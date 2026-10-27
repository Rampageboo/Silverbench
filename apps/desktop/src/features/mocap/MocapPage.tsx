import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../components/useToast";
import { IconRefresh } from "../../ui/icons";
import {
  mocapApi,
  type EditReply,
  type EngineStatus,
  type PoseData,
  type PoseVariant,
  type Take,
  type TakeIssue,
  type TakeView
} from "./mocapApi";
import {
  applyDelta,
  frameAtTime,
  lowConfidenceFrames,
  referenceFrameForViewTime,
  statusLabel,
  viewFrameAt,
  viewTimeAt
} from "./mocapDomain";
import { BlenderFramesPanel, JointRepairPanel, KeyframePanel } from "./MocapEditPanels";
import { addDrag, deleteKeyframe, keyframes, marksFor, rangesFor, type CurvePreset } from "./mocapEdits";
import { CapturePanel, EnvironmentPanel, ExportPanel, IssuesPanel, TakeList } from "./MocapPanels";
import { MocapStage } from "./MocapStage";
import { MocapTimeline, type FrameRange } from "./MocapTimeline";
import { MultiviewOverview, type OverviewTile } from "./MultiviewOverview";
import { NewTakeDialog } from "./NewTakeDialog";
import { SkeletonView } from "./SkeletonView";
import { useMocapEditor } from "./useMocapEditor";
import "./mocap.css";

type Props = { active: boolean; workspaceRoot: string; onReady?: () => void };

const POLL_MS = 1000;

/**
 * 动捕: AniMocap captures of workspace videos. The engine computes everything;
 * this page shows the take (video + 2D joints, 3D view, timeline, issues), edits
 * it (drag keyframes, per-joint repair) and exports it. Every edit is applied by
 * the engine and saved at once; undo/redo walks the saved edit sessions.
 */
