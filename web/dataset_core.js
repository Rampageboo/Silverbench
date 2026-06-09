async function openDatasetFolder() {
	      if (usesHttpBackend() || (location.protocol.startsWith("http") && await ensurePythonBackend())) {
	        await openYoloFolderFlow();
	        return;
	      }
      if (location.protocol.startsWith("http")) {
        alert("本地 Python 后端未连接。请通过 yolo_label_viewer_server.py 打开页面，不要直接打开 web/index.html 文件。");
        return;
      }
      if (!window.showDirectoryPicker) {
        alert("Open Dataset Folder needs the Python app or Chrome/Edge folder access.");
        return;
      }
	      try {
	        const handle = await showDirectoryPicker({ mode: "readwrite" });
	        await loadFromDirectoryHandle(handle);
	      } catch (error) {
	        if (error.name !== "AbortError") throw error;
	      }
	    }

    async function chooseBackupFolder() {
      if (!window.showDirectoryPicker) {
        alert("Source copy folder selection needs Chrome or Edge.");
        return;
      }
      try {
        state.backupHandle = await showDirectoryPicker({ mode: "read" });
        setStatus(`Source copy folder: ${state.backupHandle.name}`);
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
    }

	    async function onDrop(event) {
	      event.preventDefault();
	      event.stopPropagation();
	      if (el.app.classList.contains("video")) {
	        await onVideoDrop(event);
	        return;
	      }
	      if (el.app.classList.contains("mask-noise")) {
	        const directory = await droppedDirectoryHandle(event);
	        if (directory) {
	          setMaskNoiseLog("Folder dropped for photo import.\nChoose the same folder in the Python folder picker so the backend can access it.");
	          await importMaskNoiseFolder();
	          return;
	        }
	        const files = droppedImageFiles(event);
	        if (!files.length) {
	          alert("Drop an image file as the photo. Drop a mask only onto the Mask Preview area.");
	          return;
	        }
	        if (files[0]) await loadMaskNoiseFile(files[0], "photo");
	        else if (maskNoiseState.photoBitmap && !maskNoiseState.maskBitmap) setMaskNoiseLog(`${el.maskNoiseLog.textContent}\nDrop or open a B/W mask next.`);
	        return;
	      }
	      if (el.app.classList.contains("merge")) return;
	      el.dropZone.classList.remove("drop-hover");
      const item = [...event.dataTransfer.items].find(i => i.kind === "file");
      if (!item) return;
      if (item.getAsFileSystemHandle) {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle.kind === "directory") {
            await loadFromDirectoryHandle(handle);
            return;
          }
        } catch (error) {
          if (error.name !== "AbortError") throw error;
        }
      }
	      alert("拖入文件夹需要 Python 应用窗口，或在 Chrome/Edge 中使用「打开文件夹」按钮。");
	    }

	    function onKeyDown(event) {
      if (el.app.classList.contains("pool-label") && typeof onPoolLabelKeyDown === "function") {
        if (onPoolLabelKeyDown(event)) return;
        const tag = event.target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
        if (event.key.toLowerCase() === "j" && typeof canMarkYoloJunk === "function" && canMarkYoloJunk()) {
          event.preventDefault();
          markYoloJunkSelected().catch(showError);
          return;
        }
        event.preventDefault();
        return;
      }
	      if (el.app.classList.contains("merge") || el.app.classList.contains("video") || el.app.classList.contains("mask-noise")) return;
	      const tag = event.target?.tagName?.toLowerCase();
	      if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "z") {
        event.preventDefault();
        undoLastPendingEdit();
        return;
      }
      if (event.ctrlKey && key === "s") {
        event.preventDefault();
        saveSession({ manual: true });
        return;
      }
      if (key === "arrowleft" || key === "arrowup" || key === "a") {
        event.preventDefault();
        selectIndex(state.currentIndex - 1);
      } else if (key === "arrowright" || key === "arrowdown" || key === "d") {
        event.preventDefault();
        selectIndex(state.currentIndex + 1);
      } else if (key === "r") {
        event.preventDefault();
        toggleReviewed().catch(showError);
      } else if (key === "f") {
        event.preventDefault();
        toggleFlagged().catch(showError);
      } else if (key === "j" && canMarkYoloJunk()) {
        event.preventDefault();
        markYoloJunkSelected().catch(showError);
      } else if (key === "n") {
        event.preventDefault();
        nextIssue();
      } else if (key === "b") {
        event.preventDefault();
        setEditMode("black");
      } else if (key === "x") {
        event.preventDefault();
        setEditMode("box");
      } else if (key === "c") {
        event.preventDefault();
        setEditMode("crop");
      } else if (key === "escape") {
        event.preventDefault();
        setEditMode("none");
      }
    }

    function setEditMode(mode) {
      const input = document.querySelector(`input[name=editMode][value="${mode}"]`);
      if (input) input.checked = true;
    }

    async function loadFromDirectoryHandle(handle, preferredPath = null) {
      const preservedWorkspaceRoot = state.workspaceRoot;
      revokeUrls();
      bitmapCache.clear();
      Object.assign(state, {
        datasetHandle: handle,
        workspaceRoot: preservedWorkspaceRoot,
        yoloSource: "dataset",
        datasetBackendRoot: "",
        backupHandle: state.backupHandle,
	        rootName: handle.name,
	        datasetTask: "detect",
	        files: new Map(),
        allPairs: [],
        pairs: [],
        classNames: new Map(),
        labelCache: new Map(),
        classIndex: new Map(),
        imageClassSet: new Map(),
        imageClassBoxCounts: new Map(),
        classBoxCounts: new Map(),
      include: new Set(),
      exclude: new Set(),
      imageViewMode: "all",
      currentIndex: 0,
        currentImagePath: preferredPath,
        currentImage: null,
        displayRect: null,
        viewZoom: 1,
        viewPanX: 0,
        viewPanY: 0,
        viewPanDrag: null,
        selection: null,
        dragStart: null,
        boxDrag: null,
        pending: new Map(),
        labelEdits: new Map(),
        reviewedPaths: new Set(),
        flaggedPaths: new Set(),
        selectedBoxIndex: null,
        shiftSelectedPaths: new Set(),
        multiSelectAnchorIndex: null,
        blackRepeatTemplate: [],
        smartCropPreviewPlans: [],
        duplicateScan: null,
        urls: new Map()
      });
      classifierState.results.clear();

      setStatus(`Scanning ${handle.name}...`);
      await walkDirectory(handle, "");
	      state.classNames = await readClassNames();
	      state.datasetTask = inferDatasetTask();
	      if (state.datasetTask === "classify") state.classNames = classificationClassNames();
	      state.allPairs = findPairs();
	      setStatus(state.datasetTask === "classify" ? `Indexing ${handle.name} classes...` : `Indexing ${handle.name} labels...`);
      await buildLabelIndex();
      await loadSessionFromDefault(preferredPath);
      buildFilterList();
      updateSelectedClassActions();
      applyFilter(false);
      renderGallery();
      if (el.galleryScroll) el.galleryScroll.scrollTop = state.galleryScrollTop || 0;
      renderGallery();
      if (state.pairs.length) {
        const resumePath = preferredPath || state.currentImagePath;
        const preferredIndex = resumePath
          ? state.pairs.findIndex(pair => pair.imagePath === resumePath)
          : -1;
        await selectIndex(preferredIndex >= 0 ? preferredIndex : 0);
      }
      updateStatus();
      updateTrainPrepStatus();
      updateCropDatasetStatus();
    }

    function remapDatasetPath(path, pathRemap, validPaths) {
      if (!path) return null;
      const mapped = pathRemap instanceof Map ? pathRemap.get(path) : pathRemap?.[path];
      if (mapped && validPaths.has(mapped)) return mapped;
      if (validPaths.has(path)) return path;
      return null;
    }

    function remapDatasetPathSet(paths, pathRemap, validPaths) {
      const next = new Set();
      for (const path of paths) {
        const mapped = remapDatasetPath(path, pathRemap, validPaths);
        if (mapped) next.add(mapped);
      }
      return next;
    }

    function captureDatasetUiState() {
      return {
        include: new Set(state.include),
        exclude: new Set(state.exclude),
        imageViewMode: state.imageViewMode,
        galleryScrollTop: el.galleryScroll?.scrollTop || 0,
        viewZoom: state.viewZoom,
        viewPanX: state.viewPanX,
        viewPanY: state.viewPanY,
        reviewedPaths: new Set(state.reviewedPaths),
        flaggedPaths: new Set(state.flaggedPaths),
        shiftSelectedPaths: new Set(state.shiftSelectedPaths),
        multiSelectAnchorIndex: state.multiSelectAnchorIndex,
        currentIndex: state.currentIndex,
      };
    }

    function restoreDatasetUiState(snapshot, options = {}) {
      const { pathRemap = null, preferredPath = null } = options;
      const validPaths = new Set(state.allPairs.map(pair => pair.imagePath));
      state.include = new Set([...snapshot.include].filter(id => state.classNames.has(id)));
      state.exclude = new Set([...snapshot.exclude].filter(id => state.classNames.has(id)));
      state.imageViewMode = ["all", "hideReviewed", "flagged"].includes(snapshot.imageViewMode)
        ? snapshot.imageViewMode
        : "all";
      state.reviewedPaths = remapDatasetPathSet(snapshot.reviewedPaths, pathRemap, validPaths);
      state.flaggedPaths = remapDatasetPathSet(snapshot.flaggedPaths, pathRemap, validPaths);
      state.shiftSelectedPaths = remapDatasetPathSet(snapshot.shiftSelectedPaths, pathRemap, validPaths);
      state.viewZoom = snapshot.viewZoom ?? 1;
      state.viewPanX = snapshot.viewPanX ?? 0;
      state.viewPanY = snapshot.viewPanY ?? 0;
      updateImageViewControls();
      const resumePath = remapDatasetPath(preferredPath, pathRemap, validPaths)
        || remapDatasetPath(state.currentImagePath, pathRemap, validPaths);
      let anchorIndex = snapshot.multiSelectAnchorIndex;
      if (Number.isInteger(anchorIndex) && resumePath) {
        const anchorPath = state.allPairs[anchorIndex]?.imagePath;
        const remappedAnchorPath = remapDatasetPath(anchorPath, pathRemap, validPaths);
        if (remappedAnchorPath) {
          const nextAnchorIndex = state.allPairs.findIndex(pair => pair.imagePath === remappedAnchorPath);
          if (nextAnchorIndex >= 0) anchorIndex = nextAnchorIndex;
        }
      }
      return {
        galleryScrollTop: snapshot.galleryScrollTop || 0,
        resumePath,
        multiSelectAnchorIndex: anchorIndex,
        currentIndex: snapshot.currentIndex ?? 0,
      };
    }

    async function loadFromBackendDatasetPath(rootPath, preferredPath = null, options = {}) {
      const { restoreSession = true, preserveUi = false, pathRemap = null } = options;
      const uiSnapshot = preserveUi ? captureDatasetUiState() : null;
      if (!await ensurePythonBackend()) throw new Error("Python backend is not available.");
      const preservedWorkspaceRoot = state.workspaceRoot;
      revokeUrls();
      bitmapCache.clear();
      const rootName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
      Object.assign(state, {
        datasetHandle: null,
        workspaceRoot: preservedWorkspaceRoot,
        yoloSource: "dataset",
        datasetBackendRoot: rootPath,
        backupHandle: state.backupHandle,
	        rootName,
	        datasetTask: "detect",
	        files: new Map(),
        allPairs: [],
        pairs: [],
        classNames: new Map(),
        labelCache: new Map(),
        classIndex: new Map(),
        imageClassSet: new Map(),
        imageClassBoxCounts: new Map(),
        classBoxCounts: new Map(),
        include: new Set(),
        exclude: new Set(),
        imageViewMode: "all",
        currentIndex: 0,
        currentImagePath: preferredPath,
        currentImage: null,
        displayRect: null,
        viewZoom: 1,
        viewPanX: 0,
        viewPanY: 0,
        viewPanDrag: null,
        selection: null,
        dragStart: null,
        boxDrag: null,
        pending: new Map(),
        labelEdits: new Map(),
        reviewedPaths: new Set(),
        flaggedPaths: new Set(),
        selectedBoxIndex: null,
        shiftSelectedPaths: new Set(),
        multiSelectAnchorIndex: null,
        blackRepeatTemplate: [],
        smartCropPreviewPlans: [],
        duplicateScan: null,
        urls: new Map()
      });
      classifierState.results.clear();

      setStatus(`Scanning ${rootName}...`);
      const paths = JSON.parse(await backendCall("listDatasetFiles", rootPath));
      for (const path of paths) state.files.set(path, backendFileHandle(rootPath, path));
      if (state.workspaceRoot && typeof ensureInboxMetadataIndex === "function") {
        await ensureInboxMetadataIndex();
      }
	      state.classNames = await readClassNames();
	      state.datasetTask = inferDatasetTask();
	      if (state.datasetTask === "classify") state.classNames = classificationClassNames();
	      state.allPairs = findPairs();
	      setStatus(state.datasetTask === "classify" ? `Indexing ${rootName} classes...` : `Indexing ${rootName} labels...`);
      await buildLabelIndex();
      let galleryScrollTop = 0;
      let resumePath = preferredPath;
      let fallbackIndex = 0;
      if (preserveUi && uiSnapshot) {
        const restored = restoreDatasetUiState(uiSnapshot, { pathRemap, preferredPath });
        galleryScrollTop = restored.galleryScrollTop;
        resumePath = restored.resumePath || preferredPath;
        fallbackIndex = restored.currentIndex ?? 0;
        if (Number.isInteger(restored.multiSelectAnchorIndex)) {
          state.multiSelectAnchorIndex = restored.multiSelectAnchorIndex;
        }
      } else if (restoreSession) {
        await loadSessionFromDefault(preferredPath);
      }
      buildFilterList();
      updateSelectedClassActions();
      applyFilter(false);
      if (typeof invalidateVirtualGallery === "function") invalidateVirtualGallery(galleryVirtual);
      if (preserveUi && el.galleryScroll) el.galleryScroll.scrollTop = galleryScrollTop;
      if (!preserveUi && el.galleryScroll) el.galleryScroll.scrollTop = state.galleryScrollTop || 0;
      renderGallery();
      if (preserveUi && el.galleryScroll) el.galleryScroll.scrollTop = galleryScrollTop;
      if (!preserveUi && el.galleryScroll) el.galleryScroll.scrollTop = state.galleryScrollTop || 0;
      renderGallery();
      if (state.pairs.length) {
        const preferredIndex = resumePath
          ? state.pairs.findIndex(pair => pair.imagePath === resumePath)
          : -1;
        const nextIndex = preferredIndex >= 0
          ? preferredIndex
          : Math.min(Math.max(0, fallbackIndex), state.pairs.length - 1);
        await selectIndex(
          nextIndex,
          preserveUi ? { preserveShiftSelection: true } : undefined
        );
      }
      updateStatus();
      updateTrainPrepStatus();
      updateCropDatasetStatus();
    }

    function backendFileHandle(rootPath, relativePath) {
      const name = relativePath.split("/").pop() || relativePath;
      return {
        kind: "file",
        name,
        backendRoot: rootPath,
        backendPath: relativePath,
        async getFile() {
          if (/\.(txt|yaml|yml|json|csv)$/i.test(relativePath)) {
            const text = await backendCall("readTextFile", rootPath, relativePath);
            return new File([text], name, { type: "text/plain" });
          }
          const base64 = await backendCall("readFileBase64", rootPath, relativePath);
          return base64ToFile(base64, name, mimeFor(relativePath));
        },
        async createWritable() {
          const chunks = [];
          return {
            async write(data) {
              chunks.push(data);
            },
            async close() {
              const blob = new Blob(chunks);
              if (blob.type.startsWith("text/") || /\.(txt|yaml|yml|json|csv)$/i.test(relativePath)) {
                await backendCall("writeTextFile", rootPath, relativePath, await blob.text());
                return;
              }
              const base64 = await blobToBase64(blob);
              await backendCall("writeFileBase64", rootPath, relativePath, base64);
            }
          };
        }
      };
    }

    function base64ToFile(base64, name, type) {
      return new File([base64ToBlob(base64, type)], name, { type });
    }

    async function walkDirectory(dirHandle, prefix) {
      for await (const [name, handle] of dirHandle.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") {
          if (path.toLowerCase().includes("originals_before_edit")) continue;
          await walkDirectory(handle, path);
        } else {
          state.files.set(path, handle);
        }
      }
    }

	    async function readClassNames() {
	      const names = new Map();
	      const classesHandle = state.files.get("classes.txt");
	      if (classesHandle) {
	        const text = await (await classesHandle.getFile()).text();
	        text.split(/\r?\n/).forEach((raw, index) => {
	          const name = raw.trim();
	          if (name) names.set(index, name);
	        });
	        if (names.size) return names;
	      }
	      const yamlHandle = state.files.get("data.yaml") || state.files.get("detect_dataset/data.yaml");
      if (!yamlHandle) return names;
      const text = await (await yamlHandle.getFile()).text();
      let inNames = false;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (line === "names:") {
          inNames = true;
          continue;
        }
        if (inNames) {
          const match = line.match(/^(\d+)\s*:\s*(.+)$/);
	          if (match) names.set(Number(match[1]), parseClassNameValue(match[2]));
          else if (!/^\s/.test(raw)) break;
        }
      }
	      return names;
	    }

	    function parseClassNameValue(raw) {
	      const value = raw.split("#")[0].trim();
	      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
	        try {
	          return JSON.parse(value);
	        } catch {
	          return value.slice(1, -1);
	        }
	      }
	      return value;
	    }

	    function findPairs() {
	      let imagePaths = [...state.files.keys()]
	        .filter(path => IMAGE_EXTENSIONS.has(ext(path)));
	      if (state.yoloSource === "workspace") {
	        imagePaths = imagePaths.filter(path => path.startsWith("image_pool/"));
	      }
	      imagePaths.sort(naturalCompare);
	      return imagePaths.map(imagePath => ({
	        imagePath,
	        imageHandle: state.files.get(imagePath),
	        labelPath: state.datasetTask === "classify" ? null : labelPathFor(imagePath),
	        classId: state.datasetTask === "classify" ? classificationClassIdForPath(imagePath) : null,
	        className: state.datasetTask === "classify" ? classificationClassNameForPath(imagePath) : "",
	        boxes: null
	      }));
	    }

	    function inferDatasetTask() {
	      const paths = [...state.files.keys()];
	      const hasDetectLayout = paths.some(path => path.startsWith("labels/") || path.startsWith("images/"));
	      if (hasDetectLayout) return "detect";
	      return paths.some(path => IMAGE_EXTENSIONS.has(ext(path)) && classificationClassNameForPath(path)) ? "classify" : "detect";
	    }

	    function classificationClassNames() {
	      const names = new Map();
	      const classNames = [...new Set([...state.files.keys()]
	        .filter(path => IMAGE_EXTENSIONS.has(ext(path)))
	        .map(classificationClassNameForPath)
	        .filter(Boolean))]
	        .sort(naturalCompare);
	      classNames.forEach((name, index) => names.set(index, name));
	      return names;
	    }

	    function classificationClassIdForPath(imagePath) {
	      const name = classificationClassNameForPath(imagePath);
	      if (!name) return null;
	      for (const [id, className] of state.classNames.entries()) {
	        if (className === name) return id;
	      }
	      return null;
	    }

	    function classificationClassNameForPath(imagePath) {
	      const parts = imagePath.split("/");
	      if (parts.length < 2) return "";
	      if (["train", "val", "test"].includes(parts[0]) && parts.length >= 3) return parts[1];
	      if (!["images", "labels"].includes(parts[0]) && parts.length >= 2) return parts[0];
	      return "";
	    }

    const LABEL_INDEX_BATCH = 1000;
    const LABEL_INDEX_CONCURRENCY = 48;

    function yieldToUi() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }

	    function setLabelIndexStatus(done, total) {
	      const name = state.rootName || "dataset";
	      const item = state.datasetTask === "classify" ? "classes" : "labels";
	      if (!total) {
	        setStatus(`Indexing ${name} ${item}...`);
	        return;
	      }
	      setStatus(`Indexing ${name} ${item}... ${done}/${total}`);
	    }

	    async function buildLabelIndex() {
	      state.labelCache.clear();
	      state.classIndex.clear();
	      state.imageClassSet.clear();
	      state.imageClassBoxCounts.clear();
	      state.classBoxCounts.clear();
	      const pairs = state.allPairs;
	      const total = pairs.length;
	      if (!total) return;

	      if (state.datasetTask === "classify") {
	        let done = 0;
	        for (const pair of pairs) {
	          setClassificationCache(pair);
	          done += 1;
	          if (done === total || done % 500 === 0) setLabelIndexStatus(done, total);
	        }
	        return;
	      }

	      if (state.datasetBackendRoot) {
        const labelPaths = [...new Set(pairs.flatMap(pair => labelReadPathsFor(pair)).filter(Boolean))];
        const texts = new Map();
        for (let offset = 0; offset < labelPaths.length; offset += LABEL_INDEX_BATCH) {
          const batch = labelPaths.slice(offset, offset + LABEL_INDEX_BATCH);
          const raw = await backendCall(
            "readLabelTextsBatch",
            state.datasetBackendRoot,
            JSON.stringify(batch)
          );
          for (const [path, text] of Object.entries(JSON.parse(raw || "{}"))) texts.set(path, text);
          setLabelIndexStatus(Math.min(offset + batch.length, labelPaths.length), labelPaths.length);
          await yieldToUi();
        }
        let done = 0;
        for (const pair of pairs) {
          const text = labelTextFromBatch(pair, texts);
          setBoxesCache(pair, parseLabels(text));
          done += 1;
          if (done === total || done % 500 === 0) setLabelIndexStatus(done, total);
        }
        return;
      }

      let next = 0;
      let done = 0;
      async function worker() {
        while (next < total) {
          const index = next++;
          const pair = pairs[index];
          const boxes = await readBoxesForPair(pair);
          setBoxesCache(pair, boxes);
          done += 1;
          if (done === total || done % 100 === 0) setLabelIndexStatus(done, total);
        }
      }
      const workers = Math.min(LABEL_INDEX_CONCURRENCY, total);
      await Promise.all(Array.from({ length: workers }, () => worker()));
    }

    function workspaceLabelReadPaths(imagePath) {
      const stem = imagePath.split("/").pop().replace(/\.[^.]+$/, "");
      return [
        `detect_labels/${stem}.txt`,
        `detect_dataset/labels/train/${stem}.txt`,
        `detect_dataset/labels/val/${stem}.txt`,
      ];
    }

    function labelReadPathsFor(pair) {
      if (state.yoloSource === "workspace" && pair.imagePath.startsWith("image_pool/")) {
        return workspaceLabelReadPaths(pair.imagePath);
      }
      return pair.labelPath ? [pair.labelPath] : [];
    }

    function labelTextFromBatch(pair, texts) {
      for (const path of labelReadPathsFor(pair)) {
        const text = texts.get(path);
        if (text && text.trim()) return text;
      }
      const primary = labelReadPathsFor(pair)[0];
      return primary ? (texts.get(primary) ?? "") : "";
    }

    async function readLabelTextAtPath(relativePath) {
      if (!relativePath) return "";
      if (state.datasetBackendRoot) {
        try {
          return await backendCall("readTextFile", state.datasetBackendRoot, relativePath);
        } catch {
          return "";
        }
      }
      const handle = state.files.get(relativePath);
      if (!handle) return "";
      try {
        return await (await handle.getFile()).text();
      } catch {
        return "";
      }
    }

    async function readBoxesForPair(pair) {
      for (const path of labelReadPathsFor(pair)) {
        const text = await readLabelTextAtPath(path);
        if (text.trim()) return parseLabels(text);
      }
      return [];
    }

	    function setBoxesCache(pair, boxes) {
	      const cloned = boxes.map(box => ({ ...box }));
	      pair.boxes = cloned;
	      state.labelCache.set(pair.imagePath, cloned);
	      const prevClasses = state.imageClassSet.get(pair.imagePath);
      if (prevClasses) {
        for (const classId of prevClasses) state.classIndex.get(classId)?.delete(pair.imagePath);
      }
      const prevBoxCounts = state.imageClassBoxCounts.get(pair.imagePath);
      if (prevBoxCounts) {
        for (const [classId, count] of prevBoxCounts.entries()) {
          const nextCount = (state.classBoxCounts.get(classId) || 0) - count;
          if (nextCount > 0) state.classBoxCounts.set(classId, nextCount);
          else state.classBoxCounts.delete(classId);
        }
      }
      const classSet = new Set(cloned.map(box => box.classId));
      state.imageClassSet.set(pair.imagePath, classSet);
      const boxCounts = new Map();
      for (const box of cloned) boxCounts.set(box.classId, (boxCounts.get(box.classId) || 0) + 1);
      state.imageClassBoxCounts.set(pair.imagePath, boxCounts);
      for (const classId of classSet) {
        if (!state.classIndex.has(classId)) state.classIndex.set(classId, new Set());
	        state.classIndex.get(classId).add(pair.imagePath);
	      }
      for (const [classId, count] of boxCounts.entries()) {
        state.classBoxCounts.set(classId, (state.classBoxCounts.get(classId) || 0) + count);
      }
	    }

	    function setClassificationCache(pair) {
	      pair.boxes = [];
	      state.labelCache.set(pair.imagePath, []);
	      const prevClasses = state.imageClassSet.get(pair.imagePath);
	      if (prevClasses) {
	        for (const classId of prevClasses) state.classIndex.get(classId)?.delete(pair.imagePath);
	      }
	      const prevBoxCounts = state.imageClassBoxCounts.get(pair.imagePath);
	      if (prevBoxCounts) {
	        for (const [classId, count] of prevBoxCounts.entries()) {
	          const nextCount = (state.classBoxCounts.get(classId) || 0) - count;
	          if (nextCount > 0) state.classBoxCounts.set(classId, nextCount);
	          else state.classBoxCounts.delete(classId);
	        }
	      }
	      const classSet = Number.isFinite(pair.classId) ? new Set([pair.classId]) : new Set();
	      state.imageClassSet.set(pair.imagePath, classSet);
	      const boxCounts = Number.isFinite(pair.classId) ? new Map([[pair.classId, 1]]) : new Map();
	      state.imageClassBoxCounts.set(pair.imagePath, boxCounts);
	      for (const classId of classSet) {
	        if (!state.classIndex.has(classId)) state.classIndex.set(classId, new Set());
	        state.classIndex.get(classId).add(pair.imagePath);
	      }
	      for (const [classId, count] of boxCounts.entries()) {
	        state.classBoxCounts.set(classId, (state.classBoxCounts.get(classId) || 0) + count);
	      }
	    }

    function labelPathFor(imagePath) {
      const stem = imagePath.split("/").pop().replace(/\.[^.]+$/, "");
      if (state.yoloSource === "workspace" && imagePath.startsWith("image_pool/")) {
        return `detect_labels/${stem}.txt`;
      }
      const parts = imagePath.split("/");
      const candidates = [];
      if (parts[0] === "images") {
        candidates.push(["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt"));
      }
      candidates.push(`labels/train/${stem}.txt`);
      candidates.push(`labels/val/${stem}.txt`);
      candidates.push(`labels/${stem}.txt`);
      candidates.push(imagePath.replace(/\.[^.]+$/, ".txt"));
      const matched = candidates.find(path => state.files.has(path));
      if (matched) return matched;
      if (state.datasetBackendRoot && parts[0] === "images") {
        return ["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt");
      }
      return null;
    }

    async function boxesFor(pair) {
      if (state.labelCache.has(pair.imagePath)) return state.labelCache.get(pair.imagePath);
      const boxes = await readBoxesForPair(pair);
      setBoxesCache(pair, boxes);
      return boxes;
    }

    async function effectiveBoxesFor(pair) {
      if (state.labelEdits.has(pair.imagePath)) return state.labelEdits.get(pair.imagePath);
      return boxesFor(pair);
    }

    async function editableBoxesFor(pair) {
      if (state.labelEdits.has(pair.imagePath)) return state.labelEdits.get(pair.imagePath);
      const boxes = (await boxesFor(pair)).map(box => ({ ...box }));
      state.labelEdits.set(pair.imagePath, boxes);
      return boxes;
    }

    function parseLabels(text) {
      const boxes = [];
      for (const line of text.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const nums = parts.slice(0, 5).map(Number);
        if (nums.some(Number.isNaN)) continue;
        boxes.push({ classId: Math.trunc(nums[0]), x: nums[1], y: nums[2], w: nums[3], h: nums[4] });
      }
      return boxes;
    }

    async function buildFilterList() {
      const ids = new Set([...state.classNames.keys(), ...state.classIndex.keys()]);
      if (!ids.size) {
        el.filterList.innerHTML = `<div class="empty">No classes found.</div>`;
        return;
      }
      const countTitle = state.datasetTask === "classify" ? "Images" : "Images / Boxes";
      el.filterList.innerHTML = `
        <div class="filter-head">
          <span class="filter-icon-head" title="Include">&#43;</span>
          <span class="filter-icon-head" title="Exclude">&#8722;</span>
          <span>Class</span>
          <span class="filter-count-head" title="${countTitle}">Img</span>
        </div>`;
      for (const id of [...ids].sort((a, b) => a - b)) {
        const row = document.createElement("div");
        row.className = "filter-row";
        const imageCount = state.classIndex.get(id)?.size || 0;
        const boxCount = state.classBoxCounts.get(id) || 0;
        const countText = state.datasetTask === "classify" ? String(imageCount) : `${imageCount}/${boxCount}`;
        row.innerHTML = `
          <label><input type="checkbox" data-type="include" data-id="${id}" ${state.include.has(id) ? "checked" : ""}></label>
          <label><input type="checkbox" data-type="exclude" data-id="${id}" ${state.exclude.has(id) ? "checked" : ""}></label>
          <span class="filter-class-name" data-class-id="${id}">${escapeHtml(classDisplay(id))}</span>
          <span class="filter-count" title="${imageCount} image(s)${state.datasetTask === "classify" ? "" : `, ${boxCount} box(es)`}">${countText}</span>`;
        const classNameEl = row.querySelector(".filter-class-name");
        if (state.datasetTask === "classify") {
          classNameEl.addEventListener("contextmenu", event => showFilterClassCropMenu(event, id));
        }
        el.filterList.appendChild(row);
      }
      el.filterList.querySelectorAll("input").forEach(input => {
        input.addEventListener("change", event => {
          const id = Number(event.target.dataset.id);
          const set = event.target.dataset.type === "include" ? state.include : state.exclude;
          event.target.checked ? set.add(id) : set.delete(id);
          applyFilter();
        });
      });
    }

    async function applyFilter(redraw = true) {
      const currentPath = state.currentImagePath || state.pairs[state.currentIndex]?.imagePath;
      let allowed = new Set(state.allPairs.map(pair => pair.imagePath));
      if (state.include.size) {
        allowed = new Set();
        for (const classId of state.include) {
          for (const path of state.classIndex.get(classId) || []) allowed.add(path);
        }
      }
      for (const classId of state.exclude) {
        for (const path of state.classIndex.get(classId) || []) allowed.delete(path);
      }
	      if (state.datasetTask !== "classify") {
	        for (const [path, boxes] of state.labelEdits.entries()) {
	          if (boxesMatchFilter(boxes)) allowed.add(path);
	          else allowed.delete(path);
	        }
	      }
      applyImageViewMode(allowed);
      const filtered = state.allPairs.filter(pair => allowed.has(pair.imagePath));
      state.pairs = filtered;
      state.currentIndex = Math.max(0, state.pairs.findIndex(p => p.imagePath === currentPath));
      if (state.currentIndex < 0) state.currentIndex = 0;
      state.currentImagePath = state.pairs[state.currentIndex]?.imagePath || null;
      updateFilterStatus();
      updateStatus();
      if (redraw) {
        renderGallery();
        if (state.pairs.length) await selectIndex(state.currentIndex);
        else clearPreview();
      }
    }

	    function boxesMatchFilter(boxes) {
      const classes = new Set(boxes.map(box => box.classId));
      if (state.include.size && ![...state.include].some(id => classes.has(id))) return false;
      if ([...state.exclude].some(id => classes.has(id))) return false;
      return true;
    }

    function applyImageViewMode(allowed) {
      if (state.imageViewMode === "hideReviewed") {
        for (const path of state.reviewedPaths) allowed.delete(path);
        return;
      }
      if (state.imageViewMode === "flagged") {
        for (const path of [...allowed]) {
          if (!state.flaggedPaths.has(path)) allowed.delete(path);
        }
      }
    }

    async function setImageViewMode(mode) {
      state.imageViewMode = mode;
      updateImageViewControls();
      await applyFilter();
      saveSessionSoon();
    }

    function updateImageViewControls() {
      el.showAllImagesBtn.classList.toggle("active", state.imageViewMode === "all");
      el.hideReviewedImagesBtn.classList.toggle("active", state.imageViewMode === "hideReviewed");
      el.showFlaggedImagesBtn.classList.toggle("active", state.imageViewMode === "flagged");
    }

    function clearFilter() {
      state.include.clear();
      state.exclude.clear();
      el.filterList.querySelectorAll("input").forEach(input => input.checked = false);
      applyFilter();
    }

    function clearIncludeFilter() {
      state.include.clear();
      el.filterList.querySelectorAll('input[data-type="include"]').forEach(input => input.checked = false);
      applyFilter();
    }

    function clearExcludeFilter() {
      state.exclude.clear();
      el.filterList.querySelectorAll('input[data-type="exclude"]').forEach(input => input.checked = false);
      applyFilter();
    }

    function selectedImagePairs() {
      const paths = new Set(state.shiftSelectedPaths);
      const currentPath = state.currentImagePath || state.pairs[state.currentIndex]?.imagePath;
      if (currentPath) paths.add(currentPath);
      const byPath = new Map(state.allPairs.map(pair => [pair.imagePath, pair]));
      return [...paths].map(path => byPath.get(path)).filter(Boolean);
    }

    async function updateSelectedClassPanel() {
      const token = ++selectedClassRenderToken;
      const pairs = selectedImagePairs();
      updateSelectedClassActions();
      el.selectedClassStatus.textContent = `${pairs.length} image(s)`;
	      if (!pairs.length) {
	        el.selectedClassList.innerHTML = `<div class="empty">Select images to inspect classes.</div>`;
	        el.selectedClassHint.textContent = state.datasetTask === "classify"
	          ? "Enter a class ID or folder name, then Move Selected. Right-click gallery to Send selected to Detect."
	          : "Uses the current image plus Ctrl/Shift selected thumbnails.";
	        return;
	      }
	      const classCounts = new Map();
	      for (const pair of pairs) {
	        const classes = state.datasetTask === "classify"
	          ? (Number.isFinite(pair.classId) ? new Set([pair.classId]) : new Set())
	          : new Set((await effectiveBoxesFor(pair)).map(box => box.classId));
	        for (const classId of classes) classCounts.set(classId, (classCounts.get(classId) || 0) + 1);
	      }
      if (token !== selectedClassRenderToken) return;
      if (!classCounts.size) {
        el.selectedClassList.innerHTML = `<div class="empty">Selected image(s) have no labels.</div>`;
        el.selectedClassHint.textContent = state.datasetTask === "classify"
          ? "Selected image(s) are not inside a class folder."
          : "No classes to add or remove.";
        return;
      }
      el.selectedClassList.innerHTML = "";
      for (const [classId, count] of [...classCounts.entries()].sort((a, b) => a[0] - b[0])) {
        const row = document.createElement("label");
        row.className = "selected-class-row";
        row.innerHTML = `
          <input type="checkbox" data-id="${classId}">
          <span>${escapeHtml(classDisplay(classId))}</span>
          <span class="selected-class-count">${count}/${pairs.length}</span>`;
        el.selectedClassList.appendChild(row);
      }
	      el.selectedClassHint.textContent = state.datasetTask === "classify"
	        ? "Enter a class ID or folder name, then Move Selected. Right-click gallery to Send selected to Detect."
	        : "Add Include/Exclude updates the filter. Remove Class deletes matching YOLO boxes from selected image TXT files.";
    }

    function updateSelectedClassActions() {
      const mode = state.datasetTask === "classify" ? "classify" : "detect";
      document.querySelectorAll("[data-selected-class-mode]").forEach(group => {
        group.classList.toggle("is-hidden", group.dataset.selectedClassMode !== mode);
      });
    }

    function selectedClassIdsFromPanel() {
      return [...el.selectedClassList.querySelectorAll("input[data-id]:checked")]
        .map(input => Number(input.dataset.id))
        .filter(Number.isFinite);
    }

    function setSelectedClassesChecked(checked) {
      el.selectedClassList.querySelectorAll("input[data-id]").forEach(input => input.checked = checked);
    }

    function syncFilterInputs() {
      el.filterList.querySelectorAll("input[data-id]").forEach(input => {
        const id = Number(input.dataset.id);
        input.checked = input.dataset.type === "include" ? state.include.has(id) : state.exclude.has(id);
      });
    }

    async function addSelectedClassesToFilter(type) {
      const ids = selectedClassIdsFromPanel();
      if (!ids.length) {
        alert("Select one or more classes first.");
        return;
      }
      const target = type === "exclude" ? state.exclude : state.include;
      ids.forEach(id => target.add(id));
      syncFilterInputs();
      await applyFilter(false);
      renderGallery();
      if (state.pairs.length) await renderCurrentImage();
      else clearPreview();
    }

	    async function removeSelectedClassesFromImages() {
	      if (state.datasetTask === "classify") {
	        alert("Classification classes come from folders. Move images between class folders to change labels.");
	        return;
	      }
      const ids = new Set(selectedClassIdsFromPanel());
      if (!ids.size) {
        alert("Select one or more classes first.");
        return;
      }
      const pairs = selectedImagePairs();
      if (!pairs.length) return;
      let changedImages = 0;
      let removedBoxes = 0;
      for (const pair of pairs) {
        const boxes = await effectiveBoxesFor(pair);
        const kept = boxes.filter(box => !ids.has(box.classId));
        const removed = boxes.length - kept.length;
        if (!removed) continue;
        await persistLabelBoxes(pair, kept, { refreshFilterList: false });
        changedImages += 1;
        removedBoxes += removed;
      }
      if (state.selectedBoxIndex !== null) {
        state.selectedBoxIndex = null;
        populateBoxEditor(null);
      }
      await buildFilterList();
      syncFilterInputs();
      await applyFilter(false);
	      renderGallery();
	      if (state.pairs.length) await renderCurrentImage();
	      else clearPreview();
	      el.selectedClassHint.textContent = `Removed ${removedBoxes} box(es) from ${changedImages} image(s).`;
	    }

	    function resolveClassificationTargetClass(rawInput) {
	      const trimmed = String(rawInput || "").trim();
	      if (!trimmed) return { folderName: "", classId: null, matched: false };

	      if (/^\d+$/.test(trimmed)) {
	        const classId = Number(trimmed);
	        if (state.classNames.has(classId)) {
	          return {
	            folderName: state.classNames.get(classId),
	            classId,
	            matched: true,
	          };
	        }
	      }

	      for (const [classId, folderName] of state.classNames.entries()) {
	        if (folderName === trimmed) {
	          return { folderName, classId, matched: true };
	        }
	      }

	      return { folderName: trimmed, classId: null, matched: false };
	    }

	    function classificationTargetClassLabel(target) {
	      if (target.classId != null && state.classNames.has(target.classId)) return classDisplay(target.classId);
	      return target.folderName;
	    }

	    async function addClassificationFolder() {
	      if (state.datasetTask !== "classify") {
	        alert("Add Folder is for YOLO classification datasets.");
	        return;
	      }
	      if (!state.datasetBackendRoot) {
	        alert("Add Folder needs Open Dataset Folder through the Python backend.");
	        return;
	      }
	      const target = resolveClassificationTargetClass(el.classFolderNameInput?.value);
	      if (!target.folderName) {
	        alert("Enter a class ID or folder name first.");
	        return;
	      }
	      if (target.matched) {
	        alert(`Class ${classificationTargetClassLabel(target)} already exists. Use Move Selected to move images there.`);
	        return;
	      }
	      const raw = await backendCall("createClassFolder", state.datasetBackendRoot, target.folderName);
	      const result = JSON.parse(raw || "{}");
	      setStatus(`Class folder ready: ${result.relativePath || result.className || target.folderName}`);
	      await loadFromBackendDatasetPath(state.datasetBackendRoot, state.currentImagePath);
	    }

	    async function moveSelectedImagesToClass() {
	      if (state.datasetTask !== "classify") {
	        alert("Move Selected is for YOLO classification datasets.");
	        return;
	      }
	      if (!state.datasetBackendRoot) {
	        alert("Move Selected needs Open Dataset Folder through the Python backend.");
	        return;
	      }
	      const target = resolveClassificationTargetClass(el.classFolderNameInput?.value);
	      if (!target.folderName) {
	        alert("Enter a target class ID or folder name first.");
	        return;
	      }
	      const className = target.folderName;
	      const pairs = selectedImagePairs();
	      if (!pairs.length) {
	        alert("Select one or more images first.");
	        return;
	      }
	      const preview = pairs.slice(0, 6).map(pair => pair.imagePath).join("\n");
	      const more = pairs.length > 6 ? `\n...and ${pairs.length - 6} more` : "";
	      const targetLabel = classificationTargetClassLabel(target);
	      if (!confirm(`Move ${pairs.length} image(s) to ${targetLabel}?\n\n${preview}${more}`)) return;
	      const raw = await backendCall(
	        "moveImagesToClass",
	        state.datasetBackendRoot,
	        JSON.stringify(pairs.map(pair => pair.imagePath)),
	        className
	      );
	      const result = JSON.parse(raw || "{}");
	      const pathRemap = new Map((result.moved || []).map(item => [item.from, item.to]));
	      const preferred = result.moved?.[0]?.to || state.currentImagePath;
	      setStatus(`Moved ${result.moved?.length || 0} image(s) to ${targetLabel}.`);
	      await loadFromBackendDatasetPath(state.datasetBackendRoot, preferred, {
	        restoreSession: false,
	        preserveUi: true,
	        pathRemap,
	      });
	      if (result.skipped?.length) {
	        alert(`Moved ${result.moved?.length || 0} image(s).\nSkipped ${result.skipped.length}.`);
	      }
	    }

    function isImageFileLike(file) {
      return Boolean(file && (file.type?.startsWith("image/") || IMAGE_EXTENSIONS.has(ext(file.name || ""))));
    }

    function droppedImageFiles(event) {
      return [...(event.dataTransfer?.files || [])].filter(isImageFileLike);
    }

    async function droppedDirectoryHandle(event) {
      for (const item of [...(event.dataTransfer?.items || [])]) {
        if (item.kind !== "file" || !item.getAsFileSystemHandle) continue;
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle?.kind === "directory") return handle;
        } catch {
          // Ignore browsers that expose but block this API for the drop source.
        }
      }
      return null;
    }

    function updateFilterStatus() {
      const parts = [];
      if (state.include.size) parts.push(`include: ${[...state.include].sort((a, b) => a - b).map(classDisplay).join(", ")}`);
      if (state.exclude.size) parts.push(`exclude: ${[...state.exclude].sort((a, b) => a - b).map(classDisplay).join(", ")}`);
      el.filterStatus.textContent = parts.length ? parts.join("; ") : "No class filter. Showing all images.";
    }

    async function toggleReviewed() {
      const pairs = selectedImagePairs();
      if (!pairs.length) return;
      const shouldReview = pairs.some(pair => !state.reviewedPaths.has(pair.imagePath));
      for (const pair of pairs) {
        if (shouldReview) state.reviewedPaths.add(pair.imagePath);
        else state.reviewedPaths.delete(pair.imagePath);
      }
      await applyFilter();
      saveSessionSoon();
    }

    async function toggleFlagged() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      if (state.flaggedPaths.has(pair.imagePath)) state.flaggedPaths.delete(pair.imagePath);
      else state.flaggedPaths.add(pair.imagePath);
      await applyFilter();
      saveSessionSoon();
    }

    function canMarkYoloJunk() {
      return hasWorkspaceRoot() && hasDatasetOpen();
    }

    function yoloSelectedFilenames() {
      return selectedImagePairs()
        .map(pair => pair.imagePath.split("/").pop())
        .filter(Boolean);
    }

    function isYoloJunkFilename(filename) {
      return typeof isInboxJunkFile === "function" && isInboxJunkFile(filename);
    }

    async function markYoloJunkSelected() {
      if (!canMarkYoloJunk()) {
        alert("标记废片需要已绑定的工作区（含 metadata.csv）。");
        return null;
      }
      const filenames = yoloSelectedFilenames();
      if (!filenames.length) {
        setStatus("请先选择图片，再点「标记废片」。");
        return null;
      }
      if (typeof markInboxJunkFilenames !== "function") {
        alert("标记废片功能不可用。");
        return null;
      }
      const pending = filenames.filter(name => !isYoloJunkFilename(name));
      if (!pending.length) {
        setStatus("所选图片已是废片。");
        return null;
      }
      const result = await markInboxJunkFilenames(pending, {
        clearSelection: false,
        skipGridRender: true,
        quiet: false
      });
      if (result) {
        renderGallery({ patchVisible: true });
        updateReviewControls();
        updateStatus();
      }
      return result;
    }

    function canSendSelectedToDetect() {
      return hasWorkspaceRoot()
        && typeof yoloViewModeState !== "undefined"
        && yoloViewModeState.mode === "clf"
        && state.datasetTask === "classify"
        && hasDatasetOpen()
        && selectedImagePairs().length > 0;
    }

    function yoloPendingDetectFilenames(filenames) {
      const skipped = { junk: 0, alreadyDetect: 0 };
      const pending = [];
      for (const filename of filenames) {
        if (typeof isInboxDetectJunkFile === "function" && isInboxDetectJunkFile(filename)) {
          skipped.junk += 1;
          continue;
        }
        if (typeof isInboxJunkFile === "function" && isInboxJunkFile(filename, "clf")) {
          skipped.junk += 1;
          continue;
        }
        const detectInUse = typeof inboxMetadataSideState === "function"
          ? inboxMetadataSideState(filename).detectInUse
          : Boolean(
            inboxState?.metadataByFile?.get(filename)
            && (inboxState.metadataByFile.get(filename).detect_enabled === "1"
              || inboxState.metadataByFile.get(filename).detect_enabled === true)
          );
        if (detectInUse) {
          skipped.alreadyDetect += 1;
          continue;
        }
        pending.push(filename);
      }
      return { pending, skipped };
    }

    async function sendSelectedToDetect(options = {}) {
      const { skipConfirm = false } = options;
      if (!hasWorkspaceRoot()) {
        alert("Send to Detect 需要先打开工作区。");
        return null;
      }
      if (!await ensurePythonBackend()) {
        alert("需要 Python 后端。");
        return null;
      }
      if (typeof yoloViewModeState !== "undefined" && yoloViewModeState.mode !== "clf") {
        alert("请在 YOLO View 的 Clf 模式下使用。");
        return null;
      }
      if (state.datasetTask !== "classify") {
        alert("Send to Detect 仅适用于分类数据集。");
        return null;
      }
      if (typeof ensureInboxMetadataIndex === "function") {
        await ensureInboxMetadataIndex();
      }
      const allFilenames = yoloSelectedFilenames();
      if (!allFilenames.length) {
        alert("请先选择图片。");
        return null;
      }
      const { pending: filenames, skipped } = yoloPendingDetectFilenames(allFilenames);
      if (!filenames.length) {
        if (skipped.alreadyDetect && !skipped.junk) {
          setStatus(`所选 ${skipped.alreadyDetect} 张图片已在 Detect 中，无需重复发送。`);
          return null;
        }
        alert("所选图片无法发送到 Detect（废片或已在 Detect 中）。");
        return null;
      }
      const preview = filenames.slice(0, 6).join("\n");
      const more = filenames.length > 6 ? `\n...and ${filenames.length - 6} more` : "";
      const skipNotes = [
        skipped.junk ? `${skipped.junk} 张废片` : "",
        skipped.alreadyDetect ? `${skipped.alreadyDetect} 张已在 Detect` : "",
      ].filter(Boolean);
      const skipNote = skipNotes.length ? `\n\n将跳过：${skipNotes.join("，")}。` : "";
      if (!skipConfirm && !confirm(
        `将 ${filenames.length} 张图片发送到 Detect？\n\n会写入 metadata（detect_enabled=1）并构建 detect 硬链接。${skipNote}\n\n${preview}${more}`
      )) return null;

      const updates = filenames.map(filename => ({ filename, detect_enabled: true }));
      const raw = await backendCall("upsertMetadataRows", state.workspaceRoot, JSON.stringify(updates));
      const result = JSON.parse(raw || "{}");
      if (!result.ok) throw new Error("写入 metadata 失败。");

      if (typeof ensureInboxMetadataIndex === "function") {
        inboxState.metadataLoaded = false;
        await ensureInboxMetadataIndex({ force: true });
      }

      let buildResult = null;
      if (typeof runBuildYoloLinksJob === "function") {
        buildResult = await runBuildYoloLinksJob(state.workspaceRoot, false, JSON.stringify(filenames));
      }

      if (typeof refreshImagePoolAfterJunkChange === "function") {
        await refreshImagePoolAfterJunkChange({ selectionOnly: true });
      }
      renderGallery({ patchVisible: true });
      updateReviewControls();
      updateSelectedClassPanel();

      const linked = buildResult?.detectImagesLinked || 0;
      const skipSummary = skipped.alreadyDetect
        ? `，跳过 ${skipped.alreadyDetect} 张已在 Detect`
        : "";
      if (buildResult?.errors?.length) {
        setStatus(`已写入 Detect metadata：${filenames.length} 张；构建 detect ${linked} 张${skipSummary}，${buildResult.errors.length} 个错误。`);
      } else {
        setStatus(`已发送 ${filenames.length} 张到 Detect（detect 硬链接 ${linked}${skipSummary}）。`);
      }
      return { result, buildResult, filenames, skipped };
    }

    let yoloDetectContextMenuEl = null;

    function hideYoloDetectContextMenu() {
      yoloDetectContextMenuEl?.remove();
      yoloDetectContextMenuEl = null;
    }

    function showYoloDetectContextMenu(event) {
      if (!canSendSelectedToDetect()) return;
      event.preventDefault();
      hideYoloDetectContextMenu();
      const count = selectedImagePairs().length;
      const menu = document.createElement("div");
      menu.className = "context-menu";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Send selected to Detect (${count})`;
      button.addEventListener("click", () => {
        hideYoloDetectContextMenu();
        sendSelectedToDetect().catch(showError);
      });
      menu.appendChild(button);
      document.body.appendChild(menu);
      yoloDetectContextMenuEl = menu;
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      setTimeout(() => {
        document.addEventListener("click", hideYoloDetectContextMenu, { once: true });
      }, 0);
    }

    async function onGalleryContextMenu(event, index, pair) {
      if (!canSendSelectedToDetect()) return;
      event.preventDefault();
      const selectedPaths = new Set(selectedImagePairs().map(item => item.imagePath));
      if (!selectedPaths.has(pair.imagePath)) {
        state.shiftSelectedPaths.clear();
        await selectIndex(index);
      }
      showYoloDetectContextMenu(event);
    }

    async function nextIssue() {
      if (!state.pairs.length) return;
      for (let offset = 1; offset <= state.pairs.length; offset++) {
        const index = (state.currentIndex + offset) % state.pairs.length;
        const path = state.pairs[index].imagePath;
        if (!state.reviewedPaths.has(path) || state.flaggedPaths.has(path)) {
          await selectIndex(index);
          return;
        }
      }
      alert("No unreviewed or flagged image in the current filter.");
    }

    function updateReviewControls() {
      const pair = state.pairs[state.currentIndex];
      const path = pair?.imagePath;
      const reviewed = path && state.reviewedPaths.has(path);
      const flagged = path && state.flaggedPaths.has(path);
      const selected = selectedImagePairs();
      if (selected.length > 1) {
        const reviewedCount = selected.filter(item => state.reviewedPaths.has(item.imagePath)).length;
        el.markReviewedBtn.textContent = `Reviewed ${reviewedCount}/${selected.length}`;
      } else {
        el.markReviewedBtn.textContent = reviewed ? "Reviewed: Yes" : "Reviewed";
      }
      el.flagBtn.textContent = flagged ? "Flagged" : "Flag";
      el.markReviewedBtn.classList.toggle("primary", Boolean(reviewed));
      el.flagBtn.classList.toggle("danger", Boolean(flagged));

      const showJunk = canMarkYoloJunk();
      if (el.markJunkBtn) {
        el.markJunkBtn.hidden = !showJunk;
        if (!showJunk) return;
        const filenames = yoloSelectedFilenames();
        const pendingCount = filenames.filter(name => !isYoloJunkFilename(name)).length;
        if (selected.length > 1) {
          el.markJunkBtn.textContent = pendingCount
            ? `标记废片 (${pendingCount})`
            : "已是废片";
        } else {
          const filename = path?.split("/").pop() || "";
          const isJunk = filename && isYoloJunkFilename(filename);
          el.markJunkBtn.textContent = isJunk ? "已是废片" : "标记废片";
        }
        el.markJunkBtn.disabled = !pendingCount;
        el.markJunkBtn.classList.toggle("is-junk", Boolean(filenames.length) && !pendingCount);
      }
    }

	    function hasDatasetOpen() {
	      return Boolean(state.datasetHandle || state.datasetBackendRoot);
	    }
