import { describe, it, expect } from "vitest";
import {
  normalizeVideoSegment,
  normalizeVideoSegmentManifest,
  videoSegmentManifestPath,
  createVideoSegment,
} from "./videoSegmentDomain";

// ---------------------------------------------------------------------------
// normalizeVideoSegment
// ---------------------------------------------------------------------------

describe("normalizeVideoSegment", () => {
  const duration = 60_000;

  it("returns a valid segment unchanged (within bounds)", () => {
    const raw = {
      id: "seg-1",
      videoPath: "/videos/clip.mp4",
      startMs: 1000,
      endMs: 5000,
      label: "intro",
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const result = normalizeVideoSegment(raw, duration);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("seg-1");
    expect(result!.startMs).toBe(1000);
    expect(result!.endMs).toBe(5000);
    expect(result!.label).toBe("intro");
    expect(result!.enabled).toBe(true);
  });

  it("clamps startMs and endMs to [0, videoDurationMs]", () => {
    const raw = {
      id: "seg-clamp",
      videoPath: "/v.mp4",
      startMs: -500,
      endMs: 999_999,
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const result = normalizeVideoSegment(raw, duration);
    expect(result).not.toBeNull();
    expect(result!.startMs).toBe(0);
    expect(result!.endMs).toBe(duration);
  });

  it("rejects a zero-length segment after clamping", () => {
    const raw = {
      id: "seg-zero",
      videoPath: "/v.mp4",
      startMs: 5000,
      endMs: 5000,
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(normalizeVideoSegment(raw, duration)).toBeNull();
  });

  it("rejects a segment where endMs < startMs (negative duration)", () => {
    const raw = {
      id: "seg-neg",
      videoPath: "/v.mp4",
      startMs: 8000,
      endMs: 3000,
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(normalizeVideoSegment(raw, duration)).toBeNull();
  });

  it("rejects a segment with an empty id", () => {
    const raw = {
      id: "   ",
      videoPath: "/v.mp4",
      startMs: 0,
      endMs: 1000,
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(normalizeVideoSegment(raw, duration)).toBeNull();
  });

  it("rejects a segment with a missing id field", () => {
    const raw = {
      videoPath: "/v.mp4",
      startMs: 0,
      endMs: 1000,
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    expect(normalizeVideoSegment(raw, duration)).toBeNull();
  });

  it("rejects null input", () => {
    expect(normalizeVideoSegment(null, duration)).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(normalizeVideoSegment("bad", duration)).toBeNull();
    expect(normalizeVideoSegment(42, duration)).toBeNull();
  });

  it("defaults enabled to true when the field is absent", () => {
    const raw = {
      id: "seg-no-enabled",
      videoPath: "/v.mp4",
      startMs: 0,
      endMs: 1000,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const result = normalizeVideoSegment(raw, duration);
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
  });

  it("falls back to epoch string when createdAt is missing", () => {
    const raw = {
      id: "seg-dates",
      videoPath: "/v.mp4",
      startMs: 0,
      endMs: 1000,
      enabled: true,
    };
    const result = normalizeVideoSegment(raw, duration);
    expect(result).not.toBeNull();
    expect(result!.createdAt).toBe(new Date(0).toISOString());
    expect(result!.updatedAt).toBe(new Date(0).toISOString());
  });

  it("strips label to undefined when it is blank whitespace", () => {
    const raw = {
      id: "seg-blank-label",
      videoPath: "/v.mp4",
      startMs: 0,
      endMs: 1000,
      label: "   ",
      enabled: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const result = normalizeVideoSegment(raw, duration);
    expect(result).not.toBeNull();
    expect(result!.label).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeVideoSegmentManifest
// ---------------------------------------------------------------------------

describe("normalizeVideoSegmentManifest", () => {
  const validManifest = {
    version: 1 as const,
    videoPath: "/videos/clip.mp4",
    videoName: "clip.mp4",
    videoDurationMs: 120_000,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    segments: [
      {
        id: "s1",
        videoPath: "/videos/clip.mp4",
        startMs: 0,
        endMs: 10_000,
        enabled: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    ],
  };

  it("returns a valid manifest with all fields intact", () => {
    const result = normalizeVideoSegmentManifest(validManifest);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.videoPath).toBe("/videos/clip.mp4");
    expect(result!.videoDurationMs).toBe(120_000);
    expect(result!.segments).toHaveLength(1);
    expect(result!.segments[0].id).toBe("s1");
  });

  it("returns null when version is not 1", () => {
    expect(normalizeVideoSegmentManifest({ ...validManifest, version: 2 })).toBeNull();
    expect(normalizeVideoSegmentManifest({ ...validManifest, version: "1" })).toBeNull();
    expect(normalizeVideoSegmentManifest({ ...validManifest, version: undefined })).toBeNull();
  });

  it("returns a manifest with an empty segments array when segments is missing", () => {
    const raw = { ...validManifest, segments: undefined };
    const result = normalizeVideoSegmentManifest(raw);
    expect(result).not.toBeNull();
    expect(result!.segments).toEqual([]);
  });

  it("returns a manifest with an empty segments array when segments is []", () => {
    const result = normalizeVideoSegmentManifest({ ...validManifest, segments: [] });
    expect(result).not.toBeNull();
    expect(result!.segments).toHaveLength(0);
  });

  it("silently drops corrupt segments and keeps valid ones", () => {
    const raw = {
      ...validManifest,
      segments: [
        validManifest.segments[0],
        // zero-length segment — should be dropped
        {
          id: "bad",
          videoPath: "/videos/clip.mp4",
          startMs: 5000,
          endMs: 5000,
          enabled: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        // missing id — should be dropped
        {
          videoPath: "/videos/clip.mp4",
          startMs: 1000,
          endMs: 2000,
          enabled: true,
        },
      ],
    };
    const result = normalizeVideoSegmentManifest(raw);
    expect(result).not.toBeNull();
    expect(result!.segments).toHaveLength(1);
    expect(result!.segments[0].id).toBe("s1");
  });

  it("returns null for null input", () => {
    expect(normalizeVideoSegmentManifest(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(normalizeVideoSegmentManifest("bad")).toBeNull();
    expect(normalizeVideoSegmentManifest(123)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// videoSegmentManifestPath
// ---------------------------------------------------------------------------

describe("videoSegmentManifestPath", () => {
  it("returns a deterministic path for the same videoPath", () => {
    const path = "/videos/my-clip.mp4";
    expect(videoSegmentManifestPath(path)).toBe(videoSegmentManifestPath(path));
  });

  it("returns different paths for different videoPath values", () => {
    const a = videoSegmentManifestPath("/videos/a.mp4");
    const b = videoSegmentManifestPath("/videos/b.mp4");
    expect(a).not.toBe(b);
  });

  it("path does not contain '..'", () => {
    const result = videoSegmentManifestPath("/some/../tricky/../../path/video.mp4");
    expect(result).not.toContain("..");
  });

  it("names the file after the video file under labels/segments", () => {
    expect(videoSegmentManifestPath("/videos/my clip (2024)!!.mp4")).toBe("labels/segments/my clip (2024)!!.mp4.json");
  });

  it("handles Windows-style backslash separators", () => {
    expect(videoSegmentManifestPath("C:\\Users\\user\\Videos\\clip.mp4")).toBe("labels/segments/clip.mp4.json");
  });

  it("is the same for a workspace-relative and an absolute path to the same media file", () => {
    expect(videoSegmentManifestPath("media/clip.mp4")).toBe(videoSegmentManifestPath("D:/ws/media/clip.mp4"));
  });
});

// ---------------------------------------------------------------------------
// createVideoSegment
// ---------------------------------------------------------------------------

describe("createVideoSegment", () => {
  it("creates a segment with a non-empty id", () => {
    const seg = createVideoSegment("/v.mp4", 0, 5000, 60_000);
    expect(typeof seg.id).toBe("string");
    expect(seg.id.length).toBeGreaterThan(0);
  });

  it("creates a segment that is enabled by default", () => {
    const seg = createVideoSegment("/v.mp4", 0, 5000, 60_000);
    expect(seg.enabled).toBe(true);
  });

  it("sets createdAt and updatedAt to matching ISO strings", () => {
    const before = new Date().toISOString();
    const seg = createVideoSegment("/v.mp4", 1000, 3000, 60_000);
    const after = new Date().toISOString();
    expect(seg.createdAt >= before).toBe(true);
    expect(seg.createdAt <= after).toBe(true);
    expect(seg.createdAt).toBe(seg.updatedAt);
  });

  it("preserves videoPath", () => {
    const seg = createVideoSegment("/my/video.mp4", 0, 1000, 60_000);
    expect(seg.videoPath).toBe("/my/video.mp4");
  });

  it("clamps startMs below 0 to 0", () => {
    const seg = createVideoSegment("/v.mp4", -500, 1000, 60_000);
    expect(seg.startMs).toBe(0);
  });

  it("clamps endMs above videoDurationMs", () => {
    const seg = createVideoSegment("/v.mp4", 0, 999_999, 60_000);
    expect(seg.endMs).toBe(60_000);
  });

  it("rounds fractional millisecond values", () => {
    const seg = createVideoSegment("/v.mp4", 100.7, 200.3, 60_000);
    expect(Number.isInteger(seg.startMs)).toBe(true);
    expect(Number.isInteger(seg.endMs)).toBe(true);
  });

  it("stores an optional label when provided", () => {
    const seg = createVideoSegment("/v.mp4", 0, 1000, 60_000, "  my label  ");
    expect(seg.label).toBe("my label");
  });

  it("leaves label undefined when not provided", () => {
    const seg = createVideoSegment("/v.mp4", 0, 1000, 60_000);
    expect(seg.label).toBeUndefined();
  });

  it("leaves label undefined when label is blank whitespace", () => {
    const seg = createVideoSegment("/v.mp4", 0, 1000, 60_000, "   ");
    expect(seg.label).toBeUndefined();
  });

  it("two calls produce different ids", () => {
    const a = createVideoSegment("/v.mp4", 0, 1000, 60_000);
    const b = createVideoSegment("/v.mp4", 0, 1000, 60_000);
    expect(a.id).not.toBe(b.id);
  });
});
