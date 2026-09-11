#!/usr/bin/env python3
"""Fail-closed native package target and binary verification helpers."""

from __future__ import annotations

import os
import hashlib
import json
import gzip
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, NamedTuple


class NativeTarget(NamedTuple):
    rust: str
    platform: str
    arch: str
    label: str
    executable: str
    archive: str
    machine: int


class NativeLayout(NamedTuple):
    archive_root: Path
    payload_root: Path
    executable: Path
    catalog: Path
    icon: Path | None


class NativePackageInputs(NamedTuple):
    root: Path
    profile: str
    target: str
    sdl_link: str
    max_glibc: str | None
    binary: Path
    catalog: Path
    out: Path
    build_info: dict[str, Any]
    product_version: str
    abi_version: str


class NativePackageResult(NamedTuple):
    package: Path
    archive: Path
    checksum: Path
    descriptor: dict[str, Any]


class BinaryFacts(NamedTuple):
    sdl_link: str
    glibc_required_max: str | None


class VerifiedNativeArchive(NamedTuple):
    archive_sha256: str
    archive_bytes: int
    layout: NativeLayout
    descriptor: dict[str, Any]
    spec: NativeTarget
    binary_facts: BinaryFacts


TARGETS = {
    "x86_64-unknown-linux-gnu": NativeTarget(
        "x86_64-unknown-linux-gnu", "linux", "x86_64", "linux-x86_64", "calyx", "tar.gz", 62
    ),
    "aarch64-unknown-linux-gnu": NativeTarget(
        "aarch64-unknown-linux-gnu", "linux", "aarch64", "linux-aarch64", "calyx", "tar.gz", 183
    ),
    "x86_64-unknown-linux-musl": NativeTarget(
        "x86_64-unknown-linux-musl", "linux", "x86_64", "linux-x86_64", "calyx", "tar.gz", 62
    ),
    "aarch64-unknown-linux-musl": NativeTarget(
        "aarch64-unknown-linux-musl", "linux", "aarch64", "linux-aarch64", "calyx", "tar.gz", 183
    ),
    "x86_64-pc-windows-msvc": NativeTarget(
        "x86_64-pc-windows-msvc", "windows", "x86_64", "windows-x86_64", "calyx.exe", "zip", 0x8664
    ),
    "aarch64-apple-darwin": NativeTarget(
        "aarch64-apple-darwin", "macos", "arm64", "macos-arm64", "calyx", "zip", 0x0100000C
    ),
}

MAX_ARCHIVE_MEMBERS = 20_000
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024


def target_spec(target: str) -> NativeTarget:
    try:
        return TARGETS[target]
    except KeyError:
        supported = ", ".join(sorted(TARGETS))
        raise SystemExit(
            f"unsupported native target {target!r}; expected one of: {supported}"
        ) from None


def native_target_label(target: str) -> str:
    return target_spec(target).label


def native_binary_path(
    root: Path,
    target: str | None,
    environ: Mapping[str, str] | None = None,
) -> Path:
    selected_env = os.environ if environ is None else environ
    configured = Path(selected_env.get("CARGO_TARGET_DIR", "target"))
    target_dir = configured if configured.is_absolute() else root / configured
    if target:
        target_dir /= target
        executable = target_spec(target).executable
    else:
        executable = "calyx.exe" if os.name == "nt" else "calyx"
    return target_dir / "release" / executable


def verify_native_icons(root: Path) -> None:
    manifest_path = root / "assets" / "brand" / "native" / "icon-source.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"{manifest_path}: native icon manifest unavailable: {exc}") from None
    if manifest.get("schema") != 1:
        raise SystemExit(f"{manifest_path}: unsupported native icon manifest schema")
    products = manifest.get("products")
    if not isinstance(products, dict) or set(products) != {"release", "sideb"}:
        raise SystemExit(f"{manifest_path}: native icon products must be release and sideb")
    for product in products.values():
        source = product.get("source", {})
        source_path = root / str(source.get("path", ""))
        try:
            source_digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        except OSError as exc:
            raise SystemExit(f"{source_path}: native icon source unavailable: {exc}") from None
        if source_digest != source.get("sha256"):
            raise SystemExit(f"{source_path}: native icon source drift")
        outputs = product.get("outputs")
        if not isinstance(outputs, list) or len(outputs) != 2:
            raise SystemExit(f"{manifest_path}: native icon outputs are incomplete")
        for output in outputs:
            output_path = root / str(output.get("path", ""))
            try:
                payload = output_path.read_bytes()
            except OSError as exc:
                raise SystemExit(f"{output_path}: native icon unavailable: {exc}") from None
            if len(payload) != output.get("bytes"):
                raise SystemExit(f"{output_path}: native icon byte length drift")
            if hashlib.sha256(payload).hexdigest() != output.get("sha256"):
                raise SystemExit(f"{output_path}: native icon output drift")


