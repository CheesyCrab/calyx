#!/usr/bin/env python3
"""Build the reproducible, self-contained Calyx cart starter ZIP."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

try:
    from tools.product_identity import PRODUCT_VERSION
except ModuleNotFoundError:  # Direct `python3 tools/starter_package.py` execution.
    from product_identity import PRODUCT_VERSION


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "starter"
SDK = ROOT / "sdk" / "assembly"
ARCHIVE_NAME = f"calyx-cart-starter-{PRODUCT_VERSION}.zip"
TOP = "calyx-cart-starter"
EXCLUDED = {"node_modules", "cart.wasm", "LICENSE.md"}


def source_entries() -> dict[str, bytes]:
    entries: dict[str, bytes] = {}
    for source in sorted(TEMPLATE.rglob("*")):
        relative = source.relative_to(TEMPLATE)
        if not source.is_file() or any(part in EXCLUDED for part in relative.parts):
            continue
        entries[f"{TOP}/{relative.as_posix()}"] = source.read_bytes()
    for source in sorted(SDK.rglob("*")):
        if source.is_file():
            relative = source.relative_to(SDK).as_posix()
            entries[f"{TOP}/sunny/{relative}"] = source.read_bytes()
    entries[f"{TOP}/LICENSES/MIT.txt"] = (ROOT / "LICENSES" / "MIT.txt").read_bytes()
    entries[f"{TOP}/NOTICES.txt"] = (
        "Calyx cart starter component notices\n\n"
        "- Original starter example and build helper: MIT\n"
        "- Sunny authoring SDK snapshot: MIT (selected from MIT OR Apache-2.0)\n"
        "- m6x11 font metrics by Daniel Linssen: free to use with attribution\n"
        "  Source and terms: https://managore.itch.io/m6x11\n"
        "- AssemblyScript is installed separately by npm and retains its own license.\n"
    ).encode("utf-8")
    return entries


def build_starter(out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    archive = out / ARCHIVE_NAME
    with zipfile.ZipFile(
        archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as zipped:
        for name, data in sorted(source_entries().items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            zipped.writestr(info, data)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(archive.suffix + ".sha256").write_text(
        f"{digest}  {archive.name}\n", encoding="utf-8"
    )
    return archive


def check_starter() -> None:
    npm_name = "npm.cmd" if os.name == "nt" else "npm"
    npm = shutil.which(npm_name)
    if npm is None:
        raise SystemExit(f"{npm_name} not found — install Node.js and npm")
    with tempfile.TemporaryDirectory(prefix="calyx starter check ") as temporary:
        temporary_root = Path(temporary)
        archive = build_starter(temporary_root)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(temporary_root / "unpacked")
        project = temporary_root / "unpacked" / TOP
        subprocess.run(
            [npm, "ci", "--no-audit", "--no-fund"], cwd=project, check=True
        )
        subprocess.run([npm, "run", "build"], cwd=project, check=True)
        subprocess.run(
            [
                "node",
                str(ROOT / "web" / "tools" / "check-local-cart.mjs"),
                str(project / "cart.wasm"),
            ],
            cwd=ROOT,
            check=True,
        )
        evidence_root = ROOT / "build" / "starter-check"
        evidence_root.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(project / "cart.wasm", evidence_root / "original-cart.wasm")
        # Exercise the promised edit/build loop, then retain that exact module
        # for the browser product journey which follows the commit gate.
        source = project / "cart.ts"
        customized = source.read_text(encoding="utf-8").replace(
            "MY CALYX CART", "ZIP JOURNEY"
        )
        if customized == source.read_text(encoding="utf-8"):
            raise RuntimeError("starter customization marker was not found")
        source.write_text(customized, encoding="utf-8")
        subprocess.run([npm, "run", "build"], cwd=project, check=True)
        evidence = evidence_root / "customized-cart.wasm"
        shutil.copyfile(project / "cart.wasm", evidence)
        subprocess.run(
            [
                "node",
                str(ROOT / "web" / "tools" / "check-local-cart.mjs"),
                str(evidence),
            ],
            cwd=ROOT,
            check=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "build" / "distributions",
        help="output directory",
    )
    parser.add_argument(
        "--check", action="store_true", help="build and validate the starter cart"
    )
    args = parser.parse_args()
    if args.check:
        check_starter()
    archive = build_starter(args.out)
    print(f"starter: {archive}")
    print(f"starter: {archive.with_suffix(archive.suffix + '.sha256')}")


if __name__ == "__main__":
    main()
