# UI/IA Redesign Plan — YoloWorkBench Desktop

## Current Structure (Audit)

### Current Top-Level Navigation (9 items)

| Tab ID | Label | Group | Notes |
|--------|-------|-------|-------|
| `video` | Video Label | video | Primary labeling tool |
| `video-capture` | Video Segments | video | Segment management + export |
| `pool-label` | Image Box Label | image | Image annotation |
| `image-pool` | Image Pool | image | Has 3 sub-tabs: Pool / Assign / Review |
| `train-prep` | Dataset Prep | dataset | |
| `train` | Auto Label | dataset | |
| `crop` | Batch Crop | utility | |
| `mask-noise` | Mask Cleanup | utility | |
| `merge` | Dataset Merge | dataset | |

**Settings** is a modal opened from a button at the bottom of the sidebar.

### Current Pain Points

1. **No Home screen** — app boots directly to a tool, with no workspace landing
2. **No Create Workspace flow** — workspace creation is implicit (directory chooser → auto-initialize); no user-facing wizard
3. **Video Label and Box Label are separate tools** — users annotate in two different places depending on source type
4. **Review is buried** — it lives as a sub-tab inside Image Pool, not a first-class concept
5. **Export is embedded** — video export lives inside Video Segments; no unified export surface
6. **9 top-level navigation items** — cognitive overload; utility tools clutter the primary workflow
7. **No workspace-first mental model** — feels like disconnected tools, not a workspace product
8. **Segments competing with Label** — Video Segments presents as a peer to Video Label, causing confusion

### Current Feature Locations

- **Box Label**: `src/features/box-label/BoxLabelPage.tsx` (tab: `pool-label`)
- **Video Label**: `src/features/video/VideoLabelPage.tsx` (tab: `video`)
- **Video Segments**: `src/features/video/VideoCapturePage.tsx` (tab: `video-capture`)
- **Image Pool / Review**: `src/features/image-workspace/ImageWorkspaceToolPage.tsx` (tab: `image-pool`, sub-tabs: pool / inbox / yolo)
- **Open Workspace**: `WorkspaceProvider.tsx` → `chooseWorkspaceFolder()` (called from `WorkspaceRequired` inline fallback)
- **Create Workspace**: Does NOT exist as a dedicated UI flow
- **Classes**: `src/features/video/classDomain.ts`, `src/features/box-label/useBoxLabelClasses.ts` — no single management surface
- **Settings**: `src/components/SettingsModal.tsx` — modal opened from sidebar gear button

---

## Target Information Architecture

### New Top-Level Navigation (6 items)

| Tab ID | Label | Icon Concept | Notes |
|--------|-------|-------------|-------|
| `home` | Home | house | Workspace hub; Create / Open / Recent |
| `library` | Library | layers | Media sources, classes, workspace summary |
| `label` | Label | pen-tool | Unified label surface (image + video modes) |
| `review` | Review | check-circle | Review queue, proposals, filters |
| `export` | Export | upload | Detect export, CLF export, presets |
| `settings` | Settings | gear | Workspace + app settings |

### Home — Workspace Hub

- **Create Workspace** button (primary CTA)
  - Dialog: name, location picker, task type (detect / classify / both), media mode (images / videos / mixed)
- **Open Workspace** button (secondary)
- **Recent Workspaces** list (localStorage-persisted, up to 8 entries)
- **Open Last Workspace** auto-open on startup if available

### Library

- Sources list (video files, image folders)
- Classes viewer/editor
- Segments overview
- Workspace summary (counts, paths)

### Label — Unified Annotation Surface

- **Image mode**: current BoxLabelPage functionality — image gallery + canvas + box tools + proposals + undo
- **Video mode**: current VideoLabelPage functionality — video player + annotation canvas + timestamp nav + blackouts
- Mode switching: automatic based on selected source, or manual toggle
- Shared: accepted boxes, proposals, blackout overlays, review state, class selection, scoped undo/redo
- Video-only: timestamp, timeline strip, segment-aware navigation
- Image-only: image gallery, review queue within-label

### Review

- Review queue (currently DatasetReviewPage)
- Proposal-heavy items filter
- Unresolved / reviewed / junk filters
- Quick lightbox review

### Export

- Detect export (YOLO format)
- Classification export
- Export presets (future)
- Current video export planning (from VideoCapturePage)

### Settings

- Workspace settings (paths, task type, media mode)
- App settings (startup mode, theme)
- Currently in SettingsModal — can keep as modal or elevate to page

---

## Migration Plan

### Phase 1 — IA Skeleton + Home (this pass)

**Goal**: New navigation structure, Home page with Create Workspace, unified Label routing shell.

Changes:
- [x] Add new tab types: `home`, `library`, `label`, `review`, `export`
- [x] Rename/alias: `label` wraps `video` and `pool-label` contextually
- [x] New `HomePage` with Create Workspace dialog and Open Workspace
- [x] New `LabelPage` — unified routing shell, shows video or image mode
- [x] Stub `LibraryPage`, `ReviewHubPage`, `ExportHubPage`
- [x] Updated `ToolNav` — 6 items with liquid glass shell
- [x] CSS: liquid glass tokens applied to sidebar + shell
- [x] Preserve all existing pages (keep alive, accessible via label)
- [x] Old tool tabs (`video`, `video-capture`, `pool-label`, `image-pool`) kept as KeepAlive panels, navigated from Label or Library

### Phase 2 — Workspace-First Flow (deferred)

- Full Create Workspace wizard (multi-step: name → location → type → media → classes → storage)
- Recent Workspaces persistence via backend API (not just localStorage)
- Home page: workspace cards with last-opened info
- Library: editable sources list, class CRUD, segment overview table

### Phase 3 — Unified Label Editor (deferred)

- Shared canvas component usable for both image and video annotation
- Video-specific controls appear contextually within Label
- Segment navigation accessible from Label directly
- Image gallery within Label, not via separate Library link

### Phase 4 — Review + Export Promotion (deferred)

- Review page: full filter UI, proposal workflow, keyboard shortcuts
- Export page: presets, per-format config, progress monitoring
- Dataset Prep, Auto Label → hidden under Export or accessible via overflow menu
- Batch Crop, Mask Cleanup, Merge → accessible via overflow/advanced section

---

## Deferred Items

Not in this pass:
- Full class management UI
- Multi-step Create Workspace wizard
- Shared canvas unification (deep merge of VideoAnnotationCanvas + BoxLabelView)
- Segment management within Label
- Export presets system
- Full Review queue with all filters
- Removal of legacy utility tools (Crop, Mask, Merge)

---

## Product Rules Preserved

1. Proposal workflow — proposals never auto-accepted; user confirms materialization
2. Scoped undo/redo — undo never navigates between images/timestamps
3. Reviewed-only export defaults — `detectPolicy: "reviewed"`, `clfPolicy: "reviewed"`
4. Timestamp-first video model — frames decoded on demand, never saved
5. Non-destructive blackout overlays — source media never modified
6. Route order fix — `/api/multimodal/*` routes registered before StaticFiles mount
7. Workspace persistence — `lastOpenedWorkspace` restored on startup
