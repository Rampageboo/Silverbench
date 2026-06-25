import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errMessage } from "../lib/errors";
import { recordWorkspaceEventBestEffort } from "../workbench/auditLog";
import {
  ensureWorkspaceManifest,
  type WorkspaceManifest,
  type WorkspaceManifestLoadResult
} from "./workspaceManifest";

type WorkspaceArchitecturePhase = "idle" | "loading" | "ready" | "error";

type WorkspaceArchitectureContextValue = {
  workspaceRoot: string;
  manifest: WorkspaceManifest | null;
  phase: WorkspaceArchitecturePhase;
  error: string;
  migrated: boolean;
  refresh: () => Promise<WorkspaceManifestLoadResult | null>;
};

const WorkspaceArchitectureContext = createContext<WorkspaceArchitectureContextValue | null>(null);

export function WorkspaceArchitectureProvider({
  workspaceRoot,
  onMigrated,
  children
}: {
  workspaceRoot: string;
  onMigrated?: (manifest: WorkspaceManifest) => void;
  children: ReactNode;
}) {
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [phase, setPhase] = useState<WorkspaceArchitecturePhase>("idle");
  const [error, setError] = useState("");
  const [migrated, setMigrated] = useState(false);
  const requestRef = useRef(0);
  const onMigratedRef = useRef(onMigrated);
  onMigratedRef.current = onMigrated;

  const refresh = useCallback(async () => {
    const root = workspaceRoot.trim();
    const requestId = ++requestRef.current;
    if (!root) {
      setManifest(null);
      setPhase("idle");
      setError("");
      setMigrated(false);
      return null;
    }
    setPhase("loading");
    setError("");
    try {
      const result = await ensureWorkspaceManifest(root);
      if (requestId !== requestRef.current) return null;
      setManifest(result.manifest);
      setMigrated(result.migrated);
      setPhase("ready");
      if (result.migrated) {
        onMigratedRef.current?.(result.manifest);
        recordWorkspaceEventBestEffort(root, {
          tool: "workspace",
          action: "manifest.migrated",
          message: `Workspace manifest upgraded to version ${result.manifest.version}.`,
          details: {
            sourcePath: result.sourcePath,
            targetPath: "workspace/workspace.json",
            manifestVersion: result.manifest.version,
            primaryWorkflow: "video-label"
          }
        });
      }
      return result;
    } catch (reason) {
      if (requestId !== requestRef.current) return null;
      const message = errMessage(reason);
      setManifest(null);
      setMigrated(false);
      setError(message);
      setPhase("error");
      recordWorkspaceEventBestEffort(root, {
        tool: "workspace",
        action: "manifest.load-failed",
        level: "error",
        message
      });
      return null;
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  const value = useMemo<WorkspaceArchitectureContextValue>(
    () => ({ workspaceRoot, manifest, phase, error, migrated, refresh }),
    [error, manifest, migrated, phase, refresh, workspaceRoot]
  );

  return <WorkspaceArchitectureContext.Provider value={value}>{children}</WorkspaceArchitectureContext.Provider>;
}

export function useWorkspaceArchitecture() {
  const value = useContext(WorkspaceArchitectureContext);
  if (!value) throw new Error("useWorkspaceArchitecture must be used within WorkspaceArchitectureProvider.");
  return value;
}
