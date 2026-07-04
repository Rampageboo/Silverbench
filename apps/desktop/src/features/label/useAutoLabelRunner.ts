import { useCallback, type MutableRefObject } from "react";
import * as api from "../../api";
import type { AutoLabelModelKind } from "../auto-label/autoLabelModelRegistry";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";
import type { BoxLabelAutoLabelResult } from "../box-label/boxLabelTypes";

export type ClassificationClass = { key: string; name: string; aliases?: string[]; archived?: boolean };
export type AutoLabelBusyKind = "detect" | "classify";

export const CLF_AUTO_ASSIGN_MIN_CONFIDENCE = 0.55;
const SOURCE_PREP_TIMEOUT_MS = 15000;
const MODEL_INFERENCE_TIMEOUT_MS = 60000;
const PT_JOB_POLL_MS = 500;
const AUTO_LABEL_DEVICE = "0";

export const AUTO_LABEL_IN_FLIGHT_KEYS = new Set<string>();

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

export function autoLabelMediaKey(target: BoxLabelEntry | null | undefined) {
  return target ? target.imagePath || target.basename : "";
}

export function autoLabelRunIsCurrent({
  cancelled,
  token,
  activeToken,
  targetMediaKey,
  currentMediaKey,
}: {
  cancelled: boolean;
  token: number;
  activeToken: number;
  targetMediaKey: string;
  currentMediaKey: string;
}) {
  return !cancelled && token === activeToken && targetMediaKey === currentMediaKey;
}

export function autoLabelRunCanClearBusy(token: number, activeToken: number) {
  return token === activeToken;
}

export function autoLabelRunButtonText(kind: AutoLabelModelKind, running: boolean, status: string | null) {
  if (!running) return kind === "detect" ? "Run Detect" : "Run Clf";
  const prefix = kind === "detect" ? "Detect: " : "Clf: ";
  if (!status?.startsWith(prefix)) return "Running...";
  const detail = status.slice(prefix.length).trim().toLowerCase();
  if (detail.includes("preparing")) return "Preparing...";
  if (detail.includes("starting")) return "Starting...";
  if (detail.includes("running preview") || detail.includes("running base64") || detail.includes("running detect") || detail.includes("running classify")) {
    return kind === "detect" ? "Detecting..." : "Classifying...";
  }
  if (detail.includes("applying")) return "Applying...";
  if (detail.includes("polling")) return "Waiting...";
  return "Running...";
}

