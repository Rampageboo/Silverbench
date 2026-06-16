const yoloViewModeState = {
  mode: null,
  workspaceInfo: null,
  switching: false
};

function updateYoloViewModesVisibility() {
  const controls = el.yoloModeControls;
  if (!controls) return;
  controls.hidden = !Boolean(state.workspaceRoot);
}

function setYoloViewModeButtons(mode) {
  for (const button of el.yoloViewModes?.querySelectorAll("[data-yolo-mode]") || []) {
    button.classList.toggle("active", Boolean(mode) && button.dataset.yoloMode === mode);
  }
}

async function loadYoloViewWorkspaceInfo() {
  if (!state.workspaceRoot || !await ensurePythonBackend()) {
    yoloViewModeState.workspaceInfo = null;
    return null;
  }
  const raw = await backendCall("getWorkspaceInfo", state.workspaceRoot);
  const info = JSON.parse(raw || "{}");
  yoloViewModeState.workspaceInfo = info?.ok ? info : null;
  return yoloViewModeState.workspaceInfo;
}

async function ensureYoloDatasetViewLoaded(options = {}) {
  if (!state.workspaceRoot || !await ensurePythonBackend()) return;
  if (hasDatasetOpen() && state.yoloSource === "dataset") return;
  const mode = yoloViewModeState.mode === "clf" ? "clf" : "detect";
  await switchYoloViewMode(mode, { silent: true, ...options });
}

async function reloadActiveYoloDatasetView(options = {}) {
  const { silent = false } = options;
  if (!state.workspaceRoot || !await ensurePythonBackend()) return;
  const mode = yoloViewModeState.mode === "clf" ? "clf" : "detect";
  await switchYoloViewMode(mode, { silent, force: true });
}

async function switchYoloViewMode(mode, options = {}) {
  const { silent = false } = options;
  if (!state.workspaceRoot) {
    alert("请先打开工作区。");
    return;
  }
  if (yoloViewModeState.switching) return;
  if (mode !== "detect" && mode !== "clf") {
    throw new Error(`未知 YOLO 视图模式：${mode}`);
  }
  if (mode === yoloViewModeState.mode && state.yoloSource === "dataset" && hasDatasetOpen() && !options.force) return;

  yoloViewModeState.switching = true;
  try {
    const info = yoloViewModeState.workspaceInfo || await loadYoloViewWorkspaceInfo();
    if (!info?.ok) throw new Error("无法读取工作区信息。");

    if (mode === "detect") {
      await loadFromBackendDatasetPath(info.detectDataset, null, { restoreSession: false });
      state.yoloSource = "dataset";
      state.workspaceRoot = info.root;
      yoloViewModeState.mode = "detect";
      if (!silent) setStatus(`Detect 数据集：${info.name}`);
    } else {
      await loadFromBackendDatasetPath(info.clfDataset, null, { restoreSession: false });
      state.yoloSource = "dataset";
      state.workspaceRoot = info.root;
      yoloViewModeState.mode = "clf";
      if (!silent) setStatus(`Clf 数据集：${info.name}`);
    }

    setYoloViewModeButtons(mode);
    updateYoloViewModesVisibility();
    switchTab("yolo");
  } catch (error) {
    showError(error);
  } finally {
    yoloViewModeState.switching = false;
  }
}

function resetYoloViewModes() {
  yoloViewModeState.mode = null;
  yoloViewModeState.workspaceInfo = null;
  setYoloViewModeButtons(null);
  updateYoloViewModesVisibility();
}

function bindYoloViewModeEvents() {
  for (const button of el.yoloViewModes?.querySelectorAll("[data-yolo-mode]") || []) {
    button.addEventListener("click", () => {
      switchYoloViewMode(button.dataset.yoloMode).catch(showError);
    });
  }
}

window.resetYoloViewModes = resetYoloViewModes;
window.updateYoloViewModesVisibility = updateYoloViewModesVisibility;
window.loadYoloViewWorkspaceInfo = loadYoloViewWorkspaceInfo;
window.ensureYoloDatasetViewLoaded = ensureYoloDatasetViewLoaded;
window.reloadActiveYoloDatasetView = reloadActiveYoloDatasetView;
