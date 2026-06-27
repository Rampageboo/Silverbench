# Video-First Architecture

This branch changes YoloWorkBench from an image-first toolbox into a video-first annotation workbench while retaining the existing image workflows.

## Product rules

1. Video Label is the primary workflow.
2. Frames are decoded from the source video on demand.
3. Preview frames remain in memory and are not written into `image_pool`.
4. Annotation persistence contains timestamps, review state, and normalized YOLO boxes only.
5. Image Box Label and Image Pool remain supported secondary workflows.

## Application layers

```text
Workbench shell
  └─ typed tool catalogue + lazy tool registry
       ├─ Video Label
       │    ├─ page shell
       │    ├─ session orchestration hook
       │    ├─ pure annotation domain functions
       │    ├─ canvas interaction component
       │    └─ workspace-aware persistence API
       ├─ Image workspace wrapper
       │    ├─ Image Pool
       │    ├─ Inbox
       │    └─ Dataset Review
       └─ remaining dataset tools

Workspace architecture provider
  ├─ manifest migration
  ├─ storage-path policy
  └─ structured event/operation logs
```

## Tool registry

`apps/desktop/src/types/tools.ts` is the product catalogue. It declares navigation order, tool grouping, workspace requirements, heavy-tool classification, and KeepAlive policy.

`apps/desktop/src/app/toolRegistry.tsx` attaches lazy React components to that catalogue. `WorkbenchBody` renders the registry rather than manually wiring every feature page.

This implements the first usable version of roadmap item **P6 — Tool / Plugin Registry** without introducing a runtime plugin loader.

## Workspace manifest v2

Existing `workspace/workspace.json` files are migrated in place by the desktop application. The backend-compatible path keys remain unchanged; new keys are additive.

```json
{
  "version": 2,
  "type": "yolo-workbench",
  "name": "project-name",
  "createdAt": "...",
  "updatedAt": "...",
  "paths": {
    "image_pool": "image_pool",
    "detect_labels": "detect_labels",
    "metadata": "metadata.csv",
    "detect_dataset": "detect_dataset",
    "clf_dataset": "clf_dataset",
    "video_annotations": "workspace/video_annotations",
    "exports": "exports",
    "cache": ".cache",
    "logs": "workspace/logs"
  },
  "tools": {
    "videoLabel": {
      "enabled": true,
      "primary": true,
      "persistence": "timestamp-manifest",
      "saveExtractedFrames": false
    },
    "imageLabel": {
      "enabled": true,
      "secondary": true
    }
  }
}
```

This is roadmap item **P2 — Workspace Manifest**, phase 1. The manifest remains lightweight and does not contain previews, thumbnails, or decoded frames.

## Video annotation storage

Each source video has one deterministic manifest under the configured `paths.video_annotations` directory.

```text
workspace/video_annotations/<safe-video-name>-<path-hash>.json
```

The manifest is **version 2**. Each timestamp key maps to a `VideoTimestampAnnotation` with an independent `tasks` object:

```json
{
  "version": 2,
  "video": { "path": "...", "name": "...", "duration": 60, "width": 1920, "height": 1080 },
  "createdAt": "...",
  "updatedAt": "...",
  "frames": {
    "5000": {
      "timestampMs": 5000,
      "time": 5,
      "tasks": {
        "detect": { "reviewed": true, "boxes": [{ "classId": 0, "x": 0.5, "y": 0.5, "w": 0.2, "h": 0.3 }] },
        "clf": { "reviewed": false, "classKey": "cat" }
      },
      "updatedAt": "..."
    }
  }
}
```

**Task-layer design.** Each timestamp can carry an independent `detect` task and `clf` task. Detect and clf tasks have independent `reviewed` states. Clearing one task does not disturb the other. This means a single frame can be labeled for bounding-box detection and image classification simultaneously without coupling the two workflows.

Version 1 manifests (flat `{ boxes, reviewed }` per frame) are auto-migrated to version 2 on load by `normalizeVideoAnnotationManifest`. No migration script is required and no data is lost.

The file stores:

- Source video path and metadata.
- Millisecond timestamp keys.
- Per-task reviewed/empty state and annotation data.
- Normalized YOLO boxes with optional stable `classKey`.
- Creation and update timestamps.

