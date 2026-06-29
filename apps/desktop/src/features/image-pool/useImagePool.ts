import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import { useConfirm } from "../../components/useConfirm";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import {
  cardExtraClasses,
  clearJunkFilenames,
  isJunkFile,
  junkLabelForFile,
  loadMetadataMap,
  markJunkFilenames,
  passesHideJunk,
} from "./metadata";
import { hasJunkUndo, popJunkUndo, pushJunkUndo } from "../shared/junkUndo";
import { restoreJunkUndoWithLinks } from "../shared/junkMetadata";
import { useWorkspaceCache } from "../shared/useWorkspaceCache";
import { dispatchWorkspaceMediaChanged } from "../shared/mediaEvents";
import {
  IMAGE_POOL_CACHE_MS,
} from "../shared/workspaceCache";
import { parseImagePoolUi, readWorkspaceSessionLite, saveImagePoolSession } from "./session";
import type {
  DuplicateScan,
  FilteredItem,
  HideJunkMode,
  ImagePoolFilter,
  ImagePoolUiSession,
  JunkScope,
  MetadataRow
} from "./types";

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function filterItems(
  files: api.ImagePoolItem[],
  metadata: Map<string, MetadataRow>,
  filter: ImagePoolFilter,
  hideJunk: HideJunkMode
): FilteredItem[] {
  const sorted = [...files].sort((a, b) => naturalCompare(a.filename, b.filename));
  return sorted
    .filter((item) => {
      const row = metadata.get(item.filename);
      if (!passesHideJunk(row, hideJunk)) return false;
      if (filter === "junk-detect") return isJunkFile(row, "detect");
      if (filter === "junk-clf") return isJunkFile(row, "clf");
      if (filter === "junk-both") return isJunkFile(row, "both");
      if (filter === "all") return true;
      if (filter === "new") return item.isNew;
      if (filter === "unused") return !item.isUsed;
      if (filter === "used") return item.isUsed;
      return true;
    })
    .map((item) => ({ ...item, imagePath: item.imagePath || `media/${item.filename}` }));
}

function junkCounts(files: api.ImagePoolItem[], metadata: Map<string, MetadataRow>) {
  let detect = 0;
  let clf = 0;
  let both = 0;
  for (const item of files) {
    const row = metadata.get(item.filename);
    const d = isJunkFile(row, "detect");
    const c = isJunkFile(row, "clf");
    if (d) detect += 1;
    if (c) clf += 1;
    if (d && c) both += 1;
  }
  return { detect, clf, both };
}

type UseImagePoolOptions = {
  workspaceRoot: string;
  onReady?: () => void;
  onScanUpdate?: (scan: api.ImagePoolScan | null) => void;
};

const IMAGE_POOL_SCAN_CACHE_MS = IMAGE_POOL_CACHE_MS;

