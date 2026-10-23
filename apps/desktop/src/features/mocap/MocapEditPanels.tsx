import type { PoseData } from "./mocapApi";
import { jointLabel } from "./mocapDomain";
import {
  CURVE_LABELS,
  deleteKeyframe,
  exclude,
  isPending,
  keyframes,
  marksFor,
  rangesFor,
  rebuildRange,
  restoreAuto,
  setCurveAt,
  toggleSmoothing,
  trustCurrent,
  type CurvePreset,
  type EditSession
} from "./mocapEdits";
import type { FrameRange } from "./MocapTimeline";

type Change = (build: (edits: EditSession) => EditSession) => void;

const TRUST_LABELS = { locked: "锁定", weighted: "加权", excluded: "排除" } as const;

/** 手动修正: drag keyframes on the video, their curves, smoothing, undo/redo. */
export function KeyframePanel({
  edits,
  frame,
  curve,
  onCurve,
  editMode,
  onEditMode,
  dragAllowed,
  canUndo,
  canRedo,
  busy,
  onChange,
  onUndo,
  onRedo,
  onSeek
}: {
  edits: EditSession;
  frame: number;
  curve: CurvePreset;
  onCurve: (curve: CurvePreset) => void;
  editMode: boolean;
  onEditMode: (value: boolean) => void;
  dragAllowed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  onChange: Change;
  onUndo: () => void;
  onRedo: () => void;
  onSeek: (frame: number) => void;
}) {
  const keys = keyframes(edits);
  const atKey = keys.includes(frame);
  return (
    <div className="mc-edit">
      <div className="mc-inline">
        <label className="mc-check" title={dragAllowed ? "在视频上拖动关节，生成当前帧的关键帧" : undefined}>
          <input type="checkbox" checked={editMode && dragAllowed} disabled={!dragAllowed} onChange={(event) => onEditMode(event.target.checked)} />
          拖动修正
        </label>
        <select
          value={curve}
          onChange={(event) => {
            const next = event.target.value as CurvePreset;
            onCurve(next);
            if (atKey) onChange((current) => setCurveAt(current, frame, next));
          }}
          title="影响曲线：用于下一次拖动；在关键帧上时也应用到该关键帧"
        >
          {Object.entries(CURVE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              曲线 · {label}
            </option>
          ))}
        </select>
        <span className="mc-spacer" />
        <button type="button" className="ui-btn--sm" onClick={onUndo} disabled={!canUndo || busy} title="撤销 (Ctrl+Z)">
          撤销
        </button>
        <button type="button" className="ui-btn--sm" onClick={onRedo} disabled={!canRedo || busy} title="重做 (Ctrl+Y)">
          重做
        </button>
      </div>
      {!dragAllowed ? <p className="mc-muted">多视角动作的拖动方向尚未按参考视角校正，暂不可拖动；锁定、排除和区间重建可用。</p> : null}
      <div className="mc-inline">
        <button type="button" className="ui-btn--sm" disabled={!atKey || busy} onClick={() => onChange((current) => toggleSmoothing(current, frame))}>
          {edits.smoothedKeyframes.includes(frame) ? "取消关键帧平滑" : "以此关键帧平滑"}
        </button>
        <button type="button" className="ui-btn--sm" disabled={!atKey || busy} onClick={() => onChange((current) => deleteKeyframe(current, frame))} title="Delete">
          删除当前键
        </button>
      </div>
      {keys.length ? (
        <div className="mc-chips">
          {keys.map((key) => (
            <button key={key} type="button" className={`mc-chip${key === frame ? " is-active" : ""}`} onClick={() => onSeek(key)}>
              ◆ {key}
              {edits.smoothedKeyframes.includes(key) ? " · 平滑" : ""}
            </button>
          ))}
        </div>
      ) : (
        <p className="mc-muted">没有关键帧。打开"拖动修正"后在视频上拖动错位的关节。</p>
      )}
    </div>
  );
}

