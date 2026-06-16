# Long-Term Productization Roadmap

This document describes the next engineering layer after the React migration and the initial hardening roadmap. It assumes the following work has already been completed or is under control:

- Backend RPC contract objectification.
- Backend service modularization.
- Large-dataset performance hardening.
- Error handling standardization.
- Destructive action safety.
- Session/config persistence.
- Clear legacy boundary documentation.
- Shared UI/job component consolidation.

At that point, the app is no longer just a migrated desktop tool. The next goal is to make it feel like a stable dataset workbench product.

## Priority summary

| Priority | Area | Why it matters |
|---|---|---|
| P1 | Unified Job Manager | Centralizes long-running tasks, progress, cancel/retry, and output handling |
| P2 | Workspace manifest | Turns a folder collection into a formal project/workspace |
| P3 | Persistent thumbnail cache | Makes large image workflows much faster after the first scan |
| P4 | Dataset index database | Avoids repeatedly scanning 10k+ files from disk |
| P5 | Operation log + undo/recovery | Protects real datasets from accidental destructive operations |
| P6 | Tool/plugin registry | Makes adding or disabling tools cleaner |
| P7 | Packaging and update system | Moves the app from dev tool to usable desktop software |
| P8 | Structured logging | Makes debugging and support practical |
| P9 | Path authorization model | Reduces path-access errors and makes permissions understandable |
| P10 | Domain workflow/pipeline mode | Turns separate tools into an end-to-end dataset workflow |

---

## P1 — Unified Job Manager

### Problem

Several tools run long operations:

- Video Capture exports frames.
- Auto Label runs model inference.
- Batch Crop writes many images.
- Dataset Merge scans/copies many files.
- Mask Cleanup batch-exports transformed images.

If each tab owns its own job logic, the app will duplicate polling, progress display, cancellation, error reporting, and output-folder behavior.

### Desired direction

Create a shared job system with one consistent job shape:

```ts
type WorkbenchJob = {
  id: string;
  tool: string;
  title: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress?: {
    current: number;
    total: number;
  };
  currentFile?: string;
  outputRoot?: string;
  errors?: string[];
  startedAt: string;
  finishedAt?: string;
};
```

### UI direction

Add a global Job Center:

- Shows all current and recent jobs.
- Allows cancel/retry when supported.
- Opens output folders.
- Displays concise status by default.
- Keeps detailed JSON/logs behind an expandable panel.

### Rule

Feature pages can start jobs, but job lifecycle should be centralized.

---

## P2 — Workspace Manifest

### Problem

A workspace is currently mostly implied by folders and files. That works, but it makes versioning, settings, migration, and sharing less explicit.

### Desired direction

Add a formal workspace manifest, for example:

```json
{
  "version": 1,
  "type": "yolo-workbench",
  "name": "My Dataset Workspace",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z",
  "paths": {
    "imagePool": "image_pool",
    "datasets": "datasets",
    "exports": "exports",
    "cache": ".cache"
  },
  "tools": {
    "videoCapture": {},
    "autoLabel": {},
    "crop": {},
    "merge": {}
  }
}
```

### Benefits

- Clear workspace identity.
- Versioned settings.
- Easier migration between app versions.
- Safer project sharing/backups.
- Less reliance on guessing folder structure.

### Rule

The manifest should store project metadata and lightweight settings, not heavy caches or generated thumbnails.

---

## P3 — Persistent Thumbnail Cache

### Problem

Large image datasets are expensive to preview repeatedly. Runtime-only thumbnail caches help during one session, but the app may regenerate thumbnails every time it starts.

### Desired direction

Add a disk-backed cache:

```text
<workspace>/.cache/thumbs/
```

Cache keys should include:

- Source file absolute or workspace-relative path.
- File size.
- File mtime.
- Requested thumbnail size.
- Output quality/format.

If any of these change, generate a new thumbnail.

### Benefits

- Much faster second load.
- Lower repeated CPU usage.
- Better user experience on 10k+ images.

### Rule

Never treat cached thumbnails as source data. They are disposable and can be rebuilt.

---

## P4 — Dataset Index Database

### Problem

Scanning the filesystem repeatedly becomes slow as datasets grow. For 10k+ images, file listing, metadata reading, image size extraction, label lookup, and duplicate checks can become bottlenecks.

### Desired direction

Add a local SQLite index per workspace:

```text
<workspace>/.cache/workbench-index.sqlite
```

Possible tables:

```text
files
  id
  path
  kind
  size
  mtime
  hash
  width
  height
  label_path
  class_name
  split
  last_seen_at

labels
  file_id
  label_path
  label_type
  object_count
  updated_at

thumbnails
  file_id
  thumb_path
  thumb_size
  source_mtime
  source_size
```

### Benefits

- Faster Image Pool and Dataset Review.
- Faster merge planning.
- Faster duplicate detection.
- Easier filtering by class/split/label status.
- Better foundation for analytics.

### Rule

The database is an index, not the source of truth. If it is deleted, the app should rebuild it from files.

---

## P5 — Operation Log and Undo/Recovery

### Problem

The app can modify real datasets. Without operation records, recovery from accidental delete/move/overwrite is difficult.

### Desired direction

