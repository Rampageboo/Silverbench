"""Read the workspace class taxonomy (``classes.json``), the only place classes live.

A detect class's YOLO id is its position in ``tasks.detect.classKeys``; archived
classes keep their position so existing label files stay valid.
"""

from __future__ import annotations

import json
import re
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


# ── Editing (mirrors apps/desktop/src/features/workspace/workspaceClassTaxonomy.ts) ──


def slugify_class_name(name: str) -> str:
    slug = re.sub(r"\s+", "_", name.lower())
    slug = re.sub(r"[^a-z0-9_-]", "", slug).strip("_")[:64]
    return slug or "class"


def _unique_slug(base: str, used: set[str]) -> str:
    if base not in used:
        return base
    index = 2
    while f"{base}_{index}" in used:
        index += 1
    return f"{base}_{index}"


def add_class(document: dict[str, Any], name: str, task: str) -> tuple[dict[str, Any], str, bool]:
    """Add ``name`` to the ``detect`` or ``clf`` task. Returns (document, key, added).

    An active class with the same name (case-insensitive) is reused: for detect
    only if it is already a detect class, for clf it is attached to the task.
    """
    if task not in ("detect", "clf"):
        raise ValueError("task must be 'detect' or 'clf'.")
    clean = name.strip()
    if not clean:
        raise ValueError("Class names cannot be empty.")
    doc = json.loads(json.dumps(document))
    doc.setdefault("classDefs", [])
    tasks = doc.setdefault("tasks", {})
    keys = tasks.setdefault(task, {}).setdefault("classKeys", [])
    for item in doc["classDefs"]:
        if not item.get("archived") and str(item.get("name") or "").strip().lower() == clean.lower():
            if item["key"] in keys:
                return doc, item["key"], False
            if task == "clf":
                keys.append(item["key"])
                return doc, item["key"], True
    key = _unique_slug(slugify_class_name(clean), {str(item.get("key")) for item in doc["classDefs"]})
    doc["classDefs"].append({"key": key, "name": clean})
    keys.append(key)
    return doc, key, True


def resolve_class(document: dict[str, Any], value: str | int, task: str) -> dict[str, Any]:
    """Find a class of ``task`` by YOLO id (detect), key or name (case-insensitive)."""
    candidates = detect_classes(document) if task == "detect" else classify_classes(document, include_archived=True)
    if isinstance(value, int) or (isinstance(value, str) and value.strip().isdigit() and task == "detect"):
        index = int(value)
        for item in candidates:
            if item.get("id") == index:
                return item
    text = str(value).strip().lower()
    for item in candidates:
        if item["key"].lower() == text or item["name"].strip().lower() == text:
            return item
    known = ", ".join(f"{item['name']} ({item['key']})" for item in candidates[:80])
    raise ValueError(f"Unknown {task} class '{value}'. Known classes: {known or 'none yet'}. Add it with add_classes first.")
