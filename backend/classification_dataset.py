from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .dataset_merge import IMAGE_EXTENSIONS, unique_path


def create_class_folder(root: Path, class_name: str) -> dict[str, Any]:
    root_path = root.resolve()
    if not root_path.is_dir():
        raise NotADirectoryError(f"Dataset folder not found: {root_path}")
    safe_name = _safe_class_name(class_name)
    target = _default_class_dir(root_path, safe_name)
    target.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "className": safe_name, "path": str(target), "relativePath": target.relative_to(root_path).as_posix()}


def move_images_to_class(root: Path, image_paths: list[str], class_name: str) -> dict[str, Any]:
    root_path = root.resolve()
    if not root_path.is_dir():
        raise NotADirectoryError(f"Dataset folder not found: {root_path}")
    safe_name = _safe_class_name(class_name)
    moved = []
    skipped = []
    for relative_path in image_paths:
        try:
            source = _safe_child_path(root_path, relative_path)
            if not source.is_file() or source.suffix.lower() not in IMAGE_EXTENSIONS:
                skipped.append({"path": relative_path, "reason": "Not an image file."})
                continue
            target_dir = _target_class_dir_for_image(root_path, relative_path, safe_name)
            target_dir.mkdir(parents=True, exist_ok=True)
            target = unique_path(target_dir / source.name)
            shutil.move(str(source), str(target))
            _cleanup_empty_parents(source.parent, root_path)
            moved.append({
                "from": relative_path,
                "to": target.relative_to(root_path).as_posix(),
            })
        except Exception as error:
            skipped.append({"path": str(relative_path), "reason": str(error)})
    return {"ok": True, "className": safe_name, "moved": moved, "skipped": skipped}


def _target_class_dir_for_image(root: Path, relative_path: str, class_name: str) -> Path:
    parts = Path(relative_path).as_posix().split("/")
    if len(parts) >= 3 and parts[0] in {"train", "val", "test"}:
        return root / parts[0] / class_name
    return _default_class_dir(root, class_name)


def _default_class_dir(root: Path, class_name: str) -> Path:
    for split in ("train", "val", "test"):
        if (root / split).is_dir():
            return root / split / class_name
    return root / class_name


def _safe_child_path(root: Path, relative_path: str) -> Path:
    target = (root / relative_path).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Path escapes dataset root: {relative_path}")
    return target


def _safe_class_name(class_name: str) -> str:
    value = str(class_name or "").strip()
    if not value:
        raise ValueError("Class folder name is required.")
    for char in '<>:"/\\|?*':
        value = value.replace(char, "_")
    value = value.strip(" .")
    if not value:
        raise ValueError("Class folder name is invalid.")
    return value[:120]


def _cleanup_empty_parents(path: Path, root: Path) -> None:
    current = path
    while current != root and root in current.parents:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def move_val_back_to_train(root: Path) -> dict[str, Any]:
    root_path = root.resolve()
    if not root_path.is_dir():
        raise NotADirectoryError(f"Dataset folder not found: {root_path}")
    val_dir = root_path / "val"
    if not val_dir.is_dir():
        return {
            "ok": False,
            "message": "No val/ folder found in the target. Nothing to move.",
            "scanned": 0,
            "moved": 0,
            "renamed": 0,
            "skipped": 0,
            "failed": 0,
            "removedDirs": 0,
        }

    train_dir = root_path / "train"
    train_dir.mkdir(parents=True, exist_ok=True)
    stats = {"scanned": 0, "moved": 0, "renamed": 0, "skipped": 0, "failed": 0, "removedDirs": 0}
    failures: list[str] = []

    for class_dir in sorted(val_dir.iterdir(), key=lambda path: path.name.lower()):
        if not class_dir.is_dir():
            continue
        safe_class = _safe_class_name(class_dir.name)
        train_class_dir = train_dir / safe_class
        train_class_dir.mkdir(parents=True, exist_ok=True)
        existing_lower = {
            item.name.lower()
            for item in train_class_dir.iterdir()
            if item.is_file()
        }

        for source in sorted(class_dir.iterdir(), key=lambda path: path.name.lower()):
            if not source.is_file() or source.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            stats["scanned"] += 1
            dest_name = source.name
            renamed = False
            if dest_name.lower() in existing_lower:
                candidate = unique_path(train_class_dir / dest_name)
                dest_name = candidate.name
                renamed = True
            target = train_class_dir / dest_name
            try:
                shutil.move(str(source), str(target))
                existing_lower.add(dest_name.lower())
                stats["moved"] += 1
                if renamed:
                    stats["renamed"] += 1
            except Exception as error:
                stats["failed"] += 1
                failures.append(f"val/{safe_class}/{source.name}: {error}")

        try:
            next(class_dir.iterdir())
        except StopIteration:
            try:
                class_dir.rmdir()
                stats["removedDirs"] += 1
            except OSError:
                pass

    summary = (
        f"Val → Train done. moved {stats['moved']}, renamed {stats['renamed']}, failed {stats['failed']}."
    )
    if not stats["scanned"]:
        return {
            "ok": False,
            "message": "Val → Train: val/ is empty (no images).",
            **stats,
            "failures": failures,
        }
    return {
        "ok": stats["failed"] == 0,
        "message": summary,
        **stats,
        "failures": failures,
    }
