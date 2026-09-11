#!/usr/bin/env python3
"""Check public Markdown links without third-party dependencies."""

from __future__ import annotations

import argparse
import ast
from contextlib import contextmanager
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


REFERENCE_RE = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)
FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
WORKTREE_IGNORE_CANDIDATES = {
    ".local",
    ".ruff_cache",
    ".worktrees",
    "__pycache__",
    "build",
    "node_modules",
    "target",
}
APPROVED_TOP_LEVEL_FILES = {
    ".gitattributes",
    ".gitignore",
    "AGENTS.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "Cargo.lock",
    "Cargo.toml",
    "LICENSE.md",
    "README.md",
    "SECURITY.md",
    "_run-catalog.bat",
    "_run-catalog.sh",
    "play-sdl.bat",
    "play-sdl.sh",
    "play-term-auto.bat",
    "play-term-auto.sh",
    "play-term-clean.bat",
    "play-term-clean.sh",
    "play-term.bat",
    "play-term.sh",
    "play-window.bat",
    "play-window.sh",
    "serve-pwa.bat",
    "serve-pwa.sh",
    "smoke-catalog.bat",
    "smoke-catalog.sh",
}
APPROVED_TOP_LEVEL_DIRECTORIES = {
    ".cargo",
    ".github",
    "LICENSES",
    "assets",
    "carts",
    "conformance",
    "crates",
    "docs",
    "packaging",
    "sdk",
    "starter",
    "tools",
    "web",
}
APPROVED_DOCS = {
    "ABI.md",
    "AI_USE.md",
    "ARCHITECTURE.md",
    "CART_AUTHORING.md",
    "FLOAT_POLICY.md",
    "README.md",
    "RUNNING.md",
    "VERSIONING.md",
}
APPROVED_CARTS = {
    "examples/hd-input-lab",
    "examples/hello-sunny",
    "horizon-burn",
    "micro-ai-war",
    "seaway-dig",
    "split-flap-fortunes",
    "sunny-api-lab",
    "sunny-api-lab-hd",
    "system/boot",
    "system/hd-boot",
    "system/launcher",
    "system/settings",
    "wormtide",
}
APPROVED_CART_ROOT_DIRECTORIES = {
    cart for cart in APPROVED_CARTS if "/" not in cart
} | {"examples", "system"}
APPROVED_CART_ROOT_FILES = {".gitignore", "README.md"}
APPROVED_CART_GROUPS = {
    "examples": {"hd-input-lab", "hello-sunny"},
    "system": {"boot", "hd-boot", "launcher", "settings"},
}
APPROVED_CARGO_PACKAGES = {
    "crates/cli/Cargo.toml": "calyx-cli",
    "crates/core/Cargo.toml": "calyx-core",
}
APPROVED_NPM_PACKAGES = {
    "conformance/package.json": "calyx-conformance",
    "sdk/package.json": "@cheesycrab/sunny",
    "starter/package.json": "my-calyx-cart",
    "web/package.json": "@cheesycrab/calyx-web",
    **{
        f"carts/{cart}/package.json": f"@cheesycrab/cart-{PurePosixPath(cart).name}"
        for cart in APPROVED_CARTS
    },
}
HOME_PATH_RE = re.compile(
    rb"(?:/(?:users|home)/(?!shared(?:[/\\]))[^/\\\s]+|"
    rb"[a-z]:[/\\]users[/\\][^/\\\s]+)(?:[/\\]|(?=\s|$))",
    re.IGNORECASE,
)
RELATIVE_PRIVATE_IMPORT_RE = re.compile(
    rb"^\s*(?:import|export|from|require|include)\b[^\r\n]*"
    rb"[/\\]private[/\\]",
    re.IGNORECASE | re.MULTILINE,
)
JAVASCRIPT_PRIVATE_IMPORT_RE = re.compile(
    rb"(?:\b(?:import|export)\b[^\r\n;]*?\bfrom\s*|"
    rb"\bimport\s*|\b(?:require|import)\s*\(\s*)"
    rb"(['\"])private(?:[/\\][^'\"]*)?\1",
    re.MULTILINE,
)
JAVASCRIPT_SUFFIXES = {".js", ".jsx", ".mjs", ".ts", ".tsx"}
SOURCE_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".gd",
    ".h",
    ".hpp",
    ".js",
    ".jsx",
    ".mjs",
    ".py",
    ".rs",
    ".sh",
    ".ts",
    ".tsx",
}
NONPUBLIC_DIRS = {
    "archive",
    "archives",
    "history",
    "inbox",
    "inboxes",
    "plan",
    "plans",
    "planning",
    "private",
    "superpowers",
}


