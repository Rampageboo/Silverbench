const INBOX_JUNK_CLASS = "__junk__";

const junkActionState = {
  undoStack: []
};

const inboxState = {
  filter: "new",
  selected: new Set(),
  metadataByFile: new Map(),
  randomUnusedFilenames: new Set(),
  randomUnusedNonce: 0,
  randomUnusedCandidateCount: 0,
  classes: [],
  clfDatasetPath: "",
  detectClasses: [],
  detectDatasetPath: "",
  classSearch: "",
  detectClassSearch: "",
  selectedClass: "",
  selectedDetectClassId: null,
  pairs: [],
  pairsCacheKey: "",
  metadataLoaded: false,
  metadataRevision: 0,
  anchorIndex: null,
  loading: false,
  assigning: false,
  workflow: null,
  pendingFilenames: new Set()
};

function normalizeWorkspacePath(path) {
  const text = String(path || "").trim();
  if (!text) return "";
  if (text.startsWith("//") && !text.startsWith("//?/")) {
    return `\\\\${text.slice(2).replace(/\//g, "\\")}`;
  }
  if (text.startsWith("\\") && !text.startsWith("\\\\")) {
    return `\\${text}`;
  }
  return text;
}

function inboxWorkspaceRoot() {
  return normalizeWorkspacePath(state.workspaceRoot);
}

function parseBackendJson(raw, fallback = {}) {
  if (!raw?.trim()) return { ...fallback, ok: false, error: "empty backend response" };
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { ...fallback, ok: false, error: `invalid json: ${error.message}` };
  }
}

function inboxPendingFilenames() {
  return inboxPendingFilenamesFrom(inboxState.workflow);
}

function inboxPendingBatchIds() {
  return (inboxState.workflow?.assignBatches || [])
    .filter(batch => !batch.built)
    .map(batch => batch.id);
}

function applyInboxSessionSummary(summary) {
  inboxState.workflow = summary.inbox;
  inboxState.pendingFilenames = new Set(summary.pendingFilenames || []);
  updateInboxWorkflowSummary(summary);
}

function updateInboxWorkflowSummary(summary = null) {
  const stats = summary || inboxSessionSummary(inboxState.workflow);
  if (el.inboxWorkflowStatus) {
    const pendingFiles = stats.pendingFiles || 0;
    const pendingBatches = stats.pendingBatches || 0;
    const lastBuildAt = stats.lastBuildAt || (inboxState.workflow?.buildRuns || []).at(-1)?.at || "";
    const lastBuildText = lastBuildAt ? ` | last build ${lastBuildAt.replace("T", " ").replace("Z", " UTC")}` : "";
    el.inboxWorkflowStatus.textContent = pendingFiles
      ? `pending ${pendingFiles} image(s) / ${pendingBatches} batch(es)${lastBuildText} | .yolo_label_viewer/session.json`
      : `no pending batches${lastBuildText} | .yolo_label_viewer/session.json`;
  }
  if (el.inboxBuildLinksBtn) {
    el.inboxBuildLinksBtn.disabled = Boolean(inboxState.assigning);
  }
  if (el.inboxBuildPendingBtn) {
    const pendingFiles = stats.pendingFiles || 0;
    const canBuild = pendingFiles > 0 && !inboxState.assigning;
    el.inboxBuildPendingBtn.disabled = !canBuild;
    el.inboxBuildPendingBtn.textContent = pendingFiles
      ? `Build Pending (${pendingFiles})`
      : "Build Pending";
    el.inboxBuildPendingBtn.title = inboxState.assigning
      ? "Writing metadata..."
      : pendingFiles
        ? `Sync ${pendingFiles} assigned image(s) to detect/clf datasets`
        : "Pending batches appear after assignment. Select images and click a class chip, or build all metadata.";
  }
}

function applyInboxWorkflowUi() {
  const ui = inboxState.workflow?.ui;
  if (!ui) return;
  if (["new", "unassigned", "random-unused", "all"].includes(ui.filter)) {
    inboxState.filter = ui.filter;
    for (const [key, button] of [
      ["new", el.inboxFilterNewBtn],
      ["unassigned", el.inboxFilterUnassignedBtn],
      ["random-unused", el.inboxFilterRandomUnusedBtn],
      ["all", el.inboxFilterAllBtn]
    ]) {
      button?.classList.toggle("active", inboxState.filter === key);
    }
  }
  setInboxAssignTarget(ui.assignTarget === "detect" ? "detect" : "clf", { save: false });
}

async function saveInboxWorkflowUi() {
  if (!hasWorkspaceRoot() || !await ensurePythonBackend()) return;
  const inbox = normalizeInboxSession(inboxState.workflow);
  inbox.ui = {
    filter: inboxState.filter,
    assignTarget: inboxAssignTarget()
  };
  applyInboxSessionSummary(await saveInboxSession(inbox));
}

async function loadInboxWorkflow() {
  if (!hasWorkspaceRoot() || !await ensurePythonBackend()) {
    inboxState.workflow = null;
    inboxState.pendingFilenames = new Set();
    updateInboxWorkflowSummary();
    return;
  }
  const summary = await readInboxSessionData();
  const merged = mergeInboxSessions(summary.inbox, inboxState.workflow);
  applyInboxSessionSummary(
    merged === summary.inbox ? summary : inboxSessionSummary(merged)
  );
  inboxState.metadataLoaded = false;
  await ensureInboxMetadataIndex();
  applyInboxWorkflowUi();
}

function markInboxBatchesBuilt(inbox, { markAll = false, batchIds = [], filenames = [] }) {
  const builtAt = new Date().toISOString();
  const markIdSet = new Set(batchIds || []);
  const builtNames = new Set(filenames || []);
  for (const batch of inbox.assignBatches || []) {
    if (markAll || markIdSet.has(batch.id)) {
      batch.built = true;
      batch.builtAt = builtAt;
      continue;
    }
    if (builtNames.size && (batch.filenames || []).every(name => builtNames.has(name))) {
      batch.built = true;
      batch.builtAt = builtAt;
    }
  }
  return inbox;
}

async function recordInboxAssignBatch({ filenames, clfClass }) {
  if (!hasWorkspaceRoot() || !filenames.length) return null;
  const { detectEnabled, clfEnabled, assignTarget } = inboxAssignSettings();
  const inbox = normalizeInboxSession(inboxState.workflow);
  inbox.assignBatches = [...(inbox.assignBatches || []), {
    id: smallPathHash(`${Date.now()}-${filenames.join(",")}-${clfClass}`),
    at: new Date().toISOString(),
    className: clfClass,
    assignTarget,
    detectEnabled,
    clfEnabled,
    filenames,
    built: false,
    builtAt: ""
  }].slice(-2000);
  applyInboxSessionSummary(await saveInboxSession(inbox));
  return inboxState.workflow;
}

async function recordInboxBuildRun({ scope, rebuild, result, filenames, batchIds, markAll }) {
  if (!hasWorkspaceRoot()) return null;
  const inbox = normalizeInboxSession(inboxState.workflow);
  inbox.buildRuns = [...(inbox.buildRuns || []), {
    id: smallPathHash(`${Date.now()}-${scope}-${(filenames || []).length}`),
    at: new Date().toISOString(),
    scope,
    rebuild: Boolean(rebuild),
    batchIds: batchIds || [],
    filenames: filenames || result?.builtFilenames || [],
    detectImagesLinked: result?.detectImagesLinked || 0,
    clfImagesLinked: result?.clfImagesLinked || 0,
    labelsPlaced: result?.labelsPlaced || 0,
    errors: (result?.errors || []).slice(0, 20)
  }].slice(-500);
  markInboxBatchesBuilt(inbox, {
    markAll: Boolean(markAll),
    batchIds: batchIds || [],
    filenames: filenames || result?.builtFilenames || []
  });
  applyInboxSessionSummary(await saveInboxSession(inbox));
  return inboxState.workflow;
}

