import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { JobStatusPanel } from "../../components/workbench/JobStatusPanel";
import { LogPanel } from "../../components/workbench/LogPanel";
import { useRunWithConfirm } from "../../components/workbench/useRunWithConfirm";
import { useToast } from "../../components/useToast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { errMessage } from "../../lib/errors";
import {
  cancelCaptureJob,
  chooseVideoFiles,
  chooseVideoOutputFolder,
  getCaptureJob,
  getVideoFrameBase64,
  loadVideoWorkspace,
  saveVideoFrame,
  startCaptureJobs,
  type CaptureJob,
  type VideoItem,
  type VideoSegment
} from "./videoCaptureApi";

type Props = {
  onReady?: () => void;
  active?: boolean;
};

type ImageFormat = "jpg" | "png";

const PREVIEW_DEBOUNCE_MS = 200;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatClock(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(value);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ms = Math.round((value - whole) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function fileStem(name: string) {
  return (name || "video").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "video";
}

function defaultSegments(duration: number): VideoSegment[] {
  return duration > 0 ? [{ start: 0, end: duration, interval: 1 }] : [];
}

function normalizeVideo(item: VideoItem): VideoItem {
  const duration = Number(item.duration) || 0;
  const rawSegments = item.segments?.length ? item.segments : defaultSegments(duration);
  const segments = rawSegments
    .map((segment) => ({
      start: clamp(Number(segment.start), 0, duration),
      end: clamp(Number(segment.end), 0, duration),
      interval: Math.max(0.001, Number(segment.interval) || 1)
    }))
    .filter((segment) => segment.end >= segment.start);
  return { ...item, duration, width: Number(item.width) || 0, height: Number(item.height) || 0, segments };
}

function frameCount(segments: VideoSegment[]) {
  return segments.reduce((sum, segment) => {
    if (segment.interval <= 0 || segment.end < segment.start) return sum;
    return sum + Math.floor((segment.end - segment.start) / segment.interval) + 1;
  }, 0);
}

export function VideoCapturePage({ onReady, active = true }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const runWithConfirm = useRunWithConfirm();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [outputRoot, setOutputRoot] = useState("");
  const [prefix, setPrefix] = useState("");
  const [format, setFormat] = useState<ImageFormat>("jpg");
  const [scrubTime, setScrubTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [previewBase64, setPreviewBase64] = useState("");
  const [status, setStatus] = useState("Open or drop a video.");
  const [log, setLog] = useState("Ready.");
  const [job, setJob] = useState<CaptureJob | null>(null);
  const [pending, setPending] = useState(false);
  const previewRequestIdRef = useRef(0);

  const debouncedScrubTime = useDebouncedValue(scrubTime, isScrubbing ? PREVIEW_DEBOUNCE_MS : 0);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);
  const current = currentIndex >= 0 ? videos[currentIndex] : null;
  const running = job?.status === "running";
  const totalFrames = useMemo(() => videos.reduce((sum, video) => sum + frameCount(video.segments), 0), [videos]);
  const currentFrames = useMemo(() => frameCount(current?.segments || []), [current]);

  useEffect(() => {
    if (active) return;
    setPreviewBase64("");
    setPending(false);
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!workspaceRoot.trim()) {
        onReady?.();
        return;
      }
      try {
        const info = await loadVideoWorkspace(workspaceRoot);
        if (cancelled) return;
        if (!outputRoot && info.imagePool) setOutputRoot(info.imagePool);
        setStatus(`Workspace: ${info.name || info.root}`);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, outputRoot, onReady, showError]);

  useEffect(() => {
    if (!active || !current?.path) {
      setPreviewBase64("");
      return;
    }
    const requestId = ++previewRequestIdRef.current;
    let cancelled = false;
    setPending(true);
    getVideoFrameBase64(current.path, debouncedScrubTime, format)
      .then((data) => {
        if (!cancelled && requestId === previewRequestIdRef.current) {
          setPreviewBase64(data || "");
        }
      })
      .catch((err) => {
        if (!cancelled && requestId === previewRequestIdRef.current) showError(err);
      })
      .finally(() => {
        if (!cancelled && requestId === previewRequestIdRef.current) setPending(false);
      });
    return () => { cancelled = true; };
  }, [active, current?.path, debouncedScrubTime, format, showError]);

  useEffect(() => {
    if (!job?.id || job.status !== "running") return;
    const timer = window.setInterval(() => {
      getCaptureJob(job.id).then((next) => {
        setJob(next);
        setStatus(`${next.status}: ${next.saved || 0}/${next.total || totalFrames}`);
        setLog(JSON.stringify(next, null, 2));
        if (next.status !== "running") showToast(`Video capture ${next.status}.`);
      }).catch(showError);
    }, 500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, showError, showToast, totalFrames]);

  function updateCurrentVideo(next: VideoItem) {
    setVideos((items) => items.map((item, index) => (index === currentIndex ? next : item)));
  }

  function selectVideo(index: number) {
    const video = videos[index];
    if (!video) return;
    setCurrentIndex(index);
    setScrubTime(0);
    setPrefix(fileStem(video.name));
  }

  function removeVideo(index: number) {
    setVideos((items) => {
      const next = items.filter((_, itemIndex) => itemIndex !== index);
      setCurrentIndex((current) => {
        if (next.length === 0) return -1;
        if (current === index) return Math.min(index, next.length - 1);
        if (current > index) return current - 1;
        return current;
      });
      return next;
    });
  }

  async function addVideos() {
    try {
      const selected = (await chooseVideoFiles()).filter((item) => item.ok !== false).map(normalizeVideo);
      if (!selected.length) return;
      setVideos((items) => {
        const keys = new Set(items.map((item) => item.path));
        const added = selected.filter((item) => !keys.has(item.path));
        return [...items, ...added];
      });
      setCurrentIndex((index) => (index >= 0 ? index : 0));
      if (!prefix) setPrefix(fileStem(selected[0].name));
      setScrubTime(0);
      setStatus(`Added ${selected.length} video(s).`);
    } catch (err) {
      showError(err);
    }
  }

  async function chooseOutput() {
    try {
      const path = await chooseVideoOutputFolder();
      if (path) setOutputRoot(path);
    } catch (err) {
      showError(err);
    }
  }

  function endScrubbing() {
    setIsScrubbing(false);
  }

  function addSegment() {
    if (!current) return;
    const start = clamp(scrubTime, 0, current.duration);
    const end = clamp(start + Math.min(5, current.duration || 5), start, current.duration);
    updateCurrentVideo({ ...current, segments: [...current.segments, { start, end, interval: 1 }] });
  }

  function updateSegment(index: number, patch: Partial<VideoSegment>) {
    if (!current) return;
    const segments = current.segments.map((segment, segmentIndex) => {
      if (segmentIndex !== index) return segment;
      const next = { ...segment, ...patch };
      next.start = clamp(next.start, 0, current.duration);
      next.end = clamp(next.end, next.start, current.duration);
      next.interval = Math.max(0.001, Number(next.interval) || 1);
      return next;
    });
    updateCurrentVideo({ ...current, segments });
  }

  function removeSegment(index: number) {
    if (!current) return;
    updateCurrentVideo({ ...current, segments: current.segments.filter((_, segmentIndex) => segmentIndex !== index) });
  }

  function useFullVideo() {
    if (!current) return;
    updateCurrentVideo({ ...current, segments: defaultSegments(current.duration) });
  }

  async function captureCurrentFrame() {
    if (!current || !outputRoot) {
      showToast("Choose a video and output folder first.", { variant: "error" });
      return;
    }
    try {
      const written = await saveVideoFrame(current.path, outputRoot, scrubTime, prefix || fileStem(current.name), format);
      setLog(`Saved ${written}`);
      setStatus(`Saved frame at ${formatClock(scrubTime)}.`);
    } catch (err) {
      showError(err);
    }
  }

  async function exportVideos(scope: "current" | "all") {
    const selectedVideos = scope === "current" && current ? [current] : videos;
    if (!selectedVideos.length || !outputRoot) {
      showToast("Choose videos and output folder first.", { variant: "error" });
      return;
    }
    const total = selectedVideos.reduce((sum, video) => sum + frameCount(video.segments), 0);
    if (!total) {
      showToast("No frames to export. Add segments and intervals first.", { variant: "error" });
      return;
    }
    await runWithConfirm(
      {
        title: "Export video frames",
        message: `Export ${total} frame(s) from ${selectedVideos.length} video(s)?`,
        confirmLabel: "Export"
      },
      async () => {
        try {
          const next = await startCaptureJobs({
            jobs: selectedVideos.map((video) => ({ path: video.path, prefix: prefix || fileStem(video.name), segments: video.segments })),
            outputRoot,
            prefix,
            format,
            total
          });
          setJob(next);
          setStatus(`${next.status}: ${next.saved || 0}/${total}`);
          setLog(JSON.stringify(next, null, 2));
        } catch (err) {
          showError(err);
        }
      }
    );
  }

  async function cancelJob() {
    if (!job?.id) return;
    try {
      const next = await cancelCaptureJob(job.id);
      setJob(next);
      setStatus(next.detail || "Cancelling...");
    } catch (err) {
      showError(err);
    }
  }

  const videoMeta = current
    ? `${current.width}x${current.height} | ${formatClock(current.duration)}`
    : "No video loaded";

  const segmentSummary = current?.segments.length
    ? current.segments.map((segment, index) => `seg${String(index + 1).padStart(2, "0")} ${formatClock(segment.start)}-${formatClock(segment.end)}`).join(" · ")
    : "Segments: none";

  return (
    <main className="video-workspace">
      <section className="panel">
        <div className="panel-header">
          <span>Video</span>
          <span className="status">{videoMeta}</span>
        </div>
        <div className="panel-body video-panel">
          <div className="video-stage" id="videoDropZone">
            {previewBase64 ? (
              <img
                id="backendFramePreview"
                alt="Video frame preview"
                src={`data:image/${format === "png" ? "png" : "jpeg"};base64,${previewBase64}`}
              />
            ) : (
              <div className="empty">{pending ? "Loading preview..." : "No preview."}</div>
            )}
          </div>
          <input
            className="video-scrubber"
            type="range"
            min="0"
            max={current?.duration || 0}
            step="0.001"
            value={scrubTime}
            onChange={(event) => setScrubTime(Number(event.target.value))}
            onPointerDown={() => setIsScrubbing(true)}
            onPointerUp={endScrubbing}
            onPointerLeave={endScrubbing}
            disabled={!current}
            aria-label="Video progress"
          />
          <div className="segment-box">
            <div className="row">
              <div className="group-title" style={{ margin: 0 }}>Screenshot Segments</div>
              <button type="button" onClick={addSegment} disabled={!current || running}>Add Segment</button>
              <button type="button" className="danger" onClick={() => current?.segments.length && removeSegment(current.segments.length - 1)} disabled={!current?.segments.length || running}>Delete Segment</button>
              <button type="button" onClick={useFullVideo} disabled={!current || running}>Full Video</button>
            </div>
            <div className="segment-summary">{segmentSummary}</div>
            {current?.segments.map((segment, index) => (
              <div className="train-grid" key={index} style={{ marginTop: 8 }}>
                <label>
                  Start
                  <input type="number" step="0.001" value={segment.start} onChange={(event) => updateSegment(index, { start: Number(event.target.value) })} disabled={running} />
                </label>
                <label>
                  End
                  <input type="number" step="0.001" value={segment.end} onChange={(event) => updateSegment(index, { end: Number(event.target.value) })} disabled={running} />
                </label>
                <label>
                  Interval
                  <input type="number" step="0.001" min="0.001" value={segment.interval} onChange={(event) => updateSegment(index, { interval: Number(event.target.value) })} disabled={running} />
                </label>
                <div className="row" style={{ alignItems: "end" }}>
                  <span className="hint" style={{ margin: 0 }}>{frameCount([segment])} frames</span>
                  <button type="button" className="danger" onClick={() => removeSegment(index)} disabled={running}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="panel">
        <div className="panel-header">
          <span>Screenshot</span>
          <span className="status">{videos.length} videos</span>
        </div>
        <div className="panel-body video-control-stack">
          <div className="row workspace-toolbar">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={running}>Open Workspace</button>
            <button className="primary" type="button" onClick={() => void addVideos()} disabled={running}>Add Video</button>
            <button type="button" onClick={() => void chooseOutput()} disabled={running}>Output Folder</button>
          </div>
          {outputRoot ? <div className="video-time">{outputRoot}</div> : null}
          <div className="video-list">
            {videos.length ? videos.map((video, index) => (
              <div className={`video-list-item${index === currentIndex ? " active" : ""}`} key={video.path}>
                <button type="button" className="video-list-select" onClick={() => selectVideo(index)} disabled={running}>
                  {video.name}
                </button>
                <button type="button" className="video-list-remove" onClick={() => removeVideo(index)} disabled={running} aria-label={`Remove ${video.name}`}>
                  Remove
                </button>
              </div>
            )) : <div className="empty">Drop a video file or folder.</div>}
          </div>
          <div className="video-time">{formatClock(scrubTime)} / {formatClock(current?.duration || 0)}</div>
          <div className="video-time">Estimated frames: {currentFrames} current / {totalFrames} all</div>
          <button className="primary" type="button" onClick={() => void captureCurrentFrame()} disabled={!current || running}>Capture Current Frame</button>
          <div className="video-inline-grid">
            <label>
              Filename prefix
              <input value={prefix} onChange={(event) => setPrefix(event.target.value)} disabled={running} placeholder="video name" />
            </label>
            <label>
              Format
              <select value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)} disabled={running}>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
            </label>
          </div>
          <div className="hint">Export naming: video_seg01_000001_timestamp.jpg. Each video is numbered independently.</div>
          <div className="row">
            <button type="button" onClick={() => void exportVideos("current")} disabled={!current || running}>Capture Segments</button>
            <button type="button" onClick={() => void exportVideos("all")} disabled={!videos.length || running}>Export All Videos</button>
            <button type="button" onClick={() => void cancelJob()} disabled={!running}>Stop</button>
          </div>
          <JobStatusPanel
            visible={running || !!job}
            running={running}
            done={job?.saved || 0}
            total={job?.total || totalFrames || 1}
            detail={status}
          />
          <div className="hint">Add or drop a video, then capture screenshots. With a workspace open, output defaults to image_pool.</div>
          <LogPanel>{log}</LogPanel>
        </div>
      </aside>
    </main>
  );
}
