const JUNK_CONTEXTS = ["pool-label", "yolo-review", "image-pool", "inbox"];
const JUNK_UNDO_LIMIT = 10;
const junkUndoStacks = Object.fromEntries(JUNK_CONTEXTS.map(context => [context, []]));

function junkPushUndo(context, filenames) {
  if (!context || !filenames?.length || typeof snapshotMetadataForFiles !== "function") return;
  if (!junkUndoStacks[context]) return;
  junkUndoStacks[context].push(snapshotMetadataForFiles(filenames));
  if (junkUndoStacks[context].length > JUNK_UNDO_LIMIT) junkUndoStacks[context].shift();
  updateJunkUndoUi(context);
}

function junkHasUndo(context) {
  return Boolean(context && junkUndoStacks[context]?.length);
}

function junkPopUndo(context) {
  if (!context) return null;
  return junkUndoStacks[context]?.pop() || null;
}

function junkUndoButtonForContext(context) {
  switch (context) {
    case "pool-label":
    case "yolo-review":
      return el.undoMarkJunkBtn;
    case "image-pool":
      return el.imagePoolUndoJunkBtn;
    case "inbox":
      return el.inboxUndoJunkBtn;
    default:
      return null;
  }
}

function updateJunkUndoUi(context = null) {
  const contexts = context ? [context] : JUNK_CONTEXTS;
  const busy = Boolean(inboxState?.assigning);
  for (const ctx of contexts) {
    const button = junkUndoButtonForContext(ctx);
    if (!button) continue;
    const deleting = ctx === "image-pool" && imagePoolState?.deleting;
    button.disabled = !junkHasUndo(ctx) || busy || deleting;
  }
}

function resolveActiveJunkContext() {
  if (el.app?.classList.contains("pool-label")) return "pool-label";
  if (el.app?.classList.contains("yolo")) return "yolo-review";
  if (el.app?.classList.contains("image-pool")) return "image-pool";
  if (el.app?.classList.contains("inbox")) return "inbox";
  return null;
}

function resolveJunkContextFromPreview(previewContext) {
  if (previewContext === "inbox") return "inbox";
  if (previewContext === "image-pool") return "image-pool";
  if (previewContext === "yolo") {
    return el.app?.classList.contains("pool-label") ? "pool-label" : "yolo-review";
  }
  return null;
}

function resolveJunkScope(context) {
  switch (context) {
    case "pool-label":
      return "detect";
    case "yolo-review":
      return typeof yoloViewModeState !== "undefined" && yoloViewModeState.mode === "clf" ? "clf" : "detect";
    case "image-pool":
      return typeof imagePoolJunkScope === "function" ? imagePoolJunkScope() : "detect";
    case "inbox":
      return typeof inboxJunkScope === "function" ? inboxJunkScope() : "clf";
    default:
      return "detect";
  }
}

function yoloJunkScope() {
  const context = el.app?.classList.contains("pool-label") ? "pool-label" : "yolo-review";
  return resolveJunkScope(context);
}

function previewJunkScope() {
  const previewContext = typeof imagePreviewLightboxState !== "undefined"
    ? imagePreviewLightboxState.previewContext
    : "";
  const context = resolveJunkContextFromPreview(previewContext);
  return context ? resolveJunkScope(context) : "clf";
}

function canJunkInContext(context) {
  if (typeof hasWorkspaceRoot !== "function" || !hasWorkspaceRoot()) return false;
  switch (context) {
    case "pool-label":
    case "yolo-review":
      return typeof canMarkYoloJunk === "function" && canMarkYoloJunk();
    case "image-pool":
    case "inbox":
      return Boolean(state.workspaceRoot);
    default:
      return false;
  }
}

function resolveJunkFilenames(context) {
  switch (context) {
    case "pool-label":
    case "yolo-review":
      return typeof yoloSelectedFilenames === "function" ? yoloSelectedFilenames() : [];
    case "image-pool":
      return typeof imagePoolSelectedFilenames === "function" ? imagePoolSelectedFilenames() : [];
    case "inbox":
      return typeof inboxSelectedFilenames === "function" ? inboxSelectedFilenames() : [];
    default:
      return [];
  }
}

function junkStatusForContext(context, message) {
  if (context === "inbox" && typeof setInboxLog === "function") setInboxLog(message);
  else if (typeof setStatus === "function") setStatus(message);
}

async function junkRefreshUiAfterAction(context, options = {}) {
  switch (context) {
    case "pool-label":
    case "yolo-review":
      if (typeof updateReviewControls === "function") updateReviewControls();
      break;
    case "image-pool":
      if (typeof updateImagePoolJunkSelectionUI === "function") updateImagePoolJunkSelectionUI();
      if (!options.skipGridRender && typeof renderImagePoolGrid === "function") renderImagePoolGrid();
      break;
    case "inbox":
      if (!options.skipGridRender && typeof renderInboxGrid === "function") renderInboxGrid();
      if (typeof updateInboxSelectionCount === "function") updateInboxSelectionCount();
      break;
    default:
      break;
  }
  updateJunkUndoUi(context);
}

