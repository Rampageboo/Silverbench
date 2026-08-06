"""AniMocap Fusion MMPose process adapter.

The C++ application launches this module as a separate process. It never imports
PyTorch or MMPose into the product core. Output is a versioned canonical-joint
observation sequence consumed by the C++ reconstruction layer.
"""

from __future__ import annotations

import argparse
import atexit
import importlib
import json
import math
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0.0"
SEMANTICS = [
    "sceneRoot", "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
    "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
]


def _lerp(a: list[float], b: list[float], t: float) -> list[float]:
    return [a[i] + (b[i] - a[i]) * t for i in range(len(a))]


def _length(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))

def _planar_from_2d(
    points2d: list[list[float]], points3d: list[list[float]]
) -> list[list[float]]:
    """Build an anatomically stable 2.5D pose from measured image joints.

    Single-view depth is ambiguous, especially for stylized characters. The
    image plane is therefore authoritative; a small, bounded depth hint is
    retained only to keep the 3D view readable.
    """
    pelvis = points2d[0]
    ankle_mid = _lerp(points2d[3], points2d[6], 0.5)
    body_pixels = max(
        math.dist(points2d[10], ankle_mid),
        abs(points2d[10][1] - ankle_mid[1]),
        1.0,
    )
    scale = 1.55 / body_pixels

    raw_depth = [
        float(point[1]) - float(points3d[0][1]) for point in points3d[:17]
    ]
    depth_extent = max(max(abs(value) for value in raw_depth), 1e-6)
    return [[
        (pelvis[0] - point[0]) * scale,
        (pelvis[1] - point[1]) * scale + 0.9,
        max(-0.10, min(0.10, raw_depth[index] / depth_extent * 0.10)),
    ] for index, point in enumerate(points2d[:17])]


def _depth_is_plausible(points: list[list[float]]) -> bool:
    body_height = max(point[1] for point in points) - min(point[1] for point in points)
    depth_span = max(point[2] for point in points) - min(point[2] for point in points)
    return body_height > 0.5 and depth_span <= body_height * 0.45


def _prediction(result: dict[str, Any]) -> dict[str, Any]:
    value: Any = result.get("predictions", [])
    while isinstance(value, list) and value:
        value = value[0]
    if not isinstance(value, dict):
        raise RuntimeError("MMPose returned no person prediction for this frame")
    return value


def _score(scores: list[float], *indices: int) -> float:
    values = [float(scores[index]) for index in indices if index < len(scores)]
    return max(0.0, min(1.0, min(values) if values else 0.0))


def _coco_to_h36m(
    points: list[list[float]], scores: list[float]
) -> tuple[list[list[float]], list[float]]:
    if len(points) < 17:
        raise RuntimeError(f"2D pose must return 17 COCO joints, got {len(points)}")
    p = [[float(v[0]), float(v[1])] for v in points[:17]]
    pelvis = _lerp(p[11], p[12], 0.5)
    thorax = _lerp(p[5], p[6], 0.5)
    neck = _lerp(thorax, p[0], 0.2)
    mapped = [
        pelvis, p[12], p[14], p[16], p[11], p[13], p[15],
        _lerp(pelvis, thorax, 0.5), thorax, neck, p[0],
        p[5], p[7], p[9], p[6], p[8], p[10],
    ]
    mapped_scores = [
        _score(scores, 11, 12), _score(scores, 12), _score(scores, 14),
        _score(scores, 16), _score(scores, 11), _score(scores, 13),
        _score(scores, 15), _score(scores, 5, 6, 11, 12),
        _score(scores, 5, 6), _score(scores, 0, 5, 6), _score(scores, 0),
        _score(scores, 5), _score(scores, 7), _score(scores, 9),
        _score(scores, 6), _score(scores, 8), _score(scores, 10),
    ]
    return mapped, mapped_scores


