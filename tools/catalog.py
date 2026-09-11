#!/usr/bin/env python3
"""Build and view the first-party Calyx cart catalog.

One source catalog under carts/, assembled into the two shapes the product
surfaces need:

  build/catalog/   native `calyx console --carts` directory scan
  web/carts/       HTTP assets + carts.json for `web/index.html?console=...`
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import gzip
import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from socketserver import TCPServer
from pathlib import Path
from typing import Any, NamedTuple

try:
    from tools.cart_roots import discover_cart_manifests, resolve_cart_roots
    from tools.operation_lock import operation_lock
    from tools.product_identity import ABI_VERSION, PRODUCT_VERSION
    from tools.starter_package import build_starter
    from tools.flatpak_package import (
        stage_flatpak_input,
        verify_flatpak_bundle,
    )
    from tools.native_package import (
        NativePackageInputs,
        assemble_native_package,
        native_binary_path as _native_binary_path,
        native_target_label,
        verify_native_binary,
        verify_native_package as _verify_native_package,
    )
except ModuleNotFoundError:  # Direct `python3 tools/catalog.py` execution.
    from cart_roots import discover_cart_manifests, resolve_cart_roots
    from operation_lock import operation_lock
    from product_identity import ABI_VERSION, PRODUCT_VERSION
    from starter_package import build_starter
    from flatpak_package import (
        stage_flatpak_input,
        verify_flatpak_bundle,
    )
    from native_package import (
        NativePackageInputs,
        assemble_native_package,
        native_binary_path as _native_binary_path,
        native_target_label,
        verify_native_binary,
        verify_native_package as _verify_native_package,
    )

ROOT = Path(__file__).resolve().parents[1]
CARTS = ROOT / "carts"
CARTS_README = CARTS / "README.md"
SDK = ROOT / "sdk"
NATIVE_OUT = ROOT / "build" / "catalog"
WEB_OUT = ROOT / "web" / "carts"
WEB_ROOT = ROOT / "web"
RELEASE_NATIVE_OUT = ROOT / "build" / "release" / "catalog"
RELEASE_WEB_ROOT = ROOT / "build" / "release" / "web"
RELEASE_WEB_OUT = RELEASE_WEB_ROOT / "carts"
SIDE_B_NATIVE_OUT = ROOT / "build" / "sideb" / "catalog"
SIDE_B_WEB_ROOT = ROOT / "build" / "sideb" / "web"
SIDE_B_WEB_OUT = SIDE_B_WEB_ROOT / "carts"
WEB_DISTRIBUTIONS = ROOT / "build" / "distributions"
WEB_BUILD_LOCK = ROOT / "build" / ".calyx-web-build.lock"
FLATPAK_INPUT = ROOT / "build" / "flatpak" / "input"
WEB_DESCRIPTOR_SCHEMA = 1
PROFILES = ("dev", "sideb", "release")
PREFERRED_CATEGORIES = ("Games", "Stories", "Challenges", "Demos", "Settings")
SYSTEM_ROLES = ("launcher", "boot", "hd-boot")
DISPLAY_PROFILES = ("classic", "hd")
INPUT_PROFILES = ("classic", "extended")
PRESENTATION_RATES = (30, 60)
BUILD_JOBS_ENV = "CALYX_BUILD_JOBS"
MAX_AUTO_BUILD_JOBS = 4
CART_METADATA_BEGIN = "<!-- BEGIN GENERATED CART METADATA -->"
CART_METADATA_END = "<!-- END GENERATED CART METADATA -->"

# Side B marks carts that are absent from the curated release catalog without
# changing their source cover art. This 5x5 sparkle occupies only eleven pixels
# in the icon's upper-right corner; index 4 is SWEETIE-16 RED.
SIDE_B_ONLY_BADGE = (
    "00100",
    "10101",
    "01110",
    "10101",
    "00100",
)
SIDE_B_ONLY_BADGE_COLOR = 4
SIDE_B_ONLY_BADGE_X = 58
SIDE_B_ONLY_BADGE_Y = 1
MISSING_ICON_BACKGROUND = 2
MISSING_ICON_SHADOW = 5
MISSING_ICON_CROSS = 4


class BuildCommand(NamedTuple):
    label: str
    argv: list[str]
    cwd: Path


class BuildResult(NamedTuple):
    command: BuildCommand
    returncode: int | None
    stdout: str
    stderr: str


def sh(
    cmd: list[str],
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, env=env)


def positive_jobs(value: str) -> int:
    try:
        jobs = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("jobs must be an integer") from None
    if jobs < 1:
        raise argparse.ArgumentTypeError("jobs must be at least 1")
    return jobs


def glibc_ceiling(value: str) -> str:
    if re.fullmatch(r"GLIBC_(\d+(?:\.\d+)+)", value) is None:
        raise argparse.ArgumentTypeError("expected GLIBC_<version>, such as GLIBC_2.33")
    return value


def resolve_build_jobs(requested: int | None) -> int:
    """Resolve CLI/env/default precedence for bounded cart compilation."""
    if requested is not None:
        if requested < 1:
            raise SystemExit("jobs must be at least 1")
        return requested
    if raw := os.environ.get(BUILD_JOBS_ENV):
        try:
            return positive_jobs(raw)
        except argparse.ArgumentTypeError as exc:
            raise SystemExit(f"{BUILD_JOBS_ENV}: {exc}") from None
    return max(1, min(MAX_AUTO_BUILD_JOBS, os.cpu_count() or 1))


def run_captured_build(command: BuildCommand) -> BuildResult:
    try:
        completed = subprocess.run(
            command.argv,
            cwd=command.cwd,
            check=False,
            capture_output=True,
            text=True,
        )
        return BuildResult(
            command,
            completed.returncode,
            completed.stdout,
            completed.stderr,
        )
    except OSError as exc:
        return BuildResult(command, None, "", f"{type(exc).__name__}: {exc}\n")


def run_parallel_builds(
    commands: list[BuildCommand], requested_jobs: int | None
) -> None:
    """Compile concurrently, then replay diagnostics in manifest order."""
    if not commands:
        return
    workers = min(resolve_build_jobs(requested_jobs), len(commands))
    print(
        f"catalog: compiling {len(commands)} carts with {workers} job(s)",
        flush=True,
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_captured_build, command) for command in commands]
        results = [future.result() for future in futures]

    failures: list[BuildResult] = []
    for result in results:
        print(f"$ {' '.join(result.command.argv)}", flush=True)
        if result.stdout:
            print(result.stdout, end="", flush=True)
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr, flush=True)
        if result.returncode != 0:
            failures.append(result)
            status = (
                f"exit {result.returncode}"
                if result.returncode is not None
                else "could not start"
            )
            print(
                f"catalog: FAIL {result.command.label} ({status}): "
                f"{' '.join(result.command.argv)}",
                file=sys.stderr,
            )
    if failures:
        labels = ", ".join(result.command.label for result in failures)
        raise SystemExit(f"catalog: {len(failures)} cart build(s) failed: {labels}")


def npm_bin() -> str:
    """Return the npm launcher subprocess can execute on this platform."""
    name = "npm.cmd" if sys.platform == "win32" else "npm"
    npm = shutil.which(name)
    if npm is None:
        raise SystemExit(f"{name} not found — install Node.js + npm and retry")
    return npm


def read_cart_section(path: Path) -> dict[str, Any]:
    """Parse the small [cart] subset used by cart.toml manifests.

    Calyx supports Python 3.10+, so avoid tomllib here. The manifests this
    harness consumes use simple quoted strings, booleans, and integers in
    [cart].
    """
    cart: dict[str, Any] = {}
    in_cart = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            in_cart = line == "[cart]"
            continue
        if not in_cart or "=" not in line:
            continue
        key, value = [part.strip() for part in line.split("=", 1)]
        if value in ("true", "false"):
            cart[key] = value == "true"
        elif value.startswith('"') and value.endswith('"'):
            cart[key] = value[1:-1]
        elif re.fullmatch(r"-?\d+", value):
            cart[key] = int(value)
        else:
            cart[key] = value
    if "name" not in cart:
        raise SystemExit(f"{path}: [cart].name missing")
    return cart


def cart_manifest_sort_key(path: Path) -> tuple[bool, str]:
    """Alphabetical catalog order, with Settings pinned at the end."""
    name = str(read_cart_section(path)["name"])
    return (name.casefold() == "settings", path.parent.name.casefold())


def cart_role(meta: dict[str, Any]) -> str | None:
    """Return a non-ABI console role, preserving legacy launcher manifests."""
    role = str(meta.get("role", "")).strip().casefold()
    if not role and str(meta.get("name", "")).casefold() == "launcher":
        role = "launcher"
    if not role:
        return None
    if role not in SYSTEM_ROLES:
        raise SystemExit(f"unknown cart role {role!r}")
    if meta.get("system") is not True:
        raise SystemExit(f"cart role {role!r} requires system = true")
    return role


def category_sort_key(name: str) -> tuple[int, str]:
    """Mirror the launcher's preferred category order for headless feeds."""
    try:
        rank = PREFERRED_CATEGORIES.index(name)
    except ValueError:
        rank = len(PREFERRED_CATEGORIES)
    return (rank, name.casefold())


