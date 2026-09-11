#!/usr/bin/env python3
"""Focused tests for the report-first Calyx cleanup utility."""

from __future__ import annotations

import importlib.util
import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "clean_tool", Path(__file__).with_name("clean.py")
)
assert SPEC and SPEC.loader
clean = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(clean)


class CleanToolTests(unittest.TestCase):
    def test_default_reports_and_prints_options_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            target = root / "target"
            target.mkdir()
            marker = target / "keep"
            marker.write_bytes(b"cache")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(clean.main([], root), 0)
            rendered = output.getvalue()
            self.assertIn("read-only", rendered)
            self.assertIn("--cargo", rendered)
            self.assertIn("--node-modules", rendered)
            self.assertTrue(marker.exists())

    def test_node_module_discovery_stops_at_outer_directory(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            outer = root / "carts" / "demo" / "node_modules"
            (outer / "pkg" / "node_modules").mkdir(parents=True)
            self.assertEqual(clean.find_named_directories(root, "node_modules"), [outer])

    def test_build_cleanup_preserves_distributions(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            smoke = root / "build" / "catalog-smoke"
            distributions = root / "build" / "distributions"
            smoke.mkdir(parents=True)
            distributions.mkdir()
            targets = clean.transient_build_targets(root)
            self.assertIn(smoke, targets)
            self.assertNotIn(distributions, targets)

    def test_build_cleanup_includes_bounded_tool_caches(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            pycache = root / "tools" / "__pycache__"
            ruff = root / ".ruff_cache"
            browser_shot = root / "web" / "browser-shot.png"
            ignored_dependency_cache = root / "web" / "node_modules" / "pkg" / "__pycache__"
            pycache.mkdir(parents=True)
            ruff.mkdir()
            browser_shot.parent.mkdir()
            browser_shot.write_bytes(b"png")
            ignored_dependency_cache.mkdir(parents=True)
            targets = clean.tool_cache_targets(root)
            self.assertEqual(targets, sorted([ruff, pycache, browser_shot]))

    def test_distribution_retention_groups_archive_checksum_and_tree(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            dist = root / "build" / "distributions"
            dist.mkdir(parents=True)
            bases = [f"calyx-web-sideb-{value:016x}" for value in range(3)]
            for timestamp, base in enumerate(bases, start=1):
                paths = [
                    dist / base,
                    dist / f"{base}.tar.gz",
                    dist / f"{base}.tar.gz.sha256",
                ]
                paths[0].mkdir()
                paths[1].write_bytes(b"archive")
                paths[2].write_bytes(b"sum")
                for path in paths:
                    os.utime(path, (timestamp, timestamp))
            stale = clean.stale_distribution_targets(root, keep=2)
            self.assertEqual(
                {path.name for path in stale},
                {
                    bases[0],
                    f"{bases[0]}.tar.gz",
                    f"{bases[0]}.tar.gz.sha256",
                },
            )

    def test_selected_cleanup_without_yes_is_preview_only(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            generated = root / "build" / "smoke"
            generated.mkdir(parents=True)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(clean.main(["--builds"], root), 0)
            self.assertTrue(generated.exists())


if __name__ == "__main__":
    unittest.main()
