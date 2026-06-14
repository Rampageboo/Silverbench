var sessionSaveTimer = null;
var workspaceSessionWriteQueue = Promise.resolve();

function hasWorkspaceRoot() {
  return Boolean(state.workspaceRoot);
}

function usesWorkspaceSession() {
  return hasWorkspaceRoot();
}

function validSessionTab(tab) {
  return [
    "image-pool",
    "inbox",
    "video",
    "yolo",
    "pool-label",
    "train-prep",
    "train",
    "crop",
    "mask-noise",
    "merge"
  ].includes(tab) ? tab : "video";
}

function captureImagePoolViewportPath() {
  if (!el.imagePoolGridWrap || !imagePoolState?.pairs?.length) return "";
  const columns = Math.max(1, imagePoolVirtual?.columns || 1);
  const rowHeight = Math.max(1, imagePoolVirtual?.rowHeight || 150);
  const row = Math.max(0, Math.floor((el.imagePoolGridWrap.scrollTop || 0) / rowHeight));
  const index = Math.min(imagePoolState.pairs.length - 1, row * columns);
  return imagePoolState.pairs[index]?.imagePath || "";
}

function imagePoolSessionData() {
  return {
    filter: imagePoolState?.filter || "all",
    junkScope: imagePoolState?.junkScope || "detect",
    hideJunk: imagePoolState?.hideJunk || null,
    scrollTop: Math.max(0, Math.round(el.imagePoolGridWrap?.scrollTop || 0)),
    viewportImagePath: captureImagePoolViewportPath()
  };
}

function applyImagePoolSessionData(data) {
  const ui = data?.imagePoolUi && typeof data.imagePoolUi === "object" ? data.imagePoolUi : {};
  const filter = ["all", "new", "unused", "used", "junk-detect", "junk-clf", "junk-both"].includes(ui.filter)
    ? ui.filter
    : "all";
  imagePoolState.filter = filter;
  imagePoolState.junkScope = ui.junkScope === "clf" ? "clf" : "detect";
  imagePoolState.hideJunk = ["detect", "clf", "both"].includes(ui.hideJunk) ? ui.hideJunk : null;
  imagePoolState.restoreViewport = {
    scrollTop: Math.max(0, Math.round(Number(ui.scrollTop) || 0)),
    imagePath: typeof ui.viewportImagePath === "string" ? ui.viewportImagePath : ""
  };
  for (const [key, button] of [
    ["all", el.imagePoolFilterAllBtn],
    ["new", el.imagePoolFilterNewBtn],
    ["unused", el.imagePoolFilterUnusedBtn],
    ["used", el.imagePoolFilterUsedBtn],
    ["junk-detect", el.imagePoolFilterJunkDetectBtn],
    ["junk-clf", el.imagePoolFilterJunkClfBtn],
    ["junk-both", el.imagePoolFilterJunkBothBtn]
  ]) {
    button?.classList.toggle("active", filter === key);
  }
  if (typeof updateImagePoolJunkControls === "function") updateImagePoolJunkControls();
}

function restoreImagePoolViewportIfNeeded() {
  const restore = imagePoolState?.restoreViewport;
  if (!restore || !el.imagePoolGridWrap || !imagePoolState.pairs?.length) {
    if (imagePoolState) imagePoolState.restoreViewport = null;
    return;
  }
  let scrollTop = Math.max(0, Math.round(Number(restore.scrollTop) || 0));
  const imagePath = typeof restore.imagePath === "string" ? restore.imagePath : "";
  if (imagePath) {
    const index = imagePoolState.pairs.findIndex(pair => pair.imagePath === imagePath);
    if (index >= 0) {
      const columns = Math.max(1, imagePoolVirtual?.columns || 1);
      const rowHeight = Math.max(1, imagePoolVirtual?.rowHeight || 150);
      const row = Math.floor(index / columns);
      scrollTop = row * rowHeight;
    }
  }
  imagePoolState.restoreViewport = null;
  const applyScroll = () => {
    if (!el.imagePoolGridWrap) return;
    el.imagePoolGridWrap.scrollTop = scrollTop;
    if (typeof renderImagePoolGrid === "function") renderImagePoolGrid();
  };
  requestAnimationFrame(() => requestAnimationFrame(applyScroll));
}