@lru_cache(maxsize=None)
def has_tracked_ignore_boundary(root: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", ".gitignore"],
            cwd=root,
            capture_output=True,
            check=False,
        )
    except OSError:
        return False
    return result.returncode == 0


def is_worktree_ignored(root: Path, path: Path) -> bool:
    if path.name == ".git":
        return True
    if path.name not in WORKTREE_IGNORE_CANDIDATES:
        return False
    if not has_tracked_ignore_boundary(root.resolve()):
        return False
    relative = path.relative_to(root).as_posix()
    try:
        result = subprocess.run(
            ["git", "check-ignore", "--quiet", "--", relative],
            cwd=root,
            capture_output=True,
            check=False,
        )
    except OSError:
        return False
    return result.returncode == 0


@contextmanager
def publishable_tree(root: Path, excluded: frozenset[str]):
    """Expose the current Git-publishable files without ignored build residue.

    Tracked files, tracked edits, and new nonignored files are copied with
    symlinks intact. A standalone export without its own tracked ignore
    boundary keeps the raw-tree, fail-closed behavior.
    """
    root = root.resolve()
    if not has_tracked_ignore_boundary(root):
        yield root
        return
    try:
        result = subprocess.run(
            [
                "git",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                ".",
            ],
            cwd=root,
            capture_output=True,
            check=False,
        )
    except OSError:
        yield root
        return
    if result.returncode != 0:
        yield root
        return

    with tempfile.TemporaryDirectory(prefix="calyx-public-check-") as raw:
        view = Path(raw)
        for name in APPROVED_TOP_LEVEL_DIRECTORIES:
            source = root / name
            if source.is_dir() and not source.is_symlink():
                (view / name).mkdir(parents=True, exist_ok=True)
        for encoded in result.stdout.split(b"\0"):
            if not encoded:
                continue
            relative = Path(os.fsdecode(encoded))
            if relative.is_absolute() or ".." in relative.parts:
                continue
            if relative.parts and relative.parts[0] in excluded:
                continue
            source = root / relative
            if not source.exists() and not source.is_symlink():
                continue
            destination = view / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_symlink():
                destination.symlink_to(
                    os.readlink(source), target_is_directory=source.is_dir()
                )
            elif source.is_file():
                shutil.copyfile(source, destination)
            elif source.is_dir():
                destination.mkdir(exist_ok=True)
        yield view


def public_files(root: Path, excluded: frozenset[str] = frozenset()) -> list[Path]:
    files: list[Path] = []
    for current, directories, filenames in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(root)
        directories[:] = sorted(
            name
            for name in directories
            if not is_worktree_ignored(root, current_path / name)
            and not (relative == Path(".") and name in excluded)
            and not (current_path / name).is_symlink()
        )
        files.extend(current_path / name for name in sorted(filenames))
    return files


def markdown_files(root: Path, excluded: frozenset[str] = frozenset()) -> list[Path]:
    return [path for path in public_files(root, excluded) if path.suffix == ".md"]


def markdown_without_fences(text: str) -> str:
    kept: list[str] = []
    fence: tuple[str, int] | None = None
    for line in text.splitlines(keepends=True):
        match = FENCE_RE.match(line)
        marker = match.group(1) if match else ""
        if fence is None:
            if marker:
                fence = (marker[0], len(marker))
                kept.append("\n" if line.endswith("\n") else "")
            else:
                kept.append(line)
        else:
            marker_closes_fence = (
                marker
                and marker[0] == fence[0]
                and len(marker) >= fence[1]
                and line[match.end() :].strip() == ""
            )
            if marker_closes_fence:
                fence = None
            kept.append("\n" if line.endswith("\n") else "")
    return "".join(kept)


def backtick_run(text: str, start: int) -> int:
    end = start
    while end < len(text) and text[end] == "`":
        end += 1
    return end - start


def matching_backticks(text: str, start: int, length: int) -> int | None:
    index = start
    while index < len(text):
        if text[index] != "`":
            index += 1
            continue
        run = backtick_run(text, index)
        if run == length:
            return index
        index += run
    return None


def markdown_without_inline_code(text: str) -> str:
    kept: list[str] = []
    index = 0
    while index < len(text):
        if text[index] != "`":
            kept.append(text[index])
            index += 1
            continue
        run = backtick_run(text, index)
        closing = matching_backticks(text, index + run, run)
        if closing is None:
            kept.append(text[index : index + run])
            index += run
            continue
        end = closing + run
        kept.extend("\n" if char == "\n" else " " for char in text[index:end])
        index = end
    return "".join(kept)


