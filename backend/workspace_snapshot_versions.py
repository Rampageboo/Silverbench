from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SNAPSHOT_MANIFEST_FILENAME = "workspace_versions.json"
SNAPSHOT_MANIFEST_VERSION = 1
SNAPSHOT_MANIFEST_TYPE = "yolo-workbench-snapshot-versions"
VERSION_ID_RE = re.compile(r"^V([1-9][0-9]*)$")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_version_id(value: object) -> str:
    text = str(value or "").strip().upper()
    match = VERSION_ID_RE.match(text)
    if not match:
        raise ValueError(f"Invalid workspace snapshot version id: {value}")
    return f"V{int(match.group(1))}"


def is_snapshot_version_dir_name(name: str) -> bool:
    return bool(VERSION_ID_RE.match(name.strip().upper()))


def snapshot_manifest_path(workspace_root: Path) -> Path:
    return workspace_root.expanduser().resolve() / SNAPSHOT_MANIFEST_FILENAME


def _entry_id(entry: object) -> str:
    if not isinstance(entry, dict):
        raise ValueError("Workspace version entries must be objects.")
    return normalize_version_id(entry.get("id"))


def validate_snapshot_versions_manifest(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("workspace_versions.json must contain an object.")
    versions_raw = value.get("versions")
    if not isinstance(versions_raw, list) or not versions_raw:
        raise ValueError("workspace_versions.json must contain at least one version.")

    seen: set[str] = set()
    versions: list[dict[str, Any]] = []
    for raw_entry in versions_raw:
        if not isinstance(raw_entry, dict):
            raise ValueError("Workspace version entries must be objects.")
        version_id = _entry_id(raw_entry)
        if version_id in seen:
            raise ValueError(f"Duplicate workspace version id: {version_id}")
        seen.add(version_id)
        path_value = raw_entry.get("path")
        path = str(path_value).strip() if isinstance(path_value, str) and path_value.strip() else version_id
        versions.append({**raw_entry, "id": version_id, "path": path})

    active_version = normalize_version_id(value.get("activeVersion"))
    if active_version not in seen:
        raise ValueError(f"activeVersion does not exist: {active_version}")

    return {
        **value,
        "version": SNAPSHOT_MANIFEST_VERSION,
        "type": SNAPSHOT_MANIFEST_TYPE,
        "activeVersion": active_version,
        "versions": versions,
    }


def read_snapshot_versions(workspace_root: Path) -> dict[str, Any]:
    path = snapshot_manifest_path(workspace_root)
    if not path.is_file():
        raise FileNotFoundError(f"Snapshot versions manifest not found: {path}")
    return validate_snapshot_versions_manifest(json.loads(path.read_text(encoding="utf-8")))


def write_snapshot_versions(workspace_root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    root = workspace_root.expanduser().resolve()
    normalized = validate_snapshot_versions_manifest(manifest)
    path = snapshot_manifest_path(root)
    path.write_text(json.dumps(normalized, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return normalized


def is_snapshot_versioned_workspace(workspace_root: Path) -> bool:
    try:
        read_snapshot_versions(workspace_root)
    except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
        return False
    return True


def list_snapshot_versions(workspace_root: Path) -> list[dict[str, Any]]:
    return list(read_snapshot_versions(workspace_root)["versions"])


def resolve_version_path(workspace_root: Path, version_id: str) -> Path:
    root = workspace_root.expanduser().resolve()
    normalized_id = normalize_version_id(version_id)
    manifest = read_snapshot_versions(root)
    for entry in manifest["versions"]:
        if entry["id"] == normalized_id:
            path = Path(str(entry.get("path") or normalized_id))
            if not path.is_absolute():
                path = root / path
            return path.resolve()
    raise ValueError(f"Workspace version does not exist: {normalized_id}")


def resolve_active_version_path(workspace_root: Path) -> Path:
    manifest = read_snapshot_versions(workspace_root)
    return resolve_version_path(workspace_root, str(manifest["activeVersion"]))


def next_snapshot_version_id(manifest: dict[str, Any]) -> str:
    normalized = validate_snapshot_versions_manifest(manifest)
    max_number = 0
    for entry in normalized["versions"]:
        match = VERSION_ID_RE.match(entry["id"])
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"V{max_number + 1}"


def create_initial_versions_manifest(now: str | None = None) -> dict[str, Any]:
    timestamp = now or _utc_now_iso()
    return {
        "version": SNAPSHOT_MANIFEST_VERSION,
        "type": SNAPSHOT_MANIFEST_TYPE,
        "activeVersion": "V1",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "versions": [
            {
                "id": "V1",
                "path": "V1",
                "createdAt": timestamp,
                "source": "initialized-from-root",
            }
        ],
    }


def add_snapshot_version_entry(
    manifest: dict[str, Any],
    *,
    version_id: str,
    source: str,
    now: str | None = None,
) -> dict[str, Any]:
    normalized = validate_snapshot_versions_manifest(manifest)
    new_id = normalize_version_id(version_id)
    if any(entry["id"] == new_id for entry in normalized["versions"]):
        raise ValueError(f"Workspace version already exists: {new_id}")
    timestamp = now or _utc_now_iso()
    return validate_snapshot_versions_manifest(
        {
            **normalized,
            "updatedAt": timestamp,
            "versions": [
                *normalized["versions"],
                {
                    "id": new_id,
                    "path": new_id,
                    "createdAt": timestamp,
                    "source": source,
                },
            ],
        }
    )


def set_active_snapshot_version(workspace_root: Path, version_id: str) -> dict[str, Any]:
    root = workspace_root.expanduser().resolve()
    normalized_id = normalize_version_id(version_id)
    manifest = read_snapshot_versions(root)
    if not any(entry["id"] == normalized_id for entry in manifest["versions"]):
        raise ValueError(f"Workspace version does not exist: {normalized_id}")
    version_path = resolve_version_path(root, normalized_id)
    if not version_path.is_dir():
        raise NotADirectoryError(f"Workspace version folder not found: {version_path}")
    return write_snapshot_versions(
        root,
        {
            **manifest,
            "activeVersion": normalized_id,
            "updatedAt": _utc_now_iso(),
        },
    )


def _should_skip_snapshot_copy_child(path: Path) -> bool:
    return path.name == SNAPSHOT_MANIFEST_FILENAME or is_snapshot_version_dir_name(path.name)


def _copy_workspace_snapshot_contents(source: Path, destination: Path) -> None:
    source = source.expanduser().resolve()
    destination = destination.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        if _should_skip_snapshot_copy_child(child):
            continue
        target = destination / child.name
        if child.resolve() == destination:
            continue
        if child.is_dir():
            shutil.copytree(child, target, ignore=_snapshot_copy_ignore)
        elif child.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child, target)


def _remove_partial_snapshot(path: Path, context: str, original_error: Exception) -> None:
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        return
    except Exception as cleanup_error:
        raise RuntimeError(
            f"{context} failed and cleanup of partial snapshot also failed: {cleanup_error}"
        ) from original_error


def _snapshot_copy_ignore(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name == SNAPSHOT_MANIFEST_FILENAME or is_snapshot_version_dir_name(name)}


def initialize_snapshot_versioning(workspace_root: Path) -> dict[str, Any]:
    root = workspace_root.expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(f"Workspace root is not a directory: {root}")
    manifest_path = snapshot_manifest_path(root)
    if manifest_path.is_file():
        return read_snapshot_versions(root)

    version_path = root / "V1"
    created_version_path = False
    if not version_path.exists():
        created_version_path = True
        try:
            _copy_workspace_snapshot_contents(root, version_path)
        except Exception as error:
            _remove_partial_snapshot(version_path, "Initializing V1", error)
            raise
    elif not version_path.is_dir():
        raise NotADirectoryError(f"Workspace version path exists but is not a directory: {version_path}")

    manifest = create_initial_versions_manifest()
    try:
        return write_snapshot_versions(root, manifest)
    except Exception as error:
        if created_version_path:
            _remove_partial_snapshot(version_path, "Writing initial snapshot manifest", error)
        raise


def create_snapshot_version(workspace_root: Path, from_version_id: str | None = None) -> dict[str, Any]:
    root = workspace_root.expanduser().resolve()
    manifest = read_snapshot_versions(root)
    source_id = normalize_version_id(from_version_id or manifest["activeVersion"])
    source_path = resolve_version_path(root, source_id)
    if not source_path.is_dir():
        raise NotADirectoryError(f"Source workspace version folder not found: {source_path}")
    new_id = next_snapshot_version_id(manifest)
    destination_path = root / new_id
    if destination_path.exists():
        raise FileExistsError(f"Workspace version folder already exists: {destination_path}")
    try:
        _copy_workspace_snapshot_contents(source_path, destination_path)
    except Exception as error:
        _remove_partial_snapshot(destination_path, f"Creating {new_id}", error)
        raise
    updated = add_snapshot_version_entry(manifest, version_id=new_id, source=f"copied-from:{source_id}")
    try:
        return write_snapshot_versions(root, updated)
    except Exception as error:
        _remove_partial_snapshot(destination_path, f"Writing manifest entry for {new_id}", error)
        raise


def snapshot_open_payload(workspace_root: Path) -> dict[str, Any]:
    root = workspace_root.expanduser().resolve()
    manifest = read_snapshot_versions(root)
    active_id = str(manifest["activeVersion"])
    active_path = resolve_version_path(root, active_id)
    if not active_path.is_dir():
        raise NotADirectoryError(f"Active workspace version folder not found: {active_path}")
    return {
        "ok": True,
        "kind": "workspace",
        "root": str(active_path),
        "name": root.name,
        "initialized": False,
        "snapshotVersioned": True,
        "workspaceRootPath": str(root),
        "activeVersionId": active_id,
        "activeVersionPath": str(active_path),
        "workspaceVersions": manifest,
    }


def find_snapshot_container_for_version(path: Path) -> Path | None:
    version_path = path.expanduser().resolve()
    if not is_snapshot_version_dir_name(version_path.name):
        return None
    parent = version_path.parent
    if not is_snapshot_versioned_workspace(parent):
        return None
    try:
        manifest = read_snapshot_versions(parent)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    for entry in manifest["versions"]:
        entry_path = Path(str(entry.get("path") or entry["id"]))
        if not entry_path.is_absolute():
            entry_path = parent / entry_path
        if entry_path.resolve() == version_path:
            return parent
    return None
