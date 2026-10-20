import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import { chooseDirectory } from "../lib/tauri";
import { errMessage } from "../lib/errors";
import { useToast } from "../components/useToast";
import { ALL_TOOLS, type ToolTab } from "../types/tools";
import { readWorkspaceSessionLite, saveActiveTabSession } from "../features/image-pool/session";
import {
  normalizeImageWorkspaceTab,
  type ImageWorkspaceTab
} from "../features/image-pool/imageWorkspaceMode";
import { clearJunkUndoForWorkspace } from "../features/shared/junkUndo";
import { useWorkspaceCache } from "../features/shared/useWorkspaceCache";
import { sameWorkspacePath } from "../workspace/layout";
import { WorkspaceContext, type PendingFolder } from "./workspaceContext";

type WorkspaceInitPhase = "idle" | "bootstrapping" | "ready";

/** `?workspaceRoot=` opens a workspace directly (development and deep links). */
function workspaceRootFromUrl() {
  return new URLSearchParams(window.location.search).get("workspaceRoot") || "";
}

function applySessionTab(
  session: Record<string, unknown> | null,
  setActiveTab: (tab: ToolTab) => void,
  setImageWorkspaceTabState: (tab: ImageWorkspaceTab) => void
) {
  const tab = String(session?.activeTab || "");
  if (tab === "inbox" || tab === "yolo" || tab === "image-pool") {
    setActiveTab("image-pool");
    setImageWorkspaceTabState(normalizeImageWorkspaceTab(tab));
    return;
  }
  if (ALL_TOOLS.some((tool) => tool.tab === tab)) {
    setActiveTab(tab as ToolTab);
  }
}

