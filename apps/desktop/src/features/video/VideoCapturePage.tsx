import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
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

type Props = { onReady?: () => void };

type ImageFormat = "jpg" | "png";

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

export function VideoCapturePage({ onReady }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [outputRoot, setOutputRoot] = useState("");
  const [prefix, setPrefix] = useState("");
  const [format, setFormat] = useState<ImageFormat>("jpg");
  const [previewTime, setPreviewTime] = useState(0);
  const [previewBase64, setPreviewBase64] = useState("");
  const [status, setStatus] = useState("Open videos to start capture.");
  const [log, setLog] = useState("");
  const [job, setJob] = useState<CaptureJob | null>(null);
  const [pending, setPending] = useState(false);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);
  const current = currentIndex >= 0 ? videos[currentIndex] : null;
  const running = job?.status === "running";
  const totalFrames = useMemo(() => videos.reduce((sum, video) => sum + frameCount(video.segments), 0), [videos]);
  const currentFrames = useMemo(() => frameCount(current?.segments || []), [current]);

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
    if (!current?.path) {
      setPreviewBase64("");
      return;
    }
    let cancelled = false;
    setPending(true);
    getVideoFrameBase64(current.path, previewTime, format)
      .then((data) => { if (!cancelled) setPreviewBase64(data || ""); })
      .catch(showError)
      .finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; };
  }, [current?.path, previewTime, format, showError]);

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
      setPreviewTime(0);
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

  function addSegment() {
    if (!current) return;
    const start = clamp(previewTime, 0, current.duration);
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
      const written = await saveVideoFrame(current.path, outputRoot, previewTime, prefix || fileStem(current.name), format);
      setLog(`Saved ${written}`);
      setStatus(`Saved frame at ${formatClock(previewTime)}.`);
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
    if (!window.confirm(`Export ${total} frame(s) from ${selectedVideos.length} video(s)?`)) return;
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

  return (
    <main className="video-capture-native-page">
      <section className="panel">
        <div className="panel-header"><span>Video Capture</span><span className="status">{status}</span></div>
        <div className="panel-body">
          <div className="row">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)} disabled={running}>Open Workspace</button>
            <button type="button" onClick={() => void addVideos()} disabled={running}>Open Videos</button>
            <button type="button" onClick={() => setVideos([])} disabled={running || !videos.length}>Clear</button>
          </div>
          <label>Output folder<div className="row"><input value={outputRoot} onChange={(event) => setOutputRoot(event.target.value)} /><button type="button" onClick={() => void chooseOutput()} disabled={running}>Choose</button></div></label>
          <div className="grid two">
            <label>Prefix<input value={prefix} onChange={(event) => setPrefix(event.target.value)} /></label>
            <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)}><option value="jpg">jpg</option><option value="png">png</option></select></label>
          </div>
          <div className="hint">Estimated frames: {currentFrames} current / {totalFrames} all. Each segment has its own interval.</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><span>Videos</span><span className="status">{videos.length}</span></div>
        <div className="panel-body">
          {videos.length ? videos.map((video, index) => <div className="row" key={video.path}><button type="button" className={index === currentIndex ? "primary" : ""} onClick={() => { setCurrentIndex(index); setPreviewTime(0); setPrefix(fileStem(video.name)); }}>{video.name}</button><span>{video.width}x{video.height} | {formatClock(video.duration)} | {frameCount(video.segments)} frames</span></div>) : <div className="empty">No videos loaded.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><span>Preview</span><span className="status">{current ? current.name : "No video"}</span></div>
        <div className="panel-body">
          {previewBase64 ? <img alt="Video frame preview" src={`data:image/${format === "png" ? "png" : "jpeg"};base64,${previewBase64}`} style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }} /> : <div className="empty">No preview.</div>}
          <label>Time: {formatClock(previewTime)}<input type="range" min="0" max={current?.duration || 0} step="0.001" value={previewTime} onChange={(event) => setPreviewTime(Number(event.target.value))} disabled={!current || pending} /></label>
          <div className="row"><button type="button" onClick={() => setPreviewTime((value) => clamp(value - 5, 0, current?.duration || 0))} disabled={!current}>-5s</button><button type="button" onClick={() => setPreviewTime((value) => clamp(value + 5, 0, current?.duration || 0))} disabled={!current}>+5s</button><button type="button" onClick={() => void captureCurrentFrame()} disabled={!current || running}>Capture Current Frame</button></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><span>Segments</span><span className="status">{current?.segments.length || 0}</span></div>
        <div className="panel-body">
          <div className="row"><button type="button" onClick={addSegment} disabled={!current || running}>Add Segment at Preview Time</button><button type="button" onClick={useFullVideo} disabled={!current || running}>Use Full Video</button></div>
          {current?.segments.map((segment, index) => <div className="grid two" key={index}>
            <label>Start<input type="number" step="0.001" value={segment.start} onChange={(event) => updateSegment(index, { start: Number(event.target.value) })} disabled={running} /></label>
            <label>End<input type="number" step="0.001" value={segment.end} onChange={(event) => updateSegment(index, { end: Number(event.target.value) })} disabled={running} /></label>
            <label>Interval<input type="number" step="0.001" min="0.001" value={segment.interval} onChange={(event) => updateSegment(index, { interval: Number(event.target.value) })} disabled={running} /></label>
            <div className="row"><span>{formatClock(segment.start)} - {formatClock(segment.end)} | {frameCount([segment])} frames</span><button type="button" className="danger" onClick={() => removeSegment(index)} disabled={running}>Remove</button></div>
          </div>)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><span>Export</span><span className="status">{job?.status || "idle"}</span></div>
        <div className="panel-body">
          <div className="row"><button className="primary" type="button" onClick={() => void exportVideos("current")} disabled={!current || running}>Export Current Video</button><button className="primary" type="button" onClick={() => void exportVideos("all")} disabled={!videos.length || running}>Export All Videos</button><button type="button" onClick={() => void cancelJob()} disabled={!running}>Cancel</button></div>
          <pre className="log">{log || "No export job yet."}</pre>
        </div>
      </section>
    </main>
  );
}
