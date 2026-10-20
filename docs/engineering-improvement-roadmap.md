# Engineering Improvement Roadmap

This document lists non-test engineering improvements for the React desktop workbench after the main migration. The goal is not to rewrite the app again. The goal is to reduce future maintenance cost, make backend/frontend contracts safer, and keep large-dataset workflows responsive.

## Current state

The desktop workbench now has a unified React shell and feature pages under `apps/desktop/src/features/*`. The legacy web and Qt implementations were removed in October 2026.

The next phase should focus on incremental hardening rather than another broad migration.

## Priority summary

| Priority | Area | Why it matters |
|---|---|---|
| P1 | Backend RPC contract objectification | Reduces argument-order bugs between React and Python |
| P2 | Backend service modularization | Prevents `service.py` from becoming a new monolith |
| P3 | Large-dataset performance | Necessary for 10k+ image workflows |
| P4 | Error handling standardization | Makes failures actionable instead of cryptic |
| P5 | Destructive action safety | Protects real datasets from accidental deletion/overwrite |
| P6 | Session/config persistence | Reduces repeated manual setup across sessions |
| P7 | Legacy boundary documentation | Prevents future agents/developers from editing stale code paths |
| P8 | UI/job component consolidation | Reduces duplicated page logic after migration |

---

## P1 — Backend RPC contract objectification

### Problem

Many frontend calls still use positional RPC arguments:

```ts
callJson("someBackendMethod", [arg1, arg2, arg3]);
```

This is fragile because the meaning of each argument depends on order. If the frontend and backend disagree about one position, the code may still compile but fail at runtime or produce incorrect behavior.

Common risk cases:

- A backend handler changes argument order.
- A new optional argument is inserted in the middle.
- A frontend page passes a number where the backend expects a string.
- A path argument is passed to the wrong slot.
- A fallback compatibility parameter remains unclear, such as a global interval now only used as fallback.

### Desired direction

Move new or actively maintained RPC methods toward object-style arguments:

```ts
callJson("startCaptureVideoScreenshotJobs", [{
  jobs,
  outputRoot,
  fallbackInterval,
  prefix,
  format,
  total
}]);
```

Backend handlers should then read named keys rather than positional indexes:

```py
payload = args[0]
jobs = payload["jobs"]
output_root = payload["outputRoot"]
fallback_interval = payload.get("fallbackInterval", 1)
```

### Migration strategy

Do not convert every method at once. Convert only when touching a feature for real work.

Recommended order:

1. Video Capture job start/export methods.
2. Auto Label job start methods.
3. Batch Crop methods.
4. Dataset Merge write/export methods.
5. Mask Cleanup batch export methods.

### Compatibility rule

For existing methods, backend can support both shapes temporarily:

```py
if args and isinstance(args[0], dict):
    payload = args[0]
else:
    payload = legacy_args_to_payload(args)
```

Once the React app is fully stable, remove old positional compatibility only when it is clear no legacy flow still depends on it.

---

## P2 — Backend service modularization

### Problem

If every RPC handler lives in `backend/service.py`, the backend can become the new monolith after the frontend migration. Large service files make it harder to reason about ownership, dependencies, and regression risk.

### Desired direction

Keep `service.py` as a thin dispatch/orchestration layer and move feature logic into smaller service modules:

```text
backend/
  service.py                 # method dispatch and shared request handling
  services/
    video_capture_service.py
    mask_noise_service.py
    crop_service.py
    auto_label_service.py
    dataset_merge_service.py
    workspace_service.py
```

### Good boundary

`service.py` should answer:

- Which RPC method was called?
- Which feature service should handle it?
- How are errors normalized?
- How is path access enforced at the boundary?

Feature service modules should answer:

- What does this feature do?
- How does it read/write files?
- How does it run jobs?
- What result shape does it return?

### Migration strategy

Move one feature at a time. Do not reorganize every backend function in one commit.

Suggested first candidates:

1. Video Capture, because it has job state, frame extraction, and path access.
2. Mask Cleanup, because it has image processing and batch export.
3. Auto Label, because it has model/job execution concerns.

---

## P3 — Large-dataset performance

### Problem

The app is now expected to handle large real datasets, including 10k+ images. The main risk shifts from missing features to responsiveness and memory use.

Expensive frontend data types:

- Base64 images.
- Object URLs.
- Large arrays of file paths.
- Large JSON logs.
- Canvas image data.
- Thousands of DOM nodes.

### Desired direction

Use bounded memory and incremental loading.

Recommended patterns:

- Virtual lists for large image grids.
- Pagination for folders with thousands of files.
- LRU caches for thumbnails and previews.
- Avoid storing base64 longer than needed.
- Store paths and metadata, not image payloads.
- Show scan progress for large folders.
- Avoid rendering thousands of rows/items at once.

### Priority areas

#### Image Pool

If Image Pool starts handling large datasets directly, it should use virtualization or paging for image grids/lists.

#### Mask Cleanup

The thumbnail cache should stay bounded. Current LRU behavior is the right direction. If the tool is used heavily with large folders, add pagination or virtual scrolling.

#### Dataset Merge

Large directory scans should show progress and allow cancellation. Avoid loading full file contents unless necessary.

#### Video Capture

Keep preview requests debounced and avoid retaining old preview base64 strings when inactive.

---

## P4 — Error handling standardization

### Problem

Different features may show backend errors differently. Some errors are technical but not actionable for the user.

Example of a poor user-facing error:

