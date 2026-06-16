// ===== Dataset Merge: drop & source management =====
	    async function onMergeDrop(event) {
	      event.preventDefault();
	      event.stopPropagation();
	      el.mergeDropZone.classList.remove("drop-hover");
	      let added = 0;
	      const handledFileNames = new Set();

	      for (const item of [...(event.dataTransfer?.items || [])]) {
	        if (item.kind !== "file") continue;
	        try {
	          if (item.getAsFileSystemHandle) {
	            const handle = await item.getAsFileSystemHandle();
	            if (handle?.kind === "directory") {
	              await addMergeSourceHandle(handle);
	              added += 1;
	              continue;
	            }
	            if (handle?.kind === "file" && isZipFile({ name: handle.name })) {
	              const file = await handle.getFile();
	              if (file) {
	                handledFileNames.add(file.name);
	                if (await addMergeZipFile(file)) added += 1;
	                continue;
	              }
	            }
	          }
	        } catch (error) {
	          console.warn("Merge drop handle failed:", error);
	        }
	        const file = item.getAsFile?.();
	        if (file && isZipFile(file)) {
	          handledFileNames.add(file.name);
	          if (await addMergeZipFile(file)) added += 1;
	        }
	      }

	      for (const file of [...(event.dataTransfer?.files || [])]) {
	        if (isZipFile(file) && !handledFileNames.has(file.name)) {
	          if (await addMergeZipFile(file)) added += 1;
	        }
	      }

	      setMergeLog(added ? `Added ${added} source item(s).` : "No folders or ZIP files were added. Try Add ZIP or drop onto the dashed box.");
	    }

	    async function addMergeSourceFolder() {
	      if (await ensurePythonBackend()) {
	        const path = await backendCall("chooseDirectory", "选择源文件夹");
	        if (!path) return;
	        const raw = await backendCall("openFolder", path, false);
	        const result = JSON.parse(raw || "{}");
	        if (!result.ok) {
	          alert("无法打开该文件夹。");
	          return;
	        }
	        const name = result.name || path.split(/[\\/]/).filter(Boolean).pop() || path;
	        for (const source of mergeState.sources) {
	          if (source.kind === "backend" && source.backendRoot === result.root) return;
	        }
	        mergeState.sources.push({ kind: "backend", backendRoot: result.root, name });
	        renderMergeSources();
	        setMergeLog(`Added source folder: ${result.root}`);
	        return;
	      }
	      if (!window.showDirectoryPicker) {
	        alert("Folder selection needs the Python app, Chrome, or Edge.");
	        return;
	      }
	      try {
	        const handle = await showDirectoryPicker({ mode: "read" });
	        await addMergeSourceHandle(handle);
	        setMergeLog(`Added source folder: ${handle.name}`);
	      } catch (error) {
	        if (error?.name !== "AbortError") throw error;
	      }
	    }

	    async function addMergeSourceHandle(handle) {
	      for (const source of mergeState.sources) {
	        if (source.kind === "folder" && await handlesMatch(source.handle, handle)) return;
	      }
	      mergeState.sources.push({ kind: "folder", handle, name: handle.name });
	      renderMergeSources();
	    }

	    async function addMergeZipFile(file) {
	      if (!isZipFile(file)) {
	        alert(`${file.name} is not a ZIP file.`);
	        return false;
	      }
	      let buffer;
	      try {
	        setMergeLog(`Reading ${file.name}...`);
	        buffer = await readFileArrayBuffer(file);
	      } catch (error) {
	        const message = `Cannot read ZIP file ${file.name}:\n${error.message}\n\nTry Add ZIP instead of drag-and-drop, or copy the ZIP to a local folder such as Desktop/Downloads and add it again.`;
	        alert(message);
	        setMergeLog(`Failed to read ${file.name}: ${error.message}`);
	        return false;
	      }
	      const duplicate = mergeState.sources.some(source =>
	        source.kind === "zip" &&
	        source.name === file.name &&
	        source.buffer?.byteLength === buffer.byteLength
	      );
	      if (duplicate) return false;
	      mergeState.sources.push({ kind: "zip", buffer, name: file.name });
	      renderMergeSources();
	      setMergeLog(`Added ZIP: ${file.name} (${formatByteSize(buffer.byteLength)})`);
	      return true;
	    }

	    function readFileArrayBuffer(file) {
	      if (!file) return Promise.reject(new Error("Missing file object."));
	      return new Promise((resolve, reject) => {
	        const reader = new FileReader();
	        reader.onload = () => resolve(reader.result);
	        reader.onerror = () => reject(reader.error || new Error("FileReader failed."));
	        reader.onabort = () => reject(new Error("File read was aborted."));
	        reader.readAsArrayBuffer(file);
	      });
	    }

	    function formatByteSize(bytes) {
	      if (bytes < 1024) return `${bytes} B`;
	      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	    }
