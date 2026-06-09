from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Callable

import cv2

from .dataset_merge import VIDEO_EXTENSIONS, unique_path


def find_videos(folder: Path) -> list[Path]:
    return sorted(
        (path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS),
        key=lambda path: str(path).lower(),
    )


def screenshot_output_path(output_dir: Path, prefix: str, timestamp: str, suffix: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_prefix = "".join("_" if char in '<>:"/\\|?*' else char for char in prefix).strip() or "video"
    return unique_path(output_dir / f"{safe_prefix}_{timestamp}.{suffix.lstrip('.')}")


def safe_file_stem(name: str) -> str:
    safe = "".join("_" if char in '<>:"/\\|?*\x00\r\n\t' else char for char in name)
    safe = "_".join(safe.split())
    return safe[:120] or "video"


def format_timestamp(seconds: float) -> str:
    ms = round(max(0.0, float(seconds)) * 1000)
    hours = ms // 3_600_000
    minutes = (ms % 3_600_000) // 60_000
    secs = (ms % 60_000) // 1000
    millis = ms % 1000
    return f"{hours:02d}-{minutes:02d}-{secs:02d}-{millis:03d}"


def screenshot_filename(
    prefix: str,
    fallback_name: str,
    seconds: float,
    segment_number: int | None,
    image_format: str,
    sequence: int | None = None,
) -> str:
    video_stem = safe_file_stem(Path(fallback_name or "video").stem)
    custom_text = str(prefix or "").strip()
    custom = safe_file_stem(Path(custom_text).stem) if custom_text else ""
    if custom and custom.lower() != video_stem.lower():
        base = f"{video_stem}_{custom}"
    else:
        base = video_stem
    suffix = "png" if image_format == "png" else "jpg"
    segment_part = "" if segment_number is None else f"_seg{segment_number:02d}"
    seq_part = f"_{sequence:06d}" if sequence is not None else ""
    return f"{base}{segment_part}{seq_part}_{format_timestamp(seconds)}.{suffix}"


def video_info(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {"ok": False, "path": str(path), "name": path.name, "duration": 0, "width": 0, "height": 0}
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    duration = frames / fps if fps else 0
    return {"ok": True, "path": str(path), "name": path.name, "duration": duration, "width": width, "height": height}


def _try_read_frame_at(cap: cv2.VideoCapture, seconds: float, fps: float):
    seconds = max(0.0, float(seconds))
    cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000.0)
    ok, frame = cap.read()
    if ok and frame is not None:
        return frame
    frame_index = max(0, int(round(seconds * fps)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    if ok and frame is not None:
        return frame
    return None


def read_video_frame(path: Path, seconds: float):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    target_seconds = max(0.0, float(seconds))
    if frame_count > 0 and fps > 0:
        target_seconds = min(target_seconds, max(0.0, (frame_count - 1) / fps))
    try:
        for delta in (0.0, -0.05, 0.05, -0.2, 0.2, -0.5, 0.5, -1.0, 1.0):
            seek_seconds = max(0.0, target_seconds + delta)
            frame = _try_read_frame_at(cap, seek_seconds, fps)
            if frame is not None:
                return frame
    finally:
        cap.release()
    raise ValueError(f"Cannot read frame at {seconds}s from {path}")


def frame_base64(path: Path, seconds: float, image_format: str = "jpg") -> str:
    frame = read_video_frame(path, seconds)
    suffix = ".png" if image_format == "png" else ".jpg"
    ok, encoded = cv2.imencode(suffix, frame)
    if not ok:
        raise ValueError("Cannot encode frame")
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def save_video_frame(path: Path, output_dir: Path, seconds: float, prefix: str, image_format: str = "jpg") -> str:
    frame = read_video_frame(path, seconds)
    return str(write_frame(frame, output_dir, screenshot_filename(prefix, path.name, seconds, None, image_format), image_format))


def capture_video_screenshots(
    path: Path,
    output_dir: Path,
    segments: list[dict[str, Any]],
    interval: float,
    prefix: str = "",
    image_format: str = "jpg",
    progress_callback: Callable[[str], None] | None = None,
    cancel_event: Any | None = None,
) -> dict:
    if interval <= 0:
        raise ValueError("Batch interval must be greater than 0.")
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    max_frame_index = frame_count - 1 if frame_count > 0 else None
    output_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    errors: list[str] = []
    sequence = 0
    try:
        targets = capture_targets(segments, interval, fps, max_frame_index)
        target_index = 0
        current_frame_index = -1
        max_sequential_gap = max(90, int(round(fps * 4)))
        while target_index < len(targets):
            if cancel_event is not None and cancel_event.is_set():
                return {"video": str(path), "saved": len(saved), "files": saved, "errors": errors, "cancelled": True}
            frame_index, seconds, segment_index = targets[target_index]
            if current_frame_index < 0 or frame_index - current_frame_index > max_sequential_gap:
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                current_frame_index = frame_index
            while current_frame_index <= frame_index:
                ok, frame = cap.read()
                if not ok:
                    errors.append(f"Cannot read frame at {seconds:.3f}s from {path.name}")
                    target_index += 1
                    break
                if current_frame_index >= frame_index:
                    while target_index < len(targets) and targets[target_index][0] <= current_frame_index:
                        _, target_seconds, target_segment_index = targets[target_index]
                        sequence += 1
                        filename = screenshot_filename(
                            prefix,
                            path.name,
                            target_seconds,
                            target_segment_index,
                            image_format,
                            sequence,
                        )
                        saved.append(str(write_frame(frame, output_dir, filename, image_format)))
                        if progress_callback:
                            progress_callback(f"{path.name} @ {format_timestamp(target_seconds)}")
                        target_index += 1
                    break
                current_frame_index += 1
            current_frame_index += 1
    finally:
        cap.release()
    return {"video": str(path), "saved": len(saved), "files": saved, "errors": errors, "targetCount": len(targets)}


def capture_targets(
    segments: list[dict[str, Any]],
    interval: float,
    fps: float,
    max_frame_index: int | None = None,
) -> list[tuple[int, float, int]]:
    targets: list[tuple[int, float, int]] = []
    for segment_index, segment in enumerate(segments or [], start=1):
        start = max(0.0, float(segment.get("start", 0) or 0))
        end = max(start, float(segment.get("end", start) or start))
        timestamp = start
        while timestamp <= end + 0.001:
            seconds = min(timestamp, end)
            frame_index = max(0, int(round(seconds * fps)))
            if max_frame_index is not None:
                frame_index = min(frame_index, max_frame_index)
                seconds = frame_index / fps if fps else seconds
            targets.append((frame_index, seconds, segment_index))
            timestamp += interval
    return sorted(targets, key=lambda item: (item[0], item[2]))


def capture_video_screenshot_jobs(
    jobs: list[dict[str, Any]],
    output_dir: Path,
    interval: float,
    prefix: str,
    image_format: str,
    progress_callback: Callable[[int, str], None] | None = None,
    cancel_event: Any | None = None,
) -> dict:
    total_saved = 0
    results = []
    errors = []
    for job in jobs:
        if cancel_event is not None and cancel_event.is_set():
            return {"saved": total_saved, "videos": len(jobs), "results": results, "errors": errors, "cancelled": True}
        try:
            def on_frame(detail: str) -> None:
                nonlocal total_saved
                total_saved += 1
                if progress_callback:
                    progress_callback(total_saved, detail)

            job_prefix = str(job.get("prefix") or prefix or "")
            result = capture_video_screenshots(
                Path(str(job.get("path") or "")),
                output_dir,
                job.get("segments") or [],
                interval,
                job_prefix,
                image_format,
                on_frame,
                cancel_event,
            )
            results.append(result)
            errors.extend(result["errors"])
        except Exception as error:
            errors.append(str(error))
            results.append({"video": str(job.get("path") or ""), "saved": 0, "files": [], "errors": [str(error)]})
    return {"saved": total_saved, "videos": len(jobs), "results": results, "errors": errors}


def write_frame(frame, output_dir: Path, filename: str, image_format: str = "jpg") -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = ".png" if image_format == "png" else ".jpg"
    ok, encoded = cv2.imencode(suffix, frame)
    if not ok:
        raise ValueError("Cannot encode frame")
    target = unique_path(output_dir / filename)
    target.write_bytes(encoded.tobytes())
    return target


def videos_json(paths: list[Path]) -> str:
    return json.dumps([video_info(path) for path in paths], ensure_ascii=False)
