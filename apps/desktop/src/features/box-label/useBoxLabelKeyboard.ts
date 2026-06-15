import { useEffect, type MutableRefObject } from "react";
import { errMessage } from "../../lib/errors";
import { arrowKeyDelta, type BoxAdjustMode, type DragState } from "./geometry";

type UseBoxLabelKeyboardOptions = {
  dragRef: MutableRefObject<DragState>;
  keyboardAdjustingRef: MutableRefObject<boolean>;
  setSelectedBoxId: (id: number | null) => void;
  setBoxAdjustMode: (mode: BoxAdjustMode) => void;
  setStatus: (status: string) => void;
  setError: (status: string) => void;
  selectClassShortcut: (slot: number, useSlot?: boolean) => void;
  togglePointerTool: () => void;
  toggleAutoFitTool: () => void;
  toggleBlackBoxTool: () => void;
  onToggleReviewed: () => Promise<void>;
  onToggleFlagged: () => Promise<void>;
  onMarkJunk?: () => Promise<void>;
  onUndoJunk?: () => Promise<void>;
  undoLast: () => Promise<void>;
  copySelectedBoxToNext: () => Promise<void>;
  trackCsrtForward: () => Promise<void>;
  scheduleDraw: () => void;
  save: () => Promise<void>;
  deleteSelectedBox: () => void;
  createFixedBoxFromShortcut: (slot: number) => void;
  navigateRelative: (delta: number) => void;
  moveSelectedBoxByKeyboard: (dx: number, dy: number, fast: boolean) => void;
  resizeSelectedBoxByKeyboard: (key: string, fast: boolean) => void;
};

export function useBoxLabelKeyboard({
  dragRef,
  keyboardAdjustingRef,
  setSelectedBoxId,
  setBoxAdjustMode,
  setStatus,
  setError,
  selectClassShortcut,
  togglePointerTool,
  toggleAutoFitTool,
  toggleBlackBoxTool,
  onToggleReviewed,
  onToggleFlagged,
  onMarkJunk,
  onUndoJunk,
  undoLast,
  copySelectedBoxToNext,
  trackCsrtForward,
  scheduleDraw,
  save,
  deleteSelectedBox,
  createFixedBoxFromShortcut,
  navigateRelative,
  moveSelectedBoxByKeyboard,
  resizeSelectedBoxByKeyboard
}: UseBoxLabelKeyboardOptions) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" || target?.isContentEditable) return;
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
        return;
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLast().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedBox();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dragRef.current = null;
        setSelectedBoxId(null);
        scheduleDraw();
        return;
      }
      const digit = event.code.match(/^Digit(\d)$/);
      if (digit && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        selectClassShortcut(Number(digit[1]));
        return;
      }
      const altDigit = event.code.match(/^Digit(\d)$/);
      if (altDigit && event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        createFixedBoxFromShortcut(Number(altDigit[1]));
        return;
      }
      if (event.key.toLowerCase() === "a" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        navigateRelative(-1);
        return;
      }
      if (event.key.toLowerCase() === "d" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        navigateRelative(1);
        return;
      }
      if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onToggleReviewed().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onToggleFlagged().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.key.toLowerCase() === "w" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        toggleAutoFitTool();
        return;
      }
      if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        toggleBlackBoxTool();
        return;
      }
      if (event.key.toLowerCase() === "t" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        trackCsrtForward().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        copySelectedBoxToNext().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.key.toLowerCase() === "j" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onMarkJunk?.().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onUndoJunk?.().catch((err) => setError(errMessage(err)));
        return;
      }
      if (event.key.toLowerCase() === "v" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        togglePointerTool();
        return;
      }
      if (event.code === "NumpadAdd") {
        event.preventDefault();
        setBoxAdjustMode("grow");
        setStatus("Box keyboard resize: grow.");
        return;
      }
      if (event.code === "NumpadSubtract") {
        event.preventDefault();
        setBoxAdjustMode("shrink");
        setStatus("Box keyboard resize: shrink.");
        return;
      }
      const arrowDelta = arrowKeyDelta(event.key);
      if (arrowDelta) {
        event.preventDefault();
        moveSelectedBoxByKeyboard(arrowDelta.x, arrowDelta.y, event.shiftKey);
        return;
      }
      const numpad = event.code.match(/^Numpad([24568])$/);
      if (numpad) {
        event.preventDefault();
        resizeSelectedBoxByKeyboard(numpad[1], event.shiftKey);
      }
    }
    function onKeyUp() {
      keyboardAdjustingRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });
}
