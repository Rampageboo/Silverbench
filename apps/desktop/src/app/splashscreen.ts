import { invoke } from "@tauri-apps/api/core";
import { Window } from "@tauri-apps/api/window";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let revealed = false;

/**
 * Show the main window and dismiss the PowerShell pre-splash.
 * Called once the intro overlay has painted, or as a fallback when boot finishes.
 */
export async function revealMainWindow(): Promise<void> {
  if (revealed || !inTauri()) return;
  revealed = true;
  try {
    const main = await Window.getByLabel("main");
    if (main) {
      await main.show();
      await main.setFocus();
    }
    await invoke("dismiss_launch_splash");
  } catch (error) {
    console.error("Failed to reveal main window:", error);
  }
}
