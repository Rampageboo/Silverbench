import { describe, expect, it } from "vitest";
import {
  applyHomography,
  computeHomography,
  homographyFromAprilTags,
  type AprilTagDetection,
  type Point2
} from "./homography";

function expectPoint(actual: Point2 | null, expected: Point2) {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 6);
  expect(actual!.y).toBeCloseTo(expected.y, 6);
}

describe("homography", () => {
  it("maps a perspective quadrilateral to a unit square", () => {
    const source = [
      { x: 0.15, y: 0.2 },
      { x: 0.9, y: 0.1 },
      { x: 0.8, y: 0.85 },
      { x: 0.2, y: 0.9 }
    ];
    const target = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ];
    const matrix = computeHomography(source, target);
    source.forEach((point, index) => expectPoint(applyHomography(matrix, point), target[index]));
  });

  it("uses inward AprilTag corners around the interaction plane", () => {
    const detections: AprilTagDetection[] = [
      { id: 0, corners: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }] },
      { id: 1, corners: [{ x: 0.8, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.8, y: 0.2 }] },
      { id: 2, corners: [{ x: 0.8, y: 0.8 }, { x: 0.9, y: 0.8 }, { x: 0.9, y: 0.9 }, { x: 0.8, y: 0.9 }] },
      { id: 3, corners: [{ x: 0.1, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.2, y: 0.9 }, { x: 0.1, y: 0.9 }] }
    ];
    const calibration = homographyFromAprilTags(detections);
    expectPoint(applyHomography(calibration.matrix, { x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
  });

  it("rejects missing or degenerate tags", () => {
    expect(() => homographyFromAprilTags([])).toThrow(/missing apriltag/i);
    const flat: AprilTagDetection[] = [0, 1, 2, 3].map((id) => ({
      id,
      corners: [
        { x: 0.1 + id * 0.1, y: 0.5 },
        { x: 0.12 + id * 0.1, y: 0.5 },
        { x: 0.12 + id * 0.1, y: 0.51 },
        { x: 0.1 + id * 0.1, y: 0.51 }
      ]
    }));
    expect(() => homographyFromAprilTags(flat)).toThrow(/small|degenerate/i);
  });
});
