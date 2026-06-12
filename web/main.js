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
  "workspace_tools.js",
  "app_settings.js",
  "tool_icons.js",
  "tool_nav.js",
  "app_shell.js",
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

const startupUi = {
  overlay: document.getElementById("startupOverlay"),
  progress: document.getElementById("startupProgress"),
  stage: document.getElementById("startupStage"),
  detail: document.getElementById("startupDetail"),
  percent: document.getElementById("startupPercent"),
  value: 0,
  hidden: false
};
window.startupUi = startupUi;

function setStartupProgress(value, stage, detail) {
  const requested = Math.max(0, Math.min(100, Math.round(value)));
  const current = startupUi.value || 0;
  if (requested < current) return;
  const percent = Math.max(current, requested);
  startupUi.value = percent;
  if (startupUi.progress) startupUi.progress.value = percent;
  if (startupUi.percent) startupUi.percent.textContent = `${percent}%`;
  if (stage && startupUi.stage) startupUi.stage.textContent = stage;
  if (detail && startupUi.detail) startupUi.detail.textContent = detail;
}

function finishStartupOverlay(detail = "就绪") {
  if (startupUi.hidden) return;
  startupUi.hidden = true;
  setStartupProgress(100, "就绪", detail);
  syncAppUiSettingsFromBackend?.().catch(error => console.warn("App settings sync:", error));
  window.setTimeout(() => {
    startupUi.overlay?.classList.add("is-done");
    window.setTimeout(() => {
      if (startupUi.overlay) startupUi.overlay.hidden = true;
    }, 280);
  }, 180);
}

window.setStartupProgress = setStartupProgress;
window.finishStartupOverlay = finishStartupOverlay;

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
  setStartupProgress(startupUi.value || 1, "启动失败", error.message || "应用模块加载失败");
  if (log) log.textContent = message;
}

async function boot() {
  installGlobalErrorHandlers();
  purgeLegacyLocalBrowserSessions();
  setStartupProgress(5, "正在准备工作区...", "清理浏览器缓存会话");

  if (window.qt) {
    setStartupProgress(8, "加载应用外壳...", "连接 Qt WebChannel");
    await loadClassicScript("qrc:///qtwebchannel/qwebchannel.js");
  }

  for (let i = 0; i < APP_SCRIPTS.length; i++) {
    const src = APP_SCRIPTS[i];
    const percent = 10 + (i / APP_SCRIPTS.length) * 58;
    setStartupProgress(percent, "加载功能模块...", src);
    await loadClassicScript(src);
  }
  setStartupProgress(76, "启动工作台...", "初始化界面");
}

boot().catch(reportBootFailure);
