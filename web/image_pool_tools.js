const imagePoolState = {

  summary: null,

  metaByFile: new Map(),

  files: new Map(),

  pairPaths: [],

  scanAt: 0,

  filter: "all",

  junkScope: "detect",

  hideJunk: null,

  scanning: false,

  workspaceKey: "",

  pairs: [],

  pairsCacheKey: "",

  selected: new Set(),

  anchorIndex: null,

  restoreViewport: null,

  deleting: false,

  junkCountsCacheKey: "",

  junkCountsCache: { detect: 0, clf: 0, both: 0 }

};



const imagePoolVirtual = createVirtualGalleryState(150);

let imagePoolThumbObserver = null;



const IMAGE_POOL_SCAN_CACHE_MS = 300000;



function imagePoolWorkspaceKey() {

  return state.workspaceRoot || "";

}



function imagePoolPairFromPath(imagePath) {

  return {

    imagePath,

    imageHandle: imagePoolState.files.get(imagePath),

    labelPath: null,

    classId: null,

    className: "",

    boxes: null

  };

}



function imagePoolBasePairs() {

  return imagePoolState.pairPaths

    .filter(path => imagePoolState.files.has(path))

    .map(imagePoolPairFromPath);

}



function rebuildImagePoolPairPaths() {

  imagePoolState.pairPaths = [...imagePoolState.files.keys()]

    .filter(path => path.startsWith("image_pool/"))

    .sort(naturalCompare);

}



function applyImagePoolScanResult(result) {

  imagePoolState.summary = {

    total: result.total,

    newCount: result.newCount,

    usedCount: result.usedCount,

    unusedCount: result.unusedCount,

    usageScanned: Boolean(result.usageScanned)

  };

  const newSet = new Set(result.newFiles || []);
  const usedSet = new Set(result.usedFiles || []);
  imagePoolState.metaByFile = new Map();

  if (result.files?.length) {
    for (const filename of result.files) {
      imagePoolState.metaByFile.set(filename, {
        filename,
        isNew: newSet.has(filename),
        isUsed: usedSet.has(filename)
      });
      const imagePath = `image_pool/${filename}`;
      if (!imagePoolState.files.has(imagePath) && state.workspaceRoot) {
        imagePoolState.files.set(imagePath, backendFileHandle(state.workspaceRoot, imagePath));
      }
    }
  } else {
    for (const item of result.items || []) {
      imagePoolState.metaByFile.set(item.filename, item);
      const imagePath = `image_pool/${item.filename}`;
      if (!imagePoolState.files.has(imagePath) && state.workspaceRoot) {
        imagePoolState.files.set(imagePath, backendFileHandle(state.workspaceRoot, imagePath));
      }
    }
  }

  rebuildImagePoolPairPaths();
  imagePoolState.pairsCacheKey = "";

}



function imagePoolJunkScope() {
  return imagePoolState.junkScope === "clf" ? "clf" : "detect";
}

function imagePoolJunkScopeLabel(scope = imagePoolJunkScope()) {
  return scope === "detect" ? "Detect" : "Clf";
}

function isImagePoolBothJunk(filename) {
  return typeof isInboxJunkFile === "function" && isInboxJunkFile(filename, "both");
}

function imagePoolJunkMatch(filename, kind) {
  if (!filename || typeof isInboxJunkFile !== "function") return false;
  if (kind === "detect") return isInboxJunkFile(filename, "detect");
  if (kind === "clf") return isInboxJunkFile(filename, "clf");
  if (kind === "both") return isImagePoolBothJunk(filename);
  return false;
}

function passesImagePoolHideJunk(filename) {
  if (!imagePoolState.hideJunk) return true;
  return !imagePoolJunkMatch(filename, imagePoolState.hideJunk);
}

