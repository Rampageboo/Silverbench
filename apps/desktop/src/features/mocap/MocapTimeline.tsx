import { useRef } from "react";

export type FrameRange = { first: number; last: number } | null;

export type TimelineMarks = {
  /** Frames flagged by the capture (NPU review). */
  issues: number[];
  /** Frames with a sample the engine inferred (joint review rebuild). */
  inferred: number[];
  /** Frames with a low-confidence observation. */
  lowConfidence: number[];
  /** Drag keyframes (all joints). */
  keyframes?: number[];
  /** The selected joint's review marks and rebuild ranges. */
  locked?: number[];
  weighted?: number[];
  excluded?: number[];
  ranges?: [number, number][];
  /** Frames selected for the Blender export (a separate state). */
  exportFrames?: number[];
};

type Props = {
  frame: number;
  frameCount: number;
  fps: number;
  time: number;
  playing: boolean;
  range: FrameRange;
  loop: boolean;
  marks: TimelineMarks;
  onSeek: (frame: number) => void;
  onTogglePlay: () => void;
  onSetRangeStart: () => void;
  onSetRangeEnd: () => void;
  onClearRange: () => void;
  onToggleLoop: () => void;
};

/** Transport and scrub bar. Frame numbers start at 0 (Studio). */
export function MocapTimeline({
  frame,
  frameCount,
  fps,
  time,
  playing,
  range,
  loop,
  marks,
  onSeek,
  onTogglePlay,
  onSetRangeStart,
  onSetRangeEnd,
  onClearRange,
  onToggleLoop
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const last = Math.max(frameCount - 1, 1);
  const percent = (value: number) => `${(value / last) * 100}%`;

  function seekFromPointer(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    onSeek(Math.round(Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * last));
  }

  return (
    <div className="mc-timeline">
      <div className="mc-timeline__transport">
        <button
          type="button"
          className="ui-btn--sm"
          onClick={() => onSeek(frame - 10)}
          title="Back 10 frames (Shift+←)"
        >
          −10
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          onClick={() => onSeek(frame - 1)}
          title="Previous frame (←)"
        >
          ◀
        </button>
        <button type="button" className="mc-timeline__play ui-btn--sm" onClick={onTogglePlay} title="Space">
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="ui-btn--sm" onClick={() => onSeek(frame + 1)} title="Next frame (→)">
          ▶
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          onClick={() => onSeek(frame + 10)}
          title="Forward 10 frames (Shift+→)"
        >
          +10
        </button>
        <span className="mc-timeline__readout">
          Frame <strong>{frame}</strong> / {Math.max(frameCount - 1, 0)} · {time.toFixed(3)} s ·{" "}
          {fps.toFixed(fps % 1 ? 2 : 0)} fps
        </span>
        <span className="mc-timeline__spacer" />
        <button type="button" className="ui-btn--sm" onClick={onSetRangeStart} title="Set range start (I)">
          Start
        </button>
        <button type="button" className="ui-btn--sm" onClick={onSetRangeEnd} title="Set range end (O)">
          End
        </button>
        <button
          type="button"
          className={`ui-btn--sm${loop ? " is-active" : ""}`}
          aria-pressed={loop}
          onClick={onToggleLoop}
          disabled={!range}
          title="Loop range (L)"
        >
          Loop
        </button>
        {range ? (
          <>
            <span className="mc-timeline__range">
              Range {range.first}–{range.last} ({range.last - range.first + 1} frames)
            </span>
            <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={onClearRange}>
              Clear
            </button>
          </>
        ) : null}
      </div>
      <div
        className="mc-timeline__track"
        ref={trackRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          seekFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) seekFromPointer(event.clientX);
        }}
      >
        {range ? (
          <div
            className="mc-timeline__span"
            style={{ left: percent(range.first), width: percent(range.last - range.first) }}
          />
        ) : null}
        {(marks.ranges ?? []).map(([first, last]) => (
          <div
            key={`r${first}-${last}`}
            className="mc-timeline__rebuild"
            style={{ left: percent(first), width: percent(last - first) }}
          />
        ))}
        <MarkRow className="mc-mark--export" frames={marks.exportFrames ?? []} percent={percent} />
        <MarkRow className="mc-mark--excluded" frames={marks.excluded ?? []} percent={percent} />
        <MarkRow className="mc-mark--weighted" frames={marks.weighted ?? []} percent={percent} />
        <MarkRow className="mc-mark--locked" frames={marks.locked ?? []} percent={percent} />
        <MarkRow className="mc-mark--low" frames={marks.lowConfidence} percent={percent} />
        <MarkRow className="mc-mark--inferred" frames={marks.inferred} percent={percent} />
        <MarkRow className="mc-mark--issue" frames={marks.issues} percent={percent} />
        <MarkRow className="mc-mark--key" frames={marks.keyframes ?? []} percent={percent} />
        <div className="mc-timeline__head" style={{ left: percent(frame) }} />
      </div>
    </div>
  );
}

function MarkRow({
  className,
  frames,
  percent
}: {
  className: string;
  frames: number[];
  percent: (value: number) => string;
}) {
  return (
    <>
      {frames.map((value) => (
        <span key={value} className={`mc-mark ${className}`} style={{ left: percent(value) }} />
      ))}
    </>
  );
}
