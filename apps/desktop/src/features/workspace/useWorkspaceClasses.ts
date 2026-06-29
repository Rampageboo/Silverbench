import { useCallback, useEffect, useRef, useState } from "react";
import { loadLabelClasses, saveLabelClasses, writeTextFile, readTextFile } from "../../api";
import {
  dispatchWorkspaceClassesChanged,
  isWorkspaceClassesChangedEvent,
  WORKSPACE_CLASSES_CHANGED_EVENT,
} from "../shared/workspaceClassEvents";
import { normalizeClassesManifest, type ClassesManifest } from "../video/classDomain";
import {
  addDetectClassToManifest,
  addClfClassToManifest,
  renameClassInManifest,
  archiveDetectClassInManifest,
  unarchiveDetectClassInManifest,
  archiveClfClassInManifest,
  unarchiveClfClassInManifest,
  upgradeLegacyToManifest,
  manifestToLegacyClasses,
  validateNewClassName,
  activeDetectClassDefs,
  activeClfClassDefs,
} from "./workspaceClassTaxonomy";
import {
  dispatchWorkspaceClassesChangedForRoots,
  resolveActiveWorkspaceRoot,
  sameWorkspacePath,
} from "./activeWorkspaceRoot";

const CLASSES_JSON_PATH = "workspace/classes.json";

function emptyManifest(): ClassesManifest {
  return {
    version: 1,
    classDefs: [],
    tasks: {
      detect: { classKeys: [] },
      clf: { classKeys: [] },
    },
  };
}

