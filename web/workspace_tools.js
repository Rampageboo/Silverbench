async function readAppSettingsData() {
  if (!await ensurePythonBackend()) return {};
  try {
    return JSON.parse(await backendCall("readAppSettings") || "{}");
  } catch {
    return {};
  }
}

async function writeAppSettingsPatch(patch) {
  if (!await ensurePythonBackend()) return;
  const current = await readAppSettingsData();
  try {
    await backendCall("writeAppSettings", JSON.stringify({ ...current, ...patch }));
  } catch (error) {
    console.warn("Failed to save app settings:", error);
  }
}

async function rememberLastOpenedWorkspace(workspacePath) {
  if (!workspacePath) return;
  await writeAppSettingsPatch({ lastOpenedWorkspace: workspacePath });
}

async function rememberLastOpenedYoloFolder(folderPath) {
  if (!folderPath) return;
  await writeAppSettingsPatch({ lastOpenedYoloFolder: folderPath });
}

async function restoreLastOpenedFolderOnStartup() {
  if (!await ensurePythonBackend()) return;
  try {
    const settings = await readAppSettingsData();
    const savedPath = String(
      settings.lastOpenedWorkspace || settings.lastOpenedFolder || settings.lastWorkspace || ""
    ).trim();
    if (!savedPath) return;

    // openFolder registers the path in this app session (required before getWorkspaceInfo).
    const raw = await backendCall("openFolder", savedPath, false);
    if (!raw?.trim()) return;
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return;
    }
    if (!result?.ok || result.kind !== "workspace") return;

    await bindWorkspaceToImagePool(result.root, { silent: true });
    const session = await readWorkspaceSessionData();
    applyAppSessionData(session);
    await restoreWorkspaceSessionTab(session);
    setStatus(`已恢复工作区：${result.root.split(/[\\/]/).pop()}`);
  } catch (error) {
    console.warn("Restore last folder skipped:", error);
  }
}

async function restoreWorkspaceSessionTab(session) {
  const tab = validSessionTab(session?.activeTab || "image-pool");
  switchTab(tab);
  if (tab === "pool-label" && typeof refreshYoloOrPoolLabelView === "function") {
    await refreshYoloOrPoolLabelView("pool-label", appShellTabSwitchSeq);
  }
}

async function openYoloFolderFlow() {
  if (!await ensurePythonBackend()) {
    alert("需要 Python 后端。请运行 yolo_label_viewer_web_app.py 或 yolo_label_viewer_server.py。");
    return;
  }
  const path = await backendCall("chooseDirectory", "打开文件夹");
  if (!path) return;
  await importBackendFolderPath(path, { target: "yolo" });
}

async function openImagePoolFolderFlow() {
  if (!await ensurePythonBackend()) {
    alert("需要 Python 后端。请运行 yolo_label_viewer_web_app.py 或 yolo_label_viewer_server.py。");
    return;
  }
  const path = await backendCall("chooseDirectory", "打开工作区");
  if (!path) return;
  await importBackendFolderPath(path, { target: "image-pool" });
}

window.importBackendFolderPath = async function importBackendFolderPath(path, options = {}) {
  const {
    restoreSession = true,
    silent = false,
    preferredPath = null,
    target = "yolo"
  } = options;
  if (!path) return;
  if (!await ensurePythonBackend()) throw new Error("Python backend is not available.");

  const raw = await backendCall("openFolder", path, true);
  const result = JSON.parse(raw || "{}");
  if (!result.ok) throw new Error("无法打开该文件夹。");

  if (result.kind === "workspace") {
    await bindWorkspaceToImagePool(result.root, { silent });
    if (!silent) {
      const initNote = result.initialized ? "（已自动创建工作区子目录）" : "";
      if (target === "yolo") {
        setStatus(`已绑定工作区到 Image Pool：${result.name}${initNote} | YOLO 视图未改变`);
      } else {
        setStatus(`已打开工作区：${result.name}${initNote}`);
      }
    }
    return;
  }

  if (result.kind === "dataset") {
    if (target === "image-pool") {
      alert("请选择含 image_pool 的工作区根目录，而不是 detect/clf 数据集文件夹。");
      return;
    }
    const parentWs = String(result.parentWorkspace || "").trim();
    if (parentWs) {
      await bindWorkspaceToImagePool(parentWs, { silent: true });
    }
    switchTab("yolo");
    await loadFromBackendDatasetPath(result.root, preferredPath, { restoreSession });
    await rememberLastOpenedYoloFolder(result.root);
    if (!silent) {
      const wsNote = parentWs
        ? ` | 工作区 ${parentWs.split(/[\\/]/).pop()} 已绑定 Image Pool`
        : "";
      setStatus(`已打开 YOLO 数据集：${result.name}${wsNote}`);
    }
    return;
  }

  throw new Error(`无法识别文件夹类型：${result.kind || "unknown"}`);
};

