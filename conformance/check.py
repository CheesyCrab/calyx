#!/usr/bin/env python3
"""Calyx conformance runner — build / verify / bless / list.

Convenience wrapper over the suite spec in README.md; it contains NO
grading knowledge that is not in that spec + the cart manifests. A
runtime reimplementing the README's steps must reach the same verdicts.

    python check.py [--suite PATH] build        # asc-compile every cart
    python check.py [--suite PATH] list         # show the suite
    python check.py verify --runtime-cmd "..."  # grade any runtime
    python check.py bless --runtime-cmd "..." [cart ...]   # write [expected]

Cross-platform Python, stdlib only (tomllib needs Python >= 3.11).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shlex
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent

BUILD_JOBS_ENV = "CALYX_BUILD_JOBS"
MAX_AUTO_BUILD_JOBS = 4


class BuildCommand(NamedTuple):
    label: str
    argv: list[str]
    cwd: Path


class BuildResult(NamedTuple):
    command: BuildCommand
    returncode: int | None
    stdout: str
    stderr: str


class SuitePaths(NamedTuple):
    suite: Path
    carts: Path
    build: Path
    out: Path


def suite_paths(path: Path) -> SuitePaths:
    suite = path.resolve()
    return SuitePaths(suite, suite / "carts", suite / "build", suite / "out")


def sh(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)


def positive_jobs(value: str) -> int:
    try:
        jobs = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("jobs must be an integer") from None
    if jobs < 1:
        raise argparse.ArgumentTypeError("jobs must be at least 1")
    return jobs


def resolve_build_jobs(requested: int | None) -> int:
    if requested is not None:
        if requested < 1:
            raise SystemExit("jobs must be at least 1")
        return requested
    if raw := os.environ.get(BUILD_JOBS_ENV):
        try:
            return positive_jobs(raw)
        except argparse.ArgumentTypeError as exc:
            raise SystemExit(f"{BUILD_JOBS_ENV}: {exc}") from None
    return max(1, min(MAX_AUTO_BUILD_JOBS, os.cpu_count() or 1))


def run_captured_build(command: BuildCommand) -> BuildResult:
    try:
        completed = subprocess.run(
            command.argv,
            cwd=command.cwd,
            check=False,
            capture_output=True,
            text=True,
        )
        return BuildResult(
            command,
            completed.returncode,
            completed.stdout,
            completed.stderr,
        )
    except OSError as exc:
        return BuildResult(command, None, "", f"{type(exc).__name__}: {exc}\n")


def run_parallel_builds(
    commands: list[BuildCommand], requested_jobs: int | None
) -> None:
    """Compile concurrently, then replay diagnostics in manifest order."""
    if not commands:
        return
    workers = min(resolve_build_jobs(requested_jobs), len(commands))
    print(
        f"conformance: compiling {len(commands)} carts with {workers} job(s)",
        flush=True,
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_captured_build, command) for command in commands]
        results = [future.result() for future in futures]

    failures: list[BuildResult] = []
    for result in results:
        print(f"$ {' '.join(result.command.argv)}", flush=True)
        if result.stdout:
            print(result.stdout, end="", flush=True)
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr, flush=True)
        if result.returncode != 0:
            failures.append(result)
            status = (
                f"exit {result.returncode}"
                if result.returncode is not None
                else "could not start"
            )
            print(
                f"conformance: FAIL {result.command.label} ({status}): "
                f"{' '.join(result.command.argv)}",
                file=sys.stderr,
            )
    if failures:
        labels = ", ".join(result.command.label for result in failures)
        raise SystemExit(
            f"conformance: {len(failures)} cart build(s) failed: {labels}"
        )


def npm_bin() -> str:
    """Return the platform launcher that subprocess can execute directly."""
    name = "npm.cmd" if sys.platform == "win32" else "npm"
    npm = shutil.which(name)
    if npm is None:
        sys.exit(f"{name} not found — install Node.js + npm and retry")
    return npm


def asc_bin() -> Path:
    name = "asc.cmd" if sys.platform == "win32" else "asc"
    return ROOT / "node_modules" / ".bin" / name


def load_manifests(paths: SuitePaths) -> list[dict]:
    entries = []
    for mf in sorted(paths.carts.glob("*/cart.toml")):
        m = tomllib.loads(mf.read_text(encoding="utf-8"))
        m["_dir"] = mf.parent
        m["_manifest"] = mf
        entries.append(m)
    if not entries:
        sys.exit("no carts/*/cart.toml found")
    return entries


def wasm_for(m: dict, paths: SuitePaths) -> Path:
    return paths.build / f"{m['cart']['name']}.wasm"


# ── build ───────────────────────────────────────────────────────────────

def do_build(args, paths: SuitePaths | None = None) -> None:
    paths = paths or suite_paths(args.suite)
    if not asc_bin().exists():
        sh([npm_bin(), "ci", "--no-audit", "--no-fund"], cwd=ROOT)
    paths.build.mkdir(parents=True, exist_ok=True)
    commands: list[BuildCommand] = []
    for m in load_manifests(paths):
        entry = (m["_dir"] / m["cart"]["entry"]).resolve()
        commands.append(
            BuildCommand(
                m["cart"]["name"],
                [
                    str(asc_bin()),
                    str(entry),
                    "--outFile",
                    os.path.relpath(wasm_for(m, paths), ROOT),
                    "--optimize",
                ],
                ROOT,
            )
        )
    run_parallel_builds(commands, getattr(args, "jobs", None))


# ── runtime invocation (README "Runner invocation contract") ───────────

def runtime_cmd(args) -> tuple[list[str], str, str]:
    """Return (argv prefix, runtime label, dialect it implements)."""
    if args.runtime_cmd:
        argv = shlex.split(args.runtime_cmd)
        return argv, Path(argv[0]).name, args.abi
    sys.exit("need --runtime-cmd '<cmd>'")


def run_cart(
    prefix: list[str], m: dict, out: Path, paths: SuitePaths
) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    cmd = prefix + [
        "--cart", str(wasm_for(m, paths)),
        "--frames", str(m["run"]["frames"]),
        "--width", str(m["run"].get("width", 320)),
        "--height", str(m["run"].get("height", 240)),
        "--out", str(out),
    ]
    feed = m["run"].get("feed")
    if feed:
        cmd += ["--in", str(m["_dir"] / feed)]
    # System carts (ABI §4b): ask the runtime to link calyx.sys — part
    # of the runner invocation contract (README).
    if m["cart"].get("system"):
        cmd += ["--system"]
    sh(cmd)
    return out


# ── grading (README "How a runtime passes") ────────────────────────────

def grade(m: dict, out: Path) -> list[str]:
    """Return a list of failure strings; empty list = pass."""
    fails: list[str] = []
    status = json.loads((out / "status.json").read_text(encoding="utf-8"))
    exp = m["expected"]

    if "fault" in status:
        fails.append(f"run faulted: {status['fault']}")
    for key in ("run_hash", "final_hash"):
        if status.get(key) != exp[key]:
            fails.append(f"{key}: want {exp[key]}  got {status.get(key)}")
    got_pal = status.get("profile", {}).get("palette")
    if got_pal != exp["palette"]:
        fails.append(f"palette: want {exp['palette']}  got {got_pal}")

    got_color = status.get("profile", {}).get("color")
    if got_color != exp.get("color"):
        fails.append(f"color: want {exp.get('color')}  got {got_color}")

    lines = [json.loads(ln) for ln in
             (out / "frames.jsonl").read_text(encoding="utf-8").splitlines()]

    want_min = m.get("witness", {}).get("min_distinct_frame_hashes")
    if want_min is not None:
        distinct = len({ln["hash"] for ln in lines})
        if distinct < want_min:
            fails.append(
                f"vacuous golden: {distinct} distinct frame hashes "
                f"< witness minimum {want_min}")

    events_file = m["_dir"] / "events.golden.jsonl"
    if events_file.exists():
        want: dict[int, dict[str, list]] = {}
        for raw in events_file.read_text(encoding="utf-8").splitlines():
            event = json.loads(raw)
            want[event["f"]] = {
                "audio": event.get("audio", []),
                "sys": event.get("sys", []),
            }
        for ln in lines:
            expected = want.get(ln["f"], {"audio": [], "sys": []})
            for stream in ("audio", "sys"):
                got = ln.get(stream, [])
                if got != expected[stream]:
                    fails.append(
                        f"{stream} @f{ln['f']}: want {expected[stream]}  got {got}"
                    )
    return fails


def first_divergence(out: Path, m: dict) -> None:
    """Best-effort localization hint when run_hash drifts and a golden
    frames.jsonl is committed next to the manifest."""
    gold = m["_dir"] / "frames.golden.jsonl"
    if not gold.exists():
        return
    gl = (out / "frames.jsonl").read_text(encoding="utf-8").splitlines()
    wl = gold.read_text(encoding="utf-8").splitlines()
    for g_raw, w_raw in zip(gl, wl):
        g, w = json.loads(g_raw), json.loads(w_raw)
        if g["hash"] != w["hash"]:
            print(f"        first divergence at frame {g['f']}: "
                  f"want {w['hash']} got {g['hash']} "
                  f"trace={g.get('trace', [])}")
            return


def do_verify(args) -> None:
    paths = suite_paths(args.suite)
    prefix, label, dialect = runtime_cmd(args)
    do_build(args, paths)
    passed, failed, skipped = 0, 0, 0
    for m in load_manifests(paths):
        name = m["cart"]["name"]
        if "expected" not in m:
            print(f"SKIP  {name}: pending bless (no [expected])")
            skipped += 1
            continue
        if m["cart"]["abi"] != dialect:
            print(f"SKIP  {name}: dialect {m['cart']['abi']} != "
                  f"runtime's {dialect}")
            skipped += 1
            continue
        out = run_cart(prefix, m, paths.out / label / name, paths)
        fails = grade(m, out)
        if not fails:
            print(f"PASS  {name}: run_hash {m['expected']['run_hash']} "
                  f"({m['run']['frames']} frames)")
            passed += 1
        else:
            print(f"FAIL  {name}:")
            for f in fails:
                print(f"      {f}")
            first_divergence(out, m)
            failed += 1
    print(f"\n{label}: {passed} pass, {failed} fail, {skipped} skip")
    if failed:
        sys.exit(1)
    if not passed:
        print("nothing was gradable — that is not a pass")
        sys.exit(1)


# ── bless (T3+: write [expected] from a trusted runtime's run) ─────────

def do_bless(args) -> None:
    paths = suite_paths(args.suite)
    prefix, label, dialect = runtime_cmd(args)
    do_build(args, paths)
    targets = args.carts or None
    for m in load_manifests(paths):
        name = m["cart"]["name"]
        if targets and name not in targets:
            continue
        if m["cart"]["abi"] != dialect:
            print(f"skip {name}: dialect {m['cart']['abi']} != {dialect}")
            continue
        out = run_cart(prefix, m, paths.out / label / name, paths)
        status = json.loads((out / "status.json").read_text(encoding="utf-8"))
        if "fault" in status:
            sys.exit(f"refusing to bless {name}: run faulted "
                     f"{status['fault']}")
        block = (
            "\n[expected]\n"
            f"run_hash = \"{status['run_hash']}\"\n"
            f"final_hash = \"{status['final_hash']}\"\n"
            f"palette = \"{status['profile']['palette']}\"\n"
            f"blessed_by = \"{args.bless_as or label}\"\n"
        )
        if color := status["profile"].get("color"):
            block += f'color = "{color}"\n'
        text = m["_manifest"].read_text(encoding="utf-8")
        if "[expected]" in text:
            text = text[: text.index("[expected]")].rstrip() + "\n" + block
        else:
            text = text.rstrip() + "\n" + block
        m["_manifest"].write_text(text, encoding="utf-8")
        shutil.copy(out / "frames.jsonl", m["_dir"] / "frames.golden.jsonl")
        print(f"blessed {name}: run_hash {status['run_hash']} "
              f"(by {args.bless_as or label})")


def do_list(args) -> None:
    for m in load_manifests(suite_paths(args.suite)):
        c, name = m["cart"], m["cart"]["name"]
        exp = m.get("expected")
        state = (f"blessed by {exp['blessed_by']}, run_hash {exp['run_hash']}"
                 if exp else "pending bless")
        print(f"{name:12} {c['abi']:13} {m['run']['frames']:>4}f  {state}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Calyx conformance runner")
    p.add_argument(
        "--suite",
        type=Path,
        default=ROOT,
        metavar="PATH",
        help="conformance suite root (default: public conformance directory)",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_runtime(sp):
        sp.add_argument("--runtime-cmd", default=None)
        sp.add_argument("--abi", default="v1",
                        help="dialect a --runtime-cmd runtime implements")

    def add_build_options(sp):
        sp.add_argument(
            "--jobs",
            type=positive_jobs,
            default=None,
            metavar="N",
            help=(
                "parallel cart compiles (default: min(CPU count, 4); "
                f"{BUILD_JOBS_ENV} also supported)"
            ),
        )

    sp = sub.add_parser("build")
    add_build_options(sp)
    sp.set_defaults(func=do_build)
    sub.add_parser("list").set_defaults(func=do_list)
    sp = sub.add_parser("verify")
    add_runtime(sp)
    add_build_options(sp)
    sp.set_defaults(func=do_verify)
    sp = sub.add_parser("bless")
    add_runtime(sp)
    add_build_options(sp)
    sp.add_argument("carts", nargs="*")
    sp.add_argument("--as", dest="bless_as", default=None,
                    help="provenance label written to blessed_by")
    sp.set_defaults(func=do_bless)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
