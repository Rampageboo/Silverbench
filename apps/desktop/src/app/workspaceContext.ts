import { createContext } from "react";
import type * as api from "../api";
import type { ToolTab } from "../types/tools";
import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";

/** A folder that was opened but is not (yet) a workspace: an older format, a dataset, or a plain folder. */
export type PendingFolder = Exclude<api.OpenWorkspaceResponse, api.WorkspacePayload>;

export type WorkspaceContextValue = {
  /** Root of the open workspace ("" when none is open). */
  workspaceRoot: string;
  workspace: api.WorkspacePayload | null;
  /** Workspaces the user has opened, most recent first (kept in app settings). */
  recentWorkspaces: string[];
  forgetRecentWorkspace: (path: string) => Promise<void>;
  /** Opens a folder. Anything other than a workspace becomes `pendingFolder` for the launcher to resolve. */
  openWorkspacePath: (path: string) => Promise<api.OpenWorkspaceResponse | null>;
  chooseWorkspaceFolder: () => Promise<void>;
  /** Switch to a workspace the backend just created or migrated. */
  adoptWorkspace: (workspace: api.WorkspacePayload) => Promise<void>;
  pendingFolder: PendingFolder | null;
  dismissPendingFolder: () => void;
  activeTab: ToolTab;
  setActiveTab: (tab: ToolTab) => void;
  imageWorkspaceTab: ImageWorkspaceTab;
  setImageWorkspaceTab: (tab: ImageWorkspaceTab) => void;
  openBoxLabel: (item: api.ImagePoolItem) => void;
  poolLabelFocusFilename: string | null;
  clearPoolLabelFocus: () => void;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
