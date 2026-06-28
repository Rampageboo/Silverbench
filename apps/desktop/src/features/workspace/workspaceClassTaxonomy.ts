/**
 * Workspace class taxonomy — view-model layer.
 *
 * These are UI/wizard-facing adapter types. They do NOT replace the
 * storage-level ClassesManifest (features/video/classDomain.ts), YOLO
 * classes.txt, or any export format. They are a compatibility bridge that
 * lets the wizard, library, and workbench header describe task types and
 * class sets in product language without touching annotation internals.
 *
 * Key guarantee:
 *   Detect class ordering is preserved throughout the round-trip
 *   setup → ClassesManifest → tasks.detect.classKeys[N] = YOLO id N.
 *   Never reorder detect classes after labels exist.
 */

import type { ClassDef, ClassesManifest } from "../video/classDomain";

// ---------------------------------------------------------------------------
// Core product types
// ---------------------------------------------------------------------------

/** Which annotation task(s) a workspace supports. */
export type WorkspaceTaskType = "detect" | "classify" | "both";

/** What kind of media the workspace primarily uses. */
export type WorkspaceMediaMode = "images" | "videos" | "mixed";

/** How the class list was set up. */
export type WorkspaceClassSetupMode = "empty" | "manual" | "starter";

/** A single detect class as entered in the wizard. */
export type DetectClassEntry = { name: string };

/** A single classification class as entered in the wizard. */
export type ClfClassEntry = { name: string };

/**
 * The full class setup collected by the Create Workspace wizard.
 * Convert to ClassesManifest via workspaceClassSetupToClassesManifest().
 */
export type WorkspaceClassSetup = {
  taskType: WorkspaceTaskType;
  mediaMode: WorkspaceMediaMode;
  detectClasses: DetectClassEntry[];
  clfClasses: ClfClassEntry[];
  setupMode: WorkspaceClassSetupMode;
};

/**
 * Condensed class summary for display in Library and workbench header.
 * Derived from ClassesManifest or legacy LabelClass[].
 */
export type WorkspaceClassSummary = {
  taskType: WorkspaceTaskType;
  detectClassCount: number;
  clfClassCount: number;
  /** Display names in YOLO ID order (detectClassKeys order). */
  detectClassNames: string[];
  /** Display names in clf task order. */
  clfClassNames: string[];
};

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/** Slugify a human-readable class name to a stable, filesystem-safe key. */
export function slugifyClassName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "class";
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ---------------------------------------------------------------------------
// Conversion: WorkspaceClassSetup → ClassesManifest
// ---------------------------------------------------------------------------

/**
 * Convert a WorkspaceClassSetup to a ClassesManifest for writing to
 * workspace/classes.json. This is the canonical path during workspace creation.
 *
 * Class key stability contract:
 *   tasks.detect.classKeys[N] always maps to YOLO class id N.
 *   Detect classes appear first in classDefs in entry order.
 *   CLF-only classes follow detect classes in classDefs.
 *   Shared names (in both detect and clf lists) map to the same key.
 */
export function workspaceClassSetupToClassesManifest(setup: WorkspaceClassSetup): ClassesManifest {
  const needDetect = setup.taskType !== "classify";
  const needClf = setup.taskType !== "detect";

  const effectiveDetect = needDetect
    ? setup.detectClasses.map((c) => c.name.trim()).filter(Boolean)
    : [];
  const effectiveClf = needClf
    ? setup.clfClasses.map((c) => c.name.trim()).filter(Boolean)
    : [];

  if (effectiveDetect.length === 0 && effectiveClf.length === 0) {
    // Fallback: single "object" detect class so the workspace is immediately usable.
    return {
      version: 1,
      classDefs: [{ key: "object", name: "object" }],
      tasks: {
        detect: { classKeys: needDetect ? ["object"] : [] },
        clf: { classKeys: needClf ? ["object"] : [] },
      },
    };
  }

  const usedKeys = new Set<string>();
  const nameToKey = new Map<string, string>();

  const registerName = (name: string) => {
    if (nameToKey.has(name)) return; // already registered (shared class)
    const base = slugifyClassName(name);
    const key = uniqueSlug(base, usedKeys);
    usedKeys.add(key);
    nameToKey.set(name, key);
  };

  // Detect classes must be registered first so their key order is preserved.
  for (const name of effectiveDetect) registerName(name);
  // CLF classes — may overlap with detect (shared class → same key reused).
  for (const name of effectiveClf) registerName(name);

  // Build classDefs in insertion order: detect first, then clf-only.
  const seenKeys = new Set<string>();
  const classDefs: ClassDef[] = [];
  for (const name of [...effectiveDetect, ...effectiveClf]) {
    const key = nameToKey.get(name)!;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      classDefs.push({ key, name });
    }
  }

  const detectClassKeys = effectiveDetect.map((name) => nameToKey.get(name)!);
  const clfClassKeys = effectiveClf.map((name) => nameToKey.get(name)!);

  return {
    version: 1,
    classDefs,
    tasks: {
      detect: { classKeys: detectClassKeys },
      clf: { classKeys: clfClassKeys },
    },
  };
}

