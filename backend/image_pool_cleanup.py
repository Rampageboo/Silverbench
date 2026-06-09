from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Any

from .image_pool import _build_hardlink_index, _file_identity, _list_pool_images
from .image_pool_backup import image_pool_backup_file, image_pool_label_backup_file
from .yolo_workspace import IMAGE_EXTENSIONS, load_workspace_config


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_metadata_filenames(metadata_path: Path) -> set[str]:
    if not metadata_path.is_file():
        return set()
    with metadata_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return {
            (row.get("filename") or row.get("Filename") or "").strip()
            for row in reader
            if (row.get("filename") or row.get("Filename") or "").strip()
        }


def find_image_pool_duplicates(workspace_root: Path) -> dict[str, Any]:
    """Find exact duplicate files inside image_pool/ only (by SHA-256)."""
    paths = load_workspace_config(workspace_root)
    pool_images = _list_pool_images(paths.image_pool)
    metadata_names = _read_metadata_filenames(paths.metadata)

    by_size: dict[int, list[Path]] = {}
    for pool_file in pool_images:
        by_size.setdefault(pool_file.stat().st_size, []).append(pool_file)

    groups: list[dict[str, Any]] = []
    for size, candidates in by_size.items():
        if len(candidates) < 2:
            continue
        by_hash: dict[str, list[Path]] = {}
        for pool_file in candidates:
            by_hash.setdefault(_sha256_file(pool_file), []).append(pool_file)
        for digest, matches in by_hash.items():
            if len(matches) < 2:
                continue
            filenames = sorted(path.name for path in matches)
            groups.append(
                {
                    "hash": digest,
                    "size": size,
                    "count": len(filenames),
                    "filenames": filenames,
                    "inMetadata": [name for name in filenames if name in metadata_names],
                }
            )

    groups.sort(key=lambda group: (-int(group["count"]), group["filenames"][0]))
    duplicate_files = sum(int(group["count"]) - 1 for group in groups)
    return {
        "ok": True,
        "totalImages": len(pool_images),
        "groupCount": len(groups),
        "duplicateFiles": duplicate_files,
        "groups": groups,
    }


def _choose_keeper(filenames: list[str], metadata_names: set[str]) -> str:
    in_meta = [name for name in filenames if name in metadata_names]
    if len(in_meta) == 1:
        return in_meta[0]
    if in_meta:
        return sorted(in_meta)[0]
    return sorted(filenames, key=lambda name: (len(name), name))[0]


def _collect_paths_for_pool_file(
    workspace_root: Path,
    pool_file: Path,
    hardlink_index: dict[tuple[int, int], list[str]],
) -> list[Path]:
    root = workspace_root.expanduser().resolve()
    identity = _file_identity(pool_file)
    rel_paths: list[str] = [f"image_pool/{pool_file.name}"]
    if identity is not None:
        rel_paths.extend(hardlink_index.get(identity, []))
    unique: list[Path] = []
    seen: set[str] = set()
    for rel in rel_paths:
        key = rel.replace("\\", "/")
        if key in seen:
            continue
        seen.add(key)
        absolute = (root / key).resolve()
        if absolute.is_file():
            unique.append(absolute)
    return unique


def _remove_metadata_row(metadata_path: Path, filename: str) -> bool:
    if not metadata_path.is_file():
        return False
    with metadata_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    if not fieldnames:
        return False
    kept = [row for row in rows if (row.get("filename") or "").strip() != filename]
    if len(kept) == len(rows):
        return False
    with metadata_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(kept)
    return True


def delete_pool_image_completely(workspace_root: Path, filename: str) -> dict[str, Any]:
    """
    Delete an image_pool file and every hard-linked dataset path sharing its inode.
    Also removes detect_labels, metadata.csv row, and image_pool_backup copies.
    """
    paths = load_workspace_config(workspace_root)
    root = paths.root
    filename = Path(str(filename).replace("\\", "/")).name
    if not filename:
        raise ValueError("Invalid filename.")

    pool_file = paths.image_pool / filename
    if not pool_file.is_file():
        raise FileNotFoundError(f"Image not found in image_pool: {filename}")

    hardlink_index = _build_hardlink_index(root, paths.detect_out, paths.clf_out)
    to_delete = _collect_paths_for_pool_file(root, pool_file, hardlink_index)

    deleted_paths: list[str] = []
    failed_paths: list[dict[str, str]] = []
    for path in to_delete:
        rel = path.relative_to(root).as_posix()
        try:
            path.unlink()
            deleted_paths.append(rel)
        except OSError as error:
            failed_paths.append({"path": rel, "error": str(error)})

    stem = Path(filename).stem
    extras: list[str] = []

    label_file = paths.label_source / f"{stem}.txt"
    if label_file.is_file():
        try:
            label_file.unlink()
            extras.append(f"detect_labels/{stem}.txt")
        except OSError as error:
            failed_paths.append({"path": f"detect_labels/{stem}.txt", "error": str(error)})

    if _remove_metadata_row(paths.metadata, filename):
        extras.append("metadata.csv row")

    for backup in (
        image_pool_backup_file(root, filename),
        image_pool_label_backup_file(root, f"{stem}.txt"),
    ):
        if backup.is_file():
            try:
                backup.unlink()
                extras.append(backup.relative_to(root).as_posix())
            except OSError as error:
                failed_paths.append({"path": backup.relative_to(root).as_posix(), "error": str(error)})

    return {
        "ok": not failed_paths,
        "filename": filename,
        "deletedPaths": deleted_paths,
        "deletedExtras": extras,
        "failedPaths": failed_paths,
    }


def clear_image_pool_duplicates(workspace_root: Path) -> dict[str, Any]:
    """Remove duplicate image_pool files; keep one per content hash group."""
    paths = load_workspace_config(workspace_root)
    metadata_names = _read_metadata_filenames(paths.metadata)
    scan = find_image_pool_duplicates(workspace_root)
    groups = scan.get("groups") or []

    to_remove: list[str] = []
    plan: list[dict[str, Any]] = []
    for group in groups:
        filenames = list(group.get("filenames") or [])
        if len(filenames) < 2:
            continue
        keeper = _choose_keeper(filenames, metadata_names)
        removed = [name for name in filenames if name != keeper]
        to_remove.extend(removed)
        plan.append({"keeper": keeper, "remove": removed, "hash": group.get("hash", "")})

    deleted: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for filename in to_remove:
        try:
            result = delete_pool_image_completely(workspace_root, filename)
            deleted.append(result)
            if result.get("failedPaths"):
                failed.append({"filename": filename, "failedPaths": result["failedPaths"]})
        except (FileNotFoundError, ValueError, OSError) as error:
            failed.append({"filename": filename, "error": str(error)})

    return {
        "ok": not failed,
        "groupsProcessed": len(plan),
        "removedCount": len(to_remove),
        "plan": plan,
        "deleted": deleted,
        "failed": failed,
        "scan": {
            "totalImages": scan.get("totalImages", 0),
            "groupCount": scan.get("groupCount", 0),
            "duplicateFiles": scan.get("duplicateFiles", 0),
        },
    }
