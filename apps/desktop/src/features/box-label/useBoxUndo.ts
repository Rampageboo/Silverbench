/**
 * Scoped undo/redo hook for Box Label.
 *
 * Safety guarantees:
 *  - Ctrl+Z only undoes the CURRENT image (matched by filename scope key).
 *  - Ctrl+Y / Ctrl+Shift+Z only redoes the CURRENT image.
 *  - If the current image has no undo history: show a message, do nothing.
 *  - If the current image has no redo history: show a message, do nothing.
 *  - Navigating away discards any uncommitted pending transaction for the old image
 *    so the "after" snapshot is never captured from the wrong image.
 *  - Batch operations (copySelectedBoxToNext, trackCsrtForward) are not undoable
 *    via Ctrl+Z to prevent silent cross-image modification.
 *  - Image source mutations (blackbox tool) are not tracked here; use non-destructive
 *    overlays instead (see blackout overlay architecture).
 */

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import * as api from "../../api";
import type { BoxLabelEntry } from "./boxLabelCore";
import type { ProposalShape } from "./geometry";
import {
  emptyUndoRedoState,
  pushScopedTransaction,
  undoScoped,
  redoScoped,
  type BoxLabelEditorSnapshot,
  type BoxLabelUndoTransaction,
  type ScopedUndoRedoState
} from "./boxLabelUndoDomain";

const UNDO_LIMIT = 50;

let _undoIdCounter = 0;
function nextUndoId(): string {
  _undoIdCounter += 1;
  return `undo_${_undoIdCounter}`;
}

type UseBoxUndoOptions = {
  /** Basename of the currently visible image. Used as the scope key. */
  filename: string;
  /** The currently visible entry. Persist target for undo/redo restores. */
  entry: BoxLabelEntry | null;
  persistEntryLabels: (target: BoxLabelEntry, boxes: api.LabelBox[]) => Promise<api.LabelBox[]>;
  persistProposals?: (proposals: ProposalShape[]) => Promise<void>;
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  classRef: MutableRefObject<number>;
  proposalsRef?: MutableRefObject<ProposalShape[]>;
  selectedProposalIdRef?: MutableRefObject<string | null>;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setCurrentClass: (classId: number) => void;
  setProposals?: (proposals: ProposalShape[]) => void;
  setSelectedProposalId?: (id: string | null) => void;
  setStatus: (status: string) => void;
  scheduleDraw: () => void;
};

