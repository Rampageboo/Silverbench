function bindYoloPageEvents() {
  el.openFolderBtn.addEventListener("click", () => openYoloFolderFlow().catch(showError));
  el.reviewModeBtn.addEventListener("click", toggleReviewMode);
  el.markReviewedBtn.addEventListener("click", () => toggleReviewed().catch(showError));
  el.flagBtn.addEventListener("click", () => toggleFlagged().catch(showError));
  el.sendToCropBtn?.addEventListener("click", () => sendFilteredPairsToCrop());
  el.showAllImagesBtn.addEventListener("click", () => setImageViewMode("all"));
  el.hideReviewedImagesBtn.addEventListener("click", () => setImageViewMode("hideReviewed"));
  el.showFlaggedImagesBtn.addEventListener("click", () => setImageViewMode("flagged"));
  el.nextIssueBtn.addEventListener("click", nextIssue);
  document.getElementById("clearFilterBtn")?.addEventListener("click", clearFilter);
  document.getElementById("clearIncludeBtn")?.addEventListener("click", clearIncludeFilter);
  document.getElementById("clearExcludeBtn")?.addEventListener("click", clearExcludeFilter);
  bindGalleryScroll(el.galleryScroll, () => {
    state.galleryScrollTop = el.galleryScroll.scrollTop || 0;
    renderGallery();
    saveSessionSoon();
  });
  bindGalleryResize(el.galleryScroll, galleryVirtual, () => {
    scrollGalleryNearIndex(state.currentIndex, { onlyIfNeeded: true });
  });
  el.canvas.addEventListener("pointerdown", onPointerDown);
  el.canvas.addEventListener("pointermove", onPointerMove);
  el.canvas.addEventListener("pointerup", onPointerUp);
  el.canvas.addEventListener("pointerleave", onPointerUp);
  el.canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
  el.canvas.addEventListener("contextmenu", event => {
    event.preventDefault();
    if (typeof showYoloDetectContextMenu === "function" && canSendSelectedToDetect()) {
      showYoloDetectContextMenu(event);
    }
  });
  el.canvas.addEventListener("dblclick", resetPreviewView);
  setupViewerResizers();
}
