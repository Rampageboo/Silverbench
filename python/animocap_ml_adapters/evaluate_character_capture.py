"""Compare baseline and candidate observations on a held-out stylized clip."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from statistics import median
from typing import Any


BODY_SEMANTICS = (
    "head", "leftShoulder", "rightShoulder", "leftLowerArm", "rightLowerArm",
    "leftHand", "rightHand", "leftUpperLeg", "rightUpperLeg",
    "leftLowerLeg", "rightLowerLeg", "leftFoot", "rightFoot",
)
LEFT_RIGHT_PAIRS = (
    ("leftShoulder", "rightShoulder"),
    ("leftLowerArm", "rightLowerArm"),
    ("leftHand", "rightHand"),
    ("leftUpperLeg", "rightUpperLeg"),
    ("leftLowerLeg", "rightLowerLeg"),
    ("leftFoot", "rightFoot"),
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_pose(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != "1.0.0" or not value.get("frames"):
        raise RuntimeError(f"not a supported pose sequence: {path}")
    return value


def _joint_map(frame: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {joint["semantic"]: joint for joint in frame["joints"]}


def _distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    return math.hypot(
        float(a["image_xy"][0]) - float(b["image_xy"][0]),
        float(a["image_xy"][1]) - float(b["image_xy"][1]),
    )


def pose_metrics(
    ground_truth: dict[str, Any], prediction: dict[str, Any], confidence: float = 0.55
) -> dict[str, Any]:
    if len(ground_truth["frames"]) != len(prediction["frames"]):
        raise RuntimeError("held-out poses must have identical frame counts")
    errors: list[float] = []
    invalid = 0
    samples = 0
    swaps = 0
    for truth_frame, predicted_frame in zip(ground_truth["frames"], prediction["frames"]):
        truth = _joint_map(truth_frame)
        predicted = _joint_map(predicted_frame)
        visible_truth = [
            truth[name] for name in BODY_SEMANTICS
            if name in truth and truth[name]["valid"]
        ]
        if len(visible_truth) < 2:
            continue
        xs = [float(joint["image_xy"][0]) for joint in visible_truth]
        ys = [float(joint["image_xy"][1]) for joint in visible_truth]
        diagonal = max(1.0, math.hypot(max(xs) - min(xs), max(ys) - min(ys)))
        for name in BODY_SEMANTICS:
            if name not in truth or not truth[name]["valid"]:
                continue
            samples += 1
            candidate = predicted.get(name)
            if candidate is None or not candidate["valid"] or float(candidate["confidence"]) < confidence:
                invalid += 1
                continue
            errors.append(_distance(candidate, truth[name]) / diagonal)
        for left_name, right_name in LEFT_RIGHT_PAIRS:
            if not all(name in truth and name in predicted for name in (left_name, right_name)):
                continue
            if not all(truth[name]["valid"] and predicted[name]["valid"] for name in (left_name, right_name)):
                continue
            direct = _distance(predicted[left_name], truth[left_name]) + _distance(
                predicted[right_name], truth[right_name]
            )
            swapped = _distance(predicted[left_name], truth[right_name]) + _distance(
                predicted[right_name], truth[left_name]
            )
            if swapped + 1e-9 < direct:
                swaps += 1
    if not errors or samples == 0:
        raise RuntimeError("held-out evaluation has no comparable body joints")
    return {
        "median_normalized_joint_error": median(errors),
        "invalid_or_low_confidence_rate": invalid / samples,
        "left_right_swap_count": swaps,
        "comparable_samples": samples,
    }


def evaluate(
    ground_truth_path: Path,
    baseline_path: Path,
    candidate_path: Path,
    candidate_checkpoint: Path,
    candidate_config: Path,
    profile_path: Path,
    dataset_manifest: Path,
    output: Path,
    visual_review_accepted: bool,
    high_confidence_move_attempts: int,
) -> dict[str, Any]:
    baseline = pose_metrics(_load_pose(ground_truth_path), _load_pose(baseline_path))
    candidate = pose_metrics(_load_pose(ground_truth_path), _load_pose(candidate_path))
    baseline_error = baseline["median_normalized_joint_error"]
    improvement = (baseline_error - candidate["median_normalized_joint_error"]) / baseline_error
    dataset = json.loads(dataset_manifest.read_text(encoding="utf-8"))
    reasons: list[str] = []
    if improvement < 0.10:
        reasons.append("median normalized joint error improved by less than 10%")
    if candidate["invalid_or_low_confidence_rate"] > baseline["invalid_or_low_confidence_rate"]:
        reasons.append("invalid or low-confidence joint rate increased")
    if candidate["left_right_swap_count"] > baseline["left_right_swap_count"]:
        reasons.append("left/right swap count increased")
    if high_confidence_move_attempts != 0:
        reasons.append("profile refinement attempted to move high-confidence joints")
    if not visual_review_accepted:
        reasons.append("side-by-side visual review was not accepted")
    if not dataset.get("activation_eligible", False):
        reasons.append("dataset has no independent corrected-real train and held-out sequences")
    report = {
        "schema_version": "1.0.0", "kind": "animocap.character_checkpoint_evaluation",
        "status": "pass" if not reasons else "fail", "reasons": reasons,
        "metrics": {"baseline": baseline, "candidate": candidate, "relative_error_improvement": improvement},
        "high_confidence_move_attempts": high_confidence_move_attempts,
        "visual_review_accepted": visual_review_accepted,
        "candidate_checkpoint": str(candidate_checkpoint.resolve()),
        "candidate_checkpoint_sha256": _sha256_file(candidate_checkpoint),
        "candidate_config": str(candidate_config.resolve()),
        "candidate_config_sha256": _sha256_file(candidate_config),
        "profile_sha256": _sha256_file(profile_path),
        "dataset_manifest_sha256": _sha256_file(dataset_manifest),
        "dataset_split": {
            "activation_eligible": bool(dataset.get("activation_eligible", False)),
            "motion_identity_complete": bool(
                dataset.get("motion_identity_complete", False)
            ),
            "real_train_images": int(dataset.get("real_train_images", 0)),
            "synthetic_train_images": int(dataset.get("synthetic_train_images", 0)),
            "held_out_images": int(dataset.get("held_out_images", 0)),
            "train_sequence_ids": list(dataset.get("train_sequence_ids", [])),
            "held_out_sequence_ids": list(dataset.get("held_out_sequence_ids", [])),
        },
        "held_out_ground_truth_sha256": _sha256_file(ground_truth_path),
        "baseline_pose_sha256": _sha256_file(baseline_path),
        "candidate_pose_sha256": _sha256_file(candidate_path),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ground-truth", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--candidate-checkpoint", type=Path, required=True)
    parser.add_argument("--candidate-config", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--dataset-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--visual-review-accepted", action="store_true")
    parser.add_argument("--high-confidence-move-attempts", type=int, default=0)
    args = parser.parse_args()
    report = evaluate(
        args.ground_truth, args.baseline, args.candidate,
        args.candidate_checkpoint, args.candidate_config, args.profile,
        args.dataset_manifest, args.output, args.visual_review_accepted,
        max(0, args.high_confidence_move_attempts),
    )
    print(json.dumps({"event": "complete", "status": report["status"], "reasons": report["reasons"]}, ensure_ascii=False))
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
