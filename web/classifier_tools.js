    async function chooseClassifierModel() {
      if (!await ensurePythonBackend()) {
        alert("ONNX classification requires the Python backend.");
        return;
      }
      const path = await backendCall("chooseClassifierModel", "Choose YOLO Classification ONNX Model");
      if (!path) return;
      classifierState.modelPath = path;
      classifierState.modelInfo = JSON.parse(await backendCall("classifierModelInfo", path));
      classifierState.results.clear();
      updateClassifierStatus();
      updateClassifierResultPanel();
      await renderCurrentImage();
    }

    async function classifyCurrentImage() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      await classifyImagePaths([pair.imagePath]);
    }

    async function classifySelectedImages() {
      const paths = selectedImagePairs().map(pair => pair.imagePath);
      if (!paths.length) return;
      await classifyImagePaths(paths);
    }

    async function classifyVisibleImages() {
      const paths = state.pairs.map(pair => pair.imagePath);
      if (!paths.length) return;
      await classifyImagePaths(paths);
    }

    async function classifyImagePaths(paths) {
      if (classifierState.running) return;
      if (!state.datasetBackendRoot) {
        alert("ONNX classification needs a dataset opened through the Python backend, so image files have real disk paths.");
        return;
      }
      if (!classifierState.modelPath) {
        await chooseClassifierModel();
        if (!classifierState.modelPath) return;
      }
      classifierState.running = true;
      setClassifierBusy(true);
      try {
        const topK = Math.max(1, Math.min(20, parseInt(el.classifierTopKInput?.value || "5", 10)));
        if (el.classifierResult) el.classifierResult.textContent = `Classifying ${paths.length} image(s) on CPU...`;
        const raw = await backendCall(
          "classifyDatasetImages",
          state.datasetBackendRoot,
          classifierState.modelPath,
          JSON.stringify(paths),
          topK
        );
        const payload = JSON.parse(raw);
        classifierState.modelInfo = payload.model || classifierState.modelInfo;
        for (const result of payload.results || []) {
          classifierState.results.set(result.relativePath, result);
        }
        updateClassifierStatus();
        updateClassifierResultPanel(payload);
        renderGallery();
        await renderCurrentImage();
      } finally {
        classifierState.running = false;
        setClassifierBusy(false);
      }
    }

    function setClassifierBusy(busy) {
      for (const button of [el.chooseClassifierModelBtn, el.classifyCurrentBtn, el.classifySelectedBtn, el.classifyVisibleBtn]) {
        if (button) button.disabled = busy;
      }
    }

    function updateClassifierStatus() {
      if (!el.classifierModelStatus) return;
      if (!classifierState.modelPath) {
        el.classifierModelStatus.textContent = "No ONNX model";
        return;
      }
      const name = classifierState.modelPath.split(/[\\/]/).pop();
      const classes = classifierState.modelInfo?.classes?.length;
      el.classifierModelStatus.textContent = `${name}${classes ? ` | ${classes} classes` : ""}`;
    }

    function updateClassifierResultPanel(batchPayload = null) {
      if (!el.classifierResult) return;
      const pair = state.pairs[state.currentIndex];
      const current = pair ? classifierState.results.get(pair.imagePath) : null;
      const lines = [];
      if (current?.top) {
        lines.push(`Current: ${formatClassifierPrediction(current.top)}`);
        for (const prediction of (current.predictions || []).slice(1)) {
          lines.push(`  ${formatClassifierPrediction(prediction)}`);
        }
      } else if (classifierState.modelPath) {
        lines.push("Current: not classified yet.");
      }
      if (batchPayload) {
        lines.push("");
        lines.push(`Batch: ${(batchPayload.results || []).length} done, ${(batchPayload.errors || []).length} error(s).`);
        for (const error of (batchPayload.errors || []).slice(0, 6)) {
          lines.push(`ERR ${error.relativePath}: ${error.error}`);
        }
      }
      if (!lines.length) lines.push("Load a best.onnx classifier, then run CPU classification on dataset images.");
      el.classifierResult.textContent = lines.join("\n");
    }

    function formatClassifierPrediction(prediction) {
      return `${prediction.classId}: ${prediction.name} ${(prediction.confidence * 100).toFixed(1)}%`;
    }

function bindClassifierPageEvents() {
  el.chooseClassifierModelBtn?.addEventListener("click", () => chooseClassifierModel().catch(showError));
  el.classifyCurrentBtn?.addEventListener("click", () => classifyCurrentImage().catch(showError));
  el.classifySelectedBtn?.addEventListener("click", () => classifySelectedImages().catch(showError));
  el.classifyVisibleBtn?.addEventListener("click", () => classifyVisibleImages().catch(showError));
}
