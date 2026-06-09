let appShellTabSwitchSeq = 0;

function bindAppShellEvents() {
  el.imagePoolTabBtn?.addEventListener("click", () => switchTab("image-pool"));
  bindInboxEvents();
  bindYoloViewModeEvents();
  el.videoTabBtn.addEventListener("click", () => switchTab("video"));
  el.yoloTabBtn.addEventListener("click", () => switchTab("yolo"));
  el.poolLabelTabBtn?.addEventListener("click", () => switchTab("pool-label"));
  el.trainPrepTabBtn.addEventListener("click", () => switchTab("train-prep"));
  el.trainTabBtn.addEventListener("click", () => switchTab("train"));
  el.cropTabBtn.addEventListener("click", () => switchTab("crop"));
  el.maskNoiseTabBtn.addEventListener("click", () => switchTab("mask-noise"));
  el.mergeTabBtn.addEventListener("click", () => switchTab("merge"));
  renderTopbarActions("video");

  window.addEventListener("resize", () => {
    if (el.app.classList.contains("image-pool")) renderImagePoolGrid();
    if (el.app.classList.contains("inbox")) renderInboxGrid();
    renderCurrentImage();
    renderSegments();
  });
  window.addEventListener("keydown", onKeyDown);
  initPythonBackend();

  for (const target of [document.body, el.dropZone]) {
    target.addEventListener("dragover", event => {
      event.preventDefault();
      if (el.app.classList.contains("video")) {
        el.videoDropZone.classList.add("drop-hover");
        return;
      }
      if (el.app.classList.contains("merge")) {
        event.preventDefault();
        return;
      }
      el.dropZone.classList.add("drop-hover");
    });
    target.addEventListener("dragleave", () => {
      el.dropZone.classList.remove("drop-hover");
      el.videoDropZone.classList.remove("drop-hover");
    });
    target.addEventListener("drop", onDrop);
  }
}

function renderTopbarActions(tab) {
  el.topbarActions.replaceChildren();
  if (isImageWorkspaceTab(tab)) {
    el.topbarActions.append(createImageWorkspaceModeControls(tab));
    if (tab !== "yolo") return;
  }
  if (tab === "yolo") {
    if (el.yoloModeControls) el.topbarActions.append(el.yoloModeControls);
    el.topbarActions.append(...topbarControls.order);
    if (typeof updateYoloViewModesVisibility === "function") updateYoloViewModesVisibility();
    return;
  }
  if (tab === "pool-label") {
    const buttons = [topbarControls.openFolderBtn];
    if (typeof canMarkYoloJunk === "function" && canMarkYoloJunk()) {
      topbarControls.markJunkBtn.hidden = false;
      buttons.push(topbarControls.markJunkBtn);
    } else if (topbarControls.markJunkBtn) {
      topbarControls.markJunkBtn.hidden = true;
    }
    el.topbarActions.append(...buttons);
  }
}

function isImageWorkspaceTab(tab) {
  return tab === "image-pool" || tab === "inbox" || tab === "yolo";
}

function createImageWorkspaceModeControls(activeTab) {
  const wrap = document.createElement("div");
  wrap.className = "inbox-target-toggle image-workspace-mode-toggle";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Image workspace mode");

  const modes = [
    ["image-pool", "Library"],
    ["inbox", "Assign"],
    ["yolo", "Review"]
  ];
  for (const [tab, label] of modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inbox-target-option";
    button.textContent = label;
    button.classList.toggle("active", tab === activeTab);
    button.addEventListener("click", () => switchTab(tab));
    wrap.append(button);
  }
  return wrap;
}

function topbarStatusForTab(tab) {
  if (tab === "inbox") {
    if (!state.workspaceRoot) return "Open a workspace, then assign NEW images to dataset targets.";
    const visible = typeof inboxState !== "undefined" ? inboxState.pairs.length : 0;
    const newCount = imagePoolState.summary?.newCount ?? 0;
    return `Images / Assign: ${visible} visible, ${newCount} NEW.`;
  }
  if (tab === "image-pool") {
    if (!state.workspaceRoot) return "Open a workspace folder to manage image_pool.";
    const summary = imagePoolState.summary;
    if (summary) {
      return `Images / Library: ${summary.total} images, ${summary.newCount} NEW, ${summary.usedCount} linked, ${summary.unusedCount} unused.`;
    }
    return "Workspace bound. Refresh the scan to update the image_pool list.";
  }
  if (tab === "video") {
    return state.workspaceRoot
      ? "Workspace bound: screenshots save to image_pool by default, or use Output Folder."
      : "Open or drop a video, choose an output folder, then capture screenshots.";
  }
  if (tab === "merge") {
    return state.workspaceRoot
      ? "Workspace bound: Merge defaults to detect_dataset / clf_dataset; Val -> Train detects dataset type."
      : "Add source folders or ZIP files, choose a target folder, then merge.";
  }
  if (tab === "train-prep") {
    return "Prepare dataset splits, fix data.yaml, or generate train/export commands.";
  }
  if (tab === "train") {
    return "Use rough .pt models to auto-label detection data or sort classification data.";
  }
  if (tab === "crop") {
    return "Batch crop images or smart crop a YOLO dataset.";
  }
  if (tab === "mask-noise") {
    return maskNoiseState.photoFile
      ? `${maskNoiseState.photoFile.name} loaded.`
      : "Open a photo and a black/white mask.";
  }
  if (tab === "pool-label") {
    return hasDatasetOpen()
      ? `${state.rootName} | Pool Label | ${state.pairs.length}/${state.allPairs.length}`
      : "Open a workspace with image_pool to label detection boxes.";
  }
  if (tab === "yolo") return null;
  return hasDatasetOpen() ? `${state.rootName} loaded.` : "Open a folder to start, or drop a folder.";
}

