# Architecture Decisions

Normative decisions and boundaries that are not derivable from reading the
code. Component structure, call graphs, imports, and as-built topology belong
to the codebase map (`graphify-out/`), not here.

## Process boundary

The Python backend binds localhost only. This is a security boundary, not a
convenience: no endpoint may be written on the assumption that a remote caller
is possible or acceptable.

The frontend reaches the backend through a JSON-RPC-style `/api/call` dispatch
rather than a REST surface per feature. New capability is added as a dispatched
method, not as a new HTTP route.

`API_SCHEMA_VERSION` is a compatibility handshake between the desktop shell and
the backend. It must be bumped whenever `/health` or `/api/call` routing
changes, otherwise dev startup keeps a stale backend process and the mismatch
surfaces as confusing runtime behavior rather than a clear error.

## Safety guards are load-bearing

`backend/path_access.py`, `backend/image_safety.py`, and `backend/pt_safety.py`
were introduced by a deliberate hardening pass. They constrain filesystem
reach, image size, and PT model loading. New endpoints route through them; they
are not optional validation to be skipped for a "trusted" local path.

## Dependency pinning

`ultralytics` is installed with `--no-deps`. Letting it resolve its own
dependency tree can replace the pinned torch and cv2 builds. Any change to the
install path must preserve this.

## Frontend shell

The desktop app is React and TypeScript inside a Tauri shell. Tools are native
React components; iframe embedding of tool surfaces was rejected. A legacy
full-web Tauri config remains available but is not the target.

## ML runtime

torch/torchvision plus ultralytics run in-process on the local machine. There
is no inference service and no remote model endpoint.
