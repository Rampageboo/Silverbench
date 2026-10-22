"""Fit evidence-backed monotonic confidence curves for the three 2D experts.

Input is local, labelled held-out evidence. Each sample records model, COCO
joint name, raw confidence, person-box-normalized error, and source motion id.
The tool never treats cross-model agreement as ground truth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

from .mmpose_adapter import COCO_JOINTS

REQUIRED_MODELS = ("hrnet", "vitpose-humanart", "rtmw")


def _pava(values: list[float], weights: list[int]) -> list[float]:
    blocks: list[list[float]] = []
    for index, (value, weight) in enumerate(zip(values, weights)):
        blocks.append([float(index), float(index), value * weight, float(weight)])
        while len(blocks) >= 2:
            left = blocks[-2]
            right = blocks[-1]
            if left[2] / left[3] <= right[2] / right[3]:
                break
            blocks[-2:] = [[left[0], right[1], left[2] + right[2], left[3] + right[3]]]
    result = [0.0] * len(values)
    for first, last, total, weight in blocks:
        for index in range(int(first), int(last) + 1):
            result[index] = total / weight
    return result


def _curve(samples: list[dict[str, Any]], bins: int) -> list[list[float]]:
    ordered = sorted(samples, key=lambda item: float(item["raw_confidence"]))
    bin_count = max(2, min(bins, len(ordered) // 5))
    groups: list[list[dict[str, Any]]] = []
    for index in range(bin_count):
        first = round(index * len(ordered) / bin_count)
        last = round((index + 1) * len(ordered) / bin_count)
        if last > first:
            groups.append(ordered[first:last])
    raw = [sum(float(item["raw_confidence"]) for item in group) / len(group)
           for group in groups]
    support = [sum(float(item["correct"]) for item in group) / len(group)
               for group in groups]
    calibrated = _pava(support, [len(group) for group in groups])
    points: list[list[float]] = [[0.0, 0.0]]
    for x, y in zip(raw, calibrated):
        x = max(points[-1][0] + 1e-6, min(1.0, x))
        if x >= 1.0:
            break
        points.append([round(x, 8), round(max(points[-1][1], y), 8)])
    points.append([1.0, 1.0])
    return points


def fit_profile(
    evidence: dict[str, Any], *, threshold: float = 0.05,
    minimum_samples: int = 30, bins: int = 8,
) -> dict[str, Any]:
    if evidence.get("schema_version") != "1.0.0":
        raise RuntimeError("calibration evidence schema_version must be 1.0.0")
    if not 0.0 < threshold < 1.0 or minimum_samples < 10 or bins < 2:
        raise RuntimeError("invalid calibration threshold, sample minimum, or bin count")
    samples = evidence.get("samples")
    if not isinstance(samples, list) or not samples:
        raise RuntimeError("calibration evidence needs labelled samples")
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {
        model: {} for model in REQUIRED_MODELS
    }
    motion_ids: set[str] = set()
    for index, item in enumerate(samples):
        if not isinstance(item, dict):
            raise RuntimeError(f"calibration sample {index} must be an object")
        model = str(item.get("model", ""))
        joint = str(item.get("joint", ""))
        motion_id = str(item.get("motion_id", ""))
        raw = float(item.get("raw_confidence", math.nan))
        error = float(item.get("error_normalized", math.nan))
        if model not in grouped or joint not in COCO_JOINTS or not motion_id:
            raise RuntimeError(f"invalid model, joint, or motion id at sample {index}")
        if not math.isfinite(raw) or not math.isfinite(error) or not 0.0 <= raw <= 1.0 or error < 0.0:
            raise RuntimeError(f"invalid confidence or error at sample {index}")
        grouped[model].setdefault(joint, []).append({
            "raw_confidence": raw,
            "correct": 1.0 if error <= threshold else 0.0,
        })
        motion_ids.add(motion_id)
    if len(motion_ids) < 2:
        raise RuntimeError(
            "confidence calibration requires at least two distinct source motions"
        )
    models: dict[str, Any] = {}
    for model in REQUIRED_MODELS:
        joints = {
            joint: _curve(grouped[model][joint], bins)
            for joint in COCO_JOINTS
            if len(grouped[model].get(joint, [])) >= minimum_samples
        }
        if not joints:
            raise RuntimeError(
                f"model {model} has no joint with {minimum_samples} labelled samples"
            )
        models[model] = {"joints": joints}
    return {
        "schema_version": "1.0.0",
        "evidence": {
            "kind": "held-out-labelled-real",
            "motion_ids": sorted(motion_ids),
            "normalized_error_threshold": threshold,
            "minimum_samples_per_joint": minimum_samples,
            "sample_count": len(samples),
        },
        "models": models,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--error-threshold", type=float, default=0.05)
    parser.add_argument("--minimum-samples", type=int, default=30)
    parser.add_argument("--bins", type=int, default=8)
    args = parser.parse_args()
    try:
        raw = args.evidence.read_bytes()
        evidence = json.loads(raw.decode("utf-8-sig"))
        profile = fit_profile(
            evidence, threshold=args.error_threshold,
            minimum_samples=args.minimum_samples, bins=args.bins,
        )
        profile["evidence"]["source_sha256"] = hashlib.sha256(raw).hexdigest()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        print(json.dumps({
            "event": "calibrated",
            "output": str(args.output.resolve()),
            "samples": profile["evidence"]["sample_count"],
            "motions": len(profile["evidence"]["motion_ids"]),
        }))
        return 0
    except Exception as error:  # noqa: BLE001 - CLI boundary
        print(json.dumps({"event": "error", "message": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
