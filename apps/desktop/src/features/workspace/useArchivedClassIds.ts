import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { readTextFile } from "../../api";
import { normalizeClassesManifest, type ClassesManifest } from "../video/classDomain";
import { archivedDetectClassIds } from "./workspaceClassTaxonomy";

type ArchivedClassState = {
  manifest: ClassesManifest | null;
  detectIds: Set<number>;
  classKeys: Set<string>;
};

const EMPTY_STATE: ArchivedClassState = { manifest: null, detectIds: new Set(), classKeys: new Set() };

/**
 * Lightweight hook that reads workspace/classes.json and derives which detect
 * class IDs and clf class keys are archived. Falls back gracefully to an empty
 * set when the manifest is absent (legacy workspaces with only classes.txt).
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

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) {
      setState(EMPTY_STATE);
      return;
    }
    let cancelled = false;
    readTextFile(root, "workspace/classes.json")
      .then((text) => {
        if (cancelled) return;
        const manifest = normalizeClassesManifest(JSON.parse(text));
        const archivedKeys = new Set(
          manifest.classDefs.filter((d) => d.archived).map((d) => d.key)
        );
        setState({
          manifest,
          detectIds: archivedDetectClassIds(manifest),
          classKeys: archivedKeys,
        });
      })
      .catch(() => {
        if (!cancelled) setState(EMPTY_STATE);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  return {
    manifest: state.manifest,
    archivedDetectIds: state.detectIds,
    archivedDetectIdsRef: detectIdsRef,
    archivedClassKeys: state.classKeys,
    archivedClassKeysRef: classKeysRef,
    archivedClfKeys: state.classKeys,
  };
}
