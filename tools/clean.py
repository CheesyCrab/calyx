#!/usr/bin/env python3
"""Report and explicitly clean rebuildable Calyx workspace artifacts."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HEX_PAYLOAD = re.compile(r"-[0-9a-f]{16}$")
CACHE_DIRECTORY_NAMES = {"__pycache__", ".pytest_cache", ".ruff_cache"}


def path_size(path: Path) -> int:
    """Return apparent file sizes without following symlinks."""
    if not path.exists() and not path.is_symlink():
        return 0
    if path.is_symlink() or path.is_file():
        try:
            return path.lstat().st_size
        except FileNotFoundError:
            return 0
    total = 0
    try:
        entries = list(path.iterdir())
    except (FileNotFoundError, PermissionError):
        return 0
    for child in entries:
        total += path_size(child)
    return total


def human_size(value: int) -> str:
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    amount = float(value)
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.0f} {unit}" if unit == "B" else f"{amount:.1f} {unit}"
        amount /= 1024
    raise AssertionError("unreachable")


def find_named_directories(root: Path, name: str) -> list[Path]:
    found: list[Path] = []
    skipped = {".git", "target", "build"}
    for current, dirs, _files in os.walk(root):
        dirs[:] = [entry for entry in dirs if entry not in skipped]
        if name in dirs:
            path = Path(current) / name
            found.append(path)
            dirs.remove(name)
    return sorted(found)


def cart_wasm_files(root: Path) -> list[Path]:
    carts = root / "carts"
    return sorted(carts.glob("**/cart.wasm")) if carts.exists() else []


def tool_cache_targets(root: Path) -> list[Path]:
    targets: list[Path] = []
    skipped = {".git", "target", "build", "node_modules"}
    for current, dirs, _files in os.walk(root):
        dirs[:] = [entry for entry in dirs if entry not in skipped]
        caches = [entry for entry in dirs if entry in CACHE_DIRECTORY_NAMES]
        for entry in caches:
            targets.append(Path(current) / entry)
            dirs.remove(entry)
    browser_shot = root / "web" / "browser-shot.png"
    if browser_shot.exists():
        targets.append(browser_shot)
    return sorted(targets)


def transient_build_targets(root: Path) -> list[Path]:
    targets: list[Path] = []
    build = root / "build"
    if build.exists():
        targets.extend(path for path in build.iterdir() if path.name != "distributions")
    targets.extend(
        path
        for path in (
            root / "web" / "carts",
            root / "conformance" / "build",
            root / "conformance" / "out",
        )
        if path.exists()
    )
    targets.extend(cart_wasm_files(root))
    targets.extend(tool_cache_targets(root))
    return sorted(set(targets))


def distribution_base(name: str) -> str:
    for suffix in (".tar.gz.sha256", ".tar.gz"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def stale_distribution_targets(root: Path, keep: int) -> list[Path]:
    distributions = root / "build" / "distributions"
    if not distributions.exists():
        return []
    artifacts: dict[str, list[Path]] = defaultdict(list)
    for path in distributions.iterdir():
        artifacts[distribution_base(path.name)].append(path)

    families: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for base, paths in artifacts.items():
        family = HEX_PAYLOAD.sub("", base)
        newest = max(path.stat().st_mtime for path in paths)
        families[family].append((base, newest))

    stale: list[Path] = []
    for entries in families.values():
        entries.sort(key=lambda item: (item[1], item[0]), reverse=True)
        for base, _mtime in entries[keep:]:
            stale.extend(artifacts[base])
    return sorted(stale)


def report(root: Path = ROOT) -> None:
    node_modules = find_named_directories(root, "node_modules")
    wasm = cart_wasm_files(root)
    tool_caches = tool_cache_targets(root)
    rows = [
        ("Cargo target/", path_size(root / "target")),
        ("Generated build/", path_size(root / "build")),
        (
            "Conformance build/out",
            path_size(root / "conformance" / "build")
            + path_size(root / "conformance" / "out"),
        ),
        ("Generated web/carts", path_size(root / "web" / "carts")),
        ("Cart Wasm", sum(path_size(path) for path in wasm)),
        (f"Tool caches ({len(tool_caches)})", sum(path_size(path) for path in tool_caches)),
        (f"node_modules ({len(node_modules)})", sum(path_size(path) for path in node_modules)),
        ("Workspace total", path_size(root)),
    ]
    print("Calyx workspace disk report (read-only)\n")
    width = max(len(label) for label, _size in rows)
    for label, size in rows:
        print(f"  {label:<{width}}  {human_size(size):>10}")


def parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        description=(
            "Report workspace disk use by default. Cleanup selectors only preview "
            "unless --yes is also supplied. Installed hosted-PWA releases are never touched."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python3 tools/clean.py
  python3 tools/clean.py --cargo
  python3 tools/clean.py --builds --distributions --keep 2
  python3 tools/clean.py --node-modules
  python3 tools/clean.py --cargo --yes
  python3 tools/clean.py --all --yes
""",
    )


def add_arguments(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--cargo",
        action="store_true",
        help="clean the Rust target/ through cargo clean",
    )
    p.add_argument(
        "--builds",
        action="store_true",
        help="remove generated catalogs, smoke output, cart Wasm, and tool caches; preserve distributions",
    )
    p.add_argument(
        "--distributions",
        action="store_true",
        help="prune old local distribution bundles by artifact family",
    )
    p.add_argument(
        "--keep",
        type=int,
        default=2,
        metavar="N",
        help="with --distributions, retain the N newest payloads per family (default: 2)",
    )
    p.add_argument(
        "--node-modules",
        action="store_true",
        help="remove repo-local node_modules directories; later builds reinstall them",
    )
    p.add_argument("--all", action="store_true", help="select every rebuildable artifact tier")
    p.add_argument(
        "--yes",
        action="store_true",
        help="perform the selected cleanup instead of previewing it",
    )


def safe_remove(path: Path, root: Path) -> None:
    resolved_root = root.resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(resolved_root) or resolved == resolved_root:
        raise SystemExit(f"refusing unsafe cleanup target: {path}")
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def main(argv: list[str] | None = None, root: Path = ROOT) -> int:
    p = parser()
    add_arguments(p)
    args = p.parse_args(argv)
    if args.keep < 0:
        p.error("--keep must be at least 0")

    selected = (
        args.cargo
        or args.builds
        or args.distributions
        or args.node_modules
        or args.all
    )
    report(root)
    if not selected:
        print("\nCleanup options (all mutations are opt-in):\n")
        p.print_help()
        return 0

    cargo = args.cargo or args.all
    builds = args.builds or args.all
    distributions = args.distributions or args.all
    node_modules = args.node_modules or args.all
    keep = 0 if args.all else args.keep

    targets: list[Path] = []
    if builds:
        targets.extend(transient_build_targets(root))
    if distributions:
        targets.extend(stale_distribution_targets(root, keep))
    if node_modules:
        targets.extend(find_named_directories(root, "node_modules"))
    targets = sorted(set(targets))

    print("\nCleanup plan:")
    if cargo:
        print(f"  cargo clean                 {human_size(path_size(root / 'target')):>10}")
    for path in targets:
        print(f"  remove {path.relative_to(root)}  {human_size(path_size(path)):>10}")
    if not cargo and not targets:
        print("  nothing matched")
        return 0

    if not args.yes:
        print("\nPreview only; nothing removed. Re-run with --yes to execute this plan.")
        return 0

    if cargo:
        subprocess.run(["cargo", "clean"], cwd=root, check=True)
    for path in targets:
        safe_remove(path, root)
    print("\nCleanup complete.")
    report(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