def stage_layout(
    staging: Path,
    spec: NativeTarget,
    product: str,
    binary: Path,
    catalog: Path,
) -> NativeLayout:
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    sideb = product == "Calyx Side B"
    if spec.platform == "macos":
        archive_root = staging / f"{product}.app"
        contents = archive_root / "Contents"
        executable = contents / "MacOS" / spec.executable
        payload_root = contents / "Resources"
        installed_catalog = payload_root / "catalog"
        icon_name = "Calyx-Side-B" if sideb else "Calyx"
        icon = payload_root / f"{icon_name}.icns"
        executable.parent.mkdir(parents=True)
        payload_root.mkdir(parents=True)
        bundle_id = "games.cheesycrab.calyx.sideb" if sideb else "games.cheesycrab.calyx"
        plist = {
            "CFBundleDevelopmentRegion": "en",
            "CFBundleDisplayName": product,
            "CFBundleExecutable": spec.executable,
            "CFBundleIconFile": icon_name,
            "CFBundleIdentifier": bundle_id,
            "CFBundleInfoDictionaryVersion": "6.0",
            "CFBundleName": product,
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1.0.0",
            "LSMinimumSystemVersion": "11.0",
            "NSHighResolutionCapable": True,
        }
        with (contents / "Info.plist").open("wb") as handle:
            plistlib.dump(plist, handle, sort_keys=True)
    else:
        archive_root = staging / product
        payload_root = archive_root
        executable = archive_root / spec.executable
        installed_catalog = archive_root / "catalog"
        icon = None
        archive_root.mkdir(parents=True)
    shutil.copy2(binary, executable)
    executable.chmod(0o755)
    shutil.copytree(catalog, installed_catalog)
    return NativeLayout(
        archive_root,
        payload_root,
        executable,
        installed_catalog,
        icon,
    )


def deterministic_zip(source: Path, archive: Path) -> None:
    """Write a stable ZIP with fixed timestamps and explicit Unix modes."""
    archive.parent.mkdir(parents=True, exist_ok=True)
    paths = [source, *sorted(source.rglob("*"), key=lambda path: path.as_posix())]
    with zipfile.ZipFile(
        archive,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as zipped:
        for path in paths:
            if path.is_symlink():
                raise SystemExit(f"{path}: native package may not contain symlinks")
            relative = path.relative_to(source.parent).as_posix()
            is_dir = path.is_dir()
            if is_dir:
                relative += "/"
            mode = (stat.S_IFDIR | 0o755) if is_dir else (
                stat.S_IFREG | (path.stat().st_mode & 0o777)
            )
            info = zipfile.ZipInfo(relative, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = mode << 16
            if is_dir:
                info.external_attr |= 0x10
                zipped.writestr(info, b"")
            else:
                zipped.writestr(info, path.read_bytes())


def deterministic_tar_gz(source: Path, archive: Path) -> None:
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    with archive.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=epoch) as zipped:
            with tarfile.open(fileobj=zipped, mode="w") as tar:
                paths = [source, *sorted(source.rglob("*"), key=lambda path: path.as_posix())]
                for path in paths:
                    if path.is_symlink():
                        raise SystemExit(f"{path}: native package may not contain symlinks")
                    relative = path.relative_to(source.parent)
                    info = tar.gettarinfo(str(path), arcname=str(relative))
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = epoch
                    if path.is_file():
                        with path.open("rb") as handle:
                            tar.addfile(info, handle)
                    else:
                        tar.addfile(info)


def extract_native_archive(
    archive: Path,
    destination: Path,
    spec: NativeTarget,
) -> Path:
    """Safely extract a deterministic native archive and restore Unix modes."""
    destination.mkdir(parents=True, exist_ok=True)
    resolved_destination = destination.resolve()
    roots: set[str] = set()
    seen: set[str] = set()
    expanded_bytes = 0

    def parts_for(name: str) -> tuple[str, ...]:
        if (
            not name
            or "\\" in name
            or name.startswith("/")
            or re.match(r"^[A-Za-z]:", name)
        ):
            raise SystemExit(f"{archive}: unsafe archive path {name!r}")
        parts = Path(name).parts
        if not parts or ".." in parts or "." in parts:
            raise SystemExit(f"{archive}: unsafe archive path {name!r}")
        canonical = "/".join(parts)
        if canonical in seen:
            raise SystemExit(f"{archive}: duplicate archive path {name!r}")
        seen.add(canonical)
        return parts

    if spec.archive == "tar.gz":
        with tarfile.open(archive, "r:gz") as tar:
            members = tar.getmembers()
            if len(members) > MAX_ARCHIVE_MEMBERS:
                raise SystemExit(f"{archive}: archive has too many members")
            for member in members:
                parts = parts_for(member.name)
                if member.issym() or member.islnk():
                    raise SystemExit(f"{archive}: link entries are not allowed")
                expanded_bytes += member.size
                if expanded_bytes > MAX_ARCHIVE_BYTES:
                    raise SystemExit(f"{archive}: expanded archive is too large")
                roots.add(parts[0])
                output = destination.joinpath(*parts)
                if not output.resolve().is_relative_to(resolved_destination):
                    raise SystemExit(f"{archive}: unsafe archive path {member.name!r}")
                if member.isdir():
                    output.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    output.parent.mkdir(parents=True, exist_ok=True)
                    source = tar.extractfile(member)
                    if source is None:
                        raise SystemExit(f"{archive}: cannot read {member.name!r}")
                    with source, output.open("wb") as target:
                        shutil.copyfileobj(source, target)
                else:
                    raise SystemExit(f"{archive}: unsupported archive entry {member.name!r}")
                output.chmod(member.mode & 0o777)
        if len(roots) != 1:
            raise SystemExit(f"{archive}: expected one package root, found {len(roots)}")
        return destination / next(iter(roots))
    if spec.archive != "zip":
        raise SystemExit(f"fresh extraction is not implemented for {spec.archive}")
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise SystemExit(f"{archive}: archive has too many members")
        for info in members:
            parts = parts_for(info.filename.rstrip("/"))
            expanded_bytes += info.file_size
            if expanded_bytes > MAX_ARCHIVE_BYTES:
                raise SystemExit(f"{archive}: expanded archive is too large")
            roots.add(parts[0])
            output = destination.joinpath(*parts)
            if not output.resolve().is_relative_to(resolved_destination):
                raise SystemExit(f"{archive}: unsafe archive path {info.filename!r}")
            mode = (info.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise SystemExit(f"{archive}: symlink entries are not allowed")
            file_type = stat.S_IFMT(mode)
            if file_type and not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise SystemExit(f"{archive}: unsupported archive entry {info.filename!r}")
            if info.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(info) as source, output.open("wb") as target:
                    shutil.copyfileobj(source, target)
            if mode:
                output.chmod(stat.S_IMODE(mode))
    if len(roots) != 1:
        raise SystemExit(f"{archive}: expected one package root, found {len(roots)}")
    return destination / next(iter(roots))


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _inventory(root: Path) -> list[dict[str, Any]]:
    files = []
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise SystemExit(f"{path}: native package may not contain symlinks")
        if path.is_file():
            files.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": _sha256(path.read_bytes()),
                }
            )
    return files


