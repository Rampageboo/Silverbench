from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


@dataclass
class YoloBox:
    classId: int
    x: float
    y: float
    w: float
    h: float


def parse_label_text(text: str) -> list[YoloBox]:
    boxes: list[YoloBox] = []
    for raw in text.splitlines():
        parts = raw.strip().split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(float(parts[0]))
            x, y, w, h = (float(value) for value in parts[1:5])
        except ValueError:
            continue
        boxes.append(YoloBox(class_id, _clamp01(x), _clamp01(y), _clamp01(w), _clamp01(h)))
    return boxes


def boxes_to_text(boxes: list[YoloBox]) -> str:
    return "".join(f"{box.classId} {box.x:.6f} {box.y:.6f} {box.w:.6f} {box.h:.6f}\n" for box in boxes)


def label_path_for(root: Path, image_path: str) -> Path:
    image_rel = Path(image_path.replace("\\", "/"))
    stem = image_rel.stem
    parts = image_rel.parts
    candidates: list[Path] = []
    if parts and parts[0] in {"image_pool", "media"}:
        candidates.append(Path("detect_labels") / f"{stem}.txt")
    if parts and parts[0] == "images":
        candidates.append(Path("labels").joinpath(*parts[1:]).with_suffix(".txt"))
    candidates.extend(
        [
            Path("labels") / "train" / f"{stem}.txt",
            Path("labels") / "val" / f"{stem}.txt",
            Path("labels") / f"{stem}.txt",
            image_rel.with_suffix(".txt"),
        ]
    )
    for candidate in candidates:
        if (root / candidate).is_file():
            return root / candidate
    return root / candidates[0]