const inboxVirtual = createVirtualGalleryState(150);
let inboxThumbObserver = null;

function inboxPairsCacheKey() {
  return `${inboxState.filter}:${inboxState.randomUnusedNonce}:${imagePoolState.scanAt}:${imagePoolState.pairPaths.length}:${inboxState.metadataRevision}:${inboxState.metadataByFile.size}`;
}

function inboxIsUnusedForDataset(filename) {
  const sideState = inboxMetadataSideState(filename);
  const poolMeta = imagePoolState.metaByFile.get(filename);
  return !sideState.detectInUse && !sideState.clfInUse && !poolMeta?.isUsed;
}

function inboxHasNoAssignmentMetadata(filename) {
  const sideState = inboxMetadataSideState(filename);
  return !sideState.detectInUse
    && !sideState.clfInUse
    && !sideState.detectRejected
    && !sideState.clfRejected;
}

function shuffleInboxPairs(pairs) {
  const shuffled = pairs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function chooseInboxRandomUnusedSample() {
  const candidates = imagePoolBasePairs().filter(pair => {
    const filename = pair.imagePath.split("/").pop();
    return inboxIsUnusedForDataset(filename);
  });
  inboxState.randomUnusedCandidateCount = candidates.length;
  inboxState.randomUnusedFilenames = new Set(
    shuffleInboxPairs(candidates)
      .slice(0, 100)
      .map(pair => pair.imagePath.split("/").pop())
  );
  inboxState.randomUnusedNonce += 1;
}

function rebuildInboxPairs() {
  const pairs = imagePoolBasePairs();
  if (inboxState.filter === "random-unused" && inboxState.randomUnusedNonce === 0) {
    chooseInboxRandomUnusedSample();
  }
  inboxState.pairs = pairs.filter(pair => {
    const filename = pair.imagePath.split("/").pop();
    const meta = imagePoolState.metaByFile.get(filename);
    if (inboxState.filter === "new") return meta?.isNew;
    if (inboxState.filter === "unassigned") {
      return inboxHasNoAssignmentMetadata(filename);
    }
    if (inboxState.filter === "random-unused") {
      return inboxState.randomUnusedFilenames.has(filename) && inboxIsUnusedForDataset(filename);
    }
    return true;
  });
  inboxState.pairsCacheKey = inboxPairsCacheKey();
}

window.rebuildInboxPairs = rebuildInboxPairs;

function updateInboxTabBadge() {
  const btn = el.inboxTabBtn;
  if (!btn) return;
  const count = imagePoolState.summary?.newCount || 0;
  btn.textContent = count > 0 ? `Image Assign (${count})` : "Image Assign";
}

function updateInboxSelectionCount() {
  const count = inboxState.selected.size;
  if (el.inboxSelectionCount) {
    el.inboxSelectionCount.textContent = `${count} selected`;
  }
  const scope = inboxJunkScope();
  const scopeLabel = inboxJunkScopeLabel(scope);
  const selected = count ? [...inboxState.selected] : [];
  const pendingMark = selected.filter(name => !isInboxJunkFile(name, scope)).length;
  if (el.inboxMarkJunkBtn) {
    el.inboxMarkJunkBtn.disabled = !pendingMark || inboxState.assigning;
    el.inboxMarkJunkBtn.textContent = count
      ? (pendingMark ? `Mark ${scopeLabel} Junk (${pendingMark})` : `Mark ${scopeLabel} Junk`)
      : `Mark ${scopeLabel} Junk`;
  }
  updateJunkUndoButtons();
  renderInboxClassPicker();
}

function setInboxLog(message) {
  if (el.inboxLog) el.inboxLog.textContent = message;
}

async function ensureInboxMetadataIndex(options = {}) {
  const { force = false } = options;
  if (inboxState.metadataLoaded && !force) return true;
  const workspaceRoot = inboxWorkspaceRoot();
  if (!workspaceRoot || !await ensurePythonBackend()) return false;
  const metaPayload = parseBackendJson(
    await backendCall("readMetadataRows", workspaceRoot),
    { ok: false, rows: [] }
  );
  if (metaPayload.ok === false) {
    console.warn("readMetadataRows failed:", metaPayload.error || "unknown error");
    inboxState.metadataLoaded = false;
    return false;
  }
  inboxState.metadataByFile = new Map(
    (metaPayload.rows || []).map(row => [row.filename, row])
  );
  inboxState.metadataLoaded = true;
  inboxState.metadataRevision = (inboxState.metadataRevision || 0) + 1;
  return true;
}

async function reloadInboxMetadataIndex() {
  inboxState.metadataLoaded = false;
  return ensureInboxMetadataIndex({ force: true });
}

async function loadInboxClassesOnly() {
  const workspaceRoot = inboxWorkspaceRoot();
  if (!workspaceRoot || !await ensurePythonBackend()) return;
  const metaPayload = parseBackendJson(
    await backendCall("readMetadataRows", workspaceRoot),
    { ok: false, classes: [], clfClasses: [], metadataClasses: [], clfDataset: "", rows: [] }
  );
  if (metaPayload.ok === false && metaPayload.error) {
    throw new Error(metaPayload.error);
  }
  inboxState.classes = metaPayload.classes
    || metaPayload.clfClasses
    || metaPayload.metadataClasses
    || [];
  inboxState.clfDatasetPath = metaPayload.clfDataset || "";
  inboxState.detectClasses = Array.isArray(metaPayload.detectClasses) ? metaPayload.detectClasses : [];
  inboxState.detectDatasetPath = metaPayload.detectDataset || "";
  if (inboxState.selectedDetectClassId != null) {
    const stillExists = inboxState.detectClasses.some(
      item => Number(item.id) === Number(inboxState.selectedDetectClassId)
    );
    if (!stillExists) inboxState.selectedDetectClassId = null;
  }
  renderInboxClassPicker();
}

function setInboxFilter(filter) {
  inboxState.filter = filter;
  for (const [key, button] of [
    ["new", el.inboxFilterNewBtn],
    ["unassigned", el.inboxFilterUnassignedBtn],
    ["random-unused", el.inboxFilterRandomUnusedBtn],
    ["all", el.inboxFilterAllBtn]
  ]) {
    button?.classList.toggle("active", filter === key);
  }
  inboxState.selected.clear();
  inboxState.anchorIndex = null;
  saveInboxWorkflowUi().catch(() => {});
  if (filter === "unassigned" || filter === "random-unused") {
    ensureInboxMetadataIndex()
      .then(() => {
        if (filter === "random-unused") chooseInboxRandomUnusedSample();
        rebuildInboxPairs();
        renderInboxGrid();
      })
      .catch(error => setInboxLog(`Failed to load metadata: ${error.message || error}`));
    return;
  }
  rebuildInboxPairs();
  renderInboxGrid();
}

async function loadInboxMetadata(options = {}) {
  const { reloadMetadata = false } = options;
  const workspaceRoot = inboxWorkspaceRoot();
  if (!workspaceRoot) {
    renderInboxClassPicker();
    return;
  }
  if (!await ensurePythonBackend()) {
    setInboxLog("Python backend is required to load Clf classes.");
    renderInboxClassPicker();
    return;
  }

  try {
    await loadInboxClassesOnly();
    if (reloadMetadata || inboxState.filter === "unassigned") {
      inboxState.metadataLoaded = false;
      await ensureInboxMetadataIndex();
    }
    if (inboxState.selectedClass && !inboxState.classes.includes(inboxState.selectedClass)) {
      inboxState.selectedClass = "";
    }
    if (!inboxState.classes.length) {
      setInboxLog(`No classes found: clf_dataset folders, metadata.csv, and workspace.json are empty. ${inboxState.clfDatasetPath || "(unknown path)"}`);
    }
  } catch (error) {
    setInboxLog(`Failed to load Clf classes: ${error.message || error}`);
  }
}

function setInboxSelectedClass(className) {
  inboxState.selectedClass = String(className || "");
  renderInboxClassPicker();
}

function inboxAssignTarget() {
  if (el.inboxTargetDetectBtn?.classList.contains("active")) return "detect";
  return "clf";
}

function setInboxAssignTarget(target, options = {}) {
  const next = target === "detect" ? "detect" : "clf";
  el.inboxTargetDetectBtn?.classList.toggle("active", next === "detect");
  el.inboxTargetClfBtn?.classList.toggle("active", next === "clf");
  updateInboxAssignTargetUi();
  if (state.workspaceRoot && options.reloadClasses !== false) {
    loadInboxClassesOnly().catch(error => setInboxLog(`Failed to load classes: ${error.message || error}`));
  }
  if (options.save !== false) {
    saveInboxWorkflowUi().catch(() => {});
  }
  if (state.workspaceRoot) {
    renderInboxGrid({ selectionOnly: true });
    if (typeof refreshImagePoolAfterJunkChange === "function") {
      refreshImagePoolAfterJunkChange({ selectionOnly: true });
    }
  }
}

function updateInboxAssignTargetUi() {
  const target = inboxAssignTarget();
  const isDetect = target === "detect";
  if (el.inboxClfAssignPanel) el.inboxClfAssignPanel.hidden = isDetect;
  if (el.inboxDetectAssignPanel) el.inboxDetectAssignPanel.hidden = !isDetect;
  if (el.inboxAssignActionRow) {
    const actionHost = isDetect ? el.inboxDetectAssignPanel : el.inboxCreateAssignRow;
    if (actionHost && el.inboxAssignActionRow.parentElement !== actionHost) {
      actionHost.appendChild(el.inboxAssignActionRow);
    }
    el.inboxAssignActionRow.classList.toggle("is-detect", isDetect);
  }
  if (el.inboxApplyAssignBtn) {
    el.inboxApplyAssignBtn.textContent = isDetect ? "Apply to Selected (Detect)" : "Apply to Selected";
  }
  renderInboxClassPicker();
}

function inboxAssignSettings() {
  const assignTarget = inboxAssignTarget();
  return {
    assignTarget,
    detectEnabled: assignTarget === "detect",
    clfEnabled: assignTarget === "clf"
  };
}

function validateInboxAssignSettings(clfClass) {
  const { clfEnabled } = inboxAssignSettings();
  if (clfEnabled && !clfClass) {
    alert("Choose or enter a class in Clf mode.");
    return false;
  }
  return true;
}

function inboxFilteredClasses() {
  const query = String(inboxState.classSearch || "").trim().toLowerCase();
  const classes = inboxState.classes.filter(name => name !== INBOX_JUNK_CLASS);
  if (!query) return classes;
  return classes.filter(name => name.toLowerCase().includes(query));
}

function inboxFilteredDetectClasses() {
  const query = String(inboxState.detectClassSearch || "").trim().toLowerCase();
  const classes = inboxState.detectClasses || [];
  if (!query) return classes;
  return classes.filter(item => {
    const name = String(item.name || "").toLowerCase();
    const id = String(item.id ?? "");
    return name.includes(query) || id.includes(query);
  });
}

function detectClassChipLabel(item) {
  const id = Number(item.id);
  const name = String(item.name || "").trim();
  return Number.isFinite(id) ? `${id}: ${name}` : name;
}

function renderInboxClfClassPicker() {
  const picker = el.inboxClassPicker;
  if (!picker) return;
  picker.replaceChildren();
  if (!state.workspaceRoot) {
    picker.innerHTML = `<div class="empty">Open a workspace to load classes</div>`;
    if (el.inboxClassHint) el.inboxClassHint.textContent = "Classes load from clf_dataset/train|val folders";
    return;
  }

  const visible = inboxFilteredClasses();
  if (!inboxState.classes.length) {
    picker.innerHTML = `<div class="empty">No classes found. Preferred sources: clf_dataset folders, then metadata/workspace.json. Path: ${escapeHtml(inboxState.clfDatasetPath || "not found")}<br>Create a class below.</div>`;
  } else if (!visible.length) {
    picker.innerHTML = `<div class="empty">No class matches "${escapeHtml(inboxState.classSearch)}".</div>`;
  } else {
    const canQuickAssign = inboxState.selected.size > 0 && !inboxState.assigning;
    for (const className of visible) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `inbox-class-chip${canQuickAssign ? " quick-assign" : ""}${inboxState.selectedClass === className ? " active" : ""}`;
      button.textContent = className;
      button.disabled = inboxState.assigning;
      button.title = canQuickAssign
        ? `Write ${inboxState.selected.size} selected image(s) to metadata -> ${className}`
        : "Select images, then click a class for quick assignment";
      button.addEventListener("click", () => {
        if (inboxState.assigning) return;
        if (inboxState.selected.size > 0) {
          quickAssignInboxClass(className).catch(showError);
          return;
        }
        setInboxSelectedClass(className);
        setInboxLog("Select images before clicking a class chip.");
      });
      picker.appendChild(button);
    }
  }
  if (el.inboxClassHint) {
    const shown = visible.length;
    const total = inboxState.classes.length;
    el.inboxClassHint.textContent = total
      ? `clf_dataset classes ${shown}/${total}${inboxState.clfDatasetPath ? ` | ${inboxState.clfDatasetPath.split(/[\\/]/).slice(-2).join("/")}` : ""}`
      : "clf_dataset has no class folders yet";
  }
}

