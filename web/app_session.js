var sessionSaveTimer = null;

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
  if (!restore || !el.imagePoolGridWrap || !imagePoolState.pairs.length) return;
  const columns = Math.max(1, imagePoolVirtual?.columns || 1);
  const rowHeight = Math.max(1, imagePoolVirtual?.rowHeight || 150);
  let top = restore.scrollTop || 0;
  if (restore.imagePath) {
    const index = imagePoolState.pairs.findIndex(pair => pair.imagePath === restore.imagePath);
    if (index >= 0) top = Math.floor(index / columns) * rowHeight;
  }
  imagePoolState.restoreViewport = null;
  requestAnimationFrame(() => {
    el.imagePoolGridWrap.scrollTop = top;
    renderImagePoolGrid();
  });
}

function applyAppSessionData(data) {
  if (!data || typeof data !== "object") return;
  state.activeTab = validSessionTab(data.activeTab);
  if (typeof imagePoolState !== "undefined") applyImagePoolSessionData(data);
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
      filter: ["new", "unassigned", "all"].includes(ui.filter) ? ui.filter : base.ui.filter,
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

async function readWorkspaceSessionData() {
  if (!hasWorkspaceRoot() || !await ensurePythonBackend()) return {};
  try {
    const text = await backendCall("readWorkspaceSession", state.workspaceRoot);
    if (!text?.trim()) return {};
    const data = JSON.parse(text);
    return data && typeof data === "object" ? data : {};
  } catch {
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

async function readInboxSessionData() {
  const session = await readWorkspaceSessionData();
  return inboxSessionSummary(session.inbox);
}

async function saveInboxSession(inbox) {
  const session = await readWorkspaceSessionData();
  session.inbox = normalizeInboxSession(inbox);
  const path = await writeWorkspaceSessionData(session);
  if (!path) throw new Error("无法写入工作区 .yolo_label_viewer/session.json");
  return inboxSessionSummary(session.inbox);
}

function sessionData() {
  return {
    version: 3,
    yoloSource: state.yoloSource || "",
    workspaceRoot: state.workspaceRoot || "",
    activeTab: validSessionTab(state.activeTab),
    rootName: state.rootName,
    datasetRoot: state.datasetBackendRoot || "",
    savedAt: new Date().toISOString(),
    currentImagePath: state.currentImagePath,
    galleryScrollTop: Math.max(0, Math.round(el.galleryScroll?.scrollTop || state.galleryScrollTop || 0)),
    imageViewMode: state.imageViewMode,
    poolLabelShortcuts: typeof poolLabelState !== "undefined" ? normalizePoolLabelShortcuts(poolLabelState.shortcutSlots) : undefined,
    poolLabelPointerToolEnabled: typeof poolLabelState !== "undefined" ? !!poolLabelState.pointerToolEnabled : undefined,
    poolLabelAutoFitEnabled: typeof poolLabelState !== "undefined" ? !!poolLabelState.autoFitEnabled : undefined,
    imagePoolUi: typeof imagePoolState !== "undefined" ? imagePoolSessionData() : undefined,
    reviewedPaths: [...state.reviewedPaths].sort(),
    flaggedPaths: [...state.flaggedPaths].sort()
  };
}

function applySessionData(data, preferredPath = null) {
  if (!data || typeof data !== "object") return false;
  applyAppSessionData(data);
  const validPaths = new Set(state.allPairs.map(pair => pair.imagePath));
  state.reviewedPaths = new Set((data.reviewedPaths || []).filter(path => validPaths.has(path)));
  state.flaggedPaths = new Set((data.flaggedPaths || []).filter(path => validPaths.has(path)));
  state.imageViewMode = ["all", "hideReviewed", "flagged"].includes(data.imageViewMode) ? data.imageViewMode : "all";
  if (typeof poolLabelState !== "undefined") {
    poolLabelState.shortcutSlots = normalizePoolLabelShortcuts(data.poolLabelShortcuts);
    poolLabelState.pointerToolEnabled = !!data.poolLabelPointerToolEnabled;
    poolLabelState.autoFitEnabled = !!data.poolLabelAutoFitEnabled;
    if (poolLabelState.pointerToolEnabled) poolLabelState.autoFitEnabled = false;
    if (typeof poolLabelSyncAutoFitTool === "function") poolLabelSyncAutoFitTool();
  }
  const currentPath = preferredPath || data.currentImagePath;
  if (currentPath && validPaths.has(currentPath)) state.currentImagePath = currentPath;
  state.galleryScrollTop = Math.max(0, Math.round(Number(data.galleryScrollTop) || 0));
  return true;
}

async function loadSessionFromDefault(preferredPath = null) {
  if (!await ensurePythonBackend()) return false;
  try {
    let text = "";
    if (usesWorkspaceSession()) {
      text = await backendCall("readWorkspaceSession", state.workspaceRoot);
    } else {
      text = await backendCall("readSessionFile");
    }
    if (!text) return false;
    const data = JSON.parse(text);
    if (usesWorkspaceSession() && data.workspaceRoot && data.workspaceRoot !== state.workspaceRoot) {
      return false;
    }
    return applySessionData(data, preferredPath);
  } catch {
    return false;
  }
}

function saveSessionSoon() {
  if (!hasDatasetOpen() && !hasWorkspaceRoot()) return;
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => saveSession({ manual: false }), 500);
}

async function saveSession({ manual = false } = {}) {
  if (!hasDatasetOpen() && !hasWorkspaceRoot()) {
    if (manual) alert("Open a workspace or dataset first.");
    return;
  }
  try {
    if (!await ensurePythonBackend()) {
      throw new Error("Fixed session save only works inside the Python app. Start yolo_label_viewer_web_app.py instead of opening web/index.html directly in Chrome/Edge.");
    }
    let path = "";
    if (usesWorkspaceSession()) {
      const existing = await readWorkspaceSessionData();
      const data = { ...existing, ...sessionData(), inbox: existing.inbox };
      path = await writeWorkspaceSessionData(data);
      await rememberLastOpenedWorkspace(state.workspaceRoot);
    } else {
      path = await backendCall("writeSessionFile", JSON.stringify(sessionData(), null, 2));
      if (state.yoloSource === "dataset" && state.datasetBackendRoot) {
        await rememberLastOpenedYoloFolder(state.datasetBackendRoot);
      }
    }
    if (manual) {
      setStatus(usesWorkspaceSession()
        ? `审阅进度已写入工作区（.yolo_label_viewer/session.json）`
        : `审阅进度已保存：${path}`);
    }
  } catch (error) {
    if (manual) alert(`Session save failed: ${error.message}`);
    else console.warn("Session autosave failed:", error);
  }
}
