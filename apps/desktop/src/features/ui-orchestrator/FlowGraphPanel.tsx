import { useMemo, useState } from "react";
import { interpretFlow } from "./previewInterpreter";
import {
  validateDoc,
  type DecisionResult,
  type Flow,
  type Node,
  type Predictions,
  type UiOrchestrationDoc
} from "./schema";

type FlowGraphPanelProps = {
  doc: UiOrchestrationDoc;
  activeFlowId: string | null;
  predictions: Predictions | null;
  onChange: (updater: (doc: UiOrchestrationDoc) => UiOrchestrationDoc) => void;
  onSelectFlow: (id: string) => void;
  onDecision: (decision: DecisionResult | null) => void;
  setStatus: (status: string) => void;
};

const NODE_KINDS: Node["kind"][] = ["Start", "Observe", "Branch", "Act", "Wait", "End"];
const END_OUTCOMES = ["Completed", "NothingToDo", "Failed", "Aborted"] as const;

// Valid out-edge outcomes per source node kind (schema §8).
const OUTCOMES_BY_KIND: Record<Node["kind"], string[]> = {
  Start: ["Next"],
  Observe: ["Next", "Timeout"],
  Branch: ["True", "False", "Indeterminate"],
  Act: ["Next"],
  Wait: ["Next"],
  End: []
};

function newNode(kind: Node["kind"], id: string): Node {
  switch (kind) {
    case "Start":
      return { id, kind };
    case "End":
      return { id, kind, outcome: "Completed" };
    case "Observe":
      return { id, kind, page: "", timeoutMs: 8000 };
    case "Act":
      return { id, kind, intent: { type: "click", target: { element: "" } } };
    case "Branch":
      return { id, kind, condition: { type: "elementFound", target: { element: "" } } };
    case "Wait":
      return { id, kind, durationMs: 1000 };
  }
}

