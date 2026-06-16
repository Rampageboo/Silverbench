type JobStatusPanelProps = {
  visible?: boolean;
  running: boolean;
  done?: number;
  total?: number;
  detail?: string;
  className?: string;
};

export function JobStatusPanel({ visible, running, done = 0, total = 1, detail, className }: JobStatusPanelProps) {
  if (visible === false) return null;
  if (!running && done <= 0 && !detail) return null;
  const classes = ["video-progress", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <progress value={done} max={total || 1} />
      <div className="video-progress-count">
        {done} / {total}
      </div>
      {detail ? <div className="video-progress-detail">{detail}</div> : null}
    </div>
  );
}
