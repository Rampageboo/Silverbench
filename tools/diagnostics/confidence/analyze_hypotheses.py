#!/usr/bin/env python3
"""Does inter-expert disagreement predict 2D detection failures?

The dump records, per frame and per COCO joint, every expert's candidate point
and the score the fusion assigned. The failure proxy is the joint's own 2D
second difference: a joint that jumps and comes back within three frames was
not tracking the character.

A reliability signal is only worth wiring in if it separates those frames from
the rest. AUC is the separation measure; 0.5 is a coin flip.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict

import numpy as np

COCO_NAMES = [
    "nose", "leftEye", "rightEye", "leftEar", "rightEar",
    "leftShoulder", "rightShoulder", "leftElbow", "rightElbow",
    "leftWrist", "rightWrist", "leftHip", "rightHip",
    "leftKnee", "rightKnee", "leftAnkle", "rightAnkle",
]


def load(path):
    frames = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                frames.append(json.loads(line))
    return frames


def auc(scores, labels):
    """Rank-based AUC; ties share the average rank."""
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=bool)
    positives, negatives = labels.sum(), (~labels).sum()
    if positives == 0 or negatives == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=float)
    ranks[order] = np.arange(1, len(scores) + 1)
    sorted_scores = scores[order]
    start = 0
    for index in range(1, len(sorted_scores) + 1):
        if index == len(sorted_scores) or sorted_scores[index] != sorted_scores[start]:
            if index - start > 1:
                block = order[start:index]
                ranks[block] = ranks[block].mean()
            start = index
    return float((ranks[labels].sum() - positives * (positives + 1) / 2)
                 / (positives * negatives))


def main():
    path = sys.argv[1]
    frames = load(path)
    print(f"frames dumped: {len(frames)}")
    print(f"compatibility threshold: "
          f"{frames[0]['compatibility_threshold_px']:.2f} px")

    joint_count = len(frames[0]["joints"])
    fused = np.full((len(frames), joint_count, 2), np.nan)
    spread = np.full((len(frames), joint_count), np.nan)
    fused_score = np.full((len(frames), joint_count), np.nan)
    min_raw = np.full((len(frames), joint_count), np.nan)
    max_raw = np.full((len(frames), joint_count), np.nan)
    expert_count = np.zeros((len(frames), joint_count))

    for f, frame in enumerate(frames):
        for entry in frame["joints"]:
            j = entry["joint"]
            if entry["fused_point"]:
                fused[f, j] = entry["fused_point"]
            spread[f, j] = entry["max_pairwise_spread_px"]
            fused_score[f, j] = entry["fused_score"]
            raws = [e["raw_score"] for e in entry["experts"]]
            expert_count[f, j] = len(raws)
            if raws:
                min_raw[f, j] = min(raws)
                max_raw[f, j] = max(raws)

    # 1. Where the published confidence actually comes from.
    flat = fused_score[~np.isnan(fused_score)]
    exact_one = float((flat == 1.0).mean())
    print(f"\nfused_score: exact 1.0 = {exact_one * 100:.1f}%  "
          f"distinct values = {len(np.unique(flat))}  min = {flat.min():.3f}")
    predicted = np.minimum(1.0, max_raw + 0.05 * (expert_count - 1))
    saturating = (predicted >= 1.0) & ~np.isnan(max_raw)
    observed_one = (fused_score == 1.0)
    print(f"agreement-bonus model predicts saturation on "
          f"{saturating.mean() * 100:.1f}% of samples; "
          f"observed exact 1.0 on {observed_one.mean() * 100:.1f}%")
    print(f"max_raw distribution: median {np.nanmedian(max_raw):.3f}  "
          f"p10 {np.nanpercentile(max_raw, 10):.3f}  "
          f"share >= 0.90 {float(np.nanmean(max_raw >= 0.90)) * 100:.1f}%")

    # 2. Failure proxy: the joint's own 2D second difference.
    accel = np.full((len(frames), joint_count), np.nan)
    for f in range(1, len(frames) - 1):
        d = fused[f + 1] - 2 * fused[f] + fused[f - 1]
        accel[f] = np.linalg.norm(d, axis=1)

    valid = ~np.isnan(accel) & ~np.isnan(spread) & (expert_count > 0)
    values = accel[valid]
    threshold = float(np.percentile(values, 95))
    print(f"\nfailure proxy: 2D second difference > p95 = {threshold:.2f} px  "
          f"({valid.sum()} samples, {int((values > threshold).sum())} positives)")

    labels = values > threshold
    signals = {
        "expert spread (px)": spread[valid],
        "expert spread / (1+min raw)": spread[valid] / (1.0 + min_raw[valid]),
        "1 - min raw score": 1.0 - min_raw[valid],
        "1 - max raw score": 1.0 - max_raw[valid],
        "1 - published confidence": 1.0 - fused_score[valid],
        "missing experts (3 - n)": 3.0 - expert_count[valid],
    }
    print(f"\n{'signal':<32}{'AUC':>8}")
    for name, signal in signals.items():
        print(f"  {name:<30}{auc(signal, labels):>8.3f}")

    # 3. Per-joint view for the joints that actually misbehave.
    print(f"\n{'joint':<15}{'n':>6}{'p95 accel':>11}{'spread AUC':>12}"
          f"{'conf AUC':>10}{'median spread':>15}")
    for j in range(joint_count):
        column = valid[:, j]
        if column.sum() < 50:
            continue
        a = accel[:, j][column]
        s = spread[:, j][column]
        c = 1.0 - fused_score[:, j][column]
        local = a > threshold
        if local.sum() < 5:
            continue
        print(f"  {COCO_NAMES[j]:<13}{int(column.sum()):>6}"
              f"{np.percentile(a, 95):>11.2f}{auc(s, local):>12.3f}"
              f"{auc(c, local):>10.3f}{np.median(s):>15.2f}")


if __name__ == "__main__":
    main()
