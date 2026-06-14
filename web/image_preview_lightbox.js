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

const PREVIEW_FILMSTRIP_ITEM_STEP = 72;
const PREVIEW_FILMSTRIP_WINDOW_RADIUS = 36;
let previewFilmstripScrollBound = false;

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
  if (typeof releaseMediaUrl === "function") releaseMediaUrl(url);
  else if (!String(url).startsWith("data:")) URL.revokeObjectURL(url);
  if (url === imagePreviewLightboxState.objectUrl) {
    imagePreviewLightboxState.objectUrl = null;
  }
}

function resolveInstantPreviewSrc(imagePath, imageHandle, options = {}) {
  if (options.instantSrc) return options.instantSrc;
  if (typeof getCachedObjectUrl === "function") {
    const cached = getCachedObjectUrl(imagePath);
    if (cached) return cached;
  }
  return null;
}

function showInstantPreviewImage(targetImg, instantSrc, token) {
  if (!targetImg || !instantSrc) return false;
  resetPreviewImageLayout(targetImg);
  const applyFit = () => {
    if (token !== imagePreviewLightboxState.loadToken) return;
    const els = ensureImagePreviewLightboxEls();
    imagePreviewLightboxState.zoom = 1;
    imagePreviewLightboxState.panX = 0;
    imagePreviewLightboxState.panY = 0;
    imagePreviewLightboxState.fitZoom = computePreviewFitZoom(targetImg, els.stage);
    applyPreviewTransform(targetImg);
    if (!els.stage.clientWidth || !els.stage.clientHeight) schedulePreviewFit();
  };
  const onReady = () => {
    targetImg.onload = null;
    targetImg.onerror = null;
    applyFit();
  };
  targetImg.onload = onReady;
  targetImg.onerror = () => {
    targetImg.onload = null;
    targetImg.onerror = null;
  };
  if (targetImg.src === instantSrc && targetImg.complete && targetImg.naturalWidth > 0) {
    targetImg.onload = null;
    targetImg.onerror = null;
    applyFit();
    return true;
  }
  targetImg.src = instantSrc;
  if (targetImg.complete && targetImg.naturalWidth > 0) {
    targetImg.onload = null;
    targetImg.onerror = null;
    applyFit();
  }
  return true;
}

async function createPreviewObjectUrl(imagePath, imageHandle, options = {}) {
  const maxEdge = options.maxEdge || PREVIEW_MAX_EDGE;
  const handle = resolvePreviewImageHandle(imagePath, imageHandle);
  if (!handle) throw new Error(`找不到图片: ${imagePath}`);
  if (
    typeof previewObjectUrlForBackendHandle === "function"
    && typeof backendImageHandle === "function"
    && backendImageHandle(handle)
  ) {
    const url = await previewObjectUrlForBackendHandle(handle, maxEdge, PREVIEW_JPEG_QUALITY);
    if (url) return url;
  }
  const file = await handle.getFile();
  if (typeof objectUrlForFile === "function") return objectUrlForFile(file);
  return URL.createObjectURL(file);
}

