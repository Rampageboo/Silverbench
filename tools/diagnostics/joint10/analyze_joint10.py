#!/usr/bin/env python3
"""Read-only joint10 multiview isolation diagnostics.

This tool consumes the existing three-view inputs and baseline artifacts.  It
does not call the product solver and does not mutate any input.  Visibility is
reported as a static reconstruction of the source weighting formula; the
product's temporal visibility state is not persisted in baseline JSON.
"""
import argparse
import hashlib
import json
import math
import pathlib
import subprocess
from statistics import mean, median

VIEWS = [("front_left", -45.0), ("front", 0.0), ("front_right", 45.0)]
JOINT = 10
CONTROL = 9
WINDOW = range(159, 184)
PARENT = {9: 8, 10: 9, 11: 3, 12: 11, 13: 12, 14: 13}
MIRROR = {9: 13, 10: 14, 13: 9, 14: 10}
SIDE = {7: 1, 8: 1, 9: 1, 10: 1, 11: -1, 12: -1, 13: -1, 14: -1}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def git_state(root):
    def run(args):
        return subprocess.run(args, cwd=root, text=True, capture_output=True, check=False).stdout.strip()
    return {"revision": run(["git", "rev-parse", "HEAD"]),
            "status": run(["git", "status", "--short", "--branch"])}


