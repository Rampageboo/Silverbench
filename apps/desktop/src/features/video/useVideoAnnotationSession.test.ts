import { describe, expect, it } from "vitest";
import { filterVideoJunk } from "./useVideoAnnotationSession";
import type { MetadataRow } from "../image-pool/types";

describe("filterVideoJunk", () => {
  it("removes videos marked as detect junk in metadata", () => {
    const videos = [
      { name: "keep.mp4", path: "D:/media/keep.mp4" },
      { name: "junk.mp4", path: "D:/media/junk.mp4" },
    ];
    const metadata = new Map<string, MetadataRow>([
      ["junk.mp4", { filename: "junk.mp4", detect_junk: true }],
    ]);

    expect(filterVideoJunk(videos, metadata)).toEqual([videos[0]]);
  });
});
