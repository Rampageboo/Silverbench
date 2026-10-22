# Decisions

These decisions summarize reviewed Codex chats as of 2026-10-03. Historical decisions are labeled in their consequences; verify current code before treating them as runtime acceptance.

## Keep runtime Sessions/cache out of Git.

- **Decision:** Keep runtime Sessions/cache out of Git.
- **Reason:** Thousands of generated cache files had been tracked.
- **Consequences:** Ignore and remove them from the index; historical cleanup is separate.

## Serialize workspace session updates.

- **Decision:** Serialize workspace session updates.
- **Reason:** Multiple read/merge/write paths could overwrite shortcut values.
- **Consequences:** Queue writes and load Pool Label data before updating.

## Back up source images before any edit that writes them back.

- **Decision:** Back up source images before any edit that writes them back.
- **Reason:** Protection previously covered only some modes.
- **Consequences:** Apply the same guard to black-frame and crop operations; prior damage cannot be inferred back.

## Treat Tauri as the current default entrypoint and mark the old PySide6 run.bat as superseded.

- **Decision:** Treat Tauri as the current default entrypoint and mark the old PySide6 run.bat as superseded.
- **Reason:** The product migrated beyond the earlier launch path.
- **Consequences:** Keep old startup notes historical.

## Workspaces use the v3 layout; the app opens only v3.

- **Decision:** One workspace root with `rwb.json`, `classes.json`, `media/`, `labels/` (the only annotation truth), `models/`, `runs/`, `exports/`, `backups/originals/`, `versions/` and machine-local `.rwb/`. Older layouts are migrated (reversibly, by renames), never read side by side.
- **Reason:** Datasets were live hard-linked folders, classes had four sources, versions were full copies and files were named by hashes of absolute paths.
- **Consequences:** See `docs/plans/storage-format-v3.md`. `D:\Yolo\ZZZ` was migrated on 2026-10-21. Annotation files are named after their media file; videos are stored workspace-relative.

## YOLO datasets are exported, not kept in the workspace.

- **Decision:** "Export dataset" writes `exports/dataset/{detect,classify}` from labels, status and `classes.json`, copying images by default and decoding annotated video timestamps into frames.
- **Reason:** Hard-linked datasets let edits leak between the export and `media/` and needed link bookkeeping on every status change.
- **Consequences:** Junk/export toggles only change `labels/images.csv`; `data.yaml` omits `path:` so Ultralytics resolves against the yaml folder.

## Per-computer state lives in app data; development happens on one computer.

- **Decision:** App settings, recent workspaces, the gallery library, ComfyUI folder/address and model paths live in `%APPDATA%\RampageWorkbench` per computer. Development moved to the other computer on 2026-10-22; the original computer only runs `update.bat`.
- **Reason:** Paths differ between the two computers; the run-only computer must never diverge from `main`.
- **Consequences:** Nothing machine-specific is committed. The MCP server is registered at user level on each computer (`docs/yoloworkbench-mcp.md`).

## Gallery: metadata first, then reverse inference through local tools.

- **Decision:** Generation metadata is read and broken down first (ComfyUI graphs, A1111/Forge fields). Only images without it enter the reverse queue: WD tags (local tagger) and control maps made by the user's ComfyUI preprocessors.
- **Reason:** Metadata is exact; model output is an approximation. RampageWorkbench should not bundle pose/depth models that ComfyUI already has.
- **Consequences:** Control maps need a reachable ComfyUI with `comfyui_controlnet_aux`; ControlNet reference images are found only through the configured ComfyUI input folder.

## Motion capture: AniMocap is an engine inside RWB, with RWB as its only UI.

- **Decision:** Bring AniMocap Fusion in as `engines/animocap/` (git subtree, history kept) at upstream `main` `50549a85` (= tag `archive-2026-10-23`). Delete its Win32 Studio (`gui_main.cpp`, launchers, UI assets); RWB's 动捕 page is the front end and drives the engine through the CLI contract in `docs/animocap-engine.md`.
- **Reason:** One app and one repository on both computers. `50549a85` is the newest validated state (Release build, C++ tests, Python tests). The local-only branch `codex/multiview-architecture` (in the archive bundle) is blocked R&D that its own index marks unaccepted, and it conflicts with `main`'s later multiview changes.
- **Consequences:** Algorithms stay in C++; RWB adds none. Engine changes are made in this repository; later upstream commits, if any, come in with `git subtree pull --prefix=engines/animocap`. The original Studio stays reachable at the tag for comparison runs. Real-video quality is not certified by the upstream archive and must be checked on the target GPU.
