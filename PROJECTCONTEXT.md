# PROJECTCONTEXT.md — YoloWorkBench Living Project Context

Compact cross-session memory. Not authority above current Owner instructions,
the active brief, repository code, or verified tests (see
`docs/ai-workflow/project-context.md`).

## Metadata

```text
Last updated: 2026-07-12
Last verified branch: main
Last verified commit: 21d01a18233ccad5711719d8665c2adbb9958e2b
Updated by: Claude (bootstrap survey, no Codex — Owner deferred Codex onboarding)
Context confidence: partially stale — created from Claude's own repo survey,
  not a Codex Context Packet; deep module behavior unverified.

Git execution environments:
- Windows 11 workstation (d:\YoloWorkBench) | Claude Code (VSCode extension) | mode NOT YET DECIDED — treat as claude-git until Owner/Claude confirms | 2026-07-12
- Codex MCP | not connected yet | unverified | —
```

## Project summary

YoloWorkBench is a local-first desktop workbench for YOLO computer-vision
dataset work: image/video import, labeling (detection boxes + classification),
auto-labeling with PT models, dataset prep/merge/export, and training runs.

- **Frontend**: React + TypeScript + Vite inside a Tauri desktop shell
  (`apps/desktop`). All tools are native React; no iframe embeds. Legacy Qt
  shell exists (`run_legacy_qt.bat`) but Qt is not used in the main path.
- **Backend**: Python FastAPI + uvicorn (`backend_api/main.py`, ~940 lines),
  localhost-only, JSON-RPC-style `/api/call` dispatch into `backend/` service
  modules. `API_SCHEMA_VERSION` (currently 22) must be bumped when `/health`
  or `/api/call` routing changes so dev startup restarts stale backends.
- **ML runtime**: torch/torchvision + ultralytics (installed `--no-deps` by
  `run.bat` so it never replaces pinned torch/cv2).

## Module map

- `backend/` — domain logic: image pool (+backup/cleanup), media import,
  video screenshot/proxy, YOLO workspace/prep/classifier/detector/tracker,
  PT model cache/info/safety, dataset merge, blackout renderer, metadata
  assignment, workspace snapshot versions, job store, atomic writes,
  path-access and image/pt safety guards.
- `backend_api/` — FastAPI entrypoint (`main.py`), desktop dialogs bridge,
  training runner, multimodal entrypoint.
- `apps/desktop/src/` — React app: `app/`, `features/`, `workbench/`,
  `workspace/`, `components/`, `hooks/`, `lib/`, `api.ts`.
- `apps/desktop/src-tauri/` — Tauri (Rust) shell; legacy full-web config
  available via `tauri:dev:legacy`.
- `tests/` — Python tests (pytest-style, `test_*.py`) covering safety,
  pool/snapshot, media import, PT jobs, tracker, workspace session; plus
  Playwright `smoke.spec.js` (`playwright.config.js` at root).
- `docs/` — plans and roadmaps (video-first architecture, UI/IA redesign,
  unified label workbench, workspace class taxonomy, snapshot versioning,
  productization/engineering roadmaps).
- `docs/ai-workflow/` + `AGENTS.md` + `CLAUDE.md` — collaboration protocol
  (untracked as of this bootstrap; not yet committed).
- Data dirs at repo root: `image_pool/`, `image_pool_backup/`, `clf_dataset/`,
  `detect_dataset/`, `detect_labels/`, `auto_label/`, `runs/`, `logs/`.

## Build / run / validate

- Full dev launch: `run.bat` (creates `.venv`, installs `requirements.txt` +
  `ultralytics --no-deps`, then `npm run tauri:dev` in `apps/desktop`).
  Silent launch: `YoloWorkBench.vbs`. Logs: `logs/desktop.log`,
  `logs/backend.log`.
- Frontend: `npm run dev` (Vite on 127.0.0.1:5173), `npm run build`
  (tsc + vite), `npm run test` (vitest), `npm run lint`, `npm run format`.
- Backend-only dev: `npm run backend:dev` (starts backend and waits).
- Python tests: run pytest in `.venv` against `tests/`.

## Current state

- Recent work (through 2026-07-05): video-first labeling — native video
  preview with responsive fallback playback, video proxy transcoding with
  per-file locks, async PT image jobs, then a security-hardening pass
  (image size limits, PT file safety, file-operation guards).
- AI-collaboration protocol files (`AGENTS.md`, `CLAUDE.md`,
  `docs/ai-workflow/`, `agent-workflows/`) added but **not yet committed**.
- Codex MCP is configured in the environment but Owner has deferred
  onboarding; no Codex thread exists yet.

## Pending decisions / open questions

- Git execution mode for this workstation (claude-git vs codex-git) —
  category B, to be fixed when Codex onboards; default assumption claude-git.
- Whether/when to commit the untracked protocol files and `PROJECTCONTEXT.md`
  — Owner call on timing.
- `PROJECTCONTEXT_TEMPLATE.md` referenced by the project-context module does
  not exist in the repo; this file was authored from the module's spec
  instead. Create the template or drop the reference.

## Active gotchas

- `ultralytics` must stay installed with `--no-deps`; letting it pull its own
  deps can replace the pinned torch/cv2 (`run.bat` comment).
- Bump `API_SCHEMA_VERSION` in `backend_api/main.py` whenever `/health` or
  `/api/call` routing changes, or dev startup will keep a stale backend.
- Backend is localhost-only by design; safety guards (`path_access`,
  `image_safety`, `pt_safety`) are load-bearing after the 21d01a18 hardening
  pass — do not bypass them in new endpoints.
- Working tree contains only the untracked protocol files; tracked files are
  clean as of 2026-07-12.