function applyTopbarStatusForTab(tab) {
  if (tab === "yolo" || tab === "pool-label") {
    if (typeof updateStatus === "function") updateStatus();
    return;
  }
  const message = topbarStatusForTab(tab);
  if (message) setStatus(message);
}

function syncImageWorkspacePanelsForTab(isPoolLabel) {
  const target = isPoolLabel ? el.poolLabelWorkspace : el.yoloWorkspace;
  const sideStack = isPoolLabel ? el.poolLabelSideStack : el.yoloSideStack;
  if (!target || !sideStack || !el.imagePanel || !el.previewPanel) return;
  target.insertBefore(el.imagePanel, sideStack);
  target.insertBefore(el.previewPanel, sideStack);
}

function switchTab(tab) {
  const switchSeq = ++appShellTabSwitchSeq;
  state.activeTab = validSessionTab(tab);
  saveSessionSoon();
  const isImagePool = tab === "image-pool";
  const isInbox = tab === "inbox";
  const isImageWorkspace = isImageWorkspaceTab(tab);
  const isVideo = tab === "video";
  const isPoolLabel = tab === "pool-label";
  const isMerge = tab === "merge";
  const isTrainPrep = tab === "train-prep";
  const isTrain = tab === "train";
  const isCrop = tab === "crop";
  const isMaskNoise = tab === "mask-noise";
  el.app.classList.toggle("image-pool", isImagePool);
  el.app.classList.toggle("inbox", isInbox);
  el.app.classList.toggle("video", isVideo);
  el.app.classList.toggle("pool-label", isPoolLabel);
  el.app.classList.toggle("merge", isMerge);
  el.app.classList.toggle("train-prep", isTrainPrep);
  el.app.classList.toggle("train", isTrain);
  el.app.classList.toggle("crop", isCrop);
  el.app.classList.toggle("mask-noise", isMaskNoise);
  syncImageWorkspacePanelsForTab(isPoolLabel);
  el.imagePoolTabBtn?.classList.toggle("active", isImageWorkspace);
  el.inboxTabBtn?.classList.toggle("active", false);
  el.videoTabBtn.classList.toggle("active", isVideo);
  el.yoloTabBtn.classList.toggle("active", tab === "yolo");
  el.poolLabelTabBtn?.classList.toggle("active", isPoolLabel);
  el.trainPrepTabBtn.classList.toggle("active", isTrainPrep);
  el.trainTabBtn.classList.toggle("active", isTrain);
  el.cropTabBtn.classList.toggle("active", isCrop);
  el.maskNoiseTabBtn.classList.toggle("active", isMaskNoise);
  el.mergeTabBtn.classList.toggle("active", isMerge);
  renderTopbarActions(tab);
  el.activeToolTitle.textContent = isImageWorkspace
    ? "Images"
    : isVideo
      ? "Video Screenshot"
      : isMerge
        ? "Dataset Merge"
        : isTrainPrep
          ? "Dataset Prep"
          : isTrain
            ? "Auto Label"
            : isCrop
              ? "Crop"
	              : isMaskNoise
	                ? "Mask Noise"
	                : isPoolLabel
	                  ? "Pool Label"
	                  : "YOLO View";
  applyTopbarStatusForTab(tab);
  if (isInbox) {
    requestAnimationFrame(() => {
      if (switchSeq !== appShellTabSwitchSeq) return;
      refreshInboxView({ silent: true, preferCache: true })
        .catch(error => console.warn("Inbox refresh:", error))
        .finally(() => {
          if (switchSeq === appShellTabSwitchSeq) applyTopbarStatusForTab("inbox");
        });
    });
  } else if (isImagePool) {
    requestAnimationFrame(() => {
      if (switchSeq !== appShellTabSwitchSeq) return;
      const refresh = typeof ensureInboxMetadataIndex === "function"
        ? ensureInboxMetadataIndex().catch(error => console.warn("Image pool metadata:", error))
        : Promise.resolve();
      refresh.finally(() => {
        if (switchSeq !== appShellTabSwitchSeq) return;
        rebuildImagePoolPairs();
        renderImagePoolGrid();
        if (state.workspaceRoot && !imagePoolState.summary && !imagePoolState.scanning) {
          scanImagePool({ silent: true, fast: true })
            .catch(error => console.warn("Image pool scan:", error))
            .finally(() => {
              if (switchSeq === appShellTabSwitchSeq) applyTopbarStatusForTab("image-pool");
            });
        } else {
          applyTopbarStatusForTab("image-pool");
        }
      });
    });
  } else if (isTrainPrep) {
    if (state.workspaceRoot && typeof syncTrainProjectWithWorkspace === "function") {
      syncTrainProjectWithWorkspace(state.workspaceRoot).catch(error => console.warn("Train project sync:", error));
    }
    updateTrainPrepStatus();
    generateTrainCommand();
  } else if (isTrain) {
    if (state.workspaceRoot && typeof syncTrainProjectWithWorkspace === "function") {
      syncTrainProjectWithWorkspace(state.workspaceRoot).catch(error => console.warn("Train project sync:", error));
    }
    updatePtDetectStatus();
    updatePtClassifyStatus();
  } else if (isCrop) {
    updateCropDatasetStatus();
    updateCropQueueUI();
    updateBatchCropStatus();
  }
  if (tab === "yolo" || tab === "pool-label") {
    requestAnimationFrame(() => {
      if (switchSeq !== appShellTabSwitchSeq) return;
      refreshYoloOrPoolLabelView(tab, switchSeq).catch(error => console.warn("YOLO/Pool Label refresh:", error));
    });
  }
}

