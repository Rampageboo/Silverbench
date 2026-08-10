# Decisions

Confirmed by specification v0.2:

- VRMA and BVH are co-equal P0 future exporters.
- Blender is an adapter and review surface, not the compute host or data truth.
- Four-direction recordings must be phase-aligned and jointly solved, never
  solved independently and averaged.

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
