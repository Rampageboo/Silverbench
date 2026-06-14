import { useCallback, useEffect, useRef, useState } from "react";
import { useBackend } from "../hooks/useBackend";
import { readStartupOverlayMode, StartupOverlay } from "./StartupOverlay";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorkbenchBody } from "./WorkbenchBody";
import { LEGACY_WORKBENCH_ORIGIN } from "../lib/legacyWorkbench";

type StartupPhase = "active" | "done" | "hidden";

export function App() {
  const { connected } = useBackend();
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("active");
  const [startupProgress, setStartupProgress] = useState(1);
  const [startupStage, setStartupStage] = useState("正在准备工作区...");
  const [startupDetail, setStartupDetail] = useState("加载界面");
  const [startupMode] = useState(readStartupOverlayMode);
  const bootFinishedRef = useRef(false);
  const startupActive = startupPhase !== "hidden";

  const notifyNativeTabReady = useCallback(() => {
    window.dispatchEvent(new CustomEvent("ywb-native-tab-ready"));
  }, []);

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

    function onEmbedBootMessage(event: MessageEvent) {
      if (event.origin !== LEGACY_WORKBENCH_ORIGIN) return;
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "ywb-embed-progress") {
        const progress = Number(payload.progress);
        if (Number.isFinite(progress)) {
          setStartupProgress((value) => Math.max(value, Math.min(96, progress)));
        }
        if (typeof payload.stage === "string" && payload.stage) setStartupStage(payload.stage);
        if (typeof payload.detail === "string" && payload.detail) setStartupDetail(payload.detail);
        return;
      }

      if (payload.type !== "ywb-embed-ready") return;
      finishStartup(typeof payload.detail === "string" ? payload.detail : "工具页已加载");
    }

    const fallbackTimer = window.setTimeout(() => {
      finishStartup("加载超时，已进入工作台");
    }, 90000);

    window.addEventListener("message", onEmbedBootMessage);
    window.addEventListener("ywb-native-tab-ready", onNativeTabReady as EventListener);
    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("message", onEmbedBootMessage);
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
      />
      <div className={`app-workbench-root${startupActive ? " app-workbench-root--booting" : ""}`}>
        <WorkspaceProvider connected={connected}>
          <WorkbenchBody onNativeTabReady={notifyNativeTabReady} />
        </WorkspaceProvider>
      </div>
    </>
  );
}
