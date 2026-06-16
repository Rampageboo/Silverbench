const trainState = {
  projectExplicit: false,
  workspaceInfo: null,
  ptDetectSourceExplicit: false,
  ptDetectOutputExplicit: false,
  ptClassifySourceExplicit: false,
  ptClassifyOutputExplicit: false
};

async function prepareValidationSplit() {
  if (!state.datasetBackendRoot) {
    if (el.valSplitStatus) {
      el.valSplitStatus.textContent = "Create Val Split needs a real disk path. Use Open Dataset Folder for the same dataset.";
    }
    setStatus("Create Val Split needs Open Dataset Folder. Browser drag/drop mode cannot move files.");
    return;
  }
  const ratio = Math.max(0.05, Math.min(0.4, Number(el.valSplitRatioInput.value) || 0.15));
  const clfCounts = classificationCounts();
  if (trainTask() === "classify" || (clfCounts.train && !state.allPairs.length)) {
    await prepareClassificationValidationSplit(ratio);
    return;
  }
  const plan = buildValidationSplitPlan(ratio);
  if (!plan.trainPairs) {
    if (clfCounts.train) {
      await prepareClassificationValidationSplit(ratio);
      return;
    }
    alert("No images/train pairs found. For YOLO classification, use a dataset with train/<class_name>/images.");
    return;
  }
  if (plan.valPairs) {
    alert(`Validation set already exists (${plan.valPairs} image(s)). No files were moved.`);
    return;
  }
  if (!plan.imagePaths.length) {
    alert("Could not choose any image/label pairs for val.");
    return;
  }
  if (!confirm(`Create validation split?\n\nThis will move about ${Math.round(ratio * 100)}% of image/label pairs from train to val.\nExisting val files will stop the operation.\n\nDataset: ${state.rootName}`)) {
    return;
  }
  el.prepareValSplitBtn.disabled = true;
  el.valSplitStatus.textContent = `Moving ${plan.imagePaths.length} pair(s) to val...`;
  try {
    const raw = await backendCall("movePairsToVal", state.datasetBackendRoot, JSON.stringify(plan.imagePaths));
    const result = JSON.parse(raw || "{}");
    el.valSplitStatus.textContent = result.message || "Val split finished.";
    if (!result.ok) {
      alert(result.message || "Val split was not created.");
      return;
    }
    await loadFromBackendDatasetPath(state.datasetBackendRoot, state.currentImagePath);
    updateTrainPrepStatus();
    generateTrainCommand();
    let detail = result.message || "Val split finished.";
    if (result.yamlWarning) detail += `\n\nNote: ${result.yamlWarning}`;
    if (result.dataYaml?.updated?.length) detail += `\n\ndata.yaml updated: ${result.dataYaml.updated.join(", ")}`;
    alert(`${detail}\nClasses covered: ${plan.classIds.length}`);
  } finally {
    el.prepareValSplitBtn.disabled = false;
  }
}

async function prepareClassificationValidationSplit(ratio) {
  if (!confirm(`Create classification validation split?\n\nThis will move about ${Math.round(ratio * 100)}% of images from train/<class> to val/<class>.\nAt least one image is kept in train when possible.\n\nDataset: ${state.rootName}`)) {
    return;
  }
  el.prepareValSplitBtn.disabled = true;
  el.valSplitStatus.textContent = "Moving classification images to val...";
  try {
    const raw = await backendCall("prepareClassificationValidationSplit", state.datasetBackendRoot, ratio);
    const result = JSON.parse(raw || "{}");
    el.valSplitStatus.textContent = result.message || "Classification val split finished.";
    if (!result.ok) {
      alert(result.message || "Classification val split was not created.");
      return;
    }
    await loadFromBackendDatasetPath(state.datasetBackendRoot, state.currentImagePath);
    if (el.trainTaskSelect) el.trainTaskSelect.value = "classify";
    updateTrainPrepStatus();
    generateTrainCommand();
    alert(`${result.message}\nClasses: ${(result.classes || []).length}`);
  } finally {
    el.prepareValSplitBtn.disabled = false;
  }
}

