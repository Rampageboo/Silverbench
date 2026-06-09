const imagePreviewLightboxState = {
  open: false,
  imagePath: null,
  pairs: null,
  index: -1,
  zoom: 1,
  panX: 0,
  panY: 0,
  fitZoom: 1,
  loadToken: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  panStartX: 0,
  panStartY: 0,
  objectUrl: null,
  activeImgKey: "a",
  previewContext: null,
  showFilmstrip: false,
  markingJunk: false
};

let imagePreviewEls = null;

function ensureImagePreviewLightboxEls() {
  if (imagePreviewEls) return imagePreviewEls;
  imagePreviewEls = {
    root: document.getElementById("imagePreviewLightbox"),
    shell: document.getElementById("imagePreviewShell"),
    dialog: document.getElementById("imagePreviewDialog"),
    title: document.getElementById("imagePreviewTitle"),
    meta: document.getElementById("imagePreviewMeta"),
    stage: document.getElementById("imagePreviewStage"),
    imgA: document.getElementById("imagePreviewImgA"),
    imgB: document.getElementById("imagePreviewImgB"),
    closeBtn: document.getElementById("imagePreviewCloseBtn"),
    prevBtn: document.getElementById("imagePreviewPrevBtn"),
    nextBtn: document.getElementById("imagePreviewNextBtn"),
    zoomInBtn: document.getElementById("imagePreviewZoomInBtn"),
    zoomOutBtn: document.getElementById("imagePreviewZoomOutBtn"),
    zoomResetBtn: document.getElementById("imagePreviewZoomResetBtn"),
    junkBtn: document.getElementById("imagePreviewJunkBtn"),
    filmstrip: document.getElementById("imagePreviewFilmstrip"),
    filmstripTrack: document.getElementById("imagePreviewFilmstripTrack")
  };
  if (imagePreviewEls.root?.parentElement !== document.body) {
    document.body.appendChild(imagePreviewEls.root);
  }
  return imagePreviewEls;
}

function activePreviewImg() {
  const els = ensureImagePreviewLightboxEls();
  return imagePreviewLightboxState.activeImgKey === "b" ? els.imgB : els.imgA;
}

function bufferPreviewImg() {
  const els = ensureImagePreviewLightboxEls();
  return imagePreviewLightboxState.activeImgKey === "b" ? els.imgA : els.imgB;
}

function setActivePreviewImg(key) {
  const els = ensureImagePreviewLightboxEls();
  const prevKey = imagePreviewLightboxState.activeImgKey;
  imagePreviewLightboxState.activeImgKey = key === "b" ? "b" : "a";
  const prevImg = prevKey === "b" ? els.imgB : els.imgA;
  const nextImg = imagePreviewLightboxState.activeImgKey === "b" ? els.imgB : els.imgA;
  if (prevImg !== nextImg) {
    prevImg.classList.remove("active");
    prevImg.removeAttribute("src");
    resetPreviewImageLayout(prevImg);
  }
  nextImg.classList.add("active");
}

function resolvePreviewImageHandle(imagePath, imageHandle) {
  if (imageHandle) return imageHandle;
  if (imagePoolState?.files?.has(imagePath)) return imagePoolState.files.get(imagePath);
  const pools = [
    state?.pairs,
    state?.allPairs,
    imagePoolState?.pairs,
    inboxState?.pairs
  ];
  for (const list of pools) {
    const pair = list?.find(item => item.imagePath === imagePath);
    if (pair?.imageHandle) return pair.imageHandle;
  }
  if (imagePath.startsWith("image_pool/") && state?.workspaceRoot) {
    return backendFileHandle(state.workspaceRoot, imagePath);
  }
  if (state?.datasetBackendRoot) {
    return backendFileHandle(state.datasetBackendRoot, imagePath);
  }
  return null;
}

function revokePreviewObjectUrl(url = imagePreviewLightboxState.objectUrl) {
  if (!url) return;
  URL.revokeObjectURL(url);
  if (url === imagePreviewLightboxState.objectUrl) {
    imagePreviewLightboxState.objectUrl = null;
  }
}

