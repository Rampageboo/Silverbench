# UI Orchestrator temporal schema 2.0

Status: normative v0 contract for schema `2.0`.

Schema 2.0 is a new major version. It does not extend or reinterpret schema
1.x. Existing 1.0 documents and the single-frame preview remain supported as a
legacy authoring path.

The semantic authority for 2.0 is:

```text
this specification
+ the JSON maps and temporal traces under
  apps/desktop/src/features/ui-orchestrator/golden/v2/
```

YoloWorkBench and AutoHoyo implement separate interpreters. Conformance means:

```text
same document + same ordered event stream
  -> same trace
  -> same action requests
  -> same terminal result
```

YoloWorkBench is a pure simulator. AutoHoyo is the only process allowed to
resolve an intent into gated input or another side effect.

## 1. Document

```ts
type UiOrchestrationDocV2 = {
  schemaVersion: "2.0";
  game: string;
  metadata?: {
    author?: string;
    createdAt?: string;
    notes?: string;
  };
  parameters?: Record<string, ParameterDefinition>;
  pages: Page[];
  flows: TemporalFlow[];
};
```

The page, element, relative-geometry, CLF/DET/OCR binding, selector, and
condition shapes are unchanged from schema 1.0. The 1.0 closed validator remains
their implementation authority. The temporal flow is new.

Parameters are immutable inputs supplied when a consumer starts a flow:

```ts
type ParameterDefinition = {
  type: "string" | "integer";
  required?: boolean;
  default?: string | number;
};
```

No locals, mutable variables, subflows, recursion, or multi-flow orchestration
exist in v0.

## 2. Events and explicit channel availability

The interpreter advances only through an ordered event stream:

```ts
type TemporalEvent =
  | FrameEvent
  | ActionResultEvent
  | TickEvent
  | AbortEvent;
```

Every event uses monotonic milliseconds. Event times must not move backwards.
A frame sequence must strictly increase; stale frames are ignored and recorded.

```ts
type FrameEvent = {
  type: "frame";
  seq: number;
  atMs: number;
  frame?: {
    imageSize: [number, number];
    det: Channel<DetBox[]>;
    clf: Channel<ClfPrediction>;
    ocr: Channel<OcrRead[]>;
  };
};

type Channel<T> =
  | { status: "ok"; value: T }
  | { status: "missing"; reason?: string };
```

An absent frame and a missing required channel evaluate to `Indeterminate`.
They never mean an empty successful result and never become `False`.

An explicit `status: "ok", value: []` is observably different from
`status: "missing"`.

```ts
type ActionResultEvent = {
  type: "actionResult";
  requestId: string;
  atMs: number;
  status: "Succeeded" | "Failed" | "Indeterminate";
  code?: string;
};

type TickEvent = {
  type: "tick";
  atMs: number;
};

type AbortEvent = {
  type: "abort";
  atMs: number;
  reason: string;
};
```

Every event advances the clock. Deadline checks occur before the event is
otherwise handled.

## 3. Nodes and edges

```ts
type TemporalNode =
  | Start
  | Observe
  | Decide
  | Act
  | Wait
  | End;
```

Required outgoing outcomes are closed and exact:

| Node | Required outgoing edges |
|---|---|
| `Start` | `Next` |
| `Observe` | `Observed`, `Timeout` |
| `Decide` | `True`, `False`, `Indeterminate` |
| `Act` | `Succeeded`, `Failed`, `Indeterminate`, `Timeout` |
| `Wait` | `Next` |
| `End` | none |

Cycles are allowed. AutoHoyo retains runtime-owned duration, step, cancellation,
emergency-stop, and safety ceilings.

### Observe

```ts
type Observe = {
  id: string;
  kind: "Observe";
  page: string;
  timeoutMs: number;
  stability: {
    minConsecutiveFrames: number;
    minStableMs: number;
    maxFrameGapMs: number;
  };
};
```

An observation becomes stable only when both its frame count and duration
requirements hold. A gap larger than `maxFrameGapMs`, a false page decision, an
absent frame, or any missing required channel resets all accumulated stability.
The frame that stabilizes an Observe may also be consumed by its immediately
following Decide node.

### Decide

`Decide` evaluates one existing schema condition against the last stably
observed page and the current frame. It always routes one of
`True`/`False`/`Indeterminate`; it never coerces `Indeterminate` to `False`.

### Act

```ts
type Act = {
  id: string;
  kind: "Act";
  intent: Intent;
  resultTimeoutMs: number;
};
```

On first entry, Act emits exactly one request and suspends:

```ts
type ActionRequest = {
  requestId: string;
  flowId: string;
  nodeId: string;
  issuedAtMs: number;
  intent: Intent;
};
```