export function FlowGraphPanel({
  doc,
  activeFlowId,
  predictions,
  onChange,
  onSelectFlow,
  onDecision,
  setStatus
}: FlowGraphPanelProps) {
  const flow = useMemo(
    () => doc.flows.find((candidate) => candidate.id === activeFlowId) ?? doc.flows[0] ?? null,
    [doc.flows, activeFlowId]
  );
  const [errors, setErrors] = useState<string[]>([]);

  const updateFlow = (updater: (flow: Flow) => Flow) => {
    if (!flow) return;
    onChange((current) => ({
      ...current,
      flows: current.flows.map((candidate) => (candidate.id === flow.id ? updater(candidate) : candidate))
    }));
  };

  const addFlow = () => {
    const base = "flow";
    const ids = new Set(doc.flows.map((candidate) => candidate.id));
    let id = base;
    let suffix = doc.flows.length + 1;
    while (ids.has(id)) id = `${base}.${suffix++}`;
    const created: Flow = { id, nodes: [{ id: "start", kind: "Start" }], edges: [] };
    onChange((current) => ({ ...current, flows: [...current.flows, created] }));
    onSelectFlow(id);
  };

  const deleteFlow = () => {
    if (!flow) return;
    onChange((current) => ({
      ...current,
      flows: current.flows.filter((candidate) => candidate.id !== flow.id)
    }));
    onDecision(null);
  };

  const renameFlow = (id: string) => {
    if (!flow) return;
    updateFlow((current) => ({ ...current, id }));
    onSelectFlow(id);
  };

  const addNode = (kind: Node["kind"]) => {
    updateFlow((current) => {
      const ids = new Set(current.nodes.map((node) => node.id));
      let index = current.nodes.length + 1;
      let id = `n${index}`;
      while (ids.has(id)) id = `n${++index}`;
      return { ...current, nodes: [...current.nodes, newNode(kind, id)] };
    });
  };

  const updateNode = (id: string, patch: Record<string, unknown>) => {
    updateFlow((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? ({ ...node, ...patch } as Node) : node))
    }));
  };

  const renameNode = (oldId: string, newId: string) => {
    if (!newId.trim() || oldId === newId) return;
    updateFlow((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === oldId ? ({ ...node, id: newId } as Node) : node)),
      edges: current.edges.map((edge) => ({
        ...edge,
        from: edge.from === oldId ? newId : edge.from,
        to: edge.to === oldId ? newId : edge.to
      }))
    }));
  };

  const deleteNode = (id: string) => {
    updateFlow((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.from !== id && edge.to !== id)
    }));
  };

  const patchJsonField = (id: string, field: "intent" | "condition", raw: string) => {
    try {
      const value = JSON.parse(raw);
      updateNode(id, { [field]: value } as Partial<Node>);
      setStatus(`Updated ${field} of ${id}.`);
    } catch (error) {
      setStatus(`Invalid JSON for ${id}.${field}: ${(error as Error).message}`);
    }
  };

  const addEdge = () => {
    updateFlow((current) => ({
      ...current,
      edges: [
        ...current.edges,
        { from: current.nodes[0]?.id ?? "", to: current.nodes[0]?.id ?? "", on: "Next" }
      ]
    }));
  };

  const updateEdge = (index: number, patch: Partial<Flow["edges"][number]>) => {
    updateFlow((current) => ({
      ...current,
      edges: current.edges.map((edge, edgeIndex) => (edgeIndex === index ? { ...edge, ...patch } : edge))
    }));
  };

  const deleteEdge = (index: number) => {
    updateFlow((current) => ({
      ...current,
      edges: current.edges.filter((_edge, edgeIndex) => edgeIndex !== index)
    }));
  };

  const validate = () => {
    const result = validateDoc(doc);
    setErrors(result.ok ? [] : result.errors);
    setStatus(
      result.ok ? "Document is valid against schema 1.0." : `Validation failed (${result.errors.length}).`
    );
    return result.ok;
  };

  const runPreview = () => {
    if (!flow) return;
    if (!validate()) {
      onDecision(null);
      return;
    }
    if (!predictions) {
      setStatus("Run model predictions (Pages view) before previewing the decision.");
      onDecision(null);
      return;
    }
    const decision = interpretFlow(doc, flow, predictions);
    onDecision(decision);
    const intent = decision.intended ? ` → click ${decision.intended.element}` : "";
    setStatus(`Decision: ${decision.outcome}${intent}. Trace: ${decision.trace.join(" → ")}`);
  };

  if (!flow) {
    return (
      <aside className="uio-panel uio-flow-panel">
        <div className="uio-panel-heading">
          <div>
            <strong>Flows</strong>
          </div>
          <button type="button" onClick={addFlow}>
            + Flow
          </button>
        </div>
        <p className="uio-empty-copy">No flows yet.</p>
      </aside>
    );
  }

  return (
    <aside className="uio-panel uio-flow-panel">
      <div className="uio-panel-heading">
        <div>
          <strong>Flow graph</strong>
        </div>
        <button type="button" onClick={addFlow}>
          + Flow
        </button>
      </div>

      <div className="uio-flow-select">
        <select value={flow.id} onChange={(event) => onSelectFlow(event.target.value)}>
          {doc.flows.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.id}
            </option>
          ))}
        </select>
        <button type="button" className="danger-link" onClick={deleteFlow}>
          Delete
        </button>
      </div>

      <label className="uio-field">
        <span>Flow id</span>
        <input value={flow.id} onChange={(event) => renameFlow(event.target.value)} />
      </label>

      <div className="uio-section">
        <div className="uio-section-title">
          <strong>Nodes</strong>
        </div>
        <div className="uio-node-add">
          {NODE_KINDS.map((kind) => (
            <button type="button" key={kind} onClick={() => addNode(kind)}>
              + {kind}
            </button>
          ))}
        </div>
        <div className="uio-node-list">
          {flow.nodes.map((node) => (
            <div className="uio-node-card" key={node.id}>
              <div className="uio-node-head">
                <span className="uio-node-kind">{node.kind}</span>
                <input
                  className="uio-node-id"
                  defaultValue={node.id}
                  key={`id-${node.id}`}
                  onBlur={(event) => renameNode(node.id, event.target.value.trim())}
                />
                <button type="button" className="danger-link" onClick={() => deleteNode(node.id)}>
                  ✕
                </button>
              </div>
              {node.kind === "Observe" ? (
                <div className="uio-node-fields">
                  <select
                    value={node.page}
                    onChange={(event) => updateNode(node.id, { page: event.target.value })}
                  >
                    <option value="">— page —</option>
                    {doc.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.id}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={node.timeoutMs}
                    onChange={(event) => updateNode(node.id, { timeoutMs: Number(event.target.value) })}
                  />
                </div>
              ) : null}
              {node.kind === "End" ? (
                <div className="uio-node-fields">
                  <select
                    value={node.outcome}
                    onChange={(event) => updateNode(node.id, { outcome: event.target.value })}
                  >
                    {END_OUTCOMES.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {outcome}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {node.kind === "Wait" ? (
                <div className="uio-node-fields">
                  <input
                    type="number"
                    min="1"
                    value={node.durationMs}
                    onChange={(event) => updateNode(node.id, { durationMs: Number(event.target.value) })}
                  />
                </div>
              ) : null}
              {node.kind === "Act" ? (
                <textarea
                  className="uio-node-json"
                  defaultValue={JSON.stringify(node.intent, null, 2)}
                  key={`intent-${node.id}`}
                  spellCheck={false}
                  onBlur={(event) => patchJsonField(node.id, "intent", event.target.value)}
                />
              ) : null}
              {node.kind === "Branch" ? (
                <textarea
                  className="uio-node-json"
                  defaultValue={JSON.stringify(node.condition, null, 2)}
                  key={`condition-${node.id}`}
                  spellCheck={false}
                  onBlur={(event) => patchJsonField(node.id, "condition", event.target.value)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="uio-section">
        <div className="uio-section-title">
          <strong>Edges</strong>
          <button type="button" onClick={addEdge}>
            + Edge
          </button>
        </div>
        <div className="uio-edge-list">
          {flow.edges.map((edge, index) => {
            const fromNode = flow.nodes.find((node) => node.id === edge.from);
            const outcomes = fromNode ? OUTCOMES_BY_KIND[fromNode.kind] : ["Next"];
            return (
              <div className="uio-edge-row" key={`edge-${index}`}>
                <select
                  value={edge.from}
                  onChange={(event) => updateEdge(index, { from: event.target.value })}
                >
                  {flow.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id}
                    </option>
                  ))}
                </select>
                <select
                  value={edge.on}
                  onChange={(event) =>
                    updateEdge(index, { on: event.target.value as Flow["edges"][number]["on"] })
                  }
                >
                  {(outcomes.length ? outcomes : ["Next"]).map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {outcome}
                    </option>
                  ))}
                </select>
                <select value={edge.to} onChange={(event) => updateEdge(index, { to: event.target.value })}>
                  {flow.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id}
                    </option>
                  ))}
                </select>
                <button type="button" className="danger-link" onClick={() => deleteEdge(index)}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="uio-section">
        <div className="uio-section-title">
          <strong>Decision preview</strong>
          <button type="button" className="primary" onClick={runPreview}>
            Run preview
          </button>
        </div>
        {errors.length ? (
          <ol className="uio-flow-errors">
            {errors.map((error, index) => (
              <li key={`${error}-${index}`}>{error}</li>
            ))}
          </ol>
        ) : null}
      </div>
    </aside>
  );
}
