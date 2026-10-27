import { useMemo, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { calibrationSheetUrl, captureVideoFrameBase64, detectAprilTags } from "./apriltagCalibrationApi";
import { computeHomography, homographyFromAprilTags, type Point2 } from "./homography";
import { useMultimodalControls } from "./MultimodalControlProvider";
import "./multimodal-controls.css";

const TARGET_CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
] as const;
const CORNER_LABELS = ["top-left", "top-right", "bottom-right", "bottom-left"];

function decisionText(value: ReturnType<typeof useMultimodalControls>["lastDecision"]) {
  if (!value) return "No command yet";
  if (value.accepted) return `Ran: ${value.envelope.command.type}`;
  switch (value.reason) {
    case "disarmed":
      return "Ignored: controls locked";
    case "low-confidence":
      return "Ignored: low confidence";
    case "cooldown":
      return "Ignored: cooling down";
    case "confirmation-required":
      return "Dangerous command: repeat within 3.5 s to confirm";
  }
}

type DockProps = { open: boolean; onClose: () => void };

/** Voice / gesture control panel, opened from the sidebar status button. */
export function MultimodalControlDock({ open, onClose }: DockProps) {
  const controls = useMultimodalControls();
  const [calibrating, setCalibrating] = useState(false);
  const [detectingTags, setDetectingTags] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Point2[]>([]);
  const [calibrationError, setCalibrationError] = useState("");
  const [showSheet, setShowSheet] = useState(false);
  const [calibrationStatus, setCalibrationStatus] = useState("");

  const sourceStatus = useMemo(() => {
    const voice = controls.voiceEnabled ? `Voice ${controls.voiceStatus}` : "Voice off";
    const gesture = controls.gestureEnabled ? `Gesture ${controls.gestureStatus}` : "Gesture off";
    return `${voice} · ${gesture}`;
  }, [controls.gestureEnabled, controls.gestureStatus, controls.voiceEnabled, controls.voiceStatus]);

  function startCalibration() {
    if (!controls.gestureEnabled) controls.setGestureEnabled(true);
    setCalibrationPoints([]);
    setCalibrationError("");
    setCalibrationStatus("");
    setCalibrating(true);
  }

  function cancelCalibration() {
    setCalibrationPoints([]);
    setCalibrationError("");
    setCalibrating(false);
  }

  function captureCalibrationPoint(event: MouseEvent<HTMLVideoElement>) {
    if (!calibrating || calibrationPoints.length >= 4) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    };
    const next = [...calibrationPoints, point];
    setCalibrationPoints(next);
    if (next.length === 4) {
      try {
        controls.setHomography(computeHomography(next, TARGET_CORNERS));
        setCalibrating(false);
        setCalibrationError("");
        setCalibrationStatus("Manual calibration complete");
      } catch (reason) {
        setCalibrationError(reason instanceof Error ? reason.message : String(reason));
        setCalibrationPoints([]);
      }
    }
  }

  async function autoCalibrateAprilTags() {
    const video = controls.cameraVideoRef.current;
    if (!video) {
      setCalibrationError("Camera preview isn't ready.");
      return;
    }
    setDetectingTags(true);
    setCalibrationError("");
    setCalibrationStatus("Detecting AprilTags…");
    try {
      const frame = captureVideoFrameBase64(video);
      const result = await detectAprilTags(frame);
      if (result.missingIds.length) {
        throw new Error(`Tags not detected: ${result.missingIds.join(", ")}. Keep tags 0–3 in view.`);
      }
      const calibration = homographyFromAprilTags(result.detections, {
        mirrored: controls.mirrorCamera,
        tagIds: [0, 1, 2, 3]
      });
      controls.setHomography(calibration.matrix);
      setCalibrationStatus(`AprilTag calibration complete (${result.detections.length} tags)`);
    } catch (reason) {
      setCalibrationStatus("");
      setCalibrationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetectingTags(false);
    }
  }

  function openCalibrationSheet() {
    setCalibrationError("");
    setShowSheet(true);
  }

  return (
    <>
      {open ? (
        <aside className="multimodal-control-dock" aria-label="Voice and gesture controls">
          <div className="multimodal-control-head">
            <div>
              <strong>{controls.armed ? "Controls armed" : "Controls locked"}</strong>
              <small>{sourceStatus}</small>
            </div>
            <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="multimodal-control-body">
            <div className="multimodal-control-row">
              <button
                type="button"
                className={controls.armed ? "danger" : "primary"}
                onClick={() => controls.setArmed(!controls.armed)}
              >
                {controls.armed ? "Lock controls" : "Arm controls"}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={controls.voiceEnabled}
                  onChange={(event) => controls.setVoiceEnabled(event.target.checked)}
                />
                Voice
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={controls.gestureEnabled}
                  onChange={(event) => controls.setGestureEnabled(event.target.checked)}
                />
                Gesture &amp; arm
              </label>
            </div>

            <div className="multimodal-control-row multimodal-control-options">
              <label>
                <input
                  type="checkbox"
                  checked={controls.requireWakeWord}
                  onChange={(event) => controls.setRequireWakeWord(event.target.checked)}
                />
                Wake word
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={controls.mirrorCamera}
                  onChange={(event) => controls.setMirrorCamera(event.target.checked)}
                />
                Mirror camera
              </label>
            </div>

            {controls.gestureEnabled ? (
              <div className="multimodal-camera-wrap">
                <video
                  ref={controls.cameraVideoRef}
                  className={`multimodal-camera-feed${controls.mirrorCamera ? " is-mirrored" : ""}${calibrating ? " is-calibrating" : ""}`}
                  muted
                  playsInline
                  onClick={captureCalibrationPoint}
                />
                {calibrating ? (
                  <div className="multimodal-calibration-prompt">
                    Click the {CORNER_LABELS[calibrationPoints.length]} corner of the work surface
                  </div>
                ) : null}
                {calibrationPoints.map((point, index) => (
                  <span
                    key={`${point.x}-${point.y}-${index}`}
                    className="multimodal-calibration-point"
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="multimodal-control-row">
              <button type="button" onClick={openCalibrationSheet}>
                Print calibration sheet
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void autoCalibrateAprilTags()}
                disabled={detectingTags || controls.gestureStatus !== "running"}
              >
                {detectingTags ? "Detecting…" : "Auto-calibrate (AprilTag)"}
              </button>
            </div>

            <div className="multimodal-control-row">
              {calibrating ? (
                <button type="button" onClick={cancelCalibration}>
                  Cancel manual calibration
                </button>
              ) : (
                <button type="button" onClick={startCalibration}>
                  Manual 4-corner calibration
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  controls.setHomography(null);
                  setCalibrationStatus("");
                }}
                disabled={!controls.homography}
              >
                Clear calibration
              </button>
              <span className="status">{controls.homography ? "Calibrated" : "Not calibrated"}</span>
            </div>

            <div className="multimodal-control-status">
              <div>{decisionText(controls.lastDecision)}</div>
              {controls.lastTranscript ? <div>Voice: {controls.lastTranscript}</div> : null}
              {controls.lastGesture ? <div>Gesture: {controls.lastGesture}</div> : null}
              {controls.lastArmMotion ? <div>Arm: {controls.lastArmMotion}</div> : null}
              {calibrationStatus ? <div>{calibrationStatus}</div> : null}
              {controls.gestureError ? <div className="error-banner">{controls.gestureError}</div> : null}
              {calibrationError ? <div className="error-banner">{calibrationError}</div> : null}
            </div>

            <details>
              <summary>Arm gestures</summary>
              <p>
                Left: previous step · Right: next step · Up: copy previous box · Down: mark frame reviewed
              </p>
            </details>

            <details>
              <summary>AprilTag placement</summary>
              <p>Place tags 0–3 outside the corners: top-left, top-right, bottom-right, bottom-left.</p>
            </details>
          </div>
        </aside>
      ) : null}

      {showSheet
        ? createPortal(
            <div
              className="calibration-sheet-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Calibration sheet"
              onClick={() => setShowSheet(false)}
            >
              <div className="calibration-sheet-box" onClick={(e) => e.stopPropagation()}>
                <div className="calibration-sheet-header">
                  <span>AprilTag calibration sheet</span>
                  <div className="calibration-sheet-actions">
                    <button type="button" className="primary" onClick={() => window.print()}>
                      Print
                    </button>
                    <button type="button" onClick={() => setShowSheet(false)}>
                      Close
                    </button>
                  </div>
                </div>
                <img
                  className="calibration-sheet-img printable-sheet"
                  src={calibrationSheetUrl(200)}
                  alt="AprilTag calibration sheet"
                  draggable={false}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
