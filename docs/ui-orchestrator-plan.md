# UI Orchestrator — Development Plan

A new tool inside YoloWorkBench for **visually authoring game‑UI maps and
automation decision graphs**, and previewing the full decision chain against
real model predictions — without ever dispatching input.

> Status: plan / spec. Not yet implemented. Personal single‑user tool; the
> consumer of its output is the companion project **AutoHoyo** (a .NET/WPF
> game‑automation app). This document is the brief a builder (you + Codex)
> works from.

---

## 1. Why this exists

AutoHoyo automates game routines by (a) classifying which screen it is on
(CLF), (b) detecting UI elements on that screen (DET), (c) reading text (OCR),
then (d) deciding an intended action. Today that page→element→decision knowledge
is expressed three ways at once — a distilled `ui_map` JSON, hand‑tuned geometry
constants in C#, and hardcoded CLF/DET wiring in the detector — which is three
sources of truth for the same facts.

The goal here is one authoring surface that produces **one declarative source
of truth**: a schema describing, per screen, which CLF label routes to it, which
DET/OCR bindings identify its elements, the elements' relative geometry, and a
**decision graph / state machine** stitching screens into a flow. AutoHoyo then
*interprets* that data at runtime instead of hardcoding it.

Crucially, this is only viable because YoloWorkBench already owns the CLF/DET
class taxonomy and can already run the models. The UI Orchestrator is the
**downstream authoring stage** of the existing pipeline (label → train →
**orchestrate**), so it belongs in the same app, reusing the same foundation.

### Design principles (carried from the design discussion)

1. **Declarative single source of truth.** The decision tree / state machine is
   *data*, not code. The editor and AutoHoyo are two *interpreters* of the same
   graph — never two copies of the decision logic.
2. **Relative geometry only.** Element positions are stored as ratios inside a
   runtime‑located container, never absolute pixels. Absolute screen coordinates
   are resolved at runtime by AutoHoyo, not baked here. This sidesteps the
   design‑space‑vs‑runtime‑DPI problem entirely.
3. **The editor previews intent; it never acts.** No input dispatch, no game
   process, no `IInputController` equivalent. It renders "here is the decision
   and the intended click point." Whether/how that ever becomes a real click is
   100% AutoHoyo's typed, gated, arming‑guarded concern.
4. **Predictions come from one place.** Model inference stays in YoloWorkBench's
   Python backend (the same code that trains/auto‑labels). The editor consumes
   predictions; it does not re‑implement preprocessing/inference.
5. **Two interpreters are pinned by a shared golden suite.** A versioned set of
   `(graph + inputs → expected decision)` cases that both the editor's preview
   interpreter and AutoHoyo's executor must pass. This is what prevents drift.

### Personal‑use simplifications (explicit non‑goals)

- No auth, no multi‑user, no sharing/collaboration, no cloud. Local‑first, in
  keeping with YoloWorkBench's localhost‑only backend.
- No productization polish; pragmatic over pretty. YAGNI on anything not needed
  to author + preview + export a map for AutoHoyo.
- Not a general "any app" UI tool. First‑class target is Zenless Zone Zero
  screens for AutoHoyo; the schema stays game‑namespaced so other games are
  possible later, but no effort is spent generalizing beyond what ZZZ needs.

---

## 2. Core concepts / mental model

Two layers, kept separate:

**A. Page definitions — "what a screen is and where its elements are."**
Keyed by an id (e.g. `Schedule.Errands`). Each page has:
- a **CLF trigger**: the classifier label(s) + min confidence that mean "you are
  on this screen." This is the router key.
- a **fail‑closed guard**: DET elements that *must* be present once routed here;
  if absent → the page does not hold → `uncertain`, never a guessed action.
- **elements**: named, each bound to a DET class and/or an OCR phrase table,
  with container‑relative geometry and (for buttons associated to a container
  like a card) an association rule.