function renderInboxDetectClassPicker() {
  const picker = el.inboxDetectClassPicker;
  if (!picker) return;
  picker.replaceChildren();
  if (!state.workspaceRoot) {
    picker.innerHTML = `<div class="empty">Open a workspace to load detect classes</div>`;
    if (el.inboxDetectClassHint) el.inboxDetectClassHint.textContent = "Classes load from detect_dataset/data.yaml";
    return;
  }

  const visible = inboxFilteredDetectClasses();
  if (!inboxState.detectClasses.length) {
    picker.innerHTML = `<div class="empty">No detect classes found. Check that ${escapeHtml(inboxState.detectDatasetPath || "detect_dataset")}/data.yaml has a names section.</div>`;
  } else if (!visible.length) {
    picker.innerHTML = `<div class="empty">No detect class matches "${escapeHtml(inboxState.detectClassSearch)}".</div>`;
  } else {
    const canQuickAssign = inboxState.selected.size > 0 && !inboxState.assigning;
    for (const item of visible) {
      const classId = Number(item.id);
      const label = detectClassChipLabel(item);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `inbox-class-chip${canQuickAssign ? " quick-assign" : ""}${inboxState.selectedDetectClassId === classId ? " active" : ""}`;
      button.textContent = label;
      button.disabled = inboxState.assigning;
      button.title = canQuickAssign
        ? `Mark ${inboxState.selected.size} selected image(s) as detect_enabled`
        : "Select images, then click a class chip or Apply to Selected";
      button.addEventListener("click", () => {
        if (inboxState.assigning) return;
        inboxState.selectedDetectClassId = classId;
        renderInboxDetectClassPicker();
        if (inboxState.selected.size > 0) {
          quickAssignInboxDetect().catch(showError);
          return;
        }
        setInboxLog(`Selected detect class ${label}. Select images, then click the chip or Apply to Selected.`);
      });
      picker.appendChild(button);
    }
  }
  if (el.inboxDetectClassHint) {
    const shown = visible.length;
    const total = inboxState.detectClasses.length;
    el.inboxDetectClassHint.textContent = total
      ? `detect classes ${shown}/${total}${inboxState.detectDatasetPath ? ` | ${inboxState.detectDatasetPath.split(/[\\/]/).slice(-2).join("/")}/data.yaml` : ""}`
      : "detect_dataset has no data.yaml classes yet";
  }
}

