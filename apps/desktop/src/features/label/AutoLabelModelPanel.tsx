import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import {
  pickAndImportAutoLabelModel,
  readAutoLabelModelRegistry,
  type AutoLabelModelRegistry,
} from "../auto-label/autoLabelModelApi";
import {
  activeModelFilename,
  type AutoLabelModelKind,
} from "../auto-label/autoLabelModelRegistry";
import { readAutoLabelRunKeys, writeAutoLabelRunKeys } from "../auto-label/autoLabelRunRegistry";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";
import type { BoxLabelAutoLabelResult } from "../box-label/boxLabelTypes";
import { dispatchWorkspaceClassesChanged } from "../shared/workspaceClassEvents";
import { resolveActiveWorkspaceRoot } from "../workspace/activeWorkspaceRoot";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";

type ClassificationClass = { key: string; name: string; archived?: boolean };

type Props = {
  workspaceRoot: string;
  currentImage?: BoxLabelEntry | null;
  entries?: BoxLabelEntry[];
  currentIndex?: number;
  proposalCount?: number;
  boxCount?: number;
  classificationClasses?: ClassificationClass[];
  currentClassificationKey?: string | null;
  onApplyDetectPredictions?: (
    target: BoxLabelEntry,
    predictions: api.PtDetectPrediction[],
    options?: { highConfidence?: number; proposalConfidence?: number; modelId?: string; persistProposals?: boolean }
  ) => Promise<BoxLabelAutoLabelResult>;
  onAssignClassificationClass?: (classKey: string | null, basename?: string) => Promise<void>;
  onClassesChanged?: () => Promise<void> | void;
};

type AutoRunState = {
  detect: boolean;
  classify: boolean;
};

function classNamesFromModelInfo(info: api.PtModelInfo) {
  const structured = (info.classes || [])
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((item) => item.name.trim())
    .filter(Boolean);
  if (structured.length) return structured;
  return (info.classNames || [])
    .map((name) => String(name).trim())
    .filter(Boolean);
}

function predictionName(prediction: api.PtClassifyPrediction | null | undefined) {
  return (prediction?.className || prediction?.name || "").trim();
}

function confidenceText(value: number | undefined) {
  if (!Number.isFinite(value)) return "";
  return `${Math.round(Math.max(0, Math.min(1, value!)) * 100)}%`;
}

function modelClassMap(classes: ClassificationClass[]) {
  const map = new Map<string, ClassificationClass>();
  for (const item of classes) {
    if (item.archived) continue;
    map.set(item.key.trim().toLowerCase(), item);
    map.set(item.name.trim().toLowerCase(), item);
  }
  return map;
}