window.importBackendDatasetPath = async function importBackendDatasetPath(path) {
  try {
    await importBackendFolderPath(path, { target: "yolo" });
  } catch (error) {
    showError(error);
  }
};

window.importBackendWorkspacePath = async function importBackendWorkspacePath(path, options = {}) {
  try {
    await importBackendFolderPath(path, { ...options, target: "image-pool" });
  } catch (error) {
    showError(error);
  }
};

async function bindWorkspaceToImagePool(workspaceRoot, options = {}) {
  const { silent = false } = options;
  if (!await ensurePythonBackend()) throw new Error("Python backend is not available.");

  const info = JSON.parse(await backendCall("getWorkspaceInfo", workspaceRoot));
  if (!info?.ok) throw new Error("无效的工作区路径。");

  const workspaceChanged = state.workspaceRoot !== info.root;
  state.workspaceRoot = info.root;

  if (workspaceChanged && typeof resetImagePoolState === "function") {
    resetImagePoolState();
  }
  if (workspaceChanged && typeof resetInboxState === "function") {
    resetInboxState();
  }
  if (workspaceChanged && typeof resetYoloViewModes === "function") {
    resetYoloViewModes();
  }

  imagePoolState.files = new Map();
  imagePoolState.pairPaths = [];
  if (!silent) setStatus(`正在打开 ${info.name}…`);
  if (el.imagePoolStats) el.imagePoolStats.textContent = "正在加载 image_pool...";

  await rememberLastOpenedWorkspace(info.root);
  if (typeof syncScreenshotOutputWithWorkspace === "function") {
    await syncScreenshotOutputWithWorkspace(info.root, { workspaceChanged });
  }
  if (typeof syncMergeTargetWithWorkspace === "function") {
    await syncMergeTargetWithWorkspace(info.root, { workspaceChanged });
  }
  if (typeof syncTrainProjectWithWorkspace === "function") {
    await syncTrainProjectWithWorkspace(info.root, { workspaceChanged });
  }

  try {
    await scanImagePool({ silent: true, force: workspaceChanged, fast: true });
  } catch (error) {
    console.warn("Image pool scan during workspace bind:", error);
    if (!silent) setStatus(`工作区已打开，但 image_pool 扫描失败：${error?.message || error}`);
  }

  const onImagePool = el.app?.classList.contains("image-pool");
  updateImagePoolTabBadge();
  renderImagePoolStats();
  if (onImagePool) {
    renderImagePoolGrid();
  }

  if (typeof syncInboxAfterWorkspaceBind === "function") {
    try {
      await syncInboxAfterWorkspaceBind({ skipScan: true, force: workspaceChanged });
    } catch (error) {
      console.warn("Inbox sync during workspace bind:", error);
    }
  } else if (typeof reloadInboxMetadataIndex === "function") {
    reloadInboxMetadataIndex().catch(error => console.warn("Metadata reload during workspace bind:", error));
  }

  refreshImagePoolBackupHint().catch(() => {});
  if (typeof loadYoloViewWorkspaceInfo === "function") {
    loadYoloViewWorkspaceInfo().catch(() => {});
  }
  if (typeof updateYoloViewModesVisibility === "function") {
    updateYoloViewModesVisibility();
  }
  if (typeof updateInboxTabBadge === "function") {
    updateInboxTabBadge();
  }
  if (!silent) {
    const total = imagePoolState.summary?.total ?? info.imageCount;
    const newCount = imagePoolState.summary?.newCount ?? 0;
    setStatus(`${info.name} | image_pool ${total} 张，NEW ${newCount}`);
  }
}