function imagePoolJunkCounts() {
  const metaRev = typeof inboxState !== "undefined" ? inboxState.metadataRevision : 0;
  const cacheKey = `${metaRev}:${imagePoolState.pairPaths.length}:${imagePoolState.metaByFile.size}`;
  if (imagePoolState.junkCountsCacheKey === cacheKey) return imagePoolState.junkCountsCache;
  let detect = 0;
  let clf = 0;
  let both = 0;
  for (const imagePath of imagePoolState.pairPaths) {
    const filename = imagePath.split("/").pop();
    const d = imagePoolJunkMatch(filename, "detect");
    const c = imagePoolJunkMatch(filename, "clf");
    if (d) detect += 1;
    if (c) clf += 1;
    if (d && c) both += 1;
  }
  imagePoolState.junkCountsCacheKey = cacheKey;
  imagePoolState.junkCountsCache = { detect, clf, both };
  return imagePoolState.junkCountsCache;
}

function imagePoolPairsCacheKey() {
  const metaRev = typeof inboxState !== "undefined" ? inboxState.metadataRevision : 0;
  return `${imagePoolState.filter}:${imagePoolState.junkScope}:${imagePoolState.hideJunk || ""}:${metaRev}:${imagePoolState.scanAt}:${imagePoolState.pairPaths.length}:${imagePoolState.metaByFile.size}`;
}

function rebuildImagePoolPairs() {
  const pairs = imagePoolBasePairs();
  const metaLoaded = typeof inboxState !== "undefined" && inboxState.metadataByFile?.size;
  imagePoolState.pairs = pairs.filter(pair => {
    const filename = pair.imagePath.split("/").pop();
    const meta = imagePoolState.metaByFile.get(filename);
    if (metaLoaded && !passesImagePoolHideJunk(filename)) return false;
    if (imagePoolState.filter === "junk-detect") return imagePoolJunkMatch(filename, "detect");
    if (imagePoolState.filter === "junk-clf") return imagePoolJunkMatch(filename, "clf");
    if (imagePoolState.filter === "junk-both") return imagePoolJunkMatch(filename, "both");
    if (!meta || imagePoolState.filter === "all") return true;
    if (imagePoolState.filter === "new") return meta.isNew;
    if (imagePoolState.filter === "unused") return !meta.isUsed;
    if (imagePoolState.filter === "used") return meta.isUsed;
    return true;
  });
  imagePoolState.pairsCacheKey = imagePoolPairsCacheKey();
}



function updateImagePoolTabBadge() {

  const btn = el.imagePoolTabBtn;

  if (!btn) return;

  const count = imagePoolState.summary?.newCount || 0;

  btn.textContent = count > 0 ? `Image Pool (${count})` : "Image Pool";
  if (typeof updateInboxTabBadge === "function") updateInboxTabBadge();

}



function resetImagePoolState() {

  imagePoolState.summary = null;

  imagePoolState.metaByFile = new Map();

  imagePoolState.files = new Map();

  imagePoolState.pairPaths = [];

  imagePoolState.scanAt = 0;

  imagePoolState.workspaceKey = "";

  imagePoolState.pairs = [];

  imagePoolState.pairsCacheKey = "";

  imagePoolState.selected.clear();

  imagePoolState.anchorIndex = null;

  imagePoolState.restoreViewport = null;

  imagePoolState.deleting = false;

  imagePoolState.junkScope = "detect";

  imagePoolState.hideJunk = null;

  updateImagePoolJunkControls();

  updateImagePoolSelectionUI();

  if (typeof resetImagePoolDuplicateOverlay === "function") {
    resetImagePoolDuplicateOverlay();
  }

}

function imagePoolSelectedFilenames() {
  return [...imagePoolState.selected];
}

