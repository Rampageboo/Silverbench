import { validateDoc, type Condition, type ElementRef, type Page } from "./schema";

export interface UiOrchestrationDocV2 {
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
}

export interface ParameterDefinition {
  type: "string" | "integer";
  required?: boolean;
  default?: string | number;
}

export interface TemporalFlow {
  id: string;
  nodes: TemporalNode[];
  edges: TemporalEdge[];
}

export type TemporalNode =
  | TemporalStartNode
  | TemporalObserveNode
  | TemporalDecideNode
  | TemporalActNode
  | TemporalWaitNode
  | TemporalEndNode;

interface TemporalNodeBase {
  id: string;
}

export interface TemporalStartNode extends TemporalNodeBase {
  kind: "Start";
}

export interface TemporalObserveNode extends TemporalNodeBase {
  kind: "Observe";
  page: string;
  timeoutMs: number;
  stability: StabilityPolicy;
}

export interface StabilityPolicy {
  minConsecutiveFrames: number;
  minStableMs: number;
  maxFrameGapMs: number;
}

export interface TemporalDecideNode extends TemporalNodeBase {
  kind: "Decide";
  condition: Condition;
}

export interface TemporalActNode extends TemporalNodeBase {
  kind: "Act";
  intent: TemporalIntent;
  resultTimeoutMs: number;
}

export interface TemporalWaitNode extends TemporalNodeBase {
  kind: "Wait";
  durationMs: number;
}

export interface TemporalEndNode extends TemporalNodeBase {
  kind: "End";
  outcome: FlowEndOutcome;
  evidence: EndEvidence;
}

export type FlowEndOutcome = "Completed" | "NothingToDo" | "Failed";
export type RuntimeOutcome = FlowEndOutcome | "Aborted";

export type TemporalIntent = ClickIntentV2 | InputIntent | InvokeIntent;

export interface ClickIntentV2 {
  type: "click";
  target: ElementRef;
}

export interface InputIntent {
  type: "input";
  command: string;
}

export interface InvokeIntent {
  type: "invoke";
  op: string;
  arguments?: Record<string, ArgumentValue>;
}

export type ArgumentValue = string | number | boolean | null | ParameterReference;

export interface ParameterReference {
  parameter: string;
}

export type EndEvidence =
  | { source: "condition"; nodeId: string; outcome: "True" | "False" }
  | {
      source: "actionResult";
      nodeId: string;
      status: "Succeeded" | "Failed" | "Indeterminate";
      code?: string;
    }
  | { source: "timeout"; nodeId: string };

export interface TemporalEdge {
  from: string;
  to: string;
  on: TemporalEdgeOutcome;
}

export type TemporalEdgeOutcome =
  | "Next"
  | "Observed"
  | "True"
  | "False"
  | "Indeterminate"
  | "Succeeded"
  | "Failed"
  | "Timeout";

export interface ChannelOk<T> {
  status: "ok";
  value: T;
}

export interface ChannelMissing {
  status: "missing";
  reason?: string;
}

export type FrameChannel<T> = ChannelOk<T> | ChannelMissing;

export interface TemporalFrame {
  imageSize: [number, number];
  det: FrameChannel<Array<{ class: string; box: [number, number, number, number]; conf: number }>>;
  clf: FrameChannel<{ label: string; conf: number; topK?: Array<{ label: string; conf: number }> }>;
  ocr: FrameChannel<Array<{ box: [number, number, number, number]; text: string; conf: number }>>;
}

export interface FrameEvent {
  type: "frame";
  seq: number;
  atMs: number;
  frame?: TemporalFrame;
}

export interface ActionResultEvent {
  type: "actionResult";
  requestId: string;
  atMs: number;
  status: "Succeeded" | "Failed" | "Indeterminate";
  code?: string;
}

export interface TickEvent {
  type: "tick";
  atMs: number;
}

export interface AbortEvent {
  type: "abort";
  atMs: number;
  reason: string;
}

export type TemporalEvent = FrameEvent | ActionResultEvent | TickEvent | AbortEvent;

export interface ActionRequest {
  requestId: string;
  flowId: string;
  nodeId: string;
  issuedAtMs: number;
  intent: TemporalIntent;
}