function renderInboxClassPicker() {
  renderInboxClfClassPicker();
  renderInboxDetectClassPicker();
}

function renderInboxStats() {
  if (!el.inboxStats) return;
  if (!state.workspaceRoot) {
    el.inboxStats.textContent = "Open a workspace to load NEW images";
    return;
  }
  const visible = inboxState.pairs.length;
  const selected = inboxState.selected.size;
  const newCount = imagePoolState.summary?.newCount ?? 0;
  const randomText = inboxState.filter === "random-unused"
    ? ` | unused candidates ${inboxState.randomUnusedCandidateCount}`
    : "";
  el.inboxStats.textContent = `${visible} visible | NEW ${newCount}${randomText} | ${selected} selected`;
}

function ensureInboxThumbObserver() {
  if (inboxThumbObserver || !el.inboxGridWrap) return;
  inboxThumbObserver = createLazyThumbObserver(
    el.inboxGridWrap,
    loadGalleryThumbImage,
    "240px"
  );
}

function isInboxClfJunkFile(filename) {
  return inboxState.metadataByFile.get(filename)?.clf_class === INBOX_JUNK_CLASS;
}

function isInboxDetectJunkFile(filename) {
  const row = inboxState.metadataByFile.get(filename);
  if (!row) return false;
  return row.detect_junk === "1" || row.detect_junk === true;
}

function isInboxJunkFile(filename, scope) {
  if (scope === "clf") return isInboxClfJunkFile(filename);
  if (scope === "detect") return isInboxDetectJunkFile(filename);
  if (scope === "both") return isInboxDetectJunkFile(filename) && isInboxClfJunkFile(filename);
  return isInboxClfJunkFile(filename) || isInboxDetectJunkFile(filename);
}

function inboxJunkScopeLabel(scope) {
  return scope === "detect" ? "Detect" : "Clf";
}

function inboxJunkScope() {
  return inboxAssignTarget() === "detect" ? "detect" : "clf";
}

function inboxJunkLabelForFile(filename) {
  const clf = isInboxClfJunkFile(filename);
  const detect = isInboxDetectJunkFile(filename);
  if (clf && detect) return "Both junk";
  if (clf) return "Clf junk";
  if (detect) return "Detect junk";
  return "";
}

const INBOX_ASSIGN_BORDER_CLASSES = [
  "assign-border-both",
  "assign-border-both-reject",
  "assign-border-other"
];

function inboxMetadataSideState(filename) {
  const row = inboxState.metadataByFile.get(filename);
  const detectRejected = isInboxDetectJunkFile(filename);
  const clfRejected = isInboxClfJunkFile(filename);
  const detectInUse = Boolean(
    row && (row.detect_enabled === "1" || row.detect_enabled === true) && !detectRejected
  );
  const clfClass = String(row?.clf_class || "").trim();
  const clfInUse = Boolean(
    row
    && (row.clf_enabled === "1" || row.clf_enabled === true)
    && clfClass
    && clfClass !== INBOX_JUNK_CLASS
    && !clfRejected
  );
  return { detectRejected, clfRejected, detectInUse, clfInUse };
}

function inboxAssignVisualState(filename, scope) {
  const side = scope === "detect" ? "detect" : "clf";
  const { detectRejected, clfRejected, detectInUse, clfInUse } = inboxMetadataSideState(filename);
  const currentRejected = side === "detect" ? detectRejected : clfRejected;
  const currentInUse = side === "detect" ? detectInUse : clfInUse;
  const otherInUse = side === "detect" ? clfInUse : detectInUse;

  let border = "";
  if (detectInUse && clfInUse) border = "assign-border-both";
  else if (detectRejected && clfRejected) border = "assign-border-both-reject";
  else if (otherInUse) border = "assign-border-other";

  let overlay = null;
  if (currentRejected && border !== "assign-border-both-reject") overlay = "junk";
  else if (currentInUse && !border) overlay = "active";

  return { border, overlay, currentInUse, currentRejected, detectInUse, clfInUse };
}

function inboxThumbMediaClasses(filename, scope) {
  const visual = inboxAssignVisualState(filename, scope);
  const parts = [];
  if (visual.border) parts.push(visual.border);
  if (visual.overlay === "junk") parts.push("assign-current-junk");
  return parts.join(" ");
}

function inboxAssignOverlayHtml(filename, scope) {
  const visual = inboxAssignVisualState(filename, scope);
  if (!visual.overlay) return "";
  const kind = visual.overlay === "junk" ? "is-junk" : "is-active";
  const symbol = visual.overlay === "junk" ? "✕" : "✓";
  return `<div class="inbox-assign-overlay ${kind}" aria-hidden="true">${symbol}</div>`;
}

function inboxThumbMediaBlock(filename, scope, imageHtml) {
  const mediaClasses = inboxThumbMediaClasses(filename, scope);
  return `<div class="inbox-thumb-media${mediaClasses ? ` ${mediaClasses}` : ""}">${imageHtml}${inboxAssignOverlayHtml(filename, scope)}</div>`;
}

function inboxAssignCardExtraClasses(filename, scope) {
  return inboxThumbMediaClasses(filename, scope);
}

function ensureInboxThumbMedia(card) {
  let media = card.querySelector(".inbox-thumb-media");
  if (media) return media;
  const img = card.querySelector(":scope > img");
  if (!img) return null;
  media = document.createElement("div");
  media.className = "inbox-thumb-media";
  card.insertBefore(media, img);
  media.appendChild(img);
  const overlay = card.querySelector(":scope > .inbox-assign-overlay");
  if (overlay) media.appendChild(overlay);
  return media;
}

function snapshotMetadataForFiles(filenames) {
  return filenames.map(filename => ({
    filename,
    row: inboxState.metadataByFile.has(filename)
      ? { ...inboxState.metadataByFile.get(filename) }
      : null
  }));
}

function metadataRowToUpdate(filename, row) {
  if (!row) {
    return {
      filename,
      clf_class: "",
      clf_enabled: false,
      detect_enabled: false,
      detect_junk: false
    };
  }
  return {
    filename,
    clf_class: row.clf_class || "",
    clf_enabled: row.clf_enabled === "1" || row.clf_enabled === true,
    detect_enabled: row.detect_enabled === "1" || row.detect_enabled === true,
    detect_junk: row.detect_junk === "1" || row.detect_junk === true
  };
}

function pushJunkUndo(filenames, options = {}) {
  if (options.skipUndo) return;
  junkActionState.undoStack.push(snapshotMetadataForFiles(filenames));
  if (junkActionState.undoStack.length > 10) junkActionState.undoStack.shift();
  updateJunkUndoButtons();
}

function hasJunkUndo() {
  return junkActionState.undoStack.length > 0;
}

function updateJunkUndoButtons() {
  const canUndo = hasJunkUndo() && !inboxState.assigning;
  if (el.inboxUndoJunkBtn) el.inboxUndoJunkBtn.disabled = !canUndo;
  if (el.undoJunkBtn) el.undoJunkBtn.disabled = !canUndo;
  if (el.imagePoolUndoJunkBtn) el.imagePoolUndoJunkBtn.disabled = !canUndo || imagePoolState?.deleting;
}

