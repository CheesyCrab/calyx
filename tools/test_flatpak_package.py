#!/usr/bin/env python3
"""Focused tests for Flatpak product staging and verification evidence."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "flatpak_package", Path(__file__).with_name("flatpak_package.py")
)
assert SPEC and SPEC.loader
flatpak = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(flatpak)


class FlatpakInputTests(unittest.TestCase):
    def test_product_identity_is_stable_and_public_clean(self) -> None:
        self.assertEqual(flatpak.APP_ID, "org.cheesycrab.Calyx")
        self.assertEqual(flatpak.RUNTIME, "org.freedesktop.Platform")
        self.assertEqual(flatpak.RUNTIME_VERSION, "25.08")

    def test_stage_input_keeps_catalog_adjacent_and_integration_names_aligned(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "repo"
            catalog = root / "release-catalog"
            out = root / "input"
            (catalog / "launcher").mkdir(parents=True)
            (catalog / "launcher" / "cart.wasm").write_bytes(b"wasm")
            (catalog / ".calyx-catalog.json").write_text(
                json.dumps({"profile": "release", "carts": [{"name": "Launcher"}]}),
                encoding="utf-8",
            )
            (root / "assets" / "brand").mkdir(parents=True)
            (root / "assets" / "brand" / "calyx-mark.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg"/>\n', encoding="utf-8"
            )
            (root / "gamecontrollerdb.txt").write_text("mapping\n", encoding="utf-8")

            def licenses(product: Path, _catalog: Path) -> None:
                (product / "LICENSE.md").write_text("license\n", encoding="utf-8")
                (product / "NOTICES.txt").write_text("notices\n", encoding="utf-8")
                (product / "SOURCE.txt").write_text("source\n", encoding="utf-8")

            descriptor = flatpak.stage_flatpak_input(
                root=root,
                catalog=catalog,
                out=out,
                build_info={
                    "source_revision": "a" * 40,
                    "source_local": False,
                    "source_fingerprint": None,
                    "built_at": "2026-08-22T00:00:00+00:00",
                },
                product_version="1.0.0",
                abi_version="v1.4",
                license_writer=licenses,
            )

            self.assertEqual(descriptor["app_id"], flatpak.APP_ID)
            self.assertEqual(descriptor["product"], "Cheesy Crab Calyx")
            self.assertEqual(descriptor["publisher"], "Cheesy Crab")
            self.assertEqual(descriptor["profile"], "release")
            self.assertEqual(descriptor["runtime"], "org.freedesktop.Platform//25.08")
            self.assertEqual(descriptor["arch"], "x86_64")
            self.assertEqual(descriptor["source_revision"], "a" * 40)
            self.assertTrue((out / "product" / "catalog" / "launcher" / "cart.wasm").is_file())
            self.assertTrue((out / "product" / "package.json").is_file())
            self.assertTrue((out / "product" / "gamecontrollerdb.txt").is_file())
            self.assertTrue((out / "integration" / f"{flatpak.APP_ID}.desktop").is_file())
            self.assertTrue((out / "integration" / f"{flatpak.APP_ID}.metainfo.xml").is_file())
            self.assertTrue((out / "integration" / f"{flatpak.APP_ID}.svg").is_file())
            desktop = (out / "integration" / f"{flatpak.APP_ID}.desktop").read_text()
            self.assertIn(f"Exec={flatpak.APP_ID}", desktop)
            self.assertIn(f"Icon={flatpak.APP_ID}", desktop)
            metadata = (out / "integration" / f"{flatpak.APP_ID}.metainfo.xml").read_text()
            self.assertIn(f"<id>{flatpak.APP_ID}</id>", metadata)
            self.assertIn('<release version="1.0.0"', metadata)
            self.assertNotIn('type="homepage"', metadata)

    def test_stage_rejects_local_or_non_release_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            catalog = root / "catalog"
            catalog.mkdir()
            (catalog / ".calyx-catalog.json").write_text(
                json.dumps({"profile": "sideb", "carts": []}), encoding="utf-8"
            )
            with self.assertRaisesRegex(SystemExit, "release catalog"):
                flatpak.stage_flatpak_input(
                    root=root,
                    catalog=catalog,
                    out=root / "out",
                    build_info={"source_local": False},
                    product_version="1.0.0",
                    abi_version="v1.4",
                    license_writer=lambda *_: None,
                )

    def test_validation_rejects_caller_supplied_forbidden_identity(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            out = Path(raw)
            product = out / "product"
            integration = out / "integration"
            (product / "catalog").mkdir(parents=True)
            integration.mkdir()
            (product / "package.json").write_text(
                json.dumps(
                    {
                        "app_id": flatpak.APP_ID,
                        "product": "Cheesy Crab Calyx",
                        "publisher": "Cheesy Crab",
                    }
                ),
                encoding="utf-8",
            )
            (product / "catalog" / ".calyx-catalog.json").write_text("{}")
            (product / "NOTICES.txt").write_text("Forbidden Example Corp\n")
            (integration / f"{flatpak.APP_ID}.desktop").write_text(
                f"Exec={flatpak.APP_ID}\nIcon={flatpak.APP_ID}\n"
            )
            (integration / f"{flatpak.APP_ID}.metainfo.xml").write_text(
                f"<id>{flatpak.APP_ID}</id>"
            )
            (integration / f"{flatpak.APP_ID}.svg").write_text("<svg/>")
            with self.assertRaisesRegex(SystemExit, "forbidden identity"):
                flatpak.validate_flatpak_input(
                    out, forbidden_tokens=(b"Forbidden Example Corp",)
                )

    def test_validation_rejects_absolute_home_paths_and_secret_assignments(self) -> None:
        for payload, expected in (
            ("build root: /" + "Users/example/work/calyx\n", "absolute home path"),
            ("build root: /" + "Users/example\n", "absolute home path"),
            ("build root: C:" + "\\Users\\example\\work\\calyx\n", "absolute home path"),
            ("build root: C:" + "\\Users\\example\n", "absolute home path"),
            ("api_key=not-a-real-secret\n", "secret assignment"),
            ('PASSWORD="not-a-real-secret"\n', "secret assignment"),
            ("OPENAI_API_KEY=not-a-real-secret\n", "secret assignment"),
            ("AWS_SECRET_ACCESS_KEY='not-a-real-secret'\n", "secret assignment"),
        ):
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as raw:
                out = Path(raw)
                product = out / "product"
                integration = out / "integration"
                (product / "catalog").mkdir(parents=True)
                integration.mkdir()
                descriptor = {
                    "app_id": flatpak.APP_ID,
                    "product": "Cheesy Crab Calyx",
                    "publisher": "Cheesy Crab",
                }
                (product / "package.json").write_text(
                    json.dumps(descriptor), encoding="utf-8"
                )
                (product / "catalog" / ".calyx-catalog.json").write_text("{}")
                (product / "NOTICES.txt").write_text(payload)
                (integration / f"{flatpak.APP_ID}.desktop").write_text(
                    f"Exec={flatpak.APP_ID}\nIcon={flatpak.APP_ID}\n"
                )
                (integration / f"{flatpak.APP_ID}.metainfo.xml").write_text(
                    f"<id>{flatpak.APP_ID}</id>"
                )
                (integration / f"{flatpak.APP_ID}.svg").write_text("<svg/>")
                with self.assertRaisesRegex(SystemExit, expected):
                    flatpak.validate_flatpak_input(out)


class FlatpakReceiptTests(unittest.TestCase):
    def test_runtime_provenance_searches_the_installation_used_by_flatpak(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="runtime-commit\n", stderr=""
        )
        with mock.patch.object(flatpak, "_run", return_value=completed) as run:
            commit = flatpak.installed_runtime_commit(
                "org.freedesktop.Platform/x86_64/25.08", {"FLATPAK_USER_DIR": "/tmp/user"}
            )
        self.assertEqual(commit, "runtime-commit")
        command = run.call_args.args[0]
        self.assertNotIn("--user", command)
        self.assertEqual(run.call_args.kwargs["env"]["FLATPAK_USER_DIR"], "/tmp/user")

    def test_installed_contract_requires_identity_runtime_command_and_permissions(self) -> None:
        metadata = """[Application]
