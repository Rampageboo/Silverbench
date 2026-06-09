from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .yolo_workspace import IMAGE_EXTENSIONS, load_workspace_config

IMAGE_POOL_BACKUP_DIRNAME = "image_pool_backup"
LABEL_BACKUP_SUBDIR = "labels"


def image_pool_backup_dir(workspace_root: Path) -> Path:
    return workspace_root.expanduser().resolve() / IMAGE_POOL_BACKUP_DIRNAME


def image_pool_backup_file(workspace_root: Path, filename: str) -> Path:
    return image_pool_backup_dir(workspace_root) / Path(filename).name


def image_pool_label_backup_file(workspace_root: Path, label_filename: str) -> Path:
    return image_pool_backup_dir(workspace_root) / LABEL_BACKUP_SUBDIR / Path(label_filename).name


def _pool_filename(image_path: str) -> str:
    name = Path(str(image_path).replace("\\", "/")).name
    if not name:
        raise ValueError("Invalid image path.")
    return name


def _label_filename(label_path: str) -> str:
    name = Path(str(label_path).replace("\\", "/")).name
    if not name:
        raise ValueError("Invalid label path.")
    return name


def ensure_image_pool_backup(workspace_root: Path, image_path: str) -> dict[str, Any]:
    """Copy image_pool source to backup once (keeps the first original)."""
    paths = load_workspace_config(workspace_root)
    normalized = str(image_path).replace("\\", "/")
    if not normalized.startswith("image_pool/"):
        raise ValueError("Only image_pool images can be backed up here.")
    filename = _pool_filename(normalized)

    src = paths.image_pool / filename
    if not src.is_file() or src.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError(f"Image not found in image_pool: {filename}")

    dest = image_pool_backup_file(paths.root, filename)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file():
        return {
            "ok": True,
            "filename": filename,
            "backupPath": str(dest),
            "created": False,
            "alreadyExisted": True,
        }

    shutil.copy2(src, dest)
    return {
        "ok": True,
        "filename": filename,
        "backupPath": str(dest),
        "created": True,
        "alreadyExisted": False,
    }


def ensure_image_pool_label_backup(workspace_root: Path, label_path: str) -> dict[str, Any]:
    """Copy detect_labels txt to backup once before crop edits labels."""
    paths = load_workspace_config(workspace_root)
    filename = _label_filename(label_path)
    if not str(label_path).replace("\\", "/").startswith("detect_labels/"):
        raise ValueError("Only detect_labels files can be backed up here.")

    src = paths.label_source / filename
    if not src.is_file():
        return {
            "ok": True,
            "filename": filename,
            "backupPath": "",
            "created": False,
            "alreadyExisted": False,
            "skipped": True,
            "reason": "label missing",
        }

    dest = image_pool_label_backup_file(paths.root, filename)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file():
        return {
            "ok": True,
            "filename": filename,
            "backupPath": str(dest),
            "created": False,
            "alreadyExisted": True,
            "skipped": False,
        }

    shutil.copy2(src, dest)
    return {
        "ok": True,
        "filename": filename,
        "backupPath": str(dest),
        "created": True,
        "alreadyExisted": False,
        "skipped": False,
    }


def restore_image_pool_backup(workspace_root: Path, image_path: str) -> dict[str, Any]:
    """Restore image_pool file from backup; optionally restore matching label backup."""
    paths = load_workspace_config(workspace_root)
    filename = _pool_filename(image_path)
    image_backup = image_pool_backup_file(paths.root, filename)
    if not image_backup.is_file():
        raise FileNotFoundError(f"No backup for image_pool/{filename}")

    dest_image = paths.image_pool / filename
    dest_image.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image_backup, dest_image)

    restored = {"image": True, "label": False}
    stem = Path(filename).stem
    label_backup = image_pool_label_backup_file(paths.root, f"{stem}.txt")
    label_dest = paths.label_source / f"{stem}.txt"
    if label_backup.is_file() and label_dest.parent.is_dir():
        shutil.copy2(label_backup, label_dest)
        restored["label"] = True

    return {
        "ok": True,
        "filename": filename,
        "imagePath": f"image_pool/{filename}",
        "labelPath": f"detect_labels/{stem}.txt" if restored["label"] else "",
        "restored": restored,
        "backupPath": str(image_backup),
    }


def image_pool_backup_stats(workspace_root: Path) -> dict[str, Any]:
    backup_dir = image_pool_backup_dir(workspace_root)
    if not backup_dir.is_dir():
        return {"ok": True, "imageCount": 0, "labelCount": 0, "backupDir": str(backup_dir)}
    images = [
        path.name
        for path in backup_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    label_dir = backup_dir / LABEL_BACKUP_SUBDIR
    labels = []
    if label_dir.is_dir():
        labels = [path.name for path in label_dir.iterdir() if path.is_file() and path.suffix.lower() == ".txt"]
    return {
        "ok": True,
        "imageCount": len(images),
        "labelCount": len(labels),
        "backupDir": str(backup_dir),
    }