def smoke_feed_events(carts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Launch a catalog cart; round-trip through Settings when it is present."""
    settings = next(
        (cart for cart in carts if str(cart["name"]).casefold() == "settings"),
        None,
    )
    if settings is None:
        if not any(not str(cart.get("role", "")).strip() for cart in carts):
            raise SystemExit("catalog has no launchable cart")
        return [{"f": 4, "hold": ["A"]}, {"f": 5, "hold": []}]
    categories = sorted(
        {str(cart.get("category", "Games")) for cart in carts},
        key=category_sort_key,
    )
    settings_category = str(settings.get("category", "Games"))
    category_idx = categories.index(settings_category)
    category_members = [
        cart
        for cart in carts
        if str(cart.get("category", "Games")) == settings_category
    ]
    row_idx = next(
        i
        for i, cart in enumerate(category_members)
        if str(cart["name"]).casefold() == "settings"
    )

    events: list[dict[str, Any]] = []
    f = 4
    for _ in range(category_idx):
        events += [{"f": f, "hold": ["RIGHT"]}, {"f": f + 1, "hold": []}]
        f += 3
    for _ in range(row_idx):
        events += [{"f": f, "hold": ["DOWN"]}, {"f": f + 1, "hold": []}]
        f += 3
    events += [{"f": f, "hold": ["A"]}, {"f": f + 1, "hold": []}]
    exit_frame = max(20, f + 6)
    events += [
        {"f": exit_frame, "hold": ["START"]},
        {"f": exit_frame + 1, "hold": []},
    ]
    return events


def cart_manifests(roots: list[Path] | None = None) -> list[Path]:
    """Find flat product carts plus one-level role groups such as system/."""
    selected_roots = roots if roots is not None else [CARTS]
    try:
        manifests = discover_cart_manifests(selected_roots)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    return sorted(manifests, key=cart_manifest_sort_key)


def validate_publication_metadata(manifest: Path, meta: dict[str, Any]) -> None:
    """Keep source publication distinct from player-catalog curation."""
    try:
        relative = manifest.relative_to(CARTS)
    except ValueError:
        relative = None
    if relative is not None and relative.parts[0] == ".local":
        if meta.get("release") is True:
            raise SystemExit(f"{manifest}: local carts cannot enter release")
        return
    public_source = meta.get("public_source")
    if not isinstance(public_source, bool):
        raise SystemExit(f"{manifest}: [cart].public_source must be true or false")
    if meta.get("release") is True and public_source is not True:
        raise SystemExit(
            f"{manifest}: release = true requires public_source = true"
        )
    if meta.get("system") is True and public_source is not True:
        raise SystemExit(
            f"{manifest}: system = true requires public_source = true"
        )
    display = str(meta.get("display", "classic")).strip().casefold()
    if display not in DISPLAY_PROFILES:
        raise SystemExit(f"{manifest}: unknown display profile {display!r}")
    input_profile = str(meta.get("input", "classic")).strip().casefold()
    if input_profile not in INPUT_PROFILES:
        raise SystemExit(f"{manifest}: unknown input profile {input_profile!r}")
    presentation = meta.get("presentation", 60)
    if isinstance(presentation, bool) or presentation not in PRESENTATION_RATES:
        raise SystemExit(f"{manifest}: presentation must be 30 or 60")


def cart_kind(manifest: Path) -> str:
    relative = manifest.relative_to(CARTS)
    if relative.parts[0] == "system":
        return "System"
    if relative.parts[0] == "examples":
        return "Example"
    return "Product"


def cart_metadata_markdown() -> str:
    """Render the human catalog/publication view from cart manifests."""
    lines = [
        CART_METADATA_BEGIN,
        "<!-- Generated by `python3 tools/catalog.py cart-metadata --write`. -->",
        "| Cart | Kind | Category | Version | Release catalog | Public source |",
        "|---|---|---|---|---:|---:|",
    ]
    for manifest in cart_manifests([CARTS]):
        cart_dir = manifest.parent
        if not (cart_dir / "package.json").exists():
            continue
        if manifest.relative_to(CARTS).parts[0] == ".local":
            continue
        meta = read_cart_section(manifest)
        validate_publication_metadata(manifest, meta)
        relative = cart_dir.relative_to(CARTS).as_posix()
        name = str(meta["name"])
        category = str(meta.get("category", "—"))
        version = str(meta.get("version", "—"))
        release = "Yes" if meta.get("release") is True else "No"
        public = "Yes" if meta["public_source"] is True else "No"
        lines.append(
            f"| [{name}]({relative}/) | {cart_kind(manifest)} | {category} | "
            f"{version} | {release} | {public} |"
        )
    lines.append(CART_METADATA_END)
    return "\n".join(lines)


def replace_cart_metadata_block(text: str, rendered: str) -> str:
    start = text.find(CART_METADATA_BEGIN)
    end = text.find(CART_METADATA_END)
    if start < 0 or end < 0 or end < start:
        raise SystemExit(
            f"{CARTS_README}: missing generated cart metadata markers"
        )
    end += len(CART_METADATA_END)
    return text[:start] + rendered + text[end:]


def cart_metadata(args: argparse.Namespace) -> None:
    rendered = cart_metadata_markdown()
    if args.write:
        current = CARTS_README.read_text(encoding="utf-8")
        updated = replace_cart_metadata_block(current, rendered)
        CARTS_README.write_text(updated, encoding="utf-8")
        print(f"catalog: refreshed {CARTS_README.relative_to(ROOT)}")
        return
    if args.check:
        current = CARTS_README.read_text(encoding="utf-8")
        expected = replace_cart_metadata_block(current, rendered)
        if current != expected:
            raise SystemExit(
                "catalog: carts/README.md metadata is stale; run "
                "`python3 tools/catalog.py cart-metadata --write`"
            )
        print("catalog: cart metadata and generated README inventory agree")
        return
    print(rendered)


def validate_release_cart(cart_dir: Path, meta: dict[str, Any]) -> None:
    """Fail fast when an opted-in public cart is not release-shaped."""
    missing = [
        key
        for key in ("name", "author", "version", "abi", "category", "license")
        if not str(meta.get(key, "")).strip()
    ]
    if missing:
        raise SystemExit(
            f"{cart_dir / 'cart.toml'}: release cart missing " + ", ".join(missing)
        )
    icon = cart_dir / "icon.bin"
    if not icon.exists():
        raise SystemExit(f"{icon}: release cart requires a 64x64 icon")
    size = icon.stat().st_size
    if size != 4096:
        raise SystemExit(f"{icon}: expected 4096 bytes, got {size}")


def runnable_cart_dirs(
    profile: str = "dev", roots: list[Path] | None = None
) -> list[Path]:
    if profile not in PROFILES:
        raise SystemExit(f"unknown catalog profile {profile!r}")
    selected_roots = roots if roots is not None else [CARTS]
    if profile == "release" and [path.resolve() for path in selected_roots] != [
        CARTS.resolve()
    ]:
        raise SystemExit("release profile does not accept extra cart roots")
    dirs: list[Path] = []
    roles: dict[str, Path] = {}
    for manifest in cart_manifests(selected_roots):
        cart_dir = manifest.parent
        if not (cart_dir / "package.json").exists():
            continue
        meta = read_cart_section(manifest)
        validate_publication_metadata(manifest, meta)
        role = cart_role(meta)
        if role:
            if previous := roles.get(role):
                raise SystemExit(
                    f"duplicate cart role {role!r}: {previous} and {manifest}"
                )
            roles[role] = manifest
        if profile == "release" and meta.get("release") is False:
            continue
        if profile == "release" and role is None:
            if meta.get("release") is not True:
                continue
            validate_release_cart(cart_dir, meta)
        dirs.append(cart_dir)
    return dirs


def copy_tree_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def sideb_only_icon(data: bytes) -> bytes:
    """Return a cover copy with the tiny Side-B-only red sparkle applied."""
    if len(data) != 4096:
        raise ValueError(f"expected 4096 icon bytes, got {len(data)}")
    badged = bytearray(data)
    for y, row in enumerate(SIDE_B_ONLY_BADGE):
        for x, pixel in enumerate(row):
            if pixel == "1":
                offset = (SIDE_B_ONLY_BADGE_Y + y) * 64 + SIDE_B_ONLY_BADGE_X + x
                badged[offset] = SIDE_B_ONLY_BADGE_COLOR
    return bytes(badged)


def missing_cart_icon() -> bytes:
    """Return the conspicuous 64x64 icon used for missing development art."""
    icon = bytearray([MISSING_ICON_BACKGROUND] * 4096)
    for y in range(8, 56):
        for x in range(8, 56):
            distance = min(abs(x - y), abs((63 - x) - y))
            if distance <= 5:
                icon[y * 64 + x] = MISSING_ICON_SHADOW
            if distance <= 3:
                icon[y * 64 + x] = MISSING_ICON_CROSS
    return bytes(icon)


def cart_build_inputs(cart_dir: Path) -> list[Path]:
    """Inputs whose mtimes determine whether a cart wasm is current."""
    inputs: list[Path] = []
    for pattern in ("*.ts", "*.mjs", "*.js", "*.py"):
        inputs += list(cart_dir.glob(pattern))
    inputs += [
        path
        for path in (cart_dir / "package.json", cart_dir / "package-lock.json")
        if path.exists()
    ]
    inputs += list((SDK / "assembly").glob("*.ts"))
    inputs.append(SDK / "package.json")
    return inputs


def cart_needs_build(cart_dir: Path) -> bool:
    wasm = cart_dir / "cart.wasm"
    if not wasm.exists():
        return True
    wasm_mtime = wasm.stat().st_mtime_ns
    return any(
        path.stat().st_mtime_ns > wasm_mtime for path in cart_build_inputs(cart_dir)
    )


def check_built(args: argparse.Namespace) -> None:
    stale = [
        cart_dir
        for cart_dir in runnable_cart_dirs(
            args.profile, getattr(args, "cart_roots", None)
        )
        if cart_needs_build(cart_dir)
    ]
    if stale:
        names = ", ".join(cart_dir.name for cart_dir in stale)
        raise SystemExit(
            f"catalog: stale or missing cart.wasm for {names}; "
            f"run `python3 tools/catalog.py build --profile {args.profile}`"
        )
    print(f"catalog: {args.profile} cart.wasm inputs are current")


def build_first_party_carts(
    force: bool = False,
    profile: str = "dev",
    jobs: int | None = None,
    roots: list[Path] | None = None,
) -> None:
    commands: list[BuildCommand] = []
    for cart_dir in runnable_cart_dirs(profile, roots):
        if not force and not cart_needs_build(cart_dir):
            print(f"catalog: up to date {cart_dir.name}")
            continue
        if not (cart_dir / "node_modules").exists():
            command = "ci" if (cart_dir / "package-lock.json").exists() else "install"
            sh([npm_bin(), command, "--no-audit", "--no-fund"], cwd=cart_dir)
        commands.append(
            BuildCommand(cart_dir.name, [npm_bin(), "run", "build"], cart_dir)
        )
    run_parallel_builds(commands, jobs)


def assemble_native(
    out: Path,
    profile: str = "dev",
    roots: list[Path] | None = None,
) -> list[dict[str, Any]]:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    installed: list[dict[str, Any]] = []
    for cart_dir in runnable_cart_dirs(profile, roots):
        manifest = cart_dir / "cart.toml"
        meta = read_cart_section(manifest)
        wasm = cart_dir / "cart.wasm"
        if not wasm.exists():
            raise SystemExit(f"{wasm}: missing; build the cart first")
        slug = cart_dir.name
        dst = out / slug
        copy_tree_file(manifest, dst / "cart.toml")
        copy_tree_file(wasm, dst / "cart.wasm")
        role = cart_role(meta)
        icon = cart_dir / "icon.bin"
        data: bytes | None = icon.read_bytes() if icon.exists() else None
        if role is None and data is None:
            data = missing_cart_icon()
        if data is not None:
            if len(data) != 4096:
                raise SystemExit(f"{icon}: expected 4096 bytes, got {len(data)}")
            if profile == "sideb" and role is None and meta.get("release") is not True:
                data = sideb_only_icon(data)
            (dst / "icon.bin").write_bytes(data)
        installed.append({"dir": slug, "cart": meta})

    (out / ".calyx-catalog.json").write_text(
        json.dumps(
            {
                "schema": 1,
                "profile": profile,
                "carts": [item["dir"] for item in installed],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return installed


def assemble_web(native: Path, web_out: Path) -> None:
    if web_out.exists():
        shutil.rmtree(web_out)
    web_out.mkdir(parents=True)
    web_prefix = web_out.name

    manifest: dict[str, Any] = {"carts": []}
    for cart_manifest in sorted(native.glob("*/cart.toml"), key=cart_manifest_sort_key):
        cart_dir = cart_manifest.parent
        meta = read_cart_section(cart_manifest)
        name = str(meta["name"])
        slug = cart_dir.name
        dst = web_out / slug
        copy_tree_file(cart_dir / "cart.wasm", dst / "cart.wasm")
        role = cart_role(meta)
        if role:
            manifest[role] = f"./{web_prefix}/{slug}/cart.wasm"
            continue
        entry = {
            "name": name,
            "author": str(meta.get("author", "unknown")),
            "version": str(meta.get("version", "0.0")),
            "license": str(meta.get("license", "UNLICENSED")),
            "category": str(meta.get("category", "Games")),
            "wasm": f"./{web_prefix}/{slug}/cart.wasm",
            "display": str(meta.get("display", "classic")),
            "input": str(meta.get("input", "classic")),
            "presentation": int(meta.get("presentation", 60)),
        }
        if meta.get("system"):
            entry["system"] = True
        icon = cart_dir / "icon.bin"
        if icon.exists():
            data = icon.read_bytes()
            if len(data) != 4096:
                raise SystemExit(f"{icon}: expected 4096 bytes, got {len(data)}")
            entry["icon"] = base64.b64encode(data).decode("ascii")
        manifest["carts"].append(entry)

    if "launcher" not in manifest:
        raise SystemExit(f"{native}: catalog has no launcher role")
    (web_out / "carts.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )


def assemble_product_web_shell(out: Path, channel: str) -> None:
    """Copy and brand a self-contained stable or Side B player shell."""
    if channel not in ("stable", "sideb"):
        raise SystemExit(f"unknown web channel {channel!r}")
    prefix = "sideb-" if channel == "sideb" else ""
    icon_source = json.loads((WEB_ROOT / f"{prefix}icon-source.json").read_text())
    canonical_mark = (WEB_ROOT / icon_source["source"]).resolve()
    if sha256_bytes(canonical_mark.read_bytes()) != icon_source["source_sha256"]:
        raise SystemExit(
            f"{channel} PWA icons have drifted from their canonical Calyx mark"
        )
    for name, size in icon_source["outputs"].items():
        data = (WEB_ROOT / name).read_bytes()
        if (
            data[:8] != b"\x89PNG\r\n\x1a\n"
            or int.from_bytes(data[16:20], "big") != size
            or int.from_bytes(data[20:24], "big") != size
        ):
            raise SystemExit(f"{name}: expected a {size}x{size} PNG")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in (
        "app.mjs",
        "styles.css",
    ):
        copy_tree_file(WEB_ROOT / name, out / name)
    index = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
    if channel == "sideb":
        index = index.replace(
            '<html lang="en">', '<html lang="en" data-channel="sideb">'
        )
        index = index.replace("<title>Calyx</title>", "<title>Calyx Side B</title>")
    (out / "index.html").write_text(index, encoding="utf-8")
    manifest = json.loads(
        (WEB_ROOT / "manifest.webmanifest").read_text(encoding="utf-8")
    )
    if channel == "sideb":
        manifest.update(
            {
                "name": "Calyx Side B",
                "short_name": "Calyx Side B",
                "id": "./calyx-sideb",
                "description": "The unstable Calyx Side B console for testing current builds.",
            }
        )
    (out / "manifest.webmanifest").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    copy_tree_file(canonical_mark, out / "icon.svg")
    for output_name in icon_source["outputs"]:
        installed_name = output_name.removeprefix(prefix)
        copy_tree_file(WEB_ROOT / output_name, out / installed_name)
    installed_icon_source = {
        **icon_source,
        "channel": channel,
        "outputs": {
            name.removeprefix(prefix): size
            for name, size in icon_source["outputs"].items()
        },
    }
    (out / "icon-source.json").write_text(
        json.dumps(installed_icon_source, indent=2) + "\n", encoding="utf-8"
    )
    shutil.copytree(WEB_ROOT / "src", out / "src")
    qr_source = WEB_ROOT / "node_modules" / "qrcode-generator" / "qrcode.js"
    if not qr_source.is_file():
        raise SystemExit("web QR dependency missing; run `npm install` in web/")
    copy_tree_file(qr_source, out / "node_modules" / "qrcode-generator" / "qrcode.js")
    build_starter(out / "downloads")


def cart_license_rows(catalog: Path) -> list[str]:
    rows: list[str] = []
    for manifest in sorted(catalog.glob("*/cart.toml"), key=cart_manifest_sort_key):
        meta = read_cart_section(manifest)
        rows.append(
            f"- {meta.get('name', manifest.parent.name)} "
            f"{meta.get('version', '0.0.0')}: {meta.get('license', 'UNLICENSED')}"
        )
    return rows


def sdl_feature(link: str) -> str:
    if link == "bundled":
        return "sdl-bundled"
    if link == "system":
        return "sdl"
    raise SystemExit(f"unknown SDL link mode {link!r}")


def native_dependency_rows(
    target: str, sdl_link: str = "bundled"
) -> list[tuple[str, str, str]]:
    command = [
        "cargo",
        "tree",
        "-p",
        "calyx-cli",
        "--no-default-features",
        "--features",
        sdl_feature(sdl_link),
        "--edges",
        "normal",
        "--target",
        target,
        "--prefix",
        "none",
        "--format",
        "{p}\t{l}",
    ]
    output = subprocess.run(
        command, cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout
    rows: set[tuple[str, str, str]] = set()
    for raw in output.splitlines():
        line = raw.removesuffix(" (*)")
        if "\t" not in line:
            continue
        package, license_name = line.rsplit("\t", 1)
        match = re.match(r"([^ ]+) v([^ ]+)", package)
        if not match or match.group(1) in {"calyx-cli", "calyx-core"}:
            continue
        rows.add((match.group(1), match.group(2), license_name or "UNLICENSED"))
    return sorted(rows)


def copy_registry_license_files(
    out: Path, packages: list[tuple[str, str, str]]
) -> dict[tuple[str, str], list[str]]:
    cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    registries = list((cargo_home / "registry" / "src").glob("*"))
    copied: dict[str, str] = {}
    mapping: dict[tuple[str, str], list[str]] = {}
    destination = out / "licenses" / "third-party"
    for name, version, _license_name in packages:
        roots = [path / f"{name}-{version}" for path in registries]
        files: list[Path] = []
        for root in roots:
            if not root.is_dir():
                continue
            files.extend(
                path
                for path in root.rglob("*")
                if path.is_file()
                and path.name.upper().startswith(
                    ("LICENSE", "COPYING", "NOTICE", "UNLICENSE", "COPYRIGHT")
                )
            )
        installed: list[str] = []
        for source in sorted(files):
            data = source.read_bytes()
            digest = sha256_bytes(data)
            relative = copied.get(digest)
            if relative is None:
                safe_name = re.sub(r"[^A-Za-z0-9_.-]", "-", source.name)
                target = destination / f"{digest[:16]}-{safe_name}"
                copy_tree_file(source, target)
                relative = target.relative_to(out).as_posix()
                copied[digest] = relative
            installed.append(relative)
        mapping[(name, version)] = sorted(set(installed))
    return mapping


def copy_product_license_material(
    out: Path,
    surface: str,
    catalog: Path,
    dependency_target: str | None = None,
    sdl_link: str = "bundled",
) -> None:
    copy_tree_file(ROOT / "LICENSE.md", out / "LICENSE.md")
    shutil.copytree(ROOT / "LICENSES", out / "licenses" / "first-party")
    lines = [
        "Cheesy Crab Calyx component notices",
        "",
        "This product contains independently licensed components.",
        "Distribution together does not replace their component licenses.",
        "",
        "FIRST-PARTY COMPONENTS",
        "",
        f"- Calyx {surface} runtime/player: LGPL-3.0-or-later",
        "- Sunny guest SDK code compiled into carts: MIT OR Apache-2.0",
        "",
        "CARTS",
        "",
        *cart_license_rows(catalog),
        "",
        "THIRD-PARTY COMPONENTS",
        "",
        "- m6x11 font by Daniel Linssen: free to use with attribution",
        "  Source and terms: https://managore.itch.io/m6x11",
        "  Calyx embeds a pinned bitmap derived from this font.",
        "",
    ]
    if surface == "web":
        lines.extend(
            [
                "- qrcode-generator 1.4.4: MIT",
                "  Copyright (c) 2009 Kazuhiko Arase",
                "  The distributed qrcode.js retains its upstream notice.",
            ]
        )
    elif dependency_target is not None:
        packages = native_dependency_rows(dependency_target, sdl_link=sdl_link)
        license_files = copy_registry_license_files(out, packages)
        for name, version, license_name in packages:
            files = license_files[(name, version)]
            lines.append(f"- {name} {version}: {license_name}")
            if files:
                lines.append("  License text(s): " + ", ".join(files))
            else:
                lines.append(
                    "  Upstream crate metadata declares this license; no separate "
                    "license file was present in the published crate."
                )
    (out / "NOTICES.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    source_note = (
        "Calyx corresponding source\n\n"
        "The corresponding release-source archive is published with each Calyx release.\n"
        "The adjacent release.json (web) or package.json (native/Flatpak) identifies the\n"
        "source revision and whether local changes were present. The readable web\n"
        "runtime source is also included directly in a web payload. Release\n"
        "artifacts must provide matching cart, SDK, runtime, build-script, and\n"
        "lockfile source for that descriptor; a LOCAL Side B build requires its\n"
        "matching source snapshot rather than the base commit alone.\n"
    )
    (out / "SOURCE.txt").write_text(source_note, encoding="utf-8")


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_build_info() -> dict[str, Any]:
    """Describe the Calyx source used for a product payload.

    Clean builds use the commit timestamp so rebuilding the same revision stays
    reproducible. A build with local changes uses its actual assembly time and a
    compact fingerprint of the scoped Git diff and untracked files.
    """

    def git(*args: str) -> bytes:
        return subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            capture_output=True,
        ).stdout

    try:
        revision = git("rev-parse", "HEAD").decode().strip()
        status = git("status", "--porcelain=v1", "--untracked-files=all", "--", ".")
        local = bool(status.strip())
        fingerprint: str | None = None
        if local:
            digest = hashlib.sha256()
            digest.update(status)
            digest.update(git("diff", "--binary", "--no-ext-diff", "--", "."))
            digest.update(
                git("diff", "--cached", "--binary", "--no-ext-diff", "--", ".")
            )
            repo = Path(git("rev-parse", "--show-toplevel").decode().strip())
            untracked = git(
                "ls-files", "--others", "--exclude-standard", "-z", "--", "."
            )
            for raw_path in filter(None, untracked.split(b"\0")):
                path = repo / os.fsdecode(raw_path)
                digest.update(raw_path + b"\0")
                if path.is_file():
                    digest.update(path.read_bytes())
            fingerprint = digest.hexdigest()[:12]
        if epoch := os.environ.get("SOURCE_DATE_EPOCH"):
            built_at = datetime.fromtimestamp(int(epoch), timezone.utc).isoformat()
        elif local:
            built_at = datetime.now(timezone.utc).isoformat()
        else:
            built_at = git("show", "-s", "--format=%cI", "HEAD").decode().strip()
        return {
            "source_revision": revision,
            "source_local": local,
            "source_fingerprint": fingerprint,
            "built_at": built_at,
        }
    except (OSError, subprocess.CalledProcessError, ValueError):
        return {
            "source_revision": "unknown",
            "source_local": True,
            "source_fingerprint": None,
            "built_at": datetime.now(timezone.utc).isoformat(),
        }


def inventory(root: Path, excluded: set[str] | None = None) -> list[dict[str, Any]]:
    excluded = excluded or set()
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if relative in excluded:
            continue
        if path.is_symlink():
            raise SystemExit(f"{path}: release payload may not contain symlinks")
        if not path.is_file():
            continue
        data = path.read_bytes()
        entries.append(
            {"path": relative, "bytes": len(data), "sha256": sha256_bytes(data)}
        )
    return entries


def finalize_product_web(
    root: Path, channel: str, build_info: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Generate a content-addressed worker and reproducible payload descriptor."""
    for generated in ("sw.js", "release.json"):
        (root / generated).unlink(missing_ok=True)
    ordinary = inventory(root)
    asset_fingerprint = sha256_bytes(canonical_json(ordinary))
    template = (WEB_ROOT / "sw-template.js").read_text(encoding="utf-8")
    worker = (
        template.replace("__ASSET_FINGERPRINT__", asset_fingerprint)
        .replace("__DESCRIPTOR_SCHEMA__", str(WEB_DESCRIPTOR_SCHEMA))
        .replace("__CHANNEL_PREFIX__", "sideb-" if channel == "sideb" else "")
    )
    if any(
        token in worker
        for token in (
            "__ASSET_FINGERPRINT__",
            "__DESCRIPTOR_SCHEMA__",
            "__CHANNEL_PREFIX__",
        )
    ):
        raise SystemExit("service-worker template token replacement failed")
    (root / "sw.js").write_text(worker, encoding="utf-8")
    files = inventory(root)
    payload_id = sha256_bytes(canonical_json(files))
    catalog = json.loads((root / "carts" / "carts.json").read_text(encoding="utf-8"))
    descriptor = {
        "schema": WEB_DESCRIPTOR_SCHEMA,
        "product": "Calyx Side B" if channel == "sideb" else "Cheesy Crab Calyx",
        "channel": channel,
        "status": "sideb" if channel == "sideb" else "release-candidate",
        "abi": ABI_VERSION,
        "asset_fingerprint": asset_fingerprint,
        "payload_id": payload_id,
        **(build_info or source_build_info()),
        "worker_template_sha256": sha256_bytes(
            (WEB_ROOT / "sw-template.js").read_bytes()
        ),
        "carts": [
            {key: cart[key] for key in ("name", "version")} for cart in catalog["carts"]
        ],
        "files": files,
    }
    (root / "release.json").write_bytes(canonical_json(descriptor) + b"\n")
    return descriptor


def build_catalog(args: argparse.Namespace) -> None:
    if not args.skip_build:
        build_first_party_carts(
            force=args.rebuild,
            profile=args.profile,
            jobs=args.jobs,
            roots=getattr(args, "cart_roots", None),
        )
    installed = assemble_native(
        args.native_out,
        profile=args.profile,
        roots=getattr(args, "cart_roots", None),
    )
    if args.profile in ("sideb", "release"):
        channel = "sideb" if args.profile == "sideb" else "stable"
        assemble_product_web_shell(args.web_out.parent, channel)
    assemble_web(args.native_out, args.web_out)
    if args.profile in ("sideb", "release"):
        copy_product_license_material(
            args.web_out.parent, "web", args.native_out
        )
        descriptor = finalize_product_web(
            args.web_out.parent, channel, source_build_info()
        )
        print(f"catalog: payload {descriptor['payload_id']}")
    names = ", ".join(item["cart"]["name"] for item in installed)
    print(f"catalog: {args.profile} installed {len(installed)} carts: {names}")
    print(f"catalog: native {args.native_out}")
    print(f"catalog: pwa    {args.web_out / 'carts.json'}")


def calyx_prefix(args: argparse.Namespace) -> list[str]:
    if args.calyx:
        return [args.calyx]
    return ["cargo", "run", "-p", "calyx-cli", "--"]


def sdl_calyx_prefix(args: argparse.Namespace) -> list[str]:
    if args.calyx:
        return [args.calyx]
    return [
        "cargo",
        "run",
        "-p",
        "calyx-cli",
        "--features",
        "sdl-bundled",
        "--",
    ]


def ensure_catalog(args: argparse.Namespace) -> None:
    with operation_lock(WEB_BUILD_LOCK, f"catalog:{args.profile}"):
        ensure_catalog_locked(args)


def ensure_catalog_locked(args: argparse.Namespace) -> None:
    build_args = argparse.Namespace(
        skip_build=args.skip_build,
        rebuild=args.rebuild,
        jobs=args.jobs,
        profile=args.profile,
        native_out=args.native_out,
        web_out=args.web_out,
        cart_roots=getattr(args, "cart_roots", None),
    )
    build_catalog(build_args)


def smoke(args: argparse.Namespace) -> None:
    ensure_catalog(args)
    feed: Path | None = args.feed
    if feed is None and not args.no_feed:
        feed = ROOT / "build" / "catalog-smoke-feed.json"
        feed.parent.mkdir(parents=True, exist_ok=True)
        # Native console feeds are local to the active cart. Dev and Side B
        # navigate to Settings and round-trip through sys_exit. Release omits
        # transient Settings, so its smoke launches the first curated cart.
        carts = [
            read_cart_section(path)
            for path in sorted(
                args.native_out.glob("*/cart.toml"), key=cart_manifest_sort_key
            )
            if path.parent.name != "launcher"
        ]
        events = smoke_feed_events(carts)
        feed.write_text(json.dumps(events) + "\n", encoding="utf-8")
    cmd = calyx_prefix(args) + [
        "console",
        "--carts",
        str(args.native_out),
        "--present",
        "headless",
        "--frames",
        str(args.frames),
        "--out",
        str(args.out),
        "--every",
        str(args.every),
    ]
    if feed is not None:
        cmd += ["--in", str(feed)]
    sh(cmd)
    status_path = args.out / "status.json"
    if status_path.exists() and not args.no_feed:
        status = json.loads(status_path.read_text(encoding="utf-8"))
        if int(status.get("swaps", 0)) < 1:
            raise SystemExit(f"{status_path}: expected at least one catalog swap")
    print(f"catalog: smoke dump {args.out}")


def play_term(args: argparse.Namespace) -> None:
    ensure_catalog(args)
    size = shutil.get_terminal_size(fallback=(0, 0))
    if args.term_scale == "clean" and (
        size.columns < args.width or size.lines < (args.height // 2)
    ):
        print(
            "catalog: warning: clean terminal mode needs "
            f"{args.width}x{args.height // 2} cells; current terminal is "
            f"{size.columns}x{size.lines}. Use auto mode for a fitted view.",
            file=sys.stderr,
            flush=True,
        )
    cmd = calyx_prefix(args) + [
        "console",
        "--carts",
        str(args.native_out),
        "--present",
        "term",
        "--fps",
        str(args.fps),
        "--width",
        str(args.width),
        "--height",
        str(args.height),
        "--term-scale",
        args.term_scale,
    ]
    sh(cmd)


def play_window(args: argparse.Namespace) -> None:
    ensure_catalog(args)
    cmd = calyx_prefix(args) + [
        "console",
        "--carts",
        str(args.native_out),
        "--present",
        "window",
        "--audio",
        args.audio,
    ]
    sh(cmd)


def play_sdl(args: argparse.Namespace) -> None:
    ensure_catalog(args)
    cmd = sdl_calyx_prefix(args) + [
        "console",
        "--carts",
        str(args.native_out),
        "--present",
        "sdl",
        "--audio",
        args.audio,
        "--fullscreen",
        args.fullscreen,
    ]
    if args.controller_db:
        cmd += ["--controller-db", str(args.controller_db)]
    sh(cmd)


def rust_host() -> str:
    result = subprocess.run(
        ["rustc", "-vV"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("host: "):
            return line.removeprefix("host: ")
    return f"{platform.machine()}-{sys.platform}"


def deterministic_tar_gz(source: Path, archive: Path) -> None:
    """Archive a distribution without host timestamps/owners."""
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    with archive.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=epoch) as zipped:
            with tarfile.open(fileobj=zipped, mode="w") as tar:
                for path in [source, *sorted(source.rglob("*"))]:
                    relative = path.relative_to(source.parent)
                    info = tar.gettarinfo(str(path), arcname=str(relative))
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = epoch
                    if path.is_file():
                        with path.open("rb") as handle:
                            tar.addfile(info, handle)
                    else:
                        tar.addfile(info)


def native_binary_path(
    target: str | None,
    environ: dict[str, str] | None = None,
) -> Path:
    return _native_binary_path(ROOT, target, environ)


def package_build_environment(
    root: Path,
    target: str,
    environ: dict[str, str],
) -> dict[str, str]:
    """Return a package-build environment without builder-specific source paths."""
    env = dict(environ)
    env.setdefault("CARGO_TARGET_DIR", str(root.resolve() / "build" / "package-target"))
    cargo_home = Path(env.get("CARGO_HOME", Path.home() / ".cargo")).expanduser()
    if not cargo_home.is_absolute():
        cargo_home = root / cargo_home
    remaps = (
        (root.resolve(), "/calyx-source"),
        (cargo_home.resolve(), "/cargo-home"),
    )

    encoded = env.get("CARGO_ENCODED_RUSTFLAGS")
    if encoded is not None:
        rust_flags = [flag for flag in encoded.split("\x1f") if flag]
    else:
        rust_flags = shlex.split(env.get("RUSTFLAGS", ""), posix=os.name != "nt")
    rust_flags.extend(
        f"--remap-path-prefix={source}={destination}"
        for source, destination in remaps
    )
    env.pop("RUSTFLAGS", None)
    env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(rust_flags)

    msvc = target.endswith("-msvc")
    for name in ("CFLAGS", "CXXFLAGS"):
        prefix_flags = [
            (
                f"/pathmap:{source}={destination}"
                if msvc
                else f"-ffile-prefix-map={source}={destination}"
            )
            for source, destination in remaps
        ]
        rendered = (
            subprocess.list2cmdline(prefix_flags)
            if msvc
            else shlex.join(prefix_flags)
        )
        existing = env.get(name, "").strip()
        env[name] = f"{existing} {rendered}".strip()
    return env


def ensure_native_catalog(args: argparse.Namespace) -> list[dict[str, Any]]:
    if not args.skip_build:
        build_first_party_carts(
            force=args.rebuild,
            profile=args.profile,
            jobs=args.jobs,
            roots=getattr(args, "cart_roots", None),
        )
    installed = assemble_native(
        args.native_out,
        profile=args.profile,
        roots=getattr(args, "cart_roots", None),
    )
    names = ", ".join(item["cart"]["name"] for item in installed)
    print(f"catalog: {args.profile} installed {len(installed)} carts: {names}")
    return installed


def dist_native(args: argparse.Namespace) -> None:
    if args.profile not in ("sideb", "release"):
        raise SystemExit("dist-native requires --profile sideb or --profile release")
    build_info = source_build_info()
    if args.profile == "release" and build_info.get("source_local") is not False:
        raise SystemExit("release native packages require clean committed source")
    ensure_native_catalog(args)
    target = args.target or rust_host()
    native_target_label(target)
    cmd = [
        "cargo",
        "build",
        "--release",
        "--no-default-features",
        "--features",
        sdl_feature(args.sdl_link),
    ]
    if args.target:
        cmd += ["--target", args.target]
    build_env = package_build_environment(
        ROOT,
        target,
        {**os.environ, "CALYX_PACKAGE_PROFILE": args.profile},
    )
    sh(
        cmd,
        env=build_env,
    )

    binary = native_binary_path(args.target, build_env)
    if not binary.exists():
        raise SystemExit(f"{binary}: release build produced no calyx binary")
    inputs = NativePackageInputs(
        root=ROOT,
        profile=args.profile,
        target=target,
        sdl_link=args.sdl_link,
        max_glibc=args.max_glibc,
        binary=binary,
        catalog=args.native_out,
        out=args.out,
        build_info=build_info,
        product_version=PRODUCT_VERSION,
        abi_version=ABI_VERSION,
    )

    def write_licenses(package: Path, catalog_dir: Path, target: str, sdl: str) -> None:
        copy_product_license_material(
            package,
            "native",
            catalog_dir,
            dependency_target=target,
            sdl_link=sdl,
        )

    result = assemble_native_package(inputs, write_licenses)
    print(f"catalog: native distribution {result.package}")
    print(f"catalog: native archive      {result.archive}")
    print(f"catalog: native checksum     {result.checksum}")


def verify_native_archive(args: argparse.Namespace) -> None:
    build_info = source_build_info()
    revision = str(build_info["source_revision"])
    if build_info.get("source_local"):
        revision += f"+LOCAL-{build_info['source_fingerprint']}"
    receipt = _verify_native_package(args.archive, revision)
    print(f"catalog: native verification {receipt}")


def dist_flatpak_input(args: argparse.Namespace) -> None:
    if args.profile != "release":
        raise SystemExit("flatpak-input requires --profile release")
    build_info = source_build_info()
    if build_info.get("source_local") is not False:
        status_result = subprocess.run(
            ["git", "status", "--short", "--untracked-files=all", "--", "."],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        status = status_result.stdout.strip()
        diagnostic = status or status_result.stderr.strip()
        detail = f":\n{diagnostic}" if diagnostic else ""
        raise SystemExit(
            f"release Flatpak input requires clean committed source{detail}"
        )
    ensure_native_catalog(args)

    def write_licenses(product: Path, catalog_dir: Path) -> None:
        copy_product_license_material(
            product,
            "Flatpak",
            catalog_dir,
            dependency_target="x86_64-unknown-linux-gnu",
            sdl_link="bundled",
        )

    descriptor = stage_flatpak_input(
        root=ROOT,
        catalog=args.native_out,
        out=args.out,
        build_info=build_info,
        product_version=PRODUCT_VERSION,
        abi_version=ABI_VERSION,
        license_writer=write_licenses,
    )
    print(f"catalog: Flatpak input {args.out}")
    print(f"catalog: Flatpak catalog {descriptor['catalog_payload_id']}")


def verify_flatpak(args: argparse.Namespace) -> None:
    receipt = verify_flatpak_bundle(args.bundle, args.input)
    print(f"catalog: Flatpak verification {receipt}")


def dist_web(args: argparse.Namespace) -> None:
    if args.profile == "dev":
        raise SystemExit("dist-web requires --profile sideb or --profile release")
    with operation_lock(WEB_BUILD_LOCK, f"dist-web:{args.profile}"):
        ensure_catalog_locked(args)
        descriptor = json.loads((args.web_out.parent / "release.json").read_text())
        short_id = descriptor["payload_id"][:16]
        args.out.mkdir(parents=True, exist_ok=True)
        build_starter(args.out)
        channel = descriptor.get("channel", "stable")
        label = "sideb" if channel == "sideb" else "rc"
        package = args.out / f"calyx-web-{label}-{short_id}"
        if package.exists():
            shutil.rmtree(package)
        shutil.copytree(args.web_out.parent, package)
        archive = package.with_suffix(".tar.gz")
        deterministic_tar_gz(package, archive)
        checksum = Path(f"{archive}.sha256")
        checksum.write_text(
            f"{sha256_bytes(archive.read_bytes())}  {archive.name}\n",
            encoding="ascii",
        )
        print(f"catalog: web distribution {archive}")
        print(f"catalog: sha256          {checksum}")


def local_addresses() -> list[str]:
    addrs: set[str] = set()
    try:
        host = socket.gethostname()
        for info in socket.getaddrinfo(host, None, family=socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                addrs.add(ip)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if not ip.startswith("127."):
                addrs.add(ip)
    except OSError:
        pass
    return sorted(addrs)


def serve_pwa(args: argparse.Namespace) -> None:
    ensure_catalog(args)
    product_build = args.profile in ("sideb", "release")
    path = (
        "/"
        if product_build
        else f"/index.html?console=./{args.web_out.name}/carts.json"
    )
    serve_root = args.web_out.parent if product_build else WEB_ROOT
    bind_host = args.host
    print(f"catalog: serving on {bind_host}:{args.port}", flush=True)
    print(f"catalog: local  http://127.0.0.1:{args.port}{path}", flush=True)
    if bind_host in ("0.0.0.0", "::"):
        for ip in local_addresses():
            print(f"catalog: phone  http://{ip}:{args.port}{path}", flush=True)
        print(
            "catalog: note: phone Safari must use the Mac/host LAN IP, not "
            "127.0.0.1; installable PWA features may require HTTPS, but play "
            "mode should load over same-origin HTTP.",
            flush=True,
        )

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {
            **SimpleHTTPRequestHandler.extensions_map,
            ".wasm": "application/wasm",
            ".json": "application/json",
            ".mjs": "text/javascript",
        }

        def __init__(self, *h_args: Any, **h_kwargs: Any) -> None:
            super().__init__(*h_args, directory=str(serve_root), **h_kwargs)

    class LocalHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

        def server_bind(self) -> None:
            # http.server.HTTPServer.server_bind does a reverse DNS lookup
            # via socket.getfqdn(host). In sandboxed or offline localhost
            # sessions that can hang before the server starts.
            TCPServer.server_bind(self)
            self.server_name = self.server_address[0]
            self.server_port = self.server_address[1]

    httpd = LocalHTTPServer((bind_host, args.port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\ncatalog: server stopped")


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    check = sub.add_parser(
        "check-built",
        help="refuse stale or missing cart.wasm files without rebuilding",
    )
    check.add_argument("--profile", choices=PROFILES, default="sideb")
    check.add_argument(
        "--extra-cart-root",
        action="append",
        default=[],
        type=Path,
        metavar="PATH",
        help="include carts from an additional explicit root (Dev/Side B only)",
    )
    check.set_defaults(func=check_built)

    metadata = sub.add_parser(
        "cart-metadata",
        help="print or verify the manifest-owned catalog/publication inventory",
    )
    metadata_mode = metadata.add_mutually_exclusive_group()
    metadata_mode.add_argument(
        "--check",
        action="store_true",
        help="fail if carts/README.md does not match the manifests",
    )
    metadata_mode.add_argument(
        "--write",
        action="store_true",
        help="refresh the generated carts/README.md inventory",
    )
    metadata.set_defaults(func=cart_metadata)

    def shared(sp: argparse.ArgumentParser, default_profile: str = "dev") -> None:
        build = sp.add_mutually_exclusive_group()
        build.add_argument(
            "--skip-build",
            action="store_true",
            help="assemble from existing cart.wasm files without checking sources",
        )
        build.add_argument(
            "--rebuild",
            action="store_true",
            help="force every cart to compile instead of using mtime checks",
        )
        sp.add_argument(
            "--profile",
            choices=PROFILES,
            default=default_profile,
            help="dev is the loose harness; sideb is an installable current build; release is curated stable",
        )
        sp.add_argument(
            "--extra-cart-root",
            action="append",
            default=[],
            type=Path,
            metavar="PATH",
            help="include carts from an additional explicit root (Dev/Side B only)",
        )
        sp.add_argument(
            "--jobs",
            type=positive_jobs,
            default=None,
            metavar="N",
            help=(
                "parallel cart compiles (default: min(CPU count, 4); "
                f"{BUILD_JOBS_ENV} also supported)"
            ),
        )
        sp.add_argument(
            "--native-out",
            type=Path,
            default=None,
        )
        sp.add_argument(
            "--web-out",
            type=Path,
            default=None,
        )

    b = sub.add_parser("build", help="build carts and assemble native/PWA catalogs")
    shared(b)
    b.set_defaults(func=ensure_catalog)

    s = sub.add_parser("smoke", help="headless native console smoke with PNG dump")
    shared(s)
    s.add_argument("--calyx", help="use an installed calyx binary instead of cargo run")
    s.add_argument("--frames", type=int, default=150)
    s.add_argument("--every", type=int, default=30)
    s.add_argument("--out", type=Path, default=ROOT / "build" / "catalog-smoke")
    s.add_argument("--feed", type=Path, help="custom console input feed")
    s.add_argument(
        "--no-feed", action="store_true", help="only boot/render the launcher"
    )
    s.set_defaults(func=smoke)

    t = sub.add_parser(
        "play-term", help="play the catalog through the terminal presenter"
    )
    shared(t)
    t.add_argument("--calyx", help="use an installed calyx binary instead of cargo run")
    t.add_argument("--fps", type=int, choices=(30, 60), default=30)
    t.add_argument(
        "--frames",
        type=int,
        default=0,
        help=argparse.SUPPRESS,
    )
    t.add_argument("--width", type=int, default=320)
    t.add_argument("--height", type=int, default=240)
    t.add_argument("--term-scale", choices=("auto", "clean"), default="auto")
    t.set_defaults(func=play_term)

    v = sub.add_parser("play-window", help="play the catalog in a native window")
    shared(v)
    v.add_argument("--calyx", help="use an installed calyx binary instead of cargo run")
    v.add_argument("--audio", choices=("on", "off"), default="on")
    v.set_defaults(func=play_window)

    d = sub.add_parser("play-sdl", help="play the catalog in portable SDL2 fullscreen")
    shared(d)
    d.add_argument("--calyx", help="use an installed calyx binary instead of cargo run")
    d.add_argument("--audio", choices=("on", "off"), default="on")
    d.add_argument("--fullscreen", choices=("on", "off"), default="on")
    d.add_argument(
        "--controller-db", type=Path, help="extra SDL controller mapping database"
    )
    d.set_defaults(func=play_sdl)

    package = sub.add_parser(
        "dist-native", help="build a self-contained Side B or release native package"
    )
    shared(package, default_profile="sideb")
    package.add_argument("--target", help="Rust target triple (defaults to the host)")
    package.add_argument(
        "--sdl-link",
        choices=("bundled", "system"),
        default="bundled",
        help="bundle SDL2 (default) or link the target platform's SDL2",
    )
    package.add_argument(
        "--max-glibc",
        type=glibc_ceiling,
        help="fail if the binary requires a newer glibc (for example GLIBC_2.33)",
    )
    package.add_argument("--out", type=Path, default=ROOT / "build" / "distributions")
    package.set_defaults(func=dist_native)

    verify_package = sub.add_parser(
        "verify-native-package",
        help="execute a native archive and write a hash-bound verification receipt",
    )
    verify_package.add_argument("archive", type=Path)
    verify_package.set_defaults(func=verify_native_archive)

    flatpak_input = sub.add_parser(
        "flatpak-input",
        help="assemble the curated product input for an SDK-built Flatpak",
    )
    shared(flatpak_input, default_profile="release")
    flatpak_input.add_argument(
        "--out", type=Path, default=FLATPAK_INPUT
    )
    flatpak_input.set_defaults(func=dist_flatpak_input)

    flatpak_verify = sub.add_parser(
        "verify-flatpak",
        help="install and execute a Flatpak bundle and write hash-bound evidence",
    )
    flatpak_verify.add_argument("bundle", type=Path)
    flatpak_verify.add_argument("--input", type=Path, default=FLATPAK_INPUT)
    flatpak_verify.set_defaults(func=verify_flatpak)

    web_package = sub.add_parser(
        "dist-web", help="build a reproducible hosted-PWA payload archive"
    )
    shared(web_package, default_profile="release")
    web_package.add_argument("--out", type=Path, default=WEB_DISTRIBUTIONS)
    web_package.set_defaults(func=dist_web)

    w = sub.add_parser("serve-pwa", help="serve the PWA console catalog over HTTP")
    shared(w)
    w.add_argument("--host", default="0.0.0.0")
    w.add_argument("--port", type=int, default=8765)
    w.set_defaults(func=serve_pwa)

    return p


def main() -> None:
    args = parser().parse_args()
    if hasattr(args, "extra_cart_root"):
        raw_environment_roots = [
            item
            for item in os.environ.get("CALYX_EXTRA_CART_ROOTS", "").split(os.pathsep)
            if item
        ]
        if args.profile == "release" and (
            args.extra_cart_root or raw_environment_roots
        ):
            raise SystemExit("release profile does not accept extra cart roots")
        try:
            args.cart_roots = resolve_cart_roots(
                CARTS, args.extra_cart_root, os.environ
            )
        except ValueError as error:
            raise SystemExit(str(error)) from error
        private_cart_root = ROOT / "private" / "carts"
        if (
            args.profile == "sideb"
            and private_cart_root.is_dir()
            and private_cart_root.resolve() not in args.cart_roots
        ):
            raise SystemExit(
                "canonical Side B requires the private cart overlay; "
                "run `python3 private/dev.py sideb`"
            )
    if hasattr(args, "profile") and getattr(args, "native_out", None) is None:
        args.native_out = {
            "dev": NATIVE_OUT,
            "sideb": SIDE_B_NATIVE_OUT,
            "release": RELEASE_NATIVE_OUT,
        }[args.profile]
    if hasattr(args, "profile") and getattr(args, "web_out", None) is None:
        args.web_out = {
            "dev": WEB_OUT,
            "sideb": SIDE_B_WEB_OUT,
            "release": RELEASE_WEB_OUT,
        }[args.profile]
    args.func(args)


if __name__ == "__main__":
    main()
