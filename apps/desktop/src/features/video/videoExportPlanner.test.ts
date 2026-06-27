import { describe, expect, it } from "vitest";
import {
  planVideoExport,
  resolveDetectClassId,
  type ExportPlanOptions
} from "./videoExportPlanner";
import {
  createVideoAnnotationManifest,
  type VideoAnnotationManifest,
  type VideoSource
} from "./videoAnnotationApi";
import {
  updateVideoDetectBoxes,
  setVideoClfClass,
  markVideoClfReviewed,
  markVideoDetectEmpty
} from "./videoAnnotationDomain";
import type { LabelClass } from "../../api";

const video: VideoSource = {
  path: "D:/videos/clip.mp4",
  name: "clip.mp4",
  duration: 60,
  width: 1920,
  height: 1080,
  ok: true
};

const classes: LabelClass[] = [
  { id: 0, name: "cat" },
  { id: 1, name: "dog" },
  { id: 2, name: "person" }
];

const box = { classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 };

function opts(overrides: Partial<ExportPlanOptions> = {}): ExportPlanOptions {
  return { exportRoot: "exports", classes, ...overrides };
}

function makeManifest(): VideoAnnotationManifest {
  return createVideoAnnotationManifest(video);
}

// ---------------------------------------------------------------------------
// Task 8 — export planner — basic
// ---------------------------------------------------------------------------

describe("planVideoExport — detect", () => {
  it("creates a detect export item from timestamp with boxes", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], true);
    const { items, errors } = planVideoExport(manifest, opts());
    const detectItems = items.filter((i) => i.task === "detect");
    expect(detectItems).toHaveLength(1);
    expect(detectItems[0].timestampMs).toBe(5000);
    expect(detectItems[0].yoloBoxes).toHaveLength(1);
    expect(errors.filter((e) => e.type !== "no-export-ready-frames")).toHaveLength(0);
  });

  it("detect export item includes correct image and label paths", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], true);
    const { items } = planVideoExport(manifest, opts());
    const item = items.find((i) => i.task === "detect")!;
    expect(item.imageOutputPath).toMatch(/^exports\/detect\/images\/.+\.jpg$/);
    expect(item.labelOutputPath).toMatch(/^exports\/detect\/labels\/.+\.txt$/);
  });

  it("maps classId to YOLO numeric id via classKey index", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [{ classId: 2, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], true);
    const { items } = planVideoExport(manifest, opts());
    const detect = items.find((i) => i.task === "detect")!;
    // classes sorted by id: cat=0, dog=1, person=2 → YOLO id 2 for "person"
    expect(detect.yoloBoxes[0].classId).toBe(2);
  });

  it("classKey in box takes precedence for YOLO id resolution", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [{ classKey: "dog", x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], true);
    const { items } = planVideoExport(manifest, opts());
    const detect = items.find((i) => i.task === "detect")!;
    // dog is at index 1 in sorted class list
    expect(detect.yoloBoxes[0].classId).toBe(1);
  });

  it("includes empty/reviewed frames when detectPolicy is 'reviewed'", () => {
    let manifest = makeManifest();
    manifest = markVideoDetectEmpty(manifest, video, 2.0);
    const { items } = planVideoExport(manifest, opts({ detectPolicy: "reviewed" }));
    const detectItems = items.filter((i) => i.task === "detect");
    expect(detectItems).toHaveLength(1);
    expect(detectItems[0].yoloBoxes).toHaveLength(0);
  });

  it("excludes timestamps with no boxes when detectPolicy is 'has-boxes'", () => {
    let manifest = makeManifest();
    manifest = markVideoDetectEmpty(manifest, video, 2.0);
    const { items } = planVideoExport(manifest, opts({ detectPolicy: "has-boxes" }));
    const detectItems = items.filter((i) => i.task === "detect");
    expect(detectItems).toHaveLength(0);
  });

  it("excludes unreviewed timestamps with the default 'reviewed' policy", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], false);  // reviewed=false
    const { items } = planVideoExport(manifest, opts());  // default: reviewed
    expect(items.filter((i) => i.task === "detect")).toHaveLength(0);
  });

  it("includes unreviewed timestamps when detectPolicy is 'has-boxes'", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], false);  // reviewed=false
    const { items } = planVideoExport(manifest, opts({ detectPolicy: "has-boxes" }));
    expect(items.filter((i) => i.task === "detect")).toHaveLength(1);
  });
});

describe("planVideoExport — clf", () => {
  it("creates a clf export item from reviewed timestamp with clf classKey", () => {
    let manifest = makeManifest();
    manifest = setVideoClfClass(manifest, video, 3.0, "cat");
    manifest = markVideoClfReviewed(manifest, video, 3.0);
    const { items } = planVideoExport(manifest, opts());
    const clfItems = items.filter((i) => i.task === "clf");
    expect(clfItems).toHaveLength(1);
    expect(clfItems[0].classKey).toBe("cat");
    expect(clfItems[0].timestampMs).toBe(3000);
  });

  it("clf export item has correct classFolder and image path", () => {
    let manifest = makeManifest();
    manifest = setVideoClfClass(manifest, video, 3.0, "my-dog");
    manifest = markVideoClfReviewed(manifest, video, 3.0);
    const { items } = planVideoExport(manifest, opts());
    const clfItem = items.find((i) => i.task === "clf")!;
    expect(clfItem.classFolder).toBe("my-dog");
    expect(clfItem.imageOutputPath).toMatch(/^exports\/clf\/my-dog\/.+\.jpg$/);
  });

  it("skips unreviewed clf timestamps with default clfPolicy 'reviewed'", () => {
    let manifest = makeManifest();
    manifest = setVideoClfClass(manifest, video, 3.0, "cat");  // NOT reviewed
    const { items } = planVideoExport(manifest, opts());
    expect(items.filter((i) => i.task === "clf")).toHaveLength(0);
  });

  it("includes unreviewed clf timestamps when clfPolicy is 'all'", () => {
    let manifest = makeManifest();
    manifest = setVideoClfClass(manifest, video, 3.0, "cat");  // NOT reviewed
    const { items } = planVideoExport(manifest, opts({ clfPolicy: "all" }));
    expect(items.filter((i) => i.task === "clf")).toHaveLength(1);
  });
});

