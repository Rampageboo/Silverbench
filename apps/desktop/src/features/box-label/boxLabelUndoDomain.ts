/**
 * Pure scoped undo/redo domain for Box Label.
 *
 * Core invariants:
 *  - Every transaction is scoped to a single image or video timestamp.
 *  - undoScoped / redoScoped only operate on the matching scope key.
 *  - No function navigates. No function modifies another scope.
 *  - Transactions never carry navigation targets or currentIndex.
 */

import type * as api from "../../api";
import type { DetectProposal } from "../video/videoAnnotationApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UndoScopeKey = string;

/**
 * A complete capture of the editor state at one point in time.
 * All fields are shallow-copied so mutation of live state does not affect snapshots.
 */
export type BoxLabelEditorSnapshot = {
  boxes: api.LabelBox[];
  proposals: DetectProposal[];
  reviewed?: boolean;
  flagged?: boolean;
  selectedBoxIndex?: number | null;
  selectedProposalId?: string | null;
};

/**
 * One atomic undo/redo unit.
 *
 * - `before`: state to restore on undo
 * - `after`:  state to restore on redo
 * - `scopeKey`: the image / timestamp this transaction belongs to
 *
 * Must NEVER contain a navigation target, currentIndex, or reference to another scope.
 */
export type BoxLabelUndoTransaction = {
  id: string;
  scopeKey: UndoScopeKey;
  label: string;
  before: BoxLabelEditorSnapshot;
  after: BoxLabelEditorSnapshot;
  createdAt: string;
};

export type ScopedUndoRedoState = {
  undoByScope: Record<UndoScopeKey, BoxLabelUndoTransaction[]>;
  redoByScope: Record<UndoScopeKey, BoxLabelUndoTransaction[]>;
};

// ---------------------------------------------------------------------------
// Scope key helpers
// ---------------------------------------------------------------------------

/** Stable undo scope for an image pool entry. */
export function scopeKeyForImage(entry: { basename: string }): UndoScopeKey {
  return entry.basename;
}

/** Stable undo scope for a video timestamp. */
export function scopeKeyForVideoTimestamp(videoSourceKey: string, timestampMs: number): UndoScopeKey {
  return `${videoSourceKey}|${timestampMs}`;
}

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

export function emptyUndoRedoState(): ScopedUndoRedoState {
  return { undoByScope: {}, redoByScope: {} };
}

// ---------------------------------------------------------------------------
// Pure state transitions
// ---------------------------------------------------------------------------

/**
 * Push a new transaction onto the undo stack for its scope.
 * Clears the redo stack for that scope (new branch invalidates future).
 * Trims the stack if it exceeds `limit`.
 */
export function pushScopedTransaction(
  state: ScopedUndoRedoState,
  transaction: BoxLabelUndoTransaction,
  limit = 50
): ScopedUndoRedoState {
  const key = transaction.scopeKey;
  const undoStack = state.undoByScope[key] ?? [];
  const nextUndo = [...undoStack, transaction];
  if (nextUndo.length > limit) nextUndo.shift();
  return {
    undoByScope: { ...state.undoByScope, [key]: nextUndo },
    // Branching: clear redo for this scope only; other scopes unaffected.
    redoByScope: { ...state.redoByScope, [key]: [] }
  };
}

/**
 * Pop the most recent undo transaction for `scopeKey`.
 * Moves it to the redo stack.
 * Returns null transaction if there is nothing to undo for this scope.
 * NEVER touches any other scope.
 */
export function undoScoped(
  state: ScopedUndoRedoState,
  scopeKey: UndoScopeKey
): { nextState: ScopedUndoRedoState; transaction: BoxLabelUndoTransaction | null } {
  const undoStack = state.undoByScope[scopeKey];
  if (!undoStack || undoStack.length === 0) {
    return { nextState: state, transaction: null };
  }
  const nextUndo = [...undoStack];
  const transaction = nextUndo.pop()!;
  const redoStack = state.redoByScope[scopeKey] ?? [];
  return {
    nextState: {
      undoByScope: { ...state.undoByScope, [scopeKey]: nextUndo },
      redoByScope: { ...state.redoByScope, [scopeKey]: [...redoStack, transaction] }
    },
    transaction
  };
}

/**
 * Pop the most recent redo transaction for `scopeKey`.
 * Moves it back to the undo stack.
 * Returns null transaction if there is nothing to redo for this scope.
 * NEVER touches any other scope.
 */
export function redoScoped(
  state: ScopedUndoRedoState,
  scopeKey: UndoScopeKey
): { nextState: ScopedUndoRedoState; transaction: BoxLabelUndoTransaction | null } {
  const redoStack = state.redoByScope[scopeKey];
  if (!redoStack || redoStack.length === 0) {
    return { nextState: state, transaction: null };
  }
  const nextRedo = [...redoStack];
  const transaction = nextRedo.pop()!;
  const undoStack = state.undoByScope[scopeKey] ?? [];
  return {
    nextState: {
      undoByScope: { ...state.undoByScope, [scopeKey]: [...undoStack, transaction] },
      redoByScope: { ...state.redoByScope, [scopeKey]: nextRedo }
    },
    transaction
  };
}

/**
 * Wipe both undo and redo stacks for `scopeKey`.
 * Other scopes are not affected.
 */
export function clearScopeHistory(
  state: ScopedUndoRedoState,
  scopeKey: UndoScopeKey
): ScopedUndoRedoState {
  return {
    undoByScope: { ...state.undoByScope, [scopeKey]: [] },
    redoByScope: { ...state.redoByScope, [scopeKey]: [] }
  };
}

export function hasUndoForScope(state: ScopedUndoRedoState, scopeKey: UndoScopeKey): boolean {
  return (state.undoByScope[scopeKey]?.length ?? 0) > 0;
}

export function hasRedoForScope(state: ScopedUndoRedoState, scopeKey: UndoScopeKey): boolean {
  return (state.redoByScope[scopeKey]?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

export function snapshotBoxesOnly(boxes: api.LabelBox[], selectedBoxIndex: number | null = null): BoxLabelEditorSnapshot {
  return {
    boxes: boxes.map(b => ({ ...b })),
    proposals: [],
    selectedBoxIndex
  };
}

export function snapshotWithProposals(
  boxes: api.LabelBox[],
  proposals: DetectProposal[],
  selectedBoxIndex: number | null = null,
  selectedProposalId: string | null = null
): BoxLabelEditorSnapshot {
  return {
    boxes: boxes.map(b => ({ ...b })),
    proposals: [...proposals],
    selectedBoxIndex,
    selectedProposalId
  };
}
