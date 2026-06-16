import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import type { WorkspaceInfo } from "../../api";
import {
  datasetRootForTask,
  ensureTrainPrepDataYaml,
  loadTrainPrepWorkspace,
  moveTrainPrepValBackToTrain,
  prepareTrainPrepValidationSplit,
  type DatasetTask,
  type TrainPrepResult
} from "./trainPrepApi";

type TrainPrepPageProps = {
  onReady?: () => void;
};

type LoadState = {
  info: WorkspaceInfo | null;
  detectFiles: string[];
  classifyFiles: string[];
};

const DEFAULT_LOAD_STATE: LoadState = {
  info: null,
  detectFiles: [],
  classifyFiles: []
};

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0.15;
  return Math.max(0.05, Math.min(0.4, value));
}

function resultSummary(result: TrainPrepResult) {
  const lines = [result.message || (result.ok ? "Operation finished." : "Operation failed.")];
  if (typeof result.moved === "number") lines.push(`Moved: ${result.moved}`);
  if (typeof result.skipped === "number" && result.skipped > 0) lines.push(`Skipped: ${result.skipped}`);
  if (result.dataYaml?.updated?.length) lines.push(`data.yaml updated: ${result.dataYaml.updated.join(", ")}`);
  if (result.yamlWarning) lines.push(`Warning: ${result.yamlWarning}`);
  if (result.failures?.length) lines.push(`Failures:\n${result.failures.slice(0, 8).join("\n")}`);
  return lines.filter(Boolean).join("\n");
}

function countFiles(files: string[], prefix: string) {
  return files.filter((path) => path.startsWith(prefix)).length;
}

function detectStats(files: string[]) {
  return {
    trainImages: countFiles(files, "images/train/"),
    valImages: countFiles(files, "images/val/"),
    trainLabels: countFiles(files, "labels/train/"),
    valLabels: countFiles(files, "labels/val/"),
    yaml: files.includes("data.yaml")
  };
}

function classifyStats(files: string[]) {
  return {
    trainImages: files.filter((path) => path.startsWith("train/") && !path.endsWith("/")).length,
    valImages: files.filter((path) => path.startsWith("val/") && !path.endsWith("/")).length,
    classes: new Set(
      files
        .filter((path) => path.startsWith("train/") || path.startsWith("val/"))
        .map((path) => path.split("/")[1])
        .filter(Boolean)
    ).size
  };
}

