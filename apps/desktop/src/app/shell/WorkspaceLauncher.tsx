import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createWorkspace as createWorkspaceFolder, requireCurrentBackend } from "../../api";
import {
  CreateWorkspaceDialog,
  type CreateWorkspaceOptions
} from "../../features/home/CreateWorkspaceDialog";
import { workspaceClassSetupToClassesManifest } from "../../features/workspace/workspaceClassTaxonomy";
import { errMessage } from "../../lib/errors";
import { chooseDirectory } from "../../lib/tauri";
import { useWorkspace } from "../useWorkspace";
import { PendingFolderDialog } from "./PendingFolderDialog";

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
 * Owns every way of getting into a workspace (open folder, recent, create,
 * migrate) so the start page, the sidebar switcher and the command palette
 * share one flow.
 */
export function WorkspaceLauncherProvider({ children }: { children: ReactNode }) {
  const { recentWorkspaces, forgetRecentWorkspace, openWorkspacePath, adoptWorkspace, setActiveTab } = useWorkspace();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const openPath = useCallback(
    async (path: string) => {
      setError("");
      const opened = await openWorkspacePath(path);
      if (opened?.kind === "workspace") setActiveTab("label");
    },
    [openWorkspacePath, setActiveTab]
  );

  const openFolder = useCallback(async () => {
    const dir = await chooseDirectory("Choose a workspace folder");
    if (dir) await openPath(dir);
  }, [openPath]);

  const removeRecent = useCallback(
    (path: string) => {
      forgetRecentWorkspace(path).catch((err) => setError(errMessage(err)));
    },
    [forgetRecentWorkspace]
  );

  const createWorkspace = useCallback(
    async (opts: CreateWorkspaceOptions) => {
      const root = `${opts.location.replace(/[/\\]+$/, "")}/${opts.name.trim()}`;
      await requireCurrentBackend();
      const classes = workspaceClassSetupToClassesManifest({
        taskType: opts.taskType,
        mediaMode: opts.mediaMode,
        detectClasses: opts.detectClasses.map((name) => ({ name })),
        clfClasses: opts.clfClasses.map((name) => ({ name })),
        setupMode: "manual"
      });
      await adoptWorkspace(await createWorkspaceFolder(root, classes));
      setCreating(false);
      setActiveTab("label");
    },
    [adoptWorkspace, setActiveTab]
  );

  const value = useMemo<WorkspaceLauncherValue>(
    () => ({
      recent: recentWorkspaces,
      error,
      openFolder,
      openRecent: openPath,
      removeRecent,
      requestCreate: () => setCreating(true)
    }),
    [error, openFolder, openPath, recentWorkspaces, removeRecent]
  );

  return (
    <WorkspaceLauncherContext.Provider value={value}>
      {children}
      <CreateWorkspaceDialog open={creating} onCreate={createWorkspace} onClose={() => setCreating(false)} />
      <PendingFolderDialog />
    </WorkspaceLauncherContext.Provider>
  );
}
