import React from "react";
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
  const { classImageCounts } = props;

  return (
    <>
      <section
        className={`pool-label-shortcuts-panel${editor.fixedShortcutMode ? " fixed-mode" : " class-mode"}`}
        id="poolLabelShortcutsPanel"
      >
        <div className="pool-label-shortcuts" id="poolLabelShortcuts">
          {SLOT_ORDER.map((slot) => {
            const classId = editor.shortcutSlots[slot];
            const bound = classId != null && editor.classes.some((item) => item.id === classId);
            return (
              <div className="pool-label-shortcut-slot" key={slot}>
                <div className="pool-label-shortcut-number">{slot}</div>
                <BoxLabelShortcutDropdown
                  className="class-slot"
                  title={`Shortcut ${slot}`}
                  label={bound ? `${classId}: ${classNameFor(editor.classes, classId!)}` : "empty"}
                  active={bound && classId === editor.currentClass && editor.activeShortcutSlot === slot}
                  options={editor.classShortcutOptions(slot)}
                  onSelect={(value) => {
                    const next = editor.shortcutSlots.slice();
                    next[slot] = value === "" ? null : Number(value);
                    editor.setShortcutSlots(next);
                    if (value !== "") editor.selectClassShortcut(slot, true);
                    else editor.setStatus(`Shortcut ${slot} cleared.`);
                  }}
                />
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
                  </button>
                ))
              ) : (
                <div className="empty">No boxes on this image.</div>
              )}
            </div>
          </div>
        </section>

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
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (event.shiftKey) editor.onAddExcludeClass(item.id);
                      else editor.onAddIncludeClass(item.id);
                    }}
                    title="Right-click: Include · Shift+right-click: Exclude"
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
