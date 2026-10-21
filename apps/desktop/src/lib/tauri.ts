import { open } from "@tauri-apps/plugin-dialog";
import { callJson } from "../api";
import { inTauri } from "../app/splashscreen";

/** A file-type filter for pickers: label plus extensions without dots, e.g. { name: "ONNX", extensions: ["onnx"] }. */
export type FileFilter = { name: string; extensions: string[] };

/**
 * Pickers work in both shells: the native Tauri dialog in the desktop app, and the
 * backend's dialog (on the same machine) in the browser build. Paths picked here are
 * also the ones the backend is allowed to read. Empty string means cancelled.
 */
export async function chooseDirectory(title = "Choose Folder"): Promise<string> {
  if (inTauri()) {
    try {
      const selected = await open({ title, directory: true, multiple: false });
      return typeof selected === "string" ? selected : "";
    } catch {
      return "";
    }
  }
  try {
    const value = await callJson<string>("chooseDirectory", [title]);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export async function chooseFile(title = "Choose File", filters: FileFilter[] = []): Promise<string> {
  if (inTauri()) {
    try {
      const selected = await open({ title, directory: false, multiple: false, filters });
      return typeof selected === "string" ? selected : "";
    } catch {
      return "";
    }
  }
  try {
    const patterns = filters.map((filter) => [filter.name, filter.extensions.map((ext) => `*.${ext}`).join(" ")]);
    const value = await callJson<string>("chooseFile", [title, JSON.stringify(patterns)]);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
