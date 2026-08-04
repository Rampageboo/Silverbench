# Risks and Gotchas

Active, high-value, and hard to rediscover. Remove an entry once a durable
regression test enforces it or the workflow no longer exists.

## Stale backend after routing changes

Changing `/health` or `/api/call` routing without bumping `API_SCHEMA_VERSION`
(`backend_api/main.py:41`, currently 22) leaves dev startup attached to a stale
backend process. The failure looks like inexplicable runtime behavior rather
than a version error, which is what makes it expensive.

## ultralytics can silently downgrade the ML runtime

`ultralytics` must be installed with `--no-deps` (see `run.bat`). Without it,
its dependency resolution can replace the pinned torch and cv2 builds, and the
symptom appears later as unrelated inference or decoding failures.

## Safety guards are not optional validation

`path_access`, `image_safety`, and `pt_safety` became load-bearing in the
hardening pass. A new endpoint that reaches the filesystem, decodes an image,
or loads a PT file must go through them. Bypassing them "because it is
localhost" reintroduces exactly what the pass removed.

## The codebase map has known edge damage

The 2026-08-04 build reported 609 dangling-endpoint edges, 1 self-loop, and 321
collapsed edges. Map answers about call paths and impact may be incomplete.
Query the map to locate source, then read that source before making a
consequential claim.

## Large untracked data directories

`image_pool/`, `image_pool_backup/`, `clf_dataset/`, `detect_dataset/`,
`detect_labels/`, `runs/`, and `logs/` hold working data outside version
control. Destructive operations there are unrecoverable, and they are excluded
from the map by design — do not add them to a corpus.
