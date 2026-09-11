#!/usr/bin/env python3
"""Run named Calyx development-validation workflows without shell chaining."""

from __future__ import annotations

import argparse
import os
import platform
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Mapping, NamedTuple, Sequence

try:
    from tools.cart_roots import resolve_cart_roots
    from tools.product_identity import PRODUCT_VERSION
except ModuleNotFoundError:  # Direct `python3 tools/dev.py` execution.
    from cart_roots import resolve_cart_roots
    from product_identity import PRODUCT_VERSION


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable
NPM = "npm.cmd" if os.name == "nt" else "npm"
class Step(NamedTuple):
    label: str
    argv: tuple[str, ...]
    cwd: Path


class NativeHost(NamedTuple):
    rust_target: str
    artifact_label: str
    suffix: str


def step(label: str, *argv: str, cwd: Path = ROOT) -> Step:
    return Step(label, tuple(argv), cwd)


def metadata_step(root: Path = ROOT) -> Step:
    return step(
        "cart metadata",
        PYTHON,
        "tools/catalog.py",
        "cart-metadata",
        "--check",
        cwd=root,
    )


def native_host(system: str | None = None, machine: str | None = None) -> NativeHost:
    normalized_system = (system or platform.system()).casefold()
    normalized_machine = (machine or platform.machine()).casefold()
    if normalized_system == "linux" and normalized_machine in {"amd64", "x86_64"}:
        return NativeHost("x86_64-unknown-linux-gnu", "linux-x86_64", ".tar.gz")
    if normalized_system == "windows" and normalized_machine in {"amd64", "x86_64"}:
        return NativeHost("x86_64-pc-windows-msvc", "windows-x86_64", ".zip")
    if normalized_system == "darwin" and normalized_machine in {"arm64", "aarch64"}:
        return NativeHost("aarch64-apple-darwin", "macos-arm64", ".zip")
    raise ValueError(f"unsupported native release host: {system} {machine}")


def host_release_archive(
    root: Path = ROOT, host: NativeHost | None = None
) -> Path:
    if host is None:
        machine = platform.machine().casefold()
        architecture = "aarch64" if machine in {"arm64", "aarch64"} else "x86_64"
        if sys.platform == "darwin":
            selected = NativeHost("aarch64-apple-darwin", "macos-arm64", ".zip")
        elif os.name == "nt":
            selected = NativeHost(
                "x86_64-pc-windows-msvc", "windows-x86_64", ".zip"
            )
        else:
            selected = NativeHost(
                f"{architecture}-unknown-linux-gnu",
                f"linux-{architecture}",
                ".tar.gz",
            )
    else:
        selected = host
    return (
        root
        / "build"
        / "distributions"
        / f"calyx-{PRODUCT_VERSION}-{selected.artifact_label}{selected.suffix}"
    )


def resolve_cart(
    name: str,
    root: Path = ROOT,
    *,
    environ: Mapping[str, str] | None = None,
) -> Path:
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("cart must be a slug or carts-relative path")
    if relative.parts[0] == ".local":
        raise ValueError("local external carts are outside the first-party workflow")

    carts = root / "carts"
    roots = resolve_cart_roots(carts, [], os.environ if environ is None else environ)
    search_roots = [
        (cart_root, carts if index == 0 else cart_root)
        for index, cart_root in enumerate(roots)
    ]
    candidates = [
        (cart_root, search_root, candidate)
        for cart_root, search_root in search_roots
        for candidate in (
            [search_root / relative]
            if len(relative.parts) > 1
            else [
                search_root / name,
                search_root / "system" / name,
                search_root / "examples" / name,
            ]
        )
    ]
    matches = [
        (cart_root, search_root, path)
        for cart_root, search_root, path in candidates
        if (path / "cart.toml").is_file() and (path / "package.json").is_file()
    ]
    if not matches:
        raise ValueError(f"unknown runnable first-party cart {name!r}")
    if len(matches) > 1:
        rendered = ", ".join(
            f"{path.relative_to(search_root)} (owning root {cart_root})"
            for cart_root, search_root, path in matches
        )
        raise ValueError(f"ambiguous cart {name!r}: {rendered}")
    return matches[0][2]


