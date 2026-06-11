const APP_SCRIPTS = [
  "core/constants.js",
  "core/state.js",
  "core/dom.js",
  "core/bootstrap.js",
  "app_utils.js",
  "media_cache.js",
  "backend_http.js",
  "backend_api.js",
  "app_session.js",
  "app_shell.js",
  "workspace_tools.js",
  "virtual_gallery.js",
  "dataset_core.js",
  "gallery_view.js",
  "image_pool_tools.js",
  "image_pool_backup.js",
  "image_pool_duplicates.js",
  "inbox_tools.js",
  "junk_actions.js",
  "yolo_view_modes.js",
  "box_editor_core.js",
  "annotation_editor.js",
  "pool_label.js",
  "classifier_tools.js",
  "train_tools.js",
  "crop_tools.js",
  "mask_noise_tools.js",
  "video_screenshot.js",
  "dataset_merge.js",
  "yolo_page.js",
  "app.js",
  "image_preview_lightbox.js"
];

function purgeLegacyLocalBrowserSessions() {
  try {
    const prefix = "yolo_label_viewer_session:";
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Ignore browsers or sandbox modes that block localStorage.
  }
}

function installGlobalErrorHandlers() {
  window.addEventListener("error", event => {
    const detail = event.error?.stack || event.error?.message || "";
    const location = event.filename ? `${event.filename}:${event.lineno || ""}:${event.colno || ""}` : "";
    const message = detail
      ? `JS error: ${event.message}\n${location}\n${detail}`
      : `JS error: ${event.message}\n${location}`;
    console.error(message, event.error || event);
    const log = document.getElementById("videoLog");
    if (log) log.textContent = message;
  });

  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason?.stack || event.reason?.message || String(event.reason);
    const message = `Unhandled promise rejection:\n${reason}`;
    console.error(message);
    const log = document.getElementById("videoLog");
    if (log) log.textContent = message;
  });
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${src}?v=${encodeURIComponent(window.YOLO_LABEL_VIEWER_BUILD || "dev")}-${Date.now()}`;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function reportBootFailure(error) {
  const log = document.getElementById("videoLog");
  const message = `Failed to load app scripts: ${error.message}`;
  console.error(message, error);
  if (log) log.textContent = message;
}

async function boot() {
  installGlobalErrorHandlers();
  purgeLegacyLocalBrowserSessions();

  if (window.qt) {
    await loadClassicScript("qrc:///qtwebchannel/qwebchannel.js");
  }

  for (const src of APP_SCRIPTS) {
    await loadClassicScript(src);
  }
}

boot().catch(reportBootFailure);
