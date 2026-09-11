#!/usr/bin/env python3
"""Assemble and verify the Cheesy Crab Calyx Flatpak release candidate."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from xml.sax.saxutils import escape


APP_ID = "org.cheesycrab.Calyx"
PRODUCT_NAME = "Cheesy Crab Calyx"
PUBLISHER = "Cheesy Crab"
RUNTIME = "org.freedesktop.Platform"
SDK = "org.freedesktop.Sdk"
RUNTIME_VERSION = "25.08"
ARCH = "x86_64"
BRANCH = "stable"
PRODUCT_ROOT = Path("/app/lib/calyx")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _inventory(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise SystemExit(f"{path}: Flatpak product input may not contain symlinks")
        if path.is_file():
            payload = path.read_bytes()
            entries.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "bytes": len(payload),
                    "sha256": _sha256(payload),
                }
            )
    return entries


def _catalog_manifest(catalog: Path) -> dict[str, Any]:
    path = catalog / ".calyx-catalog.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"{path}: invalid release catalog manifest: {exc}") from None
    if value.get("profile") != "release":
        raise SystemExit(f"{path}: Flatpak requires the curated release catalog")
    if not isinstance(value.get("carts"), list) or not value["carts"]:
        raise SystemExit(f"{path}: release catalog has no carts")
    return value


def _desktop_entry() -> str:
    return (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=Calyx\n"
        "Comment=Play the Cheesy Crab Calyx fantasy console\n"
        f"Exec={APP_ID}\n"
        f"Icon={APP_ID}\n"
        "Terminal=false\n"
        "Categories=Game;\n"
        "Keywords=game;fantasy console;pixel art;\n"
        "StartupNotify=true\n"
    )


def _metainfo(product_version: str, built_at: str) -> str:
    try:
        date = datetime.fromisoformat(built_at.replace("Z", "+00:00")).date().isoformat()
    except (TypeError, ValueError):
        date = "2026-08-22"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>{APP_ID}</id>
  <name>Calyx</name>
  <summary>Play the Cheesy Crab Calyx fantasy console</summary>
  <developer id="org.cheesycrab">
    <name>Cheesy Crab</name>
  </developer>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>LGPL-3.0-or-later</project_license>
  <description>
    <p>Calyx is a deterministic fantasy console with a curated catalog of pixel games. It provides one consistent player for keyboard and controller play.</p>
  </description>
  <launchable type="desktop-id">{APP_ID}.desktop</launchable>
  <provides>
    <binary>{APP_ID}</binary>
  </provides>
  <categories>
    <category>Game</category>
  </categories>
  <releases>
    <release version="{escape(product_version)}" date="{date}" type="development"/>
  </releases>
</component>
"""


def stage_flatpak_input(
    *,
    root: Path,
    catalog: Path,
    out: Path,
    build_info: dict[str, Any],
    product_version: str,
    abi_version: str,
    license_writer: Callable[[Path, Path], None],
) -> dict[str, Any]:
    """Stage immutable product data consumed by the Flatpak SDK build."""
    if build_info.get("source_local") is not False:
        raise SystemExit("release Flatpak input requires clean committed source")
    manifest = _catalog_manifest(catalog)
    if out.exists():
        shutil.rmtree(out)
    product = out / "product"
    integration = out / "integration"
    integration.mkdir(parents=True)
    shutil.copytree(catalog, product / "catalog")

    controller_db = root / "gamecontrollerdb.txt"
    if controller_db.is_file():
        shutil.copy2(controller_db, product / controller_db.name)
    license_writer(product, product / "catalog")
    required = ("LICENSE.md", "NOTICES.txt", "SOURCE.txt")
    missing = [name for name in required if not (product / name).is_file()]
    if missing:
        raise SystemExit("Flatpak license spine is incomplete: " + ", ".join(missing))

    catalog_files = _inventory(product / "catalog")
    descriptor = {
        "schema": 1,
        "product": PRODUCT_NAME,
        "publisher": PUBLISHER,
        "profile": "release",
        "status": "release candidate",
        "version": product_version,
        "abi": abi_version,
        "app_id": APP_ID,
        "arch": ARCH,
        "runtime": f"{RUNTIME}//{RUNTIME_VERSION}",
        "branch": BRANCH,
        "catalog": manifest["carts"],
        "catalog_payload_id": _sha256(_canonical_json(catalog_files)),
        **build_info,
    }
    product.mkdir(parents=True, exist_ok=True)
    (product / "package.json").write_bytes(_canonical_json(descriptor) + b"\n")
    (product / "PLAYING.txt").write_text(
        f"Calyx {product_version} release candidate\n\n"
        "Launch Calyx from the application menu.\n"
        "Keyboard: arrows/WASD move, Z=A, X=B, Enter=Start, Backspace=home, Escape=quit.\n",
        encoding="utf-8",
        newline="\n",
    )
    (product / "RELEASE_NOTES.txt").write_text(
        f"Calyx {product_version} release candidate\n"
        f"Implements Calyx ABI {abi_version}.\n"
        "A Cheesy Crab project.\n",
        encoding="utf-8",
        newline="\n",
    )

    icon = root / "assets" / "brand" / "calyx-mark.svg"
    if not icon.is_file():
        raise SystemExit(f"{icon}: canonical Calyx mark is missing")
    shutil.copy2(icon, integration / f"{APP_ID}.svg")
    (integration / f"{APP_ID}.desktop").write_text(
        _desktop_entry(), encoding="utf-8", newline="\n"
    )
    (integration / f"{APP_ID}.metainfo.xml").write_text(
        _metainfo(product_version, str(build_info.get("built_at", ""))),
        encoding="utf-8",
        newline="\n",
    )
    validate_flatpak_input(out, descriptor)
    return descriptor


