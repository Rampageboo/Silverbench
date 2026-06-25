import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLabelClasses, type LabelBox, type LabelClass } from "../../api";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { VideoAnnotationCanvas } from "./VideoAnnotationCanvas";
import {
  chooseAnnotationVideos,
  getAnnotationFrameBase64,
  loadVideoAnnotationManifest,
  saveVideoAnnotationManifest,
  timestampKey,
  type VideoAnnotationManifest,
  type VideoSource
} from "./videoAnnotationApi";
import "./VideoLabelPage.css";

type Props = {
  onReady?: () => void;
  active?: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeTime(value: number, duration: number) {
  const max = duration > 0 ? Math.max(0, duration - 0.001) : 0;
  return Math.round(clamp(value, 0, max) * 1000) / 1000;
}

function formatClock(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(value);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const millis = Math.round((value - whole) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function defaultClasses(): LabelClass[] {
  return [{ id: 0, name: "object" }];
}

export function VideoLabelPage({ onReady, active = true }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const [videos, setVideos] = useState<VideoSource[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [time, setTime] = useState(0);
  const [stepSeconds, setStepSeconds] = useState(0.1);
  const [previewBase64, setPreviewBase64] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifest, setManifest] = useState<VideoAnnotationManifest | null>(null);
  const [classes, setClasses] = useState<LabelClass[]>(defaultClasses);
  const [currentClass, setCurrentClass] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [status, setStatus] = useState("Open a workspace, then add a video.");
  const previewRequestRef = useRef(0);
  const manifestRequestRef = useRef(0);
  const manifestRef = useRef<VideoAnnotationManifest | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);

  const current = currentIndex >= 0 ? videos[currentIndex] || null : null;
  const maxTime = current?.duration ? Math.max(0, current.duration - 0.001) : 0;
  const currentKey = timestampKey(time);
  const currentFrame = manifest?.frames[currentKey] || null;
  const boxes = currentFrame?.boxes || [];
  const reviewed = Boolean(currentFrame?.reviewed);

  const showError = useCallback(
    (error: unknown) => {
      const message = errMessage(error);
      setStatus(message);
      showToast(message, { variant: "error" });
    },
    [showToast]
  );

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (active) return;
    previewRequestRef.current += 1;
    setPreviewBase64("");
    setPreviewLoading(false);
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceRoot.trim()) {
      setClasses(defaultClasses());
      setCurrentClass(0);
      return;
    }
    loadLabelClasses(workspaceRoot)
      .then((items) => {
        if (cancelled) return;
        const next = items.length ? items : defaultClasses();
        setClasses(next);
        setCurrentClass((value) => (next.some((item) => item.id === value) ? value : next[0].id));
      })
      .catch((error) => {
        if (!cancelled) showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [showError, workspaceRoot]);

  useEffect(() => {
    const requestId = ++manifestRequestRef.current;
    manifestRef.current = null;
    setManifest(null);
    setSelectedIndex(null);
    setSaveState("idle");
    setTime(0);
    if (!workspaceRoot.trim() || !current) return;
    setManifestLoading(true);
    loadVideoAnnotationManifest(workspaceRoot, current)
      .then((next) => {
        if (requestId !== manifestRequestRef.current) return;
        manifestRef.current = next;
        setManifest(next);
        const reviewedTimes = Object.values(next.frames)
          .filter((frame) => frame.reviewed)
          .map((frame) => frame.time)
          .sort((a, b) => a - b);
        const initialTime = reviewedTimes[0] ?? 0;
        setTime(normalizeTime(initialTime, current.duration));
        setStatus(`Loaded ${Object.keys(next.frames).length} reviewed frame(s) for ${current.name}.`);
      })
      .catch((error) => {
        if (requestId === manifestRequestRef.current) showError(error);
      })
      .finally(() => {
        if (requestId === manifestRequestRef.current) setManifestLoading(false);
      });
  }, [current, showError, workspaceRoot]);

  useEffect(() => {
    if (!active || !current) {
      setPreviewBase64("");
      return;
    }
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    getAnnotationFrameBase64(current.path, time)
      .then((data) => {
        if (requestId === previewRequestRef.current) setPreviewBase64(data || "");
      })
      .catch((error) => {
        if (requestId === previewRequestRef.current) showError(error);
      })
      .finally(() => {
        if (requestId === previewRequestRef.current) setPreviewLoading(false);
      });
  }, [active, current, showError, time]);

  const enqueueSave = useCallback(
    (next: VideoAnnotationManifest) => {
      if (!workspaceRoot.trim()) return;
      const revision = ++saveRevisionRef.current;
      setSaveState("saving");
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await saveVideoAnnotationManifest(workspaceRoot, next);
          if (revision === saveRevisionRef.current) setSaveState("saved");
        })
        .catch((error) => {
          if (revision === saveRevisionRef.current) setSaveState("error");
          showError(error);
        });
    },
    [showError, workspaceRoot]
  );

  const updateCurrentFrame = useCallback(
    (nextBoxes: LabelBox[], nextReviewed = true) => {
      const source = manifestRef.current;
      if (!source || !current) return;
      const timestampMs = Number(timestampKey(time));
      const frames = { ...source.frames };
      if (!nextReviewed && nextBoxes.length === 0) {
        delete frames[String(timestampMs)];
      } else {
        frames[String(timestampMs)] = {
          timestampMs,
          time: timestampMs / 1000,
          boxes: nextBoxes,
          reviewed: nextReviewed || nextBoxes.length > 0,
          updatedAt: new Date().toISOString()
        };
      }
      const next: VideoAnnotationManifest = {
        ...source,
        video: current,
        updatedAt: new Date().toISOString(),
        frames
      };
      manifestRef.current = next;
      setManifest(next);
      enqueueSave(next);
    },
    [current, enqueueSave, time]
  );

  const gotoTime = useCallback(
    (nextTime: number) => {
      if (!current) return;
      setSelectedIndex(null);
      setTime(normalizeTime(nextTime, current.duration));
    },
    [current]
  );

  useEffect(() => {
    if (!active || !current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        gotoTime(time - stepSeconds);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        gotoTime(time + stepSeconds);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, current, gotoTime, stepSeconds, time]);

  const annotatedFrames = useMemo(
    () =>
      Object.values(manifest?.frames || {})
        .filter((frame) => frame.boxes.length > 0)
        .sort((a, b) => a.timestampMs - b.timestampMs),
    [manifest]
  );
  const reviewedFrames = useMemo(
    () =>
      Object.values(manifest?.frames || {})
        .filter((frame) => frame.reviewed)
        .sort((a, b) => a.timestampMs - b.timestampMs),
    [manifest]
  );

  async function addVideos() {
    if (!workspaceRoot.trim()) {
      showToast("Open a workspace before adding videos so annotations have a project location.", { variant: "error" });
      return;
    }
    try {
      const selected = await chooseAnnotationVideos();
      if (!selected.length) return;
      setVideos((items) => {
        const known = new Set(items.map((item) => item.path));
        return [...items, ...selected.filter((item) => !known.has(item.path))];
      });
      setCurrentIndex((index) => (index >= 0 ? index : 0));
      setStatus(`Added ${selected.length} video(s). Frames are decoded on demand; no screenshots are written.`);
    } catch (error) {
      showError(error);
    }
  }

  function removeVideo(index: number) {
    setVideos((items) => {
      const next = items.filter((_, itemIndex) => itemIndex !== index);
      setCurrentIndex((currentValue) => {
        if (!next.length) return -1;
        if (currentValue === index) return Math.min(index, next.length - 1);
        return currentValue > index ? currentValue - 1 : currentValue;
      });
      return next;
    });
  }

  function assignClass(classId: number) {
    setCurrentClass(classId);
    if (selectedIndex === null || !boxes[selectedIndex]) return;
    updateCurrentFrame(boxes.map((box, index) => (index === selectedIndex ? { ...box, classId } : box)), true);
  }

  function copyPreviousBoxes() {
    const previous = [...annotatedFrames].reverse().find((frame) => frame.timestampMs < Number(currentKey));
    if (!previous) {
      showToast("No earlier annotated frame has boxes.", { variant: "error" });
      return;
    }
    setSelectedIndex(null);
    updateCurrentFrame(previous.boxes.map((box) => ({ ...box })), true);
    setStatus(`Copied ${previous.boxes.length} box(es) from ${formatClock(previous.time)}.`);
  }

  function gotoAnnotated(direction: -1 | 1) {
    const currentMs = Number(currentKey);
    const candidate =
      direction < 0
        ? [...reviewedFrames].reverse().find((frame) => frame.timestampMs < currentMs)
        : reviewedFrames.find((frame) => frame.timestampMs > currentMs);
    if (candidate) gotoTime(candidate.time);
  }

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Not edited";
  const videoMeta = current
    ? `${current.width}×${current.height} · ${formatClock(current.duration)}`
    : "No video loaded";

  return (
    <main className="video-label-workspace">
      <section className="panel video-label-main-panel">
        <div className="panel-header">
          <span>Video Label</span>
          <span className="status">{videoMeta}</span>
        </div>
        <div className="panel-body video-label-main-body">
          <div className="row workspace-toolbar">
            <button className="primary" type="button" onClick={() => chooseWorkspaceFolder().catch(showError)}>
              Open Workspace
            </button>
            <button className="primary" type="button" onClick={() => void addVideos()} disabled={!workspaceRoot.trim()}>
              Add Video
            </button>
            <span className="status">{saveLabel}</span>
          </div>

          <div className="video-label-stage">
            {current && previewBase64 ? (
              <VideoAnnotationCanvas
                imageBase64={previewBase64}
                boxes={boxes}
                classes={classes}
                currentClass={currentClass}
                selectedIndex={selectedIndex}
                disabled={previewLoading || manifestLoading}
                onChange={(next) => updateCurrentFrame(next, true)}
                onSelectedIndexChange={setSelectedIndex}
              />
            ) : (
              <div className="empty video-label-empty">
                {previewLoading || manifestLoading ? "Loading video frame…" : "Add a video to begin direct frame annotation."}
              </div>
            )}
          </div>

          <div className="video-label-timeline">
            <input
              type="range"
              min="0"
              max={maxTime}
              step="0.001"
              value={Math.min(time, maxTime)}
              disabled={!current}
              onChange={(event) => gotoTime(Number(event.target.value))}
              aria-label="Video timestamp"
            />
            <div className="row video-label-time-row">
              <button type="button" onClick={() => gotoTime(time - stepSeconds)} disabled={!current}>Previous</button>
              <button type="button" onClick={() => gotoTime(time + stepSeconds)} disabled={!current}>Next</button>
              <label>
                Time (s)
                <input type="number" min="0" max={maxTime} step="0.001" value={time} onChange={(event) => gotoTime(Number(event.target.value))} disabled={!current} />
              </label>
              <label>
                Step (s)
                <input type="number" min="0.001" step="0.001" value={stepSeconds} onChange={(event) => setStepSeconds(Math.max(0.001, Number(event.target.value) || 0.1))} />
              </label>
              <span className="video-label-clock">{formatClock(time)} / {formatClock(current?.duration || 0)}</span>
            </div>
          </div>
        </div>
      </section>

      <aside className="side-stack video-label-side-stack">
        <section className="panel">
          <div className="panel-header">
            <span>Videos</span>
            <span className="status">{videos.length}</span>
          </div>
          <div className="panel-body">
            <div className="video-list">
              {videos.length ? videos.map((video, index) => (
                <div className={`video-list-item${index === currentIndex ? " active" : ""}`} key={video.path}>
                  <button type="button" className="video-list-select" onClick={() => setCurrentIndex(index)}>
                    {video.name}
                  </button>
                  <button type="button" className="video-list-remove" onClick={() => removeVideo(index)} aria-label={`Remove ${video.name}`}>
                    Remove
                  </button>
                </div>
              )) : <div className="empty">No videos added.</div>}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <span>Current Frame</span>
            <span className="status">{boxes.length} box(es)</span>
          </div>
          <div className="panel-body video-label-action-stack">
            <div className="row">
              <button type="button" onClick={() => gotoAnnotated(-1)} disabled={!reviewedFrames.length}>Previous Reviewed</button>
              <button type="button" onClick={() => gotoAnnotated(1)} disabled={!reviewedFrames.length}>Next Reviewed</button>
            </div>
            <button type="button" onClick={copyPreviousBoxes} disabled={!annotatedFrames.length || !current}>Copy Previous Boxes</button>
            <button type="button" onClick={() => updateCurrentFrame([], true)} disabled={!current}>Mark Empty / Reviewed</button>
            <button type="button" className="danger" onClick={() => updateCurrentFrame([], false)} disabled={!currentFrame}>Clear Frame Record</button>
            <div className="video-label-stats">
              <span>{reviewedFrames.length} reviewed timestamp(s)</span>
              <span>{annotatedFrames.length} with boxes</span>
              <span>Current: {reviewed ? "reviewed" : "not reviewed"}</span>
            </div>
          </div>
        </section>

        <section className="panel video-label-class-panel">
          <div className="panel-header">
            <span>Classes</span>
            <span className="status">{currentClass}</span>
          </div>
          <div className="panel-body">
            <div className="video-label-class-list">
              {classes.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === currentClass ? "selected" : ""}
                  onClick={() => assignClass(item.id)}
                >
                  {item.id}: {item.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-body">
            <div className="hint">{status}</div>
            <div className="hint">Only timestamp/box metadata is stored under workspace/video_annotations. Preview frames remain in memory and are never added to image_pool.</div>
            <div className="hint">Image-based annotation remains available in Box Label.</div>
          </div>
        </section>
      </aside>
    </main>
  );
}