function inboxClassTagForFile(filename) {
  const junkLabel = inboxJunkLabelForFile(filename);
  if (junkLabel) return junkLabel;
  const row = inboxState.metadataByFile.get(filename);
  if (!row) return "Unassigned";
  const detectOn = row.detect_enabled === "1" || row.detect_enabled === true;
  const clfOn = row.clf_enabled === "1" || row.clf_enabled === true;
  if (detectOn && clfOn && row.clf_class) return `detect + clf: ${row.clf_class}`;
  if (detectOn) return "detect";
  if (clfOn && row.clf_class) return `clf: ${row.clf_class}`;
  if (row.clf_class) return `clf: ${row.clf_class}`;
  return "Unassigned";
}

function inboxCardBadgesHtml(filename, poolMeta) {
  const pendingBuild = inboxState.pendingFilenames.has(filename);
  const isNew = poolMeta?.isNew;
  if (!isNew && !pendingBuild) return "";
  const parts = [];
  if (isNew) parts.push('<span class="image-pool-badge">NEW</span>');
  if (pendingBuild) parts.push('<span class="image-pool-badge pending-build">PENDING</span>');
  return `<div class="image-pool-badges">${parts.join("")}</div>`;
}

function syncInboxCardBadges(card, filename, poolMeta) {
  const pendingBuild = inboxState.pendingFilenames.has(filename);
  const isNew = poolMeta?.isNew;
  let badgesEl = card.querySelector(".image-pool-badges");
  if (!isNew && !pendingBuild) {
    badgesEl?.remove();
    return;
  }
  if (!badgesEl) {
    badgesEl = document.createElement("div");
    badgesEl.className = "image-pool-badges";
    card.insertBefore(badgesEl, card.querySelector("img"));
  }
  let newBadge = badgesEl.querySelector(".image-pool-badge:not(.pending-build)");
  let pendingBadge = badgesEl.querySelector(".image-pool-badge.pending-build");
  if (isNew && !newBadge) {
    newBadge = document.createElement("span");
    newBadge.className = "image-pool-badge";
    newBadge.textContent = "NEW";
    badgesEl.insertBefore(newBadge, badgesEl.firstChild);
  } else if (!isNew && newBadge) {
    newBadge.remove();
  }
  if (pendingBuild && !pendingBadge) {
    pendingBadge = document.createElement("span");
    pendingBadge.className = "image-pool-badge pending-build";
    pendingBadge.textContent = "PENDING";
    badgesEl.appendChild(pendingBadge);
  } else if (!pendingBuild && pendingBadge) {
    pendingBadge.remove();
  }
}

function syncInboxCardAssignVisual(card, filename, scope) {
  const resolvedScope = scope || inboxJunkScope();
  const visual = inboxAssignVisualState(filename, resolvedScope);
  const media = ensureInboxThumbMedia(card);
  if (!media) return;

  card.classList.remove("inbox-junk", ...INBOX_ASSIGN_BORDER_CLASSES, "assign-current-junk", "assign-current-active");
  media.classList.remove(...INBOX_ASSIGN_BORDER_CLASSES, "assign-current-junk");
  if (visual.border) media.classList.add(visual.border);
  if (visual.overlay === "junk") media.classList.add("assign-current-junk");

  card.querySelector(".inbox-junk-overlay")?.remove();
  let overlay = media.querySelector(".inbox-assign-overlay");
  if (visual.overlay) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      media.appendChild(overlay);
    }
    overlay.className = `inbox-assign-overlay ${visual.overlay === "junk" ? "is-junk" : "is-active"}`;
    overlay.textContent = visual.overlay === "junk" ? "✕" : "✓";
  } else if (overlay) {
    overlay.remove();
  }
}

function syncInboxCardJunkOverlay(card, filename, scope) {
  syncInboxCardAssignVisual(card, filename, scope);
}

function patchInboxCard(index, card) {
  const pair = inboxState.pairs[index];
  if (!pair || !card) return;
  const filename = pair.imagePath.split("/").pop();
  const poolMeta = imagePoolState.metaByFile.get(filename);
  card.classList.toggle("selected", inboxState.selected.has(filename));
  const metaEl = card.querySelector(".inbox-meta-tag");
  if (metaEl) metaEl.textContent = inboxClassTagForFile(filename);
  syncInboxCardBadges(card, filename, poolMeta);
  syncInboxCardAssignVisual(card, filename, inboxJunkScope());
}

function onInboxCardClick(event, index, pair) {
  const filename = pair.imagePath.split("/").pop();
  if (event.shiftKey) {
    const anchor = inboxState.anchorIndex ?? index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    for (let i = start; i <= end; i++) {
      inboxState.selected.add(inboxState.pairs[i].imagePath.split("/").pop());
    }
    renderInboxGrid({ selectionOnly: true });
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (inboxState.selected.has(filename)) inboxState.selected.delete(filename);
    else inboxState.selected.add(filename);
    inboxState.anchorIndex = index;
    renderInboxGrid({ selectionOnly: true });
    return;
  }
  inboxState.anchorIndex = index;
  inboxState.selected.clear();
  inboxState.selected.add(filename);
  renderInboxGrid({ selectionOnly: true });
}

function renderInboxGrid(options = {}) {
  const { selectionOnly = false } = options;
  if (!el.inboxGrid) return;
  ensureInboxThumbObserver();
  updateInboxTabBadge();
  updateInboxSelectionCount();

  if (!state.workspaceRoot) {
    el.inboxGrid.style.height = "";
    el.inboxGrid.replaceChildren();
    el.inboxGrid.appendChild(Object.assign(document.createElement("div"), {
      className: "empty",
      textContent: "Open a workspace containing image_pool, then assign NEW images."
    }));
    renderInboxStats();
    return;
  }

  if (inboxState.pairsCacheKey !== inboxPairsCacheKey()) {
    rebuildInboxPairs();
  }

  if (selectionOnly) {
    const windowEl = el.inboxGrid.querySelector(":scope > .gallery-window");
    if (windowEl) {
      for (let i = 0; i < windowEl.children.length; i++) {
        patchInboxCard(inboxVirtual.startIndex + i, windowEl.children[i]);
      }
      updateInboxSelectionCount();
      renderInboxStats();
      return;
    }
  }

  if (!inboxState.pairs.length) {
    el.inboxGrid.style.height = "";
    el.inboxGrid.replaceChildren();
    el.inboxGrid.appendChild(Object.assign(document.createElement("div"), {
      className: "empty",
      textContent: inboxState.filter === "new"
        ? "No NEW images."
        : inboxState.filter === "random-unused"
          ? "No unused images found for random sample."
          : "No images match the current filter."
    }));
    renderInboxStats();
    return;
  }

  const layout = computeVirtualGalleryLayout({
    scrollEl: el.inboxGridWrap,
    itemCount: inboxState.pairs.length,
    columnUnit: 148,
    rowExtra: 58,
    aspectRatio: 1
  });

  renderVirtualGallery({
    galleryEl: el.inboxGrid,
    virtual: inboxVirtual,
    itemCount: inboxState.pairs.length,
    layout,
    thumbObserver: inboxThumbObserver,
    renderCard(index, windowEl) {
      const pair = inboxState.pairs[index];
      const filename = pair.imagePath.split("/").pop();
      const poolMeta = imagePoolState.metaByFile.get(filename);
      const selected = inboxState.selected.has(filename);
      const classTag = inboxClassTagForFile(filename);
      const assignScope = inboxJunkScope();
      const card = document.createElement("article");
      card.className = `thumb image-pool-entry inbox-entry${selected ? " selected" : ""}`;
      const imageHtml = `<img data-path="${escapeHtml(pair.imagePath)}" data-src-pending="true" alt="${escapeHtml(filename)}">`;
      card.innerHTML = `
        ${inboxCardBadgesHtml(filename, poolMeta)}
        ${inboxThumbMediaBlock(filename, assignScope, imageHtml)}
        <div class="name">${escapeHtml(filename)}<div class="inbox-meta-tag">${escapeHtml(classTag)}</div></div>
      `;
      bindImagePreviewLightbox(card, {
        onClick: event => onInboxCardClick(event, index, pair),
        getContext: () => buildInboxPreviewContext(index, pair)
      });
      windowEl.appendChild(card);
      return card;
    },
    patchCard: patchInboxCard
  });

  renderInboxStats();
}

