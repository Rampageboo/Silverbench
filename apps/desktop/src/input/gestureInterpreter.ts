import { applyHomography, clampUnitPoint, type Homography, type Point2 } from "./homography";
import { createCommandEnvelope, type CommandEnvelope } from "./commands";

export type HandLandmark = { x: number; y: number; z?: number };

export type GestureObservation = {
  timestampMs: number;
  gesture: string;
  score: number;
  handedness?: "Left" | "Right" | string;
  landmarks: readonly HandLandmark[];
};

export type GestureInterpreterOptions = {
  seekSeconds?: number;
  mirrorX?: boolean;
  minimumScore?: number;
  stableHoldMs?: number;
  swipeWindowMs?: number;
  swipeDistance?: number;
  homography?: Homography | null;
};

type MotionSample = { timestampMs: number; x: number };

function distance(a: HandLandmark, b: HandLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function palmCenter(landmarks: readonly HandLandmark[]) {
  const indexes = [0, 5, 9, 13, 17].filter((index) => landmarks[index]);
  const sum = indexes.reduce(
    (value, index) => ({ x: value.x + landmarks[index].x, y: value.y + landmarks[index].y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / Math.max(1, indexes.length), y: sum.y / Math.max(1, indexes.length) };
}

export class GestureCommandInterpreter {
  private options: Required<Omit<GestureInterpreterOptions, "homography">> & { homography: Homography | null };
  private stableGesture = "";
  private stableSince = 0;
  private stableFired = false;
  private motion: MotionSample[] = [];
  private lastSwipeAt = 0;
  private pinchPressed = false;

  constructor(options: GestureInterpreterOptions = {}) {
    this.options = {
      seekSeconds: options.seekSeconds ?? 0.1,
      mirrorX: options.mirrorX ?? true,
      minimumScore: options.minimumScore ?? 0.72,
      stableHoldMs: options.stableHoldMs ?? 550,
      swipeWindowMs: options.swipeWindowMs ?? 450,
      swipeDistance: options.swipeDistance ?? 0.18,
      homography: options.homography ?? null
    };
  }

  setHomography(matrix: Homography | null) {
    this.options.homography = matrix;
    this.pinchPressed = false;
  }

  reset() {
    this.stableGesture = "";
    this.stableSince = 0;
    this.stableFired = false;
    this.motion = [];
    this.lastSwipeAt = 0;
    this.pinchPressed = false;
  }

  consume(observation: GestureObservation): CommandEnvelope[] {
    const commands: CommandEnvelope[] = [];
    const gesture = observation.score >= this.options.minimumScore ? observation.gesture : "None";
    this.updateStableGesture(gesture, observation.timestampMs);

    if (!this.stableFired && gesture !== "None" && observation.timestampMs - this.stableSince >= this.options.stableHoldMs) {
      const command = this.stableCommand(gesture, observation.score, observation.timestampMs);
      if (command) commands.push(command);
      this.stableFired = true;
    }

    if (gesture === "Open_Palm" && observation.landmarks.length >= 18) {
      const center = palmCenter(observation.landmarks);
      const x = this.options.mirrorX ? 1 - center.x : center.x;
      this.motion.push({ timestampMs: observation.timestampMs, x });
      const cutoff = observation.timestampMs - this.options.swipeWindowMs;
      this.motion = this.motion.filter((sample) => sample.timestampMs >= cutoff);
      const first = this.motion[0];
      const last = this.motion.at(-1);
      if (
        first &&
        last &&
        observation.timestampMs - this.lastSwipeAt > this.options.swipeWindowMs + 200 &&
        Math.abs(last.x - first.x) >= this.options.swipeDistance
      ) {
        const visualDirection = Math.sign(last.x - first.x);
        // Moving the hand left advances the video; moving right goes back.
        const seconds = visualDirection < 0 ? this.options.seekSeconds : -this.options.seekSeconds;
        commands.push(
          createCommandEnvelope("gesture", { type: "video.seekBy", seconds }, {
            confidence: observation.score,
            createdAt: observation.timestampMs,
            gesture: `Open_Palm_Swipe_${visualDirection < 0 ? "Left" : "Right"}`
          })
        );
        this.lastSwipeAt = observation.timestampMs;
        this.motion = [];
      }
    } else {
      this.motion = [];
    }

    commands.push(...this.pointerCommands(observation, gesture));
    return commands;
  }

  private updateStableGesture(gesture: string, timestampMs: number) {
    if (gesture === this.stableGesture) return;
    this.stableGesture = gesture;
    this.stableSince = timestampMs;
    this.stableFired = false;
  }

  private stableCommand(gesture: string, confidence: number, timestampMs: number): CommandEnvelope | null {
    const metadata = { confidence, createdAt: timestampMs, gesture };
    switch (gesture) {
      case "Thumb_Up":
        return createCommandEnvelope("gesture", { type: "video.markReviewed" }, metadata);
      case "Victory":
        return createCommandEnvelope("gesture", { type: "video.copyPreviousBoxes" }, metadata);
      case "ILoveYou":
        return createCommandEnvelope("gesture", { type: "controls.arm" }, metadata);
      case "Closed_Fist":
        return createCommandEnvelope("gesture", { type: "controls.disarm" }, metadata);
      default:
        return null;
    }
  }

  private pointerCommands(observation: GestureObservation, gesture: string): CommandEnvelope[] {
    const matrix = this.options.homography;
    const landmarks = observation.landmarks;
    if (!matrix || landmarks.length < 18 || (!this.pinchPressed && gesture !== "Pointing_Up" && gesture !== "None")) {
      if (this.pinchPressed && (!matrix || landmarks.length < 18)) this.pinchPressed = false;
      return [];
    }

    const indexTip = landmarks[8];
    const cameraPoint: Point2 = {
      x: this.options.mirrorX ? 1 - indexTip.x : indexTip.x,
      y: indexTip.y
    };
    const mapped = applyHomography(matrix, cameraPoint);
    if (!mapped) return [];
    const point = clampUnitPoint(mapped);
    const confidence = Math.max(observation.score, 0.75);
    const metadata = {
      confidence,
      createdAt: observation.timestampMs,
      gesture: gesture || "Pointer"
    };
    const commands = [createCommandEnvelope("gesture", { type: "pointer.move", ...point }, metadata)];

    const palmWidth = Math.max(0.001, distance(landmarks[5], landmarks[17]));
    const pinchRatio = distance(landmarks[4], landmarks[8]) / palmWidth;
    if (!this.pinchPressed && pinchRatio <= 0.32) {
      this.pinchPressed = true;
      commands.push(createCommandEnvelope("gesture", { type: "pointer.press", ...point }, metadata));
    } else if (this.pinchPressed && pinchRatio >= 0.48) {
      this.pinchPressed = false;
      commands.push(createCommandEnvelope("gesture", { type: "pointer.release", ...point }, metadata));
    }
    return commands;
  }
}