export function WorkspaceProvider({
  connected,
  children
}: {
  connected: boolean;
  children: React.ReactNode;
}) {
  const { invalidateImagePoolCache, invalidateBoxLabelCache } = useWorkspaceCache();
  const { showToast } = useToast();
  const [workspace, setWorkspace] = useState<api.WorkspacePayload | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [pendingFolder, setPendingFolder] = useState<PendingFolder | null>(null);
  const [activeTab, setActiveTab] = useState<ToolTab>("home");
  const [imageWorkspaceTab, setImageWorkspaceTabState] = useState<ImageWorkspaceTab>("image-pool");
  const [poolLabelFocusFilename, setPoolLabelFocusFilename] = useState<string | null>(null);
  const [initPhase, setInitPhase] = useState<WorkspaceInitPhase>("idle");

  const workspaceRoot = workspace?.root ?? "";
  const bootstrappedRef = useRef(false);
  const prevWorkspaceRootRef = useRef(workspaceRoot);

  const refreshRecent = useCallback(async () => {
    try {
      const settings = await api.appSettings();
      setRecentWorkspaces(settings.workspaces);
      return settings;
    } catch {
      return null;
    }
  }, []);

  const forgetRecentWorkspace = useCallback(async (path: string) => {
    const settings = await api.appSettings();
    const workspaces = settings.workspaces.filter((item) => !sameWorkspacePath(item, path));
    const next = await api.writeAppSettings({ workspaces });
    setRecentWorkspaces(next.workspaces);
  }, []);

  const setImageWorkspaceTab = useCallback(
    (tab: ImageWorkspaceTab) => {
      setImageWorkspaceTabState(tab);
      if (workspaceRoot) {
        saveActiveTabSession(workspaceRoot, tab).catch(() => {
          // Session persistence is best-effort.
        });
      }
    },
    [workspaceRoot]
  );

  const adoptWorkspace = useCallback(
    async (next: api.WorkspacePayload, options?: { restoreTab?: boolean }) => {
      setPendingFolder(null);
      setWorkspace(next);
      void refreshRecent();
      if (options?.restoreTab === false) return;
      try {
        const session = await readWorkspaceSessionLite(next.root);
        applySessionTab(session, setActiveTab, setImageWorkspaceTabState);
      } catch {
        // Tab restore is best-effort.
      }
    },
    [refreshRecent]
  );

  const openFolder = useCallback(
    async (path: string, options?: { restoreTab?: boolean }) => {
      const opened = await api.openWorkspace(path.trim());
      if (opened.kind === "workspace") await adoptWorkspace(opened, options);
      else setPendingFolder(opened);
      return opened;
    },
    [adoptWorkspace]
  );

  const openWorkspacePath = useCallback(
    async (path: string) => {
      if (!path.trim()) return null;
      try {
        const opened = await openFolder(path);
        bootstrappedRef.current = true;
        setInitPhase("ready");
        return opened;
      } catch (err) {
        showToast(errMessage(err), { variant: "error" });
        return null;
      }
    },
    [openFolder, showToast]
  );

  const chooseWorkspaceFolder = useCallback(async () => {
    const folder = await chooseDirectory("Choose a workspace folder");
    if (folder) await openWorkspacePath(folder);
  }, [openWorkspacePath]);

  const dismissPendingFolder = useCallback(() => setPendingFolder(null), []);
  const closeWorkspace = useCallback(() => {
    setWorkspace(null);
    setActiveTab("home");
  }, []);
  const clearPoolLabelFocus = useCallback(() => setPoolLabelFocusFilename(null), []);

  useEffect(() => {
    const previous = prevWorkspaceRootRef.current;
    if (previous && previous !== workspaceRoot) {
      clearJunkUndoForWorkspace(previous);
      invalidateImagePoolCache(previous);
      invalidateBoxLabelCache(previous);
    }
    prevWorkspaceRootRef.current = workspaceRoot;
  }, [invalidateBoxLabelCache, invalidateImagePoolCache, workspaceRoot]);

  useEffect(() => {
    if (!connected) {
      bootstrappedRef.current = false;
      setInitPhase("idle");
      return;
    }
    if (bootstrappedRef.current) return;

    let cancelled = false;
    setInitPhase("bootstrapping");
    void (async () => {
      const settings = await refreshRecent();
      const candidate = (workspaceRootFromUrl() || settings?.lastWorkspace || "").trim();
      try {
        if (candidate && !cancelled) await openFolder(candidate, { restoreTab: false });
      } catch (err) {
        // The last workspace may have been moved or deleted; start without one.
        if (!cancelled) showToast(errMessage(err), { variant: "error" });
      } finally {
        if (!cancelled) {
          bootstrappedRef.current = true;
          setInitPhase("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, openFolder, refreshRecent, showToast]);

  useEffect(() => {
    if (!workspaceRoot || initPhase !== "ready" || activeTab === "home") return;
    // Image-pool sub-tabs are saved by name ("yolo", "inbox") so restore reopens the same tool.
    const sessionTab = activeTab === "image-pool" ? imageWorkspaceTab : activeTab;
    saveActiveTabSession(workspaceRoot, sessionTab).catch(() => {
      // Session persistence is best-effort.
    });
  }, [activeTab, imageWorkspaceTab, workspaceRoot, initPhase]);

  const openBoxLabel = useCallback((item: api.ImagePoolItem) => {
    setPoolLabelFocusFilename(item.filename);
    setActiveTab("label");
  }, []);

  const value = useMemo(
    () => ({
      workspaceRoot,
      workspace,
      recentWorkspaces,
      forgetRecentWorkspace,
      openWorkspacePath,
      chooseWorkspaceFolder,
      adoptWorkspace,
      closeWorkspace,
      pendingFolder,
      dismissPendingFolder,
      activeTab,
      setActiveTab,
      imageWorkspaceTab,
      setImageWorkspaceTab,
      openBoxLabel,
      poolLabelFocusFilename,
      clearPoolLabelFocus
    }),
    [
      workspaceRoot,
      workspace,
      recentWorkspaces,
      forgetRecentWorkspace,
      openWorkspacePath,
      chooseWorkspaceFolder,
      adoptWorkspace,
      closeWorkspace,
      pendingFolder,
      dismissPendingFolder,
      activeTab,
      imageWorkspaceTab,
      setImageWorkspaceTab,
      openBoxLabel,
      poolLabelFocusFilename,
      clearPoolLabelFocus
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
