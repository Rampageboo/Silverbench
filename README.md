# RampageWorkbench

Local desktop workbench for visual datasets, annotation, UI orchestration and a unified image gallery with NoobAI / Anima prompts and LoRA caption export.

- Repository: https://github.com/Rampageboo/RampageWorkbench
- Windows: double-click **RampageWorkbench.vbs** for silent startup, or run `run.bat` for diagnostics. `create-shortcut.vbs` creates the desktop shortcut.
- Desktop frontend: React + Tauri in `apps/desktop`; local API: Python FastAPI in `backend_api`.
- **图库与提示词 / Gallery** has a global backend independent of YOLO workspaces. The typed frontend client and [Claude frontend handoff](docs/plans/rampageworkbench-frontend-handoff.md) describe how to connect image roots, metadata, organization, prompt review and export. Its interface design is delegated to Claude; a gallery page is not included yet.

Images stay local. Importing roots does not move or modify originals. Gallery database and cached previews are stored on local disk under `Sessions/gallery`, never directly on a shared NAS. Existing files are not overwritten during export.

If the checkout is still named `YoloWorkBench`, Windows has kept the folder open in Codex/Claude/terminals. `Finish-RampageRename.vbs` starts a one-time 30-minute helper: save work and close those apps, then reopen `D:\Projects\RampageWorkbench` after the folder changes. The helper repairs existing Git worktree links and the desktop shortcut, and clears only this checkout's generated Tauri cache. It never terminates processes. State is recorded in `logs/rename-project-status.json`; the first desktop launch after relocation rebuilds the cache.

## Compatibility

The product was previously named YoloWorkBench. Existing workspace and snapshot format identifiers, Tauri application identifier, storage keys, `YWB_*` environment variables and `yoloworkbench_mcp` Python import/launcher remain compatible so this rename does not reset workspace data or installed application preferences. Public product, window, launch and package names use RampageWorkbench.

See [desktop packaging](apps/desktop/PACKAGING.md), [gallery implementation scope](docs/plans/rampageworkbench-gallery.md) and [MCP integration](docs/yoloworkbench-mcp.md). Local inference is only reported as available after its requirements are satisfied; registering a path does not prove model quality or hardware acceptance.