def _map_h36m(
    points3d: list[list[float]],
    points2d: list[list[float]] | None,
    scores: list[float],
    width: int,
    height: int,
) -> tuple[list[dict[str, Any]], bool]:
    if len(points3d) < 17:
        raise RuntimeError(f"human3d must return at least 17 joints, got {len(points3d)}")

    # MMPose 3D convention uses Z as vertical in its visualizers. Convert to
    # AniMocap right-handed Y-up, +Z-forward.
    converted = [[float(p[0]), float(p[2]), -float(p[1])] for p in points3d[:17]]
    body_height = _length(converted[10], converted[3])
    if body_height < 1e-6:
        body_height = _length(converted[10], converted[6])
    scale = 1.55 / max(body_height, 1e-6)
    pelvis = converted[0]
    converted = [[
        (p[0] - pelvis[0]) * scale,
        (p[1] - pelvis[1]) * scale + 0.9,
        (p[2] - pelvis[2]) * scale,
    ] for p in converted]

    if points2d is None or len(points2d) < 17:
        points2d = [[
            width * 0.5 + p[0] * height / 1.7,
            height * 0.85 - (p[1] - 0.1) * height / 1.7,
        ] for p in converted]
    else:
        points2d = [[float(p[0]), float(p[1])] for p in points2d[:17]]

    used_planar_fallback = not _depth_is_plausible(converted)
    p = _planar_from_2d(points2d, points3d) if used_planar_fallback else converted
    q = points2d
    positions = {
        "sceneRoot": [p[0][0], 0.0, p[0][2]],
        "hips": p[0],
        "spine": _lerp(p[0], p[8], 0.30),
        "chest": _lerp(p[0], p[8], 0.62),
        "upperChest": p[8],
        "neck": p[9],
        "head": p[10],
        "leftShoulder": _lerp(p[8], p[11], 0.45),
        "leftUpperArm": p[11],
        "leftLowerArm": p[12],
        "leftHand": p[13],
        "rightShoulder": _lerp(p[8], p[14], 0.45),
        "rightUpperArm": p[14],
        "rightLowerArm": p[15],
        "rightHand": p[16],
        "leftUpperLeg": p[4],
        "leftLowerLeg": p[5],
        "leftFoot": p[6],
        "leftToes": [p[6][0], p[6][1], p[6][2] + 0.16],
        "rightUpperLeg": p[1],
        "rightLowerLeg": p[2],
        "rightFoot": p[3],
        "rightToes": [p[3][0], p[3][1], p[3][2] + 0.16],
    }
    image = {
        "sceneRoot": q[0], "hips": q[0],
        "spine": _lerp(q[0], q[8], 0.30),
        "chest": _lerp(q[0], q[8], 0.62),
        "upperChest": q[8], "neck": q[9], "head": q[10],
        "leftShoulder": _lerp(q[8], q[11], 0.45),
        "leftUpperArm": q[11], "leftLowerArm": q[12], "leftHand": q[13],
        "rightShoulder": _lerp(q[8], q[14], 0.45),
        "rightUpperArm": q[14], "rightLowerArm": q[15], "rightHand": q[16],
        "leftUpperLeg": q[4], "leftLowerLeg": q[5], "leftFoot": q[6], "leftToes": q[6],
        "rightUpperLeg": q[1], "rightLowerLeg": q[2], "rightFoot": q[3], "rightToes": q[3],
    }
    confidence = {
        "sceneRoot": _score(scores, 0), "hips": _score(scores, 0),
        "spine": _score(scores, 0, 8), "chest": _score(scores, 0, 8),
        "upperChest": _score(scores, 8), "neck": _score(scores, 9), "head": _score(scores, 10),
        "leftShoulder": _score(scores, 8, 11), "leftUpperArm": _score(scores, 11),
        "leftLowerArm": _score(scores, 12), "leftHand": _score(scores, 13),
        "rightShoulder": _score(scores, 8, 14), "rightUpperArm": _score(scores, 14),
        "rightLowerArm": _score(scores, 15), "rightHand": _score(scores, 16),
        "leftUpperLeg": _score(scores, 4), "leftLowerLeg": _score(scores, 5),
        "leftFoot": _score(scores, 6), "leftToes": _score(scores, 6),
        "rightUpperLeg": _score(scores, 1), "rightLowerLeg": _score(scores, 2),
        "rightFoot": _score(scores, 3), "rightToes": _score(scores, 3),
    }

    joints = []
    for semantic in SEMANTICS:
        score = confidence[semantic]
        joints.append({
            "semantic": semantic,
            "image_xy": image[semantic],
            "position_m": positions[semantic],
            "confidence": score if score >= 0.05 else 0.0,
            "valid": score >= 0.05,
        })
    return joints, used_planar_fallback


