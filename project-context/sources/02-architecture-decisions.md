# Architecture decisions

- The C++20 core owns contracts, math, serialization, fixtures, and CLI tools.
- Python is limited to future ML adapters where the upstream ecosystem requires it.
- Canonical Motion is the only source of truth; file formats and rigs are adapters.
- The internal frame is right-handed, Y-up, +Z forward, in meters.
- Rotations are parent-local `[w, x, y, z]` unit quaternions.
- `sceneRoot` owns world motion; `hips` owns local pelvis motion.
- M0 uses the 23 semantics explicitly enumerated in specification v0.2. The
  prose count of 24 is treated as a documentation inconsistency pending review.
- Contracts reject unknown fields and invalid or ambiguous data.
- Research models are optional, removable adapters and never define storage.