def parenthesized_target(text: str, opening: int) -> tuple[str, int] | None:
    depth = 1
    quote: str | None = None
    angle_destination = False
    index = opening + 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if quote is not None:
            if char == quote:
                quote = None
        elif angle_destination:
            if char == ">":
                angle_destination = False
        elif char in {'"', "'"}:
            quote = char
        elif char == "<":
            angle_destination = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[opening + 1 : index], index
        index += 1
    return None


def inline_link_targets(text: str) -> list[str]:
    targets: list[str] = []
    bracket_depth = 0
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            bracket_depth += 1
        elif char == "]" and bracket_depth:
            bracket_depth -= 1
            if index + 1 < len(text) and text[index + 1] == "(":
                parsed = parenthesized_target(text, index + 1)
                if parsed is not None:
                    target, closing = parsed
                    targets.append(target)
                    index = closing
        index += 1
    return targets


def link_targets(text: str) -> list[str]:
    visible = markdown_without_inline_code(markdown_without_fences(text))
    return inline_link_targets(visible) + [
        match.group(1) for match in REFERENCE_RE.finditer(visible)
    ]


def destination(raw: str) -> str:
    value = raw.strip()
    if value.startswith("<") and ">" in value:
        return value[1 : value.index(">")]
    return value.split(maxsplit=1)[0]


def is_external(target: str) -> bool:
    if target.startswith("//"):
        return True
    return bool(urlsplit(target).scheme)


def is_nonpublic(relative: PurePosixPath) -> bool:
    lowered = [part.lower() for part in relative.parts]
    if any(part in NONPUBLIC_DIRS for part in lowered):
        return True
    stem_tokens = re.split(r"[-_]", relative.stem.lower())
    return "roadmap" in stem_tokens or "plan" in stem_tokens or bool(
        re.fullmatch(r"t\d+.*", relative.stem.lower())
    )


def check_markdown_links(
    root: Path, excluded: frozenset[str] = frozenset()
) -> tuple[list[str], int]:
    root = root.resolve()
    errors: list[str] = []
    files = markdown_files(root, excluded)
    for source in files:
        source_name = source.relative_to(root).as_posix()
        for raw in link_targets(source.read_text(encoding="utf-8")):
            target = destination(raw)
            if not target or target.startswith("#") or is_external(target):
                continue
            path_text = unquote(urlsplit(target).path)
            if not path_text:
                continue
            candidate = root / path_text.lstrip("/") if path_text.startswith("/") else source.parent / path_text
            resolved = candidate.resolve()
            try:
                relative = resolved.relative_to(root)
            except ValueError:
                errors.append(f"{source_name}: link escapes public root: {target}")
                continue
            relative_posix = PurePosixPath(relative.as_posix())
            if is_nonpublic(relative_posix):
                errors.append(f"{source_name}: nonpublic link target: {target}")
            elif not resolved.exists():
                errors.append(f"{source_name}: broken relative link: {target}")
    return errors, len(files)


def check_exact_entries(
    root: Path,
    relative: Path,
    approved_files: set[str],
    approved_directories: set[str],
) -> list[str]:
    directory = root / relative
    prefix = "" if relative == Path(".") else f"{relative.as_posix()}/"
    errors: list[str] = []
    if not directory.is_dir():
        return [f"{relative.as_posix()}: required directory is missing"]
    actual = {
        child.name
        for child in directory.iterdir()
        if not is_worktree_ignored(root, child)
    }
    approved = approved_files | approved_directories
    for name in sorted(actual - approved):
        errors.append(f"{prefix}{name}: unapproved entry")
    for name in sorted(approved - actual):
        errors.append(f"{prefix}{name}: required entry is missing")
    for name in sorted(actual & approved_files):
        if not (directory / name).is_file() or (directory / name).is_symlink():
            errors.append(f"{prefix}{name}: required file has the wrong type")
    for name in sorted(actual & approved_directories):
        if not (directory / name).is_dir() or (directory / name).is_symlink():
            errors.append(f"{prefix}{name}: required directory has the wrong type")
    return errors


