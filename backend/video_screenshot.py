from __future__ import annotations

import base64
import hashlib
import json
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

from .dataset_merge import VIDEO_EXTENSIONS, unique_path


_CAPTURE_LOCK = threading.RLock()
_CAPTURE_CACHE: OrderedDict[str, cv2.VideoCapture] = OrderedDict()
_FRAME_BYTES_CACHE: OrderedDict[str, bytes] = OrderedDict()
_MAX_CAPTURE_CACHE = 4
_MAX_FRAME_MEMORY_CACHE = 128
_MAX_FRAME_DISK_CACHE_FILES = 512
_MAX_FRAME_DISK_CACHE_BYTES = 512 * 1024 * 1024
_FRAME_DISK_CACHE_DIR = Path(tempfile.gettempdir()) / "yoloworkbench_video_frames"


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


def _source_token(path: Path) -> tuple[str, int, int]:
    resolved = path.expanduser().resolve()
    stat = resolved.stat()
    return str(resolved), int(stat.st_mtime_ns), int(stat.st_size)


def _frame_cache_key(path: Path, seconds: float, image_format: str, max_edge: int, quality: int) -> str:
    source, mtime_ns, size = _source_token(path)
    timestamp_ms = round(max(0.0, float(seconds)) * 1000)
    fmt = "png" if image_format == "png" else "jpg"
    raw = f"{source}|{mtime_ns}|{size}|{timestamp_ms}|{fmt}|{int(max_edge or 0)}|{int(quality or 0)}"
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def _frame_cache_path(key: str) -> Path:
    return _FRAME_DISK_CACHE_DIR / key[:2] / f"{key}.bin"


def _trim_frame_disk_cache() -> None:
    try:
        if not _FRAME_DISK_CACHE_DIR.is_dir():
            return
        files: list[tuple[int, Path, int]] = []
        total_bytes = 0
        for path in _FRAME_DISK_CACHE_DIR.rglob("*.bin"):
            try:
                stat = path.stat()
            except OSError:
                continue
            size = int(stat.st_size)
            files.append((int(stat.st_mtime_ns), path, size))
            total_bytes += size
        if len(files) <= _MAX_FRAME_DISK_CACHE_FILES and total_bytes <= _MAX_FRAME_DISK_CACHE_BYTES:
            return
        files.sort(key=lambda item: item[0])
        while files and (len(files) > _MAX_FRAME_DISK_CACHE_FILES or total_bytes > _MAX_FRAME_DISK_CACHE_BYTES):
            _, path, size = files.pop(0)
            try:
                path.unlink()
            except OSError:
                continue
            total_bytes -= size
    except OSError:
        return


def _cached_capture(path: Path) -> cv2.VideoCapture:
    source, mtime_ns, size = _source_token(path)
    key = f"{source}|{mtime_ns}|{size}"
    cap = _CAPTURE_CACHE.get(key)
    if cap is not None and cap.isOpened():
        _CAPTURE_CACHE.move_to_end(key)
        return cap
    if cap is not None:
        cap.release()
        _CAPTURE_CACHE.pop(key, None)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {path}")
    _CAPTURE_CACHE[key] = cap
    while len(_CAPTURE_CACHE) > _MAX_CAPTURE_CACHE:
        _, old_cap = _CAPTURE_CACHE.popitem(last=False)
        old_cap.release()
    return cap


def read_video_frame(path: Path, seconds: float):
    with _CAPTURE_LOCK:
        cap = _cached_capture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        target_seconds = max(0.0, float(seconds))
        if frame_count > 0 and fps > 0:
            target_seconds = min(target_seconds, max(0.0, (frame_count - 1) / fps))
        for delta in (0.0, -0.05, 0.05, -0.2, 0.2, -0.5, 0.5, -1.0, 1.0):
            seek_seconds = max(0.0, target_seconds + delta)
            frame = _try_read_frame_at(cap, seek_seconds, fps)
            if frame is not None:
                return frame.copy()
    raise ValueError(f"Cannot read frame at {seconds}s from {path}")


