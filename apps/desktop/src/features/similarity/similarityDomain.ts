/**
 * Similarity Domain
 *
 * Pure perceptual hashing for image/frame comparison.
 * All functions operate on raw RGBA pixel data (Uint8ClampedArray) with
 * explicit width/height — no browser or canvas APIs required.
 *
 * Hash output: lowercase hex string.
 * Hamming distance: number of differing bits between two hashes.
 * Similarity score: 0 (identical) – 1 (completely different).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageFingerprint = {
  sourceKey: string;
  width: number;
  height: number;
  ahash?: string;
  dhash?: string;
};

export type SimilarityCandidate = {
  sourceKey: string;
  distance: number;
  score: number;
  method: "ahash" | "dhash";
};

// ---------------------------------------------------------------------------
// Internal: nearest-neighbor grayscale resize
// ---------------------------------------------------------------------------

/** Convert raw RGBA pixels to grayscale at target resolution via nearest-neighbor. */
function resampleGrayscale(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): number[] {
  const out: number[] = new Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor((dx / dstW) * srcW));
      const sy = Math.min(srcH - 1, Math.floor((dy / dstH) * srcH));
      const i = (sy * srcW + sx) * 4;
      out[dy * dstW + dx] = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }
  }
  return out;
}

/** Convert a 0/1 bit array to a lowercase hex string. */
function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Average Hash (aHash) — 8×8 = 64 bits
// ---------------------------------------------------------------------------

/** Compute the average hash of an RGBA pixel buffer. Returns a 16-char hex string. */
export function computeAHash(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  hashSize = 8
): string {
  if (width <= 0 || height <= 0 || pixels.length < 4) return "0".repeat((hashSize * hashSize) / 4);
  const gray = resampleGrayscale(pixels, width, height, hashSize, hashSize);
  const avg = gray.reduce((sum, v) => sum + v, 0) / gray.length;
  const bits = gray.map((v) => (v >= avg ? 1 : 0));
  return bitsToHex(bits);
}

// ---------------------------------------------------------------------------
// Difference Hash (dHash) — 9×8 differences = 64 bits
// ---------------------------------------------------------------------------

/** Compute the difference hash of an RGBA pixel buffer. Returns a 16-char hex string. */
export function computeDHash(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): string {
  if (width <= 0 || height <= 0 || pixels.length < 4) return "0".repeat(16);
  const gray = resampleGrayscale(pixels, width, height, 9, 8);
  const bits: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits.push(gray[row * 9 + col] > gray[row * 9 + col + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

// ---------------------------------------------------------------------------
// Hamming distance
// ---------------------------------------------------------------------------

const POPCOUNT4: number[] = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Count the number of differing bits between two hex hash strings. */
export function hammingDistance(a: string, b: string): number {
  if (a === b) return 0;
  const len = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length) * 4;
  for (let i = 0; i < len; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += POPCOUNT4[xor & 0xf];
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Score normalization
// ---------------------------------------------------------------------------

/** Convert Hamming distance to a similarity score in [0, 1]. 0 = identical, 1 = maximally different. */
export function normalizeSimilarityScore(distance: number, hashBits: number): number {
  if (hashBits <= 0) return 0;
  return Math.min(1, Math.max(0, distance / hashBits));
}

// ---------------------------------------------------------------------------
// Candidate ranking
// ---------------------------------------------------------------------------

/**
 * Rank a list of candidate fingerprints against a reference fingerprint.
 * Returns candidates sorted by ascending Hamming distance (most similar first).
 */
export function rankSimilarityCandidates(
  reference: ImageFingerprint,
  candidates: ImageFingerprint[],
  method: "ahash" | "dhash" = "dhash"
): SimilarityCandidate[] {
  const refHash = method === "ahash" ? reference.ahash : reference.dhash;
  if (!refHash) return [];
  const hashBits = refHash.length * 4;

  return candidates
    .map((candidate): SimilarityCandidate | null => {
      const candidateHash = method === "ahash" ? candidate.ahash : candidate.dhash;
      if (!candidateHash) return null;
      const distance = hammingDistance(refHash, candidateHash);
      return {
        sourceKey: candidate.sourceKey,
        distance,
        score: normalizeSimilarityScore(distance, hashBits),
        method
      };
    })
    .filter((c): c is SimilarityCandidate => c !== null)
    .sort((a, b) => a.distance - b.distance);
}
