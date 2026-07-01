import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { datasetPreviewImageUrl, invalidateDatasetImageUrl } from "../dataset-review/datasetAssets";
import { loadMetadataMap } from "../image-pool/metadata";
import type { MetadataRow } from "../image-pool/types";
import {
  DEFAULT_DEDUP_IOU_THRESHOLD,
  materializeProposal as materializeProposalFn,
  nextNeedsReviewIndex,
  predictionIou,
  prevNeedsReviewIndex,
  proposalUsesArchivedDetectClass
} from "../auto-label/proposalDomain";
import type { ReviewQueueEntry } from "../auto-label/proposalDomain";
import { imageProposalKey, loadImageProposals, saveImageProposals, type ImageProposalManifest } from "../auto-label/proposalApi";
import type { DetectProposal } from "../video/videoAnnotationApi";
import { buildClassIdByName, resolveAutoLabelClassId } from "./autoLabelClassMapping";
import { loadEntryLabels, saveEntryLabels, type BoxLabelEntry } from "./boxLabelCore";
import type { KeyboardStepMultiplier } from "./boxLabelKeyboardShortcuts";
import type { BoxLabelAutoLabelOptions, BoxLabelAutoLabelResult, BoxLabelViewProps } from "./boxLabelTypes";
import { findNearestBoxIndex, loadCanvasImage, type BoxAdjustMode, type DragState, type ProposalShape } from "./geometry";
import { useBoxLabelClasses } from "./useBoxLabelClasses";
import { useBoxLabelInteraction } from "./useBoxLabelInteraction";
import { useBoxTracking } from "./useBoxTracking";
import { useBoxUndo } from "./useBoxUndo";

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function nextPreviewImageRequestId(currentRequestId: number) {
  return currentRequestId + 1;
}

export function shouldApplyPreviewImageRequest({
  requestId,
  latestRequestId,
  targetImagePath,
  currentImagePath,
}: {
  requestId: number;
  latestRequestId: number;
  targetImagePath: string;
  currentImagePath: string | undefined;
}) {
  return requestId === latestRequestId && currentImagePath === targetImagePath;
}

