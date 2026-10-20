import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import type { LabelBox } from "../../api";
import { useConfirm } from "../../components/useConfirm";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import {
  isJunkFile,
  loadMetadataMap,
  markJunkFilenames,
  restoreMetadataSnapshots
} from "../image-pool/metadata";
import { hasJunkUndo, popJunkUndo, pushJunkUndo } from "../shared/junkUndo";
import type { JunkScope, MetadataRow } from "../image-pool/types";
import { revokeDatasetImageUrls } from "./datasetAssets";
import {
  buildLabelIndex,
  classDisplay,
  DatasetPair,
  findPairs,
  inferDatasetTask,
  readClassNamesFromDataset,
  resolveClassificationTargetClass
} from "./datasetCore";
import type { DatasetTask } from "./datasetCore";
import { mergeCropQueue, pairToCropItem, readCropQueue, saveCropQueue } from "../shared/cropQueue";
import { boxesToText, resolveLabelPathForWrite } from "./labelUtils";
import { readDatasetReviewSession, saveDatasetReviewSession, type ImageViewMode, type YoloViewMode } from "./session";

type UseDatasetReviewOptions = {
  workspaceRoot: string;
  onReady?: () => void;
};

export function useDatasetReview({ workspaceRoot, onReady }: UseDatasetReviewOptions) {
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const root = workspaceRoot.trim();
  const [mode, setMode] = useState<YoloViewMode>("detect");
  const [datasetRoot, setDatasetRoot] = useState("");
  const [datasetTask, setDatasetTask] = useState<DatasetTask>("detect");
  const [allPairs, setAllPairs] = useState<DatasetPair[]>([]);
  const [pairs, setPairs] = useState<DatasetPair[]>([]);
  const [classNames, setClassNames] = useState<Map<number, string>>(new Map());
  const [labelCache, setLabelCache] = useState<Map<string, LabelBox[]>>(new Map());
  const [classIndex, setClassIndex] = useState<Map<number, Set<string>>>(new Map());
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [exclude, setExclude] = useState<Set<number>>(new Set());
  const [imageViewMode, setImageViewMode] = useState<ImageViewMode>("all");
  const [reviewedPaths, setReviewedPaths] = useState<Set<string>>(new Set());
  const [flaggedPaths, setFlaggedPaths] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [shiftSelectedPaths, setShiftSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<Map<string, MetadataRow>>(new Map());
  const [junkScope, setJunkScope] = useState<JunkScope>("detect");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [restoreGalleryScrollTop, setRestoreGalleryScrollTop] = useState<number | null>(null);
  const galleryScrollTopRef = useRef(0);
  const [selectedClassHint, setSelectedClassHint] = useState("");
  const [canUndoJunk, setCanUndoJunk] = useState(false);
  const readyNotified = useRef(false);
  const sessionTimer = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const loadDatasetRef = useRef<(mode: YoloViewMode, options?: { silent?: boolean }) => Promise<void>>(async () => {});
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const notifyReady = useCallback(() => {
    if (readyNotified.current) return;
    readyNotified.current = true;
    onReadyRef.current?.();
  }, []);

  const currentPair = pairs[currentIndex] || null;

  const currentBoxes = useMemo(() => {
    if (!currentPair) return [];
    return labelCache.get(currentPair.imagePath) || [];
  }, [currentPair, labelCache]);

  const canSendToCrop = mode === "clf" && datasetTask === "classify" && Boolean(datasetRoot);

  const rebuildClassIndex = useCallback((cache: Map<string, LabelBox[]>, sourcePairs: DatasetPair[]) => {
    const index = new Map<number, Set<string>>();
    for (const pair of sourcePairs) {
      for (const box of cache.get(pair.imagePath) || []) {
        if (!index.has(box.classId)) index.set(box.classId, new Set());
        index.get(box.classId)!.add(pair.imagePath);
      }
    }
    return index;
  }, []);

  const updateLabelCache = useCallback(
    (imagePath: string, boxes: LabelBox[]) => {
      setLabelCache((current) => {
        const next = new Map(current);
        next.set(imagePath, boxes);
        const nextIndex = rebuildClassIndex(next, allPairs);
        setClassIndex(nextIndex);
        return next;
      });
    },
    [allPairs, rebuildClassIndex]
  );

  const applyFilters = useCallback(
    (
      sourcePairs: DatasetPair[],
      nextInclude: Set<number>,
      nextExclude: Set<number>,
      nextImageViewMode: ImageViewMode,
      nextReviewed: Set<string>,
      nextFlagged: Set<string>,
      indexClassIndex: Map<number, Set<string>>
    ) => {
      let allowed = new Set(sourcePairs.map((pair) => pair.imagePath));
      if (nextInclude.size) {
        allowed = new Set();
        for (const classId of nextInclude) {
          for (const path of indexClassIndex.get(classId) || []) allowed.add(path);
        }
      }
      for (const classId of nextExclude) {
        for (const path of indexClassIndex.get(classId) || []) allowed.delete(path);
      }
      if (nextImageViewMode === "hideReviewed") {
        for (const path of nextReviewed) allowed.delete(path);
      } else if (nextImageViewMode === "flagged") {
        allowed = new Set([...allowed].filter((path) => nextFlagged.has(path)));
      }
      return sourcePairs.filter((pair) => allowed.has(pair.imagePath));
    },
    []
  );

  const recomputePairs = useCallback(
    (
      source = allPairs,
      nextInclude = include,
      nextExclude = exclude,
      nextImageViewMode = imageViewMode,
      nextReviewed = reviewedPaths,
      nextFlagged = flaggedPaths,
      index = classIndex
    ) => {
      const filtered = applyFilters(source, nextInclude, nextExclude, nextImageViewMode, nextReviewed, nextFlagged, index);
      setPairs(filtered);
      return filtered;
    },
    [allPairs, applyFilters, classIndex, exclude, flaggedPaths, imageViewMode, include, reviewedPaths]
  );

  const queueSessionSave = useCallback(
    (fields: {
      reviewedPaths?: Set<string>;
      flaggedPaths?: Set<string>;
      currentImagePath?: string;
      galleryScrollTop?: number;
      yoloViewMode?: YoloViewMode;
      imageViewMode?: ImageViewMode;
      includeClassIds?: Set<number>;
      excludeClassIds?: Set<number>;
    }) => {
      if (!root) return;
      if (sessionTimer.current) window.clearTimeout(sessionTimer.current);
      sessionTimer.current = window.setTimeout(() => {
        saveDatasetReviewSession(root, {
          reviewedPaths: [...(fields.reviewedPaths ?? reviewedPaths)],
          flaggedPaths: [...(fields.flaggedPaths ?? flaggedPaths)],
          currentImagePath: fields.currentImagePath ?? currentPair?.imagePath ?? "",
          galleryScrollTop: fields.galleryScrollTop ?? galleryScrollTopRef.current,
          yoloViewMode: fields.yoloViewMode ?? mode,
          imageViewMode: fields.imageViewMode ?? imageViewMode,
          includeClassIds: [...(fields.includeClassIds ?? include)],
          excludeClassIds: [...(fields.excludeClassIds ?? exclude)]
        }).catch(() => {});
      }, 500);
    },
    [currentPair?.imagePath, exclude, flaggedPaths, imageViewMode, include, mode, reviewedPaths, root]
  );

  const loadDataset = useCallback(
    async (nextMode: YoloViewMode, options: { silent?: boolean } = {}) => {
      if (!root) {
        setError("Open a workspace first.");
        notifyReady();
        return;
      }
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!options.silent) setPending(true);
      setError("");
      revokeDatasetImageUrls();
      try {
        const info = await api.getWorkspaceInfo(root);
        if (!info.ok) throw new Error(info.error || "Cannot read workspace info.");
        const [session, meta] = await Promise.all([readDatasetReviewSession(root), loadMetadataMap(root)]);
        const datasetPath = nextMode === "clf" ? info.clfDataset : info.detectDataset;
        if (!datasetPath) {
          throw new Error(`${nextMode === "clf" ? "Clf" : "Detect"} dataset path is missing in workspace config.`);
        }
        setMode(nextMode);
        setJunkScope(nextMode);
        setDatasetRoot(datasetPath);
        setReviewedPaths(new Set(session.reviewedPaths));
        setFlaggedPaths(new Set(session.flaggedPaths));
        setRestoreGalleryScrollTop(session.galleryScrollTop ?? null);
        galleryScrollTopRef.current = session.galleryScrollTop ?? 0;
        setImageViewMode(session.imageViewMode || "all");
        setInclude(new Set(session.includeClassIds || []));
        setExclude(new Set(session.excludeClassIds || []));
        setMetadata(meta);

        const paths = await api.listDatasetFiles(datasetPath);
        const fileSet = new Set(paths);
        const task = inferDatasetTask(fileSet);
        const found = findPairs(fileSet, task);
        setDatasetTask(task);
        const names = await readClassNamesFromDataset(datasetPath, fileSet);
        setClassNames(names);
        setAllPairs(found);
        const indexResult = await buildLabelIndex(datasetPath, found, task, (done, total) => {
          if (!options.silent) setStatus(`Indexing labels... ${done}/${total}`);
        });
        setLabelCache(indexResult.labelCache);
        setClassIndex(indexResult.classIndex);

        const filtered = applyFilters(
          found,
          new Set(session.includeClassIds || []),
          new Set(session.excludeClassIds || []),
          session.imageViewMode || "all",
          new Set(session.reviewedPaths),
          new Set(session.flaggedPaths),
          indexResult.classIndex
        );
        setPairs(filtered);
        const resumePath = session.currentImagePath;
        const resumeIndex = resumePath ? filtered.findIndex((pair) => pair.imagePath === resumePath) : 0;
        setCurrentIndex(resumeIndex >= 0 ? resumeIndex : 0);
        setStatus(`${nextMode === "clf" ? "Clf" : "Detect"} dataset: ${found.length} image(s).`);
        notifyReady();
      } catch (err) {
        setError(errMessage(err));
        notifyReady();
      } finally {
        loadingRef.current = false;
        if (!options.silent) setPending(false);
      }
    },
    [applyFilters, notifyReady, root]
  );

  loadDatasetRef.current = loadDataset;

  useEffect(() => {
    readyNotified.current = false;
    if (!root) {
      notifyReady();
      return;
    }
    readDatasetReviewSession(root)
      .then((session) => loadDatasetRef.current(session.yoloViewMode || "detect"))
      .catch((err) => {
        setError(errMessage(err));
        notifyReady();
      });
    return () => revokeDatasetImageUrls();
  }, [root, notifyReady]);

  const switchMode = useCallback(
    (nextMode: YoloViewMode) => {
      loadDataset(nextMode).catch(() => {});
      queueSessionSave({ yoloViewMode: nextMode });
    },
    [loadDataset, queueSessionSave]
  );

  const navigate = useCallback(
    (index: number) => {
      if (index < 0 || index >= pairs.length) return;
      setCurrentIndex(index);
      setSelectedBoxIndex(null);
      queueSessionSave({ currentImagePath: pairs[index]?.imagePath });
    },
    [pairs, queueSessionSave]
  );

  const selectGallery = useCallback(
    (index: number, options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
      const pair = pairs[index];
      if (!pair) return;
      if (options.shiftKey) {
        const anchor = selectionAnchorIndex ?? currentIndex;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const next = new Set(shiftSelectedPaths);
        for (let i = start; i <= end; i += 1) {
          const item = pairs[i];
          if (item) next.add(item.imagePath);
        }
        setShiftSelectedPaths(next);
        return;
      }
      if (options.ctrlKey || options.metaKey) {
        setSelectionAnchorIndex(index);
        setShiftSelectedPaths((current) => {
          const next = new Set(current);
          if (next.has(pair.imagePath)) next.delete(pair.imagePath);
          else next.add(pair.imagePath);
          return next;
        });
        return;
      }
      setSelectionAnchorIndex(index);
      setShiftSelectedPaths(new Set());
      navigate(index);
    },
    [currentIndex, navigate, pairs, selectionAnchorIndex, shiftSelectedPaths]
  );

  const selectedPairs = useMemo(() => {
    const paths = new Set(shiftSelectedPaths);
    if (currentPair) paths.add(currentPair.imagePath);
    const byPath = new Map(allPairs.map((pair) => [pair.imagePath, pair]));
    return [...paths].map((path) => byPath.get(path)).filter(Boolean) as DatasetPair[];
  }, [allPairs, currentPair, shiftSelectedPaths]);

  const canSendToDetect = mode === "clf" && datasetTask === "classify" && Boolean(root) && selectedPairs.length > 0;

  const toggleReviewed = useCallback(async () => {
    if (!selectedPairs.length) return;
    const shouldReview = selectedPairs.some((pair) => !reviewedPaths.has(pair.imagePath));
    const next = new Set(reviewedPaths);
    for (const pair of selectedPairs) {
      if (shouldReview) next.add(pair.imagePath);
      else next.delete(pair.imagePath);
    }
    setReviewedPaths(next);
    recomputePairs(allPairs, include, exclude, imageViewMode, next, flaggedPaths);
    queueSessionSave({ reviewedPaths: next });
  }, [allPairs, exclude, flaggedPaths, imageViewMode, include, queueSessionSave, recomputePairs, reviewedPaths, selectedPairs]);

  const toggleFlagged = useCallback(async () => {
    if (!currentPair) return;
    const next = new Set(flaggedPaths);
    if (next.has(currentPair.imagePath)) next.delete(currentPair.imagePath);
    else next.add(currentPair.imagePath);
    setFlaggedPaths(next);
    recomputePairs(allPairs, include, exclude, imageViewMode, reviewedPaths, next);
    queueSessionSave({ flaggedPaths: next });
  }, [allPairs, currentPair, exclude, flaggedPaths, imageViewMode, include, queueSessionSave, recomputePairs, reviewedPaths]);

  const nextIssue = useCallback(() => {
    for (let i = currentIndex + 1; i < pairs.length; i += 1) {
      const path = pairs[i]?.imagePath;
      if (path && (!reviewedPaths.has(path) || flaggedPaths.has(path))) {
        navigate(i);
        return;
      }
    }
    for (let i = 0; i < currentIndex; i += 1) {
      const path = pairs[i]?.imagePath;
      if (path && (!reviewedPaths.has(path) || flaggedPaths.has(path))) {
        navigate(i);
        return;
      }
    }
    setStatus("No more issues in the current filter.");
  }, [currentIndex, flaggedPaths, navigate, pairs, reviewedPaths]);

  const toggleInclude = useCallback(
    (classId: number, checked: boolean) => {
      const next = new Set(include);
      if (checked) next.add(classId);
      else next.delete(classId);
      setInclude(next);
      recomputePairs(allPairs, next, exclude, imageViewMode, reviewedPaths, flaggedPaths);
      queueSessionSave({ includeClassIds: next });
    },
    [allPairs, exclude, flaggedPaths, imageViewMode, include, queueSessionSave, recomputePairs, reviewedPaths]
  );

  const toggleExclude = useCallback(
    (classId: number, checked: boolean) => {
      const next = new Set(exclude);
      if (checked) next.add(classId);
      else next.delete(classId);
      setExclude(next);
      recomputePairs(allPairs, include, next, imageViewMode, reviewedPaths, flaggedPaths);
      queueSessionSave({ excludeClassIds: next });
    },
    [allPairs, exclude, flaggedPaths, imageViewMode, include, queueSessionSave, recomputePairs, reviewedPaths]
  );

  const clearInclude = useCallback(() => {
    setInclude(new Set());
    recomputePairs(allPairs, new Set(), exclude, imageViewMode, reviewedPaths, flaggedPaths);
    queueSessionSave({ includeClassIds: new Set() });
  }, [allPairs, exclude, flaggedPaths, imageViewMode, queueSessionSave, recomputePairs, reviewedPaths]);

  const clearExclude = useCallback(() => {
    setExclude(new Set());
    recomputePairs(allPairs, include, new Set(), imageViewMode, reviewedPaths, flaggedPaths);
    queueSessionSave({ excludeClassIds: new Set() });
  }, [allPairs, flaggedPaths, imageViewMode, include, queueSessionSave, recomputePairs, reviewedPaths]);

  const clearFilters = useCallback(() => {
    setInclude(new Set());
    setExclude(new Set());
    recomputePairs(allPairs, new Set(), new Set(), imageViewMode, reviewedPaths, flaggedPaths);
    queueSessionSave({ includeClassIds: new Set(), excludeClassIds: new Set() });
  }, [allPairs, flaggedPaths, imageViewMode, queueSessionSave, recomputePairs, reviewedPaths]);

  const persistBoxes = useCallback(
    async (boxes: LabelBox[]) => {
      if (!currentPair || !datasetRoot || datasetTask === "classify") return;
      const labelPath = resolveLabelPathForWrite(currentPair, datasetTask);
      if (!labelPath) throw new Error("Cannot resolve label path.");
      await api.writeTextFile(datasetRoot, labelPath, boxesToText(boxes));
      updateLabelCache(currentPair.imagePath, boxes);
      if (!currentPair.labelPath) {
        setAllPairs((current) =>
          current.map((pair) =>
            pair.imagePath === currentPair.imagePath ? { ...pair, labelPath } : pair
          )
        );
      }
      setStatus(`Saved labels for ${currentPair.imagePath.split("/").pop()}.`);
    },
    [currentPair, datasetRoot, datasetTask, updateLabelCache]
  );

  const sendFilteredToCrop = useCallback(async () => {
    if (!canSendToCrop || !root) {
      throw new Error("请先在 YOLO View 打开分类数据集。");
    }
    if (!pairs.length) throw new Error("当前没有可见图片。");
    const queue = await readCropQueue(root);
    const items = pairs.map((pair) =>
      pairToCropItem(datasetRoot, pair.imagePath, pair.className || classDisplay(classNames, pair.classId ?? 0))
    );
    const { queue: nextQueue, added } = mergeCropQueue(queue, items, {
      source: "filtered",
      label: `当前可见列表 (${pairs.length})`
    });
    if (!added) throw new Error("没有新图片加入队列（可能已在队列中）。");
    await saveCropQueue(root, nextQueue);
    setStatus(`已加入裁切队列：${added} 张（共 ${nextQueue.items.length} 张）`);
    return added;
  }, [canSendToCrop, classNames, datasetRoot, pairs, root]);

  const sendClassToCrop = useCallback(
    async (classId: number) => {
      if (!canSendToCrop || !root) {
        throw new Error("请先在 YOLO View 打开分类数据集。");
      }
      const paths = classIndex.get(classId) || new Set<string>();
      if (!paths.size) throw new Error("该类没有图片。");
      const byPath = new Map(allPairs.map((pair) => [pair.imagePath, pair]));
      const queue = await readCropQueue(root);
      const items = [...paths].map((imagePath) => {
        const pair = byPath.get(imagePath);
        const className = pair?.className || classDisplay(classNames, classId);
        return pairToCropItem(datasetRoot, imagePath, className);
      });
      const label = `class ${classDisplay(classNames, classId)} (${paths.size})`;
      const { queue: nextQueue, added } = mergeCropQueue(queue, items, { source: "class", label });
      if (!added) throw new Error("没有新图片加入队列（可能已在队列中）。");
      await saveCropQueue(root, nextQueue);
      setStatus(`已加入裁切队列：${added} 张（${label}）`);
      return added;
    },
    [allPairs, canSendToCrop, classIndex, classNames, datasetRoot, root]
  );

  const sendSelectedToDetect = useCallback(async () => {
    if (!canSendToDetect || !root) throw new Error("请先在 Clf 分类数据集下选择图片。");
    const filenames = [
      ...new Set(
        selectedPairs
          .map((pair) => pair.imagePath.split("/").pop())
          .filter(Boolean) as string[]
      )
    ];
    const pending = filenames.filter((filename) => {
      const row = metadata.get(filename);
      if (isJunkFile(row, "detect")) return false;
      return !row?.detect_enabled;
    });
    if (!pending.length) throw new Error("所选图片无法发送到 Detect（废片或已在 Detect 中）。");
    if (
      !(await confirm({
        title: "Send to Detect",
        message: `将 ${pending.length} 张图片发送到 Detect？\n\n会把它们标记为参与 Detect（detect_enabled=1）；下次导出数据集时生效。`,
        confirmLabel: "Send"
      }))
    ) {
      return;
    }
    await api.upsertMetadataRows(
      root,
      pending.map((filename) => ({ filename, detect_enabled: true }))
    );
    setMetadata(await loadMetadataMap(root));
    setStatus(`已发送 ${pending.length} 张到 Detect，下次导出数据集时生效。`);
  }, [canSendToDetect, confirm, metadata, root, selectedPairs]);

  const addClassificationFolder = useCallback(
    async (rawInput: string) => {
      if (datasetTask !== "classify") throw new Error("Add Folder is for classification datasets.");
      if (!datasetRoot) throw new Error("Dataset not loaded.");
      const target = resolveClassificationTargetClass(rawInput, classNames);
      if (!target.folderName) throw new Error("Enter a class ID or folder name first.");
      if (target.matched) {
        throw new Error(`Class ${target.folderName} already exists. Use Move Selected instead.`);
      }
      const result = await api.createClassFolder(datasetRoot, target.folderName);
      setStatus(`Class folder ready: ${result.relativePath || result.className || target.folderName}`);
      await loadDataset(mode, { silent: true });
    },
    [classNames, datasetRoot, datasetTask, loadDataset, mode]
  );

  const moveSelectedImagesToClass = useCallback(
    async (rawInput: string) => {
      if (datasetTask !== "classify") throw new Error("Move Selected is for classification datasets.");
      if (!datasetRoot) throw new Error("Dataset not loaded.");
      const target = resolveClassificationTargetClass(rawInput, classNames);
      if (!target.folderName) throw new Error("Enter a target class ID or folder name first.");
      if (!selectedPairs.length) throw new Error("Select one or more images first.");
      const label =
        target.classId != null && classNames.has(target.classId)
          ? classDisplay(classNames, target.classId)
          : target.folderName;
      if (!(await confirm({ title: "Move images", message: `Move ${selectedPairs.length} image(s) to ${label}?`, confirmLabel: "Move" }))) return;
      const result = await api.moveImagesToClass(
        datasetRoot,
        selectedPairs.map((pair) => pair.imagePath),
        target.folderName
      );
      const preferred = result.moved?.[0]?.to || currentPair?.imagePath || "";
      setStatus(`Moved ${result.moved?.length || 0} image(s) to ${label}.`);
      await loadDataset(mode, { silent: true });
      if (preferred) {
        const index = pairs.findIndex((pair) => pair.imagePath === preferred);
        if (index >= 0) navigate(index);
      }
      if (result.skipped?.length) {
        showToast(`Moved ${result.moved?.length || 0} image(s).\nSkipped ${result.skipped.length}.`, { variant: "info" });
      }
    },
    [classNames, confirm, currentPair?.imagePath, datasetRoot, datasetTask, loadDataset, mode, navigate, pairs, selectedPairs, showToast]
  );

  const changeImageViewMode = useCallback(
    (next: ImageViewMode) => {
      setImageViewMode(next);
      recomputePairs(allPairs, include, exclude, next, reviewedPaths, flaggedPaths);
      queueSessionSave({ imageViewMode: next });
    },
    [allPairs, exclude, flaggedPaths, include, queueSessionSave, recomputePairs, reviewedPaths]
  );

  const markJunk = useCallback(async () => {
    if (!root) return;
    const filenames = selectedPairs
      .map((pair) => pair.imagePath.split("/").pop())
      .filter(Boolean) as string[];
    const targets = filenames.filter((name) => !isJunkFile(metadata.get(name), junkScope));
    if (!targets.length) return;
    pushJunkUndo("yolo-review", root, targets, metadata);
    await markJunkFilenames(root, targets, junkScope);
    setMetadata(await loadMetadataMap(root));
    setCanUndoJunk(hasJunkUndo("yolo-review", root));
    await loadDataset(mode, { silent: true });
  }, [junkScope, loadDataset, metadata, mode, root, selectedPairs]);

  const undoJunk = useCallback(async () => {
    if (!root) return;
    const snapshots = popJunkUndo("yolo-review", root);
    if (!snapshots?.length) return;
    await restoreMetadataSnapshots(root, snapshots);
    setMetadata(await loadMetadataMap(root));
    setCanUndoJunk(hasJunkUndo("yolo-review", root));
    await loadDataset(mode, { silent: true });
  }, [loadDataset, mode, root]);

  const selectedClassItems = useMemo(() => {
    const pairs = selectedPairs;
    if (!pairs.length) return [];
    const counts = new Map<number, { name: string; count: number }>();
    if (datasetTask === "classify") {
      const nameCounts = new Map<string, number>();
      for (const pair of pairs) {
        const key = pair.className || "(unknown)";
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
      }
      return [...nameCounts.entries()].map(([name, count], index) => ({
        id: index,
        name,
        count,
        total: pairs.length
      }));
    }
    for (const pair of pairs) {
      for (const box of labelCache.get(pair.imagePath) || []) {
        const existing = counts.get(box.classId);
        counts.set(box.classId, {
          name: classDisplay(classNames, box.classId),
          count: (existing?.count || 0) + 1
        });
      }
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, item]) => ({ id, name: item.name, count: item.count, total: pairs.length }));
  }, [classNames, datasetTask, labelCache, selectedPairs]);

  const addClassesToFilter = useCallback(
    (classIds: number[], type: "include" | "exclude") => {
      if (!classIds.length) return;
      const nextInclude = new Set(include);
      const nextExclude = new Set(exclude);
      const target = type === "include" ? nextInclude : nextExclude;
      classIds.forEach((id) => target.add(id));
      setInclude(nextInclude);
      setExclude(nextExclude);
      recomputePairs(allPairs, nextInclude, nextExclude, imageViewMode, reviewedPaths, flaggedPaths);
      setSelectedClassHint(`Added ${classIds.length} class(es) to ${type}.`);
    },
    [allPairs, exclude, flaggedPaths, imageViewMode, include, recomputePairs, reviewedPaths]
  );

  const removeSelectedClasses = useCallback(
    async (classIds: number[]) => {
      if (datasetTask === "classify") {
        setSelectedClassHint("Classification classes come from folders.");
        return;
      }
      if (!classIds.length || !selectedPairs.length) return;
      const idSet = new Set(classIds);
      let changedImages = 0;
      let removedBoxes = 0;
      for (const pair of selectedPairs) {
        const boxes = labelCache.get(pair.imagePath) || [];
        const kept = boxes.filter((box) => !idSet.has(box.classId));
        const removed = boxes.length - kept.length;
        if (!removed) continue;
        const labelPath = resolveLabelPathForWrite(pair, datasetTask);
        if (!labelPath) continue;
        await api.writeTextFile(datasetRoot, labelPath, boxesToText(kept));
        updateLabelCache(pair.imagePath, kept);
        changedImages += 1;
        removedBoxes += removed;
      }
      setSelectedBoxIndex(null);
      recomputePairs(allPairs, include, exclude, imageViewMode, reviewedPaths, flaggedPaths);
      setSelectedClassHint(`Removed ${removedBoxes} box(es) from ${changedImages} image(s).`);
    },
    [
      allPairs,
      datasetRoot,
      datasetTask,
      exclude,
      flaggedPaths,
      imageViewMode,
      include,
      labelCache,
      recomputePairs,
      reviewedPaths,
      selectedPairs,
      updateLabelCache
    ]
  );

  const filterStatus = useMemo(() => {
    const parts: string[] = [];
    if (include.size) {
      parts.push(`include: ${[...include].sort((a, b) => a - b).map((id) => classDisplay(classNames, id)).join(", ")}`);
    }
    if (exclude.size) {
      parts.push(`exclude: ${[...exclude].sort((a, b) => a - b).map((id) => classDisplay(classNames, id)).join(", ")}`);
    }
    return parts.length ? parts.join("; ") : "No class filter. Showing all images.";
  }, [classNames, exclude, include]);

  const classFilterItems = useMemo(() => {
    const ids = new Set([...classNames.keys(), ...classIndex.keys()]);
    return [...ids].sort((a, b) => a - b).map((id) => ({
      id,
      name: classDisplay(classNames, id),
      imageCount: classIndex.get(id)?.size || 0
    }));
  }, [classIndex, classNames]);

  return {
    mode,
    datasetRoot,
    datasetTask,
    pairs,
    allPairs,
    classNames,
    labelCache,
    currentIndex,
    currentPair,
    currentBoxes,
    selectedBoxIndex,
    setSelectedBoxIndex,
    shiftSelectedPaths,
    reviewedPaths,
    flaggedPaths,
    imageViewMode,
    include,
    exclude,
    metadata,
    junkScope,
    pending,
    error,
    status,
    filterStatus,
    classFilterItems,
    canUndoJunk,
    canSendToCrop,
    canSendToDetect,
    restoreGalleryScrollTop,
    clearGalleryRestore: () => setRestoreGalleryScrollTop(null),
    selectedClassItems,
    selectedClassHint,
    switchMode,
    navigate,
    selectGallery,
    toggleReviewed,
    toggleFlagged,
    nextIssue,
    toggleInclude,
    toggleExclude,
    clearInclude,
    clearExclude,
    clearFilters,
    addClassesToFilter,
    removeSelectedClasses,
    persistBoxes,
    sendFilteredToCrop,
    sendClassToCrop,
    sendSelectedToDetect,
    addClassificationFolder,
    moveSelectedImagesToClass,
    changeImageViewMode,
    markJunk,
    undoJunk,
    reload: () => loadDataset(mode),
    onGalleryScroll: (scrollTop: number) => {
      galleryScrollTopRef.current = scrollTop;
      queueSessionSave({ galleryScrollTop: scrollTop });
    },
    selectedPairs
  };
}
