"""Read the workspace class taxonomy (``classes.json``), the only place classes live.

A detect class's YOLO id is its position in ``tasks.detect.classKeys``; archived
classes keep their position so existing label files stay valid.
"""

from __future__ import annotations

import json
from typing import Any

from .workspace_layout import DEFAULT_CLASSES_DOCUMENT, WorkspaceLayout


def read_classes(layout: WorkspaceLayout) -> dict[str, Any]:
    try:
        data = json.loads(layout.classes.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return json.loads(json.dumps(DEFAULT_CLASSES_DOCUMENT))
    if not isinstance(data, dict):
        raise ValueError(f"{layout.classes} is not a class document.")
    return data


def _defs_by_key(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item.get("key")): item for item in document.get("classDefs") or [] if isinstance(item, dict) and item.get("key")}


def _task_keys(document: dict[str, Any], task: str) -> list[str]:
    tasks = document.get("tasks") if isinstance(document.get("tasks"), dict) else {}
    entry = tasks.get(task) if isinstance(tasks.get(task), dict) else {}
    return [str(key) for key in entry.get("classKeys") or []]


def detect_classes(document: dict[str, Any]) -> list[dict[str, Any]]:
    """Detect classes in YOLO id order: {id, key, name, archived}."""
    defs = _defs_by_key(document)
    out = []
    for index, key in enumerate(_task_keys(document, "detect")):
        item = defs.get(key, {})
        out.append({"id": index, "key": key, "name": str(item.get("name") or key), "archived": bool(item.get("archived"))})
    return out


def classify_classes(document: dict[str, Any], *, include_archived: bool = False) -> list[dict[str, Any]]:
    """Classification classes: {key, name, archived}."""
    defs = _defs_by_key(document)
    out = []
    for key in _task_keys(document, "clf"):
        item = defs.get(key, {})
        archived = bool(item.get("archived"))
        if archived and not include_archived:
            continue
        out.append({"key": key, "name": str(item.get("name") or key), "archived": archived})
    return out
