import { useRef, useState } from "react";
import { videoFrameUrl } from "../video/videoCaptureApi";

type Roi = [number, number, number, number];

/**
 * 人物范围: draw the box the person stays in, on the first frame, in source
 * pixels. Without one the capture finds the person automatically. Exclude
 * wings, weapons, pets and game UI from the box.
 */
export function PersonFrame({
  workspaceRoot,
  video,
  roi,
  disabled,
  onChange
}: {
  workspaceRoot: string;
  video: string;
  roi: Roi | null;
  disabled: boolean;
  onChange: (roi: Roi | null) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  // The full-size frame (maxEdge 4096) so its natural size is the video's pixel size.
  const src = videoFrameUrl(workspaceRoot, video, 0, 4096, 70);

  function toSource(event: React.PointerEvent<HTMLDivElement>) {
    const image = imageRef.current;
    if (!image || !natural) return null;
    const rect = image.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    return { x: (x / rect.width) * natural.width, y: (y / rect.height) * natural.height };
  }

  const shown = draft
    ? [
        Math.min(draft.x0, draft.x1),
        Math.min(draft.y0, draft.y1),
        Math.abs(draft.x1 - draft.x0),
        Math.abs(draft.y1 - draft.y0)
      ]
    : roi;

  return (
    <div className="mc-edit">
      <div
        className="mc-roi"
        onPointerDown={(event) => {
          if (disabled) return;
          const point = toSource(event);
          if (!point) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraft({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
        }}
        onPointerMove={(event) => {
          const point = draft && toSource(event);
          if (point) setDraft({ ...draft, x1: point.x, y1: point.y });
        }}
        onPointerUp={() => {
          if (!draft) return;
          const box: Roi = [
            Math.round(Math.min(draft.x0, draft.x1)),
            Math.round(Math.min(draft.y0, draft.y1)),
            Math.round(Math.abs(draft.x1 - draft.x0)),
            Math.round(Math.abs(draft.y1 - draft.y0))
          ];
          setDraft(null);
          if (box[2] >= 16 && box[3] >= 16) onChange(box);
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt="第一帧"
          draggable={false}
          onLoad={(event) =>
            setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }
        />
        {shown && natural ? (
          <div
            className="mc-roi__box"
            style={{
              left: `${(shown[0] / natural.width) * 100}%`,
              top: `${(shown[1] / natural.height) * 100}%`,
              width: `${(shown[2] / natural.width) * 100}%`,
              height: `${(shown[3] / natural.height) * 100}%`
            }}
          />
        ) : null}
      </div>
      <div className="mc-inline">
        <span className="mc-muted">
          {roi
            ? `人物范围 ${roi[2]}×${roi[3]}（左上 ${roi[0]}, ${roi[1]}）`
            : "自动人物范围 · 在画面上拖出一个框可手动指定"}
        </span>
        <span className="mc-spacer" />
        {roi ? (
          <button
            type="button"
            className="ui-btn--ghost ui-btn--sm"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            改回自动
          </button>
        ) : null}
      </div>
      <p className="mc-muted">框住人物活动的整个范围，不包括翅膀、武器、宠物和游戏界面。</p>
    </div>
  );
}
