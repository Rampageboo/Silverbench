import { callJson, getWorkspaceInfo, listDatasetFiles, type BackendMethod, type WorkspaceInfo } from "../../api";

export type MergeTask = "detect" | "classify";

function rpc<T>(method: string, args: unknown[] = []) {
  return callJson<T>(method as BackendMethod, args);
}

export function loadMergeWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export function chooseMergeDirectory(title: string) {
  return rpc<string>("chooseDirectory", [title]);
}

export function listMergeFiles(root: string) {
  return listDatasetFiles(root);
}

export function readMergeText(root: string, path: string) {
  return rpc<string>("readTextFile", [root, path]);
}

export function writeMergeText(root: string, path: string, text: string) {
  return rpc<boolean>("writeTextFile", [root, path, text]);
}

export function readMergeBase64(root: string, path: string) {
  return rpc<string>("readFileBase64", [root, path]);
}

export function writeMergeBase64(root: string, path: string, data: string) {
  return rpc<boolean>("writeFileBase64", [root, path, data]);
}

export function isImagePath(path: string) {
  return /\.(png|jpg|jpeg|bmp|webp)$/i.test(path);
}

export function isTextPath(path: string) {
  return /\.(txt|yaml|yml|json|csv)$/i.test(path);
}