export function MocapPage({ active, workspaceRoot, onReady }: Props) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pose, setPose] = useState<PoseData | null>(null);
  const [comparisonVariant, setComparisonVariant] = useState<PoseVariant | null>(null);
  const [comparison, setComparison] = useState<PoseData | null>(null);
  const [issues, setIssues] = useState<TakeIssue[]>([]);
  const [frame, setFrame] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<FrameRange>(null);
  const [loop, setLoop] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [selectedJoint, setSelectedJoint] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [curve, setCurve] = useState<CurvePreset>("smooth");
  const [exportFrames, setExportFrames] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  // Multiview review: the views, the one shown (null = fused pose on the reference view), the overview grid.
  const [views, setViews] = useState<TakeView[]>([]);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [overview, setOverview] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef(0);

  useEffect(() => onReady?.(), [onReady]);

  const take = takes.find((item) => item.id === selectedId) ?? null;
  const capturing = take?.capture.status === "capturing" || take?.capture.status === "cancelling";
  const view = views.find((item) => item.id === activeView) ?? null;
  // Other views are reviewed read-only; edits apply to the fused pose (Studio rule).
  const dragAllowed = !view;

  const onApplied = useCallback((reply: EditReply) => {
    setPose((current) => (current ? applyDelta(current, reply.pose, reply.inferred) : current));
    setComparison((current) =>
      current?.variant === "baseline" ? applyDelta(current, reply.baseline) : current
    );
  }, []);
  const onEditError = useCallback((message: string) => showToast(message, { variant: "error" }), [showToast]);
  const editor = useMocapEditor({
    workspaceRoot,
    takeId: take?.hasMotion ? take.id : null,
    enabled: !!take?.hasMotion,
    onApplied,
    onError: onEditError
  });

  const refreshStatus = useCallback(
    async (deep = false) => {
      try {
        setStatus(deep ? await mocapApi.refreshStatus() : await mocapApi.status());
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
      }
    },
    [showToast]
  );

  const refreshTakes = useCallback(async () => {
    if (!workspaceRoot) return;
    try {
      const list = await mocapApi.takes(workspaceRoot);
      setTakes(list);
      setSelectedId((current) =>
        current && list.some((item) => item.id === current) ? current : (list[0]?.id ?? null)
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  }, [workspaceRoot, showToast]);

  useEffect(() => {
    if (!active) return;
    void refreshStatus();
    void refreshTakes();
  }, [active, refreshStatus, refreshTakes]);

  // Follow a running capture; when it ends, the take list carries the result.
  useEffect(() => {
    if (!active || !capturing || !selectedId) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await mocapApi.take(workspaceRoot, selectedId);
        setTakes((list) => list.map((item) => (item.id === next.id ? next : item)));
      } catch {
        // The next tick retries; a missing backend is shown by the shell.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, capturing, selectedId, workspaceRoot]);

  const poseKey = take?.hasMotion ? `${take.id}|${take.edits?.updatedAt ?? ""}` : "";
  useEffect(() => {
    setPose(null);
    setIssues([]);
    setSelectedJoint(null);
    if (!poseKey || !take) return;
    let cancelled = false;
    mocapApi
      .pose(workspaceRoot, take.id)
      .then((data) => !cancelled && setPose(data))
      .catch((error) =>
        showToast(error instanceof Error ? error.message : String(error), { variant: "error" })
      );
    mocapApi
      .issues(workspaceRoot, take.id)
      .then((list) => !cancelled && setIssues(list))
      .catch(() => undefined);
    setViews([]);
    if (take.mode === "multiview") {
      mocapApi
        .views(workspaceRoot, take.id)
        .then((list) => !cancelled && setViews(list))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // take is read through poseKey; refetch only when the take or its edits change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseKey, workspaceRoot, showToast]);

  useEffect(() => {
    setComparison(null);
    if (!poseKey || !take || !comparisonVariant) return;
    let cancelled = false;
    mocapApi
      .pose(workspaceRoot, take.id, comparisonVariant)
      .then((data) => !cancelled && setComparison(data))
      .catch((error) =>
        showToast(error instanceof Error ? error.message : String(error), { variant: "error" })
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseKey, comparisonVariant, workspaceRoot, showToast]);

  useEffect(() => {
    setFrame(0);
    setTime(0);
    setRange(null);
    setLoop(false);
    setEditMode(false);
    setExportFrames([]);
    setActiveView(null);
    setOverview(false);
  }, [selectedId]);

  const frameCount = pose?.times.length ?? 0;

  frameRef.current = frame;
  // The video shown plays on its own clock; the timeline is always the reference's.
  const videoTimeAt = useCallback(
    (reference: number) => (view ? viewTimeAt(view, reference) : (pose?.times[reference] ?? 0)),
    [view, pose]
  );

  const seek = useCallback(
    (target: number) => {
      if (!pose || !frameCount) return;
      const next = Math.min(Math.max(Math.round(target), 0), frameCount - 1);
      setFrame(next);
      setTime(pose.times[next]);
      const element = videoRef.current;
      if (element) element.currentTime = videoTimeAt(next);
    },
    [pose, frameCount, videoTimeAt]
  );

  const onVideoTime = useCallback(
    (seconds: number) => {
      if (!pose) return;
      let next = view
        ? referenceFrameForViewTime(view, seconds, pose.times.length)
        : frameAtTime(pose.times, seconds);
      if (loop && range && (next > range.last || next < range.first)) {
        next = range.first;
        if (videoRef.current) videoRef.current.currentTime = videoTimeAt(next);
      }
      setFrame(next);
      setTime(pose.times[next] ?? seconds);
    },
    [pose, loop, range, view, videoTimeAt]
  );

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      if (loop && range && (frame < range.first || frame >= range.last)) seek(range.first);
      void element.play();
    } else element.pause();
  }, [loop, range, frame, seek]);

  const toggleExportFrame = useCallback((target: number) => {
    setExportFrames((current) =>
      current.includes(target)
        ? current.filter((value) => value !== target)
        : [...current, target].sort((a, b) => a - b)
    );
  }, []);

  const setRangeStart = useCallback(
    () => setRange((current) => ({ first: frame, last: Math.max(frame, current?.last ?? frameCount - 1) })),
    [frame, frameCount]
  );
  const setRangeEnd = useCallback(
    () => setRange((current) => ({ first: Math.min(frame, current?.first ?? 0), last: frame })),
    [frame]
  );

  // Studio shortcuts: Space, ←/→, Shift+←/→, I/O, L.
  useEffect(() => {
    if (!active || !pose) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
        return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === "z" && !event.shiftKey) editor.undo();
        else if (key === "y" || (key === "z" && event.shiftKey)) editor.redo();
        else return;
        event.preventDefault();
        return;
      }
      if (event.altKey) return;
      if (key === " ") togglePlay();
      else if (key === "delete") editor.change((current) => deleteKeyframe(current, frame));
      else if (key === "b") toggleExportFrame(frame);
      else if (key === "arrowleft") seek(frame - (event.shiftKey ? 10 : 1));
      else if (key === "arrowright") seek(frame + (event.shiftKey ? 10 : 1));
      else if (key === "i") setRangeStart();
      else if (key === "o") setRangeEnd();
      else if (key === "l" && range) setLoop((value) => !value);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, pose, frame, range, seek, togglePlay, setRangeStart, setRangeEnd, editor, toggleExportFrame]);

  const lowConfidence = useMemo(() => (pose ? lowConfidenceFrames(pose) : []), [pose]);
  const marks = useMemo(
    () => ({
      issues: [...new Set(issues.map((issue) => issue.frame))],
      inferred: pose ? [...new Set(pose.inferred.map(([inferredFrame]) => inferredFrame))] : [],
      lowConfidence,
      keyframes: keyframes(editor.edits),
      ...(selectedJoint !== null ? jointMarks(selectedJoint) : {}),
      exportFrames
    }),
    // jointMarks reads editor.edits, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, pose, lowConfidence, editor.edits, selectedJoint, exportFrames]
  );

  function jointMarks(joint: number) {
    const marks = marksFor(editor.edits, joint);
    const of = (trust: string) => marks.filter((mark) => mark.trust === trust).map((mark) => mark.frame);
    return {
      locked: of("locked"),
      weighted: of("weighted"),
      excluded: of("excluded"),
      ranges: rangesFor(editor.edits, joint).map(([first, last]) => [first, last] as [number, number])
    };
  }

  async function exportBlender() {
    if (!take) return;
    setExporting(true);
    try {
      const result = await mocapApi.export(workspaceRoot, take.id, {
        format: "blender",
        frames: exportFrames
      });
      showToast(`已导出 ${result.relativePath}`, { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setExporting(false);
    }
  }

  // A fused multiview pose is drawn over the reference (most frontal) view.
  const referenceVideo = useMemo(() => {
    if (!take) return "";
    const sorted = [...take.sources].sort((a, b) => Math.abs(a.yaw ?? 0) - Math.abs(b.yaw ?? 0));
    return sorted[0]?.video ?? "";
  }, [take]);

  const stagePose = view ? view.pose : pose;
  const stageFrame = view ? Math.round(viewFrameAt(view, frame)) : frame;

  const overviewTiles: OverviewTile[] = useMemo(() => {
    if (!pose || !overview) return [];
    const fused: OverviewTile = {
      id: null,
      label: "融合（参考视角）",
      video: referenceVideo,
      pose,
      frame,
      time: pose.times[frame] ?? 0
    };
    return [
      fused,
      ...views.map((item) => ({
        id: item.id,
        label: `${item.id}${item.yaw != null ? ` · ${item.yaw}°` : ""}`,
        video: item.video,
        pose: item.pose,
        frame: Math.round(viewFrameAt(item, frame)),
        time: viewTimeAt(item, frame)
      }))
    ];
  }, [pose, overview, views, frame, referenceVideo]);

  async function startCapture(id: string) {
    try {
      const next = await mocapApi.capture(workspaceRoot, id);
      setTakes((list) => list.map((item) => (item.id === next.id ? next : item)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  }

  async function updateRoi(id: string, roi: [number, number, number, number] | null) {
    try {
      const next = await mocapApi.updateOptions(workspaceRoot, id, { roi });
      setTakes((list) => list.map((item) => (item.id === next.id ? next : item)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  }

  async function cancelCapture(id: string) {
    try {
      const next = await mocapApi.cancel(workspaceRoot, id);
      setTakes((list) => list.map((item) => (item.id === next.id ? next : item)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  }

  if (!workspaceRoot) {
    return <div className="mc-page mc-page--empty">打开一个工作区后使用动捕。</div>;
  }

  return (
    <div className="mc-page">
      <header className="mc-head">
        <h1 className="mc-title">动捕</h1>
        {take ? (
          <span className="mc-muted">
            {take.name} · {statusLabel(take)}
            {pose ? ` · ${pose.backend}` : ""}
          </span>
        ) : null}
        <span className="mc-spacer" />
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm"
          onClick={() => void refreshTakes()}
          title="刷新"
        >
          <IconRefresh size={14} />
        </button>
        <button
          type="button"
          className="mc-primary"
          onClick={() => setCreating(true)}
          disabled={!status?.engine.built}
        >
          新建动捕
        </button>
      </header>
      <aside className="mc-left">
        <TakeList takes={takes} selectedId={selectedId} onSelect={setSelectedId} />
        <section className="mc-section">
          <h2 className="ui-eyebrow">本机环境</h2>
          <EnvironmentPanel status={status} onRefresh={refreshStatus} />
        </section>
      </aside>
      <main className="mc-center">
        {take && take.hasMotion ? (
          <>
            <div className="mc-stage-tools">
              <label className="mc-check">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(event) => setShowLabels(event.target.checked)}
                />
                关节名
              </label>
              <label className="mc-check">
                叠影
                <select
                  value={comparisonVariant ?? ""}
                  onChange={(event) =>
                    setComparisonVariant((event.target.value || null) as PoseVariant | null)
                  }
                >
                  <option value="">无</option>
                  <option value="baseline">原始叠影（重建前）</option>
                  <option value="refined">捕捉结果（未修正）</option>
                </select>
              </label>
              {take.mode === "multiview" ? (
                <>
                  <label className="mc-check">
                    视角
                    <select
                      value={activeView ?? ""}
                      onChange={(event) => {
                        setActiveView(event.target.value || null);
                        setOverview(false);
                      }}
                    >
                      <option value="">融合（参考视角，可编辑）</option>
                      {views.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id}
                          {item.yaw != null ? ` · ${item.yaw}°` : ""}（只读）
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={`ui-btn--sm${overview ? " is-active" : ""}`}
                    aria-pressed={overview}
                    disabled={!views.length}
                    onClick={() => {
                      videoRef.current?.pause();
                      setOverview((value) => !value);
                    }}
                  >
                    总览
                  </button>
                </>
              ) : null}
            </div>
            {overview ? (
              <MultiviewOverview
                workspaceRoot={workspaceRoot}
                tiles={overviewTiles}
                onOpen={(id) => {
                  setActiveView(id);
                  setOverview(false);
                }}
              />
            ) : (
              <MocapStage
                workspaceRoot={workspaceRoot}
                video={view ? view.video : referenceVideo}
                videoRef={videoRef}
                pose={stagePose}
                comparison={view ? null : comparison}
                frame={stageFrame}
                showLabels={showLabels}
                selectedJoint={selectedJoint}
                onSelectJoint={setSelectedJoint}
                onTime={onVideoTime}
                onPlayingChange={setPlaying}
                onLoaded={() => seek(frameRef.current)}
                editMode={editMode && dragAllowed && editor.loaded}
                onDragJoint={(joint, dragPx) =>
                  editor.change((current) => addDrag(current, joint, frame, dragPx, curve))
                }
              />
            )}
            <MocapTimeline
              frame={frame}
              frameCount={frameCount}
              fps={pose?.fps ?? 30}
              time={time}
              playing={playing}
              range={range}
              loop={loop}
              marks={marks}
              onSeek={seek}
              onTogglePlay={togglePlay}
              onSetRangeStart={setRangeStart}
              onSetRangeEnd={setRangeEnd}
              onClearRange={() => {
                setRange(null);
                setLoop(false);
              }}
              onToggleLoop={() => setLoop((value) => !value)}
            />
          </>
        ) : take ? (
          <CapturePanel
            workspaceRoot={workspaceRoot}
            take={take}
            onStart={() => void startCapture(take.id)}
            onCancel={() => void cancelCapture(take.id)}
            onRoi={(roi) => void updateRoi(take.id, roi)}
          />
        ) : (
          <div className="mc-empty">选择或新建一个动捕。</div>
        )}
      </main>
      <aside className="mc-right">
        {take?.hasMotion ? (
          <>
            <section className="mc-section mc-section--grow">
              <h2 className="ui-eyebrow">3D 观测（拖动旋转）</h2>
              <SkeletonView pose={pose} comparison={comparison} frame={frame} selectedJoint={selectedJoint} />
            </section>
            <section className="mc-section">
              <h2 className="ui-eyebrow">手动修正{editor.busy ? " · 计算中…" : ""}</h2>
              <KeyframePanel
                edits={editor.edits}
                frame={frame}
                curve={curve}
                onCurve={setCurve}
                editMode={editMode}
                onEditMode={setEditMode}
                dragAllowed={dragAllowed}
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                busy={editor.busy || !editor.loaded}
                onChange={editor.change}
                onUndo={editor.undo}
                onRedo={editor.redo}
                onSeek={seek}
              />
            </section>
            <section className="mc-section">
              <h2 className="ui-eyebrow">按部位修复</h2>
              {pose ? (
                <JointRepairPanel
                  pose={pose}
                  edits={editor.edits}
                  joint={selectedJoint}
                  frame={frame}
                  range={range}
                  busy={editor.busy || !editor.loaded || !!view}
                  onChange={editor.change}
                  onSeek={seek}
                />
              ) : null}
            </section>
            <section className="mc-section">
              <h2 className="ui-eyebrow">问题帧</h2>
              <IssuesPanel
                issues={issues}
                lowConfidence={lowConfidence}
                inferredCount={pose?.inferred.length ?? 0}
                onSeek={seek}
              />
            </section>
            <section className="mc-section">
              <h2 className="ui-eyebrow">导出</h2>
              <ExportPanel workspaceRoot={workspaceRoot} take={take} range={range} />
              <BlenderFramesPanel
                frames={exportFrames}
                frame={frame}
                range={range}
                busy={exporting}
                onToggle={() => toggleExportFrame(frame)}
                onAddRange={() =>
                  range &&
                  setExportFrames((current) => {
                    const next = new Set(current);
                    for (let value = range.first; value <= range.last; value++) next.add(value);
                    return [...next].sort((a, b) => a - b);
                  })
                }
                onClear={() => setExportFrames([])}
                onExport={() => void exportBlender()}
              />
            </section>
          </>
        ) : null}
      </aside>
      {creating ? (
        <NewTakeDialog
          workspaceRoot={workspaceRoot}
          onClose={() => setCreating(false)}
          onCreated={(created, start) => {
            setCreating(false);
            setTakes((list) => [created, ...list]);
            setSelectedId(created.id);
            if (start) void startCapture(created.id);
          }}
        />
      ) : null}
    </div>
  );
}
