#!/usr/bin/env python3
"""Reproject a fused pose into the views the reference anchor does not own.

`mean_reprojection_error_m` in the pipeline's own diagnostics is computed at
src/multiview.cpp:1391, before `pin_reference_image_plane` runs at :1434, so it
is blind to what the pin does. And the reference view is the pin's own
objective - matching it is what the pin is for, so it cannot judge the pin.

The side views can. Neither arm optimises agreement with them directly, so
"does the fused pose still land where front_left and front_right saw the
character" is a fidelity question the pin does not get to answer for itself.

Projection mirrors the pipeline's orthographic model (src/multiview.cpp:1370):

    u = hip_u + ppm * ( cos(yaw) * rel.x - sin(yaw) * rel.z )
    v = hip_v - ppm * rel.y

with `ppm` from estimate_pixels_per_meter (:702) - head-to-foot pixels over
head-to-foot metres, confidence weighted, clamped around image_height / 1.7.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

SEMANTIC_INDEX = {
    "hips": 1, "head": 6, "leftFoot": 17, "rightFoot": 21,
}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def pixels_per_meter(joints, image_height):
    head = joints[SEMANTIC_INDEX["head"]]
    weighted, total = 0.0, 0.0
    for key in ("leftFoot", "rightFoot"):
        foot = joints[SEMANTIC_INDEX[key]]
        if not head["valid"] or not foot["valid"]:
            continue
        vertical_m = abs(head["position_m"][1] - foot["position_m"][1])
        vertical_px = abs(head["image_xy"][1] - foot["image_xy"][1])
        if vertical_m < 0.25 or vertical_px < 8.0:
            continue
        weight = math.sqrt(head["confidence"] * foot["confidence"])
        weighted += weight * vertical_px / vertical_m
        total += weight
    fallback = image_height / 1.7
    value = weighted / total if total > 0.0 else fallback
    return min(max(value, fallback * 0.35), fallback * 3.0)


def sample(pose, position):
    """Linear interpolation at a fractional source frame, as the solver does."""
    frames = pose["frames"]
    low = int(math.floor(position))
    if low < 0 or low + 1 > len(frames) - 1:
        return None
    alpha = position - low
    a, b = frames[low]["joints"], frames[low + 1]["joints"]
    out = []
    for ja, jb in zip(a, b):
        if not (ja["valid"] and jb["valid"]):
            out.append(None)
            continue
        out.append({
            "image_xy": [(1 - alpha) * ja["image_xy"][k] + alpha * jb["image_xy"][k]
                         for k in range(2)],
            "position_m": [(1 - alpha) * ja["position_m"][k]
                           + alpha * jb["position_m"][k] for k in range(3)],
            "confidence": (1 - alpha) * ja["confidence"] + alpha * jb["confidence"],
            "valid": True,
        })
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--poses", required=True, type=Path)
    parser.add_argument("--diagnostics", required=True, type=Path)
    parser.add_argument("--reference", default="front")
    parser.add_argument("fused", nargs="+",
                        help="label=path/to/fused pose_sequence.json")
    arguments = parser.parse_args()

    yaws = {"front_left": -45.0, "front": 0.0, "front_right": 45.0}
    alignments = {
        a["view_id"]: a
        for a in load(arguments.diagnostics)["alignments"]
    }
    views = {
        name: load(arguments.poses / name / "pose_sequence.json")
        for name in yaws
    }

    print(f"{'variant':<34}{'side view':<14}{'n':>7}{'median px':>11}"
          f"{'p90 px':>9}{'mean px':>9}")
    for entry in arguments.fused:
        label, path = entry.split("=", 1)
        fused = load(path)
        for name, yaw in yaws.items():
            if name == arguments.reference:
                continue
            view = views[name]
            warp = alignments[name]["source_frame_at_reference"]
            angle = math.radians(yaw)
            errors = []
            for index, frame in enumerate(fused["frames"]):
                if index >= len(warp):
                    break
                observed = sample(view, warp[index])
                if observed is None or observed[1] is None:
                    continue
                scale = pixels_per_meter(
                    [o if o else {"valid": False, "confidence": 0.0,
                                  "image_xy": [0, 0], "position_m": [0, 0, 0]}
                     for o in observed],
                    view["image_height"])
                hip_uv = observed[1]["image_xy"]
                hip_xyz = frame["joints"][1]["position_m"]
                for slot, joint in enumerate(frame["joints"]):
                    target = observed[slot]
                    if target is None or not joint["valid"]:
                        continue
                    rel = [joint["position_m"][k] - hip_xyz[k] for k in range(3)]
                    u = hip_uv[0] + scale * (
                        math.cos(angle) * rel[0] - math.sin(angle) * rel[2])
                    v = hip_uv[1] - scale * rel[1]
                    errors.append(math.hypot(u - target["image_xy"][0],
                                             v - target["image_xy"][1]))
            errors.sort()
            if not errors:
                continue
            print(f"  {label:<32}{name:<14}{len(errors):>7}"
                  f"{errors[len(errors) // 2]:>11.2f}"
                  f"{errors[int(0.9 * len(errors))]:>9.2f}"
                  f"{sum(errors) / len(errors):>9.2f}")


if __name__ == "__main__":
    main()
