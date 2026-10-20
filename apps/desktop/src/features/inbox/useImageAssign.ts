import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import {
  clearJunkFilenames,
  isClfJunk,
  isJunkFile,
  junkLabelForFile,
  loadMetadataMap,
  markJunkFilenames,
  restoreMetadataSnapshots
} from "../image-pool/metadata";
import { hasJunkUndo, popJunkUndo, pushJunkUndo } from "../shared/junkUndo";
import { useWorkspaceCache } from "../shared/useWorkspaceCache";
import { errMessage } from "../../lib/errors";
import type { JunkScope, MetadataRow } from "../image-pool/types";
import { runExportDatasetJob } from "./exportJob";
import {
  chooseRandomUnusedSample,
  filterInboxItems,
  INBOX_JUNK_CLASS
} from "./helpers";
import {
  assignTargetFromSession,
  inboxPendingFilenamesFrom,
  inboxSessionSummary,
  markInboxBatchesBuilt,
  normalizeInboxSession,
  pendingBatchIds,
  readInboxSession,
  saveInboxSession,
  smallPathHash
} from "./session";
import type { AssignTarget, DetectClass, InboxFilter, InboxSession } from "./types";

type UseImageAssignOptions = {
  workspaceRoot: string;
  onReady?: () => void;
  onScanUpdate?: (newCount: number) => void;
};

