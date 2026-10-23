import { useEffect, useRef, useState, type RefObject } from "react";
import { ensureVideoProxy, videoSourceUrl } from "../video/videoCaptureApi";
import type { PoseData } from "./mocapApi";
import { boneSide, imagePoint, inferredSet, jointLabel, sample } from "./mocapDomain";
import { canvasColors, fitCanvas } from "./mocapCanvas";

type Props = {
  workspaceRoot: string;
  video: string;
  videoRef: RefObject<HTMLVideoElement>;
  pose: PoseData | null;
  comparison: PoseData | null;
  frame: number;
  showLabels: boolean;
  selectedJoint: number | null;
  onSelectJoint: (joint: number | null) => void;
  /** Drag correction mode: dragging a joint reports its move in source pixels. */
  editMode?: boolean;
  onDragJoint?: (joint: number, dragPx: [number, number]) => void;
  onTime: (seconds: number) => void;
  onPlayingChange: (playing: boolean) => void;
};

/** Source video with the observed 2D joints drawn over it in source-pixel space. */
export function MocapStage({
  workspaceRoot,
  video,
  videoRef,
  pose,
  comparison,
  frame,
  showLabels,
  selectedJoint,
  onSelectJoint,
  editMode = false,
  onDragJoint,
  onTime,
  onPlayingChange
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(video);
  const [videoError, setVideoError] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  // A joint being dragged: only it moves until the engine answers (Studio rule).
  const [drag, setDrag] = useState<{ joint: number; startX: number; startY: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    setSource(video);
    setVideoError("");
  }, [video]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Playback drives the frame. Per-frame callbacks report the presented frame's
  // media time; timeupdate/seeked keep the overlay right when the window is in
  // the background and frame callbacks are throttled.
  useEffect(() => {
    const element = videoRef.current as FrameCallbackVideo | null;
    if (!element) return;
    const perFrame = typeof element.requestVideoFrameCallback === "function";
    let handle = 0;
    let running = false;
    const onFrame = (_now: number, metadata?: { mediaTime: number }) => {
      if (!running) return;
      onTime(metadata?.mediaTime ?? element.currentTime);
      schedule();
    };
    const schedule = () => {
      handle = perFrame ? element.requestVideoFrameCallback!(onFrame) : requestAnimationFrame((now) => onFrame(now));
    };
    const stop = () => {
      running = false;
      if (perFrame) element.cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
    };
    const play = () => {
      onPlayingChange(true);
      if (!running) {
        running = true;
        schedule();
      }
    };
    const pause = () => {
      stop();
      onPlayingChange(false);
      onTime(element.currentTime);
    };
    const sync = () => onTime(element.currentTime);
    element.addEventListener("play", play);
    element.addEventListener("pause", pause);
    element.addEventListener("ended", pause);
    element.addEventListener("timeupdate", sync);
    element.addEventListener("seeked", sync);
    // This effect re-runs when the handlers change (loop or range toggled during playback).
    if (!element.paused) play();
    return () => {
      stop();
      element.removeEventListener("play", play);
      element.removeEventListener("pause", pause);
      element.removeEventListener("ended", pause);
      element.removeEventListener("timeupdate", sync);
      element.removeEventListener("seeked", sync);
    };
  }, [videoRef, onTime, onPlayingChange]);

  const box = contentBox(size, pose);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = fitCanvas(canvas, size.width, size.height);
    if (!context || !pose || frame >= pose.times.length) return;
    const colors = canvasColors(canvas);
    const toScreen = ([x, y]: [number, number]): [number, number] => [box.x + x * box.scale, box.y + y * box.scale];
    if (comparison && frame < comparison.times.length) {
      drawSkeleton(context, comparison, frame, toScreen, { ghost: true, colors, selectedJoint: null, inferred: new Set() });
    }
    const moved = drag && box.scale ? { joint: drag.joint, dx: drag.dx / box.scale, dy: drag.dy / box.scale } : null;
    drawSkeleton(context, pose, frame, toScreen, { ghost: false, colors, selectedJoint, inferred: inferredSet(pose), labels: showLabels, moved });
  }, [pose, comparison, frame, size, box.x, box.y, box.scale, showLabels, selectedJoint, drag]);

  function pick(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!pose) return;
    const joint = jointAt(event);
    onSelectJoint(joint);
    if (editMode && joint !== null && onDragJoint) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ joint, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
    }
  }

  function moveDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (drag) setDrag({ ...drag, dx: event.clientX - drag.startX, dy: event.clientY - drag.startY });
  }

  function endDrag() {
    if (!drag) return;
    setDrag(null);
    if (box.scale && Math.hypot(drag.dx, drag.dy) >= 1) {
      onDragJoint?.(drag.joint, [drag.dx / box.scale, drag.dy / box.scale]);
    }
  }

  function jointAt(event: React.PointerEvent<HTMLCanvasElement>): number | null {
    if (!pose) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best: number | null = null;
    let bestDistance = 14;
    pose.joints.forEach((_, joint) => {
      const [x, y] = imagePoint(pose, frame, joint);
      const distance = Math.hypot(box.x + x * box.scale - px, box.y + y * box.scale - py);
      if (distance < bestDistance) {
        best = joint;
        bestDistance = distance;
      }
    });
    return best;
  }

  async function switchToProxy() {
    setVideoError("正在生成可播放的预览副本…");
    try {
      const result = await ensureVideoProxy(workspaceRoot, video);
      setSource(result.path);
      setVideoError("");
    } catch (error) {
      setVideoError(`无法播放此视频：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="mc-stage" ref={wrapRef}>
      <video
        ref={videoRef}
        className="mc-stage__video"
        src={videoSourceUrl(workspaceRoot, source)}
        preload="auto"
        playsInline
        muted
        onLoadedMetadata={(event) => onTime(event.currentTarget.currentTime)}
        onError={() => (source === video ? void switchToProxy() : setVideoError("预览副本也无法播放。"))}
      />
      <canvas
        ref={canvasRef}
        className={`mc-stage__overlay${editMode ? " is-editing" : ""}`}
        onPointerDown={pick}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      />
      {videoError ? <div className="mc-stage__notice">{videoError}</div> : null}
    </div>
  );
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Where the source frame sits inside the stage (object-fit: contain). */
function contentBox(size: { width: number; height: number }, pose: PoseData | null) {
  const width = pose?.width || 16;
  const height = pose?.height || 9;
  const scale = Math.min(size.width / width, size.height / height) || 0;
  return { scale, x: (size.width - width * scale) / 2, y: (size.height - height * scale) / 2 };
}

type DrawOptions = {
  ghost: boolean;
  colors: ReturnType<typeof canvasColors>;
  selectedJoint: number | null;
  inferred: Set<number>;
  labels?: boolean;
  /** Preview offset of a dragged joint, in source pixels. */
  moved?: { joint: number; dx: number; dy: number } | null;
};

function drawSkeleton(
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
