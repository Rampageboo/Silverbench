#!/usr/bin/env python3
"""Does a published pose sequence's confidence predict its own failures?

Reads only `pose_sequence.json`, so it measures the number every downstream
gate actually sees - after COCO -> h36m -> semantic min-composition - rather
than an internal signal that never reaches them.

Failure proxy: the joint's own 2D second difference above the pooled p95. AUC
of (1 - confidence) against that label; 0.5 is a coin flip.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np


def auc(scores, labels):
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=bool)
    positives, negatives = labels.sum(), (~labels).sum()
    if positives == 0 or negatives == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=float)
    ranks[order] = np.arange(1, len(scores) + 1)
    ordered = scores[order]
    start = 0
    for index in range(1, len(ordered) + 1):
        if index == len(ordered) or ordered[index] != ordered[start]:
            if index - start > 1:
                block = order[start:index]
                ranks[block] = ranks[block].mean()
            start = index
    return float((ranks[labels].sum() - positives * (positives + 1) / 2)
                 / (positives * negatives))


def collect(paths):
    accel, confidence = [], []
    for path in paths:
        pose = json.loads(Path(path).read_text(encoding="utf-8"))
        frames = pose["frames"]
        joint_count = len(frames[0]["joints"])
        for index in range(1, len(frames) - 1):
            for slot in range(joint_count):
                a, b, c = (frames[index + offset]["joints"][slot]
                           for offset in (-1, 0, 1))
                if not (a["valid"] and b["valid"] and c["valid"]):
                    continue
                dx = c["image_xy"][0] - 2 * b["image_xy"][0] + a["image_xy"][0]
                dy = c["image_xy"][1] - 2 * b["image_xy"][1] + a["image_xy"][1]
                accel.append(math.hypot(dx, dy))
                confidence.append(b["confidence"])
    return np.array(accel), np.array(confidence)


def main():
    for entry in sys.argv[1:]:
        label, spec = entry.split("=", 1)
        accel, confidence = collect(spec.split(","))
        threshold = float(np.percentile(accel, 95))
        labels = accel > threshold
        exact_one = float((confidence == 1.0).mean())
        print(f"{label}")
        print(f"  samples {len(accel)}  p95 {threshold:.2f}px  "
              f"positives {int(labels.sum())}")
        print(f"  confidence: median {np.median(confidence):.4f}  "
              f"p10 {np.percentile(confidence, 10):.4f}  "
              f"exact 1.0 {exact_one * 100:.1f}%  "
              f"distinct {len(np.unique(confidence))}  "
              f"below 0.85 {float((confidence < 0.85).mean()) * 100:.1f}%")
        print(f"  AUC of (1 - confidence): {auc(-confidence, labels):.3f}")


if __name__ == "__main__":
    main()