def _resize_frame_for_preview(frame, max_edge: int):
    edge = max(0, int(max_edge or 0))
    if edge <= 0:
        return frame
    height, width = frame.shape[:2]
    current_edge = max(width, height)
    if current_edge <= edge:
        return frame
    scale = edge / current_edge
    next_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return cv2.resize(frame, next_size, interpolation=cv2.INTER_AREA)


def frame_bytes(path: Path, seconds: float, image_format: str = "jpg", max_edge: int = 0, quality: int = 72) -> bytes:
    key = _frame_cache_key(path, seconds, image_format, max_edge, quality)
    cached = _FRAME_BYTES_CACHE.get(key)
    if cached is not None:
        _FRAME_BYTES_CACHE.move_to_end(key)
        return cached

    cache_path = _frame_cache_path(key)
    try:
        if cache_path.is_file():
            payload = cache_path.read_bytes()
            _FRAME_BYTES_CACHE[key] = payload
            while len(_FRAME_BYTES_CACHE) > _MAX_FRAME_MEMORY_CACHE:
                _FRAME_BYTES_CACHE.popitem(last=False)
            return payload
    except OSError:
        pass

    frame = read_video_frame(path, seconds)
    frame = _resize_frame_for_preview(frame, max_edge)
    suffix = ".png" if image_format == "png" else ".jpg"
    params: list[int] = []
    if suffix == ".jpg":
        params = [int(cv2.IMWRITE_JPEG_QUALITY), max(35, min(int(quality), 95))]
    ok, encoded = cv2.imencode(suffix, frame, params)
    if not ok:
        raise ValueError("Cannot encode frame")
    payload = encoded.tobytes()
    _FRAME_BYTES_CACHE[key] = payload
    while len(_FRAME_BYTES_CACHE) > _MAX_FRAME_MEMORY_CACHE:
        _FRAME_BYTES_CACHE.popitem(last=False)
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(payload)
        _trim_frame_disk_cache()
    except OSError:
        pass
    return payload


def frame_base64(path: Path, seconds: float, image_format: str = "jpg", max_edge: int = 0, quality: int = 72) -> str:
    return base64.b64encode(frame_bytes(path, seconds, image_format, max_edge, quality)).decode("ascii")


def save_video_frame(path: Path, output_dir: Path, seconds: float, prefix: str, image_format: str = "jpg") -> str:
    frame = read_video_frame(path, seconds)
    return str(write_frame(frame, output_dir, screenshot_filename(prefix, path.name, seconds, None, image_format), image_format))