name=org.cheesycrab.Calyx
runtime=org.freedesktop.Platform/x86_64/25.08
command=org.cheesycrab.Calyx

[Context]
shared=ipc;
sockets=wayland;fallback-x11;pulseaudio;
devices=dri;input;
devices-if=all=!has-input-device;
"""
        flatpak.validate_installed_contract(
            metadata=metadata,
            installed_ref="app/org.cheesycrab.Calyx/x86_64/stable",
        )
        with self.assertRaisesRegex(SystemExit, "pulseaudio"):
            flatpak.validate_installed_contract(
                metadata=metadata.replace("pulseaudio;", ""),
                installed_ref="app/org.cheesycrab.Calyx/x86_64/stable",
            )
        with self.assertRaisesRegex(SystemExit, "installed ref"):
            flatpak.validate_installed_contract(
                metadata=metadata,
                installed_ref="app/org.cheesycrab.Calyx/aarch64/stable",
            )

    def test_checksum_and_receipt_are_bound_to_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            bundle = root / "calyx.flatpak"
            bundle.write_bytes(b"bundle bytes")
            receipt = flatpak.write_flatpak_evidence(
                bundle=bundle,
                descriptor={
                    "app_id": flatpak.APP_ID,
                    "version": "1.0.0",
                    "abi": "v1.4",
                    "source_revision": "b" * 40,
                    "catalog_payload_id": "c" * 64,
                },
                installed={
                    "app_commit": "d" * 64,
                    "runtime_commit": "e" * 64,
                    "runtime": "org.freedesktop.Platform/x86_64/25.08",
                },
                checks=["version", "headless-100-frame-launcher"],
            )
            digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
            checksum = Path(f"{bundle}.sha256")
            self.assertEqual(checksum.read_bytes(), f"{digest}  calyx.flatpak\n".encode("ascii"))
            data = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(data["bundle"]["sha256"], digest)
            self.assertEqual(data["bundle"]["bytes"], len(b"bundle bytes"))
            self.assertEqual(data["app_id"], flatpak.APP_ID)
            self.assertEqual(data["checks"], ["version", "headless-100-frame-launcher"])
            self.assertEqual(receipt.name, "calyx.flatpak.verification.json")


class FlatpakManifestTests(unittest.TestCase):
    ROOT = Path(__file__).resolve().parents[1]

    def test_manifest_uses_offline_sdk_build_and_minimal_game_permissions(self) -> None:
        manifest = (
            self.ROOT / "packaging" / "flatpak" / f"{flatpak.APP_ID}.yml"
        ).read_text(encoding="utf-8")
        for expected in (
            f"id: {flatpak.APP_ID}",
            "runtime: org.freedesktop.Platform",
            "runtime-version: '25.08'",
            "org.freedesktop.Sdk.Extension.rust-stable",
            "CARGO_NET_OFFLINE: 'true'",
            "cargo --offline build --release",
            "--features sdl-bundled",
            "path: ../../assets/fonts",
            "dest: assets/fonts",
            "sh flatpak/validate-metainfo.sh",
            "--socket=wayland",
            "--socket=fallback-x11",
            "--socket=pulseaudio",
            "--device-if=all:!has-input-device",
            "--device=input",
        ):
            self.assertIn(expected, manifest)
        self.assertNotIn("--share=network", manifest)
        self.assertNotIn("--filesystem=home", manifest)
        self.assertNotIn("dist-native", manifest)

    def test_private_rehearsal_allows_only_the_missing_public_homepage_warning(self) -> None:
        validator = (
            self.ROOT / "packaging" / "flatpak" / "validate-metainfo.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("url-homepage-missing", validator)
        self.assertIn("/^[EW]:/", validator)

        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            fake = fake_bin / "appstreamcli"
            metainfo = root / "app.metainfo.xml"
            metainfo.write_text("<component/>", encoding="utf-8")
            env = os.environ | {"PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}"}

            fake.write_text(
                "#!/bin/sh\n"
                "echo 'W: org.cheesycrab.Calyx:~: url-homepage-missing'\n"
                "exit 3\n",
                encoding="utf-8",
            )
            fake.chmod(0o755)
            accepted = subprocess.run(
                ["sh", str(self.ROOT / "packaging/flatpak/validate-metainfo.sh"), str(metainfo)],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)

            fake.write_text(
                "#!/bin/sh\n"
                "echo 'W: org.cheesycrab.Calyx:~: release-is-missing'\n"
                "exit 3\n",
                encoding="utf-8",
            )
            rejected = subprocess.run(
                ["sh", str(self.ROOT / "packaging/flatpak/validate-metainfo.sh"), str(metainfo)],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(rejected.returncode, 0)

    def test_manifest_supplies_new_cmake_policy_to_bundled_sdl(self) -> None:
        packaging = self.ROOT / "packaging" / "flatpak"
        manifest = (packaging / f"{flatpak.APP_ID}.yml").read_text(encoding="utf-8")
        self.assertIn("CMAKE_POLICY_VERSION_MINIMUM: '3.5'", manifest)
        self.assertIn("cflags: -std=gnu99", manifest)
        self.assertIn(
            "SDL2_TOOLCHAIN: /run/build/calyx/flatpak/sdl2-flatpak-toolchain.cmake",
            manifest,
        )
        toolchain = (packaging / "sdl2-flatpak-toolchain.cmake").read_text(
            encoding="utf-8"
        )
        self.assertIn("set(SDL_PIPEWIRE OFF CACHE BOOL", toolchain)

    def test_manifest_remaps_flatpak_build_paths_from_rust_and_sdl(self) -> None:
        packaging = self.ROOT / "packaging" / "flatpak"
        manifest = (packaging / f"{flatpak.APP_ID}.yml").read_text(encoding="utf-8")
        self.assertIn(
            "RUSTFLAGS: --remap-path-prefix=/run/build/calyx=/calyx-source",
            manifest,
        )
        self.assertIn(
            "cflags: -std=gnu99 -ffile-prefix-map=/run/build/calyx=/calyx-source",
            manifest,
        )

    def test_public_release_stages_notices_from_the_web_package_directory(self) -> None:
        workflow = (
            self.ROOT / ".github" / "workflows" / "release.yml"
        ).read_text(encoding="utf-8")
        command = next(
            line.strip()
            for line in workflow.splitlines()
            if line.strip().startswith('python3 -c "')
            and "Calyx-NOTICES.txt" in line
        )
        code = command.removeprefix('python3 -c "').removesuffix('"')

        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            distributions = root / "build" / "distributions"
            package = distributions / "calyx-web-rc-0123456789abcdef"
            package.mkdir(parents=True)
            (package / "NOTICES.txt").write_bytes(b"web notices\n")
            (distributions / f"{package.name}.tar.gz").write_bytes(b"archive")
            (distributions / f"{package.name}.tar.gz.sha256").write_text(
                "digest  archive\n", encoding="ascii"
            )

            result = subprocess.run(
                [sys.executable, "-c", code],
                cwd=root,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(
                (distributions / "Calyx-NOTICES.txt").read_bytes(),
                b"web notices\n",
            )

    def test_generated_cargo_sources_cover_every_locked_registry_package(self) -> None:
        lock = tomllib.loads((self.ROOT / "Cargo.lock").read_text(encoding="utf-8"))
        sources = json.loads(
            (
                self.ROOT / "packaging" / "flatpak" / "cargo-sources.json"
            ).read_text(encoding="utf-8")
        )
        archives = {
            (entry["url"].rsplit("/", 2)[-2], entry["sha256"])
            for entry in sources
            if entry.get("type") == "archive"
            and entry.get("url", "").startswith("https://static.crates.io/crates/")
        }
        locked = {
            (package["name"], package["checksum"])
            for package in lock["package"]
            if str(package.get("source", "")).startswith("registry+")
        }
        self.assertEqual(archives, locked)


if __name__ == "__main__":
    unittest.main()
