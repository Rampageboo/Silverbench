"""AniMocap Fusion MMPose process adapter.

The C++ application launches this module as a separate process. It never imports
PyTorch or MMPose into the product core. Output is a versioned canonical-joint
observation sequence consumed by the C++ reconstruction layer.
"""

from __future__ import annotations

import argparse
import atexit
import gc
import importlib
import importlib.util
import json
import math
import os
import sys
import tempfile
import types
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any

try:
    from .openvino_npu_pose import (
        MODEL_BIN_SHA256,
        MODEL_XML_SHA256,
        OpenVinoNpuPoseObserver,
    )
except ImportError:  # Script entry point from this directory.
    from openvino_npu_pose import (  # type: ignore[no-redef]
        MODEL_BIN_SHA256,
        MODEL_XML_SHA256,
        OpenVinoNpuPoseObserver,
    )

SCHEMA_VERSION = "1.0.0"
RTMW_CONFIG = (
    "configs/wholebody_2d_keypoint/rtmpose/cocktail14/"
    "rtmw-x_8xb320-270e_cocktail14-384x288.py"
)
RTMW_WEIGHTS = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmw/"
    "rtmw-x_simcc-cocktail14_pt-ucoco_270e-384x288-f840f204_20231122.pth"
)
HUMANART_CONFIG = (
    "configs/body_2d_keypoint/topdown_heatmap/humanart/"
    "td-hm_ViTPose-large_8xb64-210e_humanart-256x192.py"
)
HUMANART_WEIGHTS = (
    "https://download.openmmlab.com/mmpose/v1/body_2d_keypoint/"
    "topdown_heatmap/human_art/"
    "td-hm_ViTPose-large_8xb64-210e_humanart-256x192-9aba9345_20230614.pth"
)
DEFAULT_CONFIDENCE_CALIBRATION = (
    "private/calibration/pose_confidence.json"
)
SEMANTICS = [
    "sceneRoot", "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
    "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
]
COCO_JOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee",
    "right_knee", "left_ankle", "right_ankle",
]
COCO_LEFT_RIGHT_PAIRS = (
    (1, 2), (3, 4), (5, 6), (7, 8), (9, 10),
    (11, 12), (13, 14), (15, 16),
)

SAM2_CONFIG = "configs/sam2.1/sam2.1_hiera_s.yaml"


def _mask_ratio_is_valid(mask: Any, np_module: Any) -> bool:
    if mask is None or getattr(mask, "size", 0) == 0:
        return False
    ratio = float(np_module.count_nonzero(mask)) / float(mask.size)
    return 0.08 <= ratio <= 0.96


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


def _needs_high_accuracy_pass(
    scores: list[float], frame_index: int, quality: str
) -> bool:
    if quality == "maximum":
        return True
    if quality == "fast":
        return False
    important = [5, 6, 7, 8, 9, 10, 13, 14, 15, 16]
    lowest = min(
        (float(scores[index]) for index in important if index < len(scores)),
        default=0.0,
    )
    return lowest < 0.62 or frame_index % 15 == 0


