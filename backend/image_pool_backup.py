"""Originals kept before destructive edits (crop, blackout), in ``backups/originals/``.

``files/<workspace-relative path>`` holds the first original of an edited file and
``labels/<workspace-relative path>`` the label that went with it. Only the first
original is kept, so repeated edits can always be undone back to the source.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .workspace_layout import IMAGE_EXTENSIONS, WorkspaceLayout, label_candidates

FILES_SUBDIR = "files"
LABELS_SUBDIR = "labels"


def _safe_relative_path(relative_path: str) -> Path:
    normalized = str(relative_path).replace("\\", "/").lstrip("/")
    path = Path(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError("Invalid workspace-relative path.")
    return path


def _workspace_file(layout: WorkspaceLayout, relative_path: str) -> Path:
    root = layout.root.resolve()
    target = (root / _safe_relative_path(relative_path)).resolve()
    if root not in target.parents:
        raise ValueError("Path escapes workspace root.")
    return target


def original_file(layout: WorkspaceLayout, relative_path: str) -> Path:
    return layout.originals / FILES_SUBDIR / _safe_relative_path(relative_path)


def original_label_file(layout: WorkspaceLayout, relative_path: str) -> Path:
    return layout.originals / LABELS_SUBDIR / _safe_relative_path(relative_path)


def _copy_once(src: Path, dest: Path) -> bool:
    if dest.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def ensure_image_backup(layout: WorkspaceLayout, image_path: str) -> dict[str, Any]:
    normalized = str(image_path).replace("\\", "/")
    src = _workspace_file(layout, normalized)
    if not src.is_file() or src.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError(f"Image not found in workspace: {normalized}")
    dest = original_file(layout, normalized)
    created = _copy_once(src, dest)
    return {"ok": True, "imagePath": normalized, "backupPath": str(dest), "created": created, "alreadyExisted": not created}


def ensure_label_backup(layout: WorkspaceLayout, label_path: str) -> dict[str, Any]:
    normalized = str(label_path).replace("\\", "/")
    src = _workspace_file(layout, normalized)
    if not src.is_file():
        return {
            "ok": True,
            "labelPath": normalized,
            "backupPath": "",
            "created": False,
            "alreadyExisted": False,
            "skipped": True,
            "reason": "label missing",
        }
    dest = original_label_file(layout, normalized)
    created = _copy_once(src, dest)
    return {"ok": True, "labelPath": normalized, "backupPath": str(dest), "created": created, "alreadyExisted": not created, "skipped": False}


def restore_image_backup(layout: WorkspaceLayout, image_path: str) -> dict[str, Any]:
    """Restore an image (and its label, when one was kept) from the originals."""
    normalized = str(image_path).replace("\\", "/")
    image_backup = original_file(layout, normalized)
    if not image_backup.is_file():
        raise FileNotFoundError(f"No original kept for {normalized}")
    dest_image = _workspace_file(layout, normalized)
    dest_image.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image_backup, dest_image)

    label_path = ""
    for candidate in label_candidates(normalized):
        label_backup = original_label_file(layout, candidate)
        if label_backup.is_file():
            destination = _workspace_file(layout, candidate)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(label_backup, destination)
            label_path = candidate
            break
    return {
        "ok": True,
        "imagePath": normalized,
        "labelPath": label_path,
        "restored": {"image": True, "label": bool(label_path)},
        "backupPath": str(image_backup),
    }


def discard_backups(layout: WorkspaceLayout, image_path: str) -> list[str]:
    """Remove the originals kept for an image (used when the image itself is deleted)."""
    normalized = str(image_path).replace("\\", "/")
    removed = []
    for candidate in [original_file(layout, normalized), *(original_label_file(layout, c) for c in label_candidates(normalized))]:
        if candidate.is_file():
            candidate.unlink()
            removed.append(layout.relative(candidate))
    return removed


def backup_stats(layout: WorkspaceLayout) -> dict[str, Any]:
    files = layout.originals / FILES_SUBDIR
    labels = layout.originals / LABELS_SUBDIR
    images = [p for p in files.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS] if files.is_dir() else []
    label_files = [p for p in labels.rglob("*.txt") if p.is_file()] if labels.is_dir() else []
    return {"ok": True, "imageCount": len(images), "labelCount": len(label_files), "backupDir": str(layout.originals)}
