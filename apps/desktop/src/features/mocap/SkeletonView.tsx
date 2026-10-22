import { useEffect, useRef, useState } from "react";
import type { PoseData } from "./mocapApi";
import { boneSide, distanceMm, framePositions, inferredSet, jointLabel, makeProjection, sample, worldPoint, type Vec3 } from "./mocapDomain";
import { canvasColors, fitCanvas } from "./mocapCanvas";

type Props = {
  pose: PoseData | null;
  comparison: PoseData | null;
  frame: number;
  selectedJoint: number | null;
};

const DEFAULT_VIEW = { yaw: 28, pitch: -8 }; // Studio's opening angle

/** Observed 3D joints with Studio's orbit projection; drag to turn, double-click to reset. */
export function SkeletonView({ pose, comparison, frame, selectedJoint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState(DEFAULT_VIEW);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const hasComparison = !!comparison && frame < comparison.times.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = fitCanvas(canvas, size.width, size.height);
    if (!context || !pose || frame >= pose.times.length) return;
    const colors = canvasColors(canvas);
    const positions = framePositions(pose, frame);
    const ghost: Vec3[] = hasComparison
      ? comparison!.joints.map((_, joint) => worldPoint(comparison!, frame, joint)).filter((_, joint) => sample(comparison!, frame, joint).valid)
      : [];
    const projection = makeProjection(view.yaw, view.pitch, size, positions, ghost);

    context.strokeStyle = colors.floor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, projection.floorY);
    context.lineTo(size.width, projection.floorY);
    context.stroke();

    const drawBones = (data: PoseData, isGhost: boolean) => {
      context.save();
      context.lineCap = "round";
      context.globalAlpha = isGhost ? 0.4 : 1;
      if (isGhost) context.setLineDash([5, 4]);
      // Far bones first so near limbs stay on top.
      const order = data.parents
        .map((parent, joint) => ({ parent, joint, depth: projection.depth(worldPoint(data, frame, joint)) }))
        .filter(({ parent }) => parent >= 0)
        .sort((a, b) => b.depth - a.depth);
      for (const { parent, joint } of order) {
        if (!sample(data, frame, parent).valid || !sample(data, frame, joint).valid) continue;
        const [x1, y1] = projection.project(worldPoint(data, frame, parent));
        const [x2, y2] = projection.project(worldPoint(data, frame, joint));
        context.strokeStyle = isGhost ? colors.ghost : colors.side[boneSide(data.joints[joint])];
        context.lineWidth = isGhost ? 2 : 4;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      }
      context.restore();
    };
    if (hasComparison) drawBones(comparison!, true);
    drawBones(pose, false);

    const inferred = inferredSet(pose);
    pose.joints.forEach((semantic, joint) => {
      if (!sample(pose, frame, joint).valid) return;
      const [x, y] = projection.project(positions[joint]);
      context.beginPath();
      context.arc(x, y, joint === selectedJoint ? 5 : 3, 0, Math.PI * 2);
      if (inferred.has(frame * pose.joints.length + joint)) {
        context.strokeStyle = colors.inferred;
        context.lineWidth = 2;
        context.stroke();
      } else {
        context.fillStyle = colors.side[boneSide(semantic)];
        context.fill();
      }
      if (joint === selectedJoint) {
        context.strokeStyle = colors.selection;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, y, 9, 0, Math.PI * 2);
        context.stroke();
      }
    });
  }, [pose, comparison, hasComparison, frame, size, view, selectedJoint]);

  const readout =
    pose && selectedJoint !== null && frame < pose.times.length
      ? {
          name: jointLabel(pose.joints[selectedJoint]),
          confidence: sample(pose, frame, selectedJoint).confidence,
          depth: worldPoint(pose, frame, selectedJoint)[2],
          delta: hasComparison ? distanceMm(worldPoint(pose, frame, selectedJoint), worldPoint(comparison!, frame, selectedJoint)) : null
        }
      : null;

  return (
    <div className="mc-skeleton">
      <div className="mc-skeleton__tools">
        <button type="button" className="ui-btn--sm" onClick={() => setView({ yaw: 0, pitch: 0 })}>
          正面
        </button>
        <button type="button" className="ui-btn--sm" onClick={() => setView({ yaw: 90, pitch: 0 })}>
          侧面
        </button>
        <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => setView(DEFAULT_VIEW)}>
          重置视角
        </button>
      </div>
      <div
        className="mc-skeleton__view"
        ref={wrapRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ...view };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setView({
            yaw: start.yaw + (event.clientX - start.x) * 0.4,
            pitch: Math.max(-80, Math.min(80, start.pitch - (event.clientY - start.y) * 0.4))
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setView(DEFAULT_VIEW)}
      >
        <canvas ref={canvasRef} />
      </div>
      <div className="mc-skeleton__readout">
        {readout ? (
          <>
            <strong>{readout.name}</strong>
            <span>置信度 {readout.confidence.toFixed(2)}</span>
            <span>深度 {readout.depth.toFixed(3)} m</span>
            {readout.delta !== null ? <span>与叠影相差 {readout.delta.toFixed(0)} mm</span> : null}
          </>
        ) : (
          <span className="mc-muted">单目视频的深度是估计值 · 点击视频上的关节查看</span>
        )}
      </div>
    </div>
  );
}