export type CausalEvidence =
  | { source: "condition"; nodeId: string; outcome: "True" | "False" | "Indeterminate" }
  | {
      source: "actionResult";
      nodeId: string;
      status: "Succeeded" | "Failed" | "Indeterminate";
      code?: string;
    }
  | { source: "timeout"; nodeId: string };

export type TemporalValidationResult = { ok: true } | { ok: false; errors: string[] };

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const NAMESPACED_OPERATION_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

const NODE_OUTCOMES: Record<TemporalNode["kind"], readonly TemporalEdgeOutcome[]> = {
  Start: ["Next"],
  Observe: ["Observed", "Timeout"],
  Decide: ["True", "False", "Indeterminate"],
  Act: ["Succeeded", "Failed", "Indeterminate", "Timeout"],
  Wait: ["Next"],
  End: []
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: UnknownRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function expectId(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    errors.push(`${path} must be a non-empty identifier.`);
    return false;
  }
  return true;
}

function expectPositiveInteger(value: unknown, path: string, errors: string[], allowZero = false) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || Number(value) < minimum) {
    errors.push(`${path} must be an integer >= ${minimum}.`);
  }
}

function validateParameters(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("doc.parameters must be an object keyed by parameter name.");
    return;
  }
  for (const [name, rawDefinition] of Object.entries(value)) {
    expectId(name, `doc.parameters.${name}`, errors);
    const path = `doc.parameters.${name}`;
    const definition = expectRecord(rawDefinition, path, ["type", "required", "default"], ["type"], errors);
    if (!definition) continue;
    if (definition.type !== "string" && definition.type !== "integer") {
      errors.push(`${path}.type must be string or integer.`);
    }
    if (hasOwn(definition, "required") && typeof definition.required !== "boolean") {
      errors.push(`${path}.required must be boolean.`);
    }
    if (hasOwn(definition, "default")) {
      if (definition.type === "string" && typeof definition.default !== "string") {
        errors.push(`${path}.default must be a string.`);
      }
      if (
        definition.type === "integer" &&
        (!Number.isInteger(definition.default) || !Number.isFinite(definition.default))
      ) {
        errors.push(`${path}.default must be an integer.`);
      }
    }
    if (definition.required === true && hasOwn(definition, "default")) {
      errors.push(`${path} may not be required and also declare a default.`);
    }
  }
}

function validateStability(value: unknown, path: string, errors: string[]) {
  const stability = expectRecord(
    value,
    path,
    ["minConsecutiveFrames", "minStableMs", "maxFrameGapMs"],
    ["minConsecutiveFrames", "minStableMs", "maxFrameGapMs"],
    errors
  );
  if (!stability) return;
  expectPositiveInteger(stability.minConsecutiveFrames, `${path}.minConsecutiveFrames`, errors);
  expectPositiveInteger(stability.minStableMs, `${path}.minStableMs`, errors, true);
  expectPositiveInteger(stability.maxFrameGapMs, `${path}.maxFrameGapMs`, errors);
}

function validateElementRefShape(value: unknown, path: string, errors: string[]) {
  const target = expectRecord(value, path, ["element", "select", "child"], ["element"], errors);
  if (!target) return;
  expectId(target.element, `${path}.element`, errors);
  if (hasOwn(target, "child")) expectId(target.child, `${path}.child`, errors);
  if (!hasOwn(target, "select")) return;
  const select = expectRecord(
    target.select,
    `${path}.select`,
    ["by", "index", "child", "phraseTable", "phrase", "minScore"],
    ["by"],
    errors
  );
  if (!select) return;
  if (select.by === "index") {
    expectPositiveInteger(select.index, `${path}.select.index`, errors, true);
    for (const key of ["child", "phraseTable", "phrase", "minScore"]) {
      if (hasOwn(select, key)) errors.push(`${path}.select.${key} is invalid for an index selector.`);
    }
    return;
  }
  if (select.by === "ocrMatch") {
    for (const key of ["child", "phraseTable", "phrase"]) {
      if (typeof select[key] !== "string" || !String(select[key]).trim()) {
        errors.push(`${path}.select.${key} must be a non-empty string.`);
      }
    }
    if (
      typeof select.minScore !== "number" ||
      !Number.isFinite(select.minScore) ||
      select.minScore < 0 ||
      select.minScore > 1
    ) {
      errors.push(`${path}.select.minScore must be in [0, 1].`);
    }
    if (hasOwn(select, "index")) errors.push(`${path}.select.index is invalid for an ocrMatch selector.`);
    return;
  }
  errors.push(`${path}.select.by must be index or ocrMatch.`);
}

