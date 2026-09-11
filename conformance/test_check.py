#!/usr/bin/env python3
"""Focused tests for bounded, deterministic conformance compilation."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "conformance_check", Path(__file__).with_name("check.py")
)
assert SPEC and SPEC.loader
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


class ParallelBuildTests(unittest.TestCase):
    def commands(self) -> list:
        return [
            check.BuildCommand(label, ["asc", label], Path("/tmp"))
            for label in ("checker", "particles", "settings")
        ]

    def test_job_resolution_is_bounded_with_explicit_escape_hatches(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
            check.os, "cpu_count", return_value=64
        ):
            self.assertEqual(check.resolve_build_jobs(None), 4)
        with mock.patch.dict(os.environ, {"CALYX_BUILD_JOBS": "3"}, clear=True):
            self.assertEqual(check.resolve_build_jobs(None), 3)
            self.assertEqual(check.resolve_build_jobs(1), 1)

    def test_single_job_is_serial_and_default_pool_can_overlap(self) -> None:
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
            return check.BuildResult(command, 0, "", "")

        with mock.patch.object(check, "run_captured_build", side_effect=fake):
            with redirect_stdout(io.StringIO()):
                check.run_parallel_builds(self.commands(), 1)
            self.assertEqual(peak, 1)
            peak = 0
            with redirect_stdout(io.StringIO()):
                check.run_parallel_builds(self.commands(), 3)
            self.assertGreater(peak, 1)

    def test_all_failures_and_output_replay_follow_manifest_order(self) -> None:
        delays = {"checker": 0.03, "particles": 0.02, "settings": 0.01}

        def fake(command):
            time.sleep(delays[command.label])
            code = 0 if command.label == "particles" else 2
            return check.BuildResult(
                command,
                code,
                f"{command.label}-out\n",
                f"{command.label}-err\n",
            )

        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(check, "run_captured_build", side_effect=fake):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with self.assertRaisesRegex(SystemExit, "checker, settings"):
                    check.run_parallel_builds(self.commands(), 3)

        rendered = stdout.getvalue()
        self.assertLess(rendered.index("checker-out"), rendered.index("particles-out"))
        self.assertLess(rendered.index("particles-out"), rendered.index("settings-out"))
        errors = stderr.getvalue()
        self.assertIn("FAIL checker (exit 2): asc checker", errors)
        self.assertIn("FAIL settings (exit 2): asc settings", errors)


class AlternateSuiteTests(unittest.TestCase):
    def test_suite_paths_resolve_the_complete_alternate_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            suite = Path(temp_dir) / "suite" / ".." / "suite"

            paths = check.suite_paths(suite)

            resolved = suite.resolve()
            self.assertEqual(
                paths,
                check.SuitePaths(
                    resolved,
                    resolved / "carts",
                    resolved / "build",
                    resolved / "out",
                ),
            )

    def test_build_reads_and_writes_alternate_suite_with_public_compiler(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            suite = Path(temp_dir) / "alternate"
            cart = suite / "carts" / "private-probe"
            cart.mkdir(parents=True)
            entry = cart / "cart.ts"
            entry.write_text("export function start(): void {}\n", encoding="utf-8")
            (cart / "cart.toml").write_text(
                """[cart]
name = "private-probe"
entry = "cart.ts"
abi = "v1"

[run]
frames = 1
""",
                encoding="utf-8",
            )

            with mock.patch.object(check, "run_parallel_builds") as run_builds:
                check.main(["--suite", str(suite), "build"])

            commands = run_builds.call_args.args[0]
            self.assertEqual(len(commands), 1)
            command = commands[0]
            self.assertEqual(
                command.argv[0], str(check.ROOT / "node_modules" / ".bin" / "asc")
            )
            self.assertEqual(Path(command.argv[1]), entry.resolve())
            out_arg = Path(command.argv[command.argv.index("--outFile") + 1])
            self.assertEqual(
                (command.cwd / out_arg).resolve(),
                (suite / "build" / "private-probe.wasm").resolve(),
            )


class ColorProfileTests(unittest.TestCase):
    def test_color_mode_is_verified_even_when_hash_and_palette_match(self):
        with tempfile.TemporaryDirectory() as raw:
            out = Path(raw)
            (out / "frames.jsonl").write_text("")
            expected = {"run_hash": "r", "final_hash": "f", "palette": "p", "color": "rgba8888"}
            manifest = {"_dir": out, "expected": expected}
            status = {"run_hash": "r", "final_hash": "f", "profile": {"palette": "p"}}
            (out / "status.json").write_text(json.dumps(status))
            self.assertTrue(any("color" in fail for fail in check.grade(manifest, out)))
            status["profile"]["color"] = "rgba8888"
            (out / "status.json").write_text(json.dumps(status))
            self.assertEqual(check.grade(manifest, out), [])


class EventGoldenTests(unittest.TestCase):
    def grade(self, golden: str, frames: list[dict]) -> list[str]:
        with tempfile.TemporaryDirectory() as raw:
            cart = Path(raw) / "cart"
            out = Path(raw) / "out"
            cart.mkdir()
            out.mkdir()
            (cart / "events.golden.jsonl").write_text(golden, encoding="utf-8")
            (out / "status.json").write_text(
                '{"run_hash":"run","final_hash":"final",'
                '"profile":{"palette":"sweetie16"}}\n',
                encoding="utf-8",
            )
            (out / "frames.jsonl").write_text(
                "".join(json.dumps(line) + "\n" for line in frames),
                encoding="utf-8",
            )
            manifest = {
                "_dir": cart,
                "expected": {
                    "run_hash": "run",
                    "final_hash": "final",
                    "palette": "sweetie16",
                },
            }
            return check.grade(manifest, out)

    def test_sys_only_golden_defaults_omitted_audio_to_empty(self) -> None:
        fails = self.grade(
            '{"f":0,"sys":[{"op":"exit"}]}\n',
            [{"f": 0, "hash": "a", "audio": [], "sys": [{"op": "exit"}]}],
        )

        self.assertEqual(fails, [])

    def test_listed_frame_grades_both_event_streams(self) -> None:
        fails = self.grade(
            '{"f":0,"sys":[{"op":"exit"}]}\n',
            [{"f": 0, "hash": "a", "audio": [{"op": "tone"}], "sys": []}],
        )

        self.assertTrue(any("audio @f0" in fail for fail in fails), fails)
        self.assertTrue(any("sys @f0" in fail for fail in fails), fails)

    def test_unlisted_frame_rejects_either_event_stream(self) -> None:
        fails = self.grade(
            '{"f":0}\n',
            [
                {"f": 0, "hash": "a", "audio": [], "sys": []},
                {
                    "f": 1,
                    "hash": "b",
                    "audio": [{"op": "tone"}],
                    "sys": [{"op": "exit"}],
                },
            ],
        )

        self.assertTrue(any("audio @f1" in fail for fail in fails), fails)
        self.assertTrue(any("sys @f1" in fail for fail in fails), fails)


if __name__ == "__main__":
    unittest.main()