def _normalize_modes(root: Path, executable: Path, launchers: set[Path]) -> None:
    root.chmod(0o755)
    executable_rel = executable.relative_to(root)
    launcher_rels = {path.relative_to(root) for path in launchers}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise SystemExit(f"{path}: native package may not contain symlinks")
        if path.is_dir():
            path.chmod(0o755)
        elif path.is_file():
            relative = path.relative_to(root)
            path.chmod(0o755 if relative == executable_rel or relative in launcher_rels else 0o644)


def _layout_from_root(root: Path, spec: NativeTarget) -> NativeLayout:
    if spec.platform == "macos":
        payload = root / "Contents" / "Resources"
        executable = root / "Contents" / "MacOS" / spec.executable
        icons = sorted(payload.glob("*.icns"))
        return NativeLayout(root, payload, executable, payload / "catalog", icons[0] if icons else None)
    return NativeLayout(root, root, root / spec.executable, root / "catalog", None)


def _descriptor_path(root: Path) -> Path:
    candidates = [
        root / "package.json",
        root / "Contents" / "Resources" / "package.json",
    ]
    found = [path for path in candidates if path.is_file()]
    if len(found) != 1:
        raise SystemExit(f"{root}: expected exactly one native package descriptor")
    return found[0]


def _strict_checksum_rows(path: Path) -> dict[str, str]:
    rows: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as exc:
        raise SystemExit(f"{path}: cannot read SHA256SUMS: {exc}") from None
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\r\n]+)", line)
        if match is None:
            raise SystemExit(f"{path}: malformed SHA256SUMS row {line!r}")
        digest, relative = match.groups()
        parts = Path(relative).parts
        if not parts or Path(relative).is_absolute() or ".." in parts:
            raise SystemExit(f"{path}: unsafe SHA256SUMS path {relative!r}")
        canonical = Path(*parts).as_posix()
        if canonical in rows:
            raise SystemExit(f"{path}: duplicate SHA256SUMS path {relative!r}")
        rows[canonical] = digest
    return rows


