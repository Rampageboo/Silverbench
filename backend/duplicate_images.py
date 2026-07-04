from __future__ import annotations

import hashlib
import random
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from .dataset_merge import IMAGE_EXTENSIONS, unique_path


def find_duplicate_images(root: Path) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"Dataset root does not exist: {root}")

    by_size: dict[int, list[Path]] = {}
    total_images = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        relative = path.relative_to(root).as_posix()
        if "originals_before_edit" in relative.lower():
            continue
        total_images += 1
        by_size.setdefault(path.stat().st_size, []).append(path)

    groups: list[dict[str, Any]] = []
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        by_hash: dict[str, list[Path]] = {}
        for path in paths:
            digest = _sha256_file(path)
            by_hash.setdefault(digest, []).append(path)
        for digest, matches in by_hash.items():
            if len(matches) < 2:
                continue
            rel_paths = sorted(path.relative_to(root).as_posix() for path in matches)
            groups.append(
                {
                    "hash": digest,
                    "size": size,
                    "count": len(rel_paths),
                    "paths": rel_paths,
                }
            )

    groups.sort(key=lambda group: (-int(group["count"]), group["paths"][0]))
    duplicate_files = sum(int(group["count"]) - 1 for group in groups)
    return {
        "totalImages": total_images,
        "groupCount": len(groups),
        "duplicateFiles": duplicate_files,
        "groups": groups,
    }


def duplicate_images(
    root: Path,
    image_paths: list[str],
    min_copies: float,
    max_copies: float,
) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"Dataset root does not exist: {root}")
    low = max(0.0, float(min_copies))
    high = max(0.0, float(max_copies))
    if high < low:
        low, high = high, low

    created_images: list[str] = []
    created_labels: list[str] = []
    skipped: list[str] = []
    per_image: list[dict[str, Any]] = []

    for relative in image_paths:
        image_path = _safe_child_path(root, relative)
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            skipped.append(relative)
            continue
        copies = _random_copy_count(low, high)
        if copies <= 0:
            per_image.append({"image": relative, "copies": 0, "created": []})
            continue
        label_path = _label_path_for(root, relative)
        made_for_image: list[str] = []
        for index in range(copies):
            suffix = f"_dup{index + 1}_{random.randrange(36**4):04x}"
            target_image = unique_path(image_path.with_name(f"{image_path.stem}{suffix}{image_path.suffix}"))
            shutil.copy2(image_path, target_image)
            rel_image = target_image.relative_to(root).as_posix()
            created_images.append(rel_image)
            made_for_image.append(rel_image)
            if label_path and label_path.is_file():
                target_label = target_image.with_suffix(".txt")
                if "images" in target_image.parts:
                    target_label = _image_to_label_path(root, target_image)
                target_label.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(label_path, target_label)
                created_labels.append(target_label.relative_to(root).as_posix())
        per_image.append({"image": relative, "copies": copies, "created": made_for_image})

    return {
        "sourceImages": len(image_paths),
        "createdImages": len(created_images),
        "createdLabels": len(created_labels),
        "skipped": skipped,
        "created": created_images,
        "perImage": per_image,
    }


def delete_images(root: Path, image_paths: list[str]) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"Dataset root does not exist: {root}")

    deleted_images: list[str] = []
    deleted_labels: list[str] = []
    skipped: list[str] = []
    stamp = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{random.randrange(36**4):04x}"
    backup_root = root / "originals_before_edit" / f"deleted_{stamp}"

    for relative in image_paths:
        image_path = _safe_child_path(root, relative)
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            skipped.append(relative)
            continue
        label_path = _label_path_for(root, relative)
        backup_image = unique_path(backup_root / image_path.relative_to(root))
        backup_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(image_path), str(backup_image))
        deleted_images.append(relative)
        if label_path and label_path.is_file():
            backup_label = unique_path(backup_root / label_path.relative_to(root))
            backup_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(label_path), str(backup_label))
            deleted_labels.append(label_path.relative_to(root).as_posix())

    return {
        "requested": len(image_paths),
        "deletedImages": len(deleted_images),
        "deletedLabels": len(deleted_labels),
        "skipped": skipped,
        "deleted": deleted_images,
        "backupRoot": str(backup_root) if deleted_images or deleted_labels else "",
    }


def _random_copy_count(low: float, high: float) -> int:
    sample = random.uniform(low, high)
    base = int(sample)
    return base + (1 if random.random() < sample - base else 0)


def _safe_child_path(root: Path, relative_path: str) -> Path:
    root_path = root.resolve()
    target = (root_path / relative_path).resolve()
    if target != root_path and root_path not in target.parents:
        raise ValueError(f"Path escapes dataset root: {relative_path}")
    return target


def _label_path_for(root: Path, image_relative: str) -> Path | None:
    image_path = _safe_child_path(root, image_relative)
    candidates = [_image_to_label_path(root, image_path), image_path.with_suffix(".txt")]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _image_to_label_path(root: Path, image_path: Path) -> Path:
    rel_parts = image_path.relative_to(root).parts
    parts = list(rel_parts)
    for index, part in enumerate(parts):
        if part == "images":
            parts[index] = "labels"
            break
    return root.joinpath(*parts).with_suffix(".txt")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
