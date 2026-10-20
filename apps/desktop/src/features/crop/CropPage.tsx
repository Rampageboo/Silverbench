import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listDatasetFiles } from "../../api";
import { useWorkspace } from "../../app/useWorkspace";
import { LogPanel } from "../../components/workbench/LogPanel";
import { useRunWithConfirm } from "../../components/workbench/useRunWithConfirm";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import {
  buildLabelIndex,
  findPairs,
  inferDatasetTask,
  naturalCompare,
  readClassNamesFromDataset,
  type DatasetPair
} from "../dataset-review/datasetCore";
import { emptyCropQueue, readCropQueue, saveCropQueue, type CropQueueState } from "../shared/cropQueue";
import {
  chooseCropDirectory,
  defaultBatchCropOutput,
  formatBatchCropResult,
  loadCropWorkspace,
  runBatchCropFiles,
  runBatchCropImages,
  type CropAnchor
} from "./cropApi";
import {
  cropPairIntoOutputs,
  cropRunId,
  drawSmartCropPreview,
  previewSmartCropPlans,
  writeSmartCropDatasetFiles,
  type SmartCropPair
} from "./smartCropApply";
import type { SmartCropSettings } from "./smartCropPlans";
import "./crop.css";

type CropPageProps = { onReady?: () => void };