async function createPreviewObjectUrl(imagePath, imageHandle) {
  const handle = resolvePreviewImageHandle(imagePath, imageHandle);
  if (!handle) throw new Error(`找不到图片: ${imagePath}`);
  if (
    typeof previewObjectUrlForBackendHandle === "function"
    && typeof backendImageHandle === "function"
    && backendImageHandle(handle)
  ) {
    const url = await previewObjectUrlForBackendHandle(handle, PREVIEW_MAX_EDGE, PREVIEW_JPEG_QUALITY);
    if (url) return url;
  }
  const file = await handle.getFile();
  return URL.createObjectURL(file);
}

function decodePreviewUrl(url) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    const cleanup = () => {
      probe.onload = null;
      probe.onerror = null;
    };
    probe.onload = () => {
      cleanup();
      resolve();
    };
    probe.onerror = () => {
      cleanup();
      reject(new Error("图片加载失败"));
    };
    probe.src = url;
  });
}

function loadPreviewImageElement(img, url) {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("图片加载失败"));
    };
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
    };
    img.onload = onLoad;
    img.onerror = onError;
    if (img.src === url && img.complete && img.naturalWidth > 0) {
      cleanup();
      resolve();
      return;
    }
    img.src = url;
  });
}

function computePreviewFitZoom(img, stage) {
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!sw || !sh || !iw || !ih) return 1;
  return Math.min(sw / iw, sh / ih);
}

function resetPreviewImageLayout(img) {
  if (!img) return;
  img.style.width = "";
  img.style.height = "";
  img.style.left = "";
  img.style.top = "";
  img.style.transform = "";
}

function applyPreviewTransform(img = activePreviewImg()) {
  const els = ensureImagePreviewLightboxEls();
  const { zoom, panX, panY, fitZoom } = imagePreviewLightboxState;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = fitZoom * zoom;
  const w = iw * scale;
  const h = ih * scale;
  const sw = els.stage.clientWidth;
  const sh = els.stage.clientHeight;
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  img.style.left = `${sw / 2 - w / 2 + panX}px`;
  img.style.top = `${sh / 2 - h / 2 + panY}px`;
  img.style.transform = "none";
  els.zoomResetBtn.textContent = zoom === 1 ? "适应" : `${Math.round(zoom * 100)}%`;
}

function schedulePreviewFit() {
  const els = ensureImagePreviewLightboxEls();
  const img = activePreviewImg();
  let attempts = 0;
  const tryFit = () => {
    attempts += 1;
    const sw = els.stage.clientWidth;
    const sh = els.stage.clientHeight;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (sw > 0 && sh > 0 && iw > 0 && ih > 0) {
      imagePreviewLightboxState.fitZoom = computePreviewFitZoom(img, els.stage);
      applyPreviewTransform(img);
      return;
    }
    if (attempts < 12) requestAnimationFrame(tryFit);
  };
  requestAnimationFrame(tryFit);
}

function resetPreviewTransform(fit = true) {
  imagePreviewLightboxState.zoom = 1;
  imagePreviewLightboxState.panX = 0;
  imagePreviewLightboxState.panY = 0;
  if (fit) schedulePreviewFit();
  else applyPreviewTransform();
}

function currentPreviewFilename() {
  const { pairs, index } = imagePreviewLightboxState;
  const pair = pairs?.[index];
  return pair?.imagePath?.split("/").pop() || "";
}

function updatePreviewJunkButton() {
  const els = ensureImagePreviewLightboxEls();
  if (!els.junkBtn) return;
  const ctx = imagePreviewLightboxState.previewContext;
  const show = imagePreviewLightboxState.open && (
    ctx === "inbox"
    || ctx === "image-pool"
    || (ctx === "yolo" && typeof hasWorkspaceRoot === "function" && hasWorkspaceRoot())
  );
  els.junkBtn.hidden = !show;
  if (!show) return;
  const filename = currentPreviewFilename();
  const scope = typeof previewJunkScope === "function" ? previewJunkScope() : "clf";
  const scopeLabel = scope === "detect" ? "Detect" : "Clf";
  const isJunk = typeof isInboxJunkFile === "function" && isInboxJunkFile(filename, scope);
  els.junkBtn.textContent = isJunk ? `取消${scopeLabel}废片` : `标记${scopeLabel}废片`;
  els.junkBtn.classList.toggle("is-junk", isJunk);
  els.junkBtn.disabled = imagePreviewLightboxState.markingJunk || !filename;
}

