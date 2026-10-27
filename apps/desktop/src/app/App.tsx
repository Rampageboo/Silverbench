import { useCallback, useEffect, useRef, useState } from "react";
import { useBackend } from "../hooks/useBackend";
import { ToastProvider } from "../components/ToastProvider";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { WorkspaceCacheProvider } from "../features/shared/WorkspaceCacheProvider";
import { AppUpdateProvider } from "../features/update/AppUpdate";
import { retryRuntime, runtimeStatus, type RuntimeStatus } from "../lib/appRuntime";
import { readStartupOverlayMode } from "./startupOverlayMode";
import { inTauri, revealMainWindow } from "./splashscreen";
import { StartupOverlay } from "./StartupOverlay";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorkbenchBody } from "./WorkbenchBody";
import "./app.css";

type StartupPhase = "active" | "done" | "hidden";

export function App() {
  const { connected, error: backendError } = useBackend();
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("active");
  const [startupProgress, setStartupProgress] = useState(1);
  const [startupStage, setStartupStage] = useState("Preparing the workspace…");
  const [startupDetail, setStartupDetail] = useState("Loading the interface");
  const [startupMode] = useState(readStartupOverlayMode);
  const bootFinishedRef = useRef(false);
  const overlayPaintedRef = useRef(false);
  const [overlayPainted, setOverlayPainted] = useState(false);
  const startupActive = startupPhase !== "hidden";
  // Installed app: the first run installs the Python runtime before the backend exists.
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const runtimeBusyRef = useRef(false);
  runtimeBusyRef.current = !!runtime?.packaged && runtime.phase !== "running" && !connected;

  useEffect(() => {
    if (!inTauri() || connected) return;
    let cancelled = false;
    const poll = async () => {
      const status = await runtimeStatus();
      if (!cancelled) setRuntime(status);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connected]);

  const notifyNativeTabReady = useCallback(() => {
    window.dispatchEvent(new CustomEvent("ywb-native-tab-ready"));
  }, []);

  const handleOverlayPainted = useCallback(() => {
    if (overlayPaintedRef.current) return;
    overlayPaintedRef.current = true;
    setOverlayPainted(true);
    document.documentElement.classList.add("app-startup-overlay-ready");
  }, []);

  // PS pre-splash stays up until the intro overlay has fully painted in the
  // hidden main webview; then reveal with a short pause for a smooth handoff.
  useEffect(() => {
    if (!inTauri() || !overlayPainted) return;
    const timer = window.setTimeout(() => {
      void revealMainWindow();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [overlayPainted]);

  // Fallback: if painting never signals, reveal when boot finishes.
  useEffect(() => {
    if (!inTauri() || startupPhase !== "hidden") return;
    void revealMainWindow();
  }, [startupPhase]);

  useEffect(() => {
    document.documentElement.classList.toggle("app-startup-active", startupActive);
    document.body.classList.toggle("app-startup-active", startupActive);
    return () => {
      document.documentElement.classList.remove("app-startup-active");
      document.body.classList.remove("app-startup-active");
    };
  }, [startupActive]);

  useEffect(() => {
    if (!startupActive) return;
    if (!connected && runtime?.packaged && runtime.phase === "failed") {
      setStartupStage("Runtime setup failed");
      setStartupDetail(runtime.detail?.error || runtime.error || "See the log for details");
      return;
    }
    if (!connected && runtime?.packaged && runtime.phase === "preparing" && runtime.detail) {
      setStartupProgress(Math.max(1, Math.min(99, runtime.detail.percent)));
      setStartupStage(runtime.detail.message || "Preparing the runtime…");
      setStartupDetail(
        runtime.detail.log?.[runtime.detail.log.length - 1] ||
          "First launch downloads about 4 GB of dependencies"
      );
      return;
    }
    if (!connected) {
      setStartupProgress((value) => Math.max(value, 12));
      setStartupStage("Connecting to the backend…");
      setStartupDetail(backendError || "Waiting for FastAPI to start");
      return;
    }
    setStartupProgress((value) => Math.max(value, 28));
    setStartupStage("Restoring the workspace…");
    setStartupDetail("Backend connected, opening the last workspace");
  }, [backendError, connected, startupActive, runtime]);

  useEffect(() => {
    if (!startupActive) return;

    function finishStartup(detail = "Tools loaded") {
      if (bootFinishedRef.current) return;
      bootFinishedRef.current = true;
      setStartupProgress(100);
      setStartupStage("Ready");
      setStartupDetail(detail);
      setStartupPhase("done");
      window.setTimeout(() => setStartupPhase("hidden"), 280);
    }

    function onNativeTabReady() {
      finishStartup("Tools loaded");
    }

    // A first-run runtime install can take many minutes: keep waiting while it runs.
    let fallbackTimer = 0;
    const armFallback = () => {
      fallbackTimer = window.setTimeout(() => {
        if (runtimeBusyRef.current) armFallback();
        else finishStartup("Loading timed out; workbench opened");
      }, 90000);
    };
    armFallback();

    window.addEventListener("ywb-native-tab-ready", onNativeTabReady as EventListener);
    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("ywb-native-tab-ready", onNativeTabReady as EventListener);
    };
  }, [startupActive]);

  return (
    <>
      <StartupOverlay
        visible={startupActive}
        done={startupPhase === "done"}
        mode={startupMode}
        progress={startupProgress}
        stage={startupStage}
        detail={startupDetail}
        onPainted={handleOverlayPainted}
        failure={
          runtime?.packaged && runtime.phase === "failed" && !connected
            ? { log: runtime.detail?.log ?? [], onRetry: () => void retryRuntime() }
            : undefined
        }
      />
      <div className={`app-workbench-root${startupActive ? " app-workbench-root--booting" : ""}`}>
        <ToastProvider>
          <AppUpdateProvider>
            <ConfirmProvider>
              <WorkspaceCacheProvider>
                <WorkspaceProvider connected={connected}>
                  <WorkbenchBody
                    onNativeTabReady={notifyNativeTabReady}
                    backendConnected={connected || startupActive}
                  />
                </WorkspaceProvider>
              </WorkspaceCacheProvider>
            </ConfirmProvider>
          </AppUpdateProvider>
        </ToastProvider>
      </div>
    </>
  );
}
