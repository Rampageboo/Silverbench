import { useCallback, useEffect, useRef, useState } from "react";
import { useBackend } from "../hooks/useBackend";
import { BackendStatusBanner } from "../components/BackendStatusBanner";
import { ToastProvider } from "../components/ToastProvider";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { WorkspaceCacheProvider } from "../features/shared/WorkspaceCacheProvider";
import { readStartupOverlayMode } from "./startupOverlayMode";
import { inTauri, revealMainWindow } from "./splashscreen";
import { StartupOverlay } from "./StartupOverlay";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorkbenchBody } from "./WorkbenchBody";

type StartupPhase = "active" | "done" | "hidden";

export function App() {
  const { connected } = useBackend();
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("active");
  const [startupProgress, setStartupProgress] = useState(1);
  const [startupStage, setStartupStage] = useState("正在准备工作区...");
  const [startupDetail, setStartupDetail] = useState("加载界面");
  const [startupMode] = useState(readStartupOverlayMode);
  const bootFinishedRef = useRef(false);
  const overlayPaintedRef = useRef(false);
  const [overlayPainted, setOverlayPainted] = useState(false);
  const startupActive = startupPhase !== "hidden";

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
    if (!connected) {
      setStartupProgress((value) => Math.max(value, 12));
      setStartupStage("正在连接后端...");
      setStartupDetail("等待 FastAPI 启动");
      return;
    }
    setStartupProgress((value) => Math.max(value, 28));
    setStartupStage("正在恢复工作区...");
    setStartupDetail("后端已连接，正在打开上次工作区");
  }, [connected, startupActive]);

  useEffect(() => {
    if (!startupActive) return;

    function finishStartup(detail = "工具页已加载") {
      if (bootFinishedRef.current) return;
      bootFinishedRef.current = true;
      setStartupProgress(100);
      setStartupStage("就绪");
      setStartupDetail(detail);
      setStartupPhase("done");
      window.setTimeout(() => setStartupPhase("hidden"), 280);
    }

    function onNativeTabReady() {
      finishStartup("工具页已加载");
    }

    const fallbackTimer = window.setTimeout(() => {
      finishStartup("加载超时，已进入工作台");
    }, 90000);

    window.addEventListener("ywb-native-tab-ready", onNativeTabReady as EventListener);
    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("ywb-native-tab-ready", onNativeTabReady as EventListener);
    };
  }, [startupActive]);

  return (
    <>
      <BackendStatusBanner visible={!startupActive && !connected} />
      <StartupOverlay
        visible={startupActive}
        done={startupPhase === "done"}
        mode={startupMode}
        progress={startupProgress}
        stage={startupStage}
        detail={startupDetail}
        onPainted={handleOverlayPainted}
      />
      <div className={`app-workbench-root${startupActive ? " app-workbench-root--booting" : ""}`}>
        <ToastProvider>
          <ConfirmProvider>
            <WorkspaceCacheProvider>
              <WorkspaceProvider connected={connected}>
                <WorkbenchBody onNativeTabReady={notifyNativeTabReady} />
              </WorkspaceProvider>
            </WorkspaceCacheProvider>
          </ConfirmProvider>
        </ToastProvider>
      </div>
    </>
  );
}
