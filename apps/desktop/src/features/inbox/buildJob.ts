import * as api from "../../api";

export async function runBuildYoloLinksJob(
  workspaceRoot: string,
  rebuild: boolean,
  filenamesJson = "",
  onProgress?: (done: number, total: number, detail: string) => void
) {
  let state = await api.startBuildYoloLinks(workspaceRoot, rebuild, filenamesJson);
  onProgress?.(state.done || 0, state.total || 1, state.detail || "Preparing build...");
  while (!["done", "error"].includes(state.status)) {
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    state = await api.getBuildJob(state.id);
    onProgress?.(state.done || 0, state.total || 1, state.detail || "Building...");
  }
  onProgress?.(state.done || 0, state.total || 1, state.detail || "");
  if (state.status === "error") {
    throw new Error((state.errors || []).join("\n") || state.detail || "Build failed");
  }
  return state.result || {};
}
