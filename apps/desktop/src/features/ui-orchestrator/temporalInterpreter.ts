import { evaluateConditionSnapshot, evaluatePageSnapshot, type VisionDecision } from "./previewInterpreter";
import type { Condition, Predictions } from "./schema";
import {
  validateDocV2,
  type ActionRequest,
  type ActionResultEvent,
  type CausalEvidence,
  type EndEvidence,
  type FrameEvent,
  type RuntimeOutcome,
  type TemporalActNode,
  type TemporalEdgeOutcome,
  type TemporalEvent,
  type TemporalFlow,
  type TemporalFrame,
  type TemporalNode,
  type TemporalObserveNode,
  type UiOrchestrationDocV2
} from "./schemaV2";

export type TemporalEngineStatus =
  | "Running"
  | "AwaitingAction"
  | RuntimeOutcome
  | "InvalidPlan"
  | "InvalidEvent";

export type TemporalTraceRecord =
  | { type: "node"; nodeId: string; atMs: number }
  | { type: "transition"; from: string; to: string; on: TemporalEdgeOutcome; atMs: number }
  | { type: "actionRequest"; nodeId: string; requestId: string; atMs: number }
  | { type: "diagnostic"; code: string; atMs: number; detail?: string }
  | { type: "terminal"; status: TemporalEngineStatus; atMs: number; nodeId?: string };

export interface TemporalTerminal {
  status: RuntimeOutcome | "InvalidPlan" | "InvalidEvent";
  outcome?: RuntimeOutcome;
  nodeId?: string;
  evidence?: CausalEvidence | { source: "abort"; reason: string };
  diagnostic?: {
    code: string;
    endNodeId?: string;
    declaredEvidence?: EndEvidence;
    actualEvidence?: CausalEvidence;
  };
}

export interface TemporalSnapshot {
  status: TemporalEngineStatus;
  currentNodeId?: string;
  pendingAction?: ActionRequest;
  emitted: ActionRequest[];
  terminal?: TemporalTerminal;
  trace: TemporalTraceRecord[];
}

interface ObserveProgress {
  nodeId: string;
  consecutiveFrames: number;
  firstMatchAtMs: number;
  lastMatchAtMs: number;
}

function eventTime(event: TemporalEvent) {
  return event.atMs;
}

function needsOcr(condition: Condition) {
  return (
    condition.type === "ocrMatch" ||
    (condition.type === "elementFound" && condition.target.select?.by === "ocrMatch")
  );
}

function toPredictions(frame: TemporalFrame, requireClf = true): Predictions | null {
  if (frame.det.status !== "ok" || (requireClf && frame.clf.status !== "ok")) return null;
  return {
    imageSize: frame.imageSize,
    det: frame.det.value,
    clf: frame.clf.status === "ok" ? frame.clf.value : { label: "", conf: 0 },
    ...(frame.ocr.status === "ok" ? { ocr: frame.ocr.value } : {})
  };
}

function pageDecision(
  doc: UiOrchestrationDocV2,
  node: TemporalObserveNode,
  event: FrameEvent
): VisionDecision {
  if (!event.frame || event.frame.clf.status !== "ok") return "Indeterminate";
  const page = doc.pages.find((candidate) => candidate.id === node.page);
  if (!page) return "Indeterminate";
  if ((page.guard?.require.length ?? 0) > 0 && event.frame.det.status !== "ok") {
    return "Indeterminate";
  }
  const predictions = toPredictions(event.frame);
  if (!predictions) {
    // A page with no DET guard does not need DET to prove the CLF trigger.
    if ((page.guard?.require.length ?? 0) === 0) {
      return evaluatePageSnapshot(page, {
        imageSize: event.frame.imageSize,
        det: [],
        clf: event.frame.clf.value
      });
    }
    return "Indeterminate";
  }
  return evaluatePageSnapshot(page, predictions);
}

function conditionDecision(
  doc: UiOrchestrationDocV2,
  pageId: string | undefined,
  condition: Condition,
  event: FrameEvent
): VisionDecision {
  if (!pageId || !event.frame || event.frame.det.status !== "ok") return "Indeterminate";
  if (needsOcr(condition) && event.frame.ocr.status !== "ok") return "Indeterminate";
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  const predictions = toPredictions(event.frame, false);
  if (!page || !predictions) return "Indeterminate";
  return evaluateConditionSnapshot(page, condition, predictions);
}

function evidenceMatches(declared: EndEvidence, actual: CausalEvidence | undefined) {
  if (!actual || declared.source !== actual.source || declared.nodeId !== actual.nodeId) return false;
  if (declared.source === "condition" && actual.source === "condition") {
    return declared.outcome === actual.outcome;
  }
  if (declared.source === "actionResult" && actual.source === "actionResult") {
    return (
      declared.status === actual.status && (declared.code === undefined || declared.code === actual.code)
    );
  }
  return declared.source === "timeout" && actual.source === "timeout";
}