async function syncInboxAfterWorkspaceBind(options = {}) {
  const { skipScan = false, force = false } = options;
  if (!state.workspaceRoot) {
    renderInboxGrid();
    renderInboxClassPicker();
    return;
  }
  if (!skipScan && typeof scanImagePool === "function") {
    await scanImagePool({ silent: true, force, fast: !force });
  }
  await loadInboxClassesOnly();
  if (force || inboxState.workflow == null) {
    await loadInboxWorkflow();
  } else {
    updateInboxWorkflowSummary();
    applyInboxWorkflowUi();
  }
  inboxState.metadataLoaded = false;
  await ensureInboxMetadataIndex({ force: true });
  rebuildInboxPairs();
  updateInboxTabBadge();
  renderInboxGrid();
  updateInboxSelectionCount();
}

async function refreshInboxView(options = {}) {
  const { silent = false, force = false, skipScan = false, preferCache = false } = options;
  if (!state.workspaceRoot) {
    renderInboxGrid();
    renderInboxClassPicker();
    return;
  }
  if (preferCache && !force && inboxState.metadataLoaded && imagePoolState.summary) {
    rebuildInboxPairs();
    renderInboxGrid();
    renderInboxClassPicker();
    updateInboxWorkflowSummary();
    applyInboxWorkflowUi();
    return;
  }
  if (!await ensurePythonBackend()) {
    if (!silent) alert("Python backend is required.");
    return;
  }
  inboxState.loading = true;
  try {
    await syncInboxAfterWorkspaceBind({ skipScan, force });
    if (!silent) setStatus("Assign list refreshed.");
  } catch (error) {
    const message = error?.message || String(error);
    setInboxLog(`Assign load failed: ${message}`);
    console.warn("refreshInboxView:", error);
    renderInboxClassPicker();
    renderInboxGrid();
  } finally {
    inboxState.loading = false;
  }
}

function inboxSelectAllVisible() {
  for (const pair of inboxState.pairs) {
    inboxState.selected.add(pair.imagePath.split("/").pop());
  }
  renderInboxGrid();
}

function inboxClearSelection() {
  inboxState.selected.clear();
  inboxState.anchorIndex = null;
  renderInboxGrid();
}

function inboxSelectedFilenames() {
  return [...inboxState.selected];
}

function buildInboxPreviewContext(index, pair) {
  const filename = pair.imagePath.split("/").pop();
  const useSubset = inboxState.selected.size > 1 && inboxState.selected.has(filename);
  const pairs = useSubset
    ? inboxState.pairs.filter(item => inboxState.selected.has(item.imagePath.split("/").pop()))
    : inboxState.pairs;
  const previewIndex = useSubset
    ? pairs.findIndex(item => item.imagePath === pair.imagePath)
    : index;
  return {
    imagePath: pair.imagePath,
    imageHandle: pair.imageHandle,
    pairs,
    index: previewIndex,
    previewContext: "inbox",
    showFilmstrip: useSubset && pairs.length > 1
  };
}

async function applyInboxAssignment(options = {}) {
  if (!state.workspaceRoot) {
    alert("Open a workspace first.");
    return null;
  }
  const filenames = options.filenames || inboxSelectedFilenames();
  if (!filenames.length) {
    alert("Select images first.");
    return null;
  }
  const { detectEnabled, clfEnabled } = inboxAssignSettings();
  let clfClass = options.clfClass != null
    ? String(options.clfClass).trim()
    : String(inboxState.selectedClass || "").trim();
  const newClass = options.clfClass == null
    ? String(el.inboxNewClassInput?.value || "").trim()
    : "";
  if (newClass) clfClass = newClass;
  if (!validateInboxAssignSettings(clfClass)) return null;

  const updates = filenames.map(filename => {
    const update = {
      filename,
      detect_enabled: detectEnabled,
      clf_enabled: clfEnabled
    };
    if (clfEnabled) {
      update.clf_class = clfClass;
    }
    return update;
  });
  if (!options.quiet) {
    setInboxLog(`Writing metadata for ${filenames.length} image(s)...`);
  }
  const raw = await backendCall("upsertMetadataRows", inboxWorkspaceRoot(), JSON.stringify(updates));
  const result = JSON.parse(raw || "{}");
  if (!result.ok) throw new Error("Failed to write metadata.");
  if (newClass && !inboxState.classes.includes(newClass)) {
    inboxState.classes.push(newClass);
    inboxState.selectedClass = newClass;
    renderInboxClassPicker();
    el.inboxNewClassInput.value = "";
  } else if (options.clfClass != null) {
    inboxState.selectedClass = clfClass;
  }
  inboxState.metadataLoaded = false;
  await ensureInboxMetadataIndex();
  rebuildInboxPairs();
  invalidateVirtualGallery(inboxVirtual);
  if (!options.skipGridRender) renderInboxGrid();
  if (!options.skipWorkflowRecord && clfClass && clfClass !== INBOX_JUNK_CLASS) {
    await recordInboxAssignBatch({ filenames, clfClass });
  }
  if (!options.quiet) {
    setInboxLog(`Metadata updated: created ${result.created || 0}, updated ${result.updated || 0}.`);
    setStatus(`Wrote metadata for ${filenames.length} image(s).`);
  }
  return { filenames, clfClass, result };
}

function showBuildProgressOverlay() {
  if (el.buildProgressOverlay) el.buildProgressOverlay.hidden = false;
}

function hideBuildProgressOverlay() {
  if (el.buildProgressOverlay) el.buildProgressOverlay.hidden = true;
}

function setBuildProgress(value, total, detail) {
  if (el.buildProgress) {
    el.buildProgress.max = Math.max(1, total || 1);
    el.buildProgress.value = Math.max(0, Math.min(value || 0, el.buildProgress.max));
  }
  if (el.buildProgressText) {
    el.buildProgressText.textContent = `${value || 0} / ${total || 0}`;
  }
  if (el.buildProgressDetail) el.buildProgressDetail.textContent = detail || "";
}

function inboxBuildSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBuildYoloLinksJob(workspaceRoot, rebuild, filenamesJson) {
  let state = JSON.parse(await backendCall("startBuildYoloLinks", workspaceRoot, rebuild, filenamesJson));
  showBuildProgressOverlay();
  setBuildProgress(0, state.total || 1, state.detail || "Preparing build...");
  try {
    while (!["done", "error"].includes(state.status)) {
      setBuildProgress(state.done || 0, state.total || 1, state.detail || "Building...");
      await inboxBuildSleep(200);
      state = JSON.parse(await backendCall("getBuildJob", state.id));
    }
    setBuildProgress(state.done || 0, state.total || 1, state.detail || "");
    if (state.status === "error") {
      throw new Error((state.errors || []).join("\n") || state.detail || "Build failed");
    }
    return state.result || {};
  } finally {
    hideBuildProgressOverlay();
  }
}