function updateImagePoolJunkControls() {
  const scope = imagePoolJunkScope();
  el.imagePoolJunkScopeDetectBtn?.classList.toggle("active", scope === "detect");
  el.imagePoolJunkScopeClfBtn?.classList.toggle("active", scope === "clf");
  for (const [mode, button] of [
    ["detect", el.imagePoolHideDetectJunkBtn],
    ["clf", el.imagePoolHideClfJunkBtn],
    ["both", el.imagePoolHideBothJunkBtn]
  ]) {
    button?.classList.toggle("active", imagePoolState.hideJunk === mode);
  }
}

function updateImagePoolJunkSelectionUI() {
  updateImagePoolJunkControls();
  const count = imagePoolState.selected.size;
  const scope = imagePoolJunkScope();
  const scopeLabel = imagePoolJunkScopeLabel(scope);
  const selected = count ? [...imagePoolState.selected] : [];
  const pendingMark = selected.filter(name => !isInboxJunkFile(name, scope)).length;
  const pendingClear = selected.filter(name => isInboxJunkFile(name, scope)).length;
  if (el.imagePoolMarkJunkBtn) {
    el.imagePoolMarkJunkBtn.disabled = !pendingMark || imagePoolState.deleting || inboxState?.assigning;
    el.imagePoolMarkJunkBtn.textContent = count
      ? (pendingMark ? `Mark ${scopeLabel} Junk (${pendingMark})` : `Mark ${scopeLabel} Junk`)
      : `Mark ${scopeLabel} Junk`;
  }
  if (el.imagePoolClearJunkBtn) {
    el.imagePoolClearJunkBtn.disabled = !pendingClear || imagePoolState.deleting || inboxState?.assigning;
    el.imagePoolClearJunkBtn.textContent = count
      ? (pendingClear ? `Clear ${scopeLabel} Junk (${pendingClear})` : `Clear ${scopeLabel} Junk`)
      : `Clear ${scopeLabel} Junk`;
  }
  if (typeof updateJunkUndoUi === "function") updateJunkUndoUi("image-pool");
}

function updateImagePoolSelectionUI() {
  const count = imagePoolState.selected.size;
  if (el.imagePoolDeleteSelectedBtn) {
    el.imagePoolDeleteSelectedBtn.disabled = !count || imagePoolState.deleting;
    el.imagePoolDeleteSelectedBtn.textContent = count ? `Delete (${count})` : "Delete Selected";
  }
  if (el.imagePoolOpenYoloBtn) {
    el.imagePoolOpenYoloBtn.disabled = count !== 1 || imagePoolState.deleting;
  }
  if (el.imagePoolSelectAllBtn) el.imagePoolSelectAllBtn.disabled = imagePoolState.deleting;
  if (el.imagePoolClearSelectionBtn) el.imagePoolClearSelectionBtn.disabled = !count || imagePoolState.deleting;
  updateImagePoolJunkSelectionUI();
}

function patchImagePoolCard(index, card) {
  const pair = imagePoolState.pairs[index];
  if (!pair || !card) return;
  const filename = pair.imagePath.split("/").pop();
  card.classList.toggle("selected", imagePoolState.selected.has(filename));
  if (typeof syncInboxCardAssignVisual === "function") {
    syncInboxCardAssignVisual(card, filename, imagePoolJunkScope());
  }
}

function onImagePoolCardClick(event, index, pair) {
  const filename = pair.imagePath.split("/").pop();
  if (event.shiftKey) {
    const anchor = imagePoolState.anchorIndex ?? index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    for (let i = start; i <= end; i++) {
      imagePoolState.selected.add(imagePoolState.pairs[i].imagePath.split("/").pop());
    }
    renderImagePoolGrid({ selectionOnly: true });
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (imagePoolState.selected.has(filename)) imagePoolState.selected.delete(filename);
    else imagePoolState.selected.add(filename);
    imagePoolState.anchorIndex = index;
    renderImagePoolGrid({ selectionOnly: true });
    return;
  }
  imagePoolState.anchorIndex = index;
  imagePoolState.selected.clear();
  imagePoolState.selected.add(filename);
  renderImagePoolGrid({ selectionOnly: true });
}

