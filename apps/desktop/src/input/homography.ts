export type Point2 = { x: number; y: number };
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export type AprilTagDetection = {
  id: number;
  /** Corners ordered top-left, top-right, bottom-right, bottom-left in the unmirrored camera frame. */
  corners: readonly [Point2, Point2, Point2, Point2];
  decisionMargin?: number;
};

export type AprilTagCalibrationOptions = {
  tagIds?: readonly [number, number, number, number];
  mirrored?: boolean;
  minimumDecisionMargin?: number;
};

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      throw new Error("Calibration points are singular or nearly collinear.");
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < 1e-14) continue;
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function computeHomography(source: readonly Point2[], target: readonly Point2[]): Homography {
  if (source.length !== 4 || target.length !== 4) {
    throw new Error("A planar homography requires exactly four source and four target points.");
  }
  const matrix: number[][] = [];
  const vector: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = source[index];
    const { x: u, y: v } = target[index];
    if (![x, y, u, v].every(Number.isFinite)) throw new Error("Calibration points must be finite numbers.");
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  const h = solveLinearSystem(matrix, vector);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(matrix: Homography, point: Point2): Point2 | null {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-10) return null;
  const x = (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator;
  const y = (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function polygonArea(points: readonly Point2[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function mirrorPoint(point: Point2): Point2 {
  return { x: 1 - point.x, y: point.y };
}

/**
 * Four printed tags are placed just outside the interaction rectangle:
 * 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
 * Their inward-facing corners define the calibrated plane.
 */
export function homographyFromAprilTags(
  detections: readonly AprilTagDetection[],
  options: AprilTagCalibrationOptions = {}
): { matrix: Homography; source: readonly Point2[]; target: readonly Point2[] } {
  const tagIds = options.tagIds ?? [0, 1, 2, 3];
  const minimumDecisionMargin = options.minimumDecisionMargin ?? 20;
  const byId = new Map(
    detections
      .filter((detection) => (detection.decisionMargin ?? minimumDecisionMargin) >= minimumDecisionMargin)
      .map((detection) => [detection.id, detection] as const)
  );
  const tags = tagIds.map((id) => byId.get(id));
  if (tags.some((tag) => !tag)) {
    const missing = tagIds.filter((id) => !byId.has(id));
    throw new Error(`Missing AprilTag calibration ids: ${missing.join(", ")}`);
  }
  const rawSource = [
    tags[0]!.corners[2],
    tags[1]!.corners[3],
    tags[2]!.corners[0],
    tags[3]!.corners[1]
  ];
  const source = options.mirrored ? rawSource.map(mirrorPoint) : rawSource;
  if (polygonArea(source) < 0.02) {
    throw new Error("Detected calibration quadrilateral is too small or degenerate.");
  }
  const target = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ] as const;
  return { matrix: computeHomography(source, target), source, target };
}

export function clampUnitPoint(point: Point2): Point2 {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y))
  };
}