function sameBackendPath(a, b) {
  return String(a || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    === String(b || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

async function ensurePoolLabelDetectDatasetLoaded() {
  if (!state.workspaceRoot || !await ensurePythonBackend()) return;
  const cachedInfo = typeof yoloViewModeState !== "undefined" ? yoloViewModeState.workspaceInfo : null;
  const info = cachedInfo?.ok
    ? cachedInfo
    : JSON.parse(await backendCall("getWorkspaceInfo", state.workspaceRoot) || "{}");
  if (!info?.ok) throw new Error("Cannot read workspace info.");
  if (typeof yoloViewModeState !== "undefined") {
    yoloViewModeState.workspaceInfo = info;
  }
  if (state.yoloSource === "dataset"
    && sameBackendPath(state.datasetBackendRoot, info.detectDataset)
    && state.datasetTask !== "classify") {
    if (typeof yoloViewModeState !== "undefined") yoloViewModeState.mode = "detect";
    return;
  }
  await loadFromBackendDatasetPath(info.detectDataset, null, { restoreSession: true });
  state.workspaceRoot = info.root;
  if (typeof yoloViewModeState !== "undefined") {
    yoloViewModeState.mode = "detect";
    if (typeof setYoloViewModeButtons === "function") setYoloViewModeButtons("detect");
  }
}

async function refreshYoloOrPoolLabelView(tab, switchSeq = appShellTabSwitchSeq) {
  const isPoolLabel = tab === "pool-label";
  if (tab === "yolo" && state.workspaceRoot && typeof ensureYoloDatasetViewLoaded === "function") {
    await ensureYoloDatasetViewLoaded().catch(error => console.warn("YOLO dataset load:", error));
    if (switchSeq !== appShellTabSwitchSeq) return;
  }
  if (isPoolLabel && state.workspaceRoot && typeof loadFromBackendDatasetPath === "function") {
    await ensurePoolLabelDetectDatasetLoaded();
    if (switchSeq !== appShellTabSwitchSeq) return;
  } else if (isPoolLabel && state.allPairs.length && typeof buildLabelIndex === "function") {
    await buildLabelIndex();
    if (typeof applyFilter === "function") applyFilter(false);
  }
  if (isPoolLabel && state.workspaceRoot && typeof ensureInboxMetadataIndex === "function"
    && typeof hasDatasetOpen === "function" && hasDatasetOpen()) {
    await ensureInboxMetadataIndex().catch(error => console.warn("YOLO metadata load:", error));
    if (switchSeq !== appShellTabSwitchSeq) return;
  }
  if (typeof renderGallery === "function") renderGallery({ patchVisible: true });
  await renderCurrentImage();
  applyTopbarStatusForTab(tab);
  if (isPoolLabel && typeof updatePoolLabelPanel === "function") {
    await updatePoolLabelPanel().catch(error => console.warn("Pool Label panel:", error));
  }
  refreshImagePoolBackupHint().catch(() => {});
}