// ===== Merge target & workspace sync =====

	    function updateMergeTargetDisplay() {
	      if (!el.mergeTargetName) return;
	      if (!mergeState.targetBackendRoot && !mergeState.targetHandle) {
	        el.mergeTargetName.textContent = state.workspaceRoot ? "工作区默认（待同步）" : "No target folder";
	        return;
	      }
	      if (mergeState.targetExplicit) {
	        el.mergeTargetName.textContent = mergeState.targetName || "Target folder";
	        return;
	      }
	      if (state.workspaceRoot) {
	        const task = mergeTask();
	        const label = task === "classify" ? "clf_dataset" : "detect_dataset";
	        el.mergeTargetName.textContent = `${mergeState.targetName}（工作区 ${label} 默认）`;
	        return;
	      }
	      el.mergeTargetName.textContent = mergeState.targetName || "Target folder";
	    }

	    async function syncMergeTargetWithWorkspace(workspaceRoot, options = {}) {
	      const { workspaceChanged = false } = options;
	      if (workspaceChanged) {
	        mergeState.targetExplicit = false;
	        mergeState.workspaceDetectRoot = "";
	        mergeState.workspaceClfRoot = "";
	      }
	      if (mergeState.targetExplicit) {
	        updateMergeTargetDisplay();
	        return;
	      }
	      if (!workspaceRoot || !await ensurePythonBackend()) {
	        updateMergeTargetDisplay();
	        return;
	      }
	      try {
	        const info = JSON.parse(await backendCall("getWorkspaceInfo", workspaceRoot));
	        if (!info?.ok) return;
	        mergeState.workspaceDetectRoot = info.detectDataset || "";
	        mergeState.workspaceClfRoot = info.clfDataset || "";
	        const task = mergeTask();
	        const targetPath = task === "classify" ? info.clfDataset : info.detectDataset;
	        if (targetPath) {
	          mergeState.targetBackendRoot = targetPath;
	          mergeState.targetHandle = null;
	          mergeState.targetName = targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath;
	          const label = task === "classify" ? "clf_dataset" : "detect_dataset";
	          setMergeLog(`Target folder: ${label}（工作区默认）`);
	          updateMergeTargetDisplay();
	        }
	      } catch (error) {
	        console.warn("Merge target sync:", error);
	      }
	    }

	    window.syncMergeTargetWithWorkspace = syncMergeTargetWithWorkspace;

	    async function ensureMergeTargetReady() {
	      if (mergeState.targetExplicit && (mergeState.targetBackendRoot || mergeState.targetHandle)) {
	        return true;
	      }
	      if (state.workspaceRoot) {
	        await syncMergeTargetWithWorkspace(state.workspaceRoot);
	        if (mergeState.targetBackendRoot || mergeState.targetHandle) return true;
	      }
	      if (mergeState.targetBackendRoot || mergeState.targetHandle) return true;
	      alert(state.workspaceRoot
	        ? "无法解析工作区 detect_dataset / clf_dataset 路径，请手动选择 Target Folder。"
	        : "Choose a target folder.");
	      return false;
	    }

	    async function inferValToTrainTask(targetPath, targetHandle = null) {
	      if (targetPath && await ensurePythonBackend()) {
	        try {
	          const result = JSON.parse(await backendCall("inferDatasetTask", targetPath));
	          if (result?.task) return result.task;
	        } catch (error) {
	          console.warn("inferDatasetTask:", error);
	        }
	      }
	      if (targetPath && mergeState.workspaceDetectRoot && targetPath === mergeState.workspaceDetectRoot) {
	        return "detect";
	      }
	      if (targetPath && mergeState.workspaceClfRoot && targetPath === mergeState.workspaceClfRoot) {
	        return "classify";
	      }
	      if (targetHandle) {
	        const imagesRoot = await targetHandle.getDirectoryHandle("images", { create: false }).catch(() => null);
	        if (imagesRoot) return "detect";
	        const valDir = await targetHandle.getDirectoryHandle("val", { create: false }).catch(() => null);
	        if (valDir) {
	          for await (const [, handle] of valDir.entries()) {
	            if (handle.kind === "directory") return "classify";
	          }
	        }
	      }
	      return mergeTask();
	    }

	    async function chooseMergeTargetFolder() {
	      if (await ensurePythonBackend()) {
	        const path = await backendCall("chooseDirectory", "选择合并目标文件夹");
	        if (!path) return;
	        const raw = await backendCall("openFolder", path, false);
	        const result = JSON.parse(raw || "{}");
	        if (!result.ok) {
	          alert("无法打开该文件夹。");
	          return;
	        }
	        mergeState.targetHandle = null;
	        mergeState.targetBackendRoot = result.root;
	        mergeState.targetName = result.name || path.split(/[\\/]/).filter(Boolean).pop() || path;
	        mergeState.targetExplicit = true;
	        updateMergeTargetDisplay();
	        setMergeLog(`Target folder: ${result.root}`);
	        return;
	      }
	      if (!window.showDirectoryPicker) {
	        alert("Target folder selection needs the Python app, Chrome, or Edge.");
	        return;
	      }
	      try {
	        mergeState.targetBackendRoot = "";
	        mergeState.targetName = "";
	        mergeState.targetHandle = await showDirectoryPicker({ mode: "readwrite" });
	        mergeState.targetName = mergeState.targetHandle.name;
	        mergeState.targetExplicit = true;
	        updateMergeTargetDisplay();
	        setMergeLog(`Target folder: ${mergeState.targetName}`);
	      } catch (error) {
	        if (error?.name !== "AbortError") throw error;
	      }
	    }

	    function clearMergeSources() {
	      mergeState.sources = [];
	      renderMergeSources();
	      setMergeLog("Source list cleared.");
	    }

	    function renderMergeSources() {
	      el.mergeSourceCount.textContent = String(mergeState.sources.length);
	      if (!mergeState.sources.length) {
	        el.mergeSourceList.innerHTML = `<div class="empty">No source folders or ZIP files added.</div>`;
	        return;
	      }
	      el.mergeSourceList.innerHTML = "";
	      mergeState.sources.forEach((source, index) => {
	        const row = document.createElement("div");
	        row.className = "merge-source";
	        row.innerHTML = `<span>${escapeHtml(source.kind.toUpperCase())}: ${escapeHtml(source.name)}</span><button type="button" class="danger">Remove</button>`;
	        row.querySelector("button").addEventListener("click", () => {
	          mergeState.sources.splice(index, 1);
	          renderMergeSources();
	        });
	        el.mergeSourceList.appendChild(row);
	      });
	    }

	    function showMergeProgressOverlay() {
	      if (el.mergeProgressOverlay) el.mergeProgressOverlay.hidden = false;
	    }

	    function hideMergeProgressOverlay() {
	      if (el.mergeProgressOverlay) el.mergeProgressOverlay.hidden = true;
	    }

	    function setMergeProgress(value, total, text) {
	      if (!el.mergeProgress) return;
	      el.mergeProgress.max = Math.max(1, total || 1);
	      el.mergeProgress.value = Math.max(0, value || 0);
	      if (el.mergeProgressText) {
	        el.mergeProgressText.textContent = `${value || 0} / ${total || 0}`;
	      }
	      if (el.mergeProgressDetail) {
	        el.mergeProgressDetail.textContent = text || "";
	      }
	    }
