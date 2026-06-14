import { useEffect, useMemo, useRef, useState } from "react";
import { buildLegacyEmbedUrl, LEGACY_WORKBENCH_ORIGIN, type LegacyEmbedTab } from "../lib/legacyWorkbench";

type LegacyWorkbenchHostProps = {
  activeTab: LegacyEmbedTab;
  workspaceRoot: string;
  reloadKey: number;
  /** Keep iframe src stable; switch legacy tabs via postMessage only. */
  persistTab?: boolean;
  hidden?: boolean;
  focusImagePath?: string | null;
  onFocusDelivered?: () => void;
  onReady?: () => void;
};

export function LegacyWorkbenchHost({
  activeTab,
  workspaceRoot,
  reloadKey,
  persistTab = false,
  hidden = false,
  focusImagePath,
  onFocusDelivered,
  onReady
}: LegacyWorkbenchHostProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bootedRef = useRef(false);
  const [iframeBootTab] = useState(activeTab);
  const lastShellTabRef = useRef<LegacyEmbedTab | null>(null);
  const readyNotifiedRef = useRef(false);
  const [ready, setReady] = useState(false);

  const iframeSrc = useMemo(
    () => buildLegacyEmbedUrl(persistTab ? iframeBootTab : activeTab, workspaceRoot, reloadKey),
    persistTab ? [iframeBootTab, reloadKey, workspaceRoot] : [activeTab, reloadKey, workspaceRoot]
  );

  useEffect(() => {
    bootedRef.current = false;
    lastShellTabRef.current = null;
    readyNotifiedRef.current = false;
    setReady(false);
  }, [iframeSrc]);

  useEffect(() => {
    const fallbackTimer = window.setTimeout(() => {
      setReady(true);
      if (!readyNotifiedRef.current) {
        readyNotifiedRef.current = true;
        onReady?.();
      }
    }, 30000);
    return () => window.clearTimeout(fallbackTimer);
  }, [iframeSrc, onReady]);

  useEffect(() => {
    function onEmbedReady(event: MessageEvent) {
      if (event.origin !== LEGACY_WORKBENCH_ORIGIN) return;
      if (event.data?.type !== "ywb-embed-ready") return;
      bootedRef.current = true;
      setReady(true);
      if (!readyNotifiedRef.current) {
        readyNotifiedRef.current = true;
        onReady?.();
      }
    }
    window.addEventListener("message", onEmbedReady);
    return () => window.removeEventListener("message", onEmbedReady);
  }, [onReady]);

  useEffect(() => {
    if (!bootedRef.current || !ready) return;
    if (lastShellTabRef.current === activeTab) return;
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    lastShellTabRef.current = activeTab;
    frame.postMessage({ type: "ywb-shell-tab", tab: activeTab }, LEGACY_WORKBENCH_ORIGIN);
  }, [activeTab, ready]);

  useEffect(() => {
    if (!ready || activeTab !== "pool-label" || !focusImagePath) return;
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const payload = {
      type: "ywb-focus-image",
      imagePath: `image_pool/${focusImagePath}`
    };
    const timer = window.setTimeout(() => {
      frame.postMessage(payload, LEGACY_WORKBENCH_ORIGIN);
      onFocusDelivered?.();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeTab, focusImagePath, ready, onFocusDelivered, iframeSrc]);

  return (
    <div className={`legacy-tool-embed${hidden ? " legacy-tool-embed--hidden" : ""}`}>
      {!ready ? <div className="legacy-tool-embed-loading">正在加载工具页…</div> : null}
      <iframe
        ref={iframeRef}
        className={`legacy-workbench-frame ${ready ? "is-ready" : ""}`}
        title="YoloWorkBench"
        src={iframeSrc}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

export const LegacyToolEmbed = LegacyWorkbenchHost;
export const LegacyWorkbenchFrame = LegacyWorkbenchHost;
