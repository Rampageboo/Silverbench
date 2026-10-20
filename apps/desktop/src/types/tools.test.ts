import { describe, expect, it } from "vitest";
import { WORKBENCH_TOOLS } from "./tools";

describe("workbench tool catalogue", () => {
  it("is unique and keeps the image and video tools", () => {
    const tabs = WORKBENCH_TOOLS.map((tool) => tool.tab);
    expect(new Set(tabs).size).toBe(tabs.length);
    expect(tabs).toContain("video-capture");
    expect(tabs).toContain("image-pool");
  });

  it("declares memory policy for every tool", () => {
    expect(WORKBENCH_TOOLS.every((tool) => typeof tool.keepAlive === "boolean")).toBe(true);
    expect(WORKBENCH_TOOLS.find((tool) => tool.tab === "mask-noise")?.keepAlive).toBe(false);
  });
});