export function autoLabelInFlightKey(workspaceRoot: string, runKey: string) {
  return `${workspaceRoot.trim()}::${runKey}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForPtImageJob<T>(
  startJob: () => Promise<api.PtJob>,
  isCancelled: () => boolean,
  onStatus: (status: string) => void,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  onStatus("starting backend job...");
  const started = await startJob();
  const jobId = String(started.id || "");
  if (!jobId) throw new Error("Auto label job did not return an id.");
  let latest = started;
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let shouldCancelBackend = false;
  try {
    while (true) {
      if (isCancelled()) {
        shouldCancelBackend = true;
        throw new Error("Auto label cancelled.");
      }
      if (Date.now() >= deadline) {
        shouldCancelBackend = true;
        throw new Error(timeoutMessage);
      }
      const state = String(latest.status || "");
      const detail = String(latest.detail || "");
      if (detail) onStatus(detail);
      else onStatus(`polling job ${jobId.slice(0, 8)}...`);
      if (state === "done") {
        if (!latest.result) throw new Error("Auto label job completed without a result.");
        return latest.result as T;
      }
      if (state === "error") {
        const message = latest.errors?.[0] || latest.detail || "Auto label job failed.";
        throw new Error(message);
      }
      if (state === "cancelled") throw new Error("Auto label cancelled.");
      await sleep(Math.min(PT_JOB_POLL_MS, Math.max(1, deadline - Date.now())));
      latest = await api.getPtJob(jobId);
    }
  } catch (error) {
    if (shouldCancelBackend) {
      await api.cancelPtJob(jobId).catch(() => {});
    }
    throw error;
  }
}

type UseAutoLabelRunnerOptions = {
  workspaceRoot: string;
  detectModel: string;
  classifyModel: string;
  classByName: Map<string, ClassificationClass>;
  requireSourceImageBase64: boolean;
  sourceUnavailableMessage?: string;
  activeWorkspaceRootRef: MutableRefObject<string>;
  runTokenRef: MutableRefObject<number>;
  currentMediaKeyRef: MutableRefObject<string>;
  resolveSourceBase64: (target: BoxLabelEntry) => Promise<string>;
  resolveSourcePath: (target: BoxLabelEntry) => Promise<string>;
  setAutoBusy: (kind: AutoLabelBusyKind, value: boolean) => void;
  setStatus: (status: string | null) => void;
  setError: (error: string | null) => void;
  onApplyDetectPredictions?: (
    target: BoxLabelEntry,
    predictions: api.PtDetectPrediction[],
    options?: { highConfidence?: number; proposalConfidence?: number; modelId?: string; persistProposals?: boolean }
  ) => Promise<BoxLabelAutoLabelResult>;
  onAssignClassificationClass?: (classKey: string | null, basename?: string) => Promise<void>;
};

export function useAutoLabelRunner({
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
}: UseAutoLabelRunnerOptions) {
  const runDetectAuto = useCallback(
    async (target: BoxLabelEntry, token: number, isCancelled: () => boolean) => {
      if (!detectModel || !onApplyDetectPredictions) return false;
      const targetMediaKey = autoLabelMediaKey(target);
      const runMatchesActiveMedia = () =>
        autoLabelRunIsCurrent({
          cancelled: false,
          token,
          activeToken: runTokenRef.current,
          targetMediaKey,
          currentMediaKey: currentMediaKeyRef.current,
        });
      const runIsCurrent = () => !isCancelled() && runMatchesActiveMedia();
      setAutoBusy("detect", true);
      if (runIsCurrent()) setStatus("Detect: preparing source...");
      try {
        const modelRoot = activeWorkspaceRootRef.current || workspaceRoot;
        const preparedBase64 = await withTimeout(
          resolveSourceBase64(target),
          SOURCE_PREP_TIMEOUT_MS,
          "Preparing auto-label frame timed out."
        );
        if (requireSourceImageBase64 && !preparedBase64) {
          throw new Error(sourceUnavailableMessage || "Cannot confirm Auto Label frame matches the visible label frame.");
        }
        const imagePath = preparedBase64
          ? ""
          : await withTimeout(
              resolveSourcePath(target),
              SOURCE_PREP_TIMEOUT_MS,
              "Preparing auto-label frame timed out."
            );
        if (!runIsCurrent()) return false;
        if (runIsCurrent()) setStatus(preparedBase64 ? "Detect: running preview inference..." : "Detect: starting backend job...");
        const result = preparedBase64
          ? await withTimeout(
              api.detectImageBase64WithPt(modelRoot, detectModel, preparedBase64, 640, 0.25, AUTO_LABEL_DEVICE),
              MODEL_INFERENCE_TIMEOUT_MS,
              "Auto detect timed out."
            )
          : await waitForPtImageJob<api.PtDetectImageResult>(
              () => api.startDetectImageWithPt(modelRoot, detectModel, imagePath, 640, 0.25, AUTO_LABEL_DEVICE),
              () => isCancelled() || !runMatchesActiveMedia(),
              (detail) => {
                if (runIsCurrent()) setStatus(`Detect: ${detail}`);
              },
              MODEL_INFERENCE_TIMEOUT_MS,
              "Auto detect timed out."
            );
        if (!runIsCurrent()) return false;
        if (runIsCurrent()) setStatus("Detect: applying result...");
        const applied = await onApplyDetectPredictions(target, result.predictions, {
          highConfidence: 0.8,
          proposalConfidence: 0.25,
          modelId: detectModel,
          persistProposals: false,
        });
        if (runIsCurrent()) {
          setStatus(`Detect: ${applied.boxesAdded} box(es), ${applied.proposalsAdded} proposal(s), ${applied.skipped} skipped.`);
        }
        return true;
      } catch (err) {
        if (runIsCurrent()) {
          setError(err instanceof Error ? err.message : "Auto detect failed.");
          setStatus(null);
        }
        return false;
      } finally {
        if (autoLabelRunCanClearBusy(token, runTokenRef.current)) setAutoBusy("detect", false);
      }
    },
    [
      activeWorkspaceRootRef,
      currentMediaKeyRef,
      detectModel,
      onApplyDetectPredictions,
      requireSourceImageBase64,
      resolveSourceBase64,
      resolveSourcePath,
      runTokenRef,
      setAutoBusy,
      setError,
      setStatus,
      sourceUnavailableMessage,
      workspaceRoot,
    ]
  );

  const runClassifyAuto = useCallback(
    async (target: BoxLabelEntry, token: number, isCancelled: () => boolean) => {
      if (!classifyModel || !onAssignClassificationClass || classByName.size === 0) return false;
      const targetMediaKey = autoLabelMediaKey(target);
      const runMatchesActiveMedia = () =>
        autoLabelRunIsCurrent({
          cancelled: false,
          token,
          activeToken: runTokenRef.current,
          targetMediaKey,
          currentMediaKey: currentMediaKeyRef.current,
        });
      const runIsCurrent = () => !isCancelled() && runMatchesActiveMedia();
      setAutoBusy("classify", true);
      if (runIsCurrent()) setStatus("Clf: preparing source...");
      try {
        const modelRoot = activeWorkspaceRootRef.current || workspaceRoot;
        const preparedBase64 = await withTimeout(
          resolveSourceBase64(target),
          SOURCE_PREP_TIMEOUT_MS,
          "Preparing auto-label frame timed out."
        );
        if (requireSourceImageBase64 && !preparedBase64) {
          throw new Error(sourceUnavailableMessage || "Cannot confirm Auto Label frame matches the visible label frame.");
        }
        const imagePath = preparedBase64
          ? ""
          : await withTimeout(
              resolveSourcePath(target),
              SOURCE_PREP_TIMEOUT_MS,
              "Preparing auto-label frame timed out."
            );
        if (!runIsCurrent()) return false;
        if (runIsCurrent()) setStatus(preparedBase64 ? "Clf: running preview inference..." : "Clf: starting backend job...");
        const result = preparedBase64
          ? await withTimeout(
              api.classifyImageBase64WithPt(modelRoot, classifyModel, preparedBase64, 0, AUTO_LABEL_DEVICE, 5),
              MODEL_INFERENCE_TIMEOUT_MS,
              "Auto classify timed out."
            )
          : await waitForPtImageJob<api.PtClassifyImageResult>(
              () => api.startClassifyImageWithPt(modelRoot, classifyModel, imagePath, 0, AUTO_LABEL_DEVICE, 5),
              () => isCancelled() || !runMatchesActiveMedia(),
              (detail) => {
                if (runIsCurrent()) setStatus(`Clf: ${detail}`);
              },
              MODEL_INFERENCE_TIMEOUT_MS,
              "Auto classify timed out."
            );
        if (!runIsCurrent()) return false;
        if (runIsCurrent()) setStatus("Clf: applying result...");
        const top = result.top ?? result.predictions?.[0] ?? null;
        const name = predictionName(top);
        const match = name ? classByName.get(name.toLowerCase()) : null;
        const rawConfidence = typeof top?.confidence === "number" ? top.confidence : NaN;
        const confidence = confidenceText(rawConfidence);
        if (!classifyPredictionIsConfident(rawConfidence)) {
          if (runIsCurrent()) {
            setStatus(
              name
                ? `Clf: ${name}${confidence ? ` ${confidence}` : ""} below threshold; not assigned.`
                : "Clf: no confident prediction."
            );
          }
          return true;
        }
        if (!match) {
          if (runIsCurrent()) {
            setStatus(name ? `Clf: ${name}${confidence ? ` ${confidence}` : ""} not in class list.` : "Clf: no prediction.");
          }
          return true;
        }
        await onAssignClassificationClass(match.key, target.basename);
        if (runIsCurrent()) {
          setStatus(`Clf: ${match.name}${confidence ? ` ${confidence}` : ""}.`);
        }
        return true;
      } catch (err) {
        if (runIsCurrent()) {
          setError(err instanceof Error ? err.message : "Auto classify failed.");
          setStatus(null);
        }
        return false;
      } finally {
        if (autoLabelRunCanClearBusy(token, runTokenRef.current)) setAutoBusy("classify", false);
      }
    },
    [
      activeWorkspaceRootRef,
      classByName,
      classifyModel,
      currentMediaKeyRef,
      onAssignClassificationClass,
      requireSourceImageBase64,
      resolveSourceBase64,
      resolveSourcePath,
      runTokenRef,
      setAutoBusy,
      setError,
      setStatus,
      sourceUnavailableMessage,
      workspaceRoot,
    ]
  );

  return { runDetectAuto, runClassifyAuto };
}
