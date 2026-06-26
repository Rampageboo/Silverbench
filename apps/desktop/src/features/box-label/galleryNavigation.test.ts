import { describe, expect, it } from "vitest";
import { galleryRevealTargetForKey } from "./galleryNavigation";

describe("box label gallery reveal policy", () => {
  it("requests reveal only for valid A/D navigation", () => {
    expect(galleryRevealTargetForKey({ key: "a" }, 5, 10)).toBe(4);
    expect(galleryRevealTargetForKey({ key: "D" }, 5, 10)).toBe(6);
    expect(galleryRevealTargetForKey({ key: "ArrowRight" }, 5, 10)).toBeNull();
  });

  it("does not request reveal at dataset boundaries", () => {
    expect(galleryRevealTargetForKey({ key: "a" }, 0, 10)).toBeNull();
    expect(galleryRevealTargetForKey({ key: "d" }, 9, 10)).toBeNull();
    expect(galleryRevealTargetForKey({ key: "d" }, 0, 0)).toBeNull();
  });

  it("ignores modified shortcuts and text-editing targets", () => {
    expect(galleryRevealTargetForKey({ key: "d", ctrlKey: true }, 2, 10)).toBeNull();
    expect(galleryRevealTargetForKey({ key: "a", altKey: true }, 2, 10)).toBeNull();
    expect(galleryRevealTargetForKey({ key: "d", metaKey: true }, 2, 10)).toBeNull();
    expect(galleryRevealTargetForKey({ key: "d", targetTagName: "INPUT" }, 2, 10)).toBeNull();
    expect(galleryRevealTargetForKey({ key: "a", targetEditable: true }, 2, 10)).toBeNull();
  });
});
