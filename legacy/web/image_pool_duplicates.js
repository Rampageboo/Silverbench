const imagePoolDuplicateState = {
  scan: null,
  scanning: false,
  expanded: false
};

function setImagePoolDupExpanded(expanded) {
  imagePoolDuplicateState.expanded = expanded;
  el.imagePoolDupOverlay?.classList.toggle("collapsed", !expanded);
  if (el.imagePoolDupFab) {
    el.imagePoolDupFab.setAttribute("aria-expanded", expanded ? "true" : "false");
    el.imagePoolDupFab.title = expanded ? "收起重复图片" : "重复图片（点击展开）";
  }
}

function toggleImagePoolDupOverlay() {
  setImagePoolDupExpanded(!imagePoolDuplicateState.expanded);
}

function updateImagePoolDuplicateBadge(result) {
  const badge = el.imagePoolDupBadge;
  const fab = el.imagePoolDupFab;
  if (!badge || !fab) return;
  const dupCount = result?.duplicateFiles || 0;
  if (dupCount > 0) {
    badge.hidden = false;
    badge.textContent = dupCount > 99 ? "99+" : String(dupCount);
    fab.classList.add("has-dup");
    fab.title = imagePoolDuplicateState.expanded
      ? "收起重复图片"
      : `${dupCount} 张重复（点击展开）`;
  } else {
    badge.hidden = true;
    badge.textContent = "";
    fab.classList.remove("has-dup");
  }
}

function resetImagePoolDuplicateOverlay() {
  imagePoolDuplicateState.scan = null;
  setImagePoolDupExpanded(false);
  updateImagePoolDuplicateBadge(null);
  if (el.imagePoolDuplicateStatus) el.imagePoolDuplicateStatus.textContent = "未扫描";
  if (el.imagePoolDuplicateResults) {
    el.imagePoolDuplicateResults.innerHTML = `<div class="empty">点击「查找重复」扫描完全相同文件。</div>`;
  }
}

function choosePoolDuplicateKeeper(filenames, inMetadata = []) {
  const metaSet = new Set(inMetadata || []);
  const inMeta = filenames.filter(name => metaSet.has(name));
  if (inMeta.length === 1) return inMeta[0];
  if (inMeta.length) return [...inMeta].sort(naturalCompare)[0];
  return [...filenames].sort((a, b) => a.length - b.length || naturalCompare(a, b))[0];
}

async function findImagePoolDuplicates() {
  if (!state.workspaceRoot) {
    alert("请先打开 workspace。");
    return;
  }
  if (!await ensurePythonBackend()) {
    alert("需要 Python 后端。");
    return;
  }

  imagePoolDuplicateState.scanning = true;
  if (el.imagePoolFindDuplicatesBtn) el.imagePoolFindDuplicatesBtn.disabled = true;
  if (el.imagePoolDuplicateStatus) el.imagePoolDuplicateStatus.textContent = "扫描中...";
  if (el.imagePoolDuplicateResults) {
    el.imagePoolDuplicateResults.innerHTML = `<div class="empty">正在扫描 image_pool...</div>`;
  }

  try {
    const result = JSON.parse(await backendCall("findImagePoolDuplicates", state.workspaceRoot));
    imagePoolDuplicateState.scan = result;
    renderImagePoolDuplicateResults(result);
    updateImagePoolDuplicateBadge(result);
    if (el.imagePoolDuplicateStatus) {
      const groups = result.groupCount || 0;
      el.imagePoolDuplicateStatus.textContent = groups
        ? `${groups} 组，${result.duplicateFiles || 0} 张多余`
        : `${result.totalImages || 0} 张无重复`;
    }
  } finally {
    imagePoolDuplicateState.scanning = false;
    if (el.imagePoolFindDuplicatesBtn) el.imagePoolFindDuplicatesBtn.disabled = false;
  }
}

