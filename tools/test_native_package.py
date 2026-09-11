#!/usr/bin/env python3
"""Focused tests for native package targets and verification."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import shutil
import tempfile
import unittest
import warnings
import zipfile
from argparse import Namespace
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "native_package", Path(__file__).with_name("native_package.py")
)
assert SPEC and SPEC.loader
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class NativeTargetTests(unittest.TestCase):
    @staticmethod
    def _write_elf(path: Path, machine: int) -> None:
        header = bytearray(20)
        header[:7] = b"\x7fELF\x02\x01\x01"
        header[18:20] = machine.to_bytes(2, "little")
        path.write_bytes(header)

    def test_required_targets_have_pinned_shapes(self) -> None:
        self.assertEqual(
            native.target_spec("x86_64-pc-windows-msvc").label,
            "windows-x86_64",
        )
        self.assertEqual(
            native.target_spec("aarch64-apple-darwin").label,
            "macos-arm64",
        )
        with self.assertRaisesRegex(SystemExit, "unsupported native target"):
            native.target_spec("i686-pc-windows-msvc")

    def test_native_binary_path_honors_cargo_target_dir(self) -> None:
        root = Path("/repo")
        with mock.patch.dict(
            os.environ, {"CARGO_TARGET_DIR": "/tmp/calyx-cross-target"}
        ):
            self.assertEqual(
                native.native_binary_path(
                    root, "x86_64-pc-windows-msvc"
                ),
                Path(
                    "/tmp/calyx-cross-target/"
                    "x86_64-pc-windows-msvc/release/calyx.exe"
                ),
            )
        with mock.patch.dict(os.environ, {"CARGO_TARGET_DIR": "cross-target"}):
            self.assertEqual(
                native.native_binary_path(root, None),
                root / "cross-target" / "release" / "calyx",
            )

    def test_linux_verifier_rejects_wrong_architecture(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 62)
            with (
                mock.patch.object(
                    native.shutil, "which", return_value="/usr/bin/readelf"
                ),
                self.assertRaisesRegex(SystemExit, "architecture.*AArch64"),
            ):
                native.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-gnu",
                    "bundled",
                    None,
                )

    def test_linux_verifier_accepts_matching_gnu_contract(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 183)
            outputs = [
                Namespace(stdout="  NEEDED  Shared library: [libSDL2-2.0.so.0]\n"),
                Namespace(stdout="  Name: GLIBC_2.17\n  Name: GLIBC_2.33\n"),
            ]
            with (
                mock.patch.object(
                    native.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(native.subprocess, "run", side_effect=outputs),
            ):
                facts = native.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-gnu",
                    "system",
                    "GLIBC_2.33",
                )
            self.assertEqual(facts.sdl_link, "system")
            self.assertEqual(facts.glibc_required_max, "GLIBC_2.33")

    def test_linux_musl_rejects_a_glibc_ceiling(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 183)
            with self.assertRaisesRegex(SystemExit, "musl.*max-glibc"):
                native.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-musl",
                    "bundled",
                    "GLIBC_2.33",
                )


class WindowsBinaryTests(unittest.TestCase):
    @staticmethod
    def _write_pe(path: Path, machine: int) -> None:
        image = bytearray(0x88)
        image[:2] = b"MZ"
        image[0x3C:0x40] = (0x80).to_bytes(4, "little")
        image[0x80:0x84] = b"PE\0\0"
        image[0x84:0x86] = machine.to_bytes(2, "little")
        path.write_bytes(image)

    def test_windows_verifier_rejects_wrong_pe_machine(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx.exe"
            self._write_pe(binary, 0x014C)
            with self.assertRaisesRegex(SystemExit, "x86-64"):
                native.verify_native_binary(
                    binary, "x86_64-pc-windows-msvc", "bundled", None
                )

    def test_windows_bundled_verifier_rejects_sdl_dll_import(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx.exe"
            self._write_pe(binary, 0x8664)
            with (
                mock.patch.object(
                    native.shutil, "which", side_effect=lambda name: (
                        "/tool/dumpbin" if name == "dumpbin" else None
                    )
                ),
                mock.patch.object(
                    native.subprocess,
                    "run",
                    return_value=Namespace(stdout="    SDL2.dll\n"),
                ),
                self.assertRaisesRegex(SystemExit, "bundled SDL.*SDL2"),
            ):
                native.verify_native_binary(
                    binary, "x86_64-pc-windows-msvc", "bundled", None
                )

    def test_windows_verifier_fails_when_no_import_inspector_exists(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx.exe"
            self._write_pe(binary, 0x8664)
            with (
                mock.patch.object(native.shutil, "which", return_value=None),
                self.assertRaisesRegex(SystemExit, "dumpbin.*llvm-readobj"),
            ):
                native.verify_native_binary(
                    binary, "x86_64-pc-windows-msvc", "bundled", None
                )


class MacBinaryTests(unittest.TestCase):
    @staticmethod
    def _write_macho(path: Path, cpu_type: int) -> None:
        header = bytearray(32)
        header[:4] = bytes.fromhex("cffaedfe")
        header[4:8] = cpu_type.to_bytes(4, "little")
        path.write_bytes(header)

    def test_macos_verifier_requires_arm64(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_macho(binary, 0x01000007)
            with self.assertRaisesRegex(SystemExit, "arm64"):
                native.verify_native_binary(
                    binary, "aarch64-apple-darwin", "bundled", None
                )

    def test_macos_bundled_verifier_rejects_external_sdl(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_macho(binary, 0x0100000C)
            with (
                mock.patch.object(native.shutil, "which", return_value="/usr/bin/otool"),
                mock.patch.object(
                    native.subprocess,
                    "run",
                    return_value=Namespace(
                        stdout=(
                            f"{binary}:\n"
                            "  /Library/Frameworks/SDL2.framework/SDL2\n"
                        )
                    ),
                ),
                self.assertRaisesRegex(SystemExit, "bundled SDL.*SDL2"),
            ):
                native.verify_native_binary(
                    binary, "aarch64-apple-darwin", "bundled", None
                )

    def test_macos_verifier_fails_without_otool(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_macho(binary, 0x0100000C)
            with (
                mock.patch.object(native.shutil, "which", return_value=None),
                self.assertRaisesRegex(SystemExit, "otool"),
            ):
                native.verify_native_binary(
                    binary, "aarch64-apple-darwin", "bundled", None
                )


class LayoutTests(unittest.TestCase):
    def _inputs(self, root: Path) -> tuple[Path, Path]:
        binary = root / "built-calyx"
        binary.write_bytes(b"binary")
        binary.chmod(0o755)
        catalog = root / "built-catalog"
        catalog.mkdir()
        (catalog / "cart.wasm").write_bytes(b"wasm")
        return binary, catalog

    def test_windows_layout_keeps_payload_adjacent_to_exe(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            binary, catalog = self._inputs(root)
            layout = native.stage_layout(
                root / "stage",
                native.target_spec("x86_64-pc-windows-msvc"),
                "Calyx Side B",
                binary,
                catalog,
            )
            self.assertEqual(layout.archive_root.name, "Calyx Side B")
            self.assertEqual(
                layout.executable.relative_to(layout.archive_root).as_posix(),
                "calyx.exe",
            )
            self.assertEqual(
                layout.catalog.relative_to(layout.archive_root).as_posix(),
                "catalog",
            )

    def test_macos_layout_uses_contents_resources(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            binary, catalog = self._inputs(root)
            layout = native.stage_layout(
                root / "stage",
                native.target_spec("aarch64-apple-darwin"),
                "Calyx Side B",
                binary,
                catalog,
            )
            self.assertEqual(layout.archive_root.name, "Calyx Side B.app")
            self.assertEqual(
                layout.executable.relative_to(layout.archive_root).as_posix(),
                "Contents/MacOS/calyx",
            )
            self.assertEqual(
                layout.catalog.relative_to(layout.archive_root).as_posix(),
                "Contents/Resources/catalog",
            )
            plist = (layout.archive_root / "Contents/Info.plist").read_text()
            self.assertIn("games.cheesycrab.calyx.sideb", plist)
            self.assertIn("Calyx-Side-B", plist)


class ArchiveTests(unittest.TestCase):
    def test_zip_is_mtime_independent_and_preserves_executable_mode(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package = root / "Calyx Side B.app"
            executable = package / "Contents" / "MacOS" / "calyx"
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"binary")
            executable.chmod(0o755)
            resource = package / "Contents" / "Resources" / "catalog" / "cart.wasm"
            resource.parent.mkdir(parents=True)
            resource.write_bytes(b"wasm")
            resource.chmod(0o644)
            first = root / "first.zip"
            second = root / "second.zip"

            native.deterministic_zip(package, first)
            os.utime(executable, (9999, 9999))
            native.deterministic_zip(package, second)

            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(
                    archive.getinfo(
                        "Calyx Side B.app/Contents/MacOS/calyx"
                    ).date_time,
                    (1980, 1, 1, 0, 0, 0),
                )
            extracted = native.extract_native_archive(
                first,
                root / "extracted",
                native.target_spec("aarch64-apple-darwin"),
            )
            self.assertEqual(extracted.name, "Calyx Side B.app")
            self.assertEqual(
                (extracted / "Contents/MacOS/calyx").stat().st_mode & 0o777,
                0o755,
            )

    def test_zip_extraction_rejects_parent_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "bad.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("../escape", b"bad")
            with self.assertRaisesRegex(SystemExit, "unsafe archive path"):
                native.extract_native_archive(
                    archive,
                    root / "out",
                    native.target_spec("aarch64-apple-darwin"),
                )

    def test_zip_extraction_rejects_duplicate_members(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "bad.zip"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(archive, "w") as zipped:
                    zipped.writestr("Calyx/calyx.exe", b"first")
                    zipped.writestr("Calyx/calyx.exe", b"second")
            with self.assertRaisesRegex(SystemExit, "duplicate archive path"):
                native.extract_native_archive(
                    archive,
                    root / "out",
                    native.target_spec("x86_64-pc-windows-msvc"),
                )


class IconTests(unittest.TestCase):
    def test_native_icon_sources_are_checked_out_with_stable_line_endings(self) -> None:
        root = Path(__file__).resolve().parents[1]
        attributes = (root / ".gitattributes").read_text(encoding="utf-8")
        self.assertIn("assets/brand/*.svg text eol=lf", attributes.splitlines())

    def test_native_icons_match_canonical_sources_and_manifest(self) -> None:
        native.verify_native_icons(Path(__file__).resolve().parents[1])

    def test_icon_source_drift_is_rejected(self) -> None:
        source_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            shutil.copytree(
                source_root / "assets" / "brand",
                root / "assets" / "brand",
            )
            source = root / "assets" / "brand" / "calyx-mark.svg"
            source.write_text(source.read_text() + "\n<!-- drift -->\n")
            with self.assertRaisesRegex(SystemExit, "native icon source drift"):
                native.verify_native_icons(root)

    def test_manifest_names_both_product_profiles(self) -> None:
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads(
            (root / "assets/brand/native/icon-source.json").read_text()
        )
        self.assertEqual(
            sorted(manifest["products"]),
            ["release", "sideb"],
        )


class PackageFinalizationTests(unittest.TestCase):
    def _inputs(self, root: Path, out: Path) -> object:
        binary = root / "calyx"
        binary.write_bytes(b"binary")
        binary.chmod(0o755)
        catalog = root / "catalog"
        catalog.mkdir()
        (catalog / "cart.wasm").write_bytes(b"wasm")
        (catalog / ".calyx-catalog.json").write_text(
            json.dumps({"schema": 1, "profile": "sideb", "carts": []}) + "\n"
        )
        return native.NativePackageInputs(
            root=Path(__file__).resolve().parents[1],
            profile="sideb",
            target="aarch64-apple-darwin",
            sdl_link="bundled",
            max_glibc=None,
            binary=binary,
            catalog=catalog,
            out=out,
            build_info={
                "source_revision": "abc123",
                "source_local": True,
                "source_fingerprint": "local123",
                "built_at": "2026-08-20T00:00:00+00:00",
            },
            product_version="1.0.0",
            abi_version="v1.4",
        )

    @staticmethod
    def _license_writer(payload: Path, catalog: Path, target: str, sdl: str) -> None:
        del catalog, target, sdl
        (payload / "LICENSES.txt").write_text("licenses\n")

    def test_macos_descriptor_inventories_bundle_relative_paths(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            inputs = self._inputs(root, root / "out")
            with mock.patch.object(
                native,
                "verify_native_binary",
                return_value=native.BinaryFacts("bundled", None),
            ):
                result = native.assemble_native_package(
                    inputs,
                    self._license_writer,
                )
            self.assertEqual(result.descriptor["target"], "macos-arm64")
            self.assertEqual(
                result.descriptor["glibc"],
                {"ceiling": None, "required_max": None},
            )
            self.assertTrue(
                any(
                    item["path"] == "Contents/MacOS/calyx"
                    for item in result.descriptor["files"]
                )
            )
            self.assertEqual(result.package.name, "Calyx Side B.app")
            self.assertTrue(result.archive.name.endswith(".zip"))

    def test_release_descriptor_uses_formal_product_and_short_package_name(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            inputs = self._inputs(root, root / "out")
            inputs = inputs._replace(
                profile="release",
                product_version="1.0.0-rc.1",
                build_info=inputs.build_info
                | {"source_local": False, "source_fingerprint": None},
            )
            (inputs.catalog / ".calyx-catalog.json").write_text(
                json.dumps({"schema": 1, "profile": "release", "carts": []})
                + "\n"
            )
            with (
                mock.patch.object(native, "verify_native_icons"),
                mock.patch.object(
                    native,
                    "verify_native_binary",
                    return_value=native.BinaryFacts("bundled", None),
                ),
            ):
                result = native.assemble_native_package(
                    inputs,
                    self._license_writer,
                )
            self.assertEqual(result.descriptor["product"], "Cheesy Crab Calyx")
            self.assertEqual(result.package.name, "Calyx.app")
            self.assertEqual(result.archive.name, "calyx-1.0.0-rc.1-macos-arm64.zip")

    def test_assembly_statically_verifies_without_executing_package(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            inputs = self._inputs(root, root / "out")
            with (
                mock.patch.object(
                    native,
                    "verify_native_binary",
                    return_value=native.BinaryFacts("bundled", None),
                ),
                mock.patch.object(native.subprocess, "run") as run,
            ):
                result = native.assemble_native_package(inputs, self._license_writer)
            self.assertTrue(result.archive.is_file())
            run.assert_not_called()

    def test_archive_checksum_sidecar_is_lf_on_windows(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            inputs = self._inputs(root, root / "out")
            original_write_text = Path.write_text

            def windows_write_text(
                path: Path, data: str, *args: object, **kwargs: object
            ) -> int:
                if path.name.endswith(".sha256") or path.name == "SHA256SUMS":
                    newline = kwargs.get("newline")
                    encoded = data if newline == "\n" else data.replace("\n", "\r\n")
                    return path.write_bytes(encoded.encode(str(kwargs.get("encoding", "utf-8"))))
                return original_write_text(path, data, *args, **kwargs)

            with (
                mock.patch.object(
                    native,
                    "verify_native_binary",
                    return_value=native.BinaryFacts("bundled", None),
                ),
                mock.patch.object(Path, "write_text", windows_write_text),
            ):
                result = native.assemble_native_package(inputs, self._license_writer)
            checksum = result.checksum.read_bytes()
            self.assertTrue(checksum.endswith(b"\n"))
            self.assertNotIn(b"\r", checksum)
            internal_checksum = next(result.package.rglob("SHA256SUMS")).read_bytes()
            self.assertTrue(internal_checksum.endswith(b"\n"))
            self.assertNotIn(b"\r", internal_checksum)

    def test_static_archive_rejects_an_unlisted_file(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            inputs = self._inputs(root, root / "out")
            with mock.patch.object(
                native,
                "verify_native_binary",
                return_value=native.BinaryFacts("bundled", None),
            ):
                result = native.assemble_native_package(
                    inputs,
                    self._license_writer,
                )
                (result.package / "Contents/Resources/unlisted.txt").write_text("bad")
                tampered = root / "tampered.zip"
                native.deterministic_zip(result.package, tampered)
                with self.assertRaisesRegex(SystemExit, "SHA256SUMS inventory"):
                    native.verify_native_archive_static(tampered, root / "verify")


class ExecutionVerificationTests(unittest.TestCase):
    @staticmethod
    def _write_checksum(archive: Path) -> None:
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        Path(f"{archive}.sha256").write_text(
            f"{digest}  {archive.name}\n", encoding="ascii"
        )

    @staticmethod
    def _verified(
        root: Path,
        final_role: str = "launcher",
        mode: str = "console",
        frames_run: int = 100,
    ) -> object:
        package = root / "package"
        catalog = package / "catalog"
        catalog.mkdir(parents=True)
        executable = package / "calyx"
        status = json.dumps(
            {
                "mode": mode,
                "frames_run": frames_run,
                "initial_role": "boot",
                "final_role": final_role,
                "swaps": 1,
            },
            separators=(",", ":"),
        )
        executable.write_text(
            "#!/bin/sh\n"
            'if [ "${1-}" = --version ]; then\n'
            '  echo "Calyx Side B 1.0.0 · Calyx ABI v1.4"\n'
            "  exit 0\n"
            "fi\n"
            "out=\n"
            "while [ $# -gt 0 ]; do\n"
            '  if [ "$1" = --out ]; then shift; out=$1; fi\n'
            "  shift\n"
            "done\n"
            'mkdir -p "$out"\n'
            f"printf '%s\\n' '{status}' > \"$out/status.json\"\n",
            encoding="utf-8",
        )
        executable.chmod(0o755)
        descriptor = {
            "schema": 1,
            "payload_id": "payload123",
            "product": "Calyx Side B",
            "profile": "sideb",
            "version": "1.0.0",
            "abi": "v1.4",
            "target": "linux-x86_64",
            "rust_target": "x86_64-unknown-linux-gnu",
            "source_revision": "abc123",
            "sdl_link": "bundled",
            "glibc": {"ceiling": None, "required_max": "GLIBC_2.31"},
        }
        return native.VerifiedNativeArchive(
            "unused",
            0,
            native.NativeLayout(package, package, executable, catalog, None),
            descriptor,
            native.target_spec("x86_64-unknown-linux-gnu"),
            native.BinaryFacts("bundled", "GLIBC_2.31"),
        )

    def test_success_writes_hash_bound_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "calyx-sideb-linux-x86_64.tar.gz"
            archive.write_bytes(b"archive bytes")
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            self._write_checksum(archive)
            verified = self._verified(root)
            with (
                mock.patch.object(
                    native, "verify_native_archive_static", return_value=verified
                ),
                mock.patch.object(
                    native,
                    "_require_compatible_executor",
                    return_value=("linux", "x86_64"),
                ),
            ):
                receipt_path = native.verify_native_package(archive, "verifier123")
            receipt = json.loads(receipt_path.read_text())
            self.assertEqual(receipt["archive"]["sha256"], digest)
            self.assertEqual(receipt["contract"], "calyx-native-package-v1")
            self.assertEqual(receipt["package"]["payload_id"], "payload123")
            self.assertEqual(receipt["recipe"], {"frames": 100, "input": "empty"})
            self.assertIn("boot-to-launcher-v1", receipt["passed_checks"])

    def test_executor_identity_uses_package_arch_names(self) -> None:
        cases = [
            ("Darwin", "arm64", ("macos", "arm64")),
            ("Darwin", "aarch64", ("macos", "arm64")),
            ("Linux", "arm64", ("linux", "aarch64")),
            ("Linux", "aarch64", ("linux", "aarch64")),
            ("Windows", "AMD64", ("windows", "x86_64")),
        ]
        for system, machine, expected in cases:
            with (
                self.subTest(system=system, machine=machine),
                mock.patch.object(native.platform, "system", return_value=system),
                mock.patch.object(native.platform, "machine", return_value=machine),
            ):
                self.assertEqual(native._executor_identity(), expected)

    def test_missing_checksum_writes_no_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "calyx.tar.gz"
            archive.write_bytes(b"archive")
            verified = self._verified(root)
            with (
                mock.patch.object(
                    native, "verify_native_archive_static", return_value=verified
                ),
                self.assertRaisesRegex(SystemExit, "checksum.*missing"),
            ):
                native.verify_native_package(archive, "verifier123")
            self.assertFalse(Path(f"{archive}.verification.json").exists())

    def test_incompatible_host_writes_no_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "calyx.tar.gz"
            archive.write_bytes(b"archive")
            self._write_checksum(archive)
            verified = self._verified(root)
            with (
                mock.patch.object(
                    native, "verify_native_archive_static", return_value=verified
                ),
                mock.patch.object(native.platform, "system", return_value="Darwin"),
                self.assertRaisesRegex(SystemExit, "compatible.*linux-x86_64"),
            ):
                native.verify_native_package(archive, "verifier123")
            self.assertFalse(Path(f"{archive}.verification.json").exists())

    def test_wrong_final_role_writes_no_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "calyx.tar.gz"
            archive.write_bytes(b"archive")
            self._write_checksum(archive)
            verified = self._verified(root, final_role="settings")
            with (
                mock.patch.object(
                    native, "verify_native_archive_static", return_value=verified
                ),
                mock.patch.object(
                    native,
                    "_require_compatible_executor",
                    return_value=("linux", "x86_64"),
                ),
                self.assertRaisesRegex(SystemExit, "boot-to-launcher"),
            ):
                native.verify_native_package(archive, "verifier123")
            self.assertFalse(Path(f"{archive}.verification.json").exists())

    def test_wrong_frame_count_writes_no_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "calyx.tar.gz"
            archive.write_bytes(b"archive")
            self._write_checksum(archive)
            verified = self._verified(root, frames_run=99)
            with (
                mock.patch.object(
                    native, "verify_native_archive_static", return_value=verified
                ),
                mock.patch.object(
                    native,
                    "_require_compatible_executor",
                    return_value=("linux", "x86_64"),
                ),
                self.assertRaisesRegex(SystemExit, "boot-to-launcher"),
            ):
                native.verify_native_package(archive, "verifier123")
            self.assertFalse(Path(f"{archive}.verification.json").exists())

    def test_wrong_console_mode_writes_no_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "calyx.tar.gz"
            archive.write_bytes(b"archive")
            self._write_checksum(archive)
            verified = self._verified(root, mode="window")
            with (
                mock.patch.object(
                    native, "verify_native_archive_static", return_value=verified
                ),
                mock.patch.object(
                    native,
                    "_require_compatible_executor",
                    return_value=("linux", "x86_64"),
                ),
                self.assertRaisesRegex(SystemExit, "boot-to-launcher"),
            ):
                native.verify_native_package(archive, "verifier123")
            self.assertFalse(Path(f"{archive}.verification.json").exists())

if __name__ == "__main__":
    unittest.main()