Before destructive or large operations, write an operation manifest:

```json
{
  "operationId": "...",
  "tool": "dataset-merge",
  "startedAt": "...",
  "action": "copy-files",
  "items": [
    {
      "source": "...",
      "target": "...",
      "action": "copy",
      "status": "done"
    }
  ],
  "summary": {
    "created": 120,
    "skipped": 3,
    "failed": 1
  }
}
```

Store logs under:

```text
<workspace>/workspace/logs/operations/
```

### Possible recovery levels

1. **Audit only** — show exactly what changed.
2. **Manual recovery** — user can inspect source/target paths.
3. **App-assisted undo** — app reverses copy/move/delete when safe.
4. **Backup-backed undo** — app restores from backups for destructive operations.

### Rule

Do not promise undo unless the app has enough data to guarantee it. Start with audit logs first.

---

## P6 — Tool / Plugin Registry

### Problem

Workbench tools are currently wired manually through imports, navigation, and panels. As tools grow, this becomes harder to maintain.

### Desired direction

Create a typed tool registry:

```ts
type WorkbenchToolDefinition = {
  tab: ToolTab;
  label: string;
  labelZh?: string;
  keywords: string;
  component: React.ComponentType<ToolPageProps>;
  keepAlive?: boolean;
  heavy?: boolean;
  requiresWorkspace?: boolean;
};
```

Then WorkbenchBody can render tools from the registry rather than hardcoding every panel.

### Benefits

- Easier to add new tools.
- Easier to disable experimental tools.
- KeepAlive policy lives beside the tool definition.
- Navigation and panels share one source of truth.

### Rule

Do this after the current shell is stable. Premature plugin abstraction can make debugging harder.

---

## P7 — Packaging and Update System

### Problem

Running from source is acceptable during development, but it is not ideal for regular use.

### Desired direction

Add a release workflow for Windows desktop usage:

- Version number.
- Installer or portable build.
- Release notes.
- Settings migration.
- Optional auto-update later.

### Minimum useful target

```text
YoloWorkBench-vX.Y.Z-windows-portable.zip
```

or a Windows installer if preferred.

### Rule

Do not add auto-update before versioning and release artifacts are stable.

---

## P8 — Structured Logging

### Problem

Toast messages and JSON panels are useful during development, but they are not enough for diagnosing real user issues.

### Desired direction

Write structured logs to disk:

```text
<workspace>/workspace/logs/app.log
<workspace>/workspace/logs/backend.log
<workspace>/workspace/logs/jobs/<job-id>.json
```

Logs should include:

- Timestamp.
- Tool name.
- Operation/job id.
- Input/output paths.
- Error type.
- Error message.
- Optional stack trace for developer debugging.

### UI rule

The UI should show short, human-readable status. Detailed logs should be available through “Show details” or “Open log”.

---

## P9 — Path Authorization Model

### Problem

The app handles workspace files, external videos, external model files, and output folders. Path-access failures can be confusing if users do not know which folders are currently authorized.

### Desired direction

Create an explicit authorized path model:

```json
{
  "workspaceRoot": "...",
  "authorizedInputRoots": ["..."],
  "authorizedOutputRoots": ["..."],
  "authorizedModelRoots": ["..."]
}
```

### Benefits

- Fewer confusing `Path not allowed` errors.
- Clearer security boundary.
- Easier to explain why a path was rejected.
- Better support for external video/model workflows.

### UI direction

Add a small Settings or Workspace panel showing:

- Current workspace.
- Authorized input folders.
- Authorized output folders.
- Authorized model folders.
- Buttons to add/remove authorization.

---

## P10 — Domain Workflow / Pipeline Mode

### Problem

The app currently behaves like a toolbox: each tab is useful, but workflows are still user-managed.

### Desired direction

Add a pipeline view for common dataset workflows:

```text
Import images
  ↓
Clean / crop / merge
  ↓
Label / review
  ↓
Auto label
  ↓
Train prep
  ↓
Export dataset
```

### Benefits

- Better guidance for repeated workflows.
- Easier onboarding.
- Less manual switching between tabs.
- More coherent product identity.

### Rule

Do not remove the toolbox tabs. Add pipeline mode as a guided layer above them.

---

## Suggested long-term implementation order

### Phase A — Workbench operations foundation

1. Unified Job Manager.
2. Structured job logs.
3. Operation audit logs.
4. Safer destructive action integration.

### Phase B — Workspace foundation

1. Workspace manifest.
2. Path authorization model.
3. Session/config migration into manifest-aware storage.

### Phase C — Large dataset foundation

1. Persistent thumbnail cache.
2. SQLite dataset index.
3. Incremental folder scans.
4. Virtualized large lists where needed.

### Phase D — Product shell

1. Tool/plugin registry.
2. Pipeline/workflow mode.
3. Release packaging.
4. Optional auto-update.

## Final product target

The final product should feel less like a set of scripts and more like this:

```text
Workspace manifest
  ↓
Authorized paths + indexed dataset
  ↓
React tool registry + pipeline shell
  ↓
Unified job manager
  ↓
Safe file operations with logs/recovery
  ↓
Packaged desktop release
```

This is a long-term roadmap. Each item should be implemented only when the current app is already stable in daily use.
