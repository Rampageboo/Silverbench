import { describe, expect, it } from "vitest";
import {
  normalizeVideoAnnotationManifest,
  normalizeVideoAnnotationsRoot,
  videoManifestRelativePath,
  createVideoAnnotationManifest,
  type VideoSource
} from "./videoAnnotationApi";

const video: VideoSource = {
  path: "D:/captures/session 1.mp4",
  name: "session 1.mp4",
  duration: 20,
  width: 1280,
  height: 720
};

describe("video annotation persistence", () => {
  it("keeps storage inside the workspace", () => {
    expect(normalizeVideoAnnotationsRoot("workspace/custom\\labels/")).toBe("workspace/custom/labels");
    expect(() => normalizeVideoAnnotationsRoot("../outside")).toThrow(/inside the workspace/i);
  });

  it("creates a deterministic manifest path without screenshot output", () => {
    const first = videoManifestRelativePath(video, "workspace/video_annotations");
    const second = videoManifestRelativePath(video, "workspace/video_annotations");
    expect(first).toBe(second);
    expect(first).toMatch(/^workspace\/video_annotations\/session_1-[a-f0-9]{8}\.json$/);
  });

  it("createVideoAnnotationManifest produces a v2 manifest", () => {
    const manifest = createVideoAnnotationManifest(video);
    expect(manifest.version).toBe(2);
    expect(manifest.frames).toEqual({});
  });

  // ---------------------------------------------------------------------------
  // V1 migration
  // ---------------------------------------------------------------------------

  it("migrates v1 manifest to v2 task-layer format", () => {
    const manifest = normalizeVideoAnnotationManifest(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        frames: {
          "1000": {
            timestampMs: 1000,
            boxes: [{ classId: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.3 }],
            reviewed: true,
            updatedAt: "2026-01-01T00:00:00Z"
          }
        }
      },
      video
    );

    expect(manifest.version).toBe(2);
    const frame = manifest.frames["1000"];
    expect(frame).toBeDefined();
    expect(frame.tasks.detect).toBeDefined();
    expect(frame.tasks.detect!.boxes).toHaveLength(1);
    expect(frame.tasks.detect!.boxes[0].classId).toBe(1);
    expect(frame.tasks.detect!.reviewed).toBe(true);
    expect(frame.tasks.clf).toBeUndefined();
  });

  it("migrates v1 empty+reviewed frame to detect.empty = true", () => {
    const manifest = normalizeVideoAnnotationManifest(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        frames: {
          "2000": {
            timestampMs: 2000,
            boxes: [],
            reviewed: true,
            updatedAt: "2026-01-01T00:00:00Z"
          }
        }
      },
      video
    );

    const frame = manifest.frames["2000"];
    expect(frame.tasks.detect!.reviewed).toBe(true);
    expect(frame.tasks.detect!.empty).toBe(true);
    expect(frame.tasks.detect!.boxes).toHaveLength(0);
  });

  it("normalizes unsafe box values from v1 disk data", () => {
    const manifest = normalizeVideoAnnotationManifest(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        frames: {
          "1000": {
            timestampMs: 1000,
            boxes: [{ classId: 1.9, x: 4, y: -2, w: 0.4, h: 0.5 }],
            reviewed: false
          }
        }
      },
      video
    );

    const box = manifest.frames["1000"].tasks.detect!.boxes[0];
    expect(box.classId).toBe(1);
    expect(box.x).toBe(0.8);
    expect(box.y).toBe(0.25);
    expect(box.w).toBe(0.4);
    expect(box.h).toBe(0.5);
    // reviewed = false but boxes.length > 0 → reviewed = true in migration
    expect(manifest.frames["1000"].tasks.detect!.reviewed).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // V2 round-trip
  // ---------------------------------------------------------------------------

  it("normalizes a v2 manifest with detect and clf tasks", () => {
    const manifest = normalizeVideoAnnotationManifest(
      {
        version: 2,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        frames: {
          "3000": {
            timestampMs: 3000,
            time: 3,
            tasks: {
              detect: { boxes: [{ classId: 0, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], reviewed: true },
              clf: { classKey: "person", reviewed: false }
            },
            updatedAt: "2026-01-01T00:00:00Z"
          }
        }
      },
      video
    );

    expect(manifest.version).toBe(2);
    const frame = manifest.frames["3000"];
    expect(frame.tasks.detect!.boxes).toHaveLength(1);
    expect(frame.tasks.detect!.reviewed).toBe(true);
    expect(frame.tasks.clf!.classKey).toBe("person");
    expect(frame.tasks.clf!.reviewed).toBe(false);
  });

  it("rejects unsupported manifest version", () => {
    expect(() =>
      normalizeVideoAnnotationManifest({ version: 99 }, video)
    ).toThrow(/unsupported.*version/i);
  });
});
