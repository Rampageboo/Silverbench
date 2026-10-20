import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { FolderPickerRow } from "../../components/workbench/FolderPickerRow";
import { LogPanel } from "../../components/workbench/LogPanel";
import { useRunWithConfirm } from "../../components/workbench/useRunWithConfirm";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { mergeDatasets, type MergeSource } from "./mergeLogic";
import { chooseMergeDirectory, loadMergeWorkspace, moveMergeValBackToTrain, openMergeFolder, type MergeTask } from "./mergeApi";
import { isZipFile, readFileArrayBuffer } from "./mergeZip";
import "./merge.css";

type Props = { onReady?: () => void };

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function MergePage({ onReady }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const runWithConfirm = useRunWithConfirm();
  const [task, setTask] = useState<MergeTask>("detect");
  const [targetRoot, setTargetRoot] = useState("");
  const [targetExplicit, setTargetExplicit] = useState(false);
  const [sources, setSources] = useState<MergeSource[]>([]);
  const [autoRename, setAutoRename] = useState(true);
  const [status, setStatus] = useState("No target folder");
  const [log, setLog] = useState("Ready.");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ value: 0, total: 1, detail: "" });
  const zipInputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);

  const syncTarget = useCallback(async (root: string, mergeTask: MergeTask, explicit: boolean) => {
    if (explicit || !root.trim()) return;
    try {
      const info = await loadMergeWorkspace(root);
      const nextTarget = mergeTask === "classify" ? info.clfDataset : info.detectDataset;
      if (nextTarget) {
        setTargetRoot(nextTarget);
        setStatus(nextTarget.split(/[\\/]/).pop() || nextTarget);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!workspaceRoot.trim()) {
        onReady?.();
        return;
      }
      try {
        await syncTarget(workspaceRoot, task, targetExplicit);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, task, targetExplicit, onReady, showError, syncTarget]);

  async function addSourceFolder() {
    const path = await chooseMergeDirectory("Choose source dataset folder");
    if (!path) return;
    const opened = await openMergeFolder(path);
    if (!opened.ok || !opened.root) {
      showToast(opened.error || "Cannot open folder.", { variant: "error" });
      return;
    }
    if (sources.some((source) => source.kind === "folder" && source.root === opened.root)) return;
    setSources((items) => [...items, { kind: "folder", root: opened.root!, name: opened.name || baseName(opened.root!) }]);
    setLog(`Added source folder: ${opened.root}`);
  }

  async function addZipFile(file: File) {
    if (!isZipFile(file)) {
      showToast(`${file.name} is not a ZIP file.`, { variant: "error" });
      return;
    }
    const buffer = await readFileArrayBuffer(file);
    if (sources.some((source) => source.kind === "zip" && source.name === file.name && source.buffer.byteLength === buffer.byteLength)) return;
    setSources((items) => [...items, { kind: "zip", name: file.name, buffer }]);
    setLog(`Added ZIP: ${file.name}`);
  }

  async function chooseTarget() {
    const path = await chooseMergeDirectory("Choose target dataset folder");
    if (!path) return;
    const opened = await openMergeFolder(path);
    if (!opened.ok || !opened.root) {
      showToast(opened.error || "Cannot open folder.", { variant: "error" });
      return;
    }
    setTargetRoot(opened.root);
    setTargetExplicit(true);
    setStatus(opened.name || baseName(opened.root));
  }

  function removeSource(index: number) {
    setSources((items) => items.filter((_, i) => i !== index));
  }

  async function runMerge() {
    if (!sources.length || !targetRoot) {
      showToast("Add sources and choose a target first.", { variant: "error" });
      return;
    }
    if (sources.some((source) => source.kind === "folder" && source.root === targetRoot)) {
      showToast("Target cannot also be a source.", { variant: "error" });
      return;
    }
    await runWithConfirm(
      {
        title: "Merge datasets",
        message: `Merge ${sources.length} source(s) into target?\n\nTarget: ${targetRoot}`,
        confirmLabel: "Merge"
      },
      async () => {
        setRunning(true);
        setProgress({ value: 0, total: 1, detail: "Planning..." });
        try {
          const result = await mergeDatasets({
            sources,
            targetRoot,
            task,
            autoRename,
            onProgress: setProgress,
            onLog: setLog
          });
          setStatus(result.summary);
          showToast("Merge finished.");
        } catch (err) {
          const message = errMessage(err);
          setStatus(message);
          setLog((prev) => `${prev}\n\n${message}`);
          showError(err);
        } finally {
          setRunning(false);
        }
      }
    );
  }

  async function runValToTrain() {
    if (!targetRoot) {
      showToast("Choose a target folder first.", { variant: "error" });
      return;
    }
    await runWithConfirm(
      {
        title: "Val to train",
        message: task === "classify" ? "Move classification val images back to train?" : "Move detection val back to train?",
        confirmLabel: "Move"
      },
      async () => {
        setRunning(true);
        try {
          const result = await moveMergeValBackToTrain(targetRoot, task);
          setLog(result.message || "Val moved back to train.");
          setStatus("Val → Train finished.");
          showToast(result.message || "Done.", { variant: result.ok === false ? "warning" : "success" });
        } catch (err) {
          showError(err);
        } finally {
          setRunning(false);
        }
      }
    );
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    event.currentTarget.classList.remove("drop-hover");
    const files = [...event.dataTransfer.files];
    let added = 0;
    for (const file of files) {
      if (isZipFile(file)) {
        void addZipFile(file).then(() => { added += 1; }).catch(showError);
      }
    }
    if (!added) setLog("Drop ZIP files onto the dashed box, or use Add Folder.");
  }

  return (
    <main className="merge-workspace">
      <section className="panel">
        <div className="panel-header">
          <span>Sources</span>
          <span className="status">{sources.length}</span>
        </div>
        <div className="panel-body">
          <div
            className="merge-drop"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drop-hover"); }}
            onDragLeave={(e) => e.currentTarget.classList.remove("drop-hover")}
            onDrop={onDrop}
          >
            Drop dataset folders or ZIP files here.
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={running}>Open Workspace</button>
            <button className="primary" type="button" onClick={() => void addSourceFolder()} disabled={running}>Add Folder</button>
            <button type="button" onClick={() => zipInputRef.current?.click()} disabled={running}>Add ZIP</button>
            <button type="button" onClick={() => setSources([])} disabled={running || !sources.length}>Clear</button>
          </div>
          <input ref={zipInputRef} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => {
            const files = [...(e.target.files || [])];
            for (const file of files) void addZipFile(file).catch(showError);
            e.target.value = "";
          }} />
          <div className="merge-list">
            {sources.length ? sources.map((source, index) => (
              <div className="merge-source" key={`${source.kind}-${source.name}-${index}`}>
                <span>{source.name}</span>
                <button type="button" onClick={() => removeSource(index)} disabled={running}>Remove</button>
              </div>
            )) : <div className="empty">No source folders or ZIP files added.</div>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span>Merge Output</span>
          <span className="status">{targetRoot || status}</span>
        </div>
        <div className="panel-body">
          <div className="segmented merge-task-segmented">
            <label><input type="radio" name="mergeTask" value="detect" checked={task === "detect"} onChange={() => { setTask("detect"); void syncTarget(workspaceRoot, "detect", targetExplicit); }} disabled={running} />Detect</label>
            <label><input type="radio" name="mergeTask" value="classify" checked={task === "classify"} onChange={() => { setTask("classify"); void syncTarget(workspaceRoot, "classify", targetExplicit); }} disabled={running} />Classify</label>
          </div>
          <FolderPickerRow
            label="Target folder"
            value={targetRoot}
            browseLabel="Target Folder"
            disabled={running}
            readOnly={false}
            onChange={(value) => {
              setTargetRoot(value);
              setTargetExplicit(true);
            }}
            onBrowse={() => void chooseTarget()}
          />
          <div className="row merge-actions-row">
            <button className="primary" type="button" onClick={() => void runMerge()} disabled={running || !sources.length || !targetRoot}>Merge</button>
            <label><input type="checkbox" checked={autoRename} onChange={(e) => setAutoRename(e.target.checked)} disabled={running} /> Auto rename conflicts</label>
          </div>
          <div className="hint">Detect output keeps CVAT-style structure: images/train, labels/train, train.txt, and d1_/d2_/d3_ prefixes.</div>
          <div className="merge-val-train-card">
            <div className="group-title">Val → Train</div>
            <div className="row">
              <button type="button" onClick={() => void runValToTrain()} disabled={running || !targetRoot}>Val → Train</button>
            </div>
            <div className="hint">Move val data back to train on the selected target folder.</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <LogPanel>{log}</LogPanel>
          </div>
        </div>
      </section>

      {running ? (
        <div className="export-progress-overlay merge-progress-overlay">
          <div className="export-progress-card" role="dialog" aria-labelledby="mergeProgressTitle">
            <h2 id="mergeProgressTitle">Merging</h2>
            <progress value={progress.value} max={progress.total || 1} />
            <div className="export-progress-count">{progress.value} / {progress.total}</div>
            <div className="export-progress-detail">{progress.detail}</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
