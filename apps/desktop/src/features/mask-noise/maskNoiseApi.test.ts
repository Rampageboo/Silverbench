import { describe, expect, it } from "vitest";
import { defaultMaskNoiseSettings, serializeMaskNoiseSettings } from "./maskNoiseApi";

describe("maskNoiseApi", () => {
  it("serializes settings with clamps", () => {
    const json = serializeMaskNoiseSettings({
      ...defaultMaskNoiseSettings(),
      threshold: 999,
      effectMix: 2,
      grayMix: -1
    });
    const parsed = JSON.parse(json);
    expect(parsed.threshold).toBe(255);
    expect(parsed.effectMix).toBe(1);
    expect(parsed.grayMix).toBe(0);
  });
});
