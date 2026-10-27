import { useState } from "react";
import { useToast } from "../../components/useToast";
import { mocapApi, type EngineStatus, type ExportRequest, type Take, type TakeIssue } from "./mocapApi";
import { ISSUE_REASONS, STAGE_LABELS, formatDuration, frameRuns, statusLabel } from "./mocapDomain";
import type { FrameRange } from "./MocapTimeline";
import { PersonFrame } from "./PersonFrame";

export function TakeList({
  takes,
  selectedId,
  onSelect
}: {
  takes: Take[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!takes.length)
    return <p className="mc-muted mc-pad">No captures yet. Click New capture to pick a video</p>;
  return (
    <ul className="mc-takes">
      {takes.map((take) => (
        <li key={take.id}>
          <button
            type="button"
            className={`mc-take${take.id === selectedId ? " is-selected" : ""}`}
            onClick={() => onSelect(take.id)}
          >
            <span className="mc-take__name">{take.name}</span>
            <span className="mc-take__meta">
              <span className={`mc-status mc-status--${take.capture.status}`}>{statusLabel(take)}</span>
              {take.mode === "multiview" ? `${take.sources.length} views` : "Single view"}
              {take.edits ? ` · ${take.edits.frameCount} frames` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Capture state of a take that has no motion yet, or is being captured. */
export function CapturePanel({
  workspaceRoot,
  take,
  onStart,
  onCancel,
  onRoi
}: {
  workspaceRoot: string;
  take: Take;
  onStart: () => void;
  onCancel: () => void;
  onRoi: (roi: [number, number, number, number] | null) => void;
}) {
  const capture = take.capture;
  if (capture.status === "capturing" || capture.status === "cancelling") {
    const percent = Math.round((capture.fraction ?? 0) * 100);
    return (
      <div className="mc-capture">
        <div className="mc-capture__stage">
          {capture.status === "cancelling"
            ? "Cancelling"
            : (STAGE_LABELS[capture.stage ?? ""] ?? capture.stage)}
          {capture.view && capture.viewCount
            ? ` · view ${capture.viewIndex}/${capture.viewCount} (${capture.view})`
            : ""}
        </div>
        <div className="mc-progress">
          <div className="mc-progress__bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="mc-capture__numbers">
          <span>{percent}%</span>
          {capture.total ? (
            <span>
              Frame {capture.item}/{capture.total}
            </span>
          ) : null}
          <span>Elapsed {formatDuration(capture.elapsedSeconds)}</span>
          <span>
            {capture.remainingSeconds != null
              ? `${formatDuration(capture.remainingSeconds)} left`
              : "Estimating time left"}
          </span>
        </div>
        <button type="button" onClick={onCancel} disabled={capture.status === "cancelling"}>
          Cancel capture
        </button>
      </div>
    );
  }
  return (
    <div className="mc-capture">
      <dl className="mc-facts">
        <dt>Video</dt>
        <dd>
          {take.sources.map((source) => (
            <div key={source.id}>
              {source.video}
              {source.yaw !== undefined ? ` · ${source.yaw}°` : ""}
            </div>
          ))}
        </dd>
        <dt>Options</dt>
        <dd>
          Expert interval {take.options.expertInterval} · {take.options.upscale ? "AI upscale" : "No upscale"}{" "}
          · {take.options.vlm ? "Visual correction" : "No visual correction"}
          {take.options.characterProfile ? " · Character preset" : ""}
        </dd>
      </dl>
      {take.mode === "single" ? (
        <PersonFrame
          workspaceRoot={workspaceRoot}
          video={take.sources[0].video}
          roi={take.options.roi}
          disabled={false}
          onChange={onRoi}
        />
      ) : null}
      {capture.status === "failed" ? <pre className="mc-error">{capture.error}</pre> : null}
      {capture.status === "cancelled" ? (
        <p className="mc-muted">Cancelled. Partial results and logs are kept</p>
      ) : null}
      {capture.status === "interrupted" ? (
        <p className="mc-muted">The app closed during the last capture</p>
      ) : null}
      <button type="button" className="mc-primary" onClick={onStart}>
        {capture.status === "new" ? "Start capture" : "Capture again"}
      </button>
    </div>
  );
}

export function IssuesPanel({
  issues,
  lowConfidence,
  inferredCount,
  onSeek
}: {
  issues: TakeIssue[];
  lowConfidence: number[];
  inferredCount: number;
  onSeek: (frame: number) => void;
}) {
  const runs = frameRuns(lowConfidence);
  if (!issues.length && !runs.length && !inferredCount) return <p className="mc-muted">No issues</p>;
  return (
    <div className="mc-issues">
      {inferredCount ? (
        <p className="mc-muted">{inferredCount} inferred samples (orange) are not observations</p>
      ) : null}
      {issues.map((issue, index) => (
        <button
          key={`${issue.view}-${issue.frame}-${index}`}
          type="button"
          className="mc-issue"
          onClick={() => onSeek(issue.frame)}
        >
          <span>Frame {issue.frame}</span>
          <span className="mc-muted">
            {issue.view} ·{" "}
            {issue.reasons.map((reason) => ISSUE_REASONS[reason] ?? reason).join(" · ") || "Review"}
          </span>
        </button>
      ))}
      {runs.length ? <div className="mc-issues__head">Low confidence (&lt; 0.35)</div> : null}
      {runs.slice(0, 50).map(([first, last]) => (
        <button key={first} type="button" className="mc-issue" onClick={() => onSeek(first)}>
          <span>{first === last ? `Frame ${first}` : `Frames ${first}–${last}`}</span>
        </button>
      ))}
      {runs.length > 50 ? <p className="mc-muted">{runs.length - 50} more</p> : null}
    </div>
  );
}

export function ExportPanel({
  workspaceRoot,
  take,
  range
}: {
  workspaceRoot: string;
  take: Take;
  range: FrameRange;
}) {
  const { showToast } = useToast();
  const [unit, setUnit] = useState<"centimeters" | "meters">("centimeters");
  const [busy, setBusy] = useState(false);

  async function run(format: ExportRequest["format"]) {
    setBusy(true);
    try {
      const result = await mocapApi.export(workspaceRoot, take.id, {
        format,
        unit,
        range: range ? [range.first, range.last] : null
      });
      showToast(`Exported ${result.relativePath}`, { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mc-export">
      <p className="mc-muted">{range ? `Frames ${range.first}–${range.last}` : "Whole take"}</p>
      <div className="mc-inline">
        <select value={unit} onChange={(event) => setUnit(event.target.value as "centimeters" | "meters")}>
          <option value="centimeters">Centimeters</option>
          <option value="meters">Meters</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void run("bvh")}>
          Export BVH
        </button>
        <button type="button" disabled={busy} onClick={() => void run("vrma")}>
          Export VRMA
        </button>
      </div>
    </div>
  );
}

const SETUP_LABELS: Record<string, string> = {
  mmpose: "capture environment (MMPose)",
  local_vlm: "visual correction (Qwen3-VL)",
  openvino_npu: "NPU review (OpenVINO)",
  sam2: "person segmentation (SAM 2.1)"
};

/** What is installed on this computer, and how to install the rest. */
export function EnvironmentPanel({
  status,
  onRefresh
}: {
  status: EngineStatus | null;
  onRefresh: (deep: boolean) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [checking, setChecking] = useState(false);
  if (!status) return <p className="mc-muted">Checking capture engine…</p>;

  async function setup(name: string) {
    try {
      await mocapApi.openSetup(name);
      showToast("Setup opened in a new window. Click Check environment when it finishes", {
        variant: "info"
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  }

  return (
    <div className="mc-env">
      <div className="mc-env__row">
        <span className={`ui-dot ${status.engine.built ? "ui-dot--ok" : "ui-dot--danger"}`} />
        {status.engine.built
          ? `Capture engine ${status.engine.version ?? ""}`
          : "Capture engine not built: run update.bat (needs Visual Studio C++ tools)"}
      </div>
      <div className="mc-env__row">
        <span
          className={`ui-dot ${status.pose?.ready ? "ui-dot--ok" : status.environment.present ? "ui-dot--warn" : "ui-dot--danger"}`}
        />
        {status.pose?.ready
          ? `Capture environment ready${status.pose.cuda ? " · CUDA" : " · CPU only"}`
          : status.environment.present
            ? status.pose?.error
              ? `Capture environment error: ${status.pose.error}`
              : "Capture environment installed (not checked)"
            : "Capture environment not installed"}
      </div>
      {status.vlm ? (
        <div className="mc-env__row">
          <span className={`ui-dot ${status.vlm.ready ? "ui-dot--ok" : "ui-dot--warn"}`} />
          {status.vlm.ready
            ? "Visual correction ready"
            : `Visual correction unavailable${status.vlm.error ? `: ${status.vlm.error}` : ""}`}
        </div>
      ) : null}
      <div className="mc-inline">
        <button
          type="button"
          className="ui-btn--sm"
          disabled={checking || !status.environment.present}
          onClick={async () => {
            setChecking(true);
            try {
              await onRefresh(true);
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? "Checking…" : "Check environment"}
        </button>
        {Object.entries(status.setup)
          .filter(([, present]) => present)
          .map(([name]) => (
            <button
              key={name}
              type="button"
              className="ui-btn--ghost ui-btn--sm"
              onClick={() => void setup(name)}
            >
              Install {SETUP_LABELS[name] ?? name}
            </button>
          ))}
      </div>
      <p className="mc-muted">Setup downloads several GB and may install Python 3.12</p>
    </div>
  );
}
