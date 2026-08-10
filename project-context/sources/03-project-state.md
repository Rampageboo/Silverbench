# Project state

The Owner authorized implementation beyond M0 on 2026-08-06. A native Windows GUI, Media Foundation video import, MMPose inference adapter, canonical reconstruction, 2D overlay, observed 2.5D visualization, playback timeline, and sparse anchor calibration are implemented and locally verified with a 367-frame single-view video.

Current capture fusion includes HRNet/MotionBERT observations, RTMW-x 384 confidence-gated 2D refinement, LK optical flow, optional SAM 2.1 video masks with a conservative GrabCut fallback, explicit user-controlled person ROI, offline temporal smoothing, full-sequence robust bone/temporal optimization, and contact-aware foot locking. Real-video QA of the new RTMW/SAM path is still pending; deterministic helper and fallback tests pass. Cloud VLM recovery remains disabled pending an explicit provider/privacy decision.

Animation-first 2D expert fusion is implemented: base HRNet or the activated
character-HRNet specialist, Human-Art ViTPose-L, and RTMW-x 384 produce
per-joint hypotheses with ROI-normalized compatibility, non-averaging conflict
handling, and optional per-model/per-joint monotonic calibration. MotionBERT
remains the sole production 3D lifter and character rig/profile support remains
low-confidence only. Real ViTPose inference remains pending because this round
did not install mmpretrain or download the official checkpoint; no activation
or runtime-quality claim is made.

Current boundary: single-view depth is quality-gated. Implausible MotionBERT depth falls back to bounded 2.5D rather than being presented as reliable 3D. BVH and formal VRMC_vrm_animation 1.0 export are implemented from Canonical Motion; frame-accurate non-destructive clipping, selected-range export/playback, process-tree cancellation, undo/redo correction, and inferred foot-contact diagnostics are implemented; FBX remains future work. Directional-repeat multi-view solving remains available. A synchronized calibrated path now records grouped camera frames, calibrates pinhole intrinsics/extrinsics from a shared chessboard, and performs confidence-weighted robust perspective triangulation without manufacturing unsupported joints. Synthetic DLT/outlier validation passes; real fixed-camera calibration QA remains pending. Private COCO export and conservative local HRNet fine-tuning tooling are implemented but a fine-tuned model is not promoted automatically.

Animation-first character-reference v1.1 is implemented: guided Blender/MMD
multi-mesh export, optional effect separation, exact 23-joint mapping evidence,
source hashes, guarded similar/exact proportion refinement, non-stacking profile
switching, and optimization diagnostics. Local Blender synthetic RGB/mask/COCO
generation, source-motion split enforcement, synthetic/real sampling caps,
held-out evaluation, explicit hash-bound activation, and rollback are available.
The private Silver Wolf package passes Blender 5.2 export/re-import and a
367-frame profile-refinement run. A genuinely distinct held-out motion and its
accepted visual review are still required before any checkpoint can pass the
activation gate.

- The native Windows studio now uses the combined workflow/monitoring UI: automatic full-body range, local VLM recovery controls, video-plus-2.5D inspection, actionable joint issues, and an interactive confidence/ambiguity timeline. The combined target and same-size QA capture are retained under build/ as local verification artifacts.
