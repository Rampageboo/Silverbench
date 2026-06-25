import { describe, expect, it } from "vitest";
import {
  normalizeVideoAnnotationManifest,
  normalizeVideoAnnotationsRoot,
  videoManifestRelativePath,
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

  it("normalizes unsafe box values from disk", () => {
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

    expect(manifest.frames["1000"].boxes[0]).toEqual({
      classId: 1,
      x: 0.8,
      y: 0.25,
      w: 0.4,
      h: 0.5
    });
    expect(manifest.frames["1000"].reviewed).toBe(true);
  });
});
