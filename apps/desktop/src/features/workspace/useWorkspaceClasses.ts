import { useCallback, useEffect, useMemo, useState } from "react";
import { readTextFile, writeTextFile } from "../../api";
import { sameWorkspacePath, WORKSPACE_PATHS } from "../../workspace/layout";
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
  validateNewClassName,
  activeDetectClassDefs,
  activeClfClassDefs,
} from "./workspaceClassTaxonomy";

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

/** Read classes.json — the only place classes live (datasets get data.yaml / classes.txt at export). */
export async function readWorkspaceClasses(root: string): Promise<ClassesManifest> {
  try {
    return normalizeClassesManifest(JSON.parse(await readTextFile(root, WORKSPACE_PATHS.classes)));
  } catch {
    return emptyManifest();
  }
}

export async function writeWorkspaceClasses(root: string, manifest: ClassesManifest): Promise<void> {
  await writeTextFile(root, WORKSPACE_PATHS.classes, `${JSON.stringify(manifest, null, 2)}\n`);
  dispatchWorkspaceClassesChanged(root);
}

export type UseWorkspaceClassesResult = {
  manifest: ClassesManifest | null;
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
};

export function useWorkspaceClasses(workspaceRoot: string): UseWorkspaceClassesResult {
  const [manifest, setManifest] = useState<ClassesManifest | null>(null);
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
      setManifest(await readWorkspaceClasses(root));
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
        await writeWorkspaceClasses(root, next);
        setManifest(next);
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

  const importClasses = useCallback(
    async (names: string[], task: "detect" | "clf") => {
      const root = workspaceRoot.trim();
      if (!root) return { added: 0, skipped: 0 };
      const active = task === "detect" ? activeDetectClassDefs : activeClfClassDefs;
      const add = task === "detect" ? addDetectClassToManifest : addClfClassToManifest;
      // Re-read so an import never overwrites a change made elsewhere since the last load.
      let next = await readWorkspaceClasses(root);
      let added = 0;
      let skipped = 0;
      for (const name of uniqueCleanNames(names)) {
        const activeNames = active(next).map((d) => d.name.trim().toLowerCase());
        if (activeNames.includes(name.toLowerCase())) {
          skipped += 1;
          continue;
        }
        next = add(next, name).manifest;
        added += 1;
      }
      if (added > 0) await persist(next);
      return { added, skipped };
    },
    [persist, workspaceRoot]
  );

  const importDetectClasses = useCallback((names: string[]) => importClasses(names, "detect"), [importClasses]);
  const importClfClasses = useCallback((names: string[]) => importClasses(names, "clf"), [importClasses]);

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

  const archiving = useMemo(() => {
    const update = (change: (current: ClassesManifest, classKey: string) => ClassesManifest) => async (classKey: string) => {
      if (!manifest) return;
      await persist(change(manifest, classKey));
    };
    return {
      archiveDetect: update(archiveDetectClassInManifest),
      unarchiveDetect: update(unarchiveDetectClassInManifest),
      archiveClf: update(archiveClfClassInManifest),
      unarchiveClf: update(unarchiveClfClassInManifest),
    };
  }, [manifest, persist]);

  useEffect(() => {
    if (!workspaceRoot.trim()) return;
    void load();
  }, [load, workspaceRoot]);

  useEffect(() => {
    const root = workspaceRoot.trim();
    if (!root) return;
    const handleClassesChanged = (event: Event) => {
      if (!isWorkspaceClassesChangedEvent(event)) return;
      if (!sameWorkspacePath(event.detail.workspaceRoot, root)) return;
      void load();
    };
    window.addEventListener(WORKSPACE_CLASSES_CHANGED_EVENT, handleClassesChanged);
    return () => window.removeEventListener(WORKSPACE_CLASSES_CHANGED_EVENT, handleClassesChanged);
  }, [load, workspaceRoot]);

  return {
    manifest,
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
    ...archiving,
  };
}
