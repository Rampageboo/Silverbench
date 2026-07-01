import { describe, expect, it } from "vitest";
import { nextPreviewImageRequestId, shouldApplyPreviewImageRequest } from "./useBoxLabelEditor";

describe("preview image request guard", () => {
  it("increments request ids monotonically", () => {
    expect(nextPreviewImageRequestId(0)).toBe(1);
    expect(nextPreviewImageRequestId(12)).toBe(13);
  });

  it("applies only the latest request for the current entry", () => {
    expect(shouldApplyPreviewImageRequest({
      requestId: 3,
      latestRequestId: 3,
      targetImagePath: "video-frame/demo/1000.jpg",
      currentImagePath: "video-frame/demo/1000.jpg",
    })).toBe(true);

    expect(shouldApplyPreviewImageRequest({
      requestId: 2,
      latestRequestId: 3,
      targetImagePath: "video-frame/demo/1000.jpg",
      currentImagePath: "video-frame/demo/1000.jpg",
    })).toBe(false);

    expect(shouldApplyPreviewImageRequest({
      requestId: 3,
      latestRequestId: 3,
      targetImagePath: "video-frame/demo/1000.jpg",
      currentImagePath: "video-frame/demo/2000.jpg",
    })).toBe(false);
  });
});