function validateArgumentValue(value: unknown, path: string, parameterNames: Set<string>, errors: string[]) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  const reference = expectRecord(value, path, ["parameter"], ["parameter"], errors);
  if (!reference) return;
  if (typeof reference.parameter !== "string" || !parameterNames.has(reference.parameter)) {
    errors.push(`${path}.parameter must reference a declared parameter.`);
  }
}

function validateIntent(value: unknown, path: string, parameterNames: Set<string>, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (value.type === "click") {
    const intent = expectRecord(value, path, ["type", "target"], ["type", "target"], errors);
    if (intent) validateElementRefShape(intent.target, `${path}.target`, errors);
    return;
  }
  if (value.type === "input") {
    const intent = expectRecord(value, path, ["type", "command"], ["type", "command"], errors);
    if (
      intent &&
      (typeof intent.command !== "string" || !NAMESPACED_OPERATION_PATTERN.test(intent.command))
    ) {
      errors.push(`${path}.command must be a namespaced logical command.`);
    }
    return;
  }
  if (value.type === "invoke") {
    const intent = expectRecord(value, path, ["type", "op", "arguments"], ["type", "op"], errors);
    if (!intent) return;
    if (typeof intent.op !== "string" || !NAMESPACED_OPERATION_PATTERN.test(intent.op)) {
      errors.push(`${path}.op must be a namespaced operation.`);
    }
    if (hasOwn(intent, "arguments")) {
      if (!isRecord(intent.arguments)) {
        errors.push(`${path}.arguments must be an object.`);
      } else {
        for (const [name, argument] of Object.entries(intent.arguments)) {
          expectId(name, `${path}.arguments.${name}`, errors);
          validateArgumentValue(argument, `${path}.arguments.${name}`, parameterNames, errors);
        }
      }
    }
    return;
  }
  expectRecord(value, path, ["type"], ["type"], errors);
  errors.push(`${path}.type must be click, input, or invoke.`);
}

function validateConditionShape(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const allowedByType: Record<string, readonly string[]> = {
    elementFound: ["type", "target"],
    ocrMatch: ["type", "target", "phraseTable", "phrase", "minScore"],
    detPresent: ["type", "target", "minConfidence"]
  };
  const allowed = allowedByType[String(value.type)];
  if (!allowed) {
    expectRecord(value, path, ["type"], ["type"], errors);
    errors.push(`${path}.type must be elementFound, ocrMatch, or detPresent.`);
    return;
  }
  const condition = expectRecord(value, path, allowed, allowed, errors);
  if (!condition) return;
  validateElementRefShape(condition.target, `${path}.target`, errors);
  if (value.type === "ocrMatch") {
    if (typeof condition.phraseTable !== "string" || !condition.phraseTable.trim()) {
      errors.push(`${path}.phraseTable must be a non-empty string.`);
    }
    if (typeof condition.phrase !== "string" || !condition.phrase.trim()) {
      errors.push(`${path}.phrase must be a non-empty string.`);
    }
    if (
      typeof condition.minScore !== "number" ||
      !Number.isFinite(condition.minScore) ||
      condition.minScore < 0 ||
      condition.minScore > 1
    ) {
      errors.push(`${path}.minScore must be in [0, 1].`);
    }
  }
  if (
    value.type === "detPresent" &&
    (typeof condition.minConfidence !== "number" ||
      !Number.isFinite(condition.minConfidence) ||
      condition.minConfidence <= 0 ||
      condition.minConfidence > 1)
  ) {
    errors.push(`${path}.minConfidence must be in (0, 1].`);
  }
}

