import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import {
  chooseMergeDirectory,
  isImagePath,
  isTextPath,
  listMergeFiles,
  loadMergeWorkspace,
  readMergeBase64,
  readMergeText,
  writeMergeBase64,
  writeMergeText,
  type MergeTask
} from "./mergeApi";

type Props = { onReady?: () => void };
type Source = { root: string; name: string };

type Stats = {
  copied: number;
  renamed: number;
  skipped: number;
  failed: number;
};

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function destinationFor(path: string, sourceIndex: number, task: MergeTask, existing: Set<string>, reserved: Set<string>, autoRename: boolean) {
  let destination = path.replace(/\\/g, "/");
  if (task === "detect" && isImagePath(destination)) {
    const name = baseName(destination);
    destination = `images/train/${name}`;
  }
  if (task === "classify" && isImagePath(destination)) {
    const parts = destination.split("/");
    const className = parts.length >= 2 ? parts[parts.length - 2] : "unknown";
    destination = `train/${className}/${baseName(destination)}`;
  }
  if (!isImagePath(destination) && !/labels\//.test(destination) && !/(data|dataset)\.ya?ml$/i.test(destination)) return null;
  const key = destination.toLowerCase();
  if (!existing.has(key) && !reserved.has(key)) return destination;
  if (!autoRename) return null;
  const parts = destination.split("/");
  const filename = parts.pop() || destination;
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  const renamed = `${stem}_m${sourceIndex + 1}${ext}`;
  return [...parts, renamed].join("/");
}

function labelForImage(path: string) {
  const name = baseName(path).replace(/\.[^.]+$/, ".txt");
  return `labels/train/${name}`;
}

export function MergePage({ onReady }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const [task, setTask] = useState<MergeTask>("detect");
  const [targetRoot, setTargetRoot] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [autoRename, setAutoRename] = useState(true);
  const [status, setStatus] = useState("Add source folders and choose a target folder.");
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(false);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!workspaceRoot.trim()) {
        onReady?.();
        return;
      }
      try {
        const info = await loadMergeWorkspace(workspaceRoot);
        if (cancelled) return;
        const nextTarget = task === "classify" ? info.clfDataset : info.detectDataset;
        if (nextTarget && !targetRoot) setTargetRoot(nextTarget);
        setStatus(`Workspace: ${info.name || info.root}`);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, task, targetRoot, onReady, showError]);

  const canRun = useMemo(() => sources.length > 0 && Boolean(targetRoot), [sources.length, targetRoot]);

  async function addSource() {
    const root = await chooseMergeDirectory("Choose source dataset folder");
    if (!root) return;
    if (sources.some((source) => source.root === root)) return;
    setSources([...sources, { root, name: baseName(root) }]);
  }

  async function chooseTarget() {
    const root = await chooseMergeDirectory("Choose target dataset folder");
    if (root) setTargetRoot(root);
  }

  async function copyOne(sourceRoot: string, sourcePath: string, destPath: string) {
    if (isTextPath(sourcePath)) {
      const text = await readMergeText(sourceRoot, sourcePath);
      await writeMergeText(targetRoot, destPath, text);
      return;
    }
    const data = await readMergeBase64(sourceRoot, sourcePath);
    await writeMergeBase64(targetRoot, destPath, data);
  }

  async function runMerge() {
    if (!canRun) {
      showToast("Add sources and choose a target first.", { variant: "error" });
      return;
    }
    if (sources.some((source) => source.root === targetRoot)) {
      showToast("Target cannot also be a source.", { variant: "error" });
      return;
    }
    if (!window.confirm(`Merge ${sources.length} source folder(s) into target?\n\nTarget: ${targetRoot}`)) return;
    setRunning(true);
    const stats: Stats = { copied: 0, renamed: 0, skipped: 0, failed: 0 };
    const lines = [`Task: ${task}`, `Target: ${targetRoot}`];
    try {
      const existing = new Set((await listMergeFiles(targetRoot)).map((path) => path.toLowerCase()));
      const reserved = new Set<string>();
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
        const source = sources[sourceIndex];
        const files = await listMergeFiles(source.root);
        lines.push(``, `${source.name}: ${files.length} file(s)`);
        for (const path of files) {
          if (!isImagePath(path)) continue;
          const destination = destinationFor(path, sourceIndex, task, existing, reserved, autoRename);
          if (!destination) {
            stats.skipped += 1;
            continue;
          }
          try {
            await copyOne(source.root, path, destination);
            existing.add(destination.toLowerCase());
            reserved.add(destination.toLowerCase());
            stats.copied += 1;
            if (destination !== path) stats.renamed += 1;
            if (task === "detect") {
              const sourceLabel = path.replace(/^images\//, "labels/").replace(/\.[^.]+$/, ".txt");
              const targetLabel = labelForImage(destination);
              if (files.includes(sourceLabel)) await copyOne(source.root, sourceLabel, targetLabel);
              else await writeMergeText(targetRoot, targetLabel, "");
            }
          } catch (err) {
            stats.failed += 1;
            lines.push(`FAILED ${path}: ${errMessage(err)}`);
          }
        }
      }
      const summary = `Done. Copied ${stats.copied}, renamed ${stats.renamed}, skipped ${stats.skipped}, failed ${stats.failed}.`;
      lines.push("", summary);
      setStatus(summary);
      setLog(lines.join("\n"));
      showToast("Merge finished.");
    } catch (err) {
      const message = errMessage(err);
      setStatus(message);
      setLog(`${lines.join("\n")}\n\n${message}`);
      showError(err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="merge-native-page">
      <section className="panel">
        <div className="panel-header"><span>Dataset Merge</span><span className="status">{status}</span></div>
        <div className="panel-body">
          <div className="row"><button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={running}>Open Workspace</button></div>
          <div className="grid two">
            <label>Task<select value={task} onChange={(event) => setTask(event.target.value as MergeTask)} disabled={running}><option value="detect">Detect</option><option value="classify">Classify</option></select></label>
            <label><input type="checkbox" checked={autoRename} onChange={(event) => setAutoRename(event.target.checked)} disabled={running} /> Auto rename conflicts</label>
          </div>
          <label>Target folder<div className="row"><input value={targetRoot} onChange={(event) => setTargetRoot(event.target.value)} /><button type="button" onClick={() => chooseTarget().catch(showError)} disabled={running}>Choose</button></div></label>
          <div className="row"><button type="button" onClick={() => addSource().catch(showError)} disabled={running}>Add Source Folder</button><button type="button" onClick={() => setSources([])} disabled={running || !sources.length}>Clear Sources</button></div>
          <div className="info-card"><strong>Sources</strong>{sources.length ? sources.map((source, index) => <p key={source.root}>{index + 1}. {source.root}</p>) : <p>No source folders added.</p>}</div>
          <button className="primary" type="button" onClick={() => void runMerge()} disabled={running || !canRun}>Run Merge</button>
          <div className="hint">Native merge currently supports backend-accessible folders. ZIP and drag-and-drop remain available in the legacy implementation.</div>
        </div>
      </section>
      <section className="panel"><div className="panel-header"><span>Log</span></div><div className="panel-body"><pre className="log">{log || "No merge run yet."}</pre></div></section>
    </main>
  );
}
