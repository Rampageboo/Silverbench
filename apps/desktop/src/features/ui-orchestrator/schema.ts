// UI Orchestrator schema v1.0 — normative type surface.
// Strict: no additional properties beyond those declared.

export interface UiOrchestrationDoc {
  schemaVersion: "1.0";
  game: string;
  metadata?: DocMetadata;
  pages: Page[];
  flows: Flow[];
}

export interface DocMetadata {
  author?: string;
  createdAt?: string;
  notes?: string;
}

export interface Page {
  id: string;
  trigger: ClfTrigger;
  guard?: Guard;
  elements: Record<string, Element>;
}
export interface ClfTrigger {
  clf: string | string[];
  minConfidence: number;
}
export interface Guard {
  require: string[];
}

export type Element = ContainerElement | ButtonElement | TextElement | MarkerElement;

interface ElementBase {
  in?: string;
  detClass?: string;
  relRect?: RelRect;
}
export interface ContainerElement extends ElementBase {
  kind: "container";
  repeat?: Repeat;
  children?: Record<string, Element>;
}
export interface ButtonElement extends ElementBase {
  kind: "button";
  associate?: Associate;
}
export interface TextElement extends ElementBase {
  kind: "text";
  phraseTable?: PhraseTableRef;
}
export interface MarkerElement extends ElementBase {
  kind: "marker";
}

export interface Repeat {
  control?: "horizontal_scroll" | "vertical_scroll" | "grid" | "none";
  maxInstances?: number;
}
export interface Associate {
  rule: "xColumn" | "containment";
  verticalToleranceRatio?: number;
}

export type RelRect = [number, number, number, number];
export type PhraseTableRef = string;

export interface Flow {
  id: string;
  nodes: Node[];
  edges: Edge[];
}

export type Node = StartNode | EndNode | ObserveNode | ActNode | BranchNode | WaitNode;
interface NodeBase {
  id: string;
}
export interface StartNode extends NodeBase {
  kind: "Start";
}
export interface EndNode extends NodeBase {
  kind: "End";
  outcome: EndOutcome;
}
export interface ObserveNode extends NodeBase {
  kind: "Observe";
  page: string;
  timeoutMs: number;
}
export interface ActNode extends NodeBase {
  kind: "Act";
  intent: Intent;
}
export interface BranchNode extends NodeBase {
  kind: "Branch";
  condition: Condition;
}
export interface WaitNode extends NodeBase {
  kind: "Wait";
  durationMs: number;
}

export type EndOutcome = "Completed" | "NothingToDo" | "Failed" | "Aborted";

export interface Edge {
  from: string;
  to: string;
  on: EdgeOutcome;
}
export type EdgeOutcome = "Next" | "True" | "False" | "Indeterminate" | "Timeout";

export type Intent = ClickIntent;
export interface ClickIntent {
  type: "click";
  target: ElementRef;
}

export interface ElementRef {
  element: string;
  select?: Selector;
  child?: string;
}
export type Selector =
  | { by: "index"; index: number }
  | { by: "ocrMatch"; child: string; phraseTable: PhraseTableRef; phrase: string; minScore: number };

export type Condition = ElementFoundCond | OcrMatchCond | DetPresentCond;
export interface ElementFoundCond {
  type: "elementFound";
  target: ElementRef;
}
export interface OcrMatchCond {
  type: "ocrMatch";
  target: ElementRef;
  phraseTable: PhraseTableRef;
  phrase: string;
  minScore: number;
}
export interface DetPresentCond {
  type: "detPresent";
  target: ElementRef;
  minConfidence: number;
}

