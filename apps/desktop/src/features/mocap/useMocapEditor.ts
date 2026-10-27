import { useCallback, useEffect, useRef, useState } from "react";
import { mocapApi, type EditReply } from "./mocapApi";
import { EMPTY_EDITS, normalizeEdits, type EditSession } from "./mocapEdits";

const HISTORY_LIMIT = 200;

type Options = {
  workspaceRoot: string;
  takeId: string | null;
  enabled: boolean;
  /** The engine accepted an edit: patch the shown poses with the changed frames. */
  onApplied: (reply: EditReply) => void;
  onError: (message: string) => void;
};

/**
 * The take's edit session with undo/redo. Every change goes to the engine; it is
 * kept (and saved) only when the engine accepts it, so the screen never shows an
 * edit that was not applied. Requests run one at a time, in order.
 */
export function useMocapEditor({ workspaceRoot, takeId, enabled, onApplied, onError }: Options) {
  const [edits, setEdits] = useState<EditSession>(EMPTY_EDITS);
  const [past, setPast] = useState<EditSession[]>([]);
  const [future, setFuture] = useState<EditSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const current = useRef<EditSession>(EMPTY_EDITS);
  const callbacks = useRef({ onApplied, onError });
  callbacks.current = { onApplied, onError };

  useEffect(() => {
    setEdits(EMPTY_EDITS);
    current.current = EMPTY_EDITS;
    setPast([]);
    setFuture([]);
    setLoaded(false);
    if (!enabled || !takeId) return;
    let cancelled = false;
    mocapApi
      .edits(workspaceRoot, takeId)
      .then((value) => {
        if (cancelled) return;
        const normalized = normalizeEdits(value);
        current.current = normalized;
        setEdits(normalized);
        setLoaded(true);
      })
      .catch((error) => callbacks.current.onError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, takeId, enabled]);

  const submit = useCallback(
    (next: EditSession, kind: "do" | "undo" | "redo") => {
      if (!takeId) return;
      queue.current = queue.current.then(async () => {
        const before = current.current;
        setBusy(true);
        try {
          const reply = await mocapApi.saveEdits(workspaceRoot, takeId, next);
          current.current = next;
          setEdits(next);
          if (kind === "do") {
            setPast((list) => [...list.slice(-HISTORY_LIMIT + 1), before]);
            setFuture([]);
          } else if (kind === "undo") {
            setPast((list) => list.slice(0, -1));
            setFuture((list) => [before, ...list]);
          } else {
            setFuture((list) => list.slice(1));
            setPast((list) => [...list, before]);
          }
          callbacks.current.onApplied(reply);
        } catch (error) {
          callbacks.current.onError(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      });
    },
    [workspaceRoot, takeId]
  );

  /** Apply an edit built from the latest accepted session. */
  const change = useCallback(
    (build: (edits: EditSession) => EditSession) => {
      const next = build(current.current);
      if (next !== current.current) submit(next, "do");
    },
    [submit]
  );

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (previous) submit(previous, "undo");
  }, [past, submit]);

  const redo = useCallback(() => {
    const next = future[0];
    if (next) submit(next, "redo");
  }, [future, submit]);

  return { edits, loaded, busy, change, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
