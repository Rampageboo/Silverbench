const STARTUP_OVERLAY_STORAGE_KEY = "ywb_startup_overlay_mode";

function validStartupOverlayMode(mode) {
  return mode === "minimal" ? "minimal" : "overview";
}

function readStartupOverlayModeFromStorage() {
  try {
    return validStartupOverlayMode(localStorage.getItem(STARTUP_OVERLAY_STORAGE_KEY) || "overview");
  } catch {
    return "overview";
  }
}

function readStartupOverlayModeForBoot() {
  const injected = window.__YWB_STARTUP_OVERLAY_MODE__;
  if (injected === "minimal" || injected === "overview") {
    return validStartupOverlayMode(injected);
  }
  const fromDom = document.documentElement.getAttribute("data-startup-overlay-mode");
  if (fromDom === "minimal" || fromDom === "overview") {
    return validStartupOverlayMode(fromDom);
  }
  return readStartupOverlayModeFromStorage();
}

function mirrorStartupOverlayMode(mode) {
  const normalized = validStartupOverlayMode(mode);
  window.__YWB_STARTUP_OVERLAY_MODE__ = normalized;
  try {
    localStorage.setItem(STARTUP_OVERLAY_STORAGE_KEY, normalized);
  } catch {
    // Ignore browsers that block localStorage.
  }
  applyStartupOverlayMode(normalized);
  return normalized;
}

function applyStartupOverlayMode(mode) {
  const normalized = validStartupOverlayMode(mode);
  document.documentElement.setAttribute("data-startup-overlay-mode", normalized);
  const overlay = document.getElementById("startupOverlay");
  if (!overlay) return normalized;
  overlay.classList.toggle("startup-overlay--minimal", normalized === "minimal");
  overlay.classList.toggle("startup-overlay--overview", normalized === "overview");
  overlay.dataset.mode = normalized;
  return normalized;
}

async function readAppUiSettings() {
  if (typeof readAppSettingsData === "function") {
    try {
      const settings = await readAppSettingsData();
      if (settings && typeof settings === "object") return settings;
    } catch {
      // Fall through to local cache.
    }
  }
  return { startupOverlayMode: readStartupOverlayModeFromStorage() };
}

async function writeAppUiSettingsPatch(patch) {
  const current = await readAppUiSettings();
  const next = { ...current, ...patch };
  if (patch?.startupOverlayMode) {
    mirrorStartupOverlayMode(patch.startupOverlayMode);
  }
  if (typeof writeAppSettingsPatch === "function") {
    await writeAppSettingsPatch(next);
  }
  return next;
}

async function syncAppUiSettingsFromBackend() {
  const settings = await readAppUiSettings();
  const bootMode = readStartupOverlayModeForBoot();
  const stored = readStartupOverlayModeFromStorage();
  const backendMode = settings.startupOverlayMode
    ? validStartupOverlayMode(settings.startupOverlayMode)
    : null;
  const resolved = backendMode || bootMode || stored;

  if (backendMode && backendMode !== stored) {
    try {
      localStorage.setItem(STARTUP_OVERLAY_STORAGE_KEY, backendMode);
    } catch {
      // Ignore browsers that block localStorage.
    }
  }

  applyStartupOverlayMode(resolved);

  if (typeof renderSettingsPanel === "function") {
    renderSettingsPanel({ ...settings, startupOverlayMode: resolved });
  }
  return { ...settings, startupOverlayMode: resolved };
}

applyStartupOverlayMode(readStartupOverlayModeForBoot());
