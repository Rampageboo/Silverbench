from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .yolo_workspace import IMAGE_EXTENSIONS

IMAGE_POOL_BACKUP_DIRNAME = "image_pool_backup"
LABEL_BACKUP_SUBDIR = "labels"
FILES_BACKUP_SUBDIR = "files"


def image_pool_backup_dir(workspace_root: Path) -> Path:
    return workspace_root.expanduser().resolve() / IMAGE_POOL_BACKUP_DIRNAME


def _basename(value: str, *, error_message: str) -> str:
    name = Path(str(value).replace("\\", "/")).name
    if not name:
        raise ValueError(error_message)
    return name


def image_pool_backup_file(workspace_root: Path, filename: str) -> Path:
    return image_pool_backup_dir(workspace_root) / _basename(filename, error_message="Invalid image path.")


def generic_backup_file(workspace_root: Path, relative_path: str) -> Path:
    return image_pool_backup_dir(workspace_root) / FILES_BACKUP_SUBDIR / _safe_relative_path(relative_path)


def generic_label_backup_file(workspace_root: Path, relative_path: str) -> Path:
    return image_pool_backup_dir(workspace_root) / LABEL_BACKUP_SUBDIR / _safe_relative_path(relative_path)


def image_pool_label_backup_file(workspace_root: Path, label_filename: str) -> Path:
    return image_pool_backup_dir(workspace_root) / LABEL_BACKUP_SUBDIR / _basename(
        label_filename,
        error_message="Invalid label path.",
    )


def _safe_relative_path(relative_path: str) -> Path:
    normalized = str(relative_path).replace("\\", "/").lstrip("/")
    path = Path(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError("Invalid workspace-relative path.")
    return path


def _workspace_file(root: Path, relative_path: str) -> Path:
    rel = _safe_relative_path(relative_path)
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("Path escapes workspace root.") from error
    return target


def _pool_filename(image_path: str) -> str:
    return _basename(image_path, error_message="Invalid image path.")


def _allows_flat_pool_backup_fallback(image_path: str) -> bool:
    first = Path(image_path).parts[0] if Path(image_path).parts else ""
    return first in {"image_pool", "media"}


def ensure_image_pool_backup(workspace_root: Path, image_path: str) -> dict[str, Any]:
    """Copy a workspace image to backup once (keeps the first original).

    Historical API name is kept for compatibility. New backups preserve the
    workspace-relative path under image_pool_backup/files/. Old image_pool
    backups at image_pool_backup/<filename> are still recognized.
    """
    root = workspace_root.expanduser().resolve()
    normalized = str(image_path).replace("\\", "/")
    src = _workspace_file(root, normalized)

    if not src.is_file() or src.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError(f"Image not found in workspace: {normalized}")

    dest = generic_backup_file(root, normalized)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file():
        return {
            "ok": True,
            "imagePath": normalized,
            "backupPath": str(dest),
            "created": False,
            "alreadyExisted": True,
        }

    shutil.copy2(src, dest)
    return {
        "ok": True,
        "imagePath": normalized,
        "backupPath": str(dest),
        "created": True,
        "alreadyExisted": False,
    }


def ensure_image_pool_label_backup(workspace_root: Path, label_path: str) -> dict[str, Any]:
    """Copy a workspace label to backup once before image edits mutate labels."""
    root = workspace_root.expanduser().resolve()
    normalized = str(label_path).replace("\\", "/")
    src = _workspace_file(root, normalized)
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

    dest = generic_label_backup_file(root, normalized)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file():
        return {
            "ok": True,
            "labelPath": normalized,
            "backupPath": str(dest),
            "created": False,
            "alreadyExisted": True,
            "skipped": False,
        }

    shutil.copy2(src, dest)
    return {
        "ok": True,
        "labelPath": normalized,
        "backupPath": str(dest),
        "created": True,
        "alreadyExisted": False,
        "skipped": False,
    }


def restore_image_pool_backup(workspace_root: Path, image_path: str) -> dict[str, Any]:
    """Restore a workspace image from backup; optionally restore matching label."""
    root = workspace_root.expanduser().resolve()
    normalized = str(image_path).replace("\\", "/")
    image_backup = generic_backup_file(root, normalized)
    allow_flat_fallback = _allows_flat_pool_backup_fallback(normalized)
    if not image_backup.is_file() and allow_flat_fallback:
        image_backup = image_pool_backup_file(root, _pool_filename(normalized))
    if not image_backup.is_file():
        raise FileNotFoundError(f"No backup for {normalized}")

    dest_image = _workspace_file(root, normalized)
    dest_image.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image_backup, dest_image)

    restored = {"image": True, "label": False}
    label_path = ""
    stem = Path(normalized).stem
    label_candidates = [
        f"{Path(normalized).with_suffix('.txt').as_posix()}",
        f"detect_labels/{stem}.txt",
        f"labels/{stem}.txt",
    ]
    if "/images/" in normalized:
        label_candidates.insert(1, str(Path(normalized.replace("/images/", "/labels/")).with_suffix(".txt")).replace("\\", "/"))
    if normalized.startswith("images/"):
        label_candidates.insert(1, str(Path(normalized.replace("images/", "labels/", 1)).with_suffix(".txt")).replace("\\", "/"))
    for candidate in label_candidates:
        try:
            label_backup = generic_label_backup_file(root, candidate)
            label_dest = _workspace_file(root, candidate)
        except ValueError:
            continue
        if label_backup.is_file() and label_dest.parent.is_dir():
            shutil.copy2(label_backup, label_dest)
            restored["label"] = True
            label_path = candidate
            break
    if not restored["label"] and allow_flat_fallback:
        old_label_backup = image_pool_label_backup_file(root, f"{stem}.txt")
        old_label_dest = root / "detect_labels" / f"{stem}.txt"
        if old_label_backup.is_file() and old_label_dest.parent.is_dir():
            shutil.copy2(old_label_backup, old_label_dest)
            restored["label"] = True
            label_path = f"detect_labels/{stem}.txt"

    return {
        "ok": True,
        "imagePath": normalized,
        "labelPath": label_path,
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
    files_dir = backup_dir / FILES_BACKUP_SUBDIR
    generic_images = []
    if files_dir.is_dir():
        generic_images = [
            path.relative_to(files_dir).as_posix()
            for path in files_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ]
    label_dir = backup_dir / LABEL_BACKUP_SUBDIR
    labels = []
    if label_dir.is_dir():
        labels = [path.name for path in label_dir.iterdir() if path.is_file() and path.suffix.lower() == ".txt"]
    return {
        "ok": True,
        "imageCount": len(images) + len(generic_images),
        "labelCount": len(labels),
        "backupDir": str(backup_dir),
    }