function imagePoolSelectAllVisible() {
  for (const pair of imagePoolState.pairs) {
    imagePoolState.selected.add(pair.imagePath.split("/").pop());
  }
  renderImagePoolGrid({ selectionOnly: true });
}

function imagePoolClearSelection() {
  imagePoolState.selected.clear();
  imagePoolState.anchorIndex = null;
  renderImagePoolGrid({ selectionOnly: true });
}

async function deleteImagePoolFilesCompletely(filenames, options = {}) {
  const unique = [...new Set((filenames || []).map(name => String(name || "").trim()).filter(Boolean))];
  if (!unique.length) {
    alert("Select images to delete first.");
    return { deleted: 0, failed: 0 };
  }
  if (!state.workspaceRoot) {
    alert("Open a workspace first.");
    return { deleted: 0, failed: 0 };
  }
  if (!await ensurePythonBackend()) {
    alert("Python backend is required.");
    return { deleted: 0, failed: 0 };
  }
  if (options.confirm !== false) {
    const preview = unique.slice(0, 8).join("\n");
    const more = unique.length > 8 ? `\n... plus ${unique.length - 8} more` : "";
    if (!confirm(
      `Permanently delete ${unique.length} image(s)?\n\nThis removes image_pool files, all detect/clf hard links, detect_labels, and metadata records. This cannot be undone.\n\n${preview}${more}`
    )) {
      return { deleted: 0, failed: 0, cancelled: true };
    }
  }

  imagePoolState.deleting = true;
  updateImagePoolSelectionUI();
  let deleted = 0;
  let failed = 0;
  const failures = [];
  try {
    for (let i = 0; i < unique.length; i++) {
      const filename = unique[i];
      if (el.imagePoolStats) {
        el.imagePoolStats.textContent = `Deleting ${i + 1}/${unique.length}: ${filename}`;
      }
      try {
        const result = JSON.parse(await backendCall("deletePoolImageCompletely", state.workspaceRoot, filename));
        if (result.failedPaths?.length) {
          failed += 1;
          failures.push(`${filename}: ${result.failedPaths.map(item => item.error).join("; ")}`);
        } else {
          deleted += 1;
        }
        imagePoolState.files.delete(`image_pool/${filename}`);
        imagePoolState.selected.delete(filename);
      } catch (error) {
        failed += 1;
        failures.push(`${filename}: ${error?.message || error}`);
      }
    }
    rebuildImagePoolPairPaths();
    await scanImagePool({ force: true, silent: true });
    renderImagePoolGrid();
    if (typeof findImagePoolDuplicates === "function" && imagePoolDuplicateState?.scan) {
      await findImagePoolDuplicates();
    }
    if (failures.length) {
      alert(`Some deletes failed (${failed}/${unique.length}):\n${failures.slice(0, 10).join("\n")}`);
    }
    setStatus(`Deleted ${deleted} image(s)${failed ? `; ${failed} failed` : ""}.`);
    return { deleted, failed };
  } finally {
    imagePoolState.deleting = false;
    updateImagePoolSelectionUI();
    renderImagePoolStats();
  }
}

async function deleteSelectedImagePoolFiles() {
  await deleteImagePoolFilesCompletely(imagePoolSelectedFilenames());
}

function openSelectedImagePoolInYolo() {
  const filenames = imagePoolSelectedFilenames();
  if (filenames.length !== 1) {
    alert("Select exactly 1 image before opening it in Box Label.");
    return;
  }
  openImageInYoloView(filenames[0]).catch(showError);
}



function ensureImagePoolThumbObserver() {

  if (imagePoolThumbObserver || !el.imagePoolGridWrap) return;

  imagePoolThumbObserver = createLazyThumbObserver(

    el.imagePoolGridWrap,

    loadGalleryThumbImage,

    "240px"

  );

}



