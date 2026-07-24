# UI Orchestrator — Golden Conformance Suite

Versioned `(map + predictions → expected decision)` cases that pin the **two
interpreters** of the same declarative graph:

- this editor's `previewInterpreter.ts` (run here by `golden.test.ts`, vitest);
- AutoHoyo's C# `ScriptExecutor` (runs the *same* JSON through its own tests).

If both stay green on the same cases, the graph has a single meaning and the
editor cannot silently drift from the runtime. This is the one hard rule that
makes "two interpreters, one source of truth" safe (plan §6, decision D4).

## Layout

```
golden/
  <suite>/
    map.json     # a UiOrchestrationDoc (schema v1.0) — the neutral, exported map
    cases.json   # { schemaVersion, map, flowId, cases: [ { name, predictions, expected } ] }
```

- `map.json` is exactly what the editor's **Export JSON** produces — the neutral
  schema, consumer-agnostic. AutoHoyo imports it via a thin adapter (decision D9);
  no AutoHoyo-specific fields are emitted here.
- `predictions` is the schema §12 `Predictions` contract (pixel boxes,
  `imageSize [w,h]`, optional `ocr`).
- `expected` is the interpreter's `DecisionResult`: `outcome`, optional
  `intended { element, point }` (pixel center), and the full node `trace`.

## Contract each interpreter must honour

1. Validate `map.json` against schema v1.0 (reject unknown major, strict fields).
2. Route by CLF trigger, confirm with the DET guard (fail-closed: CLF picks, DET
   confirms).
3. Resolve elements from predictions (detClass instances + reading order,
   relRect children, associate binding), evaluate tri-state conditions, and walk
   the flow to an `End`.
4. Undecidable vision (missing/low DET, absent OCR) → `Indeterminate`, **never** a
   guessed action. The `ocr_unavailable_is_indeterminate` case locks this.
5. The authored artifact is the **region**; the click point is its geometric
   center. Whether/how that becomes a real click is entirely AutoHoyo's gated,
   armed, dry-run-enforced concern — this suite never encodes execution.

## Adding a case

Any semantic change to the schema or interpreter adds/updates a golden case here
**and** in AutoHoyo's suite; both sides must go green before the change lands.
Keep cases self-contained (embed the map or reference a sibling `map.json`) so
they port verbatim between the two repos.
