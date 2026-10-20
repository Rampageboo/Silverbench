import { useState } from "react";
import { detectClassChipLabel } from "./helpers";
import type { AssignTarget, DetectClass } from "./types";
import "./inbox.css";

type ImageAssignPanelProps = {
  selectedCount: number;
  workflowStatus: string;
  assignTarget: AssignTarget;
  assigning: boolean;
  log: string;
  pendingFiles: number;
  rebuild: boolean;
  clfClasses: string[];
  detectClasses: DetectClass[];
  clfClassCounts: Map<string, number>;
  detectClassCounts: Map<number, number>;
  clfDatasetPath: string;
  detectDatasetPath: string;
  selectedClass: string;
  selectedDetectClassId: number | null;
  classSearch: string;
  detectClassSearch: string;
  canQuickAssign: boolean;
  onAssignTargetChange: (target: AssignTarget) => void;
  onClassSearchChange: (value: string) => void;
  onDetectClassSearchChange: (value: string) => void;
  onSelectClass: (className: string) => void;
  onQuickAssignClass: (className: string) => void;
  onSelectDetectClass: (classId: number) => void;
  onQuickAssignDetect: () => void;
  onApplySelected: (newClass?: string) => void;
  onBuildPending: () => void;
  onBuildAll: () => void;
  onRebuildChange: (value: boolean) => void;
};

