import type { MetadataRow } from "../image-pool/types";
import { INBOX_JUNK_CLASS, restoreMetadataSnapshots } from "../image-pool/metadata";
import { runBuildYoloLinksJob } from "../inbox/buildJob";

export type MetadataUpdate = {
  filename: string;
  detect_enabled?: boolean;
  detect_junk?: boolean;
  clf_enabled?: boolean;
  clf_class?: string;
};

export function metadataRowToUpdate(filename: string, row: MetadataRow | null): MetadataUpdate {
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

export function filenamesNeedingDatasetRebuild(updates: MetadataUpdate[]) {
  const detect: string[] = [];
  const clf: string[] = [];
  for (const item of updates) {
    const filename = String(item.filename || "").trim();
    if (!filename) continue;
    if (item.detect_enabled && !item.detect_junk) detect.push(filename);
    const clfClass = String(item.clf_class || "").trim();
    if (item.clf_enabled && clfClass && clfClass !== INBOX_JUNK_CLASS) clf.push(filename);
  }
  return { detect, clf };
}

export async function rebuildDatasetLinksForFilenames(
  workspaceRoot: string,
  filenames: string[],
  scope: "detect" | "clf"
) {
  const names = [...new Set(filenames.map((name) => name.trim()).filter(Boolean))];
  if (!names.length) return;
  await runBuildYoloLinksJob(workspaceRoot, false, JSON.stringify(names));
  void scope;
}

export async function restoreJunkUndoWithLinks(
  workspaceRoot: string,
  snapshots: Array<{ filename: string; row: MetadataRow | null }>
) {
  await restoreMetadataSnapshots(workspaceRoot, snapshots);
  const updates = snapshots.map(({ filename, row }) => metadataRowToUpdate(filename, row));
  const { detect, clf } = filenamesNeedingDatasetRebuild(updates);
  if (detect.length) await rebuildDatasetLinksForFilenames(workspaceRoot, detect, "detect");
  if (clf.length) await rebuildDatasetLinksForFilenames(workspaceRoot, clf, "clf");
}
