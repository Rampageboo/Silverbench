    async function duplicateSelectedImages() {
      if (!maskNoiseState.folderBackendRoot || !maskNoiseState.folderItems.length) {
        alert("Import a Mask Cleanup image folder first.");
        return;
      }
      const items = maskNoiseSelectedItems();
      if (!items.length) {
        alert("Select image thumbnails in the Mask Cleanup grid first.");
        return;
      }
      const minCopies = Math.max(0, numberInputValue(el.duplicateMinInput, 1));
      const maxCopies = Math.max(0, numberInputValue(el.duplicateMaxInput, 3));
      const low = Math.min(minCopies, maxCopies);
      const high = Math.max(minCopies, maxCopies);
      el.duplicateStatus.textContent = `Duplicating ${items.length} image(s)...`;
      setMaskNoiseLog(`Duplicating ${items.length} Mask Cleanup selected image(s).\nRange: ${low}-${high} copies per image.`);
      const result = JSON.parse(await backendCall(
        "duplicateImages",
        maskNoiseState.folderBackendRoot,
        JSON.stringify(items.map(item => item.path)),
        low,
        high
      ));
      await loadMaskNoiseFolderFromRoot(maskNoiseState.folderBackendRoot, new Set(result.created || []));
      const skipped = result.skipped?.length ? `\nSkipped: ${result.skipped.length}` : "";
      const message = `Duplicate complete.\nSource images: ${result.sourceImages}\nCreated images: ${result.createdImages}\nCreated labels: ${result.createdLabels}${skipped}`;
      el.duplicateStatus.textContent = `${result.createdImages} image(s) created`;
      setMaskNoiseLog(message);
      setStatus(`Duplicated ${result.createdImages} image(s).`);
    }