async function fixDataYaml() {
  if (!state.datasetBackendRoot) {
    const msg = "Fix data.yaml needs Open Dataset Folder. Browser drag/drop mode cannot write to disk.";
    if (el.valSplitStatus) el.valSplitStatus.textContent = msg;
    setStatus(msg);
    return;
  }
  el.fixDataYamlBtn.disabled = true;
  try {
    const raw = await backendCall("ensureDataYaml", state.datasetBackendRoot);
    const result = JSON.parse(raw || "{}");
    if (!result.ok) {
      alert(result.message || "Could not update data.yaml.");
      if (el.valSplitStatus) el.valSplitStatus.textContent = result.message || "Fix data.yaml failed.";
      return;
    }
    if (el.valSplitStatus) el.valSplitStatus.textContent = result.message || "data.yaml updated.";
    await loadFromBackendDatasetPath(state.datasetBackendRoot, state.currentImagePath);
    updateTrainPrepStatus();
    generateTrainCommand();
    setStatus(result.updated?.length ? `data.yaml updated: ${result.updated.join(", ")}` : "data.yaml is ready.");
  } finally {
    el.fixDataYamlBtn.disabled = false;
  }
}

function buildValidationSplitPlan(ratio) {
  const train = state.allPairs.filter(pair => pair.imagePath.startsWith("images/train/") && pair.labelPath?.startsWith("labels/train/"));
  const valPairs = state.allPairs.filter(pair => pair.imagePath.startsWith("images/val/")).length;
  const classIds = [...new Set(train.flatMap(pair => (pair.boxes || []).map(box => box.classId)))].sort((a, b) => a - b);
  const targetCount = Math.min(train.length, Math.max(1, Math.round(train.length * ratio), classIds.length));
  const chosen = [];
  const chosenPaths = new Set();
  for (const classId of classIds) {
    const candidates = train.filter(pair => !chosenPaths.has(pair.imagePath) && (pair.boxes || []).some(box => box.classId === classId));
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    chosen.push(pick);
    chosenPaths.add(pick.imagePath);
  }
  const remaining = train.filter(pair => !chosenPaths.has(pair.imagePath));
  shuffleInPlace(remaining);
  for (const pair of remaining) {
    if (chosen.length >= targetCount) break;
    chosen.push(pair);
    chosenPaths.add(pair.imagePath);
  }
  return {
    trainPairs: train.length,
    valPairs,
    classIds,
    imagePaths: chosen.map(pair => pair.imagePath)
  };
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function updateTrainPrepStatus() {
  if (!hasDatasetOpen()) {
    el.trainPrepDatasetStatus.textContent = "No dataset loaded";
    if (el.valSplitStatus) el.valSplitStatus.textContent = "Open a YOLO dataset first.";
    if (el.trainDataInput) el.trainDataInput.value = "";
    return;
  }
  const dataPath = trainDataPath();
  if (el.trainDataInput && dataPath) el.trainDataInput.value = dataPath;
  if (trainTask() === "classify") {
    const counts = classificationCounts();
    el.trainPrepDatasetStatus.textContent = `${state.rootName} | train ${counts.train} | val ${counts.val} | classes ${counts.classes}`;
    if (el.valSplitStatus) {
      el.valSplitStatus.textContent = counts.val
        ? `Classification val set already exists (${counts.val} image(s)). Create Val Split will not move files.`
        : "Classification split moves images from train/<class> to val/<class>. No data.yaml is needed.";
    }
    return;
  }
  const trainCount = state.allPairs.filter(pair => pair.imagePath.startsWith("images/train/")).length;
  const valCount = state.allPairs.filter(pair => pair.imagePath.startsWith("images/val/")).length;
  el.trainPrepDatasetStatus.textContent = `${state.rootName} | train ${trainCount} | val ${valCount}`;
  if (el.valSplitStatus) {
    if (valCount) {
      el.valSplitStatus.textContent = `Validation set already exists (${valCount} image(s)). Create Val Split will not move files.`;
    } else if (state.datasetHandle && !state.datasetBackendRoot) {
      el.valSplitStatus.textContent = "Browser folder mode can label normally. Use Open Dataset Folder for Create Val Split / Fix data.yaml.";
    } else {
      el.valSplitStatus.textContent = "YOLO training requires data.yaml with both train: and val:. If there is no val set, run Create Val Split first, then Fix data.yaml.";
    }
  }
}

async function syncTrainProjectWithWorkspace(workspaceRoot, options = {}) {
  const { workspaceChanged = false } = options;
  if (workspaceChanged) {
    trainState.projectExplicit = false;
    trainState.ptDetectSourceExplicit = false;
    trainState.ptDetectOutputExplicit = false;
    trainState.ptClassifySourceExplicit = false;
    trainState.ptClassifyOutputExplicit = false;
  }
  if (!workspaceRoot || !await ensurePythonBackend()) {
    return;
  }
  try {
    const info = JSON.parse(await backendCall("getWorkspaceInfo", workspaceRoot));
    if (!info?.ok) return;
    trainState.workspaceInfo = info;
    if (!trainState.projectExplicit) {
      const task = trainTask();
      const projectPath = task === "classify" ? info.runsClassify : info.runsDetect;
      if (projectPath && el.trainProjectInput) {
        el.trainProjectInput.value = toPosixPath(projectPath);
        if (!el.trainNameInput?.value?.trim()) {
          el.trainNameInput.value = "train";
        }
        const bestPath = `${toPosixPath(projectPath)}/${toPosixPath(el.trainNameInput.value || "train")}/weights/best.pt`;
        ensureSelectOption(el.trainModelSelect, bestPath);
        if (usesBestWeightsMode()) {
          el.trainModelSelect.value = bestPath;
        }
      }
    }
    syncAutoLabelWithWorkspace(info, { workspaceChanged });
    if (el.trainDataInput) el.trainDataInput.value = trainDataPath();
    generateTrainCommand();
  } catch (error) {
    console.warn("Train project sync:", error);
  }
}

window.syncTrainProjectWithWorkspace = syncTrainProjectWithWorkspace;

function syncAutoLabelWithWorkspace(info, options = {}) {
  const { workspaceChanged = false } = options;
  if (!info?.ok) return;
  setInputDefault(el.ptDetectModelInput, info.detectBest, workspaceChanged);
  setInputDefault(el.ptClassifyModelInput, info.clfBest, workspaceChanged);
  if (!trainState.ptDetectSourceExplicit) {
    setInputDefault(el.ptDetectSourceInput, info.detectDataset, workspaceChanged);
  }
  if (!trainState.ptClassifySourceExplicit) {
    setInputDefault(el.ptClassifySourceInput, info.clfDataset, workspaceChanged);
  }
  if (!trainState.ptDetectOutputExplicit) {
    setInputDefault(el.ptDetectOutputInput, info.autoLabelDetectOutput, workspaceChanged);
  }
  if (!trainState.ptClassifyOutputExplicit) {
    setInputDefault(el.ptClassifyOutputInput, info.autoLabelClfOutput, workspaceChanged);
  }
  updatePtDetectStatus();
  updatePtClassifyStatus();
}

function setInputDefault(input, value, force = false) {
  if (!input || !value) return;
  if (force || !input.value) input.value = value;
}

function onTrainTaskChanged() {
  const task = trainTask();
  if (task === "classify") {
    if (!String(el.trainModelSelect.value || "").includes("-cls")) el.trainModelSelect.value = "yolo11n-cls.pt";
    if (!trainState.projectExplicit && !state.workspaceRoot) {
      el.trainProjectInput.value = "runs/classify";
    }
  } else {
    if (String(el.trainModelSelect.value || "").includes("-cls")) el.trainModelSelect.value = "yolo11n.pt";
    if (!trainState.projectExplicit && !state.workspaceRoot) {
      el.trainProjectInput.value = "runs/detect";
    }
  }
  if (state.workspaceRoot) {
    syncTrainProjectWithWorkspace(state.workspaceRoot).catch(error => console.warn("Train project sync:", error));
  }
  if (usesBestWeightsMode()) {
    const bestPath = trainBestWeightsPath();
    ensureSelectOption(el.trainModelSelect, bestPath);
    el.trainModelSelect.value = bestPath;
  }
  if (el.trainDataInput) el.trainDataInput.value = trainDataPath();
  generateTrainCommand();
}

function onTrainCommandModeChanged() {
  if (usesBestWeightsMode()) {
    const bestPath = trainBestWeightsPath();
    if (!String(el.trainModelSelect.value || "").endsWith(".pt")) el.trainModelSelect.value = bestPath;
    if (String(el.trainModelSelect.value || "").startsWith("yolo")) el.trainModelSelect.value = bestPath;
  }
  generateTrainCommand();
}

async function chooseTrainModelFile() {
  if (!await ensurePythonBackend()) {
    alert("Choose Weights needs the Python backend.");
    return;
  }
  const path = await backendCall("chooseTrainModelFile", "Choose best.pt / YOLO Model");
  if (!path) return;
  ensureSelectOption(el.trainModelSelect, path);
  el.trainModelSelect.value = path;
  if (path.toLowerCase().endsWith(".pt") && el.ptClassifyModelInput && !el.ptClassifyModelInput.value) {
    el.ptClassifyModelInput.value = path;
    updatePtClassifyStatus();
  }
  if (path.toLowerCase().endsWith(".pt") && el.ptDetectModelInput && !el.ptDetectModelInput.value) {
    el.ptDetectModelInput.value = path;
    updatePtDetectStatus();
  }
  generateTrainCommand();
}

async function choosePtDetectModel() {
  if (!await ensurePythonBackend()) {
    alert("Detect New Data needs the Python backend.");
    return;
  }
  const path = await backendCall("chooseTrainModelFile", "Choose YOLO Detection best.pt");
  if (!path) return;
  if (!path.toLowerCase().endsWith(".pt")) {
    alert("Choose a .pt detection model.");
    return;
  }
  el.ptDetectModelInput.value = path;
  ensureSelectOption(el.trainModelSelect, path);
  el.trainModelSelect.value = path;
  if (el.trainTaskSelect) el.trainTaskSelect.value = "detect";
  generateTrainCommand();
  updatePtDetectStatus();
}

async function choosePtClassifyModel() {
  if (!await ensurePythonBackend()) {
    alert("Classify New Data needs the Python backend.");
    return;
  }
  const path = await backendCall("chooseTrainModelFile", "Choose YOLO Classification best.pt");
  if (!path) return;
  if (!path.toLowerCase().endsWith(".pt")) {
    alert("Choose a .pt classification model.");
    return;
  }
  el.ptClassifyModelInput.value = path;
  ensureSelectOption(el.trainModelSelect, path);
  el.trainModelSelect.value = path;
  if (el.trainTaskSelect) el.trainTaskSelect.value = "classify";
  generateTrainCommand();
  updatePtClassifyStatus();
}

async function choosePtDirectory(input, title, afterChoose) {
  if (!await ensurePythonBackend()) {
    alert("Folder selection needs the Python backend.");
    return;
  }
  const path = await backendCall("chooseDirectory", title);
  if (!path) return;
  input.value = path;
  if (input === el.ptDetectSourceInput) trainState.ptDetectSourceExplicit = true;
  if (input === el.ptDetectOutputInput) trainState.ptDetectOutputExplicit = true;
  if (input === el.ptClassifySourceInput) trainState.ptClassifySourceExplicit = true;
  if (input === el.ptClassifyOutputInput) trainState.ptClassifyOutputExplicit = true;
  afterChoose?.();
}

async function runPtDetectFolder() {
  if (!await ensurePythonBackend()) {
    alert("Detect New Data needs the Python backend.");
    return;
  }
  const modelPath = el.ptDetectModelInput?.value.trim();
  const onlyNew = Boolean(el.ptDetectOnlyNewInput?.checked);
  const sourcePath = onlyNew ? onlyNewImagePoolSourcePath() : el.ptDetectSourceInput?.value.trim();
  const outputPath = el.ptDetectOutputInput?.value.trim();
  if (!modelPath || !sourcePath || !outputPath) {
    alert(onlyNew
      ? "Open a workspace with image_pool, choose detect best.pt, and choose an output folder first."
      : "Choose detect best.pt, source dataset, and output folder first.");
    return;
  }
  el.runPtDetectBtn.disabled = true;
  if (el.stopPtDetectBtn) el.stopPtDetectBtn.disabled = false;
  showPtProgress(el.ptDetectProgress, 0, 1);
  setPtDetectLog(onlyNew ? "Scanning NEW image_pool images..." : "Running detection and writing YOLO labels...");
  try {
    const imageSize = numberInputValue(el.ptDetectImageSizeInput, 640);
    const confidence = Math.max(0.01, Math.min(1, parseFloat(el.ptDetectConfInput?.value || "0.25")));
    const device = el.ptDetectDeviceInput?.value || "0";
    const onlyNewScope = onlyNew ? await onlyNewImagePoolFilenames("detect") : null;
    const includeFilenames = onlyNewScope?.filenames || [];
    if (onlyNew && !includeFilenames.length) {
      setPtDetectLog(onlyNewScope?.junkSkipped
        ? `No NEW image_pool images to auto label. Skipped ${onlyNewScope.junkSkipped} Detect junk image(s).`
        : "No NEW image_pool images to auto label.");
      return;
    }
    if (onlyNew) {
      const skipText = onlyNewScope.junkSkipped ? `, skipped ${onlyNewScope.junkSkipped} Detect junk` : "";
      setPtDetectLog(`Running detection on ${includeFilenames.length} NEW image_pool image(s)${skipText}...`);
    }
    const result = await runPtJob({
      startMethod: "startDetectFolderWithPt",
      args: [modelPath, sourcePath, outputPath, imageSize, confidence, device, JSON.stringify(includeFilenames)],
      progress: el.ptDetectProgress,
      stopButton: el.stopPtDetectBtn,
      log: setPtDetectLog,
      runningText: "Running detection"
    });
    setPtDetectLog(formatPtDetectResult(result, outputPath));
    updatePtDetectStatus();
  } catch (error) {
    setPtDetectLog(error.message || String(error));
    throw error;
  } finally {
    el.runPtDetectBtn.disabled = false;
    if (el.stopPtDetectBtn) el.stopPtDetectBtn.disabled = true;
  }
}

async function runPtClassifyFolder() {
  if (!await ensurePythonBackend()) {
    alert("Classify New Data needs the Python backend.");
    return;
  }
  const modelPath = el.ptClassifyModelInput?.value.trim();
  const onlyNew = Boolean(el.ptClassifyOnlyNewInput?.checked);
  const sourcePath = onlyNew ? onlyNewImagePoolSourcePath() : el.ptClassifySourceInput?.value.trim();
  const outputPath = el.ptClassifyOutputInput?.value.trim();
  if (!modelPath || !sourcePath || !outputPath) {
    alert(onlyNew
      ? "Open a workspace with image_pool, choose best.pt, and choose an output folder first."
      : "Choose best.pt, source dataset, and output folder first.");
    return;
  }
  el.runPtClassifyBtn.disabled = true;
  if (el.stopPtClassifyBtn) el.stopPtClassifyBtn.disabled = false;
  showPtProgress(el.ptClassifyProgress, 0, 1);
  setPtClassifyLog(onlyNew ? "Scanning NEW image_pool images..." : "Running classification with best.pt...");
  try {
    const imageSize = numberInputValue(el.ptClassifyImageSizeInput, 224);
    const device = el.ptClassifyDeviceInput?.value || "0";
    const onlyNewScope = onlyNew ? await onlyNewImagePoolFilenames("clf") : null;
    const includeFilenames = onlyNewScope?.filenames || [];
    if (onlyNew && !includeFilenames.length) {
      setPtClassifyLog(onlyNewScope?.junkSkipped
        ? `No NEW image_pool images to classify. Skipped ${onlyNewScope.junkSkipped} Clf junk image(s).`
        : "No NEW image_pool images to classify.");
      return;
    }
    if (onlyNew) {
      const skipText = onlyNewScope.junkSkipped ? `, skipped ${onlyNewScope.junkSkipped} Clf junk` : "";
      setPtClassifyLog(`Running classification on ${includeFilenames.length} NEW image_pool image(s)${skipText}...`);
    }
    const result = await runPtJob({
      startMethod: "startClassifyFolderWithPt",
      args: [modelPath, sourcePath, outputPath, imageSize, device, true, JSON.stringify(includeFilenames)],
      progress: el.ptClassifyProgress,
      stopButton: el.stopPtClassifyBtn,
      log: setPtClassifyLog,
      runningText: "Running classification"
    });
    setPtClassifyLog(formatPtClassifyResult(result, outputPath));
    updatePtClassifyStatus();
  } catch (error) {
    setPtClassifyLog(error.message || String(error));
    throw error;
  } finally {
    el.runPtClassifyBtn.disabled = false;
  }
}

function onlyNewImagePoolSourcePath() {
  return trainState.workspaceInfo?.imagePool || (state.workspaceRoot ? `${state.workspaceRoot.replace(/[\\/]$/, "")}\\image_pool` : "");
}

async function onlyNewImagePoolFilenames(scope) {
  if (!state.workspaceRoot) return { filenames: [], junkSkipped: 0, totalNew: 0 };
  const raw = await backendCall("scanImagePool", state.workspaceRoot, "");
  const result = JSON.parse(raw || "{}");
  if (!result?.ok) {
    throw new Error(result?.error || "Could not scan image_pool for NEW files.");
  }
  if (typeof applyImagePoolScanResult === "function") {
    applyImagePoolScanResult(result);
    imagePoolState.scanAt = Date.now();
    imagePoolState.workspaceKey = typeof imagePoolWorkspaceKey === "function" ? imagePoolWorkspaceKey() : state.workspaceRoot;
    if (typeof rebuildInboxPairs === "function") rebuildInboxPairs();
  }
  if (typeof ensureInboxMetadataIndex === "function") {
    await ensureInboxMetadataIndex({ force: true });
  }
  const totalNew = (result.newFiles || []).length;
  const filenames = [...new Set((result.newFiles || [])
    .map(name => String(name || "").trim())
    .filter(Boolean)
    .filter(name => !isOnlyNewJunkFile(name, scope)))];
  return { filenames, junkSkipped: totalNew - filenames.length, totalNew };
}

function isOnlyNewJunkFile(filename, scope) {
  if (typeof isInboxJunkFile === "function") {
    return isInboxJunkFile(filename, scope);
  }
  const row = typeof inboxState !== "undefined" ? inboxState.metadataByFile?.get(filename) : null;
  if (!row) return false;
  if (scope === "detect") return row.detect_junk === "1" || row.detect_junk === true;
  if (scope === "clf") return row.clf_class === "__junk__";
  return row.clf_class === "__junk__" || row.detect_junk === "1" || row.detect_junk === true;
}

async function runPtJob({ startMethod, args, progress, stopButton, log, runningText }) {
  let stopRequested = false;
  const onStop = () => { stopRequested = true; };
  stopButton?.addEventListener("click", onStop);
  try {
    let state = JSON.parse(await backendCall(startMethod, ...args));
    while (!["done", "error", "cancelled"].includes(state.status)) {
      if (stopRequested) await backendCall("cancelPtJob", state.id);
      showPtProgress(progress, state.done || 0, state.total || 1);
      log(`${runningText}: ${state.done || 0}/${state.total || 0}\n${state.detail || ""}`);
      await sleep(250);
      state = JSON.parse(await backendCall("getPtJob", state.id));
    }
    showPtProgress(progress, state.done || 0, state.total || 1);
    if (state.status === "error") {
      throw new Error((state.errors || []).join("\n") || state.detail || "Auto Label failed.");
    }
    return state.result || {};
  } finally {
    stopButton?.removeEventListener("click", onStop);
  }
}

function formatPtDetectResult(result, outputPath) {
  const classLines = Object.entries(result.classes || {}).map(([name, count]) => `${name}: ${count}`).join("\n");
  const errorLines = (result.errors || []).slice(0, 8).map(item => `ERR ${item.path}: ${item.error}`).join("\n");
  return [
    `${result.cancelled ? "Stopped" : "Done"}. ${result.copied || 0}/${result.total || 0} image(s), ${result.labels || 0} label file(s).`,
    `Output: ${result.outputDir || outputPath}`,
    "Created: images/, labels/, data.yaml",
    classLines ? `\nBoxes:\n${classLines}` : "",
    errorLines ? `\nErrors:\n${errorLines}` : "",
  ].filter(Boolean).join("\n");
}

function formatPtClassifyResult(result, outputPath) {
  const classLines = Object.entries(result.classes || {}).map(([name, count]) => `${name}: ${count}`).join("\n");
  const errorLines = (result.errors || []).slice(0, 8).map(item => `ERR ${item.path}: ${item.error}`).join("\n");
  return [
    `${result.cancelled ? "Stopped" : "Done"}. ${result.copied || 0}/${result.total || 0} image(s) copied.`,
    `Output: ${result.outputDir || outputPath}`,
    classLines ? `\nClasses:\n${classLines}` : "",
    errorLines ? `\nErrors:\n${errorLines}` : "",
  ].filter(Boolean).join("\n");
}

function showPtProgress(progress, value, total) {
  if (!progress) return;
  progress.hidden = false;
  progress.max = Math.max(1, total || 1);
  progress.value = Math.max(0, value || 0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updatePtClassifyStatus() {
  if (!el.ptClassifyStatus) return;
  const hasSource = el.ptClassifyOnlyNewInput?.checked ? Boolean(state.workspaceRoot) : Boolean(el.ptClassifySourceInput?.value);
  const ready = Boolean(el.ptClassifyModelInput?.value && hasSource && el.ptClassifyOutputInput?.value);
  el.ptClassifyStatus.textContent = ready ? "Ready" : (el.ptClassifyModelInput?.value ? "Choose source/output" : "No model selected");
}

function updatePtDetectStatus() {
  if (!el.ptDetectStatus) return;
  const hasSource = el.ptDetectOnlyNewInput?.checked ? Boolean(state.workspaceRoot) : Boolean(el.ptDetectSourceInput?.value);
  const ready = Boolean(el.ptDetectModelInput?.value && hasSource && el.ptDetectOutputInput?.value);
  el.ptDetectStatus.textContent = ready ? "Ready" : (el.ptDetectModelInput?.value ? "Choose source/output" : "No model selected");
}

function setPtClassifyLog(message) {
  if (el.ptClassifyLog) el.ptClassifyLog.textContent = message;
  setStatus(message.split("\n")[0] || message);
}

function setPtDetectLog(message) {
  if (el.ptDetectLog) el.ptDetectLog.textContent = message;
  setStatus(message.split("\n")[0] || message);
}

function trainCommandMode() {
  const value = el.trainCommandModeSelect?.value;
  return ["train", "continue-train", "export-onnx"].includes(value) ? value : "train";
}

function trainTask() {
  return el.trainTaskSelect?.value === "classify" ? "classify" : "detect";
}

function trainBestWeightsPath() {
  const project = toPosixPath(el.trainProjectInput?.value || (trainTask() === "classify" ? "runs/classify" : "runs/detect")).replace(/\/$/, "");
  const name = toPosixPath(el.trainNameInput?.value || "train").replace(/^\/+|\/+$/g, "");
  return `${project}/${name}/weights/best.pt`;
}

function usesBestWeightsMode() {
  return ["continue-train", "export-onnx"].includes(trainCommandMode());
}

function ensureSelectOption(select, value) {
  if (!select || [...select.options].some(option => option.value === value)) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

function generateTrainCommand() {
  const task = trainTask();
  const mode = trainCommandMode();
  if (mode === "export-onnx") {
    const modelPath = toPosixPath(el.trainModelSelect.value || trainBestWeightsPath());
    const args = [
      "yolo", "export",
      `model=${shellArg(modelPath)}`,
      "format=onnx",
      `imgsz=${numberInputValue(el.trainImageSizeInput, task === "classify" ? 224 : 640)}`,
      `device=${shellArg(el.trainDeviceInput.value || "0")}`
    ];
    el.trainCommandText.value = args.join(" ");
    return el.trainCommandText.value;
  }
  const dataPath = toPosixPath(el.trainDataInput?.value.trim() || trainDataPath());
  const args = [
    "yolo", task, "train",
    `model=${shellArg(el.trainModelSelect.value)}`,
    `data=${shellArg(dataPath || (task === "classify" ? "dataset" : "data.yaml"))}`,
    `epochs=${numberInputValue(el.trainEpochsInput, 100)}`,
    `batch=${numberInputValue(el.trainBatchInput, 16)}`,
    `imgsz=${numberInputValue(el.trainImageSizeInput, 640)}`,
    `device=${shellArg(el.trainDeviceInput.value || "0")}`,
    `workers=${numberInputValue(el.trainWorkersInput, 8)}`,
    `project=${shellArg(el.trainProjectInput.value || "runs/detect")}`,
    `name=${shellArg(el.trainNameInput.value || "train")}`
  ];
  el.trainCommandText.value = args.join(" ");
  return el.trainCommandText.value;
}

async function copyTrainCommand() {
  const text = generateTrainCommand();
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Training/export command copied.");
  } catch {
    el.trainCommandText.focus();
    el.trainCommandText.select();
  }
}

function datasetDataYamlPath() {
  if (state.yoloSource === "workspace" && trainState.workspaceInfo?.detectTrainData) {
    return toPosixPath(trainState.workspaceInfo.detectTrainData);
  }
  if (state.datasetBackendRoot) {
    return `${toPosixPath(state.datasetBackendRoot.replace(/[\\/]$/, ""))}/data.yaml`;
  }
  if (state.files.has("data.yaml")) return "data.yaml";
  return "";
}

function trainDataPath() {
  if (trainTask() === "classify") {
    if (state.yoloSource === "workspace" && trainState.workspaceInfo?.clfTrainData) {
      return toPosixPath(trainState.workspaceInfo.clfTrainData);
    }
    if (state.datasetBackendRoot) return toPosixPath(state.datasetBackendRoot.replace(/[\\/]$/, ""));
    return state.rootName || "";
  }
  return datasetDataYamlPath();
}

function classificationCounts() {
  const classNames = new Set();
  let train = 0;
  let val = 0;
  for (const path of state.files.keys()) {
    if (!IMAGE_EXTENSIONS.has(ext(path))) continue;
    const parts = path.split("/");
    if (parts.length < 3) continue;
    if (parts[0] === "train") {
      train += 1;
      classNames.add(parts[1]);
    } else if (parts[0] === "val") {
      val += 1;
      classNames.add(parts[1]);
    }
  }
  return { train, val, classes: classNames.size };
}

function bindTrainPageEvents() {
  el.trainPrepOpenDatasetBtn.addEventListener("click", openDatasetFolder);
  el.prepareValSplitBtn.addEventListener("click", () => prepareValidationSplit().catch(showError));
  el.fixDataYamlBtn?.addEventListener("click", () => fixDataYaml().catch(showError));
  el.generateTrainCommandBtn.addEventListener("click", generateTrainCommand);
  el.chooseTrainModelFileBtn?.addEventListener("click", () => chooseTrainModelFile().catch(showError));
  el.trainCommandModeSelect?.addEventListener("change", onTrainCommandModeChanged);
  el.trainTaskSelect?.addEventListener("change", onTrainTaskChanged);
  el.trainProjectInput?.addEventListener("input", () => {
    trainState.projectExplicit = true;
    generateTrainCommand();
  });
  el.trainNameInput?.addEventListener("input", () => {
    if (usesBestWeightsMode()) {
      const bestPath = trainBestWeightsPath();
      ensureSelectOption(el.trainModelSelect, bestPath);
      el.trainModelSelect.value = bestPath;
    }
    generateTrainCommand();
  });
  el.copyTrainCommandBtn.addEventListener("click", copyTrainCommand);
  el.choosePtDetectModelBtn?.addEventListener("click", () => choosePtDetectModel().catch(showError));
  el.choosePtDetectSourceBtn?.addEventListener("click", () => choosePtDirectory(el.ptDetectSourceInput, "Choose New Image Folder", updatePtDetectStatus).catch(showError));
  el.choosePtDetectOutputBtn?.addEventListener("click", () => choosePtDirectory(el.ptDetectOutputInput, "Choose Auto-Labeled Output Folder", updatePtDetectStatus).catch(showError));
  el.ptDetectOnlyNewInput?.addEventListener("change", updatePtDetectStatus);
  el.runPtDetectBtn?.addEventListener("click", () => runPtDetectFolder().catch(showError));
  el.choosePtClassifyModelBtn?.addEventListener("click", () => choosePtClassifyModel().catch(showError));
  el.choosePtClassifySourceBtn?.addEventListener("click", () => choosePtDirectory(el.ptClassifySourceInput, "Choose New Image Folder", updatePtClassifyStatus).catch(showError));
  el.choosePtClassifyOutputBtn?.addEventListener("click", () => choosePtDirectory(el.ptClassifyOutputInput, "Choose Classified Output Folder", updatePtClassifyStatus).catch(showError));
  el.ptClassifyOnlyNewInput?.addEventListener("change", updatePtClassifyStatus);
  el.runPtClassifyBtn?.addEventListener("click", () => runPtClassifyFolder().catch(showError));
}
