function isImagePoolWorkspacePair(pair) {
  return Boolean(state.workspaceRoot)
    && state.yoloSource === "workspace"
    && pair?.imagePath?.startsWith("image_pool/");
}

function imageEditBackupRoot() {
  return state.datasetBackendRoot || state.workspaceRoot || "";
}

async function ensureImagePoolBackupBeforeEdit(pair, editMode = "") {
  const root = imageEditBackupRoot();
  if (!root || !pair?.imagePath) return false;
  if (!await ensurePythonBackend()) return false;
  try {
    await backendCall("ensureImagePoolBackup", root, pair.imagePath);
    if (editMode === "crop" && pair.labelPath) {
      await backendCall("ensureImagePoolLabelBackup", root, pair.labelPath);
    }
    return true;
  } catch (error) {
    console.warn("Image edit backup failed:", error);
    return false;
  }
}

async function restoreImagePoolPairFromBackup(pair) {
  const root = imageEditBackupRoot();
  if (!root || !pair?.imagePath) return null;
  if (!await ensurePythonBackend()) {
    alert("需要 Python 后端。");
    return null;
  }
  const result = JSON.parse(
    await backendCall("restoreImagePoolBackup", root, pair.imagePath)
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