async function loadYoloWorkspaceAnnotation(workspaceRoot, preferredPath = null, options = {}) {
  const { restoreSession = true, silent = false } = options;
  if (!await ensurePythonBackend()) throw new Error("Python backend is not available.");

  const info = JSON.parse(await backendCall("getWorkspaceInfo", workspaceRoot));
  if (!info?.ok) throw new Error("无效的工作区路径。");

  state.workspaceRoot = info.root;
  revokeUrls();
  bitmapCache.clear();
  Object.assign(state, {
    datasetHandle: null,
    workspaceRoot: info.root,
    yoloSource: "workspace",
    datasetBackendRoot: info.root,
    backupHandle: state.backupHandle,
    rootName: info.name,
    datasetTask: "detect",
    files: new Map(),
    allPairs: [],
    pairs: [],
    classNames: new Map(),
    labelCache: new Map(),
    classIndex: new Map(),
    imageClassSet: new Map(),
    imageClassBoxCounts: new Map(),
    classBoxCounts: new Map(),
    include: new Set(),
    exclude: new Set(),
    imageViewMode: "all",
    currentIndex: 0,
    currentImagePath: preferredPath,
    currentImage: null,
    displayRect: null,
    viewZoom: 1,
    viewPanX: 0,
    viewPanY: 0,
    viewPanDrag: null,
    selection: null,
    dragStart: null,
    boxDrag: null,
    pending: new Map(),
    labelEdits: new Map(),
    reviewedPaths: new Set(),
    flaggedPaths: new Set(),
    selectedBoxIndex: null,
    shiftSelectedPaths: new Set(),
    multiSelectAnchorIndex: null,
    blackRepeatTemplate: [],
    smartCropPreviewPlans: [],
    duplicateScan: null,
    urls: new Map()
  });
  classifierState.results.clear();

  if (!silent) setStatus(`正在加载 ${info.name} 标注视图...`);
  if (typeof ensureInboxMetadataIndex === "function") {
    await ensureInboxMetadataIndex();
  }
  const paths = JSON.parse(await backendCall("listWorkspaceFiles", info.root));
  for (const relPath of paths) state.files.set(relPath, backendFileHandle(info.root, relPath));
  state.classNames = await readClassNames();
  state.datasetTask = "detect";
  state.allPairs = findPairs();
  setStatus(`正在索引 ${info.name} 标签...`);
  await buildLabelIndex();
  if (restoreSession) await loadSessionFromDefault(preferredPath);
  buildFilterList();
  updateSelectedClassActions();
  applyFilter(false);
  renderGallery();
  if (el.galleryScroll) el.galleryScroll.scrollTop = state.galleryScrollTop || 0;
  renderGallery();
  if (state.pairs.length) {
    const resumePath = preferredPath || state.currentImagePath;
    const preferredIndex = resumePath
      ? state.pairs.findIndex(pair => pair.imagePath === resumePath)
      : -1;
    const nextIndex = preferredIndex >= 0 ? preferredIndex : 0;
    await selectIndex(nextIndex);
    if (typeof scrollGalleryNearIndex === "function") scrollGalleryNearIndex(nextIndex);
  } else {
    clearPreview();
  }
  updateStatus();
  if (typeof syncTrainProjectWithWorkspace === "function") {
    await syncTrainProjectWithWorkspace(info.root, { workspaceChanged: false });
  }
  updateTrainPrepStatus();
  updateCropDatasetStatus();
  refreshImagePoolBackupHint().catch(() => {});
}