def cart_steps(name: str, root: Path = ROOT) -> list[Step]:
    cart = resolve_cart(name, root)
    return [
        metadata_step(root),
        step(f"build {cart.name}", NPM, "run", "build", cwd=cart),
    ]


def sideb_steps(
    root: Path = ROOT,
    *,
    environ: Mapping[str, str] | None = None,
) -> list[Step]:
    selected_environment = os.environ if environ is None else environ
    private_cart_root = root / "private" / "carts"
    if private_cart_root.is_dir():
        roots = resolve_cart_roots(root / "carts", [], selected_environment)
        if private_cart_root.resolve() not in roots:
            raise ValueError(
                "canonical Side B requires the private cart overlay; "
                "run `python3 private/dev.py sideb`"
            )
    return [
        metadata_step(root),
        step(
            "starter build and local profile",
            PYTHON,
            "tools/starter_package.py",
            "--check",
            cwd=root,
        ),
        step(
            "assemble Side B web product",
            PYTHON,
            "tools/catalog.py",
            "dist-web",
            "--profile",
            "sideb",
            cwd=root,
        ),
        step(
            "Side B product smoke",
            "node",
            "product-smoke.mjs",
            "--profile",
            "sideb",
            cwd=root / "web",
        ),
        step(
            "Side B touch journeys",
            "node",
            "touch-smoke.mjs",
            "--profile",
            "sideb",
            cwd=root / "web",
        ),
    ]


def commit_steps(root: Path = ROOT) -> list[Step]:
    return [
        metadata_step(root),
        step("Rust format", "cargo", "fmt", "--all", "--check", cwd=root),
        step(
            "Sunny font drift",
            PYTHON,
            "sdk/tools/gen_font.py",
            "--check",
            cwd=root,
        ),
        step(
            "starter build and local profile",
            PYTHON,
            "tools/starter_package.py",
            "--check",
            cwd=root,
        ),
        step(
            "Python tooling tests",
            PYTHON,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tools",
            "-p",
            "test_*.py",
            cwd=root,
        ),
        step(
            "conformance harness tests",
            PYTHON,
            "conformance/test_check.py",
            cwd=root,
        ),
        step("Rust workspace tests", "cargo", "test", "--workspace", cwd=root),
        step(
            "native conformance",
            "cargo",
            "run",
            "-p",
            "calyx-cli",
            "--quiet",
            "--",
            "verify",
            "--suite",
            "conformance",
            cwd=root,
        ),
        step("web runtime tests", "node", "--test", cwd=root / "web"),
        step("web parity", "node", "conform.mjs", cwd=root / "web"),
    ]


def native_rehearsal_steps(
    root: Path = ROOT, host: NativeHost | None = None
) -> list[Step]:
    selected = host or native_host()
    return [
        metadata_step(root),
        step(
            "assemble release native product",
            PYTHON,
            "tools/catalog.py",
            "dist-native",
            "--profile",
            "release",
            "--target",
            selected.rust_target,
            cwd=root,
        ),
        step(
            "verify release native product",
            PYTHON,
            "tools/catalog.py",
            "verify-native-package",
            str(host_release_archive(root, selected).relative_to(root)),
            cwd=root,
        ),
    ]


