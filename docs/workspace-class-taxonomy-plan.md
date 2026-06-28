# Workspace Class Taxonomy Plan

## Status: Phase 4C complete

---

## 1. Current class model (pre-Phase 4A)

### Two parallel systems

**System A — Legacy (Box Label)**

- Detect classes stored in `classes.txt` (one name per line, position = YOLO class ID) and `data.yaml`.
- Read by `GET /api/labels/classes` → `_read_detect_class_names()`.
- Frontend type: `LabelClass = { id: number; name: string }`.
- Class ordering is the YOLO ID: `classes.txt` line 0 = id 0, line 1 = id 1, etc.
- Box Label reads these via `loadLabelClasses(workspaceRoot)`.
- Changes must preserve ordering or existing label files become incorrect.

**System B — New (Video + workspace manifest)**

- Stable string `classKey` values defined in `workspace/classes.json`.
- Schema: `ClassesManifest = { version: 1, classDefs: ClassDef[], tasks: { detect: { classKeys }, clf: { classKeys } } }`.
- `tasks.detect.classKeys[N]` = YOLO id N at export time only.
- `tasks.clf.classKeys` = valid classification targets.
- Already defined in `features/video/classDomain.ts`.
- `workspace/classes.json` is referenced in `WorkspaceManifestPaths.classes` but was not yet written by the app before Phase 4A.

### Where classification classes lived

- `workspace/workspace.json` (v1): `classification_classes: string[]` field.
- Backend `metadata_assign.py` reads clf classes from: `clf_dataset/train/` folders (most authoritative) → `workspace.json` field → `metadata.csv` → default `["class_A", "class_B", "unknown", "background"]`.

### Create Workspace flow (pre-Phase 4A)

- Dialog collected `name`, `location`, `taskType`, `mediaMode`.
- `handleCreateWorkspace` computed root path and called `openWorkspacePath(root)`.
- `openWorkspacePath` → `POST /api/workspace/open` → `resolve_open_folder()` → `create_workspace(root)`.
- `create_workspace()` scaffolded folders using `DEFAULT_CLF_CLASSES = ("class_A", "class_B", "unknown", "background")`.
- `taskType` and `mediaMode` from the wizard were discarded — no class data written.

### Weaknesses

1. Task type and class setup were not persisted from Create Workspace.
2. Detect classes only existed if the user manually created `classes.txt`.
3. No `workspace/classes.json` was ever created, so the new system was unreachable.
4. Library "Classes" section was a non-functional "Soon" placeholder.
5. Video Label and Box Label each read classes independently (no shared source of truth).

---

## 2. Target class model

### Workspace-level class taxonomy

A workspace has:
- A **task type**: `detect` | `classify` | `both`
- A **detect class list** (ordered; position = YOLO class ID)
- A **classification class list** (unordered; name → folder-safe key)
- A **class key manifest** at `workspace/classes.json`

### Class key architecture

- Every class has a stable `key` (slugified name, e.g. `"person"`) that never changes after creation.
- The same key can appear in both `tasks.detect.classKeys` and `tasks.clf.classKeys`.
- YOLO numeric IDs are export-time only: `tasks.detect.classKeys[N]` = YOLO id N.
- Moving a class up/down in the detect list is a destructive operation — existing label files would map to the wrong class. This must be communicated clearly to users.

### Compatibility strategy

- Existing workspaces without `workspace/classes.json` continue to work exactly as before.
- Box Label still reads `classes.txt` / `data.yaml` (unchanged).
- Video Label still reads `loadLabelClasses()` (unchanged).
- `workspace/classes.json` is an additive file: its absence is not an error.
- Newly created workspaces (Phase 4A) get both `classes.txt` AND `workspace/classes.json`.
- Legacy `workspace.json` `classification_classes` field is preserved by `normalizeWorkspaceManifest`.

---

## 3. Phase 4A — What was implemented

### New: `features/workspace/workspaceClassTaxonomy.ts`

View-model type layer. Does not touch storage formats.

