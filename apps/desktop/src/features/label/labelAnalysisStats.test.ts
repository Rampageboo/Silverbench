import { describe, expect, it } from "vitest";
import type { VideoAnnotationSession } from "../video/useVideoAnnotationSession";
import {
  combineAnalysisStats,
  sortedBuckets,
  videoAnalysisStats,
  type AnalysisStats,
} from "./labelAnalysisStats";

function sessionWith(overrides: Partial<VideoAnnotationSession>): VideoAnnotationSession {
  return {
    videos: [],
    classes: [],
    clfClassOptions: [],
    manifest: null,
    ...overrides,
  } as VideoAnnotationSession;
}

function statsWith(overrides: Partial<AnalysisStats>): AnalysisStats {
  return {
    totalMedia: 0,
    detectSamples: 0,
    detectHits: 0,
    clfLabels: 0,
    proposals: 0,
    reviewed: 0,
    junk: 0,
    detectClasses: [],
    clfClasses: [],
    detectPoints: [],
    ...overrides,
  };
}

describe("labelAnalysisStats", () => {
  it("sorts class buckets by descending count before name", () => {
    const buckets = new Map([
      ["map", { key: "map", name: "Map", count: 2 }],
      ["chat", { key: "chat", name: "Chat", count: 5 }],
      ["battle", { key: "battle", name: "Battle", count: 5 }],
    ]);

    expect(sortedBuckets(buckets).map((bucket) => bucket.name)).toEqual(["Battle", "Chat", "Map"]);
  });

  it("counts video detect, clf, proposal, reviewed, and heatmap source data", () => {
    const stats = videoAnalysisStats(
      sessionWith({
        videos: [{ path: "video.mp4", name: "video.mp4", duration: 10, width: 1920, height: 1080 }],
        classes: [
          { id: 4, name: "Teleport" },
          { id: 6, name: "ChatBox" },
        ],
        clfClassOptions: [
          { key: "checkin2", name: "CheckIn2" },
          { key: "chat", name: "Chat" },
        ],
        manifest: {
          version: 2,
          video: { path: "video.mp4", name: "video.mp4", duration: 10, width: 1920, height: 1080 },
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          frames: {
            "0": {
              timestampMs: 0,
              time: 0,
              updatedAt: "2026-07-01T00:00:00.000Z",
              tasks: {
                detect: {
                  reviewed: true,
                  boxes: [
                    { classId: 4, x: 0.5, y: 0.25, w: 0.2, h: 0.1 },
                    { classKey: "6", classId: 6, x: 2, y: -1, w: 0.5, h: 0.5 },
                  ],
                  proposals: [
                    {
                      id: "proposal-1",
                      classId: 4,
                      x: 0.5,
                      y: 0.5,
                      w: 0.2,
                      h: 0.2,
                      confidence: 0.6,
                      createdAt: "2026-07-01T00:00:00.000Z",
                    },
                  ],
                },
                clf: { reviewed: false, classKey: "checkin2" },
              },
            },
            "1000": {
              timestampMs: 1000,
              time: 1,
              updatedAt: "2026-07-01T00:00:00.000Z",
              tasks: {
                detect: { reviewed: false, empty: true, boxes: [] },
                clf: { reviewed: true, classKey: "chat" },
              },
            },
          },
        },
      })
    );

    expect(stats.totalMedia).toBe(1);
    expect(stats.detectSamples).toBe(2);
    expect(stats.detectHits).toBe(2);
    expect(stats.proposals).toBe(1);
    expect(stats.clfLabels).toBe(2);
    expect(stats.reviewed).toBe(2);
    expect(stats.detectClasses).toEqual([
      { key: "6", name: "ChatBox", count: 1 },
      { key: "4", name: "Teleport", count: 1 },
    ]);
    expect(stats.clfClasses).toEqual([
      { key: "chat", name: "Chat", count: 1 },
      { key: "checkin2", name: "CheckIn2", count: 1 },
    ]);
    expect(stats.detectPoints).toEqual([
      { classKey: "4", className: "Teleport", x: 0.5, y: 0.25, area: 0.020000000000000004 },
      { classKey: "6", className: "ChatBox", x: 1, y: 0, area: 0.25 },
    ]);
  });

  it("combines stats without mutating source buckets", () => {
    const left = statsWith({
      totalMedia: 2,
      detectSamples: 1,
      detectClasses: [{ key: "4", name: "Teleport", count: 3 }],
      detectPoints: [{ classKey: "4", className: "Teleport", x: 0.1, y: 0.2, area: 0.3 }],
    });
    const right = statsWith({
      totalMedia: 3,
      detectSamples: 2,
      detectClasses: [
        { key: "4", name: "Teleport", count: 2 },
        { key: "6", name: "ChatBox", count: 7 },
      ],
      detectPoints: [{ classKey: "6", className: "ChatBox", x: 0.4, y: 0.5, area: 0.6 }],
    });

    const combined = combineAnalysisStats(left, right);

    expect(combined.totalMedia).toBe(5);
    expect(combined.detectSamples).toBe(3);
    expect(combined.detectClasses).toEqual([
      { key: "6", name: "ChatBox", count: 7 },
      { key: "4", name: "Teleport", count: 5 },
    ]);
    expect(combined.detectPoints).toEqual([...left.detectPoints, ...right.detectPoints]);
    expect(left.detectClasses).toEqual([{ key: "4", name: "Teleport", count: 3 }]);
  });
});
