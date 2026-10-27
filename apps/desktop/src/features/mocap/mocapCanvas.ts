import type { PoseData } from "./mocapApi";
import { boneSide, imagePoint, jointLabel, sample, type BoneSide } from "./mocapDomain";

/** Size a canvas for the device pixel ratio and return a context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

/** Canvas colours from the theme tokens, so drawings follow light/dark mode. */
export function canvasColors(element: Element) {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const side: Record<BoneSide, string> = {
    center: token("--mc-center", "#7aa2ff"),
    left: token("--mc-left", "#4fd1a5"),
    right: token("--mc-right", "#ff9f6b")
  };
  return {
    side,
    ghost: token("--mc-ghost", "rgba(255,255,255,0.7)"),
    inferred: token("--mc-inferred", "#ffb020"),
    selection: token("--mc-selection", "#ffffff"),
    label: token("--mc-label", "#ffffff"),
    labelHalo: token("--mc-label-halo", "rgba(0,0,0,0.75)"),
    grid: token("--mc-grid", "rgba(255,255,255,0.08)"),
    floor: token("--mc-floor", "rgba(255,255,255,0.25)"),
    text: token("--c-text-2", "#cfd6e0"),
    font: token("--font-ui", "system-ui")
  };
}

/** Where the source frame sits inside the stage (object-fit: contain). */
export function contentBox(size: { width: number; height: number }, pose: PoseData | null) {
  const width = pose?.width || 16;
  const height = pose?.height || 9;
  const scale = Math.min(size.width / width, size.height / height) || 0;
  return { scale, x: (size.width - width * scale) / 2, y: (size.height - height * scale) / 2 };
}

export type DrawOptions = {
  ghost: boolean;
  colors: ReturnType<typeof canvasColors>;
  selectedJoint: number | null;
  inferred: Set<number>;
  labels?: boolean;
  /** Preview offset of a dragged joint, in source pixels. */
  moved?: { joint: number; dx: number; dy: number } | null;
};

export function drawSkeleton(
  context: CanvasRenderingContext2D,
  pose: PoseData,
  frame: number,
  toScreen: (point: [number, number]) => [number, number],
  { ghost, colors, selectedJoint, inferred, labels, moved }: DrawOptions
) {
  const point = (joint: number): [number, number] => {
    const [x, y] = imagePoint(pose, frame, joint);
    return moved && moved.joint === joint ? [x + moved.dx, y + moved.dy] : [x, y];
  };
  const joints = pose.joints.length;
  context.save();
  context.lineCap = "round";
  context.globalAlpha = ghost ? 0.45 : 1;
  if (ghost) context.setLineDash([5, 4]);
  pose.parents.forEach((parent, joint) => {
    if (parent < 0) return;
    const a = sample(pose, frame, parent);
    const b = sample(pose, frame, joint);
    if (!a.valid || !b.valid) return;
    const [x1, y1] = toScreen(point(parent));
    const [x2, y2] = toScreen(point(joint));
    context.strokeStyle = ghost ? colors.ghost : colors.side[boneSide(pose.joints[joint])];
    context.lineWidth = ghost ? 2 : 3;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  });
  context.setLineDash([]);
  if (ghost) {
    context.restore();
    return;
  }
  context.font = `12px ${colors.font}`;
  for (let joint = 0; joint < joints; joint++) {
    const { confidence, valid } = sample(pose, frame, joint);
    if (!valid) continue;
    const [x, y] = toScreen(point(joint));
    const isInferred = inferred.has(frame * joints + joint);
    context.globalAlpha = confidence < 0.35 && !isInferred ? 0.5 : 1;
    context.beginPath();
    context.arc(x, y, joint === selectedJoint ? 6 : 4, 0, Math.PI * 2);
    if (isInferred) {
      context.strokeStyle = colors.inferred;
      context.lineWidth = 2;
      context.stroke();
    } else {
      context.fillStyle = colors.side[boneSide(pose.joints[joint])];
      context.fill();
    }
    if (joint === selectedJoint) {
      context.globalAlpha = 1;
      context.strokeStyle = colors.selection;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 10, 0, Math.PI * 2);
      context.stroke();
    }
    if (labels || joint === selectedJoint) {
      context.globalAlpha = 1;
      const text = jointLabel(pose.joints[joint]);
      context.lineWidth = 3;
      context.strokeStyle = colors.labelHalo;
      context.strokeText(text, x + 8, y - 6);
      context.fillStyle = colors.label;
      context.fillText(text, x + 8, y - 6);
    }
  }
  context.restore();
}
