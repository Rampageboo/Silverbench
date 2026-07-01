import { describe, expect, it } from "vitest";
import { buildMediaOrder, normalizeMediaSelection, shouldSelectNewlyLoadedVideo } from "./labelMediaSelection";

describe("labelMediaSelection", () => {
  it("orders videos before images in the unified media catalog", () => {
    expect(buildMediaOrder(2, 3)).toEqual([
      { kind: "video", index: 0 },
      { kind: "video", index: 1 },
      { kind: "image", index: 0 },
      { kind: "image", index: 1 },
      { kind: "image", index: 2 },
    ]);
  });

  it("clamps an out-of-range selection within the current media type", () => {
    expect(
      normalizeMediaSelection({
        selection: { kind: "image", index: 8 },
        imageCount: 3,
        videoCount: 2,
        currentImageIndex: 0,
        currentVideoIndex: 0,
      })
    ).toEqual({ kind: "image", index: 2 });

    expect(
      normalizeMediaSelection({
        selection: { kind: "video", index: 8 },
        imageCount: 3,
        videoCount: 2,
        currentImageIndex: 0,
        currentVideoIndex: 0,
      })
    ).toEqual({ kind: "video", index: 1 });
  });

  it("falls back to the other media type when the selected type disappears", () => {
    expect(
      normalizeMediaSelection({
        selection: { kind: "video", index: 0 },
        imageCount: 4,
        videoCount: 0,
        currentImageIndex: 2,
        currentVideoIndex: -1,
      })
    ).toEqual({ kind: "image", index: 2 });

    expect(
      normalizeMediaSelection({
        selection: { kind: "image", index: 0 },
        imageCount: 0,
        videoCount: 4,
        currentImageIndex: -1,
        currentVideoIndex: 3,
      })
    ).toEqual({ kind: "video", index: 3 });
  });

  it("does not override an explicit image selection when videos finish loading later", () => {
    expect(
      shouldSelectNewlyLoadedVideo({
        previousVideoCount: 0,
        nextVideoCount: 4,
        selection: { kind: "image", index: 1 },
      })
    ).toBe(false);
  });

  it("keeps initial video-first selection when videos become available", () => {
    expect(
      shouldSelectNewlyLoadedVideo({
        previousVideoCount: 0,
        nextVideoCount: 4,
        selection: { kind: "video", index: 0 },
      })
    ).toBe(true);
  });
});