Types:
- `WorkspaceTaskType = "detect" | "classify" | "both"`
- `WorkspaceMediaMode = "images" | "videos" | "mixed"`
- `WorkspaceClassSetupMode = "empty" | "manual" | "starter"`
- `DetectClassEntry`, `ClfClassEntry` — wizard inputs
- `WorkspaceClassSetup` — full wizard state
- `WorkspaceClassSummary` — condensed view for Library and header

Key functions:
- `slugifyClassName(name)` — name → stable key
- `workspaceClassSetupToClassesManifest(setup)` → `ClassesManifest` for writing
- `derivedTaskType(manifest)` → `WorkspaceTaskType`
- `workspaceClassSummary(manifest)` → `WorkspaceClassSummary`
- `workspaceClassSummaryFromLegacy(legacyClasses)` → `WorkspaceClassSummary`
- `validateClassSetup(setup)` → `string[]` (error messages)

### Improved: `CreateWorkspaceDialog.tsx`

- Added `ClassListEditor` sub-component for adding/removing class names.
- Detect classes: shows when `taskType !== "classify"`. Ordered pills with YOLO id badge.
- CLF classes: shows when `taskType !== "detect"`. Simple name pills.
- Validation via `validateClassSetup()` before submission.
- Empty class lists → default "object" class (communicated to user in empty hint).
- Dialog variant `.glass-dialog--wide` for expanded layout.
- `CreateWorkspaceOptions` now includes `detectClasses: string[]` and `clfClasses: string[]`.

### Improved: `HomePage.tsx` — workspace creation

After `openWorkspacePath(root)` scaffolds the workspace:

1. If `detectClasses.length > 0`: calls `saveLabelClasses(root, ...)` to write `classes.txt` + `data.yaml`.
2. Always: calls `writeTextFile(root, "workspace/classes.json", ...)` to write the class manifest.
   - Uses `workspaceClassSetupToClassesManifest()` to convert wizard state.
   - This file is the canonical source for the new class system.

### Improved: `LibraryPage.tsx` — Classes panel

- "Classes" card is now functional (removed "Soon" badge).
- Clicking switches to `"classes"` view within the page (no new route needed).
- `WorkspaceClassesView` component shows:
  - Task type badge (detect / classify / both)
  - Detect class list with YOLO ID numbers (read-only)
  - Classification class list (read-only)
  - Empty states and notes
  - Read-only note with file paths for manual editing
  - Back button returns to library overview
- Load order: try `workspace/classes.json` first → fall back to `/api/labels/classes`.
- Resets to overview when workspace changes.

---

## 4. Class ordering safety

### Detect class IDs

The fundamental constraint: `classes.txt` line position = YOLO class ID in label files.

**Safe operations:**
- Adding new classes at the end of the list.
- Renaming a class (name change, key unchanged).
- Adding a class to the CLF list without touching detect order.

**Destructive operations (requires re-labeling):**
- Inserting a class at any position other than the end.
- Removing a class from the middle.
- Reordering the detect class list.

Phase 4A does not allow editing classes after creation (read-only Library view). A future class editor (Phase 4B) must enforce these constraints.

### Classification class keys

CLF class keys become `clf_dataset/train/<key>/` folder names (via `classKeyToClfFolder()`). They must be:
- URL/filesystem safe: `[a-z0-9_-]` only.
- `slugifyClassName()` guarantees this.
- Renaming a CLF class after `clf_dataset` folders are created requires renaming those folders.

---

## 5. Phase 4B — What was implemented

### Safe edit policy

All manifest mutations are pure functions (receive + return `ClassesManifest`).
The caller (`useWorkspaceClasses`) persists to disk after each operation.

**Detect class rules:**
- New classes always append to the end → YOLO id = `classKeys.length`.
- Rename updates `classDef.name` only — key and ID are unchanged.
- Archive marks `classDef.archived: true` but **KEEPS** the key in `tasks.detect.classKeys` so existing label files remain valid. The ID slot is reserved forever.
- Reorder is intentionally not implemented (would corrupt existing annotations).
- Hard delete is not implemented (would shift all subsequent IDs).