def _frame_signature(frame):
    color = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR) if frame.ndim == 2 else frame
    lab = cv2.cvtColor(color, cv2.COLOR_BGR2LAB)
    resized = cv2.resize(lab, (64, 64), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(resized, (3, 3), 0)


def _signature_similarity(signature, reference_signature) -> float:
    difference = cv2.absdiff(signature, reference_signature).astype(np.float32)
    channel_difference = np.mean(difference, axis=(0, 1), dtype=np.float64) / 255.0
    luminance_similarity = 1.0 - channel_difference[0]
    chroma_similarity = 1.0 - (channel_difference[1] + channel_difference[2]) / 2.0
    score = luminance_similarity * (0.70 + 0.30 * chroma_similarity)
    return max(0.0, min(1.0, float(score)))


def frame_similarity(frame, reference) -> float:
    """Return a spatial Lab-color similarity score in [0, 1]."""
    return _signature_similarity(_frame_signature(frame), _frame_signature(reference))


def capture_video_screenshots(
    path: Path,
    output_dir: Path,
    segments: list[dict[str, Any]],
    interval: float,
    prefix: str = "",
    image_format: str = "jpg",
    progress_callback: Callable[[bool, str], None] | None = None,
    cancel_event: Any | None = None,
    similarity_threshold: float | None = None,
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
    processed = 0
    skipped = 0
    sequence = 0
    reference_signature = None
    threshold = None if similarity_threshold is None else max(0.0, min(1.0, float(similarity_threshold)))
    try:
        targets = capture_targets(segments, interval, fps, max_frame_index)
        target_index = 0
        current_frame_index = -1
        max_sequential_gap = max(90, int(round(fps * 4)))
        while target_index < len(targets):
            if cancel_event is not None and cancel_event.is_set():
                return {
                    "video": str(path),
                    "saved": len(saved),
                    "processed": processed,
                    "skipped": skipped,
                    "files": saved,
                    "errors": errors,
                    "cancelled": True,
                }
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
                        processed += 1
                        detail = f"{path.name} @ {format_timestamp(target_seconds)}"
                        signature = _frame_signature(frame) if threshold is not None else None
                        is_similar = (
                            threshold is not None
                            and reference_signature is not None
                            and _signature_similarity(signature, reference_signature) >= threshold
                        )
                        if is_similar:
                            skipped += 1
                            if progress_callback:
                                progress_callback(False, f"Skipped similar frame: {detail}")
                        else:
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
                            reference_signature = signature
                            if progress_callback:
                                progress_callback(True, detail)
                        target_index += 1
                    break
                current_frame_index += 1
            current_frame_index += 1
    finally:
        cap.release()
    return {
        "video": str(path),
        "saved": len(saved),
        "processed": processed,
        "skipped": skipped,
        "files": saved,
        "errors": errors,
        "targetCount": len(targets),
    }


def _segment_interval(segment: dict[str, Any], fallback_interval: float) -> float:
    raw = segment.get("interval", fallback_interval)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = fallback_interval
    if value <= 0:
        raise ValueError("Segment interval must be greater than 0.")
    return value


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
        segment_interval = _segment_interval(segment, interval)
        timestamp = start
        while timestamp <= end + 0.001:
            seconds = min(timestamp, end)
            frame_index = max(0, int(round(seconds * fps)))
            if max_frame_index is not None:
                frame_index = min(frame_index, max_frame_index)
                seconds = frame_index / fps if fps else seconds
            targets.append((frame_index, seconds, segment_index))
            timestamp += segment_interval
    return sorted(targets, key=lambda item: (item[0], item[2]))


def capture_video_screenshot_jobs(
    jobs: list[dict[str, Any]],
    output_dir: Path,
    interval: float,
    prefix: str,
    image_format: str,
    progress_callback: Callable[[int, int, int, str], None] | None = None,
    cancel_event: Any | None = None,
    similarity_threshold: float | None = None,
) -> dict:
    total_saved = 0
    total_processed = 0
    total_skipped = 0
    results = []
    errors = []
    for job in jobs:
        if cancel_event is not None and cancel_event.is_set():
            return {
                "saved": total_saved,
                "processed": total_processed,
                "skipped": total_skipped,
                "videos": len(jobs),
                "results": results,
                "errors": errors,
                "cancelled": True,
            }
        try:
            def on_frame(was_saved: bool, detail: str) -> None:
                nonlocal total_saved, total_processed, total_skipped
                total_processed += 1
                if was_saved:
                    total_saved += 1
                else:
                    total_skipped += 1
                if progress_callback:
                    progress_callback(total_processed, total_saved, total_skipped, detail)

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
                similarity_threshold,
            )
            results.append(result)
            errors.extend(result["errors"])
        except Exception as error:
            errors.append(str(error))
            results.append({"video": str(job.get("path") or ""), "saved": 0, "files": [], "errors": [str(error)]})
    return {
        "saved": total_saved,
        "processed": total_processed,
        "skipped": total_skipped,
        "videos": len(jobs),
        "results": results,
        "errors": errors,
    }


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
