import { describe, expect, it } from "vitest";
import {
  addOverlayToManifest,
  computeBlackoutBoxOverlapWarnings,
  emptyBlackoutManifest,
  exportRectsForTimestamp,
  findOverlaysForImage,
  findOverlaysForVideoTimestamp,
  normalizeBlackoutOverlayManifest,
  rectIou,
  removeOverlayFromManifest,
  toggleOverlayExport,
  toggleOverlayPreview,
  visibleRectsForTimestamp,
  type BlackoutOverlay
} from "./blackoutOverlayDomain";

function makeRect(id: string, timestampMs: number, x = 0.5, y = 0.5, w = 0.3, h = 0.2): BlackoutOverlay {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    target: { type: "video-timestamp", videoPath: "/video.mp4", timestampMs },
    shape: { type: "rect", x, y, w, h },
    mode: "black",
    visibleInPreview: true,
    applyOnExport: true,
    createdBy: "manual",
    createdAt: now,
    updatedAt: now
  };
}

function makeImageOverlay(id: string, imagePath: string): BlackoutOverlay {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    target: { type: "image", imagePath },
    shape: { type: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    mode: "black",
    visibleInPreview: true,
    applyOnExport: true,
    createdBy: "manual",
    createdAt: now,
    updatedAt: now
  };
}

