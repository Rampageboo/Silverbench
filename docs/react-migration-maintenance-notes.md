# React Migration Maintenance Notes

This project has moved the desktop workbench to native React tabs. The old `web/*.js` files may still be useful as historical reference, but the React desktop app should be treated as the current source of truth for active workbench behavior.

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
- Video Capture: open a video and preview one frame.
- Dataset Prep: load workspace info and run a harmless read-only action first.
- Auto Label: choose a model and confirm the job can start or reach the first validation error clearly.
- Batch Crop: choose input/output folders and start a small crop run.
- Dataset Merge: add one source and one target folder; confirm planning/export behavior.
- Mask Cleanup: open a photo and mask; generate preview.

Do not run full validation after every small code edit. Batch the changes, then validate once.

## P3 — Video preview request rate

`VideoCapturePage` requests preview frames from the backend when `previewTime` changes. This is fine for click/step seeking, but range sliders can emit many updates during dragging. Each request may require OpenCV to seek into a video and encode an image, which can be expensive for long videos or slow disks.

Future improvement:

- Debounce preview requests by roughly 150-250 ms.
- Track a request id and only display the newest response.
- Optionally request preview frames only on pointer release rather than every slider movement.

This does not block migration, but it is a likely source of sluggishness in heavy video workflows.

## P4 — Mask thumbnail cache and large folders

`MaskNoisePage` can load many thumbnails from backend image files. It currently limits the grid size, but the thumbnail object URLs can still remain in memory while the tab is kept alive.

Future improvement:

- Add pagination or virtual scrolling for large folders.
- Add an LRU cache for thumbnails, for example keeping only the most recent 100-200 thumbnails.
- Revoke object URLs when thumbnails are evicted from the cache.

This matters because the user now has large datasets. The old mask-noise use case was data expansion; the future use case is more likely to be a general mask-based image transform or batch cleanup tool.

## P6 — KeepAlive memory policy

The workbench keeps tab components mounted so their state is preserved when switching tabs. This is convenient, but it means memory-heavy state can remain alive even when the tab is not visible.

Examples of state that can stay alive:

- Video preview base64 strings.
- Video job logs and loaded video lists.
- Mask thumbnail object URLs.
- Large image lists.
- Canvas content.
- Merge source lists and logs.

Why this can make the app feel slower over time:

1. A tab loads images, video previews, thumbnails, or logs.
2. The user switches away from the tab.
3. Because the tab is kept alive, React does not unmount it.
4. Its state and cached browser resources stay in memory.
5. After using several heavy tabs, the app has more retained memory and more retained DOM/canvas/image resources.
6. The browser runtime and garbage collector have more work to do, so UI updates can become slower.

This is not exactly a memory leak if the state is intentionally retained, but the user experience can look similar: the app gradually feels heavier.

Future improvement:

- Keep light tabs alive.
- Consider disabling KeepAlive for heavy tabs such as Video Capture and Mask Cleanup.
- Or add a manual `Clear cache` / `Release memory` action inside heavy tabs.
- Or clear preview/thumbnail state when a tab becomes inactive.

Recommended policy:

- KeepAlive is good for editing tabs where preserving state matters.
- Avoid unlimited KeepAlive for tabs that load many images, canvases, base64 strings, or video previews.

## Deferred note — BackendMethod typing

Some feature API helpers cast dynamic backend method names to `BackendMethod`. This is acceptable for now and does not need to block the migration. A stricter future cleanup would add every backend RPC method to the `BackendMethod` union or replace the union with a generated method map.

## Deferred note — Legacy web files

Legacy `web/*.js` files can remain as reference material for now. They should not be treated as the active implementation for the desktop React workbench.

Future cleanup options:

- Add a clear `web/README_LEGACY.md` note.
- Move legacy files under a `legacy/` folder.
- Keep them until all React features have passed practical smoke tests.
- Delete only after there is confidence that no browser-mode fallback or historical behavior is still needed.

## Deferred note — Reusable UI components

Several migrated pages now repeat similar UI patterns:

- Folder picker rows.
- Status/log panels.
- Numeric fields.
- Job polling.
- Confirmation before destructive or long-running tasks.

This duplication is acceptable during migration. After the app stabilizes, extract shared components gradually rather than doing a large cleanup all at once.

Possible shared components:

- `FolderPickerRow`
- `LogPanel`
- `JobStatusPanel`
- `NumberField`
- `ConfirmRunButton`

## Practical priority order

1. Run one full build and smoke-test pass.
2. Fix actual build/runtime errors first.
3. Add video preview debounce if video seeking feels slow.
4. Add pagination/LRU cache if Mask Cleanup is used with large folders.
5. Review KeepAlive policy if the app feels heavier after switching across many tabs.
6. Leave legacy web files and reusable component cleanup as later refactors.
