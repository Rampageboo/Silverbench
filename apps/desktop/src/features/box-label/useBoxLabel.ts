import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { readWorkspaceSessionLite } from "../image-pool/session";
import {
  INBOX_JUNK_CLASS,
  isClfJunk,
  isDetectJunk,
  isFlaggedFile,
  isNextTrainingFile,
  isReviewedFile,
  isTaskExportEnabled,
  loadMetadataMap,
  markJunkFilenames,
  setTaskExportEnabled,
  setMetadataFlags
} from "../image-pool/metadata";
import type { MetadataRow } from "../image-pool/types";
import { hasJunkUndo, popJunkUndo, pushJunkUndo } from "../shared/junkUndo";
import { restoreJunkUndoWithLinks } from "../shared/junkMetadata";
import { useWorkspaceCache } from "../shared/useWorkspaceCache";
import { isWorkspaceMediaChangedEvent, WORKSPACE_MEDIA_CHANGED_EVENT } from "../shared/mediaEvents";
import { BOX_LABEL_CACHE_MS } from "../shared/workspaceCache";
import {
  loadDetectDatasetClassIndex,
  loadEntryLabels,
  loadMediaBoxLabelEntries,
  type BoxLabelEntry
} from "./boxLabelCore";
import {
  normalizeShortcutSlotsFromSession,
  normalizeFixedBoxSlotsFromSession,
  parsePoolLabelSession,
  resolveResumeImagePath,
  type BoxLabelShortcutSlot,
  type FixedBoxSlot,
  savePoolLabelSession
} from "./session";

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function comparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Compute the new current index after removing `removedBasenames` from
 * `entries`. Exported for unit testing; not part of the public hook API.
 */
export function computePostRemovalIndex(
  currentIndex: number,
  entries: ReadonlyArray<{ basename: string }>,
  removedBasenames: ReadonlySet<string>
): number {
  const remaining = entries.filter((entry) => !removedBasenames.has(entry.basename));
  if (!remaining.length) return 0;
  return Math.min(currentIndex, remaining.length - 1);
}

type UseBoxLabelOptions = {
  workspaceRoot: string;
  focusFilename?: string | null;
  onFocusConsumed?: () => void;
  onReady?: () => void;
};