```text
Path not allowed
```

Better:

```text
This file is outside the current workspace or authorized folders. Re-select the file from the app, or open the matching workspace first.
```

### Desired direction

Normalize errors into categories:

| Category | Meaning | Example action |
|---|---|---|
| User input error | Missing folder, missing model, invalid number | Ask user to choose/fix input |
| Path/access error | Backend rejected path | Re-select path or open workspace |
| Backend method error | Missing method or wrong payload | Developer issue; check RPC contract |
| Processing error | OpenCV/Pillow/model failed | Show file/model that failed |
| System error | Backend unreachable, permission, crash | Restart backend/app or inspect logs |

### Implementation direction

Create a small error normalization layer shared by feature pages:

```text
apps/desktop/src/lib/errorMessages.ts
```

It can map common backend messages into clearer user-facing text.

The UI should ideally show:

1. What failed.
2. Why it likely failed.
3. What the user can do next.
4. Optional technical details in an expandable area.

---

## P5 — Destructive action safety

### Problem

This app can move, delete, duplicate, crop, merge, and export dataset files. With real datasets, accidental destructive operations are high cost.

Risky actions:

- Delete images or labels.
- Move images between classes.
- Merge datasets into an existing target.
- Batch crop with overwrite behavior.
- Mask Cleanup export into a folder with existing files.
- Auto Label output overwriting labels or generated files.

### Desired direction

Dangerous operations should have a consistent safety pattern:

- Show affected item count.
- Show target folder.
- Warn about overwrite/delete behavior.
- Prefer dry-run/preview for large operations.
- Return a detailed result: created, skipped, overwritten, failed.
- Preserve partial failure information.

### UI pattern

Use one shared confirmation helper for destructive or long-running actions:

```text
ConfirmRunButton / useRunWithConfirm
```

For very risky actions, the dialog should include concrete details:

```text
Delete 134 images and 132 matching label files from:
D:/dataset/images/train

This cannot be undone by the app.
```

Avoid generic confirmation text such as:

```text
Are you sure?
```

---

## P6 — Session and configuration persistence

### Problem

Tool pages often need repeated setup:

- Input folder.
- Output folder.
- Model path.
- Device.
- Confidence threshold.
- Export format.
- Video interval.
- Last selected workspace.

If these reset every time, the app feels less like a production tool and more like a collection of scripts.

### Desired direction

Persist lightweight, non-sensitive tool settings per workspace.

Examples:

```json
{
  "videoCapture": {
    "outputRoot": "...",
    "format": "jpg",
    "defaultInterval": 1
  },
  "autoLabel": {
    "modelPath": "...",
    "device": "auto",
    "confidence": 0.35
  },
  "crop": {
    "lastInputRoot": "...",
    "lastOutputRoot": "..."
  }
}
```

### Rule

Persist convenience settings, not heavy data.

Good to persist:

- Paths.
- Numeric settings.
- Last selected options.
- UI preferences.

Avoid persisting:

- Base64 images.
- Full thumbnail caches.
- Large file lists.
- Full job logs.

---

## P7 — Legacy boundary documentation

Done by removal: the legacy web and Qt frontends were deleted in October 2026, so there is no longer a boundary to document.

---

## P8 — UI and job component consolidation

### Problem

Migration naturally creates repeated page-level patterns:

- Folder picker rows.
- Number fields.
- Status/log panels.
- Job polling.
- Confirmation before run.
- Progress display.

Some duplication is acceptable during migration. After stabilization, repeated patterns should move into shared components/hooks.

### Existing direction

Shared components can live under:

```text
apps/desktop/src/components/workbench/
```

Possible reusable pieces:

- `FolderPickerRow`
- `LogPanel`
- `JobStatusPanel`
- `NumberField`
- `ConfirmRunButton`
- `useRunWithConfirm`
- `usePollingJob`

### Rule

Extract only stable patterns. Do not over-abstract feature-specific logic.

A component is worth extracting when:

- It appears in at least two or three pages.
- Its behavior is not feature-specific.
- It reduces page size without hiding important logic.

---

## Not recommended right now

Avoid these until the app has passed practical use:

- Full rewrite of the backend RPC system.
- Deleting all legacy files immediately.
- Replacing every feature page with shared abstractions.
- Large UI redesign.
- Introducing complex state management before there is a clear need.

The current priority is stability and maintainability, not another broad migration.

---

## Suggested implementation order

### Phase 1 — Contract and safety

1. Convert one high-value RPC flow to object-style payloads.
2. Improve error messages for path and backend method failures.
3. Standardize destructive-action confirmations.

### Phase 2 — Backend structure

1. Extract Video Capture service logic from `service.py`.
2. Extract Mask Cleanup service logic.
3. Extract Auto Label service logic.

### Phase 3 — Performance hardening

1. Add virtualized/paginated large image lists where needed.
2. Keep thumbnail and preview caches bounded.
3. Add progress/cancel behavior for long scans.

### Phase 4 — Product polish

1. Persist per-workspace tool settings.
2. Replace JSON-first job logs with user-readable job status.
3. Keep technical details available behind an expandable log.

## Final target

The target architecture should feel like this:

```text
React feature pages
  ↓ typed API helpers
Backend RPC contract layer
  ↓ feature services
Small backend service modules
  ↓ file/model/image operations
Workspace-safe filesystem access
```

This keeps the app practical for a single-developer workflow while moving it closer to a maintainable desktop product.
