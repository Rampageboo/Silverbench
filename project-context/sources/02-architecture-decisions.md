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

- Windows Media Foundation owns native video decoding; decoded RGB32 rows are already top-down in the selected path and must not be flipped again.
- The Python adapter uses center-cropped HRNet 2D observations as the image-plane authority. MotionBERT depth is accepted only when anatomically plausible; otherwise bounded 2.5D is recorded in provenance.
- The GUI renders observed joint positions when observations exist. Canonical FK remains an export representation and must not replace the capture preview.
- Sparse manual anchor offsets apply across the full sequence and rebuild in-memory Canonical Motion; users are not asked to correct every frame.

- The Windows preview uses a double-buffered paint pass and HALFTONE downscaling. A user-selected person ROI is shared by preview transforms, anchor hit-testing, and the Python inference crop so image coordinates remain in the original video space.

- Offline pose observations are stabilized once with a three-frame median spike filter followed by a five-frame centered confidence-weighted smoother. The backend tag temporal-smooth5 makes the operation idempotent. LK optical flow now propagates joints between HRNet observations, gated by a conservative GrabCut foreground mask and disagreement thresholds. A VLM remains reserved for initialization and recovery rather than subpixel tracking on every frame; enabling a cloud VLM requires an explicit provider/privacy decision.

- Local VLM recovery is sized for the target RTX 5070 Ti Laptop GPU (12 GB VRAM) and runs as a low-frequency/sequential stage so it does not compete with HRNet/MotionBERT for VRAM. The development RTX 2060 is only a fallback compatibility target.

- Directional multi-view capture treats per-view inference as observations only. The C++ solver phase-aligns differing starts and rates, corrects cross-view left/right assignments, then jointly reconstructs one skeleton with confidence/alignment-weighted orthographic triangulation from known view yaw, Huber residual weighting, temporal continuity, and canonical bone-length constraints; independently reconstructed motions are never averaged.
