# PROJECTCONTEXT.md — YoloWorkBench Living Project Context

Compact cross-session memory. Not authority above current Owner instructions,
the active brief, repository code, or verified tests (see
`docs/ai-workflow/project-context.md`).

## Metadata

```text
Last updated: 2026-07-30 (UI Orchestrator M5–M7: Temporal schema 2.0,
  authoring/replay/export, and cross-repository golden conformance)
Last verified branch: main
Last verified commit: (this commit — Temporal schema 2.0 authoring, replay,
  export, and cross-repository golden fixtures)
Updated by: Codex (Owner-direct, with key architecture and safety decisions
  jointly reviewed in one persistent ChatGPT Pro conversation)
Context confidence: Temporal Orchestrator verified with 47 focused frontend
  tests, production build, 10 backend store tests, and browser farm replay/export.

Git execution environments:
- Windows 11 workstation (c:\Users\jieyi\Desktop\YoloWorkBench) | Claude Code (VSCode extension) | claude-git — CONFIRMED this session (Claude owned commit+push; Codex ran zero git) | 2026-07-25
- Codex MCP (codex-user bridge, ChatGPT account) | connected + verified this session (thread created, effort high; Spark not available on this channel) | 2026-07-25
- Windows 11 / Codex desktop / local PowerShell (C:\Users\jieyi\Documents\Projects\YoloWorkBench) | codex-git | 2026-07-30
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
  modules. `API_SCHEMA_VERSION` (currently 24) must be bumped when `/health`
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

## UI Orchestrator track (planning)

New in-app tool to visually author game-UI maps + automation decision graphs for
the companion project **AutoHoyo** (.NET/WPF game automation). It is the
downstream authoring stage of this repo's pipeline (label → train → orchestrate),
so it lives here as a **distinct feature** in `apps/desktop` — not standalone and
not bolted into the labeling flow.

- **Reuses** (do not rebuild): box-label canvas, `features/overlays`, backend
  `detect_image_with_pt` / `classify_image_with_pt`, the workspace class taxonomy
  (`get_workspace_classes` / `classes.txt` / `data.yaml`) as the single source of
  CLF/DET class names, `atomic_write`, and the `path_access` / `image_safety` /
  `pt_safety` guards. Tool registration via `app/toolRegistry.tsx`.
- **Decisions (category B):** one declarative single-source-of-truth schema; the
  editor and AutoHoyo are two *interpreters* of the same graph, pinned by a shared
  golden suite (never two copies of the decision logic); the editor **previews
  intent only and never dispatches input**; geometry is relative-in-container
  (never absolute pixels); predictions come from the Python backend (no in-browser
  ONNX).
- **M0 DONE:** schema v1.0 locked → `docs/ui-orchestrator-schema-v1.md` (normative
  TS types + 20-rule validator checklist + a canonical coffee-errand example that
  doubles as the seed golden case). Overview: `docs/ui-orchestrator-plan.md`.
  Rationale / rejected alternatives: `docs/ui-orchestrator-decisions.md`.
- **M1–M4 DONE — feature complete on main.** All in `apps/desktop/src/features/ui-orchestrator/`
  plus backend. `API_SCHEMA_VERSION` 22→24. Full suite green except one
  pre-existing unrelated failure (see gotchas). Commits:
  - **M1 `d86e43b`** — editor MVP: `schema.ts` (v1.0 types + strict full 20-rule
    validator), `editorDomain.ts` (relative-geometry helpers), `UiOrchestratorPage.tsx`
    (load reference image, draw boxes, `relRect`, bind `detClass`/`phraseTable`,
    CLF trigger + guard, save/load, validate-before-export). Backend
    `loadUiMap`/`saveUiMap` in `backend/ui_orchestrator_store.py` (atomic write to
    `ui_maps/` root, `path_access` traversal fail-closed, version-major gate) in
    `BackendService._build_handlers()`.
  - **M2 `daf2e4c`** — model-assist: `runReferencePredictions` (guarded thin
    wrapper over `detect_image_with_pt`/`classify_image_with_pt`);
    `backend/ui_orchestrator_predictions.build_predictions` maps raw → schema-§12
    `Predictions` (normalized xywh → px xyxy; clf always present, empty =
    fail-closed). Editor Model-assist panel: pick detector/classifier `.pt`, run,
    overlay DET boxes + CLF readout, "Accept as element" (px→normalized ImageRect).
  - **M3 `3d8e4dc`** — Layer B: `previewInterpreter.ts` (pure graph interpreter,
    schema §5/§7/§8/§9, fail-closed; the AutoHoyo-shared conformance target),
    `FlowGraphPanel.tsx` (form-based node/edge editor; Act/Branch as validated
    JSON), Pages/Flow mode toggle, decision-preview overlay (intended box +
    crosshair). `DecisionResult` type added.
  - **M4 `4b8faed`** — `golden/coffee_errand/{map,cases}.json` (4 neutral cases) +
    `golden.test.ts` runner + `golden/README.md` (two-interpreter contract).
- **M5–M7 DONE (2026-07-30):** schema 2.0 defines the shared temporal contract:
  `FrameEvent | ActionResultEvent | TickEvent | AbortEvent`, typed
  Observe/Act/Branch/End nodes, stable DET/CLF evidence, correlation IDs,
  deadline-before-event semantics, graph-external abort, and direct causal
  evidence for terminal success. A strict validator rejects unknown fields and
  unsupported map majors.
- **Temporal authoring workbench:** `TemporalFlowPanel` provides coffee, farm,
  and contract templates, validated JSON authoring, visual graph inspection,
  deterministic event replay, and JSON export. Preview remains side-effect-free.
- **Canonical v2 conformance:** `golden/v2/coffee-completion.json`,
  `farm-single-run.json`, `temporal-contract.json`, and `cases.json` are the
  cross-runtime source of truth. The sibling AutoHoyo importer/interpreter loads
  these fixtures; coffee is bound DryRun-only and farm remains deliberately
  unbound/fail-closed.
- **Validation:** 7 frontend test files / 47 tests passed; production build
  passed; 10 backend store tests passed; browser QA replayed farm to Completed
  and exported the map with no console warnings or errors.
- **NEXT:** implement click/input/OCR and selector-child execution only after
  their target and input-safety contract is locked. Register `zzz.farm.run`
  explicitly before any farm map can become executable in AutoHoyo.
- **Open items (non-blocking):** OCR phrase-table storage location (only the
  reference form `ns/name@ver` is locked); OCR is not yet produced by the backend
  (predictions carry no `ocr` → OCR conditions remain unsupported for temporal
  execution); the detClass dropdown reads `getWorkspaceClasses` rather than
  box-label's `workspace/classes.json` manifest (refine if it matters). Neutral
  schema, AutoHoyo importer, node vocabulary, runtime capability separation,
  and cross-repository golden fixtures are resolved.

## Pending decisions / open questions

- Git execution mode is environment-specific. The 2026-07-25 Claude workstation
  remained `claude-git`; the current 2026-07-30 Codex desktop environment is
  independently verified `codex-git` and owns this commit/push.
- OCR phrase-table storage remains open. Neutral schema/importer choice, temporal
  node vocabulary, runtime capability preflight, and the shared golden contract
  are resolved by M5–M7.
- Farm execution remains intentionally unavailable until AutoHoyo registers a
  concrete `zzz.farm.run` binding and its success evidence/input safety are tested.
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
- After M1, the working tree still carries Owner's uncommitted doc/protocol
  edits (AGENTS.md, CLAUDE.md, PROJECTCONTEXT.md, `docs/**`) — these are NOT part
  of the M1 code commit and await the Owner's doc-commit timing.
- Codex MCP (codex-user bridge) gotcha: the `codex-reply` response channel can go
  silent and abort (~1800s idle timeout) while the run keeps executing and
  writing files server-side. On abort, do NOT assume failure — wait for the
  working tree to go quiet, then review the on-disk artifacts and validate
  directly (Claude owns review in claude-git regardless).
- Codex MCP `apply_patch` broke mid-session (2026-07-25): `codex-windows-sandbox-setup.exe
  … error=program not found` — Codex could no longer write ANY file. M2–M4 were
  therefore implemented directly by Claude (Owner said "push the whole thing"),
  not routed. If Codex file writes fail this way again, don't loop on it — Claude
  implements and reviews. (Repair path if wanted: reinstall/repair the Codex
  Windows sandbox helper.)
- `pytest` is not installed in `.venv` (only runtime deps are). Validate Python
  either by installing pytest or by exercising modules directly with the venv
  interpreter.
- Pre-existing failing frontend test unrelated to any current work:
  `apps/desktop/src/features/label/VideoBoxLabelSurface.test.ts`
  (`adjacentVideoMarkerTime is not a function` — the fn is exported; likely a
  circular-import/test-isolation issue). Fails in isolation; out of M1 scope.
