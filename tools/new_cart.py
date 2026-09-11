#!/usr/bin/env python3
"""Create a flat first-party Sunny cart from the hello-sunny example."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "carts" / "examples" / "hello-sunny"
SLUG = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def display_name(slug: str) -> str:
    return " ".join(part.capitalize() for part in slug.split("-"))


def toml_string(value: str) -> str:
    # TOML accepts Unicode scalars, not JSON's escaped UTF-16 surrogate pairs.
    # DEL must still be escaped: TOML forbids it inside a basic string.
    return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")


def create_cart(
    root: Path,
    template: Path,
    slug: str,
    name: str,
    author: str,
    category: str,
    license_name: str = "GPL-3.0-or-later",
) -> Path:
    if not SLUG.fullmatch(slug):
        raise ValueError("slug must be lowercase kebab-case, for example my-first-cart")
    destination = root / "carts" / slug
    if destination.exists():
        raise FileExistsError(f"destination already exists: {destination}")
    for label, value, limit in (
        ("name", name, 63),
        ("author", author, 63),
        ("category", category, 31),
    ):
        size = len(value.encode("utf-8"))
        if not value.strip():
            raise ValueError(f"{label} must not be empty")
        if size > limit:
            raise ValueError(f"{label} exceeds the {limit}-byte ABI cap")
    if not license_name.strip():
        raise ValueError("license must not be empty")

    source = (template / "cart.ts").read_text(encoding="utf-8")
    nested_import = 'from "../../../sdk/assembly/index"'
    title_marker = 'const TITLE = "HELLO SUNNY";'
    if nested_import not in source or title_marker not in source:
        raise RuntimeError("hello-sunny template markers have drifted")
    source = source.replace(
        nested_import,
        'from "../../sdk/assembly/index"',
    )
    source = source.replace(title_marker, f"const TITLE = {json.dumps(name.upper())};")
    destination.mkdir(parents=True)
    (destination / "cart.ts").write_text(source, encoding="utf-8")

    manifest = "\n".join(
        [
            "[cart]",
            f"name = {toml_string(name)}",
            f"author = {toml_string(author)}",
            f"license = {toml_string(license_name)}",
            'version = "0.1.0"',
            'entry = "cart.ts"',
            'abi = "v1"',
            f"category = {toml_string(category)}",
            "public_source = false",
            "",
        ]
    )
    (destination / "cart.toml").write_text(manifest, encoding="utf-8")

    package = {
        "name": f"@cheesycrab/cart-{slug}",
        "version": "0.1.0",
        "private": True,
        "license": license_name,
        "description": f"Sunny cart: {name}.",
        "type": "module",
        "scripts": {
            "build": (
                "asc cart.ts --outFile cart.wasm --optimize --maximumMemory 1024"
            )
        },
        "devDependencies": {"assemblyscript": "0.28.20"},
    }
    (destination / "package.json").write_text(
        json.dumps(package, indent=2) + "\n", encoding="utf-8"
    )
    shutil.copy2(template / ".gitignore", destination / ".gitignore")
    return destination


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("slug", help="lowercase kebab-case directory/package identity")
    p.add_argument("--name", help="launcher display name (defaults from slug)")
    p.add_argument("--author", default="Your Name")
    p.add_argument(
        "--license",
        default="GPL-3.0-or-later",
        help="SPDX license for the whole cart (author-selected)",
    )
    p.add_argument("--category", default="Games")
    return p


def main() -> None:
    args = parser().parse_args()
    name = args.name or display_name(args.slug)
    try:
        destination = create_cart(
            ROOT,
            TEMPLATE,
            args.slug,
            name,
            args.author,
            args.category,
            args.license,
        )
    except (ValueError, FileExistsError) as error:
        raise SystemExit(str(error)) from error
    print(f"created {destination.relative_to(ROOT)}")
    print(
        f"next: npm install --prefix {destination.relative_to(ROOT)} --no-audit --no-fund"
    )
    print(f"then: npm run --prefix {destination.relative_to(ROOT)} build")


if __name__ == "__main__":
    main()
