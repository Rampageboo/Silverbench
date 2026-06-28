# Workspace Class Taxonomy Plan

## Status: Phase 4A complete

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

## 5. Phase 4B plan (not started)

- Wire `workspace/classes.json` as the authoritative class source for both BoxLabelPage and VideoLabelPage.
- Replace `loadLabelClasses()` call in `useVideoAnnotationSession` with `readTextFile(root, "workspace/classes.json")`.
- Add a class editor in Library: safe add-at-end for detect classes, full edit for CLF classes.
- Keep `classes.txt` in sync automatically when detect classes change.
- Show actual task type in the Label Workbench header (from `workspace/classes.json`).
- Starter class sets for common use cases.

---

## 6. Phase 4C — deferred

- Import classes from existing dataset (`classes.txt` / `data.yaml` → wizard).
- Export class config to a sharable JSON file.
- Cross-workspace class merging (for merge tool).

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
