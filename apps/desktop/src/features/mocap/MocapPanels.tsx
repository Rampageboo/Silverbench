import { useState } from "react";
import { useToast } from "../../components/useToast";
import { mocapApi, type EngineStatus, type ExportRequest, type Take, type TakeIssue } from "./mocapApi";
import { ISSUE_REASONS, STAGE_LABELS, formatDuration, frameRuns, statusLabel } from "./mocapDomain";
import type { FrameRange } from "./MocapTimeline";

export function TakeList({ takes, selectedId, onSelect }: { takes: Take[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!takes.length) return <p className="mc-muted mc-pad">还没有动捕。点"新建动捕"选择工作区里的视频。</p>;
  return (
    <ul className="mc-takes">
      {takes.map((take) => (
        <li key={take.id}>
          <button type="button" className={`mc-take${take.id === selectedId ? " is-selected" : ""}`} onClick={() => onSelect(take.id)}>
            <span className="mc-take__name">{take.name}</span>
            <span className="mc-take__meta">
              <span className={`mc-status mc-status--${take.capture.status}`}>{statusLabel(take)}</span>
              {take.mode === "multiview" ? `${take.sources.length} 视角` : "单视角"}
              {take.edits ? ` · ${take.edits.frameCount} 帧` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Capture state of a take that has no motion yet, or is being captured. */
export function CapturePanel({ take, onStart, onCancel }: { take: Take; onStart: () => void; onCancel: () => void }) {
  const capture = take.capture;
  if (capture.status === "capturing" || capture.status === "cancelling") {
    const percent = Math.round((capture.fraction ?? 0) * 100);
    return (
      <div className="mc-capture">
        <div className="mc-capture__stage">
          {capture.status === "cancelling" ? "正在取消 · 已生成的中间结果会保留" : STAGE_LABELS[capture.stage ?? ""] ?? capture.stage}
          {capture.view && capture.viewCount ? ` · 视角 ${capture.viewIndex}/${capture.viewCount}（${capture.view}）` : ""}
        </div>
        <div className="mc-progress">
          <div className="mc-progress__bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="mc-capture__numbers">
          <span>{percent}%</span>
          {capture.total ? <span>帧 {capture.item}/{capture.total}</span> : null}
          <span>已用 {formatDuration(capture.elapsedSeconds)}</span>
          <span>{capture.remainingSeconds != null ? `预计剩余 ${formatDuration(capture.remainingSeconds)}` : "正在估算剩余时间"}</span>
        </div>
        <button type="button" onClick={onCancel} disabled={capture.status === "cancelling"}>
          取消捕捉
        </button>
      </div>
    );
  }
  return (
    <div className="mc-capture">
      <dl className="mc-facts">
        <dt>视频</dt>
        <dd>
          {take.sources.map((source) => (
            <div key={source.id}>
              {source.video}
              {source.yaw !== undefined ? ` · ${source.yaw}°` : ""}
            </div>
          ))}
        </dd>
        <dt>选项</dt>
        <dd>
          辅助 AI 间隔 {take.options.expertInterval} · {take.options.upscale ? "AI 放大" : "不放大"} · {take.options.vlm ? "视觉纠错" : "无视觉纠错"}
          {take.options.characterProfile ? " · 角色预设" : ""}
        </dd>
      </dl>
      {capture.status === "failed" ? <pre className="mc-error">{capture.error}</pre> : null}
      {capture.status === "cancelled" ? <p className="mc-muted">已取消。中间结果和日志保留在 take 的 capture/ 与 logs/。</p> : null}
      {capture.status === "interrupted" ? <p className="mc-muted">上次捕捉时应用被关闭了。</p> : null}
      <button type="button" className="mc-primary" onClick={onStart}>
        {capture.status === "new" ? "开始捕捉" : "重新捕捉"}
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
  if (!issues.length && !runs.length && !inferredCount) return <p className="mc-muted">没有标记的问题帧。</p>;
  return (
    <div className="mc-issues">
      {inferredCount ? <p className="mc-muted">推算样本 {inferredCount} 个（橙色）：由区间重建生成，置信度为 0，不是观测。</p> : null}
      {issues.map((issue, index) => (
        <button key={`${issue.view}-${issue.frame}-${index}`} type="button" className="mc-issue" onClick={() => onSeek(issue.frame)}>
          <span>帧 {issue.frame}</span>
          <span className="mc-muted">
            {issue.view} · {issue.reasons.map((reason) => ISSUE_REASONS[reason] ?? reason).join(" · ") || "复查"}
          </span>
        </button>
      ))}
      {runs.length ? <div className="mc-issues__head">低置信度（&lt; 0.35）</div> : null}
      {runs.slice(0, 50).map(([first, last]) => (
        <button key={first} type="button" className="mc-issue" onClick={() => onSeek(first)}>
          <span>{first === last ? `帧 ${first}` : `帧 ${first}–${last}`}</span>
        </button>
      ))}
      {runs.length > 50 ? <p className="mc-muted">还有 {runs.length - 50} 段</p> : null}
    </div>
  );
}

export function ExportPanel({ workspaceRoot, take, range }: { workspaceRoot: string; take: Take; range: FrameRange }) {
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
      showToast(`已导出 ${result.relativePath}`, { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mc-export">
      <p className="mc-muted">{range ? `只导出区间 ${range.first}–${range.last}` : "导出整段"} · 写到 exports/mocap/</p>
      <div className="mc-inline">
        <select value={unit} onChange={(event) => setUnit(event.target.value as "centimeters" | "meters")}>
          <option value="centimeters">厘米</option>
          <option value="meters">米</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void run("bvh")}>
          导出 BVH
        </button>
        <button type="button" disabled={busy} onClick={() => void run("vrma")}>
          导出 VRMA
        </button>
      </div>
    </div>
  );
}

const SETUP_LABELS: Record<string, string> = {
  mmpose: "动作捕捉环境（MMPose）",
  local_vlm: "本地视觉纠错（Qwen3-VL）",
  openvino_npu: "NPU 复查（OpenVINO）",
  sam2: "人物分割（SAM 2.1）"
};

/** What is installed on this computer, and how to install the rest. */
export function EnvironmentPanel({ status, onRefresh }: { status: EngineStatus | null; onRefresh: (deep: boolean) => Promise<void> }) {
  const { showToast } = useToast();
  const [checking, setChecking] = useState(false);
  if (!status) return <p className="mc-muted">正在检查动捕引擎…</p>;

  async function setup(name: string) {
    try {
      await mocapApi.openSetup(name);
      showToast("安装窗口已打开。完成后点\"检查环境\"。", { variant: "info" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  }

  return (
    <div className="mc-env">
      <div className="mc-env__row">
        <span className={`ui-dot ${status.engine.built ? "ui-dot--ok" : "ui-dot--danger"}`} />
        {status.engine.built ? `动捕引擎 ${status.engine.version ?? ""}` : "动捕引擎未构建：运行 update.bat（需要 Visual Studio C++ 工具）"}
      </div>
      <div className="mc-env__row">
        <span className={`ui-dot ${status.pose?.ready ? "ui-dot--ok" : status.environment.present ? "ui-dot--warn" : "ui-dot--danger"}`} />
        {status.pose?.ready
          ? `捕捉环境就绪${status.pose.cuda ? " · CUDA" : " · 仅 CPU"}`
          : status.environment.present
            ? status.pose?.error
              ? `捕捉环境有问题：${status.pose.error}`
              : "捕捉环境已安装（未检查）"
            : "捕捉环境未安装"}
      </div>
      {status.vlm ? (
        <div className="mc-env__row">
          <span className={`ui-dot ${status.vlm.ready ? "ui-dot--ok" : "ui-dot--warn"}`} />
          {status.vlm.ready ? "本地视觉纠错就绪" : `本地视觉纠错不可用${status.vlm.error ? `：${status.vlm.error}` : ""}`}
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
          {checking ? "检查中…" : "检查环境"}
        </button>
        {Object.entries(status.setup)
          .filter(([, present]) => present)
          .map(([name]) => (
            <button key={name} type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => void setup(name)} title="在新窗口运行 AniMocap 的安装脚本">
              安装{SETUP_LABELS[name] ?? name}
            </button>
          ))}
      </div>
      <p className="mc-muted">安装会下载数 GB 的依赖和模型，可能用 winget 安装 Python 3.12；在单独的窗口中运行，可随时关闭。</p>
    </div>
  );
}
