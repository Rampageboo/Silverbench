import { createContext } from "react";
import type { WorkspaceCacheStore } from "./workspaceCache";

export const WorkspaceCacheContext = createContext<WorkspaceCacheStore | null>(null);
