# UI Orchestrator — Schema v1.0 (normative)

Formal specification of the declarative document the UI Orchestrator authors and
AutoHoyo consumes. This is the **M0 deliverable**: field names, types,
constraints, resolution semantics, and validation rules are locked here.

- Companion overview: `docs/ui-orchestrator-plan.md`.
- The normative type surface is the TypeScript block in §11. Prose sections
  define semantics and constraints that types cannot express.
- Version of this document / of the schema it defines: **1.0**.

---

## 1. Conventions

- **Coordinate origin**: top‑left; `+x` right, `+y` down.
- **Boxes** are `[x0, y0, x1, y1]` with `x0 < x1`, `y0 < y1`.
- **Ratios (`RelRect`)** are box coordinates expressed as fractions of a *parent
  element's resolved box* (see §5). Typically within `[0, 1]`, but MAY fall
  outside to describe an element that extends beyond its parent box (e.g. a GO
  button rendered just below a card's detected box). Validator range: each
  component in `[-1, 2]`.
- **Reading order** for repeated instances (§5.3): `horizontal_scroll` →
  ascending resolved‑box center‑x (left→right); `vertical_scroll` → ascending
  center‑y; `grid` → row‑major (bucket by y, then x); `none` → detection order.
  Selector indices and enumeration follow reading order.
- **Names & ids**: `element` names are unique within a page; `page` ids and
  `flow` ids are unique within the document; `node` ids are unique within a flow.
  Recommended style: dotted namespacing for page ids (`Schedule.Errands`),
  lowerCamel for element names, short slugs for node ids.
- **Class names** (`detClass`) and **CLF labels** (`trigger.clf`) MUST be strings
  that exist in the YoloWorkBench workspace taxonomy (`classes.txt` / `data.yaml`
  / `get_workspace_classes`). The schema does not redefine them; it references
  them. (Cross‑checking against the live taxonomy is an editor/validator feature,
  not a document constraint.)
- **Unknown fields are rejected** by strict validation (both on load and on
  export). This catches typos; it is not a place for ad‑hoc extension.

---

## 2. Document envelope

```jsonc
{
  "schemaVersion": "1.0",          // required; see §10
  "game": "Zenless_Zone_Zero",     // required; namespace string
  "metadata": { },                 // optional; see §11 DocMetadata
  "pages": [ /* Page */ ],         // required; >= 1
  "flows": [ /* Flow */ ]          // required; may be empty in M1 (pages-only maps)
}
```

`flows` MAY be an empty array for a pages‑only map (M1 authoring before the flow
graph exists). A document with `flows: []` is valid.

---

## 3. Page

| field | type | req | constraints |
|---|---|---|---|
| `id` | string | yes | unique across `pages` |
| `trigger` | `ClfTrigger` | yes | the router key (§3.1) |
| `guard` | `Guard` | no | fail‑closed backstop (§3.2) |
| `elements` | `Record<string, Element>` | yes | key = element name, unique within page; >= 1 entry |

### 3.1 ClfTrigger

| field | type | req | constraints |
|---|---|---|---|
| `clf` | `string \| string[]` | yes | non‑empty; a page *holds* if any listed label is the classifier top‑1 with confidence `>= minConfidence` |
| `minConfidence` | number | yes | `(0, 1]` |

CLF is the sole page‑routing signal. It selects *which* page definition applies;
it does not by itself confirm the page (that is `guard`).

### 3.2 Guard

| field | type | req | constraints |
|---|---|---|---|
| `require` | `string[]` | yes | element names in this page that MUST resolve (§5) once routed here |

Semantics: after CLF routes to a page, every element named in `require` must
resolve to at least one box. If any does not, **the page does not hold** → the
runtime result is `Indeterminate` (never a guessed action). This is the
structural encoding of "CLF picks, DET confirms."

---

## 4. Element

An `Element` is a discriminated union on `kind`: `container` | `button` | `text`
| `marker`.

### 4.1 Common fields (`ElementBase`)

| field | type | req | constraints |
|---|---|---|---|
| `in` | string | no | parent element name; **omit** for a page‑root element. Parent must exist and must be a `container`. |
| `detClass` | string | no | workspace taxonomy class; when present, the element is located by DET boxes of this class |
| `relRect` | `RelRect` | no | ratios of the parent's resolved box; used to locate a child that has no `detClass` |

**Location strategy** (exactly one must be resolvable):
- **page‑root element** (`in` omitted): MUST have `detClass`. Located by that
  class's DET boxes. If it is a `container` with `repeat`, every such box is an
  instance (§5.3).
- **child element** (`in` set): located by **either** `relRect` (a sub‑region of
  each parent instance box) **or** `detClass` + `associate` (detected globally,
  bound to a parent instance by rule — §4.6). Exactly one of these two.

### 4.2 `container`

| field | type | req | constraints |
|---|---|---|---|
| `kind` | `"container"` | yes | |
| `repeat` | `Repeat` | no | presence makes this an **array** of instances |
| `children` | `Record<string, Element>` | no | child names unique within this element |

### 4.3 `button`

| field | type | req | constraints |
|---|---|---|---|
| `kind` | `"button"` | yes | |
| `associate` | `Associate` | no | only valid when the button is a child located by `detClass` (§4.6) |

A `button` is the actionable target of a `click` intent. It resolves to a single
box (per instance, if inside an array).

### 4.4 `text`

| field | type | req | constraints |
|---|---|---|---|
| `kind` | `"text"` | yes | |
| `phraseTable` | `PhraseTableRef` | no | required when this element is referenced by an `ocrMatch` (condition or selector) |

Located by `relRect` (typical) or `detClass`. Read by OCR at runtime.

### 4.5 `marker`

| field | type | req | constraints |
|---|---|---|---|
| `kind` | `"marker"` | yes | `detClass` REQUIRED |

Presence‑only element (identity / guard). Not clickable, not read. Resolves iff
its `detClass` yields a qualifying box.

### 4.6 `Associate` (child‑to‑parent binding for detected children)

Used when a child element is located by its own `detClass` (detected globally)
and must be bound to a specific parent‑array instance — e.g. a GO button box
bound to the card it belongs to.

| field | type | req | constraints |
|---|---|---|---|
| `rule` | `"xColumn" \| "containment"` | yes | see below |
| `verticalToleranceRatio` | number | no | default `0`; fraction of the parent instance's height |

- **`xColumn`**: the child binds to the parent instance whose x‑range
  `[x0, x1]` contains the child box center‑x, provided the child center‑y is
  within `[parent.y0, parent.y1 + verticalToleranceRatio * parentHeight]`.
  Multiple candidates → nearest parent center‑x; exact tie → **no binding**
  (fail‑closed).
- **`containment`**: the child binds to a parent instance only if the child box
  center is inside `[parent.x0..x1, parent.y0..(y1 + tol*height)]`. Stricter
  subset of `xColumn`.

`verticalToleranceRatio` is the single authority for the GO‑vs‑card vertical
slack (the value AutoHoyo previously hard‑coded).

### 4.7 `Repeat`

| field | type | req | constraints |
|---|---|---|---|
| `control` | `"horizontal_scroll" \| "vertical_scroll" \| "grid" \| "none"` | no | default `"none"`; sets reading order (§1) |
| `maxInstances` | number | no | integer `>= 1`; caps instances after reading‑order sort |

`repeat` is only valid on a `container`. It does **not** carry per‑instance
geometry (size/offset/gap): instance boxes come from DET at runtime. (This is an
intentional simplification versus the legacy `ui_map`, which pre‑dated
DET‑driven instance detection.)

---

## 5. Element resolution (normative semantics)

How an element resolves to box(es) given a `Predictions` input (§12):

1. **page‑root, `detClass`**: take all DET boxes of `detClass` at/above the
   detector's reporting threshold. A plain container/button/marker resolves to
   those boxes; a container with `repeat` treats each box as an **instance**,
   sorted by reading order, capped by `maxInstances`.
2. **child, `relRect`**: for each parent instance box `P`, the child box is
   `[P.x0 + r0*Pw, P.y0 + r1*Ph, P.x0 + r2*Pw, P.y0 + r3*Ph]` where
   `relRect = [r0,r1,r2,r3]`, `Pw = P.x1-P.x0`, `Ph = P.y1-P.y0`.
3. **child, `detClass` + `associate`**: take all DET boxes of the child
   `detClass`; bind each to a parent instance by the `associate` rule (§4.6). A
   parent instance's child resolves to its bound box (or none).

An element **resolves** iff it produces `>= 1` box under the current inputs. A
`select`ed array reference resolves to the single instance chosen by the
`Selector` (§7).

Click point for an intent = **geometric center** of the resolved target box.
The authored artifact is the *region*; runtime click‑point sampling
(center‑biased jitter) is AutoHoyo's concern, not encoded here.

---

## 6. Flow

| field | type | req | constraints |
|---|---|---|---|
| `id` | string | yes | unique across `flows` |
| `nodes` | `Node[]` | yes | exactly one `Start` (§8) |
| `edges` | `Edge[]` | yes | (§9) |

The flow is the state machine / decision tree. Layer‑A pages describe screens;
Layer‑B flows stitch them.

---

## 7. ElementRef & Selector

An `ElementRef` names a target within the page most recently entered by an
`Observe` on the current path.

| field | type | req | constraints |
|---|---|---|---|
| `element` | string | yes | element name in the observed page |
| `select` | `Selector` | cond | **required iff** `element` has `repeat`; **forbidden** otherwise |
| `child` | string | no | a child name of `element` (or of the selected instance) |

**Selector** (chooses one instance of an array element):

- `{ "by": "index", "index": n }` — `n` integer `>= 0` into the reading‑ordered
  instances; resolves to none if out of range.
- `{ "by": "ocrMatch", "child": c, "phraseTable": p, "phrase": s, "minScore": m }`
  — the instance whose child `c` (a `text` element) OCR‑reads with best match
  score `>= m` for phrase `s`; ties broken by reading order; none qualifies →
  no instance.

> **M0 simplification**: selectors are evaluated independently at each
> referencing node — there is no cross‑node "select once, reuse" binding. The
> canonical coffee flow therefore repeats the same `ocrMatch` selector in its
> `Branch` and its `Act`. A stateful `Select` node is **reserved** for a later
> version (§13).

---

## 8. Nodes

All nodes: `{ "id": string, "kind": ... , ... }`, `id` unique within the flow.

| kind | extra fields | out‑edge outcomes (required set) |
|---|---|---|
| `Start` | — | exactly one `Next` |
| `End` | `outcome: EndOutcome` | none (terminal) |
| `Observe` | `page: string` (existing page id), `timeoutMs: number` (int > 0) | `Next` **and** `Timeout` |
| `Act` | `intent: Intent` | exactly one `Next` |
| `Branch` | `condition: Condition` | exactly one each of `True`, `False`, `Indeterminate` |
| `Wait` | `durationMs: number` (int > 0) | exactly one `Next` |

`EndOutcome` ∈ `"Completed" | "NothingToDo" | "Failed" | "Aborted"`.

- `Observe` succeeds (`Next`) when its `page` holds (CLF trigger + guard);
  `Timeout` when it does not within `timeoutMs`.
- `Act` expresses **intent only**; `Next` = intent produced. (Whether the real
  click registers, and any bounded retry, is AutoHoyo runtime policy — not part
  of the authored graph in v1.0.)

---

## 9. Edges & tri‑state

| field | type | req | constraints |
|---|---|---|---|
| `from` | string | yes | existing node id (not an `End`) |
| `to` | string | yes | existing node id (not `Start`) |
| `on` | `EdgeOutcome` | yes | must be valid for the `from` node kind (§8) |

`EdgeOutcome` ∈ `"Next" | "True" | "False" | "Indeterminate" | "Timeout"`.

**Fail‑closed rule (normative):** `Branch` MUST define all three of `True`,
`False`, `Indeterminate`. A condition that cannot be decided from the inputs is
`Indeterminate` — it is **never** silently treated as `False`. Low‑confidence or
missing vision → `Indeterminate`.

### 9.1 Condition tri‑state semantics

| condition | `True` | `False` | `Indeterminate` |
|---|---|---|---|
| `elementFound` | target resolves to a box | page held but target absent | required detector/OCR inputs unavailable |
| `ocrMatch` | best score `>= minScore` | text read, score `< minScore` | OCR unavailable or target `text` element unresolved |
| `detPresent` | a `detClass` box `>= minConfidence` | detector ran, none qualifies | detector output for that class unavailable |

**Condition** (§11 for exact types):
- `{ "type": "elementFound", "target": ElementRef }`
- `{ "type": "ocrMatch", "target": ElementRef, "phraseTable": ref, "phrase": str, "minScore": 0..1 }`
- `{ "type": "detPresent", "target": ElementRef, "minConfidence": 0..1 }`

---

## 10. Versioning & compatibility

- `schemaVersion` is `"MAJOR.MINOR"`. This document defines `1.0`.
- A loader MUST reject a document whose MAJOR exceeds the supported major with a
  typed error (do not silently ignore).
- Within the same MAJOR, additive MINOR fields are backward compatible; a v1.0
  loader encountering an unknown field still **fails strict validation** (§11
  is closed) — bump MINOR and update the validator to accept new fields.
- Breaking changes (removing/retyping a field, changing a default or resolution
  rule) require a MAJOR bump and an explicit migration.

---

## 11. Normative TypeScript types

```ts
// ui-orchestrator schema v1.0 — normative type surface.
// Strict: no additional properties beyond those declared.

export interface UiOrchestrationDoc {
  schemaVersion: "1.0";
  game: string;
  metadata?: DocMetadata;
  pages: Page[];                 // >= 1
  flows: Flow[];                 // may be []
}

export interface DocMetadata {
  author?: string;
  createdAt?: string;            // ISO-8601
  notes?: string;
}

export interface Page {
  id: string;
  trigger: ClfTrigger;
  guard?: Guard;
  elements: Record<string, Element>;   // >= 1
}
export interface ClfTrigger { clf: string | string[]; minConfidence: number; } // minConf in (0,1]
export interface Guard { require: string[]; }

export type Element = ContainerElement | ButtonElement | TextElement | MarkerElement;

interface ElementBase {
  in?: string;                   // parent element name; omit => page-root
  detClass?: string;
  relRect?: RelRect;
}
export interface ContainerElement extends ElementBase {
  kind: "container";
  repeat?: Repeat;
  children?: Record<string, Element>;
}
export interface ButtonElement extends ElementBase { kind: "button"; associate?: Associate; }
export interface TextElement extends ElementBase { kind: "text"; phraseTable?: PhraseTableRef; }
export interface MarkerElement extends ElementBase { kind: "marker"; } // detClass required

export interface Repeat {
  control?: "horizontal_scroll" | "vertical_scroll" | "grid" | "none";  // default "none"
  maxInstances?: number;         // int >= 1
}
export interface Associate {
  rule: "xColumn" | "containment";
  verticalToleranceRatio?: number;   // default 0
}

export type RelRect = [number, number, number, number]; // [x0,y0,x1,y1] ratios; x0<x1, y0<y1
export type PhraseTableRef = string;                     // "<ns>/<name>@<version>"

export interface Flow { id: string; nodes: Node[]; edges: Edge[]; }

export type Node = StartNode | EndNode | ObserveNode | ActNode | BranchNode | WaitNode;
interface NodeBase { id: string; }
export interface StartNode  extends NodeBase { kind: "Start"; }
export interface EndNode    extends NodeBase { kind: "End"; outcome: EndOutcome; }
export interface ObserveNode extends NodeBase { kind: "Observe"; page: string; timeoutMs: number; }
export interface ActNode    extends NodeBase { kind: "Act"; intent: Intent; }
export interface BranchNode extends NodeBase { kind: "Branch"; condition: Condition; }
export interface WaitNode   extends NodeBase { kind: "Wait"; durationMs: number; }

export type EndOutcome = "Completed" | "NothingToDo" | "Failed" | "Aborted";

export interface Edge { from: string; to: string; on: EdgeOutcome; }
export type EdgeOutcome = "Next" | "True" | "False" | "Indeterminate" | "Timeout";

export type Intent = ClickIntent;
export interface ClickIntent { type: "click"; target: ElementRef; }

export interface ElementRef { element: string; select?: Selector; child?: string; }
export type Selector =
  | { by: "index"; index: number }
  | { by: "ocrMatch"; child: string; phraseTable: PhraseTableRef; phrase: string; minScore: number };

export type Condition = ElementFoundCond | OcrMatchCond | DetPresentCond;
export interface ElementFoundCond { type: "elementFound"; target: ElementRef; }
export interface OcrMatchCond { type: "ocrMatch"; target: ElementRef; phraseTable: PhraseTableRef; phrase: string; minScore: number; }
export interface DetPresentCond { type: "detPresent"; target: ElementRef; minConfidence: number; }
```

---

## 12. Predictions input (interpreter contract)

Not part of the authored document, but locked here because the preview
interpreter (§ plan M3) and any conformance runner consume it. Produced by the
backend `runReferencePredictions` (wrapping `detect_image_with_pt` /
`classify_image_with_pt` / OCR).

```ts
export interface Predictions {
  imageSize: [number, number];         // [w,h] px of the reference frame
  det: DetBox[];
  clf: { label: string; conf: number; topK?: { label: string; conf: number }[] };
  ocr?: OcrRead[];                       // optional; absent => ocr conditions are Indeterminate
}
export interface DetBox { class: string; box: [number, number, number, number]; conf: number; } // px
export interface OcrRead { box: [number, number, number, number]; text: string; conf: number; }  // px
```

A decision result from the interpreter:

```ts
export interface DecisionResult {
  outcome: EndOutcome | "Indeterminate";
  intended?: { element: string; box: [number,number,number,number]; point: [number,number] }; // px
  trace: string[];                       // node ids visited, for the preview panel
}
```

---

## 13. Reserved / explicitly NOT in v1.0

- Stateful `Select` node (select an instance once, reuse across nodes).
- `counter` / `elapsed` conditions and loop constructs (align with AutoHoyo's
  script model when added).
- Intents other than `click` (drag, key press, sequence).
- `Act` postcondition/retry as authored control flow (remains AutoHoyo runtime
  policy in v1.0).
- Region/attribute filters to disambiguate two element roles sharing one
  `detClass` (v1.0 assumes distinct classes or reading‑order index).
- Phrase‑table storage/format (only the *reference* form `ns/name@ver` is
  locked; where tables live is an open item in the plan).

---

## 14. Canonical example (valid against v1.0)

The ZZZ coffee‑errand slice — the M0/M1 reference map and the seed golden case.

```json
{
  "schemaVersion": "1.0",
  "game": "Zenless_Zone_Zero",
  "pages": [
    {
      "id": "Schedule.Errands",
      "trigger": { "clf": "Schedule_Errands", "minConfidence": 0.90 },
      "guard": { "require": ["errands_container"] },
      "elements": {
        "errands_container": { "kind": "container", "detClass": "errands_container" },
        "action_card": {
          "kind": "container",
          "in": "errands_container",
          "detClass": "errand_card",
          "repeat": { "control": "horizontal_scroll" },
          "children": {
            "title": {
              "kind": "text",
              "relRect": [0.14, 0.12, 0.86, 0.27],
              "phraseTable": "zzz/errands@1"
            },
            "go_button": {
              "kind": "button",
              "detClass": "go_button",
              "associate": { "rule": "xColumn", "verticalToleranceRatio": 0.20 }
            }
          }
        }
      }
    }
  ],
  "flows": [
    {
      "id": "daily.coffee_errand",
      "nodes": [
        { "id": "start", "kind": "Start" },
        { "id": "seeErrands", "kind": "Observe", "page": "Schedule.Errands", "timeoutMs": 8000 },
        {
          "id": "hasCoffee",
          "kind": "Branch",
          "condition": {
            "type": "elementFound",
            "target": {
              "element": "action_card",
              "select": {
                "by": "ocrMatch", "child": "title",
                "phraseTable": "zzz/errands@1", "phrase": "Try 1 coffee", "minScore": 0.78
              }
            }
          }
        },
        {
          "id": "clickGo",
          "kind": "Act",
          "intent": {
            "type": "click",
            "target": {
              "element": "action_card",
              "select": {
                "by": "ocrMatch", "child": "title",
                "phraseTable": "zzz/errands@1", "phrase": "Try 1 coffee", "minScore": 0.78
              },
              "child": "go_button"
            }
          }
        },
        { "id": "done", "kind": "End", "outcome": "Completed" },
        { "id": "nothing", "kind": "End", "outcome": "NothingToDo" },
        { "id": "notFound", "kind": "End", "outcome": "Failed" }
      ],
      "edges": [
        { "from": "start", "to": "seeErrands", "on": "Next" },
        { "from": "seeErrands", "to": "hasCoffee", "on": "Next" },
        { "from": "seeErrands", "to": "notFound", "on": "Timeout" },
        { "from": "hasCoffee", "to": "clickGo", "on": "True" },
        { "from": "hasCoffee", "to": "nothing", "on": "False" },
        { "from": "hasCoffee", "to": "nothing", "on": "Indeterminate" },
        { "from": "clickGo", "to": "done", "on": "Next" }
      ]
    }
  ]
}
```

---

## 15. Validation rules (checklist for the M0 validator)

**Envelope**
1. `schemaVersion` present; MAJOR supported (§10).
2. `game` non‑empty; `pages.length >= 1`; `flows` is an array (may be empty).
3. No unknown fields anywhere (strict).

**Pages / elements**
4. Page ids unique; within a page, element names unique; a page has `>= 1`
   element.
5. `trigger.clf` non‑empty (string or non‑empty array); `minConfidence ∈ (0,1]`.
6. `guard.require` (if present) names existing elements in the same page.
7. Element `in` (if present) names an existing `container` in the same page; the
   parent graph is acyclic.
8. Field placement: `repeat`/`children` only on `container`; `associate` only on
   a child `button`/element that has `detClass`; `phraseTable` only on `text`;
   `marker` has `detClass`.
9. Location strategy resolvable: page‑root element has `detClass`; child has
   exactly one of (`relRect`) or (`detClass` + optional `associate`).
10. `relRect` = 4 numbers, each in `[-1,2]`, with `x0<x1`, `y0<y1`.
11. `phraseTable` refs match `^[^/]+/[^@]+@\d+$`.
12. `associate.verticalToleranceRatio` (if present) `>= 0`; `repeat.maxInstances`
    (if present) integer `>= 1`.

**Flows**
13. Flow ids unique; within a flow, node ids unique; exactly one `Start`.
14. Every edge `from`/`to` names an existing node; no edge `to` a `Start`; no
    edge `from` an `End`.
15. `on` valid for the `from` node kind (§8); required out‑edge sets satisfied:
    `Start`/`Act`/`Wait` exactly one `Next`; `Observe` exactly one `Next` and one
    `Timeout`; `Branch` exactly one each of `True`/`False`/`Indeterminate`.
16. `Observe.page` references an existing page; `timeoutMs`/`durationMs` are
    integers `> 0`.
17. Every node reachable from `Start`.

**ElementRef / Selector / Condition**
18. In every `ElementRef`, `element` exists in the page that the referencing
    node's `Observe` predecessor entered; `select` present **iff** that element
    has `repeat`; `child` (and `selector.child`) name existing children.
19. `minScore` / `minConfidence` / selector `minScore` ∈ `[0,1]`; selector
    `index >= 0`.
20. A `text` element referenced by any `ocrMatch` (condition or selector) has a
    `phraseTable` (or one is supplied inline in the ref — the ref's own
    `phraseTable` is authoritative).

Rules 1–17 and 19 are purely structural (checkable without a live workspace).
Rule 18 requires resolving the observed page per node (single‑`Observe`
dominator; if a node is reachable from two `Observe`s of different pages, the
validator errors — reserve multi‑page contexts for later).
```
