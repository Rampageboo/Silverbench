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
- The Python adapter treats base HRNet or the activated character-HRNet specialist, Human-Art ViTPose-L, and RTMW-x 384 as independent per-joint 2D hypotheses. Hypotheses are compared in the active person ROI/body box: compatible ROI-normalized hypotheses may combine, incompatible hypotheses are never averaged, and unresolved conflict retains an observed hypothesis with downgraded confidence. Per-model/per-joint monotonic calibration activates only from a hash-bound labelled-real profile containing at least two distinct source motions; otherwise identity mapping is explicit. MotionBERT remains the sole production 3D lifter; character rig/profile support is limited to low-confidence observations. MotionBERT depth is accepted only when anatomically plausible; otherwise bounded 2.5D is recorded in provenance.
- The GUI renders observed joint positions when observations exist. Canonical FK remains an export representation and must not replace the capture preview.
- Sparse manual corrections are explicit per-joint keyframes. Each edit uses a
  bounded cubic Hermite influence curve with zero slope at the authored key and
  local boundary; the internal correction API still accepts legacy
  full-sequence offsets.
  Timeline keys are visible, deletable, undoable, and re-applied from the same
  immutable baseline after profile changes. Missing observations remain missing.

- Source-character profile v1.1 is an observation-refinement adapter, not a
  target-rig contract. Similar references yield to well-supported video
  proportions; exact references enforce rig lengths only through low-confidence
  endpoints. Profile changes recompute from immutable smoothed observations and
  then reapply sparse manual corrections.
- Character-specific synthetic data is rendered locally from Canonical Motion.
  Dataset isolation is by source motion before frame extraction; effects may be
  RGB distractors but never anatomy labels. Candidate checkpoints remain
  separate until a hash-bound evaluation report passes explicit activation.

- The Windows preview uses a double-buffered paint pass and HALFTONE downscaling. A user-selected person ROI is shared by preview transforms, anchor hit-testing, and the Python inference crop so image coordinates remain in the original video space.

- Offline pose observations are stabilized once with a three-frame median spike filter followed by a five-frame centered confidence-weighted smoother. The backend tag temporal-smooth5 makes the operation idempotent. LK optical flow now propagates joints between HRNet observations, gated by a conservative GrabCut foreground mask and disagreement thresholds. A VLM remains reserved for initialization and recovery rather than subpixel tracking on every frame; enabling a cloud VLM requires an explicit provider/privacy decision.

- Local VLM recovery is sized for the target RTX 5070 Ti Laptop GPU (12 GB VRAM) and runs as a low-frequency/sequential stage so it does not compete with HRNet/MotionBERT for VRAM. The development RTX 2060 is only a fallback compatibility target.

- Intel AI Boost is an optional OpenVINO NPU shadow observer, never a silent
  replacement for the CUDA maximum-quality path. The fixed-shape FP16
  EfficientHRNet observer samples frames inside the active person ROI and
  records device-bound latency, invalid joints, ROI-normalized disagreement,
  and left/right swaps. Its observations are non-authoritative and cannot enter
  joint fusion until a distinct-motion stylized held-out gate explicitly
  activates them. Missing runtime/model/device or inference failure falls back
  without changing CUDA observations.

- Directional multi-view capture treats per-view inference as observations only. The default direct route is the animation-first front fan (`front_left` -45°, `front` 0°, `front_right` +45°); legacy four-cardinal manifests remain valid, while directional `capture.json` accepts 2–8 unique views only when every active view has an explicit finite yaw. The C++ solver phase-aligns differing starts and rates, uses per-view temporal left/right state with hysteresis, and forms deterministic pairwise 2D reprojection hypotheses in hip-relative/body-scale coordinates. Compatible hypotheses may support one joint; strict-majority outliers are rejected, incompatible hypotheses are never averaged, and unresolved conflict retains an observed hypothesis with downgraded confidence. After consensus, a bounded per-frame joint/view visibility factor uses the reference body-side axis, camera yaw, mirrored-joint overlap, materially inconsistent cross-view segments, and image-edge evidence. Near-side support is capped at +15% and far-side reduction at -30%; segment differences below 20% remain in a dead band and a short causal filter prevents video-rate weight shimmer. A separate causal temporal-reliability gate compares each view's body-normalized joint acceleration against the cross-view median. Only view-specific acceleration spikes beyond both an absolute and relative threshold are downweighted; all compatible views remain eligible and no view is permanently selected or removed. These disputed samples temporarily receive low-confidence curve authority, while their published fused confidence is restored after stabilization. The centered animation/keyframe-aware curve stage runs once before optimization and preserves invalid samples. Trusted motion turns, peaks, and contact spans remain protected. Independently reconstructed motions are never averaged.
- Directional fusion selects the view nearest 0 degrees as its reference. After
  all curve/profile optimization, a high-confidence reference observation may
  retain its image-plane coordinates only when at least two compatible views
  support the joint, the reference was not rejected, and consensus residuals
  remain bounded. Cross-view conflict therefore has authority to suppress the
  front anchor. Other views contribute orthogonal depth, occlusion recovery,
  and low-confidence evidence. Per-view GUI review is synchronized to that
  reference timeline and non-reference views are read-only.
- NPU sampling remains sparse by policy. Diagnostics expose sampled/total frames
  and build a non-authoritative review queue for sampled frames with NPU/GPU
  disagreement, missing joints, or left/right swaps. Those frames receive
  priority in the existing local VLM/GPU recovery stage, which records requested,
  processed, and accepted corrections. Studio places them on the reference
  timeline and in the issue panel; NPU coordinates still do not enter fusion.
  Utilization is not an activation or quality target.
- Directional solving emits a separate unenhanced comparison pose beside the
  authoritative fused pose. Studio displays the comparison as a grey dotted
  ghost against the enhanced purple skeleton in an oblique depth view and
  reports per-frame millimetre deltas. The comparison is review evidence, not a
  second motion truth and not an accuracy claim.
- The CLI-owned directional fused pose is the immutable GUI baseline. Studio
  does not apply a second generic optimization pass; only an explicit character
  profile may refine low-confidence samples from that baseline. Post-capture
  multiview playback decodes the selected source sequentially and maps source
  timestamps back to the reference timeline; seeks are reserved for scrubbing,
  looping, and view changes.
- Directional-repeat temporal alignment uses body-normalized 2D motion energy
  with the fastest joint fifth trimmed before smoothing, so camera-dependent
  depth and one mistracked extremity cannot select the action phase. It solves a
  continuous near-affine offset/rate map rather than per-frame DTW holds, and
  fuses only the common valid interval across every view. Out-of-range samples
  are invalid support, never clamped endpoint observations. Nonzero
  `capture.json` `time_offset_s` remains an explicit fixed phase anchor.