async function loadPreviewImageElement(img, url) {
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

function previewFilmstripWindowRange(center, total) {
  const safeCenter = Math.max(0, Math.min(total - 1, Number.isInteger(center) ? center : 0));
  const start = Math.max(0, safeCenter - PREVIEW_FILMSTRIP_WINDOW_RADIUS);
  const end = Math.min(total, safeCenter + PREVIEW_FILMSTRIP_WINDOW_RADIUS + 1);
  return { start, end, center: safeCenter };
}

function createPreviewFilmstripItem(pair, itemIndex) {
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
  loadPreviewFilmstripThumb(img, pair.imagePath, pair.imageHandle);
  return button;
}

function bindPreviewFilmstripScroll() {
  if (previewFilmstripScrollBound) return;
  const els = ensureImagePreviewLightboxEls();
  if (!els.filmstrip) return;
  els.filmstrip.addEventListener("scroll", () => {
    if (!imagePreviewLightboxState.open || !imagePreviewLightboxState.showFilmstrip) return;
    schedulePreviewFilmstripRefresh();
  }, { passive: true });
  previewFilmstripScrollBound = true;
}

let previewFilmstripRefreshTimer = null;
function schedulePreviewFilmstripRefresh() {
  clearTimeout(previewFilmstripRefreshTimer);
  previewFilmstripRefreshTimer = setTimeout(() => {
    previewFilmstripRefreshTimer = null;
    updatePreviewFilmstrip({ preserveScroll: true });
  }, 48);
}

function scrollPreviewFilmstripToIndex(index, behavior = "auto") {
  const els = ensureImagePreviewLightboxEls();
  if (!els.filmstrip || !imagePreviewLightboxState.pairs?.length) return;
  const targetLeft = Math.max(
    0,
    index * PREVIEW_FILMSTRIP_ITEM_STEP - Math.max(0, (els.filmstrip.clientWidth - PREVIEW_FILMSTRIP_ITEM_STEP) / 2)
  );
  els.filmstrip.scrollTo({ left: targetLeft, behavior });
}

function clearPreviewFilmstrip() {
  const els = ensureImagePreviewLightboxEls();
  if (els.filmstripTrack) els.filmstripTrack.replaceChildren();
  if (els.filmstrip) els.filmstrip.hidden = true;
  if (els.dialog) els.dialog.classList.remove("has-filmstrip");
}

function syncPreviewFilmstripActive() {
  const els = ensureImagePreviewLightboxEls();
  if (!els.filmstripTrack || els.filmstrip?.hidden) return;
  const { index } = imagePreviewLightboxState;
  const items = els.filmstripTrack.querySelectorAll(".image-preview-filmstrip-item");
  items.forEach(item => {
    const itemIndex = Number.parseInt(item.dataset.index || "", 10);
    const active = itemIndex === index;
    item.classList.toggle("active", active);
  });
}

function updatePreviewFilmstrip(options = {}) {
  const els = ensureImagePreviewLightboxEls();
  const { pairs, showFilmstrip } = imagePreviewLightboxState;
  bindPreviewFilmstripScroll();
  if (!showFilmstrip || !Array.isArray(pairs) || pairs.length <= 1 || !els.filmstripTrack) {
    clearPreviewFilmstrip();
    return;
  }

  const { start, end, center } = previewFilmstripWindowRange(imagePreviewLightboxState.index, pairs.length);
  const preserveScroll = options.preserveScroll === true;
  const previousScrollLeft = preserveScroll ? (els.filmstrip?.scrollLeft || 0) : null;

  els.filmstrip.hidden = false;
  els.dialog?.classList.add("has-filmstrip");
  els.filmstripTrack.replaceChildren();

  const spacerBefore = document.createElement("div");
  spacerBefore.className = "image-preview-filmstrip-spacer";
  spacerBefore.style.flex = `0 0 ${start * PREVIEW_FILMSTRIP_ITEM_STEP}px`;
  els.filmstripTrack.appendChild(spacerBefore);

  for (let itemIndex = start; itemIndex < end; itemIndex += 1) {
    els.filmstripTrack.appendChild(createPreviewFilmstripItem(pairs[itemIndex], itemIndex));
  }

  const spacerAfter = document.createElement("div");
  spacerAfter.className = "image-preview-filmstrip-spacer";
  spacerAfter.style.flex = `0 0 ${Math.max(0, pairs.length - end) * PREVIEW_FILMSTRIP_ITEM_STEP}px`;
  els.filmstripTrack.appendChild(spacerAfter);

  if (preserveScroll && previousScrollLeft != null) {
    els.filmstrip.scrollLeft = previousScrollLeft;
  } else {
    scrollPreviewFilmstripToIndex(center, "auto");
  }
  syncPreviewFilmstripActive();
}

function patchPreviewFilmstripJunkState(filename, isJunk) {
  const els = ensureImagePreviewLightboxEls();
  if (!els.filmstripTrack || els.filmstrip?.hidden) return;
  const { pairs, index } = imagePreviewLightboxState;
  const pair = pairs?.[index];
  if (!pair || pair.imagePath.split("/").pop() !== filename) return;
  const item = els.filmstripTrack.querySelector(`.image-preview-filmstrip-item[data-index="${index}"]`);
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
  updatePreviewFilmstrip({ preserveScroll: false });
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
  const instantSrc = resolveInstantPreviewSrc(imagePath, imageHandle, options);
  const els = ensureImagePreviewLightboxEls();
  const token = ++imagePreviewLightboxState.loadToken;
  const previousUrl = imagePreviewLightboxState.objectUrl;
  const targetImg = silent ? bufferPreviewImg() : activePreviewImg();

  imagePreviewLightboxState.imagePath = imagePath;
  els.title.textContent = imagePath.split("/").pop() || imagePath;
  updatePreviewNavControls();

  if (!silent && instantSrc) {
    showInstantPreviewImage(targetImg, instantSrc, token);
  } else if (!silent) {
    els.meta.textContent = "加载中…";
  }

  let nextUrl = null;
  const previewEdge = imagePreviewLightboxState.previewContext === "image-pool"
    ? (typeof PREVIEW_FAST_EDGE !== "undefined" ? PREVIEW_FAST_EDGE : PREVIEW_MAX_EDGE)
    : PREVIEW_MAX_EDGE;
  try {
    nextUrl = await createPreviewObjectUrl(imagePath, imageHandle, { maxEdge: previewEdge });
    if (token !== imagePreviewLightboxState.loadToken) {
      if (typeof releaseMediaUrl === "function") releaseMediaUrl(nextUrl);
      else if (!String(nextUrl).startsWith("data:")) URL.revokeObjectURL(nextUrl);
      return;
    }

    imagePreviewLightboxState.zoom = 1;
    imagePreviewLightboxState.panX = 0;
    imagePreviewLightboxState.panY = 0;
    resetPreviewImageLayout(targetImg);

    await loadPreviewImageElement(targetImg, nextUrl);
    if (token !== imagePreviewLightboxState.loadToken) {
      if (typeof releaseMediaUrl === "function") releaseMediaUrl(nextUrl);
      else if (!String(nextUrl).startsWith("data:")) URL.revokeObjectURL(nextUrl);
      return;
    }

    imagePreviewLightboxState.objectUrl = nextUrl;
    if (previousUrl && previousUrl !== nextUrl) {
      if (typeof releaseMediaUrl === "function") releaseMediaUrl(previousUrl);
      else if (!String(previousUrl).startsWith("data:")) URL.revokeObjectURL(previousUrl);
    }

    setActivePreviewImg(targetImg === els.imgB ? "b" : "a");
    schedulePreviewFit();
    updatePreviewNavControls();
    syncPreviewFilmstripActive();

    if (
      previewEdge < PREVIEW_MAX_EDGE
      && imagePreviewLightboxState.previewContext === "image-pool"
      && token === imagePreviewLightboxState.loadToken
    ) {
      createPreviewObjectUrl(imagePath, imageHandle, { maxEdge: PREVIEW_MAX_EDGE })
        .then(fullUrl => {
          if (!fullUrl || token !== imagePreviewLightboxState.loadToken) {
            if (fullUrl && fullUrl !== nextUrl && typeof releaseMediaUrl === "function") releaseMediaUrl(fullUrl);
            return;
          }
          if (fullUrl === nextUrl) return;
          const img = activePreviewImg();
          return loadPreviewImageElement(img, fullUrl).then(() => {
            if (token !== imagePreviewLightboxState.loadToken) {
              if (typeof releaseMediaUrl === "function") releaseMediaUrl(fullUrl);
              return;
            }
            const oldUrl = imagePreviewLightboxState.objectUrl;
            imagePreviewLightboxState.objectUrl = fullUrl;
            if (oldUrl && oldUrl !== fullUrl && typeof releaseMediaUrl === "function") releaseMediaUrl(oldUrl);
            schedulePreviewFit();
          });
        })
        .catch(() => {});
    }
  } catch (error) {
    if (token !== imagePreviewLightboxState.loadToken) {
      if (nextUrl) {
        if (typeof releaseMediaUrl === "function") releaseMediaUrl(nextUrl);
        else if (!String(nextUrl).startsWith("data:")) URL.revokeObjectURL(nextUrl);
      }
      return;
    }
    if (nextUrl && nextUrl !== previousUrl) {
      if (typeof releaseMediaUrl === "function") releaseMediaUrl(nextUrl);
      else if (!String(nextUrl).startsWith("data:")) URL.revokeObjectURL(nextUrl);
    }
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
    showFilmstrip = false,
    instantSrc = null
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
  updatePreviewJunkButton();
  const resolvedInstant = resolveInstantPreviewSrc(imagePath, imageHandle, { instantSrc });
  showImageInPreviewLightbox(imagePath, imageHandle, {
    silent: false,
    instantSrc: resolvedInstant
  }).catch(showError);
  requestAnimationFrame(() => updatePreviewFilmstrip());
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
  const junkContext = typeof resolveJunkContextFromPreview === "function"
    ? resolveJunkContextFromPreview(ctx)
    : null;
  if (!junkContext) return;
  const scope = typeof resolveJunkScope === "function" ? resolveJunkScope(junkContext) : "clf";
  const scopeLabel = scope === "detect" ? "Detect" : "Clf";
  const isJunk = typeof isInboxJunkFile === "function" && isInboxJunkFile(filename, scope);
  const runner = isJunk ? runJunkUnmark : runJunkMark;
  if (typeof runner !== "function") return;

  imagePreviewLightboxState.markingJunk = true;
  updatePreviewJunkButton();
  try {
    const result = await runner(junkContext, {
      filenames: [filename],
      clearSelection: false,
      skipGridRender: true,
      quiet: true
    });
    if (!result) return;
    patchPreviewFilmstripJunkState(filename, isInboxJunkFile(filename, scope));
    if (ctx === "image-pool" && typeof refreshImagePoolAfterJunkChange === "function") {
      refreshImagePoolAfterJunkChange({ selectionOnly: true });
    }
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
    const cardImg = card.querySelector("img");
    let instantSrc = null;
    if (cardImg?.src && cardImg.dataset.srcPending !== "true" && cardImg.complete && cardImg.naturalWidth > 0) {
      instantSrc = cardImg.src;
    }
    openImagePreviewLightbox({ ...context, instantSrc });
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
  card.addEventListener("mousedown", () => {
    const context = getContext();
    if (!context?.imagePath) return;
    const instantSrc = resolveInstantPreviewSrc(context.imagePath, context.imageHandle, context);
    if (instantSrc) return;
    const edge = context.previewContext === "image-pool" && typeof PREVIEW_FAST_EDGE !== "undefined"
      ? PREVIEW_FAST_EDGE
      : PREVIEW_MAX_EDGE;
    createPreviewObjectUrl(context.imagePath, context.imageHandle, { maxEdge: edge }).catch(() => {});
  }, { passive: true });
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
