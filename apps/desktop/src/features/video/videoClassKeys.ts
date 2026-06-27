/**
 * ClassKey compatibility layer — transition between legacy numeric classId and
 * stable string classKey.
 *
 * Transition state:
 *  - Detect boxes may carry both classId (legacy canvas) and classKey (new).
 *  - New writes add classKey; legacy canvas still reads classId.
 *  - Export uses classKey when present, classId fallback for old data.
 *  - This module is intentionally simple until the class system is fully migrated.
 */

import type { LabelClass } from "../../api";

/** Derive a stable URL-safe key from a class name. */
export function classNameToSafeKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "class";
}

/** Derive a classKey for a numeric classId using the current class list. */
export function classIdToKey(classId: number, classes: LabelClass[]): string {
  const found = classes.find((c) => c.id === classId);
  if (found) return classNameToSafeKey(found.name);
  return `class-${classId}`;
}

/**
 * Resolve a classKey back to a numeric classId.
 * Returns undefined when the key cannot be mapped.
 */
export function classKeyToClassId(classKey: string, classes: LabelClass[]): number | undefined {
  // Direct name match
  const byName = classes.find((c) => classNameToSafeKey(c.name) === classKey);
  if (byName !== undefined) return byName.id;
  // Fallback key pattern "class-N"
  const match = /^class-(\d+)$/.exec(classKey);
  if (match) return Number(match[1]);
  return undefined;
}

/**
 * Given a class list, return a stable ordered array of classKeys for YOLO
 * detect export. The index in this array is the YOLO numeric class id used in
 * label files.
 */
export function buildDetectClassKeyIndex(classes: LabelClass[]): string[] {
  return classes
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => classNameToSafeKey(c.name));
}
