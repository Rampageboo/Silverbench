import { backendBaseUrl } from "../../lib/backendConfig";

export type AiSettings = {
  cloud_enabled: boolean;
  request_limit_usd: number;
  batch_limit_usd: number;
  monthly_limit_usd: number;
  prices: Record<string, { input: number; output: number }>;
};
export type AiObject = {
  class_id: number;
  box: number[];
  pixel_box: number[];
  evidence: string;
  review_status: string;
};
export type AiResult = {
  id?: string;
  provider: string;
  cloud_request_sent: boolean;
  review_status: string;
  objects?: AiObject[];
  uncertainty?: string;
  reason?: string;
  cost_usd_estimate?: number;
  caption?: string;
  tags?: string[];
  remove_tags?: string[];
};
export type AiRecord = {
  id: string;
  status: string;
  provider: string;
  model: string;
  charged: number;
  record: {
    workspace_root: string;
    filename: string;
    task: string;
    asset_id?: string;
    original_size: number[];
    classes: { id: number; name: string }[];
    result?: AiResult;
  };
};
export async function aiRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${backendBaseUrl()}/api/ai${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.detail === "string" ? value.detail : `AI request failed (${response.status})`
    );
  return value as T;
}

export function boxPrediction(object: AiObject) {
  const [x1, y1, x2, y2] = object.box;
  // Importer acceptance flag after human review; this is not a model probability.
  return {
    classId: object.class_id,
    confidence: 1,
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    w: x2 - x1,
    h: y2 - y1
  };
}

export function correctedTags(existing: string[], add: string[], remove: string[]) {
  const removed = new Set(remove);
  return [...new Set([...existing, ...add].filter((tag) => !removed.has(tag)))];
}