// ===== Merge orchestration =====

	    async function mergeDatasets() {
	      if (!mergeState.sources.length) {
	        alert("Add at least one source folder or ZIP file.");
	        return;
	      }
	      if (!await ensureMergeTargetReady()) return;
	      for (const source of mergeState.sources) {
	        if (source.kind === "folder" && mergeState.targetHandle && await handlesMatch(source.handle, mergeState.targetHandle)) {
	          alert(`Target folder cannot also be a source folder: ${source.name}`);
	          return;
	        }
	        if (source.kind === "backend" && mergeState.targetBackendRoot && source.backendRoot === mergeState.targetBackendRoot) {
	          alert(`Target folder cannot also be a source folder: ${source.name}`);
	          return;
	        }
	      }

	      const task = mergeTask();
	      const autoRename = el.autoRenameConflicts.checked;
	      const existing = new Set();
	      const reserved = new Set();
	      const stats = { copied: 0, renamed: 0, skipped: 0, failed: 0, emptyLabels: 0, noClass: 0 };
	      const targetLabel = mergeState.targetName || mergeState.targetHandle?.name || mergeState.targetBackendRoot || "target";
	      const log = [`Scanning target folder "${targetLabel}"...`, `Task: ${task}`];
	      const copyTasks = [];
	      const trainLines = [];
	      const yamlCandidates = [];

	      showMergeProgressOverlay();
	      if (el.runMergeBtn) el.runMergeBtn.disabled = true;
	      setMergeProgress(0, 1, "Scanning target folder...");
	      try {
	        if (mergeState.targetBackendRoot) {
	          await collectBackendExistingPaths(mergeState.targetBackendRoot, "", existing);
	        } else {
	          await collectExistingPaths(mergeState.targetHandle, "", existing);
	        }
	        log.push(`Target currently has ${existing.size} file(s).`);

	        for (let sourceIndex = 0; sourceIndex < mergeState.sources.length; sourceIndex += 1) {
	          const source = mergeState.sources[sourceIndex];
	          const prefix = `d${sourceIndex + 1}_`;
	          setMergeProgress(0, 1, `Planning ${source.name}...`);
	          const sourceFiles = new Map();
	          if (source.kind === "folder") {
	            await collectSourceFiles(source.handle, "", sourceFiles);
	          } else if (source.kind === "backend") {
	            await collectBackendSourceFiles(source.backendRoot, "", sourceFiles);
	          } else {
	            await collectZipSourceFiles(source, sourceFiles);
	          }
	          const normalizedSourceFiles = normalizeDatasetRoot(sourceFiles, task);
	          const entries = [...normalizedSourceFiles.entries()].sort((a, b) => naturalCompare(a[0], b[0]));
	          const pathPlan = new Map();
	          if (task === "detect") {
	            const yamlPath = findDatasetYamlPath(normalizedSourceFiles);
	            if (yamlPath) yamlCandidates.push({ sourceName: source.name, path: yamlPath, fileSource: normalizedSourceFiles.get(yamlPath) });
	          }
	          log.push(`\n${source.name}: ${entries.length} file(s), prefix ${prefix}`);

	          for (const [path] of entries) {
	            if (!IMAGE_EXTENSIONS.has(ext(path))) continue;
	            const destination = task === "classify"
	              ? chooseClassifyImageDestination(path, prefix, existing, reserved, autoRename)
	              : chooseTrainImageDestination(path, prefix, existing, reserved, autoRename);
	            if (!destination) {
	              stats.skipped += 1;
	              if (task === "classify" && !classificationClassNameForPath(path)) {
	                stats.noClass += 1;
	                log.push(`SKIP no class folder: ${path}`);
	              } else {
	                log.push(`SKIP conflict: ${path}`);
	              }
	              continue;
	            }
	            pathPlan.set(path, destination);
	            reserved.add(destination.toLowerCase());
	            if (task === "detect") {
	              trainLines.push(destination);
	              const labelDestination = trainLabelPathForImage(destination);
	              const labelSource = labelSourceForImage(path, normalizedSourceFiles);
	              if (labelSource) {
	                pathPlan.set(labelSource, labelDestination);
	              } else {
	                copyTasks.push({
	                  path: `${path} (empty label)`,
	                  destination: labelDestination,
	                  fileSource: { kind: "text", text: "" },
	                  sourceName: source.name
	                });
	                stats.emptyLabels += 1;
	                log.push(`EMPTY label created for ${path}`);
	              }
	              reserved.add(labelDestination.toLowerCase());
	            }
	          }

	          for (const [path, fileSource] of entries) {
	            const destination = pathPlan.get(path);
	            if (!destination) continue;
	            copyTasks.push({ path, destination, fileSource, sourceName: source.name });
	          }
	        }

	        if (task === "detect" && yamlCandidates.length) {
	          copyTasks.unshift({
	            path: yamlCandidates[0].path,
	            destination: "data.yaml",
	            fileSource: yamlCandidates[0].fileSource,
	            sourceName: yamlCandidates[0].sourceName
	          });
	          const differingYaml = await findDifferingYaml(yamlCandidates);
	          if (differingYaml) {
	            log.push(`WARNING data.yaml differs: ${differingYaml.sourceName}/${differingYaml.path}. Copied ${yamlCandidates[0].sourceName}/${yamlCandidates[0].path} as data.yaml.`);
	          } else {
	            log.push(`Copied ${yamlCandidates[0].sourceName}/${yamlCandidates[0].path} as data.yaml.`);
	          }
	        } else if (task === "detect") {
	          log.push("WARNING no data.yaml found in sources.");
	        }
	        if (task === "detect") {
	          copyTasks.push({
	            path: "generated train.txt",
	            destination: "train.txt",
	            fileSource: { kind: "text", text: `${trainLines.join("\n")}${trainLines.length ? "\n" : ""}` },
	            sourceName: "merge"
	          });
	        }

	        const total = copyTasks.length;
	        log.push(`\nCopying ${total} file(s)...`);
	        setMergeProgress(0, total, total ? `Copying 0 / ${total}...` : "Nothing to copy.");

	        for (let index = 0; index < copyTasks.length; index += 1) {
	          const task = copyTasks[index];
	          setMergeProgress(index, total, `${task.sourceName}\n${task.destination}`);
	          try {
	            if (mergeState.targetBackendRoot) {
	              await copySourceFileToBackendFolder(mergeState.targetBackendRoot, task.destination, task.fileSource);
	            } else {
	              await copySourceFileToFolder(mergeState.targetHandle, task.destination, task.fileSource);
	            }
	            existing.add(task.destination.toLowerCase());
	            stats.copied += 1;
	            if (task.destination !== task.path) {
	              stats.renamed += 1;
	              log.push(`RENAMED ${task.path} -> ${task.destination}`);
	            }
	          } catch (error) {
	            stats.failed += 1;
	            log.push(`FAILED ${task.path}: ${error.message}`);
	          }
	          setMergeProgress(index + 1, total, `${task.sourceName}\n${task.destination}`);
	        }

	        const classNote = task === "classify" ? `, no class ${stats.noClass}` : "";
	        const labelNote = task === "detect" ? `, empty labels ${stats.emptyLabels}` : "";
	        const summary = `Done. Copied ${stats.copied} file(s), renamed ${stats.renamed}, skipped ${stats.skipped}, failed ${stats.failed}${labelNote}${classNote}.`;
	        log.push(`\n${summary}`);
	        setMergeLog(log.join("\n"));
	        setStatus(`Merge complete: copied ${stats.copied}, renamed ${stats.renamed}, skipped ${stats.skipped}, failed ${stats.failed}${labelNote}${classNote}.`);
	        setMergeProgress(total, total, summary);
	        if (!total) {
	          alert(task === "classify"
	            ? "No files to copy. Add classification source folders/ZIPs with images under class folders, then try again."
	            : "No files to copy. Add source folders/ZIPs that contain images and labels, then try again.");
	        } else {
	          alert(`Merge complete.\nTask: ${task}\nCopied: ${stats.copied}\nRenamed: ${stats.renamed}\nSkipped: ${stats.skipped}\nFailed: ${stats.failed}${task === "detect" ? `\nEmpty labels: ${stats.emptyLabels}` : `\nNo class: ${stats.noClass}`}`);
	        }
	      } catch (error) {
	        const message = error?.message || String(error);
	        log.push(`\nMerge failed: ${message}`);
	        setMergeLog(log.join("\n"));
	        setStatus(`Merge failed: ${message}`);
	        setMergeProgress(0, 1, message);
	        alert(`Merge failed:\n${message}`);
	        console.error(error);
	      } finally {
	        if (el.runMergeBtn) el.runMergeBtn.disabled = false;
	        hideMergeProgressOverlay();
	      }
	    }