**Video samples are timestamp annotations, not saved screenshots. Frames are decoded only for preview and export.**

The storage root must be workspace-relative. Absolute paths and traversal segments are rejected before backend file access.

## Logging and audit foundation

Structured records are written as individual JSON documents to avoid unsafe concurrent append behavior:

```text
workspace/logs/events/YYYY-MM-DD/*.json
workspace/logs/operations/<operation-id>.json
```

Current events include workspace migration, video addition, annotation session opening, persistence errors, copying boxes, marking empty frames, and clearing frame records.

This implements the audit-only starting point of roadmap items **P5 — Operation Log** and **P8 — Structured Logging**. It does not claim reversible undo.

## Memory policy

- Video Label remains mounted to preserve session state, but releases preview data when inactive.
- Preview requests are debounced and stale responses are ignored.
- Mask Cleanup is unmounted when inactive.
- Image tools retain their existing state through their nested KeepAlive boundary.

## Deferred roadmap work

The following items remain separate changes because they require broader migration or performance measurement:

- P1 global Job Manager migration for all long-running backend jobs.
- P3 persistent thumbnail cache verification and cache invalidation hardening.
- P4 SQLite dataset index.
- P7 packaged release/update channel.
- P9 categorized path authorization UI.
- P10 full guided pipeline view.

The architecture introduced here is intended to support those changes without expanding `WorkbenchBody` or `VideoLabelPage` into new monoliths.

---

## Video segment data model

### VideoSegment type

A segment is a named, enableable millisecond range within a single source video.
It contains no pixel data and does not cause frame extraction.

```ts
export interface VideoSegment {
  id: string;            // stable UUID assigned at creation; never reused
  label: string;         // human-readable name chosen by the annotator
  startMs: number;       // inclusive start timestamp in milliseconds
  endMs: number;         // exclusive end timestamp in milliseconds
  enabled: boolean;      // participates in random sampling when true
}
```

### VideoSegmentManifest storage path

Segments are stored as a top-level `segments` array inside the per-video annotation
manifest. No separate file is needed.

```text
workspace/video_annotations/<safe-video-name>-<path-hash>.json
```

Manifests written before segment support was introduced have no `segments` key.
Readers treat a missing key as an empty array. No migration script is required.

Example manifest structure with segments:

```json
{
  "videoPath": "/path/to/source.mp4",
  "durationMs": 120000,
  "segments": [
    {
      "id": "a1b2c3d4-...",
      "label": "intro",
      "startMs": 0,
      "endMs": 8000,
      "enabled": true
    },
    {
      "id": "e5f6a7b8-...",
      "label": "action-scene-1",
      "startMs": 15000,
      "endMs": 45000,
      "enabled": true
    }
  ],
  "frames": {
    "3200": { "boxes": [], "reviewed": false },
    "22500": { "boxes": [{ "classId": 0, "cx": 0.5, "cy": 0.5, "w": 0.2, "h": 0.3 }], "reviewed": true }
  }
}
```

### SamplingMode options

```ts
export type SamplingMode =
  | "whole-video"    // uniform random draw over [0, durationMs)
  | "segments-only"; // uniform random draw over the union of enabled segment ranges
```

The active mode is held in React component state for the Video Label session. It is not
written to the manifest so that reloading the workspace does not constrain the annotator
to a particular mode.

Fallback rule: if `segments-only` is selected but no segment is enabled, the sampler
falls back to `whole-video` and the UI displays a warning. It never returns an error or
an empty frame.

### How segments guide random sampling

When `segments-only` is active the sampler:

1. Collects all segments where `enabled === true`.
2. Computes total covered duration as the sum of `(endMs - startMs)` for each enabled
   segment (overlapping ranges are not de-duplicated in the current implementation).
3. Draws a uniform random value in `[0, totalCoveredMs)`.
4. Maps that value onto the ordered segment list to produce a concrete timestamp.

The resulting timestamp is passed to the video decode endpoint exactly as a
whole-video sample would be; the decode path is unaware of segments.

### Integration with the Video Label page

The Video Label page shell exposes:

