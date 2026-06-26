import { open } from "@tauri-apps/plugin-dialog";

/** Open a native single-directory picker. Empty string means cancelled or unavailable. */
export async function chooseDirectory(title = "Choose Folder") {
  try {
    const selected = await open({
      title,
      directory: true,
      multiple: false
    });
    return typeof selected === "string" ? selected : "";
  } catch {
    return "";
  }
}
