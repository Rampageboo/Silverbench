# Risks and gotchas

- A listed-node count mismatch exists: the specification says 24 but names 23.
- Model code licenses do not establish checkpoint, body-model, or dataset rights.
- Single-view depth is unobservable in ambiguous frames; confidence must expose it.
- Never smooth missing observations into apparently valid motion.
- Proprietary videos, models, textures, and game files must not enter Git.
- Different views or frame samples from the same source motion are not an
  independent held-out set. Split by source motion hash before extracting frames.
- Confidence calibration profiles must be hash-bound to labelled real evidence
  from at least two distinct source motions. Even then, calibration aligns score
  meaning; it does not by itself validate pose accuracy or activate a model.
- Synthetic-only training is useful for experimentation but cannot authorize
  checkpoint activation; activation also requires corrected real training data,
  a distinct held-out motion, zero high-confidence profile movement, and an
  accepted side-by-side review.
- NPU device discovery, successful compilation, or lower latency is not model-
  quality evidence. The current COCO-trained NPU observer is not animation-
  domain trained and produced one left/right swap in its first 567-frame shadow
  run; it must remain outside fusion until distinct-motion held-out evaluation,
  confidence calibration, and no-regression review pass.
- NPU review-queue thresholds are triage heuristics, not error labels or quality
  evidence. A marker means the sampled frame deserves priority in local recovery;
  absence of a marker cannot clear unsampled frames. NPU coordinates never
  mutate joints directly, and an unavailable local VLM may yield zero processed
  or accepted corrections without failing CUDA capture.
- MMPose 1.3.2's bundled Human-Art ViTPose config targets the retired `mmcls`
  registry and PyTorch 2.6+ rejects its legacy official checkpoint metadata by
  default. Runtime compatibility must remain narrowly scoped to the immutable
  official checkpoint; successful loading/inference is not held-out accuracy.
- Directional multi-view geometry now accepts 2–8 unique finite-yaw views (the
  direct default is -45°/0°/+45°; legacy cardinal manifests remain valid), but
  still assumes near-level cameras and estimates per-frame scale from the
  observed vertical body span. Pairwise 2D reprojection consensus is
  deterministic but can downgrade or reject views when phase alignment, body
  scale, or ROI observations are poor. Camera elevation is not yet solved,
  real multi-view QA remains required, and synthetic rejection tests are not a
  production-accuracy claim.
- Repeated or nearly static animation segments remain temporally ambiguous even
  with view-invariant motion energy. Inspect the synchronized per-view preview
  and reported common coverage; when the wrong repetition is selected, provide
  a nonzero per-view `time_offset_s` anchor. Do not reintroduce per-frame holds:
  they can lower a metric by freezing a side view while misaligning keyframes.
- The visible manual keyframe curve is a bounded cubic influence envelope, not
  a full DCC F-curve editor: tangent handles and independent X/Y/Z channel
  editing remain outside the current Studio. Automatic jitter metrics are
  synthetic/internal evidence and must be checked visually on held-out clips.
- Joint/view visibility weighting is a bounded reliability prior, not an
  occlusion oracle. Incorrect manifest yaw, persistent left/right assignment
  failure, or unreliable reference-body orientation can mis-rank near/far
  support. Strict-majority rejection remains prior-independent; verify the new
  diagnostic counts and held-out per-joint error before increasing its bounds.
- Temporal view reliability detects relative acceleration outliers, not semantic
  mistakes shared by every view. A phase mismatch that moves all views together
  can still pass this gate; inspect per-view alignment and the A/B skeleton.
  Lower jitter is stability evidence, not proof of more accurate keyframes.
- The raw/enhanced comparison pose intentionally doubles the directional C++
  solve and is a diagnostic baseline, not ground truth. Large A/B deltas expose
  places needing review; they do not establish that the enhanced result is
  better. Held-out labelled error and foot-sliding/manual-correction review are
  still required.