- A segment management panel (create, rename, set range, enable/disable, delete).
- A sampling mode toggle (whole-video / segments only).
- A "Random next" button that invokes the sampler for the current mode.
- A frame preview canvas that displays the decoded frame for the current timestamp.

Segments are saved eagerly on every create/update/delete operation because they are
lightweight (pure metadata). Frame annotations are saved on navigation away or explicit
save, consistent with the existing timestamp-manifest persistence contract.

No decoded frame is written to disk as part of any of these operations. Explicit frame
export remains a separate action in the export panel and is not triggered by annotation
or sampling.

## Non-destructive blackout overlays and similarity comparator

Blackout edits are non-destructive overlays. They are rendered in preview and applied during export, but they never modify source images or source videos.

### Core principle

```text
source video / image
  ↓
annotation layer
  ├─ detect boxes
  └─ clf label
  ↓
blackout overlay layer
  └─ rect / polygon / mask metadata
  ↓
preview/export renderer
  ├─ Video Label preview can show blackout blocks (toggle)
  └─ YOLO export applies blackouts temporarily to the exported frame image
```

Source files are **never** written by overlay APIs. Export images are derived artifacts — they can be deleted and regenerated.

### Storage

Per-video overlay files stored alongside other workspace metadata:

```text
workspace/overlays/blackouts/{vid-stem-hash}.json
workspace/overlays/blackouts/{img-stem-hash}.json
```

One file per source. Splitting avoids one monolithic JSON growing unbounded as timestamps accumulate.

### Overlay schema

```json
{
  "version": 1,
  "overlays": [
    {
      "id": "blk_001",
      "target": {
        "type": "video-timestamp",
        "videoPath": "/path/to/video.mp4",
        "timestampMs": 123456
      },
      "shape": { "type": "rect", "x": 0.5, "y": 0.5, "w": 0.3, "h": 0.15 },
      "mode": "black",
      "visibleInPreview": true,
      "applyOnExport": true,
      "createdBy": "manual",
      "createdAt": "2026-06-27T00:00:00.000Z",
      "updatedAt": "2026-06-27T00:00:00.000Z"
    }
  ]
}
```

Coordinates are normalized 0–1 with x/y at the **center** of the rect (same convention as `LabelBox` / `DetectBoxAnnotation`).

### Canvas draw order

1. Source image / decoded frame
2. Blackout overlay rects (filled black; dashed red border for identification)
3. Detect annotation boxes and handles

A "Show Blackout Overlays" toggle in the UI lets users verify the underlying image without overlays.

### Export integration

The export planner (`videoExportPlanner.ts`) accepts an optional `resolveBlackouts` callback that returns rects for a given timestamp. Each `DetectExportItem` and `ClfExportItem` carries a `blackouts: BlackoutRectShape[]` field.

The export executor (`videoExportExecutor.ts`) completes the pipeline:

1. **Frame decode** — calls `getAnnotationFrameBase64(videoPath, seconds)` (read-only; never writes source).
2. **Blackout apply** — `encodeImageWithBlackouts(base64, rects)` renders rects onto an off-screen canvas and re-encodes as JPEG. `applyBlackoutRectsToImageData` is the pure pixel-level helper used for testing.
3. **Export write** — `writeFileBase64(workspaceRoot, item.imageOutputPath, ...)` writes the blacked-out frame to the export path only.
4. **YOLO label write** — for detect items, `writeTextFile(workspaceRoot, item.labelOutputPath, ...)` writes the YOLO `.txt` label.

A Python mirror (`backend/blackout_renderer.py`) provides `apply_blackout_rects(image, rects)` for server-side use. It always returns a copy — the source ndarray is never mutated.

Source files are never in the write path. Only `imageOutputPath` and `labelOutputPath` (both under the export root) are written.

### Overlap warning

`computeExportBlackoutWarnings` (in `videoExportBlackout.ts`) checks if any export blackout rect overlaps a detect box above an IoU threshold (default 0.1). The executor logs a `console.warn` for each overlap. The first pass strategy is **warn-only** — no labels are automatically removed.

### Similarity comparator

`similarityDomain.ts` provides pure perceptual hashing:

