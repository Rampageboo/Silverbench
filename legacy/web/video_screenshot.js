// ===== Video Capture: backend import & drag-drop =====
	    let skipNextWebVideoDrop = false;

	    function backendVideoItemsFromInfoList(infoList) {
	      return (infoList || [])
	        .filter(item => item.ok)
	        .map(item => ({
	          file: null,
	          backendPath: item.path,
	          name: item.name,
	          path: item.name,
	          duration: item.duration,
	          width: item.width,
	          height: item.height
	        }));
	    }

	    async function isPythonBackendReady() {
	      if (pyBackend.ready) return true;
	      return Promise.race([
	        pyBackend.readyPromise || Promise.resolve(false),
	        new Promise(resolve => setTimeout(() => resolve(false), 800))
	      ]);
	    }

		    window.importBackendVideoPaths = async function importBackendVideoPaths(paths, options = {}) {
	      if (!paths?.length) return;
	      skipNextWebVideoDrop = true;
	      setTimeout(() => { skipNextWebVideoDrop = false; }, 400);
	      const backendReady = await isPythonBackendReady();
	      if (!backendReady || !pyBackend.bridge?.videosFromPaths) {
	        setVideoLog("Python backend is not ready for dropped videos.");
	        return;
	      }
	      const raw = await backendCall("videosFromPaths", JSON.stringify(paths));
	      const items = backendVideoItemsFromInfoList(JSON.parse(raw || "[]"));
		      if (items.length) {
		        if (options.append === false) setVideoPlaylist(items);
		        else addVideoItems(items, { append: true });
		        return;
		      }
	      setVideoLog("Could not open dropped video(s) with the Python backend. Install OpenCV/ffmpeg codecs or convert to H.264 MP4.");
	    };

	    function nativeFilePath(file) {
	      if (!file) return "";
	      const path = typeof file.path === "string" ? file.path.trim() : "";
	      return path && path !== file.name ? path : "";
	    }

	    async function openVideoSource() {
	      // Browser-only fallback: use the file picker + <video>.
	      if (pyBackend.mode === "http") {
	        if (pyBackend.ready && pyBackend.bridge?.chooseVideoFiles) {
	          const raw = await backendCall("chooseVideoFiles", "Choose Videos");
	          const items = backendVideoItemsFromInfoList(JSON.parse(raw || "[]"));
	          if (items.length) appendVideoPlaylist(items);
	          return;
	        }
	        el.videoInput.click();
	        return;
	      }
	      const backendReady = await isPythonBackendReady();
	      if (backendReady && pyBackend.bridge?.chooseVideoFiles) {
	        const raw = await backendCall("chooseVideoFiles", "Choose Videos");
	        const items = backendVideoItemsFromInfoList(JSON.parse(raw || "[]"));
	        if (items.length) appendVideoPlaylist(items);
	        return;
	      }
	      el.videoInput.click();
	    }

	    async function openBrowserWebUI() {
	      if (pyBackend.mode === "http") {
	        setVideoLog("Already running in your system browser with local backend.");
	        return;
	      }
	      if (!pyBackend.bridge?.openBrowserWebUI) {
	        alert("Open web/index.html in Chrome or Edge.");
	        return;
	      }
	      const ok = await backendCall("openBrowserWebUI");
	      if (ok) setVideoLog("Opened web/index.html in your system browser.");
	      else alert("Cannot find web/index.html next to the Python app.");
	    }

	    async function onVideoDrop(event) {
	      event.preventDefault();
	      event.stopPropagation();
	      el.videoDropZone.classList.remove("drop-hover");
	      if (skipNextWebVideoDrop) return;
	      const videos = await videosFromDrop(event.dataTransfer);
	      if (!videos.length) {
	        alert("Drop a video file or a folder containing videos.");
	        return;
	      }
	      const paths = videos.map(item => nativeFilePath(item.file)).filter(Boolean);
	      if (paths.length === videos.length && await isPythonBackendReady()) {
	        await importBackendVideoPaths(paths, { append: true });
	        return;
	      }
		      appendVideoPlaylist(videos);
	    }

	    async function videosFromDrop(dataTransfer) {
	      const videos = [];
	      const files = [...(dataTransfer?.files || [])];
	      for (const file of files) {
	        if (isVideoFile(file)) videos.push({ file, name: file.name, path: file.name });
	      }
	      if (videos.length) return videos;
	      for (const item of [...(dataTransfer?.items || [])]) {
	        if (item.kind !== "file") continue;
	        const file = item.getAsFile?.();
	        if (file && isVideoFile(file)) {
	          videos.push({ file, name: file.name, path: file.name });
	          continue;
	        }
	        if (item.getAsFileSystemHandle) {
	          const handle = await item.getAsFileSystemHandle();
	          if (handle?.kind === "file" && isVideoFileName(handle.name)) {
	            const handleFile = await handle.getFile();
	            videos.push({ file: handleFile, name: handle.name, path: handle.name });
	          } else if (handle?.kind === "directory") {
	            await collectVideosFromDirectory(handle, "", videos);
	          }
	        }
	      }
	      videos.sort((a, b) => naturalCompare(a.path, b.path));
	      return videos;
	    }

	    async function collectVideosFromDirectory(dirHandle, prefix, out) {
	      for await (const [name, handle] of dirHandle.entries()) {
	        const path = prefix ? `${prefix}/${name}` : name;
	        if (handle.kind === "directory") {
	          await collectVideosFromDirectory(handle, path, out);
	        } else if (isVideoFileName(name)) {
	          out.push({ file: await handle.getFile(), name, path });
	        }
	      }
	    }
