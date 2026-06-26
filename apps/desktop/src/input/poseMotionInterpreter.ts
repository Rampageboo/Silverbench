import { createCommandEnvelope, type CommandEnvelope } from "./commands";

export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

export type PoseObservation = {
  timestampMs: number;
  landmarks: readonly PoseLandmark[];
  worldLandmarks?: readonly PoseLandmark[];
};

export type PoseMotionInterpreterOptions = {
  seekSeconds?: number;
  mirrorX?: boolean;
  windowMs?: number;
  cooldownMs?: number;
  minimumVisibility?: number;
  minimumDisplacementBodyUnits?: number;
  minimumPathBodyUnits?: number;
  axisDominance?: number;
};

type ArmSide = "Left" | "Right";
type ArmIndexes = { readonly shoulder: number; readonly elbow: number; readonly wrist: number };
type MotionSample = {
  timestampMs: number;
  x: number;
  y: number;
  confidence: number;
};
type MotionCandidate = {
  side: ArmSide;
  direction: "Left" | "Right" | "Up" | "Down";
  confidence: number;
  score: number;
};

const LEFT_ARM: ArmIndexes = { shoulder: 11, elbow: 13, wrist: 15 };
const RIGHT_ARM: ArmIndexes = { shoulder: 12, elbow: 14, wrist: 16 };
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

function average(a: PoseLandmark, b: PoseLandmark) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Pick<PoseLandmark, "x" | "y">, b: Pick<PoseLandmark, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function landmarkConfidence(landmark: PoseLandmark | undefined) {
  if (!landmark) return 0;
  const visibility = Number.isFinite(landmark.visibility) ? Number(landmark.visibility) : 1;
  const presence = Number.isFinite(landmark.presence) ? Number(landmark.presence) : 1;
  return Math.max(0, Math.min(1, Math.min(visibility, presence)));
}

function weightedArmPoint(elbow: PoseLandmark, wrist: PoseLandmark) {
  return {
    x: wrist.x * 0.72 + elbow.x * 0.28,
    y: wrist.y * 0.72 + elbow.y * 0.28
  };
}

function mirrored(point: { x: number; y: number }, mirrorX: boolean) {
  return mirrorX ? { x: 1 - point.x, y: point.y } : point;
}

export class PoseMotionInterpreter {
  private options: Required<PoseMotionInterpreterOptions>;
  private history: Record<ArmSide, MotionSample[]> = { Left: [], Right: [] };
  private lastMotionAt = Number.NEGATIVE_INFINITY;

  constructor(options: PoseMotionInterpreterOptions = {}) {
    this.options = {
      seekSeconds: options.seekSeconds ?? 0.1,
      mirrorX: options.mirrorX ?? true,
      windowMs: options.windowMs ?? 650,
      cooldownMs: options.cooldownMs ?? 900,
      minimumVisibility: options.minimumVisibility ?? 0.5,
      minimumDisplacementBodyUnits: options.minimumDisplacementBodyUnits ?? 0.6,
      minimumPathBodyUnits: options.minimumPathBodyUnits ?? 0.78,
      axisDominance: options.axisDominance ?? 1.35
    };
  }

  reset() {
    this.history = { Left: [], Right: [] };
    this.lastMotionAt = Number.NEGATIVE_INFINITY;
  }

