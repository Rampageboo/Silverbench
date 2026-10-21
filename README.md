# RampageWorkbench

Local desktop workbench for visual datasets, annotation, UI orchestration and a unified image gallery with NoobAI / Anima prompts and LoRA caption export.

- Repository: https://github.com/Rampageboo/RampageWorkbench
- Windows: double-click **RampageWorkbench.vbs** for silent startup, or run `run.bat` for diagnostics. `create-shortcut.vbs` creates the desktop shortcut.
- Desktop frontend: React + Tauri in `apps/desktop`; local API: Python FastAPI in `backend_api`.
- **图库与提示词 / Gallery** has a global backend independent of YOLO workspaces. It indexes image folders, reads generation metadata (ComfyUI workflows, A1111/Forge, NovelAI) and breaks it down; images without metadata go to a reverse queue for model tags and ComfyUI-made control maps.

Images stay local. Importing roots does not move or modify originals. App settings, the gallery database and cached previews live in this computer's app data (`%APPDATA%\RampageWorkbench`), never on a shared NAS. Existing files are not overwritten during export.

If the checkout is still named `YoloWorkBench`, Windows has kept the folder open in Codex/Claude/terminals. `Finish-RampageRename.vbs` starts a one-time 30-minute helper: save work and close those apps, then reopen `D:\Projects\RampageWorkbench` after the folder changes. The helper repairs existing Git worktree links and the desktop shortcut, and clears only this checkout's generated Tauri cache. It never terminates processes. State is recorded in `logs/rename-project-status.json`; the first desktop launch after relocation rebuilds the cache.

## Two computers

Development happens on one computer; the other only runs the app and pulls updates from GitHub.

- **Run-only computer:** close the app, double-click `update.bat`. It fast-forwards `main`, reinstalls Python or frontend packages only when the update changed them, and refuses to run over local edits (this computer does not commit).
- **Development computer, first time:** install Git, Python 3, Node.js and Rust; `git clone https://github.com/Rampageboo/RampageWorkbench.git D:\Projects\RampageWorkbench` (the same path keeps per-project AI memory aligned); run `run.bat` once to create `.venv` and `node_modules`. Then register the MCP server (see [MCP integration](docs/yoloworkbench-mcp.md)) and sync AI config with `sync.ps1` in `~/.ai-dotfiles`.
- **Per computer, never synced:** app settings and recent workspaces, the gallery library, the ComfyUI folder and address, model paths. Each computer browses its own in Settings. Workspaces (e.g. `D:\Yolo\ZZZ`) stay where they are; copy one over only if you need real data for testing.

## Compatibility

The product was previously named YoloWorkBench. Existing workspace and snapshot format identifiers, Tauri application identifier, storage keys, `YWB_*` environment variables and `yoloworkbench_mcp` Python import/launcher remain compatible so this rename does not reset workspace data or installed application preferences. Public product, window, launch and package names use RampageWorkbench.

See [desktop packaging](apps/desktop/PACKAGING.md), [gallery implementation scope](docs/plans/rampageworkbench-gallery.md) and [MCP integration](docs/yoloworkbench-mcp.md). Local inference is only reported as available after its requirements are satisfied; registering a path does not prove model quality or hardware acceptance.
