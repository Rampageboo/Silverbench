import { writeTextFile } from "../api";

export type WorkspaceLogLevel = "debug" | "info" | "warning" | "error";

export type WorkspaceEventInput = {
  tool: string;
  action: string;
  level?: WorkspaceLogLevel;
  message?: string;
  operationId?: string;
  details?: Record<string, unknown>;
};

export type WorkspaceOperationInput = {
  operationId?: string;
  tool: string;
  action: string;
  status: "started" | "done" | "failed" | "cancelled";
  inputs?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  errors?: string[];
};

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pathSafeTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function createWorkspaceEvent(input: WorkspaceEventInput) {
  const now = new Date();
  return {
    schemaVersion: 1,
    id: randomId(),
    timestamp: now.toISOString(),
    source: "desktop",
    level: input.level || "info",
    tool: input.tool,
    action: input.action,
    message: input.message || "",
    operationId: input.operationId || "",
    details: input.details || {}
  };
}

export async function recordWorkspaceEvent(workspaceRoot: string, input: WorkspaceEventInput) {
  if (!workspaceRoot.trim()) return null;
  const event = createWorkspaceEvent(input);
  const date = new Date(event.timestamp);
  const relativePath = `workspace/logs/events/${dayKey(date)}/${pathSafeTimestamp(date)}-${event.id}.json`;
  await writeTextFile(workspaceRoot, relativePath, `${JSON.stringify(event, null, 2)}\n`);
  return { event, relativePath };
}

/** Use for diagnostics where a logging failure must never break the user's action. */
export function recordWorkspaceEventBestEffort(workspaceRoot: string, input: WorkspaceEventInput) {
  void recordWorkspaceEvent(workspaceRoot, input).catch(() => {});
}

export async function recordWorkspaceOperation(workspaceRoot: string, input: WorkspaceOperationInput) {
  if (!workspaceRoot.trim()) return null;
  const now = new Date();
  const operationId = input.operationId || randomId();
  const payload = {
    schemaVersion: 1,
    operationId,
    timestamp: now.toISOString(),
    source: "desktop",
    tool: input.tool,
    action: input.action,
    status: input.status,
    inputs: input.inputs || {},
    summary: input.summary || {},
    errors: input.errors || []
  };
  const relativePath = `workspace/logs/operations/${operationId}.json`;
  await writeTextFile(workspaceRoot, relativePath, `${JSON.stringify(payload, null, 2)}\n`);
  return { payload, relativePath };
}
