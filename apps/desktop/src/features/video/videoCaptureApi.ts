import { API_BASE_URL, callJson, getWorkspaceInfo, type BackendMethod, type WorkspaceInfo } from "../../api";

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
  processed?: number;
  skipped?: number;
  total?: number;
  detail?: string;
  errors?: string[];
  result?: Record<string, unknown> | null;
};

export type VideoProxyResult = {
  ok: boolean;
  path: string;
  sourcePath: string;
  cached: boolean;
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

export function openVideoOutputFolder(path: string) {
  return rpc<boolean>("openDirectory", [path]);
}

export function getVideoFrameBase64(path: string, seconds: number, format: "jpg" | "png", maxEdge = 0, quality = 72) {
  return rpc<string>("getVideoFrameBase64", [path, seconds, format, maxEdge, quality]);
}

export function videoFrameUrl(
  workspaceRoot: string,
  path: string,
  seconds: number,
  maxEdge = 1280,
  quality = 60
) {
  const params = new URLSearchParams({
    workspaceRoot,
    path,
    seconds: String(Math.max(0, Number(seconds) || 0)),
    maxEdge: String(maxEdge),
    quality: String(quality)
  });
  return `${API_BASE_URL}/api/video/frame?${params.toString()}`;
}

export function videoSourceUrl(workspaceRoot: string, path: string) {
  const params = new URLSearchParams({
    workspaceRoot,
    path
  });
  return `${API_BASE_URL}/api/video/source?${params.toString()}`;
}

export async function ensureVideoProxy(workspaceRoot: string, path: string) {
  const response = await fetch(`${API_BASE_URL}/api/video/proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ workspaceRoot, path })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const detail = typeof data?.detail === "string" ? data.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data as VideoProxyResult;
}

export async function prefetchVideoFrame(
  workspaceRoot: string,
  path: string,
  seconds: number,
  maxEdge = 1280,
  quality = 60
) {
  const response = await fetch(videoFrameUrl(workspaceRoot, path, seconds, maxEdge, quality), {
    cache: "force-cache"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await response.blob();
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
  deduplicateSimilar: boolean;
  similarityThreshold: number;
}) {
  return rpc<CaptureJob>("startCaptureVideoScreenshotJobs", [
    JSON.stringify(args.jobs),
    args.outputRoot,
    1,
    args.prefix,
    args.format,
    args.total,
    args.deduplicateSimilar,
    args.similarityThreshold
  ]);
}

export function getCaptureJob(jobId: string) {
  return rpc<CaptureJob>("getCaptureVideoScreenshotJob", [jobId]);
}

export function cancelCaptureJob(jobId: string) {
  return rpc<CaptureJob>("cancelCaptureVideoScreenshotJob", [jobId]);
}
