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
  document.getElementById("addEditBtn").addEventListener("click", addPendingEdit);
  document.getElementById("clearSelectionBtn").addEventListener("click", clearSelection);
  document.getElementById("undoLastBtn").addEventListener("click", undoLastPendingEdit);
  document.getElementById("undoImageBtn").addEventListener("click", undoCurrentPending);
  document.getElementById("repeatOneBtn").addEventListener("click", () => repeatBlackBox(1).catch(showError));
  document.getElementById("repeatManyBtn").addEventListener("click", () => repeatBlackBoxToShift().catch(showError));
  document.getElementById("applyBlackBtn").addEventListener("click", () => applyCurrentBlackEdits().catch(showError));
  document.getElementById("applyAllBlackBtn").addEventListener("click", () => applyAllPendingBlackEdits().catch(showError));
  document.getElementById("chooseBackupBtn").addEventListener("click", chooseBackupFolder);
  document.getElementById("restoreBackupBtn").addEventListener("click", restoreFromBackup);
  document.getElementById("clearFilterBtn").addEventListener("click", clearFilter);
  document.getElementById("clearIncludeBtn").addEventListener("click", clearIncludeFilter);
  document.getElementById("clearExcludeBtn").addEventListener("click", clearExcludeFilter);
  document.getElementById("selectAllSelectedClassesBtn").addEventListener("click", () => setSelectedClassesChecked(true));
  document.getElementById("clearSelectedClassesBtn").addEventListener("click", () => setSelectedClassesChecked(false));
  document.getElementById("addSelectedClassesIncludeBtn").addEventListener("click", () => addSelectedClassesToFilter("include"));
  document.getElementById("addSelectedClassesExcludeBtn").addEventListener("click", () => addSelectedClassesToFilter("exclude"));
  document.getElementById("removeSelectedClassesBtn").addEventListener("click", () => removeSelectedClassesFromImages().catch(showError));
  el.addClassFolderBtn?.addEventListener("click", () => addClassificationFolder().catch(showError));
  el.moveSelectedToClassBtn?.addEventListener("click", () => moveSelectedImagesToClass().catch(showError));
  document.getElementById("updateBoxBtn").addEventListener("click", updateSelectedBox);
  document.getElementById("deleteBoxBtn").addEventListener("click", deleteSelectedBox);
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