async function buildInboxLinks(options = {}) {
  if (!state.workspaceRoot) {
    alert("Open a workspace first.");
    return null;
  }
  if (!await ensurePythonBackend()) {
    alert("Python backend is required.");
    return null;
  }
  const scope = options.scope === "pending" ? "pending" : "all";
  const rebuild = Boolean(el.inboxRebuildInput?.checked);
  const pendingFilenames = scope === "pending" ? inboxPendingFilenames() : [];
  if (scope === "pending" && !pendingFilenames.length) {
    if (!options.quiet) setInboxLog("There are no pending assignment batches.");
    return null;
  }
  const filenamesJson = scope === "pending" ? JSON.stringify(pendingFilenames) : "";
  const batchIds = scope === "pending" ? inboxPendingBatchIds() : [];
  inboxState.assigning = true;
  updateInboxSelectionCount();
  let result;
  try {
    if (!options.quiet) {
      const scopeText = scope === "pending"
        ? `${pendingFilenames.length} pending image(s)`
        : "all metadata";
      setInboxLog(rebuild ? `Rebuilding (${scopeText})...` : `Building hard links (${scopeText})...`);
    }
    result = await runBuildYoloLinksJob(inboxWorkspaceRoot(), rebuild, filenamesJson);
  await recordInboxBuildRun({
    scope,
    rebuild,
    result,
    filenames: result.builtFilenames || pendingFilenames,
    batchIds,
    markAll: scope === "all"
  });
  if (!options.quiet) {
    if (result.errors?.length) {
      setInboxLog(`Build completed with errors:\n${result.errors.join("\n")}`);
    } else {
      setInboxLog(
        `Build complete: detect ${result.detectImagesLinked || 0}, clf ${result.clfImagesLinked || 0}, labels ${result.labelsPlaced || 0}.`
      );
    }
    setStatus(scope === "pending" ? "Pending batch built." : "All metadata built.");
  }
  await scanImagePool({ silent: true, force: true });
  if (typeof reloadActiveYoloDatasetView === "function") {
    await reloadActiveYoloDatasetView({ silent: true }).catch(error => console.warn("YOLO dataset reload after build:", error));
  }
  if (!options.skipGridRender) renderInboxGrid();
  return result;
  } finally {
    inboxState.assigning = false;
    updateInboxSelectionCount();
  }
}

async function applyJunkMetadataUpdates(updates, options = {}) {
  const {
    clearSelection = true,
    skipGridRender = false,
    quiet = false,
    scopeLabel = "",
    verifyJunk,
    verifyNotJunk,
    actionLabel = "Update junk",
    successLog = "",
    successStatus = ""
  } = options;
  const names = [...new Set(updates.map(item => item.filename).filter(Boolean))];
  if (!names.length) return null;
  if (!state.workspaceRoot) {
    alert("Open a workspace first.");
    return null;
  }
  if (!await ensurePythonBackend()) {
    alert("Python backend is required.");
    return null;
  }
  inboxState.assigning = true;
  updateInboxSelectionCount();
  if (typeof updateImagePoolJunkSelectionUI === "function") updateImagePoolJunkSelectionUI();
  try {
    if (!quiet) setInboxLog(`${actionLabel}: ${names.length} image(s)...`);
    const raw = await backendCall("upsertMetadataRows", inboxWorkspaceRoot(), JSON.stringify(updates));
    const result = JSON.parse(raw || "{}");
    if (!result.ok) throw new Error("Failed to write metadata.");
    inboxState.metadataLoaded = false;
    const loaded = await ensureInboxMetadataIndex({ force: true });
    if (!loaded) throw new Error("Junk state was written, but metadata reload failed. Refresh the workspace and check again.");
    if (typeof verifyJunk === "function") {
      const failed = names.filter(name => !verifyJunk(name));
      if (failed.length) {
        throw new Error(`Failed to save${scopeLabel ? ` ${scopeLabel}` : ""} junk marks for: ${failed.join(", ")}`);
      }
    }
    if (typeof verifyNotJunk === "function") {
      const failed = names.filter(name => !verifyNotJunk(name));
      if (failed.length) {
        throw new Error(`Failed to clear${scopeLabel ? ` ${scopeLabel}` : ""} junk for: ${failed.join(", ")}`);
      }
    }
    rebuildInboxPairs();
    invalidateVirtualGallery(inboxVirtual);
    if (clearSelection) {
      inboxState.selected.clear();
      inboxState.anchorIndex = null;
    }
    updateInboxSelectionCount();
    if (!skipGridRender) renderInboxGrid();
    if (typeof refreshImagePoolAfterJunkChange === "function") {
      refreshImagePoolAfterJunkChange({ selectionOnly: skipGridRender });
    }
    if (!quiet) {
      if (successLog) setInboxLog(successLog);
      if (successStatus) setStatus(successStatus);
    }
    return { ...result, filenames: names };
  } finally {
    inboxState.assigning = false;
    updateInboxSelectionCount();
    if (typeof updateImagePoolJunkSelectionUI === "function") updateImagePoolJunkSelectionUI();
    renderInboxClassPicker();
  }
}

async function markInboxJunkFilenames(filenames, options = {}) {
  const {
    clearSelection = true,
    skipGridRender = false,
    quiet = false,
    scope = "clf",
    skipUndo = false
  } = options;
  const junkScope = scope === "detect" ? "detect" : "clf";
  const scopeLabel = inboxJunkScopeLabel(junkScope);
  const names = [...new Set((filenames || []).map(name => String(name || "").trim()).filter(Boolean))];
  const pending = names.filter(name => !isInboxJunkFile(name, junkScope));
  if (!pending.length) {
    if (!quiet) setInboxLog(`Selected images are already ${scopeLabel} junk.`);
    return null;
  }
  pushJunkUndo(pending, { skipUndo });
  const updates = pending.map(filename => (
    junkScope === "detect"
      ? { filename, detect_junk: true, detect_enabled: false }
      : { filename, clf_enabled: false, clf_class: INBOX_JUNK_CLASS }
  ));
  return applyJunkMetadataUpdates(updates, {
    clearSelection,
    skipGridRender,
    quiet,
    scopeLabel,
    verifyJunk: name => isInboxJunkFile(name, junkScope),
    actionLabel: `Mark ${scopeLabel} junk`,
    successLog: `Marked ${pending.length} image(s) as ${scopeLabel} junk.\nmetadata.csv was updated; this side will not be built.`,
    successStatus: `Marked ${pending.length} image(s) as ${scopeLabel} junk.`
  });
}

async function unmarkInboxJunkFilenames(filenames, options = {}) {
  const {
    clearSelection = true,
    skipGridRender = false,
    quiet = false,
    scope = "clf",
    skipUndo = false
  } = options;
  const junkScope = scope === "detect" ? "detect" : "clf";
  const scopeLabel = inboxJunkScopeLabel(junkScope);
  const names = [...new Set((filenames || []).map(name => String(name || "").trim()).filter(Boolean))];
  const junked = names.filter(name => isInboxJunkFile(name, junkScope));
  if (!junked.length) {
    if (!quiet) setInboxLog(`Selected images are not ${scopeLabel} junk.`);
    return null;
  }
  pushJunkUndo(junked, { skipUndo });
  const updates = junked.map(filename => (
    junkScope === "detect"
      ? { filename, detect_junk: false }
      : { filename, clf_class: "", clf_enabled: false }
  ));
  return applyJunkMetadataUpdates(updates, {
    clearSelection,
    skipGridRender,
    quiet,
    scopeLabel,
    verifyNotJunk: name => !isInboxJunkFile(name, junkScope),
    actionLabel: `Clear ${scopeLabel} junk`,
    successLog: `Cleared ${scopeLabel} junk from ${junked.length} image(s).`,
    successStatus: `Cleared ${scopeLabel} junk from ${junked.length} image(s).`
  });
}

async function undoLastJunkAction(options = {}) {
  const { quiet = false, skipGridRender = false } = options;
  const snapshots = junkActionState.undoStack.pop();
  updateJunkUndoButtons();
  if (!snapshots?.length) {
    if (!quiet) setInboxLog("No junk action to undo.");
    return null;
  }
  const updates = snapshots.map(({ filename, row }) => metadataRowToUpdate(filename, row));
  return applyJunkMetadataUpdates(updates, {
    clearSelection: false,
    skipGridRender,
    quiet,
    actionLabel: "Undo junk",
    successLog: "Undid the last junk action.",
    successStatus: "Undid the junk action."
  });
}

