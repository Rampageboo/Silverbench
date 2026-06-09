function isImagePoolWorkspacePair(pair) {
  return Boolean(state.workspaceRoot)
    && state.yoloSource === "workspace"
    && pair?.imagePath?.startsWith("image_pool/");
}

async function ensureImagePoolBackupBeforeEdit(pair, editMode = "") {
  if (!isImagePoolWorkspacePair(pair)) return false;
  if (!await ensurePythonBackend()) return false;
  try {
    await backendCall("ensureImagePoolBackup", state.workspaceRoot, pair.imagePath);
    if (editMode === "crop" && pair.labelPath?.startsWith("detect_labels/")) {
      await backendCall("ensureImagePoolLabelBackup", state.workspaceRoot, pair.labelPath);
    }
    return true;
  } catch (error) {
    console.warn("Image pool backup failed:", error);
    return false;
  }
}

async function restoreImagePoolPairFromBackup(pair) {
  if (!isImagePoolWorkspacePair(pair)) return null;
  if (!await ensurePythonBackend()) {
    alert("需要 Python 后端。");
    return null;
  }
  const result = JSON.parse(
    await backendCall("restoreImagePoolBackup", state.workspaceRoot, pair.imagePath)
  );
  if (!result?.ok) return null;

  invalidateImageCache(pair.imagePath);
  removeCachedObjectUrl(pair.imagePath);
  bitmapCache.delete(pair.imagePath);
  if (result.labelPath && pair.labelPath) {
    state.labelCache.delete(pair.imagePath);
    state.labelEdits.delete(pair.imagePath);
    const boxes = await readBoxesForPair(pair);
    setBoxesCache(pair, boxes);
  }
  return result;
}

async function refreshImagePoolBackupHint() {
  if (!state.workspaceRoot || !await ensurePythonBackend()) return;
  try {
    const stats = JSON.parse(await backendCall("getImagePoolBackupStats", state.workspaceRoot));
    const btn = document.getElementById("restoreBackupBtn");
    if (btn && state.yoloSource === "workspace") {
      btn.title = stats.imageCount
        ? `从 image_pool_backup 恢复（已备份 ${stats.imageCount} 张原图）`
        : "从 image_pool_backup 恢复（尚无备份）";
    }
  } catch {
    // ignore
  }
}
