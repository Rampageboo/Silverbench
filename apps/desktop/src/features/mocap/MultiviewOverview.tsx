import { useEffect, useRef, useState } from "react";
import { videoFrameUrl } from "../video/videoCaptureApi";
import type { PoseData } from "./mocapApi";
import { canvasColors, drawSkeleton, fitCanvas } from "./mocapCanvas";

export type OverviewTile = {
  /** null = the fused pose on the reference view. */
  id: string | null;
  label: string;
  video: string;
  pose: PoseData;
  frame: number;
  time: number;
};

/**
 * Multiview overview: every view at the current reference time, each with its own 2D
 * pose. Click a view to review it on the reference timeline (read-only).
 */
export function MultiviewOverview({
  workspaceRoot,
  tiles,
  onOpen
}: {
  workspaceRoot: string;
  tiles: OverviewTile[];
  onOpen: (id: string | null) => void;
}) {
  return (
    <div className="mc-overview">
      {tiles.map((tile) => (
        <button
          key={tile.id ?? "fused"}
          type="button"
          className="mc-overview__tile"
          onClick={() => onOpen(tile.id)}
        >
          <OverviewFrame workspaceRoot={workspaceRoot} tile={tile} />
          <span className="mc-overview__label">
            {tile.label} · frame {tile.frame}
          </span>
        </button>
      ))}
    </div>
  );
}

function OverviewFrame({ workspaceRoot, tile }: { workspaceRoot: string; tile: OverviewTile }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(0);
  // Seconds rounded to the frame so moving the playhead does not refetch every pixel of time.
  const seconds = Math.round(tile.time * 1000) / 1000;
  const src = videoFrameUrl(workspaceRoot, tile.video, seconds, 480, 60);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.clientWidth) return;
    const context = fitCanvas(canvas, image.clientWidth, image.clientHeight);
    if (!context || tile.frame >= tile.pose.times.length) return;
    const scale = image.clientWidth / tile.pose.width;
    drawSkeleton(context, tile.pose, tile.frame, ([x, y]) => [x * scale, y * scale], {
      ghost: false,
      colors: canvasColors(canvas),
      selectedJoint: null,
      inferred: new Set()
    });
  }, [tile, loaded]);

  return (
    <span className="mc-overview__frame">
      <img
        ref={imageRef}
        src={src}
        alt={tile.label}
        draggable={false}
        onLoad={() => setLoaded((value) => value + 1)}
      />
      <canvas ref={canvasRef} />
    </span>
  );
}