export function useImageAssign({ workspaceRoot, onReady, onScanUpdate }: UseImageAssignOptions) {
  const { getBoxLabelCache } = useWorkspaceCache();
  const root = workspaceRoot.trim();
  const [scan, setScan] = useState<api.ImagePoolScan | null>(null);
  const [metadata, setMetadata] = useState<Map<string, MetadataRow>>(new Map());
  const [inboxSession, setInboxSession] = useState<InboxSession | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("new");
  const [assignTarget, setAssignTarget] = useState<AssignTarget>("clf");
  const [junkScope, setJunkScope] = useState<JunkScope>("clf");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [clfClasses, setClfClasses] = useState<string[]>([]);
  const [detectClasses, setDetectClasses] = useState<DetectClass[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedDetectClassId, setSelectedDetectClassId] = useState<number | null>(null);
  const [classSearch, setClassSearch] = useState("");
  const [detectClassSearch, setDetectClassSearch] = useState("");
  const [randomUnused, setRandomUnused] = useState<Set<string>>(new Set());
  const [randomCandidateCount, setRandomCandidateCount] = useState(0);
  const [randomNonce, setRandomNonce] = useState(0);
  const [pending, setPending] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState("Ready.");
  const [canUndoJunk, setCanUndoJunk] = useState(false);
  const [rebuild, setRebuild] = useState(false);
  const [restoreGalleryScrollTop, setRestoreGalleryScrollTop] = useState<number | null>(null);
  const galleryScrollTopRef = useRef(0);
  const scrollTimer = useRef<number | null>(null);
  const [buildProgress, setBuildProgress] = useState<{ open: boolean; done: number; total: number; detail: string }>({
    open: false,
    done: 0,
    total: 1,
    detail: ""
  });
  const readyNotified = useRef(false);
  const onReadyRef = useRef(onReady);
  const onScanUpdateRef = useRef(onScanUpdate);
  onReadyRef.current = onReady;
  onScanUpdateRef.current = onScanUpdate;
  const loadingRef = useRef(false);

  const notifyReady = useCallback(() => {
    if (readyNotified.current) return;
    readyNotified.current = true;
    onReadyRef.current?.();
  }, []);

  const pendingFilenames = useMemo(
    () => new Set(inboxSession ? inboxPendingFilenamesFrom(inboxSession) : []),
    [inboxSession]
  );

  const sessionSummary = useMemo(
    () => (inboxSession ? inboxSessionSummary(inboxSession) : null),
    [inboxSession]
  );

  const items = useMemo(() => {
    if (!scan?.files) return [];
    if (filter === "random-unused" && randomNonce === 0) {
      const sample = chooseRandomUnusedSample(scan.files, metadata);
      return filterInboxItems(scan.files, metadata, filter, sample.filenames);
    }
    return filterInboxItems(scan.files, metadata, filter, randomUnused);
  }, [scan, metadata, filter, randomUnused, randomNonce]);

  const filteredClfClasses = useMemo(() => {
    const classes = clfClasses.filter((name) => name !== INBOX_JUNK_CLASS);
    const query = classSearch.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((name) => name.toLowerCase().includes(query));
  }, [clfClasses, classSearch]);

  const filteredDetectClasses = useMemo(() => {
    const query = detectClassSearch.trim().toLowerCase();
    if (!query) return detectClasses;
    return detectClasses.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      return name.includes(query) || String(item.id).includes(query);
    });
  }, [detectClasses, detectClassSearch]);

  const clfClassCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of metadata.values()) {
      const name = String(row.clf_class || "").trim();
      if (!name || isClfJunk(row)) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
  }, [metadata]);

  const detectClassCounts = useMemo(() => {
    const counts = new Map<number, number>();
    const labelIndex = root ? getBoxLabelCache(root)?.labelIndex : null;
    if (labelIndex) {
      for (const classIds of labelIndex.values()) {
        for (const classId of classIds) {
          counts.set(classId, (counts.get(classId) || 0) + 1);
        }
      }
    }
    return counts;
  }, [getBoxLabelCache, root]);

  const reloadClasses = useCallback(async () => {
    if (!root) return;
    const payload = await api.readMetadataRows(root);
    if (payload.ok === false && payload.error) throw new Error(payload.error);
    setClfClasses(payload.classes || payload.clfClasses || payload.metadataClasses || []);
    setDetectClasses(Array.isArray(payload.detectClasses) ? payload.detectClasses : []);
  }, [root]);

  const reloadMetadata = useCallback(async () => {
    if (!root) return new Map<string, MetadataRow>();
    const map = await loadMetadataMap(root);
    setMetadata(map);
    return map;
  }, [root]);

  const load = useCallback(async () => {
    if (!root) {
      setScan(null);
      setError("Open a workspace first.");
      notifyReady();
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setPending(true);
    setError("");
    try {
      const info = await api.getWorkspaceInfo(root);
      if (info.ok === false) throw new Error(info.error || "Cannot read workspace info.");
      const [scanResult, inboxData] = await Promise.all([
        api.scanImagePool(root, { fast: true }),
        readInboxSession(root)
      ]);
      setScan(scanResult);
      onScanUpdateRef.current?.(scanResult.newCount);
      setInboxSession(inboxData.inbox);
      setFilter(inboxData.inbox.ui.filter);
      setAssignTarget(assignTargetFromSession(inboxData.inbox.ui));
      setJunkScope(assignTargetFromSession(inboxData.inbox.ui));
      setRestoreGalleryScrollTop(inboxData.inbox.ui.scrollTop ?? null);
      galleryScrollTopRef.current = inboxData.inbox.ui.scrollTop ?? 0;
      const map = await reloadMetadata();
      await reloadClasses();
      if (inboxData.inbox.ui.filter === "random-unused") {
        const sample = chooseRandomUnusedSample(scanResult.files, map);
        setRandomUnused(sample.filenames);
        setRandomCandidateCount(sample.candidateCount);
        setRandomNonce((value) => value + 1);
      }
      notifyReady();
    } catch (err) {
      setError(errMessage(err));
      notifyReady();
    } finally {
      loadingRef.current = false;
      setPending(false);
    }
  }, [notifyReady, reloadClasses, reloadMetadata, root]);

  useEffect(() => {
    readyNotified.current = false;
    if (!root) {
      notifyReady();
      return;
    }
    load();
  }, [root, load, notifyReady]);

  useEffect(() => {
    setCanUndoJunk(hasJunkUndo("inbox", root));
  }, [root, selected, assigning, metadata]);

  const saveUi = useCallback(
    async (nextFilter: InboxFilter, nextTarget: AssignTarget, scrollTop = galleryScrollTopRef.current) => {
      if (!root || !inboxSession) return;
      const next = normalizeInboxSession({
        ...inboxSession,
        ui: { filter: nextFilter, assignTarget: nextTarget, scrollTop }
      });
      const summary = await saveInboxSession(root, next);
      setInboxSession(summary.inbox);
    },
    [inboxSession, root]
  );

  const clearGalleryRestore = useCallback(() => setRestoreGalleryScrollTop(null), []);

  const onGalleryScroll = useCallback(
    (scrollTop: number) => {
      galleryScrollTopRef.current = scrollTop;
      if (!root || !inboxSession) return;
      if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
      scrollTimer.current = window.setTimeout(() => {
        saveInboxSession(root, {
          ...normalizeInboxSession(inboxSession),
          ui: { filter, assignTarget, scrollTop }
        }).catch(() => {});
      }, 500);
    },
    [assignTarget, filter, inboxSession, root]
  );

  const changeFilter = useCallback(
    (next: InboxFilter) => {
      setFilter(next);
      setSelected(new Set());
      setAnchorIndex(null);
      if (next === "random-unused" && scan?.files.length) {
        const sample = chooseRandomUnusedSample(scan.files, metadata);
        setRandomUnused(sample.filenames);
        setRandomCandidateCount(sample.candidateCount);
        setRandomNonce((value) => value + 1);
      }
      saveUi(next, assignTarget).catch(() => {});
    },
    [assignTarget, metadata, saveUi, scan]
  );

  const changeAssignTarget = useCallback(
    (next: AssignTarget) => {
      setAssignTarget(next);
      setJunkScope(next);
      reloadClasses().catch((err) => setLog(errMessage(err)));
      saveUi(filter, next).catch(() => {});
    },
    [filter, reloadClasses, saveUi]
  );

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(items.map((item) => item.filename)));
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAnchorIndex(null);
  }, []);

  const handleSelect = useCallback(
    (index: number, options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
      const item = items[index];
      if (!item) return;
      if (options.shiftKey) {
        const anchor = anchorIndex ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const next = new Set(selected);
        for (let i = start; i <= end; i += 1) {
          const entry = items[i];
          if (entry) next.add(entry.filename);
        }
        setSelected(next);
        return;
      }
      if (options.ctrlKey || options.metaKey) {
        setAnchorIndex(index);
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(item.filename)) next.delete(item.filename);
          else next.add(item.filename);
          return next;
        });
        return;
      }
      setAnchorIndex(index);
      setSelected(new Set([item.filename]));
    },
    [anchorIndex, items, selected]
  );

  const applyAssignment = useCallback(
    async (options: {
      filenames?: string[];
      clfClass?: string;
      newClass?: string;
      quiet?: boolean;
      skipBatch?: boolean;
    } = {}) => {
      if (!root) throw new Error("Open a workspace first.");
      const filenames = options.filenames || [...selected];
      if (!filenames.length) throw new Error("Select images first.");
      const detectEnabled = assignTarget === "detect";
      const clfEnabled = assignTarget === "clf";
      let clfClass = options.clfClass != null ? String(options.clfClass).trim() : selectedClass.trim();
      if (options.newClass?.trim()) clfClass = options.newClass.trim();
      if (clfEnabled && !clfClass) throw new Error("Choose or enter a class in Clf mode.");

      const updates = filenames.map((filename) => {
        const update: Record<string, unknown> = {
          filename,
          detect_enabled: detectEnabled,
          clf_enabled: clfEnabled
        };
        if (clfEnabled) update.clf_class = clfClass;
        return update;
      });

      if (!options.quiet) setLog(`Writing metadata for ${filenames.length} image(s)...`);
      setAssigning(true);
      try {
        const result = await api.upsertMetadataRows(root, updates);
        if (!result.ok) throw new Error("Failed to write metadata.");
        if (options.newClass?.trim() && !clfClasses.includes(clfClass)) {
          setClfClasses((current) => [...current, clfClass]);
          setSelectedClass(clfClass);
        } else if (options.clfClass != null) {
          setSelectedClass(clfClass);
        }
        await reloadMetadata();
        if (!options.skipBatch && clfClass && clfClass !== INBOX_JUNK_CLASS && inboxSession) {
          const next = normalizeInboxSession({
            ...inboxSession,
            assignBatches: [
              ...inboxSession.assignBatches,
              {
                id: smallPathHash(`${Date.now()}-${filenames.join(",")}-${clfClass}`),
                at: new Date().toISOString(),
                className: clfClass,
                assignTarget,
                detectEnabled,
                clfEnabled,
                filenames,
                built: false,
                builtAt: ""
              }
            ].slice(-2000)
          });
          const summary = await saveInboxSession(root, next);
          setInboxSession(summary.inbox);
        }
        if (!options.quiet) {
          setLog(`Metadata updated: created ${result.created || 0}, updated ${result.updated || 0}.`);
        }
        return { filenames, clfClass, result };
      } finally {
        setAssigning(false);
      }
    },
    [assignTarget, clfClasses, inboxSession, reloadMetadata, root, selected, selectedClass]
  );

  const quickAssignClass = useCallback(
    async (className: string) => {
      if (!selected.size) {
        setSelectedClass(className);
        setLog("Select images before clicking a class chip.");
        return;
      }
      await applyAssignment({ clfClass: className, quiet: true });
      setLog(`Assigned ${selected.size} image(s) -> ${className}.`);
    },
    [applyAssignment, selected.size]
  );

  const quickAssignDetect = useCallback(async () => {
    if (!selected.size) {
      setLog("Select images before marking Detect.");
      return;
    }
    await applyAssignment({ quiet: true, skipBatch: true });
    setLog(`Marked ${selected.size} image(s) as Detect (detect_enabled=1).`);
  }, [applyAssignment, selected.size]);

  const applyWithNewClass = useCallback(
    async (newClass: string) => {
      await applyAssignment({ newClass, clfClass: newClass });
    },
    [applyAssignment]
  );

  const markJunk = useCallback(async () => {
    if (!root) return;
    const names = [...selected].filter((filename) => !isJunkFile(metadata.get(filename), junkScope));
    if (!names.length) return;
    pushJunkUndo("inbox", root, names, metadata);
    setAssigning(true);
    try {
      await markJunkFilenames(root, names, junkScope);
      await reloadMetadata();
      if (scan) {
        const refreshed = await api.scanImagePool(root, { fast: false });
        setScan(refreshed);
        onScanUpdate?.(refreshed.newCount);
      }
      setCanUndoJunk(hasJunkUndo("inbox", root));
      setLog(`Marked ${names.length} image(s) as ${junkScope} junk.`);
    } finally {
      setAssigning(false);
    }
  }, [junkScope, metadata, onScanUpdate, reloadMetadata, root, scan, selected]);

  const clearJunk = useCallback(async () => {
    if (!root) return;
    const names = [...selected].filter((filename) => isJunkFile(metadata.get(filename), junkScope));
    if (!names.length) {
      setLog(`Selected images are not ${junkScope} junk.`);
      return;
    }
    pushJunkUndo("inbox", root, names, metadata);
    setAssigning(true);
    try {
      await clearJunkFilenames(root, names, junkScope);
      await reloadMetadata();
      setCanUndoJunk(hasJunkUndo("inbox", root));
      setLog(`Cleared ${junkScope} junk from ${names.length} image(s).`);
    } finally {
      setAssigning(false);
    }
  }, [junkScope, metadata, reloadMetadata, root, selected]);

  const undoJunk = useCallback(async () => {
    if (!root) return;
    const snapshots = popJunkUndo("inbox", root);
    if (!snapshots?.length) return;
    setAssigning(true);
    try {
      await restoreMetadataSnapshots(root, snapshots);
      await reloadMetadata();
      if (scan) {
        const refreshed = await api.scanImagePool(root, { fast: false });
        setScan(refreshed);
        onScanUpdate?.(refreshed.newCount);
      }
      setCanUndoJunk(hasJunkUndo("inbox", root));
      setLog(`Restored junk state for ${snapshots.length} image(s).`);
    } finally {
      setAssigning(false);
    }
  }, [onScanUpdate, reloadMetadata, root, scan]);

  const buildLinks = useCallback(
    async (scope: "pending" | "all") => {
      if (!root || !inboxSession) return;
      const pendingNames = inboxPendingFilenamesFrom(inboxSession);
      if (scope === "pending" && !pendingNames.length) {
        setLog("There are no pending assignment batches.");
        return;
      }
      const batchIds = scope === "pending" ? pendingBatchIds(inboxSession) : [];
      setAssigning(true);
      setBuildProgress({ open: true, done: 0, total: 1, detail: "Preparing export..." });
      try {
        const options = scope === "pending" ? { filenames: pendingNames, rebuild: false } : { rebuild };
        const result = await runExportDatasetJob(root, options, (done, total, detail) => {
          setBuildProgress({ open: true, done, total, detail });
        });
        const next = markInboxBatchesBuilt(normalizeInboxSession(inboxSession), {
          markAll: scope === "all",
          batchIds,
          filenames: result.builtFilenames || pendingNames
        });
        next.buildRuns = [
          ...next.buildRuns,
          {
            id: smallPathHash(`${Date.now()}-${scope}-${(result.builtFilenames || pendingNames).length}`),
            at: new Date().toISOString(),
            scope,
            rebuild,
            batchIds,
            filenames: result.builtFilenames || pendingNames,
            detectImages: result.detectImages || 0,
            clfImages: result.clfImages || 0,
            labelsPlaced: result.labelsPlaced || 0,
            errors: (result.errors || []).slice(0, 20)
          }
        ].slice(-500);
        const summary = await saveInboxSession(root, next);
        setInboxSession(summary.inbox);
        const refreshed = await api.scanImagePool(root, { fast: false });
        setScan(refreshed);
        onScanUpdate?.(refreshed.newCount);
        setLog(
          result.errors?.length
            ? `Export completed with errors:\n${result.errors.join("\n")}`
            : `Exported to ${result.exportRoot || "exports/dataset"}: detect ${result.detectImages || 0}, clf ${result.clfImages || 0}, labels ${result.labelsPlaced || 0}.`
        );
      } finally {
        setAssigning(false);
        setBuildProgress((current) => ({ ...current, open: false }));
      }
    },
    [inboxSession, onScanUpdate, rebuild, root]
  );

  const refresh = useCallback(async () => {
    if (!root || loadingRef.current) return;
    loadingRef.current = true;
    setPending(true);
    try {
      const info = await api.getWorkspaceInfo(root);
      if (info.ok === false) throw new Error(info.error || "Cannot read workspace info.");
      const scanResult = await api.scanImagePool(root, { fast: false });
      setScan(scanResult);
      onScanUpdateRef.current?.(scanResult.newCount);
      const inboxData = await readInboxSession(root);
      setInboxSession(inboxData.inbox);
      await Promise.all([reloadMetadata(), reloadClasses()]);
      setLog("Assign list refreshed.");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      loadingRef.current = false;
      setPending(false);
    }
  }, [reloadClasses, reloadMetadata, root]);

  const statsText = useMemo(() => {
    if (!root) return "Open a workspace to load NEW images";
    const newCount = scan?.newCount ?? 0;
    const randomText = filter === "random-unused" ? ` | unused candidates ${randomCandidateCount}` : "";
    return `${items.length} visible | NEW ${newCount}${randomText} | ${selected.size} selected`;
  }, [filter, items.length, randomCandidateCount, root, scan?.newCount, selected.size]);

  const workflowStatus = useMemo(() => {
    const pendingFiles = sessionSummary?.pendingFiles || 0;
    const pendingBatches = sessionSummary?.pendingBatches || 0;
    const lastBuildAt = sessionSummary?.lastBuildAt || "";
    const lastBuildText = lastBuildAt
      ? ` | last build ${lastBuildAt.replace("T", " ").replace("Z", " UTC")}`
      : "";
    return pendingFiles
      ? `pending ${pendingFiles} image(s) / ${pendingBatches} batch(es)${lastBuildText} | workspace/session.json`
      : `no pending batches${lastBuildText} | workspace/session.json`;
  }, [sessionSummary]);

  const junkSelection = useMemo(() => {
    const names = [...selected];
    const pendingMark = names.filter((name) => !isJunkFile(metadata.get(name), junkScope)).length;
    const pendingClear = names.filter((name) => isJunkFile(metadata.get(name), junkScope)).length;
    const scopeLabel = junkScope === "detect" ? "Detect" : "Clf";
    return {
      pendingMark,
      pendingClear,
      markLabel:
        names.length && pendingMark
          ? `Mark ${scopeLabel} Junk (${pendingMark})`
          : `Mark ${scopeLabel} Junk`,
      clearLabel:
        names.length && pendingClear
          ? `Clear ${scopeLabel} Junk (${pendingClear})`
          : `Clear ${scopeLabel} Junk`
    };
  }, [junkScope, metadata, selected]);

  return {
    items,
    metadata,
    scan,
    pending,
    assigning,
    error,
    log,
    statsText,
    workflowStatus,
    filter,
    assignTarget,
    junkScope,
    selected,
    clfClasses: filteredClfClasses,
    detectClasses: filteredDetectClasses,
    clfClassCounts,
    detectClassCounts,
    selectedClass,
    selectedDetectClassId,
    classSearch,
    detectClassSearch,
    pendingFilenames,
    pendingFiles: sessionSummary?.pendingFiles || 0,
    rebuild,
    buildProgress,
    canUndoJunk,
    junkSelection,
    restoreGalleryScrollTop,
    clearGalleryRestore,
    onGalleryScroll,
    cardExtraClasses: (filename: string) => (isJunkFile(metadata.get(filename), "any") ? "inbox-junk" : ""),
    junkLabelForFile: (filename: string) => junkLabelForFile(metadata.get(filename)),
    setClassSearch,
    setDetectClassSearch,
    setSelectedClass,
    setSelectedDetectClassId,
    setRebuild,
    changeFilter,
    changeAssignTarget,
    selectAllVisible,
    clearSelection,
    handleSelect,
    applyAssignment,
    applyWithNewClass,
    quickAssignClass,
    quickAssignDetect,
    markJunk,
    clearJunk,
    undoJunk,
    buildLinks,
    refresh
  };
}