async function runJunkMark(context, options = {}) {
  if (!context || !canJunkInContext(context)) return null;
  const scope = resolveJunkScope(context);
  const filenames = options.filenames || resolveJunkFilenames(context);
  if (!filenames.length) {
    junkStatusForContext(context, "请先选择图片。");
    return null;
  }
  if (typeof markInboxJunkFilenames !== "function") return null;
  const pending = filenames.filter(name => !isInboxJunkFile(name, scope));
  if (!pending.length) {
    junkStatusForContext(context, "所选图片已是废片。");
    return null;
  }
  const result = await markInboxJunkFilenames(pending, {
    clearSelection: options.clearSelection ?? context === "inbox",
    skipGridRender: options.skipGridRender ?? true,
    quiet: options.quiet ?? false,
    scope,
    junkContext: context
  });
  if (result) await junkRefreshUiAfterAction(context, options);
  return result;
}

async function runJunkUnmark(context, options = {}) {
  if (!context || !canJunkInContext(context)) return null;
  const scope = resolveJunkScope(context);
  const filenames = options.filenames || resolveJunkFilenames(context);
  if (!filenames.length) {
    junkStatusForContext(context, "请先选择图片。");
    return null;
  }
  if (typeof unmarkInboxJunkFilenames !== "function") return null;
  const result = await unmarkInboxJunkFilenames(filenames, {
    clearSelection: options.clearSelection ?? context === "inbox",
    skipGridRender: options.skipGridRender ?? true,
    quiet: options.quiet ?? false,
    scope,
    junkContext: context
  });
  if (result) await junkRefreshUiAfterAction(context, options);
  return result;
}

async function runJunkUndo(context, options = {}) {
  if (!context || !canJunkInContext(context)) {
    junkStatusForContext(context, "当前界面不支持撤回废片。");
    return null;
  }
  const snapshots = junkPopUndo(context);
  updateJunkUndoUi(context);
  if (!snapshots?.length) {
    junkStatusForContext(context, "没有可撤回的废片操作。");
    return null;
  }
  if (typeof metadataRowToUpdate !== "function" || typeof applyJunkMetadataUpdates !== "function") {
    return null;
  }
  const updates = snapshots.map(({ filename, row }) => metadataRowToUpdate(filename, row));
  const result = await applyJunkMetadataUpdates(updates, {
    clearSelection: false,
    skipGridRender: options.skipGridRender ?? true,
    quiet: options.quiet ?? false,
    restoreFromUndo: true,
    actionLabel: "Undo junk",
    successLog: "Undid the last junk action.",
    successStatus: "已撤回上一步废片操作。"
  });
  if (result) await junkRefreshUiAfterAction(context, options);
  return result;
}

function handleJunkKeyDown(event) {
  const context = resolveActiveJunkContext();
  if (!context || !canJunkInContext(context)) return false;
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return false;
  const key = event.key.toLowerCase();
  if (key === "j" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    runJunkMark(context).catch(showError);
    return true;
  }
  if (event.ctrlKey && event.shiftKey && key === "z") {
    event.preventDefault();
    runJunkUndo(context).catch(showError);
    return true;
  }
  return false;
}

function bindJunkActionEvents() {
  el.markJunkBtn?.addEventListener("click", () => {
    const context = resolveActiveJunkContext();
    if (context) runJunkMark(context).catch(showError);
  });
  el.undoMarkJunkBtn?.addEventListener("click", () => {
    const context = resolveActiveJunkContext();
    if (context) runJunkUndo(context).catch(showError);
  });
  el.inboxMarkJunkBtn?.addEventListener("click", () => runJunkMark("inbox").catch(showError));
  el.inboxUndoJunkBtn?.addEventListener("click", () => runJunkUndo("inbox").catch(showError));
  el.imagePoolMarkJunkBtn?.addEventListener("click", () => runJunkMark("image-pool").catch(showError));
  el.imagePoolClearJunkBtn?.addEventListener("click", () => runJunkUnmark("image-pool").catch(showError));
  el.imagePoolUndoJunkBtn?.addEventListener("click", () => runJunkUndo("image-pool").catch(showError));
  document.addEventListener("keydown", event => {
    if (typeof handleJunkKeyDown === "function") handleJunkKeyDown(event);
  });
}

window.junkPushUndo = junkPushUndo;
window.junkHasUndo = junkHasUndo;
window.updateJunkUndoUi = updateJunkUndoUi;
window.resolveActiveJunkContext = resolveActiveJunkContext;
window.resolveJunkContextFromPreview = resolveJunkContextFromPreview;
window.resolveJunkScope = resolveJunkScope;
window.yoloJunkScope = yoloJunkScope;
window.previewJunkScope = previewJunkScope;
window.runJunkMark = runJunkMark;
window.runJunkUnmark = runJunkUnmark;
window.runJunkUndo = runJunkUndo;
window.handleJunkKeyDown = handleJunkKeyDown;
window.bindJunkActionEvents = bindJunkActionEvents;
