import { describe, expect, it } from "vitest";
import { buildExportPlan, planClfExports, planDetectExports } from "./exportPlanner";
import type { VideoTimestampAnnotation } from "./videoAnnotationTaskDomain";
import type { ClassDef } from "./classDomain";

const classDefs: ClassDef[] = [
  { key: "car", name: "Car" },
  { key: "person", name: "Person" },
  { key: "truck", name: "Truck" }
];
const detectClassKeys = ["car", "person", "truck"];

function makeDetectFrame(
  timestampMs: number,
  boxes: Array<{ classKey: string; x: number; y: number; w: number; h: number }>,
  reviewed = true
): VideoTimestampAnnotation {
  return {
    timestampMs,
    tasks: { detect: { reviewed, boxes } },
    updatedAt: "2026-01-01T00:00:00Z"
  };
}

function makeClfFrame(
  timestampMs: number,
  classKey: string,
  reviewed = true
): VideoTimestampAnnotation {
  return {
    timestampMs,
    tasks: { clf: { reviewed, classKey } },
    updatedAt: "2026-01-01T00:00:00Z"
  };
}

function makeBothFrame(
  timestampMs: number,
  boxes: Array<{ classKey: string; x: number; y: number; w: number; h: number }>,
  clfKey: string
): VideoTimestampAnnotation {
  return {
    timestampMs,
    tasks: {
      detect: { reviewed: true, boxes },
      clf: { reviewed: true, classKey: clfKey }
    },
    updatedAt: "2026-01-01T00:00:00Z"
  };
}

describe("planDetectExports", () => {
  it("produces detect image and label output paths for reviewed detect frame", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "1000": makeDetectFrame(1000, [{ classKey: "car", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }])
    };
    const results = planDetectExports("vid1", frames, classDefs, detectClassKeys, "exports/detect");
    expect(results).toHaveLength(1);
    const [sample] = results;
    expect(sample.task).toBe("detect");
    expect(sample.outputImagePath).toContain("images/train");
    expect(sample.outputImagePath).toContain("vid1_1000.jpg");
    expect(sample.outputLabelPath).toContain("labels/train");
    expect(sample.outputLabelPath).toContain("vid1_1000.txt");
    expect(sample.labelLines).toHaveLength(1);
    expect(sample.labelLines[0]).toMatch(/^0 /); // car is id 0
  });

  it("maps classKey to correct YOLO id by detectClassKeys order", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "2000": makeDetectFrame(2000, [{ classKey: "truck", x: 0.3, y: 0.3, w: 0.1, h: 0.1 }])
    };
    const results = planDetectExports("vid1", frames, classDefs, detectClassKeys, "exports/detect");
    expect(results[0].labelLines[0]).toMatch(/^2 /); // truck is id 2
  });

  it("includes empty-box frames with empty label (reviewed empty annotation)", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "3000": { timestampMs: 3000, tasks: { detect: { reviewed: true, empty: true, boxes: [] } }, updatedAt: "" }
    };
    const results = planDetectExports("vid1", frames, classDefs, detectClassKeys, "exports/detect");
    expect(results).toHaveLength(1);
    expect(results[0].labelLines).toHaveLength(0);
  });

  it("excludes unreviewed detect frames", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "4000": makeDetectFrame(4000, [{ classKey: "car", x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], false)
    };
    const results = planDetectExports("vid1", frames, classDefs, detectClassKeys, "exports/detect");
    expect(results).toHaveLength(0);
  });

  it("excludes detect frames disabled for export", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "4500": {
        timestampMs: 4500,
        tasks: { detect: { reviewed: true, enabled: false, boxes: [{ classKey: "car", x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] } },
        updatedAt: ""
      }
    };
    const results = planDetectExports("vid1", frames, classDefs, detectClassKeys, "exports/detect");
    expect(results).toHaveLength(0);
  });

  it("does not require clf data", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "5000": makeDetectFrame(5000, [{ classKey: "person", x: 0.5, y: 0.5, w: 0.1, h: 0.1 }])
    };
    const results = planDetectExports("vid1", frames, classDefs, detectClassKeys, "exports/detect");
    expect(results).toHaveLength(1);
  });
});