class _TemporalFusion:
    """Fuse pose heatmaps with optical flow under a conservative foreground mask."""

    def __init__(
        self,
        cv2_module: Any,
        np_module: Any,
        roi: tuple[int, int, int, int],
    ) -> None:
        self.cv2 = cv2_module
        self.np = np_module
        self.roi = roi
        self.previous_gray: Any = None
        self.previous_points: Any = None
        self.foreground_mask: Any = None
        self.frame_index = 0

    def update_roi(self, roi: tuple[int, int, int, int]) -> None:
        if roi == self.roi:
            return
        self.roi = roi
        self.previous_gray = None
        self.previous_points = None
        self.foreground_mask = None

    def _segment(self, crop: Any) -> Any:
        height, width = crop.shape[:2]
        fallback = self.np.full((height, width), 255, dtype=self.np.uint8)
        if width < 24 or height < 24:
            return fallback
        inset_x = max(2, int(width * 0.025))
        inset_y = max(2, int(height * 0.025))
        rectangle = (
            inset_x,
            inset_y,
            max(2, width - inset_x * 2),
            max(2, height - inset_y * 2),
        )
        labels = self.np.zeros((height, width), dtype=self.np.uint8)
        background = self.np.zeros((1, 65), dtype=self.np.float64)
        foreground = self.np.zeros((1, 65), dtype=self.np.float64)
        try:
            self.cv2.grabCut(
                crop,
                labels,
                rectangle,
                background,
                foreground,
                1,
                self.cv2.GC_INIT_WITH_RECT,
            )
            mask = self.np.where(
                (labels == self.cv2.GC_FGD) | (labels == self.cv2.GC_PR_FGD),
                255,
                0,
            ).astype(self.np.uint8)
            kernel_size = max(5, int(min(width, height) * 0.025))
            if kernel_size % 2 == 0:
                kernel_size += 1
            kernel = self.cv2.getStructuringElement(
                self.cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
            )
            mask = self.cv2.morphologyEx(mask, self.cv2.MORPH_CLOSE, kernel)
            mask = self.cv2.dilate(mask, kernel, iterations=1)
            ratio = float(self.np.count_nonzero(mask)) / float(mask.size)
            return mask if 0.08 <= ratio <= 0.96 else fallback
        except self.cv2.error:
            return fallback

    def fuse(
        self,
        frame: Any,
        measured_points: list[list[float]],
        scores: list[float],
    ) -> list[list[float]]:
        x, y, width, height = self.roi
        crop = frame[y:y + height, x:x + width]
        if crop.size == 0:
            return measured_points
        gray = self.cv2.cvtColor(crop, self.cv2.COLOR_BGR2GRAY)
        if self.foreground_mask is None or self.frame_index % 5 == 0:
            self.foreground_mask = self._segment(crop)

        measured = self.np.asarray(measured_points, dtype=self.np.float32)
        local_measured = measured - self.np.asarray([x, y], dtype=self.np.float32)
        fused = local_measured.copy()
        if self.previous_gray is not None and self.previous_points is not None:
            tracked, status, errors = self.cv2.calcOpticalFlowPyrLK(
                self.previous_gray,
                gray,
                self.previous_points.reshape(-1, 1, 2),
                None,
                winSize=(31, 31),
                maxLevel=3,
                criteria=(
                    self.cv2.TERM_CRITERIA_EPS | self.cv2.TERM_CRITERIA_COUNT,
                    24,
                    0.01,
                ),
            )
            if tracked is not None and status is not None:
                tracked = tracked.reshape(-1, 2)
                status = status.reshape(-1)
                errors = (
                    errors.reshape(-1)
                    if errors is not None
                    else self.np.full(len(status), 999.0)
                )
                diagonal = math.hypot(width, height)
                for index in range(min(len(fused), len(tracked))):
                    tx, ty = tracked[index]
                    inside = 0 <= tx < width and 0 <= ty < height
                    foreground = (
                        inside
                        and self.foreground_mask[
                            min(height - 1, max(0, int(round(ty)))),
                            min(width - 1, max(0, int(round(tx)))),
                        ] > 0
                    )
                    flow_valid = (
                        status[index] != 0
                        and foreground
                        and errors[index] < 80.0
                    )
                    if not flow_valid:
                        continue
                    disagreement = float(
                        self.np.linalg.norm(local_measured[index] - tracked[index])
                    )
                    score = float(scores[index]) if index < len(scores) else 0.0
                    if disagreement > diagonal * 0.12 and score >= 0.45:
                        continue
                    model_weight = max(0.28, min(0.82, 0.22 + score * 0.72))
                    fused[index] = (
                        local_measured[index] * model_weight
                        + tracked[index] * (1.0 - model_weight)
                    )

        self.previous_gray = gray
        self.previous_points = fused.copy()
        self.frame_index += 1
        fused += self.np.asarray([x, y], dtype=self.np.float32)
        return fused.tolist()