function setImagePoolFilter(filter) {
  imagePoolState.filter = filter;
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
  imagePoolState.selected.clear();
  imagePoolState.anchorIndex = null;
  imagePoolState.restoreViewport = null;
  rebuildImagePoolPairs();
  renderImagePoolGrid();
  saveSessionSoon();
}

function setImagePoolJunkScope(scope) {
  imagePoolState.junkScope = scope === "clf" ? "clf" : "detect";
  updateImagePoolJunkControls();
  renderImagePoolGrid();
  saveSessionSoon();
}

function setImagePoolHideJunk(mode) {
  const next = imagePoolState.hideJunk === mode ? null : mode;
  imagePoolState.hideJunk = next;
  updateImagePoolJunkControls();
  rebuildImagePoolPairs();
  renderImagePoolGrid();
  saveSessionSoon();
}

function buildImagePoolPreviewContext(index, pair) {
  return {
    imagePath: pair.imagePath,
    imageHandle: pair.imageHandle,
    pairs: imagePoolState.pairs,
    index,
    previewContext: "image-pool",
    showFilmstrip: true
  };
}

function renderImagePoolStats() {

  const summary = imagePoolState.summary;

  const total = summary?.total ?? imagePoolBasePairs().length;

  if (!state.workspaceRoot) {

    el.imagePoolStats.textContent = "Open a workspace to scan image_pool";

    return;

  }

  if (!summary) {

    el.imagePoolStats.textContent = `${total} total | Refresh Scan updates NEW/link state`;

    return;

  }

  const selected = imagePoolState.selected.size;
  const junk = imagePoolJunkCounts();
  const hideLabel = imagePoolState.hideJunk === "detect"
    ? " | hiding Detect junk"
    : imagePoolState.hideJunk === "clf"
      ? " | hiding Clf junk"
      : imagePoolState.hideJunk === "both"
        ? " | hiding shared junk"
        : "";
  const junkLabel = junk.detect || junk.clf
    ? ` | Junk D${junk.detect} C${junk.clf} both${junk.both}`
    : "";

  el.imagePoolStats.textContent =

    `${summary.total} total | NEW ${summary.newCount} | linked ${summary.usedCount} | unused ${summary.unusedCount}${junkLabel}${hideLabel}${selected ? ` | selected ${selected}` : ""}`;

  updateImagePoolSelectionUI();

}