It does not implicitly succeed or retry. Only a result with the pending
`requestId` may select an action-result edge. A stale or duplicate result:

```text
does not change state
does not re-emit the action
records StaleActionResultIgnored
```

When the elapsed time is greater than `resultTimeoutMs`, the `Timeout` edge is
selected before processing the late event.

Retry policy is deliberately absent from schema 2.0 v0. An invoke adapter may
perform its own bounded recovery; AutoHoyo's runtime safety ceiling remains the
upper bound.

### Intent

```ts
type Intent =
  | { type: "click"; target: ElementRef }
  | { type: "input"; command: string }
  | {
      type: "invoke";
      op: string;
      arguments?: Record<
        string,
        string | number | boolean | null | { parameter: string }
      >;
    };
```

`command` and `op` must be namespaced logical identifiers such as
`zzz.interact` and `zzz.coffee.complete`. Literal virtual keys, scan codes,
absolute pixels, input permission, arming, retry ceilings, and other runtime
safety settings are invalid in an exported document.

AutoHoyo owns logical-command key mapping, coordinate transformation, current
frame re-observation, gated dispatch, and capability adapters.

Schema validity does not imply that a particular AutoHoyo runtime can execute
every intent. Before creating an execution session, AutoHoyo performs a
separate capability check against the selected flow and its exact namespaced
operations. Unsupported selectors, conditions, intent kinds, or invoke
bindings reject preparation as `UnsupportedCapability`; the interpreter is not
started and no `ActionRequest` is emitted. Pure golden replay remains available
for semantic conformance without claiming side-effect capability.

### Wait

Wait selects `Next` only after its bounded `durationMs` elapses. It does not
block a thread and can be advanced by any event.

## 4. Terminal causal evidence

Abort is a global runtime terminal. It is outside the graph, immediately clears
or seals a pending action, and cannot be changed by later events. A flow does
not need an unreachable `End(Aborted)` node.

Graph End outcomes are `Completed`, `NothingToDo`, and `Failed`. Each End
declares the exact causal evidence carried by the direct incoming transition:

```ts
type EndEvidence =
  | {
      source: "condition";
      nodeId: string;
      outcome: "True" | "False";
    }
  | {
      source: "actionResult";
      nodeId: string;
      status: "Succeeded" | "Failed" | "Indeterminate";
      code?: string;
    }
  | {
      source: "timeout";
      nodeId: string;
    };
```

The evidence references its producing node instead of copying the condition or
action definition.

Allowed evidence:

| Outcome | Allowed evidence |
|---|---|
| `NothingToDo` | condition `False` only |
| `Completed` | condition `True` or action result `Succeeded` |
| `Failed` | action result `Failed`/`Indeterminate`, or timeout |
| runtime `Aborted` | `AbortEvent` only |

If the declared evidence does not exactly match the direct transition's causal
evidence, the interpreter must not enter the End. It terminates at the engine
level:

```json
{
  "status": "InvalidPlan",
  "diagnostic": {
    "code": "TerminalEvidenceMismatch"
  }
}
```

This is not a business `Failed` outcome and is not retryable.

## 5. Coffee and farm v0 bindings

The Phase-1 coffee map invokes `zzz.coffee.complete`. AutoHoyo adapts that
operation to the existing bounded **dry-run-only** coffee-completion state
machine. YoloWorkBench does not pretend to simulate its internal polling or
input; its golden trace receives an external `ActionResultEvent` with
`code: "coffee_dry_run_completion_confirmed"`. This means that the temporal
dry-run completed with zero applied effects, not that the in-game errand was
completed.

The farm single-run map invokes `zzz.farm.run` with immutable activity/stage
parameters, then waits for stable settlement evidence. A caller may increment
`completedRuns` only after the flow reaches `Completed` through the settlement
condition. An action result such as `combat_finished` alone is not settlement
and must not commit a run. Until AutoHoyo registers that exact operation,
execution preparation fails as `UnsupportedCapability`; the farm fixture is a
synthetic conformance replay, not an executable farm workflow.

## 6. Conformance fixtures

Canonical files:

- `golden/v2/coffee-completion.json`
- `golden/v2/farm-single-run.json`
- `golden/v2/temporal-contract.json`
- `golden/v2/cases.json`

The six minimum traces cover:

1. absent frame resets stability and reaches an Observe timeout;
2. missing OCR is `Indeterminate`, never `False`;
3. stale action result is ignored and the original request is not re-emitted;
4. action-result deadline is bounded;
5. Abort is global and final;
6. a farm run completes only after stable settlement confirmation.

Any semantic change requires an intentional schema version decision and updated
golden expectations in both YoloWorkBench and AutoHoyo.
