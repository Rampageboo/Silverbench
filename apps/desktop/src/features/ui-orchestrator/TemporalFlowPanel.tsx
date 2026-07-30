import { useEffect, useMemo, useState } from "react";
import casesJson from "./golden/v2/cases.json";
import coffeeJson from "./golden/v2/coffee-completion.json";
import farmJson from "./golden/v2/farm-single-run.json";
import contractJson from "./golden/v2/temporal-contract.json";
import { TemporalInterpreter, type TemporalSnapshot } from "./temporalInterpreter";
import { validateDocV2, type TemporalEvent, type TemporalFlow, type UiOrchestrationDocV2 } from "./schemaV2";

type GoldenCase = {
  name: string;
  map: string;
  flowId: string;
  events: TemporalEvent[];
};

type TemporalFlowPanelProps = {
  doc: UiOrchestrationDocV2;
  onChange: (doc: UiOrchestrationDocV2) => void;
  status: string;
  setStatus: (status: string) => void;
};

const templates: Record<string, UiOrchestrationDocV2> = {
  "Coffee completion": coffeeJson as unknown as UiOrchestrationDocV2,
  "Farm single run": farmJson as unknown as UiOrchestrationDocV2,
  "Temporal contract": contractJson as unknown as UiOrchestrationDocV2
};

const goldenCases = (casesJson as unknown as { cases: GoldenCase[] }).cases;