export function ImageAssignPanel({
  selectedCount,
  workflowStatus,
  assignTarget,
  assigning,
  log,
  pendingFiles,
  rebuild,
  clfClasses,
  detectClasses,
  clfClassCounts,
  detectClassCounts,
  clfDatasetPath,
  detectDatasetPath,
  selectedClass,
  selectedDetectClassId,
  classSearch,
  detectClassSearch,
  canQuickAssign,
  onAssignTargetChange,
  onClassSearchChange,
  onDetectClassSearchChange,
  onSelectClass,
  onQuickAssignClass,
  onSelectDetectClass,
  onQuickAssignDetect,
  onApplySelected,
  onBuildPending,
  onBuildAll,
  onRebuildChange
}: ImageAssignPanelProps) {
  const [newClass, setNewClass] = useState("");
  const isDetect = assignTarget === "detect";

  return (
    <aside className="panel inbox-assign-panel">
      <div className="panel-header">
        <span className="panel-header-title">Batch Assign</span>
        <span id="inboxSelectionCount" className="status">
          {selectedCount} selected
        </span>
      </div>
      <div className="panel-body inbox-assign-body">
        <div className="status inbox-workflow-status" id="inboxWorkflowStatus">
          {workflowStatus}
        </div>
        <div className="inbox-target-toggle" role="group" aria-label="Assign to Detect or Clf">
          <button
            type="button"
            className={`inbox-target-option${isDetect ? " active" : ""}`}
            id="inboxTargetDetectBtn"
            onClick={() => onAssignTargetChange("detect")}
          >
            Detect
          </button>
          <button
            type="button"
            className={`inbox-target-option${!isDetect ? " active" : ""}`}
            id="inboxTargetClfBtn"
            onClick={() => onAssignTargetChange("clf")}
          >
            Clf
          </button>
        </div>
        <div className="hint inbox-assign-legend">
          Thumbnail borders show current assignment state. Blue means selected.
        </div>
        <div className="inbox-assign-target-panels">
          {!isDetect ? (
            <div className="inbox-assign-target-panel" id="inboxClfAssignPanel">
              <div className="inbox-class-field">
                <span>Clf Class</span>
                <div className="hint" id="inboxClassHint">
                  {clfClasses.length
                    ? `clf_dataset classes ${clfClasses.length}${clfDatasetPath ? ` | ${clfDatasetPath.split(/[\\/]/).slice(-2).join("/")}` : ""}`
                    : "Classes load from clf_dataset folders"}
                </div>
                <input
                  id="inboxClassSearchInput"
                  type="search"
                  placeholder="Search classes..."
                  value={classSearch}
                  onChange={(event) => onClassSearchChange(event.target.value)}
                />
                <div className="inbox-class-picker" id="inboxClassPicker">
                  {!clfClasses.length ? (
                    <div className="empty">No classes found. Create a class below.</div>
                  ) : (
                    clfClasses.map((className) => {
                      const count = clfClassCounts.get(className) || 0;
                      return (
                        <button
                          key={className}
                          type="button"
                          className={`inbox-class-chip${canQuickAssign ? " quick-assign" : ""}${selectedClass === className ? " active" : ""}`}
                          disabled={assigning}
                          title={
                            canQuickAssign
                              ? `Write ${selectedCount} selected image(s) to metadata -> ${className}`
                              : "Select images, then click a class for quick assignment"
                          }
                          onClick={() => {
                            if (canQuickAssign) onQuickAssignClass(className);
                            else onSelectClass(className);
                          }}
                        >
                          {className}
                          <span className="inbox-class-chip-count" aria-hidden="true">
                            {count}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="inbox-create-assign-row" id="inboxCreateAssignRow">
                <label className="inbox-create-class-field">
                  Or create class{" "}
                  <input
                    id="inboxNewClassInput"
                    type="text"
                    placeholder="class_name"
                    value={newClass}
                    onChange={(event) => setNewClass(event.target.value)}
                  />
                </label>
                <div className="inbox-assign-action-row" id="inboxAssignActionRow">
                  <button
                    id="inboxApplyAssignBtn"
                    type="button"
                    disabled={assigning || !selectedCount}
                    onClick={() => onApplySelected(newClass.trim() || undefined)}
                  >
                    Apply to Selected
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="inbox-assign-target-panel" id="inboxDetectAssignPanel">
              <div className="inbox-class-field">
                <span>Detect Classes</span>
                <div className="hint" id="inboxDetectClassHint">
                  {detectClasses.length
                    ? `detect classes ${detectClasses.length}${detectDatasetPath ? ` | ${detectDatasetPath.split(/[\\/]/).slice(-2).join("/")}/data.yaml` : ""}`
                    : "Classes load from detect_dataset/data.yaml"}
                </div>
                <input
                  id="inboxDetectClassSearchInput"
                  type="search"
                  placeholder="Search detect classes..."
                  value={detectClassSearch}
                  onChange={(event) => onDetectClassSearchChange(event.target.value)}
                />
                <div className="inbox-class-picker" id="inboxDetectClassPicker">
                  {!detectClasses.length ? (
                    <div className="empty">No detect classes found.</div>
                  ) : (
                    detectClasses.map((item) => {
                      const classId = Number(item.id);
                      const label = detectClassChipLabel(item);
                      const count = detectClassCounts.get(classId) || 0;
                      return (
                        <button
                          key={`${classId}-${item.name}`}
                          type="button"
                          className={`inbox-class-chip${canQuickAssign ? " quick-assign" : ""}${selectedDetectClassId === classId ? " active" : ""}`}
                          disabled={assigning}
                          onClick={() => {
                            onSelectDetectClass(classId);
                            if (canQuickAssign) onQuickAssignDetect();
                          }}
                        >
                          {label}
                          <span className="inbox-class-chip-count" aria-hidden="true">
                            {count}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="hint inbox-detect-assign-hint">
                Select images, then click a class chip or Apply to Selected. Box labels stay in Box Label.
              </div>
              <div className="inbox-assign-action-row is-detect">
                <button
                  type="button"
                  disabled={assigning || !selectedCount}
                  onClick={() => onQuickAssignDetect()}
                >
                  Apply to Selected (Detect)
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="merge-log inbox-log" id="inboxLog">
          {log}
        </div>
        <div className="row inbox-build-actions">
          <button
            type="button"
            className="primary"
            id="inboxBuildPendingBtn"
            disabled={assigning || pendingFiles <= 0}
            onClick={onBuildPending}
          >
            {pendingFiles > 0 ? `Build Pending (${pendingFiles})` : "Build Pending"}
          </button>
          <button type="button" id="inboxBuildLinksBtn" disabled={assigning} onClick={onBuildAll}>
            Build All
          </button>
          <label className="inbox-check">
            <input
              id="inboxRebuildInput"
              type="checkbox"
              checked={rebuild}
              onChange={(event) => onRebuildChange(event.target.checked)}
            />{" "}
            rebuild
          </label>
        </div>
      </div>
    </aside>
  );
}