async function importMaskNoiseFolder() {
      revokeMaskFolderUrls();
      maskNoiseState.gridCards.clear();
      el.maskFolderGrid.innerHTML = "";
      if (!await ensurePythonBackend()) {
        alert("Mask Cleanup folder import now requires the Python backend.");
        return;
      }
      const rootPath = await backendCall("chooseDirectory", "Choose Image Folder");
      if (!rootPath) return;
      await loadMaskNoiseFolderFromRoot(rootPath);
      const count = maskNoiseState.folderItems.length;
      setMaskNoiseLog(`Imported ${count} image(s) from ${maskNoiseState.folderName}.\nClick thumbnails to select/preview. Ctrl toggles, Shift selects a range.`);
    }

    async function loadMaskNoiseFolderFromRoot(rootPath, selectedPaths = new Set()) {
      const sameRoot = maskNoiseState.folderBackendRoot === rootPath;
      if (!sameRoot) {
        revokeMaskFolderUrls();
        maskNoiseState.gridCards.clear();
        el.maskFolderGrid.innerHTML = "";
      }
      maskNoiseState.selectedPaths = new Set(selectedPaths);
      maskNoiseState.anchorPath = "";
      const paths = JSON.parse(await backendCall("listDatasetFiles", rootPath))
        .filter(path => IMAGE_EXTENSIONS.has(ext(path)))
        .sort(naturalCompare);
      maskNoiseState.folderBackendRoot = rootPath;
      maskNoiseState.folderName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
      maskNoiseState.folderItems = paths.map(path => ({
        name: path.split("/").pop(),
        path,
        backendPath: backendJoinPath(rootPath, path),
        handle: backendFileHandle(rootPath, path)
      }));
      maskNoiseState.selectedPaths = new Set([...maskNoiseState.selectedPaths].filter(path => paths.includes(path)));
      maskNoiseState.anchorPath = [...maskNoiseState.selectedPaths][0] || "";
      await renderMaskFolderGrid();
      updateMaskDuplicateStatus();
    }

    async function chooseMaskNoiseOutputFolder() {
      if (await ensurePythonBackend()) {
        const path = await backendCall("chooseDirectory", "Choose Mask Cleanup Output Folder");
        if (!path) return;
        maskNoiseState.outputBackendRoot = path;
        maskNoiseState.outputHandle = null;
        maskNoiseState.outputName = path;
      } else {
        alert("Mask Cleanup output now requires the Python backend.");
        return;
      }
      setMaskNoiseLog(`${maskNoiseSummary()}\nOutput: ${maskNoiseState.outputName}`);
    }

    async function renderMaskFolderGrid() {
      const items = maskNoiseState.folderItems;
      if (!items.length) {
        maskNoiseState.gridCards.clear();
        el.maskFolderGrid.innerHTML = `<div class="empty">No images found.</div>`;
        return;
      }
      const shown = items.slice(0, 500);
      const shownPaths = new Set(shown.map(item => item.path));
      el.maskFolderGrid.querySelector(".empty")?.remove();
      for (const [path, card] of [...maskNoiseState.gridCards.entries()]) {
        if (!shownPaths.has(path)) {
          card.remove();
          maskNoiseState.gridCards.delete(path);
        }
      }
      for (let index = 0; index < shown.length; index += 1) {
        const item = shown[index];
        let card = maskNoiseState.gridCards.get(item.path);
        if (!card) {
          card = await createMaskFolderCard(item);
          maskNoiseState.gridCards.set(item.path, card);
        }
        card.dataset.index = String(index);
        card.classList.toggle("selected", maskNoiseState.selectedPaths.has(item.path));
        if (el.maskFolderGrid.children[index] !== card) el.maskFolderGrid.insertBefore(card, el.maskFolderGrid.children[index] || null);
      }
      let more = el.maskFolderGrid.querySelector("[data-mask-more]");
      if (items.length > shown.length) {
        if (!more) {
          more = document.createElement("div");
          more.className = "empty";
          more.dataset.maskMore = "true";
        }
        more.textContent = `Showing first ${shown.length}/${items.length} images.`;
        el.maskFolderGrid.appendChild(more);
      } else if (more) {
        more.remove();
      }
    }

    async function createMaskFolderCard(item) {
      const card = document.createElement("div");
      card.className = "mask-folder-item";
      card.dataset.path = item.path;
      const img = document.createElement("img");
      img.alt = item.name;
      img.src = await maskFolderItemUrl(item);
      img.loading = "lazy";
      const name = document.createElement("div");
      name.className = "mask-folder-name";
      name.textContent = item.path;
      const actions = document.createElement("div");
      actions.className = "mask-folder-actions";
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const current = maskNoiseState.folderItems.find(entry => entry.path === card.dataset.path);
        if (!current) return;
        deleteMaskFolderItem(current).catch(showError);
      });
      actions.append(deleteBtn);
      card.append(img, name, actions);
      card.addEventListener("click", event => {
        const current = maskNoiseState.folderItems.find(entry => entry.path === card.dataset.path);
        if (!current) return;
        onMaskFolderItemClick(event, current, Number(card.dataset.index) || 0).catch(showError);
      });
      return card;
    }

    async function maskFolderItemUrl(item) {
      if (maskNoiseState.folderUrls.has(item.path)) return maskNoiseState.folderUrls.get(item.path);
      const url = URL.createObjectURL(await item.handle.getFile());
      maskNoiseState.folderUrls.set(item.path, url);
      return url;
    }

    async function useMaskFolderItemAsPhoto(item) {
      maskNoiseState.photoPath = item.backendPath || "";
      await loadMaskNoiseFile(await item.handle.getFile(), "photo", { backendPath: maskNoiseState.photoPath });
      setMaskNoiseLog(`${maskNoiseSummary()}\nSelected photo: ${item.path}`);
    }

    async function onMaskFolderItemClick(event, item, index) {
      const shown = maskNoiseState.folderItems.slice(0, 500);
      if (event.shiftKey && maskNoiseState.anchorPath) {
        const anchorIndex = shown.findIndex(entry => entry.path === maskNoiseState.anchorPath);
        const start = Math.max(0, Math.min(anchorIndex >= 0 ? anchorIndex : index, index));
        const end = Math.max(anchorIndex >= 0 ? anchorIndex : index, index);
        maskNoiseState.selectedPaths.clear();
        for (let i = start; i <= end; i += 1) maskNoiseState.selectedPaths.add(shown[i].path);
      } else if (event.ctrlKey || event.metaKey) {
        if (maskNoiseState.selectedPaths.has(item.path)) maskNoiseState.selectedPaths.delete(item.path);
        else maskNoiseState.selectedPaths.add(item.path);
        maskNoiseState.anchorPath = item.path;
      } else {
        maskNoiseState.selectedPaths.clear();
        maskNoiseState.selectedPaths.add(item.path);
        maskNoiseState.anchorPath = item.path;
      }
      await useMaskFolderItemAsPhoto(item);
      updateMaskFolderSelectionClasses();
      updateMaskDuplicateStatus();
    }

    async function deleteMaskFolderItem(item) {
      if (!maskNoiseState.folderBackendRoot) {
        alert("Import a Mask Cleanup image folder first.");
        return;
      }
      const selected = maskNoiseState.selectedPaths.has(item.path) ? maskNoiseSelectedItems() : [item];
      if (!selected.length) return;
      const preview = selected.slice(0, 8).map(entry => entry.path).join("\n");
      const more = selected.length > 8 ? `\n...and ${selected.length - 8} more` : "";
      if (!confirm(`Delete ${selected.length} image(s) from the Mask Cleanup folder?\nMatching .txt labels will also be deleted.\n\n${preview}${more}`)) {
        return;
      }
      const deletePaths = selected.map(entry => entry.path);
      const deletedSet = new Set(deletePaths);
      const result = JSON.parse(await backendCall("deleteImages", maskNoiseState.folderBackendRoot, JSON.stringify(deletePaths)));
      for (const path of result.deleted || []) {
        const url = maskNoiseState.folderUrls.get(path);
        if (url) URL.revokeObjectURL(url);
        maskNoiseState.folderUrls.delete(path);
      }
      const keepSelected = new Set([...maskNoiseState.selectedPaths].filter(path => !deletedSet.has(path)));
      if (deletePaths.some(path => backendJoinPath(maskNoiseState.folderBackendRoot, path) === maskNoiseState.photoPath)) {
        clearMaskNoisePhotoPreview();
      }
      await loadMaskNoiseFolderFromRoot(maskNoiseState.folderBackendRoot, keepSelected);
      const skipped = result.skipped?.length ? `\nSkipped: ${result.skipped.length}` : "";
      setMaskNoiseLog(`Deleted ${result.deletedImages} image(s) and ${result.deletedLabels} label(s).${skipped}`);
      setStatus(`Deleted ${result.deletedImages} Mask Cleanup image(s).`);
    }

    function maskNoiseSelectedItems() {
      return maskNoiseState.folderItems.filter(item => maskNoiseState.selectedPaths.has(item.path));
    }

    function updateMaskDuplicateStatus() {
      if (!el.duplicateStatus) return;
      const selected = maskNoiseSelectedItems().length;
      const total = maskNoiseState.folderItems.length;
      el.duplicateStatus.textContent = total ? `${selected}/${total} selected` : "No grid selection";
    }

    function updateMaskFolderSelectionClasses() {
      for (const [path, card] of maskNoiseState.gridCards.entries()) {
        card.classList.toggle("selected", maskNoiseState.selectedPaths.has(path));
      }
    }

    function clearMaskNoisePhotoPreview() {
      maskNoiseState.photoFile = null;
      maskNoiseState.photoBitmap = null;
      maskNoiseState.photoPath = "";
      maskNoiseState.outputReady = false;
      for (const canvas of [el.maskOriginalCanvas, el.maskOutputCanvas, el.maskDiffCanvas]) {
        const canvasCtx = canvas.getContext("2d");
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      }
      updateMaskNoiseStatus();
    }

    function revokeMaskFolderUrls() {
      for (const url of maskNoiseState.folderUrls?.values?.() || []) URL.revokeObjectURL(url);
      maskNoiseState.folderUrls?.clear?.();
      maskNoiseState.gridCards.clear();
    }

    async function chooseMaskNoiseImage(kind) {
      if (!await ensurePythonBackend()) {
        alert("Mask Cleanup image selection now requires the Python backend.");
        return;
      }
      const title = kind === "mask" ? "Choose Black/White Mask" : "Choose Photo";
      const path = await backendCall("chooseImageFile", title);
      if (!path) return;
      await loadMaskNoisePath(path, kind);
    }

    async function loadMaskNoisePath(path, kind) {
      const name = path.split(/[\\/]/).pop() || path;
      const base64 = await backendCall("readImageFileBase64", path);
      const image = await drawBase64ImageToCanvas(kind === "mask" ? el.maskMapCanvas : el.maskOriginalCanvas, base64);
      if (kind === "mask") {
        maskNoiseState.maskFile = { name };
        maskNoiseState.maskBitmap = { width: image.naturalWidth, height: image.naturalHeight };
        maskNoiseState.maskPath = path;
      } else {
        maskNoiseState.photoFile = { name };
        maskNoiseState.photoBitmap = { width: image.naturalWidth, height: image.naturalHeight };
        maskNoiseState.photoPath = path;
        await drawBase64ImageToCanvas(el.maskOutputCanvas, base64);
      }
      maskNoiseState.outputReady = false;
      updateMaskNoiseStatus();
      setMaskNoiseLog(maskNoiseSummary());
      setStatus(kind === "mask" ? `${name} mask loaded.` : `${name} photo loaded.`);
    }

    async function loadMaskNoiseFile(file, kind, options = {}) {
      if (!isImageFileLike(file)) {
        alert("Choose an image file.");
        return;
      }
      if (!await ensurePythonBackend()) {
        alert("Mask Cleanup now requires the Python backend.");
        return;
      }
      const bitmap = await createImageBitmap(file);
      const backendPath = options.backendPath || await backendCall("saveMaskNoiseTempImage", file.name || `${kind}.png`, await cropBlobToBase64(file), state.workspaceRoot || "");
      if (kind === "mask") {
        maskNoiseState.maskFile = file;
        maskNoiseState.maskBitmap = bitmap;
        maskNoiseState.maskPath = backendPath;
        drawBitmapToMaskCanvas(el.maskMapCanvas, bitmap);
      } else {
        maskNoiseState.photoFile = file;
        maskNoiseState.photoBitmap = bitmap;
        maskNoiseState.photoPath = backendPath;
        drawBitmapToMaskCanvas(el.maskOriginalCanvas, bitmap);
        drawBitmapToMaskCanvas(el.maskOutputCanvas, bitmap);
      }
      maskNoiseState.outputReady = false;
      updateMaskNoiseStatus();
      setMaskNoiseLog(maskNoiseSummary());
      setStatus(kind === "mask" ? `${file.name} mask loaded.` : `${file.name} photo loaded.`);
    }

    function drawBitmapToMaskCanvas(canvas, bitmap) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const canvasCtx = canvas.getContext("2d");
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      canvasCtx.drawImage(bitmap, 0, 0);
    }

    async function generateMaskNoise() {
      if (!maskNoiseState.photoPath || !maskNoiseState.maskPath) {
        alert("Open both a photo and a black/white mask first.");
        return;
      }
      const settings = maskNoiseSettings();
      const payload = JSON.parse(await backendCall("maskNoisePreview", maskNoiseState.photoPath, maskNoiseState.maskPath, JSON.stringify(settings)));
      await drawBase64ImageToCanvas(el.maskOutputCanvas, payload.outputBase64);
      await drawBase64ImageToCanvas(el.maskDiffCanvas, payload.diffBase64);
      maskNoiseState.outputReady = true;
      const result = payload.stats || {};
      const affected = result.affected ?? result.changed ?? 0;
      const pct = result.total
        ? ((affected / result.total) * 100).toFixed(1)
        : "0.0";
      const message = `Backend generated ${affected} affected pixel(s) (${pct}%).\nblack noise=${result.changed || 0}, gray erase=${result.grayChanged || 0}\nmean delta=${Number(result.meanDelta || 0).toFixed(2)}, max delta=${Number(result.maxDelta || 0).toFixed(1)}\nblack<=${settings.threshold}, gray<=${settings.grayMax}, noise sigma=${settings.noiseAmount}, blur=${settings.blurRadius}`;
      setMaskNoiseLog(message);
      setStatus("Mask noise generated.");
    }

    function maskNoiseSettings() {
      return {
        threshold: Math.max(0, Math.min(255, Math.round(Number(el.maskBlackThresholdInput.value) || 0))),
        noiseAmount: Math.max(0, Math.min(255, Math.round(Number(el.maskNoiseAmountInput.value) || 0))),
        blurRadius: Math.max(0, Math.min(40, Math.round(Number(el.maskBlurRadiusInput.value) || 0))),
        effectMix: Math.max(0, Math.min(1, Number(el.maskFineNoiseInput.value) || 0)),
        grayMax: Math.max(0, Math.min(255, Math.round(Number(el.maskGrayMaxInput.value) || 0))),
        grayMix: Math.max(0, Math.min(1, Number(el.maskGrayMixInput.value) || 0))
      };
    }

    async function saveMaskNoiseOutput() {
      if (!maskNoiseState.photoPath || !maskNoiseState.maskPath) {
        alert("Open both a photo and a black/white mask first.");
        return;
      }
      if (!maskNoiseState.outputBackendRoot) {
        alert("Choose an output folder first.");
        return;
      }
      const result = JSON.parse(await backendCall(
        "maskNoiseSaveOne",
        maskNoiseState.photoPath,
        maskNoiseState.maskPath,
        maskNoiseState.outputBackendRoot,
        JSON.stringify(maskNoiseSettings())
      ));
      await drawBase64ImageToCanvas(el.maskOutputCanvas, result.outputBase64);
      await drawBase64ImageToCanvas(el.maskDiffCanvas, result.diffBase64);
      maskNoiseState.outputReady = true;
      setMaskNoiseLog(`${maskNoiseSummary()}\nSaved: ${result.output}`);
    }

    async function exportAllMaskNoise() {
      if (!maskNoiseState.maskPath) {
        alert("Open or drop one black/white mask first.");
        return;
      }
      if (!maskNoiseState.folderBackendRoot || !maskNoiseState.folderItems.length) {
        alert("Import a folder of photos first.");
        return;
      }
      if (!maskNoiseState.outputBackendRoot) {
        alert("Choose an output folder first.");
        return;
      }
      const settings = maskNoiseSettings();
      const total = maskNoiseState.folderItems.length;
      setMaskNoiseLog(`Exporting ${total} image(s) to ${maskNoiseState.outputName || "output"}...`);
      const result = JSON.parse(await backendCall(
        "maskNoiseExportFolder",
        maskNoiseState.folderBackendRoot,
        maskNoiseState.maskPath,
        maskNoiseState.outputBackendRoot,
        JSON.stringify(settings)
      ));
      if (result.firstPreview) {
        const item = maskNoiseState.folderItems[0];
        if (item) await loadMaskNoiseFile(await item.handle.getFile(), "photo", { backendPath: item.backendPath });
        await drawBase64ImageToCanvas(el.maskOutputCanvas, result.firstPreview.outputBase64);
        await drawBase64ImageToCanvas(el.maskDiffCanvas, result.firstPreview.diffBase64);
        maskNoiseState.outputReady = true;
      }
      const errorText = result.errors?.length ? `\nErrors:\n${result.errors.join("\n")}` : "";
      setMaskNoiseLog(`Backend export complete.\nExported ${result.exported}/${result.total}, failed ${result.failed}.\nOutput: ${result.output}${errorText}`);
      setStatus(`Mask noise export complete: ${result.exported}/${result.total}`);
    }

    function setMaskNoiseLog(text) {
      if (el.maskNoiseLog) el.maskNoiseLog.textContent = text;
    }

    function updateMaskNoiseStatus() {
      const photo = maskNoiseState.photoBitmap
        ? `photo ${maskNoiseState.photoBitmap.width}x${maskNoiseState.photoBitmap.height}`
        : "no photo";
      const mask = maskNoiseState.maskBitmap
        ? `mask ${maskNoiseState.maskBitmap.width}x${maskNoiseState.maskBitmap.height}`
        : "no mask";
      el.maskNoiseStatus.textContent = `${photo} | ${mask}`;
    }

    function maskNoiseSummary() {
      const lines = [];
      if (maskNoiseState.photoFile && maskNoiseState.photoBitmap) {
        lines.push(`Photo: ${maskNoiseState.photoFile.name} (${maskNoiseState.photoBitmap.width}x${maskNoiseState.photoBitmap.height})`);
      } else {
        lines.push("Photo: not loaded");
      }
      if (maskNoiseState.maskFile && maskNoiseState.maskBitmap) {
        lines.push(`Mask: ${maskNoiseState.maskFile.name} (${maskNoiseState.maskBitmap.width}x${maskNoiseState.maskBitmap.height})`);
      } else {
        lines.push("Mask: not loaded");
      }
      if (maskNoiseState.folderItems.length) lines.push(`Folder: ${maskNoiseState.folderItems.length} photo(s) imported`);
      if (maskNoiseState.outputName) lines.push(`Output: ${maskNoiseState.outputName}`);
      lines.push("Generate previews one photo. Export All processes every imported photo in Python.");
      return lines.join("\n");
    }

    function backendJoinPath(root, relativePath) {
      return `${String(root || "").replace(/[\\/]+$/, "")}/${String(relativePath || "").replace(/^[/\\]+/, "")}`;
    }

    function drawBase64ImageToCanvas(canvas, base64) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const canvasCtx = canvas.getContext("2d");
          canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
          canvasCtx.drawImage(image, 0, 0);
          resolve(image);
        };
        image.onerror = () => reject(new Error("Failed to load backend image preview."));
        image.src = `data:image/png;base64,${base64}`;
      });
    }

