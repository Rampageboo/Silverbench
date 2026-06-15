import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceCacheStore } from "./workspaceCache";
import type { MetadataRow } from "../image-pool/types";

const ROOT = "C:\\Workspace\\Demo\\";
const ROOT_NORMALIZED = "c:/workspace/demo";

describe("workspace cache store", () => {
  let cache = createWorkspaceCacheStore();

  afterEach(() => {
    cache = createWorkspaceCacheStore();
  });

  describe("image pool cache", () => {
    it("returns null for missing entries", () => {
      expect(cache.getImagePoolCache(ROOT)).toBeNull();
    });

    it("normalizes workspace root keys", () => {
      cache.setImagePoolCache(ROOT, {
        scan: { ok: true, files: [], count: 0 },
        metadata: null,
        usageScanned: false
      });
      expect(cache.getImagePoolCache("c:/workspace/demo/")).not.toBeNull();
      expect(cache.getImagePoolCache("C:/WORKSPACE/DEMO")).not.toBeNull();
    });

    it("stores scan payload and metadata", () => {
      const metadata = new Map<string, MetadataRow>([["a.jpg", { filename: "a.jpg", reviewed: true }]]);
      cache.setImagePoolCache(ROOT, {
        scan: { ok: true, files: ["a.jpg"], count: 1 },
        metadata,
        usageScanned: true,
        scannedAt: 123
      });
      const cached = cache.getImagePoolCache(ROOT_NORMALIZED);
      expect(cached?.scan.count).toBe(1);
      expect(cached?.usageScanned).toBe(true);
      expect(cached?.scannedAt).toBe(123);
      expect(cached?.metadata?.get("a.jpg")?.reviewed).toBe(true);
    });

    it("patches metadata without replacing scan", () => {
      cache.setImagePoolCache(ROOT, {
        scan: { ok: true, files: ["a.jpg"], count: 1 },
        metadata: new Map(),
        usageScanned: false
      });
      const next = new Map<string, MetadataRow>([["b.jpg", { filename: "b.jpg", flagged: true }]]);
      cache.patchImagePoolCacheMetadata(ROOT, next);
      const cached = cache.getImagePoolCache(ROOT);
      expect(cached?.scan.count).toBe(1);
      expect(cached?.metadata?.get("b.jpg")?.flagged).toBe(true);
      expect(cached?.metadata).not.toBe(next);
    });

    it("no-ops metadata patch when cache entry missing", () => {
      cache.patchImagePoolCacheMetadata(ROOT, new Map());
      expect(cache.getImagePoolCache(ROOT)).toBeNull();
    });

    it("invalidates cache entry", () => {
      cache.setImagePoolCache(ROOT, {
        scan: { ok: true, files: [], count: 0 },
        metadata: null,
        usageScanned: false
      });
      cache.invalidateImagePoolCache(ROOT);
      expect(cache.getImagePoolCache(ROOT)).toBeNull();
    });
  });

  describe("box label cache", () => {
    it("returns null for missing entries", () => {
      expect(cache.getBoxLabelCache(ROOT)).toBeNull();
    });

    it("stores dataset entries and label index", () => {
      const labelIndex = new Map<string, Set<number>>([["a.jpg", new Set([0, 1])]]);
      cache.setBoxLabelCache(ROOT, {
        datasetRoot: "/datasets/demo",
        entries: [{ basename: "a.jpg", imagePath: "images/a.jpg", labelPath: "labels/a.txt" }],
        labelIndex,
        cachedAt: 456
      });
      const cached = cache.getBoxLabelCache(ROOT);
      expect(cached?.datasetRoot).toBe("/datasets/demo");
      expect(cached?.entries).toHaveLength(1);
      expect(cached?.cachedAt).toBe(456);
      expect(cached?.labelIndex?.get("a.jpg")?.has(1)).toBe(true);
    });

    it("patches label index without replacing entries", () => {
      cache.setBoxLabelCache(ROOT, {
        datasetRoot: "/datasets/demo",
        entries: [],
        labelIndex: null
      });
      const next = new Map<string, Set<number>>([["b.jpg", new Set([2])]]);
      cache.patchBoxLabelCacheLabelIndex(ROOT, next);
      const cached = cache.getBoxLabelCache(ROOT);
      expect(cached?.entries).toEqual([]);
      expect(cached?.labelIndex?.get("b.jpg")?.has(2)).toBe(true);
      expect(cached?.labelIndex).not.toBe(next);
    });

    it("invalidates box label cache entry", () => {
      cache.setBoxLabelCache(ROOT, {
        datasetRoot: "/datasets/demo",
        entries: [],
        labelIndex: null
      });
      cache.invalidateBoxLabelCache(ROOT);
      expect(cache.getBoxLabelCache(ROOT)).toBeNull();
    });
  });
});