def track_yolo_forward(
    root: Path,
    start_image_path: str,
    start_box: dict[str, Any],
    ordered_image_paths: list[str],
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    options = options or {}
    try:
        import cv2  # type: ignore
    except ImportError as error:
        return {
            "ok": False,
            "saved": 0,
            "stoppedAt": start_image_path,
            "reason": "OpenCV is not installed. Install opencv-contrib-python for CSRT tracking.",
            "error": str(error),
        }

    tracker_factory = getattr(cv2, "TrackerCSRT_create", None)
    if tracker_factory is None and hasattr(cv2, "legacy"):
        tracker_factory = getattr(cv2.legacy, "TrackerCSRT_create", None)
    if tracker_factory is None:
        return {
            "ok": False,
            "saved": 0,
            "stoppedAt": start_image_path,
            "reason": "CSRT tracker is unavailable. Install opencv-contrib-python, not only opencv-python.",
        }

    if start_image_path not in ordered_image_paths:
        ordered_image_paths = [start_image_path, *ordered_image_paths]
    start_index = ordered_image_paths.index(start_image_path)
    forward_paths = ordered_image_paths[start_index:]
    max_frames = _positive_int(options.get("maxFrames"), len(forward_paths) - 1)
    if max_frames < len(forward_paths) - 1:
        forward_paths = forward_paths[: max_frames + 1]
    if len(forward_paths) < 2:
        return {"ok": True, "saved": 0, "stoppedAt": start_image_path, "reason": "No following frame.", "lastBox": start_box}

    first_path = _safe_child(root, forward_paths[0])
    first_frame = cv2.imread(str(first_path))
    if first_frame is None:
        return {"ok": False, "saved": 0, "stoppedAt": forward_paths[0], "reason": "Could not read start image."}

    image_h, image_w = first_frame.shape[:2]
    box = _dict_to_box(start_box)
    rect = _box_to_cv_rect(box, image_w, image_h)
    if rect[2] < 2 or rect[3] < 2:
        return {"ok": False, "saved": 0, "stoppedAt": forward_paths[0], "reason": "Selected box is too small."}

    tracker = tracker_factory()
    try:
        tracker.init(first_frame, rect)
    except Exception as error:
        return {
            "ok": False,
            "saved": 0,
            "stoppedAt": forward_paths[0],
            "reason": f"Could not start CSRT tracker: {error}",
            "lastBox": _box_to_dict(box),
        }
    initial_area = max(1.0, rect[2] * rect[3])
    previous_rect = rect
    last_box = box
    saved = 0
    stopped_at = forward_paths[0]
    reason = "Reached frame limit." if max_frames < len(ordered_image_paths[start_index:]) - 1 else "Reached final frame."
    area_min = float(options.get("areaMinRatio", 0.4))
    area_max = float(options.get("areaMaxRatio", 2.5))
    center_jump = float(options.get("centerJumpRatio", 1.5))

    for image_path in forward_paths[1:]:
        frame_path = _safe_child(root, image_path)
        frame = cv2.imread(str(frame_path))
        if frame is None:
            stopped_at = image_path
            reason = "Could not read image."
            break
        ok, tracked = tracker.update(frame)
        if not ok:
            stopped_at = image_path
            reason = "Tracker failed."
            break
        image_h, image_w = frame.shape[:2]
        rect = tuple(float(value) for value in tracked)
        valid, reason = _validate_rect(rect, previous_rect, image_w, image_h, initial_area, area_min, area_max, center_jump)
        stopped_at = image_path
        if not valid:
            break
        last_box = _rect_to_box(rect, image_w, image_h, box.classId)
        _merge_box_into_label(root, image_path, last_box)
        saved += 1
        previous_rect = rect
    return {
        "ok": True,
        "saved": saved,
        "stoppedAt": stopped_at,
        "reason": reason,
        "lastBox": _box_to_dict(last_box),
    }


def _merge_box_into_label(root: Path, image_path: str, box: YoloBox) -> None:
    label_path = label_path_for(root, image_path)
    boxes = parse_label_text(label_path.read_text(encoding="utf-8", errors="replace") if label_path.is_file() else "")
    same_class = [index for index, existing in enumerate(boxes) if existing.classId == box.classId]
    if same_class:
        best = min(same_class, key=lambda index: math.hypot(boxes[index].x - box.x, boxes[index].y - box.y))
        boxes[best] = box
    else:
        boxes.append(box)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.write_text(boxes_to_text(boxes), encoding="utf-8")


def _validate_rect(
    rect: tuple[float, float, float, float],
    previous: tuple[float, float, float, float],
    image_w: int,
    image_h: int,
    initial_area: float,
    area_min: float,
    area_max: float,
    center_jump: float,
) -> tuple[bool, str]:
    x, y, w, h = rect
    if w < 2 or h < 2:
        return False, "Tracked box became too small."
    if x < 0 or y < 0 or x + w > image_w or y + h > image_h:
        return False, "Tracked box left the image."
    ratio = (w * h) / initial_area
    if ratio < area_min or ratio > area_max:
        return False, "Tracked box area changed too much."
    px, py, pw, ph = previous
    jump = math.hypot((x + w / 2) - (px + pw / 2), (y + h / 2) - (py + ph / 2))
    if jump > math.hypot(pw, ph) * center_jump:
        return False, "Tracked box center jumped too far."
    return True, "Tracking."


def _dict_to_box(data: dict[str, Any]) -> YoloBox:
    return YoloBox(
        int(data.get("classId", 0)),
        _clamp01(float(data.get("x", 0))),
        _clamp01(float(data.get("y", 0))),
        _clamp01(float(data.get("w", 0))),
        _clamp01(float(data.get("h", 0))),
    )


def _box_to_dict(box: YoloBox) -> dict[str, Any]:
    return {"classId": box.classId, "x": box.x, "y": box.y, "w": box.w, "h": box.h}


def _box_to_rect(box: YoloBox, image_w: int, image_h: int) -> tuple[float, float, float, float]:
    w = box.w * image_w
    h = box.h * image_h
    x = (box.x * image_w) - w / 2
    y = (box.y * image_h) - h / 2
    return (float(x), float(y), float(w), float(h))


def _box_to_cv_rect(box: YoloBox, image_w: int, image_h: int) -> tuple[int, int, int, int]:
    x, y, w, h = _box_to_rect(box, image_w, image_h)
    x1 = max(0, min(image_w - 1, int(round(x))))
    y1 = max(0, min(image_h - 1, int(round(y))))
    x2 = max(x1 + 1, min(image_w, int(round(x + w))))
    y2 = max(y1 + 1, min(image_h, int(round(y + h))))
    return (int(x1), int(y1), int(x2 - x1), int(y2 - y1))


def _rect_to_box(rect: tuple[float, float, float, float], image_w: int, image_h: int, class_id: int) -> YoloBox:
    x, y, w, h = rect
    return YoloBox(class_id, _clamp01((x + w / 2) / image_w), _clamp01((y + h / 2) / image_h), _clamp01(w / image_w), _clamp01(h / image_h))


def _safe_child(root: Path, relative_path: str) -> Path:
    root = root.resolve()
    path = (root / relative_path.replace("\\", "/")).resolve()
    if root != path and root not in path.parents:
        raise ValueError(f"Path escapes root: {relative_path}")
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"Not an image path: {relative_path}")
    return path


def _clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return max(0.0, min(1.0, value))


def _positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return max(1, fallback)
    return max(1, parsed)


def track_yolo_forward_from_json(root: Path, start_image_path: str, start_box_json: str, ordered_paths_json: str, options_json: str = "{}") -> str:
    result = track_yolo_forward(
        root,
        start_image_path,
        json.loads(start_box_json or "{}"),
        json.loads(ordered_paths_json or "[]"),
        json.loads(options_json or "{}"),
    )
    return json.dumps(result, ensure_ascii=False)