function updatePreviewNavControls() {
  const els = ensureImagePreviewLightboxEls();
  const { pairs, index, previewContext } = imagePreviewLightboxState;
  const hasNav = Array.isArray(pairs) && pairs.length > 1 && index >= 0;
  els.prevBtn.hidden = !hasNav;
  els.nextBtn.hidden = !hasNav;
  const filename = currentPreviewFilename();
  const statusTag = (previewContext === "inbox" || previewContext === "yolo" || previewContext === "image-pool")
    && typeof inboxClassTagForFile === "function"
    ? inboxClassTagForFile(filename)
    : "";
  if (hasNav) {
    const suffix = statusTag ? ` · ${statusTag}` : "";
    els.meta.textContent = `${index + 1} / ${pairs.length}${suffix}`;
  } else if (statusTag) {
    els.meta.textContent = statusTag;
  } else {
    els.meta.textContent = "";
  }
  updatePreviewJunkButton();
  syncPreviewFilmstripActive();
}

async function loadPreviewFilmstripThumb(img, imagePath, imageHandle) {
  if (!img || !imagePath) return;
  try {
    const cached = getCachedObjectUrl(imagePath);
    if (cached) {
      img.src = cached;
      return;
    }
    if (typeof resolveGalleryThumbUrl === "function") {
      img.src = await resolveGalleryThumbUrl(imagePath, imageHandle);
      return;
    }
    const url = await createPreviewObjectUrl(imagePath, imageHandle);
    img.src = url;
  } catch {
    img.alt = "预览失败";
  }
}

