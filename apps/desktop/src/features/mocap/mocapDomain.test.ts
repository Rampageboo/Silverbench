import { describe, expect, it } from "vitest";
import type { PoseData } from "./mocapApi";
import {
  formatDuration,
  frameAtTime,
  frameRuns,
  imagePoint,
  lowConfidenceFrames,
  makeProjection,
  referenceFrameForViewTime,
  viewFrameAt,
  viewTimeAt,
  worldPoint
} from "./mocapDomain";

function pose(frames: number, joints: number): PoseData {
  const count = frames * joints;
  return {
    variant: "current",
    fps: 30,
    width: 1280,
    height: 720,
    backend: "test",
    joints: Array.from({ length: joints }, (_, i) => `j${i}`),
    parents: Array.from({ length: joints }, (_, i) => i - 1),
    times: Array.from({ length: frames }, (_, i) => i / 30),
    image: Array.from({ length: count * 2 }, (_, i) => i),
    position: Array.from({ length: count * 3 }, (_, i) => i / 100),
    confidence: Array.from({ length: count }, () => 0.9),
    valid: Array.from({ length: count }, () => 1),
    inferred: []
  };
}

describe("frameAtTime (Studio pose_frame)", () => {
  const times = [0, 0.04, 0.08, 0.125, 0.2];
  it("picks the nearest timestamp, not currentTime * fps", () => {
    expect(frameAtTime(times, 0)).toBe(0);
    expect(frameAtTime(times, 0.019)).toBe(0);
    expect(frameAtTime(times, 0.021)).toBe(1);
    expect(frameAtTime(times, 0.1)).toBe(2);
    expect(frameAtTime(times, 0.11)).toBe(3);
    expect(frameAtTime(times, 0.17)).toBe(4);
  });
  it("clamps outside the take", () => {
    expect(frameAtTime(times, -1)).toBe(0);
    expect(frameAtTime(times, 99)).toBe(4);
    expect(frameAtTime([], 1)).toBe(0);
  });
  it("ties go to the later frame, as in Studio", () => {
    expect(frameAtTime([0, 1], 0.5)).toBe(1);
  });
});

describe("makeProjection (Studio make_motion_projection)", () => {
  const body: [number, number, number][] = [
    [0, 0, 0],
    [0, 1.6, 0],
    [0.3, 1.0, 0.2]
  ];
  it("puts the lowest point on the floor line and fits the viewport", () => {
    const projection = makeProjection(0, 0, { width: 200, height: 400 }, body);
    const [, feetY] = projection.project([0, 0, 0]);
    const [, headY] = projection.project([0, 1.6, 0]);
    expect(feetY).toBeCloseTo(projection.floorY);
    expect(headY).toBeGreaterThanOrEqual(22 - 1e-9);
  });
  it("yaw 90 shows depth as horizontal", () => {
    const front = makeProjection(0, 0, { width: 400, height: 400 }, body);
    const side = makeProjection(90, 0, { width: 400, height: 400 }, body);
    const dx = (p: ReturnType<typeof makeProjection>) =>
      p.project([0.3, 1, 0.2])[0] - p.project([0, 1, 0])[0];
    expect(dx(front) / front.scale).toBeCloseTo(0.3);
    expect(dx(side) / side.scale).toBeCloseTo(0.2);
  });
  it("survives an empty pose", () => {
    expect(makeProjection(28, -8, { width: 100, height: 100 }, []).scale).toBeGreaterThan(0);
  });
});

describe("pose helpers", () => {
  it("index flat arrays frame-major", () => {
    const data = pose(3, 4);
    expect(imagePoint(data, 2, 1)).toEqual([18, 19]);
    expect(worldPoint(data, 1, 3)).toEqual([0.21, 0.22, 0.23]);
  });
  it("finds low-confidence frames and groups runs", () => {
    const data = pose(6, 2);
    data.confidence[2 * 2 + 1] = 0.2;
    data.confidence[3 * 2] = 0.1;
    data.confidence[5 * 2] = 0.1;
    data.valid[5 * 2] = 0; // invalid samples are not "low confidence"
    expect(lowConfidenceFrames(data)).toEqual([2, 3]);
    data.inferred = [[3, 0]]; // inferred samples are listed apart
    expect(lowConfidenceFrames(data)).toEqual([2]);
    expect(frameRuns([1, 2, 3, 7, 9, 10])).toEqual([
      [1, 3],
      [7, 7],
      [9, 10]
    ]);
  });
  it("formats durations like Studio", () => {
    expect(formatDuration(0.5)).toBe("计算中");
    expect(formatDuration(42)).toBe("42秒");
    expect(formatDuration(125)).toBe("2分5秒");
    expect(formatDuration(3720)).toBe("1小时2分");
  });
});

describe("multiview time mapping", () => {
  const view = {
    id: "left",
    video: "media/left.mp4",
    yaw: -45,
    pose: { ...pose(5, 1), times: [0, 0.1, 0.2, 0.3, 0.4] },
    sourceFrameAtReference: [0.5, 1.5, 2.5, 3.5],
    meanOffsetS: 0.05
  };
  it("maps a reference frame to the view's interpolated time", () => {
    expect(viewFrameAt(view, 1)).toBe(1.5);
    expect(viewTimeAt(view, 1)).toBeCloseTo(0.15);
    expect(viewTimeAt(view, 99)).toBeCloseTo(0.35); // clamps to the last mapped frame
  });
  it("maps the view's playing time back to the nearest reference frame", () => {
    expect(referenceFrameForViewTime(view, 0.2, 4)).toBe(1); // view frame 2 is between 1.5 and 2.5
    expect(referenceFrameForViewTime(view, 0.4, 4)).toBe(3);
    expect(referenceFrameForViewTime({ ...view, sourceFrameAtReference: [] }, 0.2, 4)).toBe(2);
  });
});
