	    function updateCropDatasetStatus() {
      if (!el.cropDatasetStatus) return;
      if (!hasDatasetOpen()) {
        el.cropDatasetStatus.textContent = "No dataset loaded";
        renderBatchCropClassAnchors();
        return;
      }
      if (state.datasetTask === "classify") {
        el.cropDatasetStatus.textContent = `${state.rootName} | classify | ${state.allPairs.length} images`;
      } else {
        const withBoxes = state.allPairs.filter(pair => (pair.boxes || []).length).length;
        el.cropDatasetStatus.textContent = `${state.rootName} | ${withBoxes}/${state.allPairs.length} images with boxes`;
      }
      renderBatchCropClassAnchors();
    }

    async function previewSmartCrop() {
      if (!hasDatasetOpen()) {
        alert("Open a YOLO dataset first.");
        return;
      }
      const pair = state.pairs[state.currentIndex];
      if (!pair) {
        alert("Select an image first.");
        return;
      }
      const settings = smartCropSettings();
      const bitmap = await imageBitmapForPair(pair);
      const boxes = await boxesFor(pair);
      state.smartCropPreviewPlans = chooseSmartCropPlans(bitmap.width, bitmap.height, boxes, settings);
      await renderCurrentImage();
      if (!state.smartCropPreviewPlans.length) {
        setCropLog("Preview: no valid crop for this image with the current size/margin.");
        return;
      }
      const summary = state.smartCropPreviewPlans
        .map((plan, index) => `crop ${index + 1}: ${plan.rect.w}x${plan.rect.h}, ${plan.boxes.length} box(es)`)
        .join("\n");
      setCropLog(`Preview current image:\n${summary}\nApply writes all dataset crops into smart_crops_TIMESTAMP.`);
    }

    async function runSmartCrop() {
      if (!hasDatasetOpen()) {
        alert("Open a YOLO dataset first.");
        return;
      }
      if (!state.datasetHandle && !state.datasetBackendRoot) {
        alert("Open a writable YOLO dataset first.");
        return;
      }
      const settings = smartCropSettings();
      const pairs = state.allPairs.filter(pair => (pair.boxes || []).length);
      if (!pairs.length) {
        alert("No labeled images found.");
        return;
      }
      cropState.stopRequested = false;
      const runId = cropRunId();
      const outputPrefix = `smart_crops_${runId}`;
      const stats = { images: 0, crops: 0, skipped: 0, boxes: 0, failed: 0 };
      const trainLines = [];
      const log = [
        `Smart crop run ${runId}`,
        `Target: ${settings.targetW}x${settings.targetH}, max ${settings.maxPerImage}/image, box margin ${settings.boxMarginPx}px`
      ];
      const runBtn = document.getElementById("applySmartCropBtn");
      const stopBtn = document.getElementById("stopSmartCropBtn");
      runBtn.disabled = true;
      stopBtn.disabled = false;
      try {
        for (let index = 0; index < pairs.length; index += 1) {
          if (cropState.stopRequested) {
            log.push("Stopped by user.");
            break;
          }
          const pair = pairs[index];
          setStatus(`Smart crop ${index + 1}/${pairs.length}: ${pair.imagePath}`);
          if (index % 10 === 0) {
            setCropLog(`${log.join("\n")}\nProcessing ${index + 1}/${pairs.length}: ${pair.imagePath}`);
            await yieldToUi();
          }
          try {
            const result = await cropPairIntoOutputs(pair, settings, runId, outputPrefix, trainLines);
            stats.images += 1;
            stats.crops += result.crops;
            stats.boxes += result.boxes;
            if (!result.crops) stats.skipped += 1;
          } catch (error) {
            stats.failed += 1;
            log.push(`FAILED ${pair.imagePath}: ${error.message}`);
          }
        }
        await writeCropDatasetFiles(trainLines, outputPrefix);
        const summary = `Done. Source images ${stats.images}, crops ${stats.crops}, boxes kept ${stats.boxes}, skipped ${stats.skipped}, failed ${stats.failed}.`;
        log.push(summary);
        log.push(`Output folder: ${outputPrefix}`);
        setCropLog(log.join("\n"));
        setStatus(summary);
        alert(summary);
      } finally {
        runBtn.disabled = false;
        stopBtn.disabled = true;
      }
    }

    function smartCropSettings() {
      return {
        targetW: Math.max(64, Math.round(Number(el.cropTargetWInput.value) || 2560)),
        targetH: Math.max(64, Math.round(Number(el.cropTargetHInput.value) || 1440)),
        maxPerImage: Math.max(1, Math.min(12, Math.round(Number(el.cropMaxPerImageInput.value) || 3))),
        boxMarginPx: Math.max(0, Math.min(1000, Math.round(Number(el.cropBoxMarginInput.value) || 0)))
      };
    }

    async function cropPairIntoOutputs(pair, settings, runId, outputPrefix, trainLines) {
      const bitmap = await imageBitmap(pair.imageHandle);
      const boxes = await boxesFor(pair);
      const plans = chooseSmartCropPlans(bitmap.width, bitmap.height, boxes, settings);
      if (!plans.length) return { crops: 0, boxes: 0 };
      const extension = outputImageExtension(pair.imagePath);
      const mime = mimeFor(pair.imagePath);
      const stem = sanitizeCropFilename(pair.imagePath.split("/").pop().replace(/\.[^.]+$/, ""));
      const hash = smallPathHash(pair.imagePath);
      let keptBoxes = 0;

      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index];
        const canvas = document.createElement("canvas");
        canvas.width = plan.rect.w;
        canvas.height = plan.rect.h;
        canvas.getContext("2d").drawImage(
          bitmap,
          plan.rect.x,
          plan.rect.y,
          plan.rect.w,
          plan.rect.h,
          0,
          0,
          plan.rect.w,
          plan.rect.h
        );
        const name = `${stem}_${hash}_${runId}_crop${String(index + 1).padStart(2, "0")}`;
        const imagePath = `images/crops/${name}.${extension}`;
        const labelPath = `labels/crops/${name}.txt`;
        const blob = await canvasBlob(canvas, mime);
        await writeCropOutputBlob(`${outputPrefix}/${imagePath}`, blob);
        await writeCropOutputText(`${outputPrefix}/${labelPath}`, boxesToText(plan.boxes));
        trainLines.push(imagePath);
        keptBoxes += plan.boxes.length;
      }
      return { crops: plans.length, boxes: keptBoxes };
    }

    function chooseSmartCropPlans(imageW, imageH, boxes, settings) {
      const size = cropSizeForImage(imageW, imageH, settings.targetW, settings.targetH);
      const pixelBoxes = boxes.map((box, index) => ({ index, classId: box.classId, rect: yoloBoxToPixelRect(box, imageW, imageH) }))
        .filter(item => item.rect.w > 1 && item.rect.h > 1);
      if (!pixelBoxes.length) return [];
      for (const item of pixelBoxes) {
        item.marginRect = expandRect(item.rect, settings.boxMarginPx);
      }

      const candidates = new Map();
      const addCandidate = (x, y) => {
        const rect = {
          x: Math.round(Math.max(0, Math.min(imageW - size.w, x))),
          y: Math.round(Math.max(0, Math.min(imageH - size.h, y))),
          w: size.w,
          h: size.h
        };
        const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
        if (!candidates.has(key)) candidates.set(key, cropPlanForRect(rect, pixelBoxes, settings.boxMarginPx));
      };
      const addCentered = (cx, cy) => addCandidate(cx - size.w / 2, cy - size.h / 2);
      const allRect = unionRects(pixelBoxes.map(item => item.marginRect));
      addCentered(allRect.x + allRect.w / 2, allRect.y + allRect.h / 2);
      addCandidate(allRect.x, allRect.y);
      addCandidate(allRect.x + allRect.w - size.w, allRect.y + allRect.h - size.h);
      addCandidate(allRect.x, allRect.y + allRect.h - size.h);
      addCandidate(allRect.x + allRect.w - size.w, allRect.y);
      addCentered(imageW / 2, imageH / 2);
      for (const item of pixelBoxes) {
        addCentered(item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h / 2);
        addCandidate(item.marginRect.x, item.marginRect.y);
        addCandidate(item.marginRect.x + item.marginRect.w - size.w, item.marginRect.y + item.marginRect.h - size.h);
      }

      const plans = [...candidates.values()].filter(plan => plan.boxes.length);
      const selected = [];
      const covered = new Set();
      while (selected.length < settings.maxPerImage) {
        let best = null;
        let bestScore = -Infinity;
        for (const plan of plans) {
          if (selected.some(existing => rectIou(plan.rect, existing.rect) > 0.82)) continue;
          const newBoxes = plan.sourceBoxIndexes.filter(index => !covered.has(index)).length;
          if (!newBoxes && selected.length) continue;
          const score = newBoxes * 10000 + plan.boxes.length * 1000 + plan.marginScore - plan.emptyPenalty;
          if (score > bestScore) {
            best = plan;
            bestScore = score;
          }
        }
        if (!best) break;
        selected.push(best);
        for (const index of best.sourceBoxIndexes) covered.add(index);
      }
      return selected;
    }

    function cropPlanForRect(rect, pixelBoxes, marginPx) {
      const outBoxes = [];
      const sourceBoxIndexes = [];
      let marginScore = 0;
      for (const item of pixelBoxes) {
        if (!rectIntersection(rect, item.rect)) continue;
        if (!rectContainsWithMargin(rect, item.rect, marginPx)) {
          return { rect, boxes: [], sourceBoxIndexes: [], marginScore: 0, emptyPenalty: rectArea(rect), invalid: true };
        }
        const edgeClearance = Math.min(
          item.rect.x - rect.x,
          item.rect.y - rect.y,
          rect.x + rect.w - item.rect.x - item.rect.w,
          rect.y + rect.h - item.rect.y - item.rect.h
        );
        outBoxes.push({
          classId: item.classId,
          x: (item.rect.x - rect.x + item.rect.w / 2) / rect.w,
          y: (item.rect.y - rect.y + item.rect.h / 2) / rect.h,
          w: item.rect.w / rect.w,
          h: item.rect.h / rect.h
        });
        sourceBoxIndexes.push(item.index);
        marginScore += Math.min(edgeClearance, marginPx * 2 || edgeClearance);
      }
      const keptRect = outBoxes.length
        ? unionRects(sourceBoxIndexes.map(index => pixelBoxes.find(item => item.index === index).rect))
        : { x: 0, y: 0, w: 0, h: 0 };
      const emptyPenalty = rectArea(keptRect) ? rectArea(rect) / Math.max(1, rectArea(keptRect)) : rectArea(rect);
      return { rect, boxes: outBoxes, sourceBoxIndexes, marginScore, emptyPenalty };
    }

    function cropSizeForImage(imageW, imageH, targetW, targetH) {
      const aspect = targetW / targetH;
      let w = Math.min(targetW, imageW);
      let h = Math.round(w / aspect);
      if (h > imageH) {
        h = Math.min(targetH, imageH);
        w = Math.round(h * aspect);
      }
      w = Math.max(1, Math.min(imageW, w));
      h = Math.max(1, Math.min(imageH, h));
      return { w, h };
    }

    function yoloBoxToPixelRect(box, imageW, imageH) {
      const x1 = clamp01(box.x - box.w / 2) * imageW;
      const y1 = clamp01(box.y - box.h / 2) * imageH;
      const x2 = clamp01(box.x + box.w / 2) * imageW;
      const y2 = clamp01(box.y + box.h / 2) * imageH;
      return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
    }

    function expandRect(rect, margin) {
      return {
        x: rect.x - margin,
        y: rect.y - margin,
        w: rect.w + margin * 2,
        h: rect.h + margin * 2
      };
    }

    function rectContainsWithMargin(crop, box, margin) {
      return box.x >= crop.x + margin
        && box.y >= crop.y + margin
        && box.x + box.w <= crop.x + crop.w - margin
        && box.y + box.h <= crop.y + crop.h - margin;
    }

    function unionRects(rects) {
      const x1 = Math.min(...rects.map(rect => rect.x));
      const y1 = Math.min(...rects.map(rect => rect.y));
      const x2 = Math.max(...rects.map(rect => rect.x + rect.w));
      const y2 = Math.max(...rects.map(rect => rect.y + rect.h));
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    function rectIntersection(a, b) {
      const x1 = Math.max(a.x, b.x);
      const y1 = Math.max(a.y, b.y);
      const x2 = Math.min(a.x + a.w, b.x + b.w);
      const y2 = Math.min(a.y + a.h, b.y + b.h);
      if (x2 <= x1 || y2 <= y1) return null;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    function rectArea(rect) {
      return Math.max(0, rect.w) * Math.max(0, rect.h);
    }

    function rectIou(a, b) {
      const intersection = rectIntersection(a, b);
      if (!intersection) return 0;
      const area = rectArea(intersection);
      return area / Math.max(1, rectArea(a) + rectArea(b) - area);
    }

    async function writeCropDatasetFiles(trainLines, outputPrefix) {
      await writeCropOutputText(`${outputPrefix}/train.txt`, `${trainLines.join("\n")}${trainLines.length ? "\n" : ""}`);
      const classIds = [...new Set(state.allPairs.flatMap(pair => (pair.boxes || []).map(box => box.classId)))].sort((a, b) => a - b);
      const names = classIds.length
        ? classIds.map(id => `  ${id}: ${JSON.stringify(state.classNames.get(id) || `class_${id}`)}`).join("\n")
        : '  0: "class_0"';
      await writeCropOutputText(`${outputPrefix}/data.yaml`, `train: images/crops\nval: images/crops\nnames:\n${names}\n`);
    }

    async function writeCropOutputBlob(relativePath, blob) {
      if (state.datasetBackendRoot) {
        await backendCall("writeFileBase64", state.datasetBackendRoot, relativePath, await cropBlobToBase64(blob));
        return;
      }
      await writeCropOutputEntry(relativePath, blob);
    }

    async function writeCropOutputText(relativePath, text) {
      if (state.datasetBackendRoot) {
        await backendCall("writeTextFile", state.datasetBackendRoot, relativePath, text);
        return;
      }
      await writeCropOutputEntry(relativePath, new Blob([text], { type: "text/plain" }));
    }

    async function writeCropOutputEntry(relativePath, blob) {
      let dir = state.datasetHandle;
      if (!dir) throw new Error("No writable dataset folder is open.");
      const parts = relativePath.split("/");
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const handle = await dir.getFileHandle(parts.at(-1), { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    }

    function cropBlobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    function blobToBase64(blob) {
      return cropBlobToBase64(blob);
    }

    function outputImageExtension(path) {
      const extension = ext(path).replace(".", "");
      return extension === "jpeg" ? "jpg" : (extension || "png");
    }

	    function cropRunId() {
      const date = new Date();
      const pad = value => String(value).padStart(2, "0");
      return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }

    function setCropLog(text) {
      if (el.cropLog) el.cropLog.textContent = text;
    }

function canSendToCrop() {
  return state.yoloSource === "dataset"
    && state.datasetTask === "classify"
    && hasDatasetOpen()
    && Boolean(state.datasetBackendRoot);
}

function updateSendToCropButton() {
  const btn = el.sendToCropBtn;
  if (!btn) return;
  const ready = canSendToCrop();
  btn.disabled = !ready;
  btn.title = ready
    ? "将当前可见图片加入 Crop 队列"
    : "请先在 YOLO View 打开分类数据集";
}

function resolvePairAbsPath(imagePath) {
  const root = state.datasetBackendRoot.replace(/[\\/]$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  const rel = imagePath.replace(/\//g, sep);
  return `${root}${sep}${rel}`;
}

function classifyClassNameForCrop(imagePath, classId = null) {
  if (Number.isFinite(classId)) return classDisplay(classId);
  return classificationClassNameForPath(imagePath) || "";
}

function pairToCropItem(pair) {
  return {
    absPath: resolvePairAbsPath(pair.imagePath),
    relPath: pair.imagePath.replace(/\\/g, "/"),
    className: pair.className || classifyClassNameForCrop(pair.imagePath, pair.classId)
  };
}

function mergeCropQueue(newItems, meta) {
  if (!cropState.queue) cropState.queue = { items: [], sources: [] };
  const existing = new Set(cropState.queue.items.map(item => item.absPath));
  let added = 0;
  for (const item of newItems) {
    if (!item?.absPath || existing.has(item.absPath)) continue;
    cropState.queue.items.push(item);
    existing.add(item.absPath);
    added += 1;
  }
  if (added) {
    cropState.queue.sources.push({
      source: meta.source,
      label: meta.label,
      added,
      at: Date.now()
    });
  }
  updateCropQueueUI();
  ensureDefaultCropOutput();
  renderBatchCropClassAnchors();
  updateBatchCropStatus();
  return added;
}

function ensureDefaultCropOutput() {
  if (!state.datasetBackendRoot || el.batchCropOutputDir?.value?.trim()) return;
  const root = state.datasetBackendRoot.replace(/[\\/]$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  const runId = cropRunId();
  el.batchCropOutputDir.value = `${root}${sep}batch_crops_${runId}${sep}train`;
}

function updateCropQueueUI() {
  const summaryEl = el.batchCropQueueSummary;
  if (!summaryEl) return;
  const items = cropState.queue?.items || [];
  if (!items.length) {
    summaryEl.textContent = "从 YOLO View 点 Send to Crop，或在 Filter 里对 class 右键发送。";
    return;
  }
  const classCounts = new Map();
  for (const item of items) {
    const name = item.className || "(unknown)";
    classCounts.set(name, (classCounts.get(name) || 0) + 1);
  }
  const classLines = [...classCounts.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([name, count]) => `${name}: ${count}`)
    .join(" | ");
  const sourceLines = (cropState.queue.sources || [])
    .slice(-3)
    .map(entry => `+${entry.added} ${entry.label}`)
    .join("\n");
  summaryEl.textContent = [
    `队列共 ${items.length} 张`,
    classLines ? `Classes: ${classLines}` : "",
    sourceLines ? `最近加入:\n${sourceLines}` : ""
  ].filter(Boolean).join("\n");
}

function clearCropQueue() {
  cropState.queue = { items: [], sources: [] };
  updateCropQueueUI();
  updateBatchCropStatus();
}

function sendFilteredPairsToCrop() {
  if (!canSendToCrop()) {
    alert("请先在 YOLO View 打开分类数据集。");
    return 0;
  }
  if (!state.pairs.length) {
    alert("当前没有可见图片。");
    return 0;
  }
  const items = state.pairs.map(pair => pairToCropItem(pair));
  const added = mergeCropQueue(items, {
    source: "filtered",
    label: `当前可见列表 (${state.pairs.length})`
  });
  if (!added) {
    alert("没有新图片加入队列（可能已在队列中）。");
    return 0;
  }
  switchTab("crop");
  setStatus(`已加入裁切队列：${added} 张（共 ${cropState.queue.items.length} 张）`);
  return added;
}

function sendClassToCrop(classId) {
  if (!canSendToCrop()) {
    alert("请先在 YOLO View 打开分类数据集。");
    return 0;
  }
  const paths = state.classIndex.get(classId) || new Set();
  if (!paths.size) {
    alert("该类没有图片。");
    return 0;
  }
  const byPath = new Map(state.allPairs.map(pair => [pair.imagePath, pair]));
  const items = [...paths].map(imagePath => {
    const pair = byPath.get(imagePath);
    if (pair) return pairToCropItem(pair);
    return {
      absPath: resolvePairAbsPath(imagePath),
      relPath: imagePath.replace(/\\/g, "/"),
      className: classifyClassNameForCrop(imagePath, classId)
    };
  });
  const label = `class ${classDisplay(classId)} (${paths.size})`;
  const added = mergeCropQueue(items, { source: "class", label });
  if (!added) {
    alert("没有新图片加入队列（可能已在队列中）。");
    return 0;
  }
  switchTab("crop");
  setStatus(`已加入裁切队列：${added} 张（${label}）`);
  return added;
}

let cropContextMenuEl = null;

function hideCropContextMenu() {
  cropContextMenuEl?.remove();
  cropContextMenuEl = null;
}

function showFilterClassCropMenu(event, classId) {
  if (!canSendToCrop()) return;
  event.preventDefault();
  hideCropContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Send class to Crop";
  button.addEventListener("click", () => {
    hideCropContextMenu();
    sendClassToCrop(classId);
  });
  menu.appendChild(button);
  document.body.appendChild(menu);
  cropContextMenuEl = menu;
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  setTimeout(() => {
    document.addEventListener("click", hideCropContextMenu, { once: true });
  }, 0);
}

function formatBatchCropResult(result, outputRoot) {
  const errors = (result.errors || []).slice(0, 10).map(item => `SKIP ${item.path}: ${item.error}`).join("\n");
  const classSummary = Object.entries(result.perClass || {})
    .filter(([name]) => name)
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([name, item]) => {
      const classAnchor = item.anchor || result.anchor || "center";
      return `${name}: ${item.cropped || 0}/${item.total || 0} (${classAnchor === "skip" ? "skip" : classAnchor})`;
    })
    .join("\n");
  return [
    `Done. Cropped ${result.cropped || 0}/${result.total || 0} image(s). Skipped ${result.skipped || 0}.`,
    `Workers: ${result.workers || 1}`,
    `Output: ${result.outputDir || outputRoot}`,
    classSummary ? `\nClasses:\n${classSummary}` : "",
    errors ? `\n${errors}` : "",
  ].filter(Boolean).join("\n");
}

function updateBatchCropStatus() {
  if (!el.batchCropStatus) return;
  const queueCount = cropState.queue?.items?.length || 0;
  const output = el.batchCropOutputDir?.value?.trim();
  const classCount = batchCropClassAnchorMap().size;
  if (queueCount) {
    el.batchCropStatus.textContent = `队列 ${queueCount} 张${output ? " | 可执行" : " | 需选 Output"}`;
    return;
  }
  const input = el.batchCropInputDir?.value?.trim();
  el.batchCropStatus.textContent = input && output
    ? `文件夹模式${classCount ? ` | ${classCount} class anchors` : ""}`
    : "队列为空 | 从 YOLO View 发送或选文件夹";
}

async function chooseBatchCropDirectory(input, title) {
  if (!await ensurePythonBackend()) {
    alert("Batch Crop needs the Python backend.");
    return;
  }
  const path = await backendCall("chooseDirectory", title);
  if (!path) return;
  input.value = path;
  updateBatchCropStatus();
}

async function runBatchCropImages() {
  if (!await ensurePythonBackend()) {
    alert("Batch Crop needs the Python backend.");
    return;
  }
  const inputRoot = el.batchCropInputDir?.value.trim();
  const outputRoot = el.batchCropOutputDir?.value.trim();
  const width = Math.max(1, Math.round(Number(el.batchCropWidthInput?.value) || 2560));
  const height = Math.max(1, Math.round(Number(el.batchCropHeightInput?.value) || 1440));
  const anchor = el.batchCropAnchorSelect?.value || "center";
  const classAnchors = Object.fromEntries(batchCropClassAnchorMap());
  const queueItems = cropState.queue?.items || [];
  if (!outputRoot) {
    alert("请先选择输出文件夹。");
    return;
  }
  if (!queueItems.length && !inputRoot) {
    alert("裁切队列为空。请从 YOLO View 发送图片，或选择 Input 文件夹。");
    return;
  }
  el.runBatchCropBtn.disabled = true;
  el.batchCropLog.textContent = `Cropping images to ${width}x${height} (${anchor})...`;
  try {
    let raw = "";
    if (queueItems.length) {
      const files = queueItems.map(item => ({
        path: item.absPath,
        relative: item.relPath,
        className: item.className || ""
      }));
      raw = await backendCall(
        "batchCropFiles",
        JSON.stringify(files),
        outputRoot,
        width,
        height,
        anchor,
        JSON.stringify(classAnchors)
      );
    } else {
      raw = await backendCall(
        "batchCropImages",
        inputRoot,
        outputRoot,
        width,
        height,
        anchor,
        JSON.stringify(classAnchors)
      );
    }
    const result = JSON.parse(raw || "{}");
    const message = formatBatchCropResult(result, outputRoot);
    el.batchCropLog.textContent = message;
    setStatus(message.split("\n")[0]);
  } finally {
    el.runBatchCropBtn.disabled = false;
    updateBatchCropStatus();
  }
}

function useLoadedClassifyTrainForBatchCrop() {
  if (!canSendToCrop()) {
    alert("Open a YOLO classification dataset through the Python backend first.");
    return;
  }
  const items = state.allPairs.map(pair => pairToCropItem(pair));
  const added = mergeCropQueue(items, {
    source: "dataset",
    label: `整个 train 数据集 (${state.allPairs.length})`
  });
  if (!added) {
    alert("没有新图片加入队列。");
    return;
  }
  switchTab("crop");
  setCropLog(`已将整个 train 数据集加入裁切队列：${added} 张。\nOutput: ${el.batchCropOutputDir.value || "(请选择)"}`);
}

function batchCropQueueClassNames() {
  const names = new Set();
  for (const item of cropState.queue?.items || []) {
    if (item.className) names.add(item.className);
  }
  return [...names].sort(naturalCompare);
}

function renderBatchCropClassAnchors() {
  if (!el.batchCropClassAnchorList) return;
  const queueClasses = batchCropQueueClassNames();
  const datasetClasses = state.datasetTask === "classify" && state.classNames.size
    ? [...state.classNames.values()].sort(naturalCompare)
    : [];
  const classes = queueClasses.length ? queueClasses : datasetClasses;
  if (!classes.length) {
    el.batchCropClassAnchorList.innerHTML = `<div class="empty">从 YOLO View 发送图片到队列，或打开分类数据集。</div>`;
    return;
  }
  el.batchCropClassAnchorList.innerHTML = "";
  for (const className of classes) {
    const row = document.createElement("label");
    row.className = "class-anchor-row";
    const name = document.createElement("span");
    name.textContent = className;
    const select = document.createElement("select");
    select.dataset.className = className;
    for (const [value, label] of [["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["skip", "Skip"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = cropState.classAnchors.get(className) || el.batchCropAnchorSelect?.value || "center";
    select.addEventListener("change", () => {
      cropState.classAnchors.set(className, select.value);
      updateBatchCropStatus();
    });
    row.append(name, select);
    el.batchCropClassAnchorList.appendChild(row);
  }
  updateBatchCropStatus();
}

function batchCropClassAnchorMap() {
  const map = new Map();
  if (state.datasetTask !== "classify") return map;
  el.batchCropClassAnchorList?.querySelectorAll("select[data-class-name]").forEach(select => {
    map.set(select.dataset.className, select.value || "center");
  });
  return map;
}

function bindCropPageEvents() {
  el.clearBatchCropQueueBtn?.addEventListener("click", () => clearCropQueue());
  el.batchCropAnchorSelect?.addEventListener("change", () => {
    renderBatchCropClassAnchors();
    updateBatchCropStatus();
  });
  el.useClassifyTrainCropBtn?.addEventListener("click", () => useLoadedClassifyTrainForBatchCrop());
  el.chooseBatchCropInputBtn?.addEventListener("click", () => chooseBatchCropDirectory(el.batchCropInputDir, "Choose Batch Crop Input Folder").catch(showError));
  el.chooseBatchCropOutputBtn?.addEventListener("click", () => chooseBatchCropDirectory(el.batchCropOutputDir, "Choose Batch Crop Output Folder").catch(showError));
  el.runBatchCropBtn?.addEventListener("click", () => runBatchCropImages().catch(showError));
  document.getElementById("previewSmartCropBtn").addEventListener("click", () => previewSmartCrop().catch(showError));
  document.getElementById("applySmartCropBtn").addEventListener("click", () => runSmartCrop().catch(showError));
  document.getElementById("stopSmartCropBtn").addEventListener("click", () => {
    cropState.stopRequested = true;
    setCropLog(`${el.cropLog.textContent}\nStop requested...`);
  });
}
