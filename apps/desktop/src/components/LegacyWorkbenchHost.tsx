import { useEffect, useMemo, useRef, useState } from "react";
import { buildLegacyEmbedUrl, type LegacyEmbedTab } from "../lib/legacyWorkbench";
import { postToLegacy, subscribeLegacyMessages } from "../lib/legacyBridge";

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
    [persistTab, iframeBootTab, activeTab, workspaceRoot, reloadKey]
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
    return subscribeLegacyMessages((message) => {
      if (message.type !== "ywb-embed-ready") return;
      bootedRef.current = true;
      setReady(true);
      if (!readyNotifiedRef.current) {
        readyNotifiedRef.current = true;
        onReady?.();
      }
    });
  }, [onReady]);

  useEffect(() => {
    if (!bootedRef.current || !ready) return;
    if (lastShellTabRef.current === activeTab) return;
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    lastShellTabRef.current = activeTab;
    postToLegacy(frame, { type: "ywb-shell-tab", tab: activeTab });
  }, [activeTab, ready]);

  useEffect(() => {
    if (!ready || activeTab !== "pool-label" || !focusImagePath) return;
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const timer = window.setTimeout(() => {
      postToLegacy(frame, {
        type: "ywb-focus-image",
        imagePath: `image_pool/${focusImagePath}`
      });
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
