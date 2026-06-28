import {
  callJson,
  getWorkspaceInfo,
  listDatasetFiles,
  type BackendMethod,
  type WorkspaceInfo
} from "../../api";
import { backendBaseUrl } from "../../lib/backendConfig";

export type DatasetTask = "detect" | "classify";

export type TrainPrepResult = {
  ok?: boolean;
  reason?: string;
  message?: string;
  moved?: number;
  skipped?: number;
  ratio?: number;
  classes?: unknown[];
  perClass?: Record<string, number>;
  movedImages?: string[];
  dataYaml?: {
    ok?: boolean;
    message?: string;
    updated?: string[];
  };
  yamlWarning?: string;
  failures?: string[];
  failed?: number;
  scanned?: number;
  renamed?: number;
  labelsMoved?: number;
};

function rpc<T>(method: BackendMethod, args: unknown[] = []) {
  return callJson<T>(method, args);
}

export async function loadTrainPrepWorkspace(workspaceRoot: string) {
  const info = await getWorkspaceInfo(workspaceRoot);
  const [detectFiles, classifyFiles] = await Promise.all([
    info.detectDataset ? listDatasetFiles(info.detectDataset).catch(() => []) : Promise.resolve([]),
    info.clfDataset ? listDatasetFiles(info.clfDataset).catch(() => []) : Promise.resolve([])
  ]);
  return { info, detectFiles, classifyFiles };
}

export function datasetRootForTask(info: WorkspaceInfo | null, task: DatasetTask) {
  if (!info) return "";
  return task === "classify" ? info.clfDataset || "" : info.detectDataset || "";
}

export async function prepareTrainPrepValidationSplit(datasetRoot: string, task: DatasetTask, ratio: number) {
  const method: BackendMethod =
    task === "classify" ? "prepareClassificationValidationSplit" : "prepareValidationSplit";
  return rpc<TrainPrepResult>(method, [datasetRoot, ratio]);
}

export async function ensureTrainPrepDataYaml(datasetRoot: string) {
  return rpc<TrainPrepResult>("ensureDataYaml", [datasetRoot]);
}

export async function moveTrainPrepValBackToTrain(datasetRoot: string, task: DatasetTask) {
  return rpc<TrainPrepResult>("moveValBackToTrain", [datasetRoot, task]);
}

// ── Training runner ────────────────────────────────────────────────────────

export type TrainingStatus = {
  running: boolean;
  stopped: boolean;
  exitCode: number | null;
  lineCount: number;
  command: string;
  error: string;
};

export async function startTraining(command: string): Promise<{ ok: boolean; reason?: string; message?: string }> {
  const res = await fetch(`${backendBaseUrl()}/api/train/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  return res.json() as Promise<{ ok: boolean; reason?: string; message?: string }>;
}

export async function stopTraining(): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${backendBaseUrl()}/api/train/stop`, { method: "POST" });
  return res.json() as Promise<{ ok: boolean; message?: string }>;
}

export async function getTrainingStatus(): Promise<TrainingStatus> {
  const res = await fetch(`${backendBaseUrl()}/api/train/status`);
  return res.json() as Promise<TrainingStatus>;
}

export function trainingStreamUrl(): string {
  return `${backendBaseUrl()}/api/train/stream`;
}
