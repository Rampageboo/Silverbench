import type { MetadataRow } from "../image-pool/types";

export type MetadataSnapshot = {
  filename: string;
  row: MetadataRow | null;
};

const stacks = new Map<string, MetadataSnapshot[][]>();
const LIMIT = 10;

function stackKey(context: string, workspaceRoot: string) {
  return `${context}::${workspaceRoot.trim()}`;
}

export function pushJunkUndo(
  context: string,
  workspaceRoot: string,
  filenames: string[],
  metadata: Map<string, MetadataRow>
) {
  if (!filenames.length || !workspaceRoot.trim()) return;
  const key = stackKey(context, workspaceRoot);
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

export function hasJunkUndo(context: string, workspaceRoot: string) {
  if (!workspaceRoot.trim()) return false;
  return Boolean(stacks.get(stackKey(context, workspaceRoot))?.length);
}

export function popJunkUndo(context: string, workspaceRoot: string) {
  if (!workspaceRoot.trim()) return null;
  const key = stackKey(context, workspaceRoot);
  const stack = stacks.get(key);
  if (!stack?.length) return null;
  return stack.pop() || null;
}

/** Drop undo stacks for a workspace when switching away. */
export function clearJunkUndoForWorkspace(workspaceRoot: string) {
  const suffix = `::${workspaceRoot.trim()}`;
  if (!suffix || suffix === "::") return;
  for (const key of [...stacks.keys()]) {
    if (key.endsWith(suffix)) stacks.delete(key);
  }
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
    clf_enabled: row.clf_enabled,
    detect_enabled: row.detect_enabled,
    detect_junk: row.detect_junk
  };
}