function isPoolLabelSessionTab(tab = state.activeTab) {
  return tab === "pool-label" || tab === "yolo";
}

function syncPoolLabelResumeSnapshotFromLiveView() {
  const path = state.pairs[state.currentIndex]?.imagePath || state.currentImagePath || state.poolLabelResumeImagePath || "";
  if (path) {
    state.poolLabelResumeImagePath = path;
    state.currentImagePath = path;
  }
  const scrollTop = Math.max(0, Math.round(el.galleryScroll?.scrollTop || state.galleryScrollTop || 0));
  state.poolLabelResumeGalleryScrollTop = scrollTop;
  state.galleryScrollTop = scrollTop;
}

function applyPoolLabelResumeFieldsFromSession(data) {
  if (!data || typeof data !== "object") return;
  const resumePath = data.poolLabelCurrentImagePath || data.currentImagePath || "";
  if (resumePath) {
    state.poolLabelResumeImagePath = resumePath;
    state.currentImagePath = resumePath;
  }
  state.poolLabelResumeGalleryScrollTop = Math.max(0, Math.round(Number(data.galleryScrollTop) || 0));
  state.galleryScrollTop = state.poolLabelResumeGalleryScrollTop;
}

function primePoolLabelResumeForView() {
  const resumePath = state.poolLabelResumeImagePath || state.currentImagePath || "";
  if (resumePath) state.currentImagePath = resumePath;
  state.galleryScrollTop = Math.max(0, Math.round(Number(state.poolLabelResumeGalleryScrollTop ?? state.galleryScrollTop) || 0));
}

window.syncPoolLabelResumeSnapshotFromLiveView = syncPoolLabelResumeSnapshotFromLiveView;
window.primePoolLabelResumeForView = primePoolLabelResumeForView;
window.applyPoolLabelResumeFieldsFromSession = applyPoolLabelResumeFieldsFromSession;

async function restoreYoloViewFromWorkspaceSession() {
  if (!hasDatasetOpen() || !Array.isArray(state.allPairs) || !state.allPairs.length) return false;
  primePoolLabelResumeForView();
  const applied = await loadSessionFromDefault(null, { lite: true });
  primePoolLabelResumeForView();
  if (!applied && !state.poolLabelResumeImagePath) return false;
  if (typeof applyFilter === "function") applyFilter(false);
  if (typeof invalidateVirtualGallery === "function" && typeof galleryVirtual !== "undefined") {
    invalidateVirtualGallery(galleryVirtual);
  }
  if (typeof renderGallery === "function") renderGallery({ patchVisible: true });
  const resumePath = state.currentImagePath;
  if (resumePath && state.pairs.length) {
    const idx = state.pairs.findIndex(pair => pair.imagePath === resumePath);
    if (idx >= 0 && typeof selectIndex === "function" && idx !== state.currentIndex) {
      await selectIndex(idx);
    }
  }
  if (typeof restoreGalleryScrollForSession === "function") {
    const idx = state.pairs.findIndex(pair => pair.imagePath === state.currentImagePath);
    restoreGalleryScrollForSession(idx >= 0 ? idx : null);
  } else if (el.galleryScroll) {
    el.galleryScroll.scrollTop = state.galleryScrollTop || 0;
  }
  if (typeof renderCurrentImage === "function") await renderCurrentImage();
  return true;
}

window.restoreYoloViewFromWorkspaceSession = restoreYoloViewFromWorkspaceSession;

