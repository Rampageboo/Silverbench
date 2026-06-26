import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { readWorkspaceSessionLite } from "../image-pool/session";
import {
  isDetectJunk,
  isFlaggedFile,
  isReviewedFile,
  loadMetadataMap,
  markJunkFilenames,
  setMetadataFlags
} from "../image-pool/metadata";
import type { MetadataRow } from "../image-pool/types";
import { hasJunkUndo, popJunkUndo, pushJunkUndo } from "../shared/junkUndo";
import { restoreJunkUndoWithLinks } from "../shared/junkMetadata";
import { useWorkspaceCache } from "../shared/useWorkspaceCache";
import { BOX_LABEL_CACHE_MS } from "../shared/workspaceCache";
import {
  loadDetectDatasetClassIndex,
  loadDetectDatasetEntries,
  type BoxLabelEntry
} from "./boxLabelCore";
import {
  normalizeShortcutSlotsFromSession,
  normalizeFixedBoxSlotsFromSession,
  parsePoolLabelSession,
  resolveResumeImagePath,
  type FixedBoxSlot,
  savePoolLabelSession
} from "./session";

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

type UseBoxLabelOptions = {
  workspaceRoot: string;
  focusFilename?: string | null;
  onFocusConsumed?: () => void;
  onReady?: () => void;
};

export function useBoxLabel({
  workspaceRoot,
  focusFilename,
  onFocusConsumed,
  onReady
}: UseBoxLabelOptions) {
  const { getBoxLabelCache, patchBoxLabelCacheLabelIndex, setBoxLabelCache } = useWorkspaceCache();
  const root = workspaceRoot.trim();
  const [datasetRoot, setDatasetRoot] = useState("");
  const [allEntries, setAllEntries] = useState<BoxLabelEntry[]>([]);
  const [labelIndex, setLabelIndex] = useState<Map<string, Set<number>>>(new Map());
  const [metadata, setMetadata] = useState<Map<string, MetadataRow>>(new Map());
  const [includeClasses, setIncludeClasses] = useState<Set<number>>(new Set());
  const [excludeClasses, setExcludeClasses] = useState<Set<number>>(new Set());
  const [imageViewMode, setImageViewMode] = useState<"all" | "hideReviewed" | "flagged">("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [galleryScrollTop, setGalleryScrollTop] = useState<number | null>(null);
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null);
  const [restoreImagePath, setRestoreImagePath] = useState("");
  const [shiftSelectedBasenames, setShiftSelectedBasenames] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);
  const [initialShortcutSlots, setInitialShortcutSlots] = useState<Array<number | null> | null>(null);
  const [initialFixedBoxSlots, setInitialFixedBoxSlots] = useState<Array<FixedBoxSlot | null> | null>(null);
  const [initialPointerToolEnabled, setInitialPointerToolEnabled] = useState(false);
  const [initialAutoFitEnabled, setInitialAutoFitEnabled] = useState(false);
  const [canUndoJunk, setCanUndoJunk] = useState(false);
  const [statusText, setStatusText] = useState("");
  const readyNotified = useRef(false);
  const sessionSaveTimer = useRef<number | null>(null);
  const shortcutSlotsRef = useRef<Array<number | null> | null>(null);
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

  const resolveIndex = useCallback((list: BoxLabelEntry[], basename: string) => {
    if (!basename) return 0;
    const index = list.findIndex((entry) => entry.basename === basename);
    return index >= 0 ? index : 0;
  }, []);

  const resolveIndexByImagePath = useCallback((list: BoxLabelEntry[], imagePath: string) => {
    if (!imagePath) return 0;
    const index = list.findIndex((entry) => entry.imagePath === imagePath);
    if (index >= 0) return index;
    const basename = imagePath.replace(/^image_pool\//, "");
    return resolveIndex(list, basename);
  }, [resolveIndex]);

  const load = useCallback(async (options: { background?: boolean } = {}) => {
    if (!root) {
      setAllEntries([]);
      setDatasetRoot("");
      setError("Open a workspace first.");
      notifyReady();
      return;
    }

    const cached = getBoxLabelCache(root);
    const cacheFresh = cached && Date.now() - cached.cachedAt < BOX_LABEL_CACHE_MS ? cached : null;
    if (cacheFresh && !options.background) {
      setDatasetRoot(cacheFresh.datasetRoot);
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
        loadDetectDatasetEntries(root),
        readWorkspaceSessionLite(root),
        loadMetadataMap(root).catch(() => new Map<string, MetadataRow>())
      ]);
      setDatasetRoot(dataset.datasetRoot);
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
      shortcutSlots?: Array<number | null>,
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
    (slots: Array<number | null>, fixedSlots?: Array<FixedBoxSlot | null>) => {
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

  const reloadMetadata = useCallback(async () => {
    if (!root) return;
    setMetadata(await loadMetadataMap(root));
  }, [root]);

  const markJunk = useCallback(async () => {
    if (!root) return;
    const targets = (
      selectedBasenames.size > 0
        ? [...selectedBasenames]
        : currentEntry
          ? [currentEntry.basename]
          : []
    ).filter((name) => !isDetectJunk(metadata.get(name)));
    if (!targets.length) {
      setStatusText("Selected images are already Detect junk.");
      return;
    }
    const targetSet = new Set(targets);
    const previousEntries = allEntries;
    pushJunkUndo("pool-label", root, targets, metadata);
    setCanUndoJunk(hasJunkUndo("pool-label", root));
    setShiftSelectedBasenames(new Set());
    setSelectionAnchorIndex(null);
    setMetadata((current) => {
      const next = new Map(current);
      for (const filename of targets) {
        const row = next.get(filename);
        next.set(filename, { ...(row || { filename }), filename, detect_junk: true, detect_enabled: false });
      }
      return next;
    });
    setAllEntries((current) => current.filter((entry) => !targetSet.has(entry.basename)));
    setCurrentIndex((index) => {
      const remaining = entries.filter((entry) => !targetSet.has(entry.basename));
      if (!remaining.length) return 0;
      return Math.min(index, remaining.length - 1);
    });
    setStatusText(`Marked ${targets.length} image(s) as Detect junk.`);
    try {
      await markJunkFilenames(root, targets, "detect");
      await reloadMetadata();
    } catch (err) {
      setAllEntries(previousEntries);
      await reloadMetadata().catch(() => {});
      setStatusText(errMessage(err));
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
    const pendingCount = names.filter((name) => !isDetectJunk(metadata.get(name))).length;
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
    updateLabelIndexForFile,
    reloadMetadata,
    markJunk,
    undoJunk,
    canUndoJunk,
    junkButtonLabel,
    statusText,
    setStatusText,
    reload: load
  };
}
