import { createContext } from "react";
import type * as api from "../api";
import type { ToolTab } from "../types/tools";
import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";

export type WorkspaceContextValue = {
  workspaceRoot: string;
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
