import type { BoxAdjustMode } from "./geometry";
import { KEYBOARD_STEP_MULTIPLIERS, type KeyboardStepMultiplier } from "./boxLabelKeyboardShortcuts";
import "./boxLabel.css";

type BoxLabelPreviewToolbarProps = {
  pointerToolEnabled: boolean;
  autoFitEnabled: boolean;
  blackBoxEnabled: boolean;
  boxAdjustMode: BoxAdjustMode;
  keyboardStepMultiplier: KeyboardStepMultiplier;
  tracking: boolean;
  canCopyNext: boolean;
  onTogglePointerTool: () => void;
  onToggleAutoFit: () => void;
  onToggleBlackBox: () => void;
  onRestoreBackup: () => void;
  onToggleBoxAdjustMode: () => void;
  onKeyboardStepMultiplierChange: (value: KeyboardStepMultiplier) => void;
  onCopyNext: () => void;
  onCsrtTrack: () => void;
};

export function BoxLabelPreviewToolbar({
  pointerToolEnabled,
  autoFitEnabled,
  blackBoxEnabled,
  boxAdjustMode,
  keyboardStepMultiplier,
  tracking,
  canCopyNext,
  onTogglePointerTool,
  onToggleAutoFit,
  onToggleBlackBox,
  onRestoreBackup,
  onToggleBoxAdjustMode,
  onKeyboardStepMultiplierChange,
  onCopyNext,
  onCsrtTrack
}: BoxLabelPreviewToolbarProps) {
  const grow = boxAdjustMode !== "shrink";

  return (
    <div className="pool-label-preview-toolbar" id="poolLabelPreviewToolbar" aria-label="Box Label tools">
      <button
        id="poolLabelPointerToolBtn"
        type="button"
        className={`pool-label-icon-tool${pointerToolEnabled ? " active" : ""}`}
        title="Cursor (V)"
        aria-label="Cursor"
        aria-pressed={pointerToolEnabled}
        onClick={onTogglePointerTool}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 3l10 10-5 1.5L8.5 20 6 3z" />
        </svg>
      </button>
      <button
        id="poolLabelAutoFitToolBtn"
        type="button"
        className={`pool-label-icon-tool${autoFitEnabled ? " active" : ""}`}
        title="Color Select (W)"
        aria-label="Color Select"
        aria-pressed={autoFitEnabled}
        onClick={onToggleAutoFit}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <path d="M8 8h8v8H8z" />
          <path d="M10 10h4v4h-4z" />
        </svg>
      </button>
      <button
        type="button"
        className={`pool-label-black-box-tool-btn pool-label-icon-tool${blackBoxEnabled ? " active" : ""}`}
        title="Black box"
        aria-label="Black box"
        aria-pressed={blackBoxEnabled}
        onClick={onToggleBlackBox}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="currentColor" />
        </svg>
      </button>
      <button
        id="poolLabelRestoreBackupBtn"
        type="button"
        className="pool-label-icon-tool danger"
        title="Restore Backup"
        aria-label="Restore Backup"
        onClick={onRestoreBackup}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v6h6" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </svg>
      </button>
      <button
        id="poolLabelAdjustModeBtn"
        type="button"
        className="pool-label-icon-tool pool-label-adjust-tool"
        title={grow ? "Box adjust: grow (Numpad +/-)" : "Box adjust: shrink (Numpad +/-)"}
        aria-label={grow ? "Box adjust mode: grow" : "Box adjust mode: shrink"}
        data-mode={grow ? "grow" : "shrink"}
        onClick={onToggleBoxAdjustMode}
      >
        <svg className="pool-label-adjust-icon pool-label-adjust-icon-grow" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect x="8" y="8" width="8" height="8" rx="1.5" />
          <path d="M7 7L4 4M17 7l3-3M7 17l-3 3M17 17l3 3" />
          <path d="M4 8V4h4M16 4h4v4M4 16v4h4M20 16v4h-4" />
        </svg>
        <svg className="pool-label-adjust-icon pool-label-adjust-icon-shrink" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect x="8" y="8" width="8" height="8" rx="1.5" />
          <path d="M4 4l4 4M20 4l-4 4M4 20l4-4M20 20l-4-4" />
          <path d="M8 4v4H4M16 4v4h4M8 20v-4H4M16 20v-4h4" />
        </svg>
      </button>
      <button
        id="poolLabelTrackBtn"
        type="button"
        className="pool-label-icon-tool primary"
        title="Add Duplicate (T)"
        aria-label="Add Duplicate"
        disabled={!canCopyNext || tracking}
        onClick={onCopyNext}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M8 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2" />
          <path d="M11 4h9v9" />
          <path d="M10 14L20 4" />
        </svg>
      </button>
      <button
        id="poolLabelCsrtBtn"
        type="button"
        className="pool-label-icon-tool"
        title="CSRT Track (Shift+T)"
        aria-label="CSRT Track"
        disabled={tracking}
        onClick={onCsrtTrack}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <circle cx="12" cy="12" r="4" />
          <path d="M17 7l3-3" />
        </svg>
      </button>
      <div className="pool-label-keypad-guide" aria-label="Keyboard box shortcuts">
        <div className="pool-label-keypad-multipliers" aria-label="Keyboard multiplier">
          <span>Step</span>
          {KEYBOARD_STEP_MULTIPLIERS.map((value) => (
            <button
              key={value}
              type="button"
              className={value === keyboardStepMultiplier ? "active" : ""}
              title={`Numpad ${value}: ${value}x keyboard multiplier`}
              aria-label={`Numpad ${value}: ${value}x keyboard multiplier`}
              aria-pressed={value === keyboardStepMultiplier}
              onClick={() => onKeyboardStepMultiplierChange(value)}
            >
              {value}x
            </button>
          ))}
        </div>
        <div className="pool-label-keypad-map" aria-label="Numpad shortcut map">
          <span><kbd>1/3/7/9</kbd> step</span>
          <span><kbd>2/4/5/6/8</kbd> resize</span>
          <span><kbd>+/-</kbd> adjust</span>
          <span><kbd>Arrows</kbd> move</span>
        </div>
      </div>
    </div>
  );
}
