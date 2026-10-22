#!/usr/bin/env python3
"""Replace published confidence with an inter-expert agreement signal.

Joint positions are copied through untouched. Only `confidence` (and the
`valid` flag it gates) changes, so any downstream difference is attributable to
the reliability signal alone.

The map from disagreement to confidence is fixed a priori:

    confidence = min_raw_score * exp(-spread / compatibility_threshold)

It is deliberately NOT fitted against the jitter metric the fused output is
later scored on — fitting it there would make the evaluation circular.
`spread` is the largest pairwise distance between the experts' candidate
points, and `compatibility_threshold` is the same scale the fusion already uses
to decide whether two experts are talking about the same joint.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

SEMANTICS = [
    "sceneRoot", "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
    "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
]

# Which h36m indices back each semantic joint, mirroring _map_h36m.
SEMANTIC_H36M = {
    "sceneRoot": (0,), "hips": (0,), "spine": (0, 8), "chest": (0, 8),
    "upperChest": (8,), "neck": (9,), "head": (10,),
    "leftShoulder": (8, 11), "leftUpperArm": (11,), "leftLowerArm": (12,),
    "leftHand": (13,), "rightShoulder": (8, 14), "rightUpperArm": (14,),
    "rightLowerArm": (15,), "rightHand": (16,),
    "leftUpperLeg": (4,), "leftLowerLeg": (5,), "leftFoot": (6,),
    "leftToes": (6,), "rightUpperLeg": (1,), "rightLowerLeg": (2,),
    "rightFoot": (3,), "rightToes": (3,),
}

# Which COCO indices back each h36m index, mirroring _coco_to_h36m.
H36M_COCO = [
    (11, 12), (12,), (14,), (16,), (11,), (13,), (15,),
    (5, 6, 11, 12), (5, 6), (0, 5, 6), (0,),
    (5,), (7,), (9,), (6,), (8,), (10,),
]


def score(values, indices):
    """The adapter's _score: the weakest contributor owns the result."""
    picked = [float(values[i]) for i in indices if i < len(values)]
    return max(0.0, min(1.0, min(picked) if picked else 0.0))


def coco_confidence(entry, threshold, operator):
    experts = entry["experts"]
    if not experts:
        return 0.0
    spread = float(entry["max_pairwise_spread_px"])
    if operator == "expert-min":
        # RTMW's scores are on an unnormalised SimCC scale and cannot be
        # compared against the other two, so they are excluded from the
        # magnitude and only contribute through the agreement term.
        scored = [
            min(1.0, float(e["raw_score"]))
            for e in experts if e["model"] != "rtmw"
        ]
        weakest = min(scored) if scored else 0.0
    else:
        weakest = min(float(e["raw_score"]) for e in experts)
    if len(experts) == 1:
        # A lone expert has nothing to disagree with; its own score is all the
        # evidence there is, and it should not be credited with agreement.
        return max(0.0, min(1.0, weakest * math.exp(-1.0)))
    return max(0.0, min(1.0, weakest * math.exp(-spread / max(threshold, 1e-6))))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", required=True, type=Path)
    parser.add_argument("--pose", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--floor", type=float, default=0.05)
    parser.add_argument(
        "--operator", choices=("apriori", "expert-min"), default="apriori",
        help="expert-min drops RTMW from the magnitude (unnormalised scale).")
    parser.add_argument(
        "--percentile-calibrate", action="store_true",
        help=(
            "Publish each observation's percentile rank instead of a raw "
            "score, so a gate at t means 'accept the most reliable (1-t) "
            "of observations' and the sweep is interpretable."
        ))
    parser.add_argument(
        "--quantile-match",
        action="store_true",
        help=(
            "Remap the new signal onto the original confidence distribution. "
            "Every gate keeps its current pass rate, so only which samples "
            "are flagged changes - not how many."
        ),
    )
    arguments = parser.parse_args()

    records = []
    with arguments.dump.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    pose = json.loads(arguments.pose.read_text(encoding="utf-8"))
    if len(records) != len(pose["frames"]):
        raise SystemExit(
            f"dump has {len(records)} frames, pose has {len(pose['frames'])}"
        )

    original = [j["confidence"] for f in pose["frames"] for j in f["joints"]]

    proposed = []
    for record, frame in zip(records, pose["frames"]):
        threshold = float(record["compatibility_threshold_px"])
        by_index = {entry["joint"]: entry for entry in record["joints"]}
        coco = [
            coco_confidence(by_index[i], threshold, arguments.operator)
            if i in by_index else 0.0
            for i in range(17)
        ]
        h36m = [score(coco, indices) for indices in H36M_COCO]
        for joint in frame["joints"]:
            proposed.append(score(h36m, SEMANTIC_H36M[joint["semantic"]]))

    if arguments.percentile_calibrate:
        order = sorted(range(len(proposed)), key=lambda i: proposed[i])
        remapped = [0.0] * len(proposed)
        for rank, index in enumerate(order):
            remapped[index] = (rank + 1) / len(order)
        proposed = remapped

    if arguments.quantile_match:
        # Rank the proposal, then hand each rank the original distribution's
        # value at that rank. Ordering is the proposal's; the histogram - and
        # therefore every gate's pass rate - is the original's.
        target = sorted(original)
        order = sorted(range(len(proposed)), key=lambda i: proposed[i])
        remapped = [0.0] * len(proposed)
        for rank, index in enumerate(order):
            remapped[index] = target[rank]
        proposed = remapped

    changed = 0
    dropped = 0
    cursor = 0
    for frame in pose["frames"]:
        for joint in frame["joints"]:
            value = proposed[cursor]
            cursor += 1
            was_valid = joint["valid"]
            joint["confidence"] = value if value >= arguments.floor else 0.0
            joint["valid"] = value >= arguments.floor
            changed += 1
            if was_valid and not joint["valid"]:
                dropped += 1

    pose["backend"] = pose["backend"].replace(
        "+confidence-calibration-identity", "+confidence-expert-agreement"
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(pose), encoding="utf-8")

    values = sorted(
        j["confidence"] for f in pose["frames"] for j in f["joints"]
    )
    print(f"{arguments.pose.name}: rewrote {changed} joints, "
          f"{dropped} newly invalid")
    print(f"  confidence: median {values[len(values) // 2]:.3f} "
          f"p10 {values[len(values) // 10]:.3f} "
          f"exact 1.0 {sum(1 for v in values if v == 1.0) / len(values) * 100:.1f}% "
          f"below 0.85 {sum(1 for v in values if v < 0.85) / len(values) * 100:.1f}%")


if __name__ == "__main__":
    main()
