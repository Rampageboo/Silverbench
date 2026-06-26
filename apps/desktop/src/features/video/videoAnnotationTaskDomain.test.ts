import { describe, expect, it } from "vitest";
import {
  clfStatusLabel,
  detectBoxCount,
  detectStatusLabel,
  isClfReady,
  isDetectReady,
  migrateV1FrameToV2,
  normalizeV2Frame,
  updateClfTask,
  updateDetectTask,
  type VideoTimestampAnnotation
} from "./videoAnnotationTaskDomain";
import type { ClassDef } from "./classDomain";

const classDefs: ClassDef[] = [
  { key: "car", name: "Car" },
  { key: "person", name: "Person" }
];

describe("migrateV1FrameToV2", () => {
  it("moves boxes into tasks.detect", () => {
    const v1 = {
      timestampMs: 1000,
      boxes: [{ classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.1 }],
      reviewed: true,
      updatedAt: "2026-01-01T00:00:00Z"
    };
    const v2 = migrateV1FrameToV2(v1, classDefs);
    expect(v2.tasks.detect?.boxes).toHaveLength(1);
    expect(v2.tasks.detect?.boxes[0].classKey).toBe("car");
    expect(v2.tasks.detect?.reviewed).toBe(true);
    expect(v2.tasks.clf).toBeUndefined();
  });

  it("marks empty when reviewed and no boxes", () => {
    const v1 = { timestampMs: 2000, boxes: [], reviewed: true };
    const v2 = migrateV1FrameToV2(v1, classDefs);
    expect(v2.tasks.detect?.empty).toBe(true);
    expect(v2.tasks.detect?.boxes).toHaveLength(0);
  });

  it("does not write any image file (migration is pure data)", () => {
    // This test documents the contract: migration produces only a data structure.
    const v1 = { timestampMs: 3000, boxes: [], reviewed: false };
    const result = migrateV1FrameToV2(v1, classDefs);
    // No file path appears in the result
    expect(JSON.stringify(result)).not.toMatch(/\.jpg|\.png|image_pool/);
  });

  it("preserves timestampMs", () => {
    const v1 = { timestampMs: 42000, boxes: [], reviewed: false };
    expect(migrateV1FrameToV2(v1, classDefs).timestampMs).toBe(42000);
  });
});

describe("isDetectReady / isClfReady", () => {
  const detectFrame: VideoTimestampAnnotation = {
    timestampMs: 1000,
    tasks: { detect: { reviewed: true, boxes: [] } },
    updatedAt: ""
  };
  const clfFrame: VideoTimestampAnnotation = {
    timestampMs: 2000,
    tasks: { clf: { reviewed: true, classKey: "car" } },
    updatedAt: ""
  };
  const pending: VideoTimestampAnnotation = {
    timestampMs: 3000,
    tasks: {},
    updatedAt: ""
  };

  it("detect-only is detectReady but not clfReady", () => {
    expect(isDetectReady(detectFrame)).toBe(true);
    expect(isClfReady(detectFrame)).toBe(false);
  });

  it("clf-only is clfReady but not detectReady", () => {
    expect(isDetectReady(clfFrame)).toBe(false);
    expect(isClfReady(clfFrame)).toBe(true);
  });

  it("pending is neither ready", () => {
    expect(isDetectReady(pending)).toBe(false);
    expect(isClfReady(pending)).toBe(false);
  });
});

describe("timestamp with both tasks", () => {
  it("can store detect and clf on the same timestamp", () => {
    const both: VideoTimestampAnnotation = {
      timestampMs: 5000,
      tasks: {
        detect: { reviewed: true, boxes: [{ classKey: "car", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }] },
        clf: { reviewed: true, classKey: "person" }
      },
      updatedAt: ""
    };
    expect(isDetectReady(both)).toBe(true);
    expect(isClfReady(both)).toBe(true);
    expect(detectBoxCount(both)).toBe(1);
  });
});

describe("updateDetectTask / updateClfTask", () => {
  const base: VideoTimestampAnnotation = {
    timestampMs: 1000,
    tasks: { clf: { reviewed: true, classKey: "car" } },
    updatedAt: ""
  };

  it("updateDetectTask does not erase clf task", () => {
    const next = updateDetectTask(base, { reviewed: true, boxes: [] }, "2026-01-01T00:00:00Z");
    expect(next.tasks.clf?.classKey).toBe("car");
    expect(next.tasks.detect?.reviewed).toBe(true);
  });

  it("updateClfTask does not erase detect task", () => {
    const withDetect: VideoTimestampAnnotation = {
      ...base,
      tasks: { ...base.tasks, detect: { reviewed: true, boxes: [] } }
    };
    const next = updateClfTask(withDetect, { classKey: "person" }, "2026-01-01T00:00:00Z");
    expect(next.tasks.detect?.reviewed).toBe(true);
    expect(next.tasks.clf?.classKey).toBe("person");
  });
});

describe("status labels", () => {
  it("detectStatusLabel returns reviewed box count", () => {
    const frame: VideoTimestampAnnotation = {
      timestampMs: 1000,
      tasks: { detect: { reviewed: true, boxes: [{ classKey: "car", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }] } },
      updatedAt: ""
    };
    expect(detectStatusLabel(frame)).toMatch(/1 box/);
  });

  it("clfStatusLabel returns class name when reviewed", () => {
    const frame: VideoTimestampAnnotation = {
      timestampMs: 1000,
      tasks: { clf: { reviewed: true, classKey: "car" } },
      updatedAt: ""
    };
    expect(clfStatusLabel(frame, classDefs)).toMatch(/Car/);
  });
});

describe("normalizeV2Frame", () => {
  it("returns null for non-object input", () => {
    expect(normalizeV2Frame(null)).toBeNull();
    expect(normalizeV2Frame("bad")).toBeNull();
  });

  it("normalizes a valid v2 frame", () => {
    const raw = {
      timestampMs: 3000,
      tasks: {
        detect: { reviewed: true, boxes: [{ classKey: "car", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }] }
      },
      updatedAt: "2026-01-01T00:00:00Z"
    };
    const result = normalizeV2Frame(raw);
    expect(result?.timestampMs).toBe(3000);
    expect(result?.tasks.detect?.boxes).toHaveLength(1);
  });

  it("drops invalid boxes (zero size)", () => {
    const raw = {
      timestampMs: 4000,
      tasks: {
        detect: {
          reviewed: true,
          boxes: [
            { classKey: "car", x: 0.5, y: 0.5, w: 0, h: 0 }, // invalid
            { classKey: "person", x: 0.3, y: 0.3, w: 0.1, h: 0.1 } // valid
          ]
        }
      },
      updatedAt: ""
    };
    const result = normalizeV2Frame(raw);
    expect(result?.tasks.detect?.boxes).toHaveLength(1);
    expect(result?.tasks.detect?.boxes[0].classKey).toBe("person");
  });
});
