#!/usr/bin/env python3
"""Optional Intel NPU pose observer for animation-first capture.

The observer is deliberately shadow-only.  It executes an independent, small
OpenVINO pose network and returns COCO observations for diagnostics, but it
does not participate in production joint fusion until held-out animation
evaluation explicitly activates that behavior.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import time
from typing import Any


MODEL_RELATIVE_PATH = Path(
    "private/models/openvino/human-pose-estimation-0005/FP16/"
    "human-pose-estimation-0005.xml"
)
MODEL_XML_SHA256 = "da933e50966a54835642c7e69d204637a4c97145002f990557f5e52d91736aa3"
MODEL_BIN_SHA256 = "64439882eb1333cff477a6267b808fde0528b7fa5ac6f19685f324ef52655200"
MODEL_INPUT_SIZE = 288
HEATMAP_SIZE = 144
JOINT_COUNT = 17


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class NpuPoseObservation:
    points: list[list[float]]
    scores: list[float]
    latency_ms: float


def _clamp_roi(
    roi: tuple[int, int, int, int], width: int, height: int
) -> tuple[int, int, int, int]:
    left = max(0, min(width - 2, int(roi[0])))
    top = max(0, min(height - 2, int(roi[1])))
    right = max(left + 2, min(width, left + int(roi[2])))
    bottom = max(top + 2, min(height, top + int(roi[3])))
    return left, top, right - left, bottom - top


def _letterbox_bgr(
    frame: Any,
    roi: tuple[int, int, int, int],
    cv2: Any,
    np: Any,
) -> tuple[Any, tuple[float, float, float]]:
    """Return NCHW BGR input and (scale, pad_x, pad_y)."""
    height, width = frame.shape[:2]
    left, top, roi_width, roi_height = _clamp_roi(roi, width, height)
    crop = frame[top:top + roi_height, left:left + roi_width]
    scale = min(MODEL_INPUT_SIZE / roi_width, MODEL_INPUT_SIZE / roi_height)
    resized_width = max(1, min(MODEL_INPUT_SIZE, int(round(roi_width * scale))))
    resized_height = max(1, min(MODEL_INPUT_SIZE, int(round(roi_height * scale))))
    resized = cv2.resize(crop, (resized_width, resized_height))
    pad_x = (MODEL_INPUT_SIZE - resized_width) // 2
    pad_y = (MODEL_INPUT_SIZE - resized_height) // 2
    canvas = np.zeros((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 3), dtype=np.float32)
    canvas[pad_y:pad_y + resized_height, pad_x:pad_x + resized_width] = resized
    tensor = np.transpose(canvas, (2, 0, 1))[None]
    return tensor, (scale, float(pad_x), float(pad_y))


def _decode_heatmaps(
    heatmaps: Any,
    roi: tuple[int, int, int, int],
    transform: tuple[float, float, float],
    minimum_score: float = 0.10,
) -> tuple[list[list[float]], list[float]]:
    """Decode one single-person peak per COCO joint without filling misses."""
    if tuple(heatmaps.shape) != (JOINT_COUNT, HEATMAP_SIZE, HEATMAP_SIZE):
        raise RuntimeError(
            "NPU heatmaps must have shape "
            f"({JOINT_COUNT}, {HEATMAP_SIZE}, {HEATMAP_SIZE})"
        )
    scale, pad_x, pad_y = transform
    left, top, roi_width, roi_height = roi
    points: list[list[float]] = []
    scores: list[float] = []
    flattened = heatmaps.reshape(JOINT_COUNT, -1)
    for joint in range(JOINT_COUNT):
        peak_index = int(flattened[joint].argmax())
        raw_score = float(flattened[joint, peak_index])
        score = max(0.0, min(1.0, raw_score))
        heatmap_x = peak_index % HEATMAP_SIZE
        heatmap_y = peak_index // HEATMAP_SIZE
        input_x = (heatmap_x + 0.5) * MODEL_INPUT_SIZE / HEATMAP_SIZE
        input_y = (heatmap_y + 0.5) * MODEL_INPUT_SIZE / HEATMAP_SIZE
        source_x = (input_x - pad_x) / scale + left
        source_y = (input_y - pad_y) / scale + top
        inside = (
            left <= source_x < left + roi_width
            and top <= source_y < top + roi_height
        )
        if score < minimum_score or not inside:
            points.append([0.0, 0.0])
            scores.append(0.0)
        else:
            points.append([float(source_x), float(source_y)])
            scores.append(score)
    return points, scores


class OpenVinoNpuPoseObserver:
    """A cached OpenVINO NPU session for sparse shadow observations."""

    def __init__(
        self,
        project_root: Path,
        model_path: Path | None = None,
        cache_directory: Path | None = None,
        minimum_score: float = 0.10,
    ) -> None:
        try:
            import cv2
            import numpy as np
            import openvino as ov
        except ImportError as error:
            raise RuntimeError(
                "OpenVINO NPU observer dependencies are unavailable; "
                "run tools/setup_openvino_npu.ps1"
            ) from error

        self.cv2 = cv2
        self.np = np
        self.minimum_score = minimum_score
        self.model_path = (model_path or project_root / MODEL_RELATIVE_PATH).resolve()
        if not self.model_path.is_file():
            raise RuntimeError(f"OpenVINO NPU pose model is missing: {self.model_path}")
        model_bin = self.model_path.with_suffix(".bin")
        if not model_bin.is_file():
            raise RuntimeError(f"OpenVINO NPU pose weights are missing: {model_bin}")
        if _sha256(self.model_path) != MODEL_XML_SHA256:
            raise RuntimeError(f"OpenVINO NPU pose XML hash mismatch: {self.model_path}")
        if _sha256(model_bin) != MODEL_BIN_SHA256:
            raise RuntimeError(f"OpenVINO NPU pose BIN hash mismatch: {model_bin}")

        core = ov.Core()
        if "NPU" not in core.available_devices:
            raise RuntimeError("OpenVINO does not expose an Intel NPU device")
        cache = (cache_directory or project_root / "private/cache/openvino").resolve()
        cache.mkdir(parents=True, exist_ok=True)
        core.set_property({"CACHE_DIR": str(cache)})
        model = core.read_model(self.model_path)
        compiled = core.compile_model(model, "NPU", {"PERFORMANCE_HINT": "LATENCY"})
        execution_devices = str(compiled.get_property("EXECUTION_DEVICES"))
        if "NPU" not in execution_devices.upper():
            raise RuntimeError(
                "OpenVINO compiled the observer without using the NPU: "
                + execution_devices
            )
        input_shape = tuple(int(value) for value in compiled.input(0).shape)
        if input_shape != (1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE):
            raise RuntimeError(f"unexpected NPU pose input shape: {input_shape}")
        heatmap_output = compiled.output("heatmaps")
        heatmap_shape = tuple(int(value) for value in heatmap_output.shape)
        if heatmap_shape != (1, JOINT_COUNT, HEATMAP_SIZE, HEATMAP_SIZE):
            raise RuntimeError(f"unexpected NPU heatmap output shape: {heatmap_shape}")
        self.compiled = compiled
        self.heatmap_output = heatmap_output
        self.execution_devices = execution_devices

    def infer(
        self, frame: Any, roi: tuple[int, int, int, int]
    ) -> NpuPoseObservation:
        height, width = frame.shape[:2]
        effective_roi = _clamp_roi(roi, width, height)
        tensor, transform = _letterbox_bgr(
            frame, effective_roi, self.cv2, self.np
        )
        started = time.perf_counter()
        result = self.compiled([tensor])
        latency_ms = (time.perf_counter() - started) * 1000.0
        heatmaps = result[self.heatmap_output][0]
        points, scores = _decode_heatmaps(
            heatmaps, effective_roi, transform, self.minimum_score
        )
        return NpuPoseObservation(points, scores, latency_ms)


def probe(project_root: Path) -> dict[str, Any]:
    """Compile the local observer and report the device actually selected."""
    started = time.perf_counter()
    observer = OpenVinoNpuPoseObserver(project_root)
    return {
        "status": "ready",
        "device": observer.execution_devices,
        "model": str(observer.model_path),
        "compile_s": time.perf_counter() - started,
        "mode": "shadow_only",
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.check:
        parser.error("--check is required")
    try:
        print(json.dumps(probe(args.project_root.resolve())), flush=True)
        return 0
    except Exception as error:  # noqa: BLE001 - CLI boundary
        print(json.dumps({"status": "unavailable", "message": str(error)}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
