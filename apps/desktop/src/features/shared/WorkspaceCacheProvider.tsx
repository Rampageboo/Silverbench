import { useRef, type ReactNode } from "react";
import { createWorkspaceCacheStore } from "./workspaceCache";
import { WorkspaceCacheContext } from "./workspaceCacheContext";

type WorkspaceCacheProviderProps = {
  children: ReactNode;
};

export function WorkspaceCacheProvider({ children }: WorkspaceCacheProviderProps) {
  const storeRef = useRef(createWorkspaceCacheStore());
  return <WorkspaceCacheContext.Provider value={storeRef.current}>{children}</WorkspaceCacheContext.Provider>;
}
