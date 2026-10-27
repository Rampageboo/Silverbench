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

const TRUST_LABELS = { locked: "Locked", weighted: "Weighted", excluded: "Excluded" } as const;

/** Keyframes: drag keyframes on the video, their curves, smoothing, undo/redo. */
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
        <label className="mc-check">
          <input
            type="checkbox"
            checked={editMode && dragAllowed}
            disabled={!dragAllowed}
            onChange={(event) => onEditMode(event.target.checked)}
          />
          Drag to fix
        </label>
        <select
          value={curve}
          onChange={(event) => {
            const next = event.target.value as CurvePreset;
            onCurve(next);
            if (atKey) onChange((current) => setCurveAt(current, frame, next));
          }}
        >
          {Object.entries(CURVE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              Curve · {label}
            </option>
          ))}
        </select>
        <span className="mc-spacer" />
        <button
          type="button"
          className="ui-btn--sm"
          onClick={onUndo}
          disabled={!canUndo || busy}
          title="Ctrl+Z"
        >
          Undo
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          onClick={onRedo}
          disabled={!canRedo || busy}
          title="Ctrl+Y"
        >
          Redo
        </button>
      </div>
      {!dragAllowed ? <p className="mc-muted">Other views are read-only. Switch to Fused to edit</p> : null}
      <div className="mc-inline">
        <button
          type="button"
          className="ui-btn--sm"
          disabled={!atKey || busy}
          onClick={() => onChange((current) => toggleSmoothing(current, frame))}
        >
          {edits.smoothedKeyframes.includes(frame) ? "Unsmooth keyframe" : "Smooth keyframe"}
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          disabled={!atKey || busy}
          onClick={() => onChange((current) => deleteKeyframe(current, frame))}
          title="Delete"
        >
          Delete keyframe
        </button>
      </div>
      {keys.length ? (
        <div className="mc-chips">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              className={`mc-chip${key === frame ? " is-active" : ""}`}
              onClick={() => onSeek(key)}
            >
              ◆ {key}
              {edits.smoothedKeyframes.includes(key) ? " · smooth" : ""}
            </button>
          ))}
        </div>
      ) : (
        <p className="mc-muted">No keyframes. Turn on Drag to fix, then drag a misplaced joint</p>
      )}
    </div>
  );
}

/** Joint repair: lock, weight or exclude the selected joint, then rebuild a range. */
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
  if (joint === null) return <p className="mc-muted">Click a joint on the video to repair it</p>;
  const span = range ?? { first: frame, last: frame };
  const marks = marksFor(edits, joint);
  const ranges = rangesFor(edits, joint);
  return (
    <div className="mc-edit">
      <div className="mc-inline">
        <strong>{jointLabel(pose.joints[joint])}</strong>
        <span className="mc-muted">
          Frame {frame}
          {range ? ` · range ${range.first}–${range.last}` : ""}
        </span>
      </div>
      <div className="mc-inline">
        <button
          type="button"
          className="ui-btn--sm"
          disabled={busy}
          onClick={() => onChange((current) => trustCurrent(current, pose, joint, frame, "locked"))}
        >
          Lock frame
        </button>
        <span className="mc-muted">Weight</span>
        {[4, 8, 16].map((weight) => (
          <button
            key={weight}
            type="button"
            className="ui-btn--sm"
            disabled={busy}
            onClick={() =>
              onChange((current) => trustCurrent(current, pose, joint, frame, "weighted", weight))
            }
          >
            {weight}×
          </button>
        ))}
      </div>
      <div className="mc-inline">
        <button
          type="button"
          className="ui-btn--sm"
          disabled={busy}
          onClick={() => onChange((current) => exclude(current, joint, span.first, span.last))}
        >
          Exclude
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          disabled={busy || !range}
          title={range ? "Lock both ends first" : "Set a range on the timeline first"}
          onClick={() =>
            range && onChange((current) => rebuildRange(current, joint, range.first, range.last))
          }
        >
          Rebuild range
        </button>
        <button
          type="button"
          className="ui-btn--sm"
          disabled={busy}
          onClick={() => onChange((current) => restoreAuto(current, joint, span.first, span.last))}
        >
          Restore auto
        </button>
      </div>
      {ranges.length ? (
        <div className="mc-chips">
          {ranges.map(([first, last]) => (
            <button
              key={`${first}-${last}`}
              type="button"
              className="mc-chip mc-chip--range"
              onClick={() => onSeek(first)}
            >
              Rebuild {first}–{last}
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
              title={isPending(edits, mark) ? "Needs a rebuild range" : undefined}
            >
              {TRUST_LABELS[mark.trust]}
              {mark.trust === "weighted" ? ` ${mark.weight}×` : ""} {mark.frame}
              {isPending(edits, mark) ? " · pending" : ""}
            </button>
          ))}
          {marks.length > 80 ? <span className="mc-muted">{marks.length - 80} more</span> : null}
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
          {frames.includes(frame) ? "Unselect frame" : "Select frame"}
        </button>
        <button type="button" className="ui-btn--sm" onClick={onAddRange} disabled={!range}>
          Select range
        </button>
        <button
          type="button"
          className="ui-btn--ghost ui-btn--sm"
          onClick={onClear}
          disabled={!frames.length}
        >
          Clear
        </button>
      </div>
      <div className="mc-inline">
        <span className="mc-muted">{frames.length} frames selected</span>
        <span className="mc-spacer" />
        <button type="button" onClick={onExport} disabled={!frames.length || busy}>
          Export to Blender
        </button>
      </div>
    </div>
  );
}