// ===== Playlist management =====

	    async function setVideoPlaylist(videos) {
	      const paths = videos.map(item => item.backendPath || nativeFilePath(item.file)).filter(Boolean);
	      if (
	        paths.length === videos.length
	        && paths.length
	        && !videos.some(item => item.backendPath)
	        && await isPythonBackendReady()
	      ) {
	        await importBackendVideoPaths(paths, { append: false });
	        return;
	      }
	      videoState.videos = normalizeVideoItems(videos);
	      videoState.currentVideoIndex = videos.length ? 0 : -1;
	      renderVideoList();
	      if (videos.length) loadVideoItem(videos[0]);
	      setVideoLog(`Loaded ${videos.length} video(s).`);
	      ensureVideoDurations().catch(error => setVideoLog(`Could not read all video durations: ${error.message}`));
	    }

	    async function appendVideoPlaylist(videos) {
	      const paths = videos.map(item => item.backendPath || nativeFilePath(item.file)).filter(Boolean);
	      if (
	        paths.length === videos.length
	        && paths.length
	        && !videos.some(item => item.backendPath)
	        && await isPythonBackendReady()
	      ) {
	        await importBackendVideoPaths(paths, { append: true });
	        return;
	      }
	      addVideoItems(videos, { append: true });
	    }

	    function addVideoItems(videos, { append = true } = {}) {
	      const items = normalizeVideoItems(videos);
	      if (!items.length) return;
	      if (videoState.videos.length) saveCurrentVideoSegments();
	      const existingKeys = new Set(append ? videoState.videos.map(videoItemKey) : []);
	      const added = items.filter(item => {
	        const key = videoItemKey(item);
	        if (!key || existingKeys.has(key)) return false;
	        existingKeys.add(key);
	        return true;
	      });
	      if (!append) {
	        videoState.videos = items;
	        videoState.currentVideoIndex = items.length ? 0 : -1;
	      } else if (added.length) {
	        const firstNewIndex = videoState.videos.length;
	        videoState.videos.push(...added);
	        videoState.currentVideoIndex = firstNewIndex;
	      }
	      renderVideoList();
	      const current = videoState.videos[videoState.currentVideoIndex];
	      if (current) loadVideoItem(current);
	      const skipped = items.length - (append ? added.length : items.length);
	      setVideoLog(`${append ? "Added" : "Loaded"} ${append ? added.length : items.length} video(s).${skipped > 0 ? ` Skipped ${skipped} duplicate(s).` : ""}`);
	      ensureVideoDurations().catch(error => setVideoLog(`Could not read all video durations: ${error.message}`));
	    }

	    function normalizeVideoItems(videos) {
	      return (videos || []).map(video => ({
	        ...video,
	        segments: video.segments || null,
	        activeSegmentIndex: Number.isInteger(video.activeSegmentIndex) ? video.activeSegmentIndex : -1
	      }));
	    }

	    function videoItemKey(item) {
	      return item.backendPath || nativeFilePath(item.file) || item.path || item.name || "";
	    }

	    function renderVideoList() {
	      el.videoImportCount.textContent = `${videoState.videos.length} video${videoState.videos.length === 1 ? "" : "s"}`;
	      if (!videoState.videos.length) {
	        el.videoList.innerHTML = `<div class="empty">Drop a video file or folder.</div>`;
	        return;
	      }
	      el.videoList.innerHTML = "";
	      videoState.videos.forEach((item, index) => {
	        const row = document.createElement("div");
	        row.className = `video-list-item${index === videoState.currentVideoIndex ? " active" : ""}`;
	        const selectBtn = document.createElement("button");
	        selectBtn.type = "button";
	        selectBtn.className = "video-list-select";
	        selectBtn.textContent = item.path;
	        selectBtn.addEventListener("click", () => selectVideoIndex(index));
	        const removeBtn = document.createElement("button");
	        removeBtn.type = "button";
	        removeBtn.className = "video-list-remove danger";
	        removeBtn.textContent = "Remove";
	        removeBtn.addEventListener("click", event => {
	          event.stopPropagation();
	          removeVideoAt(index);
	        });
	        row.append(selectBtn, removeBtn);
	        el.videoList.appendChild(row);
	      });
	      updateFrameEstimate();
	    }

	    function selectVideoIndex(index) {
	      if (!videoState.videos.length) return;
	      saveCurrentVideoSegments();
	      const next = Math.max(0, Math.min(videoState.videos.length - 1, index));
	      videoState.currentVideoIndex = next;
	      renderVideoList();
	      const item = videoState.videos[next];
	      loadVideoItem(item);
	    }

	    function removeVideoAt(index) {
	      if (index < 0 || index >= videoState.videos.length) return;
	      const wasCurrent = index === videoState.currentVideoIndex;
	      if (videoState.videos.length) saveCurrentVideoSegments();
	      videoState.videos.splice(index, 1);
	      if (!videoState.videos.length) {
	        clearVideoPlaylist();
	        return;
	      }
	      if (wasCurrent) {
	        videoState.currentVideoIndex = Math.min(index, videoState.videos.length - 1);
	        renderVideoList();
	        loadVideoItem(videoState.videos[videoState.currentVideoIndex]);
	      } else {
	        if (index < videoState.currentVideoIndex) videoState.currentVideoIndex -= 1;
	        renderVideoList();
	      }
	      setVideoLog(`Removed video. ${videoState.videos.length} remaining.`);
	      updateFrameEstimate();
	    }

	    function clearVideoPlaylist() {
	      if (videoState.url) URL.revokeObjectURL(videoState.url);
	      videoState.url = null;
	      videoState.file = null;
	      videoState.videos = [];
	      videoState.currentVideoIndex = -1;
	      videoState.backendCurrentTime = 0;
	      videoState.segments = [];
	      videoState.activeSegmentIndex = -1;
	      el.videoPlayer.removeAttribute("src");
	      el.videoPlayer.load();
	      el.backendFramePreview.hidden = true;
	      el.videoPlayer.hidden = false;
	      el.videoMeta.textContent = "No video loaded";
	      resetSegmentControls(0);
	      renderVideoList();
	      updateVideoTimeReadout();
	      updateFrameEstimate();
	      setVideoLog("No videos in list.");
	    }

	    function loadVideoItem(item) {
	      if (item.backendPath) loadBackendVideo(item);
	      else loadVideoFile(item.file, item.path);
	    }

	    function isVideoFile(file) {
	      return Boolean(file && (file.type?.startsWith("video/") || isVideoFileName(file.name)));
	    }

	    function isVideoFileName(name) {
	      return /\.(mp4|mov|m4v|avi|mkv|webm|wmv|mpeg|mpg)$/i.test(name || "");
	    }
// ===== Video loading & playback =====

	    function loadVideoFile(file, displayPath = file.name) {
	      el.backendFramePreview.hidden = true;
	      el.videoPlayer.hidden = false;
	      if (videoState.url) URL.revokeObjectURL(videoState.url);
	      videoState.file = file;
	      videoState.url = URL.createObjectURL(file);
	      el.videoPlayer.src = videoState.url;
	      el.videoMeta.textContent = displayPath;
	      el.screenshotPrefixInput.value = safeFileStem(file.name).replace(/\.[^.]+$/, "");
	      resetSegmentControls(0);
	      updateVideoTimeReadout();
	      setVideoLog(`Loaded ${displayPath}`);
	      setStatus(`Video loaded: ${displayPath}`);
	      updateFrameEstimate();
	    }

	    async function loadBackendVideo(item) {
	      if (videoState.url) {
	        URL.revokeObjectURL(videoState.url);
	        videoState.url = null;
	      }
	      videoState.file = { name: item.name };
	      el.videoPlayer.pause();
	      el.videoPlayer.removeAttribute("src");
	      el.videoPlayer.load();
	      el.videoPlayer.hidden = true;
	      el.backendFramePreview.hidden = false;
	      videoState.backendCurrentTime = 0;
	      el.videoMeta.textContent = `${item.name} | ${item.width}x${item.height} | ${formatClock(item.duration)}`;
	      el.screenshotPrefixInput.value = safeFileStem(item.name).replace(/\.[^.]+$/, "");
	      videoState.segments = item.segments?.length ? item.segments.map(segment => ({ ...segment })) : [{ start: 0, end: item.duration }];
	      videoState.activeSegmentIndex = item.activeSegmentIndex ?? 0;
	      renderSegments();
	      updateVideoTimeReadout();
	      await updateBackendPreviewFrame(0);
	      setVideoLog(`Loaded ${item.name} with Python backend.`);
	      setStatus(`Video loaded: ${item.name}`);
	    }

		    async function updateBackendPreviewFrame(seconds = 0) {
		      const item = videoState.videos[videoState.currentVideoIndex];
		      if (!item?.backendPath || !pyBackend.ready) return;
		      const requestedSeconds = Number(seconds) || 0;
		      if (videoState.backendPreviewInFlight) {
		        videoState.backendPreviewPendingTime = requestedSeconds;
		        return;
		      }
		      videoState.backendPreviewInFlight = true;
		      const requestId = ++videoState.backendPreviewRequestId;
		      const path = item.backendPath;
		      const imageFormat = el.screenshotFormatSelect.value === "png" ? "png" : "jpg";
		      try {
		        const base64 = await backendCall("getVideoFrameBase64", path, requestedSeconds, imageFormat);
		        const current = videoState.videos[videoState.currentVideoIndex];
		        if (requestId === videoState.backendPreviewRequestId && current?.backendPath === path) {
		          if (base64) {
		            el.backendFramePreview.src = `data:image/${imageFormat === "png" ? "png" : "jpeg"};base64,${base64}`;
		          }
		        }
		      } catch (error) {
		        if (requestId === videoState.backendPreviewRequestId) {
		          setVideoLog(`Preview seek failed @ ${formatClock(requestedSeconds)}: ${error.message || error}`);
		        }
		      } finally {
		        videoState.backendPreviewInFlight = false;
		        const pendingTime = videoState.backendPreviewPendingTime;
		        videoState.backendPreviewPendingTime = null;
		        const current = videoState.videos[videoState.currentVideoIndex];
		        if (current?.backendPath === path && pendingTime != null && Math.abs(pendingTime - requestedSeconds) > 0.001) {
		          updateBackendPreviewFrame(pendingTime).catch(error => setVideoLog(`Preview seek failed: ${error.message}`));
		        }
		      }
		    }

	    function onVideoMetadata() {
	      if (Number.isFinite(el.videoPlayer.duration) && el.videoPlayer.duration > 0) {
	        const item = videoState.videos[videoState.currentVideoIndex];
	        if (item) item.duration = el.videoPlayer.duration;
	        restoreSegmentsForCurrentVideo(el.videoPlayer.duration);
	        el.videoMeta.textContent = `${videoState.file?.name || "Video"} | ${el.videoPlayer.videoWidth}x${el.videoPlayer.videoHeight} | ${formatClock(el.videoPlayer.duration)}`;
	      }
	      updateVideoTimeReadout();
	    }

	    let videoErrorRecoveryPending = false;

	    async function onVideoError() {
	      const error = el.videoPlayer.error;
	      const name = videoState.file?.name || "";
	      const message = error ? `Video load error ${error.code}: ${name}` : `Video load error: ${name}`;
	      if (!window.qt) {
	        setVideoLog(`${message}\nThis browser cannot decode this video. Try Chrome/Edge, convert to H.264 MP4, or use Browser UI from the Python app.`);
	        setStatus(message);
	        return;
	      }
	      if (videoErrorRecoveryPending) return;
	      videoErrorRecoveryPending = true;
	      setVideoLog(`${message}\nQt 内置播放器不支持此编码，正在用 Python 后端重新选择文件…`);
	      setStatus(message);
	      try {
	        const backendReady = await isPythonBackendReady();
	        if (backendReady && pyBackend.bridge?.chooseVideoFiles) {
	          const raw = await backendCall("chooseVideoFiles", "Choose Videos (Python backend)");
	          const items = backendVideoItemsFromInfoList(JSON.parse(raw || "[]"));
	          if (items.length) {
		            appendVideoPlaylist(items);
	            return;
	          }
	        }
	        setVideoLog(`${message}\n请点 Open Video，或将视频拖到窗口任意位置；也可点 Browser UI 用 Chrome 打开旧版页面。`);
	      } finally {
	        videoErrorRecoveryPending = false;
	      }
	    }
