"""Export YOLO datasets from a workspace's annotations.

A dataset is a product of the workspace, not part of it: images are copied from
``media/`` (or hard-linked on request, which saves space but means editing an
exported image also edits the workspace's media), labels are copied from
``labels/images/``, and ``data.yaml`` / ``classes.txt`` are generated from
``classes.json``. Each export carries ``rwb-export.json`` recording where it
came from; a rebuild only ever clears folders that carry that file.

Annotated video timestamps (``labels/videos/*.json``) are decoded here, at export
time, and written as frames — frames are never stored in the workspace. A
timestamp goes to detect once its boxes are marked reviewed (an empty reviewed
frame becomes a negative sample), and to classify as soon as it has a class.
Video frames go to the train split; the dataset tools can move some to val.

Layout of an export folder::

    <export>/
      rwb-export.json
      detect/   data.yaml, classes.txt, images/{train,val}, labels/{train,val}
      classify/ {train,val}/<class key>/<image>
"""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .classes_store import classify_classes, detect_classes, read_classes
from .image_status import JUNK_CLASS, read_status_rows
from .workspace_layout import IMAGE_EXTENSIONS, WorkspaceLayout, utc_now_iso

SPLITS = ("train", "val")
DEFAULT_EXPORT_NAME = "dataset"


@dataclass
class ExportStats:
    detect_images: int = 0
    clf_images: int = 0
    video_frames: int = 0
    labels: int = 0
    skipped: int = 0
    link: bool = False
    copied_instead_of_linked: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def export_dirs(layout: WorkspaceLayout, name: str = DEFAULT_EXPORT_NAME, destination: Path | None = None) -> dict[str, Path]:
    root = destination or (layout.exports / name)
    return {"root": root, "detect": root / "detect", "classify": root / "classify"}


def _place_image(src: Path, dest: Path, stats: ExportStats) -> bool:
    if dest.exists():
        try:
            if os.path.samefile(src, dest):
                return False
        except OSError:
            pass
        dest.unlink()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if stats.link:
        try:
            os.link(src, dest)
            return True
        except OSError:
            stats.copied_instead_of_linked += 1  # different drive: hard links are impossible
    shutil.copy2(src, dest)
    return True


def _check_export_root(root: Path) -> None:
    """Refuse to write into a non-empty folder that is not an earlier export."""
    if root.is_dir() and any(root.iterdir()) and not (root / "rwb-export.json").is_file():
        raise ValueError(f"{root} is not empty and is not a RampageWorkbench export; choose an empty folder.")


def _clear(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)


def _usable_rows(layout: WorkspaceLayout, filenames: set[str] | None, stats: ExportStats) -> list[dict[str, Any]]:
    rows = []
    for row in read_status_rows(layout):
        name = row["filename"]
        if filenames is not None and name not in filenames:
            continue
        if Path(name).suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        detect = row["detect_enabled"] == "1" and row["detect_junk"] != "1" and row["detect_export_enabled"] == "1"
        clf_class = row["clf_class"]
        clf = row["clf_enabled"] == "1" and row["clf_export_enabled"] == "1" and clf_class not in ("", JUNK_CLASS)
        if not detect and not clf:
            continue
        source = layout.media / name
        if not source.is_file():
            stats.skipped += 1
            stats.warnings.append(f"{name}: not found in media, skipped.")
            continue
        rows.append({"filename": name, "split": row["split"], "detect": detect, "clf": clf, "clf_class": clf_class, "source": source})
    return rows