def imports_private_source(path: Path, payload: bytes) -> bool:
    if RELATIVE_PRIVATE_IMPORT_RE.search(payload):
        return True
    if path.suffix.lower() == ".py":
        try:
            tree = ast.parse(payload)
        except (SyntaxError, UnicodeError):
            return False
        return any(
            (
                isinstance(node, ast.Import)
                and any(
                    alias.name == "private" or alias.name.startswith("private.")
                    for alias in node.names
                )
            )
            or (
                isinstance(node, ast.ImportFrom)
                and node.level == 0
                and node.module is not None
                and (node.module == "private" or node.module.startswith("private."))
            )
            for node in ast.walk(tree)
        )
    return (
        path.suffix.lower() in JAVASCRIPT_SUFFIXES
        and JAVASCRIPT_PRIVATE_IMPORT_RE.search(payload) is not None
    )


def check_topology(
    root: Path, excluded: frozenset[str] = frozenset()
) -> list[str]:
    errors: list[str] = []
    approved = APPROVED_TOP_LEVEL_FILES | APPROVED_TOP_LEVEL_DIRECTORIES
    actual = {
        child.name
        for child in root.iterdir()
        if not is_worktree_ignored(root, child) and child.name not in excluded
    }
    for name in sorted(actual - approved):
        errors.append(f"{name}: unknown top-level entry")
    for name in sorted(approved - actual):
        errors.append(f"{name}: required top-level entry is missing")
    for name in sorted(actual & APPROVED_TOP_LEVEL_FILES):
        path = root / name
        if not path.is_file() or path.is_symlink():
            errors.append(f"{name}: required top-level file has the wrong type")
    for name in sorted(actual & APPROVED_TOP_LEVEL_DIRECTORIES):
        path = root / name
        if not path.is_dir() or path.is_symlink():
            errors.append(f"{name}: required top-level directory has the wrong type")

    errors.extend(check_exact_entries(root, Path("docs"), APPROVED_DOCS, set()))
    errors.extend(check_exact_entries(root, Path(".github"), set(), {"workflows"}))
    errors.extend(
        check_exact_entries(
            root,
            Path(".github/workflows"),
            {"ci.yml", "release.yml", "pages.yml"},
            set(),
        )
    )
    errors.extend(
        check_exact_entries(
            root,
            Path("carts"),
            APPROVED_CART_ROOT_FILES,
            APPROVED_CART_ROOT_DIRECTORIES,
        )
    )
    for group, carts in sorted(APPROVED_CART_GROUPS.items()):
        errors.extend(
            check_exact_entries(root, Path("carts") / group, set(), carts)
        )

    for current, directories, filenames in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative_dir = current_path.relative_to(root)
        retained: list[str] = []
        for name in sorted(directories):
            path = current_path / name
            relative = path.relative_to(root)
            if is_worktree_ignored(root, path) or (
                relative_dir == Path(".") and name in excluded
            ):
                continue
            if path.is_symlink():
                errors.append(f"{relative.as_posix()}: symlink is not allowed")
            else:
                retained.append(name)
        directories[:] = retained
        for name in sorted(filenames):
            path = current_path / name
            relative = path.relative_to(root)
            if path.is_symlink():
                errors.append(f"{relative.as_posix()}: symlink is not allowed")
                continue
            try:
                payload = path.read_bytes()
            except OSError as exc:
                errors.append(f"{relative.as_posix()}: cannot read file: {exc}")
                continue
            relative_bytes = relative.as_posix().encode("utf-8")
            if HOME_PATH_RE.search(relative_bytes) or HOME_PATH_RE.search(payload):
                errors.append(f"{relative.as_posix()}: contains absolute home path")
            if path.suffix.lower() in SOURCE_SUFFIXES and imports_private_source(
                path, payload
            ):
                errors.append(
                    f"{relative.as_posix()}: import references private source"
                )
    return errors


TOML_SECTION_RE = re.compile(r"^\s*\[\[?([^]]+)\]\]?\s*(?:#.*)?$")
TOML_VALUE_RE = re.compile(
    r'^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(true|false))\s*(?:#.*)?$'
)


def toml_section(path: Path, wanted: str) -> tuple[dict[str, object], str | None]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        return {}, str(exc)
    section = ""
    values: dict[str, object] = {}
    for line in text.splitlines():
        section_match = TOML_SECTION_RE.match(line)
        if section_match:
            section = section_match.group(1)
            continue
        if section != wanted or not line.strip() or line.lstrip().startswith("#"):
            continue
        value_match = TOML_VALUE_RE.match(line)
        if value_match:
            key, string, boolean = value_match.groups()
            values[key] = string if string is not None else boolean == "true"
    return values, None


