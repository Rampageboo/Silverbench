import { writeWorkspaceSession } from "../../api";
import { readWorkspaceSessionLite } from "../image-pool/session";
import type { InboxFilter, InboxSession, InboxSessionSummary, AssignTarget } from "./types";

const VALID_FILTERS = new Set<InboxFilter>(["new", "unassigned", "random-unused", "all"]);

export function smallPathHash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function defaultInboxSession(): InboxSession {
  return {
    assignBatches: [],
    buildRuns: [],
    ui: { filter: "new", assignTarget: "clf", scrollTop: 0 }
  };
}

export function normalizeInboxSession(data: unknown): InboxSession {
  const base = defaultInboxSession();
  if (!data || typeof data !== "object") return base;
  const root = data as InboxSession;
  const ui = root.ui && typeof root.ui === "object" ? root.ui : base.ui;
  return {
    assignBatches: Array.isArray(root.assignBatches) ? root.assignBatches.slice(-2000) : [],
    buildRuns: Array.isArray(root.buildRuns) ? root.buildRuns.slice(-500) : [],
    ui: {
      filter: VALID_FILTERS.has(ui.filter) ? ui.filter : base.ui.filter,
      assignTarget: ui.assignTarget === "detect" ? "detect" : "clf",
      scrollTop: Math.max(0, Math.round(Number(ui.scrollTop) || 0))
    }
  };
}

export function inboxPendingFilenamesFrom(inbox: InboxSession) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const batch of inbox.assignBatches || []) {
    if (batch.built) continue;
    for (const filename of batch.filenames || []) {
      if (seen.has(filename)) continue;
      seen.add(filename);
      names.push(filename);
    }
  }
  return names;
}

export function inboxSessionSummary(inbox: InboxSession): InboxSessionSummary {
  const normalized = normalizeInboxSession(inbox);
  const pendingFilenames = inboxPendingFilenamesFrom(normalized);
  const pendingBatches = normalized.assignBatches.filter((batch) => !batch.built).length;
  const lastBuildAt = normalized.buildRuns.length
    ? normalized.buildRuns[normalized.buildRuns.length - 1]?.at || ""
    : "";
  return {
    inbox: normalized,
    pendingFilenames,
    pendingBatches,
    pendingFiles: pendingFilenames.length,
    lastBuildAt
  };
}

export async function readInboxSession(workspaceRoot: string) {
  const session = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  return inboxSessionSummary(normalizeInboxSession(session.inbox));
}

export async function saveInboxSession(workspaceRoot: string, inbox: InboxSession) {
  const existing = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  const normalized = normalizeInboxSession(inbox);
  await writeWorkspaceSession(workspaceRoot, {
    ...(existing as Record<string, unknown>),
    inbox: normalized
  });
  return inboxSessionSummary(normalized);
}

export function markInboxBatchesBuilt(
  inbox: InboxSession,
  options: { markAll?: boolean; batchIds?: string[]; filenames?: string[] }
) {
  const builtAt = new Date().toISOString();
  const markIdSet = new Set(options.batchIds || []);
  const builtNames = new Set(options.filenames || []);
  for (const batch of inbox.assignBatches) {
    if (options.markAll || markIdSet.has(batch.id)) {
      batch.built = true;
      batch.builtAt = builtAt;
      continue;
    }
    if (builtNames.size && (batch.filenames || []).every((name) => builtNames.has(name))) {
      batch.built = true;
      batch.builtAt = builtAt;
    }
  }
  return inbox;
}

export function pendingBatchIds(inbox: InboxSession) {
  return inbox.assignBatches.filter((batch) => !batch.built).map((batch) => batch.id);
}

export function assignTargetFromSession(ui: { assignTarget?: AssignTarget }) {
  return ui.assignTarget === "detect" ? "detect" : "clf";
}