def _video_frame_items(layout: WorkspaceLayout, detect_keys: list[str], stats: ExportStats) -> list[dict[str, Any]]:
    """One item per exportable video timestamp: where the frame comes from and what it is labelled."""
    folder = layout.path("videoLabels")
    items: list[dict[str, Any]] = []
    for file in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            manifest = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            stats.warnings.append(f"{file.name}: unreadable video annotation ({error}).")
            continue
        video = manifest.get("video") if isinstance(manifest, dict) else None
        raw = str(video.get("path") or "") if isinstance(video, dict) else ""
        source = Path(raw) if Path(raw).is_absolute() else layout.root / raw
        if not raw or not source.is_file():
            stats.warnings.append(f"{file.name}: video {raw or '(none)'} not found, skipped.")
            continue
        prefix = source.name.replace(".", "_")
        for frame in sorted((manifest.get("frames") or {}).values(), key=lambda item: int(item.get("timestampMs") or 0)):
            tasks = frame.get("tasks") or {}
            detect, clf = tasks.get("detect") or {}, tasks.get("clf") or {}
            ms = int(frame.get("timestampMs") or 0)
            boxes = None
            if detect.get("reviewed") and detect.get("enabled") is not False:
                boxes = []
                for box in detect.get("boxes") or []:
                    key = box.get("classKey")
                    class_id = detect_keys.index(key) if key in detect_keys else box.get("classId")
                    if class_id is None:
                        continue
                    boxes.append((int(class_id), *(float(box[k]) for k in ("x", "y", "w", "h"))))
            clf_key = str(clf.get("classKey") or "").strip() if clf.get("enabled") is not False else ""
            if clf_key == JUNK_CLASS:
                clf_key = ""
            if boxes is None and not clf_key:
                continue
            items.append({"source": source, "seconds": ms / 1000, "name": f"{prefix}_{ms:010d}.jpg", "boxes": boxes, "clf": clf_key})
    return items


def _read_frame(capture: Any, seconds: float) -> Any:
    import cv2

    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    capture.set(cv2.CAP_PROP_POS_FRAMES, int(round(seconds * fps)))
    ok, frame = capture.read()
    if not ok:
        capture.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
        ok, frame = capture.read()
    if not ok or frame is None:
        raise ValueError("cannot decode a frame at this time")
    return frame


def _write_video_frames(items: list[dict[str, Any]], dirs: dict[str, Path], clf_keys: set[str], stats: ExportStats, step: Callable[[str], None]) -> None:
    """Decode each video once (its own capture, released afterwards so the file is not left locked)."""
    import cv2

    by_video: dict[Path, list[dict[str, Any]]] = {}
    for item in items:
        by_video.setdefault(item["source"], []).append(item)
    for source, video_items in by_video.items():
        capture = cv2.VideoCapture(str(source))
        try:
            if not capture.isOpened():
                stats.warnings.append(f"{source.name}: cannot open video, {len(video_items)} frame(s) skipped.")
                stats.skipped += len(video_items)
                for item in video_items:
                    step(item["name"])
                continue
            for item in video_items:
                try:
                    ok, encoded = cv2.imencode(".jpg", _read_frame(capture, item["seconds"]), [int(cv2.IMWRITE_JPEG_QUALITY), 95])
                    if not ok:
                        raise ValueError("JPEG encoding failed")
                except Exception as error:  # a truncated video must not stop the export
                    stats.warnings.append(f"{source.name} @ {item['seconds']:.3f}s: {error}")
                    stats.skipped += 1
                    step(item["name"])
                    continue
                _place_frame(encoded.tobytes(), item, dirs, clf_keys, stats)
                step(item["name"])
        finally:
            capture.release()


def _place_frame(payload: bytes, item: dict[str, Any], dirs: dict[str, Path], clf_keys: set[str], stats: ExportStats) -> None:
    name = item["name"]
    if item["boxes"] is not None:
        (dirs["detect"] / "images" / "train" / name).write_bytes(payload)
        label = "".join(f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}\n" for c, x, y, w, h in item["boxes"])
        (dirs["detect"] / "labels" / "train" / f"{Path(name).stem}.txt").write_text(label, encoding="utf-8")
        stats.detect_images += 1
        stats.labels += 1
    if item["clf"]:
        if item["clf"] not in clf_keys:
            stats.warnings.append(f"{name}: class '{item['clf']}' is not in classes.json.")
        target = dirs["classify"] / "train" / item["clf"] / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        stats.clf_images += 1
    stats.video_frames += 1


