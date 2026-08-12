#!/usr/bin/env python3
"""Compute reproducible combination-ablation jitter-proxy metrics."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any


EXCLUDED_JOINT = 10
EXCLUDED_REFERENCE_FRAMES = set(range(159, 184))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    # Match the original scratchpad producer's nearest-rank tail reporting.
    index = max(0, min(len(ordered) - 1, math.ceil(probability * len(ordered)) - 1))
    return ordered[index]


def acceleration_samples(pose: dict[str, Any]) -> list[dict[str, Any]]:
    frames = pose["frames"]
    samples: list[dict[str, Any]] = []
    for frame_index in range(1, len(frames) - 1):
        previous = frames[frame_index - 1]["joints"]
        current = frames[frame_index]["joints"]
        following = frames[frame_index + 1]["joints"]
        for joint_index in range(len(current)):
            triplet = (
                previous[joint_index], current[joint_index], following[joint_index]
            )
            hips = (previous[1], current[1], following[1])
            if not all(joint.get("valid", False) for joint in triplet + hips):
                continue
            relative = []
            for joint, hip in zip(triplet, hips):
                relative.append(
                    [
                        joint["position_m"][axis] - hip["position_m"][axis]
                        for axis in range(3)
                    ]
                )
            second_difference = [
                relative[2][axis] - 2.0 * relative[1][axis] + relative[0][axis]
                for axis in range(3)
            ]
            samples.append(
                {
                    "reference_frame": frame_index,
                    "joint": joint_index,
                    "semantic": current[joint_index]["semantic"],
                    "accel_m": math.sqrt(
                        sum(component * component for component in second_difference)
                    ),
                }
            )
    return samples


def summarize(samples: list[dict[str, Any]]) -> dict[str, Any]:
    values = [sample["accel_m"] for sample in samples]
    by_joint: dict[int, list[float]] = {}
    by_frame: dict[int, list[float]] = {}
    semantics: dict[int, str] = {}
    for sample in samples:
        by_joint.setdefault(sample["joint"], []).append(sample["accel_m"])
        by_frame.setdefault(sample["reference_frame"], []).append(sample["accel_m"])
        semantics[sample["joint"]] = sample["semantic"]
    top_samples = sorted(samples, key=lambda item: item["accel_m"], reverse=True)[:20]
    joint_peaks = sorted(
        (
            {
                "joint": joint,
                "semantic": semantics[joint],
                "mean_m": sum(joint_values) / len(joint_values),
                "p99_m": percentile(joint_values, 0.99),
                "max_m": max(joint_values),
            }
            for joint, joint_values in by_joint.items()
        ),
        key=lambda item: item["max_m"],
        reverse=True,
    )[:12]
    frame_peaks = sorted(
        (
            {
                "reference_frame": frame,
                "mean_m": sum(frame_values) / len(frame_values),
                "max_m": max(frame_values),
                "samples_over_0_15m": sum(value > 0.15 for value in frame_values),
            }
            for frame, frame_values in by_frame.items()
        ),
        key=lambda item: item["max_m"],
        reverse=True,
    )[:20]
    return {
        "n_samples": len(values),
        "median_m": percentile(values, 0.50),
        "p90_m": percentile(values, 0.90),
        "p99_m": percentile(values, 0.99),
        "max_m": max(values, default=0.0),
        "samples_over_0_15m": sum(value > 0.15 for value in values),
        "top_samples": top_samples,
        "per_joint_peaks": joint_peaks,
        "per_frame_peaks": frame_peaks,
    }


def git_output(repository: Path, *arguments: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repository), *arguments], text=True
    ).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--ablations", type=Path, required=True)
    parser.add_argument("--baseline-evidence", type=Path, required=True)
    parser.add_argument("--input-poses", type=Path, required=True)
    parser.add_argument("--producer-command", required=True)
    parser.add_argument("--build-command", required=True)
    parser.add_argument("--build-exit-status", type=int, required=True)
    parser.add_argument("--harness-command", required=True)
    parser.add_argument("--harness-exit-status", type=int, required=True)
    parser.add_argument("--linked-core", type=Path, required=True)
    parser.add_argument("--harness-executable", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    harness_run_path = arguments.ablations / "harness-run.json"
    harness_run = json.loads(harness_run_path.read_text(encoding="utf-8"))
    variants: dict[str, Any] = {}
    for variant in harness_run["variants"]:
        name = variant["variant"]
        pose_path = arguments.ablations / name / "pose_sequence.json"
        diagnostics_path = arguments.ablations / name / "multiview-diagnostics.json"
        pose = json.loads(pose_path.read_text(encoding="utf-8"))
        samples = acceleration_samples(pose)
        filtered = [
            sample
            for sample in samples
            if sample["joint"] != EXCLUDED_JOINT
            and sample["reference_frame"] not in EXCLUDED_REFERENCE_FRAMES
        ]
        diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
        conflict_joints = Counter(
            conflict["joint_index"] for conflict in diagnostics["conflicts"]
        )
        conflict_frames = Counter(
            conflict["frame_index"] for conflict in diagnostics["conflicts"]
        )
        variants[name] = {
            "options": variant["options"],
            "backend": pose["backend"],
            "frame_count": len(pose["frames"]),
            "joint_count": len(pose["frames"][0]["joints"]),
            "pose": {"path": str(pose_path), "sha256": sha256(pose_path)},
            "diagnostics": {
                "path": str(diagnostics_path),
                "sha256": sha256(diagnostics_path),
                "conflict_count": len(diagnostics["conflicts"]),
                "conflicts_by_joint": dict(sorted(conflict_joints.items())),
                "conflicts_by_frame_top": conflict_frames.most_common(20),
                "reference_anchored_observations": diagnostics[
                    "reference_anchored_observations"
                ],
                "reference_anchor_suppressed_conflicts": diagnostics[
                    "reference_anchor_suppressed_conflicts"
                ],
                "visibility_evaluated_observations": diagnostics[
                    "visibility_evaluated_observations"
                ],
                "temporal_outlier_downweighted_observations": diagnostics[
                    "temporal_outlier_downweighted_observations"
                ],
                "curve_corrected_samples": diagnostics["curve_corrected_samples"],
                "curve_maximum_correction_m": diagnostics[
                    "curve_maximum_correction_m"
                ],
                "jitter_before_curve": diagnostics["jitter_before_curve"],
                "jitter_after_curve": diagnostics["jitter_after_curve"],
            },
            "metrics_full": summarize(samples),
            "metrics_filtered": summarize(filtered),
        }

    input_files = [
        arguments.input_poses / view / "pose_sequence.json"
        for view in ("front_left", "front", "front_right")
    ]
    baseline_files = [
        arguments.baseline_evidence / name
        for name in (
            "fused_pose_sequence.json",
            "comparison_pose_sequence.json",
            "multiview-diagnostics.json",
        )
    ]
    reproduction = {
        "enhanced_pose": {
            "generated_sha256": variants["enhanced"]["pose"]["sha256"],
            "baseline_sha256": sha256(baseline_files[0]),
        },
        "combined_ablated_pose": {
            "generated_sha256": variants["combined_ablated"]["pose"]["sha256"],
            "baseline_sha256": sha256(baseline_files[1]),
        },
        "enhanced_diagnostics": {
            "generated_sha256": variants["enhanced"]["diagnostics"]["sha256"],
            "baseline_sha256": sha256(baseline_files[2]),
        },
    }
    for comparison in reproduction.values():
        comparison["identical"] = (
            comparison["generated_sha256"] == comparison["baseline_sha256"]
        )
    output = {
        "schema_version": 1,
        "producer": str(Path(__file__).resolve()),
        "command": arguments.producer_command,
        "metric_definition": (
            "Euclidean magnitude of the per-frame second difference of each "
            "joint position relative to hips, in metres; this is a jitter proxy, "
            "not labelled pose error."
        ),
        "filtered_definition": {
            "excluded_joint": EXCLUDED_JOINT,
            "excluded_reference_frames_inclusive": [159, 183],
        },
        "git": {
            "repository": str(arguments.repository.resolve()),
            "revision": git_output(arguments.repository, "rev-parse", "HEAD"),
            "branch": git_output(arguments.repository, "branch", "--show-current"),
            "status_short": git_output(arguments.repository, "status", "--short"),
        },
        "execution": {
            "build": {
                "command": arguments.build_command,
                "exit_status": arguments.build_exit_status,
            },
            "harness": {
                "command": arguments.harness_command,
                "exit_status": arguments.harness_exit_status,
            },
            "analysis": {"command": arguments.producer_command, "exit_status": 0},
            "linked_core": {
                "path": str(arguments.linked_core),
                "sha256": sha256(arguments.linked_core),
            },
            "harness_executable": {
                "path": str(arguments.harness_executable),
                "sha256": sha256(arguments.harness_executable),
            },
        },
        "inputs": [
            {"path": str(path), "sha256": sha256(path)} for path in input_files
        ],
        "baseline_evidence": [
            {"path": str(path), "sha256": sha256(path)} for path in baseline_files
        ],
        "baseline_reproduction": reproduction,
        "harness_run": {
            "path": str(harness_run_path), "sha256": sha256(harness_run_path)
        },
        "variants": variants,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