async function markInboxJunkSelected() {
  await markInboxJunkFilenames(inboxSelectedFilenames(), {
    clearSelection: true,
    scope: inboxJunkScope()
  });
}

async function quickAssignInboxDetect() {
  if (inboxAssignTarget() !== "detect") {
    setInboxLog("Current target is not Detect.");
    return;
  }
  const filenames = inboxSelectedFilenames();
  if (!filenames.length) {
    setInboxLog("Select images before marking Detect.");
    return;
  }
  inboxState.assigning = true;
  renderInboxClassPicker();
  try {
    await applyInboxAssignment({ filenames, quiet: true });
    setInboxLog(`Marked ${filenames.length} image(s) as Detect (detect_enabled=1).`);
    setStatus(`Wrote Detect metadata for ${filenames.length} image(s).`);
  } finally {
    inboxState.assigning = false;
    renderInboxClassPicker();
  }
}

async function quickAssignInboxClass(className) {
  const filenames = inboxSelectedFilenames();
  if (!filenames.length) {
    setInboxLog("Select images before clicking a class chip.");
    return;
  }
  if (!state.workspaceRoot) {
    alert("Open a workspace first.");
    return;
  }
  if (!await ensurePythonBackend()) {
    alert("Python backend is required.");
    return;
  }
  const clfClass = String(className || "").trim();
  if (!validateInboxAssignSettings(clfClass)) return;

  inboxState.assigning = true;
  renderInboxClassPicker();
  try {
    setInboxLog(`Writing metadata: ${filenames.length} image(s) -> ${clfClass}...`);
    const assignResult = await applyInboxAssignment({
      filenames,
      clfClass,
      quiet: true,
      skipGridRender: true,
      skipWorkflowRecord: false
    });
    if (!assignResult) return;
    inboxState.selected.clear();
    inboxState.anchorIndex = null;
    updateInboxWorkflowSummary();
    renderInboxGrid();
    setInboxLog(
      `Assigned ${filenames.length} image(s) -> ${clfClass} (metadata created ${assignResult.result.created || 0}, updated ${assignResult.result.updated || 0}).\nRecorded in session.json. Build Pending or Build All when ready.`
    );
    setStatus(`Wrote metadata for ${filenames.length} image(s) (${clfClass}).`);
  } finally {
    inboxState.assigning = false;
    renderInboxClassPicker();
  }
}

function resetInboxState() {
  inboxState.selected.clear();
  inboxState.metadataByFile = new Map();
  inboxState.randomUnusedFilenames = new Set();
  inboxState.randomUnusedNonce = 0;
  inboxState.randomUnusedCandidateCount = 0;
  inboxState.classes = [];
  inboxState.clfDatasetPath = "";
  inboxState.detectClasses = [];
  inboxState.detectDatasetPath = "";
  inboxState.classSearch = "";
  inboxState.detectClassSearch = "";
  inboxState.selectedClass = "";
  inboxState.selectedDetectClassId = null;
  inboxState.pairs = [];
  inboxState.pairsCacheKey = "";
  inboxState.metadataLoaded = false;
  inboxState.metadataRevision = 0;
  inboxState.anchorIndex = null;
  inboxState.workflow = null;
  inboxState.pendingFilenames = new Set();
  if (el.inboxClassSearchInput) el.inboxClassSearchInput.value = "";
  if (el.inboxDetectClassSearchInput) el.inboxDetectClassSearchInput.value = "";
  updateInboxAssignTargetUi();
  updateInboxWorkflowSummary();
}

function bindInboxEvents() {
  updateInboxAssignTargetUi();
  el.inboxTabBtn?.addEventListener("click", () => switchTab("inbox"));
  el.inboxOpenFolderBtn?.addEventListener("click", () => openImagePoolFolderFlow().catch(showError));
  el.inboxRefreshBtn?.addEventListener("click", () => refreshInboxView({ force: true }).catch(showError));
  el.inboxSelectAllBtn?.addEventListener("click", inboxSelectAllVisible);
  el.inboxClearSelectionBtn?.addEventListener("click", inboxClearSelection);
  el.inboxMarkJunkBtn?.addEventListener("click", () => markInboxJunkSelected().catch(showError));
  el.inboxFilterNewBtn?.addEventListener("click", () => setInboxFilter("new"));
  el.inboxFilterUnassignedBtn?.addEventListener("click", () => setInboxFilter("unassigned"));
  el.inboxFilterRandomUnusedBtn?.addEventListener("click", () => setInboxFilter("random-unused"));
  el.inboxFilterAllBtn?.addEventListener("click", () => setInboxFilter("all"));
  el.inboxApplyAssignBtn?.addEventListener("click", () => applyInboxAssignment().catch(showError));
  el.inboxBuildPendingBtn?.addEventListener("click", () => buildInboxLinks({ scope: "pending" }).catch(showError));
  el.inboxBuildLinksBtn?.addEventListener("click", () => buildInboxLinks({ scope: "all" }).catch(showError));
  el.inboxTargetDetectBtn?.addEventListener("click", () => setInboxAssignTarget("detect"));
  el.inboxTargetClfBtn?.addEventListener("click", () => setInboxAssignTarget("clf"));
  if (el.inboxGridWrap) {
    bindGalleryScroll(el.inboxGridWrap, () => renderInboxGrid());
    bindGalleryResize(el.inboxGridWrap, inboxVirtual, () => renderInboxGrid());
  }
  el.inboxClassSearchInput?.addEventListener("input", () => {
    inboxState.classSearch = el.inboxClassSearchInput.value || "";
    renderInboxClfClassPicker();
  });
  el.inboxDetectClassSearchInput?.addEventListener("input", () => {
    inboxState.detectClassSearch = el.inboxDetectClassSearchInput.value || "";
    renderInboxDetectClassPicker();
  });
}

function previewJunkScope() {
  const ctx = typeof imagePreviewLightboxState !== "undefined"
    ? imagePreviewLightboxState.previewContext
    : "";
  if (ctx === "yolo" && typeof yoloJunkScope === "function") return yoloJunkScope();
  if (ctx === "inbox") return inboxJunkScope();
  if (ctx === "image-pool" && typeof imagePoolJunkScope === "function") return imagePoolJunkScope();
  return "clf";
}

window.resetInboxState = resetInboxState;
window.refreshInboxView = refreshInboxView;
window.updateInboxTabBadge = updateInboxTabBadge;
window.renderInboxGrid = renderInboxGrid;
window.loadInboxClassesOnly = loadInboxClassesOnly;
window.loadInboxWorkflow = loadInboxWorkflow;
window.syncInboxAfterWorkspaceBind = syncInboxAfterWorkspaceBind;
window.syncInboxCardJunkOverlay = syncInboxCardJunkOverlay;
window.syncInboxCardAssignVisual = syncInboxCardAssignVisual;
window.inboxAssignCardExtraClasses = inboxAssignCardExtraClasses;
window.inboxThumbMediaBlock = inboxThumbMediaBlock;
window.inboxThumbMediaClasses = inboxThumbMediaClasses;
window.inboxAssignOverlayHtml = inboxAssignOverlayHtml;
window.inboxJunkLabelForFile = inboxJunkLabelForFile;
window.reloadInboxMetadataIndex = reloadInboxMetadataIndex;
window.markInboxJunkFilenames = markInboxJunkFilenames;
window.unmarkInboxJunkFilenames = unmarkInboxJunkFilenames;
window.undoLastJunkAction = undoLastJunkAction;
window.isInboxJunkFile = isInboxJunkFile;
window.inboxJunkScope = inboxJunkScope;
window.previewJunkScope = previewJunkScope;
window.inboxClassTagForFile = inboxClassTagForFile;