export function useBoxLabelEditor({
  workspaceRoot,
  datasetRoot,
  mediaDir = "media",
  entry,
  entries,
  currentIndex,
  selectedFilenames,
  shiftSelectedFilenames,
  onNavigate,
  onNavigateBoundary,
  disableMediaNavigationHotkeys = false,
  initialShortcutSlots = null,
  initialFixedBoxSlots = null,
  initialPointerToolEnabled = false,
  initialAutoFitEnabled = false,
  onShortcutSlotsChange,
  onToolStateChange,
  includeClasses,
  excludeClasses,
  imageViewMode,
  metadata: _metadata,
  onAddIncludeClass,
  onAddExcludeClass,
  onClearClassFilters,
  onImageViewModeChange: _onImageViewModeChange,
  onToggleReviewed,
  onToggleFlagged,
  onLabelsChanged,
  onMetadataChanged: _onMetadataChanged,
  onStatusText,
  onMarkJunk,
  onUndoJunk,
  imageUrlOverride = null,
  reloadLabelsOnImageUrlChange = true,
  videoUrlOverride = null,
  videoPlaybackTime = 0,
  videoPlaying = false,
  onVideoPlaybackTimeChange,
  onVideoEnded,
  onVideoLoadError,
  loadLabelsOverride,
  saveLabelsOverride,
  disableProposals = false
}: BoxLabelViewProps) {
  const boxesRef = useRef<api.LabelBox[]>([]);
  const selectedRef = useRef<number | null>(null);
  const classRef = useRef(0);
  const dragRef = useRef<DragState>(null);
  const showGridRef = useRef(true);
  const boxAdjustModeRef = useRef<BoxAdjustMode>("grow");
  const selectedFilenamesRef = useRef(selectedFilenames);
  const shiftSelectedFilenamesRef = useRef(shiftSelectedFilenames);
  const scheduleDrawRef = useRef<() => void>(() => {});
  const persistLabelsRef = useRef<(statusMessage?: string) => Promise<void>>(async () => {});
  const classesSetCurrentClassRef = useRef<(classId: number) => void>(() => {});
  const archivedDetectIdsRef = useRef<Set<number>>(new Set());
  const archivedClassKeysRef = useRef<Set<string>>(new Set());
  const classIdByNameRef = useRef<Map<string, number>>(new Map());
  const entryRef = useRef<BoxLabelEntry | null>(null);
  const proposalsRef = useRef<ProposalShape[]>([]);
  const selectedProposalIdRef = useRef<string | null>(null);
  const ephemeralProposalIdsRef = useRef<Set<string>>(new Set());
  const contentRevisionRef = useRef(0);
  const previewImageRequestRef = useRef(0);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoPlaybackTimeRef = useRef(videoPlaybackTime);
  const videoPlaybackTimeChangeRef = useRef(onVideoPlaybackTimeChange);
  const videoEndedRef = useRef(onVideoEnded);
  const videoLoadErrorRef = useRef(onVideoLoadError);
  videoPlaybackTimeRef.current = videoPlaybackTime;
  videoPlaybackTimeChangeRef.current = onVideoPlaybackTimeChange;
  videoEndedRef.current = onVideoEnded;
  videoLoadErrorRef.current = onVideoLoadError;

  const [boxes, setBoxes] = useState<api.LabelBox[]>([]);
  const [proposals, setProposals] = useState<DetectProposal[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [showGrid] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const [keyboardStepMultiplier, setKeyboardStepMultiplier] = useState<KeyboardStepMultiplier>(1);
  const [imageVersion, setImageVersion] = useState(0);
  const metadataRef = useRef<Map<string, MetadataRow>>(new Map());
  const filename = entry?.basename || "";
  const mediaImagePath = filename ? `${mediaDir.replace(/^\/+|\/+$/g, "") || "media"}/${filename}` : "";
  const entryImagePath = entry?.imagePath ?? "";
  const imageUrlReloadKey = reloadLabelsOnImageUrlChange ? imageUrlOverride : "";
  entryRef.current = entry;

  const scheduleDraw = useCallback(() => scheduleDrawRef.current(), []);
  const persistLabelsProxy = useCallback(
    (statusMessage?: string) => persistLabelsRef.current(statusMessage),
    []
  );

  const findEntryByBasename = useCallback(
    (basename: string) => entries.find((item) => item.basename === basename) || null,
    [entries]
  );

  const persistEntryLabels = useCallback(
    async (target: BoxLabelEntry, nextBoxes: api.LabelBox[]) => {
      if (target.basename === entryRef.current?.basename) contentRevisionRef.current += 1;
      const savedBoxes = saveLabelsOverride
        ? await saveLabelsOverride(target, nextBoxes)
        : await saveEntryLabels(datasetRoot, target, nextBoxes);
      if (!saveLabelsOverride && workspaceRoot && nextBoxes.length > 0) {
        await api.upsertMetadataRows(workspaceRoot, [
          { filename: target.basename, detect_enabled: true }
        ]);
      }
      onLabelsChanged(target.basename, savedBoxes);
      return savedBoxes;
    },
    [datasetRoot, onLabelsChanged, saveLabelsOverride, workspaceRoot]
  );

  const persistProposals = useCallback(
    async (proposalsList: ProposalShape[]) => {
      if (disableProposals) return;
      if (!workspaceRoot || !entry) return;
      contentRevisionRef.current += 1;
      const imageKey = imageProposalKey(entry.imagePath);
      const manifest: ImageProposalManifest = {
        version: 1,
        imageKey,
        proposals: proposalsList as DetectProposal[],
        updatedAt: new Date().toISOString()
      };
      await saveImageProposals(workspaceRoot, manifest);
    },
    [disableProposals, entry, workspaceRoot]
  );

  const persistProposalListForEntry = useCallback(
    async (target: BoxLabelEntry, proposalsList: ProposalShape[]) => {
      if (disableProposals) return;
      if (!workspaceRoot) return;
      if (target.basename === entryRef.current?.basename) contentRevisionRef.current += 1;
      const imageKey = imageProposalKey(target.imagePath);
      const manifest: ImageProposalManifest = {
        version: 1,
        imageKey,
        proposals: proposalsList as DetectProposal[],
        updatedAt: new Date().toISOString()
      };
      await saveImageProposals(workspaceRoot, manifest);
    },
    [disableProposals, workspaceRoot]
  );

  const { pushUndo, pushImageUndo, pushBatchUndo, undoLast, redoLast } = useBoxUndo({
    filename,
    entry,
    persistEntryLabels,
    persistProposals,
    boxesRef,
    selectedRef,
    classRef,
    proposalsRef,
    selectedProposalIdRef,
    setBoxes,
    setSelectedBoxId,
    setCurrentClass: (classId) => classesSetCurrentClassRef.current(classId),
    setProposals: (p) => setProposals(p as DetectProposal[]),
    setSelectedProposalId,
    setStatus,
    scheduleDraw
  });

  const addProposals = useCallback(
    async (
      incoming: DetectProposal[],
      options: { replace?: boolean; statusMessage?: string } = {}
    ): Promise<{ added: number; skipped: number }> => {
      if (!entry) return { added: 0, skipped: incoming.length };
      const validIncoming = incoming.filter(
        (proposal) =>
          proposal.id &&
          Number.isFinite(proposal.x) &&
          Number.isFinite(proposal.y) &&
          Number.isFinite(proposal.w) &&
          Number.isFinite(proposal.h) &&
          proposal.w > 0 &&
          proposal.h > 0
      );
      let skipped = incoming.length - validIncoming.length;
      const existingProposals = options.replace ? [] : (proposalsRef.current as DetectProposal[]);
      const occupied: Array<{ x: number; y: number; w: number; h: number }> = [
        ...boxesRef.current,
        ...existingProposals,
      ];
      const kept: DetectProposal[] = [];
      const usedIds = new Set(existingProposals.map((proposal) => proposal.id));

      for (const proposal of validIncoming) {
        if (usedIds.has(proposal.id)) {
          skipped += 1;
          continue;
        }
        const duplicate = occupied.some(
          (existing) => predictionIou(proposal, existing) >= DEFAULT_DEDUP_IOU_THRESHOLD
        );
        if (duplicate) {
          skipped += 1;
          continue;
        }
        kept.push(proposal);
        occupied.push(proposal);
        usedIds.add(proposal.id);
      }

      if (!kept.length && !options.replace) {
        setStatus(skipped ? "Auto label found no new proposals." : "No proposals to add.");
        return { added: 0, skipped };
      }

      const nextProposals = options.replace ? kept : [...existingProposals, ...kept];
      await persistProposals(nextProposals as ProposalShape[]);
      pushUndo("add proposals");
      proposalsRef.current = nextProposals as ProposalShape[];
      for (const proposal of nextProposals) ephemeralProposalIdsRef.current.delete(proposal.id);
      setProposals(nextProposals);
      setSelectedProposalId(kept[0]?.id ?? null);
      setStatus(options.statusMessage ?? `Added ${kept.length} proposal(s).`);
      return { added: kept.length, skipped };
    },
    [entry, persistProposals, pushUndo, setStatus]
  );

  const applyAutoLabelPredictions = useCallback(
    async (
      target: BoxLabelEntry,
      predictions: api.PtDetectPrediction[],
      options: BoxLabelAutoLabelOptions = {}
    ): Promise<BoxLabelAutoLabelResult> => {
      const highConfidence = options.highConfidence ?? 0.8;
      const proposalConfidence = options.proposalConfidence ?? 0.25;
      const targetIsCurrent = () => entryRef.current?.imagePath === target.imagePath;
      const wasCurrentAtStart = targetIsCurrent();
      const existingBoxes = wasCurrentAtStart
        ? boxesRef.current
        : loadLabelsOverride
          ? await loadLabelsOverride(target)
          : await loadEntryLabels(datasetRoot, target);
      const existingProposalManifest = workspaceRoot && !disableProposals
        ? await loadImageProposals(workspaceRoot, imageProposalKey(target.imagePath))
        : null;
      const existingProposals = wasCurrentAtStart
        ? (proposalsRef.current as DetectProposal[])
        : (existingProposalManifest?.proposals ?? []);
      const occupied: Array<{ x: number; y: number; w: number; h: number }> = [
        ...existingBoxes,
        ...existingProposals,
      ];
      const nextBoxes = [...existingBoxes];
      const nextProposals = [...existingProposals];
      const now = new Date().toISOString();
      const newEphemeralIds = new Set<string>();
      let boxesAdded = 0;
      let proposalsAdded = 0;
      let skipped = 0;
      let ignored = 0;

      predictions.forEach((prediction, index) => {
        const confidence = clamp01(prediction.confidence);
        const classId = resolveAutoLabelClassId(prediction, classIdByNameRef.current);
        const candidate = {
          classId,
          x: clamp01(prediction.x),
          y: clamp01(prediction.y),
          w: clamp01(prediction.w),
          h: clamp01(prediction.h),
        };
        if (candidate.w <= 0 || candidate.h <= 0 || archivedDetectIdsRef.current.has(classId)) {
          skipped += 1;
          return;
        }
        if (predictionIou(candidate, candidate) <= 0) {
          skipped += 1;
          return;
        }
        if (occupied.some((existing) => predictionIou(candidate, existing) >= DEFAULT_DEDUP_IOU_THRESHOLD)) {
          skipped += 1;
          return;
        }

        if (confidence >= highConfidence) {
          nextBoxes.push(candidate);
          occupied.push(candidate);
          boxesAdded += 1;
          return;
        }

        if (confidence >= proposalConfidence && (options.persistProposals || wasCurrentAtStart)) {
          const proposal: DetectProposal = {
            id: `pt_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`,
            classId,
            x: candidate.x,
            y: candidate.y,
            w: candidate.w,
            h: candidate.h,
            confidence,
            createdAt: now,
          };
          if (options.modelId) proposal.modelId = options.modelId;
          nextProposals.push(proposal);
          occupied.push(proposal);
          proposalsAdded += 1;
          if (!options.persistProposals) newEphemeralIds.add(proposal.id);
          return;
        }

        ignored += 1;
      });

      if (!boxesAdded && !proposalsAdded) {
        if (targetIsCurrent()) setStatus("Auto label found no new boxes or proposals.");
        return { total: predictions.length, boxesAdded, proposalsAdded, skipped, ignored };
      }

      const isStillCurrent = targetIsCurrent();
      if (isStillCurrent) pushUndo("auto label");
      if (boxesAdded) await persistEntryLabels(target, nextBoxes);
      if (options.persistProposals) {
        await persistProposalListForEntry(target, nextProposals as ProposalShape[]);
      } else if (isStillCurrent) {
        const persistentProposals = nextProposals.filter(
          (proposal) => !newEphemeralIds.has(proposal.id) && !ephemeralProposalIdsRef.current.has(proposal.id)
        );
        await persistProposalListForEntry(target, persistentProposals as ProposalShape[]);
      }

      if (targetIsCurrent()) {
        boxesRef.current = nextBoxes;
        proposalsRef.current = nextProposals as ProposalShape[];
        for (const id of newEphemeralIds) ephemeralProposalIdsRef.current.add(id);
        setBoxes(nextBoxes);
        setProposals(nextProposals);
        setSelectedProposalId(null);
        setSelectedBoxId(boxesAdded ? nextBoxes.length - 1 : null);
        selectedRef.current = boxesAdded ? nextBoxes.length - 1 : null;
        setStatus(`Auto label: ${boxesAdded} box(es), ${proposalsAdded} proposal(s).`);
      }

      return { total: predictions.length, boxesAdded, proposalsAdded, skipped, ignored };
    },
    [
      archivedDetectIdsRef,
      boxesRef,
      datasetRoot,
      disableProposals,
      loadLabelsOverride,
      persistEntryLabels,
      persistProposalListForEntry,
      proposalsRef,
      pushUndo,
      selectedRef,
      setBoxes,
      setStatus,
      workspaceRoot,
    ]
  );

  const materializeProposal = useCallback(
    async (proposalId: string) => {
      if (!entry) return;
      const proposal = proposalsRef.current.find((p) => p.id === proposalId);
      if (!proposal) return;
      if (proposalUsesArchivedDetectClass(proposal as DetectProposal, {
        archivedClassIds: archivedDetectIdsRef.current,
        archivedClassKeys: archivedClassKeysRef.current
      })) {
        setStatus("Proposal references an archived class. Restore the class in Library before materializing it.");
        return;
      }
      pushUndo("materialize proposal");
      const detectedBox = materializeProposalFn(proposal as DetectProposal);
      const newBox: api.LabelBox = {
        classId: detectedBox.classId ?? classRef.current,
        x: detectedBox.x,
        y: detectedBox.y,
        w: detectedBox.w,
        h: detectedBox.h
      };
      const nextBoxes = [...boxesRef.current, newBox];
      boxesRef.current = nextBoxes;
      setBoxes(nextBoxes);
      const nextProposals = proposalsRef.current.filter((p) => p.id !== proposalId);
      proposalsRef.current = nextProposals;
      setProposals(nextProposals as DetectProposal[]);
      setSelectedProposalId(null);
      setSelectedBoxId(nextBoxes.length - 1);
      selectedRef.current = nextBoxes.length - 1;
      ephemeralProposalIdsRef.current.delete(proposalId);
      const persistentNextProposals = nextProposals.filter(
        (proposal) => !ephemeralProposalIdsRef.current.has(proposal.id)
      );
      await Promise.all([
        persistEntryLabels(entry, nextBoxes),
        persistProposals(persistentNextProposals)
      ]);
      setStatus(`Proposal accepted (${nextBoxes.length} box(es) total).`);
    },
    [boxesRef, classRef, entry, persistEntryLabels, persistProposals, proposalsRef, pushUndo, selectedRef, setBoxes, setStatus]
  );

  const rejectProposal = useCallback(
    async (proposalId: string) => {
      if (!entry) return;
      pushUndo("reject proposal");
      const nextProposals = proposalsRef.current.filter((p) => p.id !== proposalId);
      proposalsRef.current = nextProposals;
      ephemeralProposalIdsRef.current.delete(proposalId);
      setProposals(nextProposals as DetectProposal[]);
      setSelectedProposalId(null);
      await persistProposals(nextProposals.filter((proposal) => !ephemeralProposalIdsRef.current.has(proposal.id)));
      setStatus(`Proposal rejected (${nextProposals.length} remaining).`);
    },
    [entry, persistProposals, proposalsRef, pushUndo, setStatus]
  );

  const acceptAllProposals = useCallback(
    async () => {
      if (!entry || !proposalsRef.current.length) return;
      const activeProposals = proposalsRef.current.filter((p) =>
        !proposalUsesArchivedDetectClass(p as DetectProposal, {
          archivedClassIds: archivedDetectIdsRef.current,
          archivedClassKeys: archivedClassKeysRef.current
        })
      );
      const skippedArchived = proposalsRef.current.length - activeProposals.length;
      if (!activeProposals.length) {
        setStatus("All proposals reference archived classes. Restore those classes in Library before materializing.");
        return;
      }
      pushUndo("accept all proposals");
      const newBoxes = activeProposals.map((p) => {
        const det = materializeProposalFn(p as DetectProposal);
        return { classId: det.classId ?? classRef.current, x: det.x, y: det.y, w: det.w, h: det.h } as api.LabelBox;
      });
      const nextBoxes = [...boxesRef.current, ...newBoxes];
      boxesRef.current = nextBoxes;
      setBoxes(nextBoxes);
      const nextProposals = proposalsRef.current.filter((p) =>
        proposalUsesArchivedDetectClass(p as DetectProposal, {
          archivedClassIds: archivedDetectIdsRef.current,
          archivedClassKeys: archivedClassKeysRef.current
        })
      );
      proposalsRef.current = nextProposals;
      setProposals(nextProposals as DetectProposal[]);
      setSelectedProposalId(null);
      await Promise.all([persistEntryLabels(entry, nextBoxes), persistProposals(nextProposals)]);
      setStatus(
        skippedArchived > 0
          ? `Accepted ${newBoxes.length} proposal(s); ${skippedArchived} archived-class proposal(s) left for restore/reject.`
          : `Accepted all proposals (${newBoxes.length} new box(es)).`
      );
    },
    [boxesRef, classRef, entry, persistEntryLabels, persistProposals, proposalsRef, pushUndo, setBoxes, setStatus]
  );

  const rejectAllProposals = useCallback(
    async () => {
      if (!entry || !proposalsRef.current.length) return;
      pushUndo("reject all proposals");
      proposalsRef.current = [];
      ephemeralProposalIdsRef.current.clear();
      setProposals([]);
      setSelectedProposalId(null);
      await persistProposals([]);
      setStatus("All proposals rejected.");
    },
    [entry, persistProposals, proposalsRef, pushUndo, setStatus]
  );

  const buildQueueEntries = useCallback((): ReviewQueueEntry[] => {
    return entries.map((e, i) => ({
      index: i,
      key: e.basename,
      hasProposals: false,
      hasAutoBoxes: false,
      isEmpty: false,
      isReviewed: metadataRef.current.get(e.basename)?.reviewed ?? false,
      isJunk: metadataRef.current.get(e.basename)?.detect_junk ?? false
    }));
  }, [entries]);

  const nextNeedsReview = useCallback(() => {
    const queueEntries = buildQueueEntries();
    const idx = nextNeedsReviewIndex(queueEntries, currentIndex);
    if (idx !== null) {
      onNavigate(idx);
    } else {
      setStatus("All images reviewed — no unreviewed images remaining.");
    }
  }, [buildQueueEntries, currentIndex, onNavigate]);

  const prevNeedsReview = useCallback(() => {
    const queueEntries = buildQueueEntries();
    const idx = prevNeedsReviewIndex(queueEntries, currentIndex);
    if (idx !== null) {
      onNavigate(idx);
    } else {
      setStatus("All images reviewed — no unreviewed images remaining.");
    }
  }, [buildQueueEntries, currentIndex, onNavigate]);

  const labelClasses = useBoxLabelClasses({
    datasetRoot,
    workspaceRoot,
    initialShortcutSlots,
    initialFixedBoxSlots,
    initialPointerToolEnabled,
    initialAutoFitEnabled,
    onShortcutSlotsChange,
    onToolStateChange,
    boxesRef,
    selectedRef,
    classRef,
    dragRef,
    pushUndo,
    persistLabels: persistLabelsProxy,
    scheduleDraw,
    setBoxes,
    setStatus
  });

  classesSetCurrentClassRef.current = labelClasses.setCurrentClass;
  archivedDetectIdsRef.current = labelClasses.archivedDetectIdsRef.current;
  archivedClassKeysRef.current = labelClasses.archivedClassKeysRef.current;

  useEffect(() => {
    classIdByNameRef.current = buildClassIdByName(
      labelClasses.classes.filter((item) => !labelClasses.archivedDetectIds.has(item.id))
    );
  }, [labelClasses.archivedDetectIds, labelClasses.classes]);

  const {
    pendingBoxSelectionRef,
    pendingNearestBoxRef,
    syncBoxToSelected,
    copySelectedBoxToNext,
    advanceDuplicateToNext,
    trackCsrtForward,
    duplicateFlow,
    selectDuplicateItem,
    pauseDuplicateFlow,
    resumeDuplicateFlow,
    deleteDuplicateFlow
  } = useBoxTracking({
      datasetRoot,
      entry,
      filename,
      entries,
      currentIndex,
      classes: labelClasses.classes,
      boxesRef,
      selectedRef,
      selectedBoxId,
      shiftSelectedFilenamesRef,
      persistEntryLabels,
      onNavigate,
      setBoxes,
      setSelectedBoxId,
      setCurrentClass: labelClasses.setCurrentClass,
      setTracking,
      setStatus,
      pushBatchUndo
    });

  const interaction = useBoxLabelInteraction({
    workspaceRoot,
    datasetRoot,
    mediaImagePath,
    entry,
    entries,
    currentIndex,
    filename,
    onNavigate,
    onNavigateBoundary,
    disableMediaNavigationHotkeys,
    onToggleReviewed,
    onToggleFlagged,
    onMarkJunk,
    onUndoJunk,
    onLabelsChanged,
    persistEntryLabels,
    boxesRef,
    selectedRef,
    classRef,
    dragRef,
    modeRef: labelClasses.modeRef,
    showGridRef,
    boxAdjustModeRef,
    keyboardStepMultiplier,
    setKeyboardStepMultiplier,
    classesRef: labelClasses.classesRef,
    pointerToolEnabled: labelClasses.pointerToolEnabled,
    autoFitEnabled: labelClasses.autoFitEnabled,
    blackBoxEnabled: labelClasses.blackBoxEnabled,
    fixedBoxSlots: labelClasses.fixedBoxSlots,
    setCurrentClass: labelClasses.setCurrentClass,
    setClassSearch: labelClasses.setClassSearch,
    archivedDetectIdsRef: labelClasses.archivedDetectIdsRef,
    setBoxAdjustMode: labelClasses.setBoxAdjustMode,
    recordFixedBoxFromBox: labelClasses.recordFixedBoxFromBox,
    selectClassShortcut: labelClasses.selectClassShortcut,
    togglePointerTool: labelClasses.togglePointerTool,
    toggleAutoFitTool: labelClasses.toggleAutoFitTool,
    toggleBlackBoxTool: labelClasses.toggleBlackBoxTool,
    pushUndo,
    pushImageUndo,
    undoLast,
    redoLast,
    syncBoxToSelected,
    copySelectedBoxToNext,
    advanceDuplicateToNext,
    trackCsrtForward,
    duplicateFlow,
    setBoxes,
    setSelectedBoxId,
    setStatus,
    setError,
    setImageVersion,
    proposalsRef,
    selectedProposalIdRef,
    setSelectedProposalId,
    onMaterializeProposal: materializeProposal
  });

  scheduleDrawRef.current = interaction.scheduleDraw;
  persistLabelsRef.current = interaction.persistLabels;

  useEffect(() => {
    selectedFilenamesRef.current = selectedFilenames;
    shiftSelectedFilenamesRef.current = shiftSelectedFilenames;
  }, [selectedFilenames, shiftSelectedFilenames]);

  useEffect(() => {
    onStatusText?.(status);
  }, [onStatusText, status]);

  useEffect(() => {
    boxesRef.current = boxes;
    scheduleDraw();
  }, [boxes, scheduleDraw]);

  useEffect(() => {
    selectedRef.current = selectedBoxId;
    scheduleDraw();
  }, [selectedBoxId, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [labelClasses.classes, labelClasses.currentClass, scheduleDraw]);

  useEffect(() => {
    proposalsRef.current = proposals as ProposalShape[];
    scheduleDraw();
  }, [proposals, scheduleDraw]);

  useEffect(() => {
    selectedProposalIdRef.current = selectedProposalId;
    scheduleDraw();
  }, [selectedProposalId, scheduleDraw]);

  useEffect(() => {
    showGridRef.current = showGrid;
    scheduleDraw();
  }, [showGrid, scheduleDraw]);

  useEffect(() => {
    boxAdjustModeRef.current = labelClasses.boxAdjustMode;
  }, [labelClasses.boxAdjustMode]);

  useEffect(() => {
    loadMetadataMap(workspaceRoot)
      .then((map) => {
        metadataRef.current = map;
      })
      .catch(() => {});
  }, [workspaceRoot]);

  // Reload labels when the active image changes; avoid deps that would re-fetch on every editor tick.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!datasetRoot || !entry) {
        setBoxes([]);
        return;
      }
      const loadStartedAtRevision = contentRevisionRef.current;
      setError("");
      setStatus("Loading labels...");
      setSelectedBoxId(null);
      selectedRef.current = null;
      interaction.zoomPointRef.current = null;
      dragRef.current = null;
      interaction.viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
      try {
        if (imageVersion > 0) invalidateDatasetImageUrl(datasetRoot, entry.imagePath);
        const imageKey = imageProposalKey(entry.imagePath);
        const [labelBoxes, image, proposalManifest] = await Promise.all([
          loadLabelsOverride ? loadLabelsOverride(entry) : loadEntryLabels(datasetRoot, entry),
          videoUrlOverride
            ? Promise.resolve(null)
            : (imageUrlOverride ? Promise.resolve(imageUrlOverride) : datasetPreviewImageUrl(datasetRoot, entry.imagePath))
              .then((imageUrl) => loadCanvasImage(imageUrl)),
          disableProposals || !workspaceRoot ? Promise.resolve(null) : loadImageProposals(workspaceRoot, imageKey)
        ]);
        if (cancelled) return;
        if (image) {
          const shouldApplyInitialImage =
            reloadLabelsOnImageUrlChange || previewImageRequestRef.current === 0;
          if (shouldApplyInitialImage) interaction.imageRef.current = image;
        }
        if (loadStartedAtRevision !== contentRevisionRef.current) {
          scheduleDraw();
          return;
        }
        boxesRef.current = labelBoxes;
        setBoxes(labelBoxes);
        const loadedProposals = proposalManifest?.proposals ?? [];
        ephemeralProposalIdsRef.current.clear();
        proposalsRef.current = loadedProposals as ProposalShape[];
        setProposals(loadedProposals);
        setSelectedProposalId(null);
        if (pendingBoxSelectionRef.current) {
          const pending = pendingBoxSelectionRef.current;
          pendingBoxSelectionRef.current = null;
          if (pending.boxIndex >= 0 && pending.boxIndex < labelBoxes.length) {
            setSelectedBoxId(pending.boxIndex);
            labelClasses.setCurrentClass(pending.classId);
            selectedRef.current = pending.boxIndex;
          }
        } else if (pendingNearestBoxRef.current && selectedRef.current === null) {
          const nearest = findNearestBoxIndex(labelBoxes, pendingNearestBoxRef.current);
          pendingNearestBoxRef.current = null;
          if (nearest >= 0) {
            setSelectedBoxId(nearest);
            labelClasses.setCurrentClass(labelBoxes[nearest].classId);
            selectedRef.current = nearest;
          }
        } else {
          setSelectedBoxId(null);
        }
        setStatus(`${labelBoxes.length} box(es) loaded.`);
        scheduleDraw();
      } catch (err) {
        if (cancelled) return;
        setBoxes([]);
        proposalsRef.current = [];
        ephemeralProposalIdsRef.current.clear();
        setProposals([]);
        setError(errMessage(err));
        setStatus("Load failed.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when image path or backup restore version changes
  }, [datasetRoot, disableProposals, entryImagePath, imageUrlReloadKey, imageVersion, loadLabelsOverride, videoUrlOverride, workspaceRoot]);

  useEffect(() => {
    if (videoUrlOverride || reloadLabelsOnImageUrlChange || !datasetRoot || !entry || !imageUrlOverride) return;
    let cancelled = false;
    const requestId = nextPreviewImageRequestId(previewImageRequestRef.current);
    previewImageRequestRef.current = requestId;
    const targetImagePath = entry.imagePath;
    loadCanvasImage(imageUrlOverride)
      .then((image) => {
        if (cancelled) return;
        if (!shouldApplyPreviewImageRequest({
          requestId,
          latestRequestId: previewImageRequestRef.current,
          targetImagePath,
          currentImagePath: entryRef.current?.imagePath,
        })) return;
        interaction.imageRef.current = image;
        scheduleDraw();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [datasetRoot, entry, imageUrlOverride, interaction.imageRef, reloadLabelsOnImageUrlChange, scheduleDraw, videoUrlOverride]);

  useEffect(() => {
    if (!videoUrlOverride) return;
    let cancelled = false;
    const video = document.createElement("video");
    video.style.position = "fixed";
    video.style.left = "-1px";
    video.style.top = "-1px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    videoElementRef.current = video;

    const applyVideoSource = () => {
      if (cancelled || videoElementRef.current !== video) return;
      interaction.imageRef.current = video;
      scheduleDraw();
    };
    const handleLoadedMetadata = () => {
      const nextTime = Math.max(0, videoPlaybackTimeRef.current || 0);
      if (Number.isFinite(nextTime) && Math.abs(video.currentTime - nextTime) > 0.02) {
        video.currentTime = nextTime;
      }
      applyVideoSource();
    };
    const handleTimeUpdate = () => {
      videoPlaybackTimeChangeRef.current?.(video.currentTime);
      scheduleDraw();
    };
    const handleEnded = () => {
      videoEndedRef.current?.();
      scheduleDraw();
    };
    const handleError = () => {
      if (cancelled || videoElementRef.current !== video) return;
      const code = video.error?.code;
      const message = code ? `Video failed to load (media error ${code}).` : "Video failed to load.";
      if (videoLoadErrorRef.current) videoLoadErrorRef.current({ code, message });
      else setError(message);
      scheduleDraw();
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", applyVideoSource);
    video.addEventListener("seeked", applyVideoSource);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    document.body.appendChild(video);
    video.src = videoUrlOverride;
    video.load();

    return () => {
      cancelled = true;
      video.pause();
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", applyVideoSource);
      video.removeEventListener("seeked", applyVideoSource);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeAttribute("src");
      video.load();
      video.remove();
      if (videoElementRef.current === video) videoElementRef.current = null;
      if (interaction.imageRef.current === video) interaction.imageRef.current = null;
    };
  }, [interaction.imageRef, scheduleDraw, setError, videoUrlOverride]);

  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    const nextTime = Math.max(0, videoPlaybackTime || 0);
    if (Math.abs(video.currentTime - nextTime) > 0.08) {
      video.currentTime = nextTime;
      scheduleDraw();
    }
  }, [scheduleDraw, videoPlaybackTime]);

  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    if (videoPlaying) {
      void video.play().catch(() => {
        videoLoadErrorRef.current?.({ message: "Video playback failed." });
      });
    } else {
      video.pause();
      scheduleDraw();
    }
  }, [scheduleDraw, videoPlaying]);

  useEffect(() => {
    if (!videoPlaying) return;
    let frame = 0;
    const draw = () => {
      scheduleDraw();
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [scheduleDraw, videoPlaying]);

  const selectedBox = selectedBoxId !== null ? boxes[selectedBoxId] : null;
  const filterText = [
    includeClasses.size ? `include ${[...includeClasses].sort((a, b) => a - b).join(",")}` : "",
    excludeClasses.size ? `exclude ${[...excludeClasses].sort((a, b) => a - b).join(",")}` : "",
    imageViewMode !== "all" ? imageViewMode : ""
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    canvasRef: interaction.canvasRef,
    stageRef: interaction.stageRef,
    zoomCanvasRef: interaction.zoomCanvasRef,
    boxes,
    classes: labelClasses.classes,
    currentClass: labelClasses.currentClass,
    selectedBoxId,
    selectedBox,
    shortcutSlots: labelClasses.shortcutSlots,
    fixedBoxSlots: labelClasses.fixedBoxSlots,
    fixedShortcutMode: labelClasses.fixedShortcutMode,
    activeShortcutSlot: labelClasses.activeShortcutSlot,
    recordingFixedBoxSlot: labelClasses.recordingFixedBoxSlot,
    pointerToolEnabled: labelClasses.pointerToolEnabled,
    autoFitEnabled: labelClasses.autoFitEnabled,
    blackBoxEnabled: labelClasses.blackBoxEnabled,
    boxAdjustMode: labelClasses.boxAdjustMode,
    keyboardStepMultiplier,
    setKeyboardStepMultiplier,
    tracking,
    error,
    status,
    filterText,
    shiftSelectedFilenames,
    classNameInput: labelClasses.classNameInput,
    setClassNameInput: labelClasses.setClassNameInput,
    classSearch: labelClasses.classSearch,
    setClassSearch: labelClasses.setClassSearch,
    filteredClasses: labelClasses.filteredClasses,
    includeClasses,
    excludeClasses,
    currentIndex,
    entries,
    onPointerDown: interaction.onPointerDown,
    onPointerMove: interaction.onPointerMove,
    onPointerUp: interaction.onPointerUp,
    onWheel: interaction.onWheel,
    togglePointerTool: labelClasses.togglePointerTool,
    toggleAutoFitTool: labelClasses.toggleAutoFitTool,
    toggleBlackBoxTool: labelClasses.toggleBlackBoxTool,
    setBoxAdjustMode: labelClasses.setBoxAdjustMode,
    restoreBackup: interaction.restoreBackup,
    copySelectedBoxToNext,
    advanceDuplicateToNext,
    trackCsrtForward,
    duplicateFlow,
    selectDuplicateItem,
    pauseDuplicateFlow,
    resumeDuplicateFlow,
    deleteDuplicateFlow,
    selectClassShortcut: labelClasses.selectClassShortcut,
    startFixedBoxRecording: labelClasses.startFixedBoxRecording,
    setShortcutSlots: labelClasses.setShortcutSlots,
    setStatus,
    setSelectedBoxId,
    setCurrentClass: labelClasses.setCurrentClass,
    isArchivedDetectClass: labelClasses.isArchivedDetectClass,
    isArchivedClassKey: labelClasses.isArchivedClassKey,
    classShortcutOptions: labelClasses.classShortcutOptions,
    fixedShortcutOptions: labelClasses.fixedShortcutOptions,
    assignClass: labelClasses.assignClass,
    applyClassToSelectedBox: labelClasses.applyClassToSelectedBox,
    addClass: labelClasses.addClass,
    onClearClassFilters,
    onAddIncludeClass,
    onAddExcludeClass,
    setError,
    proposals,
    selectedProposalId,
    setSelectedProposalId,
    addProposals,
    applyAutoLabelPredictions,
    materializeProposal,
    rejectProposal,
    acceptAllProposals,
    rejectAllProposals,
    nextNeedsReview,
    prevNeedsReview
  };
}