def _require_closed_inventory(layout: NativeLayout, descriptor: dict[str, Any]) -> None:
    actual = _inventory(layout.archive_root)
    actual_by_path = {entry["path"]: entry for entry in actual}
    sums_path = layout.payload_root / "SHA256SUMS"
    descriptor_path = layout.payload_root / "package.json"
    sums_relative = sums_path.relative_to(layout.archive_root).as_posix()
    descriptor_relative = descriptor_path.relative_to(layout.archive_root).as_posix()
    rows = _strict_checksum_rows(sums_path)
    expected_rows = set(actual_by_path) - {sums_relative}
    if set(rows) != expected_rows:
        raise SystemExit(f"{sums_path}: SHA256SUMS inventory is not closed")
    for relative, digest in rows.items():
        if actual_by_path[relative]["sha256"] != digest:
            raise SystemExit(f"{layout.archive_root / relative}: internal checksum mismatch")

    descriptor_files = [
        entry
        for entry in actual
        if entry["path"] not in {descriptor_relative, sums_relative}
    ]
    if descriptor.get("files") != descriptor_files:
        raise SystemExit(f"{descriptor_path}: descriptor file inventory mismatch")
    if descriptor.get("payload_id") != _sha256(_canonical_json(descriptor_files)):
        raise SystemExit(f"{descriptor_path}: payload_id mismatch")
    catalog_files = _inventory(layout.catalog)
    if descriptor.get("catalog_payload_id") != _sha256(_canonical_json(catalog_files)):
        raise SystemExit(f"{descriptor_path}: catalog_payload_id mismatch")


def verify_native_archive_static(
    archive: Path,
    destination: Path,
) -> VerifiedNativeArchive:
    """Extract and verify a native archive without executing its binary."""
    if destination.exists():
        shutil.rmtree(destination)
    suffix = "tar.gz" if archive.name.endswith(".tar.gz") else "zip" if archive.suffix == ".zip" else None
    if suffix is None:
        raise SystemExit(f"{archive}: expected a .tar.gz or .zip native archive")
    extraction_spec = target_spec(
        "x86_64-unknown-linux-gnu" if suffix == "tar.gz" else "x86_64-pc-windows-msvc"
    )
    root = extract_native_archive(archive, destination, extraction_spec)
    descriptor_path = _descriptor_path(root)
    try:
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"{descriptor_path}: invalid native package descriptor: {exc}") from None
    if descriptor.get("schema") != 1:
        raise SystemExit(f"{descriptor_path}: unsupported native package schema")
    rust_target = descriptor.get("rust_target")
    if not isinstance(rust_target, str):
        raise SystemExit(f"{descriptor_path}: missing rust_target")
    spec = target_spec(rust_target)
    if spec.archive != suffix or descriptor.get("target") != spec.label:
        raise SystemExit(f"{descriptor_path}: target does not match archive layout")
    layout = _layout_from_root(root, spec)
    if not layout.executable.is_file() or not layout.catalog.is_dir():
        raise SystemExit(f"{root}: native package layout is incomplete")
    if spec.platform == "macos" and not root.name.endswith(".app"):
        raise SystemExit(f"{root}: macOS package root must be an app bundle")
    if spec.platform in {"windows", "macos"}:
        canonical: dict[str, str] = {}
        for entry in _inventory(root):
            relative = entry["path"]
            folded = unicodedata.normalize("NFC", relative).casefold()
            previous = canonical.setdefault(folded, relative)
            if previous != relative:
                raise SystemExit(f"{archive}: canonical path collision {previous!r} and {relative!r}")

    profile = descriptor.get("profile")
    product = descriptor.get("product")
    if profile not in {"sideb", "release"}:
        raise SystemExit(f"{descriptor_path}: invalid native package profile")
    expected_product = (
        "Calyx Side B" if profile == "sideb" else "Cheesy Crab Calyx"
    )
    if product != expected_product:
        raise SystemExit(f"{descriptor_path}: product does not match profile")
    catalog_descriptor = json.loads(
        (layout.catalog / ".calyx-catalog.json").read_text(encoding="utf-8")
    )
    if catalog_descriptor.get("profile") != profile:
        raise SystemExit(f"{descriptor_path}: catalog profile mismatch")

    _require_closed_inventory(layout, descriptor)
    glibc = descriptor.get("glibc")
    if not isinstance(glibc, dict) or set(glibc) != {"ceiling", "required_max"}:
        raise SystemExit(f"{descriptor_path}: invalid glibc evidence")
    sdl_link = descriptor.get("sdl_link")
    if sdl_link not in {"bundled", "system"}:
        raise SystemExit(f"{descriptor_path}: invalid SDL linkage")
    facts = verify_native_binary(
        layout.executable,
        rust_target,
        sdl_link,
        glibc["ceiling"],
    )
    if facts.glibc_required_max != glibc["required_max"]:
        raise SystemExit(f"{descriptor_path}: glibc required_max mismatch")
    payload = archive.read_bytes()
    return VerifiedNativeArchive(
        _sha256(payload), len(payload), layout, descriptor, spec, facts
    )