// ===== Segment persistence per video =====

	    function saveCurrentVideoSegments() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (!item) return;
	      item.segments = videoState.segments.map(segment => ({ ...segment }));
	      item.activeSegmentIndex = videoState.activeSegmentIndex;
	    }

	    function restoreSegmentsForCurrentVideo(duration) {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (item?.segments?.length) {
	        videoState.segments = item.segments.map(segment => ({
	          start: clampSeconds(segment.start, 0, duration),
	          end: clampSeconds(segment.end, 0, duration)
	        })).filter(segment => segment.end >= segment.start);
	        videoState.activeSegmentIndex = videoState.segments.length
	          ? Math.max(0, Math.min(item.activeSegmentIndex ?? 0, videoState.segments.length - 1))
	          : -1;
	        syncInputsFromActiveSegment();
	        renderSegments();
	        return;
	      }
	      resetSegmentControls(duration);
	      saveCurrentVideoSegments();
	    }

	    function updateScreenshotOutputLog() {
	      if (videoState.outputPath) {
	        if (videoState.screenshotOutputExplicit) {
	          setVideoLog(`Output folder: ${videoState.outputPath}`);
	        } else if (state.workspaceRoot) {
	          setVideoLog(`Output folder: image_pool（工作区默认）`);
	        } else {
	          setVideoLog(`Output folder: ${videoState.outputPath}`);
	        }
	        return;
	      }
	      if (videoState.outputHandle) {
	        setVideoLog(`Output folder: ${videoState.outputHandle.name}`);
	        return;
	      }
	      if (state.workspaceRoot) {
	        setVideoLog("工作区已打开，截图将保存到 image_pool。");
	      }
	    }

	    async function syncScreenshotOutputWithWorkspace(workspaceRoot, options = {}) {
	      const { workspaceChanged = false } = options;
	      if (workspaceChanged) {
	        videoState.screenshotOutputExplicit = false;
	      }
	      if (videoState.screenshotOutputExplicit) {
	        updateScreenshotOutputLog();
	        return;
	      }
	      if (!workspaceRoot) {
	        if (workspaceChanged) {
	          videoState.outputPath = "";
	          videoState.outputHandle = null;
	        }
	        updateScreenshotOutputLog();
	        return;
	      }
	      if (!await ensurePythonBackend()) return;
	      try {
	        const info = JSON.parse(await backendCall("getWorkspaceInfo", workspaceRoot));
	        if (info?.ok && info.imagePool) {
	          videoState.outputPath = info.imagePool;
	          videoState.outputHandle = null;
	          updateScreenshotOutputLog();
	        }
	      } catch (error) {
	        console.warn("Screenshot output sync:", error);
	      }
	    }

	    window.syncScreenshotOutputWithWorkspace = syncScreenshotOutputWithWorkspace;

	    async function chooseScreenshotFolder() {
	      const backendReady = pyBackend.ready || await Promise.race([
	        pyBackend.readyPromise || Promise.resolve(false),
	        new Promise(resolve => setTimeout(() => resolve(false), 600))
	      ]);
	      if (backendReady && pyBackend.bridge?.chooseDirectory) {
	        const path = await backendCall("chooseDirectory", "Choose Screenshot Output Folder");
	        if (path) {
	          videoState.outputPath = path;
	          videoState.outputHandle = null;
	          videoState.screenshotOutputExplicit = true;
	          setVideoLog(`Output folder: ${path}`);
	        }
	        return;
	      }
	      if (!window.showDirectoryPicker) {
	        alert("Output folder selection needs Chrome or Edge, or run inside the Python app.");
	        return;
	      }
	      videoState.outputHandle = await showDirectoryPicker({ mode: "readwrite" });
	      videoState.outputPath = "";
	      videoState.screenshotOutputExplicit = true;
	      setVideoLog(`Output folder: ${videoState.outputHandle.name}`);
	    }
// ===== Screenshot output & single-frame capture =====

	    async function captureCurrentFrame() {
	      if (!ensureVideoReady()) return;
	      if (!await ensureScreenshotOutputReady()) return;
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (canUseBackendScreenshotExport(item) && pyBackend.bridge?.saveVideoFrame) {
	        const written = await backendCall("saveVideoFrame", item.backendPath, videoState.outputPath, currentVideoTime(), screenshotPrefix(), screenshotFormat());
	        setVideoLog(`Saved ${written}`);
	        setStatus(`Saved screenshot: ${written}`);
	        await refreshImagePoolAfterScreenshot();
	        return;
	      }
	      const blob = await currentVideoFrameBlob();
	      const name = screenshotFileName(currentVideoTime());
	      const written = await writeScreenshotBlob(name, blob);
	      setVideoLog(`Saved ${written}`);
	      setStatus(`Saved screenshot: ${written}`);
	      await refreshImagePoolAfterScreenshot();
	    }

	    async function captureWholeVideo() {
	      if (!ensureVideoReady()) return;
	      if (!await ensureScreenshotOutputReady()) return;
	      const interval = Number(el.captureIntervalInput.value);
	      if (!Number.isFinite(interval) || interval <= 0) {
	        alert("Batch interval must be greater than 0.");
	        return;
	      }
	      const item = videoState.videos[videoState.currentVideoIndex];
	      const duration = item?.backendPath ? item.duration : el.videoPlayer.duration;
	      if (!Number.isFinite(duration) || duration <= 0) {
	        alert("This video does not report a finite duration.");
	        return;
	      }
	      const segments = selectedSegments();
	      if (!segments.length) {
	        alert("Add or select at least one valid segment.");
	        return;
	      }
	      await exportCurrentVideoSegments({ interval, alertWhenDone: true });
	    }

	    function resetSegmentControls(duration) {
	      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
	      videoState.segments = safeDuration ? [{ start: 0, end: safeDuration }] : [];
	      videoState.activeSegmentIndex = videoState.segments.length ? 0 : -1;
	      renderSegments();
	      updateFrameEstimate();
	    }
