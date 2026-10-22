# AniMocap engine contract (RWB ↔ `animocap.exe`)

RampageWorkbench drives the AniMocap C++ engine in `engines/animocap/` through its
CLI. The engine owns every motion algorithm; RWB only orchestrates, stores and
displays. This page is the contract both sides keep.

Build: `engines/animocap/tools/build_msvc.ps1 -Configuration Release` (VS 2022
C++ tools; CMake/Ninja bundled with VS are enough). Output:
`engines/animocap/build/windows-ninja/animocap.exe`. `update.bat` rebuilds it when
the engine sources change.

All commands print one JSON object on stdout. Exit code 0 = success, 2 = contract
error (bad input; message on stderr), 1 = other failure. Output packages are never
overwritten: write to a fresh path and swap.

## Take files

A take lives in `mocap/<take>/` of the workspace:

| File | Written by | Meaning |
|---|---|---|
| `take.json` | RWB | Sources (workspace-relative videos, yaw per view), capture options, capture status |
| `capture/` | Python adapters, engine | Raw observations and diagnostics as the adapters write them; kept on failure/cancel |
| `logs/pose.log`, `logs/vlm.log` | Python adapters | JSON-line progress (`event`: `progress`, `view_started`, `stage_*`, `complete`, `error`) |
| `refined.json` | `reconstruct-pose --pose-output` (multiview without profile: the fused pose) | The base all edits replay on; written once |
| `edits.json` | RWB | The user's edits (below). Small, user labour |
| `motion.amotion/` | `apply-edits` | Canonical motion for playback and export |
| `pose.json` | `apply-edits --pose-output` | Edited observation pose shown in the UI |
| `motion.amotion.areview/` | `apply-edits --review-output` | Studio-compatible review project; `source.json` is the pre-review baseline ("原始叠影") |
| `edit-result.json` | RWB | Last `apply-edits` summary, including inferred samples |

Everything except `take.json`, `capture/`, `refined.json` and `edits.json` is
rebuilt from them on every edit (staged, then swapped in; a refused edit changes
nothing). The capture runs Studio's commands and options: `mmpose_adapter.py`
(`--quality maximum --segmentation auto --npu-mode shadow`, Maxine VSR 2×, expert
interval, ROI) → optional `local_vlm_adapter.py` (failure keeps the base result,
as in Studio) → `reconstruct-pose`; multiview runs `multiview_pipeline.py`, then
`reconstruct-pose --no-smooth` only when a character profile is set.

## `reconstruct-pose`

```
animocap reconstruct-pose <pose_sequence.json> --output <motion.amotion>
    [--character-profile <profile.json>] [--pose-output <refined.json>] [--no-smooth]
```

Same path as Studio single-view capture: smooth → `optimize_pose_sequence_detailed`
(profile options and proportion policy when a profile is given) → reconstruct.
`--no-smooth` skips the smoothing, for a fused multiview pose that is already
stabilized (Studio only optimizes it).

## `apply-edits`

```
animocap apply-edits <refined.json> --edits <edits.json> --output <motion.amotion>
    [--character-profile <profile.json>] [--pose-output <pose.json>]
    [--review-output <motion.amotion.areview>] [--cameras-from <motion.amotion>]
```

Replays the whole edit session on the refined pose, in Studio order: drag
corrections (`apply_manual_pose_corrections`) → keyframe smoothing (authored
keyframes stay exact) → joint review rebuild (`rebuild_reviewed_pose`) →
`reconstruct_canonical_motion`. `--cameras-from` keeps the solved cameras of a
multiview take. Stdout: `frame_count`, `joint_count`, counts of corrections,
marks and ranges, and `inferred`: `[frame, joint]` pairs the rebuild invented
(confidence 0; show them as inferred, never as observations).

`edits.json` (version 1):

```json
{
  "version": 1,
  "corrections": [
    {"joint": 10, "keyframe": 200, "dragPx": [12, -8], "radius": 0, "curve": "smooth"}
  ],
  "smoothedKeyframes": [200],
  "review": {
    "marks": [
      {"frame": 200, "joint": 10, "trust": "locked"},
      {"frame": 220, "joint": 10, "trust": "weighted", "weight": 8,
       "target": [0.1, 1.2, 0.0, 640.5, 300.2], "valid": true, "confidence": 0.9},
      {"frame": 210, "joint": 10, "trust": "excluded"}
    ],
    "ranges": [[200, 220, 10]]
  }
}
```

- `corrections`: an image drag of one joint at a keyframe, in source pixels.
  `radius` 0 = Studio default (¼ s, at least 4 frames). `curve`: `linear`,
  `ease-in`, `ease-out`, `smooth`, `hold`. Depth is not changed by a drag; the
  pixel→metre scale is Studio's head-to-feet estimate, taken from the refined pose.
- `review.marks`: `trust` is `locked`, `weighted` (soft, `weight` 4/8/16) or
  `excluded`. `target` is `[x, y, z, u, v]` (metres, then pixels). Omit `target`
  to take it from the corrected pose — that is how "lock this frame" and "drag a
  locked joint" are expressed.
- `review.ranges`: `[first, last, joint]`, inclusive, both ends locked; gaps with
  no support longer than 0.75 s are refused.

The engine refuses invalid edits (exit 2) instead of clamping them; RWB keeps the
previous result and shows the message.

## Other commands used

`inspect-motion`, `inspect-video`, `fuse-multiview`, `export-bvh`, `export-vrma`,
`trim-motion`: unchanged; see `animocap --help`.

## Latency

Measured on the dev machine (400 frames, 23 joints): `apply-edits` ≈ 280 ms, of
which ≈ 160 ms is Windows starting any freshly built unsigned exe (a hello-world
costs the same). Fine for capture/export; the interactive edit loop will use a
resident `animocap serve` process (plan, phase D) rather than moving maths to TS.