def _prepare_mmengine_temp_compat() -> None:
    """Keep MMEngine config loading usable in restricted Windows sessions.

    Some Windows policies allow creating a temporary directory but deny files
    inside it. NamedTemporaryFile then retries for minutes. MMEngine only needs
    unique scratch names while expanding configs, so its Windows process uses a
    dedicated, already-existing project directory.
    """
    if os.name != "nt" or getattr(
        tempfile.TemporaryDirectory, "_animocap_shared", False
    ):
        return

    scratch = Path(__file__).resolve().parent / "_mmengine_temp"
    scratch.mkdir(exist_ok=True)
    for old_file in scratch.glob("tmp*"):
        if old_file.is_file():
            old_file.unlink(missing_ok=True)

    original_temporary_directory = tempfile.TemporaryDirectory

    class SharedTemporaryDirectory:
        _animocap_shared = True

        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            self.name = str(scratch)

        def __enter__(self) -> str:
            return self.name

        def __exit__(self, *_args: Any) -> bool:
            return False

    tempfile.TemporaryDirectory = SharedTemporaryDirectory

    def restore_and_clean() -> None:
        tempfile.TemporaryDirectory = original_temporary_directory
        for temporary_file in scratch.glob("tmp*"):
            if temporary_file.is_file():
                temporary_file.unlink(missing_ok=True)

    atexit.register(restore_and_clean)

def _load_inferencer() -> Any:
    """Load Human3D without importing unused EDPose custom operators."""
    # MMPose 1.3.2 eagerly imports EDPose although this adapter never uses it.
    # Probing mmcv._ext can hang under mmcv-lite, so install the narrow
    # compatibility module unconditionally before importing MMPose APIs.
    _prepare_mmengine_temp_compat()
    if "yapf.yapflib.yapf_api" not in sys.modules:
        # MMEngine imports YAPF only to pretty-print exported configs. Loading
        # YAPF's legacy parser can take minutes on this Windows environment,
        # while inference never calls it.
        yapf_module = types.ModuleType("yapf")
        yapf_module.__version__ = "0.40.2"
        yapf_module.__path__ = []
        yapflib_module = types.ModuleType("yapf.yapflib")
        yapflib_module.__path__ = []
        yapf_api_module = types.ModuleType("yapf.yapflib.yapf_api")

        def format_code(text: str, **_kwargs: Any) -> tuple[str, bool]:
            return text, False

        yapf_api_module.FormatCode = format_code
        sys.modules["yapf"] = yapf_module
        sys.modules["yapf.yapflib"] = yapflib_module
        sys.modules["yapf.yapflib.yapf_api"] = yapf_api_module

    module_name = "mmpose.models.heads.transformer_heads"
    if module_name not in sys.modules:
        compatibility_module = types.ModuleType(module_name)

        class UnsupportedEDPoseHead:
            def __init__(self, *_args: Any, **_kwargs: Any) -> None:
                raise RuntimeError(
                    "EDPose is not enabled by the AniMocap Human3D adapter."
                )

        compatibility_module.EDPoseHead = UnsupportedEDPoseHead
        sys.modules[module_name] = compatibility_module

    from mmpose.apis import MMPoseInferencer
    return MMPoseInferencer


_ACTIVE_CROP_ROI: tuple[int, int, int, int] | None = None


def _set_active_crop(roi: tuple[int, int, int, int] | None) -> None:
    global _ACTIVE_CROP_ROI
    _ACTIVE_CROP_ROI = roi


