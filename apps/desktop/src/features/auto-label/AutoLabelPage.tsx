import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { FolderPickerRow } from "../../components/workbench/FolderPickerRow";
import { JobStatusPanel } from "../../components/workbench/JobStatusPanel";
import { LogPanel } from "../../components/workbench/LogPanel";
import { NumberField } from "../../components/workbench/NumberField";
import { useRunWithConfirm } from "../../components/workbench/useRunWithConfirm";
import { useToast } from "../../components/useToast";
import { usePollingJob } from "../../hooks/usePollingJob";
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
  const runWithConfirm = useRunWithConfirm();
  const [task, setTask] = useState<AutoLabelTask>("detect");
  const [inputRoot, setInputRoot] = useState("");
  const [detectOutputRoot, setDetectOutputRoot] = useState("");
  const [classifyOutputRoot, setClassifyOutputRoot] = useState("");
  const [detectModelPath, setDetectModelPath] = useState("");
  const [classifyModelPath, setClassifyModelPath] = useState("");
  const [imageSize, setImageSize] = useState(640);
  const [confidence, setConfidence] = useState(0.25);
  const [highConfidence, setHighConfidence] = useState(0.80);
  const [mediumConfidence, setMediumConfidence] = useState(0.40);
  const [proposalMode, setProposalMode] = useState(true);
  const [device, setDevice] = useState("0");
  const [confidencePrefix, setConfidencePrefix] = useState(true);
  const [job, setJob] = useState<PtJob | null>(null);
  const [status, setStatus] = useState("No model selected");
  const [log, setLog] = useState("Use a rough YOLO detect best.pt to create output/images, output/labels, and data.yaml.");
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
        if (!detectOutputRoot) setDetectOutputRoot(outputDefault(info.root || workspaceRoot, "detect"));
        if (!classifyOutputRoot) setClassifyOutputRoot(outputDefault(info.root || workspaceRoot, "classify"));
        setStatus(`Workspace: ${info.name || info.root}`);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, inputRoot, detectOutputRoot, classifyOutputRoot, onReady, showError]);

  const updateJobState = useCallback((next: PtJob) => {
    setJob(next);
    setStatus(`${next.status || "running"}: ${next.done || 0}/${next.total || 0}`);
    setLog(JSON.stringify(next, null, 2));
  }, []);

  const notifyJobTerminal = useCallback((next: PtJob) => {
    if (next.status) showToast(`Auto label ${next.status}.`);
  }, [showToast]);

  usePollingJob({
    job,
    pollMs: 800,
    getJob: getAutoLabelJob,
    onUpdate: updateJobState,
    onTerminal: notifyJobTerminal,
    onError: showError
  });

  const running = job?.status === "running";
  const canRunDetect = useMemo(
    () => Boolean(inputRoot && detectOutputRoot && detectModelPath && imageSize > 0),
    [detectModelPath, detectOutputRoot, imageSize, inputRoot]
  );
  const canRunClassify = useMemo(
    () => Boolean(inputRoot && classifyOutputRoot && classifyModelPath && imageSize > 0),
    [classifyModelPath, classifyOutputRoot, imageSize, inputRoot]
  );

  async function chooseInput() {
    const path = await chooseAutoLabelDirectory("Choose auto-label input folder");
    if (path) setInputRoot(path);
  }

  async function chooseDetectOutput() {
    const path = await chooseAutoLabelDirectory("Choose auto-label output folder");
    if (path) setDetectOutputRoot(path);
  }

  async function chooseClassifyOutput() {
    const path = await chooseAutoLabelDirectory("Choose classified output folder");
    if (path) setClassifyOutputRoot(path);
  }

  async function chooseDetectModel() {
    const path = await chooseAutoLabelModel("Choose detect best.pt");
    if (path) setDetectModelPath(path);
  }

  async function chooseClassifyModel() {
    const path = await chooseAutoLabelModel("Choose classify best.pt");
    if (path) setClassifyModelPath(path);
  }

  async function runJob(nextTask: AutoLabelTask) {
    const modelPath = nextTask === "detect" ? detectModelPath : classifyModelPath;
    const outputRoot = nextTask === "detect" ? detectOutputRoot : classifyOutputRoot;
    const canRun = nextTask === "detect" ? canRunDetect : canRunClassify;
    if (!canRun) {
      showToast("Choose input, output, and model first.", { variant: "error" });
      return;
    }
    const nextImageSize = nextTask === "classify" ? 224 : 640;
    await runWithConfirm(
      {
        title: "Run auto label",
        message: `Run ${nextTask} auto label?\n\nInput: ${inputRoot}\nOutput: ${outputRoot}\nModel: ${modelPath}`,
        confirmLabel: "Run"
      },
      async () => {
        setTask(nextTask);
        setImageSize(nextImageSize);
        setPending(true);
        try {
          // In proposal mode, run with mediumConfidence as the floor so all
          // medium/high predictions are captured. Post-processing applies the
          // high/medium split and writes accepted boxes + sidecar proposals.
          const runConfidence = proposalMode && nextTask === "detect" ? mediumConfidence : confidence;
          const next = await startAutoLabelJob(nextTask, inputRoot, outputRoot, modelPath, nextImageSize, runConfidence, device, confidencePrefix);
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
    );
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

  const detectLog = task === "detect" ? log : "Use a rough YOLO detect best.pt to create output/images, output/labels, and data.yaml.";
  const classifyLog = task === "classify" ? log : "Use a rough YOLO classify best.pt to copy new images into output/class_name folders.";

  return (
    <main className="train-workspace">
      <section className="panel">
        <div className="panel-header">
          <span>Detect / Auto Label New Data</span>
          <span className="status">{task === "detect" ? status : "Switch task below"}</span>
        </div>
        <div className="panel-body train-prep-stack">
          <div className="row">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={pending || running}>Open Workspace</button>
          </div>
          <div className="train-grid">
            <FolderPickerRow label="Model" value={detectModelPath} placeholder="detect best.pt" browseLabel="Choose detect best.pt" disabled={pending || running} onBrowse={() => chooseDetectModel().catch(showError)} />
            <FolderPickerRow label="Source" value={inputRoot} placeholder="detect_dataset folder" browseLabel="Source Dataset" disabled={pending || running} onBrowse={() => chooseInput().catch(showError)} />
            <FolderPickerRow label="Output" value={detectOutputRoot} placeholder="auto-labeled dataset folder" browseLabel="Output Folder" disabled={pending || running} onBrowse={() => chooseDetectOutput().catch(showError)} />
            <NumberField label="Image size" value={imageSize} onChange={(value) => setImageSize(Math.max(1, value || 1))} disabled={pending || running} />
            <NumberField label="Conf (min)" value={confidence} step={0.01} min={0} max={1} onChange={(value) => setConfidence(Math.max(0, Math.min(1, value || 0)))} disabled={pending || running} />
            <label>Device<input value={device} onChange={(event) => setDevice(event.target.value)} disabled={pending || running} placeholder="0 or cpu" /></label>
          </div>
          <div className="row">
            <label className="inline-check">
              <input type="checkbox" checked={proposalMode} onChange={(event) => setProposalMode(event.target.checked)} disabled={pending || running} />
              Generate proposals for review
            </label>
          </div>
          {proposalMode && (
            <div className="train-grid">
              <NumberField label="High conf (auto box)" value={highConfidence} step={0.01} min={0} max={1} onChange={(value) => setHighConfidence(Math.max(0, Math.min(1, value || 0)))} disabled={pending || running} />
              <NumberField label="Medium conf (proposal)" value={mediumConfidence} step={0.01} min={0} max={1} onChange={(value) => setMediumConfidence(Math.max(0, Math.min(1, value || 0)))} disabled={pending || running} />
            </div>
          )}
          <div className="row">
            <button className="primary" type="button" onClick={() => void runJob("detect")} disabled={pending || running || !canRunDetect}>Auto Label Folder</button>
            <button className="danger" type="button" onClick={() => void cancelJob()} disabled={!running}>Stop</button>
          </div>
          <JobStatusPanel visible={running && task === "detect"} running={running} done={job?.done || 0} total={job?.total || 1} detail={status} />
          <LogPanel>{detectLog}</LogPanel>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span>Classify New Data</span>
          <span className="status">{task === "classify" ? status : "Switch task below"}</span>
        </div>
        <div className="panel-body train-prep-stack">
          <div className="train-grid">
            <FolderPickerRow label="Model" value={classifyModelPath} placeholder="best.pt" browseLabel="Choose best.pt" disabled={pending || running} onBrowse={() => chooseClassifyModel().catch(showError)} />
            <FolderPickerRow label="Source" value={inputRoot} placeholder="clf_dataset folder" browseLabel="Source Dataset" disabled={pending || running} onBrowse={() => chooseInput().catch(showError)} />
            <FolderPickerRow label="Output" value={classifyOutputRoot} placeholder="classified output folder" browseLabel="Output Folder" disabled={pending || running} onBrowse={() => chooseClassifyOutput().catch(showError)} />
            <NumberField label="Image size" value={imageSize} onChange={(value) => setImageSize(Math.max(1, value || 1))} disabled={pending || running} />
            <label>Device<input value={device} onChange={(event) => setDevice(event.target.value)} disabled={pending || running} placeholder="0 or cpu" /></label>
            <label className="inline-check"><input type="checkbox" checked={confidencePrefix} onChange={(event) => setConfidencePrefix(event.target.checked)} disabled={pending || running} /> Confidence prefix</label>
          </div>
          <div className="row">
            <button className="primary" type="button" onClick={() => void runJob("classify")} disabled={pending || running || !canRunClassify}>Classify Folder</button>
            <button className="danger" type="button" onClick={() => void cancelJob()} disabled={!running}>Stop</button>
          </div>
          <JobStatusPanel visible={running && task === "classify"} running={running} done={job?.done || 0} total={job?.total || 1} detail={status} />
          <LogPanel>{classifyLog}</LogPanel>
        </div>
      </section>
    </main>
  );
}
