#!/usr/bin/env python3
"""Validate the required shape and causal controls of combination evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


EXPECTED_VARIANTS = {
    "enhanced",
    "combined_ablated",
    "disable_visibility_weighting",
    "disable_temporal_reliability",
    "disable_animation_curve",
    "disable_reference_consensus",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    arguments = parser.parse_args()
    evidence = json.loads(arguments.evidence.read_text(encoding="utf-8"))

    assert evidence["git"]["revision"] == (
        "f010b8af4cce8cea4f25f3c61d2eb4822c32eade"
    )
    assert set(evidence["variants"]) == EXPECTED_VARIANTS
    assert all(
        item["identical"] for item in evidence["baseline_reproduction"].values()
    )
    assert evidence["execution"]["build"]["exit_status"] == 0
    assert evidence["execution"]["harness"]["exit_status"] == 0

    for variant in evidence["variants"].values():
        assert variant["frame_count"] == 403
        assert variant["joint_count"] == 23
        assert variant["metrics_full"]["n_samples"] == 9223
        assert variant["metrics_filtered"]["n_samples"] == 8272

    enhanced = evidence["variants"]["enhanced"]
    assert enhanced["options"]["enable_view_visibility_weighting"] is True
    assert enhanced["options"]["enable_temporal_view_reliability"] is True
    assert enhanced["options"]["enable_animation_curve_stabilization"] is True
    assert enhanced["options"]["require_reference_consensus_for_anchor"] is True

    switches = {
        "disable_visibility_weighting": "enable_view_visibility_weighting",
        "disable_temporal_reliability": "enable_temporal_view_reliability",
        "disable_animation_curve": "enable_animation_curve_stabilization",
        "disable_reference_consensus": "require_reference_consensus_for_anchor",
    }
    for variant_name, disabled_option in switches.items():
        options = evidence["variants"][variant_name]["options"]
        for option_name in switches.values():
            expected = option_name != disabled_option
            assert options[option_name] is expected

    assert (
        evidence["variants"]["disable_reference_consensus"]["metrics_full"][
            "p99_m"
        ]
        < enhanced["metrics_full"]["p99_m"]
    )
    assert (
        evidence["variants"]["disable_animation_curve"]["metrics_full"]["p99_m"]
        > enhanced["metrics_full"]["p99_m"]
    )
    print("combination evidence verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