def _enable_center_crop(roi: tuple[int, int, int, int] | None = None) -> None:
    """Crop video frames using a mutable user or body-aware ROI."""
    import numpy as np
    from mmpose.apis.inferencers.pose2d_inferencer import Pose2DInferencer

    _set_active_crop(roi)
    original = Pose2DInferencer.preprocess_single
    if getattr(original, "_animocap_center_crop", False):
        return

    def preprocess_single(
        self: Any, input_value: Any, index: int, *args: Any, **kwargs: Any
    ) -> Any:
        if isinstance(input_value, np.ndarray):
            height, width = input_value.shape[:2]
            active_roi = _ACTIVE_CROP_ROI
            if active_roi is not None:
                roi_x, roi_y, roi_width, roi_height = active_roi
                left = max(0, min(width - 2, roi_x))
                top = max(0, min(height - 2, roi_y))
                right = max(left + 2, min(width, left + roi_width))
                bottom = max(top + 2, min(height, top + roi_height))
                self._animocap_crop_offset = (left, top)
                input_value = input_value[top:bottom, left:right].copy()
            else:
                self._animocap_crop_offset = (0, 0)
        return original(self, input_value, index, *args, **kwargs)

    preprocess_single._animocap_center_crop = True
    Pose2DInferencer.preprocess_single = preprocess_single


def _body_roi_from_points(
    points: list[list[float]],
    scores: list[float],
    width: int,
    height: int,
) -> tuple[int, int, int, int] | None:
    confident = [
        point for point, score in zip(points, scores)
        if float(score) >= 0.28 and len(point) >= 2
    ]
    if len(confident) < 9:
        return None
    xs = [float(point[0]) for point in confident]
    ys = [float(point[1]) for point in confident]
    body_width = max(80.0, max(xs) - min(xs))
    body_height = max(160.0, max(ys) - min(ys))
    margin_x = max(48.0, body_width * 0.62)
    margin_y = max(36.0, body_height * 0.18)
    left = max(0, int(min(xs) - margin_x))
    top = max(0, int(min(ys) - margin_y))
    right = min(width, int(max(xs) + margin_x))
    bottom = min(height, int(max(ys) + margin_y))
    if right - left < 120 or bottom - top < 240:
        return None
    return left, top, right - left, bottom - top