// ── Predictions input (schema §12) — produced by the backend, consumed by the
// editor overlay and (M3) the preview interpreter. Boxes are pixels of the
// reference frame; `imageSize` is [w, h] px.
export interface DetBox {
  class: string;
  box: [number, number, number, number];
  conf: number;
}
export interface OcrRead {
  box: [number, number, number, number];
  text: string;
  conf: number;
}
export interface Predictions {
  imageSize: [number, number];
  det: DetBox[];
  clf: { label: string; conf: number; topK?: { label: string; conf: number }[] };
  ocr?: OcrRead[];
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type UnknownRecord = Record<string, unknown>;

type ElementInfo = {
  name: string;
  path: string;
  value: UnknownRecord;
  structuralParent: string | null;
  effectiveParent: string | null;
  children: Map<string, ElementInfo>;
};

type PageInfo = {
  id: string;
  path: string;
  elements: Map<string, ElementInfo>;
};

type RefUse = {
  nodeId: string;
  path: string;
  value: unknown;
  mode: "plain" | "ocr-condition" | "det-condition";
};

const PHRASE_TABLE_PATTERN = /^[^/]+\/[^@]+@\d+$/;
const SCHEMA_VERSION_PATTERN = /^(\d+)\.(\d+)$/;
const SUPPORTED_SCHEMA_MAJOR = 1;
const NO_PAGE = "\u0000";

const NODE_OUTCOMES: Record<string, readonly EdgeOutcome[]> = {
  Start: ["Next"],
  End: [],
  Observe: ["Next", "Timeout"],
  Act: ["Next"],
  Branch: ["True", "False", "Indeterminate"],
  Wait: ["Next"]
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: UnknownRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function expectRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  errors: string[]
): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} is an unknown field.`);
  }
  for (const key of required) {
    if (!hasOwn(value, key)) errors.push(`${path}.${key} is required.`);
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string.`);
    return false;
  }
  return true;
}

function validatePhraseTable(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "string" || !PHRASE_TABLE_PATTERN.test(value)) {
    errors.push(`${path} must match <namespace>/<name>@<integer-version>.`);
  }
}

function validateUnitInterval(value: unknown, path: string, errors: string[], includeZero: boolean) {
  if (!isFiniteNumber(value) || value > 1 || (includeZero ? value < 0 : value <= 0)) {
    errors.push(`${path} must be in ${includeZero ? "[0, 1]" : "(0, 1]"}.`);
  }
}

function validateMetadata(value: unknown, path: string, errors: string[]) {
  const metadata = expectRecord(value, path, ["author", "createdAt", "notes"], [], errors);
  if (!metadata) return;
  for (const key of ["author", "createdAt", "notes"] as const) {
    if (hasOwn(metadata, key) && typeof metadata[key] !== "string") {
      errors.push(`${path}.${key} must be a string.`);
    }
  }
  if (
    typeof metadata.createdAt === "string" &&
    (!metadata.createdAt.trim() || Number.isNaN(Date.parse(metadata.createdAt)))
  ) {
    errors.push(`${path}.createdAt must be an ISO-8601 timestamp.`);
  }
}

function validateTrigger(value: unknown, path: string, errors: string[]) {
  const trigger = expectRecord(value, path, ["clf", "minConfidence"], ["clf", "minConfidence"], errors);
  if (!trigger) return;
  if (typeof trigger.clf === "string") {
    if (!trigger.clf.trim()) errors.push(`${path}.clf must be non-empty.`);
  } else if (Array.isArray(trigger.clf)) {
    if (trigger.clf.length === 0) errors.push(`${path}.clf must contain at least one label.`);
    trigger.clf.forEach((label, index) => {
      if (typeof label !== "string" || !label.trim()) {
        errors.push(`${path}.clf[${index}] must be a non-empty string.`);
      }
    });
  } else {
    errors.push(`${path}.clf must be a string or an array of strings.`);
  }
  validateUnitInterval(trigger.minConfidence, `${path}.minConfidence`, errors, false);
}

function validateRelRect(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isFiniteNumber)) {
    errors.push(`${path} must be an array of four finite numbers.`);
    return;
  }
  const [x0, y0, x1, y1] = value;
  value.forEach((component, index) => {
    if (component < -1 || component > 2) {
      errors.push(`${path}[${index}] must be in [-1, 2].`);
    }
  });
  if (x0 >= x1) errors.push(`${path} must satisfy x0 < x1.`);
  if (y0 >= y1) errors.push(`${path} must satisfy y0 < y1.`);
}

