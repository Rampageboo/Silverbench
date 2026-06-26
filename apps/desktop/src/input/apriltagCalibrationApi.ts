import { API_BASE_URL } from "../api";
import type { AprilTagDetection } from "./homography";

export type AprilTagDetectionResponse = {
  ok: boolean;
  dictionary: string;
  imageWidth: number;
  imageHeight: number;
  detections: AprilTagDetection[];
  requiredIds: number[];
  missingIds: number[];
  rejectedCount: number;
};

export async function detectAprilTags(imageBase64: string) {
  const response = await fetch(`${API_BASE_URL}/api/multimodal/apriltag/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 })
  });
  const data = (await response.json()) as AprilTagDetectionResponse & { detail?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.detail || `AprilTag detection failed with HTTP ${response.status}.`);
  }
  return data;
}

export function calibrationSheetUrl(dpi = 150) {
  return `${API_BASE_URL}/api/multimodal/apriltag/sheet.png?dpi=${Math.max(96, Math.min(600, Math.round(dpi)))}`;
}

export function captureVideoFrameBase64(video: HTMLVideoElement, quality = 0.9) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("Camera frame is not ready.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create camera capture canvas.");
  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", Math.max(0.5, Math.min(1, quality))).split(",", 2)[1] || "";
}
