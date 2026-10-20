import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { JobStatusPanel } from "../../components/workbench/JobStatusPanel";
import { LogPanel } from "../../components/workbench/LogPanel";
import { useRunWithConfirm } from "../../components/workbench/useRunWithConfirm";
import { useToast } from "../../components/useToast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePollingJob } from "../../hooks/usePollingJob";
import { errMessage } from "../../lib/errors";
import {
  cancelCaptureJob,
  chooseVideoFiles,
  chooseVideoOutputFolder,
  getCaptureJob,
  getVideoFrameBase64,
  listWorkspaceVideos,
  loadVideoWorkspace,
  saveVideoFrame,
  startCaptureJobs,
  type CaptureJob,
  type VideoItem,
  type VideoSegment as CaptureSegment
} from "./videoCaptureApi";
import { WORKSPACE_MEDIA_CHANGED_EVENT, isSameWorkspaceRoot, isWorkspaceMediaChangedEvent } from "../shared/mediaEvents";
import {
  loadVideoSegmentManifest,
  saveVideoSegmentManifest,
  type VideoSegmentManifest,
  type VideoSegment as ManifestSegment
} from "./videoSegmentApi";
import { createVideoSegment } from "./videoSegmentDomain";
import "./video.css";

type Props = {
  onReady?: () => void;
  active?: boolean;
};

type ImageFormat = "jpg" | "png";
type PageTab = "segments" | "export";

const PREVIEW_DEBOUNCE_MS = 200;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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

function msToSeconds(ms: number) {
  return ms / 1000;
}

function secondsToMs(seconds: number) {
  return Math.round(seconds * 1000);
}

function fileStem(name: string) {
  return (name || "video").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "video";
}

function defaultCaptureSegments(duration: number): CaptureSegment[] {
  return duration > 0 ? [{ start: 0, end: duration, interval: 1 }] : [];
}

function normalizeVideo(item: VideoItem): VideoItem {
  const duration = Number(item.duration) || 0;
  const rawSegments = item.segments?.length ? item.segments : defaultCaptureSegments(duration);
  const segments = rawSegments
    .map((segment) => ({
      start: clamp(Number(segment.start), 0, duration),
      end: clamp(Number(segment.end), 0, duration),
      interval: Math.max(0.001, Number(segment.interval) || 1)
    }))
    .filter((segment) => segment.end >= segment.start);
  return { ...item, duration, width: Number(item.width) || 0, height: Number(item.height) || 0, segments };
}

function mergeVideoItems(existing: VideoItem[], incoming: VideoItem[]) {
  const known = new Set(existing.map((item) => item.path));
  const added = incoming.filter((item) => item.path && !known.has(item.path));
  return added.length ? [...existing, ...added] : existing;
}

function frameCount(segments: CaptureSegment[]) {
  return segments.reduce((sum, segment) => {
    if (segment.interval <= 0 || segment.end < segment.start) return sum;
    return sum + Math.floor((segment.end - segment.start) / segment.interval) + 1;
  }, 0);
}

function durationLabel(seg: ManifestSegment) {
  const dur = Math.max(0, seg.endMs - seg.startMs);
  return formatClock(dur / 1000);
}

// ---------------------------------------------------------------------------
// Segments tab
// ---------------------------------------------------------------------------

type SegmentsTabProps = {
  current: VideoItem | null;
  scrubTime: number;
  setScrubTime: (t: number) => void;
  isScrubbing: boolean;
  setIsScrubbing: (v: boolean) => void;
  pending: boolean;
  previewBase64: string;
  format: ImageFormat;
  manifest: VideoSegmentManifest | null;
  saving: boolean;
  onAddSegment: () => void;
  onUpdateSegment: (id: string, patch: Partial<Pick<ManifestSegment, "startMs" | "endMs" | "label" | "enabled">>) => void;
  onRemoveSegment: (id: string) => void;
  onSave: () => void;
  onSetCurrentTime: (seconds: number) => void;
};