function validateRepeat(value: unknown, path: string, errors: string[]) {
  const repeat = expectRecord(value, path, ["control", "maxInstances"], [], errors);
  if (!repeat) return;
  if (
    hasOwn(repeat, "control") &&
    !["horizontal_scroll", "vertical_scroll", "grid", "none"].includes(String(repeat.control))
  ) {
    errors.push(`${path}.control must be horizontal_scroll, vertical_scroll, grid, or none.`);
  }
  if (
    hasOwn(repeat, "maxInstances") &&
    (!Number.isInteger(repeat.maxInstances) || Number(repeat.maxInstances) < 1)
  ) {
    errors.push(`${path}.maxInstances must be an integer >= 1.`);
  }
}

function validateAssociate(value: unknown, path: string, errors: string[]) {
  const associate = expectRecord(value, path, ["rule", "verticalToleranceRatio"], ["rule"], errors);
  if (!associate) return;
  if (associate.rule !== "xColumn" && associate.rule !== "containment") {
    errors.push(`${path}.rule must be xColumn or containment.`);
  }
  if (
    hasOwn(associate, "verticalToleranceRatio") &&
    (!isFiniteNumber(associate.verticalToleranceRatio) || associate.verticalToleranceRatio < 0)
  ) {
    errors.push(`${path}.verticalToleranceRatio must be >= 0.`);
  }
}

function collectElement(
  name: string,
  value: unknown,
  path: string,
  structuralParent: string | null,
  allElements: Map<string, ElementInfo>,
  errors: string[]
): ElementInfo | null {
  if (!name.trim()) errors.push(`${path} has an empty element name.`);
  if (allElements.has(name)) {
    errors.push(`${path} duplicates element name "${name}" within the page.`);
  }

  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  const kind = value.kind;
  const common = ["kind", "in", "detClass", "relRect"];
  const variant =
    kind === "container"
      ? ["repeat", "children"]
      : kind === "button"
        ? ["associate"]
        : kind === "text"
          ? ["phraseTable"]
          : [];
  const element = expectRecord(value, path, [...common, ...variant], ["kind"], errors);
  if (!element) return null;
  if (!["container", "button", "text", "marker"].includes(String(kind))) {
    errors.push(`${path}.kind must be container, button, text, or marker.`);
  }

  if (hasOwn(element, "in")) expectNonEmptyString(element.in, `${path}.in`, errors);
  if (hasOwn(element, "detClass")) expectNonEmptyString(element.detClass, `${path}.detClass`, errors);
  if (hasOwn(element, "relRect")) validateRelRect(element.relRect, `${path}.relRect`, errors);
  if (hasOwn(element, "repeat")) validateRepeat(element.repeat, `${path}.repeat`, errors);
  if (hasOwn(element, "associate")) validateAssociate(element.associate, `${path}.associate`, errors);
  if (hasOwn(element, "phraseTable")) validatePhraseTable(element.phraseTable, `${path}.phraseTable`, errors);

  const explicitParent = typeof element.in === "string" && element.in.trim() ? element.in : null;
  if (structuralParent && explicitParent && structuralParent !== explicitParent) {
    errors.push(
      `${path}.in must match its containing parent "${structuralParent}" when the element is nested in children.`
    );
  }
  const info: ElementInfo = {
    name,
    path,
    value: element,
    structuralParent,
    effectiveParent: structuralParent ?? explicitParent,
    children: new Map()
  };
  if (!allElements.has(name)) allElements.set(name, info);

  if (hasOwn(element, "children")) {
    if (!isRecord(element.children)) {
      errors.push(`${path}.children must be an object keyed by child name.`);
    } else {
      if (Object.keys(element.children).length === 0) {
        errors.push(`${path}.children must contain at least one child when present.`);
      }
      for (const [childName, childValue] of Object.entries(element.children)) {
        const child = collectElement(
          childName,
          childValue,
          `${path}.children.${childName}`,
          name,
          allElements,
          errors
        );
        if (child) info.children.set(childName, child);
      }
    }
  }
  return info;
}

