"""Calibrate synchronized cameras from a moving chessboard sequence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _resolve(base: Path, value: str) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else base / path).resolve()


def calibrate(args: argparse.Namespace) -> dict[str, Any]:
    import cv2
    import numpy as np

    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("mode") != "synchronized_multiview":
        raise RuntimeError("calibration requires a synchronized_multiview manifest")
    views = manifest.get("views", [])
    if not 2 <= len(views) <= 8:
        raise RuntimeError("calibration requires two to eight views")
    board_size = (args.columns, args.rows)
    object_template = np.zeros((args.rows * args.columns, 3), np.float32)
    object_template[:, :2] = (
        np.mgrid[0:args.columns, 0:args.rows].T.reshape(-1, 2)
        * args.square_size_m
    )
    captures = []
    observations: dict[str, dict[int, Any]] = {
        str(view["id"]): {} for view in views
    }
    image_size: tuple[int, int] | None = None
    try:
        for view in views:
            video = _resolve(manifest_path.parent, str(view["video"]))
            capture = cv2.VideoCapture(str(video))
            if not capture.isOpened():
                raise RuntimeError(f"cannot open calibration video: {video}")
            captures.append(capture)
        frame_index = 0
        while True:
            frames = [capture.read() for capture in captures]
            if not all(ok for ok, _ in frames):
                break
            if frame_index % args.stride != 0:
                frame_index += 1
                continue
            for view, (_, frame) in zip(views, frames):
                current_size = (frame.shape[1], frame.shape[0])
                if image_size is None:
                    image_size = current_size
                elif image_size != current_size:
                    raise RuntimeError("all calibration videos must share resolution")
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                found, corners = cv2.findChessboardCornersSB(
                    gray,
                    board_size,
                    flags=cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY,
                )
                if found:
                    observations[str(view["id"])][frame_index] = corners.reshape(-1, 2)
            if min(len(value) for value in observations.values()) >= args.maximum_samples:
                break
            frame_index += 1
    finally:
        for capture in captures:
            capture.release()
    if image_size is None:
        raise RuntimeError("calibration videos had no readable frames")

    intrinsics: dict[str, tuple[Any, Any, float]] = {}
    for view in views:
        view_id = str(view["id"])
        samples = list(observations[view_id].values())
        if len(samples) < args.minimum_samples:
            raise RuntimeError(
                f"view {view_id} has only {len(samples)} chessboard samples; "
                f"at least {args.minimum_samples} are required"
            )
        rms, camera_matrix, distortion, _rvecs, _tvecs = cv2.calibrateCamera(
            [object_template.copy() for _ in samples], samples,
            image_size, None, None,
        )
        intrinsics[view_id] = (camera_matrix, distortion, float(rms))

    reference_id = str(views[0]["id"])
    reference_matrix, reference_distortion, reference_rms = intrinsics[reference_id]
    cameras: list[dict[str, Any]] = [{
        "id": reference_id,
        "camera_matrix": reference_matrix.tolist(),
        "distortion": reference_distortion.reshape(-1).tolist(),
        "rotation_world_to_camera": np.eye(3).tolist(),
        "translation_world_to_camera_m": [0.0, 0.0, 0.0],
        "intrinsic_rms_px": reference_rms,
        "stereo_rms_px": 0.0,
        "shared_samples": len(observations[reference_id]),
    }]
    for view in views[1:]:
        view_id = str(view["id"])
        shared = sorted(
            set(observations[reference_id]).intersection(observations[view_id])
        )
        if len(shared) < args.minimum_samples:
            raise RuntimeError(
                f"views {reference_id}/{view_id} share only {len(shared)} "
                "chessboard frames; record the moving board in every camera"
            )
        camera_matrix, distortion, intrinsic_rms = intrinsics[view_id]
        result = cv2.stereoCalibrate(
            [object_template.copy() for _ in shared],
            [observations[reference_id][index] for index in shared],
            [observations[view_id][index] for index in shared],
            reference_matrix,
            reference_distortion,
            camera_matrix,
            distortion,
            image_size,
            criteria=(
                cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-7
            ),
            flags=cv2.CALIB_FIX_INTRINSIC,
        )
        stereo_rms, _k1, _d1, _k2, _d2, rotation, translation, _e, _f = result
        cameras.append({
            "id": view_id,
            "camera_matrix": camera_matrix.tolist(),
            "distortion": distortion.reshape(-1).tolist(),
            "rotation_world_to_camera": rotation.tolist(),
            "translation_world_to_camera_m": translation.reshape(-1).tolist(),
            "intrinsic_rms_px": intrinsic_rms,
            "stereo_rms_px": float(stereo_rms),
            "shared_samples": len(shared),
        })

    document = {
        "schema_version": "1.0.0",
        "model": "opencv_pinhole",
        "reference_camera": reference_id,
        "image_width": image_size[0],
        "image_height": image_size[1],
        "board": {
            "inner_columns": args.columns,
            "inner_rows": args.rows,
            "square_size_m": args.square_size_m,
        },
        "world_coordinate_system": {
            "origin": "reference_camera_optical_center",
            "x": "right", "y": "down", "z": "forward",
        },
        "cameras": cameras,
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, indent=2), encoding="utf-8")
    try:
        manifest["calibration_file"] = str(output.relative_to(manifest_path.parent))
    except ValueError:
        manifest["calibration_file"] = str(output)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return document


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--columns", type=int, default=9)
    parser.add_argument("--rows", type=int, default=6)
    parser.add_argument("--square-size-m", type=float, required=True)
    parser.add_argument("--stride", type=int, default=10)
    parser.add_argument("--minimum-samples", type=int, default=10)
    parser.add_argument("--maximum-samples", type=int, default=60)
    args = parser.parse_args()
    try:
        result = calibrate(args)
        print(json.dumps({
            "event": "complete",
            "reference_camera": result["reference_camera"],
            "cameras": len(result["cameras"]),
            "maximum_stereo_rms_px": max(
                camera["stereo_rms_px"] for camera in result["cameras"]
            ),
            "output": str(args.output.resolve()),
        }))
        return 0
    except Exception as error:
        print(json.dumps({"event": "error", "message": str(error)}), file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