- **aHash** (average hash, 64 bits) — 8×8 downsampled grayscale; bits above mean = 1.
- **dHash** (difference hash, 64 bits) — 9×8 downsampled; compares adjacent pixels per row.
- **Hamming distance** — XOR bit count between two hex hash strings.
- **Similarity score** — normalized 0 (identical) to 1 (maximally different).
- **`rankSimilarityCandidates`** — sorts a list of candidates against a reference fingerprint.

Planned workflow:
1. User selects a reference frame/image with a blackout overlay.
2. App computes or loads fingerprint for candidates (same-session frames or image pool).
3. App lists visually similar candidates sorted by score.
4. User selects candidates and confirms applying the same overlay position.
5. New `BlackoutOverlay` records are created with `createdBy: "similarity-propagation"`.

First pass uses pHash/dHash. Future methods may include template matching, ORB/AKAZE feature matching, CLIP/DINO embeddings, or optical flow for continuous video propagation.

## Box Label proposal system

### Proposal data model

Proposals are model suggestions that have not yet been confirmed by the user. They are:

- Displayed as dashed orange boxes on the canvas.
- Stored in sidecar JSON files separate from YOLO label `.txt` files.
- **Never exported** until the user materializes them into accepted boxes.
- Cleared per-image on undo/redo along with the box state.

```text
workspace/proposals/detect/{image-key}.json
```

`imageProposalKey(imagePath)` produces a stable path-safe key from the image path hash.

### ProposalShape vs DetectProposal

`ProposalShape` is a lightweight local type used inside `geometry.ts`, `boxCanvasRenderer.ts`, and `useBoxLabelCanvas.ts`:

```ts
type ProposalShape = { id: string; x: number; y: number; w: number; h: number; confidence: number };
```

`DetectProposal` (from `videoAnnotationApi.ts`) is the full storage type with `createdAt`, `classId?`, `classKey?`, and `modelId?`. The sidecar stores `DetectProposal[]`; the canvas layer only needs `ProposalShape`.

### Threshold classification (Auto Label)

Auto Label with "Generate proposals for review" mode enabled splits predictions by confidence:

- `confidence >= highConfidence` (default 0.80) → accepted auto box written to YOLO `.txt`
- `mediumConfidence <= conf < highConfidence` (default 0.40–0.80) → proposal written to sidecar
- `confidence < mediumConfidence` → ignored

The backend job is run with `confidence = mediumConfidence` as the floor. Frontend post-processing (`applyDetectThresholds`) applies the split.

### Proposal operations and undo/redo

All proposal mutations follow the two-phase commit undo pattern:

1. `pushUndo("action label")` — captures "before" snapshot (includes both `boxes` and `proposals`).
2. Mutation runs synchronously (update refs + React state).
3. Next `pushUndo` / `undoLast` / `redoLast` captures "after" and commits the transaction.

| Operation | Effect |
|---|---|
| Click dashed box (pointer mode) | Materializes → removes from proposals, adds to boxes |
| Accept Selected | Materializes selected proposal → adds to boxes |
| Reject Selected | Removes selected proposal |
| Accept All | Materializes all proposals → adds all to boxes |
| Reject All | Removes all proposals |

Undo/redo for each operation is scoped to the current image only. Navigating to another image and pressing Ctrl+Z never restores proposals on a different image.

## Assisted Auto Label and Review Queue

Auto Label generates reviewable annotations: high-confidence predictions become accepted auto boxes, medium-confidence predictions become dashed proposals, and proposals are never exported until materialized.

### Confidence tiers

| Range | Outcome | Origin | Exported? |
|---|---|---|---|
| ≥ 0.80 (high) | Placed in `boxes[]` with `origin="auto"` | `"auto"` | Yes, after user reviews the sample |
| 0.40–0.79 (medium) | Placed in `proposals[]` as a `DetectProposal` | — | Never, until materialized |
| < 0.40 (low) | Ignored | — | Never |

### Core invariants

