import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { chooseCropDirectory, loadCropWorkspace, runBatchCropImages, type CropAnchor } from "./cropApi";

type CropPageProps = { onReady?: () => void };

export function CropPage({ onReady }: CropPageProps) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const [inputRoot, setInputRoot] = useState("");
  const [outputRoot, setOutputRoot] = useState("");
  const [width, setWidth] = useState(2560);
  const [height, setHeight] = useState(1440);
  const [anchor, setAnchor] = useState<CropAnchor>("center");
  const [workers, setWorkers] = useState(0);
  const [status, setStatus] = useState("Choose input and output folders.");
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
        const info = await loadCropWorkspace(workspaceRoot);
        if (cancelled) return;
        if (!inputRoot) setInputRoot(info.clfDataset || info.detectDataset || "");
        if (!outputRoot) setOutputRoot(`${info.root.replace(/[\\/]$/, "")}/batch_crops`);
        setStatus(`Workspace: ${info.name || info.root}`);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, inputRoot, outputRoot, onReady, showError]);

  async function chooseInput() {
    const path = await chooseCropDirectory("Choose input folder");
    if (path) setInputRoot(path);
  }

  async function chooseOutput() {
    const path = await chooseCropDirectory("Choose output folder");
    if (path) setOutputRoot(path);
  }

  async function runCrop() {
    if (!inputRoot || !outputRoot) {
      showToast("Choose input and output folders first.", { variant: "error" });
      return;
    }
    if (!window.confirm(`Run crop?\n\nInput: ${inputRoot}\nOutput: ${outputRoot}`)) return;
    setPending(true);
    setStatus("Running crop...");
    setLog("");
    try {
      const result = await runBatchCropImages(inputRoot, outputRoot, width, height, anchor, workers);
      setStatus(`Done: ${result.cropped || 0}/${result.total || 0}`);
      setLog(JSON.stringify(result, null, 2));
      showToast("Crop finished.");
    } catch (err) {
      setStatus(errMessage(err));
      setLog(errMessage(err));
      showError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="crop-native-page">
      <section className="panel">
        <div className="panel-header"><span>Batch Crop</span><span className="status">{status}</span></div>
        <div className="panel-body">
          <div className="row">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={pending}>Open Workspace</button>
          </div>
          <label>Input folder<div className="row"><input value={inputRoot} onChange={(event) => setInputRoot(event.target.value)} /><button type="button" onClick={() => chooseInput().catch(showError)} disabled={pending}>Choose</button></div></label>
          <label>Output folder<div className="row"><input value={outputRoot} onChange={(event) => setOutputRoot(event.target.value)} /><button type="button" onClick={() => chooseOutput().catch(showError)} disabled={pending}>Choose</button></div></label>
          <div className="grid two">
            <label>Width<input type="number" value={width} onChange={(event) => setWidth(Math.max(1, Number(event.target.value) || 1))} disabled={pending} /></label>
            <label>Height<input type="number" value={height} onChange={(event) => setHeight(Math.max(1, Number(event.target.value) || 1))} disabled={pending} /></label>
          </div>
          <div className="grid two">
            <label>Anchor<select value={anchor} onChange={(event) => setAnchor(event.target.value as CropAnchor)} disabled={pending}><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
            <label>Workers<input type="number" value={workers} onChange={(event) => setWorkers(Math.max(0, Number(event.target.value) || 0))} disabled={pending} /></label>
          </div>
          <button className="primary" type="button" onClick={() => void runCrop()} disabled={pending}>Run Batch Crop</button>
        </div>
      </section>
      <section className="panel"><div className="panel-header"><span>Log</span></div><div className="panel-body"><pre className="log">{log || "No crop run yet."}</pre></div></section>
    </main>
  );
}