// ---------------------------------------------------------------------------
// Derivation: ClassesManifest → summary types
// ---------------------------------------------------------------------------

/**
 * Derive a WorkspaceTaskType from a ClassesManifest.
 * Used by Library panel and workbench header.
 */
export function derivedTaskType(manifest: ClassesManifest): WorkspaceTaskType {
  const hasDetect = manifest.tasks.detect.classKeys.length > 0;
  const hasClf = manifest.tasks.clf.classKeys.length > 0;
  if (hasDetect && hasClf) return "both";
  if (hasClf) return "classify";
  return "detect"; // empty or detect-only → treat as detect
}

/**
 * Build a WorkspaceClassSummary from a ClassesManifest.
 * Suitable for displaying in Library and workbench header.
 */
export function workspaceClassSummary(manifest: ClassesManifest): WorkspaceClassSummary {
  const taskType = derivedTaskType(manifest);
  const detectKeys = manifest.tasks.detect.classKeys;
  const clfKeys = manifest.tasks.clf.classKeys;
  const keyToName = new Map(manifest.classDefs.map((d) => [d.key, d.name]));
  return {
    taskType,
    detectClassCount: detectKeys.length,
    clfClassCount: clfKeys.length,
    detectClassNames: detectKeys.map((k) => keyToName.get(k) ?? k),
    clfClassNames: clfKeys.map((k) => keyToName.get(k) ?? k),
  };
}

/**
 * Adapt a legacy numeric LabelClass array (from GET /api/labels/classes) to a
 * WorkspaceClassSummary for display when workspace/classes.json is absent.
 *
 * Treats all legacy classes as detect-only (the legacy model has no clf class
 * concept at the workspace manifest level).
 */
export function workspaceClassSummaryFromLegacy(
  legacyClasses: Array<{ id: number; name: string }>
): WorkspaceClassSummary {
  const sorted = [...legacyClasses].sort((a, b) => a.id - b.id);
  return {
    taskType: "detect",
    detectClassCount: sorted.length,
    clfClassCount: 0,
    detectClassNames: sorted.map((c) => c.name),
    clfClassNames: [],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a WorkspaceClassSetup. Returns an array of error messages.
 * An empty array means the setup is valid.
 */
export function validateClassSetup(setup: WorkspaceClassSetup): string[] {
  const errors: string[] = [];
  const needDetect = setup.taskType !== "classify";
  const needClf = setup.taskType !== "detect";

  if (needDetect) {
    const blanks = setup.detectClasses.filter((c) => !c.name.trim());
    if (blanks.length > 0) errors.push("Detect class names cannot be empty.");
    const names = setup.detectClasses.map((c) => c.name.trim().toLowerCase());
    const dupe = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dupe) errors.push(`Duplicate detect class: "${dupe}".`);
  }

  if (needClf) {
    const blanks = setup.clfClasses.filter((c) => !c.name.trim());
    if (blanks.length > 0) errors.push("Classification class names cannot be empty.");
    const names = setup.clfClasses.map((c) => c.name.trim().toLowerCase());
    const dupe = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dupe) errors.push(`Duplicate classification class: "${dupe}".`);
  }

  return errors;
}
