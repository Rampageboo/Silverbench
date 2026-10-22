"""Confidence-weighted calibrated triangulation for synchronized pose views."""

from __future__ import annotations

import argparse
import bisect
import itertools
import json
import math
from pathlib import Path
from typing import Any


def _weighted_dlt(
    normalized_points: list[tuple[float, float]],
    projection_matrices: list[Any],
    weights: list[float],
    np_module: Any,
) -> Any | None:
    if len(normalized_points) < 2:
        return None
    rows = []
    for (x, y), projection, weight in zip(
        normalized_points, projection_matrices, weights
    ):
        scale = math.sqrt(max(1e-6, float(weight)))
        rows.append((x * projection[2] - projection[0]) * scale)
        rows.append((y * projection[2] - projection[1]) * scale)
    _u, _s, vh = np_module.linalg.svd(np_module.asarray(rows), full_matrices=False)
    homogeneous = vh[-1]
    if abs(float(homogeneous[3])) < 1e-10:
        return None
    point = homogeneous[:3] / homogeneous[3]
    return point if np_module.all(np_module.isfinite(point)) else None


def _camera_values(camera: dict[str, Any], np_module: Any) -> tuple[Any, Any, Any, Any]:
    matrix = np_module.asarray(camera["camera_matrix"], dtype=np_module.float64)
    distortion = np_module.asarray(camera["distortion"], dtype=np_module.float64)
    rotation = np_module.asarray(
        camera["rotation_world_to_camera"], dtype=np_module.float64
    )
    translation = np_module.asarray(
        camera["translation_world_to_camera_m"], dtype=np_module.float64
    ).reshape(3, 1)
    projection = np_module.concatenate((rotation, translation), axis=1)
    return matrix, distortion, rotation, projection


def _triangulate(
    observations: list[tuple[dict[str, Any], list[float], float]],
    reprojection_threshold_px: float,
    cv2_module: Any,
    np_module: Any,
) -> tuple[Any, float, int] | None:
    if len(observations) < 2:
        return None
    normalized = []
    projections = []
    weights = []
    camera_values = []
    for camera, point, confidence in observations:
        matrix, distortion, rotation, projection = _camera_values(camera, np_module)
        undistorted = cv2_module.undistortPoints(
            np_module.asarray(point, dtype=np_module.float64).reshape(1, 1, 2),
            matrix, distortion,
        ).reshape(2)
        normalized.append((float(undistorted[0]), float(undistorted[1])))
        projections.append(projection)
        weights.append(max(0.02, float(confidence) ** 2))
        camera_values.append((matrix, distortion, rotation, projection[:, 3]))
    def residuals_for(candidate: Any) -> list[float]:
        result = []
        for (_camera, image_point, _confidence), values in zip(
            observations, camera_values
        ):
            matrix, distortion, rotation, translation = values
            projected, _ = cv2_module.projectPoints(
                candidate.reshape(1, 1, 3), cv2_module.Rodrigues(rotation)[0],
                translation.reshape(3, 1), matrix, distortion,
            )
            result.append(math.dist(projected.reshape(2).tolist(), image_point))
        return result

    candidate_subsets = [tuple(range(len(observations)))]
    candidate_subsets.extend(itertools.combinations(range(len(observations)), 2))
    best: tuple[int, float, Any, list[int]] | None = None
    for subset in candidate_subsets:
        candidate = _weighted_dlt(
            [normalized[index] for index in subset],
            [projections[index] for index in subset],
            [weights[index] for index in subset], np_module,
        )
        if candidate is None:
            continue
        candidate_residuals = residuals_for(candidate)
        candidate_inliers = [
            index for index, residual in enumerate(candidate_residuals)
            if residual <= reprojection_threshold_px
        ]
        if len(candidate_inliers) < 2:
            continue
        inlier_rms = math.sqrt(sum(
            candidate_residuals[index] ** 2 for index in candidate_inliers
        ) / len(candidate_inliers))
        rank = (len(candidate_inliers), -inlier_rms)
        if best is None or rank > (best[0], best[1]):
            best = (rank[0], rank[1], candidate, candidate_inliers)
    if best is None:
        return None
    inliers = best[3]
    point = _weighted_dlt(
        [normalized[index] for index in inliers],
        [projections[index] for index in inliers],
        [weights[index] for index in inliers], np_module,
    )
    if point is None:
        return None
    observations = [observations[index] for index in inliers]
    camera_values = [camera_values[index] for index in inliers]
    residuals = []
    for (_camera, image_point, _confidence), values in zip(
        observations, camera_values
    ):
        matrix, distortion, rotation, translation = values
        projected, _ = cv2_module.projectPoints(
            point.reshape(1, 1, 3), cv2_module.Rodrigues(rotation)[0],
            translation.reshape(3, 1), matrix, distortion,
        )
        residuals.append(math.dist(projected.reshape(2).tolist(), image_point))
    if len(observations) < 2 or max(residuals, default=math.inf) > reprojection_threshold_px:
        return None
    for values in camera_values:
        _matrix, _distortion, rotation, translation = values
        if float((rotation @ point.reshape(3, 1) + translation.reshape(3, 1))[2, 0]) <= 0:
            return None
    rms = math.sqrt(sum(value * value for value in residuals) / len(residuals))
    return point, rms, len(observations)