export class TemporalInterpreter {
  private readonly doc: UiOrchestrationDocV2;
  private readonly flow?: TemporalFlow;
  private readonly nodes = new Map<string, TemporalNode>();
  private readonly trace: TemporalTraceRecord[] = [];
  private current?: TemporalNode;
  private currentEnteredAtMs?: number;
  private currentPageId?: string;
  private causalEvidence?: CausalEvidence;
  private pendingAction?: ActionRequest;
  private observeProgress?: ObserveProgress;
  private lastEventAtMs?: number;
  private lastFrameSeq?: number;
  private requestSequence = 0;
  private status: TemporalEngineStatus = "Running";
  private terminal?: TemporalTerminal;

  constructor(doc: UiOrchestrationDocV2, flowId?: string) {
    this.doc = doc;
    const validation = validateDocV2(doc);
    if (!validation.ok) {
      this.stopInvalidPlan(0, "DocumentValidationFailed");
      return;
    }
    this.flow = flowId ? doc.flows.find((candidate) => candidate.id === flowId) : doc.flows[0];
    if (!this.flow) {
      this.stopInvalidPlan(0, "FlowNotFound");
      return;
    }
    for (const node of this.flow.nodes) this.nodes.set(node.id, node);
    this.current = this.flow.nodes.find((node) => node.kind === "Start");
  }

  dispatch(event: TemporalEvent): TemporalSnapshot {
    const emitted: ActionRequest[] = [];
    if (this.terminal) return this.snapshot(emitted);

    const atMs = eventTime(event);
    if (
      !Number.isFinite(atMs) ||
      atMs < 0 ||
      (this.lastEventAtMs !== undefined && atMs < this.lastEventAtMs)
    ) {
      this.status = "InvalidEvent";
      this.terminal = {
        status: "InvalidEvent",
        diagnostic: { code: "NonMonotonicEventTime" }
      };
      this.trace.push({ type: "terminal", status: "InvalidEvent", atMs });
      return this.snapshot(emitted);
    }
    this.lastEventAtMs = atMs;

    if (event.type === "abort") {
      this.pendingAction = undefined;
      this.status = "Aborted";
      this.terminal = {
        status: "Aborted",
        outcome: "Aborted",
        evidence: { source: "abort", reason: event.reason }
      };
      this.trace.push({ type: "terminal", status: "Aborted", atMs });
      return this.snapshot(emitted);
    }

    if (event.type === "frame") {
      if (this.lastFrameSeq !== undefined && event.seq <= this.lastFrameSeq) {
        this.trace.push({
          type: "diagnostic",
          code: "StaleFrameIgnored",
          atMs,
          detail: `seq=${event.seq}`
        });
        return this.snapshot(emitted);
      }
      this.lastFrameSeq = event.seq;
    }
    if (event.type === "actionResult" && !this.pendingAction) {
      this.recordStaleActionResult(event);
    }

    this.advance(event, emitted);
    return this.snapshot(emitted);
  }

  getSnapshot(): TemporalSnapshot {
    return this.snapshot([]);
  }

  private snapshot(emitted: ActionRequest[]): TemporalSnapshot {
    return {
      status: this.status,
      currentNodeId: this.current?.id,
      pendingAction: this.pendingAction,
      emitted,
      terminal: this.terminal,
      trace: this.trace.slice()
    };
  }

  private enter(node: TemporalNode, atMs: number) {
    this.current = node;
    this.currentEnteredAtMs = atMs;
    this.trace.push({ type: "node", nodeId: node.id, atMs });
    if (node.kind !== "Observe") this.observeProgress = undefined;
  }

  private target(nodeId: string, on: TemporalEdgeOutcome) {
    const edge = this.flow?.edges.find((candidate) => candidate.from === nodeId && candidate.on === on);
    return edge ? this.nodes.get(edge.to) : undefined;
  }

  private transition(on: TemporalEdgeOutcome, atMs: number) {
    if (!this.current) {
      this.stopInvalidPlan(atMs, "CurrentNodeMissing");
      return false;
    }
    const from = this.current;
    const next = this.target(from.id, on);
    if (!next) {
      this.stopInvalidPlan(atMs, "TransitionMissing");
      return false;
    }
    this.trace.push({ type: "transition", from: from.id, to: next.id, on, atMs });
    this.enter(next, atMs);
    return true;
  }

