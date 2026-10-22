#!/usr/bin/env python3
"""Resample non-reference directional views onto the reference timeline.

Two alignment sources are supported so the resampling machinery itself can be
controlled for:

  --map affine  reproduce the pipeline's own global offset/rate map
  --map dtw     fit a view-invariant DTW warp, then smooth it into a
                slow-varying monotone time map

Both write a complete poses/<view>/pose_sequence.json tree that the existing
fusion harness consumes unchanged.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

# Rotation-invariant landmark pairs. Distances between these joints do not
# depend on where the camera stands, so the same feature is comparable across
# the three takes.
PAIRS = [
    ("leftHand", "rightHand"), ("leftHand", "hips"), ("rightHand", "hips"),
    ("leftHand", "head"), ("rightHand", "head"), ("leftFoot", "rightFoot"),
    ("leftFoot", "hips"), ("rightFoot", "hips"), ("leftLowerArm", "hips"),
    ("rightLowerArm", "hips"), ("leftHand", "leftUpperArm"),
    ("rightHand", "rightUpperArm"), ("head", "hips"),
    ("leftLowerLeg", "hips"), ("rightLowerLeg", "hips"),
    ("leftHand", "leftFoot"), ("rightHand", "rightFoot"),
]
SCALE_PAIR = ("head", "hips")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def joint_index(pose: dict) -> dict:
    return {
        joint["semantic"]: index
        for index, joint in enumerate(pose["frames"][0]["joints"])
    }


def features(pose: dict) -> np.ndarray:
    """Per-frame rotation-invariant feature vector, NaN where unusable."""
    index = joint_index(pose)
    frames = pose["frames"]
    out = np.full((len(frames), len(PAIRS)), np.nan)
    for frame_index, frame in enumerate(frames):
        joints = frame["joints"]

        def position(name):
            joint = joints[index[name]]
            return np.array(joint["position_m"]) if joint["valid"] else None

        anchor_a, anchor_b = position(SCALE_PAIR[0]), position(SCALE_PAIR[1])
        if anchor_a is None or anchor_b is None:
            continue
        scale = float(np.linalg.norm(anchor_a - anchor_b))
        if scale < 1e-3:
            continue
        for pair_index, (left, right) in enumerate(PAIRS):
            a, b = position(left), position(right)
            if a is None or b is None:
                continue
            out[frame_index, pair_index] = float(np.linalg.norm(a - b)) / scale
    return out


def prepare(values: np.ndarray, sigma: float = 1.5) -> np.ndarray:
    """Fill gaps, lightly smooth, and z-normalise each feature dimension."""
    filled = values.copy()
    for column in range(filled.shape[1]):
        series = filled[:, column]
        valid = ~np.isnan(series)
        if valid.sum() < 3:
            series[:] = 0.0
            continue
        series[:] = np.interp(
            np.arange(len(series)), np.flatnonzero(valid), series[valid]
        )
    radius = int(3 * sigma)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    for column in range(filled.shape[1]):
        filled[:, column] = np.convolve(
            np.pad(filled[:, column], radius, mode="edge"), kernel, mode="valid"
        )
    mean = filled.mean(axis=0)
    deviation = filled.std(axis=0)
    deviation[deviation < 1e-6] = 1.0
    return (filled - mean) / deviation


def dtw_path(reference, source, prior, band):
    """Banded DTW with a bounded local slope, seeded by the affine prior."""
    n, m = len(reference), len(source)
    lo = np.clip(np.floor(prior - band).astype(int), 0, m - 1)
    hi = np.clip(np.ceil(prior + band).astype(int) + 1, 1, m)

    cost = np.full((n, m), np.inf)
    back = np.zeros((n, m, 2), dtype=np.int32)
    for i in range(n):
        columns = np.arange(lo[i], hi[i])
        if len(columns) == 0:
            continue
        local = np.linalg.norm(source[columns] - reference[i], axis=1)
        if i == 0:
            cost[i, columns] = local
            continue
        for offset, j in enumerate(columns):
            best, best_step = np.inf, (0, 0)
            # (1,1) diagonal, (1,2) source runs faster, (2,1) source lags.
            for di, dj in ((1, 1), (1, 2), (2, 1)):
                pi, pj = i - di, j - dj
                if pi < 0 or pj < 0 or not np.isfinite(cost[pi, pj]):
                    continue
                candidate = cost[pi, pj] + local[offset] * (di + dj) / 2.0
                if candidate < best:
                    best, best_step = candidate, (di, dj)
            if np.isfinite(best):
                cost[i, j] = best
                back[i, j] = best_step

    finite = np.where(np.isfinite(cost[-1]), cost[-1], np.nan)
    end = int(np.nanargmin(finite))
    path, i, j = [], n - 1, end
    while i >= 0 and j >= 0:
        path.append((i, j))
        di, dj = back[i, j]
        if di == 0 and dj == 0:
            break
        i, j = i - di, j - dj
    path.reverse()

    raw = np.full(n, np.nan)
    for i, j in path:
        raw[i] = j
    valid = ~np.isnan(raw)
    return np.interp(np.arange(n), np.flatnonzero(valid), raw[valid])


def smooth_monotone(warp, window=91):
    """A time map must be slow-varying, or it injects jitter of its own."""
    from scipy.signal import savgol_filter

    if len(warp) % 2 == 0:
        window = min(window, len(warp) - 1)
    else:
        window = min(window, len(warp))
    if window >= 5:
        if window % 2 == 0:
            window -= 1
        warp = savgol_filter(warp, window, 2)
    warp = np.array(warp, dtype=float)
    for index in range(1, len(warp)):
        # Bound the local rate so the warp can never reverse or stall.
        warp[index] = max(warp[index], warp[index - 1] + 0.5)
    return warp


def resample(pose: dict, warp, reference: dict) -> dict:
    frames = pose["frames"]
    last = len(frames) - 1
    joint_count = len(frames[0]["joints"])
    out_frames = []
    for target_index in range(len(reference["frames"])):
        position = float(warp[target_index])
        low = int(math.floor(position))
        alpha = position - low
        high = low + 1
        in_range = 0 <= low and high <= last
        joints = []
        for slot in range(joint_count):
            template = frames[min(max(low, 0), last)]["joints"][slot]
            if not in_range:
                joints.append({
                    "confidence": 0.0,
                    "image_xy": list(template["image_xy"]),
                    "position_m": list(template["position_m"]),
                    "semantic": template["semantic"],
                    "valid": False,
                })
                continue
            a = frames[low]["joints"][slot]
            b = frames[high]["joints"][slot]
            joints.append({
                "confidence": (1 - alpha) * a["confidence"] + alpha * b["confidence"],
                "image_xy": [
                    (1 - alpha) * a["image_xy"][k] + alpha * b["image_xy"][k]
                    for k in range(2)
                ],
                "position_m": [
                    (1 - alpha) * a["position_m"][k] + alpha * b["position_m"][k]
                    for k in range(3)
                ],
                "semantic": a["semantic"],
                "valid": bool(a["valid"] and b["valid"]),
            })
        out_frames.append({
            "time_s": reference["frames"][target_index]["time_s"],
            "joints": joints,
        })
    return {
        "schema_version": pose["schema_version"],
        "source_video": pose["source_video"],
        "backend": pose["backend"] + "+prewarped",
        "image_width": pose["image_width"],
        "image_height": pose["image_height"],
        "fps": reference["fps"],
        "frames": out_frames,
    }


def trim(pose: dict, count: int) -> dict:
    trimmed = dict(pose)
    trimmed["frames"] = pose["frames"][:count]
    trimmed["backend"] = pose["backend"] + "+prewarped"
    return trimmed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--poses", required=True, type=Path)
    parser.add_argument("--diagnostics", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--map", choices=("affine", "dtw"), required=True)
    parser.add_argument("--reference", default="front")
    parser.add_argument("--frames", type=int, default=403)
    parser.add_argument("--band", type=int, default=25)
    parser.add_argument("--shift", type=float, default=0.0)
    arguments = parser.parse_args()

    diagnostics = load(arguments.diagnostics)
    alignments = {a["view_id"]: a for a in diagnostics["alignments"]}
    poses = {
        view.name: load(view / "pose_sequence.json")
        for view in sorted(arguments.poses.iterdir())
        if (view / "pose_sequence.json").exists()
    }
    reference = poses[arguments.reference]
    reference_trimmed = trim(reference, arguments.frames)
    reference_features = prepare(features(reference_trimmed))

    summary = {"map": arguments.map, "views": []}
    for view_id, pose in poses.items():
        target = arguments.output / view_id
        target.mkdir(parents=True, exist_ok=True)
        if view_id == arguments.reference:
            (target / "pose_sequence.json").write_text(
                json.dumps(reference_trimmed), encoding="utf-8"
            )
            continue
        prior = np.array(
            alignments[view_id]["source_frame_at_reference"][: arguments.frames],
            dtype=float,
        )
        if arguments.map == "affine":
            warp = prior + arguments.shift
        else:
            warp = smooth_monotone(
                dtw_path(
                    reference_features,
                    prepare(features(pose)),
                    prior,
                    arguments.band,
                )
            )
        (target / "pose_sequence.json").write_text(
            json.dumps(resample(pose, warp, reference_trimmed)), encoding="utf-8"
        )
        delta = warp - prior
        summary["views"].append({
            "view_id": view_id,
            "warp_minus_affine_frames": {
                "min": float(delta.min()),
                "max": float(delta.max()),
                "mean": float(delta.mean()),
                "std": float(delta.std()),
            },
            "warp_first": float(warp[0]),
            "warp_last": float(warp[-1]),
        })
    (arguments.output / "warp-summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