- **Boxes = accepted labels.** Only `detect.boxes[]` is read by the export planner. Proposals are structurally invisible to the exporter.
- **Proposals = suggestions.** `DetectProposal` objects live in `detect.proposals[]` and are displayed as dashed overlay boxes in the UI.
- **High-confidence auto boxes do not auto-review a sample.** The user must still open the sample and mark it reviewed before it enters the export set.
- **Auto Label never overwrites manual work.** Incoming predictions are IoU-deduped against existing boxes (threshold 0.85). Any prediction overlapping an existing box at or above the threshold is silently skipped.
- **Materializing a proposal moves it into `boxes[]` with `origin="manual"`.** The proposal is removed from `proposals[]`. Rejecting a proposal removes it without touching `boxes[]`.

### Types

```ts
// Extended accepted box
export type DetectBoxAnnotation = {
  x: number; y: number; w: number; h: number;
  classId?: number; classKey?: string;
  origin?: "manual" | "auto";   // "auto" = placed by model, not yet reviewed
  confidence?: number;           // stored when origin="auto"
};

// Proposal (never exported)
export type DetectProposal = {
  id: string;
  x: number; y: number; w: number; h: number;
  confidence: number;
  classId?: number; classKey?: string;
  modelId?: string;
  createdAt: string;
};

// Task now carries optional proposals[]
export type VideoDetectTask = {
  reviewed: boolean;
  empty?: boolean;
  boxes: DetectBoxAnnotation[];
  proposals?: DetectProposal[];   // never exported until materialized
};
```

### Image Box Label proposal sidecar

For the image-pool workflow, proposals are stored in a sidecar file separate from the YOLO `.txt` label files, so model suggestions can never pollute training data:

```text
workspace/proposals/detect/{image-stem-hash}.json
```

The sidecar is read and written by `proposalApi.ts`. Accepted boxes continue to be written to the standard YOLO `.txt` label files.

### Review queue

`proposalDomain.ts` provides a score-based review queue that surfaces the most important samples first:

| Score | Condition |
|---|---|
| 0 | Has unreviewed proposals |
| 1 | Has auto boxes (origin="auto"), unreviewed |
| 2 | Has manual labels, unreviewed |
| 3 | Empty, unreviewed |
| 9000 | Already reviewed |
| 10000 | Junk |

`nextNeedsReviewIndex` and `prevNeedsReviewIndex` traverse the sorted queue and skip reviewed/junk entries by default.

### Auto Label arg order fix

`autoLabelApi.ts` now sends arguments in the order the Python backend expects:
`[modelPath, inputRoot, outputRoot, imageSize, confidence, device, ...]`

The previous order `[inputRoot, outputRoot, modelPath, ...]` was a silent bug that caused the backend to receive incorrect paths.

## Scoped Undo/Redo

Undo and redo are scoped to the current image or timestamp. They never navigate to another item and never modify labels that are not currently visible.

### Core rule

Ctrl+Z undoes the last edit on the **currently visible** image or video timestamp. Ctrl+Y and Ctrl+Shift+Z redo the last undone action on the currently visible item. If the current item has no undo/redo history, the operation is a no-op and a safe status message is shown.

### Scope key

Each undo/redo stack entry is identified by a `UndoScopeKey`:
- Image pool: `entry.basename` (e.g. `frame_0001.jpg`)
- Video timestamp: `${videoSourceKey}|${timestampMs}`

`undoScoped` and `redoScoped` only pop transactions that match the current scope key. Transactions from other images or timestamps are never touched.

### Two-phase commit

`pushUndo(label)` captures the "before" snapshot and stages a pending transaction. The transaction is committed (with the "after" snapshot) when the next `pushUndo`, `undoLast`, or `redoLast` call runs. If the filename changes before the transaction commits, the pending entry is discarded — the "after" snapshot is never captured from the wrong image.

### Batch operations

`copySelectedBoxToNext` and `trackCsrtForward` are not undoable via Ctrl+Z. `pushBatchUndo` is a deliberate no-op. Allowing Ctrl+Z to silently restore other images is unsafe; navigate to each affected image and use Ctrl+Z there if needed.

### Export policy

The default export policy for both detect and CLF tasks is `"reviewed"`:
- `detectPolicy: "reviewed"` — only timestamps where `detect.reviewed === true` are exported.
- `clfPolicy: "reviewed"` — only timestamps where `clf.reviewed === true` are exported.

Pass `detectPolicy: "has-boxes"` or `clfPolicy: "all"` explicitly to include unreviewed samples.
