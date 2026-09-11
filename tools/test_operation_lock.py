#!/usr/bin/env python3
"""Tests for the product operation lock."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools import operation_lock as lock_support
from tools.operation_lock import operation_lock


class OperationLockTests(unittest.TestCase):
    def test_public_lock_support_has_no_host_specific_path(self) -> None:
        self.assertFalse(hasattr(lock_support, "HOST_SERVE_LOCK"))

    def test_records_owner_refuses_contention_and_cleans_up(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            lock = Path(temp) / "operation.lock"
            with operation_lock(lock, "dist-web:sideb"):
                owner = json.loads((lock / "owner.json").read_text(encoding="utf-8"))
                self.assertEqual(owner["operation"], "dist-web:sideb")
                self.assertIn("started_at", owner)
                self.assertIn("pid", owner)
                with self.assertRaisesRegex(SystemExit, "operation lock is held"):
                    with operation_lock(lock, "deploy:sideb"):
                        pass
            self.assertFalse(lock.exists())

    def test_cleans_up_after_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            lock = Path(temp) / "operation.lock"
            with self.assertRaisesRegex(RuntimeError, "boom"):
                with operation_lock(lock, "test"):
                    raise RuntimeError("boom")
            self.assertFalse(lock.exists())


if __name__ == "__main__":
    unittest.main()
