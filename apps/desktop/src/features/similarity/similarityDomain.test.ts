import { describe, expect, it } from "vitest";
import {
  computeAHash,
  computeDHash,
  hammingDistance,
  normalizeSimilarityScore,
  rankSimilarityCandidates,
  type ImageFingerprint
} from "./similarityDomain";

/** Create a synthetic RGBA buffer of a flat colour. */
function solidPixels(r: number, g: number, b: number, w = 16, h = 16): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

/** Create a half-black / half-white image. */
function halfWhite(w = 16, h = 16): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? 0 : 255;
      const i = (y * w + x) * 4;
      buf[i] = c; buf[i + 1] = c; buf[i + 2] = c; buf[i + 3] = 255;
    }
  }
  return buf;
}

describe("similarityDomain", () => {
  describe("computeAHash", () => {
    it("returns a 16-char hex string for 8×8 hash", () => {
      const hash = computeAHash(solidPixels(128, 128, 128), 16, 16);
      expect(hash).toHaveLength(16);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it("identical images produce the same hash", () => {
      const p = solidPixels(200, 100, 50);
      expect(computeAHash(p, 16, 16)).toBe(computeAHash(p, 16, 16));
    });

    it("an image that is half-dark / half-light has a different hash than the inverted version", () => {
      // Solid colours are degenerate (all pixels tie the mean → all bits equal).
      // Use a spatially varied image so the hash actually encodes structure.
      const leftDark = halfWhite(); // left half dark, right half white
      const rightDark = halfWhite(16, 16); // flip
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const c = x >= 8 ? 0 : 255; // right dark, left light (inverted)
          const i = (y * 16 + x) * 4;
          rightDark[i] = c; rightDark[i + 1] = c; rightDark[i + 2] = c;
        }
      }
      expect(computeAHash(leftDark, 16, 16)).not.toBe(computeAHash(rightDark, 16, 16));
    });

    it("handles empty / zero-size input gracefully", () => {
      const hash = computeAHash(new Uint8ClampedArray(0), 0, 0);
      expect(hash).toHaveLength(16);
    });
  });

  describe("computeDHash", () => {
    it("returns a 16-char hex string", () => {
      const hash = computeDHash(solidPixels(128, 128, 128), 16, 16);
      expect(hash).toHaveLength(16);
    });

    it("identical images produce the same dHash", () => {
      const p = halfWhite();
      expect(computeDHash(p, 16, 16)).toBe(computeDHash(p, 16, 16));
    });

    it("horizontally mirrored image produces a different dHash", () => {
      const left = halfWhite();
      const right = halfWhite();
      // flip right half: set right side to 0, left side to 255
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const c = x >= 8 ? 0 : 255;
          const i = (y * 16 + x) * 4;
          right[i] = c; right[i + 1] = c; right[i + 2] = c;
        }
      }
      expect(computeDHash(left, 16, 16)).not.toBe(computeDHash(right, 16, 16));
    });
  });

  describe("hammingDistance", () => {
    it("same string has distance 0", () => {
      expect(hammingDistance("abcdef1234567890", "abcdef1234567890")).toBe(0);
    });

    it("completely different nibbles have maximum distance", () => {
      // "0" = 0000, "f" = 1111 — differ in all 4 bits
      expect(hammingDistance("0", "f")).toBe(4);
    });

    it("single bit difference", () => {
      expect(hammingDistance("0", "1")).toBe(1);
    });

    it("handles strings of different length by counting extra bits", () => {
      const d = hammingDistance("ff", "f");
      expect(d).toBe(4);
    });
  });

  describe("normalizeSimilarityScore", () => {
    it("distance 0 = score 0 (identical)", () => {
      expect(normalizeSimilarityScore(0, 64)).toBe(0);
    });

    it("distance equals hashBits = score 1 (maximally different)", () => {
      expect(normalizeSimilarityScore(64, 64)).toBe(1);
    });

    it("clamps score to [0, 1]", () => {
      expect(normalizeSimilarityScore(100, 64)).toBe(1);
      expect(normalizeSimilarityScore(-5, 64)).toBe(0);
    });
  });

  describe("rankSimilarityCandidates", () => {
    it("sorts candidates by ascending distance", () => {
      const ref: ImageFingerprint = { sourceKey: "ref", width: 16, height: 16, dhash: "0000000000000000" };
      const candidates: ImageFingerprint[] = [
        { sourceKey: "far", width: 16, height: 16, dhash: "ffffffffffffffff" },
        { sourceKey: "close", width: 16, height: 16, dhash: "0000000000000001" }
      ];
      const ranked = rankSimilarityCandidates(ref, candidates, "dhash");
      expect(ranked[0].sourceKey).toBe("close");
      expect(ranked[1].sourceKey).toBe("far");
    });

    it("returns empty array when reference has no hash for the method", () => {
      const ref: ImageFingerprint = { sourceKey: "ref", width: 16, height: 16 };
      const candidates: ImageFingerprint[] = [
        { sourceKey: "a", width: 16, height: 16, dhash: "0000000000000000" }
      ];
      expect(rankSimilarityCandidates(ref, candidates, "dhash")).toHaveLength(0);
    });

    it("skips candidates that lack the requested hash", () => {
      const ref: ImageFingerprint = { sourceKey: "ref", width: 16, height: 16, ahash: "ff00ff00ff00ff00" };
      const candidates: ImageFingerprint[] = [
        { sourceKey: "no-ahash", width: 16, height: 16, dhash: "ff00ff00ff00ff00" }
      ];
      expect(rankSimilarityCandidates(ref, candidates, "ahash")).toHaveLength(0);
    });

    it("includes score in results", () => {
      const ref: ImageFingerprint = { sourceKey: "ref", width: 16, height: 16, dhash: "0000000000000000" };
      const candidates: ImageFingerprint[] = [
        { sourceKey: "a", width: 16, height: 16, dhash: "0000000000000000" }
      ];
      const ranked = rankSimilarityCandidates(ref, candidates);
      expect(ranked[0].score).toBe(0);
      expect(ranked[0].distance).toBe(0);
    });
  });
});
