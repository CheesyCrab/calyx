#!/usr/bin/env python3
"""Prepare a verified release web archive for GitHub Pages without rebuilding."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def prepare(archive: Path, out: Path, revision: str) -> None:
    if not re.fullmatch(r"calyx-web-rc-[0-9a-f]{16}\.tar\.gz", archive.name):
        raise ValueError("expected a release web archive filename")
    archive_root = archive.name.removesuffix(".tar.gz")
    if not re.fullmatch(r"[0-9a-f]{40,64}", revision):
        raise ValueError("expected a full source commit ID")
    if out.exists():
        raise ValueError("output directory already exists")
    checksum = archive.with_suffix(archive.suffix + ".sha256").read_text().split()
    if checksum != [digest(archive.read_bytes()), archive.name]:
        raise ValueError("archive checksum or filename does not match")
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="calyx-pages-", dir=out.parent) as tmp:
        staging = Path(tmp) / "site"
        staging.mkdir()
        names: set[str] = set()
        total = 0
        with tarfile.open(archive, "r:gz") as source:
            for member in source:
                path = PurePosixPath(member.name)
                if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                        or not path.parts or path.parts[0] != archive_root
                        or not (member.isfile() or member.isdir())):
                    raise ValueError("unsafe or unexpected archive member")
                name = path.as_posix()
                if name in names:
                    raise ValueError("duplicate archive member")
                names.add(name)
                total += member.size
                if len(names) > 10_000 or total > 256 * 1024 * 1024:
                    raise ValueError("web archive exceeds deployment limits")
                target = staging.joinpath(*path.parts[1:])
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    stream = source.extractfile(member)
                    if stream is None:
                        raise ValueError("missing archive file bytes")
                    target.write_bytes(stream.read())
        descriptor = json.loads((staging / "release.json").read_text())
        if (descriptor.get("schema") != 1 or descriptor.get("channel") != "stable"
                or descriptor.get("product") != "Cheesy Crab Calyx"
                or descriptor.get("source_local") is not False
                or descriptor.get("source_revision") != revision):
            raise ValueError("payload is not a clean release build of the selected tag")
        files = []
        for path in sorted(staging.rglob("*")):
            if path.is_file() and path != staging / "release.json":
                data = path.read_bytes()
                files.append({"path": path.relative_to(staging).as_posix(),
                              "bytes": len(data), "sha256": digest(data)})
        encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
        if files != descriptor.get("files") or digest(encoded) != descriptor.get("payload_id"):
            raise ValueError("payload inventory or content hash does not match")
        if not (staging / "index.html").is_file():
            raise ValueError("payload has no index.html")
        staging.rename(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    try:
        prepare(args.archive, args.out, args.revision)
    except (ValueError, OSError, tarfile.TarError) as error:
        parser.exit(1, f"pages payload: {error}\n")
    print(f"pages payload: verified {args.out}")


if __name__ == "__main__":
    main()