// ===== Segment helpers =====

	    function useFullSegment() {
	      const duration = Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0;
	      resetSegmentControls(duration);
	      saveCurrentVideoSegments();
	    }

	    function selectedSegments() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      const duration = item?.backendPath ? item.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      return videoState.segments
	        .map(segment => ({
	          start: clampSeconds(segment.start, 0, duration),
	          end: clampSeconds(segment.end, 0, duration)
	        }))
	        .filter(segment => segment.end >= segment.start)
	        .sort((a, b) => a.start - b.start);
	    }

	    function segmentsForVideoItem(item) {
	      const duration = Number.isFinite(item.duration) ? item.duration : 0;
	      const source = item.segments?.length ? item.segments : (duration ? [{ start: 0, end: duration }] : []);
	      return source
	        .map(segment => ({
	          start: clampSeconds(segment.start, 0, duration),
	          end: clampSeconds(segment.end, 0, duration)
	        }))
	        .filter(segment => segment.end >= segment.start)
	        .sort((a, b) => a.start - b.start);
	    }

	    function frameCountForSegments(segments, interval) {
	      if (!Number.isFinite(interval) || interval <= 0) return 0;
	      return segments.reduce((sum, segment) => sum + Math.floor((segment.end - segment.start) / interval) + 1, 0);
	    }

	    function updateFrameEstimate() {
	      const interval = Number(el.captureIntervalInput.value);
	      const current = frameCountForSegments(selectedSegments(), interval);
	      const all = videoState.videos.reduce((sum, item, index) => {
	        if (index === videoState.currentVideoIndex && Number.isFinite(el.videoPlayer.duration)) {
	          return sum + current;
	        }
	        return sum + frameCountForSegments(segmentsForVideoItem(item), interval);
	      }, 0);
	      el.frameEstimate.textContent = `Estimated frames: ${current} current / ${all} all`;
	    }

	    function ensureActiveSegment() {
	      if (videoState.activeSegmentIndex >= 0 && videoState.segments[videoState.activeSegmentIndex]) return;
	      addSegmentAtCurrentTime();
	    }

	    function addSegmentAtCurrentTime() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      const duration = item?.backendPath ? item.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      if (!duration) {
	        alert("Video duration is not loaded yet, so a segment cannot be added. If the video stays at 00:00, this codec may not be supported by the current player.");
	        return;
	      }
	      const start = clampSeconds(item?.backendPath ? 0 : (el.videoPlayer.currentTime || 0), 0, duration);
	      const end = clampSeconds(start + Math.min(5, duration), 0, duration);
	      videoState.segments.push({ start, end: Math.max(end, start) });
	      videoState.activeSegmentIndex = videoState.segments.length - 1;
	      syncInputsFromActiveSegment();
	      renderSegments();
	      saveCurrentVideoSegments();
	      updateFrameEstimate();
	    }

	    function deleteActiveSegment() {
	      if (videoState.activeSegmentIndex < 0) return;
	      videoState.segments.splice(videoState.activeSegmentIndex, 1);
	      videoState.activeSegmentIndex = videoState.segments.length ? Math.min(videoState.activeSegmentIndex, videoState.segments.length - 1) : -1;
	      syncInputsFromActiveSegment();
	      renderSegments();
	      saveCurrentVideoSegments();
	      updateFrameEstimate();
	    }

	    function syncInputsFromActiveSegment() {
	      renderSegments();
	    }
// ===== Segment timeline UI =====

	    function renderSegments() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      const duration = item?.backendPath ? item.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      el.segmentLayer.innerHTML = "";
	      if (!duration || !videoState.segments.length) {
	        el.segmentSummary.textContent = "Segments: none";
	        updatePlayhead();
	        updateFrameEstimate();
	        return;
	      }
	      videoState.segments.forEach((segment, index) => {
	        const startPct = 100 * clampSeconds(segment.start, 0, duration) / duration;
	        const endPct = 100 * clampSeconds(segment.end, 0, duration) / duration;
	        const item = document.createElement("div");
	        item.className = `segment-item${index === videoState.activeSegmentIndex ? " active" : ""}`;
	        item.dataset.index = String(index);
	        item.style.left = `${startPct}%`;
	        item.style.width = `${Math.max(0.2, endPct - startPct)}%`;
	        item.innerHTML = `<div class="segment-handle start" data-edge="start"></div><div class="segment-handle end" data-edge="end"></div>`;
	        el.segmentLayer.appendChild(item);
	      });
	      const active = videoState.segments[videoState.activeSegmentIndex];
	      if (active) {
	        el.segmentSummary.textContent = `Segments: ${videoState.segments.length} | active ${videoState.activeSegmentIndex + 1}: ${formatClock(active.start)} -> ${formatClock(active.end)} | ${formatClock(active.end - active.start)}`;
	      } else {
	        el.segmentSummary.textContent = `Segments: ${videoState.segments.length}`;
	      }
	      updatePlayhead();
	      updateFrameEstimate();
	    }

		    function onSegmentPointerDown(event) {
		      hideSegmentContextMenu();
		      if (event.button !== 0) return;
		      const current = videoState.videos[videoState.currentVideoIndex];
		      const totalDuration = current?.backendPath ? current.duration : el.videoPlayer.duration;
		      if (!Number.isFinite(totalDuration) || !totalDuration) return;
		      const item = event.target.closest(".segment-item");
		      if (!item) return;
		      event.preventDefault();
		      const edge = event.target.dataset.edge || null;
		      const index = Number(item.dataset.index);
		      videoState.activeSegmentIndex = index;
		      syncInputsFromActiveSegment();
		      saveCurrentVideoSegments();
		      const segment = videoState.segments[index];
		      videoState.segmentDrag = {
		        index,
		        edge: edge || "move",
		        startX: event.clientX,
		        segmentStart: segment.start,
		        segmentEnd: segment.end
		      };
		      el.segmentTimeline.setPointerCapture?.(event.pointerId);
		      renderSegments();
		    }

	    function seekTimelineTo(time) {
	      const current = videoState.videos[videoState.currentVideoIndex];
	      const duration = current?.backendPath ? current.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      const nextTime = clampSeconds(time, 0, duration);
	      if (current?.backendPath) {
	        videoState.backendCurrentTime = nextTime;
	        updateBackendPreviewFrame(nextTime).catch(error => setVideoLog(`Preview seek failed: ${error.message}`));
	        updateVideoTimeReadout();
	        updatePlayhead();
	        return;
	      }
	      el.videoPlayer.currentTime = nextTime;
	      updateVideoTimeReadout();
	      updatePlayhead();
	    }

		    function onSegmentPointerMove(event) {
		      const drag = videoState.segmentDrag;
		      if (!drag) return;
	      const current = videoState.videos[videoState.currentVideoIndex];
	      const duration = current?.backendPath ? current.duration : el.videoPlayer.duration;
	      const segment = videoState.segments[drag.index];
	      if (!segment) return;
	      const delta = timelineDeltaSeconds(event.clientX - drag.startX);
	      if (drag.edge === "start") {
	        segment.start = clampSeconds(drag.segmentStart + delta, 0, segment.end);
	      } else if (drag.edge === "end") {
	        segment.end = clampSeconds(drag.segmentEnd + delta, segment.start, duration);
	      } else {
	        const length = drag.segmentEnd - drag.segmentStart;
	        const nextStart = clampSeconds(drag.segmentStart + delta, 0, Math.max(0, duration - length));
	        segment.start = nextStart;
	        segment.end = nextStart + length;
	      }
	      syncInputsFromActiveSegment();
	      renderSegments();
	      saveCurrentVideoSegments();
	    }

		    function onSegmentPointerUp() {
		      videoState.segmentDrag = null;
		      videoState.timelineDrag = false;
		    }

		    function onSegmentContextMenu(event) {
		      const handle = event.target.closest(".segment-handle");
		      if (!handle) {
		        hideSegmentContextMenu();
		        return;
		      }
		      const segmentItem = handle.closest(".segment-item");
		      const index = Number(segmentItem?.dataset.index);
		      const edge = handle.dataset.edge;
		      if (!Number.isInteger(index) || !edge) return;
		      event.preventDefault();
		      event.stopPropagation();
		      videoState.activeSegmentIndex = index;
		      videoState.segmentContextTarget = { index, edge };
		      renderSegments();
		      showSegmentContextMenu(event.clientX, event.clientY);
		    }

		    function showSegmentContextMenu(clientX, clientY) {
		      const menu = el.segmentContextMenu;
		      if (!menu) return;
		      menu.hidden = false;
		      const margin = 8;
		      const rect = menu.getBoundingClientRect();
		      const left = Math.min(clientX, window.innerWidth - rect.width - margin);
		      const top = Math.min(clientY, window.innerHeight - rect.height - margin);
		      menu.style.left = `${Math.max(margin, left)}px`;
		      menu.style.top = `${Math.max(margin, top)}px`;
		    }

		    function hideSegmentContextMenu() {
		      if (el.segmentContextMenu) el.segmentContextMenu.hidden = true;
		    }

		    function snapSegmentHandleToPlayhead() {
		      const target = videoState.segmentContextTarget;
		      if (!target) return;
		      const segment = videoState.segments[target.index];
		      if (!segment) {
		        hideSegmentContextMenu();
		        return;
		      }
		      const current = videoState.videos[videoState.currentVideoIndex];
		      const duration = current?.backendPath ? current.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
		      const time = clampSeconds(currentVideoTime(), 0, duration);
		      if (target.edge === "start") {
		        segment.start = clampSeconds(time, 0, segment.end);
		      } else {
		        segment.end = clampSeconds(time, segment.start, duration);
		      }
		      videoState.activeSegmentIndex = target.index;
		      hideSegmentContextMenu();
		      syncInputsFromActiveSegment();
		      renderSegments();
		      saveCurrentVideoSegments();
		      updateFrameEstimate();
		    }
