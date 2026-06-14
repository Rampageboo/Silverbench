import type * as api from "../../api";
import type { MetadataRow } from "../image-pool/types";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";

export const IMAGE_POOL_CACHE_MS = 5 * 60 * 1000;
export const BOX_LABEL_CACHE_MS = 5 * 60 * 1000;

type ImagePoolCacheEntry = {
  scan: api.ImagePoolScan;
  metadata: Map<string, MetadataRow> | null;
  scannedAt: number;
  usageScanned: boolean;
};

type BoxLabelCacheEntry = {
  datasetRoot: string;
  entries: BoxLabelEntry[];
  labelIndex: Map<string, Set<number>> | null;
  cachedAt: number;
};

const imagePoolCache = new Map<string, ImagePoolCacheEntry>();
const boxLabelCache = new Map<string, BoxLabelCacheEntry>();

function normalizeRoot(root: string) {
  return root.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function getImagePoolCache(workspaceRoot: string) {
  return imagePoolCache.get(normalizeRoot(workspaceRoot)) ?? null;
}

export function setImagePoolCache(
  workspaceRoot: string,
  entry: Omit<ImagePoolCacheEntry, "scannedAt"> & { scannedAt?: number }
) {
  imagePoolCache.set(normalizeRoot(workspaceRoot), {
    ...entry,
    scannedAt: entry.scannedAt ?? Date.now()
  });
}

export function patchImagePoolCacheMetadata(workspaceRoot: string, metadata: Map<string, MetadataRow>) {
  const key = normalizeRoot(workspaceRoot);
  const existing = imagePoolCache.get(key);
  if (!existing) return;
  imagePoolCache.set(key, { ...existing, metadata: new Map(metadata) });
}

export function invalidateImagePoolCache(workspaceRoot: string) {
  imagePoolCache.delete(normalizeRoot(workspaceRoot));
}

export function getBoxLabelCache(workspaceRoot: string) {
  return boxLabelCache.get(normalizeRoot(workspaceRoot)) ?? null;
}

export function setBoxLabelCache(workspaceRoot: string, entry: Omit<BoxLabelCacheEntry, "cachedAt"> & { cachedAt?: number }) {
  boxLabelCache.set(normalizeRoot(workspaceRoot), {
    ...entry,
    cachedAt: entry.cachedAt ?? Date.now()
  });
}

export function patchBoxLabelCacheLabelIndex(workspaceRoot: string, labelIndex: Map<string, Set<number>>) {
  const key = normalizeRoot(workspaceRoot);
  const existing = boxLabelCache.get(key);
  if (!existing) return;
  boxLabelCache.set(key, { ...existing, labelIndex: new Map(labelIndex) });
}

export function invalidateBoxLabelCache(workspaceRoot: string) {
  boxLabelCache.delete(normalizeRoot(workspaceRoot));
}
