#!/usr/bin/env python3
"""Unit tests for the hello-sunny cart scaffolder."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import tomllib
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("new_cart.py")
SPEC = importlib.util.spec_from_file_location("new_cart", MODULE)
assert SPEC and SPEC.loader
new_cart = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(new_cart)


class NewCartTests(unittest.TestCase):
    def test_unicode_metadata_produces_a_readable_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            name = "Crab 🦀"
            author = 'Zoë "🦀" \\ crew'
            category = "Demos\x7f"
            destination = new_cart.create_cart(
                Path(tmp), new_cart.TEMPLATE, "crab", name, author, category
            )
            manifest = tomllib.loads(
                (destination / "cart.toml").read_text(encoding="utf-8")
            )["cart"]
            self.assertEqual(manifest["name"], name)
            self.assertEqual(manifest["author"], author)
            self.assertEqual(manifest["category"], category)

    def test_creates_flat_buildable_shape_from_nested_example(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            destination = new_cart.create_cart(
                root,
                new_cart.TEMPLATE,
                "my-first-cart",
                "My First Cart",
                "Ada",
                "Games",
            )
            source = (destination / "cart.ts").read_text(encoding="utf-8")
            self.assertIn('from "../../sdk/assembly/index"', source)
            self.assertIn('const TITLE = "MY FIRST CART";', source)
            self.assertNotIn("../../../sdk", source)

            manifest = (destination / "cart.toml").read_text(encoding="utf-8")
            self.assertIn('name = "My First Cart"', manifest)
            self.assertIn('author = "Ada"', manifest)
            self.assertIn('license = "GPL-3.0-or-later"', manifest)
            self.assertNotIn("release = true", manifest)
            self.assertIn("public_source = false", manifest)

            package = json.loads(
                (destination / "package.json").read_text(encoding="utf-8")
            )
            self.assertEqual(package["name"], "@cheesycrab/cart-my-first-cart")
            self.assertEqual(package["license"], "GPL-3.0-or-later")
            self.assertIn("--maximumMemory 1024", package["scripts"]["build"])
            self.assertTrue((destination / ".gitignore").exists())

    def test_accepts_an_author_selected_cart_license(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            destination = new_cart.create_cart(
                Path(tmp),
                new_cart.TEMPLATE,
                "guest-cart",
                "Guest Cart",
                "Ada",
                "Games",
                "CC0-1.0",
            )
            manifest = (destination / "cart.toml").read_text(encoding="utf-8")
            package = json.loads(
                (destination / "package.json").read_text(encoding="utf-8")
            )
            self.assertIn('license = "CC0-1.0"', manifest)
            self.assertEqual(package["license"], "CC0-1.0")

    def test_rejects_unsafe_slug_and_existing_destination(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, "lowercase kebab-case"):
                new_cart.create_cart(
                    root, new_cart.TEMPLATE, "Bad/Slug", "Bad", "Ada", "Games"
                )
            (root / "carts" / "taken").mkdir(parents=True)
            with self.assertRaisesRegex(FileExistsError, "already exists"):
                new_cart.create_cart(
                    root, new_cart.TEMPLATE, "taken", "Taken", "Ada", "Games"
                )

    def test_rejects_metadata_that_the_runtime_would_refuse(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, "category exceeds the 31-byte"):
                new_cart.create_cart(
                    root,
                    new_cart.TEMPLATE,
                    "too-wide",
                    "Fine",
                    "Ada",
                    "x" * 32,
                )
            self.assertFalse((root / "carts" / "too-wide").exists())


if __name__ == "__main__":
    unittest.main()
