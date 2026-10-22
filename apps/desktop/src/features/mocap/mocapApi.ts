/** Motion-capture REST contract (backend_api/mocap.py, docs/animocap-engine.md). */
import { backendBaseUrl } from "../../lib/backendConfig";

export type CaptureStatus = "new" | "capturing" | "cancelling" | "ready" | "failed" | "cancelled" | "interrupted";

export type TakeSource = { id: string; video: string; yaw?: number; timeOffset?: number };

export type TakeOptions = {
  roi: [number, number, number, number] | null;
  vlm: boolean;
  appearanceReference: string | null;
  expertInterval: "1" | "2" | "3" | "auto";
  upscale: boolean;
  characterProfile: string | null;
  fps: number;
};

export type CaptureState = {
  status: CaptureStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  warning?: string | null;
  // While capturing:
  stage?: string;
  fraction?: number;
  item?: number;
  total?: number;
  view?: string | null;
  viewIndex?: number;
  viewCount?: number;
  elapsedSeconds?: number;
  remainingSeconds?: number | null;
};

export type Take = {
  id: string;
  name: string;
  createdAt: string;
  mode: "single" | "multiview";
  sources: TakeSource[];
  options: TakeOptions;
  capture: CaptureState;
  hasMotion: boolean;
  edits?: { frameCount: number; corrections: number; reviewMarks: number; reviewRanges: number; updatedAt: string };
};

export type PoseVariant = "current" | "baseline" | "refined";

/** One pose sequence as flat arrays: index ``(frame * joints + joint) * k``. */
export type PoseData = {
  variant: PoseVariant;
  fps: number;
  width: number;
  height: number;
  backend: string;
  joints: string[];
  parents: number[];
  times: number[];
  image: number[];
  position: number[];
  confidence: number[];
  valid: number[];
  inferred: [number, number][];
};

export type TakeIssue = {
  view: string;
  frame: number;
  time: number;
  invalidJoints: number;
  leftRightSwaps: number;
  meanNormalizedError: number | null;
  reasons: string[];
};

export type EngineStatus = {
  root: string;
  engine: { built: boolean; path: string; version?: string | null; error?: string };
  environment: { present: boolean; path: string };
  setup: Record<string, boolean>;
  pose?: { ready: boolean; error?: string; cuda?: boolean; [key: string]: unknown };
  vlm?: { ready: boolean; error?: string; [key: string]: unknown };
};

export type ExportRequest = { format: "bvh" | "vrma"; unit?: "centimeters" | "meters"; range?: [number, number] | null };

export class MocapApiError extends Error {
  constructor(
    readonly status: number,
    detail: unknown
  ) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

async function request<T>(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const params = new URLSearchParams(query).toString();
  const response = await fetch(`${backendBaseUrl()}/api/mocap${path}${params ? `?${params}` : ""}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = result && typeof result === "object" && "detail" in result ? result.detail : result;
    throw new MocapApiError(response.status, detail ?? response.statusText);
  }
  return result as T;
}

const takePath = (id: string) => `/takes/${encodeURIComponent(id)}`;

export const mocapApi = {
  status: (deep = false) => request<EngineStatus>("GET", "/status", deep ? { deep: "true" } : {}),
  refreshStatus: () => request<EngineStatus>("POST", "/status/refresh"),
  openSetup: (name: string) => request<{ started: string }>("POST", `/setup/${encodeURIComponent(name)}`),
  takes: (workspaceRoot: string) => request<{ takes: Take[] }>("GET", "/takes", { workspaceRoot }).then((r) => r.takes),
  take: (workspaceRoot: string, id: string) => request<Take>("GET", takePath(id), { workspaceRoot }),
  createTake: (workspaceRoot: string, body: { name?: string; sources: TakeSource[]; options: Partial<TakeOptions> }) =>
    request<Take>("POST", "/takes", { workspaceRoot }, body),
  capture: (workspaceRoot: string, id: string) => request<Take>("POST", `${takePath(id)}/capture`, { workspaceRoot }),
  cancel: (workspaceRoot: string, id: string) => request<Take>("POST", `${takePath(id)}/cancel`, { workspaceRoot }),
  pose: (workspaceRoot: string, id: string, variant: PoseVariant = "current") =>
    request<PoseData>("GET", `${takePath(id)}/pose`, { workspaceRoot, variant }),
  issues: (workspaceRoot: string, id: string) =>
    request<{ issues: TakeIssue[] }>("GET", `${takePath(id)}/issues`, { workspaceRoot }).then((r) => r.issues),
  export: (workspaceRoot: string, id: string, body: ExportRequest) =>
    request<{ path: string; relativePath: string }>("POST", `${takePath(id)}/export`, { workspaceRoot }, body)
};