def _yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _write_detect_metadata(detect_root: Path, classes: list[dict[str, Any]]) -> None:
    # No "path:" key: Ultralytics then resolves train/val against this file's folder (a relative
    # "path: ." would resolve against the working directory instead).
    lines = ["# Generated by RampageWorkbench from classes.json", "train: images/train", "val: images/val", "names:"]
    lines += [f"  {item['id']}: {_yaml_quote(item['name'])}" for item in classes]
    (detect_root / "data.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (detect_root / "classes.txt").write_text("".join(f"{item['name']}\n" for item in classes), encoding="utf-8")


def export_dataset(
    layout: WorkspaceLayout,
    *,
    name: str = DEFAULT_EXPORT_NAME,
    destination: Path | None = None,
    rebuild: bool = True,
    filenames: list[str] | None = None,
    progress: Callable[[int, int, str], None] | None = None,
    link: bool = False,
    include_videos: bool = True,
) -> dict[str, Any]:
    """Write (or refresh) a YOLO detect + classify dataset from the workspace.

    ``filenames`` limits the export to those media images (an incremental update);
    video frames are only written by a full export."""
    stats = ExportStats(link=link)
    dirs = export_dirs(layout, name, destination)
    _check_export_root(dirs["root"])
    allowed = {Path(str(item).replace("\\", "/")).name for item in filenames} if filenames else None
    rows = _usable_rows(layout, allowed, stats)
    classes = read_classes(layout)
    detect_defs = detect_classes(classes)
    clf_keys = {item["key"] for item in classify_classes(classes, include_archived=True)}

    if rebuild and allowed is None:
        _clear(dirs["detect"])
        _clear(dirs["classify"])
    for split in SPLITS:
        (dirs["detect"] / "images" / split).mkdir(parents=True, exist_ok=True)
        (dirs["detect"] / "labels" / split).mkdir(parents=True, exist_ok=True)

    frames = _video_frame_items(layout, [d["key"] for d in detect_defs], stats) if include_videos and allowed is None else []
    total = max(1, len(rows) + len(frames))
    for index, row in enumerate(rows, start=1):
        name_ = row["filename"]
        split = row["split"]
        if row["detect"]:
            if _place_image(row["source"], dirs["detect"] / "images" / split / name_, stats):
                stats.detect_images += 1
            label = layout.image_label_file(name_)
            dest_label = dirs["detect"] / "labels" / split / label.name
            if label.is_file():
                shutil.copy2(label, dest_label)
            else:
                dest_label.write_text("", encoding="utf-8")  # reviewed image with no objects
            stats.labels += 1
        if row["clf"]:
            if row["clf_class"] not in clf_keys:
                stats.warnings.append(f"{name_}: class '{row['clf_class']}' is not in classes.json.")
            if _place_image(row["source"], dirs["classify"] / split / row["clf_class"] / name_, stats):
                stats.clf_images += 1
        if progress:
            progress(index, total, name_)
    done = len(rows)

    def step(label: str) -> None:
        nonlocal done
        done += 1
        if progress:
            progress(done, total, label)

    _write_video_frames(frames, dirs, clf_keys, stats, step)

    _write_detect_metadata(dirs["detect"], detect_defs)
    manifest = {
        "format": "rwb-export",
        "version": 1,
        "exportedAt": utc_now_iso(),
        "workspace": {"root": str(layout.root), "id": layout.read_manifest().get("id")},
        "detectImages": stats.detect_images,
        "classifyImages": stats.clf_images,
        "videoFrames": stats.video_frames,
    }
    dirs["root"].mkdir(parents=True, exist_ok=True)
    (dirs["root"] / "rwb-export.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if stats.copied_instead_of_linked:
        stats.warnings.append(f"{stats.copied_instead_of_linked} image(s) were copied: the export folder is on another drive.")
    return {
        "ok": not stats.errors,
        "exportRoot": str(dirs["root"]),
        "detectDataset": str(dirs["detect"]),
        "clfDataset": str(dirs["classify"]),
        "detectImages": stats.detect_images,
        "clfImages": stats.clf_images,
        "videoFrames": stats.video_frames,
        "labelsPlaced": stats.labels,
        "skippedRows": stats.skipped,
        "warnings": stats.warnings[:20],
        "errors": stats.errors,
        "builtFilenames": sorted(row["filename"] for row in rows),
    }