// ===== Playback controls & scrubber =====

		    async function toggleVideoPlayback() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (item?.backendPath) {
	        setVideoLog("Playback is unavailable for backend-only videos; use -5s/+5s or the segment timeline to seek preview frames.");
	        return;
	      }
	      if (!videoState.file && !el.videoPlayer.src) {
	        alert("Open or drop a video first.");
	        return;
	      }
	      try {
	        if (el.videoPlayer.paused) await el.videoPlayer.play();
	        else el.videoPlayer.pause();
	      } catch (error) {
	        setVideoLog(`Playback failed: ${error.message}`);
	      }
	    }

	    function nudgeVideoTime(deltaSeconds) {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      const duration = item?.backendPath ? item.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      if (!duration) return;
	      seekTimelineTo(currentVideoTime() + deltaSeconds);
	    }

	    function timelineEventTime(event) {
	      const rect = timelineRailRect();
	      const pct = clamp01((event.clientX - rect.left) / rect.width);
	      const current = videoState.videos[videoState.currentVideoIndex];
	      const duration = current?.backendPath ? current.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      return pct * duration;
	    }

	    function timelineDeltaSeconds(pixelDelta) {
	      const rect = timelineRailRect();
	      const current = videoState.videos[videoState.currentVideoIndex];
	      const duration = current?.backendPath ? current.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
	      return rect.width ? pixelDelta * duration / rect.width : 0;
	    }

	    function timelineRailRect() {
	      const rect = el.segmentTimeline.getBoundingClientRect();
	      return { left: rect.left + 12, width: Math.max(1, rect.width - 24) };
	    }

		    function updatePlayhead() {
		      if (videoState.exporting) return;
		      const current = videoState.videos[videoState.currentVideoIndex];
		      const duration = current?.backendPath ? current.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
		      const currentTime = currentVideoTime();
		      const pct = duration ? 100 * clampSeconds(currentTime, 0, duration) / duration : 0;
		      const rect = timelineRailRect();
		      el.segmentPlayhead.style.left = `${12 + rect.width * pct / 100}px`;
		    }

		    function updateVideoScrubber(duration, currentTime) {
		      if (!el.videoScrubber) return;
		      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
		      const safeTime = clampSeconds(currentTime || 0, 0, safeDuration);
		      el.videoScrubber.max = String(safeDuration);
		      el.videoScrubber.value = String(safeTime);
		      el.videoScrubber.disabled = !safeDuration;
		    }

		    function scrubberPointerTime(event) {
		      const current = videoState.videos[videoState.currentVideoIndex];
		      const duration = current?.backendPath ? current.duration : (Number.isFinite(el.videoPlayer.duration) ? el.videoPlayer.duration : 0);
		      const rect = el.videoScrubber.getBoundingClientRect();
		      const pct = rect.width ? clamp01((event.clientX - rect.left) / rect.width) : 0;
		      return pct * duration;
		    }

		    function onVideoScrubberPointerDown(event) {
		      if (event.button !== 0 || el.videoScrubber.disabled) return;
		      event.preventDefault();
		      videoState.scrubberDrag = true;
		      el.videoScrubber.setPointerCapture?.(event.pointerId);
		      seekTimelineTo(scrubberPointerTime(event));
		    }

		    function onVideoScrubberPointerMove(event) {
		      if (!videoState.scrubberDrag) return;
		      event.preventDefault();
		      seekTimelineTo(scrubberPointerTime(event));
		    }

		    function onVideoScrubberPointerUp() {
		      videoState.scrubberDrag = false;
		    }

	    function clampSeconds(value, min, max) {
	      if (!Number.isFinite(value)) return min;
	      return Math.max(min, Math.min(max, value));
	    }

	    function ensureVideoReady() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (item?.backendPath && item.duration) return true;
	      if (!videoState.file || !el.videoPlayer.videoWidth) {
	        alert("Open or drop a video first.");
	        return false;
	      }
	      return true;
	    }

	    function hasOutputFolder() {
	      return Boolean(videoState.outputPath || videoState.outputHandle);
	    }

	    async function ensureScreenshotOutputReady() {
	      if (hasOutputFolder()) return true;
	      if (state.workspaceRoot) {
	        await syncScreenshotOutputWithWorkspace(state.workspaceRoot);
	        if (hasOutputFolder()) return true;
	      }
	      alert(state.workspaceRoot
	        ? "无法解析工作区 image_pool 路径，请手动选择 Output Folder。"
	        : "Choose an output folder first.");
	      return false;
	    }

	    async function refreshImagePoolAfterScreenshot() {
	      if (!state.workspaceRoot || videoState.screenshotOutputExplicit) return;
	      if (typeof scanImagePool === "function") {
	        await scanImagePool({ force: true, silent: true }).catch(() => {});
	      }
	    }