def assemble_native_package(
    inputs: NativePackageInputs,
    license_writer: Callable[[Path, Path, str, str], None],
) -> NativePackageResult:
    """Assemble, archive, statically verify, and only then publish a package."""
    spec = target_spec(inputs.target)
    if inputs.profile not in ("sideb", "release"):
        raise SystemExit("native package profile must be sideb or release")
    if inputs.profile == "release" and inputs.build_info.get("source_local") is not False:
        raise SystemExit("release native packages require clean committed source")
    catalog_descriptor = json.loads(
        (inputs.catalog / ".calyx-catalog.json").read_text(encoding="utf-8")
    )
    if catalog_descriptor.get("profile") != inputs.profile:
        raise SystemExit(
            f"native package profile {inputs.profile!r} does not match catalog profile "
            f"{catalog_descriptor.get('profile')!r}"
        )
    verify_native_icons(inputs.root)
    binary_facts = verify_native_binary(
        inputs.binary, inputs.target, inputs.sdl_link, inputs.max_glibc
    )
    inputs.out.mkdir(parents=True, exist_ok=True)
    sideb = inputs.profile == "sideb"
    product = "Calyx Side B" if sideb else "Calyx"
    descriptor_product = "Calyx Side B" if sideb else "Cheesy Crab Calyx"
    status = "sideb" if sideb else "release-candidate"

    with tempfile.TemporaryDirectory(prefix=".calyx-native-", dir=inputs.out) as raw:
        work = Path(raw)
        layout = stage_layout(work / "stage", spec, product, inputs.binary, inputs.catalog)
        mark_name = "calyx-sideb-mark.svg" if sideb else "calyx-mark.svg"
        shutil.copy2(inputs.root / "assets" / "brand" / mark_name, layout.payload_root / mark_name)
        if spec.platform == "macos":
            icon_name = "Calyx-Side-B.icns" if sideb else "Calyx.icns"
            shutil.copy2(inputs.root / "assets/brand/native" / icon_name, layout.icon)
        elif spec.platform == "windows":
            icon_name = "calyx-sideb.ico" if sideb else "calyx.ico"
            shutil.copy2(inputs.root / "assets/brand/native" / icon_name, layout.payload_root / "calyx.ico")

        launchers: set[Path] = set()
        if spec.platform == "linux":
            launcher = layout.payload_root / product
            launcher.write_text(
                "#!/usr/bin/env sh\nset -eu\n"
                'HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n'
                'exec "$HERE/calyx" "$@"\n',
                encoding="utf-8",
            )
            launchers.add(launcher)
        (layout.payload_root / "PLAYING.txt").write_text(
            f"{product} {inputs.product_version}\n\n"
            f"Start {spec.executable} to open the console.\n"
            "Keyboard: arrows/WASD move, Z=A, X=B, Enter=Start, Backspace=home, Escape=quit.\n",
            encoding="utf-8",
        )
        license_writer(layout.payload_root, layout.catalog, inputs.target, inputs.sdl_link)
        (layout.payload_root / "RELEASE_NOTES.txt").write_text(
            f"{product} {inputs.product_version} ({status})\n"
            f"Implements Calyx ABI {inputs.abi_version}.\n"
            + (
                "Inclusive native staging build; unfinished content may be present.\n"
                if sideb
                else "Curated Calyx 1.0 release-candidate build.\n"
            ),
            encoding="utf-8",
        )
        _normalize_modes(layout.archive_root, layout.executable, launchers)
        base_files = _inventory(layout.archive_root)
        catalog_files = _inventory(layout.catalog)
        descriptor = {
            "schema": 1,
            "product": descriptor_product,
            "profile": inputs.profile,
            "status": status,
            "version": inputs.product_version,
            "abi": inputs.abi_version,
            "target": spec.label,
            "rust_target": inputs.target,
            "sdl_link": inputs.sdl_link,
            "glibc": {
                "ceiling": inputs.max_glibc,
                "required_max": binary_facts.glibc_required_max,
            },
            "signing": "unsigned-not-notarized",
            "catalog_payload_id": _sha256(_canonical_json(catalog_files)),
            "payload_id": _sha256(_canonical_json(base_files)),
            **inputs.build_info,
            "files": base_files,
        }
        (layout.payload_root / "package.json").write_bytes(_canonical_json(descriptor) + b"\n")
        sums = [
            f"{entry['sha256']}  {entry['path']}"
            for entry in _inventory(layout.archive_root)
            if entry["path"] != layout.payload_root.joinpath("SHA256SUMS").relative_to(layout.archive_root).as_posix()
        ]
        (layout.payload_root / "SHA256SUMS").write_text(
            "\n".join(sums) + "\n", encoding="ascii", newline="\n"
        )
        _normalize_modes(layout.archive_root, layout.executable, launchers)

        if sideb:
            base = f"calyx-sideb-{spec.label}-{descriptor['payload_id'][:16]}"
        else:
            base = f"calyx-{inputs.product_version}-{spec.label}"
        if spec.platform == "linux":
            renamed_root = layout.archive_root.with_name(base)
            layout.archive_root.rename(renamed_root)
            layout = _layout_from_root(renamed_root, spec)

        archive_suffix = ".tar.gz" if spec.archive == "tar.gz" else ".zip"
        staged_archive = work / f"{base}{archive_suffix}"
        if spec.archive == "tar.gz":
            deterministic_tar_gz(layout.archive_root, staged_archive)
        else:
            deterministic_zip(layout.archive_root, staged_archive)
        verify_native_archive_static(staged_archive, work / "verified")

        final_package = inputs.out / layout.archive_root.name
        final_archive = inputs.out / staged_archive.name
        final_checksum = Path(f"{final_archive}.sha256")
        if final_package.exists():
            shutil.rmtree(final_package)
        for path in (final_archive, final_checksum):
            if path.exists():
                path.unlink()
        layout.archive_root.rename(final_package)
        staged_archive.rename(final_archive)
        digest = _sha256(final_archive.read_bytes())
        final_checksum.write_text(
            f"{digest}  {final_archive.name}\n", encoding="ascii", newline="\n"
        )
        return NativePackageResult(final_package, final_archive, final_checksum, descriptor)


