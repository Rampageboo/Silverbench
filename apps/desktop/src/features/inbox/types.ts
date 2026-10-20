import type { ImagePoolItem } from "../../api";
import type { MetadataRow } from "../image-pool/types";
import { isClfJunk, isDetectJunk } from "../image-pool/metadata";

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
  detectImages: number;
  clfImages: number;
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

export function metadataSideState(row: MetadataRow | undefined) {
  const detectRejected = isDetectJunk(row);
  const clfRejected = isClfJunk(row);
  const detectInUse = Boolean(row && row.detect_enabled && !detectRejected);
  const clfClass = String(row?.clf_class || "").trim();
  const clfInUse = Boolean(
    row && row.clf_enabled && clfClass && clfClass !== "__junk__" && !clfRejected
  );
  return { detectRejected, clfRejected, detectInUse, clfInUse };
}
