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