function validateEvidence(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (value.source === "condition") {
    const evidence = expectRecord(
      value,
      path,
      ["source", "nodeId", "outcome"],
      ["source", "nodeId", "outcome"],
      errors
    );
    if (!evidence) return;
    expectId(evidence.nodeId, `${path}.nodeId`, errors);
    if (evidence.outcome !== "True" && evidence.outcome !== "False") {
      errors.push(`${path}.outcome must be True or False.`);
    }
    return;
  }
  if (value.source === "actionResult") {
    const evidence = expectRecord(
      value,
      path,
      ["source", "nodeId", "status", "code"],
      ["source", "nodeId", "status"],
      errors
    );
    if (!evidence) return;
    expectId(evidence.nodeId, `${path}.nodeId`, errors);
    if (!["Succeeded", "Failed", "Indeterminate"].includes(String(evidence.status))) {
      errors.push(`${path}.status must be Succeeded, Failed, or Indeterminate.`);
    }
    if (hasOwn(evidence, "code") && (typeof evidence.code !== "string" || !evidence.code.trim())) {
      errors.push(`${path}.code must be a non-empty string.`);
    }
    return;
  }
  if (value.source === "timeout") {
    const evidence = expectRecord(value, path, ["source", "nodeId"], ["source", "nodeId"], errors);
    if (evidence) expectId(evidence.nodeId, `${path}.nodeId`, errors);
    return;
  }
  expectRecord(value, path, ["source"], ["source"], errors);
  errors.push(`${path}.source must be condition, actionResult, or timeout.`);
}

function validateNode(
  value: unknown,
  path: string,
  parameterNames: Set<string>,
  errors: string[]
): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  const allowedByKind: Record<string, readonly string[]> = {
    Start: ["id", "kind"],
    Observe: ["id", "kind", "page", "timeoutMs", "stability"],
    Decide: ["id", "kind", "condition"],
    Act: ["id", "kind", "intent", "resultTimeoutMs"],
    Wait: ["id", "kind", "durationMs"],
    End: ["id", "kind", "outcome", "evidence"]
  };
  const allowed = allowedByKind[String(value.kind)];
  if (!allowed) {
    expectRecord(value, path, ["id", "kind"], ["id", "kind"], errors);
    errors.push(`${path}.kind must be Start, Observe, Decide, Act, Wait, or End.`);
    return value;
  }
  const node = expectRecord(value, path, allowed, allowed, errors);
  if (!node) return null;
  expectId(node.id, `${path}.id`, errors);
  if (node.kind === "Observe") {
    expectId(node.page, `${path}.page`, errors);
    expectPositiveInteger(node.timeoutMs, `${path}.timeoutMs`, errors);
    validateStability(node.stability, `${path}.stability`, errors);
  }
  if (node.kind === "Decide") validateConditionShape(node.condition, `${path}.condition`, errors);
  if (node.kind === "Act") {
    validateIntent(node.intent, `${path}.intent`, parameterNames, errors);
    expectPositiveInteger(node.resultTimeoutMs, `${path}.resultTimeoutMs`, errors);
  }
  if (node.kind === "Wait") {
    expectPositiveInteger(node.durationMs, `${path}.durationMs`, errors);
  }
  if (node.kind === "End") {
    if (!["Completed", "NothingToDo", "Failed"].includes(String(node.outcome))) {
      errors.push(`${path}.outcome must be Completed, NothingToDo, or Failed.`);
    }
    validateEvidence(node.evidence, `${path}.evidence`, errors);
  }
  return node;
}

function evidenceTransition(evidence: EndEvidence): { nodeId: string; on: TemporalEdgeOutcome } {
  if (evidence.source === "condition") return { nodeId: evidence.nodeId, on: evidence.outcome };
  if (evidence.source === "actionResult") return { nodeId: evidence.nodeId, on: evidence.status };
  return { nodeId: evidence.nodeId, on: "Timeout" };
}

