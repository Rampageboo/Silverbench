import { describe, expect, it } from "vitest";
import { commitNumberDraft, updateVideoCaptureSegment } from "./videoCaptureDomain";

const segment = { start: 2, end: 8, interval: 1 };

describe("updateVideoCaptureSegment", () => {
  it("keeps start inside the current range", () => {
    expect(updateVideoCaptureSegment(segment, { start: 12 }, 20)).toEqual({ start: 8, end: 8, interval: 1 });
  });

  it("keeps end after start", () => {
    expect(updateVideoCaptureSegment(segment, { end: 1 }, 20)).toEqual({ start: 2, end: 2, interval: 1 });
  });

  it("keeps interval independent and positive", () => {
    expect(updateVideoCaptureSegment(segment, { interval: 0 }, 20)).toEqual({ start: 2, end: 8, interval: 0.001 });
    expect(updateVideoCaptureSegment(segment, { interval: 0.25 }, 20)).toEqual({ start: 2, end: 8, interval: 0.25 });
  });
});

describe("commitNumberDraft", () => {
  it("allows decimal drafts to be completed before validation", () => {
    expect(commitNumberDraft("0.5", 1, 0.001)).toBe(0.5);
    expect(commitNumberDraft("0.25", 1, 0.001)).toBe(0.25);
  });

  it("restores the current value for an empty or invalid draft", () => {
    expect(commitNumberDraft("", 1, 0.001)).toBe(1);
    expect(commitNumberDraft("-", 1, 0.001)).toBe(1);
  });

  it("enforces bounds only when the edit is committed", () => {
    expect(commitNumberDraft("0", 1, 0.001)).toBe(0.001);
    expect(commitNumberDraft("12", 1, 0, 10)).toBe(10);
  });
});