export function AutoLabelModelPanel({
  workspaceRoot,
  currentImage = null,
  entries = [],
  currentIndex = 0,
  proposalCount = 0,
  boxCount = 0,
  classificationClasses = [],
  currentClassificationKey = null,
  onApplyDetectPredictions,
  onAssignClassificationClass,
  onClassesChanged,
}: Props) {
  const [registry, setRegistry] = useState<AutoLabelModelRegistry>({});
  const [importing, setImporting] = useState<AutoLabelModelKind | null>(null);
  const [classImporting, setClassImporting] = useState<AutoLabelModelKind | null>(null);
  const [autoRunning, setAutoRunning] = useState<AutoRunState>({ detect: false, classify: false });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [autoRunKeysLoaded, setAutoRunKeysLoaded] = useState(false);
  const autoRunKeysRef = useRef<Set<string>>(new Set());
  const runTokenRef = useRef(0);
  const activeWorkspaceRootRef = useRef("");
  const workspaceClasses = useWorkspaceClasses(workspaceRoot);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) {
      setRegistry({});
      autoRunKeysRef.current = new Set();
      activeWorkspaceRootRef.current = "";
      setAutoRunKeysLoaded(false);
      return;
    }
    let cancelled = false;
    setAutoRunKeysLoaded(false);
    resolveActiveWorkspaceRoot(root)
      .then(async (activeRoot) => {
        if (cancelled) return;
        activeWorkspaceRootRef.current = activeRoot;
        const [registryResult, runKeysResult] = await Promise.allSettled([
          readAutoLabelModelRegistry(activeRoot),
          readAutoLabelRunKeys(activeRoot),
        ]);
        if (cancelled) return;
        setRegistry(registryResult.status === "fulfilled" ? registryResult.value : {});
        autoRunKeysRef.current = runKeysResult.status === "fulfilled" ? runKeysResult.value : new Set();
      })
      .finally(() => {
        if (!cancelled) setAutoRunKeysLoaded(true);
      });
    workspaceClasses.load().catch(() => {});
    return () => {
      cancelled = true;
    };
    // workspaceClasses.load is stable enough for this panel; reloading on every
    // hook state change would create noisy duplicate reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot]);

  const detectModel = registry.detect?.activeModel ?? "";
  const classifyModel = registry.classify?.activeModel ?? "";
  const classByName = useMemo(() => modelClassMap(classificationClasses), [classificationClasses]);
  const currentClassificationName = useMemo(() => {
    if (!currentClassificationKey) return "";
    return classificationClasses.find((item) => item.key === currentClassificationKey)?.name ?? currentClassificationKey;
  }, [classificationClasses, currentClassificationKey]);

  async function handleImport(kind: AutoLabelModelKind) {
    if (!workspaceRoot.trim()) return;
    setImporting(kind);
    setError(null);
    setStatus(null);
    try {
      const activeRoot = await resolveActiveWorkspaceRoot(workspaceRoot);
      activeWorkspaceRootRef.current = activeRoot;
      const updated = await pickAndImportAutoLabelModel(activeRoot, kind);
      if (updated) setRegistry(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(null);
    }
  }

  async function handleUseClasses(kind: AutoLabelModelKind) {
    if (!workspaceRoot.trim()) return;
    const entry = kind === "detect" ? registry.detect : registry.classify;
    if (!entry?.activeModel) return;
    setClassImporting(kind);
    setError(null);
    setStatus(null);
    try {
      const activeRoot = await resolveActiveWorkspaceRoot(workspaceRoot);
      activeWorkspaceRootRef.current = activeRoot;
      const info = await api.ptModelInfo(activeRoot, entry.activeModel);
      const names = classNamesFromModelInfo(info);
      if (!names.length) throw new Error("No classes found in this model.");
      const result = kind === "detect"
        ? await workspaceClasses.importDetectClasses(names)
        : await workspaceClasses.importClfClasses(names);
      await workspaceClasses.load().catch(() => {});
      await onClassesChanged?.();
      dispatchWorkspaceClassesChanged(workspaceRoot);
      setStatus(`${kind === "detect" ? "Detect" : "Clf"} classes: ${result.added} added, ${result.skipped} skipped.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to use model classes.");
    } finally {
      setClassImporting(null);
    }
  }

  const setAutoBusy = useCallback((kind: keyof AutoRunState, value: boolean) => {
    setAutoRunning((current) => ({ ...current, [kind]: value }));
  }, []);

  const persistAutoRunKey = useCallback(
    async (key: string) => {
      if (!workspaceRoot.trim()) return;
      autoRunKeysRef.current.add(key);
      const activeRoot = await resolveActiveWorkspaceRoot(workspaceRoot);
      activeWorkspaceRootRef.current = activeRoot;
      await writeAutoLabelRunKeys(activeRoot, autoRunKeysRef.current);
    },
    [workspaceRoot]
  );

  const runDetectAuto = useCallback(
    async (target: BoxLabelEntry, token: number, isCancelled: () => boolean) => {
      if (!detectModel || !onApplyDetectPredictions) return false;
      setAutoBusy("detect", true);
      if (!isCancelled() && runTokenRef.current === token) setStatus("Detect: running...");
      try {
        const modelRoot = activeWorkspaceRootRef.current || workspaceRoot;
        const result = await api.detectImageWithPt(modelRoot, detectModel, target.imagePath, 640, 0.25, "cpu");
        const applied = await onApplyDetectPredictions(target, result.predictions, {
          highConfidence: 0.8,
          proposalConfidence: 0.25,
          modelId: detectModel,
          persistProposals: false,
        });
        if (!isCancelled() && runTokenRef.current === token) {
          setStatus(`Detect: ${applied.boxesAdded} box(es), ${applied.proposalsAdded} proposal(s), ${applied.skipped} skipped.`);
        }
        return true;
      } catch (err) {
        if (!isCancelled() && runTokenRef.current === token) {
          setError(err instanceof Error ? err.message : "Auto detect failed.");
          setStatus(null);
        }
        return false;
      } finally {
        setAutoBusy("detect", false);
      }
    },
    [detectModel, onApplyDetectPredictions, setAutoBusy, workspaceRoot]
  );

  const runClassifyAuto = useCallback(
    async (target: BoxLabelEntry, token: number, isCancelled: () => boolean) => {
      if (!classifyModel || !onAssignClassificationClass || classByName.size === 0) return false;
      setAutoBusy("classify", true);
      if (!isCancelled() && runTokenRef.current === token) setStatus("Clf: running...");
      try {
        const modelRoot = activeWorkspaceRootRef.current || workspaceRoot;
        const result = await api.classifyImageWithPt(modelRoot, classifyModel, target.imagePath, 224, "cpu", 5);
        const top = result.top ?? result.predictions?.[0] ?? null;
        const name = predictionName(top);
        const match = name ? classByName.get(name.toLowerCase()) : null;
        const confidence = confidenceText(top?.confidence);
        if (!match) {
          if (!isCancelled() && runTokenRef.current === token) {
            setStatus(name ? `Clf: ${name}${confidence ? ` ${confidence}` : ""} not in class list.` : "Clf: no prediction.");
          }
          return true;
        }
        await onAssignClassificationClass(match.key, target.basename);
        if (!isCancelled() && runTokenRef.current === token) {
          setStatus(`Clf: ${match.name}${confidence ? ` ${confidence}` : ""}.`);
        }
        return true;
      } catch (err) {
        if (!isCancelled() && runTokenRef.current === token) {
          setError(err instanceof Error ? err.message : "Auto classify failed.");
          setStatus(null);
        }
        return false;
      } finally {
        setAutoBusy("classify", false);
      }
    },
    [classByName, classifyModel, onAssignClassificationClass, setAutoBusy, workspaceRoot]
  );

  const handleRunDetectNow = useCallback(async () => {
    const target = currentImage;
    if (!target || !detectModel || !onApplyDetectPredictions) return;
    setError(null);
    await runDetectAuto(target, runTokenRef.current, () => false);
  }, [currentImage, detectModel, onApplyDetectPredictions, runDetectAuto]);

  const handleRunClassifyNow = useCallback(async () => {
    const target = currentImage;
    if (!target || !classifyModel || !onAssignClassificationClass || classByName.size === 0) return;
    setError(null);
    await runClassifyAuto(target, runTokenRef.current, () => false);
  }, [classByName, classifyModel, currentImage, onAssignClassificationClass, runClassifyAuto]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    const target = currentImage;
    if (!root || !target || !autoRunKeysLoaded) return;
    const targetEntry = target;
    const targetId = targetEntry.imagePath || targetEntry.basename;
    const detectKey = detectModel ? `detect:${detectModel}:${targetId}` : "";
    const classifyKey = classifyModel ? `classify:${classifyModel}:${targetId}` : "";
    const shouldDetect = Boolean(detectKey && onApplyDetectPredictions && !autoRunKeysRef.current.has(detectKey));
    const shouldClassify = Boolean(
      classifyKey &&
      onAssignClassificationClass &&
      classByName.size > 0 &&
      !autoRunKeysRef.current.has(classifyKey)
    );
    if (!shouldDetect && !shouldClassify) return;

    if (shouldDetect) autoRunKeysRef.current.add(detectKey);
    if (shouldClassify) autoRunKeysRef.current.add(classifyKey);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    let cancelled = false;

    const tasks: Promise<void>[] = [];
    setError(null);
    if (shouldDetect) {
      tasks.push((async () => {
        const ok = await runDetectAuto(targetEntry, token, () => cancelled);
        if (!cancelled && ok) {
          await persistAutoRunKey(detectKey).catch(() => {});
        } else if (!ok) {
          autoRunKeysRef.current.delete(detectKey);
        }
      })());
    }
    if (shouldClassify) {
      tasks.push((async () => {
        const ok = await runClassifyAuto(targetEntry, token, () => cancelled);
        if (!cancelled && ok) {
          await persistAutoRunKey(classifyKey).catch(() => {});
        } else if (!ok) {
          autoRunKeysRef.current.delete(classifyKey);
        }
      })());
    }

    void Promise.all(tasks);
    return () => {
      cancelled = true;
    };
  }, [
    classByName,
    classifyModel,
    currentImage,
    detectModel,
    autoRunKeysLoaded,
    onApplyDetectPredictions,
    onAssignClassificationClass,
    persistAutoRunKey,
    runClassifyAuto,
    runDetectAuto,
    workspaceRoot,
  ]);

  const detectName = activeModelFilename(registry.detect) ?? "Not set";
  const classifyName = activeModelFilename(registry.classify) ?? "Not set";
  const detectSet = !!detectModel;
  const classifySet = !!classifyModel;
  const detectBusy = importing === "detect" || classImporting === "detect" || autoRunning.detect || workspaceClasses.saving;
  const classifyBusy =
    importing === "classify" || classImporting === "classify" || autoRunning.classify || workspaceClasses.saving;
  const anyImporting = importing !== null || classImporting !== null;
  const autoLabel = autoRunning.detect && autoRunning.classify
    ? "Auto running"
    : autoRunning.detect
      ? "Detecting"
      : autoRunning.classify
      ? "Classifying"
      : detectSet || classifySet
        ? "Auto on"
        : "Models not set";

  return (
    <section className="alm-panel">
      <div className="alm-panel-head">
        <div>
          <div className="alm-panel-label alm-panel-title">Auto Label</div>
          <div className="alm-panel-subtitle">Runs once when a new image is opened.</div>
        </div>
        <span className={`alm-panel-auto-badge${autoRunning.detect || autoRunning.classify ? " active" : ""}`}>
          {autoLabel}
        </span>
      </div>

      <div className="alm-model-list">
        <div className="alm-model-row">
          <div className="alm-panel-col">
            <div className="alm-panel-label">Detect</div>
            <div className={`alm-panel-value${detectSet ? "" : " alm-panel-value--unset"}`} title={detectName}>
              {detectName}
            </div>
          </div>
          <div className="alm-panel-actions">
            <button
              type="button"
              className="alm-panel-btn"
              disabled={detectBusy || anyImporting}
              aria-busy={importing === "detect" || undefined}
              onClick={() => {
                void handleImport("detect");
              }}
            >
              {importing === "detect" ? "Importing..." : detectSet ? "Change" : "Import"}
            </button>
            <button
              type="button"
              className="alm-panel-btn"
              disabled={detectBusy || anyImporting || !detectSet}
              aria-busy={classImporting === "detect" || undefined}
              onClick={() => {
                void handleUseClasses("detect");
              }}
            >
              {classImporting === "detect" ? "Reading..." : "Use Classes"}
            </button>
            <button
              type="button"
              className="alm-panel-btn alm-panel-btn--primary"
              disabled={detectBusy || !detectSet || !currentImage || !onApplyDetectPredictions}
              aria-busy={autoRunning.detect || undefined}
              onClick={() => {
                void handleRunDetectNow();
              }}
            >
              {autoRunning.detect ? "Running..." : "Run Detect"}
            </button>
          </div>
        </div>

        <div className="alm-model-row">
          <div className="alm-panel-col">
            <div className="alm-panel-label">Classify</div>
            <div className={`alm-panel-value${classifySet ? "" : " alm-panel-value--unset"}`} title={classifyName}>
              {classifyName}
            </div>
          </div>
          <div className="alm-panel-actions">
            <button
              type="button"
              className="alm-panel-btn"
              disabled={classifyBusy || anyImporting}
              aria-busy={importing === "classify" || undefined}
              onClick={() => {
                void handleImport("classify");
              }}
            >
              {importing === "classify" ? "Importing..." : classifySet ? "Change" : "Import"}
            </button>
            <button
              type="button"
              className="alm-panel-btn"
              disabled={classifyBusy || anyImporting || !classifySet}
              aria-busy={classImporting === "classify" || undefined}
              onClick={() => {
                void handleUseClasses("classify");
              }}
            >
              {classImporting === "classify" ? "Reading..." : "Use Classes"}
            </button>
            <button
              type="button"
              className="alm-panel-btn alm-panel-btn--primary"
              disabled={classifyBusy || !classifySet || !currentImage || !onAssignClassificationClass || classByName.size === 0}
              aria-busy={autoRunning.classify || undefined}
              onClick={() => {
                void handleRunClassifyNow();
              }}
            >
              {autoRunning.classify ? "Running..." : "Run Clf"}
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="alm-panel-error">{error}</div> : null}
      {status ? <div className="alm-panel-status">{status}</div> : null}
      <div className="alm-panel-summary">
        <span>{currentIndex + 1} / {Math.max(entries.length, 1)}</span>
        <span>{boxCount} box(es)</span>
        <span>{proposalCount} proposal(s)</span>
      </div>
      {currentClassificationName ? (
        <div className="alm-panel-current-clf" title={currentClassificationName}>
          Current clf: {currentClassificationName}
        </div>
      ) : null}
    </section>
  );
}
