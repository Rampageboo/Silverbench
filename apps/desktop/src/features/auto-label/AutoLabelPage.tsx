import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import {
  cancelAutoLabelJob,
  chooseAutoLabelDirectory,
  chooseAutoLabelModel,
  getAutoLabelJob,
  loadAutoLabelWorkspace,
  startAutoLabelJob,
  type AutoLabelTask,
  type PtJob
} from "./autoLabelApi";

type Props = { onReady?: () => void };

function outputDefault(root: string, task: AutoLabelTask) {
  if (!root) return "";
  const clean = root.replace(/[\\/]$/, "");
  return `${clean}/${task === "classify" ? "auto_classify_out" : "auto_detect_out"}`;
}

export function AutoLabelPage({ onReady }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const [task, setTask] = useState<AutoLabelTask>("detect");
  const [inputRoot, setInputRoot] = useState("");
  const [outputRoot, setOutputRoot] = useState("");
  const [modelPath, setModelPath] = useState("");
  const [imageSize, setImageSize] = useState(640);
  const [confidence, setConfidence] = useState(0.25);
  const [device, setDevice] = useState("0");
  const [confidencePrefix, setConfidencePrefix] = useState(true);
  const [job, setJob] = useState<PtJob | null>(null);
  const [status, setStatus] = useState("Choose folders and a model.");
  const [log, setLog] = useState("");
  const [pending, setPending] = useState(false);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!workspaceRoot.trim()) {
        onReady?.();
        return;
      }
      try {
        const info = await loadAutoLabelWorkspace(workspaceRoot);
        if (cancelled) return;
        if (!inputRoot) setInputRoot(info.root || workspaceRoot);
        if (!outputRoot) setOutputRoot(outputDefault(info.root || workspaceRoot, task));
        setStatus(`Workspace: ${info.name || info.root}`);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, inputRoot, outputRoot, task, onReady, showError]);

  useEffect(() => {
    if (!job?.id || job.status !== "running") return;
    const timer = window.setInterval(() => {
      getAutoLabelJob(job.id).then((next) => {
        setJob(next);
        setStatus(`${next.status || "running"}: ${next.done || 0}/${next.total || 0}`);
        setLog(JSON.stringify(next, null, 2));
        if (next.status && next.status !== "running") {
          showToast(`Auto label ${next.status}.`);
        }
      }).catch(showError);
    }, 800);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, showError, showToast]);

  const running = job?.status === "running";
  const canRun = useMemo(() => Boolean(inputRoot && outputRoot && modelPath && imageSize > 0), [inputRoot, outputRoot, modelPath, imageSize]);

  async function chooseInput() {
    const path = await chooseAutoLabelDirectory("Choose auto-label input folder");
    if (path) setInputRoot(path);
  }

  async function chooseOutput() {
    const path = await chooseAutoLabelDirectory("Choose auto-label output folder");
    if (path) setOutputRoot(path);
  }

  async function chooseModel() {
    const path = await chooseAutoLabelModel("Choose YOLO PT model");
    if (path) setModelPath(path);
  }

  async function runJob() {
    if (!canRun) {
      showToast("Choose input, output, and model first.", { variant: "error" });
      return;
    }
    if (!window.confirm(`Run ${task} auto label?\n\nInput: ${inputRoot}\nOutput: ${outputRoot}\nModel: ${modelPath}`)) return;
    setPending(true);
    try {
      const next = await startAutoLabelJob(task, inputRoot, outputRoot, modelPath, imageSize, confidence, device, confidencePrefix);
      setJob(next);
      setStatus(`${next.status || "running"}: ${next.done || 0}/${next.total || 0}`);
      setLog(JSON.stringify(next, null, 2));
    } catch (err) {
      setStatus(errMessage(err));
      setLog(errMessage(err));
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function cancelJob() {
    if (!job?.id) return;
    try {
      const next = await cancelAutoLabelJob(job.id);
      setJob(next);
      setStatus(next.detail || "Cancelling...");
      setLog(JSON.stringify(next, null, 2));
    } catch (err) {
      showError(err);
    }
  }

  return (
    <main className="auto-label-native-page">
      <section className="panel">
        <div className="panel-header"><span>Auto Label</span><span className="status">{status}</span></div>
        <div className="panel-body">
          <div className="row"><button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={pending || running}>Open Workspace</button></div>
          <div className="grid two">
            <label>Task<select value={task} onChange={(event) => { const next = event.target.value as AutoLabelTask; setTask(next); setOutputRoot(outputDefault(workspaceRoot, next)); setImageSize(next === "classify" ? 224 : 640); }} disabled={pending || running}><option value="detect">Detect</option><option value="classify">Classify</option></select></label>
            <label>Device<input value={device} onChange={(event) => setDevice(event.target.value)} disabled={pending || running} /></label>
          </div>
          <label>Input folder<div className="row"><input value={inputRoot} onChange={(event) => setInputRoot(event.target.value)} /><button type="button" onClick={() => chooseInput().catch(showError)} disabled={pending || running}>Choose</button></div></label>
          <label>Output folder<div className="row"><input value={outputRoot} onChange={(event) => setOutputRoot(event.target.value)} /><button type="button" onClick={() => chooseOutput().catch(showError)} disabled={pending || running}>Choose</button></div></label>
          <label>Model<div className="row"><input value={modelPath} onChange={(event) => setModelPath(event.target.value)} /><button type="button" onClick={() => chooseModel().catch(showError)} disabled={pending || running}>Choose</button></div></label>
          <div className="grid two">
            <label>Image size<input type="number" value={imageSize} onChange={(event) => setImageSize(Math.max(1, Number(event.target.value) || 1))} disabled={pending || running} /></label>
            {task === "detect" ? <label>Confidence<input type="number" step="0.01" min="0" max="1" value={confidence} onChange={(event) => setConfidence(Math.max(0, Math.min(1, Number(event.target.value) || 0)))} disabled={pending || running} /></label> : <label><input type="checkbox" checked={confidencePrefix} onChange={(event) => setConfidencePrefix(event.target.checked)} disabled={pending || running} /> Confidence prefix</label>}
          </div>
          <div className="row"><button className="primary" type="button" onClick={() => void runJob()} disabled={pending || running || !canRun}>Start</button><button type="button" onClick={() => void cancelJob()} disabled={!running}>Cancel</button></div>
        </div>
      </section>
      <section className="panel"><div className="panel-header"><span>Job</span></div><div className="panel-body"><pre className="log">{log || "No job running."}</pre></div></section>
    </main>
  );
}
