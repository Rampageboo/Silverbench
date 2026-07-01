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

type ClassificationClass = { key: string; name: string; aliases?: string[]; archived?: boolean };

type Props = {
  workspaceRoot: string;
  currentImage?: BoxLabelEntry | null;
  entries?: BoxLabelEntry[];
  currentIndex?: number;
  proposalCount?: number;
  boxCount?: number;
  classificationClasses?: ClassificationClass[];
  currentClassificationKey?: string | null;
  sourceImageBase64?: string | null;
  sourceImagePath?: string | null;
  prepareSourceImagePath?: (target: BoxLabelEntry) => Promise<string | null | undefined>;
  sourceUnavailableMessage?: string;
  autoRunAllowed?: boolean;
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

export const CLF_AUTO_ASSIGN_MIN_CONFIDENCE = 0.55;

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

export function classifyPredictionIsConfident(confidence: unknown) {
  return typeof confidence === "number" && Number.isFinite(confidence) && confidence >= CLF_AUTO_ASSIGN_MIN_CONFIDENCE;
}

export function modelRunId(modelPath: string, updatedAt: string | undefined) {
  const model = modelPath.trim();
  const stamp = String(updatedAt || "").trim();
  return stamp ? `${model}@${stamp}` : model;
}

export function shouldAutoRunDetect(existingBoxCount: number, existingProposalCount: number) {
  return existingBoxCount <= 0 && existingProposalCount <= 0;
}

export function shouldAutoRunClassify(currentClassKey: string | null | undefined) {
  return !String(currentClassKey || "").trim();
}

export function shouldAutoRunForEmptySample(
  existingBoxCount: number,
  existingProposalCount: number,
  currentClassKey: string | null | undefined
) {
  return shouldAutoRunDetect(existingBoxCount, existingProposalCount) && shouldAutoRunClassify(currentClassKey);
}

function modelClassMap(classes: ClassificationClass[]) {
  const map = new Map<string, ClassificationClass>();
  for (const item of classes) {
    if (item.archived) continue;
    map.set(item.key.trim().toLowerCase(), item);
    map.set(item.name.trim().toLowerCase(), item);
    for (const alias of item.aliases ?? []) {
      const key = alias.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, item);
    }
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
  sourceImageBase64,
  sourceImagePath,
  prepareSourceImagePath,
  sourceUnavailableMessage,
  autoRunAllowed = true,
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
  const detectModelRunId = modelRunId(detectModel, registry.detect?.updatedAt);
  const classifyModelRunId = modelRunId(classifyModel, registry.classify?.updatedAt);
  const classByName = useMemo(() => modelClassMap(classificationClasses), [classificationClasses]);
  const currentClassificationName = useMemo(() => {
    if (!currentClassificationKey) return "";
    return classificationClasses.find((item) => item.key === currentClassificationKey)?.name ?? currentClassificationKey;
  }, [classificationClasses, currentClassificationKey]);
  const sourceBase64 = typeof sourceImageBase64 === "string" ? sourceImageBase64.trim() : "";
  const sourcePath = typeof sourceImagePath === "string" ? sourceImagePath.trim() : "";
  const canPrepareSource = typeof prepareSourceImagePath === "function";
  const sourceReady = sourceImageBase64 === undefined || sourceBase64.length > 0 || sourcePath.length > 0 || canPrepareSource;

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

  const resolveSourcePath = useCallback(
    async (target: BoxLabelEntry) => {
      if (sourceBase64) return "";
      if (sourcePath) return sourcePath;
      const prepared = await prepareSourceImagePath?.(target);
      const preparedPath = String(prepared || "").trim();
      if (prepareSourceImagePath) {
        if (!preparedPath) throw new Error(sourceUnavailableMessage || "Source image is not ready.");
        return preparedPath;
      }
      return target.imagePath;
    },
    [prepareSourceImagePath, sourceBase64, sourcePath, sourceUnavailableMessage]
  );

  const runDetectAuto = useCallback(
    async (target: BoxLabelEntry, token: number, isCancelled: () => boolean) => {
      if (!detectModel || !onApplyDetectPredictions) return false;
      setAutoBusy("detect", true);
      if (!isCancelled() && runTokenRef.current === token) setStatus("Detect: running...");
      try {
        const modelRoot = activeWorkspaceRootRef.current || workspaceRoot;
        const imagePath = await resolveSourcePath(target);
        const result = sourceBase64
          ? await api.detectImageBase64WithPt(modelRoot, detectModel, sourceBase64, 640, 0.25, "cpu")
          : await api.detectImageWithPt(modelRoot, detectModel, imagePath, 640, 0.25, "cpu");
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
    [detectModel, onApplyDetectPredictions, resolveSourcePath, setAutoBusy, sourceBase64, workspaceRoot]
  );

  const runClassifyAuto = useCallback(
    async (target: BoxLabelEntry, token: number, isCancelled: () => boolean) => {
      if (!classifyModel || !onAssignClassificationClass || classByName.size === 0) return false;
      setAutoBusy("classify", true);
      if (!isCancelled() && runTokenRef.current === token) setStatus("Clf: running...");
      try {
        const modelRoot = activeWorkspaceRootRef.current || workspaceRoot;
        const imagePath = await resolveSourcePath(target);
        const result = sourceBase64
          ? await api.classifyImageBase64WithPt(modelRoot, classifyModel, sourceBase64, 0, "cpu", 5)
          : await api.classifyImageWithPt(modelRoot, classifyModel, imagePath, 0, "cpu", 5);
        const top = result.top ?? result.predictions?.[0] ?? null;
        const name = predictionName(top);
        const match = name ? classByName.get(name.toLowerCase()) : null;
        const rawConfidence = typeof top?.confidence === "number" ? top.confidence : NaN;
        const confidence = confidenceText(rawConfidence);
        if (!classifyPredictionIsConfident(rawConfidence)) {
          if (!isCancelled() && runTokenRef.current === token) {
            setStatus(
              name
                ? `Clf: ${name}${confidence ? ` ${confidence}` : ""} below threshold; not assigned.`
                : "Clf: no confident prediction."
            );
          }
          return true;
        }
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
    [classByName, classifyModel, onAssignClassificationClass, resolveSourcePath, setAutoBusy, sourceBase64, workspaceRoot]
  );

  const handleRunDetectNow = useCallback(async () => {
    const target = currentImage;
    if (!target || !detectModel || !onApplyDetectPredictions || !sourceReady) return;
    setError(null);
    await runDetectAuto(target, runTokenRef.current, () => false);
  }, [currentImage, detectModel, onApplyDetectPredictions, runDetectAuto, sourceReady]);

  const handleRunClassifyNow = useCallback(async () => {
    const target = currentImage;
    if (!target || !classifyModel || !onAssignClassificationClass || classByName.size === 0 || !sourceReady) return;
    setError(null);
    await runClassifyAuto(target, runTokenRef.current, () => false);
  }, [classByName, classifyModel, currentImage, onAssignClassificationClass, runClassifyAuto, sourceReady]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    const target = currentImage;
    if (!root || !target || !autoRunKeysLoaded || !sourceReady || !autoRunAllowed) return;
    const targetEntry = target;
    const targetId = targetEntry.imagePath || targetEntry.basename;
    const detectKey = detectModelRunId ? `detect:${detectModelRunId}:${targetId}` : "";
    const classifyKey = classifyModelRunId ? `classify:${classifyModelRunId}:${targetId}` : "";
    const sampleIsEmpty = shouldAutoRunForEmptySample(boxCount, proposalCount, currentClassificationKey);
    const shouldDetect = Boolean(
      detectKey &&
      onApplyDetectPredictions &&
      sampleIsEmpty &&
      !autoRunKeysRef.current.has(detectKey)
    );
    const shouldClassify = Boolean(
      classifyKey &&
      onAssignClassificationClass &&
      classByName.size > 0 &&
      sampleIsEmpty &&
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
    boxCount,
    classifyModel,
    classifyModelRunId,
    currentImage,
    currentClassificationKey,
    detectModel,
    detectModelRunId,
    autoRunKeysLoaded,
    onApplyDetectPredictions,
    onAssignClassificationClass,
    proposalCount,
    persistAutoRunKey,
    runClassifyAuto,
    runDetectAuto,
    sourceReady,
    autoRunAllowed,
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
      : !autoRunAllowed
        ? "Manual"
      : detectSet || classifySet
        ? "Auto on"
        : "Models not set";
  const autoSubtitle = autoRunAllowed
    ? "Runs once when a new image is opened."
    : "Manual buttons only.";

  return (
    <section className="alm-panel">
      <div className="alm-panel-head">
        <div>
          <div className="alm-panel-label alm-panel-title">Auto Label Models</div>
          <div className="alm-panel-subtitle">{autoSubtitle}</div>
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
              disabled={detectBusy || !detectSet || !currentImage || !onApplyDetectPredictions || !sourceReady}
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
              disabled={classifyBusy || !classifySet || !currentImage || !onAssignClassificationClass || classByName.size === 0 || !sourceReady}
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
      {status ? <div className="alm-panel-status">{status}</div> : !sourceReady && sourceUnavailableMessage ? (
        <div className="alm-panel-status">{sourceUnavailableMessage}</div>
      ) : null}
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
