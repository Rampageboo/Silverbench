import type { MetadataRow } from "../image-pool/types";

export type MetadataSnapshot = {
  filename: string;
  row: MetadataRow | null;
};

const stacks = new Map<string, MetadataSnapshot[][]>();
const LIMIT = 10;

function stackKey(context: string) {
  return context;
}

export function pushJunkUndo(context: string, filenames: string[], metadata: Map<string, MetadataRow>) {
  if (!filenames.length) return;
  const key = stackKey(context);
  const stack = stacks.get(key) || [];
  stack.push(
    filenames.map((filename) => ({
      filename,
      row: metadata.has(filename) ? { ...metadata.get(filename)! } : null
    }))
  );
  if (stack.length > LIMIT) stack.shift();
  stacks.set(key, stack);
}

export function hasJunkUndo(context: string) {
  return Boolean(stacks.get(stackKey(context))?.length);
}

export function popJunkUndo(context: string) {
  const key = stackKey(context);
  const stack = stacks.get(key);
  if (!stack?.length) return null;
  return stack.pop() || null;
}

export function metadataRowToUpdate(filename: string, row: MetadataRow | null) {
  if (!row) {
    return {
      filename,
      clf_class: "",
      clf_enabled: false,
      detect_enabled: false,
      detect_junk: false
    };
  }
  return {
    filename,
    clf_class: row.clf_class || "",
    clf_enabled: row.clf_enabled === "1" || row.clf_enabled === true,
    detect_enabled: row.detect_enabled === "1" || row.detect_enabled === true,
    detect_junk: row.detect_junk === "1" || row.detect_junk === true
  };
}