function applyAppSessionData(data) {
  if (!data || typeof data !== "object") return;
  state.activeTab = validSessionTab(data.activeTab);
  applyPoolLabelResumeFieldsFromSession(data);
  if (typeof imagePoolState !== "undefined") applyImagePoolSessionData(data);
  if (typeof poolLabelState !== "undefined") applyPoolLabelSessionFields(data);
}

function sessionPathStem(path) {
  return String(path || "").split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
}

function resolveSessionImagePath(path, validPaths) {
  if (!path) return "";
  if (validPaths.has(path)) return path;
  const stem = sessionPathStem(path);
  if (!stem) return "";
  const matches = [...validPaths].filter(candidate => sessionPathStem(candidate) === stem);
  if (!matches.length) return "";
  matches.sort((a, b) => {
    const aScore = (a.startsWith("image_pool/") ? 0 : 1) + (a.includes("/train/") ? 0 : 1);
    const bScore = (b.startsWith("image_pool/") ? 0 : 1) + (b.includes("/train/") ? 0 : 1);
    return aScore - bScore || naturalCompare(a, b);
  });
  return matches[0];
}

function hasPoolLabelDatasetLoaded() {
  return hasDatasetOpen()
    && Array.isArray(state.allPairs)
    && state.allPairs.length > 0
    && typeof poolLabelState !== "undefined";
}

function poolLabelSessionData() {
  if (!hasPoolLabelDatasetLoaded()) return {};
  const savedAt = new Date().toISOString();
  return {
    workspaceRoot: state.workspaceRoot || "",
    datasetRoot: state.datasetBackendRoot || "",
    poolLabelSavedAt: savedAt,
    poolLabelShortcuts: normalizePoolLabelShortcuts(poolLabelState.shortcutSlots),
    poolLabelShortcutAssigned: normalizePoolLabelShortcutAssigned(poolLabelState.shortcutSlots),
    poolLabelFixedBoxes: normalizePoolLabelFixedBoxes(poolLabelState.fixedBoxSlots),
    poolLabelPointerToolEnabled: !!poolLabelState.pointerToolEnabled,
    poolLabelAutoFitEnabled: !!poolLabelState.autoFitEnabled
  };
}

function normalizeSessionRootPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sessionsRootMatches(a, b) {
  const left = normalizeSessionRootPath(a);
  const right = normalizeSessionRootPath(b);
  return Boolean(left && right && left === right);
}

function applyPoolLabelSessionFields(data) {
  if (typeof poolLabelState === "undefined") return;
  const source = data || {};
  const sourceTime = Date.parse(source?.poolLabelSavedAt || source?.savedAt || "") || 0;
  if (poolLabelState.shortcutChangedAt && sourceTime < poolLabelState.shortcutChangedAt) {
    return;
  }
  poolLabelState.shortcutSlots = normalizePoolLabelShortcutsFromSession(source);
  poolLabelState.fixedBoxSlots = normalizePoolLabelFixedBoxes(source.poolLabelFixedBoxes);
  poolLabelState.activeFixedBoxSlot = null;
  poolLabelState.recordingFixedBoxSlot = null;
  poolLabelState.pointerToolEnabled = !!source?.poolLabelPointerToolEnabled;
  poolLabelState.autoFitEnabled = !!source?.poolLabelAutoFitEnabled;
  if (poolLabelState.pointerToolEnabled) poolLabelState.autoFitEnabled = false;
  if (typeof poolLabelSyncAutoFitTool === "function") poolLabelSyncAutoFitTool();
}

