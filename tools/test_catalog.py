#!/usr/bin/env python3
"""Focused tests for the catalog/distribution harness."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import threading
import time
import unittest
from argparse import Namespace
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "catalog", Path(__file__).with_name("catalog.py")
)
assert SPEC and SPEC.loader
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


class ParallelBuildTests(unittest.TestCase):
    def commands(self) -> list:
        root = Path("/tmp")
        return [
            catalog.BuildCommand(label, ["build", label], root)
            for label in ("alpha", "beta", "gamma")
        ]

    def test_default_is_cpu_bounded_and_cli_or_env_can_override(self) -> None:
        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch.object(catalog.os, "cpu_count", return_value=128),
        ):
            self.assertEqual(catalog.resolve_build_jobs(None), 4)
        with mock.patch.dict(os.environ, {"CALYX_BUILD_JOBS": "2"}, clear=True):
            self.assertEqual(catalog.resolve_build_jobs(None), 2)
            self.assertEqual(catalog.resolve_build_jobs(1), 1)
        with mock.patch.dict(os.environ, {"CALYX_BUILD_JOBS": "0"}, clear=True):
            with self.assertRaisesRegex(SystemExit, "at least 1"):
                catalog.resolve_build_jobs(None)

    def test_jobs_one_is_serial_and_multiple_jobs_overlap(self) -> None:
        active = 0
        peak = 0
        lock = threading.Lock()

        def fake(command):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.02)
            with lock:
                active -= 1
            return catalog.BuildResult(command, 0, "", "")

        with mock.patch.object(catalog, "run_captured_build", side_effect=fake):
            with redirect_stdout(io.StringIO()):
                catalog.run_parallel_builds(self.commands(), 1)
            self.assertEqual(peak, 1)
            peak = 0
            with redirect_stdout(io.StringIO()):
                catalog.run_parallel_builds(self.commands(), 3)
            self.assertGreater(peak, 1)

    def test_output_and_multiple_failures_are_reported_in_manifest_order(self) -> None:
        delays = {"alpha": 0.03, "beta": 0.02, "gamma": 0.01}

        def fake(command):
            time.sleep(delays[command.label])
            code = 7 if command.label != "beta" else 0
            return catalog.BuildResult(
                command,
                code,
                f"{command.label}-out\n",
                f"{command.label}-err\n",
            )

        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(catalog, "run_captured_build", side_effect=fake):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with self.assertRaisesRegex(SystemExit, "alpha, gamma"):
                    catalog.run_parallel_builds(self.commands(), 3)

        rendered = stdout.getvalue()
        self.assertLess(rendered.index("alpha-out"), rendered.index("beta-out"))
        self.assertLess(rendered.index("beta-out"), rendered.index("gamma-out"))
        errors = stderr.getvalue()
        self.assertIn("FAIL alpha (exit 7): build alpha", errors)
        self.assertIn("FAIL gamma (exit 7): build gamma", errors)

    def test_incremental_selection_only_submits_stale_carts(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dirs = [Path(raw) / name for name in ("alpha", "beta", "gamma")]
            for cart_dir in dirs:
                (cart_dir / "node_modules").mkdir(parents=True)
            submitted = []
            with (
                mock.patch.object(catalog, "runnable_cart_dirs", return_value=dirs),
                mock.patch.object(
                    catalog,
                    "cart_needs_build",
                    side_effect=lambda path: path.name != "beta",
                ),
                mock.patch.object(catalog, "npm_bin", return_value="npm"),
                mock.patch.object(
                    catalog,
                    "run_parallel_builds",
                    side_effect=lambda commands, _jobs: submitted.extend(commands),
                ),
            ):
                with redirect_stdout(io.StringIO()):
                    catalog.build_first_party_carts(jobs=2)
            self.assertEqual(
                [command.label for command in submitted], ["alpha", "gamma"]
            )

    def test_check_built_names_stale_carts_and_never_rebuilds(self) -> None:
        dirs = [Path("/tmp/alpha"), Path("/tmp/beta")]
        args = Namespace(profile="sideb")
        with (
            mock.patch.object(catalog, "runnable_cart_dirs", return_value=dirs),
            mock.patch.object(
                catalog,
                "cart_needs_build",
                side_effect=lambda path: path.name == "beta",
            ),
        ):
            with self.assertRaisesRegex(
                SystemExit,
                r"stale or missing cart\.wasm for beta",
            ):
                catalog.check_built(args)

    def test_failed_compilation_prevents_catalog_assembly(self) -> None:
        args = Namespace(
            skip_build=False,
            rebuild=False,
            jobs=2,
            profile="dev",
            native_out=Path("native"),
            web_out=Path("web"),
        )
        with (
            mock.patch.object(
                catalog, "build_first_party_carts", side_effect=SystemExit("failed")
            ),
            mock.patch.object(catalog, "assemble_native") as assemble,
        ):
            with self.assertRaisesRegex(SystemExit, "failed"):
                catalog.build_catalog(args)
        assemble.assert_not_called()


class WebPayloadTests(unittest.TestCase):
    def test_side_b_shell_has_independent_red_identity(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            payload = Path(raw) / "sideb"
            catalog.assemble_product_web_shell(payload, "sideb")
            manifest = json.loads(
                (payload / "manifest.webmanifest").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["name"], "Calyx Side B")
            self.assertEqual(manifest["id"], "./calyx-sideb")
            self.assertIn('data-channel="sideb"', (payload / "index.html").read_text())
            self.assertEqual(
                (payload / "icon.svg").read_bytes(),
                (
                    catalog.ROOT / "assets" / "brand" / "calyx-sideb-mark.svg"
                ).read_bytes(),
            )

    def test_payload_identity_is_reproducible_and_content_addressed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            web_source = root / "source"
            payload = root / "payload"
            (payload / "carts").mkdir(parents=True)
            web_source.mkdir()
            (web_source / "sw-template.js").write_text(
                'const F="__ASSET_FINGERPRINT__"; const S=__DESCRIPTOR_SCHEMA__;\n'
            )
            (payload / "index.html").write_text("hello")
            (payload / "carts" / "carts.json").write_text(
                json.dumps({"carts": [{"name": "One", "version": "0.1"}]})
            )
            old_web = catalog.WEB_ROOT
            catalog.WEB_ROOT = web_source
            build_info = {
                "source_revision": "a" * 40,
                "source_local": False,
                "source_fingerprint": None,
                "built_at": "2026-07-15T12:00:00+00:00",
            }
            try:
                first = catalog.finalize_product_web(payload, "stable", build_info)
                first_tree = {
                    path.relative_to(payload).as_posix(): path.read_bytes()
                    for path in payload.rglob("*")
                    if path.is_file()
                }
                second = catalog.finalize_product_web(payload, "stable", build_info)
                second_tree = {
                    path.relative_to(payload).as_posix(): path.read_bytes()
                    for path in payload.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(first, second)
                self.assertEqual(first_tree, second_tree)
                (payload / "index.html").write_text("changed")
                changed = catalog.finalize_product_web(payload, "stable", build_info)
                self.assertNotEqual(first["payload_id"], changed["payload_id"])
            finally:
                catalog.WEB_ROOT = old_web

    def test_inventory_rejects_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "file").write_text("ok")
            (root / "link").symlink_to(root / "file")
            with self.assertRaisesRegex(SystemExit, "symlinks"):
                catalog.inventory(root)


class CatalogProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.old_carts = catalog.CARTS
        catalog.CARTS = self.root / "carts"
        catalog.CARTS.mkdir()

    def tearDown(self) -> None:
        catalog.CARTS = self.old_carts
        self.tmp.cleanup()

    def cart(
        self,
        slug: str,
        *,
        name: str,
        category: str = "Games",
        release: bool | None = None,
        icon: bool = False,
        role: str | None = None,
        system: bool = False,
        public_source: bool | None = None,
        display: str | None = None,
        input_profile: str | None = None,
        presentation: int | None = None,
    ) -> Path:
        root = catalog.CARTS / slug
        root.mkdir(parents=True)
        lines = [
            "[cart]",
            f'name = "{name}"',
            'author = "Cheesy Crab"',
            'license = "GPL-3.0-or-later"',
            'version = "1.0.0"',
            'abi = "v1"',
            f'category = "{category}"',
        ]
        if release is not None:
            lines.append(f"release = {str(release).lower()}")
        if role:
            lines.append(f'role = "{role}"')
        if system:
            lines.append("system = true")
        if display:
            lines.append(f'display = "{display}"')
        if input_profile:
            lines.append(f'input = "{input_profile}"')
        if presentation is not None:
            lines.append(f"presentation = {presentation}")
        if public_source is None:
            public_source = release or system
        lines.append(f"public_source = {str(public_source).lower()}")
        (root / "cart.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (root / "package.json").write_text("{}\n", encoding="utf-8")
        (root / "cart.wasm").write_bytes(b"wasm")
        if icon:
            (root / "icon.bin").write_bytes(bytes([3]) * 4096)
        return root

    def test_dev_includes_all_but_release_is_opt_in(self) -> None:
        self.cart("launcher", name="launcher", system=True)
        self.cart("system/boot", name="Calyx Boot", role="boot", system=True)
        self.cart("ready", name="Ready", category="Demos", release=True, icon=True)
        self.cart("wip", name="WIP")

        self.assertEqual(
            [p.name for p in catalog.runnable_cart_dirs("dev")],
            ["boot", "launcher", "ready", "wip"],
        )
        self.assertEqual(
            [p.name for p in catalog.runnable_cart_dirs("sideb")],
            ["boot", "launcher", "ready", "wip"],
        )
        self.assertEqual(
            [p.name for p in catalog.runnable_cart_dirs("release")],
            ["boot", "launcher", "ready"],
        )

    def test_hd_role_and_cart_are_sideb_only(self) -> None:
        self.cart("launcher", name="launcher", system=True)
        self.cart("system/boot", name="Calyx Boot", role="boot", system=True)
        self.cart(
            "system/hd-boot",
            name="Calyx HD Boot",
            role="hd-boot",
            system=True,
            release=False,
            display="hd",
        )
        self.cart(
            "hd-lab",
            name="HD Lab",
            release=False,
            display="hd",
            input_profile="extended",
        )

        self.assertEqual(
            [p.name for p in catalog.runnable_cart_dirs("sideb")],
            ["boot", "hd-boot", "hd-lab", "launcher"],
        )
        self.assertEqual(
            [p.name for p in catalog.runnable_cart_dirs("release")],
            ["boot", "launcher"],
        )

    def test_display_and_input_profiles_are_validated(self) -> None:
        self.cart("bad-display", name="Bad Display", display="4k")
        with self.assertRaisesRegex(SystemExit, "unknown display profile"):
            catalog.runnable_cart_dirs("dev")

        (catalog.CARTS / "bad-display" / "cart.toml").unlink()
        self.cart("bad-input", name="Bad Input", input_profile="analog")
        with self.assertRaisesRegex(SystemExit, "unknown input profile"):
            catalog.runnable_cart_dirs("dev")

        (catalog.CARTS / "bad-input" / "cart.toml").unlink()
        self.cart("bad-presentation", name="Bad Presentation", presentation=24)
        with self.assertRaisesRegex(SystemExit, "presentation must be 30 or 60"):
            catalog.runnable_cart_dirs("dev")

    def test_sideb_discovers_runnable_carts_from_an_explicit_extra_root(self) -> None:
        self.cart("public", name="Public")
        extra = self.root / "extra"
        private = extra / "private"
        private.mkdir(parents=True)
        (private / "cart.toml").write_text(
            '[cart]\nname = "Private"\npublic_source = false\n',
            encoding="utf-8",
        )
        (private / "package.json").write_text("{}\n", encoding="utf-8")

        try:
            carts = catalog.runnable_cart_dirs("sideb", [catalog.CARTS, extra])
        except TypeError as error:
            self.fail(f"catalog does not accept resolved cart roots: {error}")

        self.assertEqual([path.name for path in carts], ["private", "public"])

    def test_release_refuses_an_extra_cart_root(self) -> None:
        extra = self.root / "extra"
        extra.mkdir()

        try:
            catalog.runnable_cart_dirs("release", [catalog.CARTS, extra])
        except TypeError as error:
            self.fail(f"catalog does not accept resolved cart roots: {error}")
        except SystemExit as error:
            self.assertIn(
                "release profile does not accept extra cart roots", str(error)
            )
        else:
            self.fail("release profile accepted an extra cart root")

    def test_sideb_marks_only_carts_absent_from_release(self) -> None:
        self.cart("launcher", name="launcher", role="launcher", system=True)
        release = self.cart("ready", name="Ready", release=True, icon=True)
        sideb_only = self.cart("wip", name="WIP")
        original = bytes([3]) * 4096

        dev = self.root / "dev"
        sideb = self.root / "sideb"
        catalog.assemble_native(dev, profile="dev")
        catalog.assemble_native(sideb, profile="sideb")

        self.assertEqual((dev / "ready" / "icon.bin").read_bytes(), original)
        missing = catalog.missing_cart_icon()
        self.assertEqual((dev / "wip" / "icon.bin").read_bytes(), missing)
        self.assertEqual((sideb / "ready" / "icon.bin").read_bytes(), original)
        expected = catalog.sideb_only_icon(missing)
        self.assertEqual((sideb / "wip" / "icon.bin").read_bytes(), expected)
        self.assertEqual(sum(a != b for a, b in zip(missing, expected)), 11)
        self.assertEqual((release / "icon.bin").read_bytes(), original)
        self.assertFalse((sideb_only / "icon.bin").exists())

    def test_every_ordinary_assembled_cart_has_a_valid_icon(self) -> None:
        self.cart("launcher", name="launcher", role="launcher", system=True)
        self.cart("missing", name="Missing")
        broken = self.cart("broken", name="Broken", icon=True)
        (broken / "icon.bin").write_bytes(b"short")

        with self.assertRaisesRegex(SystemExit, "expected 4096 bytes, got 5"):
            catalog.assemble_native(self.root / "broken-out", profile="dev")

        (broken / "icon.bin").write_bytes(bytes([3]) * 4096)
        out = self.root / "valid-out"
        catalog.assemble_native(out, profile="dev")
        ordinary = [
            path
            for path in out.iterdir()
            if path.is_dir() and path.name != "launcher"
        ]
        self.assertTrue(ordinary)
        self.assertTrue(
            all((path / "icon.bin").stat().st_size == 4096 for path in ordinary)
        )

    def test_role_groups_are_discovered_and_duplicate_slugs_fail(self) -> None:
        grouped = self.root / "carts" / "system"
        grouped.mkdir()
        launcher = self.cart("system/launcher", name="launcher", system=True)
        self.assertEqual(catalog.runnable_cart_dirs(), [launcher])
        native = self.root / "native"
        catalog.assemble_native(native)
        self.assertTrue((native / "launcher" / "cart.wasm").exists())
        self.assertFalse((native / "system").exists())

        duplicate = self.root / "carts" / "launcher"
        duplicate.mkdir()
        (duplicate / "cart.toml").write_text(
            '[cart]\nname = "other launcher"\n', encoding="utf-8"
        )
        (duplicate / "package.json").write_text("{}\n", encoding="utf-8")
        with self.assertRaisesRegex(SystemExit, "duplicate cart slug 'launcher'"):
            catalog.runnable_cart_dirs()

    def test_release_cart_requires_complete_metadata_and_icon(self) -> None:
        self.cart("launcher", name="launcher", system=True)
        self.cart("broken", name="Broken", release=True)
        with self.assertRaisesRegex(SystemExit, "requires a 64x64 icon"):
            catalog.runnable_cart_dirs("release")

    def test_release_and_system_carts_cannot_be_private_source(self) -> None:
        release = self.cart(
            "release",
            name="Release",
            release=True,
            icon=True,
            public_source=False,
        )
        with self.assertRaisesRegex(
            SystemExit, "release = true requires public_source = true"
        ):
            catalog.runnable_cart_dirs("dev")

        (release / "cart.toml").unlink()
        self.cart(
            "system/boot",
            name="Calyx Boot",
            role="boot",
            system=True,
            public_source=False,
        )
        with self.assertRaisesRegex(
            SystemExit, "system = true requires public_source = true"
        ):
            catalog.runnable_cart_dirs("dev")

    def test_first_party_publication_is_explicit_and_local_carts_are_opt_in(
        self,
    ) -> None:
        first_party = self.cart("first-party", name="First Party")
        manifest = first_party / "cart.toml"
        manifest.write_text(
            manifest.read_text(encoding="utf-8").replace(
                "public_source = false\n", ""
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(SystemExit, "public_source must be true or false"):
            catalog.runnable_cart_dirs("dev")

        manifest.unlink()
        local = self.cart(".local/external", name="External")
        local_manifest = local / "cart.toml"
        local_manifest.write_text(
            local_manifest.read_text(encoding="utf-8").replace(
                "public_source = false\n", ""
            ),
            encoding="utf-8",
        )
        self.assertEqual(catalog.runnable_cart_dirs("dev"), [])
        self.assertEqual(
            catalog.runnable_cart_dirs(
                "dev", [catalog.CARTS, catalog.CARTS / ".local"]
            ),
            [local],
        )
        self.assertEqual(catalog.runnable_cart_dirs("release"), [])

    def test_generated_metadata_keeps_release_and_source_roles_distinct(self) -> None:
        self.cart("private", name="Private", public_source=False)
        self.cart("examples/example", name="Example", public_source=True)
        self.cart(
            "release", name="Release", release=True, icon=True, public_source=True
        )
        rendered = catalog.cart_metadata_markdown()
        self.assertIn(
            "| [Private](private/) | Product | Games | 1.0.0 | No | No |",
            rendered,
        )
        self.assertIn(
            "| [Example](examples/example/) | Example | Games | 1.0.0 | No | Yes |",
            rendered,
        )
        self.assertIn(
            "| [Release](release/) | Product | Games | 1.0.0 | Yes | Yes |",
            rendered,
        )

    def test_category_reaches_native_and_web_release_manifests(self) -> None:
        self.cart("launcher", name="launcher", system=True)
        self.cart("system/boot", name="Calyx Boot", role="boot", system=True)
        self.cart(
            "ready",
            name="Ready",
            category="Challenges",
            release=True,
            icon=True,
        )
        native = self.root / "native"
        web = self.root / "web" / "payload"
        catalog.assemble_native(native, profile="release")
        catalog.assemble_web(native, web)
        manifest = json.loads((web / "carts.json").read_text(encoding="utf-8"))
        self.assertEqual([c["name"] for c in manifest["carts"]], ["Ready"])
        self.assertEqual(manifest["carts"][0]["category"], "Challenges")
        self.assertEqual(manifest["carts"][0]["license"], "GPL-3.0-or-later")
        self.assertEqual(manifest["launcher"], "./payload/launcher/cart.wasm")
        self.assertEqual(manifest["boot"], "./payload/boot/cart.wasm")
        self.assertEqual(manifest["carts"][0]["wasm"], "./payload/ready/cart.wasm")

    def test_hd_profiles_reach_native_and_web_manifests(self) -> None:
        self.cart("launcher", name="launcher", system=True)
        self.cart(
            "hd",
            name="HD",
            display="hd",
            input_profile="extended",
            presentation=30,
        )
        native = self.root / "native"
        web = self.root / "web" / "payload"
        catalog.assemble_native(native, profile="sideb")
        catalog.assemble_web(native, web)
        manifest = json.loads((web / "carts.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["carts"][0]["display"], "hd")
        self.assertEqual(manifest["carts"][0]["input"], "extended")
        self.assertEqual(manifest["carts"][0]["presentation"], 30)

    def test_boot_role_is_unique_privileged_and_hidden_from_cart_list(self) -> None:
        self.cart("launcher", name="launcher", system=True)
        self.cart("system/boot", name="Calyx Boot", role="boot", system=True)
        self.cart("game", name="Game")
        native = self.root / "native"
        web = self.root / "web" / "payload"
        catalog.assemble_native(native)
        catalog.assemble_web(native, web)
        manifest = json.loads((web / "carts.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["boot"], "./payload/boot/cart.wasm")
        self.assertEqual([cart["name"] for cart in manifest["carts"]], ["Game"])

        (self.root / "carts" / "system" / "boot" / "cart.toml").write_text(
            '[cart]\nname = "Calyx Boot"\nrole = "boot"\npublic_source = true\n',
            encoding="utf-8",
        )
        with self.assertRaisesRegex(SystemExit, "requires system = true"):
            catalog.runnable_cart_dirs()

    def test_smoke_feed_navigates_category_then_row_to_settings(self) -> None:
        carts = [
            {"name": "Alpha", "category": "Games"},
            {"name": "Demo", "category": "Demos"},
            {"name": "About", "category": "Settings"},
            {"name": "Settings", "category": "Settings"},
        ]
        events = catalog.smoke_feed_events(carts)
        pressed = [(event["f"], event["hold"]) for event in events if event["hold"]]
        self.assertEqual(
            pressed,
            [
                (4, ["RIGHT"]),
                (7, ["RIGHT"]),
                (10, ["DOWN"]),
                (13, ["A"]),
                (20, ["START"]),
            ],
        )

    def test_smoke_feed_launches_first_cart_when_settings_is_absent(self) -> None:
        carts = [
            {"name": "Alpha", "category": "Games"},
            {"name": "Demo", "category": "Demos"},
        ]

        events = catalog.smoke_feed_events(carts)

        pressed = [(event["f"], event["hold"]) for event in events if event["hold"]]
        self.assertEqual(pressed, [(4, ["A"])])


class CatalogMetadataDocumentTests(unittest.TestCase):
    def test_checked_in_inventory_matches_cart_manifests(self) -> None:
        with redirect_stdout(io.StringIO()):
            catalog.cart_metadata(Namespace(check=True, write=False))


class CatalogCartRootCliTests(unittest.TestCase):
    def test_private_checkout_refuses_sideb_without_private_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "carts"
            private = root / "private" / "carts"
            public.mkdir()
            private.mkdir(parents=True)
            argv = ["catalog.py", "build", "--profile", "sideb", "--skip-build"]
            with (
                mock.patch.object(catalog, "ROOT", root),
                mock.patch.object(catalog, "CARTS", public),
                mock.patch.object(catalog.sys, "argv", argv),
                mock.patch.dict(catalog.os.environ, {}, clear=True),
                mock.patch.object(catalog, "ensure_catalog") as command,
            ):
                with self.assertRaisesRegex(SystemExit, r"private/dev\.py sideb"):
                    catalog.main()
            command.assert_not_called()

    def test_repeatable_extra_cart_root_reaches_sideb_catalog_commands(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "carts"
            first = root / "first"
            second = root / "second"
            public.mkdir()
            first.mkdir()
            second.mkdir()
            argv = [
                "catalog.py",
                "build",
                "--profile",
                "sideb",
                "--extra-cart-root",
                str(first),
                "--extra-cart-root",
                str(second),
                "--skip-build",
            ]
            with (
                mock.patch.object(catalog, "ROOT", root),
                mock.patch.object(catalog, "CARTS", public),
                mock.patch.object(catalog.sys, "argv", argv),
                mock.patch.dict(catalog.os.environ, {}, clear=True),
                mock.patch.object(catalog, "ensure_catalog") as command,
                redirect_stderr(io.StringIO()),
            ):
                try:
                    catalog.main()
                except SystemExit as error:
                    self.fail(f"catalog rejected generic extra roots: {error}")

            args = command.call_args.args[0]
            self.assertEqual(
                args.cart_roots,
                [public.resolve(), first.resolve(), second.resolve()],
            )

    def test_environment_extra_root_reaches_sideb_catalog_commands(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "carts"
            extra = root / "extra"
            public.mkdir()
            extra.mkdir()
            argv = ["catalog.py", "build", "--profile", "sideb", "--skip-build"]
            with (
                mock.patch.object(catalog, "ROOT", root),
                mock.patch.object(catalog, "CARTS", public),
                mock.patch.object(catalog.sys, "argv", argv),
                mock.patch.dict(
                    catalog.os.environ,
                    {"CALYX_EXTRA_CART_ROOTS": str(extra)},
                    clear=True,
                ),
                mock.patch.object(catalog, "ensure_catalog") as command,
            ):
                catalog.main()

            args = command.call_args.args[0]
            self.assertTrue(
                hasattr(args, "cart_roots"),
                "catalog command did not resolve environment cart roots",
            )
            self.assertEqual(
                args.cart_roots, [public.resolve(), extra.resolve()]
            )

    def test_release_cli_refuses_an_extra_cart_root_before_running(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            extra = Path(raw) / "extra"
            extra.mkdir()
            argv = [
                "catalog.py",
                "build",
                "--profile",
                "release",
                "--extra-cart-root",
                str(extra),
                "--skip-build",
            ]
            with (
                mock.patch.object(catalog.sys, "argv", argv),
                mock.patch.dict(catalog.os.environ, {}, clear=True),
                mock.patch.object(catalog, "ensure_catalog") as command,
                redirect_stderr(io.StringIO()),
            ):
                try:
                    catalog.main()
                except SystemExit as error:
                    self.assertIn(
                        "release profile does not accept extra cart roots", str(error)
                    )
                else:
                    self.fail("release command accepted an extra cart root")
            command.assert_not_called()


class DistributionTests(unittest.TestCase):
    @staticmethod
    def _write_elf(path: Path, machine: int) -> None:
        header = bytearray(20)
        header[:7] = b"\x7fELF\x02\x01\x01"
        header[18:20] = machine.to_bytes(2, "little")
        path.write_bytes(header)

    def test_native_binary_verification_requires_an_elf_inspector(self) -> None:
        with (
            mock.patch.object(catalog.shutil, "which", return_value=None),
            self.assertRaisesRegex(SystemExit, "readelf"),
        ):
            catalog.verify_native_binary(
                Path("/tmp/calyx"),
                "x86_64-unknown-linux-gnu",
                "bundled",
                None,
            )

    def test_native_binary_verification_reports_inspector_failure_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 62)
            failure = catalog.subprocess.CalledProcessError(
                1,
                ["/usr/bin/readelf", "-d", str(binary)],
                stderr="not an ELF file",
            )
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(catalog.subprocess, "run", side_effect=failure),
                self.assertRaisesRegex(SystemExit, "readelf.*not an ELF file"),
            ):
                catalog.verify_native_binary(
                    binary,
                    "x86_64-unknown-linux-gnu",
                    "bundled",
                    None,
                )

    def test_native_binary_verification_rejects_wrong_architecture(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 62)
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                self.assertRaisesRegex(SystemExit, "architecture.*AArch64"),
            ):
                catalog.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-gnu",
                    "bundled",
                    None,
                )

    def test_native_binary_verification_requires_declared_system_sdl(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 183)
            completed = Namespace(
                stdout="Dynamic section contains:\n  NEEDED  Shared library: [libc.so.6]\n"
            )
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(
                    catalog.subprocess, "run", return_value=completed
                ),
                self.assertRaisesRegex(SystemExit, "system SDL.*libSDL2-2.0.so.0"),
            ):
                catalog.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-gnu",
                    "system",
                    None,
                )

    def test_native_binary_verification_rejects_dynamic_sdl_in_bundled_mode(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 62)
            completed = Namespace(
                stdout=(
                    "Dynamic section contains:\n"
                    "  NEEDED  Shared library: [libSDL2-2.0.so.0]\n"
                )
            )
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(
                    catalog.subprocess, "run", return_value=completed
                ),
                self.assertRaisesRegex(SystemExit, "bundled SDL.*dynamic dependency"),
            ):
                catalog.verify_native_binary(
                    binary,
                    "x86_64-unknown-linux-gnu",
                    "bundled",
                    None,
                )

    def test_native_binary_verification_enforces_glibc_ceiling(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 62)
            outputs = [
                Namespace(stdout="  NEEDED  Shared library: [libc.so.6]\n"),
                Namespace(
                    stdout=(
                        "Version needs section:\n"
                        "  Name: GLIBC_2.17\n"
                        "  Name: GLIBC_2.34\n"
                    )
                ),
            ]
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(catalog.subprocess, "run", side_effect=outputs),
                self.assertRaisesRegex(
                    SystemExit, "requires GLIBC_2.34.*ceiling GLIBC_2.33"
                ),
            ):
                catalog.verify_native_binary(
                    binary,
                    "x86_64-unknown-linux-gnu",
                    "bundled",
                    "GLIBC_2.33",
                )

    def test_native_binary_verification_requires_glibc_evidence_for_gnu(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 62)
            outputs = [
                Namespace(stdout="  NEEDED  Shared library: [libc.so.6]\n"),
                Namespace(stdout="No version information found in this file.\n"),
            ]
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(catalog.subprocess, "run", side_effect=outputs),
                self.assertRaisesRegex(SystemExit, "no GLIBC version requirements"),
            ):
                catalog.verify_native_binary(
                    binary,
                    "x86_64-unknown-linux-gnu",
                    "bundled",
                    "GLIBC_2.33",
                )

    def test_native_binary_verification_rejects_glibc_ceiling_for_musl(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 183)
            with self.assertRaisesRegex(SystemExit, "musl.*max-glibc"):
                catalog.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-musl",
                    "bundled",
                    "GLIBC_2.33",
                )

    def test_native_binary_verification_accepts_matching_gnu_contract(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "calyx"
            self._write_elf(binary, 183)
            outputs = [
                Namespace(
                    stdout="  NEEDED  Shared library: [libSDL2-2.0.so.0]\n"
                ),
                Namespace(stdout="  Name: GLIBC_2.17\n  Name: GLIBC_2.33\n"),
            ]
            with (
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                mock.patch.object(catalog.subprocess, "run", side_effect=outputs),
            ):
                catalog.verify_native_binary(
                    binary,
                    "aarch64-unknown-linux-gnu",
                    "system",
                    "GLIBC_2.33",
                )

    def test_native_distribution_verifies_binary_before_creating_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            binary = root / "calyx"
            native_out = root / "catalog"
            out = root / "distributions"
            self._write_elf(binary, 62)
            native_out.mkdir()
            (native_out / ".calyx-catalog.json").write_text(
                json.dumps({"schema": 1, "profile": "sideb", "carts": []})
                + "\n",
                encoding="utf-8",
            )
            args = Namespace(
                profile="sideb",
                target="aarch64-unknown-linux-gnu",
                sdl_link="bundled",
                max_glibc=None,
                out=out,
                native_out=native_out,
                skip_build=True,
                rebuild=False,
                jobs=1,
            )
            with (
                mock.patch.object(
                    catalog, "source_build_info", return_value={"source_local": True}
                ),
                mock.patch.object(catalog, "ensure_native_catalog", return_value=[]),
                mock.patch.object(catalog, "sh") as build,
                mock.patch.object(catalog, "native_binary_path", return_value=binary),
                mock.patch.object(
                    catalog.shutil, "which", return_value="/usr/bin/readelf"
                ),
                self.assertRaisesRegex(SystemExit, "architecture.*AArch64"),
            ):
                catalog.dist_native(args)
            self.assertFalse(out.exists())
            self.assertEqual(
                build.call_args.kwargs["env"]["CALYX_PACKAGE_PROFILE"],
                "sideb",
            )

    def test_native_distribution_accepts_a_glibc_ceiling(self) -> None:
        with redirect_stderr(io.StringIO()):
            try:
                args = catalog.parser().parse_args(
                    ["dist-native", "--max-glibc", "GLIBC_2.33"]
                )
            except SystemExit as exc:
                self.fail(f"dist-native rejected --max-glibc: {exc}")
        self.assertEqual(args.max_glibc, "GLIBC_2.33")

    def test_native_package_build_remaps_source_and_toolchain_paths(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            root = base / "source"
            cargo_home = base / "cargo-home"
            env = catalog.package_build_environment(
                root,
                "aarch64-apple-darwin",
                {
                    "CARGO_HOME": str(cargo_home),
                    "RUSTFLAGS": "-C target-cpu=generic",
                    "CFLAGS": "-O2",
                    "CXXFLAGS": "-O2",
                },
            )

            rust_flags = env["CARGO_ENCODED_RUSTFLAGS"].split("\x1f")
            self.assertIn("-C", rust_flags)
            self.assertIn("target-cpu=generic", rust_flags)
            self.assertIn(
                f"--remap-path-prefix={root.resolve()}=/calyx-source",
                rust_flags,
            )
            self.assertIn(
                f"--remap-path-prefix={cargo_home.resolve()}=/cargo-home",
                rust_flags,
            )
            self.assertNotIn("RUSTFLAGS", env)
            self.assertIn(
                f"-ffile-prefix-map={cargo_home.resolve()}=/cargo-home",
                env["CFLAGS"],
            )
            self.assertIn(
                f"-ffile-prefix-map={root.resolve()}=/calyx-source",
                env["CXXFLAGS"],
            )
            self.assertEqual(
                env["CARGO_TARGET_DIR"],
                str(root.resolve() / "build" / "package-target"),
            )

    def test_msvc_package_build_uses_pathmap_for_native_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "source"
            cargo_home = Path(raw) / "cargo-home"
            env = catalog.package_build_environment(
                root,
                "x86_64-pc-windows-msvc",
                {"CARGO_HOME": str(cargo_home)},
            )

            self.assertIn(
                f"/pathmap:{root.resolve()}=/calyx-source",
                env["CFLAGS"],
            )
            self.assertIn(
                f"/pathmap:{cargo_home.resolve()}=/cargo-home",
                env["CXXFLAGS"],
            )

    def test_native_distribution_rejects_a_malformed_glibc_ceiling_early(self) -> None:
        with (
            redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit),
        ):
            catalog.parser().parse_args(["dist-native", "--max-glibc", "2.33"])

    def test_native_package_verification_parser_accepts_an_archive(self) -> None:
        args = catalog.parser().parse_args(
            ["verify-native-package", "build/distributions/calyx.tar.gz"]
        )
        self.assertEqual(args.archive, Path("build/distributions/calyx.tar.gz"))
        self.assertIs(args.func, catalog.verify_native_archive)

    def test_native_dependency_inventory_is_package_and_license_specific(self) -> None:
        output = (
            "calyx-cli v0.1.0 (/src/cli)\tLGPL-3.0-or-later\n"
            "calyx-helper v2.0.0\tMIT\n"
            "serde_json v1.0.150\tMIT OR Apache-2.0\n"
            "memchr v2.8.2\tUnlicense OR MIT (*)\n"
        )
        with mock.patch.object(
            catalog.subprocess,
            "run",
            return_value=Namespace(stdout=output),
        ) as run:
            rows = catalog.native_dependency_rows("x86_64-unknown-linux-gnu")
        self.assertEqual(
            rows,
            [
                ("calyx-helper", "2.0.0", "MIT"),
                ("memchr", "2.8.2", "Unlicense OR MIT"),
                ("serde_json", "1.0.150", "MIT OR Apache-2.0"),
            ],
        )
        self.assertIn("{p}\t{l}", run.call_args.args[0])

    def test_sdl_source_launcher_uses_the_portable_bundled_feature(self) -> None:
        prefix = catalog.sdl_calyx_prefix(Namespace(calyx=None))
        self.assertEqual(
            prefix,
            [
                "cargo",
                "run",
                "-p",
                "calyx-cli",
                "--features",
                "sdl-bundled",
                "--",
            ],
        )

    def test_native_sdl_link_mode_selects_build_and_inventory_feature(self) -> None:
        self.assertEqual(catalog.sdl_feature("bundled"), "sdl-bundled")
        self.assertEqual(catalog.sdl_feature("system"), "sdl")
        with self.assertRaisesRegex(SystemExit, "unknown SDL link mode"):
            catalog.sdl_feature("vendor")

        with mock.patch.object(
            catalog.subprocess,
            "run",
            return_value=Namespace(stdout="serde_json v1.0.150\tMIT OR Apache-2.0\n"),
        ) as run:
            catalog.native_dependency_rows(
                "aarch64-unknown-linux-gnu", sdl_link="system"
            )
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--features") + 1], "sdl")

    def test_native_binary_path_honors_cargo_target_dir(self) -> None:
        with mock.patch.dict(
            os.environ, {"CARGO_TARGET_DIR": "/tmp/calyx-cross-target"}
        ):
            self.assertEqual(
                catalog.native_binary_path("aarch64-unknown-linux-gnu"),
                Path(
                    "/tmp/calyx-cross-target/"
                    "aarch64-unknown-linux-gnu/release/calyx"
                ),
            )
        with mock.patch.dict(os.environ, {"CARGO_TARGET_DIR": "cross-target"}):
            self.assertEqual(
                catalog.native_binary_path(None),
                catalog.ROOT / "cross-target" / "release" / "calyx",
            )
        explicit = {"CARGO_TARGET_DIR": "/tmp/calyx-package-target"}
        self.assertEqual(
            catalog.native_binary_path("aarch64-apple-darwin", explicit),
            Path(
                "/tmp/calyx-package-target/"
                "aarch64-apple-darwin/release/calyx"
            ),
        )

    def test_archive_is_independent_of_source_mtimes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package = root / "calyx-sdl-test"
            (package / "catalog" / "launcher").mkdir(parents=True)
            (package / "calyx").write_bytes(b"binary")
            (package / "catalog" / "launcher" / "cart.wasm").write_bytes(b"wasm")

            first = root / "first.tar.gz"
            second = root / "second.tar.gz"
            old_epoch = os.environ.get("SOURCE_DATE_EPOCH")
            os.environ["SOURCE_DATE_EPOCH"] = "123"
            try:
                catalog.deterministic_tar_gz(package, first)
                os.utime(package / "calyx", (9999, 9999))
                catalog.deterministic_tar_gz(package, second)
            finally:
                if old_epoch is None:
                    os.environ.pop("SOURCE_DATE_EPOCH", None)
                else:
                    os.environ["SOURCE_DATE_EPOCH"] = old_epoch

            self.assertEqual(first.read_bytes(), second.read_bytes())

class LockfileConsistencyTests(unittest.TestCase):
    """Per-cart package-lock.json files must agree on dependency integrity.

    Carts are self-contained build units (a cart dir can be copied out and
    built standalone), so each carries its own lockfile rather than sharing a
    workspace root. That makes lockfile drift a per-cart hazard: one cart can
    pin a wrong integrity and go unnoticed on any machine with cached
    node_modules (catalog.py skips `npm ci` when node_modules exists). This
    offline check asserts every lockfile agrees on the integrity (and resolved
    URL) for a given (name, version), catching drift without a network fetch.
    """

    def _collect_lockfiles(self) -> list[Path]:
        return [
            path
            for path in catalog.ROOT.rglob("package-lock.json")
            if "node_modules" not in path.parts
        ]

    def test_dependency_integrity_is_consistent_across_lockfiles(self) -> None:
        lockfiles = self._collect_lockfiles()
        self.assertGreater(len(lockfiles), 1, "expected multiple per-cart lockfiles")

        # (name, version) -> {integrity: {lockfile paths}}
        seen: dict[tuple[str, str], dict[str, set[Path]]] = {}
        for lock in lockfiles:
            data = json.loads(lock.read_text(encoding="utf-8"))
            for pkg_path, info in data.get("packages", {}).items():
                if not pkg_path or "node_modules/" not in pkg_path:
                    continue
                name = pkg_path.rsplit("node_modules/", 1)[1]
                version = info.get("version")
                integrity = info.get("integrity")
                if version is None or integrity is None:
                    continue
                seen.setdefault((name, version), {}).setdefault(
                    integrity, set()
                ).add(lock)

        drift = {
            (name, version): hashes
            for (name, version), hashes in seen.items()
            if len(hashes) > 1
        }
        if drift:
            lines = ["dependency integrity drift across lockfiles:"]
            for (name, version), hashes in drift.items():
                lines.append(f"  {name}@{version}:")
                for integrity, locks in hashes.items():
                    lines.append(f"    {integrity}")
                    for lock in sorted(locks):
                        lines.append(f"      {lock.relative_to(catalog.ROOT)}")
            self.fail("\n".join(lines))


if __name__ == "__main__":
    unittest.main()
