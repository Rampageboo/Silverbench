import { useEffect, useRef, useState, type RefObject } from "react";
import { ensureVideoProxy, videoSourceUrl } from "../video/videoCaptureApi";
import type { PoseData } from "./mocapApi";
import { imagePoint, inferredSet } from "./mocapDomain";
import { canvasColors, contentBox, drawSkeleton, fitCanvas } from "./mocapCanvas";

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
  /** The video is ready to seek (first load, or after switching views). */
  onLoaded?: () => void;
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
  onPlayingChange,
  onLoaded
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(video);
  const [videoError, setVideoError] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  // A joint being dragged: only it moves until the engine answers (Studio rule).
  const [drag, setDrag] = useState<{
    joint: number;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
  } | null>(null);
  // After release the joint stays where it was dropped until the engine's pose arrives.
  const [held, setHeld] = useState<{ joint: number; dx: number; dy: number; pose: PoseData } | null>(null);

  useEffect(() => {
    if (!held) return;
    if (held.pose !== pose) {
      setHeld(null);
      return;
    }
    const timer = window.setTimeout(() => setHeld(null), 3000); // refused or failed edit
    return () => window.clearTimeout(timer);
  }, [held, pose]);

  // A new source reports time 0 before it loads; that must not move the timeline.
  const ready = useRef(false);

  useEffect(() => {
    ready.current = false;
    setSource(video);
    setVideoError("");
  }, [video]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
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
      if (ready.current) onTime(metadata?.mediaTime ?? element.currentTime);
      schedule();
    };
    const schedule = () => {
      handle = perFrame
        ? element.requestVideoFrameCallback!(onFrame)
        : requestAnimationFrame((now) => onFrame(now));
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
      if (ready.current) onTime(element.currentTime);
    };
    const sync = () => {
      if (ready.current) onTime(element.currentTime);
    };
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
    const toScreen = ([x, y]: [number, number]): [number, number] => [
      box.x + x * box.scale,
      box.y + y * box.scale
    ];
    if (comparison && frame < comparison.times.length) {
      drawSkeleton(context, comparison, frame, toScreen, {
        ghost: true,
        colors,
        selectedJoint: null,
        inferred: new Set()
      });
    }
    const moved =
      drag && box.scale
        ? { joint: drag.joint, dx: drag.dx / box.scale, dy: drag.dy / box.scale }
        : held && held.pose === pose
          ? held
          : null;
    drawSkeleton(context, pose, frame, toScreen, {
      ghost: false,
      colors,
      selectedJoint,
      inferred: inferredSet(pose),
      labels: showLabels,
      moved
    });
  }, [pose, comparison, frame, size, box.x, box.y, box.scale, showLabels, selectedJoint, drag, held]);

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
    if (pose && box.scale && Math.hypot(drag.dx, drag.dy) >= 1) {
      const dragPx: [number, number] = [drag.dx / box.scale, drag.dy / box.scale];
      setHeld({ joint: drag.joint, dx: dragPx[0], dy: dragPx[1], pose });
      onDragJoint?.(drag.joint, dragPx);
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
    setVideoError("Creating a playable preview copy…");
    try {
      const result = await ensureVideoProxy(workspaceRoot, video);
      setSource(result.path);
      setVideoError("");
    } catch (error) {
      setVideoError(`Cannot play this video: ${error instanceof Error ? error.message : String(error)}`);
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
        onLoadedMetadata={(event) => {
          if (onLoaded) onLoaded();
          else onTime(event.currentTarget.currentTime);
          ready.current = true;
        }}
        onError={() =>
          source === video ? void switchToProxy() : setVideoError("The preview copy cannot be played either")
        }
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
