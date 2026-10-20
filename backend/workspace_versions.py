"""Annotation snapshots under ``versions/``.

A snapshot copies the annotations (``labels/`` and ``classes.json``) — a few
megabytes — never the media. The live annotations are always the current state;
restoring a snapshot first snapshots the current state, so a restore never
loses work.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from .workspace_layout import RELATIVE_PATHS, WorkspaceLayout, utc_now_iso, write_json

INDEX_FILENAME = "versions.json"
_ID_PATTERN = re.compile(r"^V([1-9][0-9]*)$")
_SNAPSHOT_ITEMS = (RELATIVE_PATHS["classes"], "labels")


def _versions_dir(layout: WorkspaceLayout) -> Path:
    return layout.path("versions")


def _index_path(layout: WorkspaceLayout) -> Path:
    return _versions_dir(layout) / INDEX_FILENAME


def read_versions(layout: WorkspaceLayout) -> dict[str, Any]:
    try:
        data = json.loads(_index_path(layout).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    snapshots = [item for item in (data.get("snapshots") if isinstance(data, dict) else None) or [] if isinstance(item, dict) and item.get("id")]
    return {"ok": True, "version": 1, "snapshots": snapshots}


def _write_index(layout: WorkspaceLayout, index: dict[str, Any]) -> None:
    write_json(_index_path(layout), {"version": 1, "snapshots": index["snapshots"]})


def _next_id(index: dict[str, Any], layout: WorkspaceLayout) -> str:
    numbers = [int(m.group(1)) for item in index["snapshots"] if (m := _ID_PATTERN.match(str(item["id"])))]
    folder = _versions_dir(layout)
    if folder.is_dir():
        numbers += [int(m.group(1)) for child in folder.iterdir() if (m := _ID_PATTERN.match(child.name))]
    return f"V{max(numbers, default=0) + 1}"


def _counts(folder: Path) -> dict[str, int]:
    labels = folder / "labels"
    return {
        "imageLabels": sum(1 for _ in (labels / "images").glob("*.txt")) if (labels / "images").is_dir() else 0,
        "videoLabels": sum(1 for _ in (labels / "videos").glob("*.json")) if (labels / "videos").is_dir() else 0,
    }


def _copy_annotations(source_root: Path, destination: Path) -> None:
    destination.mkdir(parents=True)
    for item in _SNAPSHOT_ITEMS:
        src = source_root / item
        if src.is_dir():
            shutil.copytree(src, destination / item)
        elif src.is_file():
            shutil.copy2(src, destination / item)


def create_snapshot(layout: WorkspaceLayout, note: str = "") -> dict[str, Any]:
    index = read_versions(layout)
    snapshot_id = _next_id(index, layout)
    folder = _versions_dir(layout) / snapshot_id
    try:
        _copy_annotations(layout.root, folder)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    entry = {"id": snapshot_id, "createdAt": utc_now_iso(), "note": str(note or ""), **_counts(folder)}
    index["snapshots"].append(entry)
    _write_index(layout, index)
    return {**index, "created": entry}


def _snapshot_folder(layout: WorkspaceLayout, snapshot_id: str) -> Path:
    if not _ID_PATTERN.match(snapshot_id):
        raise ValueError(f"Invalid snapshot id: {snapshot_id}")
    folder = _versions_dir(layout) / snapshot_id
    if not folder.is_dir():
        raise FileNotFoundError(f"Snapshot {snapshot_id} does not exist.")
    return folder


def restore_snapshot(layout: WorkspaceLayout, snapshot_id: str) -> dict[str, Any]:
    """Replace the live annotations with a snapshot (after snapshotting them)."""
    folder = _snapshot_folder(layout, snapshot_id)
    backup = create_snapshot(layout, f"Before restoring {snapshot_id}")["created"]
    staging = layout.state / "restore-staging"
    shutil.rmtree(staging, ignore_errors=True)
    _copy_annotations(folder, staging)
    for item in _SNAPSHOT_ITEMS:
        live = layout.root / item
        if live.is_dir():
            shutil.rmtree(live)
        elif live.is_file():
            live.unlink()
        if (staging / item).exists():
            (staging / item).replace(live)
    shutil.rmtree(staging, ignore_errors=True)
    return {**read_versions(layout), "restored": snapshot_id, "backup": backup}


def delete_snapshot(layout: WorkspaceLayout, snapshot_id: str) -> dict[str, Any]:
    folder = _snapshot_folder(layout, snapshot_id)
    shutil.rmtree(folder)
    index = read_versions(layout)
    index["snapshots"] = [item for item in index["snapshots"] if item["id"] != snapshot_id]
    _write_index(layout, index)
    return index
