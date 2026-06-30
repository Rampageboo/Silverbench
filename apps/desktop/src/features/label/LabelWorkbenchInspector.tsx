import type {
  LabelSourceSummary,
  LabelWorkbenchAction,
  LabelWorkbenchActionGroup,
  LabelWorkbenchClassPalette,
  LabelWorkbenchInspectorState,
  LabelWorkbenchMode,
  LabelWorkbenchSamplingControl,
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

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path fill="currentColor" d="M4 3h3v10H4V3Zm5 0h3v10H9V3Z" />
    </svg>
  );
}

function ResumeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path fill="currentColor" d="M5 3.3v9.4L12.5 8 5 3.3Z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path fill="currentColor" d="M6 2h4l.6 1.2H14v1.4H2V3.2h3.4L6 2Zm-2.8 4h9.6l-.5 8H3.7l-.5-8Zm2.2 1.2.3 5.6h1.2l-.3-5.6H5.4Zm4 0-.3 5.6h1.2l.3-5.6H9.4Z" />
    </svg>
  );
}

function ActionGroupsView({ groups, hideGroupTitles = false }: { groups: LabelWorkbenchActionGroup[]; hideGroupTitles?: boolean }) {
  return (
    <div className="lwb-inspector-actions">
      {groups.map((group) =>
        group.actions.length ? (
          <div key={group.id} className="lwb-inspector-action-group" data-group-id={group.id}>
            {hideGroupTitles ? null : <div className="lwb-inspector-action-group-title">{group.label}</div>}
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
            items.map((item) => {
              const handleSelect = () => {
                void item.run?.();
              };
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={`pool-label-box-row lwb-inspector-duplicate-row${item.selected ? " selected" : ""}${item.tone === "muted" ? " muted" : ""}`}
                  onClick={handleSelect}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelect();
                    }
                  }}
                >
                  <span className="lwb-inspector-duplicate-row-main">
                    <span>{item.label}</span>
                    {item.detail ? <span className="lwb-inspector-duplicate-row-detail">{item.detail}</span> : null}
                  </span>
                  <span className="lwb-inspector-duplicate-row-icons" aria-label="Duplicate box actions">
                    {item.onPause ? (
                      <button
                        type="button"
                        className="lwb-inspector-duplicate-icon"
                        title="Pause duplicate box"
                        aria-label="Pause duplicate box"
                        onClick={(event) => {
                          event.stopPropagation();
                          void item.onPause?.();
                        }}
                      >
                        <PauseIcon />
                      </button>
                    ) : null}
                    {item.onResume ? (
                      <button
                        type="button"
                        className="lwb-inspector-duplicate-icon"
                        title="Resume duplicate box"
                        aria-label="Resume duplicate box"
                        onClick={(event) => {
                          event.stopPropagation();
                          void item.onResume?.();
                        }}
                      >
                        <ResumeIcon />
                      </button>
                    ) : null}
                    {item.onDelete ? (
                      <button
                        type="button"
                        className="lwb-inspector-duplicate-icon lwb-inspector-duplicate-icon--danger"
                        title="Delete duplicate box"
                        aria-label="Delete duplicate box"
                        onClick={(event) => {
                          event.stopPropagation();
                          void item.onDelete?.();
                        }}
                      >
                        <DeleteIcon />
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="empty">No duplicate boxes queued.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function SamplingControlsView({ control }: { control: LabelWorkbenchSamplingControl }) {
  return (
    <section className="lwb-inspector-section lwb-inspector-sampling-panel">
      <div className="lwb-inspector-row-title">
        <div className="lwb-inspector-kicker">Random Sampling</div>
        <span className="status">{control.segmentCount} segment(s)</span>
      </div>
      <div className="lwb-inspector-form">
        <div className="lwb-inspector-static-field">Source: {control.sourceLabel}</div>
        <label>
          <span>Sampling mode</span>
          <select
            value={control.mode}
            onChange={(event) => {
              void control.onModeChange?.(event.target.value);
            }}
          >
            {control.modeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Min spacing (ms)</span>
          <input
            type="number"
            min="0"
            step="100"
            value={control.minSpacingMs}
            onChange={(event) => {
              void control.onMinSpacingMsChange?.(Math.max(0, Number(event.target.value) || 0));
            }}
          />
        </label>
      </div>
    </section>
  );
}

function DetectClassPaletteView({ palette }: { palette: LabelWorkbenchClassPalette }) {
  const classes = palette.detectClasses ?? [];
  if (!classes.length || !palette.onSelectDetectClass) return null;
  return (
    <section className="panel lwb-inspector-detect-class-panel">
      <div className="panel-header">
        <span>Detect Classes</span>
        <span className="status">{palette.currentDetectClassId ?? "none"}</span>
      </div>
      <div className="panel-body">
        <div className="lwb-inspector-detect-class-list">
          {classes.map((item) => {
            const classId = safeNumber(item.id);
            const selected = classId !== null && classId === palette.currentDetectClassId;
            return (
              <button
                key={`${item.id ?? "class"}-${item.name}`}
                type="button"
                className={selected ? "selected" : ""}
                disabled={classId === null}
                onClick={() => {
                  if (classId !== null) void palette.onSelectDetectClass?.(classId);
                }}
              >
                {classId !== null ? `${classId}: ` : null}{item.name}
              </button>
            );
          })}
        </div>
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
  const samplingControl = inspectorState?.samplingControl ?? null;
  const classPalette = inspectorState?.classPalette ?? null;
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
  const actionsSection = (
    <section className="lwb-inspector-section">
      <div className="lwb-inspector-kicker">Actions</div>
      {hasActions ? (
        <ActionGroupsView groups={remainingActionGroups} hideGroupTitles={mode === "video"} />
      ) : (
        <div className="lwb-inspector-muted">No contextual actions available.</div>
      )}
    </section>
  );

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
          {reviewActionGroups.some((group) => group.actions.length > 0) ? (
            <ActionGroupsView groups={reviewActionGroups} hideGroupTitles />
          ) : null}
        </section>
      ) : null}

      {mode === "image" ? (
        <>
          <DuplicateActionsView group={duplicateActionGroup} />
          <div id="lwbClassifyClassesSlot" className="lwb-inspector-classify-slot" />
        </>
      ) : null}

      {mode === "video" && samplingControl ? <SamplingControlsView control={samplingControl} /> : null}

      {mode === "video" && (hasActions || (!hasReviewActions && !hasDuplicatePanel)) ? actionsSection : null}

      {mode === "video" && classPalette ? <DetectClassPaletteView palette={classPalette} /> : null}

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

      {mode !== "video" && (hasActions || (!hasReviewActions && !hasDuplicatePanel)) ? actionsSection : null}
    </aside>
  );
}
