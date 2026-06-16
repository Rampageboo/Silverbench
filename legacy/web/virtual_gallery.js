const GALLERY_THUMB_MAX_SIZE = 128;

const thumbLoadQueue = {
  active: 0,
  max: 4,
  pending: []
};

function createVirtualGalleryState(defaultRowHeight = 132) {
  return { rowHeight: defaultRowHeight, columns: 1, startIndex: -1, endIndex: -1, startRow: 0, _rangeKey: "", _itemCount: 0 };
}

function computeVirtualGalleryLayout({
  scrollEl,
  itemCount,
  columnUnit = 138,
  gap = 10,
  rowExtra = 50,
  aspectRatio = 10 / 16
}) {
  const width = Math.max(1, (scrollEl?.clientWidth || scrollEl?.offsetWidth || 640) - 24);
  const columns = Math.max(1, Math.floor(width / columnUnit));
  const columnWidth = (width - Math.max(0, columns - 1) * gap) / columns;
  const rowHeight = Math.ceil(columnWidth * aspectRatio + rowExtra);
  const totalRows = Math.ceil(Math.max(itemCount, 1) / columns);
  const scrollTop = scrollEl?.scrollTop || 0;
  const viewportRows = Math.ceil((scrollEl?.clientHeight || scrollEl?.offsetHeight || 480) / Math.max(rowHeight, 1));
  const startRow = Math.max(0, Math.floor(scrollTop / Math.max(rowHeight, 1)) - 2);
  const endRow = Math.min(totalRows, startRow + viewportRows + 5);
  return {
    columns,
    rowHeight,
    totalRows,
    startRow,
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns)
  };
}

function virtualGalleryRangeKey(layout, itemCount) {
  return `${itemCount}:${layout.columns}:${layout.rowHeight}:${layout.startRow}:${layout.startIndex}:${layout.endIndex}`;
}

function invalidateVirtualGallery(virtual) {
  if (!virtual) return;
  virtual._rangeKey = "";
  virtual._itemCount = -1;
}

function renderVirtualGallery({
  galleryEl,
  virtual,
  itemCount,
  layout,
  thumbObserver,
  renderCard,
  patchCard
}) {
  if (!itemCount) {
    galleryEl.replaceChildren();
    galleryEl.style.height = "";
    virtual._rangeKey = "";
    virtual._itemCount = 0;
    return;
  }

  const rangeKey = virtualGalleryRangeKey(layout, itemCount);
  const rangeChanged = virtual._rangeKey !== rangeKey || virtual._itemCount !== itemCount;

  galleryEl.style.height = `${layout.totalRows * layout.rowHeight}px`;
  galleryEl.style.setProperty("--gallery-columns", layout.columns);
  virtual.columns = layout.columns;
  virtual.rowHeight = layout.rowHeight;
  virtual.startIndex = layout.startIndex;
  virtual.endIndex = layout.endIndex;
  virtual.startRow = layout.startRow;
  virtual._rangeKey = rangeKey;
  virtual._itemCount = itemCount;

  const windowEl = galleryEl.querySelector(":scope > .gallery-window");
  if (!rangeChanged && windowEl) {
    if (typeof patchCard === "function") {
      for (let index = layout.startIndex; index < layout.endIndex; index++) {
        const card = windowEl.children[index - layout.startIndex];
        if (card) patchCard(index, card);
      }
    }
    return;
  }

  if (windowEl) {
    windowEl.remove();
  }

  const nextWindow = document.createElement("div");
  nextWindow.className = "gallery-window";
  nextWindow.style.top = `${layout.startRow * layout.rowHeight}px`;
  nextWindow.style.setProperty("--gallery-columns", layout.columns);
  galleryEl.appendChild(nextWindow);

  for (let index = layout.startIndex; index < layout.endIndex; index++) {
    const card = renderCard(index, nextWindow);
    const img = card?.querySelector?.("img[data-path]");
    if (!img) continue;
    const imagePath = img.dataset.path;
    const cachedThumb = getCachedObjectUrl(imagePath);
    if (cachedThumb) {
      img.src = cachedThumb;
      img.dataset.srcPending = "false";
      continue;
    }
    if (thumbObserver) thumbObserver.observe(img);
  }
}

function bindGalleryScroll(scrollEl, renderFn) {
  const key = UI_FRAME?.GALLERY_SCROLL || "gallery-scroll";
  scrollEl.addEventListener("scroll", () => {
    scheduleUiFrame(key, renderFn);
  }, { passive: true });
}

function bindGalleryResize(scrollEl, virtual, renderFn) {
  if (!scrollEl || typeof ResizeObserver === "undefined") return;
  const key = UI_FRAME?.GALLERY_RESIZE || "gallery-resize";
  const observer = new ResizeObserver(() => {
    invalidateVirtualGallery(virtual);
    scheduleUiFrame(key, renderFn);
  });
  observer.observe(scrollEl);
}

function createLazyThumbObserver(scrollRoot, loadFn, rootMargin = "180px") {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      observer.unobserve(img);
      queueGalleryThumbLoad(img, loadFn);
    }
  }, { root: scrollRoot, rootMargin });
  return observer;
}

function queueGalleryThumbLoad(img, loadFn) {
  thumbLoadQueue.pending.push({ img, loadFn });
  drainThumbLoadQueue();
}

function drainThumbLoadQueue() {
  while (thumbLoadQueue.active < thumbLoadQueue.max && thumbLoadQueue.pending.length) {
    const job = thumbLoadQueue.pending.shift();
    thumbLoadQueue.active += 1;
    Promise.resolve(job.loadFn(job.img))
      .catch(() => {
        job.img.dataset.srcPending = "false";
        job.img.alt = "预览失败";
      })
      .finally(() => {
        thumbLoadQueue.active -= 1;
        drainThumbLoadQueue();
      });
  }
}

async function resolveGalleryThumbUrl(imagePath, imageHandle) {
  const cached = getCachedObjectUrl(imagePath);
  if (cached) return cached;
  if (state.workspaceRoot && imagePath.startsWith("image_pool/")) {
    const filename = imagePath.split("/").pop();
    const url = await thumbObjectUrlForImagePool(filename, GALLERY_THUMB_MAX_SIZE);
    return setCachedObjectUrl(imagePath, url);
  }
  if (
    typeof previewObjectUrlForBackendHandle === "function"
    && typeof backendImageHandle === "function"
    && backendImageHandle(imageHandle)
  ) {
    const url = await previewObjectUrlForBackendHandle(imageHandle, GALLERY_THUMB_MAX_SIZE, THUMB_JPEG_QUALITY);
    if (url) return setCachedObjectUrl(imagePath, url);
  }
  return fileUrl(imagePath, imageHandle);
}

async function loadGalleryThumbImage(img) {
  const imagePath = img.dataset.path;
  const cached = getCachedObjectUrl(imagePath);
  if (cached) {
    img.src = cached;
    img.dataset.srcPending = "false";
    return;
  }
  let imageHandle = state.allPairs?.find(item => item.imagePath === imagePath)?.imageHandle;
  if (!imageHandle && imagePath.startsWith("image_pool/") && state.workspaceRoot) {
    imageHandle = imagePoolState.files?.get(imagePath)
      || backendFileHandle(state.workspaceRoot, imagePath);
  }
  if (!imageHandle) return;
  try {
    img.src = await resolveGalleryThumbUrl(imagePath, imageHandle);
    img.dataset.srcPending = "false";
  } catch {
    img.dataset.srcPending = "false";
    img.alt = "预览失败";
  }
}