function bindMaskNoisePageEvents() {
  document.getElementById("importMaskFolderBtn").addEventListener("click", () => importMaskNoiseFolder().catch(showError));
  document.getElementById("chooseMaskOutputBtn").addEventListener("click", () => chooseMaskNoiseOutputFolder().catch(showError));
  document.getElementById("exportAllMaskNoiseBtn").addEventListener("click", () => exportAllMaskNoise().catch(showError));
  document.getElementById("openMaskPhotoBtn").addEventListener("click", () => chooseMaskNoiseImage("photo").catch(showError));
  document.getElementById("openMaskMapBtn").addEventListener("click", () => chooseMaskNoiseImage("mask").catch(showError));
  document.getElementById("generateMaskNoiseBtn").addEventListener("click", () => generateMaskNoise().catch(showError));
  document.getElementById("saveMaskNoiseBtn").addEventListener("click", () => saveMaskNoiseOutput().catch(showError));
  document.getElementById("duplicateSelectedBtn").addEventListener("click", () => duplicateSelectedImages().catch(showError));
  el.maskPhotoInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) loadMaskNoiseFile(file, "photo").catch(showError);
    event.target.value = "";
  });
  el.maskMapInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) loadMaskNoiseFile(file, "mask").catch(showError);
    event.target.value = "";
  });
  el.maskDropZone.addEventListener("dragover", event => {
    event.preventDefault();
    event.stopPropagation();
    el.maskDropZone.classList.add("drop-hover");
  });
  el.maskDropZone.addEventListener("dragleave", () => {
    el.maskDropZone.classList.remove("drop-hover");
  });
  el.maskDropZone.addEventListener("drop", event => {
    event.preventDefault();
    event.stopPropagation();
    el.maskDropZone.classList.remove("drop-hover");
    const file = droppedImageFiles(event)[0];
    if (file) loadMaskNoiseFile(file, "mask").catch(showError);
    else alert("Drop one black/white mask image here.");
  });
}
