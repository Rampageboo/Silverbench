import { createContext } from "react";
import type * as api from "../api";
import type { ToolTab } from "../types/tools";
import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";
import type {
  WorkspaceVersionId,
  WorkspaceVersionsManifest
} from "../features/workspace-versioning/workspaceSnapshotVersions";

export type WorkspaceContextValue = {
  /** Effective workspace path used by tools. For snapshot workspaces this is root/V1, root/V2, etc. */
  workspaceRoot: string;
  /** Container path selected by the user. For snapshot workspaces this is the folder containing V1/V2. */
  workspaceRootPath: string;
  activeVersionId: WorkspaceVersionId | null;
  activeVersionPath: string;
  snapshotVersions: WorkspaceVersionsManifest | null;
  setWorkspaceRoot: (value: string) => void;
  setWorkspaceRootInput: (value: string) => void;
  activeTab: ToolTab;
  setActiveTab: (tab: ToolTab) => void;
  imageWorkspaceTab: ImageWorkspaceTab;
  setImageWorkspaceTab: (tab: ImageWorkspaceTab) => void;
  openWorkspacePath: (path: string) => Promise<void>;
  chooseWorkspaceFolder: () => Promise<void>;
  openBoxLabel: (item: api.ImagePoolItem) => void;
  poolLabelFocusFilename: string | null;
  clearPoolLabelFocus: () => void;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
