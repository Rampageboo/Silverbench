import { useCallback, useEffect, useRef, useState } from "react";
import { loadedModels, releaseModels, type LoadedModels } from "../../api";
import { useDismiss } from "../../ui/useDismiss";

const POLL_MS = 15_000;

function minutes(seconds: number) {
  return seconds < 60 ? "Used just now" : `Used ${Math.round(seconds / 60)} min ago`;
}

/**
 * Shows which models the backend holds in memory and lets the user free them.
 * Models load on first use and are released after an idle period on their own;
 * this is only visible while something is actually loaded.
 */
export function ModelMemoryStatus({ connected, collapsed }: { connected: boolean; collapsed: boolean }) {
  const [state, setState] = useState<LoadedModels | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [triggerRef, menuRef], close);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setState(await loadedModels(signal));
    } catch {
      // Status only: a missing backend is already shown next to this.
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), open ? 3_000 : POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [connected, open, refresh]);

  async function release(path?: string) {
    setBusy(true);
    try {
      setState(await releaseModels(path));
    } finally {
      setBusy(false);
    }
  }

  const models = state?.models ?? [];
  if (!connected || !models.length) return null;
  const gpu = state?.gpu.reservedMB;
  const label = `Models ${models.length}${gpu ? ` · ${gpu >= 1024 ? `${(gpu / 1024).toFixed(1)} GB` : `${gpu} MB`}` : ""}`;

  return (
    <span className="shell-models">
      <button
        ref={triggerRef}
        type="button"
        className={`shell-status__item shell-status__btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title="Loaded models"
        aria-expanded={open}
      >
        <span className="ui-dot ui-dot--warn" />
        {collapsed ? null : <span>{label}</span>}
      </button>
      {open ? (
        <div ref={menuRef} className="ui-menu shell-models__menu" role="menu">
          <div className="ui-menu__label ui-eyebrow">Loaded models</div>
          {models.map((model) => (
            <div key={model.path} className="shell-models__row" title={model.path}>
              <span className="shell-models__text">
                <span>{model.name}</span>
                <span className="ui-menu__item-sub">{minutes(model.idleSeconds)}</span>
              </span>
              <button
                type="button"
                className="ui-btn--ghost ui-btn--sm"
                onClick={() => void release(model.path)}
                disabled={busy}
              >
                Release
              </button>
            </div>
          ))}
          <div className="ui-menu__sep" />
          <div className="shell-models__foot">
            <span className="ui-menu__item-sub">
              {state?.gpu.reservedMB !== undefined
                ? `GPU ${state.gpu.reservedMB} MB reserved (${state.gpu.allocatedMB ?? 0} MB allocated)`
                : "GPU not in use"}
            </span>
            <button type="button" className="ui-btn--sm" onClick={() => void release()} disabled={busy}>
              {busy ? "Releasing…" : "Release all"}
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
