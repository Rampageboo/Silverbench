// UI Orchestrator preview interpreter (schema v1.0 §5/§7/§8/§9).
//
// A PURE interpreter of the declarative flow graph, run against real backend
// predictions. It is the editor's decision-preview engine and the shared
// conformance target for the golden suite (M4) — AutoHoyo's executor is the
// second interpreter of the same graph. It NEVER dispatches input; it only
// reports the decision + the intended click point.
//
// Fail-closed everywhere: undecidable vision → Indeterminate, never a guessed
// action (schema §9).

import type {
  Associate,
  ClfTrigger,
  Condition,
  DecisionResult,
  Element,
  Flow,
  Node,
  OcrRead,
  Page,
  Predictions,
  Selector,
  UiOrchestrationDoc
} from "./schema";

type Box = [number, number, number, number];
export type VisionDecision = "True" | "False" | "Indeterminate";
type Tri = VisionDecision;
type Resolution = { status: "resolved"; box: Box } | { status: "absent" } | { status: "indeterminate" };

type ElementInfo = { element: Element; parentName: string | null };
type PageIndex = Map<string, ElementInfo>;

const MAX_STEPS = 1000;

function center(box: Box): [number, number] {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}
function width(box: Box) {
  return box[2] - box[0];
}
function height(box: Box) {
  return box[3] - box[1];
}
function centerInside(region: Box, point: [number, number]) {
  return point[0] >= region[0] && point[0] <= region[2] && point[1] >= region[1] && point[1] <= region[3];
}

function indexPage(page: Page): PageIndex {
  const index: PageIndex = new Map();
  const visit = (record: Record<string, Element>, structuralParent: string | null) => {
    for (const [name, element] of Object.entries(record)) {
      index.set(name, { element, parentName: structuralParent ?? element.in ?? null });
      if (element.kind === "container" && element.children) visit(element.children, name);
    }
  };
  visit(page.elements, null);
  return index;
}

function detByClass(predictions: Predictions, cls: string): Box[] {
  return predictions.det.filter((det) => det.class === cls).map((det) => det.box);
}

function sortReadingOrder(boxes: Box[], control: string | undefined): Box[] {
  const arr = boxes.slice();
  if (control === "vertical_scroll") {
    arr.sort((a, b) => center(a)[1] - center(b)[1]);
  } else if (control === "horizontal_scroll") {
    arr.sort((a, b) => center(a)[0] - center(b)[0]);
  } else if (control === "grid") {
    arr.sort((a, b) => {
      const [, ay] = center(a);
      const [, by] = center(b);
      const rowTolerance = Math.max(height(a), height(b)) * 0.5;
      if (Math.abs(ay - by) > rowTolerance) return ay - by;
      return center(a)[0] - center(b)[0];
    });
  }
  // "none" / undefined → detection order
  return arr;
}

