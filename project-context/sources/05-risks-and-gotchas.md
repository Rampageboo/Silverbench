# Risks and gotchas

- A listed-node count mismatch exists: the specification says 24 but names 23.
- Model code licenses do not establish checkpoint, body-model, or dataset rights.
- Single-view depth is unobservable in ambiguous frames; confidence must expose it.
- Never smooth missing observations into apparently valid motion.
- Proprietary videos, models, textures, and game files must not enter Git.
- Directional multi-view geometry currently assumes fixed yaw angles of 0/90/180/-90 degrees, near-level cameras, and per-frame scale estimated from the observed vertical body span. Camera calibration/elevation is not yet solved, and real four-video QA remains required before claiming production accuracy.
