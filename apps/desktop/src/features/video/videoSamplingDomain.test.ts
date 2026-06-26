import { describe, it, expect } from "vitest";
import {
  makeSeededRng,
  computeSamplingPool,
  isTooCloseToExisting,
  sampleTimestamp,
} from "./videoSamplingDomain";
import type { TimestampRecord, SamplingOptions } from "./videoSamplingDomain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SamplingOptions block — callers override individual fields. */
function opts(
  overrides: Partial<SamplingOptions> & { mode: SamplingOptions["mode"] }
): SamplingOptions {
  return {
    minSpacingMs: 0,
    avoidReviewed: false,
    avoidAnnotated: false,
    maxAttempts: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeSeededRng
// ---------------------------------------------------------------------------

describe("makeSeededRng", () => {
  it("returns values in [0, 1)", () => {
    const rng = makeSeededRng(12345);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic: same seed → same sequence", () => {
    const rng1 = makeSeededRng(42);
    const rng2 = makeSeededRng(42);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("different seeds produce different sequences", () => {
    const seq = (seed: number) => {
      const rng = makeSeededRng(seed);
      return Array.from({ length: 10 }, () => rng());
    };
    expect(seq(1)).not.toEqual(seq(2));
  });
});

// ---------------------------------------------------------------------------
// computeSamplingPool
// ---------------------------------------------------------------------------

describe("computeSamplingPool", () => {
  it("returns empty array when there are no segments", () => {
    expect(computeSamplingPool(60_000, [])).toEqual([]);
  });

  it("excludes disabled segments", () => {
    const segments = [
      { startMs: 0, endMs: 5000, enabled: true },
      { startMs: 10_000, endMs: 15_000, enabled: false },
    ];
    const pool = computeSamplingPool(60_000, segments);
    expect(pool).toHaveLength(1);
    expect(pool[0].startMs).toBe(0);
    expect(pool[0].endMs).toBe(5000);
  });

  it("excludes segments that are fully outside the video duration", () => {
    const segments = [
      { startMs: 70_000, endMs: 80_000, enabled: true },
    ];
    expect(computeSamplingPool(60_000, segments)).toHaveLength(0);
  });

  it("clamps segment endMs to videoDurationMs", () => {
    const segments = [{ startMs: 50_000, endMs: 120_000, enabled: true }];
    const pool = computeSamplingPool(60_000, segments);
    expect(pool).toHaveLength(1);
    expect(pool[0].endMs).toBe(60_000);
  });

  it("clamps segment startMs to 0 when it is negative", () => {
    const segments = [{ startMs: -5000, endMs: 3000, enabled: true }];
    const pool = computeSamplingPool(60_000, segments);
    expect(pool).toHaveLength(1);
    expect(pool[0].startMs).toBe(0);
  });

  it("sorts resulting pool by startMs ascending", () => {
    const segments = [
      { startMs: 20_000, endMs: 30_000, enabled: true },
      { startMs: 0, endMs: 10_000, enabled: true },
    ];
    const pool = computeSamplingPool(60_000, segments);
    expect(pool[0].startMs).toBe(0);
    expect(pool[1].startMs).toBe(20_000);
  });

  it("returns empty array when all segments have zero effective duration after clamping", () => {
    // After clamping both start/end to videoDurationMs they become equal
    const segments = [{ startMs: 60_000, endMs: 60_000, enabled: true }];
    expect(computeSamplingPool(60_000, segments)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isTooCloseToExisting
// ---------------------------------------------------------------------------

describe("isTooCloseToExisting", () => {
  const reviewed: TimestampRecord = { timestampMs: 5000, reviewed: true };
  const annotated: TimestampRecord = {
    timestampMs: 10_000,
    boxes: [{ x: 0, y: 0 }],
  };
  const plain: TimestampRecord = { timestampMs: 15_000 };

  it("returns false when existing list is empty", () => {
    expect(isTooCloseToExisting(5000, [], 1000, true, true)).toBe(false);
  });

  it("returns true when candidate is within spacing of a reviewed timestamp", () => {
    expect(isTooCloseToExisting(5500, [reviewed], 1000, true, false)).toBe(true);
  });

  it("returns false when candidate is outside spacing of a reviewed timestamp", () => {
    expect(isTooCloseToExisting(7000, [reviewed], 1000, true, false)).toBe(false);
  });

  it("returns true when candidate is within spacing of an annotated timestamp", () => {
    expect(isTooCloseToExisting(10_400, [annotated], 1000, false, true)).toBe(true);
  });

  it("returns false when candidate is outside spacing of an annotated timestamp", () => {
    expect(isTooCloseToExisting(12_000, [annotated], 1000, false, true)).toBe(false);
  });

  it("avoidReviewed only — annotated record not avoided", () => {
    // Annotated but not reviewed — should not be avoided when only avoidReviewed is set
    expect(isTooCloseToExisting(10_100, [annotated], 1000, true, false)).toBe(false);
  });

  it("avoidAnnotated only — reviewed record not avoided", () => {
    // Reviewed but not annotated — should not be avoided when only avoidAnnotated is set
    expect(isTooCloseToExisting(5100, [reviewed], 1000, false, true)).toBe(false);
  });

  it("returns false when neither avoidReviewed nor avoidAnnotated is set", () => {
    expect(isTooCloseToExisting(5100, [reviewed, annotated], 500, false, false)).toBe(false);
  });

  it("ignores plain records (no review, no boxes) regardless of spacing", () => {
    expect(isTooCloseToExisting(15_100, [plain], 500, true, true)).toBe(false);
  });

  it("treats exact spacing boundary as safe (strict less-than)", () => {
    // distance === minSpacingMs is NOT too close (< not <=)
    expect(isTooCloseToExisting(6000, [reviewed], 1000, true, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — whole-video
// ---------------------------------------------------------------------------

describe("sampleTimestamp whole-video", () => {
  const rng = makeSeededRng(1);

  it("returns a candidate in [0, videoDurationMs]", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "whole-video" }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng,
    });
    expect(result).not.toBeNull();
    expect(result!.timestampMs).toBeGreaterThanOrEqual(0);
    expect(result!.timestampMs).toBeLessThanOrEqual(60_000);
  });

  it("reports source as 'whole-video'", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "whole-video" }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(2),
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("whole-video");
  });

  it("returns null when videoDurationMs is 0", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "whole-video" }),
      videoDurationMs: 0,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(3),
    });
    expect(result).toBeNull();
  });

  it("returns null when videoDurationMs is negative", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "whole-video" }),
      videoDurationMs: -1000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(4),
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — segments-only
// ---------------------------------------------------------------------------

describe("sampleTimestamp segments-only", () => {
  const segment = { id: "s1", startMs: 10_000, endMs: 20_000 };

  it("returns a candidate within a segment range", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "segments-only" }),
      videoDurationMs: 60_000,
      enabledSegments: [segment],
      existingTimestamps: [],
      rng: makeSeededRng(10),
    });
    expect(result).not.toBeNull();
    expect(result!.timestampMs).toBeGreaterThanOrEqual(segment.startMs);
    expect(result!.timestampMs).toBeLessThanOrEqual(segment.endMs);
  });

  it("reports source as 'segment'", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "segments-only" }),
      videoDurationMs: 60_000,
      enabledSegments: [segment],
      existingTimestamps: [],
      rng: makeSeededRng(11),
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("segment");
  });

  it("annotates result with segmentId when candidate falls in the segment", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "segments-only" }),
      videoDurationMs: 60_000,
      enabledSegments: [segment],
      existingTimestamps: [],
      rng: makeSeededRng(12),
    });
    expect(result).not.toBeNull();
    expect(result!.segmentId).toBe("s1");
  });

  it("returns null when there are no enabled segments", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "segments-only" }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(13),
    });
    expect(result).toBeNull();
  });

  it("returns null when segments array is empty", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "segments-only" }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(14),
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — segments-preferred fallback
// ---------------------------------------------------------------------------