def _needs_humanart_pass(
    scores: list[float], frame_index: int, quality: str
) -> bool:
    """Schedule the animation-domain expert without changing fast mode."""
    if quality == "maximum":
        return True
    if quality == "fast":
        return False
    important = [5, 6, 7, 8, 9, 10, 13, 14, 15, 16]
    lowest = min(
        (float(scores[index]) for index in important if index < len(scores)),
        default=0.0,
    )
    return lowest < 0.70 or frame_index % 15 == 0


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RuntimeError(f"{label} must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise RuntimeError(f"{label} must be a finite number")
    return result


class _ConfidenceCalibration:
    """Validated, deterministic raw-confidence calibration curves."""

    def __init__(
        self,
        curves: dict[str, dict[str, list[tuple[float, float]]]] | None = None,
        status: str = "identity",
        source: Path | None = None,
    ) -> None:
        self.curves = curves or {}
        self.status = status
        self.source = source

    def _curve(
        self, model: str, joint_index: int
    ) -> list[tuple[float, float]] | None:
        model_keys = [model]
        if model == "character-hrnet":
            model_keys.append("hrnet")
        elif model == "vitpose-humanart":
            model_keys.extend(["vitpose", "humanart"])
        elif model == "rtmw":
            model_keys.append("rtmw-x")
        joint_keys = (COCO_JOINTS[joint_index], str(joint_index))
        for model_key in model_keys:
            joints = self.curves.get(model_key)
            if joints is None:
                continue
            for joint_key in joint_keys:
                if joint_key in joints:
                    return joints[joint_key]
        return None

    def calibrate(self, model: str, joint_index: int, raw: float) -> float:
        raw_value = max(0.0, min(1.0, float(raw)))
        curve = self._curve(model, joint_index)
        if not curve:
            return raw_value
        if raw_value <= curve[0][0]:
            return curve[0][1]
        if raw_value >= curve[-1][0]:
            return curve[-1][1]
        for (left_x, left_y), (right_x, right_y) in zip(curve, curve[1:]):
            if raw_value <= right_x:
                fraction = (raw_value - left_x) / (right_x - left_x)
                return left_y + fraction * (right_y - left_y)
        return curve[-1][1]


def _load_confidence_calibration(path: Path) -> _ConfidenceCalibration:
    """Load and strictly validate a local calibration profile."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot read confidence calibration {path}: {error}") from error
    if not isinstance(document, dict) or document.get("schema_version") != "1.0.0":
        raise RuntimeError("confidence calibration schema_version must be 1.0.0")
    models = document.get("models")
    if not isinstance(models, dict) or not models:
        raise RuntimeError("confidence calibration models must be a non-empty object")
    curves: dict[str, dict[str, list[tuple[float, float]]]] = {}
    for model, model_value in models.items():
        if not isinstance(model, str) or not model:
            raise RuntimeError("confidence calibration model names must be non-empty strings")
        if not isinstance(model_value, dict):
            raise RuntimeError(f"confidence calibration model {model} must be an object")
        joints = model_value.get("joints")
        if not isinstance(joints, dict) or not joints:
            raise RuntimeError(f"confidence calibration model {model} needs a joints object")
        curves[model] = {}
        for joint, points in joints.items():
            if joint not in COCO_JOINTS and not (
                joint.isdigit() and 0 <= int(joint) < len(COCO_JOINTS)
            ):
                raise RuntimeError(f"unknown confidence calibration joint {model}/{joint}")
            if not isinstance(points, list) or len(points) < 2:
                raise RuntimeError(f"confidence calibration curve {model}/{joint} needs two points")
            validated: list[tuple[float, float]] = []
            previous_raw = -1.0
            previous_support = -1.0
            for point_index, point in enumerate(points):
                if not isinstance(point, list) or len(point) != 2:
                    raise RuntimeError(
                        f"confidence calibration point {model}/{joint}/{point_index} "
                        "must be [raw, support]"
                    )
                raw = _number(point[0], f"confidence calibration raw {model}/{joint}")
                support = _number(
                    point[1], f"confidence calibration support {model}/{joint}"
                )
                if not 0.0 <= raw <= 1.0 or not 0.0 <= support <= 1.0:
                    raise RuntimeError(
                        f"confidence calibration values {model}/{joint} must be in [0,1]"
                    )
                if raw <= previous_raw:
                    raise RuntimeError(
                        f"confidence calibration raw points must be strictly increasing "
                        f"for {model}/{joint}"
                    )
                if support < previous_support:
                    raise RuntimeError(
                        f"confidence calibration support points must be monotonic for "
                        f"{model}/{joint}"
                    )
                validated.append((raw, support))
                previous_raw = raw
                previous_support = support
            curves[model][joint] = validated
    # Structural validation succeeds here; the profile itself is not evidence
    # that a held-out calibration study was performed.
    return _ConfidenceCalibration(curves, "profile", path.resolve())


def _resolve_confidence_calibration(
    path: Path | None,
) -> _ConfidenceCalibration:
    project_root = Path(__file__).resolve().parents[2]
    candidate = path
    if candidate is None:
        candidate = project_root / DEFAULT_CONFIDENCE_CALIBRATION
        if not candidate.is_file():
            return _ConfidenceCalibration()
    try:
        return _load_confidence_calibration(candidate)
    except RuntimeError as error:
        if path is not None:
            raise
        print(json.dumps({
            "event": "warning",
            "stage": "confidence_calibration",
            "message": str(error),
        }), flush=True)
        return _ConfidenceCalibration(status="identity-auto-rejected", source=candidate)


def _roi_diagonal(
    roi: tuple[int, int, int, int] | None,
    fallback: float | None = None,
) -> float:
    if roi is not None:
        return max(1.0, math.hypot(float(roi[2]), float(roi[3])))
    return max(1.0, float(fallback or 1.0))


def _needs_npu_shadow_pass(
    scores: list[float], frame_index: int, mode: str, interval: int
) -> bool:
    if mode != "shadow":
        return False
    interval = max(1, interval)
    if frame_index % interval == 0:
        return True
    return bool(scores) and min(float(value) for value in scores) < 0.45 and frame_index % 5 == 0


def _compare_npu_shadow(
    npu_points: list[list[float]],
    npu_scores: list[float],
    reference_points: list[list[float]],
    reference_scores: list[float],
    roi: tuple[int, int, int, int],
) -> dict[str, float | int]:
    diagonal = _roi_diagonal(roi)
    compared = 0
    invalid = 0
    normalized_error = 0.0
    for npu_point, npu_score, reference_point, reference_score in zip(
        npu_points, npu_scores, reference_points, reference_scores
    ):
        if float(npu_score) <= 0.0:
            invalid += 1
            continue
        if float(reference_score) <= 0.0:
            continue
        normalized_error += math.dist(npu_point, reference_point) / diagonal
        compared += 1

    swaps = 0
    for left, right in COCO_LEFT_RIGHT_PAIRS:
        if any(
            float(scores[index]) <= 0.0
            for scores in (npu_scores, reference_scores)
            for index in (left, right)
        ):
            continue
        direct = math.dist(npu_points[left], reference_points[left]) + math.dist(
            npu_points[right], reference_points[right]
        )
        swapped = math.dist(npu_points[left], reference_points[right]) + math.dist(
            npu_points[right], reference_points[left]
        )
        if swapped + diagonal * 0.02 < direct:
            swaps += 1
    return {
        "compared_joints": compared,
        "invalid_joints": invalid,
        "normalized_error_sum": normalized_error,
        "left_right_swaps": swaps,
    }


def _npu_review_reasons(comparison: dict[str, float | int]) -> list[str]:
    """Turn a sparse NPU comparison into a non-authoritative review hint."""
    compared = int(comparison.get("compared_joints", 0))
    invalid = int(comparison.get("invalid_joints", 0))
    swaps = int(comparison.get("left_right_swaps", 0))
    normalized_error = float(comparison.get("normalized_error_sum", 0.0))
    mean_error = normalized_error / compared if compared else 0.0
    reasons: list[str] = []
    if swaps > 0:
        reasons.append("left_right_swap")
    if invalid >= 5:
        reasons.append("missing_joints")
    if compared >= 6 and mean_error >= 0.05:
        reasons.append("gpu_npu_disagreement")
    return reasons


def _fuse_coco_hypotheses(
    hypotheses: dict[
        str,
        tuple[list[list[float]], list[float]] | None,
    ],
    roi: tuple[int, int, int, int] | None = None,
    calibration: _ConfidenceCalibration | None = None,
    image_diagonal: float | None = None,
) -> tuple[list[list[float]], list[float], dict[str, int]]:
    """Fuse compatible per-model joint hypotheses without inventing limbs."""
    calibration = calibration or _ConfidenceCalibration()
    reference_diagonal = _roi_diagonal(roi, image_diagonal)
    compatibility_threshold = max(6.0, reference_diagonal * 0.035)
    priority = {
        "character-hrnet": 0,
        "hrnet": 0,
        "vitpose-humanart": 1,
        "rtmw": 2,
    }
    candidates_by_joint: list[list[dict[str, Any]]] = [
        [] for _ in range(len(COCO_JOINTS))
    ]
    fallback_points = [[0.0, 0.0] for _ in COCO_JOINTS]
    for model, value in hypotheses.items():
        if value is None:
            continue
        points, raw_scores = value
        if points:
            for index, point in enumerate(points[:len(COCO_JOINTS)]):
                if isinstance(point, list) and len(point) >= 2:
                    fallback_points[index] = [float(point[0]), float(point[1])]
        for index in range(min(len(points), len(raw_scores), len(COCO_JOINTS))):
            point = points[index]
            if not isinstance(point, list) or len(point) < 2:
                continue
            raw_score = max(0.0, min(1.0, float(raw_scores[index])))
            score = calibration.calibrate(model, index, raw_score)
            if score <= 0.0:
                continue
            candidates_by_joint[index].append({
                "model": model,
                "point": [float(point[0]), float(point[1])],
                "raw_score": raw_score,
                "score": score,
            })

    fused_points: list[list[float]] = []
    fused_scores: list[float] = []
    diagnostics = {
        "fused_joints": 0,
        "agreement_joints": 0,
        "conflict_joints": 0,
        "missing_joints": 0,
    }
    base_models = {"hrnet", "character-hrnet"}
    for index, candidates in enumerate(candidates_by_joint):
        if not candidates:
            fused_points.append(fallback_points[index])
            fused_scores.append(0.0)
            diagnostics["missing_joints"] += 1
            continue

        clusters: list[list[dict[str, Any]]] = []
        ordered = sorted(
            candidates,
            key=lambda item: (
                priority.get(str(item["model"]), 9),
                -float(item["score"]),
                str(item["model"]),
            ),
        )
        for candidate in ordered:
            compatible = [
                cluster for cluster in clusters
                if all(
                    math.dist(candidate["point"], member["point"])
                    <= compatibility_threshold
                    for member in cluster
                )
            ]
            if not compatible:
                clusters.append([candidate])
            else:
                selected = max(
                    compatible,
                    key=lambda cluster: (
                        sum(float(item["score"]) for item in cluster),
                        len(cluster),
                    ),
                )
                selected.append(candidate)

        def cluster_key(cluster: list[dict[str, Any]]) -> tuple[float, int, float]:
            return (
                sum(float(item["score"]) for item in cluster),
                len(cluster),
                max(float(item["score"]) for item in cluster),
            )

        clusters.sort(key=cluster_key, reverse=True)
        top = clusters[0]
        second = clusters[1] if len(clusters) > 1 else None
        top_support = cluster_key(top)[0]
        second_support = cluster_key(second)[0] if second else 0.0
        clear_winner = second is None or (
            top_support >= second_support + 0.18
            and top_support >= second_support * 1.15
        )
        conflict = second is not None and not clear_winner
        if conflict:
            diagnostics["conflict_joints"] += 1
            base_candidate = next(
                (
                    item for item in candidates
                    if str(item["model"]) in base_models
                ),
                None,
            )
            chosen = base_candidate or max(
                candidates, key=lambda item: float(item["score"])
            )
            fused_points.append(list(chosen["point"]))
            fused_scores.append(max(0.0, min(1.0, float(chosen["score"]) * 0.55)))
            continue

        strongest = max(top, key=lambda item: float(item["score"]))
        runner_up_score = max(
            (float(item["score"]) for item in top if item is not strongest),
            default=0.0,
        )
        if len(top) == 1 or float(strongest["score"]) >= runner_up_score + 0.20:
            fused_points.append(list(strongest["point"]))
            fused_scores.append(float(strongest["score"]))
        else:
            weights = [max(0.05, float(item["score"])) for item in top]
            total = sum(weights)
            fused_points.append([
                sum(item["point"][axis] * weight for item, weight in zip(top, weights))
                / total
                for axis in range(2)
            ])
            fused_scores.append(min(
                1.0,
                max(float(item["score"]) for item in top) + 0.05 * (len(top) - 1),
            ))
            diagnostics["agreement_joints"] += 1
        diagnostics["fused_joints"] += 1

    return fused_points, fused_scores, diagnostics


def _fuse_coco_observations(
    base_points: list[list[float]],
    base_scores: list[float],
    refined_points: list[list[float]],
    refined_scores: list[float],
    image_diagonal: float,
) -> tuple[list[list[float]], list[float]]:
    """Backward-compatible two-expert wrapper around joint hypothesis fusion."""
    points, scores, _diagnostics = _fuse_coco_hypotheses(
        {
            "hrnet": (base_points, base_scores),
            "rtmw": (refined_points, refined_scores),
        },
        image_diagonal=image_diagonal,
    )
    return points, scores


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


def _load_sam2_predictor(
    checkpoint: Path, device: str | None
) -> tuple[Any, Any, str]:
    if not checkpoint.is_file():
        raise RuntimeError(f"SAM 2.1 checkpoint is unavailable: {checkpoint}")
    import torch
    from sam2.build_sam import build_sam2_video_predictor

    resolved_device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    predictor = build_sam2_video_predictor(
        SAM2_CONFIG,
        str(checkpoint),
        device=resolved_device,
        apply_postprocessing=False,
    )
    return predictor, torch, resolved_device


class _Sam2VideoMaskProvider:
    """Lazy SAM 2.1 video-object mask stream prompted by the person ROI."""

    def __init__(
        self,
        input_path: Path,
        checkpoint: Path,
        device: str | None,
        cv2_module: Any,
        np_module: Any,
        predictor: Any = None,
        torch_module: Any = None,
        resolved_device: str | None = None,
    ) -> None:
        if not checkpoint.is_file():
            raise RuntimeError(f"SAM 2.1 checkpoint is unavailable: {checkpoint}")
        self.cv2 = cv2_module
        self.np = np_module
        if predictor is None:
            self.predictor, self.torch, self.device = _load_sam2_predictor(
                checkpoint, device
            )
        else:
            if torch_module is None:
                raise RuntimeError("shared SAM 2.1 predictor requires its torch runtime")
            self.torch = torch_module
            self.device = resolved_device or device or "cpu"
            self.predictor = predictor
        self.input_path = input_path
        self.state: Any = None
        self.iterator: Any = None
        self.cache: dict[int, Any] = {}
        self.exhausted = False
        self.used = False

    def _precision_context(self) -> Any:
        if str(self.device).startswith("cuda"):
            return self.torch.autocast("cuda", dtype=self.torch.bfloat16)
        return nullcontext()

    def ensure_started(self, roi: tuple[int, int, int, int]) -> None:
        if self.state is not None:
            return
        x, y, width, height = roi
        box = self.np.asarray(
            [x, y, x + width - 1, y + height - 1], dtype=self.np.float32
        )
        with self.torch.inference_mode(), self._precision_context():
            self.state = self.predictor.init_state(
                video_path=str(self.input_path),
                offload_video_to_cpu=True,
                offload_state_to_cpu=True,
            )
            self.predictor.add_new_points_or_box(
                inference_state=self.state,
                frame_idx=0,
                obj_id=1,
                box=box,
            )
            self.iterator = iter(self.predictor.propagate_in_video(self.state))

    def _advance(self, target_frame: int) -> None:
        while not self.exhausted and target_frame not in self.cache:
            try:
                with self.torch.inference_mode(), self._precision_context():
                    frame_index, object_ids, mask_logits = next(self.iterator)
            except StopIteration:
                self.exhausted = True
                break
            if len(object_ids) == 0:
                continue
            mask = (mask_logits[0, 0] > 0.0).to("cpu").numpy()
            self.cache[int(frame_index)] = (mask.astype(self.np.uint8) * 255)

    def mask_for_frame(
        self,
        frame_index: int,
        roi: tuple[int, int, int, int],
    ) -> Any:
        self.ensure_started(roi)
        self._advance(frame_index)
        full_mask = self.cache.pop(frame_index, None)
        if full_mask is None:
            return None
        x, y, width, height = roi
        cropped = full_mask[y:y + height, x:x + width]
        if not _mask_ratio_is_valid(cropped, self.np):
            return None
        kernel_size = max(3, int(min(width, height) * 0.012))
        if kernel_size % 2 == 0:
            kernel_size += 1
        kernel = self.cv2.getStructuringElement(
            self.cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
        )
        self.used = True
        return self.cv2.morphologyEx(cropped, self.cv2.MORPH_CLOSE, kernel)

    def close(self) -> None:
        if self.state is not None:
            try:
                self.predictor.reset_state(self.state)
            except Exception:  # noqa: BLE001 - best-effort GPU state cleanup
                pass
        self.state = None
        self.iterator = None
        self.cache.clear()


class _TemporalFusion:
    """Fuse pose heatmaps with optical flow under a conservative foreground mask."""

    def __init__(
        self,
        cv2_module: Any,
        np_module: Any,
        roi: tuple[int, int, int, int],
        mask_provider: Any = None,
    ) -> None:
        self.cv2 = cv2_module
        self.np = np_module
        self.roi = roi
        self.previous_gray: Any = None
        self.previous_points: Any = None
        self.foreground_mask: Any = None
        self.frame_index = 0
        self.mask_provider = mask_provider
        self.mask_provider_error = ""

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
            return mask if _mask_ratio_is_valid(mask, self.np) else fallback
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
        provider_mask = None
        if self.mask_provider is not None:
            try:
                provider_mask = self.mask_provider.mask_for_frame(
                    self.frame_index, self.roi
                )
            except Exception as error:
                self.mask_provider_error = str(error)
                self.mask_provider = None
        if provider_mask is not None:
            self.foreground_mask = provider_mask
        elif self.foreground_mask is None or self.frame_index % 5 == 0:
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


def _load_high_accuracy_refiner(
    inferencer_type: Any, device: str | None
) -> Any:
    import mmpose

    config = Path(mmpose.__file__).resolve().parent / ".mim" / RTMW_CONFIG
    if not config.is_file():
        raise RuntimeError(f"RTMW config is unavailable: {config}")
    return inferencer_type(
        pose2d=str(config),
        pose2d_weights=RTMW_WEIGHTS,
        det_model="whole_image",
        device=device,
    )


@contextmanager
def _trusted_openmmlab_checkpoint_load() -> Any:
    """Allow legacy official OpenMMLab checkpoints under PyTorch 2.6+.

    PyTorch changed ``torch.load`` to ``weights_only=True`` by default.  The
    pinned OpenMMLab checkpoints contain NumPy metadata that predates that
    restriction, so MMEngine cannot load them without opting out explicitly.
    Keep the compatibility override scoped to the two immutable official model
    URLs owned by this adapter; user-supplied checkpoints never pass through it.
    """
    import torch

    original_load = torch.load

    def load_legacy_checkpoint(*args: Any, **kwargs: Any) -> Any:
        kwargs.setdefault("weights_only", False)
        return original_load(*args, **kwargs)

    torch.load = load_legacy_checkpoint
    try:
        yield
    finally:
        torch.load = original_load


def _humanart_runtime_config() -> Any:
    """Return the bundled Human-Art config adapted to MMPreTrain 1.x.

    MMPose 1.3.2 still ships this config with the retired ``mmcls`` registry
    name and its old ``output_cls_token`` argument.  MMPreTrain is the supported
    successor.  Patch a Config object in memory so site-packages and the source
    config remain untouched, and disable the redundant backbone pretraining
    download because the complete Human-Art checkpoint is loaded immediately.
    """
    import mmpose
    from mmengine import Config
    from mmpretrain.utils import register_all_modules

    register_all_modules(init_default_scope=False)
    source = Path(mmpose.__file__).resolve().parent / ".mim" / HUMANART_CONFIG
    if not source.is_file():
        raise RuntimeError(f"Human-Art ViTPose-L config is unavailable: {source}")
    config = Config.fromfile(str(source))
    backbone = config.model.backbone
    if backbone.type not in ("mmcls.VisionTransformer", "mmpretrain.VisionTransformer"):
        raise RuntimeError(
            f"unsupported Human-Art ViTPose backbone: {backbone.type}"
        )
    backbone.type = "mmpretrain.VisionTransformer"
    backbone.pop("output_cls_token", None)
    backbone.out_type = "featmap"
    backbone.init_cfg = None
    return config


def _load_humanart_expert(
    inferencer_type: Any, device: str | None
) -> Any:
    """Load the independent Human-Art ViTPose-L animation expert."""
    if importlib.util.find_spec("mmpretrain") is None:
        raise RuntimeError(
            "mmpretrain is unavailable; install the guided MMPose dependencies "
            "to enable Human-Art ViTPose-L"
        )
    config = _humanart_runtime_config()
    with _trusted_openmmlab_checkpoint_load():
        return inferencer_type(
            pose2d=config,
            pose2d_weights=HUMANART_WEIGHTS,
            det_model="whole_image",
            device=device,
        )


def _prepare_offline_models(device: str | None = "cpu") -> None:
    """Resolve and cache every checkpoint needed by the offline quality path."""
    inferencer_type = _load_inferencer()
    base = inferencer_type(
        pose3d="human3d",
        pose2d="td-hm_hrnet-w32_8xb64-210e_coco-256x192",
        det_model="whole_image",
        device=device,
    )
    del base
    refiner = _load_high_accuracy_refiner(inferencer_type, device)
    del refiner
    humanart = _load_humanart_expert(inferencer_type, device)
    del humanart


def _resolve_anime_pose_model(
    config: Path | None,
    weights: Path | None,
) -> tuple[Path | None, Path | None]:
    if (config is None) != (weights is None):
        raise RuntimeError("anime pose config and weights must be provided together")
    if config is None:
        activated = Path(__file__).resolve().parents[2] / "private" / "models" / "anime-pose"
        candidate_config = activated / "config.py"
        candidate_weights = activated / "checkpoint.pth"
        if candidate_config.is_file() and candidate_weights.is_file():
            config, weights = candidate_config, candidate_weights
    if config is not None and (not config.is_file() or not weights or not weights.is_file()):
        raise RuntimeError("activated anime pose config/checkpoint is incomplete")
    return config, weights


def _base_model_name(anime_pose_weights: Path | None) -> str:
    return "character-hrnet" if anime_pose_weights is not None else "hrnet"


def _refine_frame_2d(
    refiner: Any,
    frame: Any,
    roi: tuple[int, int, int, int],
) -> tuple[list[list[float]], list[float]] | None:
    x, y, width, height = roi
    crop = frame[y:y + height, x:x + width]
    if crop.size == 0:
        return None
    # The top-level video inferencer uses the mutable crop hook, but this
    # helper already passes a cropped ndarray to each independent 2D expert.
    # Disable the hook for the nested call so the ROI is not applied twice.
    previous_crop = _ACTIVE_CROP_ROI
    _set_active_crop(None)
    try:
        result = next(refiner(crop, return_vis=False, show=False))
        prediction = _prediction(result)
        keypoints = prediction.get("keypoints")
        scores = prediction.get("keypoint_scores")
        if keypoints is None or scores is None:
            return None
        if hasattr(keypoints, "tolist"):
            keypoints = keypoints.tolist()
        if hasattr(scores, "tolist"):
            scores = scores.tolist()
        if keypoints and isinstance(keypoints[0][0], list):
            keypoints = keypoints[0]
        if scores and isinstance(scores[0], list):
            scores = scores[0]
        points = [
            [float(point[0]) + x, float(point[1]) + y]
            for point in keypoints
        ]
        return points, [float(score) for score in scores]
    except (RuntimeError, StopIteration, KeyError, TypeError, ValueError):
        return None
    finally:
        _set_active_crop(previous_crop)


def _probe_cuda(torch: Any) -> bool:
    if not torch.cuda.is_available():
        return False
    try:
        probe = torch.zeros(1, device="cuda")
        probe.add_(1)
        torch.cuda.synchronize()
    except RuntimeError as error:
        raise RuntimeError(
            "PyTorch can see CUDA but cannot execute a GPU kernel. "
            "Install the CUDA build matching the target GPU (RTX 50-series "
            "requires a Blackwell-capable build): " + str(error)
        ) from error
    return True


class MMPoseSession:
    """One reusable GPU model set for a sequence of video views."""

    def __init__(
        self,
        device: str | None = None,
        quality: str = "balanced",
        segmentation: str = "auto",
        sam2_checkpoint: Path | None = None,
        anime_pose_config: Path | None = None,
        anime_pose_weights: Path | None = None,
        confidence_calibration: Path | None = None,
        npu_mode: str = "off",
        npu_model: Path | None = None,
        npu_sample_interval: int = 15,
    ) -> None:
        try:
            import cv2
            import numpy as np
            inferencer_type = _load_inferencer()
        except ImportError as error:
            raise RuntimeError(
                f"MMPose adapter import failed: {error}. Run tools/setup_mmpose.ps1."
            ) from error

        self.cv2 = cv2
        self.np = np
        self.device = device
        self.quality = quality
        self.segmentation = segmentation
        self.anime_pose_config, self.anime_pose_weights = _resolve_anime_pose_model(
            anime_pose_config, anime_pose_weights
        )
        self.calibration = _resolve_confidence_calibration(confidence_calibration)
        self.base_model = _base_model_name(self.anime_pose_weights)
        if npu_mode not in ("off", "shadow"):
            raise RuntimeError("NPU mode must be off or shadow")
        if npu_sample_interval < 1:
            raise RuntimeError("NPU sample interval must be at least one frame")
        self.npu_mode = npu_mode
        self.npu_sample_interval = npu_sample_interval
        inferencer_arguments: dict[str, Any] = dict(
            pose3d="human3d",
            pose2d=(
                str(self.anime_pose_config)
                if self.anime_pose_config is not None
                else "td-hm_hrnet-w32_8xb64-210e_coco-256x192"
            ),
            det_model="whole_image",
            device=device,
        )
        if self.anime_pose_weights is not None:
            inferencer_arguments["pose2d_weights"] = str(self.anime_pose_weights)
        self.inferencer = inferencer_type(**inferencer_arguments)

        self.high_accuracy_refiner = None
        self.high_accuracy_error = ""
        self.humanart_expert = None
        self.humanart_error = ""
        if quality != "fast":
            try:
                self.high_accuracy_refiner = _load_high_accuracy_refiner(
                    inferencer_type, device
                )
            except Exception as error:  # noqa: BLE001 - optional model boundary
                self.high_accuracy_error = str(error)
            try:
                self.humanart_expert = _load_humanart_expert(
                    inferencer_type, device
                )
            except Exception as error:  # noqa: BLE001 - optional model boundary
                self.humanart_error = str(error)

        self.npu_observer = None
        self.npu_error = ""
        if npu_mode == "shadow":
            try:
                self.npu_observer = OpenVinoNpuPoseObserver(
                    Path(__file__).resolve().parents[2], model_path=npu_model
                )
            except Exception as error:  # noqa: BLE001 - optional device boundary
                self.npu_error = str(error)

        self.sam2_checkpoint = sam2_checkpoint or (
            Path(__file__).resolve().parents[2]
            / "private" / "models" / "sam2" / "sam2.1_hiera_small.pt"
        )
        self.sam2_predictor = None
        self.sam2_torch = None
        self.sam2_device = device or "cpu"
        self.sam2_error = ""
        if segmentation != "grabcut":
            try:
                (
                    self.sam2_predictor,
                    self.sam2_torch,
                    self.sam2_device,
                ) = _load_sam2_predictor(self.sam2_checkpoint, device)
            except Exception as error:  # noqa: BLE001 - optional model boundary
                self.sam2_error = str(error)
                if segmentation == "sam2":
                    raise RuntimeError(
                        f"SAM 2.1 segmentation was required but could not start: {error}"
                    ) from error

    def mask_provider(self, input_path: Path) -> _Sam2VideoMaskProvider | None:
        if self.sam2_predictor is None:
            return None
        return _Sam2VideoMaskProvider(
            input_path,
            self.sam2_checkpoint,
            self.device,
            self.cv2,
            self.np,
            predictor=self.sam2_predictor,
            torch_module=self.sam2_torch,
            resolved_device=self.sam2_device,
        )

    def reset_video_state(self) -> None:
        for wrapper in (
            self.inferencer,
            self.high_accuracy_refiner,
            self.humanart_expert,
        ):
            inner = getattr(wrapper, "inferencer", None)
            buffer = getattr(inner, "_buffer", None)
            if hasattr(buffer, "clear"):
                buffer.clear()

    def run(
        self,
        input_path: Path,
        output_path: Path,
        roi: tuple[int, int, int, int] | None = None,
    ) -> None:
        try:
            _run_mmpose_with_session(self, input_path, output_path, roi)
        finally:
            self.reset_video_state()

    def close(self) -> None:
        self.reset_video_state()
        self.inferencer = None
        self.high_accuracy_refiner = None
        self.humanart_expert = None
        self.npu_observer = None
        self.sam2_predictor = None
        gc.collect()
        torch_module = self.sam2_torch or sys.modules.get("torch")
        if torch_module is not None and torch_module.cuda.is_available():
            torch_module.cuda.empty_cache()
        self.sam2_torch = None


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

def _run_mmpose_with_session(
    session: MMPoseSession,
    input_path: Path,
    output_path: Path,
    roi: tuple[int, int, int, int] | None = None,
) -> None:
    cv2 = session.cv2
    np = session.np
    quality = session.quality
    segmentation = session.segmentation
    anime_pose_weights = session.anime_pose_weights
    calibration = session.calibration
    base_model = session.base_model
    npu_observer = session.npu_observer
    npu_error = session.npu_error

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
    mask_provider = session.mask_provider(input_path)
    sam2_error = session.sam2_error
    if sam2_error:
        print(json.dumps({
            "event": "warning",
            "stage": "sam2_mask",
            "message": sam2_error,
        }), flush=True)
    temporal_fusion = _TemporalFusion(cv2, np, effective_roi, mask_provider)
    inferencer = session.inferencer
    high_accuracy_refiner = session.high_accuracy_refiner
    high_accuracy_error = session.high_accuracy_error
    if high_accuracy_error:
        print(json.dumps({
            "event": "warning",
            "stage": "rtmw_refiner",
            "message": high_accuracy_error,
        }), flush=True)
    humanart_expert = session.humanart_expert
    humanart_error = session.humanart_error
    if humanart_error:
        print(json.dumps({
            "event": "warning",
            "stage": "vitpose_humanart",
            "message": humanart_error,
        }), flush=True)
    if npu_error:
        print(json.dumps({
            "event": "warning",
            "stage": "openvino_npu_shadow",
            "message": npu_error,
        }), flush=True)
    frames = []
    planar_fallback_frames = 0
    high_accuracy_frames = 0
    humanart_frames = 0
    fusion_totals = {
        "fused_joints": 0,
        "agreement_joints": 0,
        "conflict_joints": 0,
        "missing_joints": 0,
    }
    npu_totals: dict[str, float | int] = {
        "sampled_frames": 0,
        "compared_joints": 0,
        "invalid_joints": 0,
        "normalized_error_sum": 0.0,
        "left_right_swaps": 0,
        "latency_ms_sum": 0.0,
    }
    npu_review_frames: list[dict[str, Any]] = []
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
            refined_hypothesis = None
            if (
                high_accuracy_refiner is not None
                and flow_frame_ok
                and _needs_high_accuracy_pass(coco_scores, frame_index, quality)
            ):
                refined_hypothesis = _refine_frame_2d(
                    high_accuracy_refiner, flow_frame, effective_roi
                )
                if refined_hypothesis is not None:
                    high_accuracy_frames += 1

            humanart_hypothesis = None
            if (
                humanart_expert is not None
                and flow_frame_ok
                and _needs_humanart_pass(coco_scores, frame_index, quality)
            ):
                humanart_hypothesis = _refine_frame_2d(
                    humanart_expert, flow_frame, effective_roi
                )
                if humanart_hypothesis is not None:
                    humanart_frames += 1

            hypotheses: dict[
                str,
                tuple[list[list[float]], list[float]] | None,
            ] = {
                base_model: (coco_points, coco_scores),
                "vitpose-humanart": humanart_hypothesis,
                "rtmw": refined_hypothesis,
            }
            coco_points, coco_scores, fusion_diagnostics = _fuse_coco_hypotheses(
                hypotheses,
                roi=effective_roi,
                calibration=calibration,
            )
            for key, value in fusion_diagnostics.items():
                fusion_totals[key] += value
            if (
                npu_observer is not None
                and flow_frame_ok
                and _needs_npu_shadow_pass(
                    coco_scores,
                    frame_index,
                    session.npu_mode,
                    session.npu_sample_interval,
                )
            ):
                try:
                    npu_observation = npu_observer.infer(flow_frame, effective_roi)
                    comparison = _compare_npu_shadow(
                        npu_observation.points,
                        npu_observation.scores,
                        coco_points,
                        coco_scores,
                        effective_roi,
                    )
                    npu_totals["sampled_frames"] += 1
                    npu_totals["latency_ms_sum"] += npu_observation.latency_ms
                    for key in (
                        "compared_joints", "invalid_joints",
                        "normalized_error_sum", "left_right_swaps",
                    ):
                        npu_totals[key] += comparison[key]
                    reasons = _npu_review_reasons(comparison)
                    if reasons:
                        compared = int(comparison["compared_joints"])
                        npu_review_frames.append({
                            "frame_index": frame_index,
                            "time_s": frame_index / fps,
                            "reasons": reasons,
                            "mean_normalized_error": (
                                float(comparison["normalized_error_sum"]) / compared
                                if compared else None
                            ),
                            "invalid_joints": int(comparison["invalid_joints"]),
                            "left_right_swaps": int(comparison["left_right_swaps"]),
                        })
                except Exception as error:  # noqa: BLE001 - optional device boundary
                    session.npu_error = str(error)
                    npu_error = session.npu_error
                    npu_observer = None
                    session.npu_observer = None
                    print(json.dumps({
                        "event": "warning",
                        "stage": "openvino_npu_shadow",
                        "message": npu_error,
                    }), flush=True)
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
    if mask_provider is not None:
        mask_provider.close()
    if not frames:
        raise RuntimeError("MMPose produced no frames")

    print(json.dumps({
        "event": "fusion_diagnostics",
        **fusion_totals,
        "calibration": calibration.status,
    }), flush=True)
    sampled_frames = int(npu_totals["sampled_frames"])
    compared_joints = int(npu_totals["compared_joints"])
    npu_diagnostics = {
        "event": "npu_shadow_diagnostics",
        "schema_version": "1.0.0",
        "authoritative": False,
        "policy": "sparse-shadow-only",
        "role": "review-queue-scout",
        "mode": session.npu_mode,
        "status": (
            "active" if sampled_frames
            else "unavailable" if npu_error
            else "inactive"
        ),
        "total_frames": len(frames),
        "sample_interval": session.npu_sample_interval,
        "sampled_frames": sampled_frames,
        "sampled_ratio": sampled_frames / len(frames),
        "compared_joints": compared_joints,
        "invalid_joints": int(npu_totals["invalid_joints"]),
        "mean_normalized_error": (
            float(npu_totals["normalized_error_sum"]) / compared_joints
            if compared_joints else None
        ),
        "left_right_swaps": int(npu_totals["left_right_swaps"]),
        "review_frame_count": len(npu_review_frames),
        "review_frames": npu_review_frames,
        "mean_latency_ms": (
            float(npu_totals["latency_ms_sum"]) / sampled_frames
            if sampled_frames else None
        ),
        "message": npu_error,
        "device": (
            session.npu_observer.execution_devices
            if session.npu_observer is not None else ""
        ),
        "model_xml_sha256": MODEL_XML_SHA256,
        "model_bin_sha256": MODEL_BIN_SHA256,
    }
    print(json.dumps(npu_diagnostics), flush=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.with_name("npu-shadow-diagnostics.json").write_text(
        json.dumps(npu_diagnostics, indent=2, sort_keys=True), encoding="utf-8"
    )
    output_path.write_text(json.dumps({
        "schema_version": SCHEMA_VERSION,
        "source_video": str(input_path.resolve()),
        "backend": (
            (
                "mmpose-hrnet-motionbert+2.5d-fallback"
                if planar_fallback_frames
                else "mmpose-hrnet-motionbert"
            )
            + "+lk-flow"
            + (
                "+sam2.1-mask"
                if mask_provider is not None and mask_provider.used
                else "+grabcut+sam2-unavailable"
                if segmentation != "grabcut" and (
                    sam2_error or temporal_fusion.mask_provider_error
                )
                else "+grabcut"
            )
            + (
                "+rtmw-x-384-adaptive"
                if high_accuracy_frames and quality == "balanced"
                else "+rtmw-x-384-full"
                if high_accuracy_frames
                else "+rtmw-unavailable"
                if quality != "fast" and high_accuracy_error
                else ""
            )
            + (
                "+vitpose-humanart-adaptive"
                if humanart_frames and quality == "balanced"
                else "+vitpose-humanart-full"
                if humanart_frames
                else "+vitpose-humanart-unavailable"
                if quality != "fast" and (
                    humanart_error or (humanart_expert is not None and not humanart_frames)
                )
                else ""
            )
            + "+joint-hypothesis-fusion"
            + (
                "+uncertain-joint-conflicts"
                if fusion_totals["conflict_joints"]
                else ""
            )
            + (
                "+confidence-calibration-profile"
                if calibration.status == "profile"
                else "+confidence-calibration-identity"
            )
            + ("+anime-finetuned-hrnet" if anime_pose_weights is not None else "")
            + (
                "+openvino-npu-shadow"
                if sampled_frames
                else "+openvino-npu-unavailable"
                if session.npu_mode == "shadow" and npu_error
                else ""
            )
            + ("+user-roi" if roi is not None else "+auto-body-roi")
        ),
        "image_width": width,
        "image_height": height,
        "fps": fps,
        "frames": frames,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def run_mmpose(
    input_path: Path,
    output_path: Path,
    device: str | None,
    roi: tuple[int, int, int, int] | None = None,
    quality: str = "balanced",
    segmentation: str = "auto",
    sam2_checkpoint: Path | None = None,
    anime_pose_config: Path | None = None,
    anime_pose_weights: Path | None = None,
    confidence_calibration: Path | None = None,
    npu_mode: str = "off",
    npu_model: Path | None = None,
    npu_sample_interval: int = 15,
) -> None:
    session = MMPoseSession(
        device=device,
        quality=quality,
        segmentation=segmentation,
        sam2_checkpoint=sam2_checkpoint,
        anime_pose_config=anime_pose_config,
        anime_pose_weights=anime_pose_weights,
        confidence_calibration=confidence_calibration,
        npu_mode=npu_mode,
        npu_model=npu_model,
        npu_sample_interval=npu_sample_interval,
    )
    try:
        session.run(input_path, output_path, roi)
    finally:
        session.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--device", default=None)
    parser.add_argument("--roi", nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument(
        "--quality", choices=("fast", "balanced", "maximum"), default="balanced"
    )
    parser.add_argument(
        "--segmentation", choices=("auto", "grabcut", "sam2"), default="auto"
    )
    parser.add_argument("--sam2-checkpoint", type=Path, default=None)
    parser.add_argument("--anime-pose-config", type=Path, default=None)
    parser.add_argument("--anime-pose-weights", type=Path, default=None)
    parser.add_argument("--confidence-calibration", type=Path, default=None)
    parser.add_argument("--npu-mode", choices=("off", "shadow"), default="off")
    parser.add_argument("--npu-model", type=Path, default=None)
    parser.add_argument("--npu-sample-interval", type=int, default=15)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--prepare-models", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            _load_inferencer()
            import cv2
            import mmcv
            import mmengine
            import mmpose
            import torch
            cuda_ready = _probe_cuda(torch)
            try:
                import mmpretrain
                mmpretrain_version = mmpretrain.__version__
                _humanart_runtime_config()
                humanart_status = "runtime-config-ready"
            except ImportError:
                mmpretrain_version = None
                humanart_status = "dependency-missing"
            except Exception as error:  # noqa: BLE001 - readiness boundary
                humanart_status = f"runtime-config-error: {error}"
            try:
                import openvino as ov
                openvino_version = ov.get_version()
                openvino_devices = ov.Core().available_devices
            except ImportError:
                openvino_version = None
                openvino_devices = []
            print(json.dumps({
                "event": "ready", "mmpose": mmpose.__version__,
                "mmcv": mmcv.__version__, "mmengine": mmengine.__version__,
                "torch": torch.__version__, "opencv": cv2.__version__,
                "cuda": cuda_ready, "mmpretrain": mmpretrain_version,
                "vitpose_humanart": humanart_status,
                "openvino": openvino_version,
                "intel_npu": "available" if "NPU" in openvino_devices else "unavailable",
            }), flush=True)
            return 0
        if args.prepare_models:
            _prepare_offline_models(args.device or "cpu")
            print(json.dumps({
                "event": "models_ready",
                "models": [
                    "hrnet-w32-coco", "motionbert-human3d", "rtmw-x-384",
                    "vitpose-humanart-large",
                ],
            }), flush=True)
            return 0
        if args.input is None or args.output is None:
            parser.error(
                "--input and --output are required unless --check or --prepare-models is used"
            )
        roi = tuple(args.roi) if args.roi is not None else None
        run_mmpose(
            args.input,
            args.output,
            args.device,
            roi,
            args.quality,
            args.segmentation,
            args.sam2_checkpoint,
            args.anime_pose_config,
            args.anime_pose_weights,
            args.confidence_calibration,
            args.npu_mode,
            args.npu_model,
            args.npu_sample_interval,
        )
        print(json.dumps({"event": "complete", "output": str(args.output)}), flush=True)
        return 0
    except Exception as error:  # adapter boundary reports a concise process error
        print(json.dumps({"event": "error", "message": str(error)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

