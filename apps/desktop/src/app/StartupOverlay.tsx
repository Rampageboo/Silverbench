import { useEffect, useRef } from "react";
import "./startup.css";
import "./app.css";

type StartupOverlayProps = {
  visible: boolean;
  done?: boolean;
  mode?: import("./startupOverlayMode").StartupOverlayMode;
  progress: number;
  stage: string;
  detail: string;
  onPainted?: () => void;
  /** Installed app: the runtime could not be prepared; show its log and a retry. */
  failure?: { log: string[]; onRetry: () => void };
};

export function StartupOverlay({
  visible,
  done = false,
  mode = "overview",
  progress,
  stage,
  detail,
  onPainted,
  failure
}: StartupOverlayProps) {
  const paintedRef = useRef(false);

  useEffect(() => {
    if (!visible || paintedRef.current) return;

    let cancelled = false;
    const icon = new Image();
    icon.src = "/assets/app-icon.png";

    function signalPainted() {
      if (cancelled || paintedRef.current) return;
      paintedRef.current = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!cancelled) onPainted?.();
        });
      });
    }

    if (icon.complete) signalPainted();
    else {
      icon.onload = signalPainted;
      icon.onerror = signalPainted;
    }

    return () => {
      cancelled = true;
    };
  }, [visible, onPainted]);

  if (!visible) return null;

  const percent = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className={`startup-overlay startup-overlay--${mode}${done ? " is-done" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!done}
    >
      <section className="startup-panel" aria-label="Silverbench startup">
        <header className="startup-hero">
          <img
            className="startup-brand-mark startup-brand-image"
            src="/assets/app-icon.png"
            width={74}
            height={74}
            alt=""
          />
          <div className="startup-brand-mark startup-brand-abbrev" aria-hidden="true">
            RW
          </div>
          <div className="startup-copy">
            <h1>Silverbench</h1>
          </div>
        </header>
        <div className="startup-loading">
          <p>{stage}</p>
          <progress value={percent} max={100} />
          <div className="startup-progress-row">
            <span>{detail}</span>
            <span>{percent}%</span>
          </div>
          {failure ? (
            <div className="startup-failure">
              {failure.log.length ? <pre>{failure.log.slice(-8).join("\n")}</pre> : null}
              <button type="button" onClick={failure.onRetry}>
                Retry
              </button>
              <span>Logs: %LOCALAPPDATA%\RampageWorkbench\logs</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