function renderImagePoolGrid(options = {}) {

  const { selectionOnly = false } = options;

  if (!el.imagePoolGrid) return;

  ensureImagePoolThumbObserver();



  if (!state.workspaceRoot) {

    el.imagePoolGrid.style.height = "";

    el.imagePoolGrid.innerHTML = `<div class="empty">Open a workspace containing image_pool.</div>`;

    imagePoolThumbObserver?.disconnect();

    renderImagePoolStats();

    updateImagePoolTabBadge();

    return;

  }



  if (imagePoolState.pairsCacheKey !== imagePoolPairsCacheKey()) {
    rebuildImagePoolPairs();
  }

  if (selectionOnly) {
    const windowEl = el.imagePoolGrid.querySelector(":scope > .gallery-window");
    if (windowEl) {
      for (let i = 0; i < windowEl.children.length; i++) {
        patchImagePoolCard(imagePoolVirtual.startIndex + i, windowEl.children[i]);
      }
      renderImagePoolStats();
      return;
    }
  }

  if (!imagePoolState.pairs.length) {

    el.imagePoolGrid.style.height = "";

    el.imagePoolGrid.replaceChildren();
    el.imagePoolGrid.appendChild(Object.assign(document.createElement("div"), {
      className: "empty",
      textContent: imagePoolState.summary ? "No images match the current filter." : "image_pool is empty, or refresh the scan."
    }));

    renderImagePoolStats();

    updateImagePoolTabBadge();

    return;

  }



  const layout = computeVirtualGalleryLayout({

    scrollEl: el.imagePoolGridWrap,

    itemCount: imagePoolState.pairs.length,

    columnUnit: 148,

    rowExtra: 52,

    aspectRatio: 1

  });



  renderVirtualGallery({

    galleryEl: el.imagePoolGrid,

    virtual: imagePoolVirtual,

    itemCount: imagePoolState.pairs.length,

    layout,

    thumbObserver: imagePoolThumbObserver,

    renderCard(index, windowEl) {

      const pair = imagePoolState.pairs[index];

      const filename = pair.imagePath.split("/").pop();

      const meta = imagePoolState.metaByFile.get(filename);
      const scope = imagePoolJunkScope();
      const assignClasses = typeof inboxAssignCardExtraClasses === "function"
        ? inboxAssignCardExtraClasses(filename, scope)
        : "";
      const overlayHtml = typeof inboxAssignOverlayHtml === "function"
        ? inboxAssignOverlayHtml(filename, scope)
        : "";
      const junkLabel = typeof inboxJunkLabelForFile === "function"
        ? inboxJunkLabelForFile(filename)
        : "";
      const usedText = meta?.isUsed ? "linked" : meta ? "not in detect/clf datasets" : "";
      const statusParts = [usedText, junkLabel].filter(Boolean);

      const selected = imagePoolState.selected.has(filename);

      const card = document.createElement("article");

      card.className = `thumb image-pool-entry${selected ? " selected" : ""}${assignClasses ? ` ${assignClasses}` : ""}`;

      card.dataset.filename = filename;

      card.title = statusParts.length ? `${statusParts.join(" · ")} · double-click to preview` : "Double-click to preview";

      const badges = [];
      if (meta?.isNew) badges.push('<span class="image-pool-badge">NEW</span>');
      if (meta?.isUsed) badges.push('<span class="image-pool-badge used">USED</span>');
      const badgesHtml = badges.length ? `<div class="image-pool-badges">${badges.join("")}</div>` : "";

      card.innerHTML = `

        ${badgesHtml}

        <img data-path="${escapeHtml(pair.imagePath)}" data-src-pending="true" alt="${escapeHtml(filename)}">

        ${overlayHtml}

        <div class="name">${escapeHtml(filename)}${statusParts.length ? `<div class="image-pool-status">${escapeHtml(statusParts.join(" · "))}</div>` : ""}</div>

      `;

      bindImagePreviewLightbox(card, {
        onClick: event => onImagePoolCardClick(event, index, pair),
        getContext: () => buildImagePoolPreviewContext(index, pair)
      });

      windowEl.appendChild(card);

      return card;

    },

    patchCard: patchImagePoolCard

  });



  renderImagePoolStats();

  updateImagePoolTabBadge();

  if (typeof restoreImagePoolViewportIfNeeded === "function") restoreImagePoolViewportIfNeeded();

}



function scanImagePoolBackendArgs(fast) {
  return [state.workspaceRoot, fast ? "fast" : ""];
}