export function useImagePool({ workspaceRoot, onReady, onScanUpdate }: UseImagePoolOptions) {
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const {
    getImagePoolCache,
    invalidateBoxLabelCache,
    patchImagePoolCacheMetadata,
    setImagePoolCache
  } = useWorkspaceCache();
  const root = workspaceRoot.trim();
  const [scan, setScan] = useState<api.ImagePoolScan | null>(null);
  const [metadata, setMetadata] = useState<Map<string, MetadataRow>>(new Map());
  const [filter, setFilter] = useState<ImagePoolFilter>("all");
  const [junkScope, setJunkScope] = useState<JunkScope>("detect");
  const [hideJunk, setHideJunk] = useState<HideJunkMode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState<api.MediaImportMode | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [duplicateScan, setDuplicateScan] = useState<DuplicateScan | null>(null);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null);
  const [restoreImagePath, setRestoreImagePath] = useState("");
  const [canUndoJunk, setCanUndoJunk] = useState(false);
  const readyNotified = useRef(false);
  const sessionSaveTimer = useRef<number | null>(null);
  const usageScanTimer = useRef<number | null>(null);
  const usageScanScheduled = useRef(false);
  const lastScanAtRef = useRef(0);
  const lastScanUsageRef = useRef(false);
  const scanRef = useRef<api.ImagePoolScan | null>(null);
  const scanningRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const onScanUpdateRef = useRef(onScanUpdate);
  onReadyRef.current = onReady;
  onScanUpdateRef.current = onScanUpdate;

  const notifyReady = useCallback(() => {
    if (readyNotified.current) return;
    readyNotified.current = true;
    onReadyRef.current?.();
  }, []);

  const applyScan = useCallback((value: api.ImagePoolScan | null) => {
    scanRef.current = value;
    setScan(value);
  }, []);

  const items = useMemo(
    () => filterItems(scan?.files || [], metadata, filter, hideJunk),
    [scan, metadata, filter, hideJunk]
  );

  const counts = useMemo(() => junkCounts(scan?.files || [], metadata), [scan, metadata]);

  const reloadMetadata = useCallback(async () => {
    if (!root) return new Map<string, MetadataRow>();
    const map = await loadMetadataMap(root);
    setMetadata(map);
    patchImagePoolCacheMetadata(root, map);
    return map;
  }, [patchImagePoolCacheMetadata, root]);

  const runScan = useCallback(
    async (options: { fast?: boolean; force?: boolean; silent?: boolean } = {}) => {
      if (!root) {
        applyScan(null);
        setError("Enter a workspace root.");
        return null;
      }
      if (scanningRef.current) return scanRef.current;
      const cachedScan = scanRef.current;
      if (
        !options.force &&
        cachedScan &&
        lastScanAtRef.current &&
        Date.now() - lastScanAtRef.current < IMAGE_POOL_SCAN_CACHE_MS
      ) {
        if (options.silent || (options.fast !== false && lastScanUsageRef.current)) {
          return cachedScan;
        }
      }
      if (!options.silent) {
        setPending(true);
        setError("");
      }
      scanningRef.current = true;
      try {
        const result = await api.scanImagePool(root, { fast: options.fast !== false });
        applyScan(result);
        onScanUpdateRef.current?.(result);
        lastScanAtRef.current = Date.now();
        lastScanUsageRef.current = Boolean(result.usageScanned);
        const meta = await reloadMetadata();
        setImagePoolCache(root, {
          scan: result,
          metadata: meta,
          usageScanned: lastScanUsageRef.current
        });
        if (!result.usageScanned && !usageScanScheduled.current) {
          usageScanScheduled.current = true;
          window.clearTimeout(usageScanTimer.current || undefined);
          usageScanTimer.current = window.setTimeout(() => {
            runScan({ fast: false, silent: true }).catch(() => {});
          }, 400);
        }
        notifyReady();
        return result;
      } catch (err) {
        const message = errMessage(err);
        if (!options.silent) setError(message);
        if (!options.silent) notifyReady();
        return null;
      } finally {
        scanningRef.current = false;
        if (!options.silent) setPending(false);
      }
    },
    [applyScan, notifyReady, reloadMetadata, root, setImagePoolCache]
  );

  const persistUiSession = useCallback(
    (overrides: Partial<ImagePoolUiSession> & { scrollTop?: number; viewportImagePath?: string } = {}) => {
      if (!root) return;
      const ui: ImagePoolUiSession = {
        filter: overrides.filter ?? filter,
        junkScope: overrides.junkScope ?? junkScope,
        hideJunk: overrides.hideJunk !== undefined ? overrides.hideJunk : hideJunk,
        scrollTop: Math.max(0, Math.round(overrides.scrollTop ?? 0)),
        viewportImagePath: overrides.viewportImagePath ?? ""
      };
      saveImagePoolSession(root, ui).catch(() => {});
    },
    [root, filter, junkScope, hideJunk]
  );

  useEffect(() => {
    readyNotified.current = false;
    usageScanScheduled.current = false;
    setDuplicateScan(null);
    if (!root) {
      applyScan(null);
      notifyReady();
      return;
    }

    const sharedCache = getImagePoolCache(root);
    const cacheFresh =
      sharedCache && Date.now() - sharedCache.scannedAt < IMAGE_POOL_SCAN_CACHE_MS ? sharedCache : null;
    if (cacheFresh) {
      applyScan(cacheFresh.scan);
      lastScanAtRef.current = cacheFresh.scannedAt;
      lastScanUsageRef.current = cacheFresh.usageScanned;
      if (cacheFresh.metadata) setMetadata(cacheFresh.metadata);
    } else {
      lastScanAtRef.current = 0;
      lastScanUsageRef.current = false;
      applyScan(null);
    }

    let cancelled = false;
    (async () => {
      const session = await readWorkspaceSessionLite(root);
      if (cancelled) return;
      const ui = parseImagePoolUi(session);
      if (ui.filter) setFilter(ui.filter);
      if (ui.junkScope) setJunkScope(ui.junkScope);
      if (ui.hideJunk !== undefined) setHideJunk(ui.hideJunk);
      if (ui.scrollTop) setRestoreScrollTop(ui.scrollTop);
      if (ui.viewportImagePath) setRestoreImagePath(ui.viewportImagePath);
      if (cacheFresh) {
        notifyReady();
        if (!cacheFresh.usageScanned) {
          void runScan({ silent: true, fast: false });
        }
        return;
      }
      await runScan({ silent: false });
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(usageScanTimer.current || undefined);
    };
    // applyScan is intentionally omitted: root change should reset scan state once, not re-bind on every scan callback identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyReady, root, runScan]);

  const queueSessionSave = useCallback(
    (scrollTop: number, viewportImagePath: string) => {
      if (!root) return;
      if (sessionSaveTimer.current) window.clearTimeout(sessionSaveTimer.current);
      sessionSaveTimer.current = window.setTimeout(() => {
        const ui: ImagePoolUiSession = {
          filter,
          junkScope,
          hideJunk,
          scrollTop: Math.max(0, Math.round(scrollTop)),
          viewportImagePath
        };
        saveImagePoolSession(root, ui).catch(() => {});
      }, 500);
    },
    [root, filter, junkScope, hideJunk]
  );

  const selectSingle = useCallback((index: number, filename: string) => {
    setAnchorIndex(index);
    setSelected(new Set([filename]));
  }, []);

  const toggleSelect = useCallback((index: number, filename: string) => {
    setAnchorIndex(index);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const rangeSelect = useCallback(
    (index: number) => {
      const anchor = anchorIndex ?? index;
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      const next = new Set<string>();
      for (let i = start; i <= end; i++) {
        const item = items[i];
        if (item) next.add(item.filename);
      }
      setSelected(next);
    },
    [anchorIndex, items]
  );

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(items.map((item) => item.filename)));
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAnchorIndex(null);
  }, []);

  const changeFilter = useCallback(
    (next: ImagePoolFilter) => {
      setFilter(next);
      setSelected(new Set());
      setAnchorIndex(null);
      setRestoreScrollTop(0);
      setRestoreImagePath("");
      persistUiSession({ filter: next, scrollTop: 0, viewportImagePath: "" });
    },
    [persistUiSession]
  );

  const changeJunkScope = useCallback(
    (next: JunkScope) => {
      setJunkScope(next);
      persistUiSession({ junkScope: next });
    },
    [persistUiSession]
  );

  const toggleHideJunk = useCallback(
    (mode: "detect" | "clf" | "both") => {
      setHideJunk((current) => {
        const next = current === mode ? null : mode;
        persistUiSession({ hideJunk: next });
        return next;
      });
    },
    [persistUiSession]
  );

  const deleteFilenames = useCallback(
    async (filenames: string[]) => {
      if (!filenames.length || !root) return;
      const unique = [...new Set(filenames)];
      const preview = unique.slice(0, 8).join("\n");
      const more = unique.length > 8 ? `\n... plus ${unique.length - 8} more` : "";
      if (
        !(await confirm({
          title: "Delete images",
          message: `Permanently delete ${unique.length} image(s)?\n\nThis removes media files, all detect/clf hard links, detect_labels, and metadata records. This cannot be undone.\n\n${preview}${more}`,
          confirmLabel: "Delete",
          danger: true
        }))
      ) {
        return;
      }
      setDeleting(true);
      let deleted = 0;
      let failed = 0;
      const failures: string[] = [];
      try {
        for (let i = 0; i < unique.length; i++) {
          const filename = unique[i];
          setStatus(`Deleting ${i + 1}/${unique.length}: ${filename}`);
          try {
            const result = await api.deletePoolImageCompletely(root, filename);
            if (result.failedPaths?.length) {
              failed += 1;
              failures.push(`${filename}: ${result.failedPaths.map((item) => item.error).join("; ")}`);
            } else {
              deleted += 1;
            }
          } catch (err) {
            failed += 1;
            failures.push(`${filename}: ${errMessage(err)}`);
          }
        }
        setSelected(new Set());
        await runScan({ force: true, silent: true });
        invalidateBoxLabelCache(root);
        dispatchWorkspaceMediaChanged(root);
        if (duplicateScan?.groups?.length) {
          const dup = (await api.findImagePoolDuplicates(root)) as DuplicateScan;
          setDuplicateScan(dup);
        }
        if (failures.length) {
          showToast(`Some deletes failed (${failed}/${unique.length}):\n${failures.slice(0, 10).join("\n")}`, {
            variant: "error"
          });
        }
        setStatus(`Deleted ${deleted} image(s)${failed ? `; ${failed} failed` : ""}.`);
      } finally {
        setDeleting(false);
        setStatus("");
      }
    },
    [confirm, duplicateScan, invalidateBoxLabelCache, root, runScan, showToast]
  );

  const deleteSelected = useCallback(async () => {
    await deleteFilenames([...selected]);
  }, [deleteFilenames, selected]);

  const markSeen = useCallback(async () => {
    if (!root) return;
    setPending(true);
    try {
      const result = await api.markImagePoolSeen(root);
      await runScan({ force: true });
      setStatus(`Marked ${result.markedCount || 0} media image(s) as seen.`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setPending(false);
    }
  }, [root, runScan]);

  const importMedia = useCallback(
    async (mode: api.MediaImportMode) => {
      if (!root) {
        setError("Open a workspace before importing media.");
        return;
      }
      setPending(true);
      setImporting(mode);
      setError("");
      try {
        const selectedPaths = await api.chooseMediaFiles(
          mode === "move" ? "Move Media into Workspace Media" : "Copy Media into Workspace Media"
        );
        if (!selectedPaths.length) {
          setStatus("");
          return;
        }
        setStatus(`${mode === "move" ? "Moving" : "Copying"} ${selectedPaths.length} media file(s) into media...`);
        const result = await api.importMediaFiles(root, selectedPaths, mode);
        await runScan({ force: true, silent: true });
        invalidateBoxLabelCache(root);
        dispatchWorkspaceMediaChanged(root);
        const skipped = result.skippedCount ? `, ${result.skippedCount} skipped` : "";
        const failed = result.failedCount ? `, ${result.failedCount} failed` : "";
        const message = `${mode === "move" ? "Moved" : "Copied"} ${result.importedCount} media file(s) into media${skipped}${failed}.`;
        setStatus(message);
        showToast(message, { variant: result.failedCount ? "error" : "success" });
      } catch (err) {
        setError(errMessage(err));
      } finally {
        setImporting(null);
        setPending(false);
      }
    },
    [invalidateBoxLabelCache, root, runScan, showToast]
  );

  const markJunkFiles = useCallback(
    async (filenames: string[]) => {
      if (!root || !filenames.length) return;
      const pendingNames = filenames.filter((name) => !isJunkFile(metadata.get(name), junkScope));
      if (!pendingNames.length) return;
      pushJunkUndo("image-pool", root, pendingNames, metadata);
      setCanUndoJunk(hasJunkUndo("image-pool", root));
      setPending(true);
      try {
        await markJunkFilenames(root, pendingNames, junkScope);
        await reloadMetadata();
        setStatus(`Marked ${pendingNames.length} image(s) as ${junkScope} junk.`);
      } catch (err) {
        setError(errMessage(err));
      } finally {
        setPending(false);
      }
    },
    [root, metadata, junkScope, reloadMetadata]
  );

  const clearJunkFiles = useCallback(
    async (filenames: string[]) => {
      if (!root || !filenames.length) return;
      const junked = filenames.filter((name) => isJunkFile(metadata.get(name), junkScope));
      if (!junked.length) return;
      pushJunkUndo("image-pool", root, junked, metadata);
      setCanUndoJunk(hasJunkUndo("image-pool", root));
      setPending(true);
      try {
        await clearJunkFilenames(root, junked, junkScope);
        await reloadMetadata();
        setStatus(`Cleared ${junkScope} junk from ${junked.length} image(s).`);
      } catch (err) {
        setError(errMessage(err));
      } finally {
        setPending(false);
      }
    },
    [root, metadata, junkScope, reloadMetadata]
  );

  const markJunk = useCallback(async () => {
    await markJunkFiles([...selected]);
  }, [markJunkFiles, selected]);

  const clearJunk = useCallback(async () => {
    await clearJunkFiles([...selected]);
  }, [clearJunkFiles, selected]);

  const undoJunk = useCallback(async () => {
    const snapshots = popJunkUndo("image-pool", root);
    setCanUndoJunk(hasJunkUndo("image-pool", root));
    if (!snapshots?.length || !root) {
      setStatus("没有可撤回的废片操作。");
      return;
    }
    setPending(true);
    try {
      await restoreJunkUndoWithLinks(root, snapshots);
      await reloadMetadata();
      setStatus("已撤回上一步废片操作。");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setPending(false);
    }
  }, [root, reloadMetadata]);

  const scanDuplicates = useCallback(async () => {
    if (!root) return;
    setDuplicatePending(true);
    try {
      const result = (await api.findImagePoolDuplicates(root)) as DuplicateScan;
      setDuplicateScan(result);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setDuplicatePending(false);
    }
  }, [root]);

  const clearDuplicates = useCallback(async () => {
    if (!root) return;
    let scanResult = duplicateScan;
    if (!scanResult?.groups?.length) {
      scanResult = (await api.findImagePoolDuplicates(root)) as DuplicateScan;
      setDuplicateScan(scanResult);
    }
    const dupCount = scanResult?.duplicateFiles || 0;
    if (!dupCount) {
      showToast("没有发现重复图片。", { variant: "info" });
      return;
    }
    if (
      !(await confirm({
        title: "Clear duplicates",
        message: `清除 ${dupCount} 张重复图？\n\n每组保留 1 张（优先 metadata 中登记的），其余彻底删除（含硬链接）。`,
        confirmLabel: "Clear",
        danger: true
      }))
    ) {
      return;
    }
    setDuplicatePending(true);
    try {
      const result = await api.clearImagePoolDuplicates(root);
      await runScan({ force: true, silent: true });
      invalidateBoxLabelCache(root);
      dispatchWorkspaceMediaChanged(root);
      const refreshed = (await api.findImagePoolDuplicates(root)) as DuplicateScan;
      setDuplicateScan(refreshed);
      const failed = result.failed?.length || 0;
      const msg = `已清除 ${result.removedCount || 0} 张重复图${failed ? `，${failed} 张失败` : ""}。`;
      setStatus(msg);
      showToast(msg, { variant: failed ? "error" : "info" });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setDuplicatePending(false);
    }
  }, [confirm, duplicateScan, invalidateBoxLabelCache, root, runScan, showToast]);

  const statsText = useMemo(() => {
    if (!root) return "Open a workspace to scan media";
    if (!scan) {
      if (pending) return "Scanning media...";
      if (error) return error;
      return "Refresh scan to load media";
    }
    const hideLabel =
      hideJunk === "detect"
        ? " | hiding Detect junk"
        : hideJunk === "clf"
          ? " | hiding Clf junk"
          : hideJunk === "both"
            ? " | hiding shared junk"
            : "";
    const junkLabel =
      counts.detect || counts.clf
        ? ` | Junk D${counts.detect} C${counts.clf} both${counts.both}`
        : "";
    const selectedCount = selected.size;
    return `${scan.total} total | NEW ${scan.newCount} | linked ${scan.usedCount} | unused ${scan.unusedCount}${junkLabel}${hideLabel}${selectedCount ? ` | selected ${selectedCount}` : ""}`;
  }, [root, scan, pending, error, hideJunk, counts, selected.size]);

  const selectedFilenames = useMemo(() => [...selected], [selected]);

  const junkSelection = useMemo(() => {
    const scopeLabel = junkScope === "detect" ? "Detect" : "Clf";
    const pendingMark = selectedFilenames.filter(
      (name) => !isJunkFile(metadata.get(name), junkScope)
    ).length;
    const pendingClear = selectedFilenames.filter((name) =>
      isJunkFile(metadata.get(name), junkScope)
    ).length;
    return { scopeLabel, pendingMark, pendingClear };
  }, [selectedFilenames, metadata, junkScope]);

  const clearRestoreViewport = useCallback(() => {
    setRestoreScrollTop(null);
    setRestoreImagePath("");
  }, []);

  const getCardExtraClasses = useCallback(
    (filename: string) => cardExtraClasses(metadata.get(filename), junkScope),
    [metadata, junkScope]
  );

  const getJunkLabelForFile = useCallback(
    (filename: string) => junkLabelForFile(metadata.get(filename)),
    [metadata]
  );

  const emptyGridMessage = useMemo(() => {
    if (!root) return "Open a workspace containing media.";
    if (!scan) {
      if (pending) return "Scanning media...";
      if (error) return error;
      return "Refresh scan to load media.";
    }
    if (!scan.files.length) return "media is empty, or refresh the scan.";
    if (!items.length) return "No images match the current filter.";
    return "";
  }, [root, scan, pending, error, items.length]);

  return {
    scan,
    items,
    metadata,
    filter,
    junkScope,
    hideJunk,
    selected,
    selectedFilenames,
    pending,
    deleting,
    importing,
    error,
    status,
    statsText,
    duplicateScan,
    duplicatePending,
    restoreScrollTop,
    restoreImagePath,
    clearRestoreViewport,
    queueSessionSave,
    changeFilter,
    changeJunkScope,
    toggleHideJunk,
    runScan,
    selectSingle,
    toggleSelect,
    rangeSelect,
    selectAllVisible,
    clearSelection,
    deleteSelected,
    deleteFilenames,
    markSeen,
    importMedia,
    markJunk,
    clearJunk,
    markJunkFiles,
    clearJunkFiles,
    undoJunk,
    canUndoJunk,
    scanDuplicates,
    clearDuplicates,
    junkSelection,
    emptyGridMessage,
    cardExtraClasses: getCardExtraClasses,
    junkLabelForFile: getJunkLabelForFile
  };
}
