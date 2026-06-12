const UI_FRAME = {
  GALLERY_SCROLL: "gallery-scroll",
  GALLERY_RESIZE: "gallery-resize",
  PREVIEW_LAYOUT: "preview-layout",
  PREVIEW_BASE: "preview-base",
  PREVIEW_OVERLAY: "preview-overlay",
  PREVIEW_ZOOM: "preview-zoom",
  WINDOW_RESIZE: "window-resize",
  LAYOUT: "layout"
};

const uiFrameJobs = new Map();
let uiFrameRaf = 0;

/** Coalesce work to the next animation frame (latest callback wins per key). */
function scheduleUiFrame(key, fn) {
  if (!key || typeof fn !== "function") return;
  uiFrameJobs.set(key, fn);
  if (uiFrameRaf) return;
  uiFrameRaf = requestAnimationFrame(() => {
    uiFrameRaf = 0;
    const jobs = [...uiFrameJobs.entries()];
    uiFrameJobs.clear();
    for (const [, job] of jobs) job();
  });
}

function cancelUiFrame(key) {
  uiFrameJobs.delete(key);
}

function flushUiFrame() {
  if (!uiFrameRaf) return;
  cancelAnimationFrame(uiFrameRaf);
  uiFrameRaf = 0;
  const jobs = [...uiFrameJobs.entries()];
  uiFrameJobs.clear();
  for (const [, job] of jobs) job();
}

/** Run non-critical work when the browser is idle (session sync, etc.). */
function scheduleUiIdle(fn, timeoutMs = 1200) {
  if (typeof fn !== "function") return;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return;
  }
  setTimeout(fn, 1);
}

function scheduleGalleryPaint(fn) {
  scheduleUiFrame(UI_FRAME.GALLERY_SCROLL, fn);
}

function schedulePreviewLayout(fn) {
  scheduleUiFrame(UI_FRAME.PREVIEW_LAYOUT, fn);
}

window.UI_FRAME = UI_FRAME;
window.scheduleUiFrame = scheduleUiFrame;
window.cancelUiFrame = cancelUiFrame;
window.flushUiFrame = flushUiFrame;
window.scheduleUiIdle = scheduleUiIdle;
window.scheduleGalleryPaint = scheduleGalleryPaint;
window.schedulePreviewLayout = schedulePreviewLayout;