function pretty(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function nodeDetail(node: TemporalFlow["nodes"][number]) {
  if (node.kind === "Observe") {
    return `${node.page} · ${node.stability.minConsecutiveFrames} frames / ${node.stability.minStableMs} ms`;
  }
  if (node.kind === "Decide") return node.condition.type;
  if (node.kind === "Act") {
    if (node.intent.type === "click") return `click ${node.intent.target.element}`;
    if (node.intent.type === "input") return node.intent.command;
    return node.intent.op;
  }
  if (node.kind === "Wait") return `${node.durationMs} ms`;
  if (node.kind === "End") return `${node.outcome} · ${node.evidence.source}`;
  return "entry";
}

export function TemporalFlowPanel({ doc, onChange, status, setStatus }: TemporalFlowPanelProps) {
  const [source, setSource] = useState(() => pretty(doc));
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [flowId, setFlowId] = useState(doc.flows[0]?.id ?? "");
  const [caseName, setCaseName] = useState(goldenCases[0]?.name ?? "");
  const [eventsSource, setEventsSource] = useState(() => pretty(goldenCases[0]?.events ?? []));
  const [result, setResult] = useState<TemporalSnapshot | null>(null);

  useEffect(() => {
    setSource(pretty(doc));
    if (!doc.flows.some((flow) => flow.id === flowId)) setFlowId(doc.flows[0]?.id ?? "");
    setResult(null);
  }, [doc, flowId]);

  const activeFlow = useMemo(
    () => doc.flows.find((flow) => flow.id === flowId) ?? doc.flows[0],
    [doc.flows, flowId]
  );

  function applySource() {
    try {
      const parsed = JSON.parse(source) as unknown;
      const validation = validateDocV2(parsed);
      if (!validation.ok) {
        setSourceErrors(validation.errors);
        setStatus(`Schema 2.0 validation failed with ${validation.errors.length} errors.`);
        return;
      }
      const next = parsed as UiOrchestrationDocV2;
      setSourceErrors([]);
      onChange(next);
      setFlowId(next.flows[0]?.id ?? "");
      setStatus("Applied a valid schema 2.0 temporal document.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceErrors([`JSON parse failed: ${message}`]);
      setStatus("Temporal JSON could not be parsed.");
    }
  }

  function loadTemplate(name: string) {
    const template = templates[name];
    if (!template) return;
    const next = structuredClone(template);
    onChange(next);
    setFlowId(next.flows[0]?.id ?? "");
    setSourceErrors([]);
    setStatus(`Loaded the ${name} schema 2.0 template.`);
  }

  function selectGolden(name: string) {
    setCaseName(name);
    const selected = goldenCases.find((candidate) => candidate.name === name);
    if (!selected) return;
    setEventsSource(pretty(selected.events));
    const templateName =
      selected.map === "coffee-completion.json"
        ? "Coffee completion"
        : selected.map === "farm-single-run.json"
          ? "Farm single run"
          : "Temporal contract";
    loadTemplate(templateName);
    setFlowId(selected.flowId);
  }

  function replay() {
    let events: TemporalEvent[];
    try {
      const parsed = JSON.parse(eventsSource) as unknown;
      if (!Array.isArray(parsed)) throw new Error("event stream must be a JSON array");
      events = parsed as TemporalEvent[];
    } catch (error) {
      setStatus(`Temporal replay failed: ${error instanceof Error ? error.message : String(error)}.`);
      return;
    }
    const validation = validateDocV2(doc);
    if (!validation.ok) {
      setSourceErrors(validation.errors);
      setStatus("Fix schema 2.0 validation errors before replay.");
      return;
    }
    const interpreter = new TemporalInterpreter(doc, activeFlow?.id);
    let snapshot = interpreter.getSnapshot();
    for (const event of events) snapshot = interpreter.dispatch(event);
    setResult(snapshot);
    setStatus(`Replayed ${events.length} event${events.length === 1 ? "" : "s"} · ${snapshot.status}.`);
  }

  return (
    <div className="uio-temporal-panel">
      <div className="uio-temporal-toolbar">
        <div>
          <span className="uio-panel-kicker">Schema 2.0</span>
          <strong>Temporal state-machine workbench</strong>
        </div>
        <div className="uio-temporal-template-actions">
          {Object.keys(templates).map((name) => (
            <button key={name} type="button" onClick={() => loadTemplate(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <p className="uio-temporal-status" role="status">
        {status}
      </p>

      <div className="uio-temporal-grid">
        <section className="uio-panel uio-temporal-source">
          <div className="uio-panel-heading">
            <div>
              <span className="uio-panel-kicker">Author</span>
              <strong>Validated document</strong>
            </div>
            <button type="button" className="primary" onClick={applySource}>
              Apply JSON
            </button>
          </div>
          <textarea
            aria-label="Temporal document JSON"
            spellCheck={false}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
          {sourceErrors.length ? (
            <ol className="uio-temporal-errors">
              {sourceErrors.map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ol>
          ) : (
            <p className="uio-temporal-ok">Closed validator · no schema errors.</p>
          )}
        </section>

        <section className="uio-panel uio-temporal-graph-panel">
          <div className="uio-panel-heading">
            <div>
              <span className="uio-panel-kicker">Inspect</span>
              <strong>Decision graph</strong>
            </div>
            <select
              aria-label="Temporal flow"
              value={activeFlow?.id ?? ""}
              onChange={(event) => setFlowId(event.target.value)}
            >
              {doc.flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.id}
                </option>
              ))}
            </select>
          </div>
          <div className="uio-temporal-graph">
            {activeFlow?.nodes.map((node) => {
              const outgoing = activeFlow.edges.filter((edge) => edge.from === node.id);
              return (
                <article key={node.id} className={`uio-temporal-node kind-${node.kind.toLowerCase()}`}>
                  <div>
                    <span>{node.kind}</span>
                    <strong>{node.id}</strong>
                    <small>{nodeDetail(node)}</small>
                  </div>
                  {outgoing.length ? (
                    <ul>
                      {outgoing.map((edge) => (
                        <li key={`${edge.from}-${edge.on}`}>
                          <code>{edge.on}</code>
                          <span>→ {edge.to}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <em>terminal</em>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="uio-panel uio-temporal-replay">
          <div className="uio-panel-heading">
            <div>
              <span className="uio-panel-kicker">Simulate</span>
              <strong>Ordered temporal events</strong>
            </div>
            <button type="button" className="primary" onClick={replay}>
              Replay
            </button>
          </div>
          <label className="uio-field">
            <span>Golden event stream</span>
            <select value={caseName} onChange={(event) => selectGolden(event.target.value)}>
              {goldenCases.map((golden) => (
                <option key={golden.name} value={golden.name}>
                  {golden.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="Temporal event stream JSON"
            spellCheck={false}
            value={eventsSource}
            onChange={(event) => setEventsSource(event.target.value)}
          />
        </section>

        <section className="uio-panel uio-temporal-result">
          <div className="uio-panel-heading">
            <div>
              <span className="uio-panel-kicker">Result</span>
              <strong>{result?.status ?? "Not replayed"}</strong>
            </div>
            {result?.currentNodeId ? <code>{result.currentNodeId}</code> : null}
          </div>
          {result ? (
            <>
              <dl>
                <div>
                  <dt>Action requests</dt>
                  <dd>{result.trace.filter((record) => record.type === "actionRequest").length}</dd>
                </div>
                <div>
                  <dt>Trace records</dt>
                  <dd>{result.trace.length}</dd>
                </div>
                <div>
                  <dt>Terminal evidence</dt>
                  <dd>{result.terminal?.evidence?.source ?? "—"}</dd>
                </div>
              </dl>
              <ol className="uio-temporal-trace">
                {result.trace.map((record, index) => (
                  <li key={`${record.type}-${index}`}>
                    <code>{record.type}</code>
                    <span>{JSON.stringify(record)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="uio-empty-copy">
              Replay a golden or edited event stream. This simulator emits intent only and never dispatches
              input.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
