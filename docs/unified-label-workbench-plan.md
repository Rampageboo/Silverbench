# Unified Label Workbench — Architecture Plan

## Status: Label Workbench v1 Consolidation complete

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

## 5. Phase 5A - Shared inspector and control bridge

Phase 5A adds an additive Workbench Inspector beside the existing image/video
labeling surfaces. It does not move ownership of editing state out of
`BoxLabelPage` or `VideoLabelPage`.

### What was added

- `LabelWorkbenchInspector` displays source status, task chips, review status,
  class counts, proposal context, blackout/overlay context, segment context,
  warnings, and contextual actions.
- `labelWorkbenchTypes.ts` now includes lightweight capability/action models:
  `LabelWorkbenchCapability`, `LabelWorkbenchActionId`,
  `LabelWorkbenchAction`, `LabelWorkbenchActionGroup`,
  `LabelWorkbenchControlState`, and `LabelWorkbenchInspectorState`.
- `LabelWorkbenchContextValue` now supports optional upward reporting:
  `reportInspectorState`, `registerWorkbenchActions`, and
  `clearWorkbenchActions`, in addition to `reportSourceSummary`.
- `LabelPage` renders the inspector as a right-side rail and clears source,
  inspector, and action state on mode switch to avoid stale image/video state.

### Child page adapters

- `BoxLabelPage` reports image source status, review state, observed class
  count, archived-class status warnings when surfaced by the child workflow,
  and safe review/junk actions.
- Box proposal actions are shown as unavailable in Phase 5A because proposal
  materialization/rejection is still owned inside `BoxLabelView`.
- `VideoLabelPage` reports current video/timestamp, detect/classify status,
  active class counts, blackout count, segment count, archived-class warnings,
  and safe actions: Random Next, Copy Previous Boxes, Mark Reviewed, Mark
  Empty, and Clear Frame Record.

### Existing controls intentionally retained

The inspector duplicates a subset of actions during transition. Existing
controls remain in place:

- Box Label topbar review/junk controls.
- Box Label proposal panel materialize/reject controls.
- Box Label class/shortcut/fixed-box controls.
- Video Label Random Sampling, Detect, Classification, and Blackout panels.

### Deferred to Phase 5B/5C

- Remove duplicate old controls after inspector actions are proven stable.
- Move class picker fully into the Workbench.
- Move proposal panel fully into the Workbench.
- Add a shared canvas abstraction.
- Add a shared command system.
- Add a unified undo/redo command model.

---

## 6. Phase 5B - Workbench action bridge activation

Phase 5B activates inspector actions as bridges into existing child-page
handlers. The Workbench does not own annotation state, undo/redo state,
proposal state, sampling state, storage, or export behavior.

### Wired actions

- Image review:
  - Mark/Unmark Reviewed calls the existing `useBoxLabel` metadata handler.
  - Mark Junk calls the existing `useBoxLabel` junk handler.
- Image proposals:
  - Accept Selected calls `BoxLabelView` / `useBoxLabelEditor.materializeProposal`.
  - Reject Selected calls `useBoxLabelEditor.rejectProposal`.
  - Accept All calls `useBoxLabelEditor.acceptAllProposals`.
  - Reject All calls `useBoxLabelEditor.rejectAllProposals`.
- Video navigation/review:
  - Random Next calls the existing segment-aware `useVideoSampling.randomNext` path.
  - Copy Previous Boxes calls `useVideoAnnotationSession.copyPreviousBoxes`.
  - Mark Reviewed calls `useVideoAnnotationSession.updateCurrentFrame`.
  - Mark Empty calls `useVideoAnnotationSession.markEmptyReviewed`.
  - Clear Frame Record calls `useVideoAnnotationSession.clearFrameRecord`.

### Guardrails preserved

- Box proposal materialize/reject remains owned by `BoxLabelView` and
  `useBoxLabelEditor`, so scoped undo/redo snapshots still include boxes and
  proposals exactly as before.
- Archived-class guards still run inside the existing proposal handlers.
- Video actions still preserve timestamp-first annotation behavior, current
  sampling logic, reviewed/empty semantics, and blackout overlay behavior.
- Disabled inspector actions show a reason instead of silently doing nothing.

### Left disabled or not moved

- Accept Selected and Reject Selected remain disabled until a proposal is
  selected in the existing Box Label proposal panel.
- Accept Selected and Accept All remain disabled when the target proposal(s)
  only reference archived classes.
- Class picker, proposal panel UI, canvas controls, export controls, and
  undo/redo UI remain in their existing child-page locations.

### Existing controls intentionally retained

Duplicate controls are expected in Phase 5B. The old Box Label and Video Label
controls remain the canonical fallback while the Workbench bridge proves stable.

### Deferred

- Removing legacy child-page controls globally.
- Moving proposal panel fully into the Workbench.
- Moving class picker fully into the Workbench.
- Shared command system.
- Shared canvas abstraction.
- Unified undo/redo command model.

---

## 7. Phase 5C - Embedded label mode and duplicate UI cleanup

Phase 5C adds render-mode awareness so `BoxLabelPage` and `VideoLabelPage`
can distinguish standalone rendering from Workbench-embedded rendering. This
phase is UI de-duplication only.