function queueSummary(queue: CropQueueState) {
  if (!queue.items.length) return "Use Send to Crop from Review, or right-click a class in Filter.";
  const classCounts = new Map<string, number>();
  for (const item of queue.items) {
    const name = item.className || "(unknown)";
    classCounts.set(name, (classCounts.get(name) || 0) + 1);
  }
  const classLines = [...classCounts.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([name, count]) => `${name}: ${count}`)
    .join(" | ");
  const sourceLines = (queue.sources || []).slice(-3).map((entry) => `+${entry.added} ${entry.label}`).join("\n");
  return [`Queue: ${queue.items.length} image(s)`, classLines ? `Classes: ${classLines}` : "", sourceLines ? `Recent:\n${sourceLines}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function CropPage({ onReady }: CropPageProps) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const runWithConfirm = useRunWithConfirm();
  const [inputRoot, setInputRoot] = useState("");
  const [outputRoot, setOutputRoot] = useState("");
  const [width, setWidth] = useState(2560);
  const [height, setHeight] = useState(1440);
  const [anchor, setAnchor] = useState<CropAnchor>("center");
  const [workers, setWorkers] = useState(0);
  const [classAnchors, setClassAnchors] = useState<Record<string, CropAnchor>>({});
  const [queue, setQueue] = useState<CropQueueState>(emptyCropQueue());
  const [status, setStatus] = useState("Choose folders");
  const [batchLog, setBatchLog] = useState("For 2560x1660 to 2560x1440, Center crops 110px from top and bottom.");
  const [pending, setPending] = useState(false);

  const [datasetRoot, setDatasetRoot] = useState("");
  const [datasetPairs, setDatasetPairs] = useState<DatasetPair[]>([]);
  const [labelCache, setLabelCache] = useState<Map<string, import("../../api").LabelBox[]>>(new Map());
  const [classNames, setClassNames] = useState<Map<number, string>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [smartSettings, setSmartSettings] = useState<SmartCropSettings>({ targetW: 2560, targetH: 1440, maxPerImage: 3, boxMarginPx: 80 });
  const [smartLog, setSmartLog] = useState("Open a detect dataset to preview smart crops.");
  const [smartRunning, setSmartRunning] = useState(false);
  const stopSmartRef = useRef(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);

  const refreshQueue = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setQueue(emptyCropQueue());
      return;
    }
    setQueue(await readCropQueue(workspaceRoot));
  }, [workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!workspaceRoot.trim()) {
        onReady?.();
        return;
      }
      try {
        const info = await loadCropWorkspace(workspaceRoot);
        if (cancelled) return;
        if (!inputRoot) setInputRoot(info.clfDataset || info.detectDataset || "");
        if (!outputRoot) setOutputRoot(defaultBatchCropOutput(info.root));
        if (!datasetRoot) setDatasetRoot(info.detectDataset || "");
        setStatus(`Workspace: ${info.name || info.root}`);
        await refreshQueue();
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, inputRoot, outputRoot, datasetRoot, onReady, refreshQueue, showError]);

  const queueClasses = useMemo(() => {
    const names = new Set(queue.items.map((item) => item.className || "(unknown)"));
    return [...names].sort(naturalCompare);
  }, [queue.items]);

  async function chooseInput() {
    const path = await chooseCropDirectory("Choose input folder");
    if (path) setInputRoot(path);
  }

  async function chooseOutput() {
    const path = await chooseCropDirectory("Choose output folder");
    if (path) setOutputRoot(path);
  }

  async function openDetectDataset() {
    const path = await chooseCropDirectory("Open detect dataset folder");
    if (!path) return;
    setPending(true);
    try {
      const files = await listDatasetFiles(path);
      const fileSet = new Set(files);
      const task = inferDatasetTask(fileSet);
      if (task !== "detect") {
        showToast("Smart crop requires a detect dataset with images/ and labels/.", { variant: "error" });
        return;
      }
      const pairs = findPairs(fileSet, "detect");
      const index = await buildLabelIndex(path, pairs, "detect");
      setDatasetRoot(path);
      setDatasetPairs(pairs);
      setLabelCache(index.labelCache);
      setClassNames(await readClassNamesFromDataset(path, fileSet));
      setCurrentIndex(0);
      setSmartLog(`Loaded ${pairs.length} image(s) from detect dataset.`);
      setStatus(`${pairs.length} images, ${[...index.labelCache.values()].filter((boxes) => boxes.length).length} labeled`);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function runFolderCrop() {
    if (!inputRoot || !outputRoot) {
      showToast("Choose input and output folders first.", { variant: "error" });
      return;
    }
    await runWithConfirm(
      {
        title: "Run batch crop",
        message: `Run crop?\n\nInput: ${inputRoot}\nOutput: ${outputRoot}`,
        confirmLabel: "Run"
      },
      async () => {
        setPending(true);
        try {
          const result = await runBatchCropImages(inputRoot, outputRoot, width, height, anchor, classAnchors, workers);
          setStatus(`Done: ${result.cropped || 0}/${result.total || 0}`);
          setBatchLog(formatBatchCropResult(result, outputRoot));
          showToast("Crop finished.");
        } catch (err) {
          setStatus(errMessage(err));
          setBatchLog(errMessage(err));
          showError(err);
        } finally {
          setPending(false);
        }
      }
    );
  }

  async function runQueueCrop() {
    if (!outputRoot || !queue.items.length) {
      showToast("Add items to the crop queue and choose output first.", { variant: "error" });
      return;
    }
    setPending(true);
    try {
      const result = await runBatchCropFiles(outputRoot, width, height, anchor, classAnchors, queue.items, workers);
      setStatus(`Queue crop: ${result.cropped || 0}/${result.total || 0}`);
      setBatchLog(formatBatchCropResult(result, outputRoot));
      showToast("Queue crop finished.");
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function clearQueue() {
    const next = emptyCropQueue();
    setQueue(next);
    if (workspaceRoot.trim()) await saveCropQueue(workspaceRoot, next);
  }

  async function renderSmartPreview(index = currentIndex) {
    if (!datasetRoot || !datasetPairs[index]) return;
    const pair = datasetPairs[index];
    const smartPair: SmartCropPair = {
      imagePath: pair.imagePath,
      labelPath: pair.labelPath,
      boxes: labelCache.get(pair.imagePath) || []
    };
    const plans = await previewSmartCropPlans(datasetRoot, smartPair, smartSettings);
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const base64 = await import("../../api").then((api) => api.readFileBase64(datasetRoot, pair.imagePath));
    const blob = await fetch(`data:image/jpeg;base64,${base64}`).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (ctx) drawSmartCropPreview(ctx, bitmap, bitmap.width, bitmap.height, plans);
    bitmap.close();
    setSmartLog(
      plans.length
        ? plans.map((plan, i) => `crop ${i + 1}: ${plan.rect.w}x${plan.rect.h}, ${plan.boxes.length} box(es)`).join("\n")
        : "Preview: no valid crop for this image."
    );
  }

  async function applySmartCrop() {
    if (!datasetRoot) {
      showToast("Open a detect dataset first.", { variant: "error" });
      return;
    }
    const labeled = datasetPairs.filter((pair) => (labelCache.get(pair.imagePath) || []).length);
    if (!labeled.length) {
      showToast("No labeled images found.", { variant: "error" });
      return;
    }
    stopSmartRef.current = false;
    setSmartRunning(true);
    const runId = cropRunId();
    const outputPrefix = `smart_crops_${runId}`;
    const trainLines: string[] = [];
    const log: string[] = [`Smart crop run ${runId}`, `Target: ${smartSettings.targetW}x${smartSettings.targetH}`];
    try {
      for (let index = 0; index < labeled.length; index += 1) {
        if (stopSmartRef.current) {
          log.push("Stopped by user.");
          break;
        }
        const pair = labeled[index];
        setStatus(`Smart crop ${index + 1}/${labeled.length}: ${pair.imagePath}`);
        const smartPair: SmartCropPair = {
          imagePath: pair.imagePath,
          labelPath: pair.labelPath,
          boxes: labelCache.get(pair.imagePath) || []
        };
        try {
          await cropPairIntoOutputs(datasetRoot, smartPair, smartSettings, runId, outputPrefix, trainLines);
        } catch (err) {
          log.push(`FAILED ${pair.imagePath}: ${errMessage(err)}`);
        }
      }
      await writeSmartCropDatasetFiles(datasetRoot, outputPrefix, trainLines, classNames);
      const summary = `Done. Output: ${outputPrefix}, crops ${trainLines.length}.`;
      log.push(summary);
      setSmartLog(log.join("\n"));
      setStatus(summary);
      showToast("Smart crop finished.");
    } catch (err) {
      showError(err);
    } finally {
      setSmartRunning(false);
    }
  }

  const currentPair = datasetPairs[currentIndex];
  const labeledCount = datasetPairs.filter((pair) => (labelCache.get(pair.imagePath) || []).length).length;

  return (
    <main className="crop-workspace">
      <section className="panel">
        <div className="panel-header">
          <span>Batch Crop Images</span>
          <span className="status">{status}</span>
        </div>
        <div className="panel-body train-prep-stack">
          <div className="row">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={pending || smartRunning}>Open Workspace</button>
          </div>
          <div className="batch-crop-queue-panel">
            <div className="row">
              <span className="group-title">Crop Queue</span>
              <button type="button" onClick={() => void clearQueue()} disabled={pending || !queue.items.length}>Clear Queue</button>
            </div>
            <LogPanel>{queueSummary(queue)}</LogPanel>
          </div>
          <div className="train-grid">
            <label>Output<input value={outputRoot} onChange={(e) => setOutputRoot(e.target.value)} readOnly placeholder="cropped output folder" /></label>
            <label>Width<input type="number" value={width} onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 1))} disabled={pending} /></label>
            <label>Height<input type="number" value={height} onChange={(e) => setHeight(Math.max(1, Number(e.target.value) || 1))} disabled={pending} /></label>
            <label>
              Anchor
              <select value={anchor} onChange={(e) => setAnchor(e.target.value as CropAnchor)} disabled={pending}>
                <option value="center">Center</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button type="button" onClick={() => void runQueueCrop()} disabled={pending || !queue.items.length}>Run Queue Crop</button>
            <button type="button" onClick={() => chooseOutput().catch(showError)} disabled={pending}>Output Folder</button>
            <button className="primary" type="button" onClick={() => void runFolderCrop()} disabled={pending}>Batch Crop Folder</button>
          </div>
          <details className="batch-crop-advanced">
            <summary>Advanced: import from folder (legacy flow)</summary>
            <div className="train-grid" style={{ marginTop: 8 }}>
              <label>Input<input value={inputRoot} onChange={(e) => setInputRoot(e.target.value)} readOnly placeholder="source image folder" /></label>
              <label>Workers<input type="number" value={workers} onChange={(e) => setWorkers(Math.max(0, Number(e.target.value) || 0))} disabled={pending} /></label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" onClick={() => chooseInput().catch(showError)} disabled={pending}>Input Folder</button>
            </div>
          </details>
          {queueClasses.length ? (
            <div className="class-anchor-list">
              {queueClasses.map((className) => (
                <label key={className} className="row">
                  <span>{className}</span>
                  <select
                    value={classAnchors[className] || anchor}
                    onChange={(e) => setClassAnchors((prev) => ({ ...prev, [className]: e.target.value as CropAnchor }))}
                    disabled={pending}
                  >
                    <option value="center">Center</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="skip">Skip</option>
                  </select>
                </label>
              ))}
            </div>
          ) : (
            <div className="class-anchor-list"><div className="empty">Open a classification dataset queue to set per-class anchors.</div></div>
          )}
          <LogPanel>{batchLog}</LogPanel>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span>Smart Crop YOLO Dataset</span>
          <span className="status">{datasetRoot ? `${labeledCount}/${datasetPairs.length} labeled` : "No dataset loaded"}</span>
        </div>
        <div className="panel-body train-prep-stack">
          <div className="row">
            <button type="button" onClick={() => void openDetectDataset()} disabled={pending || smartRunning}>Open Detect Dataset</button>
          </div>
          <div className="crop-grid">
            <label>Width<input type="number" value={smartSettings.targetW} onChange={(e) => setSmartSettings((s) => ({ ...s, targetW: Math.max(64, Number(e.target.value) || 2560) }))} disabled={smartRunning} /></label>
            <label>Height<input type="number" value={smartSettings.targetH} onChange={(e) => setSmartSettings((s) => ({ ...s, targetH: Math.max(64, Number(e.target.value) || 1440) }))} disabled={smartRunning} /></label>
            <label>Max / image<input type="number" value={smartSettings.maxPerImage} onChange={(e) => setSmartSettings((s) => ({ ...s, maxPerImage: Math.max(1, Math.min(12, Number(e.target.value) || 3)) }))} disabled={smartRunning} /></label>
            <label>Margin px<input type="number" value={smartSettings.boxMarginPx} onChange={(e) => setSmartSettings((s) => ({ ...s, boxMarginPx: Math.max(0, Number(e.target.value) || 0) }))} disabled={smartRunning} /></label>
          </div>
          {currentPair ? (
            <div className="row">
              <button type="button" onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} disabled={smartRunning || currentIndex <= 0}>Prev</button>
              <span className="status">{currentPair.imagePath}</span>
              <button type="button" onClick={() => setCurrentIndex((i) => Math.min(datasetPairs.length - 1, i + 1))} disabled={smartRunning || currentIndex >= datasetPairs.length - 1}>Next</button>
            </div>
          ) : null}
          <div className="row">
            <button type="button" onClick={() => void renderSmartPreview()} disabled={!datasetRoot || !currentPair || smartRunning}>Preview Current</button>
            <button className="primary" type="button" onClick={() => void applySmartCrop()} disabled={!datasetRoot || smartRunning}>Apply Dataset</button>
            <button className="danger" type="button" onClick={() => { stopSmartRef.current = true; }} disabled={!smartRunning}>Stop</button>
          </div>
          <div className="smart-crop-preview-wrap">
            <canvas ref={previewCanvasRef} className="smart-crop-preview-canvas" />
          </div>
          <div className="crop-tool-log">{smartLog}</div>
        </div>
      </section>
    </main>
  );
}