type DatasetDetectPoint = {
  classKey: string;
  className: string;
  x: number;
  y: number;
  area: number;
};

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function useBoxLabel({
  workspaceRoot,
  focusFilename,
  onFocusConsumed,
  onReady
}: UseBoxLabelOptions) {
  const { getBoxLabelCache, patchBoxLabelCacheLabelIndex, setBoxLabelCache } = useWorkspaceCache();
  const root = workspaceRoot.trim();
  const [datasetRoot, setDatasetRoot] = useState("");
  const [mediaDir, setMediaDir] = useState("media");
  const [allEntries, setAllEntries] = useState<BoxLabelEntry[]>([]);
  const [labelIndex, setLabelIndex] = useState<Map<string, Set<number>>>(new Map());
  const [metadata, setMetadata] = useState<Map<string, MetadataRow>>(new Map());
  const [datasetDetectPoints, setDatasetDetectPoints] = useState<DatasetDetectPoint[]>([]);
  const [includeClasses, setIncludeClasses] = useState<Set<number>>(new Set());
  const [excludeClasses, setExcludeClasses] = useState<Set<number>>(new Set());
  const [imageViewMode, setImageViewMode] = useState<"all" | "hideReviewed" | "flagged" | "nextTraining">("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [galleryScrollTop, setGalleryScrollTop] = useState<number | null>(null);
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null);
  const [restoreImagePath, setRestoreImagePath] = useState("");
  const [shiftSelectedBasenames, setShiftSelectedBasenames] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);
  const [initialShortcutSlots, setInitialShortcutSlots] = useState<Array<BoxLabelShortcutSlot | null> | null>(null);
  const [initialFixedBoxSlots, setInitialFixedBoxSlots] = useState<Array<FixedBoxSlot | null> | null>(null);
  const [initialPointerToolEnabled, setInitialPointerToolEnabled] = useState(false);
  const [initialAutoFitEnabled, setInitialAutoFitEnabled] = useState(false);
  const [canUndoJunk, setCanUndoJunk] = useState(false);
  const [statusText, setStatusText] = useState("");
  const readyNotified = useRef(false);
  const sessionSaveTimer = useRef<number | null>(null);
  const shortcutSlotsRef = useRef<Array<BoxLabelShortcutSlot | null> | null>(null);
  const fixedBoxSlotsRef = useRef<Array<FixedBoxSlot | null> | null>(null);
  const toolStateRef = useRef({ pointerToolEnabled: false, autoFitEnabled: false });
  const pendingFocusFilename = useRef<string | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const notifyReady = useCallback(() => {
    if (readyNotified.current) return;
    readyNotified.current = true;
    onReadyRef.current?.();
  }, []);

  const entries = useMemo(() => {
    return allEntries.filter((entry) => {
      const classes = labelIndex.get(entry.basename);
      if (includeClasses.size && ![...includeClasses].some((id) => classes?.has(id))) return false;
      if ([...excludeClasses].some((id) => classes?.has(id))) return false;
      const row = metadata.get(entry.basename);
      if (isDetectJunk(row)) return false;
      if (imageViewMode === "hideReviewed" && isReviewedFile(row)) return false;
      if (imageViewMode === "flagged" && !isFlaggedFile(row)) return false;
      if (imageViewMode === "nextTraining" && !isNextTrainingFile(row)) return false;
      return true;
    });
  }, [allEntries, excludeClasses, imageViewMode, includeClasses, labelIndex, metadata]);

  const currentEntry = entries[currentIndex] || null;
  const currentImagePath = currentEntry?.imagePath || "";

  const selectedBasenames = useMemo(() => {
    const names = new Set(shiftSelectedBasenames);
    if (currentEntry) names.add(currentEntry.basename);
    return names;
  }, [shiftSelectedBasenames, currentEntry]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => naturalCompare(a.basename, b.basename)),
    [entries]
  );

  const classImageCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const classIds of labelIndex.values()) {
      for (const classId of classIds) {
        counts.set(classId, (counts.get(classId) || 0) + 1);
      }
    }
    return counts;
  }, [labelIndex]);

  const datasetStats = useMemo(() => {
    const detectClassCounts = new Map<number, number>();
    const clfClassCounts = new Map<string, number>();
    let clfLabels = 0;
    let reviewed = 0;
    let junk = 0;
    for (const row of metadata.values()) {
      if (isReviewedFile(row)) reviewed += 1;
      if (isDetectJunk(row) || isClfJunk(row)) junk += 1;
      const classKey = String(row.clf_class || "").trim();
      if (classKey && classKey !== INBOX_JUNK_CLASS && isTaskExportEnabled(row, "clf")) {
        clfLabels += 1;
        clfClassCounts.set(classKey, (clfClassCounts.get(classKey) ?? 0) + 1);
      }
    }

    let detectSamples = 0;
    let detectHits = 0;
    for (const [basename, classIds] of labelIndex) {
      const row = metadata.get(basename);
      if (!isTaskExportEnabled(row, "detect")) continue;
      detectSamples += 1;
      detectHits += classIds.size;
      for (const classId of classIds) {
        detectClassCounts.set(classId, (detectClassCounts.get(classId) ?? 0) + 1);
      }
    }
    if (datasetDetectPoints.length) {
      detectHits = datasetDetectPoints.length;
      detectClassCounts.clear();
      for (const point of datasetDetectPoints) {
        const classId = Number(point.classKey);
        if (!Number.isFinite(classId)) continue;
        detectClassCounts.set(classId, (detectClassCounts.get(classId) ?? 0) + 1);
      }
    }

    return {
      totalMedia: allEntries.length,
      detectSamples,
      detectHits,
      clfLabels,
      proposals: 0,
      reviewed,
      junk,
      detectClasses: [...detectClassCounts.entries()]
        .map(([classId, count]) => ({ key: String(classId), name: `#${classId}`, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      clfClasses: [...clfClassCounts.entries()]
        .map(([classKey, count]) => ({ key: classKey, name: classKey, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      detectPoints: datasetDetectPoints,
    };
  }, [allEntries.length, datasetDetectPoints, labelIndex, metadata]);

  useEffect(() => {
    if (!datasetRoot || !allEntries.length || !labelIndex.size) {
      setDatasetDetectPoints([]);
      return;
    }

    let cancelled = false;
    async function scanDetectPoints() {
      const points: DatasetDetectPoint[] = [];
      const entriesWithLabels = allEntries.filter((entry) => {
        if (!labelIndex.has(entry.basename)) return false;
        return isTaskExportEnabled(metadata.get(entry.basename), "detect");
      });
      for (const entry of entriesWithLabels) {
        if (cancelled) return;
        const boxes = await loadEntryLabels(datasetRoot, entry).catch(() => []);
        for (const box of boxes) {
          const classKey = String(box.classId);
          points.push({
            classKey,
            className: `#${classKey}`,
            x: clampUnit(box.x),
            y: clampUnit(box.y),
            area: clampUnit(box.w) * clampUnit(box.h),
          });
        }
      }
      if (!cancelled) setDatasetDetectPoints(points);
    }

    void scanDetectPoints();
    return () => {
      cancelled = true;
    };
  }, [allEntries, datasetRoot, labelIndex, metadata]);

  const resolveIndex = useCallback((list: BoxLabelEntry[], basename: string) => {
    if (!basename) return 0;
    const index = list.findIndex((entry) => entry.basename === basename);
    return index >= 0 ? index : 0;
  }, []);

  const resolveIndexByImagePath = useCallback((list: BoxLabelEntry[], imagePath: string) => {
    if (!imagePath) return 0;
    const index = list.findIndex((entry) => entry.imagePath === imagePath);
    if (index >= 0) return index;
    const basename = imagePath.split("/").pop() || imagePath;
    return resolveIndex(list, basename);
  }, [resolveIndex]);

  const load = useCallback(async (options: { background?: boolean; force?: boolean } = {}) => {
    if (!root) {
      setAllEntries([]);
      setDatasetRoot("");
      setMediaDir("media");
      setError("Open a workspace first.");
      notifyReady();
      return;
    }

    const cached = getBoxLabelCache(root);
    const cacheFresh =
      cached &&
      !options.force &&
      Date.now() - cached.cachedAt < BOX_LABEL_CACHE_MS &&
      comparablePath(cached.datasetRoot) === comparablePath(root)
        ? cached
        : null;
    if (cacheFresh && !options.background) {
      setDatasetRoot(cacheFresh.datasetRoot);
      setMediaDir(cacheFresh.mediaDir || "media");
      setAllEntries(cacheFresh.entries);
      if (cacheFresh.labelIndex) setLabelIndex(cacheFresh.labelIndex);
      setError("");
      setPending(false);
      notifyReady();
      readWorkspaceSessionLite(root)
        .then((session) => {
          const parsed = parsePoolLabelSession(session);
          const shortcuts = normalizeShortcutSlotsFromSession(parsed);
          const fixedSlots = normalizeFixedBoxSlotsFromSession(parsed);
          setInitialShortcutSlots(shortcuts);
          setInitialFixedBoxSlots(fixedSlots);
          if (shortcuts) shortcutSlotsRef.current = shortcuts;
          if (fixedSlots) fixedBoxSlotsRef.current = fixedSlots;
          const pointerTool = !!parsed.poolLabelPointerToolEnabled;
          const autoFit = pointerTool ? false : !!parsed.poolLabelAutoFitEnabled;
          setInitialPointerToolEnabled(pointerTool);
          setInitialAutoFitEnabled(autoFit);
          toolStateRef.current = { pointerToolEnabled: pointerTool, autoFitEnabled: autoFit };
          const resumePath = resolveResumeImagePath(parsed);
          const index = resolveIndexByImagePath(cacheFresh.entries, resumePath);
          setCurrentIndex(index);
          setRestoreScrollTop(parsed.galleryScrollTop ?? null);
          setRestoreImagePath(resumePath || cacheFresh.entries[index]?.imagePath || "");
        })
        .catch(() => {});
      loadMetadataMap(root).then(setMetadata).catch(() => {});
      void load({ background: true });
      return;
    }

    if (!options.background) {
      setPending(true);
      setError("");
    }
    try {
      const [, dataset, session, meta] = await Promise.all([
        api.openWorkspace(root).catch(() => {}),
        loadMediaBoxLabelEntries(root),
        readWorkspaceSessionLite(root),
        loadMetadataMap(root).catch(() => new Map<string, MetadataRow>())
      ]);
      setDatasetRoot(dataset.datasetRoot);
      setMediaDir(dataset.mediaDir || "media");
      const list = [...dataset.entries].sort((a, b) => naturalCompare(a.basename, b.basename));
      setAllEntries(list);
      setMetadata(meta);
      setShiftSelectedBasenames(new Set());
      setSelectionAnchorIndex(null);

      const parsed = parsePoolLabelSession(session);
      const shortcuts = normalizeShortcutSlotsFromSession(parsed);
      const fixedSlots = normalizeFixedBoxSlotsFromSession(parsed);
      setInitialShortcutSlots(shortcuts);
      setInitialFixedBoxSlots(fixedSlots);
      if (shortcuts) shortcutSlotsRef.current = shortcuts;
      if (fixedSlots) fixedBoxSlotsRef.current = fixedSlots;
      const pointerTool = !!parsed.poolLabelPointerToolEnabled;
      const autoFit = pointerTool ? false : !!parsed.poolLabelAutoFitEnabled;
      setInitialPointerToolEnabled(pointerTool);
      setInitialAutoFitEnabled(autoFit);
      toolStateRef.current = { pointerToolEnabled: pointerTool, autoFitEnabled: autoFit };

      const resumePath = resolveResumeImagePath(parsed);
      const index = resolveIndexByImagePath(list, resumePath);
      setCurrentIndex(index);
      setRestoreScrollTop(parsed.galleryScrollTop ?? null);
      setRestoreImagePath(resumePath || list[index]?.imagePath || "");

      if (focusFilename) {
        pendingFocusFilename.current = focusFilename;
      }
      setBoxLabelCache(root, {
        datasetRoot: dataset.datasetRoot,
        mediaDir: dataset.mediaDir || "media",
        entries: list,
        labelIndex: cacheFresh?.labelIndex ?? null
      });
      notifyReady();
      loadDetectDatasetClassIndex(dataset.datasetRoot, list, dataset.filePaths)
        .then((indexMap) => {
          setLabelIndex(indexMap);
          patchBoxLabelCacheLabelIndex(root, indexMap);
        })
        .catch(() => {});
      if (!list.length) {
        setStatusText("detect_dataset 中没有图片。请先从 Image Assign 发送到 Detect。");
      } else {
        setStatusText(`${list.length} image(s) in detect_dataset`);
      }
      setStatusText(
        list.length
          ? `${list.length} media image(s) ready for detect + clf labeling.`
          : "No media images found. Import images into media to start labeling."
      );
    } catch (err) {
      if (!options.background) {
        setAllEntries([]);
        setDatasetRoot("");
        setError(errMessage(err));
        notifyReady();
      }
    } finally {
      if (!options.background) setPending(false);
    }
  }, [focusFilename, getBoxLabelCache, notifyReady, patchBoxLabelCacheLabelIndex, resolveIndexByImagePath, root, setBoxLabelCache]);

  useEffect(() => {
    readyNotified.current = false;
    pendingFocusFilename.current = null;
    if (!root) {
      notifyReady();
      return;
    }
    load();
  }, [notifyReady, root, load]);

  useEffect(() => {
    if (!root) return;
    const handleMediaChanged = (event: Event) => {
      if (!isWorkspaceMediaChangedEvent(event)) return;
      if (comparablePath(event.detail.workspaceRoot) !== comparablePath(root)) return;
      void load({ background: true, force: true });
    };
    window.addEventListener(WORKSPACE_MEDIA_CHANGED_EVENT, handleMediaChanged);
    return () => window.removeEventListener(WORKSPACE_MEDIA_CHANGED_EVENT, handleMediaChanged);
  }, [load, root]);

  useEffect(() => {
    if (currentIndex >= entries.length && entries.length) setCurrentIndex(entries.length - 1);
    if (!entries.length && currentIndex !== 0) setCurrentIndex(0);
  }, [currentIndex, entries.length]);

  useEffect(() => {
    const focus = pendingFocusFilename.current || focusFilename;
    if (!focus || !entries.length) return;
    setImageViewMode("all");
    const index = resolveIndex(entries, focus);
    if (index < 0 || !entries[index]) {
      setStatusText(`「${focus}」不在 detect_dataset 中。请先从 Image Assign 发送到 Detect。`);
      setStatusText(`"${focus}" is not in workspace media. Import it before labeling.`);
      pendingFocusFilename.current = null;
      onFocusConsumed?.();
      return;
    }
    setCurrentIndex(index);
    setRestoreImagePath(entries[index].imagePath);
    pendingFocusFilename.current = null;
    onFocusConsumed?.();
  }, [entries, focusFilename, onFocusConsumed, resolveIndex]);

  const queueSessionSave = useCallback(
    (
      index: number,
      scrollTop: number,
      shortcutSlots?: Array<BoxLabelShortcutSlot | null>,
      fixedBoxSlots?: Array<FixedBoxSlot | null>,
      toolState?: { pointerToolEnabled: boolean; autoFitEnabled: boolean }
    ) => {
      if (!root) return;
      const entry = entries[index];
      if (!entry) return;
      const tools = toolState ?? toolStateRef.current;
      if (sessionSaveTimer.current) window.clearTimeout(sessionSaveTimer.current);
      sessionSaveTimer.current = window.setTimeout(() => {
        savePoolLabelSession(root, {
          currentImagePath: entry.imagePath,
          galleryScrollTop: scrollTop,
          shortcutSlots: shortcutSlots ?? shortcutSlotsRef.current ?? undefined,
          fixedBoxSlots: fixedBoxSlots ?? fixedBoxSlotsRef.current ?? undefined,
          pointerToolEnabled: tools.pointerToolEnabled,
          autoFitEnabled: tools.autoFitEnabled
        }).catch(() => {});
      }, 500);
    },
    [entries, root]
  );

  const navigate = useCallback(
    (index: number) => {
      if (index < 0 || index >= entries.length) return;
      setCurrentIndex(index);
      queueSessionSave(index, galleryScrollTop ?? 0);
    },
    [entries.length, galleryScrollTop, queueSessionSave]
  );

  const selectGalleryImage = useCallback(
    (index: number, options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
      const entry = entries[index];
      if (!entry) return;
      if (options.shiftKey) {
        const anchor = selectionAnchorIndex ?? currentIndex;
        const start = Math.max(0, Math.min(anchor, index));
        const end = Math.min(entries.length - 1, Math.max(anchor, index));
        const next = new Set<string>();
        for (let i = start; i <= end; i += 1) {
          const item = entries[i];
          if (item) next.add(item.basename);
        }
        setShiftSelectedBasenames(next);
        return;
      }
      if (options.ctrlKey || options.metaKey) {
        setSelectionAnchorIndex(index);
        setShiftSelectedBasenames((current) => {
          const next = new Set(current);
          if (next.has(entry.basename)) next.delete(entry.basename);
          else next.add(entry.basename);
          return next;
        });
        return;
      }
      setSelectionAnchorIndex(index);
      setShiftSelectedBasenames(new Set());
      navigate(index);
    },
    [currentIndex, entries, navigate, selectionAnchorIndex]
  );

  const onGalleryScroll = useCallback(
    (scrollTop: number, imagePath: string) => {
      setGalleryScrollTop(scrollTop);
      queueSessionSave(currentIndex, scrollTop);
      if (imagePath) setRestoreImagePath(imagePath);
    },
    [currentIndex, queueSessionSave]
  );

  const clearRestoreViewport = useCallback(() => {
    setRestoreScrollTop(null);
    setRestoreImagePath("");
  }, []);

  const onShortcutSlotsChange = useCallback(
    (slots: Array<BoxLabelShortcutSlot | null>, fixedSlots?: Array<FixedBoxSlot | null>) => {
      shortcutSlotsRef.current = slots;
      if (fixedSlots) fixedBoxSlotsRef.current = fixedSlots;
      queueSessionSave(currentIndex, galleryScrollTop ?? 0, slots, fixedSlots);
    },
    [currentIndex, galleryScrollTop, queueSessionSave]
  );

  const onToolStateChange = useCallback(
    (pointerToolEnabled: boolean, autoFitEnabled: boolean) => {
      toolStateRef.current = { pointerToolEnabled, autoFitEnabled };
      queueSessionSave(currentIndex, galleryScrollTop ?? 0, undefined, undefined, toolStateRef.current);
    },
    [currentIndex, galleryScrollTop, queueSessionSave]
  );

  const addIncludeClass = useCallback((classId: number) => {
    setIncludeClasses((current) => new Set(current).add(classId));
    setExcludeClasses((current) => {
      const next = new Set(current);
      next.delete(classId);
      return next;
    });
  }, []);

  const addExcludeClass = useCallback((classId: number) => {
    setExcludeClasses((current) => new Set(current).add(classId));
    setIncludeClasses((current) => {
      const next = new Set(current);
      next.delete(classId);
      return next;
    });
  }, []);

  const clearClassFilters = useCallback(() => {
    setIncludeClasses(new Set());
    setExcludeClasses(new Set());
  }, []);

  const selectedOrCurrentBasenames = useCallback(() => {
    const names = selectedBasenames.size ? [...selectedBasenames] : currentEntry ? [currentEntry.basename] : [];
    return [...new Set(names)];
  }, [currentEntry, selectedBasenames]);

  const toggleReviewed = useCallback(async () => {
    if (!root) return;
    const names = selectedOrCurrentBasenames();
    if (!names.length) return;
    const shouldReview = names.some((name) => !isReviewedFile(metadata.get(name)));
    await setMetadataFlags(root, names, { reviewed: shouldReview });
    setMetadata(await loadMetadataMap(root));
  }, [metadata, root, selectedOrCurrentBasenames]);

  const toggleFlagged = useCallback(async () => {
    if (!root) return;
    const names = selectedOrCurrentBasenames();
    if (!names.length) return;
    const shouldFlag = names.some((name) => !isFlaggedFile(metadata.get(name)));
    await setMetadataFlags(root, names, { flagged: shouldFlag });
    setMetadata(await loadMetadataMap(root));
  }, [metadata, root, selectedOrCurrentBasenames]);

  const toggleNextTraining = useCallback(async () => {
    if (!root) return;
    const names = selectedOrCurrentBasenames();
    if (!names.length) return;
    const shouldQueue = names.some((name) => !isNextTrainingFile(metadata.get(name)));
    await setMetadataFlags(root, names, { next_train: shouldQueue });
    setMetadata(await loadMetadataMap(root));
    setStatusText(
      shouldQueue
        ? `Added ${names.length} image(s) to the next training batch.`
        : `Removed ${names.length} image(s) from the next training batch.`
    );
  }, [metadata, root, selectedOrCurrentBasenames]);

  const reloadMetadata = useCallback(async () => {
    if (!root) return;
    setMetadata(await loadMetadataMap(root));
  }, [root]);

  const currentDetectExportEnabled = currentEntry
    ? isTaskExportEnabled(metadata.get(currentEntry.basename), "detect")
    : true;
  const currentClfExportEnabled = currentEntry
    ? isTaskExportEnabled(metadata.get(currentEntry.basename), "clf")
    : true;

  const toggleTaskExportEnabled = useCallback(async (task: "detect" | "clf") => {
    if (!root || !currentEntry) return;
    const filename = currentEntry.basename;
    const nextEnabled = !isTaskExportEnabled(metadata.get(filename), task);
    setMetadata((current) => {
      const next = new Map(current);
      const row = next.get(filename);
      next.set(filename, {
        ...(row || { filename }),
        filename,
        [task === "detect" ? "detect_export_enabled" : "clf_export_enabled"]: nextEnabled
      });
      return next;
    });
    setStatusText(`${task === "detect" ? "Detect" : "Clf"} export ${nextEnabled ? "enabled" : "disabled"} for ${filename}.`);
    try {
      await setTaskExportEnabled(root, filename, task, nextEnabled);
      await reloadMetadata();
    } catch (err) {
      await reloadMetadata().catch(() => {});
      setStatusText(`Failed to update ${task} export flag: ${errMessage(err)}`);
      throw err;
    }
  }, [currentEntry, metadata, reloadMetadata, root]);

  const toggleDetectExportEnabled = useCallback(
    () => toggleTaskExportEnabled("detect"),
    [toggleTaskExportEnabled]
  );
  const toggleClfExportEnabled = useCallback(
    () => toggleTaskExportEnabled("clf"),
    [toggleTaskExportEnabled]
  );

  const assignClassificationClass = useCallback(async (classKey: string | null, basename?: string) => {
    if (!root) return;
    const trimmedKey = classKey?.trim() ?? "";
    const filename = (basename || currentEntry?.basename || "").trim();
    if (!filename) return;
    const existing = metadata.get(filename);
    const update: Record<string, unknown> = {
      filename,
      clf_enabled: Boolean(trimmedKey),
      clf_class: trimmedKey
    };

    setMetadata((current) => {
      const next = new Map(current);
      const currentRow = current.get(filename) || existing;
      next.set(filename, {
        ...(currentRow || { filename }),
        filename,
        clf_enabled: Boolean(trimmedKey),
        clf_class: trimmedKey,
        detect_enabled: currentRow?.detect_enabled ?? false
      });
      return next;
    });
    setStatusText(trimmedKey ? `Assigned ${filename} -> ${trimmedKey}.` : `Removed classification from ${filename}.`);
    try {
      const result = await api.upsertMetadataRows(root, [update]);
      if (result.ok === false) throw new Error(result.error || "Failed to assign classification class.");
      await reloadMetadata();
    } catch (err) {
      await reloadMetadata().catch(() => {});
      setStatusText(`Failed to assign classification class: ${errMessage(err)}`);
      throw err;
    }
  }, [currentEntry, metadata, reloadMetadata, root]);

  const markJunk = useCallback(async () => {
    if (!root) return;
    const targets = (
      selectedBasenames.size > 0
        ? [...selectedBasenames]
        : currentEntry
          ? [currentEntry.basename]
          : []
    ).filter((name) => {
      const row = metadata.get(name);
      return !isDetectJunk(row) || !isClfJunk(row);
    });
    if (!targets.length) {
      setStatusText("Selected images are already junk.");
      return;
    }
    const targetSet = new Set(targets);
    const previousEntries = allEntries;
    const previousIndex = currentIndex;
    pushJunkUndo("pool-label", root, targets, metadata);
    setCanUndoJunk(hasJunkUndo("pool-label", root));
    setShiftSelectedBasenames(new Set());
    setSelectionAnchorIndex(null);
    setMetadata((current) => {
      const next = new Map(current);
      for (const filename of targets) {
        const row = next.get(filename);
        next.set(filename, {
          ...(row || { filename }),
          filename,
          detect_junk: true,
          detect_enabled: false,
          clf_enabled: false,
          clf_class: INBOX_JUNK_CLASS
        });
      }
      return next;
    });
    setAllEntries((current) => current.filter((entry) => !targetSet.has(entry.basename)));
    setCurrentIndex((index) => computePostRemovalIndex(index, entries, targetSet));
    setStatusText(`Marked ${targets.length} image(s) as junk.`);
    try {
      await markJunkFilenames(root, targets, "both");
      await reloadMetadata();
    } catch (err) {
      // Restore optimistic state on backend failure so the gallery and
      // preview remain consistent with the server's actual metadata.
      setAllEntries(previousEntries);
      setCurrentIndex(previousIndex);
      await reloadMetadata().catch(() => {});
      setStatusText(`Failed to mark junk: ${errMessage(err)}`);
    }
  }, [allEntries, currentEntry, entries, metadata, reloadMetadata, root, selectedBasenames]);

  const undoJunk = useCallback(async () => {
    if (!root) return;
    const snapshots = popJunkUndo("pool-label", root);
    setCanUndoJunk(hasJunkUndo("pool-label", root));
    if (!snapshots?.length) {
      setStatusText("没有可撤回的废片操作。");
      return;
    }
    await restoreJunkUndoWithLinks(root, snapshots);
    await reloadMetadata();
    await load({ background: true });
    setStatusText("已撤回上一步废片操作。");
  }, [load, reloadMetadata, root]);

  const junkButtonLabel = useMemo(() => {
    const names =
      selectedBasenames.size > 0
        ? [...selectedBasenames]
        : currentEntry
          ? [currentEntry.basename]
          : [];
    const pendingCount = names.filter((name) => {
      const row = metadata.get(name);
      return !isDetectJunk(row) || !isClfJunk(row);
    }).length;
    if (names.length > 1) {
      return pendingCount ? `Mark Junk (${pendingCount})` : "Already junk";
    }
    if (names.length === 1 && isDetectJunk(metadata.get(names[0]))) return "Already junk";
    return "Mark Junk";
  }, [currentEntry, metadata, selectedBasenames]);

  const updateLabelIndexForFile = useCallback((basename: string, boxes: api.LabelBox[]) => {
    setLabelIndex((current) => {
      const next = new Map(current);
      const classIds = new Set(boxes.map((box) => box.classId));
      if (classIds.size) next.set(basename, classIds);
      else next.delete(basename);
      if (root) patchBoxLabelCacheLabelIndex(root, next);
      return next;
    });
  }, [patchBoxLabelCacheLabelIndex, root]);

  return {
    datasetRoot,
    mediaDir,
    entries: sortedEntries,
    currentIndex,
    currentEntry,
    currentImagePath,
    pending,
    error,
    restoreScrollTop,
    restoreImagePath,
    initialShortcutSlots,
    initialFixedBoxSlots,
    initialPointerToolEnabled,
    initialAutoFitEnabled,
    includeClasses,
    excludeClasses,
    imageViewMode,
    metadata,
    classImageCounts,
    datasetStats,
    navigate,
    selectGalleryImage,
    selectedBasenames,
    shiftSelectedBasenames,
    onGalleryScroll,
    clearRestoreViewport,
    onShortcutSlotsChange,
    onToolStateChange,
    addIncludeClass,
    addExcludeClass,
    clearClassFilters,
    setImageViewMode,
    toggleReviewed,
    toggleFlagged,
    toggleNextTraining,
    updateLabelIndexForFile,
    reloadMetadata,
    assignClassificationClass,
    currentDetectExportEnabled,
    currentClfExportEnabled,
    toggleDetectExportEnabled,
    toggleClfExportEnabled,
    markJunk,
    undoJunk,
    canUndoJunk,
    junkButtonLabel,
    statusText,
    setStatusText,
    reload: load
  };
}

export type BoxLabelModel = ReturnType<typeof useBoxLabel>;
