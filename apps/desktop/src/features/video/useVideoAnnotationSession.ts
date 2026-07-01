import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLabelClasses, type LabelBox, type LabelClass } from "../../api";
import { useToast } from "../../components/useToast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { errMessage } from "../../lib/errors";
import { recordWorkspaceEventBestEffort, recordWorkspaceOperation } from "../../workbench/auditLog";
import { useWorkspaceArchitecture } from "../../workspace/WorkspaceArchitectureProvider";
import { WORKSPACE_MEDIA_CHANGED_EVENT, isSameWorkspaceRoot, isWorkspaceMediaChangedEvent } from "../shared/mediaEvents";
import { useArchivedClassIds } from "../workspace/useArchivedClassIds";
import {
  classificationClassDisplayName,
  classificationOptionsForNewAnnotations,
  isClassificationClassArchived
} from "../workspace/workspaceClassTaxonomy";
import {
  chooseAnnotationVideos,
  DEFAULT_VIDEO_ANNOTATIONS_ROOT,
  getAnnotationFrameBase64,
  getAnnotationFrameUrl,
  loadVideoAnnotationManifest,
  prefetchAnnotationFrame,
  saveVideoAnnotationManifest,
  timestampKey,
  type VideoAnnotationManifest,
  type VideoClfTask,
  type VideoSource,
  type VideoTimestampSource
} from "./videoAnnotationApi";
import { listWorkspaceVideos } from "./videoCaptureApi";
import {
  adjacentReviewedFrame,
  clampVideoTime,
  cloneDetectBoxes,
  clearVideoFrameRecord,
  detectBoxesToLabelBoxes,
  frameAnnotationAt,
  formatVideoClock,
  getClfTask,
  getDetectTask,
  labelBoxToDetectBox,
  markVideoDetectEmpty,
  markVideoTimestamp,
  markVideoClfReviewed,
  moveVideoFrameRecord,
  clearVideoClfLabel,
  setVideoClfClass,
  setVideoClfEnabled,
  setVideoClfReviewed,
  setVideoDetectEnabled,
  sortedVideoFrames,
  updateVideoDetectBoxes,
  videoTimelineMarkers
} from "./videoAnnotationDomain";

type SaveState = "idle" | "saving" | "saved" | "error";

function defaultClasses(): LabelClass[] {
  return [{ id: 0, name: "object" }];
}

function mergeVideoSources(existing: VideoSource[], incoming: VideoSource[]) {
  const known = new Set(existing.map((item) => item.path));
  const added = incoming.filter((item) => item.path && !known.has(item.path));
  return added.length ? [...existing, ...added] : existing;
}

