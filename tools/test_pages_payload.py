from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

import pages_payload


class PagesPayloadTests(unittest.TestCase):
    revision = "a" * 40

    def archive(self, root: Path, *, revision=None, local=False, extra=None, corrupt=False):
        content = b"<html>Calyx</html>"
        files = [{"path": "index.html", "bytes": len(content),
                  "sha256": hashlib.sha256(content).hexdigest()}]
        descriptor = {
            "schema": 1, "channel": "stable", "product": "Cheesy Crab Calyx",
            "source_revision": revision or self.revision, "source_local": local,
            "files": files,
            "payload_id": hashlib.sha256(json.dumps(
                files, sort_keys=True, separators=(",", ":")
            ).encode()).hexdigest(),
        }
        entries = {"calyx-web-rc-0123456789abcdef/index.html": b"tampered" if corrupt else content,
                   "calyx-web-rc-0123456789abcdef/release.json": json.dumps(descriptor).encode()}
        if extra:
            entries[extra] = b"unexpected"
        archive = root / "calyx-web-rc-0123456789abcdef.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            for name, data in entries.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                output.addfile(info, io.BytesIO(data))
        archive.with_suffix(archive.suffix + ".sha256").write_text(
            f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n"
        )
        return archive

    def test_promotes_verified_bytes_without_rebuilding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = self.archive(root)
            pages_payload.prepare(archive, root / "site", self.revision)
            self.assertEqual((root / "site/index.html").read_bytes(), b"<html>Calyx</html>")

    def test_refuses_wrong_revision_local_build_tampering_and_extra_files(self):
        for kwargs in [dict(revision="b" * 40), dict(local=True), dict(corrupt=True),
                       dict(extra="calyx-web-rc-0123456789abcdef/extra.js"), dict(extra="calyx-web-rc-0123456789abcdef/nested/release.json"), dict(extra="../escape")]:
            with self.subTest(kwargs=kwargs), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                archive = self.archive(root, **kwargs)
                with self.assertRaises(ValueError):
                    pages_payload.prepare(archive, root / "site", self.revision)
                self.assertFalse((root / "site").exists())
                self.assertFalse((root / "escape").exists())

    def test_refuses_bad_archive_checksum(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = self.archive(root)
            archive.with_suffix(archive.suffix + ".sha256").write_text("0" * 64)
            with self.assertRaises(ValueError):
                pages_payload.prepare(archive, root / "site", self.revision)


if __name__ == "__main__":
    unittest.main()
