import { describe, expect, it } from "vitest";
import { sanitizeFilename, sanitizePathSegment } from "./sanitizePathSegment";

describe("sanitizePathSegment", () => {
  it("replaces invalid path characters", () => {
    expect(sanitizePathSegment('foo<>:"/\\|?*bar', "class")).toBe("foo_________bar");
  });

  it("replaces control characters", () => {
    expect(sanitizePathSegment("a\u0000b\u001fb", "class")).toBe("a_b_b");
  });

  it("falls back when empty", () => {
    expect(sanitizePathSegment("   ", "class")).toBe("class");
  });
});

describe("sanitizeFilename", () => {
  it("collapses whitespace", () => {
    expect(sanitizeFilename("my file name")).toBe("my_file_name");
  });

  it("uses fallback for empty input", () => {
    expect(sanitizeFilename("")).toBe("image");
  });
});
