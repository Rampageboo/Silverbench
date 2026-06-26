import { describe, expect, it } from "vitest";
import { GestureCommandInterpreter, type HandLandmark } from "./gestureInterpreter";
import type { Homography } from "./homography";

function hand(x = 0.5, y = 0.5): HandLandmark[] {
  return Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
}

describe("GestureCommandInterpreter", () => {
  it("emits stable semantic gesture commands once per hold", () => {
    const interpreter = new GestureCommandInterpreter({ stableHoldMs: 100, mirrorX: false });
    expect(interpreter.consume({ timestampMs: 1000, gesture: "Thumb_Up", score: 0.9, landmarks: hand() })).toHaveLength(0);
    const commands = interpreter.consume({ timestampMs: 1120, gesture: "Thumb_Up", score: 0.9, landmarks: hand() });
    expect(commands.map((item) => item.command)).toEqual([{ type: "video.markReviewed" }]);
    expect(interpreter.consume({ timestampMs: 1300, gesture: "Thumb_Up", score: 0.9, landmarks: hand() })).toHaveLength(0);
  });

  it("maps an open-palm swipe to video navigation", () => {
    const interpreter = new GestureCommandInterpreter({
      mirrorX: false,
      swipeWindowMs: 500,
      swipeDistance: 0.2,
      seekSeconds: 0.25
    });
    const first = hand(0.8, 0.5);
    const last = hand(0.45, 0.5);
    interpreter.consume({ timestampMs: 1000, gesture: "Open_Palm", score: 0.95, landmarks: first });
    const commands = interpreter.consume({ timestampMs: 1200, gesture: "Open_Palm", score: 0.95, landmarks: last });
    expect(commands.some((item) => item.command.type === "video.seekBy" && item.command.seconds === -0.25)).toBe(true);
  });

  it("uses homography for pointing and pinch press/release", () => {
    const identity: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const interpreter = new GestureCommandInterpreter({ mirrorX: false, homography: identity });
    const pointing = hand();
    pointing[5] = { x: 0.2, y: 0.5 };
    pointing[17] = { x: 0.8, y: 0.5 };
    pointing[8] = { x: 0.25, y: 0.75 };
    pointing[4] = { x: 0.9, y: 0.2 };
    const move = interpreter.consume({ timestampMs: 2000, gesture: "Pointing_Up", score: 0.9, landmarks: pointing });
    expect(move[0].command).toEqual({ type: "pointer.move", x: 0.25, y: 0.75 });

    const pinched = pointing.map((item) => ({ ...item }));
    pinched[4] = { x: 0.26, y: 0.75 };
    const press = interpreter.consume({ timestampMs: 2100, gesture: "None", score: 0.9, landmarks: pinched });
    expect(press.some((item) => item.command.type === "pointer.press")).toBe(true);

    const released = pinched.map((item) => ({ ...item }));
    released[4] = { x: 0.9, y: 0.2 };
    const release = interpreter.consume({ timestampMs: 2200, gesture: "None", score: 0.9, landmarks: released });
    expect(release.some((item) => item.command.type === "pointer.release")).toBe(true);
  });
});