def run_mmpose(
    input_path: Path,
    output_path: Path,
    device: str | None,
    roi: tuple[int, int, int, int] | None = None,
) -> None:
    try:
        import cv2
        import numpy as np
        MMPoseInferencer = _load_inferencer()
    except ImportError as error:
        raise RuntimeError(
            f"MMPose adapter import failed: {error}. Run tools/setup_mmpose.ps1."
        ) from error

    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open video: {input_path}")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()

    if roi is not None:
        roi_x, roi_y, roi_width, roi_height = roi
        if (
            roi_width < 2 or roi_height < 2 or roi_x >= width or roi_y >= height
            or roi_x + roi_width <= 0 or roi_y + roi_height <= 0
        ):
            raise RuntimeError(f"invalid person ROI {roi} for {width}x{height} video")

    if roi is None:
        if width / max(height, 1) > 1.15:
            crop_width = int(width * 0.50)
            crop_height = int(height * 0.90)
            effective_roi = (
                max(0, (width - crop_width) // 2),
                max(0, int(height * 0.08)),
                crop_width,
                crop_height,
            )
        else:
            effective_roi = (0, 0, width, height)
    else:
        roi_x, roi_y, roi_width, roi_height = roi
        left = max(0, min(width - 2, roi_x))
        top = max(0, min(height - 2, roi_y))
        right = max(left + 2, min(width, roi_x + roi_width))
        bottom = max(top + 2, min(height, roi_y + roi_height))
        effective_roi = (left, top, right - left, bottom - top)

    _enable_center_crop(effective_roi)
    flow_capture = cv2.VideoCapture(str(input_path))
    temporal_fusion = _TemporalFusion(cv2, np, effective_roi)
    inferencer = MMPoseInferencer(
        pose3d="human3d",
        pose2d="td-hm_hrnet-w32_8xb64-210e_coco-256x192",
        det_model="whole_image",
        device=device,
    )
    frames = []
    planar_fallback_frames = 0
    generator = inferencer(
        str(input_path),
        return_vis=False,
        show=False,
        rebase_keypoint_height=True,
    )
    for frame_index, result in enumerate(generator):
        flow_frame_ok, flow_frame = flow_capture.read()
        predicted = _prediction(result)
        keypoints = predicted.get("keypoints")
        if keypoints is None:
            raise RuntimeError("MMPose result is missing 3D keypoints")
        if hasattr(keypoints, "tolist"):
            keypoints = keypoints.tolist()
        points3d = keypoints[0] if keypoints and isinstance(keypoints[0][0], list) else keypoints

        points2d = None
        scores = predicted.get("keypoint_scores", [0.5] * len(points3d))
        if hasattr(scores, "tolist"):
            scores = scores.tolist()
        if scores and isinstance(scores[0], list):
            scores = scores[0]

        # Pose3DInferencer retains the already-computed HRNet sample in its
        # frame buffer. Reuse it so the overlay uses measured image pixels and
        # meaningful 2D confidence rather than a synthetic 3D projection.
        pose3d_inferencer = inferencer.inferencer
        pose2d_sample = getattr(pose3d_inferencer, "_buffer", {}).get(
            "pose2d_results"
        )
        if pose2d_sample is not None:
            instances = pose2d_sample.pred_instances
            coco_points = instances.keypoints[0]
            coco_scores = instances.keypoint_scores[0]
            if hasattr(coco_points, "tolist"):
                coco_points = coco_points.tolist()
            crop_offset = getattr(
                pose3d_inferencer.pose2d_model,
                "_animocap_crop_offset",
                (0, 0),
            )
            coco_points = [
                [point[0] + crop_offset[0], point[1] + crop_offset[1]]
                for point in coco_points
            ]
            if hasattr(coco_scores, "tolist"):
                coco_scores = coco_scores.tolist()
            if roi is None and frame_index == 0:
                body_roi = _body_roi_from_points(
                    coco_points, coco_scores, width, height
                )
                if body_roi is not None:
                    effective_roi = body_roi
                    _set_active_crop(body_roi)
                    temporal_fusion.update_roi(body_roi)
            if flow_frame_ok:
                coco_points = temporal_fusion.fuse(
                    flow_frame, coco_points, coco_scores
                )
            points2d, scores = _coco_to_h36m(coco_points, coco_scores)

        joints, used_planar_fallback = _map_h36m(
            points3d, points2d, scores, width, height
        )
        planar_fallback_frames += int(used_planar_fallback)
        frames.append({
            "time_s": frame_index / fps,
            "joints": joints,
        })
        print(json.dumps({
            "event": "progress",
            "frame": frame_index + 1,
            "total": frame_count,
        }), flush=True)

    flow_capture.release()
    if not frames:
        raise RuntimeError("MMPose produced no frames")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        "schema_version": SCHEMA_VERSION,
        "source_video": str(input_path.resolve()),
        "backend": (
            (
                "mmpose-hrnet-motionbert+2.5d-fallback"
                if planar_fallback_frames
                else "mmpose-hrnet-motionbert"
            )
            + "+lk-flow+grabcut"
            + ("+user-roi" if roi is not None else "+auto-body-roi")
        ),
        "image_width": width,
        "image_height": height,
        "fps": fps,
        "frames": frames,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--device", default=None)
    parser.add_argument("--roi", nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            _load_inferencer()
            import cv2
            import mmcv
            import mmengine
            import mmpose
            import torch
            print(json.dumps({
                "event": "ready", "mmpose": mmpose.__version__,
                "mmcv": mmcv.__version__, "mmengine": mmengine.__version__,
                "torch": torch.__version__, "opencv": cv2.__version__,
                "cuda": torch.cuda.is_available(),
            }), flush=True)
            return 0
        if args.input is None or args.output is None:
            parser.error("--input and --output are required unless --check is used")
        roi = tuple(args.roi) if args.roi is not None else None
        run_mmpose(args.input, args.output, args.device, roi)
        print(json.dumps({"event": "complete", "output": str(args.output)}), flush=True)
        return 0
    except Exception as error:  # adapter boundary reports a concise process error
        print(json.dumps({"event": "error", "message": str(error)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