async function readCurrentSessionData(options = {}) {
  if (!await ensurePythonBackend()) return {};
  const lite = options.lite === true;
  try {
    let text = "";
    if (usesWorkspaceSession()) {
      text = lite
        ? await backendCall("readWorkspaceSession", state.workspaceRoot, "lite")
        : await backendCall("readWorkspaceSession", state.workspaceRoot);
    } else {
      text = await backendCall("readSessionFile");
    }
    if (!text?.trim()) return {};
    let data = parseBackendJson(text, {});
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function poolLabelSessionPayload(data) {
  if (!data || typeof data !== "object") return null;
  const hasPayload = Array.isArray(data.poolLabelShortcuts)
    || Array.isArray(data.poolLabelFixedBoxes)
    || data.poolLabelPointerToolEnabled != null
    || data.poolLabelAutoFitEnabled != null;
  return hasPayload ? data : null;
}

async function readPoolLabelSessionPayload() {
  let data = await readCurrentSessionData();
  if (poolLabelSessionPayload(data)) return data;
  if (!hasWorkspaceRoot()) return data;
  try {
    const globalText = await backendCall("readSessionFile");
    const global = parseBackendJson(globalText, {});
    if (!poolLabelSessionPayload(global)) return data;
    if (!sessionsRootMatches(global.workspaceRoot, state.workspaceRoot)) return data;
    return { ...data, ...global };
  } catch (error) {
    console.warn("Global pool label session read:", error);
    return data;
  }
}

async function loadPoolLabelSessionFields() {
  applyPoolLabelSessionFields(await readPoolLabelSessionPayload());
  if (typeof renderPoolLabelShortcuts === "function") renderPoolLabelShortcuts();
}

function defaultInboxSession() {
  return {
    assignBatches: [],
    buildRuns: [],
    ui: {
      filter: "new",
      assignTarget: "clf"
    }
  };
}

function normalizeInboxSession(data) {
  const base = defaultInboxSession();
  if (!data || typeof data !== "object") return base;
  const ui = data.ui && typeof data.ui === "object" ? data.ui : {};
  return {
    assignBatches: Array.isArray(data.assignBatches) ? data.assignBatches.slice(-2000) : [],
    buildRuns: Array.isArray(data.buildRuns) ? data.buildRuns.slice(-500) : [],
    ui: {
      filter: ["new", "unassigned", "random-unused", "all"].includes(ui.filter) ? ui.filter : base.ui.filter,
      assignTarget: ui.assignTarget === "detect"
        ? "detect"
        : (ui.detectEnabled && !ui.clfEnabled ? "detect" : "clf")
    }
  };
}

function inboxPendingFilenamesFrom(inbox) {
  const names = [];
  const seen = new Set();
  for (const batch of inbox?.assignBatches || []) {
    if (batch.built) continue;
    for (const filename of batch.filenames || []) {
      if (seen.has(filename)) continue;
      seen.add(filename);
      names.push(filename);
    }
  }
  return names;
}

function inboxSessionSummary(inbox) {
  const normalized = normalizeInboxSession(inbox);
  const pendingFilenames = inboxPendingFilenamesFrom(normalized);
  const pendingBatches = normalized.assignBatches.filter(batch => !batch.built).length;
  const lastBuildAt = normalized.buildRuns.at(-1)?.at || "";
  return {
    inbox: normalized,
    pendingFilenames,
    pendingBatches,
    pendingFiles: pendingFilenames.length,
    lastBuildAt
  };
}

function mergeInboxSessions(diskInbox, localInbox) {
  const disk = normalizeInboxSession(diskInbox);
  if (!localInbox) return disk;
  const local = normalizeInboxSession(localInbox);
  const diskPending = inboxPendingFilenamesFrom(disk).length;
  const localPending = inboxPendingFilenamesFrom(local).length;
  if (localPending <= diskPending) return disk;
  const diskIds = new Set((disk.assignBatches || []).map(batch => batch.id));
  const extraBatches = (local.assignBatches || []).filter(batch => batch.id && !diskIds.has(batch.id));
  if (!extraBatches.length) return disk;
  return normalizeInboxSession({
    ...disk,
    assignBatches: [...(disk.assignBatches || []), ...extraBatches]
  });
}

async function readWorkspaceSessionData(options = {}) {
  if (!hasWorkspaceRoot() || !await ensurePythonBackend()) return {};
  const lite = options.lite === true;
  try {
    const text = lite
      ? await backendCall("readWorkspaceSession", state.workspaceRoot, "lite")
      : await backendCall("readWorkspaceSession", state.workspaceRoot);
    if (!text?.trim()) return {};
    const data = parseBackendJson(text, {});
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    console.warn("readWorkspaceSession failed:", error);
    return {};
  }
}

async function writeWorkspaceSessionData(session) {
  if (!hasWorkspaceRoot() || !await ensurePythonBackend()) return "";
  const payload = {
    ...session,
    version: Math.max(Number(session.version) || 2, 3),
    workspaceRoot: state.workspaceRoot,
    savedAt: new Date().toISOString()
  };
  if (payload.inbox) payload.inbox = normalizeInboxSession(payload.inbox);
  return backendCall("writeWorkspaceSession", state.workspaceRoot, JSON.stringify(payload, null, 2));
}

function updateWorkspaceSessionData(mutator) {
  if (!hasWorkspaceRoot()) return Promise.resolve("");
  const write = async () => {
    const existing = await readWorkspaceSessionData();
    const next = await mutator(existing && typeof existing === "object" ? existing : {});
    if (!next || typeof next !== "object") return "";
    return writeWorkspaceSessionData(next);
  };
  const queued = workspaceSessionWriteQueue.then(write, write);
  workspaceSessionWriteQueue = queued.catch(() => {});
  return queued;
}

async function readInboxSessionData() {
  const session = await readWorkspaceSessionData();
  return inboxSessionSummary(session.inbox);
}

async function saveInboxSession(inbox) {
  let summary = null;
  const path = await updateWorkspaceSessionData(session => {
    const next = { ...session, inbox: normalizeInboxSession(inbox) };
    summary = inboxSessionSummary(next.inbox);
    return next;
  });
  if (!path) throw new Error("无法写入工作区 workspace/session.json");
  return summary;
}

function sessionData() {
  if (isPoolLabelSessionTab()) {
    syncPoolLabelResumeSnapshotFromLiveView();
  }
  const galleryScrollTop = isPoolLabelSessionTab()
    ? Math.max(0, Math.round(el.galleryScroll?.scrollTop || state.galleryScrollTop || state.poolLabelResumeGalleryScrollTop || 0))
    : Math.max(0, Math.round(state.poolLabelResumeGalleryScrollTop || state.galleryScrollTop || 0));
  const poolLabelImagePath = state.poolLabelResumeImagePath || state.currentImagePath || "";
  const data = {
    version: 3,
    yoloSource: state.yoloSource || "",
    workspaceRoot: state.workspaceRoot || "",
    activeTab: validSessionTab(state.activeTab),
    rootName: state.rootName,
    datasetRoot: state.datasetBackendRoot || "",
    savedAt: new Date().toISOString(),
    galleryScrollTop,
    imageViewMode: state.imageViewMode,
    imagePoolUi: typeof imagePoolState !== "undefined" ? imagePoolSessionData() : undefined,
    reviewedPaths: [...state.reviewedPaths].sort(),
    flaggedPaths: [...state.flaggedPaths].sort()
  };
  if (poolLabelImagePath) {
    data.poolLabelCurrentImagePath = poolLabelImagePath;
    if (isPoolLabelSessionTab()) data.currentImagePath = poolLabelImagePath;
  }
  Object.assign(data, poolLabelSessionData());
  return data;
}

function applySessionData(data, preferredPath = null) {
  if (!data || typeof data !== "object") return false;
  applyAppSessionData(data);
  const validPaths = new Set(state.allPairs.map(pair => pair.imagePath));
  state.reviewedPaths = new Set((data.reviewedPaths || []).filter(path => validPaths.has(path)));
  state.flaggedPaths = new Set((data.flaggedPaths || []).filter(path => validPaths.has(path)));
  state.imageViewMode = ["all", "hideReviewed", "flagged"].includes(data.imageViewMode) ? data.imageViewMode : "all";
  if (typeof poolLabelState !== "undefined") {
    applyPoolLabelSessionFields(data);
  }
  const currentPath = resolveSessionImagePath(
    preferredPath || data.poolLabelCurrentImagePath || data.currentImagePath,
    validPaths
  );
  if (currentPath) {
    state.currentImagePath = currentPath;
    state.poolLabelResumeImagePath = currentPath;
  }
  state.galleryScrollTop = Math.max(0, Math.round(Number(data.galleryScrollTop) || 0));
  state.poolLabelResumeGalleryScrollTop = state.galleryScrollTop;
  return true;
}

async function loadSessionFromDefault(preferredPath = null, options = {}) {
  const data = await readCurrentSessionData(options);
  return Object.keys(data).length ? applySessionData(data, preferredPath) : false;
}

function saveSessionSoon() {
  if (window.startupRestoreInProgress) return;
  if (!hasDatasetOpen() && !hasWorkspaceRoot()) return;
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    scheduleUiIdle(() => saveSession({ manual: false }));
  }, 500);
}

