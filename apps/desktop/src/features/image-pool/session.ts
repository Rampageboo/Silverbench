import { callBackend } from "../../api";
import type { ImagePoolFilter, ImagePoolUiSession, JunkScope } from "./types";

const VALID_FILTERS = new Set<ImagePoolFilter>([
  "all",
  "new",
  "unused",
  "used",
  "junk-detect",
  "junk-clf",
  "junk-both"
]);

export function parseImagePoolUi(data: unknown): Partial<ImagePoolUiSession> {
  const root = data as { imagePoolUi?: Partial<ImagePoolUiSession> } | null;
  const ui = root?.imagePoolUi;
  if (!ui || typeof ui !== "object") return {};
  const filter = VALID_FILTERS.has(ui.filter as ImagePoolFilter)
    ? (ui.filter as ImagePoolFilter)
    : "all";
  const junkScope: JunkScope = ui.junkScope === "clf" ? "clf" : "detect";
  const hideJunk =
    ui.hideJunk === "detect" || ui.hideJunk === "clf" || ui.hideJunk === "both"
      ? ui.hideJunk
      : null;
  return {
    filter,
    junkScope,
    hideJunk,
    scrollTop: Math.max(0, Math.round(Number(ui.scrollTop) || 0)),
    viewportImagePath: typeof ui.viewportImagePath === "string" ? ui.viewportImagePath : ""
  };
}

export async function readWorkspaceSessionLite(workspaceRoot: string) {
  try {
    return (await callBackend("readWorkspaceSession", [workspaceRoot, "lite"])) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export async function saveActiveTabSession(workspaceRoot: string, activeTab: string) {
  const existing = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  await callBackend("writeWorkspaceSession", [
    workspaceRoot,
    JSON.stringify({ ...existing, activeTab })
  ]);
}

export async function saveImagePoolSession(
  workspaceRoot: string,
  ui: ImagePoolUiSession,
  activeTab = "image-pool"
) {
  const existing = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  await callBackend("writeWorkspaceSession", [
    workspaceRoot,
    JSON.stringify({ ...existing, activeTab, imagePoolUi: ui })
  ]);
}