async function scanImagePool(options = {}) {

  const { silent = false, force = false, fast = false } = options;

  if (!state.workspaceRoot) {

    resetImagePoolState();

    renderImagePoolGrid();

    return null;

  }

  if (!await ensurePythonBackend()) {

    if (!silent) alert("Python backend is required.");

    return null;

  }



  const sameWorkspace = imagePoolState.workspaceKey === imagePoolWorkspaceKey();

  const cacheFresh = sameWorkspace

    && imagePoolState.summary

    && imagePoolState.summary.usageScanned !== false

    && Date.now() - imagePoolState.scanAt < IMAGE_POOL_SCAN_CACHE_MS;

  if (!force && cacheFresh) {

    rebuildImagePoolPairs();
    if (typeof rebuildInboxPairs === "function") rebuildInboxPairs();
    if (el.app?.classList.contains("image-pool")) renderImagePoolGrid();
    else if (el.app?.classList.contains("inbox") && typeof renderInboxGrid === "function") renderInboxGrid();

    return imagePoolState.summary;

  }

  if (imagePoolState.scanning) return imagePoolState.summary;



  imagePoolState.scanning = true;

  if (!silent) {
    if (el.imagePoolRefreshBtn) el.imagePoolRefreshBtn.disabled = true;
    if (el.imagePoolStats) {
      el.imagePoolStats.textContent = fast
        ? "Fast scanning image_pool..."
        : "Scanning image_pool, including hard-link checks...";
    }
  } else if (el.imagePoolStats && fast) {
    el.imagePoolStats.textContent = "Loading image_pool...";
  }

  try {

    const raw = await backendCall("scanImagePool", ...scanImagePoolBackendArgs(fast));
    if (!raw?.trim()) {
      throw new Error("scanImagePool returned no data. Fully restart the Python app and try again.");
    }
    const result = JSON.parse(raw);
    if (!result?.ok && result?.error) {
      throw new Error(result.error);
    }

    applyImagePoolScanResult(result);

    if (typeof ensureInboxMetadataIndex === "function") {
      await ensureInboxMetadataIndex({ force: false });
    }

    imagePoolState.scanAt = Date.now();

    imagePoolState.workspaceKey = imagePoolWorkspaceKey();

    rebuildImagePoolPairs();
    if (typeof rebuildInboxPairs === "function") rebuildInboxPairs();

    if (el.app?.classList.contains("image-pool")) {

      renderImagePoolGrid();

    } else if (el.app?.classList.contains("inbox") && typeof renderInboxGrid === "function") {

      renderInboxGrid();

    } else {

      updateImagePoolTabBadge();

      renderImagePoolStats();

    }

    if (!silent) {

      const usedText = result.fast && !result.usedCount
        ? "link count updating in background"
        : `${result.usedCount} linked`;
      setStatus(`Images: ${result.total} total, ${result.newCount} NEW, ${usedText}`);

    }

    if (!result.usageScanned) {
      queueImagePoolUsageScan();
    }

    return imagePoolState.summary;

  } finally {

    imagePoolState.scanning = false;

    if (el.imagePoolRefreshBtn) el.imagePoolRefreshBtn.disabled = false;

  }

}

let imagePoolUsageScanTimer = null;

function queueImagePoolUsageScan() {
  clearTimeout(imagePoolUsageScanTimer);
  imagePoolUsageScanTimer = setTimeout(() => {
    imagePoolUsageScanTimer = null;
    if (!state.workspaceRoot || imagePoolState.scanning) return;
    if (!el.app?.classList.contains("image-pool") && !el.app?.classList.contains("inbox")) return;
    scanImagePool({ silent: true, fast: false })
      .then(summary => {
        if (!summary) return;
        if (el.app?.classList.contains("image-pool")) renderImagePoolGrid();
        else if (el.app?.classList.contains("inbox") && typeof renderInboxGrid === "function") renderInboxGrid();
        else updateImagePoolTabBadge();
      })
      .catch(error => console.warn("Image pool usage scan:", error));
  }, 400);
}



async function markImagePoolSeen() {

  if (!state.workspaceRoot) {

    alert("Open a workspace first.");

    return;

  }

  if (!await ensurePythonBackend()) {

    alert("Python backend is required.");

    return;

  }

  const result = JSON.parse(await backendCall("markImagePoolSeen", state.workspaceRoot));

  await scanImagePool({ force: true });

  setStatus(`Marked ${result.markedCount} image_pool image(s) as seen.`);

}



