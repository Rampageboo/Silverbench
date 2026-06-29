import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as api from "../api";

import { chooseDirectory } from "../lib/tauri";

import { errMessage } from "../lib/errors";

import { useToast } from "../components/useToast";

import { ALL_TOOLS, PRIMARY_NAV_TOOLS, type ToolTab } from "../types/tools";

import { readWorkspaceSessionLite, saveActiveTabSession } from "../features/image-pool/session";

import {

  normalizeImageWorkspaceTab,

  type ImageWorkspaceTab

} from "../features/image-pool/imageWorkspaceMode";

import {
  validateWorkspaceVersionsManifest,
  type WorkspaceVersionId,
  type WorkspaceVersionsManifest
} from "../features/workspace-versioning/workspaceSnapshotVersions";

import { clearJunkUndoForWorkspace } from "../features/shared/junkUndo";

import { useWorkspaceCache } from "../features/shared/useWorkspaceCache";

import { WorkspaceContext } from "./workspaceContext";



type WorkspaceInitPhase = "idle" | "bootstrapping" | "ready";



function readInitialWorkspaceRoot() {

  const params = new URLSearchParams(window.location.search);

  return params.get("workspaceRoot") || window.localStorage.getItem("ywb.workspaceRoot") || "";

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



async function resolveStartupWorkspaceRoot(currentRoot: string) {

  const trimmed = currentRoot.trim();

  if (trimmed) return trimmed;

  try {

    const settings = await api.appSettings();

    return (settings.lastOpenedWorkspace || settings.lastOpenedFolder || settings.lastOpenedYoloFolder || "").trim();

  } catch {

    return "";

  }

}



function openedWorkspaceState(opened: api.OpenWorkspaceResponse, fallbackPath: string) {

  const snapshotVersions = opened.workspaceVersions

    ? validateWorkspaceVersionsManifest(opened.workspaceVersions)

    : null;

  const activeRoot = (opened.activeVersionPath || opened.root || fallbackPath).trim();

  const containerRoot = (opened.workspaceRootPath || (snapshotVersions ? fallbackPath : activeRoot)).trim();

  const activeVersionId = (opened.activeVersionId || snapshotVersions?.activeVersion || null) as WorkspaceVersionId | null;

  return {

    workspaceRoot: activeRoot,

    workspaceRootPath: containerRoot || activeRoot,

    activeVersionId,

    activeVersionPath: snapshotVersions ? activeRoot : "",

    snapshotVersions

  };

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

  const [workspaceRoot, setWorkspaceRootState] = useState(readInitialWorkspaceRoot);

  const [workspaceRootPath, setWorkspaceRootPath] = useState(readInitialWorkspaceRoot);

  const [activeVersionId, setActiveVersionId] = useState<WorkspaceVersionId | null>(null);

  const [activeVersionPath, setActiveVersionPath] = useState("");

  const [snapshotVersions, setSnapshotVersions] = useState<WorkspaceVersionsManifest | null>(null);

  const [activeTab, setActiveTab] = useState<ToolTab>("home");

  const [imageWorkspaceTab, setImageWorkspaceTabState] = useState<ImageWorkspaceTab>("image-pool");

  const [poolLabelFocusFilename, setPoolLabelFocusFilename] = useState<string | null>(null);

  const [initPhase, setInitPhase] = useState<WorkspaceInitPhase>("idle");



  const bootstrappedRef = useRef(false);

  const prevWorkspaceRootRef = useRef(workspaceRoot);

  const workspaceRootRef = useRef(workspaceRoot);



  workspaceRootRef.current = workspaceRoot;



  const setWorkspaceRoot = useCallback((value: string) => {

    setWorkspaceRootState(value);

    setWorkspaceRootPath(value);

    setActiveVersionId(null);

    setActiveVersionPath("");

    setSnapshotVersions(null);

  }, []);



  const setWorkspaceRootInput = useCallback((value: string) => {

    setWorkspaceRoot(value);

  }, [setWorkspaceRoot]);



  const setImageWorkspaceTab = useCallback(

    (tab: ImageWorkspaceTab) => {

      setImageWorkspaceTabState(tab);

      const root = workspaceRoot.trim();

      if (root) {

        saveActiveTabSession(root, tab).catch(() => {

          // Session persistence is best-effort.

        });

      }

    },

    [workspaceRoot]

  );



  const afterWorkspaceOpened = useCallback(async (opened: api.OpenWorkspaceResponse, fallbackPath: string, options?: { restoreTab?: boolean }) => {

    const { restoreTab = true } = options ?? {};

    const next = openedWorkspaceState(opened, fallbackPath);

    const root = next.workspaceRoot.trim();

    const containerRoot = next.workspaceRootPath.trim();

    if (!root) return;



    window.localStorage.setItem("ywb.workspaceRoot", containerRoot || root);

    setWorkspaceRootState(root);

    setWorkspaceRootPath(containerRoot || root);

    setActiveVersionId(next.activeVersionId);

    setActiveVersionPath(next.activeVersionPath);

    setSnapshotVersions(next.snapshotVersions);

    await api.writeAppSettings({ lastOpenedWorkspace: containerRoot || root });



    if (restoreTab) {

      try {

        const session = await readWorkspaceSessionLite(root);

        applySessionTab(session, setActiveTab, setImageWorkspaceTabState);

      } catch {

        // Session tab restore is best-effort.

      }

    }

  }, []);



  const openWorkspacePath = useCallback(

    async (path: string) => {

      const trimmed = path.trim();

      if (!trimmed) return;

      try {

        const opened = await api.openWorkspace(trimmed);

        await afterWorkspaceOpened(opened, trimmed);

        bootstrappedRef.current = true;

        setInitPhase("ready");

      } catch (err) {

        showToast(errMessage(err), { variant: "error" });

      }

    },

    [afterWorkspaceOpened, showToast]

  );



  const clearPoolLabelFocus = useCallback(() => {

    setPoolLabelFocusFilename(null);

  }, []);



  const chooseWorkspaceFolder = useCallback(async () => {

    const folder = await chooseDirectory("Choose YOLO workspace folder");

    if (folder) await openWorkspacePath(folder);

  }, [openWorkspacePath]);



  useEffect(() => {

    const previous = prevWorkspaceRootRef.current.trim();

    const current = workspaceRoot.trim();

    if (previous && previous !== current) {

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

      try {

        const candidate = await resolveStartupWorkspaceRoot(workspaceRootRef.current);

        if (cancelled) return;



        if (!candidate) {

          bootstrappedRef.current = true;

          setInitPhase("ready");

          return;

        }



        const opened = await api.openWorkspace(candidate);

        if (cancelled) return;



        await afterWorkspaceOpened(opened, candidate, { restoreTab: false });

        if (cancelled) return;



        bootstrappedRef.current = true;

        setInitPhase("ready");

      } catch (err) {

        if (!cancelled) {

          showToast(errMessage(err), { variant: "error" });

          bootstrappedRef.current = true;

          setInitPhase("ready");

        }

      }

    })();



    return () => {

      cancelled = true;

    };

  }, [afterWorkspaceOpened, connected, showToast]);



  useEffect(() => {

    const root = workspaceRoot.trim();

    if (!root || initPhase !== "ready") return;

    if (activeTab === "home") return;

    saveActiveTabSession(root, activeTab).catch(() => {

      // Session persistence is best-effort.

    });

  }, [activeTab, workspaceRoot, initPhase]);



  const openBoxLabel = useCallback((item: api.ImagePoolItem) => {

    setPoolLabelFocusFilename(item.filename);

    setActiveTab("label");

  }, []);



  const value = useMemo(

    () => ({

      workspaceRoot,

      workspaceRootPath,

      activeVersionId,

      activeVersionPath,

      snapshotVersions,

      setWorkspaceRoot,

      setWorkspaceRootInput,

      activeTab,

      setActiveTab,

      imageWorkspaceTab,

      setImageWorkspaceTab,

      openWorkspacePath,

      chooseWorkspaceFolder,

      openBoxLabel,

      poolLabelFocusFilename,

      clearPoolLabelFocus

    }),

    [

      workspaceRoot,

      workspaceRootPath,

      activeVersionId,

      activeVersionPath,

      snapshotVersions,

      activeTab,

      imageWorkspaceTab,

      setImageWorkspaceTab,

      openWorkspacePath,

      chooseWorkspaceFolder,

      openBoxLabel,

      poolLabelFocusFilename,

      clearPoolLabelFocus,

      setWorkspaceRoot,

      setWorkspaceRootInput

    ]

  );



  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;

}

