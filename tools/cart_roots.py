"""Resolve and discover public plus explicitly supplied cart roots."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping, Sequence


def resolve_cart_roots(
    public_root: Path,
    cli_roots: Sequence[Path],
    environ: Mapping[str, str],
) -> list[Path]:
    requested = list(cli_roots)
    if raw := environ.get("CALYX_EXTRA_CART_ROOTS"):
        requested.extend(Path(item) for item in raw.split(os.pathsep) if item)
    roots = [public_root.resolve()]
    for requested_root in requested:
        root = requested_root.resolve()
        if not root.is_dir():
            raise ValueError(f"cart root does not exist: {root}")
        if root not in roots:
            roots.append(root)
    return roots


def discover_cart_manifests(roots: Sequence[Path]) -> list[Path]:
    manifests = sorted(
        (
            manifest
            for root in roots
            for pattern in ("*/cart.toml", "*/*/cart.toml")
            for manifest in root.glob(pattern)
            if manifest.relative_to(root).parts[0] != ".local"
        ),
        key=lambda path: (path.parent.name, path.as_posix()),
    )
    by_slug: dict[str, Path] = {}
    for manifest in manifests:
        slug = manifest.parent.name
        if slug in by_slug:
            raise ValueError(
                f"duplicate cart slug {slug!r}: {by_slug[slug]} and {manifest}"
            )
        by_slug[slug] = manifest
    return manifests