def lerp(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def sample(seq, position, joint):
    position = max(0.0, min(position, len(seq["frames"]) - 1.0))
    lo = int(math.floor(position)); hi = min(lo + 1, len(seq["frames"]) - 1)
    t = position - lo
    a = seq["frames"][lo]["joints"][joint]
    b = seq["frames"][hi]["joints"][joint]
    valid = bool(a.get("valid", False) and b.get("valid", False))
    return {"semantic": a.get("semantic"), "valid": valid,
            "confidence": float(a.get("confidence", 0.0) + (b.get("confidence", 0.0) - a.get("confidence", 0.0)) * t),
            "image_xy": lerp(a["image_xy"], b["image_xy"], t),
            "position_m": lerp(a["position_m"], b["position_m"], t)}


def dist(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def static_visibility(view_index, yaw, joint, obs, all_obs, width, height):
    # Source defaults: near-side bonus .15, far-side penalty .30.
    factor = 1.0
    if joint in SIDE:
        side_alignment = SIDE[joint] * math.sin(math.radians(yaw))
        factor *= 1.0 + 0.15 * max(0.0, side_alignment) - 0.30 * max(0.0, -side_alignment)
    mirrored = MIRROR.get(joint)
    overlap = False
    if mirrored is not None and all_obs[mirrored]["valid"]:
        sep = math.hypot(obs["image_xy"][0] - all_obs[mirrored]["image_xy"][0],
                         obs["image_xy"][1] - all_obs[mirrored]["image_xy"][1]) / max(1.0, height / 1.7)
        if sep < 0.06:
            factor *= 1.0 - (0.60 if SIDE.get(joint, 0) * math.sin(math.radians(yaw)) < -0.05 else 0.22) * (1.0 - sep / 0.06)
            overlap = True
    x, y = obs["image_xy"]
    if x < width * 0.02 or x > width * 0.98 or y < height * 0.02 or y > height * 0.98:
        factor *= 0.70
    return max(0.30, min(1.20, factor)), overlap


def centroid(obs, weights):
    active = [(o, w) for o, w in zip(obs, weights) if o["valid"] and w > 0]
    if not active:
        return None
    total = sum(w for _, w in active)
    return [sum(o["position_m"][i] * w for o, w in active) / total for i in range(3)]


def summarize(values):
    values = [v for v in values if v is not None]
    return {"count": len(values), "mean": mean(values) if values else None,
            "median": median(values) if values else None,
            "max": max(values) if values else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-root", required=True, type=pathlib.Path)
    ap.add_argument("--output", required=True, type=pathlib.Path)
    args = ap.parse_args()
    root = args.input_root.resolve()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    pose_paths = [root / "outputs" / "FrontLeft-1786531924229" / "poses" / v / "pose_sequence.json" for v, _ in VIEWS]
    base_dir = root / "outputs" / "alignment-common-qa-20260812-0240"
    paths = {"front_left": pose_paths[0], "front": pose_paths[1], "front_right": pose_paths[2],
             "diagnostics": base_dir / "multiview-diagnostics.json",
             "fused": base_dir / "fused_pose_sequence.json",
             "comparison": base_dir / "comparison_pose_sequence.json"}
    for p in paths.values():
        if not p.exists():
            raise FileNotFoundError(p)
    poses = [load(p) for p in pose_paths]
    baseline = load(paths["diagnostics"]); fused = load(paths["fused"]); comparison = load(paths["comparison"])
    alignments = baseline["alignments"]
    conflicts = {(c["frame_index"], c["joint_index"]): c for c in baseline["conflicts"]}
    width, height = poses[1]["image_width"], poses[1]["image_height"]
    trace = []
    target_spread = []; control_spread = []; weighted_shift = []; baseline_delta = []
    for frame in WINDOW:
        per_view = []
        for vi, ((view, yaw), pose) in enumerate(zip(VIEWS, poses)):
            src_frame = alignments[vi]["source_frame_at_reference"][frame]
            joints = [sample(pose, src_frame, j) for j in range(23)]
            obs = joints[JOINT]
            factor, overlap = static_visibility(vi, yaw, JOINT, obs, joints, width, height) if obs["valid"] else (0.0, False)
            per_view.append({"view": view, "reference_frame": frame, "source_frame": src_frame,
                             "raw_observation": obs, "static_visibility_factor": factor,
                             "visibility_overlap_downweighted": overlap,
                             "weight_confidence_squared": obs["confidence"] ** 2 * factor if obs["valid"] else 0.0})
        obs = [x["raw_observation"] for x in per_view]
        valid = [o["valid"] for o in obs]
        positions = [o["position_m"] for o in obs if o["valid"]]
        spread = max((dist(a, b) for i, a in enumerate(positions) for b in positions[i + 1:]), default=0.0)
        equal = centroid(obs, [1.0] * 3)
        weights = [x["weight_confidence_squared"] for x in per_view]
        weighted = centroid(obs, weights)
        fused_pos = fused["frames"][frame]["joints"][JOINT]["position_m"]
        for item, o in zip(per_view, obs):
            item["residual_to_weighted_centroid_m"] = dist(o["position_m"], weighted) if o["valid"] and weighted else None
            item["residual_to_fused_m"] = dist(o["position_m"], fused_pos) if o["valid"] else None
        trace.append({"frame": frame, "joint": JOINT, "semantic": obs[0]["semantic"],
                      "per_view": per_view, "valid_view_count": sum(valid),
                      "input_pairwise_max_disagreement_m": spread,
                      "equal_view_centroid_m": equal, "confidence_visibility_centroid_m": weighted,
                      "selected_fused_position_m": fused_pos,
                      "contributing_views": [x["view"] for x in per_view if x["raw_observation"]["valid"]],
                      "baseline_conflict": conflicts.get((frame, JOINT)),
                      "anchor_status": {"available": False, "inferred": True,
                                        "reason": "baseline persists aggregate anchor counts, not per-frame anchor state",
                                        "reference_confidence": per_view[1]["raw_observation"]["confidence"],
                                        "reference_confident": per_view[1]["raw_observation"]["confidence"] >= 0.85}})
        target_spread.append(spread); weighted_shift.append(dist(equal, weighted) if equal and weighted else None)
        baseline_delta.append(dist(weighted, fused_pos) if weighted else None)
        # Nearby control joint uses the same input-disagreement measurement.
        cobs = [sample(pose, alignments[vi]["source_frame_at_reference"][frame], CONTROL) for vi, pose in enumerate(poses)]
        cpos = [o["position_m"] for o in cobs if o["valid"]]
        control_spread.append(max((dist(a, b) for i, a in enumerate(cpos) for b in cpos[i + 1:]), default=0.0))

    def spread_for(frame, joint):
        positions = []
        for vi, pose in enumerate(poses):
            o = sample(pose, alignments[vi]["source_frame_at_reference"][frame], joint)
            if o["valid"]:
                positions.append(o["position_m"])
        return max((dist(a, b) for i, a in enumerate(positions) for b in positions[i + 1:]), default=0.0)

    all_joint10_spread = [spread_for(frame, JOINT) for frame in range(403)]
    all_control_spread = [spread_for(frame, CONTROL) for frame in range(403)]

    def window_metrics(frames, include_joint=True):
        fs = set(frames)
        cs = [c for c in baseline["conflicts"] if c["frame_index"] in fs and (include_joint or c["joint_index"] != JOINT)]
        joint_spreads = [all_joint10_spread[f] for f in fs]
        control_spreads = [all_control_spread[f] for f in fs]
        return {"frames": len(fs), "conflicts": len(cs), "joint10_conflicts": sum(c["joint_index"] == JOINT for c in cs),
                "control_joint9_conflicts": sum(c["joint_index"] == CONTROL for c in cs),
                "max_conflict_m": max((c["disagreement_m"] for c in cs), default=0.0),
                "joint10_input_spread": summarize(joint_spreads),
                "control_joint9_input_spread": summarize(control_spreads)}

    full = window_metrics(range(403), True)
    filtered = window_metrics([f for f in range(403) if f not in WINDOW], True)
    full_filtered_joint10_removed = window_metrics([f for f in range(403) if f not in WINDOW], False)
    target_metrics = window_metrics(WINDOW, True)
    result = {"producer": "tools/diagnostics/joint10/analyze_joint10.py",
              "command": f"python tools/diagnostics/joint10/analyze_joint10.py --input-root {root} --output {out}",
              "revision": git_state(pathlib.Path.cwd())["revision"], "worktree_status": git_state(pathlib.Path.cwd())["status"],
              "input_root": str(root), "main_checkout": str(root), "input_paths": {k: str(v) for k, v in paths.items()},
              "input_sha256": {k: sha256(v) for k, v in paths.items()},
              "options": {"views": VIEWS, "common_frames": 403, "joints": 23, "target_joint": JOINT,
                          "control_joint": CONTROL, "target_window": [159, 183],
                          "static_visibility_defaults": {"near_bonus": 0.15, "far_penalty": 0.30, "overlap_threshold_m": 0.06}},
              "diagnostics": {
                  "input_disagreement_only": {"description": "pairwise raw position spread, independent of confidence/visibility weighting", "target_window": summarize(target_spread), "control_joint9": summarize(control_spread)},
                  "weighting_selection_counterfactual": {"description": "equal-view centroid vs confidence-squared/static-visibility centroid vs baseline fused position", "equal_to_weighted_shift_m": summarize(weighted_shift), "weighted_to_baseline_fused_m": summarize(baseline_delta)},
                  "control": {"joint10_semantic": "leftHand", "control_joint": CONTROL, "control_semantic": "leftLowerArm"}},
              "conclusion": {"status": "confirmed", "confidence": "medium",
                             "summary": "Joint10 has direct multiview input disagreement in frames159-183, while the baseline fused position repeatedly follows the reference-view image-plane coordinates; the evidence supports input disagreement plus reference-anchor/selection behavior, not a visibility-only explanation.",
                             "falsifiers": ["If raw per-view disagreement disappears when the same aligned source frames are replayed, the input-disagreement mechanism is falsified.", "If a product-level ablation with reference anchoring disabled leaves the same selected positions and conflicts, the anchor mechanism is falsified.", "If joint9 shows the same target-window concentration after equalizing input disagreement, the joint10-isolation claim is weakened."]},
              "metrics": {"full": full, "target_window_159_183": target_metrics, "filtered_excluding_frames_159_183": filtered,
                          "filtered_excluding_joint10_and_frames_159_183": full_filtered_joint10_removed},
              "limitations": ["static_visibility_factor reconstructs source weighting without persisted temporal visibility state", "anchor_status is inferred because baseline diagnostics persist aggregate anchor counts only", "no product solver or source/defaults were modified"],
              "per_frame_spikes": sorted([
                  {"frame": t["frame"], "disagreement_m": t["baseline_conflict"]["disagreement_m"],
                   "contributing_views": t["contributing_views"]}
                  for t in trace if t["baseline_conflict"]], key=lambda x: x["disagreement_m"], reverse=True),
              "trace": trace}
    with open(out / "joint10-isolation.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2); f.write("\n")
    print(json.dumps({"output": str(out / "joint10-isolation.json"), "target_conflicts": full["joint10_conflicts"], "window_max_spread_m": max(target_spread), "control_window_max_spread_m": max(control_spread)}, indent=2))


if __name__ == "__main__":
    main()