// ===== Source file collection =====

	    async function collectExistingPaths(dirHandle, prefix, out) {
	      for await (const [name, handle] of dirHandle.entries()) {
	        const path = prefix ? `${prefix}/${name}` : name;
	        if (handle.kind === "directory") await collectExistingPaths(handle, path, out);
	        else out.add(path.toLowerCase());
	      }
	    }

	    async function collectBackendExistingPaths(rootPath, prefix, out) {
	      const paths = JSON.parse(await backendCall("listDatasetFiles", rootPath) || "[]");
	      for (const path of paths) {
	        const normalized = prefix ? `${prefix}/${path}` : path;
	        out.add(normalized.toLowerCase());
	      }
	    }

	    async function collectBackendSourceFiles(rootPath, prefix, out) {
	      const paths = JSON.parse(await backendCall("listDatasetFiles", rootPath) || "[]");
	      for (const path of paths) {
	        const normalized = prefix ? `${prefix}/${path}` : path;
	        const handle = backendFileHandle(rootPath, path);
	        try {
	          const file = await handle.getFile();
	          out.set(normalized, {
	            kind: "buffer",
	            buffer: await file.arrayBuffer(),
	            type: file.type
	          });
	        } catch (error) {
	          throw new Error(`Cannot read source file "${normalized}": ${error.message}`);
	        }
	      }
	    }

	    async function mergeBlobToBase64(blob) {
	      return new Promise((resolve, reject) => {
	        const reader = new FileReader();
	        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
	        reader.onerror = () => reject(reader.error);
	        reader.readAsDataURL(blob);
	      });
	    }

	    async function copySourceFileToBackendFolder(rootPath, path, source) {
	      const blob = await sourceBlob(source);
	      const parts = path.split("/");
	      const relativePath = parts.join("/");
	      if (blob.type.startsWith("text/") || /\.(txt|yaml|yml|json|csv)$/i.test(relativePath)) {
	        await backendCall("writeTextFile", rootPath, relativePath, await blob.text());
	        return;
	      }
	      const base64 = await mergeBlobToBase64(blob);
	      await backendCall("writeFileBase64", rootPath, relativePath, base64);
	    }

	    async function collectSourceFiles(dirHandle, prefix, out) {
	      for await (const [name, handle] of dirHandle.entries()) {
	        const path = prefix ? `${prefix}/${name}` : name;
	        if (handle.kind === "directory") await collectSourceFiles(handle, path, out);
	        else {
	          try {
	            const file = await handle.getFile();
	            out.set(path, {
	              kind: "buffer",
	              buffer: await file.arrayBuffer(),
	              type: file.type
	            });
	          } catch (error) {
	            throw new Error(`Cannot read source file "${path}": ${error.message}`);
	          }
	        }
	      }
	    }

	    async function collectZipSourceFiles(zipSource, out) {
	      if (!zipSource.buffer) {
	        throw new Error(`ZIP source "${zipSource.name}" is missing cached data. Remove it and add the ZIP again.`);
	      }
	      const zip = await readZipEntries(zipSource.buffer, zipSource.name);
	      for (const entry of zip.entries) {
	        if (entry.directory) continue;
	        const path = cleanZipPath(entry.name);
	        if (!path || path.startsWith("__MACOSX/") || path.endsWith(".DS_Store")) continue;
	        out.set(path, { kind: "zip", zipBuffer: zip.buffer, entry });
	      }
	    }
// ===== Dataset path normalization =====

	    function normalizeDatasetRoot(sourceFiles, task = "detect") {
	      const paths = [...sourceFiles.keys()];
	      if (!paths.length) return sourceFiles;
	      const firstParts = new Set(paths.map(path => path.split("/")[0]).filter(Boolean));
	      if (firstParts.size !== 1) return sourceFiles;
	      const root = [...firstParts][0];
	      const stripped = paths
	        .filter(path => path.startsWith(`${root}/`))
	        .map(path => path.slice(root.length + 1));
	      if (stripped.length !== paths.length) return sourceFiles;
	      const hasDatasetShape = stripped.some(path =>
	        path === "data.yaml" ||
	        /(^|\/)dataset\.ya?ml$/i.test(path) ||
	        /^(images|labels|train|val|test)\//.test(path)
	      ) || (task === "classify" && stripped.some(path => IMAGE_EXTENSIONS.has(ext(path)) && classificationClassNameForPath(path)));
	      if (!hasDatasetShape) return sourceFiles;
	      const normalized = new Map();
	      for (const [path, source] of sourceFiles.entries()) {
	        normalized.set(path.slice(root.length + 1), source);
	      }
	      return normalized;
	    }
