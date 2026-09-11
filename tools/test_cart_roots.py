#!/usr/bin/env python3
"""Behavioral tests for deterministic public plus explicit cart roots."""

from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path


try:
    cart_roots = importlib.import_module("tools.cart_roots")
except ModuleNotFoundError:
    cart_roots = None


class CartRootTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(cart_roots, "tools.cart_roots interface is missing")
        return cart_roots

    def test_resolve_preserves_public_cli_then_environment_order(self) -> None:
        module = self.module()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "public"
            cli = root / "cli"
            env_one = root / "env-one"
            env_two = root / "env-two"
            for path in (public, cli, env_one, env_two):
                path.mkdir()

            resolved = module.resolve_cart_roots(
                public,
                [cli],
                {
                    "CALYX_EXTRA_CART_ROOTS": os.pathsep.join(
                        (str(env_one), str(env_two))
                    )
                },
            )

            self.assertEqual(
                resolved,
                [
                    public.resolve(),
                    cli.resolve(),
                    env_one.resolve(),
                    env_two.resolve(),
                ],
            )

    def test_resolve_deduplicates_identical_resolved_roots(self) -> None:
        module = self.module()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "public"
            extra = root / "extra"
            public.mkdir()
            extra.mkdir()

            resolved = module.resolve_cart_roots(
                public,
                [extra, extra / ".." / "extra"],
                {"CALYX_EXTRA_CART_ROOTS": str(extra)},
            )

            self.assertEqual(resolved, [public.resolve(), extra.resolve()])

    def test_resolve_rejects_a_missing_requested_root(self) -> None:
        module = self.module()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "public"
            missing = root / "missing"
            public.mkdir()

            with self.assertRaisesRegex(
                ValueError,
                rf"cart root does not exist: {missing.resolve()}",
            ):
                module.resolve_cart_roots(public, [missing], {})

    def test_discovery_is_stable_across_flat_and_grouped_carts(self) -> None:
        module = self.module()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            public = root / "public"
            extra = root / "extra"
            manifests = [
                public / "zeta" / "cart.toml",
                public / "system" / "launcher" / "cart.toml",
                extra / "alpha" / "cart.toml",
            ]
            for manifest in manifests:
                manifest.parent.mkdir(parents=True, exist_ok=True)
                manifest.write_text("[cart]\n")

            discovered = module.discover_cart_manifests([public, extra])

            self.assertEqual(
                [path.parent.name for path in discovered],
                ["alpha", "launcher", "zeta"],
            )

    def test_discovery_rejects_duplicate_slugs_across_roots(self) -> None:
        module = self.module()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            first_manifest = root / "a-root" / "group" / "same" / "cart.toml"
            second_manifest = root / "z-root" / "same" / "cart.toml"
            for manifest in (second_manifest, first_manifest):
                manifest.parent.mkdir(parents=True, exist_ok=True)
                manifest.write_text("[cart]\n")

            expected = (
                f"duplicate cart slug 'same': {first_manifest} and {second_manifest}"
            )
            for roots in (
                [second_manifest.parents[1], first_manifest.parents[2]],
                [first_manifest.parents[2], second_manifest.parents[1]],
            ):
                with self.subTest(roots=roots), self.assertRaises(ValueError) as raised:
                    module.discover_cart_manifests(roots)
                self.assertEqual(str(raised.exception), expected)

    def test_hidden_cart_group_requires_an_explicit_root(self) -> None:
        module = self.module()
        with tempfile.TemporaryDirectory() as raw:
            public = Path(raw) / "public"
            visible = public / "visible" / "cart.toml"
            hidden_root = public / ".local"
            hidden = hidden_root / "external" / "cart.toml"
            for manifest in (visible, hidden):
                manifest.parent.mkdir(parents=True, exist_ok=True)
                manifest.write_text("[cart]\n")

            self.assertEqual(module.discover_cart_manifests([public]), [visible])
            self.assertEqual(
                module.discover_cart_manifests([public, hidden_root]),
                [hidden, visible],
            )


if __name__ == "__main__":
    unittest.main()
