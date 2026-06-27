/**
 * Blackout Overlay Persistence API
 *
 * Stores non-destructive overlay metadata at:
 *   workspace/overlays/blackouts/{safe-source-key}.json
 *
 * Source images and videos are NEVER modified by this module.
 *
 * Path security: workspace-relative paths only. Rejects ../, absolute paths,
 * and Windows drive references.
 */

import { readTextFile, writeTextFile } from "../../api";
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

export const DEFAULT_OVERLAYS_ROOT = "workspace/overlays/blackouts";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function safeStem(value: string, maxLength = 60): string {
  return (
    String(value || "source")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLength) || "source"
  );
}

/** Derive a stable string key for a video source path. */
export function videoBlackoutSourceKey(videoPath: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < videoPath.length; i++) {
    hash ^= videoPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const basename = videoPath.replace(/\\/g, "/").split("/").pop() ?? "video";
  const stem = basename.replace(/\.[^.]+$/, "");
  return `vid-${safeStem(stem, 40)}-${(hash >>> 0).toString(16).slice(0, 6)}`;
}

/** Derive a stable string key for an image source path. */
export function imageBlackoutSourceKey(imagePath: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < imagePath.length; i++) {
    hash ^= imagePath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const basename = imagePath.replace(/\\/g, "/").split("/").pop() ?? "image";
  const stem = basename.replace(/\.[^.]+$/, "");
  return `img-${safeStem(stem, 40)}-${(hash >>> 0).toString(16).slice(0, 6)}`;
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
  const safe = safeStem(sourceKey, 80);
  return `${root}/${safe}.json`;
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