  consume(observation: PoseObservation): CommandEnvelope[] {
    if (observation.landmarks.length < 25) {
      this.history = { Left: [], Right: [] };
      return [];
    }

    const landmarks = observation.landmarks;
    const leftShoulder = landmarks[LEFT_ARM.shoulder];
    const rightShoulder = landmarks[RIGHT_ARM.shoulder];
    if (!leftShoulder || !rightShoulder) return [];
    const shoulders = average(leftShoulder, rightShoulder);
    const hips = landmarks[LEFT_HIP] && landmarks[RIGHT_HIP]
      ? average(landmarks[LEFT_HIP], landmarks[RIGHT_HIP])
      : shoulders;
    const torsoCenter = {
      x: shoulders.x * 0.65 + hips.x * 0.35,
      y: shoulders.y * 0.65 + hips.y * 0.35
    };
    const bodyScale = Math.max(0.06, distance(leftShoulder, rightShoulder));

    this.captureArm("Left", LEFT_ARM, observation, torsoCenter, bodyScale);
    this.captureArm("Right", RIGHT_ARM, observation, torsoCenter, bodyScale);

    if (observation.timestampMs - this.lastMotionAt < this.options.cooldownMs) return [];
    const candidates = [this.candidate("Left"), this.candidate("Right")].filter(
      (value): value is MotionCandidate => value !== null
    );
    if (!candidates.length) return [];
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    this.lastMotionAt = observation.timestampMs;
    this.history = { Left: [], Right: [] };

    const metadata = {
      confidence: best.confidence,
      createdAt: observation.timestampMs,
      gesture: `Arm_${best.side}_${best.direction}`
    };
    switch (best.direction) {
      case "Left":
        return [createCommandEnvelope("gesture", { type: "video.seekBy", seconds: -this.options.seekSeconds }, metadata)];
      case "Right":
        return [createCommandEnvelope("gesture", { type: "video.seekBy", seconds: this.options.seekSeconds }, metadata)];
      case "Up":
        return [createCommandEnvelope("gesture", { type: "video.gotoReviewed", direction: -1 }, metadata)];
      case "Down":
        return [createCommandEnvelope("gesture", { type: "video.gotoReviewed", direction: 1 }, metadata)];
    }
  }

  private captureArm(
    side: ArmSide,
    indexes: ArmIndexes,
    observation: PoseObservation,
    torsoCenter: { x: number; y: number },
    bodyScale: number
  ) {
    const shoulder = observation.landmarks[indexes.shoulder];
    const elbow = observation.landmarks[indexes.elbow];
    const wrist = observation.landmarks[indexes.wrist];
    const confidence = Math.min(
      landmarkConfidence(shoulder),
      landmarkConfidence(elbow),
      landmarkConfidence(wrist)
    );
    if (!shoulder || !elbow || !wrist || confidence < this.options.minimumVisibility) {
      this.history[side] = [];
      return;
    }

    const armPoint = mirrored(weightedArmPoint(elbow, wrist), this.options.mirrorX);
    const torso = mirrored(torsoCenter, this.options.mirrorX);
    const sample: MotionSample = {
      timestampMs: observation.timestampMs,
      x: (armPoint.x - torso.x) / bodyScale,
      y: (armPoint.y - torso.y) / bodyScale,
      confidence
    };
    const cutoff = observation.timestampMs - this.options.windowMs;
    this.history[side] = [...this.history[side], sample].filter((item) => item.timestampMs >= cutoff);
  }

  private candidate(side: ArmSide): MotionCandidate | null {
    const samples = this.history[side];
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    let path = 0;
    for (let index = 1; index < samples.length; index += 1) {
      path += Math.hypot(samples[index].x - samples[index - 1].x, samples[index].y - samples[index - 1].y);
    }
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const displacement = Math.max(absX, absY);
    if (
      displacement < this.options.minimumDisplacementBodyUnits ||
      path < this.options.minimumPathBodyUnits
    ) {
      return null;
    }

    let direction: MotionCandidate["direction"] | null = null;
    if (absX >= absY * this.options.axisDominance) direction = dx < 0 ? "Left" : "Right";
    else if (absY >= absX * this.options.axisDominance) direction = dy < 0 ? "Up" : "Down";
    if (!direction) return null;

    const confidence = samples.reduce((sum, sample) => sum + sample.confidence, 0) / samples.length;
    const straightness = Math.min(1, displacement / Math.max(path, 1e-6));
    const strength = Math.min(1, displacement / (this.options.minimumDisplacementBodyUnits * 1.8));
    return {
      side,
      direction,
      confidence: Math.max(0.72, Math.min(1, confidence * 0.75 + straightness * 0.15 + strength * 0.1)),
      score: displacement * (0.7 + straightness * 0.3)
    };
  }
}
