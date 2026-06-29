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
      currentImagePath: "media/a.jpg",
      poolLabelCurrentImagePath: "media/b.jpg",
      galleryScrollTop: 12.7,
      poolLabelPointerToolEnabled: true,
      poolLabelAutoFitEnabled: false
    });
    expect(parsed.galleryScrollTop).toBe(13);
    expect(parsed.poolLabelPointerToolEnabled).toBe(true);
    expect(parsed.poolLabelAutoFitEnabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // normalizeShortcutSlotsFromSession — null vs empty semantics
  // -------------------------------------------------------------------------

  it("normalizeShortcutSlotsFromSession returns null when both fields are absent", () => {
    // Absent shortcut fields mean 'not loaded yet', NOT 'all cleared'.
    // The caller must treat null as 'unknown', not as an empty slot list.
    expect(normalizeShortcutSlotsFromSession({})).toBeNull();
    expect(normalizeShortcutSlotsFromSession({ poolLabelFixedBoxes: [] })).toBeNull();
  });

  it("normalizeShortcutSlotsFromSession returns all-null for empty arrays", () => {
    // An explicit empty poolLabelShortcuts array means 'user cleared all shortcuts'.
    const slots = normalizeShortcutSlotsFromSession({ poolLabelShortcuts: [] });
    expect(slots).not.toBeNull();
    expect(slots).toHaveLength(10);
    expect(slots!.every((s) => s === null)).toBe(true);
  });

  it("normalizeShortcutSlotsFromSession normalises a partial array (legacy numeric)", () => {
    const slots = normalizeShortcutSlotsFromSession({
      poolLabelShortcuts: [0, 1, 2]
    });
    expect(slots).not.toBeNull();
    expect(slots![0]).toEqual({ classId: 0, mode: "draw" });
    expect(slots![1]).toEqual({ classId: 1, mode: "draw" });
    expect(slots![2]).toEqual({ classId: 2, mode: "draw" });
    expect(slots![3]).toBeNull();
    expect(slots).toHaveLength(10);
  });

  it("normalizeShortcutSlotsFromSession preserves mode from object format", () => {
    const slots = normalizeShortcutSlotsFromSession({
      poolLabelShortcuts: [
        { classId: 3, mode: "subject-select" },
        { classId: 7, mode: "draw" }
      ]
    });
    expect(slots![0]).toEqual({ classId: 3, mode: "subject-select" });
    expect(slots![1]).toEqual({ classId: 7, mode: "draw" });
    expect(slots![2]).toBeNull();
  });

  it("normalizeShortcutSlotsFromSession respects assigned mask", () => {
    const slots = normalizeShortcutSlotsFromSession({
      poolLabelShortcuts: [1, 2, null, 3],
      poolLabelShortcutAssigned: [true, false, true, true]
    });
    expect(slots![0]).toEqual({ classId: 1, mode: "draw" });
    expect(slots![1]).toBeNull();
    expect(slots![2]).toBeNull();
    expect(slots![3]).toEqual({ classId: 3, mode: "draw" });
    expect(slots![4]).toBeNull();
  });

  it("normalizeShortcutSlotsFromSession rejects negative class ids", () => {
    const slots = normalizeShortcutSlotsFromSession({
      poolLabelShortcuts: [-1, 0, "bad", 5]
    });
    expect(slots![0]).toBeNull();
    expect(slots![1]).toEqual({ classId: 0, mode: "draw" });
    expect(slots![2]).toBeNull();
    expect(slots![3]).toEqual({ classId: 5, mode: "draw" });
  });

  it("normalizeShortcutSlotsFromSession rejects negative classId in object format", () => {
    const slots = normalizeShortcutSlotsFromSession({
      poolLabelShortcuts: [{ classId: -2, mode: "draw" }, { classId: 4, mode: "subject-select" }]
    });
    expect(slots![0]).toBeNull();
    expect(slots![1]).toEqual({ classId: 4, mode: "subject-select" });
  });

  // -------------------------------------------------------------------------
  // normalizeFixedBoxSlotsFromSession
  // -------------------------------------------------------------------------

  it("normalizeFixedBoxSlotsFromSession returns null when absent", () => {
    expect(normalizeFixedBoxSlotsFromSession({})).toBeNull();
  });

  it("normalizeFixedBoxSlotsFromSession clamps coordinates", () => {
    const slots = normalizeFixedBoxSlotsFromSession({
      poolLabelFixedBoxes: [{ classId: 2, x: 1.5, y: -0.2, w: 0.3, h: 0.4 }]
    });
    expect(slots![0]).toEqual({ classId: 2, x: 1, y: 0, w: 0.3, h: 0.4 });
  });

  it("normalizeFixedBoxSlotsFromSession rejects non-integer classIds", () => {
    const slots = normalizeFixedBoxSlotsFromSession({
      poolLabelFixedBoxes: [{ classId: 1.5, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]
    });
    expect(slots![0]).toBeNull();
  });

  it("normalizeFixedBoxSlotsFromSession preserves valid entry with explicit empty array", () => {
    const slots = normalizeFixedBoxSlotsFromSession({ poolLabelFixedBoxes: [] });
    expect(slots).not.toBeNull();
    expect(slots!.every((s) => s === null)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // resolveResumeImagePath
  // -------------------------------------------------------------------------

  it("resolveResumeImagePath prefers pool label path", () => {
    expect(
      resolveResumeImagePath({
        poolLabelCurrentImagePath: "media/b.jpg",
        currentImagePath: "media/a.jpg"
      })
    ).toBe("media/b.jpg");
    expect(resolveResumeImagePath({ currentImagePath: "media/a.jpg" })).toBe("media/a.jpg");
  });

  it("resolveResumeImagePath returns empty string when both are absent", () => {
    expect(resolveResumeImagePath({})).toBe("");
  });
});
