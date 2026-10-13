import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { requireCurrentBackend, saveLabelClasses, writeTextFile } from "../../api";
import {
  CreateWorkspaceDialog,
  type CreateWorkspaceOptions
} from "../../features/home/CreateWorkspaceDialog";
import { initializeSnapshotVersioning } from "../../features/workspace-versioning/workspaceSnapshotVersionApi";
import { workspaceClassSetupToClassesManifest } from "../../features/workspace/workspaceClassTaxonomy";
import { chooseDirectory } from "../../lib/tauri";
import { loadRecentWorkspaces, pushRecentWorkspace, removeRecentWorkspace } from "../recentWorkspaces";
import { useWorkspace } from "../useWorkspace";

type WorkspaceLauncherValue = {
  recent: string[];
  error: string;
  openFolder: () => Promise<void>;
  openRecent: (path: string) => Promise<void>;
  removeRecent: (path: string) => void;
  requestCreate: () => void;
};

const WorkspaceLauncherContext = createContext<WorkspaceLauncherValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceLauncher() {
  const value = useContext(WorkspaceLauncherContext);
  if (!value) throw new Error("useWorkspaceLauncher must be used inside WorkspaceLauncherProvider");
  return value;
}

/**
 * Owns every way of getting into a workspace (open folder, recent, create) so
 * the start page, the sidebar switcher and the command palette share one flow.
 */
export function WorkspaceLauncherProvider({ children }: { children: ReactNode }) {
  const { workspaceRoot, workspaceRootPath, openWorkspacePath, setActiveTab } = useWorkspace();
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Any workspace that ends up open (including one restored at startup) is recent.
  const currentRoot = (workspaceRootPath || workspaceRoot).trim();
  useEffect(() => {
    if (currentRoot) setRecent(pushRecentWorkspace(currentRoot));
  }, [currentRoot]);

  const openPath = useCallback(
    async (path: string) => {
      setError("");
      try {
        await openWorkspacePath(path);
        setRecent(pushRecentWorkspace(path));
        setActiveTab("label");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [openWorkspacePath, setActiveTab]
  );

  const openFolder = useCallback(async () => {
    const dir = await chooseDirectory("Choose YOLO workspace folder");
    if (dir) await openPath(dir);
  }, [openPath]);

  const removeRecent = useCallback((path: string) => {
    setRecent(removeRecentWorkspace(path));
  }, []);

  const createWorkspace = useCallback(
    async (opts: CreateWorkspaceOptions) => {
      const root = `${opts.location.replace(/[/\\]+$/, "")}/${opts.name.trim()}`;
      await requireCurrentBackend();
      await openWorkspacePath(root);

      // classes.txt + data.yaml (read by Box Label).
      if (opts.detectClasses.length > 0) {
        await saveLabelClasses(
          root,
          opts.detectClasses.map((name, id) => ({ id, name }))
        );
      }

      // workspace/classes.json (class manifest).
      const classesManifest = workspaceClassSetupToClassesManifest({
        taskType: opts.taskType,
        mediaMode: opts.mediaMode,
        detectClasses: opts.detectClasses.map((name) => ({ name })),
        clfClasses: opts.clfClasses.map((name) => ({ name })),
        setupMode: "manual"
      });
      await writeTextFile(root, "workspace/classes.json", `${JSON.stringify(classesManifest, null, 2)}\n`);

      await initializeSnapshotVersioning(root);
      await openWorkspacePath(root);

      setRecent(pushRecentWorkspace(root));
      setCreating(false);
      setActiveTab("label");
    },
    [openWorkspacePath, setActiveTab]
  );

  const value = useMemo<WorkspaceLauncherValue>(
    () => ({
      recent,
      error,
      openFolder,
      openRecent: openPath,
      removeRecent,
      requestCreate: () => setCreating(true)
    }),
    [error, openFolder, openPath, recent, removeRecent]
  );

  return (
    <WorkspaceLauncherContext.Provider value={value}>
      {children}
      <CreateWorkspaceDialog open={creating} onCreate={createWorkspace} onClose={() => setCreating(false)} />
    </WorkspaceLauncherContext.Provider>
  );
}
