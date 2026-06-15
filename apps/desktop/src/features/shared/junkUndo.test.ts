import { afterEach, describe, expect, it } from "vitest";
import {
  clearJunkUndoForWorkspace,
  hasJunkUndo,
  metadataRowToUpdate,
  popJunkUndo,
  pushJunkUndo
} from "./junkUndo";
import type { MetadataRow } from "../image-pool/types";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const CONTEXT = "image-pool";

function sampleMetadata() {
  return new Map<string, MetadataRow>([
    ["a.jpg", { filename: "a.jpg", detect_junk: true, reviewed: true }],
    ["b.jpg", { filename: "b.jpg", clf_class: "cat" }]
  ]);
}

afterEach(() => {
  clearJunkUndoForWorkspace(ROOT_A);
  clearJunkUndoForWorkspace(ROOT_B);
});

describe("pushJunkUndo / popJunkUndo", () => {
  it("round-trips metadata snapshots", () => {
    const metadata = sampleMetadata();
    pushJunkUndo(CONTEXT, ROOT_A, ["a.jpg", "b.jpg"], metadata);
    expect(hasJunkUndo(CONTEXT, ROOT_A)).toBe(true);
    const snapshot = popJunkUndo(CONTEXT, ROOT_A);
    expect(snapshot).toHaveLength(2);
    expect(snapshot?.[0]).toEqual({ filename: "a.jpg", row: metadata.get("a.jpg") });
    expect(snapshot?.[1].row).toEqual(metadata.get("b.jpg"));
    expect(hasJunkUndo(CONTEXT, ROOT_A)).toBe(false);
  });

  it("ignores empty filenames or blank workspace", () => {
    pushJunkUndo(CONTEXT, "  ", ["a.jpg"], sampleMetadata());
    pushJunkUndo(CONTEXT, ROOT_A, [], sampleMetadata());
    expect(hasJunkUndo(CONTEXT, ROOT_A)).toBe(false);
  });

  it("stores null row when filename missing from metadata", () => {
    pushJunkUndo(CONTEXT, ROOT_A, ["missing.jpg"], new Map());
    const snapshot = popJunkUndo(CONTEXT, ROOT_A);
    expect(snapshot).toEqual([{ filename: "missing.jpg", row: null }]);
  });

  it("isolates stacks by workspace root", () => {
    pushJunkUndo(CONTEXT, ROOT_A, ["a.jpg"], sampleMetadata());
    pushJunkUndo(CONTEXT, ROOT_B, ["b.jpg"], sampleMetadata());
    expect(popJunkUndo(CONTEXT, ROOT_A)?.[0].filename).toBe("a.jpg");
    expect(popJunkUndo(CONTEXT, ROOT_B)?.[0].filename).toBe("b.jpg");
  });

  it("isolates stacks by context name", () => {
    pushJunkUndo("pool", ROOT_A, ["a.jpg"], sampleMetadata());
    pushJunkUndo("inbox", ROOT_A, ["b.jpg"], sampleMetadata());
    expect(popJunkUndo("pool", ROOT_A)?.[0].filename).toBe("a.jpg");
    expect(popJunkUndo("inbox", ROOT_A)?.[0].filename).toBe("b.jpg");
  });

  it("keeps at most ten undo snapshots per stack", () => {
    for (let index = 0; index < 11; index += 1) {
      pushJunkUndo(CONTEXT, ROOT_A, [`file-${index}.jpg`], new Map());
    }
    const first = popJunkUndo(CONTEXT, ROOT_A);
    expect(first?.[0].filename).toBe("file-10.jpg");
    for (let index = 0; index < 9; index += 1) {
      popJunkUndo(CONTEXT, ROOT_A);
    }
    expect(hasJunkUndo(CONTEXT, ROOT_A)).toBe(false);
  });

  it("clearJunkUndoForWorkspace removes all contexts for that root", () => {
    pushJunkUndo("pool", ROOT_A, ["a.jpg"], sampleMetadata());
    pushJunkUndo("inbox", ROOT_A, ["b.jpg"], sampleMetadata());
    clearJunkUndoForWorkspace(ROOT_A);
    expect(hasJunkUndo("pool", ROOT_A)).toBe(false);
    expect(hasJunkUndo("inbox", ROOT_A)).toBe(false);
  });
});

describe("metadataRowToUpdate", () => {
  it("clears junk flags when row is null", () => {
    expect(metadataRowToUpdate("x.jpg", null)).toEqual({
      filename: "x.jpg",
      clf_class: "",
      clf_enabled: false,
      detect_enabled: false,
      detect_junk: false
    });
  });

  it("copies row fields for backend update", () => {
    const row: MetadataRow = {
      filename: "y.jpg",
      clf_class: "dog",
      clf_enabled: true,
      detect_enabled: true,
      detect_junk: false
    };
    expect(metadataRowToUpdate("y.jpg", row)).toEqual({
      filename: "y.jpg",
      clf_class: "dog",
      clf_enabled: true,
      detect_enabled: true,
      detect_junk: false
    });
  });
});