function validateEndEvidenceSemantics(
  node: TemporalEndNode,
  nodes: Map<string, TemporalNode>,
  edges: TemporalEdge[],
  path: string,
  errors: string[]
) {
  const evidence = node.evidence;
  const source = nodes.get(evidence.nodeId);
  const expectedKind =
    evidence.source === "condition" ? "Decide" : evidence.source === "actionResult" ? "Act" : undefined;
  if (!source) {
    errors.push(`${path}.evidence.nodeId references nonexistent node "${evidence.nodeId}".`);
    return;
  }
  if (expectedKind && source.kind !== expectedKind) {
    errors.push(`${path}.evidence.nodeId must reference a ${expectedKind} node.`);
  }
  if (evidence.source === "timeout" && source.kind !== "Observe" && source.kind !== "Act") {
    errors.push(`${path}.evidence.nodeId for timeout must reference an Observe or Act node.`);
  }
  const transition = evidenceTransition(evidence);
  if (
    !edges.some((edge) => edge.from === transition.nodeId && edge.to === node.id && edge.on === transition.on)
  ) {
    errors.push(`${path}.evidence must describe the direct transition into End "${node.id}".`);
  }

  const allowed =
    node.outcome === "NothingToDo"
      ? evidence.source === "condition" && evidence.outcome === "False"
      : node.outcome === "Completed"
        ? (evidence.source === "condition" && evidence.outcome === "True") ||
          (evidence.source === "actionResult" && evidence.status === "Succeeded")
        : evidence.source === "timeout" ||
          (evidence.source === "actionResult" &&
            (evidence.status === "Failed" || evidence.status === "Indeterminate"));
  if (!allowed) {
    errors.push(`${path}.evidence is not permitted for outcome ${node.outcome}.`);
  }
}

function validateFlow(
  value: unknown,
  index: number,
  pageIds: Set<string>,
  parameterNames: Set<string>,
  errors: string[]
) {
  const path = `doc.flows[${index}]`;
  const flow = expectRecord(value, path, ["id", "nodes", "edges"], ["id", "nodes", "edges"], errors);
  if (!flow) return "";
  expectId(flow.id, `${path}.id`, errors);

  const nodes = new Map<string, TemporalNode>();
  const nodePaths = new Map<string, string>();
  let starts = 0;
  if (!Array.isArray(flow.nodes)) {
    errors.push(`${path}.nodes must be an array.`);
  } else {
    flow.nodes.forEach((rawNode, nodeIndex) => {
      const nodePath = `${path}.nodes[${nodeIndex}]`;
      const raw = validateNode(rawNode, nodePath, parameterNames, errors);
      if (!raw || typeof raw.id !== "string" || !raw.id) return;
      if (nodes.has(raw.id)) {
        errors.push(`${nodePath}.id duplicates node id "${raw.id}".`);
        return;
      }
      const node = raw as unknown as TemporalNode;
      nodes.set(node.id, node);
      nodePaths.set(node.id, nodePath);
      if (node.kind === "Start") starts += 1;
      if (node.kind === "Observe" && !pageIds.has(node.page)) {
        errors.push(`${nodePath}.page references nonexistent page "${node.page}".`);
      }
    });
  }
  if (starts !== 1) errors.push(`${path}.nodes must contain exactly one Start node; found ${starts}.`);

  const edges: TemporalEdge[] = [];
  const outgoing = new Map<string, Map<TemporalEdgeOutcome, TemporalEdge[]>>();
  const adjacency = new Map<string, string[]>();
  if (!Array.isArray(flow.edges)) {
    errors.push(`${path}.edges must be an array.`);
  } else {
    flow.edges.forEach((rawEdge, edgeIndex) => {
      const edgePath = `${path}.edges[${edgeIndex}]`;
      const edgeRecord = expectRecord(rawEdge, edgePath, ["from", "to", "on"], ["from", "to", "on"], errors);
      if (!edgeRecord) return;
      expectId(edgeRecord.from, `${edgePath}.from`, errors);
      expectId(edgeRecord.to, `${edgePath}.to`, errors);
      if (
        !["Next", "Observed", "True", "False", "Indeterminate", "Succeeded", "Failed", "Timeout"].includes(
          String(edgeRecord.on)
        )
      ) {
        errors.push(`${edgePath}.on is not a valid temporal edge outcome.`);
        return;
      }
      const edge = edgeRecord as unknown as TemporalEdge;
      edges.push(edge);
      const fromNode = nodes.get(edge.from);
      const toNode = nodes.get(edge.to);
      if (!fromNode) errors.push(`${edgePath}.from references nonexistent node "${edge.from}".`);
      if (!toNode) errors.push(`${edgePath}.to references nonexistent node "${edge.to}".`);
      if (toNode?.kind === "Start") errors.push(`${edgePath} may not target a Start node.`);
      if (fromNode?.kind === "End") errors.push(`${edgePath} may not originate from an End node.`);
      if (fromNode && !NODE_OUTCOMES[fromNode.kind].includes(edge.on)) {
        errors.push(`${edgePath}.on "${edge.on}" is invalid for ${fromNode.kind}.`);
      }
      const outcomes = outgoing.get(edge.from) ?? new Map();
      const matching = outcomes.get(edge.on) ?? [];
      matching.push(edge);
      outcomes.set(edge.on, matching);
      outgoing.set(edge.from, outcomes);
      const next = adjacency.get(edge.from) ?? [];
      next.push(edge.to);
      adjacency.set(edge.from, next);
    });
  }

  for (const node of nodes.values()) {
    const outcomes = outgoing.get(node.id) ?? new Map();
    for (const required of NODE_OUTCOMES[node.kind]) {
      const count = outcomes.get(required)?.length ?? 0;
      if (count !== 1) {
        errors.push(`${nodePaths.get(node.id)} requires exactly one ${required} edge; found ${count}.`);
      }
    }
    const count = [...outcomes.values()].reduce((sum, matches) => sum + matches.length, 0);
    if (node.kind === "End" && count !== 0) {
      errors.push(`${nodePaths.get(node.id)} is terminal and must not have outgoing edges.`);
    }
  }

  const start = [...nodes.values()].find((node) => node.kind === "Start");
  if (start) {
    const reachable = new Set<string>();
    const queue = [start.id];
    while (queue.length) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (nodes.has(next)) queue.push(next);
      }
    }
    for (const node of nodes.values()) {
      if (!reachable.has(node.id)) errors.push(`${nodePaths.get(node.id)} is unreachable from Start.`);
    }
  }

  for (const node of nodes.values()) {
    if (node.kind === "End") {
      validateEndEvidenceSemantics(node, nodes, edges, nodePaths.get(node.id) ?? `${path}.nodes`, errors);
    }
  }

  return typeof flow.id === "string" ? flow.id : "";
}

