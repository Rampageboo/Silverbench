import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { errMessage } from "../../lib/errors";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import type { BoxLabelViewProps } from "./boxLabelTypes";
import { BoxLabelPreviewToolbar } from "./BoxLabelPreviewToolbar";
import { BoxLabelShortcutDropdown } from "./BoxLabelShortcutDropdown";
import { classNameFor, SLOT_ORDER } from "./geometry";
import type { FixedBoxSlot } from "./session";
import { useBoxLabelEditor } from "./useBoxLabelEditor";

function fixedBoxReady(slot: FixedBoxSlot | null) {
  return Boolean(slot && slot.w > 0 && slot.h > 0);
}

type ClassToolMode = "none" | "add" | "search";
type CanvasClassSearchMenu = { x: number; y: number; query: string };

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

export const BoxLabelView = React.memo(function BoxLabelView(props: BoxLabelViewProps) {
  const editor = useBoxLabelEditor(props);
  const {
    classImageCounts,
    classificationClasses = [],
    classificationClassesBusy = false,
    classificationClassesStatus,
    classificationClassesPortalId,
    detectClassKeysById,
    currentClassificationKey,
    onAssignClassificationClass,
    onAddClassificationClass,
    onRenameClass,
    onWorkspaceClassesChanged,
    onWorkbenchBridgeChange,
    showSideStack = true,
    canvasOverlay,
    detectTaskEnabled = true,
    clfTaskEnabled = true,
    onToggleDetectTaskEnabled,
    onToggleClfTaskEnabled,
  } = props;
  const auraRef = useRef<HTMLDivElement | null>(null);
  const canvasClassSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [classificationClassNameInput, setClassificationClassNameInput] = useState("");
  const [classificationClassSearch, setClassificationClassSearch] = useState("");
  const [detectClassToolMode, setDetectClassToolMode] = useState<ClassToolMode>("none");
  const [classificationClassToolMode, setClassificationClassToolMode] = useState<ClassToolMode>("none");
  const [classificationPortalTarget, setClassificationPortalTarget] = useState<HTMLElement | null>(null);
  const [canvasClassSearchMenu, setCanvasClassSearchMenu] = useState<CanvasClassSearchMenu | null>(null);
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
  const filteredClassificationClasses = useMemo(() => {
    const activeClasses = classificationClasses
      .filter((item) => !item.archived)
      .sort(
        (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.key.localeCompare(b.key)
      );
    const terms = classificationClassSearch.trim().toLowerCase().split(" ").filter(Boolean);
    if (!terms.length) return activeClasses;
    return activeClasses.filter((item) => {
      const text = `${item.key} ${item.name}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [classificationClasses, classificationClassSearch]);
  const showDetectSearchTool = detectClassToolMode === "search" || editor.classSearch.trim().length > 0;
  const showClassificationSearchTool =
    classificationClassToolMode === "search" || classificationClassSearch.trim().length > 0;
  const canvasClassSearchResults = useMemo(() => {
    if (!canvasClassSearchMenu) return [];
    const activeClasses = editor.classes
      .filter((item) => !editor.isArchivedDetectClass(item.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id);
    const terms = canvasClassSearchMenu.query.trim().toLowerCase().split(" ").filter(Boolean);
    if (!terms.length) return activeClasses.slice(0, 24);
    return activeClasses
      .filter((item) => {
        const text = `${item.id} ${item.name}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .slice(0, 24);
  }, [canvasClassSearchMenu, editor.classes, editor.isArchivedDetectClass]);

  const handleAddClassificationClass = useCallback(() => {
    const name = classificationClassNameInput.trim();
    if (!name) {
      editor.setStatus("Enter a classification class name first.");
      return;
    }
    if (!onAddClassificationClass) {
      editor.setStatus("Classification class management is unavailable for this workspace.");
      return;
    }
    onAddClassificationClass(name)
      .then((classKey) => {
        if (!classKey) {
          editor.setStatus("Classification class was not created.");
          return;
        }
        setClassificationClassNameInput("");
        editor.setStatus(`Created classification class ${name}.`);
      })
      .catch((err) => editor.setError(errMessage(err)));
  }, [classificationClassNameInput, editor, onAddClassificationClass]);

  const handleAssignClassificationClass = useCallback(
    (classKey: string, className: string) => {
      if (!onAssignClassificationClass) {
        editor.setStatus("Classification assignment is unavailable for this source.");
        return;
      }
      const nextKey = classKey === currentClassificationKey ? null : classKey;
      onAssignClassificationClass(nextKey)
        .then(() =>
          editor.setStatus(
            nextKey ? `Assigned classification: ${className}.` : `Removed classification: ${className}.`
          )
        )
        .catch((err) => editor.setError(errMessage(err)));
    },
    [currentClassificationKey, editor, onAssignClassificationClass]
  );

  const handleRenameClass = useCallback(
    (classKey: string | undefined, currentName: string) => {
      if (!classKey) {
        editor.setStatus("This class cannot be renamed because no workspace class key was found.");
        return;
      }
      if (!onRenameClass) {
        editor.setStatus("Class rename is unavailable for this workspace.");
        return;
      }
      const nextName = window.prompt("Rename class", currentName);
      if (nextName === null) return;
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === currentName) return;
      onRenameClass(classKey, trimmed)
        .then(() => onWorkspaceClassesChanged?.())
        .then(() => editor.setStatus(`Renamed class ${currentName} to ${trimmed}.`))
        .catch((err) => editor.setError(errMessage(err)));
    },
    [editor, onRenameClass, onWorkspaceClassesChanged]
  );

  const handleCanvasContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const viewer = event.currentTarget.closest("#previewViewer") as HTMLElement | null;
      const rect = viewer?.getBoundingClientRect();
      const rawX = rect ? event.clientX - rect.left : event.clientX;
      const rawY = rect ? event.clientY - rect.top : event.clientY;
      const maxX = Math.max(8, (rect?.width ?? window.innerWidth) - 280);
      const maxY = Math.max(8, (rect?.height ?? window.innerHeight) - 340);
      setCanvasClassSearchMenu({
        x: Math.max(8, Math.min(rawX, maxX)),
        y: Math.max(8, Math.min(rawY, maxY)),
        query: "",
      });
      window.requestAnimationFrame(() => canvasClassSearchInputRef.current?.focus());
      editor.setStatus("Search detect classes.");
    },
    [editor]
  );

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      setCanvasClassSearchMenu(null);
      editor.onPointerDown(event);
    },
    [editor]
  );

  const handleCanvasClassSearchSelect = useCallback(
    (classId: number) => {
      setCanvasClassSearchMenu(null);
      editor.assignClass(classId).catch((err) => editor.setError(errMessage(err)));
    },
    [editor]
  );

  useEffect(() => {
    setCanvasClassSearchMenu(null);
  }, [props.entry?.basename]);

  useEffect(() => {
    if (!classificationClassesPortalId || typeof document === "undefined") {
      setClassificationPortalTarget(null);
      return;
    }
    setClassificationPortalTarget(document.getElementById(classificationClassesPortalId));
  }, [classificationClassesPortalId]);

  const classificationClassesPanel = (
    <section className="panel filter-panel pool-label-classes-panel pool-label-clf-classes-panel">
      <div className="panel-header pool-label-class-panel-header">
        {renderTaskLight(
          "Classify",
          `Classify Classes${classificationClasses.length ? ` (${classificationClasses.length})` : ""}`,
          clfTaskEnabled,
          onToggleClfTaskEnabled
        )}
        <div className="pool-label-class-header-actions">
          <button
            type="button"
            className={`pool-label-class-icon-btn${classificationClassToolMode === "add" ? " active" : ""}`}
            title="Add classify class"
            aria-label="Add classify class"
            aria-pressed={classificationClassToolMode === "add"}
            onClick={() =>
              setClassificationClassToolMode((mode) => (mode === "add" ? "none" : "add"))
            }
          >
            <AddIcon />
          </button>
          <button
            type="button"
            className={`pool-label-class-icon-btn${showClassificationSearchTool ? " active" : ""}`}
            title="Search classify classes"
            aria-label="Search classify classes"
            aria-pressed={showClassificationSearchTool}
            onClick={() =>
              setClassificationClassToolMode((mode) => (mode === "search" ? "none" : "search"))
            }
          >
            <SearchIcon />
          </button>
        </div>
      </div>
      <div className="panel-body filter-panel-body">
        <div className="pool-label-tools">
          {classificationClassToolMode === "add" ? (
            <div className="pool-label-class-inline-tool">
              <input
                id="poolLabelClfClassNameInput"
                type="text"
                placeholder="clf class"
                value={classificationClassNameInput}
                onChange={(event) => setClassificationClassNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleAddClassificationClass();
                  if (event.key === "Escape") setClassificationClassToolMode("none");
                }}
                disabled={classificationClassesBusy}
                autoFocus
              />
              <button
                id="poolLabelAddClfClassBtn"
                type="button"
                className="pool-label-class-inline-submit"
                onClick={handleAddClassificationClass}
                disabled={classificationClassesBusy}
                title="Add classify class"
                aria-label="Add classify class"
              >
                <AddIcon />
              </button>
            </div>
          ) : null}
          {showClassificationSearchTool ? (
            <div className="pool-label-class-inline-tool">
              <input
                id="poolLabelClfClassSearchInput"
                className="pool-label-class-search"
                type="search"
                placeholder="search clf classes"
                value={classificationClassSearch}
                onChange={(event) => setClassificationClassSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setClassificationClassSearch("");
                    setClassificationClassToolMode("none");
                  }
                }}
                autoFocus={classificationClassToolMode === "search"}
              />
            </div>
          ) : null}
          <div className="pool-label-class-list" id="poolLabelClfClassList">
            {filteredClassificationClasses.length ? (
              filteredClassificationClasses.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`pool-label-class-row pool-label-class-row--static pool-label-class-row--clf${item.key === currentClassificationKey ? " selected" : ""}`}
                  title={
                    item.key === currentClassificationKey
                      ? `Remove classify class: ${item.name}`
                      : `Assign classify class: ${item.name}`
                  }
                  aria-pressed={item.key === currentClassificationKey}
                  disabled={classificationClassesBusy || (!onAssignClassificationClass && !onRenameClass)}
                  onClick={() => handleAssignClassificationClass(item.key, item.name)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    handleRenameClass(item.key, item.name);
                  }}
                >
                  {item.name}
                </button>
              ))
            ) : (
              <div className="empty">No active clf classes.</div>
            )}
          </div>
          {classificationClassesStatus ? (
            <div className="hint pool-label-clf-class-status">{classificationClassesStatus}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
  const classificationClassesPortal =
    classificationClassesPortalId && classificationPortalTarget
      ? createPortal(classificationClassesPanel, classificationPortalTarget)
      : null;

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

  const handleWorkbenchStartDuplicate = useCallback(() => {
    editor.copySelectedBoxToNext().catch((err) => editor.setError(errMessage(err)));
  }, [editor.copySelectedBoxToNext, editor.setError]);

  const handleWorkbenchAdvanceDuplicate = useCallback(() => {
    editor.advanceDuplicateToNext().catch((err) => editor.setError(errMessage(err)));
  }, [editor.advanceDuplicateToNext, editor.setError]);

  const handleWorkbenchSelectDuplicate = useCallback((id: string) => {
    editor.selectDuplicateItem(id);
  }, [editor.selectDuplicateItem]);

  const handleWorkbenchPauseDuplicate = useCallback((id?: string) => {
    editor.pauseDuplicateFlow(id).catch((err) => editor.setError(errMessage(err)));
  }, [editor.pauseDuplicateFlow, editor.setError]);

  const handleWorkbenchResumeDuplicate = useCallback((id?: string) => {
    editor.resumeDuplicateFlow(id).catch((err) => editor.setError(errMessage(err)));
  }, [editor.resumeDuplicateFlow, editor.setError]);

  const handleWorkbenchDeleteDuplicate = useCallback((id?: string) => {
    editor.deleteDuplicateFlow(id).catch((err) => editor.setError(errMessage(err)));
  }, [editor.deleteDuplicateFlow, editor.setError]);

  useEffect(() => {
    onWorkbenchBridgeChange?.({
      proposalCount: editor.proposals.length,
      activeProposalCount,
      selectedProposalId: editor.selectedProposalId,
      selectedProposalArchived,
      selectedProposalClassId: selectedProposal?.classId ?? null,
      selectedProposalClassKey: selectedProposal?.classKey ?? null,
      selectedProposalClassName:
        selectedProposal?.classId != null
          ? classNameFor(editor.classes, selectedProposal.classId)
          : (selectedProposal?.classKey ?? null),
      selectedProposalConfidence: selectedProposal?.confidence ?? null,
      activeDetectClasses: editor.classes.map((item) => ({ id: item.id, name: item.name })),
      currentClassId: editor.currentClass,
      acceptSelectedProposal: editor.selectedProposalId ? handleWorkbenchAcceptSelectedProposal : null,
      rejectSelectedProposal: editor.selectedProposalId ? handleWorkbenchRejectSelectedProposal : null,
      acceptAllProposals: handleWorkbenchAcceptAllProposals,
      rejectAllProposals: handleWorkbenchRejectAllProposals,
      duplicateFlow: editor.duplicateFlow,
      startDuplicateToNext: handleWorkbenchStartDuplicate,
      advanceDuplicateToNext: handleWorkbenchAdvanceDuplicate,
      selectDuplicateItem: handleWorkbenchSelectDuplicate,
      pauseDuplicateFlow: handleWorkbenchPauseDuplicate,
      resumeDuplicateFlow: handleWorkbenchResumeDuplicate,
      deleteDuplicateFlow: handleWorkbenchDeleteDuplicate
    });
  }, [
    activeProposalCount,
    editor.proposals.length,
    editor.selectedProposalId,
    editor.classes,
    editor.currentClass,
    handleWorkbenchAcceptAllProposals,
    handleWorkbenchAcceptSelectedProposal,
    handleWorkbenchAdvanceDuplicate,
    handleWorkbenchDeleteDuplicate,
    handleWorkbenchPauseDuplicate,
    handleWorkbenchResumeDuplicate,
    handleWorkbenchSelectDuplicate,
    handleWorkbenchRejectAllProposals,
    handleWorkbenchRejectSelectedProposal,
    handleWorkbenchStartDuplicate,
    onWorkbenchBridgeChange,
    editor.duplicateFlow,
    selectedProposal,
    selectedProposalArchived
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

  const renderedCanvasOverlay =
    typeof canvasOverlay === "function"
      ? canvasOverlay({
          entry: props.entry,
          entries: props.entries,
          currentIndex: props.currentIndex,
          boxes: editor.boxes,
          proposals: editor.proposals,
          activeDetectClasses: editor.classes.map((item) => ({ id: item.id, name: item.name })),
          classificationClasses,
          currentClassificationKey: currentClassificationKey ?? null,
          addProposals: editor.addProposals,
          applyAutoLabelPredictions: editor.applyAutoLabelPredictions,
          assignClassificationClass: onAssignClassificationClass,
          reloadWorkspaceClasses: onWorkspaceClassesChanged,
        })
      : canvasOverlay;
  const renderedPreviewDock =
    typeof props.previewDock === "function"
      ? props.previewDock({
          entry: props.entry,
          entries: props.entries,
          currentIndex: props.currentIndex,
          boxes: editor.boxes,
          proposals: editor.proposals,
          activeDetectClasses: editor.classes.map((item) => ({ id: item.id, name: item.name })),
          classificationClasses,
          currentClassificationKey: currentClassificationKey ?? null,
          addProposals: editor.addProposals,
          applyAutoLabelPredictions: editor.applyAutoLabelPredictions,
          assignClassificationClass: onAssignClassificationClass,
          reloadWorkspaceClasses: onWorkspaceClassesChanged,
        })
      : props.previewDock;
  const currentMetadata = props.entry ? props.metadata.get(props.entry.basename) : undefined;
  const previewSourceName = props.entry?.basename ?? "No media selected";
  const previewIndexText =
    props.entry && props.entries.length > 0 ? `${props.currentIndex + 1} / ${props.entries.length}` : "0 / 0";
  const previewReviewLabel = isFlaggedFile(currentMetadata)
    ? "Flagged"
    : isReviewedFile(currentMetadata)
      ? "Reviewed"
      : "Unreviewed";
  function renderTaskLight(
    label: string,
    titleText: string,
    enabled: boolean,
    onToggle?: () => Promise<void>
  ) {
    const title = `${label} dataset ${enabled ? "included" : "excluded"}`;
    const content = (
      <>
        <span className="pool-label-task-light" aria-hidden="true" />
        <span>{titleText}</span>
      </>
    );
    if (!onToggle) {
      return (
        <span className={`pool-label-task-light-btn pool-label-task-title-chip${enabled ? " is-on" : " is-off"}`} title={title}>
          {content}
        </span>
      );
    }
    return (
      <button
        type="button"
        className={`pool-label-task-light-btn pool-label-task-title-chip${enabled ? " is-on" : " is-off"}`}
        title={title}
        aria-label={title}
        aria-pressed={enabled}
        disabled={!props.entry}
        onClick={() => {
          onToggle().catch((err) => editor.setError(errMessage(err)));
        }}
      >
        {content}
      </button>
    );
  }

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
                    label={
                      bound
                        ? `${slotData!.classId}: ${classNameFor(editor.classes, slotData!.classId)}${modeTag}`
                        : "empty"
                    }
                    active={
                      bound && slotData!.classId === editor.currentClass && editor.activeShortcutSlot === slot
                    }
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
                      <svg
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        aria-hidden="true"
                      >
                        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                        <rect x="7" y="7" width="10" height="10" rx="1" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        fill="currentColor"
                        stroke="none"
                        aria-hidden="true"
                      >
                        <path d="M6 3l10 10-5 1.5L8.5 20 6 3z" />
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
        <div className="panel-header pool-label-preview-header">
          <div className="pool-label-preview-heading">
            <span className="pool-label-preview-title">Preview</span>
            <span className="pool-label-preview-source" title={previewSourceName}>
              {previewSourceName}
            </span>
          </div>
          <div className="pool-label-preview-status-row">
            <span className="pool-label-preview-index">{previewIndexText}</span>
            <span className="pool-label-preview-chip">{previewReviewLabel}</span>
            <span id="boxCount" className="status pool-label-preview-box-count">
              {editor.boxes.length} box(es)
            </span>
          </div>
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
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={editor.onPointerMove}
              onPointerUp={editor.onPointerUp}
              onPointerCancel={editor.onPointerUp}
              onContextMenu={handleCanvasContextMenu}
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
            <BoxLabelPreviewToolbar
              pointerToolEnabled={editor.pointerToolEnabled}
              autoFitEnabled={editor.autoFitEnabled}
              blackBoxEnabled={editor.blackBoxEnabled}
              boxAdjustMode={editor.boxAdjustMode}
              tracking={editor.tracking}
              canCopyNext={editor.selectedBoxId !== null && editor.currentIndex >= 0}
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
          </aside>
          {renderedCanvasOverlay ?? null}
          {canvasClassSearchMenu ? (
            <div
              className="pool-label-canvas-class-menu"
              style={{ left: canvasClassSearchMenu.x, top: canvasClassSearchMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <input
                ref={canvasClassSearchInputRef}
                className="pool-label-canvas-class-search"
                type="search"
                placeholder="Search detect class"
                value={canvasClassSearchMenu.query}
                onChange={(event) =>
                  setCanvasClassSearchMenu((menu) =>
                    menu ? { ...menu, query: event.target.value } : menu
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setCanvasClassSearchMenu(null);
                    return;
                  }
                  if (event.key === "Enter") {
                    const first = canvasClassSearchResults[0];
                    if (first) handleCanvasClassSearchSelect(first.id);
                  }
                }}
              />
              <div className="pool-label-canvas-class-results" role="listbox">
                {canvasClassSearchResults.length ? (
                  canvasClassSearchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`pool-label-canvas-class-option${item.id === editor.currentClass ? " selected" : ""}`}
                      onClick={() => handleCanvasClassSearchSelect(item.id)}
                    >
                      <span>{item.id}: {item.name}</span>
                      <span className="pool-label-canvas-class-count">{classImageCounts.get(item.id) || 0}</span>
                    </button>
                  ))
                ) : (
                  <div className="pool-label-canvas-class-empty">No matching classes.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        {renderedPreviewDock ? <div className="pool-label-preview-dock">{renderedPreviewDock}</div> : null}
      </section>

      {classificationClassesPortal}
      {showSideStack ? (
        <aside className="side-stack pool-label-side-stack" id="poolLabelSideStack">
          <section className="panel pool-label-box-panel" id="poolLabelBoxPanel">
            <div className="panel-header">
              <span>Current Boxes</span>
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
                      {index + 1}. {classNameFor(editor.classes, box.classId)} x={box.x.toFixed(3)} y=
                      {box.y.toFixed(3)} w={box.w.toFixed(3)} h={box.h.toFixed(3)}
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

          <div
            className={`pool-label-class-panels${classificationClassesPortalId ? " pool-label-class-panels--single" : ""}`}
          >
            <section className="panel filter-panel pool-label-classes-panel pool-label-detect-classes-panel">
              <div className="panel-header pool-label-class-panel-header">
                {renderTaskLight("Detect", "Detect Classes", detectTaskEnabled, onToggleDetectTaskEnabled)}
                <div className="pool-label-class-header-actions">
                  <button
                    type="button"
                    className={`pool-label-class-icon-btn${detectClassToolMode === "add" ? " active" : ""}`}
                    title="Add detect class"
                    aria-label="Add detect class"
                    aria-pressed={detectClassToolMode === "add"}
                    onClick={() => setDetectClassToolMode((mode) => (mode === "add" ? "none" : "add"))}
                  >
                    <AddIcon />
                  </button>
                  <button
                    type="button"
                    className={`pool-label-class-icon-btn${showDetectSearchTool ? " active" : ""}`}
                    title="Search detect classes"
                    aria-label="Search detect classes"
                    aria-pressed={showDetectSearchTool}
                    onClick={() =>
                      setDetectClassToolMode((mode) => (mode === "search" ? "none" : "search"))
                    }
                  >
                    <SearchIcon />
                  </button>
                </div>
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
                  {detectClassToolMode === "add" ? (
                    <div className="pool-label-class-inline-tool">
                      <input
                        id="poolLabelClassNameInput"
                        type="text"
                        placeholder="detect class"
                        value={editor.classNameInput}
                        onChange={(event) => editor.setClassNameInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") editor.addClass();
                          if (event.key === "Escape") setDetectClassToolMode("none");
                        }}
                        autoFocus
                      />
                      <button
                        id="poolLabelAddClassBtn"
                        type="button"
                        className="pool-label-class-inline-submit"
                        onClick={editor.addClass}
                        title="Add detect class"
                        aria-label="Add detect class"
                      >
                        <AddIcon />
                      </button>
                    </div>
                  ) : null}
                  {showDetectSearchTool ? (
                    <div className="pool-label-class-inline-tool">
                      <input
                        id="poolLabelClassSearchInput"
                        className="pool-label-class-search"
                        type="search"
                        placeholder="search detect classes"
                        value={editor.classSearch}
                        onChange={(event) => editor.setClassSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            editor.setClassSearch("");
                            setDetectClassToolMode("none");
                          }
                        }}
                        autoFocus={detectClassToolMode === "search"}
                      />
                    </div>
                  ) : null}
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
                          if (event.shiftKey) {
                            editor.onAddExcludeClass(item.id);
                            return;
                          }
                          if (event.ctrlKey || event.altKey || event.metaKey) {
                            editor.onAddIncludeClass(item.id);
                            return;
                          }
                          handleRenameClass(detectClassKeysById?.[item.id], item.name);
                        }}
                        title="Single-click: select class · Double-click: relabel selected box · Right-click: rename · Shift/right-click: exclude filter · Ctrl/right-click: include filter"
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
            {classificationClassesPortalId ? null : classificationClassesPanel}
          </div>
        </aside>
      ) : null}
    </>
  );
});
