import { describe, expect, it } from "vitest";
import { isNumpadCode, keyboardMultiplierForNumpad, numpadResizeKey } from "./boxLabelKeyboardShortcuts";

describe("box label keyboard shortcuts", () => {
  it("maps unused numpad corners to keyboard multipliers", () => {
    expect(keyboardMultiplierForNumpad("Numpad1")).toBe(1);
    expect(keyboardMultiplierForNumpad("Numpad3")).toBe(3);
    expect(keyboardMultiplierForNumpad("Numpad7")).toBe(7);
    expect(keyboardMultiplierForNumpad("Numpad9")).toBe(9);
  });

  it("keeps top-row digits and resize keys out of multiplier handling", () => {
    expect(keyboardMultiplierForNumpad("Digit1")).toBeNull();
    expect(keyboardMultiplierForNumpad("Numpad2")).toBeNull();
    expect(keyboardMultiplierForNumpad("Numpad5")).toBeNull();
    expect(keyboardMultiplierForNumpad("Numpad8")).toBeNull();
  });

  it("identifies numpad resize keys by physical code", () => {
    expect(numpadResizeKey("Numpad4")).toBe("4");
    expect(numpadResizeKey("Numpad6")).toBe("6");
    expect(numpadResizeKey("Digit4")).toBeNull();
    expect(isNumpadCode("Numpad4")).toBe(true);
    expect(isNumpadCode("ArrowLeft")).toBe(false);
  });
});
