from __future__ import annotations

import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

import starter_package


class StarterPackageTests(unittest.TestCase):
    def test_builds_reproducible_self_contained_zip(self) -> None:
        with tempfile.TemporaryDirectory(prefix="calyx starter test ") as tmp:
            out = Path(tmp) / "dist"
            first = starter_package.build_starter(out)
            first_bytes = first.read_bytes()
            second = starter_package.build_starter(out)
            self.assertEqual(first_bytes, second.read_bytes())
            checksum = first.with_suffix(first.suffix + ".sha256")
            self.assertEqual(
                checksum.read_text(encoding="utf-8"),
                f"{hashlib.sha256(first_bytes).hexdigest()}  {first.name}\n",
            )
            with zipfile.ZipFile(first) as archive:
                names = archive.namelist()
                self.assertIn("calyx-cart-starter/cart.ts", names)
                self.assertIn("calyx-cart-starter/sunny/index.ts", names)
                self.assertIn("calyx-cart-starter/LICENSES/MIT.txt", names)
                self.assertNotIn("calyx-cart-starter/node_modules/", names)
                package = archive.read("calyx-cart-starter/package.json")
                self.assertIn(b'"assemblyscript": "0.28.20"', package)
                self.assertIn(b"--maximumMemory 1024", package)

    def test_vendored_sunny_bytes_match_canonical_sdk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive = starter_package.build_starter(Path(tmp))
            with zipfile.ZipFile(archive) as zipped:
                for source in sorted(starter_package.SDK.rglob("*")):
                    if source.is_file():
                        relative = source.relative_to(starter_package.SDK).as_posix()
                        self.assertEqual(
                            zipped.read(f"calyx-cart-starter/sunny/{relative}"),
                            source.read_bytes(),
                        )


if __name__ == "__main__":
    unittest.main()
