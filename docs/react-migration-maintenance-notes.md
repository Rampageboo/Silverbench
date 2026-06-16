# React Migration Maintenance Notes

This project has moved the desktop workbench to native React tabs. The old `legacy/web/*.js` files may still be useful as historical reference, but the React desktop app should be treated as the current source of truth for active workbench behavior.

## Current scope

All primary workbench tabs are now wired through React pages in `apps/desktop/src/features/*` and mounted from `apps/desktop/src/app/WorkbenchBody.tsx`.

Current native areas:

- Image Pool
- Box Label
- Video Capture
- Dataset Prep
- Auto Label
- Batch Crop
- Dataset Merge
- Mask Cleanup

## P1 — Build and smoke-test after migration

Run a single validation pass after a coherent batch of changes rather than validating after every small edit.

Recommended command:

```bash
cd apps/desktop
npm run build
npm run tauri:dev
```

Minimum smoke test:

- Image Pool: open a workspace and scan images.
- Box Label: open an image and confirm labels can load/save.
- Video Capture: open a video and preview one frame; drag the scrubber and confirm preview requests are throttled.
- Dataset Prep: load workspace info and run a harmless read-only action first.
- Auto Label: choose a model and confirm the job can start or reach the first validation error clearly.
- Batch Crop: choose input/output folders and start a small crop run.
- Dataset Merge: add one source and one target folder; confirm planning/export behavior.
- Mask Cleanup: open a photo and mask; generate preview.

Do not run full validation after every small code edit. Batch the changes, then validate once.

## P3 — Video preview request rate (done)

`VideoCapturePage` debounces backend preview requests (~200 ms while dragging the scrubber), tracks a request id to ignore stale responses, and flushes immediately on pointer release. Tab deactivation clears the preview base64 string to release memory while keeping video lists and capture jobs alive.

## P4 — Mask thumbnail cache (done)

`MaskNoisePage` uses `useLruObjectUrlCache` (capacity 150) so object URLs are revoked when evicted. The grid still caps display at 500 items (`GRID_LIMIT`). Full pagination/virtual scroll remains a future option for very large folders.

## P6 — KeepAlive memory policy (done)

| Tab | Policy |
|-----|--------|
| Mask Cleanup | `persist={false}` — unmount when inactive |
| Video Capture | KeepAlive + clear preview on inactive |
| Other tabs | KeepAlive (preserve editing state) |

## BackendMethod typing (done)

Feature API helpers (`videoCaptureApi`, `autoLabelApi`, `trainPrepApi`, `cropApi`) use `rpc(method: BackendMethod, …)` so every desktop RPC name is checked at compile time. When adding a new backend handler in `backend/service.py`, add the same string to the `BackendMethod` union in `apps/desktop/src/api.ts`.

## Legacy web files

Legacy web assets live under `legacy/web/`. The React desktop shell imports only `legacy/web/styles.css`; full `legacy/web` remains for `tauri:dev:legacy`, Qt, and standalone server flows.

## Reusable UI components (done for tool tabs)

Shared thin wrappers live in `apps/desktop/src/components/workbench/`:

- `LogPanel` — log/status text areas
- `JobStatusPanel` — progress + status (Video, Auto Label)
- `FolderPickerRow` — path input + browse button (Auto Label, Merge)
- `NumberField` — labeled number inputs (Auto Label)
- `useRunWithConfirm` — replaces `window.confirm` on tool pages

Migrated pages: Video Capture, Auto Label, Batch Crop, Dataset Merge, Dataset Prep, Mask Cleanup.

Image Pool / Box Label / Dataset Review were left unchanged (already have richer dedicated UI).

## Practical priority order

1. Run one full build and smoke-test pass after changes.
2. Fix actual build/runtime errors first.
3. Add pagination/virtual scroll if Mask Cleanup is used with folders much larger than 500 images.
4. Review KeepAlive policy further if other heavy tabs need `persist={false}`.
5. Extract more shared components gradually as new tool pages are added.