// ===== Train / classify destination rules =====

	    function chooseTrainImageDestination(path, prefix, existing, reserved, autoRename) {
	      const filename = safeDatasetFilename(path.split("/").pop());
	      const dot = filename.lastIndexOf(".");
	      const stem = dot > 0 ? filename.slice(0, dot) : filename;
	      const suffix = dot > 0 ? filename.slice(dot) : "";
	      let index = 1;
	      while (index < 10000) {
	        const renamed = index === 1 ? `${prefix}${stem}${suffix}` : `${prefix}${stem}_${index}${suffix}`;
	        const candidate = `images/train/${renamed}`;
	        const labelCandidate = trainLabelPathForImage(candidate);
	        const hasConflict = [candidate, labelCandidate].some(p => existing.has(p.toLowerCase()) || reserved.has(p.toLowerCase()));
	        if (!hasConflict) return candidate;
	        if (!autoRename) return null;
	        index += 1;
	      }
	      return null;
	    }

	    function chooseClassifyImageDestination(path, prefix, existing, reserved, autoRename) {
	      const className = classificationClassNameForPath(path);
	      if (!className) return null;
	      const classFolder = safeDatasetPathSegment(className);
	      const filename = safeDatasetFilename(path.split("/").pop());
	      const dot = filename.lastIndexOf(".");
	      const stem = dot > 0 ? filename.slice(0, dot) : filename;
	      const suffix = dot > 0 ? filename.slice(dot) : "";
	      let index = 1;
	      while (index < 10000) {
	        const renamed = index === 1 ? `${prefix}${stem}${suffix}` : `${prefix}${stem}_${index}${suffix}`;
	        const candidate = `train/${classFolder}/${renamed}`;
	        const hasConflict = existing.has(candidate.toLowerCase()) || reserved.has(candidate.toLowerCase());
	        if (!hasConflict) return candidate;
	        if (!autoRename) return null;
	        index += 1;
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

	    function trainLabelPathForImage(imagePath) {
	      const filename = imagePath.split("/").pop().replace(/\.[^.]+$/, ".txt");
	      return `labels/train/${filename}`;
	    }

	    function labelSourceForImage(imagePath, sourceFiles) {
	      return possibleLabelPathsForImage(imagePath).find(labelPath => sourceFiles.has(labelPath)) || "";
	    }

	    function possibleLabelPathsForImage(imagePath) {
	      const stem = imagePath.split("/").pop().replace(/\.[^.]+$/, "");
	      const parts = imagePath.split("/");
	      const candidates = [];
	      if (parts[0] === "images") {
	        candidates.push(["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt"));
	      }
	      candidates.push(`labels/train/${stem}.txt`);
	      candidates.push(`labels/val/${stem}.txt`);
	      candidates.push(`labels/${stem}.txt`);
	      candidates.push(imagePath.replace(/\.[^.]+$/, ".txt"));
	      return [...new Set(candidates)];
	    }

	    function findDatasetYamlPath(sourceFiles) {
	      const paths = [...sourceFiles.keys()].filter(path => /\.(ya?ml)$/i.test(path));
	      return paths.find(path => path.split("/").pop().toLowerCase() === "data.yaml")
	        || paths.find(path => /(^|\/)dataset\.ya?ml$/i.test(path))
	        || paths[0]
	        || "";
	    }

	    async function findDifferingYaml(yamlCandidates) {
	      if (yamlCandidates.length < 2) return null;
	      const first = await sourceText(yamlCandidates[0].fileSource);
	      for (const candidate of yamlCandidates.slice(1)) {
	        if ((await sourceText(candidate.fileSource)).trim() !== first.trim()) return candidate;
	      }
	      return null;
	    }

	    async function sourceText(source) {
	      const blob = await sourceBlob(source);
	      return blob.text();
	    }

	    function safeDatasetFilename(filename) {
	      return String(filename || "image").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_");
	    }

	    function safeDatasetPathSegment(segment) {
	      return String(segment || "class").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "class";
	    }

	    async function copySourceFileToFolder(rootHandle, path, source) {
	      const parts = path.split("/");
	      let dir = rootHandle;
	      for (const part of parts.slice(0, -1)) {
	        dir = await dir.getDirectoryHandle(part, { create: true });
	      }
	      const targetHandle = await dir.getFileHandle(parts.at(-1), { create: true });
	      const writable = await targetHandle.createWritable();
	      await writable.write(await sourceBlob(source));
	      await writable.close();
	    }

	    async function sourceBlob(source) {
	      if (source.kind === "buffer") return new Blob([source.buffer], { type: source.type || "application/octet-stream" });
	      if (source.kind === "text") return new Blob([source.text || ""], { type: "text/plain" });
	      return zipEntryBlob(source.zipBuffer, source.entry);
	    }

	    function isZipFile(file) {
	      return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
	    }

	    async function readZipEntries(fileOrBuffer, label = "ZIP") {
	      const buffer = fileOrBuffer instanceof ArrayBuffer
	        ? fileOrBuffer
	        : await fileOrBuffer.arrayBuffer();
	      const view = new DataView(buffer);
	      const eocdOffset = findEndOfCentralDirectory(view);
	      if (eocdOffset < 0) throw new Error(`Cannot read ZIP directory: ${label}`);
	      const totalEntries = view.getUint16(eocdOffset + 10, true);
	      const centralOffset = view.getUint32(eocdOffset + 16, true);
	      const entries = [];
	      let offset = centralOffset;
	      const decoder = new TextDecoder();
	      for (let i = 0; i < totalEntries; i += 1) {
	        if (view.getUint32(offset, true) !== 0x02014b50) break;
	        const flags = view.getUint16(offset + 8, true);
	        const method = view.getUint16(offset + 10, true);
	        const compressedSize = view.getUint32(offset + 20, true);
	        const uncompressedSize = view.getUint32(offset + 24, true);
	        const nameLength = view.getUint16(offset + 28, true);
	        const extraLength = view.getUint16(offset + 30, true);
	        const commentLength = view.getUint16(offset + 32, true);
	        const localHeaderOffset = view.getUint32(offset + 42, true);
	        const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
	        const name = decoder.decode(nameBytes);
	        entries.push({
	          name,
	          method,
	          compressedSize,
	          uncompressedSize,
	          localHeaderOffset,
	          directory: name.endsWith("/"),
	          utf8: Boolean(flags & 0x0800)
	        });
	        offset += 46 + nameLength + extraLength + commentLength;
	      }
	      return { buffer, entries };
	    }

	    function findEndOfCentralDirectory(view) {
	      const min = Math.max(0, view.byteLength - 22 - 65535);
	      for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
	        if (view.getUint32(offset, true) === 0x06054b50) return offset;
	      }
	      return -1;
	    }

	    async function zipEntryBlob(buffer, entry) {
	      const view = new DataView(buffer);
	      const offset = entry.localHeaderOffset;
	      if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`Bad ZIP entry: ${entry.name}`);
	      const nameLength = view.getUint16(offset + 26, true);
	      const extraLength = view.getUint16(offset + 28, true);
	      const dataStart = offset + 30 + nameLength + extraLength;
	      const compressed = new Blob([buffer.slice(dataStart, dataStart + entry.compressedSize)]);
	      if (entry.method === 0) return compressed;
	      if (entry.method === 8) {
	        if (!("DecompressionStream" in window)) {
	          throw new Error("This browser cannot decompress ZIP deflate entries.");
	        }
	        const stream = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
	        return new Response(stream).blob();
	      }
	      throw new Error(`Unsupported ZIP compression method ${entry.method}: ${entry.name}`);
	    }

	    function cleanZipPath(path) {
	      const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
	      if (parts.includes("..")) return "";
	      return parts.join("/");
	    }

	    async function handlesMatch(a, b) {
	      if (!a || !b || !a.isSameEntry) return false;
	      try {
	        return await a.isSameEntry(b);
	      } catch {
	        return false;
	      }
	    }

	    function setMergeLog(text) {
	      el.mergeLog.textContent = text;
	    }

	    function mergeTask() {
	      return document.querySelector("input[name=mergeTask]:checked")?.value === "classify" ? "classify" : "detect";
	    }

	    function updateMergeModeHint() {
	      const isClassify = mergeTask() === "classify";
	      if (el.mergeValToTrainHint) {
	        el.mergeValToTrainHint.textContent = state.workspaceRoot && !mergeState.targetExplicit
	          ? "已绑定工作区：按目标文件夹结构自动识别 detect / classify，把 val 移回 train。也可点击 Target Folder 指定其他目录。"
	          : isClassify
	            ? "把 val/<class> 下的图片移动回 train/<class>，自动处理重名。在上方已选 Target Folder 上操作。"
	            : "把 images/val 与 labels/val 中的配对移回 train，自动处理重名。在上方已选 Target Folder 上操作。";
	      }
	      if (!el.mergeModeHint) return;
	      const workspaceNote = state.workspaceRoot && !mergeState.targetExplicit
	        ? ` 已绑定工作区时默认输出到 ${isClassify ? "clf_dataset" : "detect_dataset"}。`
	        : "";
	      el.mergeModeHint.textContent = isClassify
	        ? `Classify output writes images to train/<class_name>/ with d1_/d2_/d3_ prefixes. Images must already be under train/<class>, val/<class>, test/<class>, or <class>/ folders.${workspaceNote}`
	        : `Detect output keeps the CVAT-style structure: images/train, labels/train, generated train.txt, and d1_/d2_/d3_ prefixes. Existing train/val/test TXT lists are ignored.${workspaceNote}`;
	      if (state.workspaceRoot && !mergeState.targetExplicit) {
	        syncMergeTargetWithWorkspace(state.workspaceRoot).catch(error => console.warn("Merge target sync:", error));
	      } else {
	        updateMergeTargetDisplay();
	      }
	    }

	    async function mergeFileExistsInDir(dirHandle, filename) {
	      try {
	        await dirHandle.getFileHandle(filename);
	        return true;
	      } catch {
	        return false;
	      }
	    }

	    async function ensureNestedDirectory(rootHandle, parts) {
	      let current = rootHandle;
	      for (const part of parts) {
	        current = await current.getDirectoryHandle(part, { create: true });
	      }
	      return current;
	    }

	    async function collectNestedImages(dirHandle, prefix, out) {
	      for await (const [name, handle] of dirHandle.entries()) {
	        const path = prefix ? `${prefix}/${name}` : name;
	        if (handle.kind === "directory") {
	          await collectNestedImages(handle, path, out);
	        } else if (IMAGE_EXTENSIONS.has(ext(name))) {
	          out.push({ path, handle });
	        }
	      }
	    }

	    async function uniqueFileNameInDir(dirHandle, filename) {
	      if (!await mergeFileExistsInDir(dirHandle, filename)) return filename;
	      const dot = filename.lastIndexOf(".");
	      const stem = dot > 0 ? filename.slice(0, dot) : filename;
	      const suffix = dot > 0 ? filename.slice(dot) : "";
	      for (let index = 2; index < 10000; index += 1) {
	        const candidate = `${stem}_${index}${suffix}`;
	        if (!await mergeFileExistsInDir(dirHandle, candidate)) return candidate;
	      }
	      throw new Error(`Cannot create unique filename for ${filename}`);
	    }
