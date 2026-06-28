# Unified Label Workbench — Architecture Plan

## Status: Phase 3A complete

---

## 1. Background

YoloWorkBench has two annotation surfaces:
- **Box Label** — image-by-image detection annotation (`detect_dataset`)
- **Video Label** — timestamp-based detection + classification annotation from video sources

Phase 1 introduced a `LabelPage` wrapper that toggled between them using a mode switch.
Phase 3A establishes a real shared workbench architecture that makes these feel like one surface.

---

## 2. Phase 3A — Shared workbench shell (completed)

### What was built

**`features/label/labelWorkbenchTypes.ts`**
View-model type definitions. These are UI-facing adapters — not storage formats.
- `LabelSourceKind` — `"image"` | `"video-timestamp"`
- `LabelTaskKind` — `"detect"` | `"classify"` | `"both"`
- `LabelWorkbenchMode` — `"image"` | `"video"`
- `LabelReviewStatus` — `"unreviewed"` | `"approved"` | `"flagged"` | `"unknown"`
- `LabelSourceSummary` — discriminated union: `ImageSourceSummary` | `VideoTimestampSummary`
- `LabelWorkbenchContextValue` — shape of what `LabelWorkbenchContext` provides

**`features/label/LabelWorkbenchContext.ts`**
React context for the workbench. Provides `mode`, `setMode`, and `reportSourceSummary`.

**`features/label/useLabelWorkbench.ts`**
Hook for child pages to access workbench context. Returns `null` when used outside a LabelPage.

**`features/label/LabelWorkbenchHeader.tsx`**
Unified header shell. Renders:
- `LabelModeSwitch` — "Image" / "Video" tabs (replaces old inline label-mode-bar)
- `LabelSourceBadge` — "Image source" / "Video timestamp" (normalized product language)
- `LabelTaskChips` — "Detect" / "Classify" chips (statically derived from mode in Phase 3A)
- `LabelSourceSummaryBar` — live source info (empty in Phase 3A; populated when children call `reportSourceSummary`)
- Workspace name — right-aligned

**`features/label/LabelPage.tsx`** (refactored)
- Now a real workbench shell, not a thin toggle wrapper.
- Provides `LabelWorkbenchContext` to all descendants.
- Renders `LabelWorkbenchHeader` above the content area.
- Delegates canvas rendering to existing `VideoLabelPage` / `BoxLabelPage` unchanged.

### What is unchanged

- `BoxLabelPage` and `VideoLabelPage` — no modifications in Phase 3A.
- `BoxLabelView` canvas — unchanged.
- `VideoAnnotationCanvas` — unchanged.
- All annotation domain models — unchanged.
- YOLO label file formats — unchanged.
- Workspace manifest structure — unchanged.
- Export behavior — unchanged.
- Undo/redo command model — unchanged.
- Proposal accept/reject behavior — unchanged.

### Language normalization

The LabelPage wrapper and workbench header use normalized product language:
- "Image" / "Video" (not "Box Label" / "Video Label")
- "Image source" (not "Box Label")
- "Video timestamp" (not "Video Label frame")
- "Detect" / "Classify" (task-level language, not implementation class names)

Note: `BoxLabelTopbar` internally still says "Box Label" (it lives inside BoxLabelPage which
is untouched). This will be updated in Phase 3B.

---

## 3. Phase 3B — Source summary integration (planned)

Connect `BoxLabelPage` and `VideoLabelPage` to `reportSourceSummary` so the workbench
header can show live status without duplicating topbar logic.

**BoxLabelPage changes (Phase 3B):**
```typescript
const workbench = useLabelWorkbench();

useEffect(() => {
  workbench?.reportSourceSummary({
    kind: "image",
    totalImages: pool.entries.length,
    currentIndex: pool.currentIndex,
    filename: pool.currentEntry?.basename ?? null,
    reviewStatus: deriveReviewStatus(pool.currentEntry, pool.metadata),
  });
}, [pool.currentIndex, pool.entries.length, pool.metadata]);
```

**VideoLabelPage changes (Phase 3B):**
```typescript
const workbench = useLabelWorkbench();

useEffect(() => {
  workbench?.reportSourceSummary({
    kind: "video-timestamp",
    videoName: session.current?.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, "") ?? null,
    timestampMs: Math.round(session.time * 1000),
    reviewed: session.reviewed,
    hasDetectTask: Boolean(session.detectTask),
    hasClfTask: Boolean(session.clfTask),
  });
}, [session.current, session.time, session.reviewed, session.detectTask, session.clfTask]);
```

**BoxLabelTopbar title update (Phase 3B):**
Change the `title` prop from `"Box Label"` to `"Images"` or similar neutral language.

---

## 4. Phase 3B — Additional workbench improvements (planned)

- **Segment timeline integration**: Show the active segment label and time range in the
  workbench header when in video mode.
- **Proposal status integration**: Show pending proposal count in the header when the
  image source has unresolved proposals.
- **Review status indicator**: Real-time review chip in the header.
- **Source navigation**: Optional source list/drawer accessible from the header without
  going to Library.
- **Mode persistence**: Remember last active mode per workspace (currently resets to video
  on each mount).

---

## 5. Phase 3C — Shared canvas abstraction (deferred; NOT Phase 3A/B)

> **Risk: high. Do not start until Phase 3B is complete and stable.**

Unifying the annotation canvas (BoxLabelView + VideoAnnotationCanvas) into a shared
component requires:
- Shared annotation command model (currently separate between image and video)
- Unified undo/redo stack (currently scoped per-page with different mechanisms)
- Shared proposal panel internals
- Shared pointer tool state

The two canvases have different rendering models:
- BoxLabelView: renders labeled boxes on a static image.
- VideoAnnotationCanvas: renders labeled boxes on a video frame (base64 preview).

Risks:
1. Undo/redo breakage across both modes if command models diverge.
2. Proposal accept/select behavior may differ subtly between image and video flows.
3. Blackout overlay rendering is video-only and has no image equivalent.

Recommended approach: keep both canvases separate until the command model is unified
behind a shared interface. Do not share DOM or React state between them.

---

## 6. CSS namespace

Phase 3A introduces the `.lwb-*` CSS namespace for all workbench header components.

Existing `.label-*` classes continue to be used for the outer page shell:
- `.label-page` — outer container (flex column, h:100%)
- `.label-content` — the canvas area below the header
- `.label-page--workbench` — modifier added in Phase 3A
- `.label-page--no-workspace` — empty state modifier

The `.label-mode-bar`, `.label-mode-tab` etc. from Phase 2 are no longer used in the
DOM (LabelWorkbenchHeader replaces them) but remain in styles.css for reference.

---

## 7. File map

```
apps/desktop/src/features/label/
├── labelWorkbenchTypes.ts       Phase 3A — shared type definitions
├── LabelWorkbenchContext.ts     Phase 3A — React context
├── useLabelWorkbench.ts         Phase 3A — hook for child pages
├── LabelWorkbenchHeader.tsx     Phase 3A — unified header component
│   ├── LabelModeSwitch         (inline)
│   ├── LabelSourceBadge        (inline)
│   ├── LabelTaskChips          (inline)
│   └── LabelSourceSummaryBar   (inline, wired in Phase 3B)
└── LabelPage.tsx               Phase 3A — workbench shell
```
