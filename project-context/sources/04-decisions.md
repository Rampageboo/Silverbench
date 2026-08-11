# Decisions

Confirmed by specification v0.2:

- VRMA and BVH are co-equal P0 future exporters.
- Blender is an adapter and review surface, not the compute host or data truth.
- Directional-repeat recordings use the animation-first front fan
  (`front_left` -45°, `front` 0°, `front_right` +45°) by default. Legacy
  four-cardinal manifests remain valid; arbitrary directional manifests use
  2–8 unique views with an explicit finite yaw on every active view. Views are
  phase-aligned and jointly solved, never solved independently and averaged;
  pairwise 2D reprojection strict-majority consensus rejects supported wrong
  views without averaging incompatible limbs.

Pending later milestone review:

- Exact motion prior, DTW versus soft-DTW, FBX implementation, and real-time UI.

Confirmed by Owner on 2026-08-06:

- C++/C is preferred for the product; Python is acceptable for mocap libraries whose practical ecosystem requires it.
- A single-view local test video is authorized for ignored QA outputs only and must not enter Git.
- Optional manual anchor dragging is acceptable when corrections propagate automatically instead of requiring frequent frame-by-frame input.

Confirmed by Owner on 2026-08-10:

- Animation/game-character capture and animation-suitable motion take priority
  over real-human capture.
- Supplied Blender/MMD rigs may be used as similar-proportion source-character
  references by default; native character preview, arbitrary target-rig
  retargeting, FBX, and human-performer optimization remain later milestones.

Confirmed by Owner on 2026-08-11:

- Bring the local Intel NPU into the animation-first workflow without replacing
  the RTX main path. NPU results remain shadow-only until the same held-out
  quality and left/right-swap evidence required for model activation passes.
- Treat the most frontal, high-confidence observation as the animation capture
  reference instead of averaging it away with weaker side/back views. Retain
  synchronized per-view review after capture, and keep NPU sampling
  non-authoritative rather than maximizing device utilization.
