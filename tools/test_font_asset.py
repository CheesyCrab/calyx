#!/usr/bin/env python3
"""Behavioral checks for the ABI-pinned Calyx font asset."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "assets" / "fonts" / "m6x11-v1.json"
EXPECTED_SHA256 = "61f8571f4c53fc51feb78190cd91be36929b488179d222f4239216514a117c5d"


class FontAssetTests(unittest.TestCase):
    def test_canonical_font_keeps_abi_digest_at_asset_path(self) -> None:
        self.assertTrue(CANONICAL.is_file(), f"missing canonical font: {CANONICAL}")
        self.assertEqual(hashlib.sha256(CANONICAL.read_bytes()).hexdigest(), EXPECTED_SHA256)

    def test_sunny_generated_font_matches_canonical_asset(self) -> None:
        result = subprocess.run(
            [sys.executable, "sdk/tools/gen_font.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_web_generated_font_matches_canonical_asset(self) -> None:
        self.assertTrue(CANONICAL.is_file(), f"missing canonical font: {CANONICAL}")
        generated = (ROOT / "web" / "src" / "m6x11.mjs").read_text(encoding="utf-8")
        payload = generated.split("export default ", maxsplit=1)[1].removesuffix(";\n")
        self.assertEqual(json.loads(payload), json.loads(CANONICAL.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