def check_cart_manifests(
    root: Path, excluded: frozenset[str] = frozenset()
) -> list[str]:
    del excluded
    errors: list[str] = []
    carts_root = root / "carts"
    if not carts_root.is_dir():
        return ["carts: required public cart directory is missing"]
    manifests = {
        path.parent.relative_to(carts_root).as_posix(): path
        for path in public_files(carts_root)
        if path.name == "cart.toml"
    }
    actual = set(manifests)
    for cart in sorted(actual - APPROVED_CARTS):
        errors.append(f"carts/{cart}: unapproved public cart")
    for cart in sorted(APPROVED_CARTS - actual):
        errors.append(f"carts/{cart}: approved public cart is missing")
    for cart in sorted(actual):
        path = manifests[cart]
        relative = path.relative_to(root).as_posix()
        values, error = toml_section(path, "cart")
        if error:
            errors.append(f"{relative}: cannot read cart manifest: {error}")
            continue
        if values.get("public_source") is not True:
            errors.append(f"{relative}: public_source must be true")
        if values.get("author") != "Cheesy Crab":
            errors.append(f"{relative}: unapproved first-party cart author")
    return errors


def package_json_name(path: Path) -> tuple[str | None, str | None]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, str(exc)
    name = document.get("name") if isinstance(document, dict) else None
    if not isinstance(name, str):
        return None, "name must be a string"
    return name, None


def check_package_identity(
    root: Path, excluded: frozenset[str] = frozenset()
) -> list[str]:
    errors: list[str] = []
    files = public_files(root, excluded)
    cargo_manifests = {
        path.relative_to(root).as_posix(): path
        for path in files
        if path.name == "Cargo.toml"
    }
    allowed_cargo_paths = {"Cargo.toml", *APPROVED_CARGO_PACKAGES}
    for relative in sorted(set(cargo_manifests) - allowed_cargo_paths):
        errors.append(f"{relative}: unapproved Cargo manifest")
    for relative, expected in sorted(APPROVED_CARGO_PACKAGES.items()):
        path = cargo_manifests.get(relative)
        if path is None:
            errors.append(f"{relative}: required Cargo package is missing")
            continue
        values, error = toml_section(path, "package")
        if error:
            errors.append(f"{relative}: cannot read Cargo manifest: {error}")
        elif values.get("name") != expected:
            errors.append(
                f"{relative}: unapproved Cargo package name: {values.get('name')}"
            )
    core = root / "crates/core/Cargo.toml"
    if core.is_file():
        values, error = toml_section(core, "lib")
        if error:
            errors.append(f"crates/core/Cargo.toml: cannot read library identity: {error}")
        elif values.get("name") != "calyx_core":
            errors.append(
                "crates/core/Cargo.toml: unapproved Rust library crate name: "
                f"{values.get('name')}"
            )

    npm_manifests = {
        path.relative_to(root).as_posix(): path
        for path in files
        if path.name == "package.json"
    }
    for relative in sorted(set(npm_manifests) - set(APPROVED_NPM_PACKAGES)):
        errors.append(f"{relative}: unapproved npm package manifest")
    for relative, expected in sorted(APPROVED_NPM_PACKAGES.items()):
        path = npm_manifests.get(relative)
        if path is None:
            errors.append(f"{relative}: required npm package is missing")
            continue
        name, error = package_json_name(path)
        if error:
            errors.append(f"{relative}: invalid package.json: {error}")
        elif name != expected:
            errors.append(f"{relative}: unapproved npm package name: {name}")
    return errors


def check_tree(
    root: Path, *, excluded: frozenset[str] = frozenset()
) -> list[str]:
    errors: list[str] = []
    errors.extend(check_topology(root, excluded))
    link_errors, _ = check_markdown_links(root, excluded)
    errors.extend(link_errors)
    errors.extend(check_cart_manifests(root, excluded))
    errors.extend(check_package_identity(root, excluded))
    return sorted(errors)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="public repository root")
    parser.add_argument(
        "--exclude",
        action="append",
        choices=("private",),
        default=[],
        help="explicit canonical-superset exclusion (only 'private' is allowed)",
    )
    args = parser.parse_args(argv)
    if not args.root.is_dir():
        parser.error(f"not a directory: {args.root}")

    excluded = frozenset(args.exclude)
    with publishable_tree(args.root, excluded) as checked_root:
        errors = check_tree(checked_root, excluded=excluded)
        checked = len(markdown_files(checked_root.resolve(), excluded))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"public-check: tree OK ({checked} Markdown files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