// ===== Val to train operations =====

	    function beginValToTrainOperation(progressMessage) {
	      showMergeProgressOverlay();
	      if (el.runMergeBtn) el.runMergeBtn.disabled = true;
	      if (el.mergeValToTrainBtn) el.mergeValToTrainBtn.disabled = true;
	      setMergeProgress(0, 1, progressMessage);
	    }

	    function endValToTrainOperation() {
	      if (el.runMergeBtn) el.runMergeBtn.disabled = false;
	      if (el.mergeValToTrainBtn) el.mergeValToTrainBtn.disabled = false;
	      hideMergeProgressOverlay();
	    }

	    function reportValToTrainResult(result) {
	      const log = [result.message || "Val → Train finished."];
	      if (result.failures?.length) log.push(...result.failures.map(item => `FAILED ${item}`));
	      setMergeLog(log.join("\n"));
	      setStatus(result.message || "Val → Train finished.");
	      const total = Number(result.scanned) || Number(result.moved) || 1;
	      setMergeProgress(total, total, result.message || "Done.");
	      if (!result.ok && !result.moved) alert(result.message || "Nothing to move.");
	      else alert(result.message || "Val → Train finished.");
	    }

	    async function moveValBackToTrainWithBackend(task) {
	      beginValToTrainOperation(task === "detect"
	        ? "Moving images/val and labels/val back to train/..."
	        : "Moving val/ images to train/...");
	      try {
	        const raw = await backendCall("moveValBackToTrain", mergeState.targetBackendRoot, "auto");
	        const result = JSON.parse(raw || "{}");
	        if (result.message) {
	          result.message = `${task === "detect" ? "[detect]" : "[classify]"} ${result.message}`;
	        }
	        reportValToTrainResult(result);
	      } finally {
	        endValToTrainOperation();
	      }
	    }

	    async function moveClassifyValBackToTrainBrowser(root) {
	      const autoRename = true;
	      beginValToTrainOperation("Moving val/ images to train/...");
	      const log = [];
	      const stats = { scanned: 0, moved: 0, renamed: 0, skipped: 0, failed: 0, removedDirs: 0 };

	      try {
	        const valDir = await root.getDirectoryHandle("val", { create: false }).catch(() => null);
	        if (!valDir) {
	          alert("No val/ folder found in the target. Nothing to move.");
	          return;
	        }
	        const trainDir = await root.getDirectoryHandle("train", { create: true });

	        let total = 0;
	        for await (const [, classHandle] of valDir.entries()) {
	          if (classHandle.kind !== "directory") continue;
	          for await (const [name, fileHandle] of classHandle.entries()) {
	            if (fileHandle.kind !== "file") continue;
	            if (!IMAGE_EXTENSIONS.has(ext(name))) continue;
	            total += 1;
	          }
	        }
	        if (!total) {
	          setMergeLog("Val → Train: val/ is empty (no images).");
	          setMergeProgress(0, 1, "Nothing to move.");
	          return;
	        }

	        log.push(`Val → Train: moving ${total} image(s) from val/ back to train/ ...`);
	        setMergeProgress(0, total, `Planning 0 / ${total}...`);

	        let index = 0;
	        for await (const [className, classHandle] of valDir.entries()) {
	          if (classHandle.kind !== "directory") continue;
	          const valClassDir = classHandle;
	          const safeClass = safeDatasetPathSegment(className);
	          const trainClassDir = await trainDir.getDirectoryHandle(safeClass, { create: true });

	          const existingLower = new Set();
	          for await (const [name, h] of trainClassDir.entries()) {
	            if (h.kind === "file") existingLower.add(name.toLowerCase());
	          }

	          for await (const [name, fileHandle] of valClassDir.entries()) {
	            if (fileHandle.kind !== "file") continue;
	            if (!IMAGE_EXTENSIONS.has(ext(name))) continue;
	            stats.scanned += 1;
	            index += 1;
	            setMergeProgress(index - 1, total, `val/${safeClass}/${name}`);

	            const filename = safeDatasetFilename(name);
	            const dot = filename.lastIndexOf(".");
	            const stem = dot > 0 ? filename.slice(0, dot) : filename;
	            const suffix = dot > 0 ? filename.slice(dot) : "";

	            let destName = filename;
	            if (existingLower.has(destName.toLowerCase())) {
	              if (!autoRename) {
	                stats.skipped += 1;
	                continue;
	              }
	              let n = 2;
	              while (n < 10000) {
	                const candidate = `${stem}_${n}${suffix}`;
	                if (!existingLower.has(candidate.toLowerCase())) {
	                  destName = candidate;
	                  stats.renamed += 1;
	                  break;
	                }
	                n += 1;
	              }
	              if (destName === filename) {
	                stats.failed += 1;
	                continue;
	              }
	            }

	            try {
	              const file = await fileHandle.getFile();
	              const targetHandle = await trainClassDir.getFileHandle(destName, { create: true });
	              const writable = await targetHandle.createWritable();
	              await writable.write(await file.arrayBuffer());
	              await writable.close();

	              await valClassDir.removeEntry(name);
	              existingLower.add(destName.toLowerCase());
	              stats.moved += 1;
	            } catch (error) {
	              stats.failed += 1;
	              log.push(`FAILED val/${safeClass}/${name}: ${error?.message || error}`);
	            }

	            setMergeProgress(index, total, `Moved ${index} / ${total}`);
	          }

	          let hasAny = false;
	          for await (const [, h] of valClassDir.entries()) {
	            hasAny = true;
	            break;
	          }
	          if (!hasAny) {
	            try {
	              await valDir.removeEntry(className);
	              stats.removedDirs += 1;
	            } catch {}
	          }
	        }

	        const summary = `Val → Train done. moved ${stats.moved}, renamed ${stats.renamed}, failed ${stats.failed}.`;
	        log.push(summary);
	        setMergeLog(log.join("\n"));
	        setStatus(summary);
	        setMergeProgress(total, total, summary);
	        alert(summary);
	      } finally {
	        endValToTrainOperation();
	      }
	    }

	    async function moveDetectValBackToTrainBrowser(root) {
	      beginValToTrainOperation("Moving images/val and labels/val back to train/...");
	      const log = [];
	      const stats = { scanned: 0, moved: 0, renamed: 0, labelsMoved: 0, failed: 0 };

	      try {
	        const imagesRoot = await root.getDirectoryHandle("images", { create: false }).catch(() => null);
	        const labelsRoot = await root.getDirectoryHandle("labels", { create: false }).catch(() => null);
	        const imageValDir = imagesRoot
	          ? await imagesRoot.getDirectoryHandle("val", { create: false }).catch(() => null)
	          : null;
	        if (!imageValDir) {
	          alert("No images/val folder found in the target. Nothing to move.");
	          return;
	        }
	        const imageTrainDir = await imagesRoot.getDirectoryHandle("train", { create: true });
	        const labelValDir = labelsRoot
	          ? await labelsRoot.getDirectoryHandle("val", { create: false }).catch(() => null)
	          : null;
	        const labelTrainDir = labelsRoot
	          ? await labelsRoot.getDirectoryHandle("train", { create: true })
	          : null;

	        const images = [];
	        await collectNestedImages(imageValDir, "", images);
	        if (!images.length) {
	          setMergeLog("Val → Train: images/val is empty (no images).");
	          setMergeProgress(0, 1, "Nothing to move.");
	          return;
	        }

	        log.push(`Val → Train: moving ${images.length} image(s) from images/val back to images/train ...`);
	        setMergeProgress(0, images.length, `Planning 0 / ${images.length}...`);

	        let index = 0;
	        for (const item of images) {
	          stats.scanned += 1;
	          index += 1;
	          const relParts = item.path.split("/");
	          const fileName = relParts.pop();
	          const trainImageDir = relParts.length
	            ? await ensureNestedDirectory(imageTrainDir, relParts)
	            : imageTrainDir;
	          setMergeProgress(index - 1, images.length, `images/val/${item.path}`);

	          let destName = safeDatasetFilename(fileName);
	          const renamed = await mergeFileExistsInDir(trainImageDir, destName);
	          if (renamed) {
	            try {
	              destName = await uniqueFileNameInDir(trainImageDir, destName);
	              stats.renamed += 1;
	            } catch (error) {
	              stats.failed += 1;
	              log.push(`FAILED images/val/${item.path}: ${error?.message || error}`);
	              continue;
	            }
	          }

	          try {
	            const file = await item.handle.getFile();
	            const targetHandle = await trainImageDir.getFileHandle(destName, { create: true });
	            const writable = await targetHandle.createWritable();
	            await writable.write(await file.arrayBuffer());
	            await writable.close();
	            await removeEntryByRelativePath(imageValDir, item.path);
	            stats.moved += 1;

	            if (labelValDir && labelTrainDir) {
	              const labelRelParts = [...relParts, fileName.replace(/\.[^.]+$/, ".txt")];
	              const labelValPath = labelRelParts.join("/");
	              const labelHandle = await getFileHandleByRelativePath(labelValDir, labelRelParts).catch(() => null);
	              if (labelHandle) {
	                const labelTrainSubdir = relParts.length
	                  ? await ensureNestedDirectory(labelTrainDir, relParts)
	                  : labelTrainDir;
	                const destStem = destName.replace(/\.[^.]+$/, "");
	                let labelDestName = `${destStem}.txt`;
	                if (await mergeFileExistsInDir(labelTrainSubdir, labelDestName)) {
	                  labelDestName = await uniqueFileNameInDir(labelTrainSubdir, labelDestName);
	                }
	                const labelFile = await labelHandle.getFile();
	                const labelTarget = await labelTrainSubdir.getFileHandle(labelDestName, { create: true });
	                const labelWritable = await labelTarget.createWritable();
	                await labelWritable.write(await labelFile.arrayBuffer());
	                await labelWritable.close();
	                await removeEntryByRelativePath(labelValDir, labelValPath);
	                stats.labelsMoved += 1;
	              }
	            }
	          } catch (error) {
	            stats.failed += 1;
	            log.push(`FAILED images/val/${item.path}: ${error?.message || error}`);
	          }

	          setMergeProgress(index, images.length, `Moved ${index} / ${images.length}`);
	        }

	        const summary = `Val → Train done. moved ${stats.moved} image(s), labels ${stats.labelsMoved}, renamed ${stats.renamed}, failed ${stats.failed}.`;
	        log.push(summary);
	        setMergeLog(log.join("\n"));
	        setStatus(summary);
	        setMergeProgress(images.length, images.length, summary);
	        alert(summary);
	      } finally {
	        endValToTrainOperation();
	      }
	    }

	    async function getFileHandleByRelativePath(dirHandle, parts) {
	      let current = dirHandle;
	      for (let i = 0; i < parts.length - 1; i += 1) {
	        current = await current.getDirectoryHandle(parts[i], { create: false });
	      }
	      return current.getFileHandle(parts[parts.length - 1], { create: false });
	    }

	    async function removeEntryByRelativePath(dirHandle, relativePath) {
	      const parts = relativePath.split("/");
	      let current = dirHandle;
	      for (let i = 0; i < parts.length - 1; i += 1) {
	        current = await current.getDirectoryHandle(parts[i], { create: false });
	      }
	      await current.removeEntry(parts[parts.length - 1]);
	    }

	    async function moveValBackToTrain() {
	      if (!await ensureMergeTargetReady()) return;
	      const task = await inferValToTrainTask(mergeState.targetBackendRoot, mergeState.targetHandle);
	      if (mergeState.targetBackendRoot) {
	        await moveValBackToTrainWithBackend(task);
	        return;
	      }
	      if (task === "detect") {
	        await moveDetectValBackToTrainBrowser(mergeState.targetHandle);
	        return;
	      }
	      await moveClassifyValBackToTrainBrowser(mergeState.targetHandle);
	    }
