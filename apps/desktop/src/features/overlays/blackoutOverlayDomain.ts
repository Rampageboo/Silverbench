/**
 * Blackout Overlay Domain
 *
 * Non-destructive overlay metadata. Source images and videos are NEVER modified.
 * Overlays are rendered in preview and applied during export only.
 *
 * Coordinate convention: x/y are the CENTER of the rect, normalized 0–1.
 * This matches the LabelBox / DetectBoxAnnotation convention used elsewhere.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlackoutRectShape = {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BlackoutPolygonShape = {
  type: "polygon";
  points: Array<{ x: number; y: number }>;
};

export type BlackoutShape = BlackoutRectShape | BlackoutPolygonShape;

export type BlackoutTarget =
  | {
      type: "image";
      sourceId?: string;
      imagePath?: string;
    }
  | {
      type: "video-timestamp";
      videoSourceId?: string;
      videoPath?: string;
      timestampMs: number;
    };

export type BlackoutOverlay = {
  id: string;
  target: BlackoutTarget;
  shape: BlackoutShape;
  mode: "black";
  visibleInPreview: boolean;
  applyOnExport: boolean;
  createdBy: "manual" | "similarity-propagation";
  sourceOverlayId?: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
};

export type BlackoutOverlayManifest = {
  version: 1;
  overlays: BlackoutOverlay[];
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp01(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function clampBetween(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Compute IoU between two center-normalized rects. Returns 0 if no overlap. */
export function rectIou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2;
  const ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2;
  const bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const intersection = (ix2 - ix1) * (iy2 - iy1);
  const unionArea = a.w * a.h + b.w * b.h - intersection;
  return unionArea > 0 ? intersection / unionArea : 0;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeBlackoutRect(raw: unknown): BlackoutRectShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const w = clamp01(r.w);
  const h = clamp01(r.h);
  if (w <= 0 || h <= 0) return null;
  const x = clampBetween(clamp01(r.x), w / 2, 1 - w / 2);
  const y = clampBetween(clamp01(r.y), h / 2, 1 - h / 2);
  return { type: "rect", x, y, w, h };
}

function normalizeBlackoutPolygon(raw: unknown): BlackoutPolygonShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.points)) return null;
  const points = r.points
    .map((p) =>
      p && typeof p === "object"
        ? { x: clamp01((p as Record<string, unknown>).x), y: clamp01((p as Record<string, unknown>).y) }
        : null
    )
    .filter((p): p is { x: number; y: number } => p !== null);
  if (points.length < 3) return null;
  return { type: "polygon", points };
}

function normalizeBlackoutShape(raw: unknown): BlackoutShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "rect") return normalizeBlackoutRect(raw);
  if (r.type === "polygon") return normalizeBlackoutPolygon(raw);
  return null;
}

function normalizeBlackoutTarget(raw: unknown): BlackoutTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "image") {
    return {
      type: "image",
      ...(typeof r.sourceId === "string" && r.sourceId ? { sourceId: r.sourceId } : {}),
      ...(typeof r.imagePath === "string" && r.imagePath ? { imagePath: r.imagePath } : {})
    };
  }
  if (r.type === "video-timestamp") {
    const timestampMs = Math.max(0, Math.round(Number(r.timestampMs) || 0));
    return {
      type: "video-timestamp",
      ...(typeof r.videoSourceId === "string" && r.videoSourceId ? { videoSourceId: r.videoSourceId } : {}),
      ...(typeof r.videoPath === "string" && r.videoPath ? { videoPath: r.videoPath } : {}),
      timestampMs
    };
  }
  return null;
}

function normalizeBlackoutOverlay(raw: unknown): BlackoutOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
  if (!id) return null;
  const target = normalizeBlackoutTarget(r.target);
  if (!target) return null;
  const shape = normalizeBlackoutShape(r.shape);
  if (!shape) return null;
  const now = new Date().toISOString();
  return {
    id,
    target,
    shape,
    mode: "black",
    visibleInPreview: r.visibleInPreview !== false,
    applyOnExport: r.applyOnExport !== false,
    createdBy: r.createdBy === "similarity-propagation" ? "similarity-propagation" : "manual",
    ...(typeof r.sourceOverlayId === "string" ? { sourceOverlayId: r.sourceOverlayId } : {}),
    ...(typeof r.confidence === "number" ? { confidence: r.confidence } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : now
  };
}