def validate_flatpak_input(
    out: Path,
    descriptor: dict[str, Any] | None = None,
    *,
    forbidden_tokens: tuple[bytes | str, ...] = (),
) -> None:
    product = out / "product"
    integration = out / "integration"
    if descriptor is None:
        try:
            descriptor = json.loads((product / "package.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Flatpak package descriptor is invalid: {exc}") from None
    if descriptor.get("app_id") != APP_ID:
        raise SystemExit("Flatpak package descriptor app ID mismatch")
    if (
        descriptor.get("product") != PRODUCT_NAME
        or descriptor.get("publisher") != PUBLISHER
    ):
        raise SystemExit("Flatpak package descriptor product metadata mismatch")
    expected = [
        integration / f"{APP_ID}.desktop",
        integration / f"{APP_ID}.metainfo.xml",
        integration / f"{APP_ID}.svg",
        product / "catalog" / ".calyx-catalog.json",
    ]
    missing = [str(path) for path in expected if not path.is_file()]
    if missing:
        raise SystemExit("Flatpak product input is incomplete: " + ", ".join(missing))
    desktop = expected[0].read_text(encoding="utf-8")
    if f"Exec={APP_ID}\n" not in desktop or f"Icon={APP_ID}\n" not in desktop:
        raise SystemExit("Flatpak desktop entry does not match the application ID")
    metainfo = expected[1].read_text(encoding="utf-8")
    if f"<id>{APP_ID}</id>" not in metainfo:
        raise SystemExit("Flatpak AppStream metadata does not match the application ID")
    folded_tokens = tuple(
        token.encode("utf-8").lower() if isinstance(token, str) else token.lower()
        for token in forbidden_tokens
    )
    home_path = re.compile(
        rb"(?:/(?:users|home)/[^/\\\s]+|"
        rb"[a-z]:[/\\]users[/\\][^/\\\s]+)(?:[/\\]|(?=\s|$))",
        re.IGNORECASE,
    )
    secret_assignment = re.compile(
        rb"(?<![a-z0-9])(?:[a-z0-9]+[_-])*"
        rb"(?:api[_-]?key|access[_-]?token|secret(?:[_-]access)?[_-]?key|"
        rb"secret|password)(?![a-z0-9])\s*[:=]\s*"
        rb'(?:"[^"\r\n]*"|\'[^\'\r\n]*\'|[^\s"\']+)',
        re.IGNORECASE,
    )
    for path in sorted(out.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(out).as_posix().encode("utf-8").lower()
        payload = path.read_bytes().lower()
        if any(token in relative or token in payload for token in folded_tokens):
            raise SystemExit(
                f"{path}: Flatpak product input contains forbidden identity"
            )
        if home_path.search(relative) or home_path.search(payload):
            raise SystemExit(f"{path}: Flatpak product input contains absolute home path")
        if secret_assignment.search(payload):
            raise SystemExit(f"{path}: Flatpak product input contains secret assignment")


def write_flatpak_evidence(
    *,
    bundle: Path,
    descriptor: dict[str, Any],
    installed: dict[str, str],
    checks: list[str],
) -> Path:
    payload = bundle.read_bytes()
    digest = _sha256(payload)
    checksum = Path(f"{bundle}.sha256")
    checksum.write_text(
        f"{digest}  {bundle.name}\n", encoding="ascii", newline="\n"
    )
    receipt = {
        "schema": 1,
        "scope": "flatpak-installed-package",
        "contract": "calyx-flatpak-package-v1",
        "app_id": descriptor["app_id"],
        "version": descriptor["version"],
        "abi": descriptor["abi"],
        "source_revision": descriptor["source_revision"],
        "catalog_payload_id": descriptor["catalog_payload_id"],
        "bundle": {
            "name": bundle.name,
            "sha256": digest,
            "bytes": len(payload),
        },
        "flatpak": installed,
        "checks": checks,
        "verified_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    receipt_path = Path(f"{bundle}.verification.json")
    receipt_path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return receipt_path


def validate_installed_contract(*, metadata: str, installed_ref: str) -> None:
    expected_ref = f"app/{APP_ID}/{ARCH}/{BRANCH}"
    if installed_ref.strip() != expected_ref:
        raise SystemExit(
            f"Flatpak installed ref mismatch: expected {expected_ref}, got {installed_ref.strip()}"
        )
    required_text = (
        f"name={APP_ID}",
        f"runtime={RUNTIME}/{ARCH}/{RUNTIME_VERSION}",
        f"command={APP_ID}",
        "ipc",
        "wayland",
        "fallback-x11",
        "pulseaudio",
        "dri",
        "input",
        "all",
        "has-input-device",
    )
    for value in required_text:
        if value not in metadata:
            raise SystemExit(f"Flatpak installed metadata is missing {value}")
    forbidden = ("network", "filesystems=host", "filesystems=home")
    for value in forbidden:
        if value in metadata:
            raise SystemExit(f"Flatpak installed metadata unexpectedly grants {value}")


def _run(
    command: list[str],
    label: str,
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command, check=True, capture_output=True, text=True, env=env
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        raise SystemExit(f"Flatpak {label} failed: {detail.strip()}") from None


def installed_runtime_commit(runtime_ref: str, env: dict[str, str]) -> str:
    """Read the runtime commit from whichever installation Flatpak resolves."""
    return _run(
        ["flatpak", "info", "--show-commit", runtime_ref],
        "runtime commit inspection",
        env=env,
    ).stdout.strip()


def verify_flatpak_bundle(bundle: Path, input_root: Path) -> Path:
    """Install and execute a built bundle, then write hash-bound evidence."""
    bundle = bundle.resolve()
    validate_flatpak_input(input_root)
    descriptor = json.loads(
        (input_root / "product" / "package.json").read_text(encoding="utf-8")
    )
    if not bundle.is_file():
        raise SystemExit(f"{bundle}: Flatpak bundle is missing")

    with tempfile.TemporaryDirectory(prefix=".calyx-flatpak-verify-", dir=bundle.parent) as raw:
        work = Path(raw)
        user_dir = work / "user"
        status_dir = work / "status"
        status_dir.mkdir()
        env = {**os.environ, "FLATPAK_USER_DIR": str(user_dir)}
        _run(
            ["flatpak", "install", "--user", "--noninteractive", str(bundle)],
            "fresh install",
            env=env,
        )
        installed_ref = _run(
            ["flatpak", "info", "--user", "--show-ref", APP_ID],
            "installed ref inspection",
            env=env,
        ).stdout.strip()
        metadata = _run(
            ["flatpak", "info", "--user", "--show-metadata", APP_ID],
            "installed metadata inspection",
            env=env,
        ).stdout
        validate_installed_contract(metadata=metadata, installed_ref=installed_ref)
        version = _run(
            ["flatpak", "run", "--user", APP_ID, "--version"],
            "version check",
            env=env,
        )
        if descriptor["version"] not in version.stdout or descriptor["abi"] not in version.stdout:
            raise SystemExit("Flatpak version output does not match package descriptor")

        _run(
            [
                "flatpak", "run", "--user", f"--filesystem={status_dir}",
                APP_ID, "console", "--carts", str(PRODUCT_ROOT / "catalog"),
                "--present", "headless", "--frames", "100", "--out", str(status_dir),
            ],
            "boot-to-launcher check",
            env=env,
        )
        status = json.loads((status_dir / "status.json").read_text(encoding="utf-8"))
        app_info = _run(
            ["flatpak", "info", "--user", "--show-commit", APP_ID],
            "app commit inspection",
            env=env,
        ).stdout.strip()
        runtime_ref = f"{RUNTIME}/{ARCH}/{RUNTIME_VERSION}"
        runtime_info = installed_runtime_commit(runtime_ref, env)
    expected = {
        "mode": "console",
        "frames_run": 100,
        "initial_role": "boot",
        "swaps": 1,
        "final_role": "launcher",
    }
    if any(status.get(key) != value for key, value in expected.items()):
        raise SystemExit(f"Flatpak boot-to-launcher check failed: {status}")

    sdk_commit = _run(
        ["flatpak", "info", "--show-commit", f"{SDK}//{RUNTIME_VERSION}"],
        "SDK commit inspection",
    ).stdout.strip()
    rust_extension_commit = _run(
        [
            "flatpak", "info", "--show-commit",
            f"org.freedesktop.Sdk.Extension.rust-stable//{RUNTIME_VERSION}",
        ],
        "Rust extension commit inspection",
    ).stdout.strip()
    return write_flatpak_evidence(
        bundle=bundle,
        descriptor=descriptor,
        installed={
            "app_commit": app_info,
            "runtime_commit": runtime_info,
            "runtime": runtime_ref,
            "sdk_commit": sdk_commit,
            "rust_extension_commit": rust_extension_commit,
            "branch": BRANCH,
        },
        checks=[
            "bundle-import-v1",
            "fresh-user-install-v1",
            "version-identity-v1",
            "boot-to-launcher-v1",
        ],
    )