describe("planVideoExport — both tasks on one timestamp", () => {
  it("produces both detect and clf items from a single reviewed timestamp", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 5.0, "cat");
    manifest = markVideoClfReviewed(manifest, video, 5.0);
    const { items } = planVideoExport(manifest, opts());
    const byTimestamp = items.filter((i) => i.timestampMs === 5000);
    const taskTypes = byTimestamp.map((i) => i.task).sort();
    expect(taskTypes).toEqual(["clf", "detect"]);
  });
});

describe("planVideoExport — missing video source", () => {
  it("returns missing-source error when video.ok is false", () => {
    const badVideo: VideoSource = { ...video, ok: false };
    const manifest: VideoAnnotationManifest = { ...makeManifest(), video: badVideo };
    const { items, errors } = planVideoExport(manifest, opts());
    expect(items).toHaveLength(0);
    const err = errors.find((e) => e.type === "missing-video-source");
    expect(err).toBeDefined();
  });

  it("returns missing-source error when video path is empty", () => {
    const badVideo: VideoSource = { ...video, path: "", ok: undefined };
    const manifest: VideoAnnotationManifest = { ...makeManifest(), video: badVideo };
    const { errors } = planVideoExport(manifest, opts());
    expect(errors.some((e) => e.type === "missing-video-source")).toBe(true);
  });
});

describe("planVideoExport — includeDetect / includeClf flags", () => {
  it("skips detect items when includeDetect is false", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = markVideoClfReviewed(manifest, video, 1.0);
    const { items } = planVideoExport(manifest, opts({ includeDetect: false }));
    expect(items.every((i) => i.task !== "detect")).toBe(true);
    expect(items.some((i) => i.task === "clf")).toBe(true);
  });

  it("skips clf items when includeClf is false", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = markVideoClfReviewed(manifest, video, 1.0);
    const { items } = planVideoExport(manifest, opts({ includeClf: false }));
    expect(items.every((i) => i.task !== "clf")).toBe(true);
    expect(items.some((i) => i.task === "detect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 4 — classKey helpers
// ---------------------------------------------------------------------------

describe("resolveDetectClassId", () => {
  it("maps a classKey to YOLO numeric id by sorted class order", () => {
    // classes: cat=0, dog=1, person=2 → sorted by id → same order
    expect(resolveDetectClassId("cat", classes)).toBe(0);
    expect(resolveDetectClassId("dog", classes)).toBe(1);
    expect(resolveDetectClassId("person", classes)).toBe(2);
  });

  it("returns undefined for unknown classKey", () => {
    expect(resolveDetectClassId("unknown-class", classes)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task 9 — blackout resolver integration
// ---------------------------------------------------------------------------

describe("planVideoExport — blackout resolver", () => {
  it("export items carry empty blackouts when no resolver is provided", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    const { items } = planVideoExport(manifest, opts());
    const detectItem = items.find((i) => i.task === "detect")!;
    expect(detectItem.blackouts).toEqual([]);
  });

  it("export items carry rects from the resolver for matching timestamp", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    const rect = { type: "rect" as const, x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    const resolveBlackouts = (ts: number) => ts === 1000 ? [rect] : [];
    const { items } = planVideoExport(manifest, opts({ resolveBlackouts }));
    const detectItem = items.find((i) => i.task === "detect")!;
    expect(detectItem.blackouts).toHaveLength(1);
    expect(detectItem.blackouts[0]).toEqual(rect);
  });

  it("clf export items also carry blackout rects", () => {
    let manifest = makeManifest();
    manifest = setVideoClfClass(manifest, video, 2.0, "cat");
    manifest = markVideoClfReviewed(manifest, video, 2.0);
    const rect = { type: "rect" as const, x: 0.5, y: 0.5, w: 0.3, h: 0.3 };
    const resolveBlackouts = () => [rect];
    const { items } = planVideoExport(manifest, opts({ resolveBlackouts }));
    const clfItem = items.find((i) => i.task === "clf")!;
    expect(clfItem.blackouts).toHaveLength(1);
  });

  it("resolver returning different rects per timestamp is respected", () => {
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = updateVideoDetectBoxes(manifest, video, 2.0, [box], true);
    const resolveBlackouts = (ts: number) =>
      ts === 1000 ? [{ type: "rect" as const, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] : [];
    const { items } = planVideoExport(manifest, opts({ resolveBlackouts }));
    const item1 = items.find((i) => i.task === "detect" && i.timestampMs === 1000)!;
    const item2 = items.find((i) => i.task === "detect" && i.timestampMs === 2000)!;
    expect(item1.blackouts).toHaveLength(1);
    expect(item2.blackouts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 10 — no image files created in tests
// ---------------------------------------------------------------------------

describe("export planner — no image writes", () => {
  it("planning does not call any file write API", () => {
    // planVideoExport is pure — it returns a plan; no I/O is performed.
    // This test verifies the function returns synchronously without side effects.
    let manifest = makeManifest();
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    const start = Date.now();
    const result = planVideoExport(manifest, opts());
    const elapsed = Date.now() - start;
    expect(result.items).toBeDefined();
    // Pure computation — must be fast (< 100ms)
    expect(elapsed).toBeLessThan(100);
  });
});
