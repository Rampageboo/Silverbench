import { callJson, getWorkspaceInfo, type BackendMethod, type WorkspaceInfo } from "../../api";

export type VideoSegment = {
  start: number;
  end: number;
  interval: number;
};

export type VideoItem = {
  ok?: boolean;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  segments: VideoSegment[];
};

export type CaptureJob = {
  id: string;
  status: string;
  saved?: number;
  total?: number;
  detail?: string;
  errors?: string[];
  result?: Record<string, unknown> | null;
};

function rpc<T>(method: BackendMethod, args: unknown[] = []) {
  return callJson<T>(method, args);
}

export function loadVideoWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export function chooseVideoFiles() {
  return rpc<VideoItem[]>("chooseVideoFiles", ["Choose Videos"]);
}

export function listWorkspaceVideos(workspaceRoot: string) {
  return rpc<VideoItem[]>("listWorkspaceVideos", [workspaceRoot]);
}

export function chooseVideoOutputFolder() {
  return rpc<string>("chooseDirectory", ["Choose Screenshot Output Folder"]);
}

export function getVideoFrameBase64(path: string, seconds: number, format: "jpg" | "png") {
  return rpc<string>("getVideoFrameBase64", [path, seconds, format]);
}

export function saveVideoFrame(path: string, outputRoot: string, seconds: number, prefix: string, format: "jpg" | "png") {
  return rpc<string>("saveVideoFrame", [path, outputRoot, seconds, prefix, format]);
}

export function startCaptureJobs(args: {
  jobs: Array<{ path: string; prefix: string; segments: VideoSegment[] }>;
  outputRoot: string;
  prefix: string;
  format: "jpg" | "png";
  total: number;
}) {
  return rpc<CaptureJob>("startCaptureVideoScreenshotJobs", [
    JSON.stringify(args.jobs),
    args.outputRoot,
    1,
    args.prefix,
    args.format,
    args.total
  ]);
}

export function getCaptureJob(jobId: string) {
  return rpc<CaptureJob>("getCaptureVideoScreenshotJob", [jobId]);
}

export function cancelCaptureJob(jobId: string) {
  return rpc<CaptureJob>("cancelCaptureVideoScreenshotJob", [jobId]);
}