function uniqueCleanNames(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

async function readManifestForMutation(root: string, fallback: ClassesManifest | null): Promise<ClassesManifest> {
  try {
    const text = await readTextFile(root, CLASSES_JSON_PATH);
    return normalizeClassesManifest(JSON.parse(text));
  } catch {
    const legacyClasses = await loadLabelClasses(root).catch(() => []);
    if (legacyClasses.length > 0) return upgradeLegacyToManifest(legacyClasses);
    return fallback ?? emptyManifest();
  }
}

export type UseWorkspaceClassesResult = {
  manifest: ClassesManifest | null;
  /** True when workspace has only classes.txt (no classes.json yet). */
  legacyMode: boolean;
  loading: boolean;
  saving: boolean;
  loadError: string;
  saveError: string;
  load: () => Promise<void>;
  addDetect: (name: string) => Promise<string | null>;
  addClf: (name: string) => Promise<string | null>;
  importDetectClasses: (names: string[]) => Promise<{ added: number; skipped: number }>;
  importClfClasses: (names: string[]) => Promise<{ added: number; skipped: number }>;
  rename: (classKey: string, newName: string) => Promise<void>;
  archiveDetect: (classKey: string) => Promise<void>;
  unarchiveDetect: (classKey: string) => Promise<void>;
  archiveClf: (classKey: string) => Promise<void>;
  unarchiveClf: (classKey: string) => Promise<void>;
  upgradeLegacy: () => Promise<void>;
};

export function useWorkspaceClasses(workspaceRoot: string): UseWorkspaceClassesResult {
  const [manifest, setManifest] = useState<ClassesManifest | null>(null);
  const [legacyMode, setLegacyMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const activeWorkspaceRootRef = useRef("");

  const load = useCallback(async () => {
    const root = workspaceRoot.trim();
    if (!root) return;
    setLoading(true);
    setLoadError("");
    try {
      const classRoot = await resolveActiveWorkspaceRoot(root);
      activeWorkspaceRootRef.current = classRoot;
      try {
        const text = await readTextFile(classRoot, CLASSES_JSON_PATH);
        const m = normalizeClassesManifest(JSON.parse(text));
        setManifest(m);
        setLegacyMode(false);
      } catch {
        // No classes.json — try legacy classes.txt.
        const legacyClasses = await loadLabelClasses(classRoot);
        if (legacyClasses.length > 0) {
          // Read-only legacy mode: show data but don't auto-upgrade.
          const m = upgradeLegacyToManifest(legacyClasses);
          setManifest(m);
          setLegacyMode(true);
        } else {
          setManifest(null);
          setLegacyMode(false);
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setManifest(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  const persist = useCallback(
    async (next: ClassesManifest) => {
      const root = workspaceRoot.trim();
      if (!root) return;
      setSaving(true);
      setSaveError("");
      try {
        const classRoot = await resolveActiveWorkspaceRoot(root);
        // Write classes.json (canonical source).
        await writeTextFile(classRoot, CLASSES_JSON_PATH, `${JSON.stringify(next, null, 2)}\n`);
        // Sync classes.txt (ALL detect classes including archived, to preserve IDs).
        const legacyClasses = manifestToLegacyClasses(next);
        if (legacyClasses.length > 0) {
          await saveLabelClasses(classRoot, legacyClasses);
        }
        setManifest(next);
        setLegacyMode(false);
        dispatchWorkspaceClassesChangedForRoots(dispatchWorkspaceClassesChanged, root, classRoot);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [workspaceRoot]
  );

  const addDetect = useCallback(
    async (name: string): Promise<string | null> => {
      if (!manifest) return null;
      const activeNames = activeDetectClassDefs(manifest).map((d) => d.name);
      const errors = validateNewClassName(name, activeNames);
      if (errors.length > 0) throw new Error(errors[0]);
      const { manifest: next, classKey } = addDetectClassToManifest(manifest, name);
      await persist(next);
      return classKey;
    },
    [manifest, persist]
  );

  const addClf = useCallback(
    async (name: string): Promise<string | null> => {
      if (!manifest) return null;
      const activeNames = activeClfClassDefs(manifest).map((d) => d.name);
      const errors = validateNewClassName(name, activeNames);
      if (errors.length > 0) throw new Error(errors[0]);
      const { manifest: next, classKey } = addClfClassToManifest(manifest, name);
      await persist(next);
      return classKey;
    },
    [manifest, persist]
  );

  const importDetectClasses = useCallback(
    async (names: string[]) => {
      const root = workspaceRoot.trim();
      if (!root) return { added: 0, skipped: 0 };
      const clean = uniqueCleanNames(names);
      const classRoot = await resolveActiveWorkspaceRoot(root);
      let next = await readManifestForMutation(classRoot, manifest);
      let added = 0;
      let skipped = 0;
      for (const name of clean) {
        const activeNames = activeDetectClassDefs(next).map((d) => d.name.trim().toLowerCase());
        if (activeNames.includes(name.toLowerCase())) {
          skipped += 1;
          continue;
        }
        next = addDetectClassToManifest(next, name).manifest;
        added += 1;
      }
      if (added > 0) await persist(next);
      return { added, skipped };
    },
    [manifest, persist, workspaceRoot]
  );

  const importClfClasses = useCallback(
    async (names: string[]) => {
      const root = workspaceRoot.trim();
      if (!root) return { added: 0, skipped: 0 };
      const clean = uniqueCleanNames(names);
      const classRoot = await resolveActiveWorkspaceRoot(root);
      let next = await readManifestForMutation(classRoot, manifest);
      let added = 0;
      let skipped = 0;
      for (const name of clean) {
        const activeNames = activeClfClassDefs(next).map((d) => d.name.trim().toLowerCase());
        if (activeNames.includes(name.toLowerCase())) {
          skipped += 1;
          continue;
        }
        next = addClfClassToManifest(next, name).manifest;
        added += 1;
      }
      if (added > 0) await persist(next);
      return { added, skipped };
    },
    [manifest, persist, workspaceRoot]
  );

  const rename = useCallback(
    async (classKey: string, newName: string) => {
      if (!manifest) return;
      const allNames = manifest.classDefs
        .filter((d) => d.key !== classKey && !d.archived)
        .map((d) => d.name);
      const errors = validateNewClassName(newName, allNames);
      if (errors.length > 0) throw new Error(errors[0]);
      await persist(renameClassInManifest(manifest, classKey, newName));
    },
    [manifest, persist]
  );

  const archiveDetect = useCallback(
    async (classKey: string) => {
      if (!manifest) return;
      await persist(archiveDetectClassInManifest(manifest, classKey));
    },
    [manifest, persist]
  );

  const unarchiveDetect = useCallback(
    async (classKey: string) => {
      if (!manifest) return;
      await persist(unarchiveDetectClassInManifest(manifest, classKey));
    },
    [manifest, persist]
  );

  const archiveClf = useCallback(
    async (classKey: string) => {
      if (!manifest) return;
      await persist(archiveClfClassInManifest(manifest, classKey));
    },
    [manifest, persist]
  );

  const unarchiveClf = useCallback(
    async (classKey: string) => {
      if (!manifest) return;
      await persist(unarchiveClfClassInManifest(manifest, classKey));
    },
    [manifest, persist]
  );

  const upgradeLegacy = useCallback(async () => {
    const root = workspaceRoot.trim();
    if (!root || !legacyMode || !manifest) return;
    // Write manifest (converted from legacy) and sync classes.txt.
    await persist(manifest);
  }, [workspaceRoot, legacyMode, manifest, persist]);

  useEffect(() => {
    if (!workspaceRoot.trim()) return;
    void load();
  }, [load, workspaceRoot]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) return;
    const handleClassesChanged = (event: Event) => {
      if (!isWorkspaceClassesChangedEvent(event)) return;
      if (
        !sameWorkspacePath(event.detail.workspaceRoot, root) &&
        !sameWorkspacePath(event.detail.workspaceRoot, activeWorkspaceRootRef.current)
      ) {
        return;
      }
      void load();
    };
    window.addEventListener(WORKSPACE_CLASSES_CHANGED_EVENT, handleClassesChanged);
    return () => window.removeEventListener(WORKSPACE_CLASSES_CHANGED_EVENT, handleClassesChanged);
  }, [load, workspaceRoot]);

  return {
    manifest,
    legacyMode,
    loading,
    saving,
    loadError,
    saveError,
    load,
    addDetect,
    addClf,
    importDetectClasses,
    importClfClasses,
    rename,
    archiveDetect,
    unarchiveDetect,
    archiveClf,
    unarchiveClf,
    upgradeLegacy,
  };
}
