import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import {
  chooseMaskDirectory,
  chooseMaskImageFile,
  defaultMaskNoiseSettings,
  deleteMaskImages,
  duplicateMaskImages,
  fileToBase64,
  joinBackendPath,
  listMaskFolderImages,
  maskNoiseExportFolder,
  maskNoisePreview,
  maskNoiseSaveOne,
  readMaskImageBase64,
  saveMaskNoiseTempImage,
  type MaskNoiseSettings
} from "./maskNoiseApi";

type FolderItem = { path: string; name: string; backendPath: string };

type Props = { onReady?: () => void };

const GRID_LIMIT = 500;

async function drawBase64ToCanvas(canvas: HTMLCanvasElement | null, base64: string) {
  if (!canvas || !base64) return;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable."));
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      resolve();
    };
    image.onerror = () => reject(new Error("Failed to load image preview."));
    image.src = `data:image/png;base64,${base64}`;
  });
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function MaskNoisePage({ onReady }: Props) {
  const { workspaceRoot } = useWorkspace();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<MaskNoiseSettings>(defaultMaskNoiseSettings);
  const [folderRoot, setFolderRoot] = useState("");
  const [folderItems, setFolderItems] = useState<FolderItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState("");
  const [photoPath, setPhotoPath] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoSize, setPhotoSize] = useState("");
  const [maskPath, setMaskPath] = useState("");
  const [maskName, setMaskName] = useState("");
  const [maskSize, setMaskSize] = useState("");
  const [outputRoot, setOutputRoot] = useState("");
  const [log, setLog] = useState("Ready.");
  const [duplicateMin, setDuplicateMin] = useState(1);
  const [duplicateMax, setDuplicateMax] = useState(3);
  const [pending, setPending] = useState(false);
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map());

  const maskMapRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const diffRef = useRef<HTMLCanvasElement>(null);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    return () => {
      for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
    };
  }, [thumbUrls]);

  const updateSetting = useCallback(<K extends keyof MaskNoiseSettings>(key: K, value: MaskNoiseSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const loadFolder = useCallback(async (rootPath: string, keepSelected = new Set<string>()) => {
    const paths = await listMaskFolderImages(rootPath);
    const items = paths.map((path) => ({
      path,
      name: path.split("/").pop() || path,
      backendPath: joinBackendPath(rootPath, path)
    }));
    const validSelected = new Set([...keepSelected].filter((path) => paths.includes(path)));
    setFolderRoot(rootPath);
    setFolderItems(items);
    setSelectedPaths(validSelected);
    setAnchorPath([...validSelected][0] || "");
  }, []);

  async function importFolder() {
    try {
      const rootPath = await chooseMaskDirectory("Choose Image Folder");
      if (!rootPath) return;
      setPending(true);
      await loadFolder(rootPath);
      setLog(`Imported folder.\nClick thumbnails to select/preview.`);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function chooseOutput() {
    try {
      const path = await chooseMaskDirectory("Choose Mask Cleanup Output Folder");
      if (!path) return;
      setOutputRoot(path);
      setLog(`Output: ${path}`);
    } catch (err) {
      showError(err);
    }
  }

  async function loadImagePath(path: string, kind: "photo" | "mask") {
    const base64 = await readMaskImageBase64(path);
    const name = path.split(/[\\/]/).pop() || path;
    if (kind === "mask") {
      await drawBase64ToCanvas(maskMapRef.current, base64);
      setMaskPath(path);
      setMaskName(name);
      const canvas = maskMapRef.current;
      setMaskSize(canvas ? `${canvas.width}x${canvas.height}` : "");
    } else {
      await drawBase64ToCanvas(photoRef.current, base64);
      await drawBase64ToCanvas(outputRef.current, base64);
      clearCanvas(diffRef.current);
      setPhotoPath(path);
      setPhotoName(name);
      const canvas = photoRef.current;
      setPhotoSize(canvas ? `${canvas.width}x${canvas.height}` : "");
    }
  }

  async function openImage(kind: "photo" | "mask") {
    try {
      const path = await chooseMaskImageFile(kind === "mask" ? "Choose Black/White Mask" : "Choose Photo");
      if (!path) return;
      await loadImagePath(path, kind);
    } catch (err) {
      showError(err);
    }
  }

  async function loadDroppedFile(file: File, kind: "photo" | "mask") {
    const base64 = await fileToBase64(file);
    const backendPath = await saveMaskNoiseTempImage(file.name || `${kind}.png`, base64, workspaceRoot);
    await loadImagePath(backendPath, kind);
  }

  async function selectFolderItem(item: FolderItem, index: number, event: React.MouseEvent) {
    const shown = folderItems.slice(0, GRID_LIMIT);
    let nextSelected = new Set(selectedPaths);
    if (event.shiftKey && anchorPath) {
      const anchorIndex = shown.findIndex((entry) => entry.path === anchorPath);
      const start = Math.max(0, Math.min(anchorIndex >= 0 ? anchorIndex : index, index));
      const end = Math.max(anchorIndex >= 0 ? anchorIndex : index, index);
      nextSelected = new Set();
      for (let i = start; i <= end; i += 1) nextSelected.add(shown[i].path);
    } else if (event.ctrlKey || event.metaKey) {
      if (nextSelected.has(item.path)) nextSelected.delete(item.path);
      else nextSelected.add(item.path);
      setAnchorPath(item.path);
    } else {
      nextSelected = new Set([item.path]);
      setAnchorPath(item.path);
    }
    setSelectedPaths(nextSelected);
    await loadImagePath(item.backendPath, "photo");
  }

  const ensureThumbUrl = useCallback(async (item: FolderItem) => {
    if (thumbUrls.has(item.path)) return thumbUrls.get(item.path)!;
    const base64 = await readMaskImageBase64(item.backendPath);
    const blob = await fetch(`data:image/jpeg;base64,${base64}`).then((r) => r.blob());
    const url = URL.createObjectURL(blob);
    setThumbUrls((prev) => new Map(prev).set(item.path, url));
    return url;
  }, [thumbUrls]);

  async function generatePreview() {
    if (!photoPath || !maskPath) {
      showToast("Open both a photo and a black/white mask first.", { variant: "error" });
      return;
    }
    setPending(true);
    try {
      const payload = await maskNoisePreview(photoPath, maskPath, settings);
      await drawBase64ToCanvas(outputRef.current, payload.outputBase64);
      await drawBase64ToCanvas(diffRef.current, payload.diffBase64);
      setLog(`Generated preview.\nblack noise=${payload.stats?.changed || 0}, gray erase=${payload.stats?.grayChanged || 0}`);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function saveOne() {
    if (!photoPath || !maskPath || !outputRoot) {
      showToast("Choose photo, mask, and output folder first.", { variant: "error" });
      return;
    }
    setPending(true);
    try {
      const result = await maskNoiseSaveOne(photoPath, maskPath, outputRoot, settings);
      await drawBase64ToCanvas(outputRef.current, result.outputBase64);
      await drawBase64ToCanvas(diffRef.current, result.diffBase64);
      setLog(`Saved: ${result.output}`);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function exportAll() {
    if (!maskPath || !folderRoot || !folderItems.length || !outputRoot) {
      showToast("Import folder, mask, and output folder first.", { variant: "error" });
      return;
    }
    setPending(true);
    try {
      const result = await maskNoiseExportFolder(folderRoot, maskPath, outputRoot, settings);
      if (result.firstPreview) {
        await drawBase64ToCanvas(outputRef.current, result.firstPreview.outputBase64);
        await drawBase64ToCanvas(diffRef.current, result.firstPreview.diffBase64);
      }
      const errorText = result.errors?.length ? `\nErrors:\n${result.errors.join("\n")}` : "";
      setLog(`Export complete.\nExported ${result.exported}/${result.total}, failed ${result.failed}.\nOutput: ${result.output}${errorText}`);
      showToast("Mask noise export finished.");
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function duplicateSelected() {
    if (!folderRoot) {
      showToast("Import a folder first.", { variant: "error" });
      return;
    }
    const items = folderItems.filter((item) => selectedPaths.has(item.path));
    if (!items.length) {
      showToast("Select thumbnails first.", { variant: "error" });
      return;
    }
    const low = Math.min(duplicateMin, duplicateMax);
    const high = Math.max(duplicateMin, duplicateMax);
    setPending(true);
    try {
      const result = await duplicateMaskImages(folderRoot, items.map((item) => item.path), low, high);
      await loadFolder(folderRoot, new Set(result.created || []));
      setLog(`Duplicate complete.\nCreated images: ${result.createdImages}\nCreated labels: ${result.createdLabels}`);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function deleteSelected(item: FolderItem) {
    if (!folderRoot) return;
    const items = selectedPaths.has(item.path) ? folderItems.filter((i) => selectedPaths.has(i.path)) : [item];
    if (!window.confirm(`Delete ${items.length} image(s) and matching labels?`)) return;
    setPending(true);
    try {
      const paths = items.map((i) => i.path);
      const result = await deleteMaskImages(folderRoot, paths);
      if (paths.some((path) => joinBackendPath(folderRoot, path) === photoPath)) {
        setPhotoPath("");
        setPhotoName("");
        clearCanvas(photoRef.current);
        clearCanvas(outputRef.current);
        clearCanvas(diffRef.current);
      }
      await loadFolder(folderRoot, new Set([...selectedPaths].filter((path) => !paths.includes(path))));
      setLog(`Deleted ${result.deletedImages} image(s) and ${result.deletedLabels} label(s).`);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  const statusText = `${photoSize ? `photo ${photoSize}` : "no photo"} | ${maskSize ? `mask ${maskSize}` : "no mask"}`;
  const selectedCount = folderItems.filter((item) => selectedPaths.has(item.path)).length;
  const shownItems = folderItems.slice(0, GRID_LIMIT);

  return (
    <main className="mask-noise-workspace">
      <section className="panel">
        <div className="panel-header">
          <span>Mask Cleanup</span>
          <span className="status">{statusText}</span>
        </div>
        <div className="panel-body mask-noise-stack">
          <div className="row">
            <button type="button" onClick={() => void importFolder()} disabled={pending}>Import Folder</button>
            <button type="button" onClick={() => void chooseOutput()} disabled={pending}>Output Folder</button>
            <button type="button" className="primary" onClick={() => void exportAll()} disabled={pending}>Export All</button>
            <button type="button" className="primary" onClick={() => void openImage("photo")} disabled={pending}>Open Photo</button>
            <button type="button" onClick={() => void openImage("mask")} disabled={pending}>Open B/W Mask</button>
            <button type="button" onClick={() => void generatePreview()} disabled={pending}>Generate</button>
            <button type="button" onClick={() => void saveOne()} disabled={pending}>Save PNG</button>
          </div>
          <div className="mask-noise-grid">
            <label>Black threshold<input type="number" min="0" max="255" value={settings.threshold} onChange={(e) => updateSetting("threshold", Number(e.target.value))} disabled={pending} /></label>
            <label>Noise sigma<input type="number" min="0" max="40" value={settings.noiseAmount} onChange={(e) => updateSetting("noiseAmount", Number(e.target.value))} disabled={pending} /></label>
            <label>Blur radius<input type="number" min="0" max="12" value={settings.blurRadius} onChange={(e) => updateSetting("blurRadius", Number(e.target.value))} disabled={pending} /></label>
            <label>Effect mix<input type="number" min="0" max="1" step="0.05" value={settings.effectMix} onChange={(e) => updateSetting("effectMix", Number(e.target.value))} disabled={pending} /></label>
            <label>Gray max<input type="number" min="0" max="255" value={settings.grayMax} onChange={(e) => updateSetting("grayMax", Number(e.target.value))} disabled={pending} /></label>
            <label>Gray erase mix<input type="number" min="0" max="1" step="0.05" value={settings.grayMix} onChange={(e) => updateSetting("grayMix", Number(e.target.value))} disabled={pending} /></label>
          </div>
          <div className="hint">Black mask areas receive light blur/noise. Gray mask areas get randomized background-like erasing. White areas stay unchanged.</div>
          <div className="duplicate-panel">
            <div className="row duplicate-head">
              <div className="group-title">Duplicate Selected</div>
              <span className="status">{folderItems.length ? `${selectedCount}/${folderItems.length} selected` : "No grid selection"}</span>
            </div>
            <div className="mask-noise-grid">
              <label>Min copies / image<input type="number" min="0" max="100" step="0.1" value={duplicateMin} onChange={(e) => setDuplicateMin(Number(e.target.value))} disabled={pending} /></label>
              <label>Max copies / image<input type="number" min="0" max="100" step="0.1" value={duplicateMax} onChange={(e) => setDuplicateMax(Number(e.target.value))} disabled={pending} /></label>
            </div>
            <div className="row">
              <button type="button" onClick={() => void duplicateSelected()} disabled={pending}>Duplicate Selected</button>
            </div>
          </div>
          <div
            className="mask-mini-preview"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drop-hover"); }}
            onDragLeave={(e) => e.currentTarget.classList.remove("drop-hover")}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("drop-hover");
              const file = e.dataTransfer.files?.[0];
              if (file) void loadDroppedFile(file, "mask").catch(showError);
            }}
          >
            <div className="group-title">Mask Preview</div>
            <canvas ref={maskMapRef} id="maskMapCanvas" />
          </div>
          <div className="merge-log mask-noise-log">{log}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">Preview</div>
        <div className="panel-body mask-noise-preview">
          <div className="mask-canvas-card">
            <div className="group-title">Photo {photoName ? `— ${photoName}` : ""}</div>
            <canvas ref={photoRef} id="maskOriginalCanvas" />
          </div>
          <div className="mask-canvas-card">
            <div className="group-title">Output</div>
            <canvas ref={outputRef} id="maskOutputCanvas" />
          </div>
          <div className="mask-canvas-card">
            <div className="group-title">Diff x8</div>
            <canvas ref={diffRef} id="maskDiffCanvas" />
          </div>
          <div className="mask-folder-grid" id="maskFolderGrid">
            {shownItems.length ? shownItems.map((item, index) => (
              <MaskFolderThumb
                key={item.path}
                item={item}
                selected={selectedPaths.has(item.path)}
                ensureUrl={ensureThumbUrl}
                onSelect={(event) => void selectFolderItem(item, index, event)}
                onDelete={() => void deleteSelected(item)}
                disabled={pending}
              />
            )) : <div className="empty">Import a folder to show image thumbnails.</div>}
            {folderItems.length > GRID_LIMIT ? <div className="empty">Showing first {GRID_LIMIT}/{folderItems.length} images.</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function MaskFolderThumb({
  item,
  selected,
  ensureUrl,
  onSelect,
  onDelete,
  disabled
}: {
  item: FolderItem;
  selected: boolean;
  ensureUrl: (item: FolderItem) => Promise<string>;
  onSelect: (event: React.MouseEvent) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let cancelled = false;
    ensureUrl(item).then((url) => { if (!cancelled) setSrc(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [item, ensureUrl]);

  return (
    <div className={`mask-folder-item${selected ? " selected" : ""}`} onClick={onSelect} role="button" tabIndex={0}>
      {src ? <img src={src} alt={item.name} loading="lazy" /> : <div className="empty">{item.name}</div>}
      <div className="mask-folder-name">{item.path}</div>
      <div className="mask-folder-actions">
        <button type="button" className="danger" disabled={disabled} onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
      </div>
    </div>
  );
}