function syncPreviewFilmstripActive() {
  const els = ensureImagePreviewLightboxEls();
  if (!els.filmstripTrack || els.filmstrip?.hidden) return;
  const { index } = imagePreviewLightboxState;
  const items = els.filmstripTrack.querySelectorAll(".image-preview-filmstrip-item");
  items.forEach((item, itemIndex) => {
    const active = itemIndex === index;
    item.classList.toggle("active", active);
    if (active) {
      item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });
}

function clearPreviewFilmstrip() {
  const els = ensureImagePreviewLightboxEls();
  if (els.filmstripTrack) els.filmstripTrack.replaceChildren();
  if (els.filmstrip) els.filmstrip.hidden = true;
  if (els.dialog) els.dialog.classList.remove("has-filmstrip");
}

function updatePreviewFilmstrip() {
  const els = ensureImagePreviewLightboxEls();
  const { pairs, showFilmstrip } = imagePreviewLightboxState;
  clearPreviewFilmstrip();
  if (!showFilmstrip || !Array.isArray(pairs) || pairs.length <= 1 || !els.filmstripTrack) return;

  els.filmstrip.hidden = false;
  els.dialog?.classList.add("has-filmstrip");

  pairs.forEach((pair, itemIndex) => {
    const filename = pair.imagePath.split("/").pop();
    const isJunk = typeof isInboxJunkFile === "function" && isInboxJunkFile(filename);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `image-preview-filmstrip-item${itemIndex === imagePreviewLightboxState.index ? " active" : ""}${isJunk ? " inbox-junk" : ""}`;
    button.title = filename;
    button.dataset.index = String(itemIndex);
    const img = document.createElement("img");
    img.alt = filename;
    img.draggable = false;
    button.appendChild(img);
    if (isJunk) {
      const overlay = document.createElement("span");
      overlay.className = "image-preview-filmstrip-junk";
      overlay.setAttribute("aria-hidden", "true");
      overlay.textContent = "✕";
      button.appendChild(overlay);
    }
    button.addEventListener("click", event => {
      event.stopPropagation();
      jumpPreviewLightboxTo(itemIndex);
    });
    els.filmstripTrack.appendChild(button);
    loadPreviewFilmstripThumb(img, pair.imagePath, pair.imageHandle);
  });
  syncPreviewFilmstripActive();
}

function patchPreviewFilmstripJunkState(filename, isJunk) {
  const els = ensureImagePreviewLightboxEls();
  if (!els.filmstripTrack || els.filmstrip?.hidden) return;
  const { pairs, index } = imagePreviewLightboxState;
  const pair = pairs?.[index];
  if (!pair || pair.imagePath.split("/").pop() !== filename) return;
  const item = els.filmstripTrack.children[index];
  if (!item) return;
  item.classList.toggle("inbox-junk", isJunk);
  let overlay = item.querySelector(".image-preview-filmstrip-junk");
  if (isJunk && !overlay) {
    overlay = document.createElement("span");
    overlay.className = "image-preview-filmstrip-junk";
    overlay.setAttribute("aria-hidden", "true");
    overlay.textContent = "✕";
    item.appendChild(overlay);
  } else if (!isJunk && overlay) {
    overlay.remove();
  }
}

function jumpPreviewLightboxTo(nextIndex) {
  const { pairs, index } = imagePreviewLightboxState;
  if (!Array.isArray(pairs) || !pairs.length || nextIndex < 0 || nextIndex >= pairs.length) return;
  if (nextIndex === index) return;
  imagePreviewLightboxState.index = nextIndex;
  const pair = pairs[nextIndex];
  showImageInPreviewLightbox(pair.imagePath, pair.imageHandle, { silent: true }).catch(showError);
}

function clearPreviewImages() {
  const els = ensureImagePreviewLightboxEls();
  for (const img of [els.imgA, els.imgB]) {
    img.removeAttribute("src");
    img.classList.remove("active");
    resetPreviewImageLayout(img);
  }
  imagePreviewLightboxState.activeImgKey = "a";
  els.imgA.classList.add("active");
}

function refreshGalleriesAfterPreviewChange() {
  const rerender = () => {
    if (typeof invalidateVirtualGallery === "function") {
      if (typeof inboxVirtual !== "undefined") invalidateVirtualGallery(inboxVirtual);
      if (typeof imagePoolVirtual !== "undefined") invalidateVirtualGallery(imagePoolVirtual);
      if (typeof galleryVirtual !== "undefined") invalidateVirtualGallery(galleryVirtual);
    }
    if (typeof renderInboxGrid === "function") renderInboxGrid();
    if (typeof renderImagePoolGrid === "function") renderImagePoolGrid();
    if (typeof renderGallery === "function") renderGallery();
  };
  requestAnimationFrame(() => {
    rerender();
    requestAnimationFrame(rerender);
  });
}

function closeImagePreviewLightbox() {
  const els = ensureImagePreviewLightboxEls();
  if (!els.root) return;
  imagePreviewLightboxState.open = false;
  imagePreviewLightboxState.loadToken += 1;
  imagePreviewLightboxState.previewContext = null;
  imagePreviewLightboxState.showFilmstrip = false;
  imagePreviewLightboxState.markingJunk = false;
  clearPreviewFilmstrip();
  clearPreviewImages();
  revokePreviewObjectUrl();
  els.root.hidden = true;
  document.body.classList.remove("image-preview-open");
  refreshGalleriesAfterPreviewChange();
}

async function showImageInPreviewLightbox(imagePath, imageHandle, options = {}) {
  const silent = Boolean(options.silent);
  const els = ensureImagePreviewLightboxEls();
  const token = ++imagePreviewLightboxState.loadToken;
  const previousUrl = imagePreviewLightboxState.objectUrl;
  const targetImg = silent ? bufferPreviewImg() : activePreviewImg();

  imagePreviewLightboxState.imagePath = imagePath;
  els.title.textContent = imagePath.split("/").pop() || imagePath;
  updatePreviewNavControls();

  let nextUrl = null;
  try {
    nextUrl = await createPreviewObjectUrl(imagePath, imageHandle);
    if (token !== imagePreviewLightboxState.loadToken) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    await decodePreviewUrl(nextUrl);
    if (token !== imagePreviewLightboxState.loadToken) {
      URL.revokeObjectURL(nextUrl);
      return;
    }

    imagePreviewLightboxState.zoom = 1;
    imagePreviewLightboxState.panX = 0;
    imagePreviewLightboxState.panY = 0;
    resetPreviewImageLayout(targetImg);

    await loadPreviewImageElement(targetImg, nextUrl);
    if (token !== imagePreviewLightboxState.loadToken) {
      URL.revokeObjectURL(nextUrl);
      return;
    }

    imagePreviewLightboxState.objectUrl = nextUrl;
    if (previousUrl && previousUrl !== nextUrl) {
      URL.revokeObjectURL(previousUrl);
    }

    setActivePreviewImg(targetImg === els.imgB ? "b" : "a");
    schedulePreviewFit();
    syncPreviewFilmstripActive();
  } catch (error) {
    if (token !== imagePreviewLightboxState.loadToken) {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      return;
    }
    if (nextUrl && nextUrl !== previousUrl) URL.revokeObjectURL(nextUrl);
    els.meta.textContent = "加载失败";
    setStatus(`预览加载失败: ${error?.message || error}`);
  }
}

function openImagePreviewLightbox(options = {}) {
  const els = ensureImagePreviewLightboxEls();
  if (!els.root) return;
  const {
    imagePath,
    imageHandle = null,
    pairs = null,
    index = -1,
    previewContext = null,
    showFilmstrip = false
  } = options;
  if (!imagePath) return;

  imagePreviewLightboxState.open = true;
  imagePreviewLightboxState.pairs = pairs;
  imagePreviewLightboxState.index = index;
  imagePreviewLightboxState.previewContext = previewContext;
  imagePreviewLightboxState.showFilmstrip = Boolean(showFilmstrip);
  imagePreviewLightboxState.markingJunk = false;
  els.root.hidden = false;
  document.body.classList.add("image-preview-open");
  updatePreviewFilmstrip();
  updatePreviewJunkButton();
  showImageInPreviewLightbox(imagePath, imageHandle, { silent: false }).catch(showError);
}

function stepPreviewLightbox(delta) {
  const { pairs, index } = imagePreviewLightboxState;
  if (!Array.isArray(pairs) || !pairs.length || index < 0) return;
  const nextIndex = Math.max(0, Math.min(pairs.length - 1, index + delta));
  jumpPreviewLightboxTo(nextIndex);
}

async function markCurrentPreviewAsJunk() {
  const ctx = imagePreviewLightboxState.previewContext;
  if (!imagePreviewLightboxState.open || (ctx !== "inbox" && ctx !== "yolo" && ctx !== "image-pool")) return;
  if (ctx === "yolo" && (typeof hasWorkspaceRoot !== "function" || !hasWorkspaceRoot())) return;
  const filename = currentPreviewFilename();
  if (!filename) return;
  const scope = typeof previewJunkScope === "function" ? previewJunkScope() : "clf";
  const scopeLabel = scope === "detect" ? "Detect" : "Clf";
  const isJunk = typeof isInboxJunkFile === "function" && isInboxJunkFile(filename, scope);
  const action = isJunk ? "unmarkInboxJunkFilenames" : "markInboxJunkFilenames";
  if (typeof window[action] !== "function") return;

  imagePreviewLightboxState.markingJunk = true;
  updatePreviewJunkButton();
  try {
    const result = await window[action]([filename], {
      clearSelection: false,
      skipGridRender: true,
      quiet: true,
      scope
    });
    if (!result) return;
    const scopeAfter = typeof previewJunkScope === "function" ? previewJunkScope() : "clf";
    patchPreviewFilmstripJunkState(filename, isInboxJunkFile(filename, scopeAfter));
    if (ctx === "inbox" && typeof renderInboxGrid === "function") renderInboxGrid({ selectionOnly: true });
    if (ctx === "yolo" && typeof renderGallery === "function") renderGallery({ patchVisible: true });
    if (ctx === "image-pool" && typeof refreshImagePoolAfterJunkChange === "function") {
      refreshImagePoolAfterJunkChange({ selectionOnly: true });
    }
    if (typeof updateReviewControls === "function") updateReviewControls();
    updatePreviewNavControls();
    setStatus(isJunk ? `已取消 ${scopeLabel} 废片：${filename}` : `已标记 ${scopeLabel} 废片：${filename}`);
  } catch (error) {
    showError(error);
  } finally {
    imagePreviewLightboxState.markingJunk = false;
    updatePreviewJunkButton();
  }
}

function bindDeferredThumbClick(card, onSingleClick, onPreview) {
  let clickTimer = null;
  card.addEventListener("click", event => {
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      onSingleClick(event);
    }, 260);
  });
  card.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    onPreview(event);
  });
}

