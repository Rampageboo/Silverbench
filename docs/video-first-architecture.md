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

The file stores:

- Source video path and metadata.
- Millisecond timestamp keys.
- Reviewed/empty-frame state.
- Normalized YOLO boxes.
- Creation and update timestamps.

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
