# AniMocap M0 data contracts

Canonical skeleton, keypoint, motion, camera, and provenance documents use schema version `1.0.0`. All contracts fail closed on
missing or unknown object fields. Numeric values must be finite.

## Canonical frame and skeleton

- Right-handed coordinates, Y up, +Z forward, distances in metres.
- T-pose faces +Z.
- Parent-local unit quaternions use `[w, x, y, z]`.
- `sceneRoot` stores world motion; `hips` stores character-local translation.
- The canonical skeleton uses the 23 semantics explicitly enumerated in the
  v0.2 specification. Bone names and parent indices are unique and fixed by
  `configs/skeletons/animocap_canonical_v1.json`.

## Capture Manifest

JSON object fields:

| Field | Type | Rule |
| --- | --- | --- |
| `version` | integer | Must be `1` |
| `mode` | string | `single` or `multi` |
| `views` | array | Unique view IDs and video paths; one view for single, at least two for multi |
| `subject` | object | Non-empty ID, optional finite positive height in metres |
| `output.directory` | string | Non-empty local output path |

Each view contains exactly `id`, `video`, and nullable `yaw_degrees`.

## 2D keypoint frame

The in-memory C++ contract represents one source frame:

| Field | Type / shape | Unit and rule |
| --- | --- | --- |
| `source_time_s` | float64 scalar | Seconds, non-negative |
| `bbox_xyxy` | float64 `[4]` | Pixels, positive area |
| `keypoints_xy` | float64 `[J,2]` | Pixels |
| `confidence` | float32 `[J]` | Range `[0,1]` |
| `visibility` | uint8 `[J]` | Boolean mask |
| `manual_override` | uint8 `[J]` | Boolean mask; never silently merged with raw estimates |

All joint arrays share `J`. Raw estimates, refined estimates, and manual
overrides are separate variants in future milestones.

## Canonical Motion Package

A package directory contains `manifest.json`, `skeleton.json`,
`provenance.json`, `cameras.json`, alignment and diagnostic JSON, and these
NumPy v1 arrays:

| Array | Dtype / shape | Meaning |
| --- | --- | --- |
| `time_s.npy` | float64 `[F]` | Strictly increasing seconds |
| `scene_root_translation_m.npy` | float64 `[F,3]` | World translation in metres |
| `scene_root_rotation_wxyz.npy` | float64 `[F,4]` | Continuous unit quaternion |
| `local_rotations_wxyz.npy` | float64 `[F,J,4]` | Parent-local continuous unit quaternions |
| `hips_translation_m.npy` | float64 `[F,3]` | Hips-local translation in metres |
| `confidence.npy` | float32 `[F,J]` | Range `[0,1]` |
| `valid_mask.npy` | uint8 `[F,J]` | Boolean validity mask |
| `foot_contacts.npy` | uint8 `[F,2]` | Left/right Boolean contact mask |

The manifest fixes package type, raw motion variant, skeleton ID, FPS, frame and
joint counts, coordinate frame, rotation convention, and local array filenames.
Load rejects dtype, shape, count, unit, version, or filename violations.

## Camera metadata

`cameras.json` contains a version and a unique-ID camera array. Each weak
perspective camera contains yaw and pitch in degrees, a finite positive scale in
pixels per metre, and a two-element principal point in pixels. M0 fixtures use a
front camera and a held-out 45-degree camera.

## Provenance

Every motion package records the code version, configuration SHA-256, source
SHA-256 list, model ID, and model-weights SHA-256. M0 uses `none-m0` and no
weights. Future runtime models or datasets are disallowed until their license,
source, version, and hash are recorded in `LICENSES.md`.