// ===== Event binding =====

function bindMergePageEvents() {
  document.getElementById("addMergeSourceBtn").addEventListener("click", () => addMergeSourceFolder().catch(error => {
    if (error?.name === "AbortError") return;
    const message = error?.message || String(error);
    setMergeLog(`Add folder failed: ${message}`);
    alert(`Add folder failed:\n${message}`);
    console.error(error);
  }));
  document.getElementById("addMergeZipBtn").addEventListener("click", () => el.mergeZipInput.click());
  document.getElementById("clearMergeSourcesBtn").addEventListener("click", clearMergeSources);
  document.getElementById("chooseMergeTargetBtn").addEventListener("click", () => chooseMergeTargetFolder().catch(error => {
    if (error?.name === "AbortError") return;
    const message = error?.message || String(error);
    setMergeLog(`Choose target folder failed: ${message}`);
    alert(`Choose target folder failed:\n${message}`);
    console.error(error);
  }));
  document.getElementById("mergeValToTrainBtn").addEventListener("click", () => moveValBackToTrain().catch(error => {
    const message = error?.message || String(error);
    setMergeLog(`Val → Train failed: ${message}`);
    alert(`Val → Train failed:\n${message}`);
    console.error(error);
  }));
  document.getElementById("runMergeBtn").addEventListener("click", () => {
    mergeDatasets().catch(error => {
      const message = error?.message || String(error);
      setMergeLog(`Merge failed: ${message}`);
      alert(`Merge failed:\n${message}`);
      console.error(error);
    });
  });
  el.mergeZipInput.addEventListener("change", async event => {
    const files = [...(event.target.files || [])];
    let added = 0;
    event.target.value = "";
    for (const file of files) {
      if (await addMergeZipFile(file)) added += 1;
    }
    if (files.length > 1) setMergeLog(`Added ${added}/${files.length} ZIP file(s).`);
  });
  document.querySelectorAll("input[name=mergeTask]").forEach(input => {
    input.addEventListener("change", updateMergeModeHint);
  });
  updateMergeModeHint();
  for (const target of [el.mergeDropZone, document.querySelector(".merge-workspace")].filter(Boolean)) {
    target.addEventListener("dragover", onMergeDragOver);
    target.addEventListener("dragleave", onMergeDragLeave);
    target.addEventListener("drop", onMergeDrop);
  }
}

function onMergeDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  el.mergeDropZone.classList.add("drop-hover");
}

function onMergeDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  el.mergeDropZone.classList.remove("drop-hover");
}