### Embedded mode

- `LabelWorkbenchContextValue.renderMode` is set to
  `"workbench-embedded"` by `LabelPage`.
- Child pages rendered outside `LabelPage` still see no Workbench context and
  keep their standalone chrome and controls.
- `useLabelWorkbench` exposes a small helper for embedded-mode checks.

### Duplicate UI audit

Box Label duplicates now covered by the Workbench:

- Top-level `Box Label` title/topbar.
- Current image source/status text.
- Mark Reviewed / Mark Junk controls.
- Proposal accept/reject controls, now available through inspector actions.

Video Label duplicates now covered by the Workbench:

- Top-level `Video Label` title/header and current video summary.
- Random Next action.
- Copy Previous Boxes, Mark Empty, and Clear Frame Record actions.
- Detect/classify task and review status summary chips.

### Hidden or de-emphasized in embedded mode

- Box Label hides the topbar in Workbench embedded mode.
- Video Label hides the top-level page header in Workbench embedded mode.
- Video Label hides duplicated embedded controls for Random Next, Copy Previous
  Boxes, Mark Empty, and Clear Frame Record.
- Embedded Box/Video layouts reduce nested spacing and shell chrome without
  applying blur or filters to the annotation canvas.

### Intentionally retained in embedded mode

- Box Label gallery, shortcut/fixed-box controls, canvas tools, current boxes,
  proposal list/panel, class picker, and keyboard shortcuts.
- Video canvas/preview, timeline/scrub controls, Add Video, sampling mode/min
  spacing controls, reviewed-frame navigation, classification controls, blackout
  overlay controls, detect class picker, and session/status text.

### Preserved behavior

- Standalone Box Label and Video Label render as before.
- Annotation editing, proposal logic, scoped undo/redo, timestamp/session logic,
  sampling, persistence, export behavior, and YOLO formats are unchanged.

### Deferred

- Shared canvas abstraction.
- Moving class picker fully into the Workbench.
- Moving proposal panel fully into the Workbench.
- Moving video timeline fully into the Workbench.
- Removing legacy child page controls globally.
- Shared command system.
- Unified undo/redo command model.

---

## 8. Milestone - Label Workbench v1 Consolidation

The v1 consolidation makes the unified Label page feel like a product surface
while keeping child pages in charge of annotation behavior.

### Workbench now presents

- Consistent image/video source summaries: filename or video name, image index
  or timestamp, task chips, review status, class counts, proposal counts, segment
  context, and blackout context.
- Image Proposal / Review details in the inspector:
  - proposal count;
  - selected proposal class and confidence;
  - archived selected-proposal warning;
  - Accept Selected, Reject Selected, Accept All, Reject All;
  - Mark Reviewed / Unreviewed and Mark Junk.
- Class palette summaries:
  - active detect classes with YOLO id badges;
  - active classification classes in video mode;
  - archived classes are filtered out of normal active class display;
  - archived references still surface as warnings.
- Inspector action state: enabled, disabled, unavailable, busy, and danger.

### Child pages still own

- Box and video canvas rendering.
- Annotation editing, proposal materialization/rejection, and undo/redo snapshots.
- Class selection and shortcut/fixed-box controls.
- Video timeline, sampling logic, timestamp/session logic, and blackout editing.
- Persistence, export behavior, YOLO formats, class id ordering, and
  `classes.txt` compatibility.

### Embedded duplicate cleanup

- Box Label embedded mode hides the duplicated topbar/title/status.
- Box Label embedded mode hides old proposal action buttons now that inspector
  actions have parity, while keeping the proposal list/selection UI.
- Video Label embedded mode hides duplicated title/status and duplicated action
  buttons already exposed in the inspector.
- Standalone Box Label and Video Label keep legacy chrome and controls.

### Still intentionally retained

- Box Label gallery, canvas tools, class picker, current boxes, proposal list,
  keyboard shortcuts, and local editing controls.
- Video timeline/scrub controls, sampling parameters, reviewed-frame navigation,
  class/task controls, blackout controls, and session status.

### Deferred

- Shared canvas abstraction.
- Moving class picker fully into the Workbench.
- Moving proposal panel fully into the Workbench.
- Moving video timeline fully into the Workbench.
- Removing legacy child-page controls globally.
- Shared command system.
- Unified undo/redo command model.
- Export presets.

---

## 9. Phase 5D - Shared canvas abstraction (deferred; NOT Workbench v1)

> **Risk: high. Do not start until Label Workbench v1 is complete and stable.**

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

## 10. CSS namespace

Phase 3A introduces the `.lwb-*` CSS namespace for all workbench header components.

Existing `.label-*` classes continue to be used for the outer page shell:
- `.label-page` — outer container (flex column, h:100%)
- `.label-content` — the canvas area below the header
- `.label-page--workbench` — modifier added in Phase 3A
- `.label-page--no-workspace` — empty state modifier

The `.label-mode-bar`, `.label-mode-tab` etc. from Phase 2 are no longer used in the
DOM (LabelWorkbenchHeader replaces them) but remain in styles.css for reference.

---

## 11. File map

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
