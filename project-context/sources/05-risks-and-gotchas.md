# Risks and gotchas

- A listed-node count mismatch exists: the specification says 24 but names 23.
- Model code licenses do not establish checkpoint, body-model, or dataset rights.
- Single-view depth is unobservable in ambiguous frames; confidence must expose it.
- Never smooth missing observations into apparently valid motion.
- Proprietary videos, models, textures, and game files must not enter Git.
- Different views or frame samples from the same source motion are not an
  independent held-out set. Split by source motion hash before extracting frames.
- Confidence calibration profiles are structural inputs, not held-out evidence;
  their presence must not be treated as validation of model quality.
- Synthetic-only training is useful for experimentation but cannot authorize
  checkpoint activation; activation also requires corrected real training data,
  a distinct held-out motion, zero high-confidence profile movement, and an
  accepted side-by-side review.
- Directional multi-view geometry currently assumes fixed yaw angles of 0/90/180/-90 degrees, near-level cameras, and per-frame scale estimated from the observed vertical body span. Camera calibration/elevation is not yet solved, and real four-video QA remains required before claiming production accuracy.