  private advance(event: TemporalEvent, emitted: ActionRequest[]) {
    const atMs = eventTime(event);
    const observeNodesProcessed = new Set<string>();

    for (let step = 0; step < 1000 && this.current && !this.terminal; step += 1) {
      if (this.currentEnteredAtMs === undefined) this.enter(this.current, atMs);
      const node = this.current;
      const enteredAtMs = this.currentEnteredAtMs ?? atMs;

      if (node.kind === "Observe" && atMs - enteredAtMs > node.timeoutMs) {
        this.causalEvidence = { source: "timeout", nodeId: node.id };
        this.observeProgress = undefined;
        if (!this.transition("Timeout", atMs)) return;
        continue;
      }
      if (
        node.kind === "Act" &&
        this.pendingAction &&
        atMs - this.pendingAction.issuedAtMs > node.resultTimeoutMs
      ) {
        this.causalEvidence = { source: "timeout", nodeId: node.id };
        this.pendingAction = undefined;
        this.status = "Running";
        if (!this.transition("Timeout", atMs)) return;
        continue;
      }

      if (node.kind === "Start") {
        if (!this.transition("Next", atMs)) return;
        continue;
      }
      if (node.kind === "End") {
        if (!evidenceMatches(node.evidence, this.causalEvidence)) {
          this.status = "InvalidPlan";
          this.terminal = {
            status: "InvalidPlan",
            nodeId: node.id,
            diagnostic: {
              code: "TerminalEvidenceMismatch",
              endNodeId: node.id,
              declaredEvidence: node.evidence,
              actualEvidence: this.causalEvidence
            }
          };
          this.trace.push({ type: "terminal", status: "InvalidPlan", nodeId: node.id, atMs });
          return;
        }
        this.status = node.outcome;
        this.terminal = {
          status: node.outcome,
          outcome: node.outcome,
          nodeId: node.id,
          evidence: this.causalEvidence
        };
        this.trace.push({ type: "terminal", status: node.outcome, nodeId: node.id, atMs });
        return;
      }
      if (node.kind === "Wait") {
        if (atMs - enteredAtMs >= node.durationMs) {
          if (!this.transition("Next", atMs)) return;
          continue;
        }
        return;
      }
      if (node.kind === "Observe") {
        if (event.type !== "frame" || observeNodesProcessed.has(node.id)) return;
        observeNodesProcessed.add(node.id);
        const decision = pageDecision(this.doc, node, event);
        if (decision !== "True") {
          this.observeProgress = undefined;
          return;
        }
        const previous = this.observeProgress;
        const continues =
          previous?.nodeId === node.id && event.atMs - previous.lastMatchAtMs <= node.stability.maxFrameGapMs;
        this.observeProgress = continues
          ? {
              ...previous,
              consecutiveFrames: previous.consecutiveFrames + 1,
              lastMatchAtMs: event.atMs
            }
          : {
              nodeId: node.id,
              consecutiveFrames: 1,
              firstMatchAtMs: event.atMs,
              lastMatchAtMs: event.atMs
            };
        const stable =
          this.observeProgress.consecutiveFrames >= node.stability.minConsecutiveFrames &&
          event.atMs - this.observeProgress.firstMatchAtMs >= node.stability.minStableMs;
        if (!stable) return;
        this.currentPageId = node.page;
        this.observeProgress = undefined;
        if (!this.transition("Observed", atMs)) return;
        continue;
      }
      if (node.kind === "Decide") {
        if (event.type !== "frame") return;
        const decision = conditionDecision(this.doc, this.currentPageId, node.condition, event);
        this.causalEvidence = { source: "condition", nodeId: node.id, outcome: decision };
        if (!this.transition(decision, atMs)) return;
        continue;
      }
      if (node.kind === "Act") {
        if (!this.pendingAction) {
          this.requestSequence += 1;
          const request: ActionRequest = {
            requestId: `${this.flow!.id}:${node.id}:${this.requestSequence}`,
            flowId: this.flow!.id,
            nodeId: node.id,
            issuedAtMs: atMs,
            intent: node.intent
          };
          this.pendingAction = request;
          this.status = "AwaitingAction";
          emitted.push(request);
          this.trace.push({
            type: "actionRequest",
            nodeId: node.id,
            requestId: request.requestId,
            atMs
          });
          return;
        }
        if (event.type !== "actionResult") return;
        if (event.requestId !== this.pendingAction.requestId) {
          this.recordStaleActionResult(event);
          return;
        }
        this.causalEvidence = {
          source: "actionResult",
          nodeId: node.id,
          status: event.status,
          ...(event.code ? { code: event.code } : {})
        };
        this.pendingAction = undefined;
        this.status = "Running";
        if (!this.transition(event.status, atMs)) return;
        continue;
      }
    }
    if (!this.terminal) this.stopInvalidPlan(atMs, "ImmediateStepLimitExceeded");
  }

  private recordStaleActionResult(event: ActionResultEvent) {
    this.trace.push({
      type: "diagnostic",
      code: "StaleActionResultIgnored",
      atMs: event.atMs,
      detail: `requestId=${event.requestId}`
    });
  }

  private stopInvalidPlan(atMs: number, code: string) {
    this.status = "InvalidPlan";
    this.terminal = { status: "InvalidPlan", diagnostic: { code } };
    this.trace.push({ type: "terminal", status: "InvalidPlan", atMs });
  }
}

export function runTemporalTrace(
  doc: UiOrchestrationDocV2,
  events: TemporalEvent[],
  flowId?: string
): TemporalSnapshot {
  const interpreter = new TemporalInterpreter(doc, flowId);
  let snapshot = interpreter.getSnapshot();
  for (const event of events) snapshot = interpreter.dispatch(event);
  return snapshot;
}
