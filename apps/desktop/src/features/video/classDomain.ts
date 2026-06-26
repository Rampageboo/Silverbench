/**
 * Class key architecture — stable class identifiers for detect and clf tasks.
 *
 * Internal workspace data uses string `classKey` values. YOLO numeric ids are
 * an export-time mapping only. This means:
 *  - Moving a class up or down the detect list does not corrupt existing boxes.
 *  - The same classKey can appear in both detect and clf class sets.
 *  - Multiple workspace mismatch is handled by stable classKey, not global ids.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClassDef = {
  /** Stable slug, e.g. "person" or "cat". Never reused after deletion. */
  key: string;
  /** Human-readable display name. */
  name: string;
  /** Optional hex color for UI rendering. */
  color?: string;
};

/**
 * Workspace-level classes manifest.
 *
 * `tasks.detect.classKeys` controls the YOLO id order for detection export.
 * `tasks.clf.classKeys` controls which classes are valid clf targets.
 * Both lists reference keys defined in `classDefs`.
 */
export type ClassesManifest = {
  version: 1;
  classDefs: ClassDef[];
  tasks: {
    detect: { classKeys: string[] };
    clf: { classKeys: string[] };
  };
};

// ---------------------------------------------------------------------------
// Legacy compatibility helpers
// ---------------------------------------------------------------------------

/**
 * Map a legacy numeric classId to a stable classKey.
 * Falls back to "class_N" when the id is out of range.
 *
 * @deprecated Use classKey everywhere internally. Call only during migration or
 *   when consuming legacy `LabelBox.classId` from pre-v2 manifests.
 */
export function classIdToKey(classId: number, classDefs: ClassDef[]): string {
  const def = classDefs[Math.trunc(classId)];
  return def?.key ?? `class_${Math.max(0, Math.trunc(classId))}`;
}

/**
 * Map a stable classKey to the YOLO numeric id for detect export.
 * Returns 0 when the key is not found in the ordered detect class list.
 */
export function classKeyToDetectId(classKey: string, detectClassKeys: string[]): number {
  const index = detectClassKeys.indexOf(classKey);
  return index >= 0 ? index : 0;
}

/**
 * Derive a safe folder name for clf export.
 * Uses the class name when available, otherwise the key.
 * Non-alphanumeric characters are replaced with underscores.
 */
export function classKeyToClfFolder(classKey: string, classDefs: ClassDef[]): string {
  const def = classDefs.find((d) => d.key === classKey);
  const raw = def?.name || classKey;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || classKey;
}

// ---------------------------------------------------------------------------
// Default / empty
// ---------------------------------------------------------------------------

export function createDefaultClassesManifest(): ClassesManifest {
  return {
    version: 1,
    classDefs: [{ key: "object", name: "object" }],
    tasks: {
      detect: { classKeys: ["object"] },
      clf: { classKeys: [] }
    }
  };
}

/**
 * Build a ClassesManifest from the legacy LabelClass array that existing code
 * uses (numeric `id` + `name`). This is a one-time migration helper.
 */
export function classesManifestFromLegacyClasses(
  items: Array<{ id: number; name: string; color?: string }>
): ClassesManifest {
  const sorted = [...items].sort((a, b) => a.id - b.id);
  const classDefs: ClassDef[] = sorted.map((item) => ({
    key: slugify(item.name) || `class_${item.id}`,
    name: item.name,
    color: item.color
  }));
  const detectKeys = classDefs.map((d) => d.key);
  return {
    version: 1,
    classDefs,
    tasks: {
      detect: { classKeys: detectKeys },
      clf: { classKeys: [] }
    }
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function normalizeClassesManifest(value: unknown): ClassesManifest {
  if (!value || typeof value !== "object") return createDefaultClassesManifest();
  const data = value as Partial<ClassesManifest>;
  if (data.version !== 1) return createDefaultClassesManifest();
  const classDefs: ClassDef[] = Array.isArray(data.classDefs)
    ? data.classDefs.filter((d): d is ClassDef => Boolean(d?.key && d?.name))
    : [];
  const detectKeys: string[] = Array.isArray(data.tasks?.detect?.classKeys)
    ? (data.tasks.detect.classKeys as string[]).filter((k) => typeof k === "string")
    : classDefs.map((d) => d.key);
  const clfKeys: string[] = Array.isArray(data.tasks?.clf?.classKeys)
    ? (data.tasks.clf.classKeys as string[]).filter((k) => typeof k === "string")
    : [];
  return {
    version: 1,
    classDefs,
    tasks: {
      detect: { classKeys: detectKeys },
      clf: { classKeys: clfKeys }
    }
  };
}