**Classification class rules:**
- New classes append to `tasks.clf.classKeys`.
- Rename updates `classDef.name` only — key stays stable (safe for folder names).
- Archive removes from `tasks.clf.classKeys` and marks `classDef.archived: true`.
- No ID sensitivity, so archiving is reversible (restore re-appends to classKeys).

### `ClassDef.archived?: boolean`

Added to `classDomain.ts`. Additive field — existing manifests without it are handled
by `normalizeClassesManifest` which now passes the field through.

### `useWorkspaceClasses.ts` — new persistence hook

```
load()         reads classes.json → normalizeClassesManifest()
               if not found → reads classes.txt → upgradeLegacyToManifest() [legacyMode=true]

persist(next)  writeTextFile(root, "workspace/classes.json", JSON)
               saveLabelClasses(root, manifestToLegacyClasses(next))
               ↑ classes.txt includes ALL detect classes (inc. archived) for ID stability
```

Operations: `addDetect`, `addClf`, `rename`, `archiveDetect`, `unarchiveDetect`,
`archiveClf`, `unarchiveClf`, `upgradeLegacy`.

### Library Classes panel — upgraded to management UI

- `WorkspaceClassesView` uses `useWorkspaceClasses` hook.
- Detect class list: all classes shown in YOLO id order (archived dimmed).
  - Rename inline, Archive with confirm step, Restore for archived.
  - Warning: "Detect class order cannot be changed."
  - Add class row: validates uniqueness, appends, saves.
- Classification class list: active + archived shown.
  - Rename inline, Archive with confirm step, Restore.
  - Info note about stable slug keys.
  - Add class row.
- Legacy mode (classes.txt only): shows read-only with "Save as classes.json" button.
- Saving indicator in header.

### New helpers in `workspaceClassTaxonomy.ts`

- `allDetectClassDefs(manifest)` — all detect defs with `yoloId`, including archived
- `activeDetectClassDefs(manifest)` — non-archived detect defs
- `activeClfClassDefs(manifest)` — clf defs (only active are in classKeys)
- `archivedClassDefs(manifest)` — all archived defs
- `validateNewClassName(name, existingActiveNames)` — empty + duplicate check
- `addDetectClassToManifest` / `addClfClassToManifest` — append + slug
- `renameClassInManifest` — name-only update, key stable
- `archiveDetectClassInManifest` / `unarchiveDetectClassInManifest`
- `archiveClfClassInManifest` / `unarchiveClfClassInManifest`
- `upgradeLegacyToManifest(legacyClasses)` — preserve order as detect YOLO IDs
- `manifestToLegacyClasses(manifest)` — ALL detect classes (inc. archived) for classes.txt

### Detect ID stability — guaranteed by

1. `addDetect*` only appends.
2. `archiveDetect*` keeps key in `tasks.detect.classKeys`.
3. `manifestToLegacyClasses` maps ALL `tasks.detect.classKeys` in order (including archived).
4. Tests: `manifestToLegacyClasses` of an archived manifest still returns archived class at correct id.

### Legacy upgrade path

When `classes.json` is absent:
- Hook loads `classes.txt` → `upgradeLegacyToManifest()` → `legacyMode = true`.
- Library panel shows "Legacy class format" notice.
- "Save as classes.json" button calls `upgradeLegacy()` → `persist()`.
- `classes.txt` is NOT removed (kept for Box Label and other tools).
- Class editing is read-only in legacy mode until upgrade.

### Intentionally deferred

- Drag-reorder with annotation migration (shifts IDs — requires label rewriting).
- Hard delete with full annotation reference scan.
- Class merge / split.
- Automatic relabeling on rename.
- Shared detect class panel across Box/Video Label.
- Starter class sets.

### Tests added (35 new, 505 total)

- append detect → existing IDs unchanged
- rename → key and ID unchanged
- archive detect → key stays in classKeys (ID reserved)
- unarchive detect → ID still at same position
- archive/unarchive clf
- `manifestToLegacyClasses` includes archived classes at correct id
- `upgradeLegacyToManifest` preserves order
- `validateNewClassName` rejects empty + case-insensitive duplicates
- display helpers (allDetect, active*, archived*)

