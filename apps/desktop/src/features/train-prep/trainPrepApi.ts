import {
  callJson,
  getWorkspaceInfo,
  listDatasetFiles,
  type BackendMethod,
  type WorkspaceInfo
} from "../../api";

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

function rpc<T>(method: string, args: unknown[] = []) {
  return callJson<T>(method as BackendMethod, args);
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
  const method = task === "classify" ? "prepareClassificationValidationSplit" : "prepareValidationSplit";
  return rpc<TrainPrepResult>(method, [datasetRoot, ratio]);
}

export async function ensureTrainPrepDataYaml(datasetRoot: string) {
  return rpc<TrainPrepResult>("ensureDataYaml", [datasetRoot]);
}

export async function moveTrainPrepValBackToTrain(datasetRoot: string, task: DatasetTask) {
  return rpc<TrainPrepResult>("moveValBackToTrain", [datasetRoot, task]);
}
