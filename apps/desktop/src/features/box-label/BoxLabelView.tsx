import React, { useRef, useCallback, useEffect, useMemo } from "react";
import { errMessage } from "../../lib/errors";
import type { BoxLabelViewProps } from "./boxLabelTypes";
import { BoxLabelPreviewToolbar } from "./BoxLabelPreviewToolbar";
import { BoxLabelShortcutDropdown } from "./BoxLabelShortcutDropdown";
import { classNameFor, SLOT_ORDER } from "./geometry";
import type { FixedBoxSlot } from "./session";
import { useBoxLabelEditor } from "./useBoxLabelEditor";

function fixedBoxReady(slot: FixedBoxSlot | null) {
  return Boolean(slot && slot.w > 0 && slot.h > 0);
}

export const BoxLabelView = React.memo(function BoxLabelView(props: BoxLabelViewProps) {
  const editor = useBoxLabelEditor(props);
  const { classImageCounts, onWorkbenchBridgeChange } = props;
  const auraRef = useRef<HTMLDivElement | null>(null);
  const selectedProposal = editor.selectedProposalId
    ? editor.proposals.find((p) => p.id === editor.selectedProposalId)
    : null;
  const selectedProposalArchived =
    (selectedProposal?.classId != null && editor.isArchivedDetectClass(selectedProposal.classId)) ||
    (Boolean(selectedProposal?.classKey) && editor.isArchivedClassKey(selectedProposal!.classKey!));
  const activeProposalCount = useMemo(
    () =>
      editor.proposals.filter(
        (proposal) =>
          !(
            (proposal.classId != null && editor.isArchivedDetectClass(proposal.classId)) ||
            (Boolean(proposal.classKey) && editor.isArchivedClassKey(proposal.classKey!))
          )
      ).length,
    [editor.proposals, editor.isArchivedDetectClass, editor.isArchivedClassKey]
  );

  const handleWorkbenchAcceptSelectedProposal = useCallback(() => {
    if (!editor.selectedProposalId) return;
    editor.materializeProposal(editor.selectedProposalId).catch((err) => editor.setError(errMessage(err)));
  }, [editor.materializeProposal, editor.selectedProposalId, editor.setError]);

  const handleWorkbenchRejectSelectedProposal = useCallback(() => {
    if (!editor.selectedProposalId) return;
    editor.rejectProposal(editor.selectedProposalId).catch((err) => editor.setError(errMessage(err)));
  }, [editor.rejectProposal, editor.selectedProposalId, editor.setError]);

  const handleWorkbenchAcceptAllProposals = useCallback(() => {
    editor.acceptAllProposals().catch((err) => editor.setError(errMessage(err)));
  }, [editor.acceptAllProposals, editor.setError]);

  const handleWorkbenchRejectAllProposals = useCallback(() => {
    editor.rejectAllProposals().catch((err) => editor.setError(errMessage(err)));
  }, [editor.rejectAllProposals, editor.setError]);

  useEffect(() => {
    onWorkbenchBridgeChange?.({
      proposalCount: editor.proposals.length,
      activeProposalCount,
      selectedProposalId: editor.selectedProposalId,
      selectedProposalArchived,
      selectedProposalClassId: selectedProposal?.classId ?? null,
      selectedProposalClassKey: selectedProposal?.classKey ?? null,
      selectedProposalClassName: selectedProposal?.classId != null
        ? classNameFor(editor.classes, selectedProposal.classId)
        : selectedProposal?.classKey ?? null,
      selectedProposalConfidence: selectedProposal?.confidence ?? null,
      activeDetectClasses: editor.classes.map((item) => ({ id: item.id, name: item.name })),
      currentClassId: editor.currentClass,
      acceptSelectedProposal: editor.selectedProposalId ? handleWorkbenchAcceptSelectedProposal : null,
      rejectSelectedProposal: editor.selectedProposalId ? handleWorkbenchRejectSelectedProposal : null,
      acceptAllProposals: handleWorkbenchAcceptAllProposals,
      rejectAllProposals: handleWorkbenchRejectAllProposals,
    });
  }, [
    activeProposalCount,
    editor.proposals.length,
    editor.selectedProposalId,
    editor.classes,
    editor.currentClass,
    handleWorkbenchAcceptAllProposals,
    handleWorkbenchAcceptSelectedProposal,
    handleWorkbenchRejectAllProposals,
    handleWorkbenchRejectSelectedProposal,
    onWorkbenchBridgeChange,
    selectedProposal,
    selectedProposalArchived,
  ]);

  useEffect(() => {
    return () => onWorkbenchBridgeChange?.(null);
  }, [onWorkbenchBridgeChange]);

  const handleCanvasWrapMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const aura = auraRef.current;
    if (!aura) return;
    const rect = e.currentTarget.getBoundingClientRect();
    aura.style.left = `${e.clientX - rect.left}px`;
    aura.style.top = `${e.clientY - rect.top}px`;
    aura.style.opacity = "1";
  }, []);

  const handleCanvasWrapMouseLeave = useCallback(() => {
    const aura = auraRef.current;
    if (aura) aura.style.opacity = "0";
  }, []);

  return (
    <>
      <section
        className={`pool-label-shortcuts-panel${editor.fixedShortcutMode ? " fixed-mode" : " class-mode"}`}
        id="poolLabelShortcutsPanel"
      >
        <div className="pool-label-shortcuts" id="poolLabelShortcuts">
          {SLOT_ORDER.map((slot) => {
            const slotData = editor.shortcutSlots[slot];
            const bound = slotData != null && editor.classes.some((item) => item.id === slotData.classId);
            const slotMode = slotData?.mode ?? "draw";
            const modeTag = slotMode === "subject-select" ? " · SS" : "";
            return (
              <div className="pool-label-shortcut-slot" key={slot}>
                <div className="pool-label-shortcut-number">{slot}</div>
                <div className="pool-label-shortcut-class-row-wrap">
                  <BoxLabelShortcutDropdown
                    className="class-slot"
                    title={`Shortcut ${slot}`}
                    label={bound ? `${slotData!.classId}: ${classNameFor(editor.classes, slotData!.classId)}${modeTag}` : "empty"}
                    active={bound && slotData!.classId === editor.currentClass && editor.activeShortcutSlot === slot}
                    options={editor.classShortcutOptions(slot)}
                    onSelect={(value) => {
                      const next = editor.shortcutSlots.slice();
                      if (value === "") {
                        next[slot] = null;
                      } else {
                        const existingMode = next[slot]?.mode ?? "draw";
                        next[slot] = { classId: Number(value), mode: existingMode };
                      }
                      editor.setShortcutSlots(next);
                      if (value !== "") editor.selectClassShortcut(slot, true);
                      else editor.setStatus(`Shortcut ${slot} cleared.`);
                    }}
                  />
                  <button
                    type="button"
                    className={`pool-label-shortcut-mode-btn${slotMode === "subject-select" ? " mode-ss" : " mode-draw"}`}
                    title={`Shortcut ${slot} mode: ${slotMode === "subject-select" ? "Subject Select" : "Draw"} — click to toggle`}
                    disabled={!bound}
                    onClick={() => {
                      const next = editor.shortcutSlots.slice();
                      const current = next[slot];
                      if (!current) return;
                      next[slot] = {
                        ...current,
                        mode: current.mode === "draw" ? "subject-select" : "draw"
                      };
                      editor.setShortcutSlots(next);
                      editor.setStatus(
                        `Shortcut ${slot} mode → ${next[slot]!.mode === "subject-select" ? "Subject Select" : "Draw"}.`
                      );
                    }}
                  >
                    {slotMode === "subject-select" ? (
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
                        <rect x="7" y="7" width="10" height="10" rx="1"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" stroke="none" aria-hidden="true">
                        <path d="M6 3l10 10-5 1.5L8.5 20 6 3z"/>
                      </svg>
                    )}
                  </button>
                </div>
                <BoxLabelShortcutDropdown
                  className="fixed-slot"
                  title={`Alt shortcut ${slot}`}
                  label={
                    editor.fixedBoxSlots[slot]?.classId != null
                      ? editor.fixedShortcutOptions(slot).find((item) => item.selected)?.label || "Alt: empty"
                      : "Alt: empty"
                  }
                  active={fixedBoxReady(editor.fixedBoxSlots[slot])}
                  recording={editor.recordingFixedBoxSlot === slot}
                  options={editor.fixedShortcutOptions(slot)}
                  onSelect={(value) => {
                    editor.startFixedBoxRecording(slot, value === "" ? null : Number(value));
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel" id="previewPanel">
        <div className="panel-header">
          <span>Preview</span>
          <span id="boxCount" className="status">
            {editor.boxes.length} box(es)
          </span>
        </div>
        <div className="panel-body viewer" id="previewViewer">
          {editor.error ? <div className="error-banner">{editor.error}</div> : null}
          <div
            className={`canvas-wrap${editor.pointerToolEnabled ? " pool-label-pointer-tool" : ""}${editor.autoFitEnabled ? " pool-label-subject-select" : ""}${editor.blackBoxEnabled ? " pool-label-black-box-tool" : ""}`}
            id="dropZone"
            ref={editor.stageRef}
            onMouseMove={handleCanvasWrapMouseMove}
            onMouseLeave={handleCanvasWrapMouseLeave}
          >
            <canvas
              id="previewCanvas"
              ref={editor.canvasRef}
              onPointerDown={editor.onPointerDown}
              onPointerMove={editor.onPointerMove}
              onPointerUp={editor.onPointerUp}
              onPointerCancel={editor.onPointerUp}
              onContextMenu={(event) => event.preventDefault()}
              onWheel={editor.onWheel}
            />
            <div
              ref={auraRef}
              className="cursor-aura"
              data-adjust={editor.boxAdjustMode}
              style={{ opacity: 0 }}
              aria-hidden="true"
            />
          </div>
          <aside className="pool-label-zoom-side" id="poolLabelZoomSide">
            <div className="pool-label-zoom-view" id="poolLabelZoomView">
              <canvas id="poolLabelZoomCanvas" ref={editor.zoomCanvasRef} width={500} height={600} />
              <div className="pool-label-zoom-class" id="poolLabelZoomClass">
                {editor.selectedBox
                  ? classNameFor(editor.classes, editor.selectedBox.classId)
                  : classNameFor(editor.classes, editor.currentClass)}
              </div>
            </div>
          </aside>
          <BoxLabelPreviewToolbar
            pointerToolEnabled={editor.pointerToolEnabled}
            autoFitEnabled={editor.autoFitEnabled}
            blackBoxEnabled={editor.blackBoxEnabled}
            boxAdjustMode={editor.boxAdjustMode}
            tracking={editor.tracking}
            canCopyNext={
              editor.selectedBoxId !== null &&
              editor.currentIndex >= 0 &&
              editor.currentIndex < editor.entries.length - 1
            }
            onTogglePointerTool={editor.togglePointerTool}
            onToggleAutoFit={editor.toggleAutoFitTool}
            onToggleBlackBox={editor.toggleBlackBoxTool}
            onRestoreBackup={() => editor.restoreBackup().catch((err) => editor.setError(errMessage(err)))}
            onToggleBoxAdjustMode={() =>
              editor.setBoxAdjustMode((value) => (value === "grow" ? "shrink" : "grow"))
            }
            onCopyNext={() => editor.copySelectedBoxToNext().catch((err) => editor.setError(errMessage(err)))}
            onCsrtTrack={() => editor.trackCsrtForward().catch((err) => editor.setError(errMessage(err)))}
          />
        </div>
      </section>

      <aside className="side-stack pool-label-side-stack" id="poolLabelSideStack">
        <section className="panel pool-label-box-panel" id="poolLabelBoxPanel">
          <div className="panel-header">
            <span>Current Boxes</span>
            <span className="pool-label-review-queue-actions">
              <button
                type="button"
                title="Go to previous image that needs review"
                onClick={() => editor.prevNeedsReview()}
              >
                ← Needs Review
              </button>
              <button
                type="button"
                title="Go to next image that needs review"
                onClick={() => editor.nextNeedsReview()}
              >
                Needs Review →
              </button>
            </span>
          </div>
          <div className="panel-body pool-label-box-panel-body">
            <div className="hint" id="poolLabelStatus">
              {editor.status}
              {editor.filterText ? ` | ${editor.filterText}` : ""}
              {editor.shiftSelectedFilenames.size
                ? ` | selected ${editor.shiftSelectedFilenames.size} image(s)`
                : ""}
            </div>
            <div className="pool-label-box-list" id="poolLabelBoxList">
              {editor.boxes.length ? (
                editor.boxes.map((box, index) => (
                  <button
                    key={`${index}-${box.classId}-${box.x}-${box.y}`}
                    type="button"
                    className={`pool-label-box-row${editor.selectedBoxId === index ? " selected" : ""}`}
                    onClick={() => {
                      editor.setSelectedBoxId(index);
                      editor.setCurrentClass(box.classId);
                    }}
                  >
                    {index + 1}. {classNameFor(editor.classes, box.classId)} x={box.x.toFixed(3)} y={box.y.toFixed(3)}{" "}
                    w={box.w.toFixed(3)} h={box.h.toFixed(3)}
                    {editor.isArchivedDetectClass(box.classId) ? (
                      <span className="pool-label-archived-badge">archived</span>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="empty">No boxes on this image.</div>
              )}
            </div>
          </div>
        </section>

        {editor.proposals.length > 0 && (
          <section className="panel pool-label-proposals-panel" id="poolLabelProposalsPanel">
            <div className="panel-header">
              <span>Proposals ({editor.proposals.length})</span>
              <span className="pool-label-proposal-actions">
                {editor.selectedProposalId && (
                  <>
                    <button
                      type="button"
                      className="primary"
                      title={selectedProposalArchived ? "Restore this class in Library before materializing" : "Materialize selected proposal as a box"}
                      disabled={selectedProposalArchived}
                      onClick={() =>
                        editor.materializeProposal(editor.selectedProposalId!).catch((err) => editor.setError(errMessage(err)))
                      }
                    >
                      Materialize
                    </button>
                    <button
                      type="button"
                      title="Reject selected proposal"
                      onClick={() =>
                        editor.rejectProposal(editor.selectedProposalId!).catch((err) => editor.setError(errMessage(err)))
                      }
                    >
                      Reject
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="primary"
                  title="Accept all proposals as boxes"
                  onClick={() => editor.acceptAllProposals().catch((err) => editor.setError(errMessage(err)))}
                >
                  Accept All
                </button>
                <button
                  type="button"
                  title="Reject all proposals"
                  onClick={() => editor.rejectAllProposals().catch((err) => editor.setError(errMessage(err)))}
                >
                  Reject All
                </button>
              </span>
            </div>
            <div className="panel-body pool-label-proposals-body">
              {editor.proposals.map((p) => {
                const archivedProposal =
                  (p.classId != null && editor.isArchivedDetectClass(p.classId)) ||
                  (Boolean(p.classKey) && editor.isArchivedClassKey(p.classKey!));
                return (
                <div
                  key={p.id}
                  className={`pool-label-proposal-row${editor.selectedProposalId === p.id ? " selected" : ""}`}
                  onClick={() => editor.setSelectedProposalId(editor.selectedProposalId === p.id ? null : p.id)}
                >
                  <span className="pool-label-proposal-conf">{Math.round(p.confidence * 100)}%</span>
                  <span className="pool-label-proposal-coords">
                    {archivedProposal ? <span className="pool-label-archived-badge">archived</span> : null}
                    {p.x.toFixed(3)},{p.y.toFixed(3)} {p.w.toFixed(3)}×{p.h.toFixed(3)}
                  </span>
                  <span className="pool-label-proposal-btns">
                    <button
                      type="button"
                      className="primary pool-label-proposal-accept"
                      title={archivedProposal ? "Restore this class in Library before materializing" : "Materialize this proposal as a box"}
                      disabled={archivedProposal}
                      onClick={(e) => {
                        e.stopPropagation();
                        editor.materializeProposal(p.id).catch((err) => editor.setError(errMessage(err)));
                      }}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="pool-label-proposal-reject"
                      title="Reject this proposal"
                      onClick={(e) => {
                        e.stopPropagation();
                        editor.rejectProposal(p.id).catch((err) => editor.setError(errMessage(err)));
                      }}
                    >
                      ✗
                    </button>
                  </span>
                </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="panel filter-panel pool-label-classes-panel">
          <div className="panel-header">
            <span>Classes</span>
            <span className="status">{editor.currentClass}</span>
          </div>
          <div className="panel-body filter-panel-body">
            <div className="pool-label-tools">
              {(editor.includeClasses.size > 0 || editor.excludeClasses.size > 0) && (
                <div className="row yolo-filter-tools" style={{ marginBottom: 8 }}>
                  <button type="button" onClick={() => editor.onClearClassFilters()}>
                    Deselect All Filters
                  </button>
                </div>
              )}
              <div className="row">
                <input
                  id="poolLabelClassNameInput"
                  type="text"
                  placeholder="class name"
                  value={editor.classNameInput}
                  onChange={(event) => editor.setClassNameInput(event.target.value)}
                />
                <button id="poolLabelAddClassBtn" type="button" className="primary" onClick={editor.addClass}>
                  Add Class
                </button>
              </div>
              <input
                id="poolLabelClassSearchInput"
                className="pool-label-class-search"
                type="search"
                placeholder="search classes"
                value={editor.classSearch}
                onChange={(event) => editor.setClassSearch(event.target.value)}
              />
              <div className="pool-label-class-list" id="poolLabelClassList">
                {editor.filteredClasses.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`pool-label-class-row${item.id === editor.currentClass ? " selected" : ""}${editor.includeClasses.has(item.id) ? " include-filter" : ""}${editor.excludeClasses.has(item.id) ? " exclude-filter" : ""}`}
                    onClick={() => void editor.assignClass(item.id)}
                    onDoubleClick={() => void editor.applyClassToSelectedBox(item.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (event.shiftKey) editor.onAddExcludeClass(item.id);
                      else editor.onAddIncludeClass(item.id);
                    }}
                    title="Single-click: select class · Double-click: relabel selected box · Right-click: include/exclude filter"
                  >
                    {item.id}: {item.name}
                    {editor.includeClasses.has(item.id) ? " [inc]" : ""}
                    {editor.excludeClasses.has(item.id) ? " [exc]" : ""}
                    <span className="pool-label-class-row-count" aria-hidden="true">
                      {classImageCounts.get(item.id) || 0}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </aside>
    </>
  );
});