def _readelf_output(readelf: str, binary: Path, option: str) -> str:
    try:
        return subprocess.run(
            [readelf, option, str(binary)],
            cwd=binary.parent,
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "LC_ALL": "C"},
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        raise SystemExit(
            f"{binary}: readelf inspection failed: {detail.strip()}"
        ) from None


def _verify_elf(
    binary: Path,
    spec: NativeTarget,
    sdl_link: str,
    max_glibc: str | None,
) -> BinaryFacts:
    if "musl" in spec.rust and max_glibc is not None:
        raise SystemExit("musl native packages do not accept --max-glibc")
    readelf = next(
        (
            resolved
            for command in ("readelf", "llvm-readelf", "greadelf")
            if (resolved := shutil.which(command)) is not None
        ),
        None,
    )
    if readelf is None:
        raise SystemExit(
            "native package verification requires readelf, llvm-readelf, or greadelf"
        )

    with binary.open("rb") as handle:
        header = handle.read(20)
    if len(header) < 20 or header[:4] != b"\x7fELF":
        raise SystemExit(f"{binary}: native package binary is not an ELF file")
    byteorder = {1: "little", 2: "big"}.get(header[5])
    if byteorder is None:
        raise SystemExit(f"{binary}: ELF has an unknown byte order")
    machine = int.from_bytes(header[18:20], byteorder)
    expected_name = "x86-64" if spec.arch == "x86_64" else "AArch64"
    if machine != spec.machine:
        raise SystemExit(
            f"{binary}: ELF architecture {machine} does not match declared "
            f"{expected_name} target {spec.rust!r}"
        )

    dynamic = _readelf_output(readelf, binary, "-d")
    sdl_soname = "libSDL2-2.0.so.0"
    if sdl_link == "system" and f"[{sdl_soname}]" not in dynamic:
        raise SystemExit(
            f"{binary}: system SDL package requires DT_NEEDED {sdl_soname}"
        )
    if sdl_link == "bundled" and f"[{sdl_soname}]" in dynamic:
        raise SystemExit(
            f"{binary}: bundled SDL package has a dynamic dependency on {sdl_soname}"
        )

    required_max = None
    if "musl" not in spec.rust:
        version_info = _readelf_output(readelf, binary, "--version-info")
        versions = {
            match.group(1)
            for match in re.finditer(r"\bGLIBC_(\d+(?:\.\d+)+)\b", version_info)
        }
        if not versions:
            raise SystemExit(
                f"{binary}: GNU target has no GLIBC version requirements to verify"
            )
        highest = max(versions, key=lambda value: tuple(map(int, value.split("."))))
        required_max = f"GLIBC_{highest}"
        if max_glibc is not None:
            ceiling_match = re.fullmatch(r"GLIBC_(\d+(?:\.\d+)+)", max_glibc)
            if ceiling_match is None:
                raise SystemExit(
                    f"invalid glibc ceiling {max_glibc!r}; expected GLIBC_<version>"
                )
            ceiling = tuple(map(int, ceiling_match.group(1).split(".")))
            if tuple(map(int, highest.split("."))) > ceiling:
                raise SystemExit(
                    f"{binary}: requires GLIBC_{highest}, newer than declared "
                    f"ceiling {max_glibc}"
                )
    return BinaryFacts(sdl_link, required_max)


