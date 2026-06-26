import { describe, expect, it } from "vitest";
import { computePostRemovalIndex } from "./useBoxLabel";

const makeEntries = (basenames: string[]) => basenames.map((basename) => ({ basename }));

describe("computePostRemovalIndex", () => {
  it("advances current index past the removed item when current is junked", () => {
    const entries = makeEntries(["a", "b", "c", "d", "e"]);
    // Current is 'b' (index 2). Remove 'b'. Remaining: a,c,d,e (len 4). Min(2,3) = 2.
    expect(computePostRemovalIndex(2, entries, new Set(["b"]))).toBe(2);
  });

  it("clamps to last item when the current item was the last", () => {
    const entries = makeEntries(["a", "b", "c"]);
    // currentIndex 2, remove 'c'. Remaining: a,b (len 2). Min(2,1)=1.
    expect(computePostRemovalIndex(2, entries, new Set(["c"]))).toBe(1);
  });

  it("returns 0 when all entries are removed", () => {
    const entries = makeEntries(["x", "y"]);
    expect(computePostRemovalIndex(0, entries, new Set(["x", "y"]))).toBe(0);
  });

  it("preserves index when a non-current item is removed from before the current position", () => {
    const entries = makeEntries(["a", "b", "c", "d"]);
    // currentIndex 3 (d). Remove 'a'. Remaining: b,c,d (len 3). Min(3,2)=2.
    expect(computePostRemovalIndex(3, entries, new Set(["a"]))).toBe(2);
  });

  it("preserves index when a non-current item is removed after current", () => {
    const entries = makeEntries(["a", "b", "c", "d"]);
    // currentIndex 1 (b). Remove 'd'. Remaining: a,b,c (len 3). Min(1,2)=1.
    expect(computePostRemovalIndex(1, entries, new Set(["d"]))).toBe(1);
  });

  it("handles multi-selection removal correctly", () => {
    const entries = makeEntries(["a", "b", "c", "d", "e"]);
    // currentIndex 2 (c). Remove a,b,c. Remaining: d,e (len 2). Min(2,1)=1.
    expect(computePostRemovalIndex(2, entries, new Set(["a", "b", "c"]))).toBe(1);
  });

  it("returns 0 for empty entries list", () => {
    expect(computePostRemovalIndex(0, [], new Set(["x"]))).toBe(0);
  });

  it("current index 0 with first item removed returns 0 when others remain", () => {
    const entries = makeEntries(["a", "b", "c"]);
    // Remove 'a'. Remaining: b,c. Min(0,1)=0.
    expect(computePostRemovalIndex(0, entries, new Set(["a"]))).toBe(0);
  });
});
