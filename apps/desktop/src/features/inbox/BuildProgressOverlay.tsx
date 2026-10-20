import "./inbox.css";
type BuildProgressOverlayProps = {
  open: boolean;
  done: number;
  total: number;
  detail: string;
};

export function BuildProgressOverlay({ open, done, total, detail }: BuildProgressOverlayProps) {
  if (!open) return null;
  const max = Math.max(1, total || 1);
  return (
    <div id="buildProgressOverlay" className="build-progress-overlay" hidden={false}>
      <div className="build-progress-card">
        <div className="group-title">Building dataset links</div>
        <progress id="buildProgress" max={max} value={Math.min(done, max)} />
        <div id="buildProgressText" className="status">
          {done} / {total}
        </div>
        <div id="buildProgressDetail" className="hint">
          {detail}
        </div>
      </div>
    </div>
  );
}