def _run_inspector(command: list[str], binary: Path, label: str) -> str:
    try:
        return subprocess.run(
            command,
            cwd=binary.parent,
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "LC_ALL": "C"},
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        raise SystemExit(
            f"{binary}: {label} inspection failed: {detail.strip()}"
        ) from None


def _verify_pe(binary: Path, spec: NativeTarget, sdl_link: str) -> BinaryFacts:
    with binary.open("rb") as handle:
        dos = handle.read(64)
        if len(dos) < 64 or dos[:2] != b"MZ":
            raise SystemExit(f"{binary}: native package binary is not a PE file")
        pe_offset = int.from_bytes(dos[0x3C:0x40], "little")
        handle.seek(pe_offset)
        header = handle.read(6)
    if len(header) < 6 or header[:4] != b"PE\0\0":
        raise SystemExit(f"{binary}: native package binary is not a PE file")
    machine = int.from_bytes(header[4:6], "little")
    if machine != spec.machine:
        raise SystemExit(
            f"{binary}: PE architecture 0x{machine:04x} does not match declared "
            f"x86-64 target {spec.rust!r}"
        )

    dumpbin = shutil.which("dumpbin")
    llvm = shutil.which("llvm-readobj")
    if dumpbin:
        imports = _run_inspector([dumpbin, "/DEPENDENTS", str(binary)], binary, "dumpbin")
    elif llvm:
        imports = _run_inspector(
            [llvm, "--coff-imports", str(binary)], binary, "llvm-readobj"
        )
    else:
        raise SystemExit(
            "Windows native package verification requires dumpbin or llvm-readobj"
        )
    has_sdl = "sdl2.dll" in imports.casefold()
    if sdl_link == "bundled" and has_sdl:
        raise SystemExit(f"{binary}: bundled SDL package imports SDL2.dll")
    if sdl_link == "system" and not has_sdl:
        raise SystemExit(f"{binary}: system SDL package must import SDL2.dll")
    return BinaryFacts(sdl_link, None)


def _verify_macho(binary: Path, spec: NativeTarget, sdl_link: str) -> BinaryFacts:
    with binary.open("rb") as handle:
        header = handle.read(8)
    byteorder = {
        bytes.fromhex("cffaedfe"): "little",
        bytes.fromhex("feedfacf"): "big",
    }.get(header[:4])
    if len(header) < 8 or byteorder is None:
        raise SystemExit(f"{binary}: native package binary is not a 64-bit Mach-O")
    cpu_type = int.from_bytes(header[4:8], byteorder)
    if cpu_type != spec.machine:
        raise SystemExit(
            f"{binary}: Mach-O CPU 0x{cpu_type:08x} does not match declared "
            f"arm64 target {spec.rust!r}"
        )

    otool = shutil.which("otool")
    if otool is None:
        raise SystemExit("macOS native package verification requires otool")
    libraries = _run_inspector([otool, "-L", str(binary)], binary, "otool")
    lowered = libraries.casefold()
    has_sdl = any(
        marker.casefold() in lowered
        for marker in ("SDL2.framework", "/libSDL2", "libSDL2-2.0")
    )
    if sdl_link == "bundled" and has_sdl:
        raise SystemExit(f"{binary}: bundled SDL package links external SDL2")
    if sdl_link == "system" and not has_sdl:
        raise SystemExit(f"{binary}: system SDL package must link external SDL2")
    return BinaryFacts(sdl_link, None)


def verify_native_binary(
    binary: Path,
    target: str,
    sdl_link: str,
    max_glibc: str | None,
) -> BinaryFacts:
    """Assert that a binary matches its declared package contract."""
    spec = target_spec(target)
    if spec.platform == "linux":
        return _verify_elf(binary, spec, sdl_link, max_glibc)
    elif spec.platform == "windows":
        if max_glibc is not None:
            raise SystemExit("--max-glibc applies only to Linux native packages")
        return _verify_pe(binary, spec, sdl_link)
    elif spec.platform == "macos":
        if max_glibc is not None:
            raise SystemExit("--max-glibc applies only to Linux native packages")
        return _verify_macho(binary, spec, sdl_link)
    raise AssertionError(f"unsupported native platform {spec.platform!r}")


