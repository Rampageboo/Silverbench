import { describe, expect, it } from "vitest";
import { shouldKeepBackendConnectedAfterPollFailure } from "./useBackend";

describe("useBackend connection grace", () => {
  it("keeps backend connected during a brief health poll failure after a healthy poll", () => {
    expect(shouldKeepBackendConnectedAfterPollFailure(1_000, 4_000, 4_500)).toBe(true);
  });

  it("does not keep backend connected before first success or after the grace window", () => {
    expect(shouldKeepBackendConnectedAfterPollFailure(0, 1_000, 4_500)).toBe(false);
    expect(shouldKeepBackendConnectedAfterPollFailure(1_000, 6_000, 4_500)).toBe(false);
  });
});