export function validateDocV2(doc: unknown): TemporalValidationResult {
  const errors: string[] = [];
  const envelope = expectRecord(
    doc,
    "doc",
    ["schemaVersion", "game", "metadata", "parameters", "pages", "flows"],
    ["schemaVersion", "game", "pages", "flows"],
    errors
  );
  if (!envelope) return { ok: false, errors };
  if (envelope.schemaVersion !== "2.0") errors.push('doc.schemaVersion must be exactly "2.0".');
  if (typeof envelope.game !== "string" || !envelope.game.trim()) {
    errors.push("doc.game must be a non-empty string.");
  }
  if (hasOwn(envelope, "parameters")) validateParameters(envelope.parameters, errors);

  // Schema 2.0 deliberately reuses the already-locked page/vision layer from
  // 1.0. Reusing its closed validator avoids a second implementation of page
  // geometry and binding semantics while the temporal flow evolves separately.
  const pageValidation = validateDoc({
    schemaVersion: "1.0",
    game: envelope.game,
    ...(hasOwn(envelope, "metadata") ? { metadata: envelope.metadata } : {}),
    pages: envelope.pages,
    flows: []
  });
  if (!pageValidation.ok) errors.push(...pageValidation.errors);

  const pageIds = new Set<string>();
  if (Array.isArray(envelope.pages)) {
    for (const page of envelope.pages) {
      if (isRecord(page) && typeof page.id === "string") pageIds.add(page.id);
    }
  }
  const parameterNames = new Set(isRecord(envelope.parameters) ? Object.keys(envelope.parameters) : []);
  const flowIds = new Set<string>();
  if (!Array.isArray(envelope.flows)) {
    errors.push("doc.flows must be an array.");
  } else {
    if (envelope.flows.length === 0) errors.push("doc.flows must contain at least one flow.");
    envelope.flows.forEach((flow, index) => {
      const id = validateFlow(flow, index, pageIds, parameterNames, errors);
      if (!id) return;
      if (flowIds.has(id)) errors.push(`doc.flows[${index}].id duplicates flow id "${id}".`);
      flowIds.add(id);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
