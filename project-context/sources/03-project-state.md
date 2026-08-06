# Project state

The Owner authorized implementation beyond M0 on 2026-08-06. A native Windows GUI, Media Foundation video import, MMPose inference adapter, canonical reconstruction, 2D overlay, observed 2.5D visualization, playback timeline, and sparse anchor calibration are implemented and locally verified with a 367-frame single-view video.

Current capture fusion includes HRNet observations, LK optical flow, a conservative GrabCut foreground gate, explicit user-controlled person ROI, and offline temporal smoothing. Real-video QA completed on an 8-frame excerpt with the full fusion backend. Cloud VLM recovery remains disabled pending an explicit provider/privacy decision.

Current boundary: single-view depth is quality-gated. Implausible MotionBERT depth falls back to bounded 2.5D rather than being presented as reliable 3D. Export adapters remain future work. Directional multi-view solving is implemented for two to four observations and the native workflow currently imports the full front/right/back/left set. Synthetic validation covers unequal starts/rates, temporary occlusion, left/right label inversion, diagnostics persistence, and four-camera output; orchestration and UI import have smoke coverage. Real four-video capture QA is still pending because only a single-view recording is available locally.

- The native Windows studio now uses the combined workflow/monitoring UI: automatic full-body range, local VLM recovery controls, video-plus-2.5D inspection, actionable joint issues, and an interactive confidence/ambiguity timeline. The combined target and same-size QA capture are retained under build/ as local verification artifacts.
