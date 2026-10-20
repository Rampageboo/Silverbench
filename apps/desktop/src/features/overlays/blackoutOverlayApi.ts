/**
 * Blackout Overlay Persistence API
 *
 * Stores non-destructive overlay metadata at:
 *   labels/overlays/<media file name>.json
 *
 * Source images and videos are NEVER modified by this module.
 *
 * Path security: workspace-relative paths only. Rejects ../, absolute paths,
 * and Windows drive references.
 */

import { readTextFile, writeTextFile } from "../../api";
import { fileName, WORKSPACE_PATHS } from "../../workspace/layout";
import {
  addOverlayToManifest,
  emptyBlackoutManifest,
  normalizeBlackoutOverlayManifest,
  removeOverlayFromManifest,
  toggleOverlayExport,
  toggleOverlayPreview,
  type BlackoutOverlay,
  type BlackoutOverlayManifest
} from "./blackoutOverlayDomain";

export const DEFAULT_OVERLAYS_ROOT: string = WORKSPACE_PATHS.overlays;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Overlays are keyed by the media file name (unique within a workspace's media folder). */
export function videoBlackoutSourceKey(videoPath: string): string {
  return fileName(videoPath);
}

export function imageBlackoutSourceKey(imagePath: string): string {
  return fileName(imagePath);
}

/**
 * Validate and normalize the overlays root path.
 * Rejects absolute paths, .., and Windows drive references.
 */
export function normalizeOverlaysRoot(value: unknown): string {
  const raw = String(value || DEFAULT_OVERLAYS_ROOT).trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || raw.startsWith("//") || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error("Blackout overlay path must be workspace-relative.");
  }
  const text = raw.replace(/^\/+|\/+$/g, "");
  const parts = text.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === ".." || p === "." || p.includes(":"))) {
    throw new Error("Blackout overlay path must stay inside the workspace.");
  }
  return parts.join("/");
}

/** Resolve the relative manifest path for a given source key. */
export function blackoutManifestRelativePath(
  sourceKey: string,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): string {
  const root = normalizeOverlaysRoot(overlaysRoot);
  const key = fileName(sourceKey);
  if (!key || key === "." || key === "..") throw new Error("Blackout overlay key must be a file name.");
  return `${root}/${key}.json`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadBlackoutOverlays(
  workspaceRoot: string,
  sourceKey: string,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): Promise<BlackoutOverlayManifest> {
  const relativePath = blackoutManifestRelativePath(sourceKey, overlaysRoot);
  let text: string;
  try {
    text = await readTextFile(workspaceRoot, relativePath);
  } catch {
    return emptyBlackoutManifest();
  }
  if (!text.trim()) return emptyBlackoutManifest();
  try {
    return normalizeBlackoutOverlayManifest(JSON.parse(text));
  } catch {
    return emptyBlackoutManifest();
  }
}

export async function saveBlackoutOverlays(
  workspaceRoot: string,
  sourceKey: string,
  manifest: BlackoutOverlayManifest,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): Promise<BlackoutOverlayManifest> {
  const relativePath = blackoutManifestRelativePath(sourceKey, overlaysRoot);
  await writeTextFile(workspaceRoot, relativePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function addBlackoutOverlay(
  workspaceRoot: string,
  sourceKey: string,
  overlay: BlackoutOverlay,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): Promise<BlackoutOverlayManifest> {
  const manifest = await loadBlackoutOverlays(workspaceRoot, sourceKey, overlaysRoot);
  const updated = addOverlayToManifest(manifest, overlay);
  return saveBlackoutOverlays(workspaceRoot, sourceKey, updated, overlaysRoot);
}

export async function removeBlackoutOverlay(
  workspaceRoot: string,
  sourceKey: string,
  overlayId: string,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): Promise<BlackoutOverlayManifest> {
  const manifest = await loadBlackoutOverlays(workspaceRoot, sourceKey, overlaysRoot);
  const updated = removeOverlayFromManifest(manifest, overlayId);
  return saveBlackoutOverlays(workspaceRoot, sourceKey, updated, overlaysRoot);
}

export async function toggleBlackoutPreview(
  workspaceRoot: string,
  sourceKey: string,
  overlayId: string,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): Promise<BlackoutOverlayManifest> {
  const manifest = await loadBlackoutOverlays(workspaceRoot, sourceKey, overlaysRoot);
  const updated = toggleOverlayPreview(manifest, overlayId);
  return saveBlackoutOverlays(workspaceRoot, sourceKey, updated, overlaysRoot);
}

export async function toggleBlackoutExport(
  workspaceRoot: string,
  sourceKey: string,
  overlayId: string,
  overlaysRoot = DEFAULT_OVERLAYS_ROOT
): Promise<BlackoutOverlayManifest> {
  const manifest = await loadBlackoutOverlays(workspaceRoot, sourceKey, overlaysRoot);
  const updated = toggleOverlayExport(manifest, overlayId);
  return saveBlackoutOverlays(workspaceRoot, sourceKey, updated, overlaysRoot);
}
