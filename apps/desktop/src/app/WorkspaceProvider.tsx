import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import { chooseDirectory } from "../lib/tauri";
import { tabUsesNativeReact, WORKBENCH_TOOLS, type ToolTab } from "../types/tools";
import { readWorkspaceSessionLite, saveActiveTabSession } from "../features/image-pool/session";
import {
  normalizeImageWorkspaceTab,
  type ImageWorkspaceTab
} from "../features/image-pool/imageWorkspaceMode";

type WorkspaceContextValue = {
  workspaceRoot: string;
  setWorkspaceRoot: (value: string) => void;
  setWorkspaceRootInput: (value: string) => void;
  scan: api.ImagePoolScan | null;
  selected: api.ImagePoolItem | null;
  setSelected: (item: api.ImagePoolItem | null) => void;
  activeTab: ToolTab;
  setActiveTab: (tab: ToolTab) => void;
  imageWorkspaceTab: ImageWorkspaceTab;
  setImageWorkspaceTab: (tab: ImageWorkspaceTab) => void;
  imagePoolPending: boolean;
  imagePoolError: string;
  loadImagePool: () => Promise<void>;
  openWorkspacePath: (path: string) => Promise<void>;
  chooseWorkspaceFolder: () => Promise<void>;
  selectByIndex: (index: number) => void;
  openBoxLabel: (item: api.ImagePoolItem) => void;
  poolLabelFocusFilename: string | null;
  clearPoolLabelFocus: () => void;
  imagePoolNewCount: number;
  setImagePoolNewCount: (count: number) => void;
  selectedIndex: number;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readInitialWorkspaceRoot() {
  const params = new URLSearchParams(window.location.search);
  return params.get("workspaceRoot") || window.localStorage.getItem("ywb.workspaceRoot") || "";
}

export function WorkspaceProvider({
  connected,
  children
}: {
  connected: boolean;
  children: React.ReactNode;
}) {
  const [workspaceRoot, setWorkspaceRoot] = useState(readInitialWorkspaceRoot);
  const setWorkspaceRootInput = useCallback((value: string) => {
    autoScanStarted.current = false;
    setWorkspaceRoot(value);
  }, []);
  const [scan, setScan] = useState<api.ImagePoolScan | null>(null);
  const [selected, setSelected] = useState<api.ImagePoolItem | null>(null);
  const [activeTab, setActiveTab] = useState<ToolTab>("image-pool");
  const [imageWorkspaceTab, setImageWorkspaceTabState] = useState<ImageWorkspaceTab>("image-pool");
  const setImageWorkspaceTab = useCallback(
    (tab: ImageWorkspaceTab) => {
      setImageWorkspaceTabState(tab);
      const root = workspaceRoot.trim();
      if (root) saveActiveTabSession(root, tab).catch(() => {});
    },
    [workspaceRoot]
  );
  const [poolLabelFocusFilename, setPoolLabelFocusFilename] = useState<string | null>(null);
  const [imagePoolNewCount, setImagePoolNewCount] = useState(0);
  const [imagePoolPending, setImagePoolPending] = useState(false);
  const [imagePoolError, setImagePoolError] = useState("");
  const settingsLoaded = useRef(false);
  const autoScanStarted = useRef(false);
  const prevConnectedRef = useRef(false);

  const loadImagePool = useCallback(async () => {
    const root = workspaceRoot.trim();
    if (!root) {
      setImagePoolError("Enter a workspace root.");
      return;
    }
    setImagePoolPending(true);
    setImagePoolError("");
    try {
      const result = await api.scanImagePool(root, { fast: true });
      const resolved = result.workspaceRoot || root;
      window.localStorage.setItem("ywb.workspaceRoot", resolved);
      setWorkspaceRoot(resolved);
      setScan(result);
      setSelected((current) => {
        if (current && result.files.some((item) => item.filename === current.filename)) return current;
        return result.files[0] || null;
      });
      await api.writeAppSettings({ lastOpenedWorkspace: resolved });
    } catch (err) {
      setScan(null);
      setSelected(null);
      setImagePoolError(err instanceof Error ? err.message : String(err));
    } finally {
      setImagePoolPending(false);
    }
  }, [workspaceRoot]);

  const openWorkspacePath = useCallback(
    async (path: string) => {
      const trimmed = path.trim();
      if (!trimmed) return;
      setImagePoolError("");
      try {
        const opened = await api.openWorkspace(trimmed);
        const resolved = opened.root || trimmed;
        autoScanStarted.current = false;
        setWorkspaceRoot(resolved);
        window.localStorage.setItem("ywb.workspaceRoot", resolved);
        await api.writeAppSettings({ lastOpenedWorkspace: resolved });
      } catch (err) {
        setImagePoolError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  const clearPoolLabelFocus = useCallback(() => {
    setPoolLabelFocusFilename(null);
  }, []);

  const chooseWorkspaceFolder = useCallback(async () => {
    const folder = await chooseDirectory("Choose YOLO workspace folder");
    if (folder) await openWorkspacePath(folder);
  }, [openWorkspacePath]);

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = connected;
    if (!connected || wasConnected) return;
    const trimmed = workspaceRoot.trim();
    if (!trimmed) return;
    openWorkspacePath(trimmed).catch((err) => {
      setImagePoolError(err instanceof Error ? err.message : String(err));
    });
  }, [connected, workspaceRoot, openWorkspacePath]);

  useEffect(() => {
    if (!connected || settingsLoaded.current) return;
    settingsLoaded.current = true;
    const restoreWorkspace = (root: string) => {
      const trimmed = root.trim();
      if (!trimmed) return;
      autoScanStarted.current = false;
      setWorkspaceRoot(trimmed);
      openWorkspacePath(trimmed).catch(() => {});
    };
    if (workspaceRoot.trim()) {
      restoreWorkspace(workspaceRoot);
      return;
    }
    api
      .appSettings()
      .then((settings) => {
        const root = settings.lastOpenedWorkspace || settings.lastOpenedFolder || settings.lastOpenedYoloFolder;
        restoreWorkspace(root || "");
      })
      .catch(() => {
        // Startup settings are optional.
      });
  }, [connected, workspaceRoot, openWorkspacePath]);

  const sessionTabLoaded = useRef(false);
  useEffect(() => {
    if (!connected || sessionTabLoaded.current || !workspaceRoot.trim()) return;
    sessionTabLoaded.current = true;
    readWorkspaceSessionLite(workspaceRoot.trim())
      .then((session) => {
        const tab = String(session?.activeTab || "");
        if (tab === "inbox" || tab === "yolo" || tab === "image-pool") {
          setActiveTab("image-pool");
          setImageWorkspaceTabState(normalizeImageWorkspaceTab(tab));
          return;
        }
        if (WORKBENCH_TOOLS.some((tool) => tool.tab === tab)) {
          setActiveTab(tab as ToolTab);
        }
      })
      .catch(() => {});
  }, [connected, workspaceRoot]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) return;
    if (activeTab === "image-pool") return;
    saveActiveTabSession(root, activeTab).catch(() => {});
  }, [activeTab, workspaceRoot]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!connected || !root) return;
    let cancelled = false;
    api
      .scanImagePool(root, { fast: true })
      .then((result) => {
        if (!cancelled) setImagePoolNewCount(result.newCount ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connected, workspaceRoot, setImagePoolNewCount]);

  useEffect(() => {
    if (!connected || autoScanStarted.current || !workspaceRoot.trim()) return;
    if (tabUsesNativeReact(activeTab)) return;
    autoScanStarted.current = true;
    loadImagePool();
  }, [connected, workspaceRoot, activeTab, loadImagePool]);

  const previousTab = useRef(activeTab);
  useEffect(() => {
    if (!connected || !workspaceRoot.trim()) return;
    if (tabUsesNativeReact(activeTab)) return;
    const wasReact = tabUsesNativeReact(previousTab.current);
    const isReact = tabUsesNativeReact(activeTab);
    previousTab.current = activeTab;
    if (!wasReact && isReact) {
      loadImagePool();
    }
  }, [activeTab, connected, workspaceRoot, loadImagePool]);

  const selectByIndex = useCallback(
    (index: number) => {
      if (!scan?.files.length) return;
      const clamped = Math.max(0, Math.min(index, scan.files.length - 1));
      setSelected(scan.files[clamped]);
    },
    [scan]
  );

  const openBoxLabel = useCallback((item: api.ImagePoolItem) => {
    setSelected(item);
    setPoolLabelFocusFilename(item.filename);
    setActiveTab("pool-label");
  }, []);

  const selectedIndex = scan && selected ? scan.files.findIndex((item) => item.filename === selected.filename) : -1;

  const value = useMemo(
    () => ({
      workspaceRoot,
      setWorkspaceRoot,
      setWorkspaceRootInput,
      scan,
      selected,
      setSelected,
      activeTab,
      setActiveTab,
      imageWorkspaceTab,
      setImageWorkspaceTab,
      imagePoolPending,
      imagePoolError,
      loadImagePool,
      openWorkspacePath,
      chooseWorkspaceFolder,
      selectByIndex,
      openBoxLabel,
      poolLabelFocusFilename,
      clearPoolLabelFocus,
      imagePoolNewCount,
      setImagePoolNewCount,
      selectedIndex
    }),
    [
      workspaceRoot,
      scan,
      selected,
      activeTab,
      imageWorkspaceTab,
      setImageWorkspaceTab,
      imagePoolPending,
      imagePoolError,
      loadImagePool,
      openWorkspacePath,
      chooseWorkspaceFolder,
      selectByIndex,
      openBoxLabel,
      poolLabelFocusFilename,
      clearPoolLabelFocus,
      imagePoolNewCount,
      setImagePoolNewCount,
      selectedIndex,
      setWorkspaceRootInput
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider.");
  return context;
}