---

## 6. Phase 4C - Active vs archived consumption

Archived classes are historical/read-only targets. They keep enough identity to
render and export existing annotations, but they are no longer offered for new
annotation decisions by default.

### Detect consumption rules

- Archived detect classes remain in `tasks.detect.classKeys` at their original
  YOLO numeric ID.
- `classes.txt` and `data.yaml` compatibility remains unchanged: detect names
  are written in full YOLO ID order, including archived slots.
- Box Label and Video Label keep the full class list for rendering existing
  boxes, so old annotations still show the archived class name.
- New class pickers, shortcut dropdowns, fixed-box recording, and Video Label
  detect buttons use active detect classes only.
- If the current selected historical box uses an archived class, the UI marks it
  as `archived` and blocks creation/relabeling/materialization into that class
  until the class is restored in Library.

### Classification consumption rules

- Active classification choices are derived from `tasks.clf.classKeys` and
  exclude `classDef.archived`.
- Existing video classification records can still display an archived
  `classKey` by looking it up in `classDefs`.
- New classification assignment is blocked for archived keys.

### Proposal and Auto Label policy

- Proposal materialization is blocked when the proposal references an archived
  detect class.
- Accept All materializes active-class proposals and leaves archived-class
  proposals in the sidecar for restore/reject handling.
- The pure Auto Label threshold helper can filter archived detect predictions
  before they become accepted boxes or materializable proposals; skipped
  archived predictions are counted separately.

### Helper additions

- Detect lookup/display: `findDetectClassById`, `findDetectClassByKey`,
  `isDetectClassArchivedById`, `isDetectClassArchived`,
  `detectClassDisplayName`.
- Active option helpers: `activeDetectClasses`,
  `detectClassOptionsForNewAnnotations`, `activeClassificationClasses`,
  `classificationOptionsForNewAnnotations`.
- Classification lookup/display: `findClassificationClassByKey`,
  `isClassificationClassArchived`, `classificationClassDisplayName`.
- Export compatibility: `exportDetectClassNamesPreservingIds`.

### Intentionally deferred

- Import classes from existing dataset (`classes.txt` / `data.yaml` to wizard).
- Export class config to a sharable JSON file.
- Cross-workspace class merging (for merge tool).
- Class merge/split.
- Hard delete with full annotation reference scanning.
- Drag reorder with annotation migration.
- Relabeling old annotations.
- Shared class-control extraction across Box/Video Label.
- Shared canvas unification.

---

## 7. File map

```
apps/desktop/src/
├── features/
│   ├── workspace/
│   │   ├── workspaceClassTaxonomy.ts       Phase 4A — view-model types + helpers
│   │   └── workspaceClassTaxonomy.test.ts  Phase 4A — tests
│   ├── home/
│   │   ├── CreateWorkspaceDialog.tsx       Phase 4A — expanded wizard
│   │   └── HomePage.tsx                    Phase 4A — write classes after creation
│   ├── library/
│   │   └── LibraryPage.tsx                 Phase 4A — functional classes panel
│   └── video/
│       └── classDomain.ts                  Pre-Phase 4A — ClassesManifest schema (unchanged)
└── workspace/
    └── workspaceManifest.ts                Pre-Phase 4A — paths.classes defined (unchanged)
```

---

## 8. Compatibility matrix

| Scenario | Behavior |
|---|---|
| Old workspace, no `classes.json` | Library falls back to `classes.txt`. Box Label unchanged. |
| Old workspace, no `classes.txt` | Library shows empty detect class list. |
| New workspace (Phase 4A) | Both `classes.txt` and `workspace/classes.json` written at creation. |
| Workspace with both files | Library reads `classes.json` (preferred). |
| Box Label (existing flow) | Reads `classes.txt` via `loadLabelClasses()` — unchanged. |
| Video Label (existing flow) | Reads `classes.txt` via `loadLabelClasses()` — unchanged. |
| Export planner | Uses `detectClassKeys` from `ClassesManifest` — unchanged. |
