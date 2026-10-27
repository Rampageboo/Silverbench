# RampageWorkbench

Local desktop workbench for visual datasets, annotation, UI orchestration and a unified image gallery with NoobAI / Anima prompts and LoRA caption export.

- Repository: https://github.com/Rampageboo/RampageWorkbench
- Windows: double-click **RampageWorkbench.vbs** for silent startup, or run `run.bat` for diagnostics. `create-shortcut.vbs` creates the desktop shortcut.
- Desktop frontend: React + Tauri in `apps/desktop`; local API: Python FastAPI in `backend_api`.
- **图库与提示词 / Gallery** has a global backend independent of YOLO workspaces. It indexes image folders, reads generation metadata (ComfyUI workflows, A1111/Forge, NovelAI) and breaks it down; images without metadata go to a reverse queue for model tags and ComfyUI-made control maps.

Images stay local. Importing roots does not move or modify originals. App settings, the gallery database and cached previews live in this computer's app data (`%APPDATA%\RampageWorkbench`), never on a shared NAS. Existing files are not overwritten during export.

If the checkout is still named `YoloWorkBench`, Windows has kept the folder open in Codex/Claude/terminals. `Finish-RampageRename.vbs` starts a one-time 30-minute helper: save work and close those apps, then reopen `D:\Projects\RampageWorkbench` after the folder changes. The helper repairs existing Git worktree links and the desktop shortcut, and clears only this checkout's generated Tauri cache. It never terminates processes. State is recorded in `logs/rename-project-status.json`; the first desktop launch after relocation rebuilds the cache.

## Install and updates

- **Install:** download `RampageWorkbench_<version>_x64-setup.exe` from the [latest Release](https://github.com/Rampageboo/RampageWorkbench/releases/latest) and run it (per user, no admin). Windows SmartScreen may warn because the installer is not code-signed: *More info → Run anyway*.
- **First start** prepares the Python runtime (about 4 GB: CUDA PyTorch and the rest, exact versions in `packaging/requirements.lock.txt`), with progress on the start screen. Later starts take seconds; a release that changes the lock reinstalls only then.
- **Updates:** the app checks GitHub at start and every six hours, and in *Settings → About & updates*. *Update and restart* downloads the signed installer, verifies it, stops the backend, installs and restarts. A failed download or install leaves the current version running.
- **Per-user data** (survives updates and uninstall): `%APPDATA%\RampageWorkbench` (settings, gallery), `%LOCALAPPDATA%\RampageWorkbench` (runtime venv, logs, motion-capture engine with its `.venv-mmpose` and models). Workspaces stay wherever they are.
- **Publishing a version** (development computer): write `docs/releases/v<version>.md`, then `scriptselease.ps1 -Version <version>`. GitHub Actions builds, signs and publishes; see [the plan](docs/plans/2026-10-27-release-and-auto-update.md). The updater's signing key is the repository secret `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`); keep the offline copy from `%USERPROFILE%\.tauri` safe — without it installed apps cannot accept new updates.

## Two computers

Development happens on one computer; the other runs the installed app and updates itself from the Release.

- **Run-only computer:** install from the Release (above). `update.bat` remains for a source checkout: it fast-forwards `main`, reinstalls Python or frontend packages only when the update changed them, rebuilds the app (`tauri build --no-bundle`) when the desktop app changed, and refuses to run over local edits.
- **Development computer:** use `run.bat` (development mode with hot reload). A built app there would be whatever was last built, so do not rely on the shortcut while developing.
- **Development computer, first time:** install Git, Python 3, Node.js and Rust; `git clone https://github.com/Rampageboo/RampageWorkbench.git D:\Projects\RampageWorkbench` (the same path keeps per-project AI memory aligned); run `run.bat` once to create `.venv` and `node_modules`. Then register the MCP server (see [MCP integration](docs/yoloworkbench-mcp.md)) and sync AI config with `sync.ps1` in `~/.ai-dotfiles`.
- **Per computer, never synced:** app settings and recent workspaces, the gallery library, the ComfyUI folder and address, model paths. Each computer browses its own in Settings. Workspaces (e.g. `D:\Yolo\ZZZ`) stay where they are; copy one over only if you need real data for testing.

## Compatibility

The product was previously named YoloWorkBench. Existing workspace and snapshot format identifiers, Tauri application identifier, storage keys, `YWB_*` environment variables and `yoloworkbench_mcp` Python import/launcher remain compatible so this rename does not reset workspace data or installed application preferences. Public product, window, launch and package names use RampageWorkbench.

See [desktop packaging](apps/desktop/PACKAGING.md), [gallery implementation scope](docs/plans/rampageworkbench-gallery.md) and [MCP integration](docs/yoloworkbench-mcp.md). Local inference is only reported as available after its requirements are satisfied; registering a path does not prove model quality or hardware acceptance.
