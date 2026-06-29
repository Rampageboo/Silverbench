import type {
  LabelSourceSummary,
  LabelWorkbenchAction,
  LabelWorkbenchActionGroup,
  LabelWorkbenchInspectorState,
  LabelWorkbenchMode,
} from "./labelWorkbenchTypes";

type Props = {
  mode: LabelWorkbenchMode;
  sourceSummary: LabelSourceSummary | null;
  inspectorState: LabelWorkbenchInspectorState | null;
  actionGroups: LabelWorkbenchActionGroup[];
};

function safeNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatInspectorMs(ms: number | null | undefined): string | null {
  const value = safeNumber(ms);
  if (value === null) return null;
  const totalMs = Math.max(0, Math.round(value));
  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const millis = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function sourceTitle(mode: LabelWorkbenchMode, source: LabelSourceSummary | null) {
  if (!source) return mode === "image" ? "No image selected" : "No video timestamp selected";
  if (source.kind === "image") return source.filename || "Image source";
  return source.videoName || "Video timestamp";
}

function sourceMeta(source: LabelSourceSummary | null, state: LabelWorkbenchInspectorState | null) {
  if (!source) return "Open or select a source to inspect.";
  if (source.kind === "image") {
    const index = safeNumber(source.currentIndex);
    const total = safeNumber(source.totalImages);
    return index !== null && total !== null && total > 0 ? `${index + 1} / ${total}` : "Image source";
  }
  const stamp = state?.timestampLabel || formatInspectorMs(source.timestampMs);
  return stamp ? `Timestamp ${stamp}` : "Video timestamp";
}

function reviewLabel(source: LabelSourceSummary | null, state: LabelWorkbenchInspectorState | null) {
  const status = state?.reviewStatus ?? (source?.kind === "image" ? source.reviewStatus : source?.reviewed ? "approved" : "unreviewed");
  if (status === "approved") return "Reviewed";
  if (status === "flagged") return "Flagged";
  if (status === "unreviewed") return "Unreviewed";
  return "Unknown";
}

function isProposalAction(action: LabelWorkbenchAction) {
  return String(action.id).startsWith("proposal.");
}

function actionDisabled(action: LabelWorkbenchAction) {
  return Boolean(action.disabled || action.busy || action.unavailableReason || !action.run);
}

function actionState(action: LabelWorkbenchAction) {
  if (action.busy) return "busy";
  if (!action.run || action.unavailableReason) return "unavailable";
  if (action.disabled) return "disabled";
  return "enabled";
}

function actionStatusText(action: LabelWorkbenchAction) {
  if (action.busy) return "Busy";
  if (action.unavailableReason) return action.unavailableReason;
  if (action.disabled || !action.run) return "Unavailable";
  return null;
}

function InspectorActionButton({ action }: { action: LabelWorkbenchAction }) {
  const disabled = actionDisabled(action);
  const state = actionState(action);
  const statusText = actionStatusText(action);
  return (
    <div className="lwb-inspector-action-wrap">
      <button
        type="button"
        className={`lwb-inspector-action lwb-inspector-action--${action.variant ?? "default"} lwb-inspector-action--${state}`}
        disabled={disabled}
        aria-busy={action.busy || undefined}
        data-state={state}
        title={statusText || action.title || action.label}
        onClick={() => {
          if (disabled) return;
          void action.run?.();
        }}
      >
        {action.busy ? `${action.label}...` : action.label}
      </button>
      {statusText ? <div className="lwb-inspector-action-status">{statusText}</div> : null}
    </div>
  );
}

function ActionGroupsView({ groups }: { groups: LabelWorkbenchActionGroup[] }) {
  return (
    <div className="lwb-inspector-actions">
      {groups.map((group) =>
        group.actions.length ? (
          <div key={group.id} className="lwb-inspector-action-group" data-group-id={group.id}>
            <div className="lwb-inspector-action-group-title">{group.label}</div>
            {group.actions.map((action) => (
              <InspectorActionButton key={action.id} action={action} />
            ))}
          </div>
        ) : null
      )}
    </div>
  );
}

function DuplicateActionsView({ group }: { group: LabelWorkbenchActionGroup | null }) {
  const actions = group?.actions ?? [];
  const items = group?.items ?? [];
  return (
    <section className="panel pool-label-box-panel lwb-inspector-duplicate-panel">
      <div className="panel-header">
        <span>Duplicate to Next Frame</span>
      </div>
      <div className="panel-body lwb-inspector-duplicate-body">
        <div className="hint lwb-inspector-duplicate-status">
          {group?.description ?? "Select a box and press T to add it to duplicate list."}
        </div>
        <div className="lwb-inspector-duplicate-list">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pool-label-box-row lwb-inspector-duplicate-row${item.selected ? " selected" : ""}${item.tone === "muted" ? " muted" : ""}`}
                onClick={() => {
                  void item.run?.();
                }}
              >
                <span>{item.label}</span>
                {item.detail ? <span className="lwb-inspector-duplicate-row-detail">{item.detail}</span> : null}
              </button>
            ))
          ) : (
            <div className="empty">No duplicate boxes queued.</div>
          )}
        </div>
        {actions.length ? (
          <div className="lwb-inspector-duplicate-actions">
            {actions.map((action) => {
              const disabled = actionDisabled(action);
              const state = actionState(action);
              const statusText = actionStatusText(action);
              return (
                <button
                  key={action.id}
                  type="button"
                  className={`lwb-inspector-action lwb-inspector-action--${action.variant ?? "default"} lwb-inspector-action--${state}`}
                  disabled={disabled}
                  aria-busy={action.busy || undefined}
                  data-state={state}
                  title={statusText || action.title || action.label}
                  onClick={() => {
                    if (disabled) return;
                    void action.run?.();
                  }}
                >
                  {action.busy ? `${action.label}...` : action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function LabelWorkbenchInspector({
  mode,
  sourceSummary,
  inspectorState,
  actionGroups,
}: Props) {
  const taskKind = inspectorState?.taskKind ?? "both";
  const overlayCount = safeNumber(inspectorState?.overlaySummary?.activeCount);
  const segment = inspectorState?.segmentSummary;
  const warnings = inspectorState?.warnings ?? [];

  const duplicateActionGroup = mode === "image"
    ? actionGroups.find((group) => group.id === "image-duplicate") ?? null
    : null;
  const reviewActionGroups = mode === "image"
    ? actionGroups.filter((group) => group.id === "image-review")
    : [];
  const remainingActionGroups = mode === "image"
    ? actionGroups
        .filter((group) => group.id !== "image-review" && group.id !== "image-duplicate")
        .map((group) => ({
          ...group,
          actions: group.actions.filter((action) => !isProposalAction(action)),
        }))
    : actionGroups;
  const hasReviewActions = reviewActionGroups.some((group) => group.actions.length > 0);
  const hasActions = remainingActionGroups.some((group) => group.actions.length > 0);
  const hasDuplicatePanel = Boolean(duplicateActionGroup);

  return (
    <aside className="lwb-inspector" aria-label="Label workbench inspector">
      {mode !== "image" ? (
        <>
          <section className="lwb-inspector-section">
            <div className="lwb-inspector-kicker">Source</div>
            <div className="lwb-inspector-title" title={sourceTitle(mode, sourceSummary)}>
              {sourceTitle(mode, sourceSummary)}
            </div>
            <div className="lwb-inspector-muted">{sourceMeta(sourceSummary, inspectorState)}</div>
            {inspectorState?.sourceDetail ? (
              <div className="lwb-inspector-muted">{inspectorState.sourceDetail}</div>
            ) : null}
          </section>

          <section className="lwb-inspector-section">
            <div className="lwb-inspector-kicker">Status</div>
            <div className="lwb-inspector-chip-row">
              {taskKind === "both" || taskKind === "detect" ? <span className="lwb-inspector-chip">Detect</span> : null}
              {taskKind === "both" || taskKind === "classify" ? <span className="lwb-inspector-chip">Classify</span> : null}
              <span className="lwb-inspector-chip">{reviewLabel(sourceSummary, inspectorState)}</span>
            </div>
          </section>
        </>
      ) : null}

      {mode === "image" ? (
        <section className="lwb-inspector-section lwb-inspector-proposal-review">
          <div className="lwb-inspector-kicker">Review</div>
          {reviewActionGroups.some((group) => group.actions.length > 0) ? <ActionGroupsView groups={reviewActionGroups} /> : null}
        </section>
      ) : null}

      {mode === "image" ? (
        <>
          <DuplicateActionsView group={duplicateActionGroup} />
          <div id="lwbClassifyClassesSlot" className="lwb-inspector-classify-slot" />
        </>
      ) : null}

      {mode === "video" ? <div id="lwbClassifyClassesSlot" className="lwb-inspector-classify-slot" /> : null}

      {overlayCount !== null || segment ? (
        <section className="lwb-inspector-section">
          <div className="lwb-inspector-kicker">Context</div>
          <div className="lwb-inspector-grid">
            {overlayCount !== null ? <span>Blackouts: {overlayCount}</span> : null}
            {segment ? (
              <span>
                Segment: {segment.label}
                {formatInspectorMs(segment.startMs) && formatInspectorMs(segment.endMs)
                  ? ` (${formatInspectorMs(segment.startMs)}-${formatInspectorMs(segment.endMs)})`
                  : ""}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="lwb-inspector-section">
          <div className="lwb-inspector-kicker">Warnings</div>
          {warnings.map((warning) => (
            <div key={warning.id} className={`lwb-inspector-warning lwb-inspector-warning--${warning.tone ?? "warning"}`}>
              <strong>{warning.label}</strong>
              {warning.detail ? <span>{warning.detail}</span> : null}
            </div>
          ))}
        </section>
      ) : null}

      {hasActions || (!hasReviewActions && !hasDuplicatePanel) ? (
        <section className="lwb-inspector-section">
          <div className="lwb-inspector-kicker">Actions</div>
          {hasActions ? (
            <ActionGroupsView groups={remainingActionGroups} />
          ) : (
            <div className="lwb-inspector-muted">No contextual actions available.</div>
          )}
        </section>
      ) : null}
    </aside>
  );
}
