import { describe, expect, it } from "vitest";
import { PoseMotionInterpreter, type PoseLandmark } from "./poseMotionInterpreter";

function pose(): PoseLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1, presence: 1 }));
  landmarks[11] = { x: 0.4, y: 0.42, visibility: 1, presence: 1 };
  landmarks[12] = { x: 0.6, y: 0.42, visibility: 1, presence: 1 };
  landmarks[23] = { x: 0.43, y: 0.72, visibility: 1, presence: 1 };
  landmarks[24] = { x: 0.57, y: 0.72, visibility: 1, presence: 1 };
  landmarks[13] = { x: 0.38, y: 0.52, visibility: 1, presence: 1 };
  landmarks[15] = { x: 0.36, y: 0.62, visibility: 1, presence: 1 };
  landmarks[14] = { x: 0.62, y: 0.52, visibility: 1, presence: 1 };
  landmarks[16] = { x: 0.64, y: 0.62, visibility: 1, presence: 1 };
  return landmarks;
}

function translated(source: PoseLandmark[], dx: number, dy: number) {
  return source.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }));
}

describe("PoseMotionInterpreter", () => {
  it("uses shoulder-elbow-wrist motion for a left arm sweep", () => {
    const interpreter = new PoseMotionInterpreter({ mirrorX: false, windowMs: 500, seekSeconds: 0.25 });
    const start = pose();
    const end = pose();
    end[13] = { ...end[13], x: 0.22 };
    end[15] = { ...end[15], x: 0.12 };
    expect(interpreter.consume({ timestampMs: 1000, landmarks: start })).toEqual([]);
    const commands = interpreter.consume({ timestampMs: 1250, landmarks: end });
    expect(commands.map((item) => item.command)).toContainEqual({ type: "video.seekBy", seconds: -0.25 });
    expect(commands[0]?.gesture).toMatch(/Arm_Left_Left/);
  });

  it("maps upward and downward forearm sweeps to reviewed-frame navigation", () => {
    const upInterpreter = new PoseMotionInterpreter({ mirrorX: false, windowMs: 500 });
    const upStart = pose();
    const upEnd = pose();
    upEnd[13] = { ...upEnd[13], y: 0.32 };
    upEnd[15] = { ...upEnd[15], y: 0.2 };
    upInterpreter.consume({ timestampMs: 2000, landmarks: upStart });
    expect(upInterpreter.consume({ timestampMs: 2250, landmarks: upEnd }).map((item) => item.command)).toContainEqual({
      type: "video.gotoReviewed",
      direction: -1
    });

    const downInterpreter = new PoseMotionInterpreter({ mirrorX: false, windowMs: 500 });
    const downStart = pose();
    downStart[13] = { ...downStart[13], y: 0.3 };
    downStart[15] = { ...downStart[15], y: 0.18 };
    const downEnd = pose();
    downEnd[13] = { ...downEnd[13], y: 0.62 };
    downEnd[15] = { ...downEnd[15], y: 0.76 };
    downInterpreter.consume({ timestampMs: 3000, landmarks: downStart });
    expect(downInterpreter.consume({ timestampMs: 3250, landmarks: downEnd }).map((item) => item.command)).toContainEqual({
      type: "video.gotoReviewed",
      direction: 1
    });
  });

  it("subtracts torso translation so moving the whole body does not trigger", () => {
    const interpreter = new PoseMotionInterpreter({ mirrorX: false, windowMs: 500 });
    const start = pose();
    const end = translated(start, 0.18, 0.08);
    interpreter.consume({ timestampMs: 4000, landmarks: start });
    expect(interpreter.consume({ timestampMs: 4250, landmarks: end })).toEqual([]);
  });

  it("rejects an arm with low wrist visibility", () => {
    const interpreter = new PoseMotionInterpreter({ mirrorX: false, windowMs: 500 });
    const start = pose();
    const end = pose();
    start[15] = { ...start[15], visibility: 0.1 };
    end[15] = { ...end[15], x: 0.1, visibility: 0.1 };
    interpreter.consume({ timestampMs: 5000, landmarks: start });
    expect(interpreter.consume({ timestampMs: 5250, landmarks: end })).toEqual([]);
  });
});
