import { callJson, getWorkspaceInfo, type BackendMethod, type WorkspaceInfo } from "../../api";

export type AutoLabelTask = "detect" | "classify";

export type PtJob = {
  id: string;
  kind?: string;
  status?: string;
  done?: number;
  total?: number;
  detail?: string;
  errors?: string[];
  result?: Record<string, unknown> | null;
};

function rpc<T>(method: string, args: unknown[] = []) {
  return callJson<T>(method as BackendMethod, args);
}

export function loadAutoLabelWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export function chooseAutoLabelDirectory(title: string) {
  return rpc<string>("chooseDirectory", [title]);
}

export function chooseAutoLabelModel(title: string) {
  return rpc<string>("chooseTrainModelFile", [title]);
}

export function startAutoLabelJob(task: AutoLabelTask, inputRoot: string, outputRoot: string, modelPath: string, imageSize: number, confidence: number, device: string, confidencePrefix: boolean) {
  if (task === "classify") {
    return rpc<PtJob>("startClassifyFolderWithPt", [inputRoot, outputRoot, modelPath, imageSize, device, confidencePrefix, "[]"]);
  }
  return rpc<PtJob>("startDetectFolderWithPt", [inputRoot, outputRoot, modelPath, imageSize, confidence, device, "[]"]);
}

export function getAutoLabelJob(jobId: string) {
  return rpc<PtJob>("getPtJob", [jobId]);
}

export function cancelAutoLabelJob(jobId: string) {
  return rpc<PtJob>("cancelPtJob", [jobId]);
}
