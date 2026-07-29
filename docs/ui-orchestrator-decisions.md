# UI Orchestrator — Decision Log

The **why** behind the UI Orchestrator, including alternatives that were
considered and rejected. The *what* lives in `docs/ui-orchestrator-plan.md`
(overview) and `docs/ui-orchestrator-schema-v1.md` (normative schema). Read this
when you need the reasoning, not the spec — e.g. before revisiting a decision.

Format per entry: **Decision → Context → Rejected → Why → Consequence.**

---

## D1 — Retire the UMG export; hand-author from screenshots

- **Decision:** Do not consume the game's exported UMG widget-blueprint JSON at
  runtime. Author the map by hand from real screenshots.
- **Context:** The source data started as UMG (`umg_widget_blueprint_layout_rules`)
  exports of the game's own UI, later distilled into a `ui_map` and visual
  signatures.
- **Rejected:** (a) keep UMG as a runtime source; (b) keep UMG as a bootstrap/seed
  with references back to it; (c) both formats side by side.
- **Why:** UMG is bloated (wrapper widgets, verbose slots) and, worse, its
  coordinates are **design-space**, not runtime — they only become screen pixels
  after ScaleBox/DPI. Hand-authoring from an actual captured frame yields
  **runtime geometry directly**, sidestepping the design-vs-runtime-DPI problem,
  and removes a dependency on datamining internals the game can change any patch.
- **Consequence:** Lose UMG's precise relative-geometry seed; gain independence
  and correctness. Geometry is authored as **ratios of a runtime-located
  container** (see schema §5), which is resolution/DPI independent.

## D2 — One declarative schema as the single source of truth

- **Decision:** A single authoritative, versioned declarative document describes
  pages, element/vision bindings, geometry, and the decision graph.
- **Context:** The same facts were previously expressed three times — a distilled
  `ui_map`, hand-tuned geometry constants in AutoHoyo's C#, and hardcoded CLF/DET
  wiring in the detector.
- **Rejected:** Continue with per-concern representations; keep geometry constants
  in code.
- **Why:** Three sources of truth for one fact drift on every game/UI change (the
  GO-vs-card vertical tolerance was independently a `ui_map` offset **and** a C#
  constant). Collapsing to one document removes the drift class.
- **Consequence:** AutoHoyo *interprets* data instead of hardcoding it; the
  editor authors that same data.

## D3 — CLF is the router; DET is the fail-closed confirmation

- **Decision:** Each page is keyed by a CLF trigger label. Once CLF routes to a
  page, a `guard` of required DET elements must resolve or the page does not hold.
- **Context:** Owner's mental model — "when the classifier sees a screen, activate
  the corresponding UI." A natural CLF → page → elements chain.
- **Rejected:** The legacy weighted box-matching vote; CLF as a sole unconditional
  trigger.
- **Why:** CLF-first is the clean, natural router. But CLF misfires; a sole
  trigger could route to the wrong page and act on wrong expectations. A DET guard
  makes it fail-closed: **CLF picks, DET confirms**; low confidence / missing
  elements → `Indeterminate`, never a guessed action.
- **Consequence:** `trigger.clf` + `guard.require` in the schema; the tri-state
  `Indeterminate` is structurally required on every `Branch`.

## D4 — Decision logic lives in data as a graph, not duplicated as code

- **Decision:** The decision tree / state machine is **declarative data** (the
  flow graph). The editor and AutoHoyo are two *interpreters* of it.
- **Context:** Owner wanted the tool to visualize and preview the decision tree /
  state machine (Option ③), which naively means re-implementing decision logic in
  the editor.