function subRect(parent: Box, rel: [number, number, number, number]): Box {
  const w = width(parent);
  const h = height(parent);
  return [parent[0] + rel[0] * w, parent[1] + rel[1] * h, parent[0] + rel[2] * w, parent[1] + rel[3] * h];
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const intersection = [...ta].filter((token) => tb.has(token)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? intersection / union : 0;
}

function ocrReadsIn(region: Box, ocr: OcrRead[]): OcrRead[] {
  return ocr.filter((read) => centerInside(region, center(read.box)));
}

function ocrBestScore(region: Box, phrase: string, ocr: OcrRead[]): { reads: number; score: number } {
  const reads = ocrReadsIn(region, ocr);
  let score = 0;
  for (const read of reads) score = Math.max(score, textSimilarity(read.text, phrase));
  return { reads: reads.length, score };
}

// Bind a detected child box to a single parent instance (schema §4.6). Returns
// the child box owned by `parent`, or null (fail-closed on ambiguous ties).
function bindByAssociate(parent: Box, children: Box[], associate: Associate | undefined): Box | null {
  const tolerance = associate?.verticalToleranceRatio ?? 0;
  const yLow = parent[1];
  const yHigh = parent[3] + tolerance * height(parent);
  const parentCenterX = center(parent)[0];
  const candidates: { box: Box; dx: number }[] = [];
  for (const child of children) {
    const [cx, cy] = center(child);
    const inColumn = cx >= parent[0] && cx <= parent[2];
    const inRows = cy >= yLow && cy <= yHigh;
    if (inColumn && inRows) candidates.push({ box: child, dx: Math.abs(cx - parentCenterX) });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dx - b.dx);
  if (candidates.length >= 2 && candidates[0].dx === candidates[1].dx) return null; // exact tie → no binding
  return candidates[0].box;
}

// Instance boxes of a page-root element (schema §5.1). Child elements are not
// resolved as top instances here — they are reached via ElementRef.child.
function topInstances(index: PageIndex, name: string, predictions: Predictions): Box[] | "indeterminate" {
  const info = index.get(name);
  if (!info || !info.element.detClass) return "indeterminate";
  let boxes = detByClass(predictions, info.element.detClass);
  if (info.element.kind === "container" && info.element.repeat) {
    boxes = sortReadingOrder(boxes, info.element.repeat.control);
    if (info.element.repeat.maxInstances) boxes = boxes.slice(0, info.element.repeat.maxInstances);
  }
  return boxes;
}

function childRegion(instanceBox: Box, childElement: Element): Box | null {
  if (childElement.relRect) return subRect(instanceBox, childElement.relRect);
  return null;
}

function selectInstance(
  instances: Box[],
  selector: Selector | undefined,
  index: PageIndex,
  predictions: Predictions
): Resolution {
  if (!selector) {
    return instances.length ? { status: "resolved", box: instances[0] } : { status: "absent" };
  }
  if (selector.by === "index") {
    if (selector.index < 0 || selector.index >= instances.length) return { status: "absent" };
    return { status: "resolved", box: instances[selector.index] };
  }
  // ocrMatch selector (schema §7)
  if (!predictions.ocr) return { status: "indeterminate" };
  const childInfo = index.get(selector.child);
  if (!childInfo) return { status: "indeterminate" };
  let best: { box: Box; score: number } | null = null;
  let anyReads = false;
  for (const instance of instances) {
    const region = childRegion(instance, childInfo.element);
    if (!region) continue;
    const { reads, score } = ocrBestScore(region, selector.phrase, predictions.ocr);
    if (reads > 0) anyReads = true;
    if (score >= selector.minScore && (!best || score > best.score)) best = { box: instance, score };
  }
  if (best) return { status: "resolved", box: best.box };
  return anyReads ? { status: "absent" } : { status: "indeterminate" };
}

function resolveChild(
  parentBox: Box,
  childElement: Element,
  predictions: Predictions
): Resolution {
  if (childElement.relRect) return { status: "resolved", box: subRect(parentBox, childElement.relRect) };
  if (childElement.detClass) {
    const detections = detByClass(predictions, childElement.detClass);
    if (detections.length === 0) return { status: "absent" };
    const associate = childElement.kind === "button" ? childElement.associate : undefined;
    const bound = bindByAssociate(parentBox, detections, associate);
    return bound ? { status: "resolved", box: bound } : { status: "absent" };
  }
  return { status: "indeterminate" };
}

function resolveRef(
  index: PageIndex,
  ref: { element: string; select?: Selector; child?: string },
  predictions: Predictions
): Resolution {
  const instances = topInstances(index, ref.element, predictions);
  if (instances === "indeterminate") return { status: "indeterminate" };
  const selected = selectInstance(instances, ref.select, index, predictions);
  if (selected.status !== "resolved") return selected;
  if (!ref.child) return selected;
  const childInfo = index.get(ref.child);
  if (!childInfo) return { status: "indeterminate" };
  return resolveChild(selected.box, childInfo.element, predictions);
}

function clfLabels(trigger: ClfTrigger): string[] {
  return Array.isArray(trigger.clf) ? trigger.clf : [trigger.clf];
}

function pageHolds(page: Page, index: PageIndex, predictions: Predictions): boolean {
  const { label, conf } = predictions.clf;
  if (!clfLabels(page.trigger).includes(label) || conf < page.trigger.minConfidence) return false;
  for (const name of page.guard?.require ?? []) {
    if (resolveRef(index, { element: name }, predictions).status !== "resolved") return false;
  }
  return true;
}

function evalCondition(condition: Condition, index: PageIndex, predictions: Predictions): Tri {
  if (condition.type === "elementFound") {
    const resolution = resolveRef(index, condition.target, predictions);
    if (resolution.status === "resolved") return "True";
    if (resolution.status === "absent") return "False";
    return "Indeterminate";
  }
  if (condition.type === "detPresent") {
    const element = index.get(condition.target.element)?.element;
    const cls = element?.detClass;
    if (!cls) return "Indeterminate";
    return predictions.det.some((det) => det.class === cls && det.conf >= condition.minConfidence)
      ? "True"
      : "False";
  }
  // ocrMatch condition (schema §9.1)
  if (!predictions.ocr) return "Indeterminate";
  const resolution = resolveRef(index, condition.target, predictions);
  if (resolution.status !== "resolved") return "Indeterminate";
  const { reads, score } = ocrBestScore(resolution.box, condition.phrase, predictions.ocr);
  if (reads === 0) return "Indeterminate";
  return score >= condition.minScore ? "True" : "False";
}

// Shared single-frame primitives used by the schema-2.0 temporal interpreter.
// Missing-channel handling stays in that interpreter; these helpers only run
// after it has proved that every required prediction channel is available.
export function evaluatePageSnapshot(page: Page, predictions: Predictions): "True" | "False" {
  return pageHolds(page, indexPage(page), predictions) ? "True" : "False";
}

export function evaluateConditionSnapshot(
  page: Page,
  condition: Condition,
  predictions: Predictions
): VisionDecision {
  return evalCondition(condition, indexPage(page), predictions);
}

export function interpretFlow(
  doc: UiOrchestrationDoc,
  flow: Flow,
  predictions: Predictions
): DecisionResult {
  const pages = new Map(doc.pages.map((page) => [page.id, page] as const));
  const nodes = new Map(flow.nodes.map((node) => [node.id, node] as const));
  const target = (from: string, on: string) => flow.edges.find((edge) => edge.from === from && edge.on === on)?.to;

  const trace: string[] = [];
  let intended: DecisionResult["intended"] | undefined;
  let observed: PageIndex | null = null;
  let current: Node | undefined = flow.nodes.find((node) => node.kind === "Start");
  if (!current) return { outcome: "Indeterminate", trace };

  for (let step = 0; step < MAX_STEPS && current; step += 1) {
    trace.push(current.id);
    const node: Node = current;
    switch (node.kind) {
      case "Start":
      case "Wait": {
        const to = target(node.id, "Next");
        current = to ? nodes.get(to) : undefined;
        break;
      }
      case "Observe": {
        const page = pages.get(node.page);
        const index = page ? indexPage(page) : null;
        if (page && index && pageHolds(page, index, predictions)) {
          observed = index;
          const to = target(node.id, "Next");
          current = to ? nodes.get(to) : undefined;
        } else {
          const to = target(node.id, "Timeout");
          current = to ? nodes.get(to) : undefined;
        }
        break;
      }
      case "Branch": {
        if (!observed) return { outcome: "Indeterminate", intended, trace };
        const tri = evalCondition(node.condition, observed, predictions);
        const to = target(node.id, tri);
        current = to ? nodes.get(to) : undefined;
        break;
      }
      case "Act": {
        if (!observed) return { outcome: "Indeterminate", intended, trace };
        const resolution = resolveRef(observed, node.intent.target, predictions);
        if (resolution.status !== "resolved") return { outcome: "Indeterminate", intended, trace };
        intended = {
          element: node.intent.target.child ?? node.intent.target.element,
          box: resolution.box,
          point: center(resolution.box)
        };
        const to = target(node.id, "Next");
        current = to ? nodes.get(to) : undefined;
        break;
      }
      case "End":
        return { outcome: node.outcome, intended, trace };
    }
  }
  return { outcome: "Indeterminate", intended, trace };
}

// Convenience: interpret a flow by id (or the first flow when omitted).
export function interpret(
  doc: UiOrchestrationDoc,
  predictions: Predictions,
  flowId?: string
): DecisionResult {
  const flow = flowId ? doc.flows.find((candidate) => candidate.id === flowId) : doc.flows[0];
  if (!flow) return { outcome: "Indeterminate", trace: [] };
  return interpretFlow(doc, flow, predictions);
}
