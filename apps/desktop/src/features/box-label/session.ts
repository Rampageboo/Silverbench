import { callBackend } from "../../api";
import { readWorkspaceSessionLite } from "../image-pool/session";

export type PoolLabelSession = {
  currentImagePath?: string;
  poolLabelCurrentImagePath?: string;
  galleryScrollTop?: number;
  poolLabelShortcuts?: Array<number | null>;
  poolLabelShortcutAssigned?: boolean[];
  poolLabelFixedBoxes?: Array<FixedBoxSlot | null>;
  poolLabelPointerToolEnabled?: boolean;
  poolLabelAutoFitEnabled?: boolean;
};

export type FixedBoxSlot = {
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function parsePoolLabelSession(data: unknown): PoolLabelSession {
  const root = data as PoolLabelSession | null;
  if (!root || typeof root !== "object") return {};
  return {
    currentImagePath: typeof root.currentImagePath === "string" ? root.currentImagePath : "",
    poolLabelCurrentImagePath:
      typeof root.poolLabelCurrentImagePath === "string" ? root.poolLabelCurrentImagePath : "",
    galleryScrollTop: Math.max(0, Math.round(Number(root.galleryScrollTop) || 0)),
    poolLabelShortcuts: Array.isArray(root.poolLabelShortcuts) ? root.poolLabelShortcuts : undefined,
    poolLabelShortcutAssigned: Array.isArray(root.poolLabelShortcutAssigned)
      ? root.poolLabelShortcutAssigned
      : undefined,
    poolLabelFixedBoxes: Array.isArray(root.poolLabelFixedBoxes) ? root.poolLabelFixedBoxes : undefined,
    poolLabelPointerToolEnabled:
      root.poolLabelPointerToolEnabled === true || root.poolLabelPointerToolEnabled === false
        ? root.poolLabelPointerToolEnabled
        : undefined,
    poolLabelAutoFitEnabled:
      root.poolLabelAutoFitEnabled === true || root.poolLabelAutoFitEnabled === false
        ? root.poolLabelAutoFitEnabled
        : undefined
  };
}

export function normalizeShortcutSlotsFromSession(data: PoolLabelSession): Array<number | null> | null {
  const raw = data.poolLabelShortcuts;
  const assigned = data.poolLabelShortcutAssigned;
  if (!Array.isArray(raw) && !Array.isArray(assigned)) return null;
  const slots = Array.from({ length: 10 }, (_, index) => {
    const value = raw?.[index];
    if (value == null) return null;
    const classId = Number(value);
    return Number.isInteger(classId) && classId >= 0 ? classId : null;
  });
  if (Array.isArray(assigned)) {
    return Array.from({ length: 10 }, (_, index) => (assigned[index] ? slots[index] : null));
  }
  return slots;
}

export function normalizeFixedBoxSlotsFromSession(data: PoolLabelSession): Array<FixedBoxSlot | null> | null {
  const raw = data.poolLabelFixedBoxes;
  if (!Array.isArray(raw)) return null;
  return Array.from({ length: 10 }, (_, index): FixedBoxSlot | null => {
    const value = raw?.[index];
    if (!value || typeof value !== "object") return null;
    const classId = Number(value.classId);
    const x = Number(value.x);
    const y = Number(value.y);
    const w = Number(value.w);
    const h = Number(value.h);
    if (![classId, x, y, w, h].every(Number.isFinite) || !Number.isInteger(classId)) return null;
    return {
      classId,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      w: Math.max(0, Math.min(1, w)),
      h: Math.max(0, Math.min(1, h))
    };
  });
}

export function resolveResumeImagePath(data: PoolLabelSession) {
  return data.poolLabelCurrentImagePath || data.currentImagePath || "";
}

export async function savePoolLabelSession(
  workspaceRoot: string,
  fields: {
    currentImagePath: string;
    galleryScrollTop: number;
    shortcutSlots?: Array<number | null>;
    fixedBoxSlots?: Array<FixedBoxSlot | null>;
    pointerToolEnabled?: boolean;
    autoFitEnabled?: boolean;
  }
) {
  const existing = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  const shortcutSlots = fields.shortcutSlots;
  const payload: Record<string, unknown> = {
    ...existing,
    activeTab: "pool-label",
    poolLabelSessionVersion: 1,
    currentImagePath: fields.currentImagePath,
    poolLabelCurrentImagePath: fields.currentImagePath,
    galleryScrollTop: Math.max(0, Math.round(fields.galleryScrollTop)),
    poolLabelSavedAt: new Date().toISOString()
  };
  // Only write shortcut fields when the caller has an authoritative value.
  // undefined means "not yet hydrated" — omitting the fields preserves
  // whatever shortcuts were already in the session file.
  if (shortcutSlots !== undefined) {
    payload.poolLabelShortcuts = shortcutSlots;
    payload.poolLabelShortcutAssigned = shortcutSlots.map((slot) => slot !== null);
  }
  if (fields.fixedBoxSlots !== undefined) {
    payload.poolLabelFixedBoxes = fields.fixedBoxSlots;
  }
  if (fields.pointerToolEnabled != null) {
    payload.poolLabelPointerToolEnabled = fields.pointerToolEnabled;
  }
  if (fields.autoFitEnabled != null) {
    payload.poolLabelAutoFitEnabled = fields.autoFitEnabled;
  }
  await callBackend("writeWorkspaceSession", [workspaceRoot, JSON.stringify(payload)]);
}