def _nearest_frame(pose: dict[str, Any], time_s: float) -> dict[str, Any] | None:
    times = pose["_times"]
    index = bisect.bisect_left(times, time_s)
    candidates = [value for value in (index - 1, index) if 0 <= value < len(times)]
    if not candidates:
        return None
    nearest = min(candidates, key=lambda value: abs(times[value] - time_s))
    if abs(times[nearest] - time_s) > 0.55 / float(pose["fps"]):
        return None
    return pose["frames"][nearest]


def solve(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    import cv2
    import numpy as np

    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("mode") != "synchronized_multiview":
        raise RuntimeError("calibrated solve requires synchronized_multiview mode")
    calibration_path = args.calibration
    if calibration_path is None:
        value = manifest.get("calibration_file")
        if not value:
            raise RuntimeError("manifest calibration_file is missing")
        calibration_path = Path(value)
        if not calibration_path.is_absolute():
            calibration_path = manifest_path.parent / calibration_path
    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    cameras = {camera["id"]: camera for camera in calibration["cameras"]}
    poses = []
    for view in manifest["views"]:
        view_id = str(view["id"])
        if view_id not in cameras:
            raise RuntimeError(f"calibration is missing camera {view_id}")
        path = args.poses / view_id / "pose_sequence.json"
        pose = json.loads(path.read_text(encoding="utf-8"))
        pose["_times"] = [float(frame["time_s"]) for frame in pose["frames"]]
        poses.append((view, pose))
    reference_id = str(calibration["reference_camera"])
    reference_index = next(
        (index for index, (view, _pose) in enumerate(poses)
         if str(view["id"]) == reference_id), None
    )
    if reference_index is None:
        raise RuntimeError("reference camera is not in the capture manifest")
    reference_pose = poses[reference_index][1]
    semantics = [
        joint["semantic"] for joint in reference_pose["frames"][0]["joints"]
    ]
    output_frames = []
    residual_sum = 0.0
    solved_joints = 0
    support_histogram: dict[str, int] = {}
    for reference_frame in reference_pose["frames"]:
        time_s = float(reference_frame["time_s"])
        sampled_frames = []
        for view, pose in poses:
            sampled_frames.append(_nearest_frame(
                pose, time_s + float(view.get("time_offset_s", 0.0))
            ))
        output_joints = []
        for joint_index, semantic in enumerate(semantics):
            observations = []
            fallback_joint = reference_frame["joints"][joint_index]
            for (view, _pose), sampled in zip(poses, sampled_frames):
                if sampled is None:
                    continue
                joint = sampled["joints"][joint_index]
                confidence = float(joint["confidence"])
                if joint["valid"] and confidence >= args.minimum_confidence:
                    observations.append((
                        cameras[str(view["id"])], joint["image_xy"], confidence
                    ))
            result = _triangulate(
                observations, args.reprojection_threshold_px, cv2, np
            )
            if result is None:
                output_joints.append({
                    "semantic": semantic,
                    "image_xy": fallback_joint["image_xy"],
                    "position_m": fallback_joint["position_m"],
                    "confidence": 0.0,
                    "valid": False,
                })
                continue
            point, rms, support = result
            mean_confidence = sum(item[2] for item in observations) / len(observations)
            confidence = min(1.0, mean_confidence * (0.82 + 0.06 * support) *
                math.exp(-rms / args.reprojection_threshold_px))
            output_joints.append({
                "semantic": semantic,
                "image_xy": fallback_joint["image_xy"],
                "position_m": [float(point[0]), float(-point[1]), float(point[2])],
                "confidence": confidence,
                "valid": True,
            })
            residual_sum += rms
            solved_joints += 1
            support_histogram[str(support)] = support_histogram.get(str(support), 0) + 1
        output_frames.append({"time_s": time_s, "joints": output_joints})
    if solved_joints == 0:
        raise RuntimeError("no joints could be triangulated from at least two cameras")
    output_pose = {
        "schema_version": "1.0.0",
        "source_video": str(manifest_path),
        "backend": "calibrated-multiview-weighted-dlt+undistort+robust-reprojection",
        "image_width": int(reference_pose["image_width"]),
        "image_height": int(reference_pose["image_height"]),
        "fps": float(reference_pose["fps"]),
        "frames": output_frames,
    }
    diagnostics = {
        "schema_version": "1.0.0",
        "mode": "synchronized_calibrated_multiview",
        "reference_camera": reference_id,
        "camera_count": len(poses),
        "frame_count": len(output_frames),
        "solved_joints": solved_joints,
        "invalid_joints": len(output_frames) * len(semantics) - solved_joints,
        "mean_reprojection_error_px": residual_sum / solved_joints,
        "support_histogram": support_histogram,
        "reprojection_threshold_px": args.reprojection_threshold_px,
    }
    return output_pose, diagnostics


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--poses", type=Path, required=True)
    parser.add_argument("--calibration", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--diagnostics", type=Path, required=True)
    parser.add_argument("--minimum-confidence", type=float, default=0.12)
    parser.add_argument("--reprojection-threshold-px", type=float, default=12.0)
    args = parser.parse_args()
    try:
        pose, diagnostics = solve(args)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(pose, ensure_ascii=False), encoding="utf-8")
        args.diagnostics.write_text(
            json.dumps(diagnostics, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps({"event": "complete", **diagnostics}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"event": "error", "message": str(error)}), file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