describe("planClfExports", () => {
  it("produces clf class folder output path for reviewed clf frame", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "1000": makeClfFrame(1000, "car")
    };
    const results = planClfExports("vid1", frames, classDefs, "exports/clf");
    expect(results).toHaveLength(1);
    const [sample] = results;
    expect(sample.task).toBe("clf");
    expect(sample.outputFolder).toContain("train/Car");
    expect(sample.outputImagePath).toContain("Car/vid1_1000.jpg");
  });

  it("uses class name for folder (not key)", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "2000": makeClfFrame(2000, "person")
    };
    const results = planClfExports("vid1", frames, classDefs, "exports/clf");
    expect(results[0].outputFolder).toMatch(/Person/);
  });

  it("excludes clf frame with no classKey", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "3000": { timestampMs: 3000, tasks: { clf: { reviewed: true } }, updatedAt: "" }
    };
    const results = planClfExports("vid1", frames, classDefs, "exports/clf");
    expect(results).toHaveLength(0);
  });

  it("excludes unreviewed clf frames", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "4000": makeClfFrame(4000, "car", false)
    };
    const results = planClfExports("vid1", frames, classDefs, "exports/clf");
    expect(results).toHaveLength(0);
  });

  it("excludes clf frames disabled for export", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "4500": { timestampMs: 4500, tasks: { clf: { reviewed: true, enabled: false, classKey: "car" } }, updatedAt: "" }
    };
    const results = planClfExports("vid1", frames, classDefs, "exports/clf");
    expect(results).toHaveLength(0);
  });

  it("does not require detect data", () => {
    const frames: Record<string, VideoTimestampAnnotation> = {
      "5000": makeClfFrame(5000, "truck")
    };
    const results = planClfExports("vid1", frames, classDefs, "exports/clf");
    expect(results).toHaveLength(1);
  });
});

describe("buildExportPlan", () => {
  const frames: Record<string, VideoTimestampAnnotation> = {
    "1000": makeBothFrame(1000, [{ classKey: "car", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }], "car"),
    "2000": makeDetectFrame(2000, [{ classKey: "person", x: 0.3, y: 0.4, w: 0.1, h: 0.15 }]),
    "3000": makeClfFrame(3000, "truck")
  };

  it("returns error plan when video source is missing", () => {
    const plan = buildExportPlan({
      videoSourceId: "vid1",
      videoSourceExists: false,
      frames,
      classDefs,
      detectClassKeys,
      detectOutputBase: "exports/detect",
      clfOutputBase: "exports/clf"
    });
    expect(plan.error?.type).toBe("missing-source");
    expect(plan.error?.message).toMatch(/relink required/i);
    expect(plan.samples).toHaveLength(0);
  });

  it("produces samples for both detect and clf tasks from same timestamp", () => {
    const plan = buildExportPlan({
      videoSourceId: "vid1",
      videoSourceExists: true,
      frames,
      classDefs,
      detectClassKeys,
      detectOutputBase: "exports/detect",
      clfOutputBase: "exports/clf"
    });
    expect(plan.error).toBeUndefined();
    const detectSamples = plan.samples.filter((s) => s.task === "detect");
    const clfSamples = plan.samples.filter((s) => s.task === "clf");
    // timestamp 1000 → detect + clf
    // timestamp 2000 → detect only
    // timestamp 3000 → clf only
    expect(detectSamples.map((s) => s.timestampMs)).toEqual(expect.arrayContaining([1000, 2000]));
    expect(clfSamples.map((s) => s.timestampMs)).toEqual(expect.arrayContaining([1000, 3000]));
  });

  it("detect-only timestamp does not produce clf sample", () => {
    const detectOnlyFrames: Record<string, VideoTimestampAnnotation> = {
      "1000": makeDetectFrame(1000, [{ classKey: "car", x: 0.5, y: 0.5, w: 0.1, h: 0.1 }])
    };
    const plan = buildExportPlan({
      videoSourceId: "vid1",
      videoSourceExists: true,
      frames: detectOnlyFrames,
      classDefs,
      detectClassKeys,
      detectOutputBase: "exports/detect",
      clfOutputBase: "exports/clf"
    });
    expect(plan.samples.filter((s) => s.task === "clf")).toHaveLength(0);
    expect(plan.samples.filter((s) => s.task === "detect")).toHaveLength(1);
  });

  it("clf-only timestamp does not produce detect sample", () => {
    const clfOnlyFrames: Record<string, VideoTimestampAnnotation> = {
      "1000": makeClfFrame(1000, "car")
    };
    const plan = buildExportPlan({
      videoSourceId: "vid1",
      videoSourceExists: true,
      frames: clfOnlyFrames,
      classDefs,
      detectClassKeys,
      detectOutputBase: "exports/detect",
      clfOutputBase: "exports/clf"
    });
    expect(plan.samples.filter((s) => s.task === "detect")).toHaveLength(0);
    expect(plan.samples.filter((s) => s.task === "clf")).toHaveLength(1);
  });
});
