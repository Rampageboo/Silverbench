# Project state

The Owner authorized implementation beyond M0 on 2026-08-06. A native Windows GUI, Media Foundation video import, MMPose inference adapter, canonical reconstruction, 2D overlay, observed 2.5D visualization, playback timeline, and sparse anchor calibration are implemented and locally verified with a 367-frame single-view video.

Current capture fusion includes HRNet/MotionBERT observations, RTMW-x 384 confidence-gated 2D refinement, LK optical flow, optional SAM 2.1 video masks with a conservative GrabCut fallback, explicit user-controlled person ROI, offline temporal smoothing, full-sequence robust bone/temporal optimization, and contact-aware foot locking. Real-video QA of the new RTMW/SAM path is still pending; deterministic helper and fallback tests pass. Cloud VLM recovery remains disabled pending an explicit provider/privacy decision.

Animation-first 2D expert fusion is implemented: base HRNet or the activated
character-HRNet specialist, Human-Art ViTPose-L, and RTMW-x 384 produce
per-joint hypotheses with ROI-normalized compatibility, non-averaging conflict
handling, and optional per-model/per-joint monotonic calibration. MotionBERT
remains the sole production 3D lifter and character rig/profile support remains
low-confidence only. The adapter now migrates MMPose 1.3.2's legacy
`mmcls.VisionTransformer` Human-Art config to MMPreTrain in memory and applies
a narrowly scoped PyTorch 2.6+ loader compatibility boundary for the immutable
official checkpoint. On 2026-08-11 the complete maximum CUDA session loaded all
four production models, and ViTPose-L returned 17/17 joints on one real
2304x1440 animation frame. This verifies runtime execution only; held-out
quality and activation remain unverified.

Animation-first directional capture fusion is implemented and locally tested:
direct import recommends the three-view front fan (-45°/0°/+45°), legacy
four-cardinal manifests remain compatible, and directional or synchronized
`capture.json` manifests accept 2–8 views. Directional manifests require an
explicit finite yaw for every active view. The solver uses stable left/right
assignment, pairwise ROI/body-scale 2D reprojection consensus with strict-
majority wrong-view rejection, and backward-compatible diagnostics. The
centered animation-curve stage is integrated before optimization; deterministic
tests cover fan agreement, two corrupt views among eight, one-frame ambiguity,
and degenerate yaw. Directional fusion now selects the view nearest 0 degrees as
reference and restores its high-confidence image-plane coordinates after all
optimization while retaining other-view depth. Studio loads each per-view pose
and offers synchronized, read-only side-view review on the reference timeline.
These checks are synthetic/local evidence only, not a real-video quality claim.

Intel NPU shadow inference is implemented and locally exercised through
OpenVINO 2026.2.1 on Intel AI Boost. A 567-frame Front animation clip produced
44 sampled NPU frames and 702 comparable joints with mean person-ROI-normalized
disagreement 0.0170, 46 invalid NPU joints, one left/right swap, and 121.99 ms
mean sampled latency under concurrent CUDA capture. The device reported NPU as
the execution target and compiled-model caching reduced a measured reload from
about 80 seconds cold to below two seconds. Because a swap was observed and no
distinct-motion held-out gate has passed, NPU remains non-authoritative shadow
diagnostics and is not activated for fusion.
Shadow diagnostics now record total frames, sampling interval and sample ratio;
new captures also record per-frame review reasons for missing joints,
left/right swaps, and material NPU/GPU disagreement. Studio maps those sparse
review frames onto the fused reference timeline and shows them in the issue
panel. They remain review hints outside fusion, so low Task Manager utilization
is expected under this policy.

The 2026-08-11 four-cardinal real run exposed three GUI defects after successful
capture: Studio reapplied generic pose optimization to the already optimized
and reference-pinned fused sequence, post-capture playback sought the decoder on
every frame, and completion collapsed the workspace to one view. The source fix
removes the duplicate no-profile optimization, uses sequential decoded playback
with inverse reference-time mapping, opens a clickable 2-by-4 post-capture
overview, and starts fused 2.5D inspection in the front-locked projection. Unit
and native checks pass; a fresh real capture/visual comparison is still pending.

The same run also exposed view-dependent temporal matching ambiguity. The
single scalar motion descriptor was replaced by a multichannel yaw-invariant,
left/right-symmetric action signature and same-animation rate guard; directional
`time_offset_s` now acts as a manual phase anchor. Re-solving the preserved real
poses reduced conflicts from 2221 to 1547, rejected observations from 1570 to
1200, and mean reprojection error from 0.0450 m to 0.0381 m. These are internal
consistency improvements on one run, not ground-truth accuracy evidence.

Studio manual correction now creates explicit per-joint keyframes at the
current frame instead of copying one offset across the entire sequence. A
bounded cubic influence curve is visible on the timeline together with
keyframe diamonds; current-frame deletion, undo, redo, immutable-baseline
reapplication, and missing-sample preservation are covered by deterministic
checks. Automatic curve stabilization now separately recognizes bounded
high-confidence micro-reversals and caps those corrections at 6 mm while
preserving deliberate peaks and turns. The synthetic curve fixture reduced its
second-difference jitter metric from 0.0597414 to 0.0365139 with zero peak
error. This is deterministic algorithm evidence, not a real-clip visual-quality
claim; user-editable tangent handles are not implemented.

Directional fusion now applies bounded joint/view visibility weighting after
strict-majority consensus. The reference pose supplies the current body-left
axis; camera yaw supplies the view direction, while mirrored-joint image
overlap, cross-view parent-segment stability, and image-edge proximity can
further reduce support. Diagnostics count evaluated, boosted, downweighted, and
overlap-downweighted observations. A deterministic near-side/far-side
comparison improves recovery relative to the same clean fused baseline and
existing corrupt-view/reference-anchor tests still pass. Real stylized-video
accuracy remains unverified. Re-solving the preserved 531-frame three-view
stylized observations with the smoothed visibility weights reduced mean
reprojection error by 1.35%, rejected observations by 0.82%, and final jitter
by 0.64% while retaining all 12,166 reference anchors; reported conflicts rose
by 1.60%. These are internal-consistency diagnostics without ground truth, not
an accuracy or activation claim.

The false multiview failure after successful package generation was traced to
profile refinement attempting to overwrite the immutable raw `motion.amotion`.
Studio now retains the profile-refined result in memory as an unsaved corrected
variant, preserves the raw package, logs multiview child output, and recovers a
valid generated package when later post-processing fails.

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