- **Rejected:** (a) hardcode decision logic in C# and copy it into the editor's
  JS (two drifting code copies); (b) push association/decision *rules* themselves
  into a data rule-language (too much behavior in data — needs its own validator
  and security review); (c) keep only geometry/phrases external and CLF/DET wiring
  in code (a half-measure that doesn't deliver the state-machine value asked for).
- **Why:** Making the graph declarative gives a single source of truth with two
  *interpreters*, not two logics. Drift is prevented by a shared **golden
  conformance suite** (`(graph + predictions → expected decision)` cases both
  sides must pass) — a standard pattern, and a fit for this repo's existing
  test/golden culture.
- **Consequence:** Layer-B flow graph in the schema; a `previewInterpreter.ts` in
  the editor; a `golden/` suite; AutoHoyo's executor as the second interpreter.

## D5 — Option ③ preview, done without embedding models

- **Decision:** The full decision-chain preview runs on **predictions produced by
  the Python backend**, not on models embedded in the browser.
- **Context:** Platform chosen = Web (Tauri+React); reference source = user
  screenshots.
- **Rejected:** (a) pure annotation editor with no preview (Option ①) — doesn't
  give the state-machine validation the Owner wanted; (b) embed ONNX + preprocessing
  in the editor from day one (Option ②) — heavy, and duplicates AutoHoyo's
  inference/preprocessing.
- **Why:** Inference truth should live in one place (the backend already runs the
  PT detector/classifier for auto-label). The editor consumes predictions and only
  interprets the graph. Embedding models is deferred to an optional convenience
  layer behind a `runReferencePredictions` seam.
- **Consequence:** Predictions contract locked in schema §12; `runReferencePredictions`
  backend method planned for M2; in-tool inference explicitly reserved.

## D6 — The editor previews intent; it never acts

- **Decision:** The editor renders the decision + intended click point. It never
  dispatches OS/game input and never drives a game process.
- **Context:** This is automation authoring for a tool (AutoHoyo) that guards real
  input behind gates, arming, emergency stop, and a coordinate transform.
- **Rejected:** Any form of live "test click" from the editor.
- **Why:** Keeping execution out of the editor means Option ③ adds **no new safety
  surface**. Real input, gated dispatch, per-run arming, emergency stop, the
  frame→screen transform, and dry-run enforcement remain AutoHoyo's typed, audited
  concern. The data describes *intent and structure*; the runtime owns *permission
  and execution*.
- **Consequence:** Non-negotiable guardrail (plan §10). The schema encodes no
  execution/safety fields.

## D7 — Build it inside YoloWorkBench, as a distinct feature

- **Decision:** The tool is a new **distinct feature** in YoloWorkBench's
  `apps/desktop`, reusing the foundation — not standalone, not merged into the
  labeling flow.
- **Context:** Discovered YoloWorkBench is a mature Tauri+React + Python-FastAPI
  app that already does CLF/DET labeling, runs PT models, owns the class taxonomy,
  and uses the same AI workflow — i.e. the exact stack the Owner planned to build
  the editor in.
- **Rejected:** (a) a fully standalone program — would rebuild the canvas, model
  runner, taxonomy, shell, safety, and AI workflow, and would re-create the
  class-name drift the map exists to avoid (CLF/DET names are *defined* in
  YoloWorkBench's taxonomy); (b) bolt it into the labeling UI — muddies that tool's
  identity, since dataset-building and automation-authoring are different concerns.
- **Why:** The editor is the downstream stage of the same pipeline (label → train
  → orchestrate); same repo = maximal reuse + one source of class names, while a
  distinct feature keeps concerns clean. Refactor is lazy/in-place (reuse
  components where they are; extract shared packages only when a second app truly
  needs them). Graduate to a separate sibling app only if distribution ever
  diverges.
- **Consequence:** Personal single-user scope (drop auth/multi-user/collaboration);
  Tauri+React satisfies the earlier "Web" platform choice; reference images come
  from user screenshots to start.

## D8 — Schema v1.0 specifics

Locked in `docs/ui-orchestrator-schema-v1.md`. Notable choices and their reasons:

- **Two layers** (pages + flows): screens vs the flow across them — matches the
  CLF→page→act mental model.
- **Element = discriminated union** (`container`/`button`/`text`/`marker`); array
  = `container` + `repeat`. **Dropped** the legacy `size`/`offset`/`gap`/
  `start_index`/`count` array geometry — DET provides instance boxes at runtime, so
  computing card positions geometrically (the pre-DET `ui_map` approach) is
  unnecessary. *This is a behavioral simplification vs the old `ui_map`.*
- **Two child-location strategies:** `relRect` (a sub-region of the parent box) or
  `detClass` + `associate` (detected globally, bound to a parent instance). Covers
  "title inside a card" vs "GO button detected independently and bound to its card."
- **`relRect` ratios may exceed [0,1]** to express an element rendered outside its
  parent box (the GO-below-card reality).
- **`associate.verticalToleranceRatio`** is the single home for the GO-vs-card
  vertical slack (AutoHoyo's old hard-coded ~20% constant).
- **Fail-closed is structural:** `Branch` MUST define `True`/`False`/
  `Indeterminate`; `Observe` MUST define `Next`/`Timeout`. Undecidable → never
  silently `False`.
- **Selectors are evaluated per node** (no cross-node "select once, reuse"); the
  coffee flow repeats its `ocrMatch` selector in `Branch` and `Act`. A stateful
  `Select` node is reserved.
- **`click` is the only intent** in v1.0; `Act` expresses intent only (retry /
  postcondition remain AutoHoyo runtime policy).
- **Strict validation:** unknown fields are rejected (catches typos).

## D9 — Align with AutoHoyo, but export a neutral schema

- **Decision:** Flow node vocabulary mirrors AutoHoyo's existing node-graph script
  domain model (`Start`/`End`/`Wait`/`Action`/`Condition`; edge outcomes
  `Next`/`True`/`False`/`Indeterminate`; tri-state conditions). **Recommendation:**
  export a neutral schema + a thin AutoHoyo importer, rather than emitting
  AutoHoyo's `ScriptStore` schema directly.
- **Why:** Alignment lets AutoHoyo hydrate a script with minimal glue and avoids it
  re-inventing an executor. A neutral schema keeps the editor game- and
  consumer-agnostic (open item — could be revisited if only AutoHoyo ever consumes
  it).
- **Consequence:** An AutoHoyo-side adapter maps the exported map onto its script /
  vision-detector composition; safety stays entirely on AutoHoyo's side.

---

## Still open (not blocking M0/M1)

- OCR phrase-table storage/format — only the *reference* form `ns/name@ver` is
  locked; where the tables live (a small editor store vs reusing AutoHoyo's
  committed phrase tables) is undecided.
- Neutral schema + importer vs direct `ScriptStore` export (D9).
- Disambiguating two element roles that share one `detClass` (e.g. featured vs
  action card) — v1.0 assumes distinct classes or reading-order index; a region
  filter is reserved.
