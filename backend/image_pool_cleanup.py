"""Duplicate detection and complete deletion of media images."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from .image_pool import list_media_images
from .image_pool_backup import discard_backups
from .image_status import read_status_rows, remove_status_row
from .workspace_layout import RELATIVE_PATHS, WorkspaceLayout


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_image_pool_duplicates(layout: WorkspaceLayout) -> dict[str, Any]:
    """Exact duplicate images in media/ (by SHA-256)."""
    images = [layout.media / name for name in list_media_images(layout)]
    with_status = {row["filename"] for row in read_status_rows(layout)}
    by_size: dict[int, list[Path]] = {}
    for image in images:
        by_size.setdefault(image.stat().st_size, []).append(image)
    groups: list[dict[str, Any]] = []
    for size, candidates in by_size.items():
        if len(candidates) < 2:
            continue
        by_hash: dict[str, list[Path]] = {}
        for image in candidates:
            by_hash.setdefault(_sha256_file(image), []).append(image)
        for digest, matches in by_hash.items():
            if len(matches) < 2:
                continue
            names = sorted(path.name for path in matches)
            groups.append({"hash": digest, "size": size, "count": len(names), "filenames": names, "inMetadata": [n for n in names if n in with_status]})
    groups.sort(key=lambda group: (-int(group["count"]), group["filenames"][0]))
    return {
        "ok": True,
        "totalImages": len(images),
        "groupCount": len(groups),
        "duplicateFiles": sum(int(group["count"]) - 1 for group in groups),
        "groups": groups,
    }


def _choose_keeper(filenames: list[str], with_status: set[str]) -> str:
    annotated = sorted(name for name in filenames if name in with_status)
    if annotated:
        return annotated[0]
    return sorted(filenames, key=lambda name: (len(name), name))[0]


def delete_pool_image_completely(layout: WorkspaceLayout, filename: str) -> dict[str, Any]:
    """Delete a media image with everything that belongs to it: label, status row,
    proposals and kept originals. Exported datasets are snapshots and stay as they are."""
    filename = Path(str(filename).replace("\\", "/")).name
    if not filename:
        raise ValueError("Invalid filename.")
    image = layout.media / filename
    if not image.is_file():
        raise FileNotFoundError(f"Image not found in media: {filename}")

    deleted: list[str] = []
    failed: list[dict[str, str]] = []
    for target in (image, layout.image_label_file(filename), layout.path("proposals") / f"{filename}.json"):
        if not target.is_file():
            continue
        try:
            target.unlink()
            deleted.append(layout.relative(target))
        except OSError as error:
            failed.append({"path": layout.relative(target), "error": str(error)})
    extras = []
    if remove_status_row(layout, filename):
        extras.append(f"{RELATIVE_PATHS['imageStatus']} row")
    extras += discard_backups(layout, f"{RELATIVE_PATHS['media']}/{filename}")
    return {"ok": not failed, "filename": filename, "deletedPaths": deleted, "deletedExtras": extras, "failedPaths": failed}


def clear_image_pool_duplicates(layout: WorkspaceLayout) -> dict[str, Any]:
    """Remove duplicate media images, keeping one per content group (an annotated one if any)."""
    with_status = {row["filename"] for row in read_status_rows(layout)}
    scan = find_image_pool_duplicates(layout)
    plan: list[dict[str, Any]] = []
    to_remove: list[str] = []
    for group in scan["groups"]:
        names = list(group["filenames"])
        keeper = _choose_keeper(names, with_status)
        removed = [name for name in names if name != keeper]
        to_remove += removed
        plan.append({"keeper": keeper, "remove": removed, "hash": group["hash"]})
    deleted: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for filename in to_remove:
        try:
            result = delete_pool_image_completely(layout, filename)
            deleted.append(result)
            if result["failedPaths"]:
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
        "scan": {key: scan[key] for key in ("totalImages", "groupCount", "duplicateFiles")},
    }