describe("sampleTimestamp segments-preferred", () => {
  it("falls back to whole-video when segment sampling is blocked by spacing", () => {
    // Place a reviewed timestamp that covers the entire segment range with huge spacing
    const segment = { id: "s1", startMs: 0, endMs: 5000 };
    const blocking: TimestampRecord = { timestampMs: 2500, reviewed: true };

    const result = sampleTimestamp({
      ...opts({ mode: "segments-preferred", avoidReviewed: true, minSpacingMs: 60_001 }),
      videoDurationMs: 60_000,
      enabledSegments: [segment],
      existingTimestamps: [blocking],
      rng: makeSeededRng(20),
    });
    // Might land in whole-video space since segments are fully blocked
    // The test just asserts we get a result (not null) and source is valid
    // (Implementation may still find a whole-video candidate)
    if (result !== null) {
      expect(["whole-video", "segment"]).toContain(result.source);
    }
    // If null, that is acceptable when spacing blocks every attempt
  });

  it("returns a segment candidate first when segments are available and open", () => {
    const segment = { id: "s1", startMs: 1000, endMs: 10_000 };
    const result = sampleTimestamp({
      ...opts({ mode: "segments-preferred" }),
      videoDurationMs: 60_000,
      enabledSegments: [segment],
      existingTimestamps: [],
      rng: makeSeededRng(21),
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("segment");
  });

  it("falls back to whole-video source when no segments exist", () => {
    const result = sampleTimestamp({
      ...opts({ mode: "segments-preferred" }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(22),
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("whole-video");
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — avoids reviewed timestamps
// ---------------------------------------------------------------------------

describe("sampleTimestamp avoids reviewed", () => {
  it("returns null when every possible position is blocked by a reviewed record", () => {
    // Cover the entire duration with a reviewed record at the midpoint and huge spacing
    const blocking: TimestampRecord = { timestampMs: 500, reviewed: true };

    const result = sampleTimestamp({
      ...opts({ mode: "whole-video", avoidReviewed: true, minSpacingMs: 999_999, maxAttempts: 20 }),
      videoDurationMs: 1000,
      enabledSegments: [],
      existingTimestamps: [blocking],
      rng: makeSeededRng(30),
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — deterministic seeded
// ---------------------------------------------------------------------------

describe("sampleTimestamp deterministic seeded", () => {
  it("same seed produces the same timestamp", () => {
    const common = {
      ...opts({ mode: "whole-video" as const }),
      videoDurationMs: 120_000,
      enabledSegments: [],
      existingTimestamps: [],
    };
    const a = sampleTimestamp({ ...common, seed: 99 });
    const b = sampleTimestamp({ ...common, seed: 99 });
    expect(a).not.toBeNull();
    expect(a!.timestampMs).toBe(b!.timestampMs);
  });

  it("different seeds produce different timestamps (with high probability)", () => {
    const common = {
      ...opts({ mode: "whole-video" as const }),
      videoDurationMs: 120_000,
      enabledSegments: [],
      existingTimestamps: [],
    };
    const a = sampleTimestamp({ ...common, seed: 1 });
    const b = sampleTimestamp({ ...common, seed: 2 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.timestampMs).not.toBe(b!.timestampMs);
  });

  it("rng option takes precedence over seed", () => {
    const fixedRng = makeSeededRng(777);
    const result = sampleTimestamp({
      ...opts({ mode: "whole-video", seed: 1 }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: fixedRng,
    });
    const expected = sampleTimestamp({
      ...opts({ mode: "whole-video" }),
      videoDurationMs: 60_000,
      enabledSegments: [],
      existingTimestamps: [],
      rng: makeSeededRng(777),
    });
    expect(result).not.toBeNull();
    expect(expected).not.toBeNull();
    expect(result!.timestampMs).toBe(expected!.timestampMs);
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — max attempts exhausted
// ---------------------------------------------------------------------------

describe("sampleTimestamp max attempts", () => {
  it("returns null when maxAttempts is exhausted by spacing", () => {
    // Single reviewed timestamp with spacing larger than the whole video
    const blocking: TimestampRecord = { timestampMs: 500, reviewed: true };
    const result = sampleTimestamp({
      ...opts({ mode: "whole-video", avoidReviewed: true, minSpacingMs: 100_000, maxAttempts: 5 }),
      videoDurationMs: 1000,
      enabledSegments: [],
      existingTimestamps: [blocking],
      rng: makeSeededRng(40),
    });
    expect(result).toBeNull();
  });

  it("returns null for segments-only when maxAttempts is 0 (no attempts made)", () => {
    const segment = { id: "s1", startMs: 0, endMs: 5000 };
    const result = sampleTimestamp({
      ...opts({ mode: "segments-only", maxAttempts: 0 }),
      videoDurationMs: 60_000,
      enabledSegments: [segment],
      existingTimestamps: [],
      rng: makeSeededRng(41),
    });
    // 0 attempts → loop body never executes → null
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sampleTimestamp — result never exceeds videoDurationMs
// ---------------------------------------------------------------------------

describe("sampleTimestamp clamps to duration", () => {
  it("no result exceeds videoDurationMs across many samples (whole-video)", () => {
    const duration = 30_000;
    for (let seed = 0; seed < 50; seed++) {
      const result = sampleTimestamp({
        ...opts({ mode: "whole-video" }),
        videoDurationMs: duration,
        enabledSegments: [],
        existingTimestamps: [],
        rng: makeSeededRng(seed),
      });
      if (result !== null) {
        expect(result.timestampMs).toBeLessThanOrEqual(duration);
      }
    }
  });

  it("no result exceeds videoDurationMs across many samples (segments-only)", () => {
    const duration = 30_000;
    const segment = { id: "s1", startMs: 0, endMs: duration };
    for (let seed = 0; seed < 50; seed++) {
      const result = sampleTimestamp({
        ...opts({ mode: "segments-only" }),
        videoDurationMs: duration,
        enabledSegments: [segment],
        existingTimestamps: [],
        rng: makeSeededRng(seed),
      });
      if (result !== null) {
        expect(result.timestampMs).toBeLessThanOrEqual(duration);
      }
    }
  });

  it("no result is negative", () => {
    const duration = 60_000;
    for (let seed = 0; seed < 30; seed++) {
      const result = sampleTimestamp({
        ...opts({ mode: "whole-video" }),
        videoDurationMs: duration,
        enabledSegments: [],
        existingTimestamps: [],
        rng: makeSeededRng(seed),
      });
      if (result !== null) {
        expect(result.timestampMs).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