function SegmentsTab({
  current,
  scrubTime,
  setScrubTime,
  isScrubbing,
  setIsScrubbing,
  pending,
  previewBase64,
  format,
  manifest,
  saving,
  onAddSegment,
  onUpdateSegment,
  onRemoveSegment,
  onSave,
  onSetCurrentTime
}: SegmentsTabProps) {
  const duration = current?.duration ?? 0;
  const segments = manifest?.segments ?? [];

  function endScrubbing() {
    setIsScrubbing(false);
  }

  return (
    <div className="panel-body video-panel">
      {/* Preview stage */}
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

      {/* Scrubber */}
      <input
        className="video-scrubber"
        type="range"
        min="0"
        max={duration}
        step="0.001"
        value={scrubTime}
        onChange={(event) => setScrubTime(Number(event.target.value))}
        onPointerDown={() => setIsScrubbing(true)}
        onPointerUp={endScrubbing}
        onPointerLeave={endScrubbing}
        disabled={!current}
        aria-label="Video progress"
      />
      <div className="video-time">{formatClock(scrubTime)} / {formatClock(duration)}</div>

      {/* Segment manifest panel */}
      <div className="segment-box">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="group-title" style={{ margin: 0 }}>Segments</div>
          <button type="button" onClick={onAddSegment} disabled={!current || saving}>
            Add at Playhead
          </button>
          <button
            type="button"
            className="primary"
            onClick={onSave}
            disabled={!manifest || saving}
          >
            {saving ? "Saving..." : "Save Segments"}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          Segments defined here are used by Video Label for random sampling.
        </div>

        {segments.length === 0 ? (
          <div className="empty" style={{ marginTop: 8 }}>No segments yet. Scrub to a point and click "Add at Playhead".</div>
        ) : (
          <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: "0.85em" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingBottom: 4 }}>Start</th>
                <th style={{ textAlign: "left", paddingBottom: 4 }}>End</th>
                <th style={{ textAlign: "left", paddingBottom: 4 }}>Duration</th>
                <th style={{ textAlign: "left", paddingBottom: 4 }}>Label</th>
                <th style={{ textAlign: "left", paddingBottom: 4 }}>On</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => (
                <tr key={seg.id} style={{ opacity: seg.enabled ? 1 : 0.5 }}>
                  <td style={{ paddingRight: 4 }}>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max={duration}
                      style={{ width: 80 }}
                      value={msToSeconds(seg.startMs).toFixed(3)}
                      onChange={(e) =>
                        onUpdateSegment(seg.id, { startMs: secondsToMs(Number(e.target.value)) })
                      }
                      disabled={saving}
                    />
                    <button
                      type="button"
                      title="Jump to start"
                      style={{ marginLeft: 2, fontSize: "0.8em" }}
                      onClick={() => onSetCurrentTime(msToSeconds(seg.startMs))}
                    >
                      Go
                    </button>
                  </td>
                  <td style={{ paddingRight: 4 }}>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max={duration}
                      style={{ width: 80 }}
                      value={msToSeconds(seg.endMs).toFixed(3)}
                      onChange={(e) =>
                        onUpdateSegment(seg.id, { endMs: secondsToMs(Number(e.target.value)) })
                      }
                      disabled={saving}
                    />
                    <button
                      type="button"
                      title="Jump to end"
                      style={{ marginLeft: 2, fontSize: "0.8em" }}
                      onClick={() => onSetCurrentTime(msToSeconds(seg.endMs))}
                    >
                      Go
                    </button>
                  </td>
                  <td style={{ paddingRight: 8, whiteSpace: "nowrap" }}>{durationLabel(seg)}</td>
                  <td style={{ paddingRight: 4 }}>
                    <input
                      type="text"
                      style={{ width: 90 }}
                      value={seg.label ?? ""}
                      onChange={(e) => onUpdateSegment(seg.id, { label: e.target.value })}
                      placeholder="optional"
                      disabled={saving}
                    />
                  </td>
                  <td style={{ paddingRight: 4 }}>
                    <input
                      type="checkbox"
                      checked={seg.enabled}
                      onChange={(e) => onUpdateSegment(seg.id, { enabled: e.target.checked })}
                      disabled={saving}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onRemoveSegment(seg.id)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Frames tab
// ---------------------------------------------------------------------------

type ExportTabProps = {
  current: VideoItem | null;
  scrubTime: number;
  setScrubTime: (t: number) => void;
  isScrubbing: boolean;
  setIsScrubbing: (v: boolean) => void;
  pending: boolean;
  previewBase64: string;
  format: ImageFormat;
  setFormat: (f: ImageFormat) => void;
  videos: VideoItem[];
  currentIndex: number;
  outputRoot: string;
  prefix: string;
  setPrefix: (p: string) => void;
  running: boolean;
  job: CaptureJob | null;
  totalFrames: number;
  currentFrames: number;
  status: string;
  log: string;
  onAddVideos: () => void;
  onRemoveVideo: (index: number) => void;
  onSelectVideo: (index: number) => void;
  onChooseOutput: () => void;
  onCaptureFrame: () => void;
  onExportVideos: (scope: "current" | "all") => void;
  onCancelJob: () => void;
  onOpenWorkspace: () => void;
};

function ExportTab({
  current,
  scrubTime,
  setScrubTime,
  isScrubbing,
  setIsScrubbing,
  pending,
  previewBase64,
  format,
  setFormat,
  videos,
  currentIndex,
  outputRoot,
  prefix,
  setPrefix,
  running,
  job,
  totalFrames,
  currentFrames,
  status,
  log,
  onAddVideos,
  onRemoveVideo,
  onSelectVideo,
  onChooseOutput,
  onCaptureFrame,
  onExportVideos,
  onCancelJob,
  onOpenWorkspace
}: ExportTabProps) {
  const duration = current?.duration ?? 0;

  function endScrubbing() {
    setIsScrubbing(false);
  }

  const segmentSummary = current?.segments.length
    ? current.segments
        .map((seg, i) => `seg${String(i + 1).padStart(2, "0")} ${formatClock(seg.start)}-${formatClock(seg.end)}`)
        .join(" · ")
    : "Segments: none";

  return (
    <>
      {/* Left: video stage */}
      <section className="panel">
        <div className="panel-header">
          <span>Video</span>
          <span className="status">
            {current ? `${current.width}x${current.height} | ${formatClock(duration)}` : "No video loaded"}
          </span>
        </div>
        <div className="panel-body video-panel">
          <div className="video-stage" id="videoDropZoneExport">
            {previewBase64 ? (
              <img
                id="backendFramePreviewExport"
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
            max={duration}
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
              <div className="group-title" style={{ margin: 0 }}>Export Segments</div>
            </div>
            <div className="segment-summary">{segmentSummary}</div>
            {current?.segments.map((segment, index) => (
              <div className="train-grid" key={index} style={{ marginTop: 8 }}>
                <label>
                  Start
                  <input
                    type="number"
                    step="0.001"
                    value={segment.start}
                    disabled={running}
                    readOnly
                  />
                </label>
                <label>
                  End
                  <input
                    type="number"
                    step="0.001"
                    value={segment.end}
                    disabled={running}
                    readOnly
                  />
                </label>
                <label>
                  Interval (s)
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={segment.interval}
                    disabled={running}
                    readOnly
                  />
                </label>
                <div className="row" style={{ alignItems: "end" }}>
                  <span className="hint" style={{ margin: 0 }}>{frameCount([segment])} frames</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Right: controls */}
      <aside className="panel">
        <div className="panel-header">
          <span>Export Frames</span>
          <span className="status">{videos.length} videos</span>
        </div>
        <div className="panel-body video-control-stack">
          <div className="row workspace-toolbar">
            <button className="primary" type="button" onClick={onOpenWorkspace} disabled={running}>
              Open Workspace
            </button>
            <button className="primary" type="button" onClick={onAddVideos} disabled={running}>
              Add Video
            </button>
            <button type="button" onClick={onChooseOutput} disabled={running}>
              Output Folder
            </button>
          </div>
          {outputRoot ? <div className="video-time">{outputRoot}</div> : null}
          <div className="video-list">
            {videos.length ? (
              videos.map((video, index) => (
                <div
                  className={`video-list-item${index === currentIndex ? " active" : ""}`}
                  key={video.path}
                >
                  <button
                    type="button"
                    className="video-list-select"
                    onClick={() => onSelectVideo(index)}
                    disabled={running}
                  >
                    {video.name}
                  </button>
                  <button
                    type="button"
                    className="video-list-remove"
                    onClick={() => onRemoveVideo(index)}
                    disabled={running}
                    aria-label={`Remove ${video.name}`}
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <div className="empty">Drop a video file or folder.</div>
            )}
          </div>
          <div className="video-time">
            {formatClock(scrubTime)} / {formatClock(duration)}
          </div>
          <div className="video-time">
            Estimated frames: {currentFrames} current / {totalFrames} all
          </div>
          <button
            className="primary"
            type="button"
            onClick={onCaptureFrame}
            disabled={!current || running}
          >
            Capture Current Frame
          </button>
          <div className="video-inline-grid">
            <label>
              Filename prefix
              <input
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                disabled={running}
                placeholder="video name"
              />
            </label>
            <label>
              Format
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as ImageFormat)}
                disabled={running}
              >
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
            </label>
          </div>
          <div className="hint">
            Export naming: video_seg01_000001_timestamp.jpg. Each video is numbered independently.
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => onExportVideos("current")}
              disabled={!current || running}
            >
              Capture Segments
            </button>
            <button
              type="button"
              onClick={() => onExportVideos("all")}
              disabled={!videos.length || running}
            >
              Export All Videos
            </button>
            <button type="button" onClick={onCancelJob} disabled={!running}>
              Stop
            </button>
          </div>
          <JobStatusPanel
            visible={running || !!job}
            running={running}
            done={job?.saved || 0}
            total={job?.total || totalFrames || 1}
            detail={status}
          />
          <div className="hint">
            Add or drop a video, then capture screenshots. With a workspace open, output defaults to media.
          </div>
          <LogPanel>{log}</LogPanel>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export function VideoCapturePage({ onReady, active = true }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const runWithConfirm = useRunWithConfirm();

  // Shared video state
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Preview state
  const [scrubTime, setScrubTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [previewBase64, setPreviewBase64] = useState("");
  const [pending, setPending] = useState(false);
  const [format, setFormat] = useState<ImageFormat>("jpg");
  const previewRequestIdRef = useRef(0);

  // Workspace / export state
  const [outputRoot, setOutputRoot] = useState("");
  const [prefix, setPrefix] = useState("");
  const [status, setStatus] = useState("Open or drop a video.");
  const [log, setLog] = useState("Ready.");
  const [job, setJob] = useState<CaptureJob | null>(null);

  // Segments tab state
  const [manifest, setManifest] = useState<VideoSegmentManifest | null>(null);
  const [saving, setSaving] = useState(false);

  // Page tab
  const [pageTab, setPageTab] = useState<PageTab>("segments");

  const debouncedScrubTime = useDebouncedValue(scrubTime, isScrubbing ? PREVIEW_DEBOUNCE_MS : 0);

  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);
  const current = currentIndex >= 0 ? videos[currentIndex] : null;
  const running = job?.status === "running";
  const totalFrames = useMemo(() => videos.reduce((sum, v) => sum + frameCount(v.segments), 0), [videos]);
  const currentFrames = useMemo(() => frameCount(current?.segments ?? []), [current]);

  const loadWorkspaceVideos = useCallback(
    async (options: { replace?: boolean; silent?: boolean } = {}) => {
      const root = workspaceRoot.trim();
      if (!root) {
        setVideos([]);
        setCurrentIndex(-1);
        return;
      }
      try {
        const workspaceVideos = (await listWorkspaceVideos(root))
          .filter((item) => item.ok !== false && item.path)
          .map(normalizeVideo);
        setVideos((items) => options.replace ? workspaceVideos : mergeVideoItems(items, workspaceVideos));
        setCurrentIndex((index) => {
          if (options.replace) {
            if (!workspaceVideos.length) return -1;
            return index >= 0 ? Math.min(index, workspaceVideos.length - 1) : 0;
          }
          return index >= 0 ? index : workspaceVideos.length ? 0 : -1;
        });
        if (!options.silent && workspaceVideos.length) {
          setStatus(`Loaded ${workspaceVideos.length} workspace video(s) from media.`);
        }
      } catch (err) {
        if (!options.silent) showError(err);
      }
    },
    [showError, workspaceRoot]
  );

  // Deactivate preview when tab is not active
  useEffect(() => {
    if (active) return;
    setPreviewBase64("");
    setPending(false);
  }, [active]);

  // Load workspace info on mount / workspace change
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
        await loadWorkspaceVideos({ replace: true, silent: true });
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) onReady?.();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workspaceRoot, outputRoot, onReady, showError, loadWorkspaceVideos]);

  useEffect(() => {
    if (!workspaceRoot.trim()) return;
    const onMediaChanged = (event: Event) => {
      if (!isWorkspaceMediaChangedEvent(event)) return;
      if (!isSameWorkspaceRoot(event.detail.workspaceRoot, workspaceRoot)) return;
      void loadWorkspaceVideos({ silent: true });
    };
    window.addEventListener(WORKSPACE_MEDIA_CHANGED_EVENT, onMediaChanged);
    return () => window.removeEventListener(WORKSPACE_MEDIA_CHANGED_EVENT, onMediaChanged);
  }, [loadWorkspaceVideos, workspaceRoot]);

  // Load segment manifest when the selected video changes
  useEffect(() => {
    if (!current?.path || !workspaceRoot.trim()) {
      setManifest(null);
      return;
    }
    let cancelled = false;
    const durationMs = secondsToMs(current.duration);
    loadVideoSegmentManifest(workspaceRoot, current.path, durationMs)
      .then((m) => { if (!cancelled) setManifest(m); })
      .catch((err) => { if (!cancelled) showError(err); });
    return () => { cancelled = true; };
  }, [current?.path, current?.duration, workspaceRoot, showError]);

  // Fetch frame preview
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
        if (!cancelled && requestId === previewRequestIdRef.current) setPreviewBase64(data || "");
      })
      .catch((err) => {
        if (!cancelled && requestId === previewRequestIdRef.current) showError(err);
      })
      .finally(() => {
        if (!cancelled && requestId === previewRequestIdRef.current) setPending(false);
      });
    return () => { cancelled = true; };
  }, [active, current?.path, debouncedScrubTime, format, showError]);

  const updateCaptureJobState = useCallback((next: CaptureJob) => {
    setJob(next);
    setStatus(`${next.status}: ${next.saved || 0}/${next.total || totalFrames}`);
    setLog(JSON.stringify(next, null, 2));
  }, [totalFrames]);

  const notifyCaptureJobTerminal = useCallback((next: CaptureJob) => {
    if (next.status !== "running") showToast(`Video export ${next.status}.`);
  }, [showToast]);

  // Poll running export job
  usePollingJob({
    job,
    pollMs: 500,
    getJob: getCaptureJob,
    onUpdate: updateCaptureJobState,
    onTerminal: notifyCaptureJobTerminal,
    onError: showError
  });

  // ---------------------------------------------------------------------------
  // Video list handlers
  // ---------------------------------------------------------------------------

  function selectVideo(index: number) {
    const video = videos[index];
    if (!video) return;
    setCurrentIndex(index);
    setScrubTime(0);
    setPrefix(fileStem(video.name));
  }

  function removeVideo(index: number) {
    setVideos((items) => {
      const next = items.filter((_, i) => i !== index);
      setCurrentIndex((cur) => {
        if (next.length === 0) return -1;
        if (cur === index) return Math.min(index, next.length - 1);
        if (cur > index) return cur - 1;
        return cur;
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

  // ---------------------------------------------------------------------------
  // Segments tab handlers
  // ---------------------------------------------------------------------------

  function handleAddSegment() {
    if (!current) return;
    const durationMs = secondsToMs(current.duration);
    const startMs = secondsToMs(clamp(scrubTime, 0, current.duration));
    const endMs = secondsToMs(clamp(scrubTime + Math.min(5, current.duration || 5), 0, current.duration));
    const seg = createVideoSegment(current.path, startMs, endMs, durationMs);
    setManifest((prev) => {
      if (!prev) return prev;
      return { ...prev, segments: [...prev.segments, seg], updatedAt: new Date().toISOString() };
    });
  }

  function handleUpdateSegment(
    id: string,
    patch: Partial<Pick<ManifestSegment, "startMs" | "endMs" | "label" | "enabled">>
  ) {
    if (!current) return;
    const durationMs = secondsToMs(current.duration);
    setManifest((prev) => {
      if (!prev) return prev;
      const segments = prev.segments.map((seg) => {
        if (seg.id !== id) return seg;
        const next = { ...seg, ...patch, updatedAt: new Date().toISOString() };
        next.startMs = clamp(next.startMs, 0, durationMs);
        next.endMs = clamp(next.endMs, next.startMs, durationMs);
        return next;
      });
      return { ...prev, segments, updatedAt: new Date().toISOString() };
    });
  }

  function handleRemoveSegment(id: string) {
    setManifest((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        segments: prev.segments.filter((seg) => seg.id !== id),
        updatedAt: new Date().toISOString()
      };
    });
  }

  async function handleSaveSegments() {
    if (!manifest || !workspaceRoot.trim()) return;
    setSaving(true);
    try {
      await saveVideoSegmentManifest(workspaceRoot, manifest);
      showToast("Segments saved.");
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Export tab handlers
  // ---------------------------------------------------------------------------

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
    const total = selectedVideos.reduce((sum, v) => sum + frameCount(v.segments), 0);
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
            jobs: selectedVideos.map((v) => ({ path: v.path, prefix: prefix || fileStem(v.name), segments: v.segments })),
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const videoMeta = current
    ? `${current.width}x${current.height} | ${formatClock(current.duration)}`
    : "No video loaded";

  return (
    <main className="video-workspace">
      {/* Segments tab: single-column layout with preview + manifest */}
      {pageTab === "segments" ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <span>Video Segments</span>
              <span className="status">{videoMeta}</span>
            </div>
            <SegmentsTab
              current={current}
              scrubTime={scrubTime}
              setScrubTime={setScrubTime}
              isScrubbing={isScrubbing}
              setIsScrubbing={setIsScrubbing}
              pending={pending}
              previewBase64={previewBase64}
              format={format}
              manifest={manifest}
              saving={saving}
              onAddSegment={handleAddSegment}
              onUpdateSegment={handleUpdateSegment}
              onRemoveSegment={handleRemoveSegment}
              onSave={() => void handleSaveSegments()}
              onSetCurrentTime={setScrubTime}
            />
          </section>

          <aside className="panel">
            <div className="panel-header">
              <span>Videos</span>
              <span className="status">{videos.length} loaded</span>
            </div>
            <div className="panel-body video-control-stack">
              {/* Tab switcher — inside segments branch so pageTab is always "segments" here */}
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="primary" onClick={() => setPageTab("segments")}>
                  Segments
                </button>
                <button type="button" onClick={() => setPageTab("export")}>
                  Export Frames
                </button>
              </div>

              <div className="row workspace-toolbar" style={{ marginTop: 8 }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => chooseWorkspaceFolder().catch(showError)}
                  disabled={running}
                >
                  Open Workspace
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={() => void addVideos()}
                  disabled={running}
                >
                  Add Video
                </button>
              </div>

              <div className="video-list">
                {videos.length ? (
                  videos.map((video, index) => (
                    <div
                      className={`video-list-item${index === currentIndex ? " active" : ""}`}
                      key={video.path}
                    >
                      <button
                        type="button"
                        className="video-list-select"
                        onClick={() => selectVideo(index)}
                        disabled={running}
                      >
                        {video.name}
                      </button>
                      <button
                        type="button"
                        className="video-list-remove"
                        onClick={() => removeVideo(index)}
                        disabled={running}
                        aria-label={`Remove ${video.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty">Add a video to start defining segments.</div>
                )}
              </div>

              {manifest ? (
                <div className="hint" style={{ marginTop: 4 }}>
                  {manifest.segments.length} segment(s) defined
                  {manifest.updatedAt ? ` · saved ${new Date(manifest.updatedAt).toLocaleString()}` : ""}
                </div>
              ) : null}

              <div className="hint" style={{ marginTop: 8 }}>
                Segments are saved to <code>video_segments/</code> in your workspace and consumed by Video Label for random-frame sampling.
              </div>
            </div>
          </aside>
        </>
      ) : (
        /* Export tab: two-panel layout matching original design */
        <>
          {/* Tab switcher injected as overlay row — reuse aside panel header area */}
          <section className="panel" style={{ display: "contents" }}>
            <ExportTab
              current={current}
              scrubTime={scrubTime}
              setScrubTime={setScrubTime}
              isScrubbing={isScrubbing}
              setIsScrubbing={setIsScrubbing}
              pending={pending}
              previewBase64={previewBase64}
              format={format}
              setFormat={setFormat}
              videos={videos}
              currentIndex={currentIndex}
              outputRoot={outputRoot}
              prefix={prefix}
              setPrefix={setPrefix}
              running={running}
              job={job}
              totalFrames={totalFrames}
              currentFrames={currentFrames}
              status={status}
              log={log}
              onAddVideos={() => void addVideos()}
              onRemoveVideo={removeVideo}
              onSelectVideo={selectVideo}
              onChooseOutput={() => void chooseOutput()}
              onCaptureFrame={() => void captureCurrentFrame()}
              onExportVideos={(scope) => void exportVideos(scope)}
              onCancelJob={() => void cancelJob()}
              onOpenWorkspace={() => chooseWorkspaceFolder().catch(showError)}
            />
          </section>
          {/* Tab switcher floating in the sidebar */}
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              display: "flex",
              gap: 4,
              zIndex: 10
            }}
          >
            <button type="button" onClick={() => setPageTab("segments")}>
              Segments
            </button>
            <button type="button" className="primary" onClick={() => setPageTab("export")}>
              Export Frames
            </button>
          </div>
        </>
      )}
    </main>
  );
}
