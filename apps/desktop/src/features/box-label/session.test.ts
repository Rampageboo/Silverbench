import { describe, expect, it } from "vitest";
import {
  normalizeFixedBoxSlotsFromSession,
  normalizeShortcutSlotsFromSession,
  parsePoolLabelSession,
  resolveResumeImagePath
} from "./session";

describe("box-label session", () => {
  it("parsePoolLabelSession ignores invalid input", () => {
    expect(parsePoolLabelSession(null)).toEqual({});
    expect(parsePoolLabelSession("bad")).toEqual({});
  });

  it("parsePoolLabelSession reads known fields", () => {
    const parsed = parsePoolLabelSession({
      currentImagePath: "image_pool/a.jpg",
      poolLabelCurrentImagePath: "image_pool/b.jpg",
      galleryScrollTop: 12.7,
      poolLabelPointerToolEnabled: true,
      poolLabelAutoFitEnabled: false
    });
    expect(parsed.galleryScrollTop).toBe(13);
    expect(parsed.poolLabelPointerToolEnabled).toBe(true);
    expect(parsed.poolLabelAutoFitEnabled).toBe(false);
  });

  it("normalizeShortcutSlotsFromSession respects assigned mask", () => {
    const slots = normalizeShortcutSlotsFromSession({
      poolLabelShortcuts: [1, 2, null, 3],
      poolLabelShortcutAssigned: [true, false, true, true]
    });
    expect(slots).toEqual([1, null, null, 3, null, null, null, null, null, null]);
  });

  it("normalizeFixedBoxSlotsFromSession clamps coordinates", () => {
    const slots = normalizeFixedBoxSlotsFromSession({
      poolLabelFixedBoxes: [{ classId: 2, x: 1.5, y: -0.2, w: 0.3, h: 0.4 }]
    });
    expect(slots[0]).toEqual({ classId: 2, x: 1, y: 0, w: 0.3, h: 0.4 });
  });

  it("resolveResumeImagePath prefers pool label path", () => {
    expect(
      resolveResumeImagePath({
        poolLabelCurrentImagePath: "image_pool/b.jpg",
        currentImagePath: "image_pool/a.jpg"
      })
    ).toBe("image_pool/b.jpg");
    expect(resolveResumeImagePath({ currentImagePath: "image_pool/a.jpg" })).toBe("image_pool/a.jpg");
  });
});
