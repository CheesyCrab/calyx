#!/usr/bin/env python3
"""Behavioral tests for fail-closed public-tree validation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


CHECKER = Path(__file__).with_name("public_check.py")
TOP_LEVEL_FILES = (
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
)
TOP_LEVEL_DIRECTORIES = (
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
)
DOCS = (
    "ABI.md",
    "AI_USE.md",
    "ARCHITECTURE.md",
    "CART_AUTHORING.md",
    "FLOAT_POLICY.md",
    "README.md",
    "RUNNING.md",
    "VERSIONING.md",
)
CARTS = (
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
)


def write_valid_tree(root: Path) -> None:
    for directory in TOP_LEVEL_DIRECTORIES:
        (root / directory).mkdir(parents=True, exist_ok=True)
    for filename in TOP_LEVEL_FILES:
        (root / filename).write_text("\n", encoding="utf-8")
    (root / "Cargo.toml").write_text(
        '[workspace]\nmembers = ["crates/core", "crates/cli"]\n',
        encoding="utf-8",
    )
    (root / "Cargo.lock").write_text(
        'version = 3\n\n[[package]]\nname = "calyx-core"\n'
        'version = "0.1.0"\n\n[[package]]\nname = "calyx-cli"\n'
        'version = "0.1.0"\n',
        encoding="utf-8",
    )
    for filename in DOCS:
        (root / "docs" / filename).write_text(f"# {filename}\n", encoding="utf-8")
    workflows = root / ".github" / "workflows"
    workflows.mkdir()
    for filename in ("ci.yml", "release.yml", "pages.yml"):
        (workflows / filename).write_text("name: fixture\n", encoding="utf-8")

    crate_manifests = {
        "core": '[package]\nname = "calyx-core"\n\n[lib]\nname = "calyx_core"\n',
        "cli": '[package]\nname = "calyx-cli"\n\n[[bin]]\nname = "calyx"\n',
    }
    for slug, payload in crate_manifests.items():
        path = root / "crates" / slug / "Cargo.toml"
        path.parent.mkdir(parents=True)
        path.write_text(payload, encoding="utf-8")

    npm_packages = {
        "sdk": "@cheesycrab/sunny",
        "starter": "my-calyx-cart",
        "web": "@cheesycrab/calyx-web",
        "conformance": "calyx-conformance",
    }
    for directory, name in npm_packages.items():
        (root / directory / "package.json").write_text(
            json.dumps({"name": name, "private": True}) + "\n",
            encoding="utf-8",
        )

    (root / "carts" / ".gitignore").write_text(".local/\n", encoding="utf-8")
    (root / "carts" / "README.md").write_text("# Carts\n", encoding="utf-8")
    for cart in CARTS:
        directory = root / "carts" / cart
        directory.mkdir(parents=True)
        system = cart.startswith("system/")
        release = cart != "system/settings"
        manifest = (
            "[cart]\n"
            f'name = "{Path(cart).name}"\n'
            'author = "Cheesy Crab"\n'
            f"release = {'true' if release else 'false'}\n"
            f"system = {'true' if system else 'false'}\n"
            "public_source = true\n"
        )
        (directory / "cart.toml").write_text(manifest, encoding="utf-8")
        (directory / "package.json").write_text(
            json.dumps(
                {
                    "name": f"@cheesycrab/cart-{Path(cart).name}",
                    "private": True,
                }
            )
            + "\n",
            encoding="utf-8",
        )


class PublicCheckTests(unittest.TestCase):
    def run_checker(
        self, root: Path, *extra: str
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, CHECKER, "--root", root, *extra],
            capture_output=True,
            text=True,
            check=False,
        )

    def valid_root(self, raw: str) -> Path:
        root = Path(raw)
        write_valid_tree(root)
        return root

    def test_accepts_exact_approved_public_tree(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("public-check: tree OK", result.stdout)

    def test_accepts_canonical_superset_only_with_explicit_private_exclusion(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            private = root / "private" / "operations"
            private.mkdir(parents=True)
            (private / "operator.txt").write_text(
                "/" + "Users/example/private-host\n", encoding="utf-8"
            )

            rejected = self.run_checker(root)
            accepted = self.run_checker(root, "--exclude", "private")

            self.assertEqual(rejected.returncode, 1)
            self.assertIn("private: unknown top-level entry", rejected.stderr)
            self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)

    def test_rejects_unknown_top_level_entries(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "surprise.txt").write_text("unexpected\n", encoding="utf-8")

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("surprise.txt: unknown top-level entry", result.stderr)

    def test_rejects_missing_public_policy_or_release_record(self) -> None:
        for filename in ("CHANGELOG.md", "SECURITY.md"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                (root / filename).unlink()

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn(
                    f"{filename}: required top-level entry is missing",
                    result.stderr,
                )

    def test_rejects_nonpublic_topology(self) -> None:
        forbidden = ("docs/archive", "docs/superpowers", "inbox", "private")
        for relative in forbidden:
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                (root / relative).mkdir(parents=True)

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn(relative, result.stderr)

    def test_rejects_unapproved_or_missing_public_cart_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            extra = root / "carts" / "unapproved"
            extra.mkdir()
            (extra / "cart.toml").write_text(
                '[cart]\nauthor = "Cheesy Crab"\npublic_source = true\n',
                encoding="utf-8",
            )
            (root / "carts" / "wormtide" / "cart.toml").unlink()

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("carts/unapproved: unapproved public cart", result.stderr)
            self.assertIn("carts/wormtide: approved public cart is missing", result.stderr)

    def test_rejects_manifestless_entries_in_cart_catalog_directories(self) -> None:
        unexpected = (
            ("carts/notes.txt", False),
            ("carts/unlisted", True),
            ("carts/examples/notes.txt", False),
            ("carts/examples/unlisted", True),
            ("carts/system/notes.txt", False),
            ("carts/system/unlisted", True),
        )
        for relative, is_directory in unexpected:
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                path = root / relative
                if is_directory:
                    path.mkdir()
                else:
                    path.write_text("unexpected\n", encoding="utf-8")

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn(f"{relative}: unapproved entry", result.stderr)

    def test_rejects_public_source_false(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            manifest = root / "carts" / "wormtide" / "cart.toml"
            manifest.write_text(
                manifest.read_text(encoding="utf-8").replace(
                    "public_source = true", "public_source = false"
                ),
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "carts/wormtide/cart.toml: public_source must be true",
                result.stderr,
            )

    def test_rejects_release_or_system_cart_without_public_source(self) -> None:
        for cart in ("horizon-burn", "system/launcher"):
            with self.subTest(cart=cart), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                manifest = root / "carts" / cart / "cart.toml"
                manifest.write_text(
                    manifest.read_text(encoding="utf-8").replace(
                        "public_source = true\n", ""
                    ),
                    encoding="utf-8",
                )

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn("public_source must be true", result.stderr)

    def test_rejects_public_import_into_private_source(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "web" / "bad.mjs").write_text(
                'import { secret } from "../private/secret.mjs";\n',
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("web/bad.mjs: import references private source", result.stderr)

    def test_rejects_bare_private_module_imports(self) -> None:
        imports = (
            ("tools/from_private.py", "from private.module import secret\n"),
            ("tools/import_private.py", "import private.module\n"),
            ("web/require-private.js", 'require("private/module.js");\n'),
        )
        for relative, source in imports:
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                (root / relative).write_text(source, encoding="utf-8")

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn(
                    f"{relative}: import references private source",
                    result.stderr,
                )

    def test_rejects_unapproved_cargo_and_npm_package_names(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "crates" / "core" / "Cargo.toml").write_text(
                '[package]\nname = "wrong-core"\n', encoding="utf-8"
            )
            (root / "sdk" / "package.json").write_text(
                json.dumps({"name": "@wrong/sunny"}) + "\n", encoding="utf-8"
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "crates/core/Cargo.toml: unapproved Cargo package name: wrong-core",
                result.stderr,
            )
            self.assertIn(
                "sdk/package.json: unapproved npm package name: @wrong/sunny",
                result.stderr,
            )

    def test_rejects_unapproved_first_party_cart_author(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            manifest = root / "carts" / "wormtide" / "cart.toml"
            manifest.write_text(
                manifest.read_text(encoding="utf-8").replace(
                    'author = "Cheesy Crab"', 'author = "Someone Else"'
                ),
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("unapproved first-party cart author", result.stderr)

    @unittest.skipIf(os.name == "nt", "creating symlinks is privilege-sensitive on Windows")
    def test_rejects_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "assets" / "target.txt").write_text("target\n", encoding="utf-8")
            (root / "assets" / "link.txt").symlink_to("target.txt")

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("assets/link.txt: symlink is not allowed", result.stderr)

    @unittest.skipIf(os.name == "nt", "creating symlinks is privilege-sensitive on Windows")
    def test_ignores_known_untracked_worktree_directories(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / ".gitignore").write_text(
                "carts/.local\ntools/__pycache__/\n", encoding="utf-8"
            )
            subprocess.run(
                ["git", "init", "--initial-branch=main"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "add", ".gitignore"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            local = root / "carts" / ".local"
            local.mkdir()
            (local / "external").symlink_to(root / "assets", target_is_directory=True)
            cache = root / "tools" / "__pycache__"
            cache.mkdir()
            (cache / "cached.pyc").write_bytes(b"/" + b"home/example/calyx\n")

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_git_view_ignores_build_residue_and_empty_directories(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / ".gitignore").write_text(
                "**/cart.wasm\n**/node_modules/\nconformance/out/\n",
                encoding="utf-8",
            )
            subprocess.run(
                ["git", "init", "--initial-branch=main"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "add", ".gitignore"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            residue = root / "carts" / "private-probe"
            (residue / "node_modules").mkdir(parents=True)
            (residue / "cart.wasm").write_bytes(b"wasm")
            (residue / "node_modules" / "package.json").write_text(
                '{"name":"ignored"}\n', encoding="utf-8"
            )
            generated = root / "conformance" / "out"
            generated.mkdir()
            (generated / "status.json").write_text(
                "/" + "home/example/private-build\n", encoding="utf-8"
            )
            (root / "docs" / "superpowers" / "plans").mkdir(parents=True)

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_git_view_rejects_source_beside_ignored_build_residue(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / ".gitignore").write_text("**/cart.wasm\n", encoding="utf-8")
            subprocess.run(
                ["git", "init", "--initial-branch=main"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "add", ".gitignore"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            residue = root / "carts" / "private-probe"
            residue.mkdir()
            (residue / "cart.wasm").write_bytes(b"wasm")
            (residue / "cart.toml").write_text(
                '[cart]\nname = "private-probe"\n', encoding="utf-8"
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("carts/private-probe: unapproved entry", result.stderr)

    def test_git_view_cannot_hide_force_tracked_unknown_content(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / ".gitignore").write_text("hidden/\n", encoding="utf-8")
            subprocess.run(
                ["git", "init", "--initial-branch=main"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            hidden = root / "hidden"
            hidden.mkdir()
            (hidden / "secret.txt").write_text("tracked\n", encoding="utf-8")
            subprocess.run(
                ["git", "add", ".gitignore"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "add", "-f", "hidden/secret.txt"],
                cwd=root,
                capture_output=True,
                check=True,
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("hidden: unknown top-level entry", result.stderr)

    def test_does_not_ignore_generated_names_without_git_exclusion(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "build").mkdir()

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("build: unknown top-level entry", result.stderr)

    def test_does_not_inherit_ancestor_git_ignores_for_untracked_export(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            outer = Path(raw)
            subprocess.run(
                ["git", "init", "--initial-branch=main"],
                cwd=outer,
                capture_output=True,
                check=True,
            )
            (outer / ".gitignore").write_text("/scratch/\n", encoding="utf-8")
            subprocess.run(
                ["git", "add", ".gitignore"],
                cwd=outer,
                capture_output=True,
                check=True,
            )
            root = outer / "scratch" / "export"
            root.mkdir(parents=True)
            write_valid_tree(root)
            (root / "build").mkdir()

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("build: unknown top-level entry", result.stderr)

    def test_rejects_generic_absolute_home_paths(self) -> None:
        forbidden = (
            "/" + "Users/example/work/calyx",
            "/" + "home/example/work/calyx",
            "C:" + r"\Users\example\work\calyx",
        )
        for value in forbidden:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                (root / "assets" / "path.txt").write_text(value + "\n", encoding="utf-8")

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn("absolute home path", result.stderr)

    def test_reports_errors_in_stable_sorted_order(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "z-last").write_text("bad\n", encoding="utf-8")
            (root / "a-first").write_text("bad\n", encoding="utf-8")

            result = self.run_checker(root)

            errors = result.stderr.splitlines()
            self.assertEqual(errors, sorted(errors))

    def test_accepts_existing_relative_files_and_ignores_external_links(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "README.md").write_text(
                "[Guide](docs/RUNNING.md#run) [site](https://example.com) "
                "[mail](mailto:hello@example.com) [section](#local)\n",
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_ignores_links_with_valid_absolute_uri_schemes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "README.md").write_text(
                "[FTP](ftp://example.com/archive.zip) "
                "[URN](urn:isbn:9780140328721)\n",
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_ignores_link_syntax_inside_inline_code(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "README.md").write_text(
                "[Guide](docs/RUNNING.md) `[example](missing.md)` "
                "``[example](also-missing.md)``\n",
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_ignores_link_syntax_inside_fenced_code(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "README.md").write_text(
                "```markdown\n[example](missing.md)\n```\n"
                "~~~markdown\n[example](also-missing.md)\n~~~\n",
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_accepts_balanced_parentheses_in_relative_destinations(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            target = root / "assets" / "guide_(old).md"
            target.write_text("# Guide\n", encoding="utf-8")
            (root / "README.md").write_text(
                "[Old guide](assets/guide_(old).md)\n",
                encoding="utf-8",
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_broken_relative_file_link(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.valid_root(raw)
            (root / "README.md").write_text(
                "[Missing](docs/MISSING.md)\n", encoding="utf-8"
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("README.md: broken relative link: docs/MISSING.md", result.stderr)

    def test_rejects_links_into_nonpublic_history_and_planning_paths(self) -> None:
        forbidden = (
            "private/active/release.md",
            "docs/archive/result.md",
            "inbox/idea.md",
            "plans/release.md",
            "planning/release.md",
            "history/notes.md",
            "docs/ROADMAP.md",
        )
        for target in forbidden:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as raw:
                root = self.valid_root(raw)
                path = root / target
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("# Not public\n", encoding="utf-8")
                (root / "README.md").write_text(
                    f"[Not public]({target})\n", encoding="utf-8"
                )

                result = self.run_checker(root)

                self.assertEqual(result.returncode, 1)
                self.assertIn(
                    f"README.md: nonpublic link target: {target}", result.stderr
                )

    def test_rejects_relative_links_that_escape_the_checked_root(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            outer = Path(raw)
            root = outer / "export"
            root.mkdir()
            write_valid_tree(root)
            (outer / "parent.md").write_text("# Parent\n", encoding="utf-8")
            (root / "README.md").write_text(
                "[Parent](../parent.md)\n", encoding="utf-8"
            )

            result = self.run_checker(root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("README.md: link escapes public root: ../parent.md", result.stderr)


if __name__ == "__main__":
    unittest.main()
