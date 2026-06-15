export type StartupOverlayMode = "overview" | "minimal";

const STARTUP_OVERLAY_STORAGE_KEY = "ywb_startup_overlay_mode";

export function normalizeStartupOverlayMode(value: unknown): StartupOverlayMode {
  return value === "minimal" ? "minimal" : "overview";
}

export function readStartupOverlayMode(): StartupOverlayMode {
  try {
    return normalizeStartupOverlayMode(localStorage.getItem(STARTUP_OVERLAY_STORAGE_KEY));
  } catch {
    return "overview";
  }
}

export function writeStartupOverlayMode(mode: StartupOverlayMode): StartupOverlayMode {
  const normalized = normalizeStartupOverlayMode(mode);
  try {
    localStorage.setItem(STARTUP_OVERLAY_STORAGE_KEY, normalized);
  } catch {
    // Ignore environments that block localStorage.
  }
  return normalized;
}
