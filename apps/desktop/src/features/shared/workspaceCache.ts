import type * as api from "../../api";
import type { MetadataRow } from "../image-pool/types";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";

export const IMAGE_POOL_CACHE_MS = 5 * 60 * 1000;
export const BOX_LABEL_CACHE_MS = 5 * 60 * 1000;

export type ImagePoolCacheEntry = {
  scan: api.ImagePoolScan;
  metadata: Map<string, MetadataRow> | null;
  scannedAt: number;
  usageScanned: boolean;
};

export type BoxLabelCacheEntry = {
  datasetRoot: string;
  mediaDir?: string;
  entries: BoxLabelEntry[];
  labelIndex: Map<string, Set<number>> | null;
  cachedAt: number;
};

export function normalizeWorkspaceRoot(root: string) {
  return root.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function createWorkspaceCacheStore() {
  const imagePoolCache = new Map<string, ImagePoolCacheEntry>();
  const boxLabelCache = new Map<string, BoxLabelCacheEntry>();

  function getImagePoolCache(workspaceRoot: string) {
    return imagePoolCache.get(normalizeWorkspaceRoot(workspaceRoot)) ?? null;
  }

  function setImagePoolCache(
    workspaceRoot: string,
    entry: Omit<ImagePoolCacheEntry, "scannedAt"> & { scannedAt?: number }
  ) {
    imagePoolCache.set(normalizeWorkspaceRoot(workspaceRoot), {
      ...entry,
      scannedAt: entry.scannedAt ?? Date.now()
    });
  }

  function patchImagePoolCacheMetadata(workspaceRoot: string, metadata: Map<string, MetadataRow>) {
    const key = normalizeWorkspaceRoot(workspaceRoot);
    const existing = imagePoolCache.get(key);
    if (!existing) return;
    imagePoolCache.set(key, { ...existing, metadata: new Map(metadata) });
  }

  function invalidateImagePoolCache(workspaceRoot: string) {
    imagePoolCache.delete(normalizeWorkspaceRoot(workspaceRoot));
  }

  function getBoxLabelCache(workspaceRoot: string) {
    return boxLabelCache.get(normalizeWorkspaceRoot(workspaceRoot)) ?? null;
  }

  function setBoxLabelCache(
    workspaceRoot: string,
    entry: Omit<BoxLabelCacheEntry, "cachedAt"> & { cachedAt?: number }
  ) {
    boxLabelCache.set(normalizeWorkspaceRoot(workspaceRoot), {
      ...entry,
      cachedAt: entry.cachedAt ?? Date.now()
    });
  }

  function patchBoxLabelCacheLabelIndex(workspaceRoot: string, labelIndex: Map<string, Set<number>>) {
    const key = normalizeWorkspaceRoot(workspaceRoot);
    const existing = boxLabelCache.get(key);
    if (!existing) return;
    boxLabelCache.set(key, { ...existing, labelIndex: new Map(labelIndex) });
  }

  function invalidateBoxLabelCache(workspaceRoot: string) {
    boxLabelCache.delete(normalizeWorkspaceRoot(workspaceRoot));
  }

  return {
    getImagePoolCache,
    setImagePoolCache,
    patchImagePoolCacheMetadata,
    invalidateImagePoolCache,
    getBoxLabelCache,
    setBoxLabelCache,
    patchBoxLabelCacheLabelIndex,
    invalidateBoxLabelCache
  };
}

export type WorkspaceCacheStore = ReturnType<typeof createWorkspaceCacheStore>;
