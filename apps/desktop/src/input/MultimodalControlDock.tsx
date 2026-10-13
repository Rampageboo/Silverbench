import { useMemo, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  calibrationSheetUrl,
  captureVideoFrameBase64,
  detectAprilTags
} from "./apriltagCalibrationApi";
import { computeHomography, homographyFromAprilTags, type Point2 } from "./homography";
import { useMultimodalControls } from "./MultimodalControlProvider";
import "./multimodal-controls.css";

const TARGET_CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
] as const;
const CORNER_LABELS = ["左上", "右上", "右下", "左下"];

function decisionText(value: ReturnType<typeof useMultimodalControls>["lastDecision"]) {
  if (!value) return "尚无命令";
  if (value.accepted) return `已执行：${value.envelope.command.type}`;
  switch (value.reason) {
    case "disarmed":
      return "命令被忽略：控制未解锁";
    case "low-confidence":
      return "命令被忽略：置信度不足";
    case "cooldown":
      return "命令被忽略：冷却中";
    case "confirmation-required":
      return "危险命令：请在 3.5 秒内重复一次确认";
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
    const voice = controls.voiceEnabled ? `语音 ${controls.voiceStatus}` : "语音关闭";
    const gesture = controls.gestureEnabled ? `手势/手臂 ${controls.gestureStatus}` : "手势关闭";
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
        setCalibrationStatus("四角手动校准完成");
      } catch (reason) {
        setCalibrationError(reason instanceof Error ? reason.message : String(reason));
        setCalibrationPoints([]);
      }
    }
  }

  async function autoCalibrateAprilTags() {
    const video = controls.cameraVideoRef.current;
    if (!video) {
      setCalibrationError("摄像头预览尚未挂载。");
      return;
    }
    setDetectingTags(true);
    setCalibrationError("");
    setCalibrationStatus("正在识别 AprilTag…");
    try {
      const frame = captureVideoFrameBase64(video);
      const result = await detectAprilTags(frame);
      if (result.missingIds.length) {
        throw new Error(`未检测到标签：${result.missingIds.join(", ")}。请确保 0、1、2、3 同时入镜。`);
      }
      const calibration = homographyFromAprilTags(result.detections, {
        mirrored: controls.mirrorCamera,
        tagIds: [0, 1, 2, 3]
      });
      controls.setHomography(calibration.matrix);
      setCalibrationStatus(`AprilTag 自动校准完成，共识别 ${result.detections.length} 个标签。`);
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
          <strong>{controls.armed ? "控制已解锁" : "控制已锁定"}</strong>
          <small>{sourceStatus}</small>
        </div>
        <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={onClose}>
          Close
        </button>
      </div>
        <div className="multimodal-control-body">
          <div className="multimodal-control-row">
            <button type="button" className={controls.armed ? "danger" : "primary"} onClick={() => controls.setArmed(!controls.armed)}>
              {controls.armed ? "锁定控制" : "解锁控制"}
            </button>
            <label>
              <input
                type="checkbox"
                checked={controls.voiceEnabled}
                onChange={(event) => controls.setVoiceEnabled(event.target.checked)}
              />
              语音
            </label>
            <label>
              <input
                type="checkbox"
                checked={controls.gestureEnabled}
                onChange={(event) => controls.setGestureEnabled(event.target.checked)}
              />
              手势与手臂
            </label>
          </div>

          <div className="multimodal-control-row multimodal-control-options">
            <label>
              <input
                type="checkbox"
                checked={controls.requireWakeWord}
                onChange={(event) => controls.setRequireWakeWord(event.target.checked)}
              />
              唤醒词
            </label>
            <label>
              <input
                type="checkbox"
                checked={controls.mirrorCamera}
                onChange={(event) => controls.setMirrorCamera(event.target.checked)}
              />
              镜像摄像头
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
                  点击操作平面的{CORNER_LABELS[calibrationPoints.length]}角
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
            <button type="button" onClick={openCalibrationSheet}>打开打印标定板</button>
            <button
              type="button"
              className="primary"
              onClick={() => void autoCalibrateAprilTags()}
              disabled={detectingTags || controls.gestureStatus !== "running"}
            >
              {detectingTags ? "识别中…" : "AprilTag 自动校准"}
            </button>
          </div>

          <div className="multimodal-control-row">
            {calibrating ? (
              <button type="button" onClick={cancelCalibration}>取消手动校准</button>
            ) : (
              <button type="button" onClick={startCalibration}>四角手动校准</button>
            )}
            <button
              type="button"
              onClick={() => {
                controls.setHomography(null);
                setCalibrationStatus("");
              }}
              disabled={!controls.homography}
            >
              清除校准
            </button>
            <span className="status">{controls.homography ? "已校准" : "未校准"}</span>
          </div>

          <div className="multimodal-control-status">
            <div>{decisionText(controls.lastDecision)}</div>
            {controls.lastTranscript ? <div>语音：{controls.lastTranscript}</div> : null}
            {controls.lastGesture ? <div>手势：{controls.lastGesture}</div> : null}
            {controls.lastArmMotion ? <div>手臂：{controls.lastArmMotion}</div> : null}
            {calibrationStatus ? <div>{calibrationStatus}</div> : null}
            {controls.gestureError ? <div className="error-banner">{controls.gestureError}</div> : null}
            {calibrationError ? <div className="error-banner">{calibrationError}</div> : null}
          </div>

          <details>
            <summary>手臂动作映射</summary>
            <p>系统同时跟踪肩、肘和腕；手掌识别不稳定时，小臂或整臂的明确挥动仍可触发。</p>
            <p>向左：上一时间步；向右：下一时间步；向上：复制前一个框；向下：标记当前帧已复核。</p>
          </details>

          <details>
            <summary>AprilTag 摆放</summary>
            <p>
              在操作平面四角外侧放置标签 0、1、2、3，顺序为左上、右上、右下、左下。自动识别使用各标签朝内的角点建立单应性矩阵。
            </p>
            <p>离散手势和手臂挥动不需要校准；只有指向、捏合和隔空画框使用该矩阵。手离标定平面越远，视差误差越大。</p>
          </details>
        </div>
    </aside>
    ) : null}

      {showSheet ? createPortal(
        <div
          className="calibration-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="打印标定板"
          onClick={() => setShowSheet(false)}
        >
          <div className="calibration-sheet-box" onClick={(e) => e.stopPropagation()}>
            <div className="calibration-sheet-header">
              <span>AprilTag 标定板 — 打印后放置于操作平面四角</span>
              <div className="calibration-sheet-actions">
                <button type="button" className="primary" onClick={() => window.print()}>打印</button>
                <button type="button" onClick={() => setShowSheet(false)}>关闭</button>
              </div>
            </div>
            <img
              className="calibration-sheet-img printable-sheet"
              src={calibrationSheetUrl(200)}
              alt="AprilTag 标定板"
              draggable={false}
            />
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