export function normalizeBlackoutOverlayManifest(raw: unknown): BlackoutOverlayManifest {
  const base: BlackoutOverlayManifest = { version: 1, overlays: [] };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.overlays)) return base;
  const overlays = r.overlays
    .map(normalizeBlackoutOverlay)
    .filter((o): o is BlackoutOverlay => o !== null);
  return { version: 1, overlays };
}

export function emptyBlackoutManifest(): BlackoutOverlayManifest {
  return { version: 1, overlays: [] };
}

// ---------------------------------------------------------------------------
// Pure CRUD
// ---------------------------------------------------------------------------

export function addOverlayToManifest(
  manifest: BlackoutOverlayManifest,
  overlay: BlackoutOverlay
): BlackoutOverlayManifest {
  const duplicate = manifest.overlays.some((o) => o.id === overlay.id);
  if (duplicate) return manifest;
  return { ...manifest, overlays: [...manifest.overlays, overlay] };
}

export function removeOverlayFromManifest(
  manifest: BlackoutOverlayManifest,
  id: string
): BlackoutOverlayManifest {
  return { ...manifest, overlays: manifest.overlays.filter((o) => o.id !== id) };
}

export function toggleOverlayPreview(
  manifest: BlackoutOverlayManifest,
  id: string
): BlackoutOverlayManifest {
  return {
    ...manifest,
    overlays: manifest.overlays.map((o) =>
      o.id === id ? { ...o, visibleInPreview: !o.visibleInPreview, updatedAt: new Date().toISOString() } : o
    )
  };
}

export function toggleOverlayExport(
  manifest: BlackoutOverlayManifest,
  id: string
): BlackoutOverlayManifest {
  return {
    ...manifest,
    overlays: manifest.overlays.map((o) =>
      o.id === id ? { ...o, applyOnExport: !o.applyOnExport, updatedAt: new Date().toISOString() } : o
    )
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function findOverlaysForVideoTimestamp(
  manifest: BlackoutOverlayManifest,
  timestampMs: number,
  videoPath?: string
): BlackoutOverlay[] {
  return manifest.overlays.filter((o) => {
    if (o.target.type !== "video-timestamp") return false;
    if (o.target.timestampMs !== timestampMs) return false;
    if (videoPath && o.target.videoPath && o.target.videoPath !== videoPath) return false;
    return true;
  });
}

export function findOverlaysForImage(
  manifest: BlackoutOverlayManifest,
  imagePath: string
): BlackoutOverlay[] {
  return manifest.overlays.filter((o) => {
    if (o.target.type !== "image") return false;
    if (o.target.imagePath && o.target.imagePath !== imagePath) return false;
    return true;
  });
}

/** Rect shapes visible in preview for a given timestamp. */
export function visibleRectsForTimestamp(
  manifest: BlackoutOverlayManifest,
  timestampMs: number,
  videoPath?: string
): BlackoutRectShape[] {
  return findOverlaysForVideoTimestamp(manifest, timestampMs, videoPath)
    .filter((o) => o.visibleInPreview && o.shape.type === "rect")
    .map((o) => o.shape as BlackoutRectShape);
}

/** Rect shapes to apply on export for a given timestamp. */
export function exportRectsForTimestamp(
  manifest: BlackoutOverlayManifest,
  timestampMs: number,
  videoPath?: string
): BlackoutRectShape[] {
  return findOverlaysForVideoTimestamp(manifest, timestampMs, videoPath)
    .filter((o) => o.applyOnExport && o.shape.type === "rect")
    .map((o) => o.shape as BlackoutRectShape);
}

// ---------------------------------------------------------------------------
// Overlap warning
// ---------------------------------------------------------------------------

export type BlackoutBoxOverlapWarning = {
  overlayId: string;
  boxIndex: number;
  iou: number;
};

/**
 * Compute overlap between blackout rects and detect boxes for a timestamp.
 * Returns warnings where IoU exceeds the threshold (default 0.1).
 */
export function computeBlackoutBoxOverlapWarnings(
  overlays: BlackoutOverlay[],
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
  threshold = 0.1
): BlackoutBoxOverlapWarning[] {
  const warnings: BlackoutBoxOverlapWarning[] = [];
  for (const overlay of overlays) {
    if (!overlay.applyOnExport || overlay.shape.type !== "rect") continue;
    const rect = overlay.shape as BlackoutRectShape;
    boxes.forEach((box, boxIndex) => {
      const iou = rectIou(rect, box);
      if (iou >= threshold) warnings.push({ overlayId: overlay.id, boxIndex, iou });
    });
  }
  return warnings;
}
