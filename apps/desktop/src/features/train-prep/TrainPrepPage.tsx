import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { LogPanel } from "../../components/workbench/LogPanel";
import { useRunWithConfirm } from "../../components/workbench/useRunWithConfirm";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import type { WorkspaceInfo } from "../../api";
import { runBuildYoloLinksJob } from "../inbox/buildJob";
import {
  datasetRootForTask,
  ensureTrainPrepDataYaml,
  getTrainingStatus,
  loadTrainPrepWorkspace,
  moveTrainPrepValBackToTrain,
  nextTrainingFilenames,
  nextTrainingStarCount,
  prepareTrainPrepValidationSplit,
  startTraining,
  stopTraining,
  trainingStreamUrl,
  type DatasetTask,
  type TrainPrepMetadataRow,
  type TrainPrepResult
} from "./trainPrepApi";
import "./trainPrep.css";

type TrainPrepPageProps = {
  onReady?: () => void;
};

type LoadState = {
  info: WorkspaceInfo | null;
  detectFiles: string[];
  classifyFiles: string[];
  metadataRows: TrainPrepMetadataRow[];
};

type CmdMode = "train" | "continue" | "export";
type TrainPhase = "idle" | "running" | "done" | "error" | "stopped";

function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const DEFAULT_LOAD_STATE: LoadState = {
  info: null,
  detectFiles: [],
  classifyFiles: [],
  metadataRows: []
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
    trainImages: files.filter((p) => p.startsWith("train/") && !p.endsWith("/")).length,
    valImages: files.filter((p) => p.startsWith("val/") && !p.endsWith("/")).length,
    classes: new Set(
      files
        .filter((p) => p.startsWith("train/") || p.startsWith("val/"))
        .map((p) => p.split("/")[1])
        .filter(Boolean)
    ).size
  };
}

