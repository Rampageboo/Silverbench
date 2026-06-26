import { readTextFile, writeTextFile } from "../../api";
import {
  type VideoSegmentManifest,
  type VideoSegment,
  normalizeVideoSegmentManifest,
  videoSegmentManifestPath
} from "./videoSegmentDomain";

export { type VideoSegmentManifest, type VideoSegment };

export const SEGMENT_STORAGE_DIR = "video_segments" as const;

function videoBasename(videoPath: string): string {
  return String(videoPath || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "video";
}

function createEmptyManifest(
  videoPath: string,
  videoDurationMs: number
): VideoSegmentManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    videoPath,
    videoName: videoBasename(videoPath),
    videoDurationMs,
    createdAt: now,
    updatedAt: now,
    segments: []
  };
}

/**
 * Returns the absolute path to the segment manifest JSON for a given video.
 * The relative portion is computed by videoSegmentDomain and joined here.
 */
export function videoSegmentManifestAbsPath(
  workspaceRoot: string,
  videoPath: string,
  segmentsRoot?: string
): string {
  const root = segmentsRoot ?? `${workspaceRoot}/${SEGMENT_STORAGE_DIR}`;
  const relPath = videoSegmentManifestPath(videoPath);
  if (relPath.includes("..")) {
    throw new Error("Video segment manifest path must stay inside the workspace.");
  }
  // If a custom absolute segmentsRoot is supplied, join it with the filename part only.
  const fileName = relPath.split("/").pop() ?? relPath;
  return `${root}/${fileName}`;
}

export async function loadVideoSegmentManifest(
  workspaceRoot: string,
  videoPath: string,
  videoDurationMs: number,
  segmentsRoot?: string
): Promise<VideoSegmentManifest> {
  const relPath = videoSegmentManifestPath(videoPath);
  let text: string;
  try {
    text = await readTextFile(workspaceRoot, relPath);
  } catch {
    return createEmptyManifest(videoPath, videoDurationMs);
  }
  if (!text.trim()) return createEmptyManifest(videoPath, videoDurationMs);
  try {
    const normalized = normalizeVideoSegmentManifest(JSON.parse(text));
    return normalized ?? createEmptyManifest(videoPath, videoDurationMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${relPath}: ${message}`);
  }
}

export async function saveVideoSegmentManifest(
  workspaceRoot: string,
  manifest: VideoSegmentManifest,
  segmentsRoot?: string
): Promise<void> {
  const relPath = videoSegmentManifestPath(manifest.videoPath);
  const next: VideoSegmentManifest = { ...manifest, updatedAt: new Date().toISOString() };
  await writeTextFile(workspaceRoot, relPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function addVideoSegment(
  workspaceRoot: string,
  videoPath: string,
  videoDurationMs: number,
  startMs: number,
  endMs: number,
  label?: string,
  segmentsRoot?: string
): Promise<VideoSegmentManifest> {
  const manifest = await loadVideoSegmentManifest(
    workspaceRoot,
    videoPath,
    videoDurationMs,
    segmentsRoot
  );
  const id = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const segment: VideoSegment = {
    id,
    videoPath,
    startMs: Math.max(0, Math.round(startMs)),
    endMs: Math.min(videoDurationMs, Math.round(endMs)),
    label: label ?? "",
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  const next: VideoSegmentManifest = {
    ...manifest,
    segments: [...manifest.segments, segment],
    updatedAt: now
  };
  await saveVideoSegmentManifest(workspaceRoot, next, segmentsRoot);
  return next;
}

export async function removeVideoSegment(
  workspaceRoot: string,
  videoPath: string,
  videoDurationMs: number,
  segmentId: string,
  segmentsRoot?: string
): Promise<VideoSegmentManifest> {
  const manifest = await loadVideoSegmentManifest(
    workspaceRoot,
    videoPath,
    videoDurationMs,
    segmentsRoot
  );
  const next: VideoSegmentManifest = {
    ...manifest,
    segments: manifest.segments.filter((s) => s.id !== segmentId),
    updatedAt: new Date().toISOString()
  };
  await saveVideoSegmentManifest(workspaceRoot, next, segmentsRoot);
  return next;
}

export async function toggleVideoSegment(
  workspaceRoot: string,
  videoPath: string,
  videoDurationMs: number,
  segmentId: string,
  enabled: boolean,
  segmentsRoot?: string
): Promise<VideoSegmentManifest> {
  const manifest = await loadVideoSegmentManifest(
    workspaceRoot,
    videoPath,
    videoDurationMs,
    segmentsRoot
  );
  const now = new Date().toISOString();
  const next: VideoSegmentManifest = {
    ...manifest,
    segments: manifest.segments.map((s) =>
      s.id === segmentId ? { ...s, enabled, updatedAt: now } : s
    ),
    updatedAt: now
  };
  await saveVideoSegmentManifest(workspaceRoot, next, segmentsRoot);
  return next;
}
