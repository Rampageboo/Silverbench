import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { sameWorkspacePath } from "../../workspace/layout";
import {
  isWorkspaceClassesChangedEvent,
  WORKSPACE_CLASSES_CHANGED_EVENT,
} from "../shared/workspaceClassEvents";
import type { ClassesManifest } from "../video/classDomain";
import { readWorkspaceClasses } from "./useWorkspaceClasses";
import { archivedDetectClassIds } from "./workspaceClassTaxonomy";

type ArchivedClassState = {
  manifest: ClassesManifest | null;
  detectIds: Set<number>;
  classKeys: Set<string>;
};

const EMPTY_STATE: ArchivedClassState = { manifest: null, detectIds: new Set(), classKeys: new Set() };

/**
 * Lightweight hook that reads classes.json and derives which detect class IDs
 * and clf class keys are archived.
 *
 * This is the single source of truth for archived state in label UIs.
 * Use archivedDetectIds to filter class pickers while keeping the full class
 * list available for rendering existing annotations.
 */
export function useArchivedClassIds(workspaceRoot: string): {
  manifest: ClassesManifest | null;
  archivedDetectIds: Set<number>;
  archivedDetectIdsRef: MutableRefObject<Set<number>>;
  archivedClassKeys: Set<string>;
  archivedClassKeysRef: MutableRefObject<Set<string>>;
  archivedClfKeys: Set<string>;
} {
  const [state, setState] = useState<ArchivedClassState>(EMPTY_STATE);
  const detectIdsRef = useRef<Set<number>>(new Set());
  const classKeysRef = useRef<Set<string>>(new Set());
  detectIdsRef.current = state.detectIds;
  classKeysRef.current = state.classKeys;

  const load = useCallback(async (options: { cancelled?: () => boolean } = {}) => {
    const root = workspaceRoot.trim();
    if (!root) {
      if (!options.cancelled?.()) setState(EMPTY_STATE);
      return;
    }
    const manifest = await readWorkspaceClasses(root);
    const archivedKeys = new Set(
      manifest.classDefs.filter((d) => d.archived).map((d) => d.key)
    );
    if (!options.cancelled?.()) {
      setState({
        manifest,
        detectIds: archivedDetectClassIds(manifest),
        classKeys: archivedKeys,
      });
    }
  }, [workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    load({ cancelled: () => cancelled }).catch(() => {
      if (!cancelled) setState(EMPTY_STATE);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) return;
    const handleClassesChanged = (event: Event) => {
      if (!isWorkspaceClassesChangedEvent(event)) return;
      if (!sameWorkspacePath(event.detail.workspaceRoot, root)) return;
      void load().catch(() => setState(EMPTY_STATE));
    };
    window.addEventListener(WORKSPACE_CLASSES_CHANGED_EVENT, handleClassesChanged);
    return () => window.removeEventListener(WORKSPACE_CLASSES_CHANGED_EVENT, handleClassesChanged);
  }, [load, workspaceRoot]);

  return {
    manifest: state.manifest,
    archivedDetectIds: state.detectIds,
    archivedDetectIdsRef: detectIdsRef,
    archivedClassKeys: state.classKeys,
    archivedClassKeysRef: classKeysRef,
    archivedClfKeys: state.classKeys,
  };
}
