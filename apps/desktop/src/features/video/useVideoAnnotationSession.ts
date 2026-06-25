import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLabelClasses, type LabelBox, type LabelClass } from "../../api";
import { useToast } from "../../components/useToast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { errMessage } from "../../lib/errors";
import { recordWorkspaceEventBestEffort, recordWorkspaceOperation } from "../../workbench/auditLog";
import { useWorkspaceArchitecture } from "../../workspace/WorkspaceArchitectureProvider";
import {
  chooseAnnotationVideos,
  DEFAULT_VIDEO_ANNOTATIONS_ROOT,
  getAnnotationFrameBase64,
  loadVideoAnnotationManifest,
  saveVideoAnnotationManifest,
  timestampKey,
  type VideoAnnotationManifest,
  type VideoSource
} from "./videoAnnotationApi";
import {
  adjacentReviewedFrame,
  clampVideoTime,
  cloneBoxes,
  frameAnnotationAt,
  sortedVideoFrames,
  updateVideoFrameAnnotation
} from "./videoAnnotationDomain";

type SaveState = "idle" | "saving" | "saved" | "error";

function defaultClasses(): LabelClass[] {
  return [{ id: 0, name: "object" }];
}

export function useVideoAnnotationSession({
  workspaceRoot,
  active,
  onReady
}: {
  workspaceRoot: string;
  active: boolean;
  onReady?: () => void;
}) {
  const { showToast } = useToast();
  const { manifest: workspaceManifest } = useWorkspaceArchitecture();
  const annotationsRoot = String(
    workspaceManifest?.paths.video_annotations || DEFAULT_VIDEO_ANNOTATIONS_ROOT
  );
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
  const currentRef = useRef<VideoSource | null>(null);
  const timeRef = useRef(0);
  const debouncedPreviewTime = useDebouncedValue(time, 120);

  const current = currentIndex >= 0 ? videos[currentIndex] || null : null;
  currentRef.current = current;
  timeRef.current = time;
  const maxTime = current?.duration ? Math.max(0, current.duration - 0.001) : 0;
  const currentKey = timestampKey(time);
  const currentFrame = frameAnnotationAt(manifest, time);
  const boxes = currentFrame?.boxes || [];
  const reviewed = Boolean(currentFrame?.reviewed);

  const showError = useCallback(
    (reason: unknown, action = "unknown") => {
      const message = errMessage(reason);
      setStatus(message);
      showToast(message, { variant: "error" });
      const activeVideo = currentRef.current;
      const activeTime = timeRef.current;
      recordWorkspaceEventBestEffort(workspaceRoot, {
        tool: "video-label",
        action: `${action}.failed`,
        level: "error",
        message,
        details: activeVideo ? { videoPath: activeVideo.path, time: activeTime } : { time: activeTime }
      });
    },
    [showToast, workspaceRoot]
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
      .catch((reason) => {
        if (!cancelled) showError(reason, "classes.load");
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
    if (!workspaceRoot.trim() || !current) {
      setManifestLoading(false);
      return;
    }
    setManifestLoading(true);
    loadVideoAnnotationManifest(workspaceRoot, current, annotationsRoot)
      .then((next) => {
        if (requestId !== manifestRequestRef.current) return;
        manifestRef.current = next;
        setManifest(next);
        const reviewedTimes = Object.values(next.frames)
          .filter((frame) => frame.reviewed)
          .map((frame) => frame.time)
          .sort((a, b) => a - b);
        const initialTime = reviewedTimes[0] ?? 0;
        setTime(clampVideoTime(initialTime, current.duration));
        setStatus(`Loaded ${Object.keys(next.frames).length} reviewed frame(s) for ${current.name}.`);
        recordWorkspaceEventBestEffort(workspaceRoot, {
          tool: "video-label",
          action: "annotation.opened",
          details: {
            videoPath: current.path,
            annotationRoot: annotationsRoot,
            reviewedFrames: Object.keys(next.frames).length
          }
        });
      })
      .catch((reason) => {
        if (requestId === manifestRequestRef.current) showError(reason, "annotation.load");
      })
      .finally(() => {
        if (requestId === manifestRequestRef.current) setManifestLoading(false);
      });
  }, [annotationsRoot, current, showError, workspaceRoot]);

  useEffect(() => {
    if (!active || !current) {
      setPreviewBase64("");
      setPreviewLoading(false);
      return;
    }
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    getAnnotationFrameBase64(current.path, debouncedPreviewTime)
      .then((data) => {
        if (requestId === previewRequestRef.current) setPreviewBase64(data || "");
      })
      .catch((reason) => {
        if (requestId === previewRequestRef.current) showError(reason, "preview.load");
      })
      .finally(() => {
        if (requestId === previewRequestRef.current) setPreviewLoading(false);
      });
  }, [active, current, debouncedPreviewTime, showError]);

  const enqueueSave = useCallback(
    (next: VideoAnnotationManifest) => {
      if (!workspaceRoot.trim()) return;
      const revision = ++saveRevisionRef.current;
      setSaveState("saving");
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await saveVideoAnnotationManifest(workspaceRoot, next, annotationsRoot);
          if (revision === saveRevisionRef.current) setSaveState("saved");
        })
        .catch((reason) => {
          if (revision === saveRevisionRef.current) setSaveState("error");
          showError(reason, "annotation.save");
        });
    },
    [annotationsRoot, showError, workspaceRoot]
  );

  const updateCurrentFrame = useCallback(
    (nextBoxes: LabelBox[], nextReviewed = true) => {
      const source = manifestRef.current;
      if (!source || !current) return;
      const next = updateVideoFrameAnnotation(source, current, time, nextBoxes, nextReviewed);
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
      setTime(clampVideoTime(nextTime, current.duration));
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
    () => sortedVideoFrames(manifest, (frame) => frame.boxes.length > 0),
    [manifest]
  );
  const reviewedFrames = useMemo(
    () => sortedVideoFrames(manifest, (frame) => frame.reviewed),
    [manifest]
  );

  const addVideos = useCallback(async () => {
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
      recordWorkspaceEventBestEffort(workspaceRoot, {
        tool: "video-label",
        action: "video.added",
        details: { count: selected.length, paths: selected.map((video) => video.path) }
      });
    } catch (reason) {
      showError(reason, "video.add");
    }
  }, [showError, showToast, workspaceRoot]);

  const removeVideo = useCallback((index: number) => {
    setVideos((items) => {
      const next = items.filter((_, itemIndex) => itemIndex !== index);
      setCurrentIndex((currentValue) => {
        if (!next.length) return -1;
        if (currentValue === index) return Math.min(index, next.length - 1);
        return currentValue > index ? currentValue - 1 : currentValue;
      });
      return next;
    });
  }, []);

  const assignClass = useCallback(
    (classId: number) => {
      setCurrentClass(classId);
      if (selectedIndex === null || !boxes[selectedIndex]) return;
      updateCurrentFrame(
        boxes.map((box, index) => (index === selectedIndex ? { ...box, classId } : box)),
        true
      );
    },
    [boxes, selectedIndex, updateCurrentFrame]
  );

  const copyPreviousBoxes = useCallback(() => {
    const previous = [...annotatedFrames].reverse().find((frame) => frame.timestampMs < Number(currentKey));
    if (!previous || !current) {
      showToast("No earlier annotated frame has boxes.", { variant: "error" });
      return;
    }
    setSelectedIndex(null);
    updateCurrentFrame(cloneBoxes(previous.boxes), true);
    setStatus(`Copied ${previous.boxes.length} box(es) from the previous annotated timestamp.`);
    void recordWorkspaceOperation(workspaceRoot, {
      tool: "video-label",
      action: "copy-previous-boxes",
      status: "done",
      inputs: { videoPath: current.path, fromTimestampMs: previous.timestampMs, toTimestampMs: Number(currentKey) },
      summary: { boxCount: previous.boxes.length }
    }).catch(() => {});
  }, [annotatedFrames, current, currentKey, showToast, updateCurrentFrame, workspaceRoot]);

  const gotoReviewed = useCallback(
    (direction: -1 | 1) => {
      const candidate = adjacentReviewedFrame(reviewedFrames, Number(currentKey), direction);
      if (candidate) gotoTime(candidate.time);
    },
    [currentKey, gotoTime, reviewedFrames]
  );

  const markEmptyReviewed = useCallback(() => {
    if (!current) return;
    updateCurrentFrame([], true);
    void recordWorkspaceOperation(workspaceRoot, {
      tool: "video-label",
      action: "mark-empty-reviewed",
      status: "done",
      inputs: { videoPath: current.path, timestampMs: Number(currentKey) },
      summary: { boxCount: 0 }
    }).catch(() => {});
  }, [current, currentKey, updateCurrentFrame, workspaceRoot]);

  const clearFrameRecord = useCallback(() => {
    if (!currentFrame || !current) return;
    updateCurrentFrame([], false);
    setSelectedIndex(null);
    void recordWorkspaceOperation(workspaceRoot, {
      tool: "video-label",
      action: "clear-frame-record",
      status: "done",
      inputs: { videoPath: current.path, timestampMs: Number(currentKey) },
      summary: { removedBoxCount: currentFrame.boxes.length }
    }).catch(() => {});
  }, [current, currentFrame, currentKey, updateCurrentFrame, workspaceRoot]);

  return {
    annotationsRoot,
    videos,
    currentIndex,
    setCurrentIndex,
    current,
    removeVideo,
    addVideos,
    time,
    maxTime,
    gotoTime,
    stepSeconds,
    setStepSeconds,
    previewBase64,
    previewLoading,
    manifestLoading,
    manifest,
    currentFrame,
    boxes,
    reviewed,
    classes,
    currentClass,
    assignClass,
    selectedIndex,
    setSelectedIndex,
    saveState,
    status,
    annotatedFrames,
    reviewedFrames,
    updateCurrentFrame,
    copyPreviousBoxes,
    gotoReviewed,
    markEmptyReviewed,
    clearFrameRecord,
    showError
  };
}
