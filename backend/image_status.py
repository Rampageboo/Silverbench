"""Per-image status in ``labels/images.csv``.

One row per media image: dataset split, which tasks it takes part in, its
classification class key, junk/review/flag state and the next-training star.
"""

from __future__ import annotations

import csv
import io
import json
import threading
from pathlib import Path
from typing import Any

from .atomic_write import write_text_atomic
from .classes_store import classify_classes, detect_classes, read_classes
from .workspace_layout import WorkspaceLayout

JUNK_CLASS = "__junk__"

FIELDNAMES = [
    "filename",
    "split",
    "detect_enabled",
    "clf_enabled",
    "clf_class",
    "detect_junk",
    "detect_export_enabled",
    "clf_export_enabled",
    "reviewed",
    "flagged",
    "next_train",
]

_DEFAULT_ROW = {
    "split": "train",
    "detect_enabled": "0",
    "clf_enabled": "1",
    "clf_class": "",
    "detect_junk": "0",
    "detect_export_enabled": "1",
    "clf_export_enabled": "1",
    "reviewed": "0",
    "flagged": "0",
    "next_train": "0",
}

_BOOL_FIELDS = {"detect_enabled", "clf_enabled", "detect_junk", "reviewed", "flagged", "next_train"}
_DEFAULT_TRUE_FIELDS = {"detect_export_enabled", "clf_export_enabled"}

# Serializes read-modify-write per file: FastAPI runs sync endpoints in a threadpool.
_LOCKS_GUARD = threading.Lock()
_LOCKS: dict[str, threading.Lock] = {}


def _lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.Lock())


def _truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _flag(value: Any) -> str:
    return "1" if _truthy(value) else "0"


def _normalize_row(raw: dict[str, Any]) -> dict[str, str] | None:
    filename = Path(str(raw.get("filename") or "").replace("\\", "/")).name.strip()
    if not filename:
        return None
    row = {"filename": filename}
    split = str(raw.get("split") or "train").strip().lower()
    row["split"] = split if split in {"train", "val"} else "train"
    for name in _BOOL_FIELDS:
        row[name] = _flag(raw.get(name) or "")
    for name in _DEFAULT_TRUE_FIELDS:
        value = raw.get(name)
        row[name] = "1" if value is None or str(value).strip() == "" else _flag(value)
    row["clf_class"] = str(raw.get("clf_class") or "").strip()
    return row


def read_status_rows(layout: WorkspaceLayout) -> list[dict[str, str]]:
    path = layout.image_status
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = [_normalize_row(raw) for raw in csv.DictReader(handle)]
    return [row for row in rows if row]


def _write_rows(layout: WorkspaceLayout, rows: list[dict[str, str]]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=FIELDNAMES)
    writer.writeheader()
    writer.writerows(sorted(rows, key=lambda row: row["filename"].lower()))
    layout.image_status.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(layout.image_status, buffer.getvalue())


def status_payload(layout: WorkspaceLayout) -> dict[str, Any]:
    """Rows plus the class lists the assign and pool pages need."""
    classes = read_classes(layout)
    clf = [item["key"] for item in classify_classes(classes)]
    return {
        "ok": True,
        "metadataPath": str(layout.image_status),
        "rows": read_status_rows(layout),
        "classes": clf,
        "clfClasses": clf,
        "detectClasses": [{"id": item["id"], "name": item["name"]} for item in detect_classes(classes)],
    }


def _updates_list(updates: object) -> list[dict[str, Any]]:
    if isinstance(updates, str):
        updates = json.loads(updates or "[]")
    if isinstance(updates, dict):
        updates = [updates]
    if not isinstance(updates, list) or not all(isinstance(item, dict) for item in updates):
        raise ValueError("Status updates must be a list of objects.")
    return updates


def upsert_status_rows(layout: WorkspaceLayout, updates: object) -> dict[str, Any]:
    items = _updates_list(updates)
    if not items:
        raise ValueError("No status updates provided.")
    with _lock(layout.image_status):
        by_name = {row["filename"]: row for row in read_status_rows(layout)}
        created = changed = 0
        for item in items:
            filename = Path(str(item.get("filename") or "").replace("\\", "/")).name
            if not filename:
                continue
            row = by_name.get(filename)
            if row is None:
                row = {"filename": filename, **_DEFAULT_ROW}
                created += 1
            else:
                changed += 1
            split = str(item.get("split") or "").strip().lower()
            if split in {"train", "val"}:
                row["split"] = split
            for name in (*_BOOL_FIELDS, *_DEFAULT_TRUE_FIELDS):
                if name in item:
                    row[name] = _flag(item[name])
            if _truthy(item.get("detect_junk")):
                row["detect_enabled"] = "0"
            if "clf_class" in item:
                row["clf_class"] = str(item["clf_class"] or "").strip()
                if row["clf_class"] == JUNK_CLASS:
                    row["clf_enabled"] = "0"
            by_name[filename] = row
        _write_rows(layout, list(by_name.values()))
    return {"ok": True, "metadataPath": str(layout.image_status), "updated": changed, "created": created, "total": len(by_name)}


def remove_status_row(layout: WorkspaceLayout, filename: str) -> bool:
    with _lock(layout.image_status):
        rows = read_status_rows(layout)
        kept = [row for row in rows if row["filename"] != filename]
        if len(kept) == len(rows):
            return False
        _write_rows(layout, kept)
        return True
