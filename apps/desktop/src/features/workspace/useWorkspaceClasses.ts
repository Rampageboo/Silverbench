import { useCallback, useState } from "react";
import { loadLabelClasses, saveLabelClasses, writeTextFile, readTextFile } from "../../api";
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

const CLASSES_JSON_PATH = "workspace/classes.json";

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

  const load = useCallback(async () => {
    const root = workspaceRoot.trim();
    if (!root) return;
    setLoading(true);
    setLoadError("");
    try {
      try {
        const text = await readTextFile(root, CLASSES_JSON_PATH);
        const m = normalizeClassesManifest(JSON.parse(text));
        setManifest(m);
        setLegacyMode(false);
      } catch {
        // No classes.json — try legacy classes.txt.
        const legacyClasses = await loadLabelClasses(root);
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
        // Write classes.json (canonical source).
        await writeTextFile(root, CLASSES_JSON_PATH, `${JSON.stringify(next, null, 2)}\n`);
        // Sync classes.txt (ALL detect classes including archived, to preserve IDs).
        const legacyClasses = manifestToLegacyClasses(next);
        if (legacyClasses.length > 0) {
          await saveLabelClasses(root, legacyClasses);
        }
        setManifest(next);
        setLegacyMode(false);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
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
    rename,
    archiveDetect,
    unarchiveDetect,
    archiveClf,
    unarchiveClf,
    upgradeLegacy,
  };
}
