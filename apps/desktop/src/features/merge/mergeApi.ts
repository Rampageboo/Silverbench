import { callJson, getWorkspaceInfo, type WorkspaceInfo } from "../../api";
import { moveTrainPrepValBackToTrain, type DatasetTask } from "../train-prep/trainPrepApi";

export type MergeTask = "detect" | "classify";

export function loadMergeWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export function chooseMergeDirectory(title: string) {
  return callJson<string>("chooseDirectory", [title]);
}

export function openMergeFolder(path: string) {
  return callJson<{ ok: boolean; root?: string; name?: string; error?: string }>("openFolder", [path, false]);
}

export function moveMergeValBackToTrain(datasetRoot: string, task: DatasetTask) {
  return moveTrainPrepValBackToTrain(datasetRoot, task);
}
