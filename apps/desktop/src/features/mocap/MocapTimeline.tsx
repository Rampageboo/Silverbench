import { useRef } from "react";

export type FrameRange = { first: number; last: number } | null;

export type TimelineMarks = {
  /** Frames flagged by the capture (NPU review). */
  issues: number[];
  /** Frames with a sample the engine inferred (joint review rebuild). */
  inferred: number[];
  /** Frames with a low-confidence observation. */
  lowConfidence: number[];
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
        <button type="button" className="ui-btn--sm" onClick={() => onSeek(frame - 10)} title="后退 10 帧 (Shift+←)">
          −10
        </button>
        <button type="button" className="ui-btn--sm" onClick={() => onSeek(frame - 1)} title="上一帧 (←)">
          ◀
        </button>
        <button type="button" className="mc-timeline__play ui-btn--sm" onClick={onTogglePlay} title="播放/暂停 (空格)">
          {playing ? "暂停" : "播放"}
        </button>
        <button type="button" className="ui-btn--sm" onClick={() => onSeek(frame + 1)} title="下一帧 (→)">
          ▶
        </button>
        <button type="button" className="ui-btn--sm" onClick={() => onSeek(frame + 10)} title="前进 10 帧 (Shift+→)">
          +10
        </button>
        <span className="mc-timeline__readout">
          帧 <strong>{frame}</strong> / {Math.max(frameCount - 1, 0)} · {time.toFixed(3)} s · {fps.toFixed(fps % 1 ? 2 : 0)} fps
        </span>
        <span className="mc-timeline__spacer" />
        <button type="button" className="ui-btn--sm" onClick={onSetRangeStart} title="设为起点 (I)">
          起点
        </button>
        <button type="button" className="ui-btn--sm" onClick={onSetRangeEnd} title="设为终点 (O)">
          终点
        </button>
        <button
          type="button"
          className={`ui-btn--sm${loop ? " is-active" : ""}`}
          aria-pressed={loop}
          onClick={onToggleLoop}
          disabled={!range}
          title="区间循环 (L)"
        >
          循环
        </button>
        {range ? (
          <>
            <span className="mc-timeline__range">
              区间 {range.first}–{range.last}（{range.last - range.first + 1} 帧）
            </span>
            <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={onClearRange}>
              清除
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
        {range ? <div className="mc-timeline__span" style={{ left: percent(range.first), width: percent(range.last - range.first) }} /> : null}
        <MarkRow className="mc-mark--low" frames={marks.lowConfidence} percent={percent} />
        <MarkRow className="mc-mark--inferred" frames={marks.inferred} percent={percent} />
        <MarkRow className="mc-mark--issue" frames={marks.issues} percent={percent} />
        <div className="mc-timeline__head" style={{ left: percent(frame) }} />
      </div>
    </div>
  );
}

function MarkRow({ className, frames, percent }: { className: string; frames: number[]; percent: (value: number) => string }) {
  return (
    <>
      {frames.map((value) => (
        <span key={value} className={`mc-mark ${className}`} style={{ left: percent(value) }} />
      ))}
    </>
  );
}