function bindImagePreviewLightbox(card, options = {}) {
  const getContext = typeof options.getContext === "function" ? options.getContext : () => options;
  const onClick = options.onClick;
  const attachPreview = () => {
    const context = getContext();
    openImagePreviewLightbox(context);
  };
  if (onClick) {
    bindDeferredThumbClick(card, onClick, attachPreview);
  } else {
    card.addEventListener("dblclick", event => {
      event.preventDefault();
      event.stopPropagation();
      attachPreview();
    });
  }
  card.title = card.title
    ? `${card.title} · 双击放大预览`
    : "双击放大预览";
}

function initImagePreviewLightbox() {
  const els = ensureImagePreviewLightboxEls();
  if (!els.root) return;

  els.closeBtn?.addEventListener("click", closeImagePreviewLightbox);
  els.shell?.addEventListener("click", event => {
    if (event.target === els.shell) closeImagePreviewLightbox();
  });
  els.dialog?.addEventListener("click", event => event.stopPropagation());
  els.prevBtn?.addEventListener("click", () => stepPreviewLightbox(-1));
  els.nextBtn?.addEventListener("click", () => stepPreviewLightbox(1));
  els.junkBtn?.addEventListener("click", event => {
    event.stopPropagation();
    markCurrentPreviewAsJunk().catch(showError);
  });
  els.zoomInBtn?.addEventListener("click", () => {
    imagePreviewLightboxState.zoom = Math.min(12, imagePreviewLightboxState.zoom * 1.25);
    applyPreviewTransform();
  });
  els.zoomOutBtn?.addEventListener("click", () => {
    imagePreviewLightboxState.zoom = Math.max(0.2, imagePreviewLightboxState.zoom / 1.25);
    applyPreviewTransform();
  });
  els.zoomResetBtn?.addEventListener("click", () => resetPreviewTransform(true));

  els.stage?.addEventListener("wheel", event => {
    if (!imagePreviewLightboxState.open) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    imagePreviewLightboxState.zoom = Math.max(0.2, Math.min(12, imagePreviewLightboxState.zoom * factor));
    applyPreviewTransform();
  }, { passive: false });

  els.stage?.addEventListener("dblclick", event => {
    if (event.target !== activePreviewImg()) return;
    if (imagePreviewLightboxState.zoom === 1) {
      imagePreviewLightboxState.zoom = 2;
    } else {
      resetPreviewTransform(true);
    }
    applyPreviewTransform();
  });

  els.stage?.addEventListener("pointerdown", event => {
    if (!imagePreviewLightboxState.open || event.button !== 0) return;
    imagePreviewLightboxState.dragging = true;
    imagePreviewLightboxState.dragStartX = event.clientX;
    imagePreviewLightboxState.dragStartY = event.clientY;
    imagePreviewLightboxState.panStartX = imagePreviewLightboxState.panX;
    imagePreviewLightboxState.panStartY = imagePreviewLightboxState.panY;
    els.stage.setPointerCapture(event.pointerId);
    els.stage.classList.add("dragging");
  });
  els.stage?.addEventListener("pointermove", event => {
    if (!imagePreviewLightboxState.dragging) return;
    imagePreviewLightboxState.panX = imagePreviewLightboxState.panStartX + (event.clientX - imagePreviewLightboxState.dragStartX);
    imagePreviewLightboxState.panY = imagePreviewLightboxState.panStartY + (event.clientY - imagePreviewLightboxState.dragStartY);
    applyPreviewTransform();
  });
  const endDrag = event => {
    if (!imagePreviewLightboxState.dragging) return;
    imagePreviewLightboxState.dragging = false;
    els.stage.classList.remove("dragging");
    if (event.pointerId != null) {
      try {
        els.stage.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
  };
  els.stage?.addEventListener("pointerup", endDrag);
  els.stage?.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", event => {
    if (!imagePreviewLightboxState.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeImagePreviewLightbox();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepPreviewLightbox(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepPreviewLightbox(1);
    }
  });

  window.addEventListener("resize", () => {
    if (!imagePreviewLightboxState.open) return;
    resetPreviewTransform(true);
  });
}

initImagePreviewLightbox();