def release_steps(root: Path = ROOT) -> list[Step]:
    return commit_steps(root) + [
        step(
            "SDL presenter feature tests",
            "cargo",
            "test",
            "-p",
            "calyx-cli",
            "--no-default-features",
            "--features",
            "sdl-bundled",
            cwd=root,
        ),
        step(
            "build soak catalog",
            PYTHON,
            "tools/catalog.py",
            "build",
            cwd=root,
        ),
        step(
            "release soak",
            "cargo",
            "run",
            "--release",
            "-p",
            "calyx-cli",
            "--quiet",
            "--",
            "soak",
            "--cycles",
            "5",
            "--out",
            "build/soak-report.json",
            cwd=root,
        ),
        step("browser runtime smoke", "node", "smoke.mjs", cwd=root / "web"),
        step(
            "assemble release web product",
            PYTHON,
            "tools/catalog.py",
            "dist-web",
            "--profile",
            "release",
            cwd=root,
        ),
        step(
            "release product smoke",
            "node",
            "product-smoke.mjs",
            "--profile",
            "release",
            cwd=root / "web",
        ),
        step(
            "release touch journeys",
            "node",
            "touch-smoke.mjs",
            "--profile",
            "release",
            cwd=root / "web",
        ),
        step(
            "assemble release native product",
            PYTHON,
            "tools/catalog.py",
            "dist-native",
            "--profile",
            "release",
            cwd=root,
        ),
        step(
            "verify release native product",
            PYTHON,
            "tools/catalog.py",
            "verify-native-package",
            str(host_release_archive(root).relative_to(root)),
            cwd=root,
        ),
    ]


def command_text(argv: Sequence[str]) -> str:
    if os.name == "nt":
        return subprocess.list2cmdline(argv)
    return shlex.join(argv)


def run_steps(steps: Sequence[Step], dry_run: bool = False) -> int:
    started = time.monotonic()
    total = len(steps)
    for index, item in enumerate(steps, start=1):
        try:
            relative = item.cwd.relative_to(ROOT) if item.cwd != ROOT else Path(".")
        except ValueError:
            relative = item.cwd
        print(f"\n[{index}/{total}] {item.label}")
        print(f"  cwd: {relative}")
        print(f"  $ {command_text(item.argv)}", flush=True)
        if dry_run:
            continue
        try:
            completed = subprocess.run(item.argv, cwd=item.cwd, check=False)
        except OSError as error:
            print(f"dev: could not start {item.argv[0]}: {error}", file=sys.stderr)
            return 127
        if completed.returncode != 0:
            print(
                f"dev: FAIL {item.label} (exit {completed.returncode})",
                file=sys.stderr,
            )
            return completed.returncode
    elapsed = time.monotonic() - started
    mode = "planned" if dry_run else "passed"
    print(f"\ndev: {mode} {total} step(s) in {elapsed:.1f}s")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "--dry-run",
        action="store_true",
        help="print the selected workflow without running commands",
    )
    sub = result.add_subparsers(dest="workflow", required=True)

    def accept_trailing_dry_run(workflow: argparse.ArgumentParser) -> None:
        workflow.add_argument(
            "--dry-run",
            action="store_true",
            default=argparse.SUPPRESS,
            help=argparse.SUPPRESS,
        )

    cart = sub.add_parser("cart", help="build one first-party cart")
    accept_trailing_dry_run(cart)
    cart.add_argument("name", help="cart slug or grouped path such as system/launcher")
    sideb = sub.add_parser(
        "sideb", help="assemble and validate Side B without deploying"
    )
    accept_trailing_dry_run(sideb)
    commit = sub.add_parser(
        "commit", help="run the normal local commit-readiness checks"
    )
    accept_trailing_dry_run(commit)
    native_release = sub.add_parser(
        "native-release",
        help="build and execute the current host's release package",
    )
    accept_trailing_dry_run(native_release)
    release = sub.add_parser(
        "release", help="run the full local release-candidate checks"
    )
    accept_trailing_dry_run(release)
    return result


def selected_steps(args: argparse.Namespace, root: Path = ROOT) -> list[Step]:
    if args.workflow == "cart":
        return cart_steps(args.name, root)
    if args.workflow == "sideb":
        return sideb_steps(root)
    if args.workflow == "commit":
        return commit_steps(root)
    if args.workflow == "native-release":
        return native_rehearsal_steps(root)
    if args.workflow == "release":
        return release_steps(root)
    raise AssertionError(f"unknown workflow {args.workflow}")


def main() -> None:
    args = parser().parse_args()
    try:
        steps = selected_steps(args)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    raise SystemExit(run_steps(steps, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