def _executor_identity() -> tuple[str, str]:
    system = platform.system().casefold()
    machine = platform.machine().casefold()
    platform_name = {"darwin": "macos", "windows": "windows", "linux": "linux"}.get(
        system, system
    )
    if platform_name == "macos" and machine in {"arm64", "aarch64"}:
        architecture = "arm64"
    else:
        architecture = {
            "amd64": "x86_64",
            "x86_64": "x86_64",
            "arm64": "aarch64",
            "aarch64": "aarch64",
        }.get(machine, machine)
    return platform_name, architecture


def _require_compatible_executor(spec: NativeTarget) -> tuple[str, str]:
    executor = _executor_identity()
    if executor != (spec.platform, spec.arch):
        raise SystemExit(
            f"native execution verification requires a compatible {spec.label} host; "
            f"current host is {executor[0]}-{executor[1]}"
        )
    return executor


def _run_checked(command: list[str], label: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        raise SystemExit(f"native package {label} failed: {detail.strip()}") from None


def _write_receipt_atomic(path: Path, receipt: dict[str, Any]) -> None:
    payload = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
    fd, raw = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(raw)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def verify_native_package(archive: Path, verifier_revision: str) -> Path:
    """Execute one verified native archive and write its hash-bound receipt."""
    archive = archive.resolve()
    try:
        source_stat = archive.stat(follow_symlinks=False)
    except OSError as exc:
        raise SystemExit(f"{archive}: cannot inspect native archive: {exc}") from None
    if not stat.S_ISREG(source_stat.st_mode):
        raise SystemExit(f"{archive}: native archive must be a regular file")

    receipt_path = Path(f"{archive}.verification.json")
    with tempfile.TemporaryDirectory(prefix=".calyx-verify-", dir=archive.parent) as raw:
        work = Path(raw)
        private_archive = work / archive.name
        with archive.open("rb") as source, private_archive.open("xb") as target:
            shutil.copyfileobj(source, target)
        payload = private_archive.read_bytes()
        digest = _sha256(payload)
        archive_bytes = len(payload)

        checksum_path = Path(f"{archive}.sha256")
        if not checksum_path.is_file():
            raise SystemExit(f"{checksum_path}: archive checksum is missing")
        try:
            checksum = checksum_path.read_text(encoding="ascii")
        except (OSError, UnicodeError) as exc:
            raise SystemExit(f"{checksum_path}: cannot read archive checksum: {exc}") from None
        expected = f"{digest}  {archive.name}\n"
        if checksum != expected:
            raise SystemExit(f"{checksum_path}: archive checksum mismatch")

        verified = verify_native_archive_static(private_archive, work / "extracted")
        executor_platform, executor_arch = _require_compatible_executor(verified.spec)
        descriptor = verified.descriptor
        version = _run_checked([str(verified.layout.executable), "--version"], "version check")
        if (
            str(descriptor.get("version")) not in version.stdout
            or str(descriptor.get("abi")) not in version.stdout
        ):
            raise SystemExit(
                "native package version output does not match its descriptor: "
                f"{version.stdout.strip()}"
            )

        status_dir = work / "status"
        _run_checked(
            [
                str(verified.layout.executable),
                "console",
                "--carts",
                str(verified.layout.catalog),
                "--present",
                "headless",
                "--frames",
                "100",
                "--out",
                str(status_dir),
            ],
            "boot-to-launcher check",
        )
        try:
            status = json.loads((status_dir / "status.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise SystemExit(f"native package boot-to-launcher status is invalid: {exc}") from None
        if not (
            status.get("mode") == "console"
            and status.get("frames_run") == 100
            and status.get("initial_role") == "boot"
            and status.get("swaps") == 1
            and status.get("final_role") == "launcher"
        ):
            raise SystemExit(f"native package boot-to-launcher check failed: {status}")

        glibc = descriptor["glibc"]
        receipt = {
            "schema": 1,
            "scope": "native-host-package",
            "contract": "calyx-native-package-v1",
            "archive": {
                "name": archive.name,
                "sha256": digest,
                "bytes": archive_bytes,
            },
            "package": {
                key: descriptor.get(key)
                for key in (
                    "payload_id",
                    "product",
                    "profile",
                    "version",
                    "abi",
                    "target",
                    "rust_target",
                    "source_revision",
                )
            },
            "compatibility": {
                "sdl_link": descriptor["sdl_link"],
                "glibc_ceiling": glibc["ceiling"],
                "glibc_required_max": glibc["required_max"],
            },
            "executor": {
                "platform": executor_platform,
                "architecture": executor_arch,
            },
            "verified_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "verifier_revision": verifier_revision,
            "recipe": {"frames": 100, "input": "empty"},
            "passed_checks": [
                "archive-integrity-v1",
                "binary-contract-v1",
                "version-identity-v1",
                "boot-to-launcher-v1",
            ],
        }
        _write_receipt_atomic(receipt_path, receipt)
    return receipt_path