export function useVideoAnnotationSession({
  workspaceRoot,
  active,
  onReady,
  previewMode = "base64",
  loadMarkerBase64 = true,
  handleArrowKeys = true
}: {
  workspaceRoot: string;
  active: boolean;
  onReady?: () => void;
  previewMode?: "base64" | "url";
  loadMarkerBase64?: boolean;
  handleArrowKeys?: boolean;
}) {
  const { showToast } = useToast();
  const { manifest: workspaceManifest } = useWorkspaceArchitecture();
  const {
    manifest: classManifest,
    archivedDetectIds,
    archivedClassKeys
  } = useArchivedClassIds(workspaceRoot);
  const annotationsRoot = String(
    workspaceManifest?.paths.video_annotations || DEFAULT_VIDEO_ANNOTATIONS_ROOT
  );
  const [videos, setVideos] = useState<VideoSource[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [time, setTime] = useState(0);
  const [stepSeconds, setStepSeconds] = useState(0.1);
  const [previewBase64, setPreviewBase64] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifest, setManifest] = useState<VideoAnnotationManifest | null>(null);
  const [classes, setClasses] = useState<LabelClass[]>(defaultClasses);
  const [currentClass, setCurrentClass] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [status, setStatus] = useState("Open a workspace, then add a video.");
  const previewRequestRef = useRef(0);
  const autoLabelFrameRequestRef = useRef(0);
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
  const activeDetectClasses = useMemo(
    () => classes.filter((item) => !archivedDetectIds.has(item.id)),
    [archivedDetectIds, classes]
  );
  const clfClassOptions = useMemo(
    () =>
      classManifest
        ? classificationOptionsForNewAnnotations(classManifest).map((def) => ({
            key: def.key,
            name: def.name
          }))
        : [],
    [classManifest]
  );

  // Detect task derived state
  const detectTask = getDetectTask(currentFrame);
  const boxes: LabelBox[] = useMemo(
    () => detectBoxesToLabelBoxes(detectTask?.boxes ?? []),
    [detectTask?.boxes]
  );
  const reviewed = Boolean(detectTask?.reviewed);
  const detectExportEnabled = detectTask?.enabled !== false;

  // Clf task derived state
  const clfTask: VideoClfTask | undefined = getClfTask(currentFrame) ?? undefined;
  const clfExportEnabled = clfTask?.enabled !== false;

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
    setVideosLoaded(false);
  }, [workspaceRoot]);

  useEffect(() => {
    if (active) return;
    previewRequestRef.current += 1;
    autoLabelFrameRequestRef.current += 1;
    setPreviewBase64("");
    setPreviewUrl("");
    setPreviewLoading(false);
  }, [active]);

  const loadWorkspaceVideos = useCallback(
    async (options: { replace?: boolean; silent?: boolean } = {}) => {
      const root = workspaceRoot.trim();
      if (!root) {
        setVideos([]);
        setCurrentIndex(-1);
        setVideosLoaded(true);
        return;
      }
      if (options.replace) {
        setVideosLoaded(false);
      }
      try {
        const workspaceVideos = (await listWorkspaceVideos(root))
          .filter((item) => item.ok !== false && item.path)
          .map((item) => ({
            ok: item.ok,
            path: String(item.path || ""),
            name: String(item.name || "video"),
            duration: Math.max(0, Number(item.duration) || 0),
            width: Math.max(0, Math.trunc(Number(item.width) || 0)),
            height: Math.max(0, Math.trunc(Number(item.height) || 0))
          }));
        setVideos((items) => options.replace ? workspaceVideos : mergeVideoSources(items, workspaceVideos));
        setCurrentIndex((index) => {
          if (options.replace) {
            if (!workspaceVideos.length) return -1;
            return index >= 0 ? Math.min(index, workspaceVideos.length - 1) : 0;
          }
          if (index >= 0) return index;
          return workspaceVideos.length ? 0 : -1;
        });
        if (!options.silent && workspaceVideos.length) {
          setStatus(`Loaded ${workspaceVideos.length} workspace video(s) from media.`);
        }
      } catch (reason) {
        if (!options.silent) showError(reason, "videos.workspace.load");
      } finally {
        if (options.replace) {
          setVideosLoaded(true);
        }
      }
    },
    [showError, workspaceRoot]
  );

  useEffect(() => {
    void loadWorkspaceVideos({ replace: true, silent: true });
  }, [loadWorkspaceVideos]);

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
        setCurrentClass((value) => {
          const active = next.filter((item) => !archivedDetectIds.has(item.id));
          if (active.some((item) => item.id === value)) return value;
          return active[0]?.id ?? next[0].id;
        });
      })
      .catch((reason) => {
        if (!cancelled) showError(reason, "classes.load");
      });
    return () => {
      cancelled = true;
    };
  }, [archivedDetectIds, showError, workspaceRoot]);

  useEffect(() => {
    if (classes.some((item) => item.id === currentClass && !archivedDetectIds.has(item.id))) return;
    const next = classes.find((item) => !archivedDetectIds.has(item.id));
    if (next) setCurrentClass(next.id);
  }, [archivedDetectIds, classes, currentClass]);

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
          .filter((frame) => frame.tasks.detect?.reviewed)
          .map((frame) => frame.time)
          .sort((a, b) => a - b);
        const initialTime = reviewedTimes[0] ?? 0;
        setTime(clampVideoTime(initialTime, current.duration));
        setStatus(`Loaded ${Object.keys(next.frames).length} annotated frame(s) for ${current.name}.`);
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
      setPreviewUrl("");
      setPreviewLoading(false);
      return;
    }
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    if (previewMode === "url" && workspaceRoot.trim()) {
      const fastUrl = getAnnotationFrameUrl(workspaceRoot, current.path, debouncedPreviewTime, { fast: true });
      const fullUrl = getAnnotationFrameUrl(workspaceRoot, current.path, debouncedPreviewTime);
      setPreviewUrl(fastUrl);
      setPreviewBase64("");
      const image = new Image();
      image.onload = () => {
        if (requestId !== previewRequestRef.current) return;
        setPreviewUrl(fullUrl);
        setPreviewLoading(false);
      };
      image.onerror = () => {
        if (requestId === previewRequestRef.current) setPreviewLoading(false);
      };
      image.src = fullUrl;
      return () => {
        image.onload = null;
        image.onerror = null;
      };
    }
    setPreviewUrl("");
    // Preview decode: frame is decoded in memory only; no file is written.
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
  }, [active, current, debouncedPreviewTime, previewMode, showError, workspaceRoot]);

  useEffect(() => {
    if (!loadMarkerBase64) return;
    if (previewMode !== "url") return;
    if (!active || !current || !currentFrame) {
      autoLabelFrameRequestRef.current += 1;
      setPreviewBase64("");
      return;
    }
    const requestId = ++autoLabelFrameRequestRef.current;
    getAnnotationFrameBase64(current.path, currentFrame.time)
      .then((data) => {
        if (requestId === autoLabelFrameRequestRef.current) setPreviewBase64(data || "");
      })
      .catch((reason) => {
        if (requestId === autoLabelFrameRequestRef.current) showError(reason, "preview.marker.load");
      });
  }, [active, current, currentFrame, loadMarkerBase64, previewMode, showError]);

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

  // Update detect boxes on the current timestamp (canvas onChange handler).
  // Does NOT touch the clf task.
  const updateCurrentFrame = useCallback(
    (nextBoxes: LabelBox[], nextReviewed = true) => {
      const source = manifestRef.current;
      if (!source || !current) return;
      const detectBoxes = nextBoxes.map(labelBoxToDetectBox);
      const next = updateVideoDetectBoxes(source, current, time, detectBoxes, nextReviewed);
      manifestRef.current = next;
      setManifest(next);
      enqueueSave(next);
    },
    [current, enqueueSave, time]
  );

  const loadBoxesAtTime = useCallback((seconds: number): LabelBox[] => {
    const frame = frameAnnotationAt(manifestRef.current, seconds);
    return detectBoxesToLabelBoxes(getDetectTask(frame)?.boxes ?? []);
  }, []);

  const updateFrameAtTime = useCallback(
    (seconds: number, nextBoxes: LabelBox[], nextReviewed = true): LabelBox[] => {
      const source = manifestRef.current;
      if (!source || !current) return nextBoxes;
      const detectBoxes = nextBoxes.map(labelBoxToDetectBox);
      const next = updateVideoDetectBoxes(source, current, seconds, detectBoxes, nextReviewed);
      manifestRef.current = next;
      setManifest(next);
      enqueueSave(next);
      return nextBoxes.map((box) => ({ ...box }));
    },
    [current, enqueueSave]
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
    if (!active || !current || !handleArrowKeys) return;
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
  }, [active, current, gotoTime, handleArrowKeys, stepSeconds, time]);

  // Annotated = has detect boxes; reviewed = detect task reviewed
  const annotatedFrames = useMemo(
    () => sortedVideoFrames(manifest, (frame) => (frame.tasks.detect?.boxes.length ?? 0) > 0),
    [manifest]
  );
  const reviewedFrames = useMemo(
    () => sortedVideoFrames(manifest, (frame) => Boolean(frame.tasks.detect?.reviewed)),
    [manifest]
  );
  const timelineMarkers = useMemo(
    () => videoTimelineMarkers(manifest),
    [manifest]
  );

  useEffect(() => {
    if (previewMode !== "url" || !active || !current || !workspaceRoot.trim() || !timelineMarkers.length) return;
    const timeout = window.setTimeout(() => {
      const currentMs = Number(currentKey);
      const sorted = timelineMarkers
        .map((marker) => ({ ms: Number(marker.key), time: marker.time }))
        .filter((marker) => Number.isFinite(marker.ms) && Number.isFinite(marker.time))
        .sort((a, b) => a.ms - b.ms);
      const nextIndex = sorted.findIndex((marker) => marker.ms >= currentMs);
      const candidateIndexes = new Set<number>([
        Math.max(0, nextIndex < 0 ? sorted.length - 1 : nextIndex - 1),
        Math.max(0, nextIndex < 0 ? sorted.length - 1 : nextIndex),
        Math.min(sorted.length - 1, nextIndex < 0 ? sorted.length - 1 : nextIndex + 1)
      ]);
      for (const index of candidateIndexes) {
        const marker = sorted[index];
        if (!marker) continue;
        void prefetchAnnotationFrame(workspaceRoot, current.path, marker.time).catch(() => {});
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [active, current, currentKey, previewMode, timelineMarkers, workspaceRoot]);

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
      if (archivedDetectIds.has(classId)) {
        setStatus("Class is archived. Restore it in Library before using it for new video boxes.");
        showToast("Class is archived. Restore it in Library before using it for new video boxes.", { variant: "error" });
        return;
      }
      setCurrentClass(classId);
      if (selectedIndex === null || !boxes[selectedIndex]) return;
      updateCurrentFrame(
        boxes.map((box, index) => (index === selectedIndex ? { ...box, classId } : box)),
        true
      );
    },
    [archivedDetectIds, boxes, selectedIndex, showToast, updateCurrentFrame]
  );

  // Copy detect boxes only from the previous annotated timestamp.
  // Does NOT copy clf label.
  const copyPreviousBoxes = useCallback(() => {
    const previous = [...annotatedFrames].reverse().find((frame) => frame.timestampMs < Number(currentKey));
    if (!previous || !current) {
      showToast("No earlier annotated frame has boxes.", { variant: "error" });
      return;
    }
    const prevBoxes = previous.tasks.detect?.boxes ?? [];
    if (!prevBoxes.length) {
      showToast("No earlier annotated frame has boxes.", { variant: "error" });
      return;
    }
    setSelectedIndex(null);
    const source = manifestRef.current;
    if (!source) return;
    const detectBoxes = cloneDetectBoxes(prevBoxes);
    const next = updateVideoDetectBoxes(source, current, time, detectBoxes, true);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
    setStatus(`Copied ${detectBoxes.length} box(es) from the previous annotated timestamp.`);
    void recordWorkspaceOperation(workspaceRoot, {
      tool: "video-label",
      action: "copy-previous-boxes",
      status: "done",
      inputs: { videoPath: current.path, fromTimestampMs: previous.timestampMs, toTimestampMs: Number(currentKey) },
      summary: { boxCount: detectBoxes.length }
    }).catch(() => {});
  }, [annotatedFrames, current, currentKey, enqueueSave, showToast, time, workspaceRoot]);

  const gotoReviewed = useCallback(
    (direction: -1 | 1) => {
      const candidate = adjacentReviewedFrame(reviewedFrames, Number(currentKey), direction);
      if (candidate) gotoTime(candidate.time);
    },
    [currentKey, gotoTime, reviewedFrames]
  );

  // Mark detect task empty+reviewed. Does NOT affect clf task.
  const markEmptyReviewed = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !current) return;
    const next = markVideoDetectEmpty(source, current, time);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
    void recordWorkspaceOperation(workspaceRoot, {
      tool: "video-label",
      action: "mark-empty-reviewed",
      status: "done",
      inputs: { videoPath: current.path, timestampMs: Number(currentKey) },
      summary: { boxCount: 0 }
    }).catch(() => {});
  }, [current, currentKey, enqueueSave, time, workspaceRoot]);

  const markTimestamp = useCallback((seconds = time, source: VideoTimestampSource = { kind: "manual" }) => {
    const manifestSource = manifestRef.current;
    if (!manifestSource || !current) return;
    const next = markVideoTimestamp(manifestSource, current, seconds, source);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
  }, [current, enqueueSave, time]);

  const markCurrentTimestamp = useCallback(
    (source: VideoTimestampSource = { kind: "manual" }) => markTimestamp(time, source),
    [markTimestamp, time]
  );

  // Clear the whole frame record (both detect and clf).
  const clearFrameRecord = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !currentFrame || !current) return;
    const detectBoxCount = currentFrame.tasks.detect?.boxes.length ?? 0;
    const next = clearVideoFrameRecord(source, time);
    manifestRef.current = next;
    setManifest(next);
    setSelectedIndex(null);
    enqueueSave(next);
    void recordWorkspaceOperation(workspaceRoot, {
      tool: "video-label",
      action: "clear-frame-record",
      status: "done",
      inputs: { videoPath: current.path, timestampMs: Number(currentKey) },
      summary: { removedBoxCount: detectBoxCount }
    }).catch(() => {});
  }, [current, currentFrame, currentKey, enqueueSave, time, workspaceRoot]);

  const moveFrameRecord = useCallback((fromTime: number, toTime: number) => {
    const source = manifestRef.current;
    if (!source || !current) return false;
    const nextTime = clampVideoTime(toTime, current.duration);

    try {
      const next = moveVideoFrameRecord(source, current, fromTime, nextTime);
      if (next === source) {
        gotoTime(nextTime);
        return true;
      }
      manifestRef.current = next;
      setManifest(next);
      setSelectedIndex(null);
      setTime(nextTime);
      enqueueSave(next);
      setStatus(`Moved annotation marker to ${formatVideoClock(nextTime)}.`);
      void recordWorkspaceOperation(workspaceRoot, {
        tool: "video-label",
        action: "move-frame-record",
        status: "done",
        inputs: {
          videoPath: current.path,
          fromTimestampMs: Number(timestampKey(fromTime)),
          toTimestampMs: Number(timestampKey(nextTime))
        }
      }).catch(() => {});
      return true;
    } catch (reason) {
      showError(reason, "annotation.marker.move");
      return false;
    }
  }, [current, enqueueSave, gotoTime, showError, workspaceRoot]);

  // ---------------------------------------------------------------------------
  // Clf task actions
  // ---------------------------------------------------------------------------

  const setClfClass = useCallback(
    (classKey: string) => {
      if (archivedClassKeys.has(classKey) || (classManifest && isClassificationClassArchived(classManifest, classKey))) {
        setStatus("Classification class is archived. Restore it in Library before assigning it.");
        showToast("Classification class is archived. Restore it in Library before assigning it.", { variant: "error" });
        return;
      }
      const source = manifestRef.current;
      if (!source || !current) return;
      const next = setVideoClfClass(source, current, time, classKey);
      manifestRef.current = next;
      setManifest(next);
      enqueueSave(next);
    },
    [archivedClassKeys, classManifest, current, enqueueSave, showToast, time]
  );

  const clfDisplayName = useCallback(
    (classKey: string) =>
      classManifest ? classificationClassDisplayName(classManifest, classKey) : classKey,
    [classManifest]
  );

  const isArchivedDetectClass = useCallback(
    (classId: number) => archivedDetectIds.has(classId),
    [archivedDetectIds]
  );

  const isArchivedClfClass = useCallback(
    (classKey: string) =>
      archivedClassKeys.has(classKey) || (classManifest ? isClassificationClassArchived(classManifest, classKey) : false),
    [archivedClassKeys, classManifest]
  );

  const markClfReviewed = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !current) return;
    const next = markVideoClfReviewed(source, current, time);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
  }, [current, enqueueSave, time]);

  const toggleClfReviewed = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !current) return;
    const next = setVideoClfReviewed(source, current, time, !Boolean(clfTask?.reviewed));
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
  }, [clfTask?.reviewed, current, enqueueSave, time]);

  const toggleDetectExportEnabled = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !current) return;
    const next = setVideoDetectEnabled(source, current, time, !detectExportEnabled);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
  }, [current, detectExportEnabled, enqueueSave, time]);

  const toggleClfExportEnabled = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !current) return;
    const next = setVideoClfEnabled(source, current, time, !clfExportEnabled);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
  }, [clfExportEnabled, current, enqueueSave, time]);

  const clearClfLabel = useCallback(() => {
    const source = manifestRef.current;
    if (!source || !current) return;
    const next = clearVideoClfLabel(source, current, time);
    manifestRef.current = next;
    setManifest(next);
    enqueueSave(next);
  }, [current, enqueueSave, time]);

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
    previewUrl,
    previewLoading,
    videosLoaded,
    manifestLoading,
    manifest,
    currentFrame,
    // Detect derived state
    boxes,
    reviewed,
    detectExportEnabled,
    detectTask,
    // Clf derived state
    clfTask,
    clfExportEnabled,
    // Classes
    classes,
    activeDetectClasses,
    clfClassOptions,
    clfDisplayName,
    isArchivedDetectClass,
    archivedDetectClassIds: archivedDetectIds,
    isArchivedClfClass,
    currentClass,
    assignClass,
    selectedIndex,
    setSelectedIndex,
    saveState,
    status,
    annotatedFrames,
    reviewedFrames,
    timelineMarkers,
    // Detect actions
    updateCurrentFrame,
    updateFrameAtTime,
    loadBoxesAtTime,
    copyPreviousBoxes,
    gotoReviewed,
    markEmptyReviewed,
    markTimestamp,
    markCurrentTimestamp,
    clearFrameRecord,
    moveFrameRecord,
    toggleDetectExportEnabled,
    // Clf actions
    setClfClass,
    markClfReviewed,
    toggleClfReviewed,
    toggleClfExportEnabled,
    clearClfLabel,
    showError
  };
}

export type VideoAnnotationSession = ReturnType<typeof useVideoAnnotationSession>;