async function openImageInYoloView(filename) {

  if (!state.workspaceRoot || !filename) return;

  const imagePath = `image_pool/${filename}`;

  if (state.yoloSource !== "workspace" || state.datasetBackendRoot !== state.workspaceRoot) {

    await loadYoloWorkspaceAnnotation(state.workspaceRoot, imagePath);

  }

  switchTab("pool-label");

  if (state.imageViewMode !== "all") {

    state.imageViewMode = "all";

    applyFilter(false);

  }

  const index = state.pairs.findIndex(pair => pair.imagePath === imagePath);

  if (index < 0) {

    buildFilterList();

    applyFilter(false);

    renderGallery();

    const retry = state.pairs.findIndex(pair => pair.imagePath === imagePath);

    if (retry < 0) {

      alert("This image is not visible under the current filter.");

      return;

    }

    await selectIndex(retry);

    return;

  }

  await selectIndex(index);

}



function bindImagePoolPageEvents() {

  el.imagePoolOpenFolderBtn?.addEventListener("click", () => openImagePoolFolderFlow().catch(showError));

  el.imagePoolRefreshBtn?.addEventListener("click", () => scanImagePool({ force: true }).catch(showError));

  el.imagePoolMarkSeenBtn?.addEventListener("click", () => markImagePoolSeen().catch(showError));

  el.imagePoolSelectAllBtn?.addEventListener("click", imagePoolSelectAllVisible);

  el.imagePoolClearSelectionBtn?.addEventListener("click", imagePoolClearSelection);

  el.imagePoolOpenYoloBtn?.addEventListener("click", () => openSelectedImagePoolInYolo());

  el.imagePoolDeleteSelectedBtn?.addEventListener("click", () => deleteSelectedImagePoolFiles().catch(showError));

  el.imagePoolFilterAllBtn?.addEventListener("click", () => setImagePoolFilter("all"));

  el.imagePoolFilterNewBtn?.addEventListener("click", () => setImagePoolFilter("new"));

  el.imagePoolFilterUnusedBtn?.addEventListener("click", () => setImagePoolFilter("unused"));

  el.imagePoolFilterUsedBtn?.addEventListener("click", () => setImagePoolFilter("used"));

  el.imagePoolFilterJunkDetectBtn?.addEventListener("click", () => setImagePoolFilter("junk-detect"));

  el.imagePoolFilterJunkClfBtn?.addEventListener("click", () => setImagePoolFilter("junk-clf"));

  el.imagePoolFilterJunkBothBtn?.addEventListener("click", () => setImagePoolFilter("junk-both"));

  el.imagePoolJunkScopeDetectBtn?.addEventListener("click", () => setImagePoolJunkScope("detect"));

  el.imagePoolJunkScopeClfBtn?.addEventListener("click", () => setImagePoolJunkScope("clf"));

  el.imagePoolHideDetectJunkBtn?.addEventListener("click", () => setImagePoolHideJunk("detect"));

  el.imagePoolHideClfJunkBtn?.addEventListener("click", () => setImagePoolHideJunk("clf"));

  el.imagePoolHideBothJunkBtn?.addEventListener("click", () => setImagePoolHideJunk("both"));

  if (el.imagePoolGridWrap) {
    bindGalleryScroll(el.imagePoolGridWrap, () => renderImagePoolGrid());
    el.imagePoolGridWrap.addEventListener("scroll", () => saveSessionSoon(), { passive: true });
    bindGalleryResize(el.imagePoolGridWrap, imagePoolVirtual, () => renderImagePoolGrid());
  }

  bindImagePoolDuplicateEvents();

}



window.scanImagePool = scanImagePool;

window.resetImagePoolState = resetImagePoolState;

window.deleteImagePoolFilesCompletely = deleteImagePoolFilesCompletely;

window.imagePoolJunkScope = imagePoolJunkScope;

window.refreshImagePoolAfterJunkChange = function refreshImagePoolAfterJunkChange(options = {}) {
  rebuildImagePoolPairs();
  if (options.selectionOnly) renderImagePoolGrid({ selectionOnly: true });
  else renderImagePoolGrid();
  updateImagePoolJunkSelectionUI();
};

