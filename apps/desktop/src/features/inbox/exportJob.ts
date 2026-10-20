import * as api from "../../api";

/** Export the workspace's annotations as a YOLO dataset and wait for the job to finish. */
export async function runExportDatasetJob(
  workspaceRoot: string,
  options: api.ExportOptions = {},
  onProgress?: (done: number, total: number, detail: string) => void
): Promise<Partial<api.ExportResult>> {
  let state = await api.startExportDataset(workspaceRoot, options);
  onProgress?.(state.done || 0, state.total || 1, state.detail || "Preparing export...");
  while (!["done", "error"].includes(state.status)) {
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    state = await api.getBuildJob(state.id);
    onProgress?.(state.done || 0, state.total || 1, state.detail || "Exporting...");
  }
  onProgress?.(state.done || 0, state.total || 1, state.detail || "");
  if (state.status === "error") {
    throw new Error((state.errors || []).join("\n") || state.detail || "Export failed");
  }
  return state.result || {};
}