/** 按部位修复: lock, weight or exclude the selected joint, then rebuild a range. */
export function JointRepairPanel({
  pose,
  edits,
  joint,
  frame,
  range,
  busy,
  onChange,
  onSeek
}: {
  pose: PoseData;
  edits: EditSession;
  joint: number | null;
  frame: number;
  range: FrameRange;
  busy: boolean;
  onChange: Change;
  onSeek: (frame: number) => void;
}) {
  if (joint === null) return <p className="mc-muted">点击视频上的关节选择要修复的部位。</p>;
  const span = range ?? { first: frame, last: frame };
  const marks = marksFor(edits, joint);
  const ranges = rangesFor(edits, joint);
  return (
    <div className="mc-edit">
      <div className="mc-inline">
        <strong>{jointLabel(pose.joints[joint])}</strong>
        <span className="mc-muted">帧 {frame}{range ? ` · 区间 ${range.first}–${range.last}` : ""}</span>
      </div>
      <div className="mc-inline">
        <button type="button" className="ui-btn--sm" disabled={busy} onClick={() => onChange((current) => trustCurrent(current, pose, joint, frame, "locked"))}>
          锁定此帧
        </button>
        <span className="mc-muted">可信权重</span>
        {[4, 8, 16].map((weight) => (
          <button
            key={weight}
            type="button"
            className="ui-btn--sm"
            disabled={busy}
            onClick={() => onChange((current) => trustCurrent(current, pose, joint, frame, "weighted", weight))}
          >
            {weight}×
          </button>
        ))}
      </div>
      <div className="mc-inline">
        <button type="button" className="ui-btn--sm" disabled={busy} onClick={() => onChange((current) => exclude(current, joint, span.first, span.last))}>
          排除此部位
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          disabled={busy || !range}
          title={range ? "区间两端必须先锁定" : "先在时间轴上设起点/终点"}
          onClick={() => range && onChange((current) => rebuildRange(current, joint, range.first, range.last))}
        >
          重建区间
        </button>
        <button type="button" className="ui-btn--sm" disabled={busy} onClick={() => onChange((current) => restoreAuto(current, joint, span.first, span.last))}>
          恢复自动
        </button>
      </div>
      <p className="mc-muted">锁定与加权作用于当前帧；排除与恢复自动作用于选区（无选区时为当前帧）。重建区间要求两端锁定，缺口不超过 0.75 秒。</p>
      {ranges.length ? (
        <div className="mc-chips">
          {ranges.map(([first, last]) => (
            <button key={`${first}-${last}`} type="button" className="mc-chip mc-chip--range" onClick={() => onSeek(first)}>
              重建 {first}–{last}
            </button>
          ))}
        </div>
      ) : null}
      {marks.length ? (
        <div className="mc-chips">
          {marks.slice(0, 80).map((mark) => (
            <button
              key={`${mark.frame}-${mark.trust}`}
              type="button"
              className={`mc-chip mc-chip--${mark.trust}${isPending(edits, mark) ? " is-pending" : ""}`}
              onClick={() => onSeek(mark.frame)}
              title={isPending(edits, mark) ? "尚未生效：需要覆盖它的重建区间" : undefined}
            >
              {TRUST_LABELS[mark.trust]}
              {mark.trust === "weighted" ? ` ${mark.weight}×` : ""} {mark.frame}
              {isPending(edits, mark) ? " · 待重建" : ""}
            </button>
          ))}
          {marks.length > 80 ? <span className="mc-muted">还有 {marks.length - 80} 个</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Frames chosen for the Blender export: its own selection, never the inferred or locked frames. */
export function BlenderFramesPanel({
  frames,
  frame,
  range,
  busy,
  onToggle,
  onAddRange,
  onClear,
  onExport
}: {
  frames: number[];
  frame: number;
  range: FrameRange;
  busy: boolean;
  onToggle: () => void;
  onAddRange: () => void;
  onClear: () => void;
  onExport: () => void;
}) {
  return (
    <div className="mc-edit">
      <div className="mc-inline">
        <button type="button" className="ui-btn--sm" onClick={onToggle} title="B">
          {frames.includes(frame) ? "取消选中此帧" : "选中此帧"}
        </button>
        <button type="button" className="ui-btn--sm" onClick={onAddRange} disabled={!range}>
          选中区间
        </button>
        <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={onClear} disabled={!frames.length}>
          清除
        </button>
      </div>
      <div className="mc-inline">
        <span className="mc-muted">已选 {frames.length} 帧 · 导出完整姿态，在 Blender 新建 Action</span>
        <span className="mc-spacer" />
        <button type="button" onClick={onExport} disabled={!frames.length || busy}>
          导出到 Blender
        </button>
      </div>
    </div>
  );
}