function validateElementGraph(page: PageInfo, errors: string[]) {
  for (const element of page.elements.values()) {
    const parentName = element.effectiveParent;
    if (parentName) {
      const parent = page.elements.get(parentName);
      if (!parent) {
        errors.push(`${element.path}.in references nonexistent element "${parentName}".`);
      } else if (parent.value.kind !== "container") {
        errors.push(
          `${element.path}.in must reference a container; "${parentName}" is ${String(parent.value.kind)}.`
        );
      }
    }

    const hasParent = Boolean(parentName);
    const hasRelRect = hasOwn(element.value, "relRect");
    const hasDetClass =
      typeof element.value.detClass === "string" && element.value.detClass.trim().length > 0;
    if (!hasParent) {
      if (!hasDetClass) errors.push(`${element.path} is page-root and must have detClass.`);
      if (hasRelRect) errors.push(`${element.path}.relRect is only valid for a child element.`);
    } else if (Number(hasRelRect) + Number(hasDetClass) !== 1) {
      errors.push(
        `${element.path} is a child and must have exactly one location strategy: relRect or detClass.`
      );
    }

    if (element.value.kind === "marker" && !hasDetClass) {
      errors.push(`${element.path} is a marker and must have detClass.`);
    }
    if (
      hasOwn(element.value, "associate") &&
      (!hasParent || !hasDetClass || element.value.kind !== "button")
    ) {
      errors.push(`${element.path}.associate is only valid on a detected child button.`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visiting.has(name)) {
      errors.push(`${page.path}.elements has a parent cycle involving "${name}".`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    const parent = page.elements.get(name)?.effectiveParent;
    if (parent && page.elements.has(parent)) visit(parent);
    visiting.delete(name);
    visited.add(name);
  };
  page.elements.forEach((_element, name) => visit(name));
}

function validatePage(value: unknown, index: number, errors: string[]): PageInfo | null {
  const path = `doc.pages[${index}]`;
  const page = expectRecord(
    value,
    path,
    ["id", "trigger", "guard", "elements"],
    ["id", "trigger", "elements"],
    errors
  );
  if (!page) return null;
  expectNonEmptyString(page.id, `${path}.id`, errors);
  validateTrigger(page.trigger, `${path}.trigger`, errors);

  const allElements = new Map<string, ElementInfo>();
  if (!isRecord(page.elements)) {
    errors.push(`${path}.elements must be an object keyed by element name.`);
  } else {
    if (Object.keys(page.elements).length === 0) {
      errors.push(`${path}.elements must contain at least one element.`);
    }
    for (const [name, element] of Object.entries(page.elements)) {
      collectElement(name, element, `${path}.elements.${name}`, null, allElements, errors);
    }
  }

  const info: PageInfo = {
    id: typeof page.id === "string" ? page.id : "",
    path,
    elements: allElements
  };
  validateElementGraph(info, errors);

  if (hasOwn(page, "guard")) {
    const guard = expectRecord(page.guard, `${path}.guard`, ["require"], ["require"], errors);
    if (guard) {
      if (!Array.isArray(guard.require)) {
        errors.push(`${path}.guard.require must be an array of element names.`);
      } else {
        guard.require.forEach((name, requireIndex) => {
          if (typeof name !== "string" || !name.trim()) {
            errors.push(`${path}.guard.require[${requireIndex}] must be a non-empty string.`);
          } else if (!allElements.has(name)) {
            errors.push(`${path}.guard.require references nonexistent element "${name}".`);
          }
        });
      }
    }
  }
  return info;
}

function validateSelector(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (value.by === "index") {
    const selector = expectRecord(value, path, ["by", "index"], ["by", "index"], errors);
    if (selector && (!Number.isInteger(selector.index) || Number(selector.index) < 0)) {
      errors.push(`${path}.index must be an integer >= 0.`);
    }
    return;
  }
  if (value.by === "ocrMatch") {
    const selector = expectRecord(
      value,
      path,
      ["by", "child", "phraseTable", "phrase", "minScore"],
      ["by", "child", "phraseTable", "phrase", "minScore"],
      errors
    );
    if (!selector) return;
    expectNonEmptyString(selector.child, `${path}.child`, errors);
    validatePhraseTable(selector.phraseTable, `${path}.phraseTable`, errors);
    expectNonEmptyString(selector.phrase, `${path}.phrase`, errors);
    validateUnitInterval(selector.minScore, `${path}.minScore`, errors, true);
    return;
  }
  expectRecord(value, path, ["by"], ["by"], errors);
  errors.push(`${path}.by must be index or ocrMatch.`);
}

function validateElementRefShape(value: unknown, path: string, errors: string[]) {
  const ref = expectRecord(value, path, ["element", "select", "child"], ["element"], errors);
  if (!ref) return;
  expectNonEmptyString(ref.element, `${path}.element`, errors);
  if (hasOwn(ref, "child")) expectNonEmptyString(ref.child, `${path}.child`, errors);
  if (hasOwn(ref, "select")) validateSelector(ref.select, `${path}.select`, errors);
}

function validateIntent(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (value.type !== "click") {
    expectRecord(value, path, ["type", "target"], ["type", "target"], errors);
    errors.push(`${path}.type must be click.`);
    return;
  }
  const intent = expectRecord(value, path, ["type", "target"], ["type", "target"], errors);
  if (intent) validateElementRefShape(intent.target, `${path}.target`, errors);
}

function validateCondition(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (value.type === "elementFound") {
    const condition = expectRecord(value, path, ["type", "target"], ["type", "target"], errors);
    if (condition) validateElementRefShape(condition.target, `${path}.target`, errors);
    return;
  }
  if (value.type === "ocrMatch") {
    const condition = expectRecord(
      value,
      path,
      ["type", "target", "phraseTable", "phrase", "minScore"],
      ["type", "target", "phraseTable", "phrase", "minScore"],
      errors
    );
    if (!condition) return;
    validateElementRefShape(condition.target, `${path}.target`, errors);
    validatePhraseTable(condition.phraseTable, `${path}.phraseTable`, errors);
    expectNonEmptyString(condition.phrase, `${path}.phrase`, errors);
    validateUnitInterval(condition.minScore, `${path}.minScore`, errors, true);
    return;
  }
  if (value.type === "detPresent") {
    const condition = expectRecord(
      value,
      path,
      ["type", "target", "minConfidence"],
      ["type", "target", "minConfidence"],
      errors
    );
    if (!condition) return;
    validateElementRefShape(condition.target, `${path}.target`, errors);
    validateUnitInterval(condition.minConfidence, `${path}.minConfidence`, errors, true);
    return;
  }
  expectRecord(value, path, ["type"], ["type"], errors);
  errors.push(`${path}.type must be elementFound, ocrMatch, or detPresent.`);
}

function validateNode(value: unknown, path: string, errors: string[]): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  const kind = value.kind;
  const extras =
    kind === "End"
      ? ["outcome"]
      : kind === "Observe"
        ? ["page", "timeoutMs"]
        : kind === "Act"
          ? ["intent"]
          : kind === "Branch"
            ? ["condition"]
            : kind === "Wait"
              ? ["durationMs"]
              : [];
  const required = ["id", "kind", ...extras];
  const node = expectRecord(value, path, ["id", "kind", ...extras], required, errors);
  if (!node) return null;
  expectNonEmptyString(node.id, `${path}.id`, errors);
  if (!["Start", "End", "Observe", "Act", "Branch", "Wait"].includes(String(kind))) {
    errors.push(`${path}.kind must be Start, End, Observe, Act, Branch, or Wait.`);
    return node;
  }
  if (kind === "End" && !["Completed", "NothingToDo", "Failed", "Aborted"].includes(String(node.outcome))) {
    errors.push(`${path}.outcome must be Completed, NothingToDo, Failed, or Aborted.`);
  }
  if (kind === "Observe") {
    expectNonEmptyString(node.page, `${path}.page`, errors);
    if (!Number.isInteger(node.timeoutMs) || Number(node.timeoutMs) <= 0) {
      errors.push(`${path}.timeoutMs must be an integer > 0.`);
    }
  }
  if (kind === "Wait" && (!Number.isInteger(node.durationMs) || Number(node.durationMs) <= 0)) {
    errors.push(`${path}.durationMs must be an integer > 0.`);
  }
  if (kind === "Act") validateIntent(node.intent, `${path}.intent`, errors);
  if (kind === "Branch") validateCondition(node.condition, `${path}.condition`, errors);
  return node;
}

function collectRefUses(node: UnknownRecord, path: string): RefUse[] {
  const nodeId = typeof node.id === "string" ? node.id : "";
  if (node.kind === "Act" && isRecord(node.intent)) {
    return [{ nodeId, path: `${path}.intent.target`, value: node.intent.target, mode: "plain" }];
  }
  if (node.kind === "Branch" && isRecord(node.condition)) {
    const mode =
      node.condition.type === "ocrMatch"
        ? "ocr-condition"
        : node.condition.type === "detPresent"
          ? "det-condition"
          : "plain";
    return [{ nodeId, path: `${path}.condition.target`, value: node.condition.target, mode }];
  }
  return [];
}

function validateElementRefSemantics(use: RefUse, page: PageInfo, errors: string[]) {
  if (!isRecord(use.value) || typeof use.value.element !== "string") return;
  const ref = use.value;
  const elementName = String(ref.element);
  const element = page.elements.get(elementName);
  if (!element) {
    errors.push(`${use.path}.element "${elementName}" does not exist in observed page "${page.id}".`);
    return;
  }

  const hasSelect = hasOwn(ref, "select");
  const isRepeat = hasOwn(element.value, "repeat");
  if (hasSelect !== isRepeat) {
    errors.push(
      `${use.path}.select must be ${isRepeat ? "present" : "absent"} because "${element.name}" ${
        isRepeat ? "has" : "does not have"
      } repeat.`
    );
  }

  const childName = typeof ref.child === "string" ? ref.child : null;
  const child = childName ? element.children.get(childName) : null;
  if (childName && !child) {
    errors.push(`${use.path}.child "${childName}" is not a child of "${element.name}".`);
  }

  if (isRecord(ref.select) && ref.select.by === "ocrMatch" && typeof ref.select.child === "string") {
    const selectorChild = element.children.get(ref.select.child);
    if (!selectorChild) {
      errors.push(`${use.path}.select.child "${ref.select.child}" is not a child of "${element.name}".`);
    } else if (selectorChild.value.kind !== "text") {
      errors.push(`${use.path}.select.child "${ref.select.child}" must reference a text element.`);
    } else if (!hasOwn(selectorChild.value, "phraseTable") && !hasOwn(ref.select, "phraseTable")) {
      errors.push(`${use.path}.select requires a phraseTable for text child "${ref.select.child}".`);
    }
  }

  if (use.mode === "ocr-condition") {
    const textTarget = child ?? element;
    if (textTarget.value.kind !== "text") {
      errors.push(`${use.path} must resolve to a text element for an ocrMatch condition.`);
    }
  }
}

function validateFlow(value: unknown, index: number, pages: Map<string, PageInfo>, errors: string[]): string {
  const path = `doc.flows[${index}]`;
  const flow = expectRecord(value, path, ["id", "nodes", "edges"], ["id", "nodes", "edges"], errors);
  if (!flow) return "";
  expectNonEmptyString(flow.id, `${path}.id`, errors);

  const nodes = new Map<string, UnknownRecord>();
  const nodePaths = new Map<string, string>();
  const refUses: RefUse[] = [];
  let startCount = 0;
  if (!Array.isArray(flow.nodes)) {
    errors.push(`${path}.nodes must be an array.`);
  } else {
    flow.nodes.forEach((rawNode, nodeIndex) => {
      const nodePath = `${path}.nodes[${nodeIndex}]`;
      const node = validateNode(rawNode, nodePath, errors);
      if (!node) return;
      const id = typeof node.id === "string" ? node.id : "";
      if (nodes.has(id)) errors.push(`${nodePath}.id duplicates node id "${id}" within the flow.`);
      else if (id) {
        nodes.set(id, node);
        nodePaths.set(id, nodePath);
      }
      if (node.kind === "Start") startCount += 1;
      if (node.kind === "Observe" && typeof node.page === "string" && !pages.has(node.page)) {
        errors.push(`${nodePath}.page references nonexistent page "${node.page}".`);
      }
      refUses.push(...collectRefUses(node, nodePath));
    });
  }
  if (startCount !== 1)
    errors.push(`${path}.nodes must contain exactly one Start node; found ${startCount}.`);

  const adjacency = new Map<string, UnknownRecord[]>();
  const outcomeCounts = new Map<string, Map<string, number>>();
  if (!Array.isArray(flow.edges)) {
    errors.push(`${path}.edges must be an array.`);
  } else {
    flow.edges.forEach((rawEdge, edgeIndex) => {
      const edgePath = `${path}.edges[${edgeIndex}]`;
      const edge = expectRecord(rawEdge, edgePath, ["from", "to", "on"], ["from", "to", "on"], errors);
      if (!edge) return;
      expectNonEmptyString(edge.from, `${edgePath}.from`, errors);
      expectNonEmptyString(edge.to, `${edgePath}.to`, errors);
      if (!["Next", "True", "False", "Indeterminate", "Timeout"].includes(String(edge.on))) {
        errors.push(`${edgePath}.on is not a valid edge outcome.`);
      }
      const from = typeof edge.from === "string" ? edge.from : "";
      const to = typeof edge.to === "string" ? edge.to : "";
      const fromNode = nodes.get(from);
      const toNode = nodes.get(to);
      if (!fromNode) errors.push(`${edgePath}.from references nonexistent node "${from}".`);
      if (!toNode) errors.push(`${edgePath}.to references nonexistent node "${to}".`);
      if (toNode?.kind === "Start") errors.push(`${edgePath} may not target a Start node.`);
      if (fromNode?.kind === "End") errors.push(`${edgePath} may not originate from an End node.`);
      if (fromNode) {
        const validOutcomes = NODE_OUTCOMES[String(fromNode.kind)] ?? [];
        if (!validOutcomes.includes(edge.on as EdgeOutcome)) {
          errors.push(`${edgePath}.on "${String(edge.on)}" is invalid for ${String(fromNode.kind)}.`);
        }
        const byOutcome = outcomeCounts.get(from) ?? new Map<string, number>();
        byOutcome.set(String(edge.on), (byOutcome.get(String(edge.on)) ?? 0) + 1);
        outcomeCounts.set(from, byOutcome);
        const outgoing = adjacency.get(from) ?? [];
        outgoing.push(edge);
        adjacency.set(from, outgoing);
      }
    });
  }

  for (const [id, node] of nodes) {
    const required = NODE_OUTCOMES[String(node.kind)] ?? [];
    const counts = outcomeCounts.get(id) ?? new Map<string, number>();
    for (const outcome of required) {
      const count = counts.get(outcome) ?? 0;
      if (count !== 1) {
        errors.push(`${nodePaths.get(id)} requires exactly one ${outcome} edge; found ${count}.`);
      }
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (node.kind === "End" && total !== 0) {
      errors.push(`${nodePaths.get(id)} is terminal and must not have outgoing edges.`);
    }
  }

  const start = [...nodes.values()].find((node) => node.kind === "Start");
  const startId = typeof start?.id === "string" ? start.id : "";
  if (startId) {
    const reachable = new Set<string>();
    const queue = [startId];
    while (queue.length) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of adjacency.get(current) ?? []) {
        if (typeof edge.to === "string" && nodes.has(edge.to)) queue.push(edge.to);
      }
    }
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) errors.push(`${nodePaths.get(id)} is unreachable from Start.`);
    }

    const contexts = new Map<string, Set<string>>();
    contexts.set(startId, new Set([NO_PAGE]));
    const contextQueue = [startId];
    const queued = new Set(contextQueue);
    while (contextQueue.length) {
      const current = contextQueue.shift()!;
      queued.delete(current);
      const node = nodes.get(current);
      if (!node) continue;
      const input = contexts.get(current) ?? new Set([NO_PAGE]);
      for (const edge of adjacency.get(current) ?? []) {
        if (typeof edge.to !== "string" || !nodes.has(edge.to)) continue;
        const output =
          node.kind === "Observe" && edge.on === "Next" && typeof node.page === "string"
            ? new Set([node.page])
            : input;
        const target = contexts.get(edge.to) ?? new Set<string>();
        const before = target.size;
        output.forEach((context) => target.add(context));
        contexts.set(edge.to, target);
        if (target.size !== before && !queued.has(edge.to)) {
          contextQueue.push(edge.to);
          queued.add(edge.to);
        }
      }
    }

    for (const use of refUses) {
      const nodeContexts = contexts.get(use.nodeId) ?? new Set([NO_PAGE]);
      const pageIds = [...nodeContexts].filter((pageId) => pageId !== NO_PAGE);
      if (nodeContexts.has(NO_PAGE) || pageIds.length === 0) {
        errors.push(`${use.path} has no single preceding successful Observe page on every path.`);
        continue;
      }
      const uniquePageIds = [...new Set(pageIds)];
      if (uniquePageIds.length !== 1) {
        errors.push(
          `${use.path} is reached from Observe nodes for different pages: ${uniquePageIds.join(", ")}.`
        );
        continue;
      }
      const observedPage = pages.get(uniquePageIds[0]);
      if (observedPage) validateElementRefSemantics(use, observedPage, errors);
    }
  }

  return typeof flow.id === "string" ? flow.id : "";
}

