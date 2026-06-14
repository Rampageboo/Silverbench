import type { ImagePoolItem } from "../../api";
import type { JunkScope, MetadataRow } from "../image-pool/types";

export type InboxFilter = "new" | "unassigned" | "random-unused" | "all";
export type AssignTarget = "detect" | "clf";

export type InboxAssignBatch = {
  id: string;
  at: string;
  className: string;
  assignTarget: AssignTarget;
  detectEnabled: boolean;
  clfEnabled: boolean;
  filenames: string[];
  built: boolean;
  builtAt: string;
};

export type InboxBuildRun = {
  id: string;
  at: string;
  scope: string;
  rebuild: boolean;
  batchIds: string[];
  filenames: string[];
  detectImagesLinked: number;
  clfImagesLinked: number;
  labelsPlaced: number;
  errors: string[];
};

export type InboxSession = {
  assignBatches: InboxAssignBatch[];
  buildRuns: InboxBuildRun[];
  ui: {
    filter: InboxFilter;
    assignTarget: AssignTarget;
    scrollTop?: number;
  };
};

export type InboxSessionSummary = {
  inbox: InboxSession;
  pendingFilenames: string[];
  pendingBatches: number;
  pendingFiles: number;
  lastBuildAt: string;
};

export type DetectClass = { id: number; name: string };

export type InboxItem = ImagePoolItem & { imagePath: string };

export type InboxUiState = {
  filter: InboxFilter;
  assignTarget: AssignTarget;
  junkScope: JunkScope;
};

export function metadataSideState(row: MetadataRow | undefined) {
  const detectRejected = row?.detect_junk === true || row?.detect_junk === "1";
  const clfRejected = row?.clf_class === "__junk__";
  const detectInUse = Boolean(row && (row.detect_enabled === true || row.detect_enabled === "1") && !detectRejected);
  const clfClass = String(row?.clf_class || "").trim();
  const clfInUse = Boolean(
    row &&
      (row.clf_enabled === true || row.clf_enabled === "1") &&
      clfClass &&
      clfClass !== "__junk__" &&
      !clfRejected
  );
  return { detectRejected, clfRejected, detectInUse, clfInUse };
}
