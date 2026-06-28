import type {
  LabelProposalSummary,
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

function proposalText(summary: LabelProposalSummary | null | undefined) {
  if (!summary) return null;
  const pending = safeNumber(summary.pendingCount);
  const total = safeNumber(summary.totalCount);
  if (pending === null && total === null) return null;
  if (pending !== null && total !== null) return `${pending} pending / ${total} total`;
  if (pending !== null) return `${pending} pending`;
  return `${total} total`;
}

function proposalCount(summary: LabelProposalSummary | null | undefined) {
  if (!summary) return null;
  const total = safeNumber(summary.totalCount);
  const pending = safeNumber(summary.pendingCount);
  return total ?? pending;
}

function confidenceText(value: number | null | undefined) {
  const confidence = safeNumber(value);
  if (confidence === null) return null;
  return confidence <= 1 ? `${Math.round(confidence * 100)}%` : `${confidence.toFixed(1)}%`;
}

function classItemKey(item: { id?: number | null; key?: string | null; name: string }, index: number) {
  return item.key || (item.id != null ? String(item.id) : `${item.name}-${index}`);
}

function classItemLabel(item: { id?: number | null; key?: string | null; name: string }) {
  return item.id != null ? `${item.id}: ${item.name}` : item.name;
}

function selectedProposalLabel(proposal: LabelWorkbenchInspectorState["selectedProposal"]) {
  if (!proposal) return null;
  const label = proposal.className || proposal.classKey || proposal.classId;
  return label != null ? String(label) : proposal.id;
}

function isSelectedProposalAction(action: LabelWorkbenchAction) {
  return action.id === "proposal.acceptSelected" || action.id === "proposal.rejectSelected";
}

function isBatchProposalAction(action: LabelWorkbenchAction) {
  return action.id === "proposal.acceptAll" || action.id === "proposal.rejectAll";
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

export function LabelWorkbenchInspector({
  mode,
  sourceSummary,
  inspectorState,
  actionGroups,
}: Props) {
  const taskKind = inspectorState?.taskKind ?? "both";
  const classSummary = inspectorState?.classSummary;
  const proposalSummary = proposalText(inspectorState?.proposalSummary);
  const proposalCountValue = proposalCount(inspectorState?.proposalSummary);
  const overlayCount = safeNumber(inspectorState?.overlaySummary?.activeCount);
  const segment = inspectorState?.segmentSummary;
  const warnings = inspectorState?.warnings ?? [];
  const reviewActionGroups = mode === "image"
    ? actionGroups.filter((group) => group.id === "image-review")
    : [];
  const proposalActionGroups = mode === "image"
    ? actionGroups.filter((group) => group.id === "image-proposals")
    : [];
  const remainingActionGroups = mode === "image"
    ? actionGroups.filter((group) => group.id !== "image-review" && group.id !== "image-proposals")
    : actionGroups;
  const selectedProposal = inspectorState?.selectedProposal;
  const proposalActions = proposalActionGroups.flatMap((group) => group.actions);
  const visibleProposalActions =
    proposalCountValue !== null && proposalCountValue > 0
      ? proposalActions.filter((action) =>
          selectedProposal
            ? isSelectedProposalAction(action) || (proposalCountValue > 1 && isBatchProposalAction(action))
            : isBatchProposalAction(action)
        )
      : [];
  const visibleProposalActionGroups = visibleProposalActions.length
    ? [{ id: "image-proposals", label: "Proposals", actions: visibleProposalActions }]
    : [];
  const hasProposalReviewActions =
    reviewActionGroups.some((group) => group.actions.length > 0) ||
    visibleProposalActionGroups.some((group) => group.actions.length > 0);
  const hasActions = remainingActionGroups.some((group) => group.actions.length > 0);
  const selectedProposalConfidence = confidenceText(selectedProposal?.confidence);
  const selectedProposalName = selectedProposalLabel(selectedProposal);
  const classPalette = inspectorState?.classPalette;
  const detectClasses = (classPalette?.detectClasses ?? []).filter((item) => !item.archived);
  const classificationClasses = (classPalette?.classificationClasses ?? []).filter((item) => !item.archived);
  const visibleDetectClasses = detectClasses.slice(0, 18);
  const visibleClassificationClasses = classificationClasses.slice(0, 18);
  const hiddenDetectCount = Math.max(0, detectClasses.length - visibleDetectClasses.length);
  const hiddenClassificationCount = Math.max(0, classificationClasses.length - visibleClassificationClasses.length);

  return (
    <aside className="lwb-inspector" aria-label="Label workbench inspector">
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

      {mode === "image" ? (
        <section className="lwb-inspector-section lwb-inspector-proposal-review">
          <div className="lwb-inspector-kicker">Proposal / Review</div>
          <div className="lwb-inspector-grid">
            <span>Review: {reviewLabel(sourceSummary, inspectorState)}</span>
            {proposalCountValue !== null && proposalCountValue <= 0 ? (
              <span>No proposals on this image.</span>
            ) : null}
            {proposalCountValue !== null && proposalCountValue > 0 ? (
              <span>Proposals: {proposalSummary ?? `${proposalCountValue} total`}</span>
            ) : null}
            {proposalCountValue !== null && proposalCountValue > 0 && selectedProposal ? (
              <>
                <span>Selected: {selectedProposalName}</span>
                {selectedProposalConfidence ? <span>Confidence: {selectedProposalConfidence}</span> : null}
                {selectedProposal.archived ? <span>Selected proposal class is archived.</span> : null}
              </>
            ) : null}
            {proposalCountValue !== null && proposalCountValue > 0 && !selectedProposal ? (
              <span>Select a proposal to accept or reject it.</span>
            ) : null}
          </div>
          {reviewActionGroups.some((group) => group.actions.length > 0) ? <ActionGroupsView groups={reviewActionGroups} /> : null}
          {visibleProposalActionGroups.length ? <ActionGroupsView groups={visibleProposalActionGroups} /> : null}
        </section>
      ) : null}

      {classSummary ? (
        <section className="lwb-inspector-section">
          <div className="lwb-inspector-kicker">Classes</div>
          <div className="lwb-inspector-grid">
            {safeNumber(classSummary.activeDetectCount) !== null ? (
              <span>Detect active: {safeNumber(classSummary.activeDetectCount)}</span>
            ) : null}
            {safeNumber(classSummary.totalDetectCount) !== null ? (
              <span>Detect total: {safeNumber(classSummary.totalDetectCount)}</span>
            ) : null}
            {safeNumber(classSummary.activeClassificationCount) !== null ? (
              <span>Classify active: {safeNumber(classSummary.activeClassificationCount)}</span>
            ) : null}
            {safeNumber(classSummary.observedClassCount) !== null ? (
              <span>Observed: {safeNumber(classSummary.observedClassCount)}</span>
            ) : null}
          </div>
          {classPalette ? (
            <div className="lwb-inspector-class-palette">
              {visibleDetectClasses.length ? (
                <div className="lwb-inspector-class-group">
                  <div className="lwb-inspector-action-group-title">Active Detect</div>
                  <div className="lwb-inspector-chip-row">
                    {visibleDetectClasses.map((item, index) => (
                      <span
                        key={classItemKey(item, index)}
                        className={`lwb-inspector-chip lwb-inspector-class-chip${item.id === classPalette.currentDetectClassId ? " selected" : ""}`}
                      >
                        {classItemLabel(item)}
                      </span>
                    ))}
                    {hiddenDetectCount ? <span className="lwb-inspector-muted">+{hiddenDetectCount} more</span> : null}
                  </div>
                </div>
              ) : null}
              {visibleClassificationClasses.length ? (
                <div className="lwb-inspector-class-group">
                  <div className="lwb-inspector-action-group-title">Active Classify</div>
                  <div className="lwb-inspector-chip-row">
                    {visibleClassificationClasses.map((item, index) => (
                      <span
                        key={classItemKey(item, index)}
                        className={`lwb-inspector-chip lwb-inspector-class-chip${item.key === classPalette.currentClassificationKey ? " selected" : ""}`}
                      >
                        {item.name}
                      </span>
                    ))}
                    {hiddenClassificationCount ? <span className="lwb-inspector-muted">+{hiddenClassificationCount} more</span> : null}
                  </div>
                </div>
              ) : null}
              {classPalette.readOnlyReason ? <div className="lwb-inspector-muted">{classPalette.readOnlyReason}</div> : null}
            </div>
          ) : null}
        </section>
      ) : null}

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

      {hasActions || !hasProposalReviewActions ? (
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