// ===== Batch export (browser) =====

	    async function exportCurrentVideoSegments({ interval, alertWhenDone = false } = {}) {
	      interval = interval || Number(el.captureIntervalInput.value);
	      const item = videoState.videos[videoState.currentVideoIndex];
	      const video = el.videoPlayer;
	      const segments = selectedSegments();
	      if (canUseBackendScreenshotExport(item) && pyBackend.bridge?.startCaptureVideoScreenshotJobs) {
	        return exportCurrentVideoSegmentsWithBackend(item, segments, interval, alertWhenDone);
	      }
	      if (shouldRequireBackendBatchExport([item])) return { saved: 0, stopped: true };
	      const originalTime = video.currentTime;
	      video.pause();
	      videoState.stopBatch = false;
	      videoState.exporting = true;
	      resetExportSequence();
	      let saved = 0;
	      const total = frameCountForSegments(segments, interval);
	      showExportProgressOverlay();
	      setExportProgress(0, total, "Exporting current video...");
	      try {
	      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
	        const { start, end } = segments[segmentIndex];
	        for (let t = start; t <= end + 0.001; t += interval) {
	          if (videoState.stopBatch) break;
	          await seekVideo(Math.min(t, end));
	          const blob = await currentVideoFrameBlob();
	          const written = await writeScreenshotBlob(
	            screenshotFileName(currentVideoTime(), segmentIndex + 1, item, nextExportSequence()),
	            blob
	          );
	          saved += 1;
	          setExportProgress(saved, total, `Exporting current video...\nLast: ${written}`);
	        }
	        if (videoState.stopBatch) break;
	      }
	      await seekVideo(Math.min(originalTime, video.duration || 0));
	      const stopped = videoState.stopBatch;
	      videoState.stopBatch = false;
	      const message = `${stopped ? "Stopped" : "Done"}. Saved ${saved} screenshot(s).`;
	      setVideoLog(message);
	      setStatus(message);
	      setExportProgress(saved, total, message);
	      if (alertWhenDone) await notifyExportFinished(message);
	      await refreshImagePoolAfterScreenshot();
	      return { saved, stopped };
	      } finally {
	        videoState.exporting = false;
	        updatePlayhead();
	        hideExportProgressOverlay();
	      }
	    }
// ===== Batch export (Python backend jobs) =====

	    async function exportCurrentVideoSegmentsWithBackend(item, segments, interval, alertWhenDone) {
	      const total = frameCountForSegments(segments, interval);
	      const result = await exportBackendScreenshotJobs(
	        [{ path: item.backendPath, segments, prefix: screenshotPrefixForItem(item) }],
	        interval,
	        total,
	        "Exporting current video with Python backend..."
	      );
	      if (alertWhenDone) await notifyExportFinished(result.message);
	      await refreshImagePoolAfterScreenshot();
	      return { saved: result.saved, stopped: result.stopped };
	    }

	    async function exportAllVideos() {
	      if (!videoState.videos.length) {
	        alert("Import at least one video first.");
	        return;
	      }
	      if (!await ensureScreenshotOutputReady()) return;
	      const interval = Number(el.captureIntervalInput.value);
	      if (!Number.isFinite(interval) || interval <= 0) {
	        alert("Batch interval must be greater than 0.");
	        return;
	      }
	      saveCurrentVideoSegments();
	      await ensureVideoDurations();
	      const originalIndex = videoState.currentVideoIndex;
	      const originalTime = el.videoPlayer.currentTime || 0;
	      const total = videoState.videos.reduce((sum, item) => sum + frameCountForSegments(segmentsForVideoItem(item), interval), 0);
	      if (!total) {
	        alert("No frames to export. Check segments and interval.");
	        return;
	      }
	      videoState.stopBatch = false;
	      videoState.exporting = true;
	      if (canUseBackendScreenshotJobsExport()) {
	        await exportAllVideosWithBackend(interval, total);
	        return;
	      }
	      if (shouldRequireBackendBatchExport(videoState.videos)) {
	        videoState.exporting = false;
	        return;
	      }
	      let saved = 0;
	      showExportProgressOverlay();
	      setExportProgress(0, total, "Exporting all videos...");
	      try {
	      for (let videoIndex = 0; videoIndex < videoState.videos.length; videoIndex += 1) {
	        if (videoState.stopBatch) break;
	        selectVideoIndex(videoIndex);
	        await waitForVideoReady();
	        const item = videoState.videos[videoIndex];
	        const segments = selectedSegments();
	        resetExportSequence();
	        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
	          const { start, end } = segments[segmentIndex];
	          for (let t = start; t <= end + 0.001; t += interval) {
	            if (videoState.stopBatch) break;
	            await seekVideo(Math.min(t, end));
	            const blob = await currentVideoFrameBlob();
	            const name = screenshotFileName(currentVideoTime(), segmentIndex + 1, item, nextExportSequence());
	            const written = await writeScreenshotBlob(name, blob);
	            saved += 1;
	            setExportProgress(saved, total, `Exporting ${videoIndex + 1}/${videoState.videos.length}: ${item.path}\nLast: ${written}`);
	          }
	          if (videoState.stopBatch) break;
	        }
	      }
	      if (originalIndex >= 0 && originalIndex < videoState.videos.length) {
	        selectVideoIndex(originalIndex);
	        await waitForVideoReady();
	        await seekVideo(Math.min(originalTime, el.videoPlayer.duration || 0));
	      }
	      const stopped = videoState.stopBatch;
	      videoState.stopBatch = false;
	      const message = `${stopped ? "Export stopped" : "Export complete"}. Saved ${saved}/${total} screenshot(s).`;
	      setVideoLog(message);
	      setStatus(message);
	      setExportProgress(saved, total, message);
	      await notifyExportFinished(message);
	      await refreshImagePoolAfterScreenshot();
	      } finally {
	        videoState.exporting = false;
	        updatePlayhead();
	        hideExportProgressOverlay();
	      }
	    }

	    async function exportAllVideosWithBackend(interval, total) {
	      const jobs = videoState.videos.map(item => ({
	        path: item.backendPath,
	        segments: segmentsForVideoItem(item),
	        prefix: screenshotPrefixForItem(item)
	      }));
	      const result = await exportBackendScreenshotJobs(jobs, interval, total, `Exporting ${jobs.length} video(s) with Python backend...`);
	      await notifyExportFinished(result.message);
	    }

	    async function exportBackendScreenshotJobs(jobs, interval, total, initialMessage) {
	      showExportProgressOverlay();
	      setExportProgress(0, total, initialMessage);
	      videoState.stopBatch = false;
	      videoState.exporting = true;
	      try {
	        const raw = await backendCall(
	          "startCaptureVideoScreenshotJobs",
	          JSON.stringify(jobs),
	          videoState.outputPath,
	          interval,
	          screenshotPrefix(),
	          screenshotFormat(),
	          total
	        );
	        let state = JSON.parse(raw || "{}");
	        while (!["done", "error", "cancelled"].includes(state.status)) {
	          if (videoState.stopBatch && pyBackend.bridge?.cancelCaptureVideoScreenshotJob) {
	            await backendCall("cancelCaptureVideoScreenshotJob", state.id);
	          }
	          await sleep(250);
	          state = JSON.parse(await backendCall("getCaptureVideoScreenshotJob", state.id));
	          setExportProgress(
	            Number(state.saved) || 0,
	            total,
	            `${initialMessage}\n${state.detail || ""}`
	          );
	        }
	        const saved = Number(state.saved) || 0;
	        const errors = state.errors || state.result?.errors || [];
	        const errorText = errors.length ? `\nErrors:\n${errors.slice(0, 8).join("\n")}` : "";
	        const stopped = state.status === "cancelled";
	        const failed = state.status === "error";
	        const message = `${stopped ? "Export cancelled" : failed ? "Export failed" : "Export complete"}. Saved ${saved}/${total} screenshot(s).${errorText}`;
	        setVideoLog(message);
	        setStatus(`Saved ${saved}/${total} screenshot(s).`);
	        setExportProgress(saved, total, message);
	        await refreshImagePoolAfterScreenshot();
	        return { saved, stopped, message };
	      } finally {
	        videoState.stopBatch = false;
	        videoState.exporting = false;
	        updatePlayhead();
	        hideExportProgressOverlay();
	      }
	    }

	    function sleep(ms) {
	      return new Promise(resolve => setTimeout(resolve, ms));
	    }

	    function canUseBackendScreenshotExport(item) {
	      return Boolean(item?.backendPath && videoState.outputPath && pyBackend.ready);
	    }

	    function canUseBackendScreenshotJobsExport() {
	      return Boolean(
	        videoState.outputPath &&
	        pyBackend.ready &&
	        pyBackend.bridge?.startCaptureVideoScreenshotJobs &&
	        videoState.videos.length &&
	        videoState.videos.every(item => item.backendPath)
	      );
	    }

	    function shouldRequireBackendBatchExport(items) {
	      if (!videoState.outputPath || !pyBackend.ready || !items?.length) return false;
	      const missing = items.filter(item => !item?.backendPath);
	      if (!missing.length) return false;
	      const message = [
	        "Batch screenshot needs backend-imported videos for the fast export path.",
	        "Click Open Video and choose the videos again, then run Export All.",
	        "",
	        `Missing backend path: ${missing.slice(0, 3).map(item => item?.name || item?.path || "video").join(", ")}`
	      ].join("\n");
	      setVideoLog(message);
	      setStatus("Re-open videos with Open Video before batch export.");
	      alert(message);
	      return true;
	    }

	    function screenshotVideoStem(fileOrItem) {
	      const name = fileOrItem?.name || fileOrItem?.file?.name || videoState.file?.name || "video";
	      return safeFileStem(name).replace(/\.[^.]+$/, "");
	    }

	    function screenshotNameBase(fileOrItem) {
	      const videoStem = screenshotVideoStem(fileOrItem);
	      const customRaw = String(el.screenshotPrefixInput.value || "").trim();
	      const custom = customRaw ? safeFileStem(customRaw).replace(/\.[^.]+$/, "") : "";
	      if (custom && custom.toLowerCase() !== videoStem.toLowerCase()) {
	        return `${videoStem}_${custom}`;
	      }
	      return videoStem;
	    }

	    function screenshotPrefixForItem(item) {
	      const custom = safeFileStem(el.screenshotPrefixInput.value || "").replace(/\.[^.]+$/, "");
	      return custom || screenshotVideoStem(item);
	    }

	    function screenshotPrefix() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      return screenshotPrefixForItem(item || { name: videoState.file?.name });
	    }

	    function resetExportSequence() {
	      videoState.exportSequence = 0;
	    }

	    function nextExportSequence() {
	      videoState.exportSequence = (videoState.exportSequence || 0) + 1;
	      return videoState.exportSequence;
	    }