export function validateDoc(doc: unknown): ValidationResult {
  const errors: string[] = [];
  const envelope = expectRecord(
    doc,
    "doc",
    ["schemaVersion", "game", "metadata", "pages", "flows"],
    ["schemaVersion", "game", "pages", "flows"],
    errors
  );
  if (!envelope) return { ok: false, errors };

  if (typeof envelope.schemaVersion !== "string") {
    errors.push("doc.schemaVersion must be a MAJOR.MINOR string.");
  } else {
    const match = SCHEMA_VERSION_PATTERN.exec(envelope.schemaVersion);
    if (!match) {
      errors.push("doc.schemaVersion must be a MAJOR.MINOR string.");
    } else if (Number(match[1]) > SUPPORTED_SCHEMA_MAJOR) {
      errors.push(
        `doc.schemaVersion major ${match[1]} is unsupported; maximum supported major is ${SUPPORTED_SCHEMA_MAJOR}.`
      );
    } else if (envelope.schemaVersion !== "1.0") {
      errors.push('doc.schemaVersion must be exactly "1.0" for this closed validator.');
    }
  }
  expectNonEmptyString(envelope.game, "doc.game", errors);
  if (hasOwn(envelope, "metadata")) validateMetadata(envelope.metadata, "doc.metadata", errors);

  const pages = new Map<string, PageInfo>();
  if (!Array.isArray(envelope.pages)) {
    errors.push("doc.pages must be an array.");
  } else {
    if (envelope.pages.length === 0) errors.push("doc.pages must contain at least one page.");
    envelope.pages.forEach((page, index) => {
      const info = validatePage(page, index, errors);
      if (!info || !info.id) return;
      if (pages.has(info.id)) errors.push(`${info.path}.id duplicates page id "${info.id}".`);
      else pages.set(info.id, info);
    });
  }

  const flowIds = new Set<string>();
  if (!Array.isArray(envelope.flows)) {
    errors.push("doc.flows must be an array.");
  } else {
    envelope.flows.forEach((flow, index) => {
      const id = validateFlow(flow, index, pages, errors);
      if (!id) return;
      if (flowIds.has(id)) errors.push(`doc.flows[${index}].id duplicates flow id "${id}".`);
      else flowIds.add(id);
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
