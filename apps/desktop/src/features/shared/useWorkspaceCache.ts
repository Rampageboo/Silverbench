import { useContext } from "react";
import { WorkspaceCacheContext } from "./workspaceCacheContext";

export function useWorkspaceCache() {
  const store = useContext(WorkspaceCacheContext);
  if (!store) {
    throw new Error("useWorkspaceCache must be used within WorkspaceCacheProvider.");
  }
  return store;
}
