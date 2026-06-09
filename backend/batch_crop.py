from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Literal

from PIL import Image


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
Anchor = Literal["center", "top", "bottom"]
ANCHORS = {"center", "top", "bottom"}
CLASS_ACTIONS = {"center", "top", "bottom", "skip"}


def batch_crop_images(
    input_root: Path,
    output_root: Path,
    target_width: int,
    target_height: int,
    anchor: Anchor = "center",
    class_anchors: dict[str, str] | None = None,
    workers: int | None = None,
) -> dict:
    if not input_root.is_dir():
        raise ValueError(f"Input folder does not exist: {input_root}")
    if target_width <= 0 or target_height <= 0:
        raise ValueError("Target width and height must be positive.")
    if anchor not in ANCHORS:
        raise ValueError(f"Unknown anchor: {anchor}")
    anchors_by_class = {
        str(class_name): str(class_anchor)
        for class_name, class_anchor in (class_anchors or {}).items()
        if str(class_anchor) in CLASS_ACTIONS
    }
    output_root.mkdir(parents=True, exist_ok=True)

    stats = {
        "inputDir": str(input_root),
        "outputDir": str(output_root),
        "targetWidth": target_width,
        "targetHeight": target_height,
        "anchor": anchor,
        "classAnchors": anchors_by_class,
        "workers": 0,
        "perClass": {},
        "total": 0,
        "cropped": 0,
        "skipped": 0,
        "errors": [],
    }
    image_paths = [
        path
        for path in sorted(input_root.rglob("*"))
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    stats["total"] = len(image_paths)
    worker_count = _worker_count(workers, len(image_paths))
    stats["workers"] = worker_count

    if worker_count <= 1:
        results = [
            _crop_one(path, input_root, output_root, target_width, target_height, anchor, anchors_by_class)
            for path in image_paths
        ]
    else:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    _crop_one,
                    path,
                    input_root,
                    output_root,
                    target_width,
                    target_height,
                    anchor,
                    anchors_by_class,
                )
                for path in image_paths
            ]
            results = [future.result() for future in as_completed(futures)]

    return _summarize_crop_results(stats, results)


def batch_crop_files(
    files: list[dict],
    output_root: Path,
    target_width: int,
    target_height: int,
    anchor: Anchor = "center",
    class_anchors: dict[str, str] | None = None,
    workers: int | None = None,
) -> dict:
    if target_width <= 0 or target_height <= 0:
        raise ValueError("Target width and height must be positive.")
    if anchor not in ANCHORS:
        raise ValueError(f"Unknown anchor: {anchor}")
    anchors_by_class = {
        str(class_name): str(class_anchor)
        for class_name, class_anchor in (class_anchors or {}).items()
        if str(class_anchor) in CLASS_ACTIONS
    }
    output_root.mkdir(parents=True, exist_ok=True)

    entries: list[tuple[Path, str, str]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        path = Path(str(item.get("path") or "")).expanduser()
        relative = str(item.get("relative") or "").replace("\\", "/").strip()
        class_name = str(item.get("className") or "")
        if not relative or not path.is_file():
            continue
        entries.append((path.resolve(), relative, class_name))

    stats = {
        "inputDir": "",
        "outputDir": str(output_root),
        "targetWidth": target_width,
        "targetHeight": target_height,
        "anchor": anchor,
        "classAnchors": anchors_by_class,
        "workers": 0,
        "perClass": {},
        "total": len(entries),
        "cropped": 0,
        "skipped": 0,
        "errors": [],
    }
    worker_count = _worker_count(workers, len(entries))
    stats["workers"] = worker_count

    if worker_count <= 1:
        results = [
            _crop_one_file(path, relative, class_name, output_root, target_width, target_height, anchor, anchors_by_class)
            for path, relative, class_name in entries
        ]
    else:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    _crop_one_file,
                    path,
                    relative,
                    class_name,
                    output_root,
                    target_width,
                    target_height,
                    anchor,
                    anchors_by_class,
                )
                for path, relative, class_name in entries
            ]
            results = [future.result() for future in as_completed(futures)]

    return _summarize_crop_results(stats, results)


def _summarize_crop_results(stats: dict, results: list[dict]) -> dict:
    for result in results:
        class_name = result["className"]
        class_stats = stats["perClass"].setdefault(
            class_name or "",
            {"anchor": result["anchor"], "total": 0, "cropped": 0, "skipped": 0},
        )
        class_stats["anchor"] = result["anchor"]
        class_stats["total"] += 1
        if result["ok"]:
            stats["cropped"] += 1
            class_stats["cropped"] += 1
        else:
            stats["skipped"] += 1
            class_stats["skipped"] += 1
            if not result.get("skippedByClass"):
                stats["errors"].append({"path": result["relativePath"], "error": result["error"]})
    return stats


def _crop_one(
    path: Path,
    input_root: Path,
    output_root: Path,
    target_width: int,
    target_height: int,
    anchor: Anchor,
    anchors_by_class: dict[str, str],
) -> dict:
    relative = path.relative_to(input_root)
    class_name = _class_name_from_relative(relative)
    return _crop_one_file(
        path,
        relative.as_posix(),
        class_name,
        output_root,
        target_width,
        target_height,
        anchor,
        anchors_by_class,
    )


def _crop_one_file(
    path: Path,
    relative: str,
    class_name: str,
    output_root: Path,
    target_width: int,
    target_height: int,
    anchor: Anchor,
    anchors_by_class: dict[str, str],
) -> dict:
    target = output_root / Path(relative)
    image_anchor = anchors_by_class.get(class_name, anchor)
    result = {
        "relativePath": relative,
        "className": class_name,
        "anchor": image_anchor,
        "skippedByClass": image_anchor == "skip",
        "ok": False,
        "error": "",
    }
    if image_anchor == "skip":
        result["error"] = "class skipped"
        return result
    try:
        with Image.open(path) as image:
            image = image.convert("RGB") if path.suffix.lower() in {".jpg", ".jpeg"} else image.copy()
            if image.width < target_width or image.height < target_height:
                result["error"] = f"too small: {image.width}x{image.height}"
                return result
            left = max(0, (image.width - target_width) // 2)
            if image_anchor == "top":
                top = 0
            elif image_anchor == "bottom":
                top = image.height - target_height
            else:
                top = max(0, (image.height - target_height) // 2)
            cropped = image.crop((left, top, left + target_width, top + target_height))
            target.parent.mkdir(parents=True, exist_ok=True)
            cropped.save(target)
            result["ok"] = True
            return result
    except Exception as error:
        result["error"] = str(error)
        return result


def _worker_count(workers: int | None, total: int) -> int:
    if total <= 1:
        return 1
    if workers and workers > 0:
        return min(workers, total)
    cpu_count = os.cpu_count() or 4
    return min(total, max(2, min(16, cpu_count * 2)))


def _class_name_from_relative(relative: Path) -> str:
    parts = relative.parts
    if len(parts) >= 3 and parts[0] in {"train", "val", "test"}:
        return parts[1]
    return parts[0] if len(parts) >= 2 else ""