function shellArg(s: string) {
  if (!s) return '""';
  if (/[ "'\\]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function toPosix(p: string) {
  return p.replace(/\\/g, "/");
}

function StatRow({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="tp-stat-row">
      <span className="tp-stat-label">{label}</span>
      <span className={`tp-stat-value${accent ? " tp-stat-accent" : ""}`}>{value}</span>
    </div>
  );
}

export function TrainPrepPage({ onReady }: TrainPrepPageProps) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const runWithConfirm = useRunWithConfirm();

  // Dataset split state
  const [task, setTask] = useState<DatasetTask>("detect");
  const [ratio, setRatio] = useState(0.15);
  const [state, setState] = useState<LoadState>(DEFAULT_LOAD_STATE);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [opStatus, setOpStatus] = useState("");
  const [log, setLog] = useState("");

  // Training execution state
  const [trainPhase, setTrainPhase] = useState<TrainPhase>("idle");
  const [trainLines, setTrainLines] = useState<string[]>([]);
  const [trainExitCode, setTrainExitCode] = useState<number | null>(null);
  const [trainElapsed, setTrainElapsed] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Generate command state
  const [cmdMode, setCmdMode] = useState<CmdMode>("train");
  const [cmdModel, setCmdModel] = useState("");
  const [cmdEpochs, setCmdEpochs] = useState(100);
  const [cmdBatch, setCmdBatch] = useState(16);
  const [cmdImgsz, setCmdImgsz] = useState(640);
  const [cmdDevice, setCmdDevice] = useState("0");
  const [cmdWorkers, setCmdWorkers] = useState(8);
  const [cmdProject, setCmdProject] = useState("");
  const [cmdName, setCmdName] = useState("train");
  const [copied, setCopied] = useState(false);

  const showError = useCallback(
    (err: unknown) => showToast(errMessage(err), { variant: "error" }),
    [showToast]
  );

  // Auto-scroll training log
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [trainLines, autoScroll]);

  // Training SSE connection
  const connectStream = useCallback((resuming: boolean) => {
    esRef.current?.close();
    if (!resuming) {
      setTrainLines([]);
      setTrainExitCode(null);
    }
    setTrainPhase("running");
    startTimeRef.current = Date.now();
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setTrainElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    const es = new EventSource(trainingStreamUrl());
    esRef.current = es;

    es.onmessage = (e) => {
      setTrainLines((prev) => [...prev, e.data as string]);
    };

    es.addEventListener("done", (e) => {
      const code = parseInt((e as MessageEvent<string>).data, 10);
      setTrainExitCode(code);
      setTrainPhase(code === 0 ? "done" : "error");
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
      es.close();
      esRef.current = null;
    });

    es.onerror = () => {
      // SSE closed (process ended or network drop); phase will be set by "done" event or left as-is
      es.close();
      esRef.current = null;
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    };
  }, []);

  // On mount: check if training is already running
  useEffect(() => {
    let cancelled = false;
    getTrainingStatus().then((status) => {
      if (cancelled) return;
      if (status.running) {
        connectStream(true);
      } else if (status.lineCount > 0) {
        setTrainLines([]);
        setTrainExitCode(status.exitCode ?? null);
        setTrainPhase(
          status.exitCode === 0 ? "done" : status.stopped ? "stopped" : status.exitCode != null ? "error" : "idle"
        );
        // Replay the buffer once to show prior output
        connectStream(false);
      }
    }).catch(() => { /* backend not yet started */ });
    return () => {
      cancelled = true;
      esRef.current?.close();
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [connectStream]);

  async function handleStartTraining() {
    setTrainLines([]);
    setTrainExitCode(null);
    setTrainElapsed(0);
    const result = await startTraining(generatedCommand).catch((err: unknown) => ({
      ok: false as const,
      message: errMessage(err)
    }));
    if (!result.ok) {
      showToast(result.message ?? "Failed to start training", { variant: "error" });
      return;
    }
    connectStream(false);
  }

  async function handleStopTraining() {
    const result = await stopTraining().catch(() => ({ ok: false, message: "Request failed" }));
    if (result.ok) {
      setTrainPhase("stopped");
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    } else {
      showToast(result.message ?? "Failed to stop", { variant: "error" });
    }
  }

  const refresh = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setState(DEFAULT_LOAD_STATE);
      setOpStatus("");
      onReady?.();
      return;
    }
    setLoading(true);
    try {
      const next = await loadTrainPrepWorkspace(workspaceRoot);
      setState(next);
      onReady?.();
    } catch (err) {
      setState(DEFAULT_LOAD_STATE);
      showError(err);
      onReady?.();
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot, onReady, showError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const datasetRoot = useMemo(
    () => datasetRootForTask(state.info, task),
    [state.info, task]
  );
  const detect = detectStats(state.detectFiles);
  const classify = classifyStats(state.classifyFiles);
  const totalFiles = state.detectFiles.length + state.classifyFiles.length;
  const starredCount = nextTrainingStarCount(state.metadataRows);
  const readyNextTraining = useMemo(
    () => nextTrainingFilenames(state.metadataRows, task),
    [state.metadataRows, task]
  );
  const pending = loading || running;

  // Auto-generated YOLO command
  const generatedCommand = useMemo(() => {
    const model = cmdModel.trim() || (task === "classify" ? "yolov8n-cls.pt" : "yolov8n.pt");

    if (cmdMode === "export") {
      return [
        "yolo", "export",
        `model=${shellArg(toPosix(model))}`,
        "format=onnx",
        `imgsz=${task === "classify" ? 224 : cmdImgsz}`,
        `device=${shellArg(cmdDevice || "0")}`
      ].join(" ");
    }

    const dataPath = task === "classify"
      ? toPosix(state.info?.clfDataset || "dataset")
      : toPosix(state.info?.detectDataset ? `${state.info.detectDataset}/data.yaml` : "data.yaml");

    const project = cmdProject.trim() || (task === "classify" ? "runs/classify" : "runs/detect");

    const args = [
      "yolo", task, "train",
      `model=${shellArg(toPosix(model))}`,
      `data=${shellArg(dataPath)}`,
      `epochs=${cmdEpochs}`,
      `batch=${cmdBatch}`,
      `imgsz=${cmdImgsz}`,
      `device=${shellArg(cmdDevice || "0")}`,
      `workers=${cmdWorkers}`,
      `project=${shellArg(toPosix(project))}`,
      `name=${shellArg(cmdName || "train")}`
    ];
    return args.join(" ");
  }, [cmdMode, cmdModel, cmdEpochs, cmdBatch, cmdImgsz, cmdDevice, cmdWorkers, cmdProject, cmdName, task, state.info]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(generatedCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }

  const runOperation = useCallback(
    async (label: string, operation: () => Promise<TrainPrepResult>) => {
      if (!datasetRoot) {
        showToast("Open a workspace before running Dataset Prep.", { variant: "error" });
        return;
      }
      setRunning(true);
      setOpStatus(label);
      setLog("");
      try {
        const result = await operation();
        const summary = resultSummary(result);
        setLog(summary);
        setOpStatus(result.ok === false ? "Finished with warnings" : "Done");
        showToast(result.message || label, { variant: result.ok === false ? "warning" : "success" });
        await refresh();
      } catch (err) {
        const message = errMessage(err);
        setLog(message);
        setOpStatus(message);
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
    void runWithConfirm(
      {
        title: "Create validation split",
        message:
          task === "classify"
            ? `Move ~${percent}% of images from train/<class> to val/<class>. Existing val files stop the operation.`
            : `Move ~${percent}% of image/label pairs from train to val. Existing val files stop the operation.`,
        confirmLabel: "Create split",
        danger: true
      },
      () => runOperation("Creating validation split…", () =>
        prepareTrainPrepValidationSplit(datasetRoot, task, safeRatio))
    );
  }

  function handleFixDataYaml() {
    void runOperation("Fixing data.yaml…", () => ensureTrainPrepDataYaml(datasetRoot));
  }

  function handleMoveValBack() {
    void runWithConfirm(
      {
        title: "Move val back to train",
        message:
          task === "classify"
            ? "Move all val/<class> images back to train/<class>?"
            : "Move images/val and labels/val back to train?",
        confirmLabel: "Move",
        danger: true
      },
      () => runOperation("Moving val back to train…", () =>
        moveTrainPrepValBackToTrain(datasetRoot, task))
    );
  }

  function handleBuildNextTrainingBatch() {
    if (!readyNextTraining.length) {
      showToast(
        starredCount
          ? `No starred images are ready for ${task === "detect" ? "Detection" : "Classification"}. Add the required label first.`
          : "Star images in Label before preparing the next training batch.",
        { variant: "warning" }
      );
      return;
    }
    void runOperation(
      `Preparing ${readyNextTraining.length} starred image(s)…`,
      async () => {
        const result = await runBuildYoloLinksJob(
          workspaceRoot,
          false,
          JSON.stringify(readyNextTraining),
          (done, total, detail) => {
            setOpStatus(`Starred batch ${done}/${total}${detail ? ` · ${detail}` : ""}`);
          }
        );
        const built = result.builtFilenames?.length ?? 0;
        const errors = result.errors ?? [];
        return {
          ok: errors.length === 0,
          message: `Prepared ${built} starred image(s) for the ${task === "detect" ? "Detection" : "Classification"} dataset.`,
          skipped: Math.max(0, readyNextTraining.length - built),
          failures: errors,
        };
      }
    );
  }

  const wsName = state.info?.name || (workspaceRoot ? workspaceRoot.split(/[\\/]/).pop() : "");

  return (
    <main className="train-prep-workspace">

      {/* ── Left panel: controls ── */}
      <section className="panel">
        <div className="panel-header">
          <span>Dataset Prep</span>
          {wsName ? <span className="status">{wsName}</span> : null}
        </div>
        <div className="panel-body train-prep-stack" style={{ overflowY: "auto" }}>

          {/* Workspace */}
          <div className="tp-section">
            <div className="row">
              <button className="primary" type="button"
                onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={pending}>
                Open Workspace
              </button>
              <button type="button" onClick={() => void refresh()}
                disabled={pending || !workspaceRoot.trim()}>
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="tp-divider" />

          <div className="tp-section">
            <p className="tp-section-title">★ Next Training Batch</p>
            <div className="info-card tp-next-training-card">
              <StatRow label="Starred images" value={starredCount} accent={starredCount > 0} />
              <StatRow
                label={`Ready for ${task === "detect" ? "Detection" : "Classification"}`}
                value={readyNextTraining.length}
                accent={readyNextTraining.length > 0}
              />
              <button
                type="button"
                className="primary"
                onClick={handleBuildNextTrainingBatch}
                disabled={pending || !workspaceRoot.trim() || readyNextTraining.length === 0}
              >
                Prepare Starred Batch
              </button>
            </div>
            <p className="hint">
              Starred images stay queued after preparation, so a failed or repeated training run does not lose the selection.
            </p>
          </div>

          <div className="tp-divider" />

          {/* Dataset split */}
          <div className="tp-section">
            <p className="tp-section-title">Val Split</p>
            <div className="train-grid">
              <label>
                Task
                <select value={task} onChange={(e) => setTask(e.target.value as DatasetTask)} disabled={pending}>
                  <option value="detect">Detection</option>
                  <option value="classify">Classification</option>
                </select>
              </label>
              <label>
                Val ratio
                <input type="number" min="0.05" max="0.4" step="0.01" value={ratio}
                  onChange={(e) => setRatio(clampRatio(Number(e.target.value)))} disabled={pending} />
              </label>
            </div>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }}>
              Dataset root
              <input value={datasetRoot || ""} readOnly placeholder="Open a workspace first"
                style={{ fontFamily: "monospace", fontSize: 11 }} />
            </label>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <button type="button" onClick={handleCreateValSplit} disabled={pending || !datasetRoot}>
                Create Val Split
              </button>
              <button type="button" onClick={handleFixDataYaml}
                disabled={pending || !datasetRoot || task !== "detect"}>
                Fix data.yaml
              </button>
              <button type="button" onClick={handleMoveValBack} disabled={pending || !datasetRoot}>
                Move Val → Train
              </button>
            </div>
            <p className="hint">Create Val Split moves files on disk and cannot be undone by this tool.</p>
          </div>

          <div className="tp-divider" />

          {/* Generate command */}
          <div className="tp-section">
            <p className="tp-section-title">Generate Training Command</p>
            <div className="train-grid">
              <label>
                Mode
                <select value={cmdMode} onChange={(e) => setCmdMode(e.target.value as CmdMode)}>
                  <option value="train">Train new model</option>
                  <option value="continue">Continue training</option>
                  <option value="export">Export ONNX</option>
                </select>
              </label>
              <label>
                Model / weights
                <input value={cmdModel}
                  onChange={(e) => setCmdModel(e.target.value)}
                  placeholder={task === "classify" ? "yolov8n-cls.pt" : "yolov8n.pt"} />
              </label>
            </div>

            {cmdMode !== "export" ? (
              <div className="train-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                <label>
                  Epochs
                  <input type="number" min="1" value={cmdEpochs}
                    onChange={(e) => setCmdEpochs(Math.max(1, Number(e.target.value)))} />
                </label>
                <label>
                  Batch
                  <input type="number" min="1" value={cmdBatch}
                    onChange={(e) => setCmdBatch(Math.max(1, Number(e.target.value)))} />
                </label>
                <label>
                  Imgsz
                  <input type="number" min="32" step="32" value={cmdImgsz}
                    onChange={(e) => setCmdImgsz(Math.max(32, Number(e.target.value)))} />
                </label>
                <label>
                  Device
                  <input value={cmdDevice} onChange={(e) => setCmdDevice(e.target.value)} placeholder="0" />
                </label>
                <label>
                  Workers
                  <input type="number" min="0" value={cmdWorkers}
                    onChange={(e) => setCmdWorkers(Math.max(0, Number(e.target.value)))} />
                </label>
                <label>
                  Run name
                  <input value={cmdName} onChange={(e) => setCmdName(e.target.value)} placeholder="train" />
                </label>
              </div>
            ) : (
              <div className="train-grid">
                <label>
                  Imgsz
                  <input type="number" min="32" step="32" value={cmdImgsz}
                    onChange={(e) => setCmdImgsz(Math.max(32, Number(e.target.value)))} />
                </label>
                <label>
                  Device
                  <input value={cmdDevice} onChange={(e) => setCmdDevice(e.target.value)} placeholder="0" />
                </label>
              </div>
            )}

            {cmdMode !== "export" ? (
              <label style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }}>
                Project dir
                <input value={cmdProject}
                  onChange={(e) => setCmdProject(e.target.value)}
                  placeholder={task === "classify" ? "runs/classify" : "runs/detect"} />
              </label>
            ) : null}

            <div className="tp-cmd-wrap">
              <textarea className="tp-cmd-text" readOnly value={generatedCommand} rows={3} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  className={copied ? "primary" : ""}
                  style={{ minWidth: 72 }}
                  onClick={() => void copyCommand()}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
                {trainPhase === "running" ? (
                  <button
                    type="button"
                    className="danger"
                    style={{ minWidth: 72 }}
                    onClick={() => void handleStopTraining()}
                  >
                    ■ Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    style={{ minWidth: 72 }}
                    onClick={() => void handleStartTraining()}
                  >
                    ▶ Train
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── Right panel: status ── */}
      <section className="panel">
        <div className="panel-header">
          <span>Dataset Status</span>
          <span className="status">
            {workspaceRoot.trim()
              ? (loading ? "Loading…" : `${totalFiles} files indexed`)
              : "No workspace open"}
          </span>
        </div>
        <div className="panel-body train-prep-stack">

          <div className="train-grid">
            {/* Detect card */}
            <div className="info-card">
              <strong style={{ fontSize: 13, marginBottom: 2 }}>Detection</strong>
              <StatRow label="Train images" value={detect.trainImages} accent={detect.trainImages > 0} />
              <StatRow label="Val images" value={detect.valImages} />
              <StatRow label="Train labels" value={detect.trainLabels} />
              <StatRow label="Val labels" value={detect.valLabels} />
              <div className="tp-stat-row" style={{ marginTop: 4 }}>
                <span className="tp-stat-label">data.yaml</span>
                <span className={`tp-yaml-badge ${detect.yaml ? "tp-yaml-ok" : "tp-yaml-missing"}`}>
                  {detect.yaml ? "present" : "missing"}
                </span>
              </div>
            </div>

            {/* Classify card */}
            <div className="info-card">
              <strong style={{ fontSize: 13, marginBottom: 2 }}>Classification</strong>
              <StatRow label="Train images" value={classify.trainImages} accent={classify.trainImages > 0} />
              <StatRow label="Val images" value={classify.valImages} />
              <StatRow label="Classes" value={classify.classes} accent={classify.classes > 0} />
            </div>
          </div>

          {opStatus ? (
            <div className="tp-op-status">
              <span>{opStatus}</span>
              {running ? <span className="tp-spinner" /> : null}
            </div>
          ) : null}

          <LogPanel>
            {log || (loading ? "Loading dataset status…" : "No operation run yet.")}
          </LogPanel>

          <div className="tp-divider" />

          {/* Training output */}
          <div className="tp-section">
            <div className="tp-train-header">
              <p className="tp-section-title" style={{ margin: 0 }}>Training Output</p>
              <span className={`tp-train-badge ${trainPhase}`}>
                {trainPhase === "running" && <span className="tp-spinner" style={{ width: 8, height: 8 }} />}
                {trainPhase}
              </span>
              {(trainPhase === "running" || trainElapsed > 0) && (
                <span className="tp-train-elapsed">{formatElapsed(trainElapsed)}</span>
              )}
              {trainExitCode != null && (
                <span className="tp-train-elapsed">exit {trainExitCode}</span>
              )}
              {trainLines.length > 0 && (
                <span className="tp-train-elapsed" style={{ marginLeft: "auto" }}>
                  {trainLines.length} lines
                </span>
              )}
            </div>
            <div className="tp-train-controls">
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Auto-scroll
              </label>
              {trainLines.length > 0 && (
                <button
                  type="button"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => { setTrainLines([]); setTrainExitCode(null); setTrainPhase("idle"); setTrainElapsed(0); }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="tp-train-log" ref={logRef}>
              {trainLines.length > 0
                ? trainLines.map((line, i) => (
                    <span key={i} className="tp-train-line">{line || " "}</span>
                  ))
                : <span className="tp-train-placeholder">
                    {trainPhase === "idle"
                      ? "Press ▶ Train to start. Output will appear here."
                      : "Waiting for output…"}
                  </span>
              }
            </div>
          </div>

        </div>
      </section>

    </main>
  );
}
