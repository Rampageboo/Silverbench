import { readTextFile, writeTextFile } from "../../api";
import { workspaceRelative } from "../../workspace/layout";
import {
  type VideoSegmentManifest,
  type VideoSegment,
  normalizeVideoSegmentManifest,
  videoSegmentManifestPath
} from "./videoSegmentDomain";

export { type VideoSegmentManifest, type VideoSegment };

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

export async function loadVideoSegmentManifest(
  workspaceRoot: string,
  videoPath: string,
  videoDurationMs: number
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
    // Stored relative to the workspace; callers work with the path they opened the video by.
    return normalized ? { ...normalized, videoPath } : createEmptyManifest(videoPath, videoDurationMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${relPath}: ${message}`);
  }
}

export async function saveVideoSegmentManifest(
  workspaceRoot: string,
  manifest: VideoSegmentManifest
): Promise<void> {
  const relPath = videoSegmentManifestPath(manifest.videoPath);
  const next: VideoSegmentManifest = {
    ...manifest,
    videoPath: workspaceRelative(workspaceRoot, manifest.videoPath),
    updatedAt: new Date().toISOString()
  };
  await writeTextFile(workspaceRoot, relPath, `${JSON.stringify(next, null, 2)}\n`);
}