function renderImagePoolDuplicateResults(result) {
  const container = el.imagePoolDuplicateResults;
  if (!container) return;
  const groups = result?.groups || [];
  container.innerHTML = "";
  if (!groups.length) {
    container.innerHTML = `<div class="empty">image_pool 中没有完全相同的重复文件。</div>`;
    return;
  }

  for (const [index, group] of groups.entries()) {
    const filenames = group.filenames || [];
    const keeper = choosePoolDuplicateKeeper(filenames, group.inMetadata || []);
    const groupEl = document.createElement("div");
    groupEl.className = "duplicate-photo-group";
    const sizeText = formatPoolDuplicateBytes(group.size || 0);
    groupEl.innerHTML = `
      <div class="duplicate-photo-group-head">
        <span>组 ${index + 1}</span>
        <span>${group.count} 张 | ${sizeText}</span>
      </div>
      <div class="duplicate-photo-grid"></div>`;
    const grid = groupEl.querySelector(".duplicate-photo-grid");

    for (const filename of filenames) {
      const isKeeper = filename === keeper;
      const item = document.createElement("div");
      item.className = `duplicate-photo-item${isKeeper ? " duplicate-photo-keeper" : ""}`;
      item.innerHTML = `
        <img data-filename="${escapeHtml(filename)}" data-src-pending="true" alt="">
        <span title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
        <div class="duplicate-photo-item-actions">
          ${isKeeper ? `<span class="status">保留</span>` : `<button type="button" class="danger" data-delete="${escapeHtml(filename)}">删除</button>`}
        </div>`;
      const deleteBtn = item.querySelector("[data-delete]");
      deleteBtn?.addEventListener("click", () => deleteImagePoolFileCompletely(filename).catch(showError));
      grid.appendChild(item);
      loadImagePoolDuplicateThumb(item.querySelector("img"), filename);
    }
    container.appendChild(groupEl);
  }
}

async function loadImagePoolDuplicateThumb(img, filename) {
  if (!img || !state.workspaceRoot) return;
  try {
    const url = await thumbObjectUrlForImagePool(filename, 128);
    img.src = url;
    img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    img.dataset.srcPending = "false";
  } catch {
    img.removeAttribute("src");
  }
}

async function deleteImagePoolFileCompletely(filename) {
  if (!filename) return;
  if (typeof window.deleteImagePoolFilesCompletely === "function") {
    await window.deleteImagePoolFilesCompletely([filename]);
    return;
  }
  alert("删除功能未加载，请刷新应用。");
}

async function clearImagePoolDuplicates() {
  if (!state.workspaceRoot) {
    alert("请先打开 workspace。");
    return;
  }
  if (!await ensurePythonBackend()) {
    alert("需要 Python 后端。");
    return;
  }

  if (!imagePoolDuplicateState.scan?.groups?.length) {
    await findImagePoolDuplicates();
  }
  const dupCount = imagePoolDuplicateState.scan?.duplicateFiles || 0;
  if (!dupCount) {
    alert("没有发现重复图片。");
    return;
  }
  if (!confirm(`清除 ${dupCount} 张重复图？\n\n每组保留 1 张（优先 metadata 中登记的），其余彻底删除（含硬链接）。`)) {
    return;
  }

  if (el.imagePoolClearDuplicatesBtn) el.imagePoolClearDuplicatesBtn.disabled = true;
  try {
    const result = JSON.parse(await backendCall("clearImagePoolDuplicates", state.workspaceRoot));
    for (const filename of (result.plan || []).flatMap(entry => entry.remove || [])) {
      imagePoolState.files.delete(`image_pool/${filename}`);
    }
    rebuildImagePoolPairPaths();
    await scanImagePool({ force: true, silent: true });
    renderImagePoolGrid();
    await findImagePoolDuplicates();
    const failed = result.failed?.length || 0;
    const msg = `已清除 ${result.removedCount || 0} 张重复图${failed ? `，${failed} 张失败` : ""}。`;
    setStatus(msg);
    alert(msg);
  } finally {
    if (el.imagePoolClearDuplicatesBtn) el.imagePoolClearDuplicatesBtn.disabled = false;
  }
}

function formatPoolDuplicateBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function bindImagePoolDuplicateEvents() {
  el.imagePoolFindDuplicatesBtn?.addEventListener("click", () => findImagePoolDuplicates().catch(showError));
  el.imagePoolClearDuplicatesBtn?.addEventListener("click", () => clearImagePoolDuplicates().catch(showError));
  el.imagePoolDupFab?.addEventListener("click", () => toggleImagePoolDupOverlay());
  el.imagePoolDupCollapseBtn?.addEventListener("click", () => setImagePoolDupExpanded(false));
}
