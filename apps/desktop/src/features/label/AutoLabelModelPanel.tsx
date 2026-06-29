import { useEffect, useState } from "react";
import {
  pickAndImportAutoLabelModel,
  readAutoLabelModelRegistry,
  type AutoLabelModelRegistry,
} from "../auto-label/autoLabelModelApi";
import { activeModelFilename } from "../auto-label/autoLabelModelRegistry";

type Props = {
  workspaceRoot: string;
};

export function AutoLabelModelPanel({ workspaceRoot }: Props) {
  const [registry, setRegistry] = useState<AutoLabelModelRegistry>({});
  const [importing, setImporting] = useState<"detect" | "classify" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) { setRegistry({}); return; }
    let cancelled = false;
    readAutoLabelModelRegistry(root)
      .then((r) => { if (!cancelled) setRegistry(r); })
      .catch(() => { if (!cancelled) setRegistry({}); });
    return () => { cancelled = true; };
  }, [workspaceRoot]);

  async function handleImport(kind: "detect" | "classify") {
    if (!workspaceRoot.trim()) return;
    setImporting(kind);
    setError(null);
    try {
      const updated = await pickAndImportAutoLabelModel(workspaceRoot, kind);
      if (updated) setRegistry(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(null);
    }
  }

  const detectName = activeModelFilename(registry.detect) ?? "Not set";
  const classifyName = activeModelFilename(registry.classify) ?? "Not set";
  const detectSet = !!registry.detect?.activeModel;
  const classifySet = !!registry.classify?.activeModel;

  return (
    <section className="alm-panel">
      <div className="alm-panel-label alm-panel-title">Auto Label Models</div>

      <div className="alm-panel-row">
        <div className="alm-panel-col">
          <div className="alm-panel-label">Detect model</div>
          <div className={`alm-panel-value${detectSet ? "" : " alm-panel-value--unset"}`} title={detectName}>
            {detectName}
          </div>
        </div>
        <button
          type="button"
          className="alm-panel-btn"
          disabled={importing !== null}
          aria-busy={importing === "detect" || undefined}
          onClick={() => { void handleImport("detect"); }}
        >
          {importing === "detect" ? "Importing…" : detectSet ? "Change" : "Import"}
        </button>
      </div>

      <div className="alm-panel-row">
        <div className="alm-panel-col">
          <div className="alm-panel-label">Classification model</div>
          <div className={`alm-panel-value${classifySet ? "" : " alm-panel-value--unset"}`} title={classifyName}>
            {classifyName}
          </div>
        </div>
        <button
          type="button"
          className="alm-panel-btn"
          disabled={importing !== null}
          aria-busy={importing === "classify" || undefined}
          onClick={() => { void handleImport("classify"); }}
        >
          {importing === "classify" ? "Importing…" : classifySet ? "Change" : "Import"}
        </button>
      </div>

      {error ? <div className="alm-panel-error">{error}</div> : null}
      <div className="alm-panel-hint">Used for Auto Label / proposal generation.</div>
    </section>
  );
}