describe("blackoutOverlayDomain", () => {
  describe("normalizeBlackoutOverlayManifest", () => {
    it("returns empty manifest for null", () => {
      const result = normalizeBlackoutOverlayManifest(null);
      expect(result.version).toBe(1);
      expect(result.overlays).toHaveLength(0);
    });

    it("drops overlays with zero-size rect", () => {
      const bad = {
        version: 1,
        overlays: [
          {
            id: "x1",
            target: { type: "video-timestamp", timestampMs: 1000 },
            shape: { type: "rect", x: 0.5, y: 0.5, w: 0, h: 0.2 },
            mode: "black",
            visibleInPreview: true,
            applyOnExport: true,
            createdBy: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      };
      expect(normalizeBlackoutOverlayManifest(bad).overlays).toHaveLength(0);
    });

    it("clamps rect x/y to keep it inside bounds", () => {
      const raw = {
        version: 1,
        overlays: [
          {
            id: "x2",
            target: { type: "video-timestamp", timestampMs: 1000 },
            shape: { type: "rect", x: 0.0, y: 0.0, w: 0.4, h: 0.4 },
            mode: "black",
            visibleInPreview: true,
            applyOnExport: true,
            createdBy: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      };
      const result = normalizeBlackoutOverlayManifest(raw);
      expect(result.overlays).toHaveLength(1);
      const shape = result.overlays[0].shape;
      if (shape.type !== "rect") throw new Error("expected rect");
      // x must be >= w/2 = 0.2
      expect(shape.x).toBeGreaterThanOrEqual(0.2);
      expect(shape.y).toBeGreaterThanOrEqual(0.2);
    });

    it("drops polygon with fewer than 3 points", () => {
      const raw = {
        version: 1,
        overlays: [
          {
            id: "p1",
            target: { type: "video-timestamp", timestampMs: 1000 },
            shape: { type: "polygon", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
            mode: "black",
            visibleInPreview: true,
            applyOnExport: true,
            createdBy: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      };
      expect(normalizeBlackoutOverlayManifest(raw).overlays).toHaveLength(0);
    });

    it("drops overlay missing id", () => {
      const raw = {
        version: 1,
        overlays: [
          {
            id: "",
            target: { type: "video-timestamp", timestampMs: 1000 },
            shape: { type: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
            mode: "black",
            visibleInPreview: true,
            applyOnExport: true,
            createdBy: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      };
      expect(normalizeBlackoutOverlayManifest(raw).overlays).toHaveLength(0);
    });

    it("round-trips a valid overlay", () => {
      const overlay = makeRect("r1", 5000);
      const manifest = { version: 1, overlays: [overlay] };
      const result = normalizeBlackoutOverlayManifest(manifest);
      expect(result.overlays).toHaveLength(1);
      expect(result.overlays[0].id).toBe("r1");
    });

    it("visibleInPreview and applyOnExport are independent", () => {
      const raw = {
        version: 1,
        overlays: [
          {
            id: "flags1",
            target: { type: "video-timestamp", timestampMs: 1000 },
            shape: { type: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
            mode: "black",
            visibleInPreview: false,
            applyOnExport: true,
            createdBy: "manual",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      };
      const result = normalizeBlackoutOverlayManifest(raw);
      expect(result.overlays[0].visibleInPreview).toBe(false);
      expect(result.overlays[0].applyOnExport).toBe(true);
    });
  });

  describe("CRUD on manifests", () => {
    it("addOverlayToManifest appends the overlay", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("o1", 1000));
      expect(m.overlays).toHaveLength(1);
    });

    it("addOverlayToManifest ignores duplicate ids", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("o1", 1000));
      m = addOverlayToManifest(m, makeRect("o1", 2000));
      expect(m.overlays).toHaveLength(1);
    });

    it("removeOverlayFromManifest removes by id", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("o1", 1000));
      m = addOverlayToManifest(m, makeRect("o2", 2000));
      m = removeOverlayFromManifest(m, "o1");
      expect(m.overlays).toHaveLength(1);
      expect(m.overlays[0].id).toBe("o2");
    });

    it("toggleOverlayPreview flips visibleInPreview", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("o1", 1000));
      expect(m.overlays[0].visibleInPreview).toBe(true);
      m = toggleOverlayPreview(m, "o1");
      expect(m.overlays[0].visibleInPreview).toBe(false);
      m = toggleOverlayPreview(m, "o1");
      expect(m.overlays[0].visibleInPreview).toBe(true);
    });

    it("toggleOverlayExport flips applyOnExport", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("o1", 1000));
      m = toggleOverlayExport(m, "o1");
      expect(m.overlays[0].applyOnExport).toBe(false);
    });

    it("preview and export flags are toggled independently", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("o1", 1000));
      m = toggleOverlayPreview(m, "o1");
      m = toggleOverlayExport(m, "o1");
      expect(m.overlays[0].visibleInPreview).toBe(false);
      expect(m.overlays[0].applyOnExport).toBe(false);
    });
  });

  describe("query helpers", () => {
    it("findOverlaysForVideoTimestamp returns only matching timestamp", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("a", 1000));
      m = addOverlayToManifest(m, makeRect("b", 2000));
      const result = findOverlaysForVideoTimestamp(m, 1000);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a");
    });

    it("findOverlaysForVideoTimestamp filters by videoPath when provided", () => {
      const now = "2026-01-01T00:00:00.000Z";
      const o: BlackoutOverlay = {
        id: "x",
        target: { type: "video-timestamp", videoPath: "/other.mp4", timestampMs: 1000 },
        shape: { type: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        mode: "black",
        visibleInPreview: true,
        applyOnExport: true,
        createdBy: "manual",
        createdAt: now,
        updatedAt: now
      };
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, o);
      expect(findOverlaysForVideoTimestamp(m, 1000, "/video.mp4")).toHaveLength(0);
      expect(findOverlaysForVideoTimestamp(m, 1000, "/other.mp4")).toHaveLength(1);
    });

    it("findOverlaysForImage returns only image overlays with matching path", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeImageOverlay("i1", "/img/a.jpg"));
      m = addOverlayToManifest(m, makeImageOverlay("i2", "/img/b.jpg"));
      const result = findOverlaysForImage(m, "/img/a.jpg");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("i1");
    });

    it("visibleRectsForTimestamp returns only visibleInPreview rects", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("v1", 1000));
      m = addOverlayToManifest(m, makeRect("v2", 1000));
      m = toggleOverlayPreview(m, "v1");
      const rects = visibleRectsForTimestamp(m, 1000);
      expect(rects).toHaveLength(1);
    });

    it("exportRectsForTimestamp returns only applyOnExport rects", () => {
      let m = emptyBlackoutManifest();
      m = addOverlayToManifest(m, makeRect("e1", 1000));
      m = toggleOverlayExport(m, "e1");
      const rects = exportRectsForTimestamp(m, 1000);
      expect(rects).toHaveLength(0);
    });
  });

  describe("rectIou", () => {
    it("identical rects have IoU = 1", () => {
      expect(rectIou({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, { x: 0.5, y: 0.5, w: 0.4, h: 0.4 })).toBeCloseTo(1);
    });

    it("non-overlapping rects have IoU = 0", () => {
      expect(rectIou({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, { x: 0.9, y: 0.9, w: 0.1, h: 0.1 })).toBe(0);
    });
  });

  describe("computeBlackoutBoxOverlapWarnings", () => {
    it("warns when blackout overlaps detect box above threshold", () => {
      // Blackout exactly covers the box → IoU = 1.0 (fully overlapping)
      const overlay = makeRect("b1", 1000, 0.5, 0.5, 0.2, 0.2);
      overlay.applyOnExport = true;
      const boxes = [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
      const warnings = computeBlackoutBoxOverlapWarnings([overlay], boxes, 0.1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].boxIndex).toBe(0);
      expect(warnings[0].overlayId).toBe("b1");
    });

    it("does not warn when applyOnExport is false", () => {
      const overlay = makeRect("b2", 1000, 0.5, 0.5, 0.8, 0.8);
      overlay.applyOnExport = false;
      const boxes = [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
      expect(computeBlackoutBoxOverlapWarnings([overlay], boxes, 0.1)).toHaveLength(0);
    });

    it("does not warn when blackout and box do not overlap", () => {
      const overlay = makeRect("b3", 1000, 0.1, 0.1, 0.1, 0.1);
      const boxes = [{ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }];
      expect(computeBlackoutBoxOverlapWarnings([overlay], boxes, 0.1)).toHaveLength(0);
    });
  });
});