**B. Flow graph — "what to do across screens" (the state machine / decision
tree).** Nodes reference pages/elements; edges are transitions and conditions.
This is the layer the "decision tree / state machine" idea lives in. Node kinds
deliberately mirror AutoHoyo's existing script domain vocabulary (see §7):
- `Start` / `End`
- `Observe` — wait until CLF reports a given page/state (with timeout).
- `Act` — express intent to click/interact with a named element of the current
  page. (Intent only; execution is AutoHoyo's.)
- `Branch` — tri‑state condition on a vision signal → `True` / `False` /
  `Indeterminate` edges. Low‑confidence vision is **never** silently `False`.
- `Wait` — bounded delay.

Runtime split (who owns what):

| Concern | Authored here (data) | Resolved by AutoHoyo (runtime) |
|---|---|---|
| Which screen am I on | CLF label + threshold | actual CLF inference |
| Does the screen hold | guard DET list | actual DET inference |
| Where is element X | relative‑in‑container ratios | container box → absolute screen px |
| What is element X | DET class / OCR phrase table | actual DET/OCR |
| What to do / flow | decision graph | executing it under gates |
| Whether it may click | — | gated input, arming, emergency stop |

---

## 3. The schema (the actual deliverable)

> **M0 is done.** The field names, types, constraints, resolution semantics, and
> validation rules are now locked in the normative spec:
> **`docs/ui-orchestrator-schema-v1.md`** (schema v1.0). The block below is a
> quick orientation only — the spec file is authoritative.

Single versioned JSON document per game. Orientation shape:

```jsonc
{
  "schemaVersion": "1.0",
  "game": "Zenless_Zone_Zero",

  // ---- Layer A: page definitions -------------------------------------------
  "pages": [
    {
      "id": "Schedule.Errands",
      "trigger": { "clf": "Schedule_Errands", "minConfidence": 0.90 }, // router key
      "guard":   { "requireDet": ["errands_container"] },              // fail-closed backstop
      "elements": {
        "errands_container": {
          "detClass": "errands_container",
          "kind": "container",
          "control": "horizontal_scroll"
        },
        "action_card": {
          "in": "errands_container",
          "detClass": "errand_card",
          "kind": "array", "startIndex": 1, "count": 3,
          "children": {
            "title": {
              "kind": "ocrText",
              "relRect": [0.14, 0.12, 0.86, 0.27],   // ratios of the card box
              "phraseTable": "zzz/errands@1"
            },
            "go_button": {
              "kind": "button",
              "detClass": "go_button",
              "relRect": [0.13, 0.84, 0.88, 0.97],
              "associate": {                          // one source of truth for GO↔card geometry
                "to": "action_card",
                "rule": "xColumn",
                "verticalToleranceRatio": 0.20
              }
            }
          }
        }
      }
    }
  ],

  // ---- Layer B: flow graph (the state machine / decision tree) --------------
  "flows": [
    {
      "id": "daily.coffee_errand",
      "nodes": [
        { "id": "n0", "kind": "Start" },
        { "id": "n1", "kind": "Observe", "page": "Schedule.Errands", "timeoutMs": 8000 },
        { "id": "n2", "kind": "Branch",
          "condition": { "type": "ocrMatch", "element": "action_card.title",
                         "phraseTable": "zzz/errands@1", "phrase": "Try 1 coffee",
                         "minScore": 0.78 } },
        { "id": "n3", "kind": "Act",
          "intent": { "type": "click", "element": "action_card.go_button" } },
        { "id": "n4", "kind": "End", "outcome": "Completed" },
        { "id": "n5", "kind": "End", "outcome": "NothingToDo" }
      ],
      "edges": [
        { "from": "n0", "to": "n1", "on": "Next" },
        { "from": "n1", "to": "n2", "on": "Next" },
        { "from": "n2", "to": "n3", "on": "True" },
        { "from": "n2", "to": "n5", "on": "False" },
        { "from": "n2", "to": "n5", "on": "Indeterminate" },
        { "from": "n3", "to": "n4", "on": "Next" }
      ]
    }
  ]
}
```

Notes:
- `relRect` are ratios `[x0,y0,x1,y1]` of the parent container's box, so the map
  is resolution/DPI independent.
- `associate` moves the GO‑vs‑card geometry (AutoHoyo's hand‑tuned 20% constant)
  into the data as the single authority.
- The flow's tri‑state `Branch` and edge outcomes (`Next`/`True`/`False`/
  `Indeterminate`) intentionally match AutoHoyo's script model (§7).
- **Versioning:** document `schemaVersion` + a loader that rejects unknown major
  versions with a typed error; validation runs on load and on export (mirror the
  discipline in `backend/yolo_workspace.py` / atomic writes).

---

## 4. Where it lives in YoloWorkBench (reuse map)

This is a new **tool/feature**, registered alongside the others — not bolted
into the labeling flow. It gets its own identity but reuses the foundation.

### Reuse as‑is (do not rebuild)

| Need | Reuse |
|---|---|
| Desktop shell / Web stack | Tauri + React + Vite (`apps/desktop`) — already the chosen stack |
| Tool registration + nav | `apps/desktop/src/app/toolRegistry.tsx`, `components/ToolNav.tsx` |
| Feature module pattern | `apps/desktop/src/features/<name>/` |
| Canvas box drawing | `apps/desktop/src/features/box-label/*` (and `components/workbench/`) |
| Overlay rendering (preview) | `apps/desktop/src/features/overlays/*` |
| Model predictions (DET/CLF) | backend `detect_image_with_pt`, `classify_image_with_pt` (via `/api/call`) |
| Auto‑label plumbing (frontend) | `apps/desktop/src/features/auto-label/*` |
| CLF/DET class names (taxonomy) | backend `get_workspace_classes`, `classes.txt` / `data.yaml`, `parse_class_names` |
| Image load / pick | `chooseImageFiles`, `readImageFileBase64` (already in `api.ts`) |
| Backend call hook / typing | `apps/desktop/src/api.ts` (`BackendMethod` union), `hooks/useBackend.ts`, `hooks/usePollingJob.ts` |
| Atomic persistence | backend `atomic_write.write_text_atomic`; snapshot pattern in `workspace-versioning` |
| Safety guards for new endpoints | `backend/path_access.py`, `image_safety.py`, `pt_safety.py` (load‑bearing — must be used) |

### Build new

**Frontend — `apps/desktop/src/features/ui-orchestrator/`**
- Page editor canvas: reference image + draw/edit element boxes (reuse box‑label
  canvas), compute `relRect` from the drawn box vs its container.
- Binding side panel: pick `detClass` / `phraseTable` from the workspace
  taxonomy (dropdowns fed by `get_workspace_classes`), set CLF trigger + guard.
- Flow graph editor: node/edge canvas for Layer B (Start/Observe/Act/Branch/
  Wait/End). A lightweight graph is enough; no need for a heavy node‑graph lib
  initially.
- Decision preview panel: run predictions on the current reference frame, run
  the preview interpreter, render the resulting decision + intended point as an
  overlay (reuse `overlays`).
- Register the tool in `toolRegistry.tsx`.

**Frontend — shared TS**
- `schema.ts`: TypeScript types for the schema (§3) + a validator.
- `previewInterpreter.ts`: the decision‑graph interpreter (see §5).

**Backend — new `/api/call` methods** (register in `backend/service.py`, add to
`api.ts` `BackendMethod` union, **bump `API_SCHEMA_VERSION`**):
- `runReferencePredictions` — given an image path + chosen DET/CLF models, return
  `{ det: [{class, box, conf}], clf: {label, conf, topK}, ocr?: [...] }`. Thin
  wrapper over the existing `detect_image_with_pt` + `classify_image_with_pt`
  (+ OCR if/when wired). Must go through `path_access` / `image_safety` /
  `pt_safety`.
- `loadUiMap` / `saveUiMap` — read/write the schema JSON atomically
  (`write_text_atomic`), with load‑time validation.
- (Optional, later) `runGoldenConformance` — run the shared golden cases through
  a Python copy of the interpreter for cross‑checking (see §6).

**Shared**
- `golden/` conformance cases (JSON) — versioned with the schema.

---

## 5. The decision‑preview design (Option ③, done cheaply)

The "full decision chain preview" the tool is built around, without embedding
ONNX in the browser and without duplicating decision logic as bespoke code:

1. **Inputs = real predictions, produced once, in the backend.** The editor calls
   `runReferencePredictions` on the current reference frame. Inference truth
   lives only in the Python backend (which already does it for auto‑label).
2. **The preview is a pure interpreter of the declarative graph.** `previewInterpreter.ts`
   walks the flow: resolve the current page by CLF label, apply the guard, locate
   elements from the DET boxes, resolve `relRect`/`associate` geometry, evaluate
   `Branch` conditions (tri‑state), and stop at an `Act` intent or an `End`. It
   outputs `{ decision, intendedElement, intendedPointRatio, trace }`.
3. **Render intent, not action.** The overlay shows the container box, the target
   element box, and the intended point (a crosshair) — analogous to AutoHoyo's
   dry‑run overlay. Nothing is dispatched anywhere.
4. **Intended point is a ratio, resolved to pixels only for display.** The editor
   shows it on the reference image; AutoHoyo independently resolves the same ratio
   to real screen pixels at runtime. (Optionally mirror AutoHoyo's center‑biased
   sampling for display parity, but the authored artifact is the region, not a
   fixed pixel.)

Embedding models in the editor (the heavier "Option ②" of live in‑tool
inference) is explicitly deferred; the `runReferencePredictions` seam keeps that
door open as a pure convenience layer later.

---

## 6. Preventing drift: the golden conformance suite

Two interpreters (this editor's `previewInterpreter.ts`; AutoHoyo's C# executor)
must agree. Mechanism:

- A versioned `golden/` set of cases: `{ schema, predictions, expectedDecision }`.
- The editor runs them through `previewInterpreter.ts` (a vitest suite).
- AutoHoyo runs the *same* JSON cases through its executor (its own test suite).
- Any semantic change to the graph spec adds/updates a golden case; both sides
  must stay green. This fits YoloWorkBench's existing test culture (vitest +
  pytest) and AutoHoyo's golden‑fixture culture.

This is the one hard rule that makes "two interpreters" safe rather than a second
source of truth.

---

## 7. AutoHoyo consumer contract & alignment

The editor's output is consumed by AutoHoyo. To avoid AutoHoyo re‑inventing an
executor, align the schema with its **existing node‑graph script domain model**:

- AutoHoyo already has: immutable graph model (`Start`/`End`/`Wait`/`Action`/
  `Condition` nodes; edge outcomes `Next`/`True`/`False`/`Indeterminate`),
  tri‑state conditions, a dry‑run `ScriptExecutor`, a versioned `ScriptStore`
  (under `%LocalAppData%\AutoHoyo\config\automation-scripts\`), and safety
  ceilings (max passes/steps/duration).
- The flow graph (Layer B) should map onto that vocabulary so an AutoHoyo adapter
  can hydrate a script from the exported map with minimal glue. `Observe`/`Act`
  correspond to ZZZ typed action/condition handlers; `Branch` to its tri‑state
  `Condition`.
- Page definitions (Layer A) feed AutoHoyo's vision detector composition
  (CLF routes → DET/OCR identify → geometry). The `associate` block replaces the
  hardcoded GO‑vs‑card constant.
- **Safety stays entirely on AutoHoyo's side.** Real input, the gated input
  controller, per‑run arming, emergency stop, the frame→screen coordinate
  transform, and dry‑run enforcement are AutoHoyo's — this schema never encodes
  any of them. The map describes *intent and structure*; the runtime owns
  *permission and execution*.

> Open item for a later joint pass: decide whether the editor exports AutoHoyo's
> `ScriptStore` schema directly, or a neutral schema + a thin AutoHoyo importer.
> Recommendation: neutral schema + importer, so the editor stays game‑ and
> consumer‑agnostic.

---

## 8. Build plan (incremental slices)

Each milestone is independently useful and independently validated (matches the
one‑slice‑at‑a‑time habit of both repos).

- **M0 — Schema + types.** Lock the schema (§3). TS types + validator; a couple
  of hand‑written example maps; golden case format defined. No UI yet.
- **M1 — Editor MVP (Option ①).** New `ui-orchestrator` feature + tool
  registration. Load a reference image, draw element boxes (reuse box‑label),
  compute `relRect`, pick `detClass`/`phraseTable` from the workspace taxonomy,
  set CLF trigger + guard, `saveUiMap`/`loadUiMap`. Export valid JSON. No models,
  no flow graph yet.
- **M2 — Model‑assist.** `runReferencePredictions` backend method (wraps existing
  detect/classify). Overlay predicted DET boxes + CLF label on the frame; let the
  author "accept" a predicted box as an element so `detClass` is filled from real
  model output (kills mistyped class names).
- **M3 — Flow graph + decision preview (Option ③).** Layer B editor (nodes/edges).
  `previewInterpreter.ts`. Decision preview panel + intended‑point overlay,
  running on M2 predictions.
- **M4 — Golden conformance + AutoHoyo handshake.** `golden/` cases; vitest suite;
  align/export for AutoHoyo's consumer; verify the coffee‑errand flow round‑trips
  and matches AutoHoyo's existing golden fixtures.

Schema 1.0 milestones M0–M4 are implemented. Temporal work continues as a new
major rather than changing their meaning:

- **M5 — Temporal schema 2.0.** Normative spec, closed TypeScript types and
  validator, four-event contract, emit-once Act suspension, structured terminal
  evidence, coffee and farm template maps.
- **M6 — Golden temporal traces.** Shared JSON event streams and exact traces for
  missing frame/channel, stale result, action deadline, abort, and farm
  settlement-only completion.
- **M7 — Temporal authoring and preview.** Load/edit/export 2.0 documents and
  replay ordered events in the UI without dispatching input.
- **M8 — AutoHoyo dry-run consumer.** Neutral importer plus a separate temporal
  interpreter; do not lower to the acyclic `ScriptExecutor`.
- **M9 — Coffee invoke binding.** Adapt `zzz.coffee.complete` to the existing
  bounded coffee completion action and return typed causal evidence.
- **M10 — Coffee declarative expansion.** Replace the invoke adapter only after
  click/logical-input bindings and cross-runtime golden parity are proven.
- **M11 — Farm single run.** Bind `zzz.farm.run`; commit a run only after stable
  settlement confirmation.

Suggested first shippable target: **M0 → M1**, then reassess before investing in
the flow graph.

---

## 9. Open questions

- Final schema field names / exact `associate` and `guard` shapes (lock in M0).
- OCR phrase‑table storage: reference by id (`zzz/errands@1`) resolved where? —
  likely a small phrase‑table store the editor can read/write, or reuse
  AutoHoyo's committed phrase tables as the source.
- Neutral schema + AutoHoyo importer vs direct `ScriptStore` export (§7).
- Whether reference frames are pulled from YoloWorkBench's existing image pool /
  workspace, or picked ad‑hoc via `chooseImageFiles` (start with ad‑hoc).
- Multi‑card `count`/scroll semantics for arrays — how the flow addresses "the
  coffee card specifically" vs "card at index N" (the OCR `Branch` handles
  identity in the example; confirm that covers the real cases).

---

## 10. Guardrails (do not violate)

1. The editor **never** dispatches OS/game input and never drives a game process.
   It previews intent only.
2. Geometry is stored **relative to a runtime‑located container**, never absolute
   pixels.
3. The decision graph is the **single source of truth**; the editor is an
   interpreter, pinned to AutoHoyo by the golden suite — never a second copy of
   the decision logic.
4. New backend endpoints go through the existing safety guards (`path_access`,
   `image_safety`, `pt_safety`) and bump `API_SCHEMA_VERSION`.
5. Inference stays in the backend; the editor consumes predictions, it does not
   re‑implement preprocessing/inference.
```
