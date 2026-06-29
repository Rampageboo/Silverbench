import { callJson } from "../../api";
import type { HideJunkMode, JunkScope, MetadataRow } from "./types";

export const INBOX_JUNK_CLASS = "__junk__";

export function truthyFlag(value: unknown) {
  return value === true || value === "1" || value === 1;
}

function normalizeMetadataRow(row: Record<string, unknown>): MetadataRow {
  return {
    filename: String(row.filename || ""),
    detect_junk: truthyFlag(row.detect_junk),
    clf_class: row.clf_class != null ? String(row.clf_class) : undefined,
    detect_enabled: truthyFlag(row.detect_enabled),
    clf_enabled: truthyFlag(row.clf_enabled),
    reviewed: truthyFlag(row.reviewed),
    flagged: truthyFlag(row.flagged)
  };
}

export function isDetectJunk(row: MetadataRow | undefined) {
  return Boolean(row?.detect_junk);
}

export function isClfJunk(row: MetadataRow | undefined) {
  if (!row) return false;
  return row.clf_class === INBOX_JUNK_CLASS;
}

export function isJunkFile(
  row: MetadataRow | undefined,
  scope: JunkScope | "both" | "any" = "any"
) {
  if (scope === "clf") return isClfJunk(row);
  if (scope === "detect") return isDetectJunk(row);
  if (scope === "both") return isDetectJunk(row) && isClfJunk(row);
  return isClfJunk(row) || isDetectJunk(row);
}

export function isReviewedFile(row: MetadataRow | undefined) {
  return Boolean(row?.reviewed);
}

export function isFlaggedFile(row: MetadataRow | undefined) {
  return Boolean(row?.flagged);
}

export function junkLabelForFile(row: MetadataRow | undefined) {
  const clf = isClfJunk(row);
  const detect = isDetectJunk(row);
  if (clf && detect) return "Both junk";
  if (clf) return "Clf junk";
  if (detect) return "Detect junk";
  return "";
}

function metadataSideState(row: MetadataRow | undefined) {
  const detectRejected = isDetectJunk(row);
  const clfRejected = isClfJunk(row);
  const detectInUse = Boolean(row && row.detect_enabled && !detectRejected);
  const clfClass = String(row?.clf_class || "").trim();
  const clfInUse = Boolean(
    row && row.clf_enabled && clfClass && clfClass !== INBOX_JUNK_CLASS && !clfRejected
  );
  return { detectRejected, clfRejected, detectInUse, clfInUse };
}

export function assignVisualState(row: MetadataRow | undefined, scope: JunkScope) {
  const side = scope === "detect" ? "detect" : "clf";
  const { detectRejected, clfRejected, detectInUse, clfInUse } = metadataSideState(row);
  const currentRejected = side === "detect" ? detectRejected : clfRejected;
  const currentInUse = side === "detect" ? detectInUse : clfInUse;
  const otherInUse = side === "detect" ? clfInUse : detectInUse;

  let border = "";
  if (detectInUse && clfInUse) border = "assign-border-both";
  else if (detectRejected && clfRejected) border = "assign-border-both-reject";
  else if (otherInUse) border = "assign-border-other";

  let overlay: "junk" | "active" | null = null;
  if (currentRejected && border !== "assign-border-both-reject") overlay = "junk";
  else if (currentInUse && !border) overlay = "active";

  return { border, overlay, currentInUse, currentRejected };
}

export function thumbMediaClasses(row: MetadataRow | undefined, scope: JunkScope) {
  const visual = assignVisualState(row, scope);
  const parts: string[] = [];
  if (visual.border) parts.push(visual.border);
  if (visual.overlay === "junk") parts.push("assign-current-junk");
  return parts.join(" ");
}

export function cardExtraClasses(row: MetadataRow | undefined, _scope: JunkScope) {
  return isJunkFile(row, "any") ? "inbox-junk" : "";
}

export async function loadMetadataMap(workspaceRoot: string) {
  const result = await callJson<{ ok?: boolean; rows?: Array<Record<string, unknown>> }>(
    "readMetadataRows",
    [workspaceRoot]
  );
  const map = new Map<string, MetadataRow>();
  for (const row of result?.rows || []) {
    const normalized = normalizeMetadataRow(row);
    if (normalized.filename) map.set(normalized.filename, normalized);
  }
  return map;
}

export async function markJunkFilenames(
  workspaceRoot: string,
  filenames: string[],
  scope: JunkScope | "both"
) {
  const updates = filenames.map((filename) => {
    if (scope === "both") {
      return {
        filename,
        detect_junk: true,
        detect_enabled: false,
        clf_enabled: false,
        clf_class: INBOX_JUNK_CLASS,
      };
    }
    return scope === "detect"
      ? { filename, detect_junk: true, detect_enabled: false }
      : { filename, clf_enabled: false, clf_class: INBOX_JUNK_CLASS };
  });
  await callJson("upsertMetadataRows", [workspaceRoot, JSON.stringify(updates)]);
  if (scope === "detect") {
    await callJson("removeDetectDatasetLinks", [workspaceRoot, JSON.stringify(filenames)]);
    return;
  }
  if (scope === "clf") {
    await callJson("removeClfDatasetLinks", [workspaceRoot, JSON.stringify(filenames)]);
    return;
  }
  const cleanupResults = await Promise.allSettled([
    callJson("removeDetectDatasetLinks", [workspaceRoot, JSON.stringify(filenames)]),
    callJson("removeClfDatasetLinks", [workspaceRoot, JSON.stringify(filenames)]),
  ]);
  const failedCleanup = cleanupResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failedCleanup) {
    throw failedCleanup.reason instanceof Error
      ? failedCleanup.reason
      : new Error(String(failedCleanup.reason || "Failed to remove dataset links."));
  }
}

export async function clearJunkFilenames(
  workspaceRoot: string,
  filenames: string[],
  scope: JunkScope
) {
  const updates = filenames.map((filename) =>
    scope === "detect"
      ? { filename, detect_junk: false }
      : { filename, clf_class: "", clf_enabled: false }
  );
  await callJson("upsertMetadataRows", [workspaceRoot, JSON.stringify(updates)]);
}

export async function restoreMetadataSnapshots(
  workspaceRoot: string,
  snapshots: Array<{ filename: string; row: MetadataRow | null }>
) {
  const updates = snapshots.map(({ filename, row }) => {
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
      detect_junk: row.detect_junk,
      reviewed: row.reviewed,
      flagged: row.flagged
    };
  });
  await callJson("upsertMetadataRows", [workspaceRoot, JSON.stringify(updates)]);
}

export async function setMetadataFlags(
  workspaceRoot: string,
  filenames: string[],
  flags: Partial<Pick<MetadataRow, "reviewed" | "flagged">>
) {
  const updates = [...new Set(filenames)].map((filename) => ({ filename, ...flags }));
  if (updates.length) {
    await callJson("upsertMetadataRows", [workspaceRoot, JSON.stringify(updates)]);
  }
}

export function passesHideJunk(row: MetadataRow | undefined, hideJunk: HideJunkMode) {
  if (!hideJunk) return true;
  return !isJunkFile(row, hideJunk);
}