export function useBoxUndo({
  filename,
  entry,
  persistEntryLabels,
  persistProposals,
  boxesRef,
  selectedRef,
  classRef: _classRef,
  proposalsRef,
  selectedProposalIdRef: _selectedProposalIdRef,
  setBoxes,
  setSelectedBoxId,
  setCurrentClass,
  setProposals,
  setSelectedProposalId,
  setStatus,
  scheduleDraw
}: UseBoxUndoOptions) {
  // All undo/redo state lives here. It is NOT React state (no re-render needed).
  const undoStateRef = useRef<ScopedUndoRedoState>(emptyUndoRedoState());

  // Two-phase commit: pushUndo captures "before", the transaction is committed when
  // the next pushUndo/undoLast/redoLast runs (capturing current state as "after").
  const pendingRef = useRef<{
    label: string;
    before: BoxLabelEditorSnapshot;
    scopeKey: string;
  } | null>(null);

  // When the scope key (filename) changes due to navigation, discard the pending
  // transaction so the "after" snapshot is never captured from the new image.
  const prevFilenameRef = useRef(filename);
  useEffect(() => {
    if (prevFilenameRef.current !== filename) {
      pendingRef.current = null;
    }
    prevFilenameRef.current = filename;
  }, [filename]);

  const captureSnapshot = useCallback((): BoxLabelEditorSnapshot => ({
    boxes: boxesRef.current.map(b => ({ ...b })),
    proposals: (proposalsRef?.current ?? []).map(p => ({ ...p })) as import("../video/videoAnnotationApi").DetectProposal[],
    selectedBoxIndex: selectedRef.current
  }), [boxesRef, proposalsRef, selectedRef]);

  /**
   * Commit any pending transaction. The current state is the "after" snapshot.
   * Safe to call when there is no pending transaction (no-op).
   */
  const flushPendingTransaction = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    // Guard: if the user navigated away, the scope key won't match current filename.
    if (pending.scopeKey !== filename) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    const after = captureSnapshot();
    const transaction: BoxLabelUndoTransaction = {
      id: nextUndoId(),
      scopeKey: pending.scopeKey,
      label: pending.label,
      before: pending.before,
      after,
      createdAt: new Date().toISOString()
    };
    undoStateRef.current = pushScopedTransaction(undoStateRef.current, transaction, UNDO_LIMIT);
  }, [captureSnapshot, filename]);

  /**
   * Call BEFORE making an edit. Captures the "before" snapshot for this undo unit.
   * If called again before the previous unit is committed, the previous unit is
   * committed first with the current state as "after".
   *
   * This matches the existing call-site pattern: pushUndo("action") then mutate.
   */
  const pushUndo = useCallback((label: string) => {
    flushPendingTransaction();     // commit previous pending if any
    if (!filename) return;         // no visible image, nothing to track
    pendingRef.current = {
      label,
      before: captureSnapshot(),
      scopeKey: filename
    };
  }, [captureSnapshot, filename, flushPendingTransaction]);

  /** No-op: image source mutations (blackbox) are not tracked in label undo. */
  const pushImageUndo = useCallback(
    (_action: string, _imageBase64: string) => {
      // Intentional no-op. Blackbox edits modify source image files, which is a
      // separate concern from label undo. Use non-destructive blackout overlays instead.
    },
    []
  );

  /** No-op: batch operations are not undoable via Ctrl+Z to prevent cross-image modification. */
  const pushBatchUndo = useCallback(
    (_action: string, _snapshots: Array<{ filename: string; boxes: api.LabelBox[] }>) => {
      // Intentional no-op. Batch ops (copy-to-next, CSRT forward) modify multiple images.
      // Allowing Ctrl+Z to silently restore other images is unsafe. Navigate to each
      // affected image and use Ctrl+Z there if needed.
    },
    []
  );

  /** Apply a snapshot to the CURRENT entry only. Never touches another file. */
  const applySnapshot = useCallback(
    async (snap: BoxLabelEditorSnapshot) => {
      const target = entry;
      if (!target) return;
      // Restore boxes
      boxesRef.current = snap.boxes.map(b => ({ ...b }));
      setBoxes(boxesRef.current);
      const nextSelectedIndex =
        snap.selectedBoxIndex !== null &&
        snap.selectedBoxIndex !== undefined &&
        snap.selectedBoxIndex >= 0 &&
        snap.selectedBoxIndex < snap.boxes.length
          ? snap.selectedBoxIndex
          : null;
      setSelectedBoxId(nextSelectedIndex);
      if (nextSelectedIndex !== null && snap.boxes[nextSelectedIndex]) {
        setCurrentClass(snap.boxes[nextSelectedIndex].classId);
      }
      // Restore proposals (only if the hook received proposal refs and setters)
      if (proposalsRef && setProposals) {
        const nextProposals = (snap.proposals ?? []).map(p => ({ ...p }));
        proposalsRef.current = nextProposals;
        setProposals(nextProposals);
      }
      setSelectedProposalId?.(null);
      // Persist both boxes and proposals to their respective files
      await persistEntryLabels(target, boxesRef.current);
      if (persistProposals && proposalsRef) {
        await persistProposals(proposalsRef.current);
      }
    },
    [boxesRef, entry, persistEntryLabels, persistProposals, proposalsRef, setBoxes, setCurrentClass, setProposals, setSelectedBoxId, setSelectedProposalId]
  );

  /**
   * Undo the most recent action for the current image.
   * If there is nothing to undo for this image: shows a message and does nothing.
   * Never navigates. Never modifies another image.
   */
  const undoLast = useCallback(async () => {
    if (!filename || !entry) {
      setStatus("Nothing to undo.");
      return;
    }
    // Commit pending transaction so redo can restore the full "after" state.
    flushPendingTransaction();
    const { nextState, transaction } = undoScoped(undoStateRef.current, filename);
    if (!transaction) {
      setStatus("Nothing to undo for this image.");
      return;
    }
    undoStateRef.current = nextState;
    await applySnapshot(transaction.before);
    setStatus(`Undid "${transaction.label}".`);
    scheduleDraw();
  }, [applySnapshot, entry, filename, flushPendingTransaction, scheduleDraw, setStatus]);

  /**
   * Redo the most recently undone action for the current image.
   * If there is nothing to redo: shows a message and does nothing.
   * Never navigates. Never modifies another image.
   */
  const redoLast = useCallback(async () => {
    if (!filename || !entry) {
      setStatus("Nothing to redo.");
      return;
    }
    flushPendingTransaction();
    const { nextState, transaction } = redoScoped(undoStateRef.current, filename);
    if (!transaction) {
      setStatus("Nothing to redo for this image.");
      return;
    }
    undoStateRef.current = nextState;
    await applySnapshot(transaction.after);
    setStatus(`Redid "${transaction.label}".`);
    scheduleDraw();
  }, [applySnapshot, entry, filename, flushPendingTransaction, scheduleDraw, setStatus]);

  return { pushUndo, pushImageUndo, pushBatchUndo, undoLast, redoLast };
}
