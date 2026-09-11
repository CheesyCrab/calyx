"""Small atomic filesystem lock for Calyx product build/deploy operations."""

from __future__ import annotations

import json
import os
import socket
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


@contextmanager
def operation_lock(path: Path, operation: str) -> Iterator[None]:
    """Hold ``path`` until the operation finishes; never guess that it is stale."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.mkdir()
    except FileExistsError:
        owner_path = path / "owner.json"
        try:
            owner = json.loads(owner_path.read_text(encoding="utf-8"))
            detail = (
                f"operation={owner.get('operation', '?')} "
                f"pid={owner.get('pid', '?')} "
                f"host={owner.get('host', '?')} "
                f"started_at={owner.get('started_at', '?')}"
            )
        except (OSError, ValueError):
            detail = "owner record unavailable"
        raise SystemExit(f"Calyx operation lock is held: {path} ({detail})") from None

    owner_path = path / "owner.json"
    try:
        owner_path.write_text(
            json.dumps(
                {
                    "operation": operation,
                    "pid": os.getpid(),
                    "host": socket.gethostname(),
                    "started_at": datetime.now(timezone.utc).isoformat(),
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        yield
    finally:
        owner_path.unlink(missing_ok=True)
        path.rmdir()
