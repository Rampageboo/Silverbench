"""Record two to four cameras with grouped grab/retrieve synchronization."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def capture(args: argparse.Namespace) -> None:
    import cv2

    if not 2 <= len(args.cameras) <= 4:
        raise RuntimeError("two to four camera indices are required")
    names = args.names or [f"camera_{index}" for index in args.cameras]
    if len(names) != len(args.cameras) or len(set(names)) != len(names):
        raise RuntimeError("--names must be unique and match --cameras")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    captures = []
    writers = []
    videos: list[Path] = []
    try:
        for camera_index, name in zip(args.cameras, names):
            camera = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
            if not camera.isOpened():
                raise RuntimeError(f"cannot open camera {camera_index}")
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
            camera.set(cv2.CAP_PROP_FPS, args.fps)
            captures.append(camera)
            video = output / f"{name}.mp4"
            writer = cv2.VideoWriter(
                str(video), cv2.VideoWriter_fourcc(*"mp4v"), args.fps,
                (args.width, args.height),
            )
            if not writer.isOpened():
                raise RuntimeError(f"cannot create video: {video}")
            writers.append(writer)
            videos.append(video)

        for _ in range(20):
            for camera in captures:
                camera.grab()
            for camera in captures:
                camera.retrieve()

        start = time.perf_counter()
        frame_records = []
        frame_count = 0
        maximum_frames = int(args.duration * args.fps) if args.duration > 0 else None
        while maximum_frames is None or frame_count < maximum_frames:
            cycle_start = time.perf_counter()
            if not all(camera.grab() for camera in captures):
                raise RuntimeError("one or more cameras stopped delivering frames")
            frames = []
            retrieve_times = []
            for camera in captures:
                ok, frame = camera.retrieve()
                retrieve_times.append(time.perf_counter() - start)
                if not ok:
                    raise RuntimeError("camera frame retrieval failed")
                if frame.shape[1] != args.width or frame.shape[0] != args.height:
                    frame = cv2.resize(frame, (args.width, args.height))
                frames.append(frame)
            for writer, frame in zip(writers, frames):
                writer.write(frame)
            frame_records.append({
                "frame_index": frame_count,
                "time_s": sum(retrieve_times) / len(retrieve_times),
                "camera_time_s": dict(zip(names, retrieve_times)),
                "retrieve_span_ms": (max(retrieve_times) - min(retrieve_times)) * 1000.0,
            })
            frame_count += 1
            if args.preview:
                target_height = 360
                previews = [cv2.resize(
                    frame,
                    (max(1, int(frame.shape[1] * target_height / frame.shape[0])), target_height),
                ) for frame in frames]
                cv2.imshow("AniMocap synchronized capture (Q to stop)", cv2.hconcat(previews))
                if cv2.waitKey(1) & 0xFF in (ord("q"), ord("Q")):
                    break
            remaining = 1.0 / args.fps - (time.perf_counter() - cycle_start)
            if remaining > 0:
                time.sleep(remaining)
    finally:
        for writer in writers:
            writer.release()
        for camera in captures:
            camera.release()
        if args.preview:
            cv2.destroyAllWindows()

    if not frame_records:
        raise RuntimeError("no synchronized frames were recorded")
    (output / "capture_timestamps.json").write_text(json.dumps({
        "schema_version": "1.0.0",
        "synchronization": "software_grouped_grab_retrieve",
        "hardware_sync": False,
        "fps": args.fps,
        "frames": frame_records,
        "mean_retrieve_span_ms": sum(
            item["retrieve_span_ms"] for item in frame_records
        ) / len(frame_records),
        "maximum_retrieve_span_ms": max(
            item["retrieve_span_ms"] for item in frame_records
        ),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "version": 1,
        "mode": "synchronized_multiview",
        "fps": args.fps,
        "looping": False,
        "calibration_file": "calibration.json",
        "views": [{
            "id": name,
            "video": video.name,
            "yaw_degrees": None,
            "time_offset_s": 0.0,
        } for name, video in zip(names, videos)],
        "subject": {"type": "anime_humanoid", "approximate_height_m": None},
        "output": {"directory": "output"},
    }
    (output / "capture.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({
        "event": "complete",
        "manifest": str((output / "capture.json").resolve()),
        "frames": len(frame_records),
        "maximum_retrieve_span_ms": max(
            item["retrieve_span_ms"] for item in frame_records
        ),
    }, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cameras", nargs="+", type=int, required=True)
    parser.add_argument("--names", nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--duration", type=float, default=15.0)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    try:
        capture(args)
        return 0
    except Exception as error:
        print(json.dumps({"event": "error", "message": str(error)}), file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
