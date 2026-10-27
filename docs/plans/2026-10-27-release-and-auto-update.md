# RampageWorkbench as an installed app with GitHub Release auto-update

Status: built and verified locally (2026-10-27); first public release waits for the Owner's go (repository visibility, Actions secrets). Local check: installer 0.1.1 → first-run bootstrap → backend from the per-user runtime (192 backend tests pass in that runtime) → update check reaches the endpoint → 0.1.2 installed over it (10.7 s to a healthy backend, engine re-synced, `.venv-mmpose`/`private`/`ui_maps`/runtime kept) → uninstall keeps user data. Not exercised locally: clicking Update and restart in the native window (first real release). Owner decisions: the product is renamed Silverbench and published from a new public repository `Rampageboo/Silverbench` with cleaned history (the old repository stays private: its pull requests keep old commits reachable); English-only UI; releases are built by GitHub Actions
(free for public repos, independent of which computer is used for development).

## Outcome

- A Windows installer (NSIS, per-user, no admin) from the repo's GitHub Release.
- The app checks for updates at start and in Settings; one click downloads,
  verifies the signature, installs and restarts.
- No source checkout, Node, Rust or Visual Studio on the run computer.
  `update.bat` stays only for development checkouts.
- Done = a tag `vX.Y.Z` produces a Release with the installer and
  `latest.json`; an installed older version updates itself to it; the app works
  (backend, gallery, YOLO, mocap) from the install folder alone.

## Decided

- **Heavy Python deps are installed on first run, not shipped.** CUDA torch is
  ~2.5 GB and a Release asset is capped at 2 GB; updates would also be huge.
  The installer carries a self-contained CPython 3.14 (python-build-standalone,
  same version as the tested dev venv), the backend code, the built engine and
  the frontend. First run creates `%LOCALAPPDATA%\RampageWorkbench\runtime\venv`
  from `packaging/requirements.lock.txt` (exact versions frozen from the tested
  dev venv; torch/torchvision from the PyTorch cu130 index) with a progress
  screen. Each start compares the lock's hash; a changed lock reinstalls.
- **Per-user state lives outside the install folder** (an update replaces it):
  runtime venv, logs, orchestrator `ui_maps`, and the AniMocap engine root.
- **AniMocap is synced to `%LOCALAPPDATA%\RampageWorkbench\animocap`** on each new
  app version (code files only). Its `.venv-mmpose` and `private/` (models,
  Maxine runtime) stay there across updates, so AniMocap's root-relative paths
  keep working unchanged. `RWB_ANIMOCAP_ROOT` points the backend at it.
- **Updater**: tauri-plugin-updater + NSIS `createUpdaterArtifacts`, minisign key.
  Private key + password are GitHub Actions secrets (the Owner keeps an offline
  copy; losing it means users must reinstall manually once). Endpoint:
  `releases/latest/download/latest.json` of `Rampageboo/Silverbench`.
- **Before installing an update the backend process tree is stopped** (uvicorn,
  resident engines, capture adapters), so no file is locked.
- App settings stay in `%APPDATA%\RampageWorkbench` (unchanged), so switching the
  run computer from `update.bat` to the installed app keeps its settings.

## Risks / open

- Unsigned installer: Windows SmartScreen warns on first install (code-signing
  certificate is a separate purchase decision).
- First run needs internet and ~4 GB; a failed install shows the pip log and a
  retry button.
- Making the repo public publishes its full history: scan for secrets first;
  the Owner confirms before visibility changes.

## Verify

- Local: stage + `tauri build` installer, install to a clean folder, first-run
  bootstrap, backend tests inside the runtime venv, mocap engine from the synced
  root, uninstall leaves user data.
- CI: tag build produces installer, `.sig`, `latest.json`; an installed previous
  version updates.