export function TrainPrepPage({ onReady }: TrainPrepPageProps) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const [task, setTask] = useState<DatasetTask>("detect");
  const [ratio, setRatio] = useState(0.15);
  const [state, setState] = useState<LoadState>(DEFAULT_LOAD_STATE);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Open a workspace to prepare train/val data.");
  const [log, setLog] = useState("");

  const showError = useCallback(
    (err: unknown) => showToast(errMessage(err), { variant: "error" }),
    [showToast]
  );

  const refresh = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setState(DEFAULT_LOAD_STATE);
      setStatus("Open a workspace to prepare train/val data.");
      onReady?.();
      return;
    }
    setLoading(true);
    try {
      const next = await loadTrainPrepWorkspace(workspaceRoot);
      setState(next);
      setStatus(`Workspace: ${next.info.name || next.info.root}`);
      onReady?.();
    } catch (err) {
      setState(DEFAULT_LOAD_STATE);
      setStatus(errMessage(err));
      showError(err);
      onReady?.();
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot, onReady, showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const datasetRoot = useMemo(() => datasetRootForTask(state.info, task), [state.info, task]);
  const currentFiles = task === "classify" ? state.classifyFiles : state.detectFiles;
  const detect = detectStats(state.detectFiles);
  const classify = classifyStats(state.classifyFiles);
  const pending = loading || running;

  const runOperation = useCallback(
    async (label: string, operation: () => Promise<TrainPrepResult>) => {
      if (!datasetRoot) {
        showToast("Open a workspace before running Dataset Prep.", { variant: "error" });
        return;
      }
      setRunning(true);
      setStatus(label);
      setLog("");
      try {
        const result = await operation();
        const summary = resultSummary(result);
        setLog(summary);
        setStatus(result.ok === false ? "Finished with warnings" : "Finished");
        showToast(result.message || label, { variant: result.ok === false ? "error" : "info" });
        await refresh();
      } catch (err) {
        const message = errMessage(err);
        setLog(message);
        setStatus(message);
        showError(err);
      } finally {
        setRunning(false);
      }
    },
    [datasetRoot, refresh, showError, showToast]
  );

  function handleCreateValSplit() {
    const safeRatio = clampRatio(ratio);
    const percent = Math.round(safeRatio * 100);
    const confirmed = window.confirm(
      task === "classify"
        ? `Create classification validation split?\n\nThis moves about ${percent}% of images from train/<class> to val/<class>. Existing val files stop the operation.`
        : `Create detection validation split?\n\nThis moves about ${percent}% of image/label pairs from images/train + labels/train to val. Existing val files stop the operation.`
    );
    if (!confirmed) return;
    void runOperation("Creating validation split...", () => prepareTrainPrepValidationSplit(datasetRoot, task, safeRatio));
  }

  function handleFixDataYaml() {
    void runOperation("Fixing data.yaml...", () => ensureTrainPrepDataYaml(datasetRoot));
  }

  function handleMoveValBack() {
    const confirmed = window.confirm(
      task === "classify"
        ? "Move classification val images back to train?"
        : "Move detection images/val and labels/val back to train?"
    );
    if (!confirmed) return;
    void runOperation("Moving val back to train...", () => moveTrainPrepValBackToTrain(datasetRoot, task));
  }

  return (
    <main className="train-prep-native-page">
      <section className="panel">
        <div className="panel-header">
          <span>Dataset Prep</span>
          <span className="status">{status}</span>
        </div>
        <div className="panel-body">
          <div className="row">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={pending}>
              Open Workspace
            </button>
            <button type="button" onClick={() => refresh()} disabled={pending || !workspaceRoot.trim()}>
              Refresh
            </button>
          </div>

          <div className="grid two">
            <label>
              Task
              <select value={task} onChange={(event) => setTask(event.target.value as DatasetTask)} disabled={pending}>
                <option value="detect">Detect dataset</option>
                <option value="classify">Classification dataset</option>
              </select>
            </label>
            <label>
              Validation ratio
              <input
                type="number"
                min="0.05"
                max="0.4"
                step="0.01"
                value={ratio}
                onChange={(event) => setRatio(clampRatio(Number(event.target.value)))}
                disabled={pending}
              />
            </label>
          </div>

          <label>
            Dataset root
            <input value={datasetRoot || ""} readOnly placeholder="Open a workspace first" />
          </label>

          <div className="row">
            <button type="button" onClick={handleCreateValSplit} disabled={pending || !datasetRoot}>
              Create Val Split
            </button>
            <button type="button" onClick={handleFixDataYaml} disabled={pending || !datasetRoot || task !== "detect"}>
              Fix data.yaml
            </button>
            <button type="button" onClick={handleMoveValBack} disabled={pending || !datasetRoot}>
              Move Val Back to Train
            </button>
          </div>

          <div className="hint">
            Create Val Split is destructive: it moves files on disk. Existing val files stop the split to avoid accidental mixing.
            Fix data.yaml applies to detection datasets only.
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span>Dataset status</span>
          <span className="status">{currentFiles.length} indexed file(s)</span>
        </div>
        <div className="panel-body">
          <div className="grid two">
            <div className="info-card">
              <strong>Detect</strong>
              <p>train images: {detect.trainImages}</p>
              <p>val images: {detect.valImages}</p>
              <p>train labels: {detect.trainLabels}</p>
              <p>val labels: {detect.valLabels}</p>
              <p>data.yaml: {detect.yaml ? "present" : "missing"}</p>
            </div>
            <div className="info-card">
              <strong>Classification</strong>
              <p>train images: {classify.trainImages}</p>
              <p>val images: {classify.valImages}</p>
              <p>classes: {classify.classes}</p>
            </div>
          </div>
          <pre className="log">{log || (loading ? "Loading dataset status..." : "No operation run yet.")}</pre>
        </div>
      </section>
    </main>
  );
}
