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
import {
  AUTO_LABEL_IN_FLIGHT_KEYS,
  autoLabelInFlightKey,
  autoLabelMediaKey,
  autoLabelRunButtonText,
  modelRunId,
  shouldAutoRunClassify,
  shouldAutoRunDetect,
  useAutoLabelRunner,
  type ClassificationClass,
} from "./useAutoLabelRunner";

export {
  CLF_AUTO_ASSIGN_MIN_CONFIDENCE,
  autoLabelMediaKey,
  autoLabelRunButtonText,
  autoLabelRunCanClearBusy,
  autoLabelRunIsCurrent,
  classifyPredictionIsConfident,
  modelRunId,
  shouldAutoRunClassify,
  shouldAutoRunDetect,
  shouldAutoRunForEmptySample,
} from "./useAutoLabelRunner";

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
  prepareSourceImageBase64?: (target: BoxLabelEntry) => Promise<string | null | undefined> | string | null | undefined;
  prepareSourceImagePath?: (target: BoxLabelEntry) => Promise<string | null | undefined>;
  requireSourceImageBase64?: boolean;
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
  prepareSourceImageBase64,
  prepareSourceImagePath,
  requireSourceImageBase64 = false,
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
  const currentMediaKeyRef = useRef("");
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
  const canPrepareBase64Source = typeof prepareSourceImageBase64 === "function";
  const canPrepareSource = typeof prepareSourceImagePath === "function";
  const hasExplicitBase64Source = typeof sourceImageBase64 === "string";
  const sourceReady = !hasExplicitBase64Source || sourceBase64.length > 0 || canPrepareBase64Source || sourcePath.length > 0 || canPrepareSource;
  const currentMediaKey = autoLabelMediaKey(currentImage);
  const shouldAutoDetect = shouldAutoRunDetect(boxCount, proposalCount);
  const shouldAutoClassify = shouldAutoRunClassify(currentClassificationKey);
  const detectAutoKey = detectModelRunId && currentMediaKey ? `detect:${detectModelRunId}:${currentMediaKey}` : "";
  const classifyAutoKey = classifyModelRunId && currentMediaKey ? `classify:${classifyModelRunId}:${currentMediaKey}` : "";
  const canAutoDetect = Boolean(detectAutoKey && onApplyDetectPredictions);
  const canAutoClassify = Boolean(classifyAutoKey && onAssignClassificationClass && classByName.size > 0);
  const autoRunPlanKey =
    workspaceRoot.trim() && currentMediaKey && autoRunKeysLoaded && sourceReady && autoRunAllowed && (shouldAutoDetect || shouldAutoClassify)
      ? [
          currentMediaKey,
          canAutoDetect && shouldAutoDetect ? detectAutoKey : "",
          canAutoClassify && shouldAutoClassify ? classifyAutoKey : "",
          boxCount,
          proposalCount,
          currentClassificationKey ?? "",
        ].join("|")
      : "";

  useEffect(() => {
    currentMediaKeyRef.current = currentMediaKey;
    runTokenRef.current += 1;
    setAutoRunning({ detect: false, classify: false });
    setStatus((current) => current && current.toLowerCase().includes("running") ? null : current);
  }, [currentMediaKey]);

  useEffect(() => {
    if (autoRunAllowed && sourceReady && currentMediaKey) return;
    runTokenRef.current += 1;
    setAutoRunning({ detect: false, classify: false });
    setStatus((current) => current && current.toLowerCase().includes("running") ? null : current);
  }, [autoRunAllowed, currentMediaKey, sourceReady]);

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

  const resolveSourceBase64 = useCallback(
    async (target: BoxLabelEntry) => {
      if (sourceBase64) return sourceBase64;
      const prepared = await prepareSourceImageBase64?.(target);
      return String(prepared || "").trim();
    },
    [prepareSourceImageBase64, sourceBase64]
  );

  const { runDetectAuto, runClassifyAuto } = useAutoLabelRunner({
    workspaceRoot,
    detectModel,
    classifyModel,
    classByName,
    requireSourceImageBase64,
    sourceUnavailableMessage,
    activeWorkspaceRootRef,
    runTokenRef,
    currentMediaKeyRef,
    resolveSourceBase64,
    resolveSourcePath,
    setAutoBusy,
    setStatus,
    setError,
    onApplyDetectPredictions,
    onAssignClassificationClass,
  });

  const handleRunDetectNow = useCallback(async () => {
    const target = currentImage;
    if (!target || !detectModel || !onApplyDetectPredictions || !sourceReady) return;
    setError(null);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    await runDetectAuto(target, token, () => false);
  }, [currentImage, detectModel, onApplyDetectPredictions, runDetectAuto, sourceReady]);

  const handleRunClassifyNow = useCallback(async () => {
    const target = currentImage;
    if (!target || !classifyModel || !onAssignClassificationClass || classByName.size === 0 || !sourceReady) return;
    setError(null);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    await runClassifyAuto(target, token, () => false);
  }, [classByName, classifyModel, currentImage, onAssignClassificationClass, runClassifyAuto, sourceReady]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    const target = currentImage;
    if (!autoRunPlanKey || !root || !target || !autoRunKeysLoaded || !sourceReady || !autoRunAllowed) return;
    const targetEntry = target;
    const detectInFlightKey = detectAutoKey ? autoLabelInFlightKey(root, detectAutoKey) : "";
    const classifyInFlightKey = classifyAutoKey ? autoLabelInFlightKey(root, classifyAutoKey) : "";
    const shouldDetect = Boolean(
      detectAutoKey &&
      onApplyDetectPredictions &&
      shouldAutoDetect &&
      !autoRunKeysRef.current.has(detectAutoKey) &&
      !AUTO_LABEL_IN_FLIGHT_KEYS.has(detectInFlightKey)
    );
    const shouldClassify = Boolean(
      classifyAutoKey &&
      onAssignClassificationClass &&
      classByName.size > 0 &&
      shouldAutoClassify &&
      !autoRunKeysRef.current.has(classifyAutoKey) &&
      !AUTO_LABEL_IN_FLIGHT_KEYS.has(classifyInFlightKey)
    );
    if (!shouldDetect && !shouldClassify) return;

    if (shouldDetect) {
      autoRunKeysRef.current.add(detectAutoKey);
      AUTO_LABEL_IN_FLIGHT_KEYS.add(detectInFlightKey);
    }
    if (shouldClassify) {
      autoRunKeysRef.current.add(classifyAutoKey);
      AUTO_LABEL_IN_FLIGHT_KEYS.add(classifyInFlightKey);
    }
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;

    setError(null);
    void (async () => {
      if (shouldDetect) {
        const ok = await runDetectAuto(targetEntry, token, () => token !== runTokenRef.current);
        AUTO_LABEL_IN_FLIGHT_KEYS.delete(detectInFlightKey);
        if (token === runTokenRef.current) {
          if (ok) {
            await persistAutoRunKey(detectAutoKey).catch(() => {});
          } else {
            autoRunKeysRef.current.delete(detectAutoKey);
          }
        }
      }
      if (token !== runTokenRef.current) return;
      if (shouldClassify) {
        const ok = await runClassifyAuto(targetEntry, token, () => token !== runTokenRef.current);
        AUTO_LABEL_IN_FLIGHT_KEYS.delete(classifyInFlightKey);
        if (token === runTokenRef.current) {
          if (ok) {
            await persistAutoRunKey(classifyAutoKey).catch(() => {});
          } else {
            autoRunKeysRef.current.delete(classifyAutoKey);
          }
        }
      }
    })().finally(() => {
      if (shouldDetect) AUTO_LABEL_IN_FLIGHT_KEYS.delete(detectInFlightKey);
      if (shouldClassify) AUTO_LABEL_IN_FLIGHT_KEYS.delete(classifyInFlightKey);
      if (token !== runTokenRef.current) {
        if (shouldDetect) autoRunKeysRef.current.delete(detectAutoKey);
        if (shouldClassify) autoRunKeysRef.current.delete(classifyAutoKey);
      }
    });
    // autoRunPlanKey is the scheduling boundary. The run functions and parent
    // callbacks may get new identities during normal render churn; that must
    // not restart the same marker/model auto-label job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoRunPlanKey,
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
  const detectRunLabel = autoLabelRunButtonText("detect", autoRunning.detect, status);
  const classifyRunLabel = autoLabelRunButtonText("classify", autoRunning.classify, status);

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
              {detectRunLabel}
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
              {classifyRunLabel}
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
