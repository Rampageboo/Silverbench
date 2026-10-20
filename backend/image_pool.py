"""Media listing for the image pool: which images exist, which are new, which are used.

"Used" means the image takes part in a task (detect or classify) according to
``labels/images.csv``. "New" means it was added since the pool was last marked
seen; that list lives in ``.rwb/cache/scan.json`` (deleting it only resets the
"new" badges).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .atomic_write import write_text_atomic
from .image_status import JUNK_CLASS, read_status_rows
from .workspace_layout import IMAGE_EXTENSIONS, WorkspaceLayout


def _seen_path(layout: WorkspaceLayout) -> Path:
    return layout.path("scanCache")


def read_seen(layout: WorkspaceLayout) -> dict[str, Any]:
    try:
        data = json.loads(_seen_path(layout).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    known = data.get("knownFiles") if isinstance(data, dict) else None
    return {
        "knownFiles": sorted({str(name) for name in known or [] if name}),
        "updatedAt": str(data.get("updatedAt") or "") if isinstance(data, dict) else "",
    }


def _write_seen(layout: WorkspaceLayout, filenames: list[str]) -> str:
    path = _seen_path(layout)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "knownFiles": sorted(set(filenames)), "updatedAt": datetime.now(timezone.utc).isoformat()}
    write_text_atomic(path, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return str(path)


def list_media_images(layout: WorkspaceLayout) -> list[str]:
    if not layout.media.is_dir():
        return []
    return [p.name for p in sorted(layout.media.iterdir()) if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]


def used_images(layout: WorkspaceLayout) -> set[str]:
    used = set()
    for row in read_status_rows(layout):
        detect = row["detect_enabled"] == "1" and row["detect_junk"] != "1"
        clf = row["clf_enabled"] == "1" and row["clf_class"] not in ("", JUNK_CLASS)
        if detect or clf:
            used.add(row["filename"])
    return used


def scan_image_pool(layout: WorkspaceLayout, *, fast: bool = False) -> dict[str, Any]:
    files = list_media_images(layout)
    seen = read_seen(layout)
    known = set(seen["knownFiles"])
    used = used_images(layout)
    new_files = [name for name in files if name not in known]
    used_files = [name for name in files if name in used]
    return {
        "ok": True,
        "workspaceRoot": str(layout.root),
        "total": len(files),
        "newCount": len(new_files),
        "usedCount": len(used_files),
        "unusedCount": len(files) - len(used_files),
        "snapshotUpdatedAt": seen["updatedAt"],
        "mediaDir": layout.relative(layout.media),
        "files": files,
        "newFiles": new_files,
        "usedFiles": used_files,
        "fast": fast,
        "fromCache": False,
        "usageScanned": True,
    }


def mark_image_pool_seen(layout: WorkspaceLayout) -> dict[str, Any]:
    files = list_media_images(layout)
    return {"ok": True, "markedCount": len(files), "snapshotFile": _write_seen(layout, files)}