// ===== Export utilities (paths, base64, progress) =====

	    function screenshotFormat() {
	      return el.screenshotFormatSelect.value === "png" ? "png" : "jpg";
	    }

	    async function ensureVideoDurations() {
	      for (const item of videoState.videos) {
	        if (!Number.isFinite(item.duration)) item.duration = await readVideoDuration(item.file);
	        if (!item.segments?.length && Number.isFinite(item.duration)) {
	          item.segments = [{ start: 0, end: item.duration }];
	          item.activeSegmentIndex = 0;
	        }
	      }
	      updateFrameEstimate();
	    }

	    function readVideoDuration(file) {
	      return new Promise(resolve => {
	        const video = document.createElement("video");
	        const url = URL.createObjectURL(file);
	        video.preload = "metadata";
	        video.onloadedmetadata = () => {
	          const duration = video.duration;
	          URL.revokeObjectURL(url);
	          resolve(duration);
	        };
	        video.onerror = () => {
	          URL.revokeObjectURL(url);
	          resolve(0);
	        };
	        video.src = url;
	      });
	    }

	    function waitForVideoReady() {
	      if (el.videoPlayer.videoWidth && Number.isFinite(el.videoPlayer.duration)) {
	        return Promise.resolve();
	      }
	      return new Promise(resolve => {
	        const done = () => {
	          el.videoPlayer.removeEventListener("loadedmetadata", done);
	          resolve();
	        };
	        el.videoPlayer.addEventListener("loadedmetadata", done, { once: true });
	      });
	    }

	    async function writeScreenshotBlob(filename, blob) {
	      if (videoState.outputPath && pyBackend.ready && pyBackend.bridge?.writeBase64File) {
	        const targetPath = joinPath(videoState.outputPath, filename);
	        const base64 = await blobToBase64(blob);
	        return backendCall("writeBase64File", targetPath, base64);
	      }
	      if (!videoState.outputHandle) throw new Error("No output folder selected.");
	      return writeUniqueBlobToFolder(videoState.outputHandle, filename, blob);
	    }

	    function blobToBase64(blob) {
	      return new Promise((resolve, reject) => {
	        const reader = new FileReader();
	        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
	        reader.onerror = () => reject(reader.error);
	        reader.readAsDataURL(blob);
	      });
	    }

	    function joinPath(folder, filename) {
	      return `${folder.replace(/[\\/]$/, "")}\\${filename}`;
	    }

	    function showExportProgressOverlay() {
	      if (el.exportProgressOverlay) el.exportProgressOverlay.hidden = false;
	      if (el.videoProgressBox) el.videoProgressBox.hidden = false;
	    }

	    function hideExportProgressOverlay() {
	      if (el.exportProgressOverlay) el.exportProgressOverlay.hidden = true;
	    }

	    function setExportProgress(value, total, text) {
	      el.exportProgress.max = Math.max(1, total || 1);
	      el.exportProgress.value = Math.max(0, value || 0);
	      el.exportProgressText.textContent = `${value || 0} / ${total || 0}`;
	      if (el.exportProgressDetail) {
	        el.exportProgressDetail.textContent = text ? String(text).replace(/\n/g, "\n") : "";
	      }
	      if (el.videoProgress) {
	        el.videoProgress.max = Math.max(1, total || 1);
	        el.videoProgress.value = Math.max(0, value || 0);
	      }
	      if (el.videoProgressText) el.videoProgressText.textContent = `${value || 0} / ${total || 0}`;
	      if (el.videoProgressDetail) {
	        el.videoProgressDetail.textContent = text ? String(text).replace(/\n/g, "\n") : "";
	      }
	      if (text) setVideoLog(text);
	    }

	    async function openExportFolder() {
	      if (videoState.outputPath && pyBackend.ready && pyBackend.bridge?.openDirectory) {
	        const ok = await backendCall("openDirectory", videoState.outputPath);
	        if (!ok) alert("Could not open export folder.");
	        return;
	      }
	      alert("Direct folder opening is available when Output Folder is selected inside the Python app.");
	    }

	    async function notifyExportFinished(message) {
	      if (videoState.outputPath && pyBackend.ready && pyBackend.bridge?.openDirectory) {
	        if (confirm(`${message}\n\nOpen export folder?`)) {
	          await openExportFolder();
	        }
	        return;
	      }
	      alert(message);
	    }

	    function currentVideoFrameBlob() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (item?.backendPath) {
	        const imageFormat = el.screenshotFormatSelect.value === "png" ? "png" : "jpg";
	        return backendCall("getVideoFrameBase64", item.backendPath, Number(videoState.backendCurrentTime) || 0, imageFormat)
	          .then(base64 => base64ToBlob(base64, imageFormat === "png" ? "image/png" : "image/jpeg"));
	      }
	      const video = el.videoPlayer;
	      const canvas = document.createElement("canvas");
	      canvas.width = video.videoWidth;
	      canvas.height = video.videoHeight;
	      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
	      const format = el.screenshotFormatSelect.value;
	      return canvasBlob(canvas, format === "jpg" ? "image/jpeg" : "image/png");
	    }

	    function seekVideo(time) {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      if (item?.backendPath) {
	        videoState.backendCurrentTime = clampSeconds(time, 0, item.duration || 0);
	        return updateBackendPreviewFrame(videoState.backendCurrentTime);
	      }
	      const video = el.videoPlayer;
	      if (Math.abs(video.currentTime - time) < 0.001) {
	        return new Promise(resolve => requestAnimationFrame(resolve));
	      }
	      return new Promise(resolve => {
	        const done = () => {
	          video.removeEventListener("seeked", done);
	          resolve();
	        };
	        video.addEventListener("seeked", done, { once: true });
	        video.currentTime = time;
	      });
	    }

	    async function writeUniqueBlobToFolder(rootHandle, filename, blob) {
	      const targetName = await uniqueFileName(rootHandle, filename);
	      const handle = await rootHandle.getFileHandle(targetName, { create: true });
	      await writeBlob(handle, blob);
	      return targetName;
	    }

	    async function uniqueFileName(rootHandle, filename) {
	      if (!await fileExistsInFolder(rootHandle, filename)) return filename;
	      for (let index = 2; index < 10000; index += 1) {
	        const candidate = suffixPath(filename, index);
	        if (!await fileExistsInFolder(rootHandle, candidate)) return candidate;
	      }
	      throw new Error(`Cannot create unique filename for ${filename}`);
	    }

	    async function fileExistsInFolder(rootHandle, filename) {
	      try {
	        await rootHandle.getFileHandle(filename);
	        return true;
	      } catch {
	        return false;
	      }
	    }

	    function screenshotFileName(time, segmentNumber = null, fileOrItem = null, sequence = null) {
	      const source = fileOrItem || videoState.videos[videoState.currentVideoIndex] || videoState.file;
	      const base = screenshotNameBase(source);
	      const extName = el.screenshotFormatSelect.value === "jpg" ? "jpg" : "png";
	      const segmentPart = segmentNumber == null ? "" : `_seg${String(segmentNumber).padStart(2, "0")}`;
	      const seqPart = sequence == null ? "" : `_${String(sequence).padStart(6, "0")}`;
	      return `${base}${segmentPart}${seqPart}_${formatTimestamp(time)}.${extName}`;
	    }

	    function safeFileStem(name) {
	      return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 120) || "video";
	    }

	    function formatTimestamp(seconds) {
	      const ms = Math.round(seconds * 1000);
	      const h = Math.floor(ms / 3600000);
	      const m = Math.floor((ms % 3600000) / 60000);
	      const s = Math.floor((ms % 60000) / 1000);
	      const n = ms % 1000;
	      return `${String(h).padStart(2, "0")}-${String(m).padStart(2, "0")}-${String(s).padStart(2, "0")}-${String(n).padStart(3, "0")}`;
	    }

		    function updateVideoTimeReadout() {
		      const video = el.videoPlayer;
		      const item = videoState.videos[videoState.currentVideoIndex];
		      const duration = item?.backendPath ? item.duration : (Number.isFinite(video.duration) ? video.duration : 0);
		      const current = currentVideoTime();
		      el.videoTimeReadout.textContent = `${formatClock(current)} / ${formatClock(duration)}`;
		      updateVideoScrubber(duration, current);
		      updatePlayhead();
		    }

	    function currentVideoTime() {
	      const item = videoState.videos[videoState.currentVideoIndex];
	      return item?.backendPath ? (videoState.backendCurrentTime || 0) : (el.videoPlayer.currentTime || 0);
	    }

	    function base64ToBlob(base64, type) {
	      const binary = atob(base64);
	      const bytes = new Uint8Array(binary.length);
	      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	      return new Blob([bytes], { type });
	    }

	    function formatClock(seconds) {
	      const ms = Math.round((seconds || 0) * 1000);
	      const h = Math.floor(ms / 3600000);
	      const m = Math.floor((ms % 3600000) / 60000);
	      const s = Math.floor((ms % 60000) / 1000);
	      const n = ms % 1000;
	      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(n).padStart(3, "0")}`;
	    }

	    function trimSeconds(seconds) {
	      return String(Math.round(seconds * 1000) / 1000);
	    }

	    function setVideoLog(text) {
	      el.videoLog.textContent = text;
	    }

function bindVideoPageEvents() {
// ===== Event binding =====
  document.getElementById("openVideoBtn").addEventListener("click", openVideoSource);
  document.getElementById("openBrowserWebBtn")?.addEventListener("click", () => openBrowserWebUI());
  document.getElementById("chooseScreenshotFolderBtn").addEventListener("click", chooseScreenshotFolder);
  document.getElementById("captureFrameBtn").addEventListener("click", captureCurrentFrame);
  document.getElementById("captureBatchBtn").addEventListener("click", captureWholeVideo);
  document.getElementById("exportAllVideosBtn").addEventListener("click", exportAllVideos);
  document.getElementById("stopCaptureBatchBtn").addEventListener("click", () => videoState.stopBatch = true);
  el.captureIntervalInput.addEventListener("input", updateFrameEstimate);
  document.getElementById("addSegmentBtn").addEventListener("click", addSegmentAtCurrentTime);
  document.getElementById("deleteSegmentBtn").addEventListener("click", deleteActiveSegment);
	  document.getElementById("fullSegmentBtn").addEventListener("click", useFullSegment);
	  el.segmentTimeline.addEventListener("pointerdown", onSegmentPointerDown);
	  el.segmentTimeline.addEventListener("contextmenu", onSegmentContextMenu);
	  el.snapSegmentHandleBtn.addEventListener("click", snapSegmentHandleToPlayhead);
	  document.addEventListener("click", event => {
	    if (!el.segmentContextMenu?.contains(event.target)) hideSegmentContextMenu();
	  });
	  document.addEventListener("keydown", event => {
	    if (event.key === "Escape") hideSegmentContextMenu();
	  });
	  el.videoScrubber.addEventListener("input", event => {
	    seekTimelineTo(Number(event.target.value) || 0);
	  });
	  el.videoScrubber.addEventListener("pointerdown", onVideoScrubberPointerDown);
	  el.videoScrubber.addEventListener("pointermove", onVideoScrubberPointerMove);
	  el.videoScrubber.addEventListener("pointerup", onVideoScrubberPointerUp);
	  el.videoScrubber.addEventListener("pointercancel", onVideoScrubberPointerUp);
	  window.addEventListener("resize", updatePlayhead);
	  window.addEventListener("pointermove", onSegmentPointerMove);
  window.addEventListener("pointerup", onSegmentPointerUp);
	  el.videoInput.addEventListener("change", event => {
	    const files = [...(event.target.files || [])].filter(isVideoFile);
	    if (files.length) appendVideoPlaylist(files.map(file => ({ file, name: file.name, path: file.name })));
	    event.target.value = "";
	  });
  el.videoPlayer.addEventListener("loadedmetadata", onVideoMetadata);
  el.videoPlayer.addEventListener("loadeddata", onVideoMetadata);
  el.videoPlayer.addEventListener("canplay", onVideoMetadata);
  el.videoPlayer.addEventListener("error", onVideoError);
  el.videoPlayer.addEventListener("timeupdate", updateVideoTimeReadout);
  el.videoPlayer.addEventListener("seeked", updateVideoTimeReadout);
  for (const target of [el.videoDropZone, el.videoPlayer]) {
    target.addEventListener("dragover", onVideoDragOver);
    target.addEventListener("dragleave", () => el.videoDropZone.classList.remove("drop-hover"));
    target.addEventListener("drop", onVideoDrop);
  }
}

function onVideoDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  el.videoDropZone.classList.add("drop-hover");
}
