import { writeWorkspaceSession } from "../../api";
import { readWorkspaceSessionLite } from "../image-pool/session";

export type CropQueueItem = {
  absPath: string;
  relPath: string;
  className: string;
};

export type CropQueueSource = {
  source: string;
  label: string;
  added: number;
  at: number;
};

export type CropQueueState = {
  items: CropQueueItem[];
  sources: CropQueueSource[];
};

export function emptyCropQueue(): CropQueueState {
  return { items: [], sources: [] };
}

export async function readCropQueue(workspaceRoot: string): Promise<CropQueueState> {
  const session = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  const queue = session.cropQueue as CropQueueState | undefined;
  if (!queue || !Array.isArray(queue.items)) return emptyCropQueue();
  return {
    items: queue.items.filter((item) => item?.absPath),
    sources: Array.isArray(queue.sources) ? queue.sources : []
  };
}

export async function saveCropQueue(workspaceRoot: string, queue: CropQueueState) {
  const existing = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  await writeWorkspaceSession(workspaceRoot, {
    ...(existing as Record<string, unknown>),
    cropQueue: queue
  });
}

export function mergeCropQueue(
  queue: CropQueueState,
  newItems: CropQueueItem[],
  meta: { source: string; label: string }
) {
  const next = {
    items: [...queue.items],
    sources: [...queue.sources]
  };
  const existing = new Set(next.items.map((item) => item.absPath));
  let added = 0;
  for (const item of newItems) {
    if (!item.absPath || existing.has(item.absPath)) continue;
    next.items.push(item);
    existing.add(item.absPath);
    added += 1;
  }
  if (added) {
    next.sources.push({ ...meta, added, at: Date.now() });
  }
  return { queue: next, added };
}

export function pairToCropItem(datasetRoot: string, imagePath: string, className: string) {
  const root = datasetRoot.replace(/[\\/]+$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  const rel = imagePath.replace(/\//g, sep);
  return {
    absPath: `${root}${sep}${rel}`,
    relPath: imagePath.replace(/\\/g, "/"),
    className: className || "(unknown)"
  };
}