function flushSessionSoon() {
  if (!hasDatasetOpen() && !hasWorkspaceRoot()) return;
  if (isPoolLabelSessionTab()) {
    syncPoolLabelResumeSnapshotFromLiveView();
  } else {
    state.currentImagePath = state.pairs[state.currentIndex]?.imagePath || state.currentImagePath || state.poolLabelResumeImagePath || "";
    state.galleryScrollTop = Math.max(0, Math.round(el.galleryScroll?.scrollTop || state.galleryScrollTop || state.poolLabelResumeGalleryScrollTop || 0));
  }
  clearTimeout(sessionSaveTimer);
  saveSession({ manual: false }).catch(error => console.warn("Session flush failed:", error));
}

window.addEventListener("pagehide", flushSessionSoon);
window.addEventListener("beforeunload", flushSessionSoon);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSessionSoon();
});

async function saveSession({ manual = false } = {}) {
  if (!hasDatasetOpen() && !hasWorkspaceRoot()) {
    if (manual) alert("Open a workspace or dataset first.");
    return;
  }
  const snapshot = sessionData();
  try {
    if (!await ensurePythonBackend()) {
      throw new Error("Fixed session save only works inside the Qt app. Use run_legacy_qt.bat instead of opening web/index.html directly in Chrome/Edge.");
    }
    let path = "";
    if (usesWorkspaceSession()) {
      path = await updateWorkspaceSessionData(existing => ({ ...existing, ...snapshot, inbox: existing.inbox }));
      await rememberLastOpenedWorkspace(state.workspaceRoot);
    } else {
      path = await backendCall("writeSessionFile", JSON.stringify(snapshot, null, 2));
      if (state.yoloSource === "dataset" && state.datasetBackendRoot) {
        await rememberLastOpenedYoloFolder(state.datasetBackendRoot);
      }
    }
    if (manual) {
      setStatus(usesWorkspaceSession()
        ? `审阅进度已写入工作区（workspace/session.json）`
        : `审阅进度已保存：${path}`);
    }
  } catch (error) {
    if (manual) alert(`Session save failed: ${error.message}`);
    else console.warn("Session autosave failed:", error);
  }
}

async function savePoolLabelSessionNow(poolLabelData = null) {
  const savedAt = new Date().toISOString();
  const snapshot = {
    ...(poolLabelData || poolLabelSessionData()),
    workspaceRoot: state.workspaceRoot || "",
    datasetRoot: state.datasetBackendRoot || "",
    poolLabelSavedAt: savedAt
  };
  const hasPoolLabelPayload = Array.isArray(snapshot.poolLabelShortcuts)
    || Array.isArray(snapshot.poolLabelFixedBoxes)
    || snapshot.poolLabelPointerToolEnabled
    || snapshot.poolLabelAutoFitEnabled;
  if (!hasWorkspaceRoot() || !hasPoolLabelPayload || !await ensurePythonBackend()) return;
  await updateWorkspaceSessionData(existing => ({ ...existing, ...snapshot }));
}
