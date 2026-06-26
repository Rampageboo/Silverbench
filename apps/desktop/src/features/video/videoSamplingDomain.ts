export type SamplingMode = "whole-video" | "segments-only" | "segments-preferred";

export type SamplingOptions = {
  mode: SamplingMode;
  minSpacingMs: number;
  avoidReviewed: boolean;
  avoidAnnotated: boolean;
  maxAttempts: number;
  seed?: number;
};

export type SampleCandidate = {
  timestampMs: number;
  source: "whole-video" | "segment";
  segmentId?: string;
};

export type Rng = () => number;

export type TimestampRecord = {
  timestampMs: number;
  reviewed?: boolean;
  boxes?: unknown[];
};

/**
 * mulberry32 seeded PRNG — fast, deterministic, good distribution.
 * Returns a function that produces floats in [0, 1).
 */
export function makeSeededRng(seed: number): Rng {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Returns enabled segments clamped to [0, videoDurationMs], sorted by startMs.
 * Segments that are fully outside the video duration are excluded.
 */
export function computeSamplingPool(
  videoDurationMs: number,
  segments: Array<{ startMs: number; endMs: number; enabled: boolean }>
): Array<{ startMs: number; endMs: number }> {
  return segments
    .filter((seg) => seg.enabled)
    .map((seg) => ({
      startMs: Math.max(0, seg.startMs),
      endMs: Math.min(videoDurationMs, seg.endMs)
    }))
    .filter((seg) => seg.startMs < seg.endMs)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Returns true if candidateMs is within minSpacingMs of any existing timestamp
 * that matches the avoidReviewed / avoidAnnotated criteria.
 */
export function isTooCloseToExisting(
  candidateMs: number,
  existing: TimestampRecord[],
  minSpacingMs: number,
  avoidReviewed: boolean,
  avoidAnnotated: boolean
): boolean {
  for (const record of existing) {
    const shouldAvoid =
      (avoidReviewed && record.reviewed === true) ||
      (avoidAnnotated && Array.isArray(record.boxes) && record.boxes.length > 0);
    if (shouldAvoid && Math.abs(candidateMs - record.timestampMs) < minSpacingMs) {
      return true;
    }
  }
  return false;
}

type EnabledSegment = { id: string; startMs: number; endMs: number };

type SampleTimestampInput = SamplingOptions & {
  videoDurationMs: number;
  enabledSegments: EnabledSegment[];
  existingTimestamps: TimestampRecord[];
  rng?: Rng;
};

/**
 * Picks a random segment weighted by duration using the provided RNG.
 * Returns null if the pool is empty.
 */
function pickWeightedSegment(
  pool: Array<{ startMs: number; endMs: number }>,
  rng: Rng
): { startMs: number; endMs: number } | null {
  if (pool.length === 0) return null;
  const totalDuration = pool.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
  if (totalDuration <= 0) return null;
  let target = rng() * totalDuration;
  for (const seg of pool) {
    target -= seg.endMs - seg.startMs;
    if (target <= 0) return seg;
  }
  return pool[pool.length - 1];
}

/**
 * Sample a single timestamp from segment space, returning a SampleCandidate
 * annotated with its source segment id (if the original enabledSegments list
 * provides one).
 */
function sampleFromSegments(
  enabledSegments: EnabledSegment[],
  pool: Array<{ startMs: number; endMs: number }>,
  existingTimestamps: TimestampRecord[],
  minSpacingMs: number,
  avoidReviewed: boolean,
  avoidAnnotated: boolean,
  attempts: number,
  rng: Rng
): SampleCandidate | null {
  for (let i = 0; i < attempts; i++) {
    const seg = pickWeightedSegment(pool, rng);
    if (!seg) return null;
    const range = seg.endMs - seg.startMs;
    const candidateMs = Math.round(seg.startMs + rng() * range);
    if (
      !isTooCloseToExisting(candidateMs, existingTimestamps, minSpacingMs, avoidReviewed, avoidAnnotated)
    ) {
      // Find which original segment this maps to for the id
      const source = enabledSegments.find(
        (s) => s.startMs <= candidateMs && candidateMs <= s.endMs
      );
      return {
        timestampMs: candidateMs,
        source: "segment",
        segmentId: source?.id
      };
    }
  }
  return null;
}

/**
 * Sample a single timestamp from the whole video range [0, videoDurationMs].
 */
function sampleFromWholeVideo(
  videoDurationMs: number,
  existingTimestamps: TimestampRecord[],
  minSpacingMs: number,
  avoidReviewed: boolean,
  avoidAnnotated: boolean,
  attempts: number,
  rng: Rng
): SampleCandidate | null {
  for (let i = 0; i < attempts; i++) {
    const candidateMs = Math.round(rng() * videoDurationMs);
    if (
      !isTooCloseToExisting(candidateMs, existingTimestamps, minSpacingMs, avoidReviewed, avoidAnnotated)
    ) {
      return { timestampMs: candidateMs, source: "whole-video" };
    }
  }
  return null;
}

/**
 * Sample a random timestamp according to the given options.
 *
 * - "segments-only": sample only within enabled segments; return null if none exist.
 * - "segments-preferred": try segments first (half the budget), then whole video.
 * - "whole-video": sample uniformly from the full video duration.
 *
 * Returns null when maxAttempts are exhausted or preconditions cannot be met.
 */
export function sampleTimestamp(options: SampleTimestampInput): SampleCandidate | null {
  const {
    mode,
    minSpacingMs,
    avoidReviewed,
    avoidAnnotated,
    maxAttempts,
    videoDurationMs,
    enabledSegments,
    existingTimestamps,
    seed
  } = options;

  if (videoDurationMs <= 0) return null;

  const rng: Rng = options.rng ?? (seed !== undefined ? makeSeededRng(seed) : Math.random);

  const pool = computeSamplingPool(
    videoDurationMs,
    enabledSegments.map((s) => ({ ...s, enabled: true }))
  );

  if (mode === "segments-only") {
    if (pool.length === 0) return null;
    return sampleFromSegments(
      enabledSegments,
      pool,
      existingTimestamps,
      minSpacingMs,
      avoidReviewed,
      avoidAnnotated,
      maxAttempts,
      rng
    );
  }

  if (mode === "segments-preferred") {
    if (pool.length > 0) {
      const segmentAttempts = Math.max(1, Math.floor(maxAttempts / 2));
      const candidate = sampleFromSegments(
        enabledSegments,
        pool,
        existingTimestamps,
        minSpacingMs,
        avoidReviewed,
        avoidAnnotated,
        segmentAttempts,
        rng
      );
      if (candidate !== null) return candidate;
    }
    const wholeAttempts = Math.max(1, Math.ceil(maxAttempts / 2));
    return sampleFromWholeVideo(
      videoDurationMs,
      existingTimestamps,
      minSpacingMs,
      avoidReviewed,
      avoidAnnotated,
      wholeAttempts,
      rng
    );
  }

  // mode === "whole-video"
  return sampleFromWholeVideo(
    videoDurationMs,
    existingTimestamps,
    minSpacingMs,
    avoidReviewed,
    avoidAnnotated,
    maxAttempts,
    rng
  );
}
