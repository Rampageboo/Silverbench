/**
 * Display rules for motion capture, ported from AniMocap Studio (gui_main.cpp) so
 * both front ends show the same frame, projection and names. No motion maths
 * lives here: every edit goes through the engine.
 */
import type { PoseData, Take } from "./mocapApi";

export const JOINT_LABELS: Record<string, string> = {
  sceneRoot: "根节点",
  hips: "骨盆",
  spine: "脊柱",
  chest: "胸部",
  upperChest: "上胸",
  neck: "颈部",
  head: "头部",
  leftShoulder: "左锁骨",
  leftUpperArm: "左肩",
  leftLowerArm: "左肘",
  leftHand: "左手",
  rightShoulder: "右锁骨",
  rightUpperArm: "右肩",
  rightLowerArm: "右肘",
  rightHand: "右手",
  leftUpperLeg: "左髋",
  leftLowerLeg: "左膝",
  leftFoot: "左踝",
  leftToes: "左脚尖",
  rightUpperLeg: "右髋",
  rightLowerLeg: "右膝",
  rightFoot: "右踝",
  rightToes: "右脚尖"
};

export function jointLabel(semantic: string) {
  return JOINT_LABELS[semantic] ?? semantic;
}

export type BoneSide = "center" | "left" | "right";

export function boneSide(semantic: string): BoneSide {
  if (semantic.startsWith("left")) return "left";
  if (semantic.startsWith("right")) return "right";
  return "center";
}

/** Capture stage codes from backend/mocap/progress.py, in Studio's words. */
export const STAGE_LABELS: Record<string, string> = {
  loading_models: "正在加载模型",
  pose: "HRNet + 光流动作捕捉",
  visual_recovery_starting: "正在启动本地视觉纠错",
  visual_recovery: "本地视觉纠错",
  visual_recovery_finishing: "正在整理视觉纠错结果",
  pose_per_view: "逐视角提取关节",
  visual_recovery_per_view: "逐视角本地视觉纠错",
  multiview_solve: "相位对齐与多视角联合求解",
  triangulation: "标定透视三角化",
  kinematic_reconstruction: "运动学重建",
  refining: "骨架优化",
  building: "生成动作",
  finishing: "正在整理动作数据",
  failing: "正在整理失败信息"
};

const STATUS_LABELS: Record<string, string> = {
  new: "未捕捉",
  capturing: "捕捉中",
  cancelling: "正在取消",
  ready: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

export function statusLabel(take: Take) {
  return STATUS_LABELS[take.capture.status] ?? take.capture.status;
}

export const ISSUE_REASONS: Record<string, string> = {
  left_right_swap: "左右交换",
  missing_joints: "关节缺失",
  gpu_npu_disagreement: "双设备分歧"
};

/** Studio ``format_elapsed``. */
export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 1) return "计算中";
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}秒`;
  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) return `${minutes}分${rounded % 60}秒`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}

/**
 * Pose frame shown at a source time: the nearest frame by ``time_s`` (Studio
 * ``pose_frame``). Frames come from the engine's timestamps, never from
 * ``currentTime * fps``, so variable frame rates and offsets stay aligned.
 */
export function frameAtTime(times: readonly number[], time: number) {
  if (!times.length) return 0;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < time) low = middle + 1;
    else high = middle;
  }
  if (low >= times.length) return times.length - 1;
  if (low === 0) return 0;
  return Math.abs(times[low - 1] - time) < Math.abs(times[low] - time) ? low - 1 : low;
}

export type Vec3 = [number, number, number];

export function jointCount(pose: PoseData) {
  return pose.joints.length;
}

export function imagePoint(pose: PoseData, frame: number, joint: number): [number, number] {
  const k = (frame * pose.joints.length + joint) * 2;
  return [pose.image[k], pose.image[k + 1]];
}

export function worldPoint(pose: PoseData, frame: number, joint: number): Vec3 {
  const k = (frame * pose.joints.length + joint) * 3;
  return [pose.position[k], pose.position[k + 1], pose.position[k + 2]];
}

export function sample(pose: PoseData, frame: number, joint: number) {
  const k = frame * pose.joints.length + joint;
  return { confidence: pose.confidence[k], valid: pose.valid[k] === 1 };
}

export function framePositions(pose: PoseData, frame: number): Vec3[] {
  return pose.joints.map((_, joint) => worldPoint(pose, frame, joint));
}

export type Projection = {
  project: (point: Vec3) => [number, number];
  depth: (point: Vec3) => number;
  floorY: number;
  scale: number;
};

/** Studio ``make_motion_projection``: orbit by yaw/pitch, fit to the viewport, feet on the floor line. */
export function makeProjection(
  yawDegrees: number,
  pitchDegrees: number,
  viewport: { width: number; height: number },
  positions: readonly Vec3[],
  comparison: readonly Vec3[] = [],
  padding = 22
): Projection {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const raw = ([x, y, z]: Vec3): [number, number] => {
    const rx = cy * x + sy * z;
    const rz = -sy * x + cy * z;
    return [rx, cp * y - sp * rz];
  };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of [...positions, ...comparison]) {
    const [px, py] = raw(point);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    [minX, maxX, minY, maxY] = [-1, 1, 0, 1];
  }
  const width = Math.max(0.1, maxX - minX);
  const height = Math.max(0.1, maxY - minY);
  const scale = Math.min(Math.max(24, viewport.width - padding * 2) / width, Math.max(24, viewport.height - padding * 2) / height);
  const originX = viewport.width / 2 - ((minX + maxX) / 2) * scale;
  const floorY = viewport.height - padding;
  const originY = floorY + minY * scale;
  return {
    project: (point) => {
      const [px, py] = raw(point);
      return [originX + px * scale, originY - py * scale];
    },
    depth: ([x, y, z]) => sp * y + cp * (-sy * x + cy * z),
    floorY,
    scale
  };
}

/**
 * Frames where a valid observed joint is below the Studio low-confidence line
 * (0.35). Inferred samples have confidence 0 by contract and are listed apart.
 */
export function lowConfidenceFrames(pose: PoseData, threshold = 0.35) {
  const joints = pose.joints.length;
  const inferred = inferredSet(pose);
  const frames: number[] = [];
  for (let frame = 0; frame < pose.times.length; frame++) {
    for (let joint = 0; joint < joints; joint++) {
      const k = frame * joints + joint;
      if (pose.valid[k] === 1 && pose.confidence[k] < threshold && !inferred.has(k)) {
        frames.push(frame);
        break;
      }
    }
  }
  return frames;
}

/** Group consecutive frame numbers into inclusive ranges for a compact list. */
export function frameRuns(frames: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const frame of frames) {
    const last = runs[runs.length - 1];
    if (last && frame === last[1] + 1) last[1] = frame;
    else runs.push([frame, frame]);
  }
  return runs;
}

export function inferredSet(pose: PoseData) {
  return new Set(pose.inferred.map(([frame, joint]) => frame * pose.joints.length + joint));
}

/** Millimetre distance between two poses at one joint, for the A/B depth readout. */
export function distanceMm(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000;
}
