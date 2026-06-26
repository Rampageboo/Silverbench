import { useEffect, useRef, useState, type RefObject } from "react";
import { GestureCommandInterpreter, type GestureObservation, type HandLandmark } from "./gestureInterpreter";
import { PoseMotionInterpreter, type PoseLandmark, type PoseObservation } from "./poseMotionInterpreter";
import type { CommandEnvelope } from "./commands";
import type { Homography } from "./homography";

const DEFAULT_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";
const DEFAULT_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const DEFAULT_GESTURE_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
const DEFAULT_POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

type CategoryLike = { categoryName?: string; score?: number; displayName?: string };
type GestureResultLike = {
  gestures?: CategoryLike[][];
  landmarks?: HandLandmark[][];
  handedness?: CategoryLike[][];
};
type PoseResultLike = {
  landmarks?: PoseLandmark[][];
  worldLandmarks?: PoseLandmark[][];
};
type GestureRecognizerLike = {
  recognizeForVideo: (video: HTMLVideoElement, timestampMs?: number) => GestureResultLike;
  close?: () => void;
};
type PoseLandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, timestampMs?: number) => PoseResultLike;
  close?: () => void;
};
type MediaPipeVisionModule = {
  FilesetResolver: {
    forVisionTasks: (wasmRoot: string) => Promise<unknown>;
  };
  GestureRecognizer: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>
    ) => Promise<GestureRecognizerLike>;
  };
  PoseLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>
    ) => Promise<PoseLandmarkerLike>;
  };
};

export type GestureCameraStatus =
  | "disabled"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "error";

export function useMediaPipeGestureCommands({
  enabled,
  videoRef,
  publish,
  homography,
  mirrorX = true,
  seekSeconds = 0.1,
  framesPerSecond = 6,
  moduleUrl = DEFAULT_MODULE_URL,
  wasmRoot = DEFAULT_WASM_ROOT,
  gestureModelUrl = DEFAULT_GESTURE_MODEL_URL,
  poseModelUrl = DEFAULT_POSE_MODEL_URL
}: {
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  publish: (envelope: CommandEnvelope) => void;
  homography?: Homography | null;
  mirrorX?: boolean;
  seekSeconds?: number;
  framesPerSecond?: number;
  moduleUrl?: string;
  wasmRoot?: string;
  gestureModelUrl?: string;
  poseModelUrl?: string;
}) {
  const [status, setStatus] = useState<GestureCameraStatus>("disabled");
  const [lastGesture, setLastGesture] = useState("");
  const [lastArmMotion, setLastArmMotion] = useState("");
  const [error, setError] = useState("");
  const publishRef = useRef(publish);
  publishRef.current = publish;

  useEffect(() => {
    if (!enabled) {
      setStatus("disabled");
      setLastGesture("");
      setLastArmMotion("");
      setError("");
      return;
    }
    const video = videoRef.current;
    if (!video) {
      setStatus("error");
      setError("Gesture camera video element is not mounted.");
      return;
    }

    let disposed = false;
    let stream: MediaStream | null = null;
    let gestureRecognizer: GestureRecognizerLike | null = null;
    let poseLandmarker: PoseLandmarkerLike | null = null;
    let animationFrame = 0;
    let lastGestureInferenceAt = Number.NEGATIVE_INFINITY;
    let lastPoseInferenceAt = Number.NEGATIVE_INFINITY;
    let preferredTask: "gesture" | "pose" = "gesture";
    const intervalMs = 1000 / Math.max(1, framesPerSecond);
    const gestureInterpreter = new GestureCommandInterpreter({
      mirrorX,
      seekSeconds,
      homography: homography || null
    });
    const poseInterpreter = new PoseMotionInterpreter({ mirrorX, seekSeconds });

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      gestureRecognizer?.close?.();
      poseLandmarker?.close?.();
      gestureRecognizer = null;
      poseLandmarker = null;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      video.pause();
      video.srcObject = null;
    };

    const processGesture = (timestampMs: number) => {
      if (!gestureRecognizer) return;
      const result = gestureRecognizer.recognizeForVideo(video, timestampMs);
      const landmarks = result.landmarks?.[0] || [];
      if (!landmarks.length) {
        setLastGesture("");
        return;
      }
      const category = result.gestures?.[0]?.[0];
      const gesture = category?.categoryName || "None";
      const score = Number(category?.score ?? 0.8);
      const handedness = result.handedness?.[0]?.[0]?.categoryName;
      const observation: GestureObservation = {
        timestampMs,
        gesture,
        score,
        handedness,
        landmarks
      };
      setLastGesture(gesture === "None" ? "Hand detected" : gesture);
      for (const command of gestureInterpreter.consume(observation)) publishRef.current(command);
    };

    const processPose = (timestampMs: number) => {
      if (!poseLandmarker) return;
      const result = poseLandmarker.detectForVideo(video, timestampMs);
      const landmarks = result.landmarks?.[0] || [];
      if (!landmarks.length) return;
      const observation: PoseObservation = {
        timestampMs,
        landmarks,
        worldLandmarks: result.worldLandmarks?.[0]
      };
      const commands = poseInterpreter.consume(observation);
      for (const command of commands) {
        setLastArmMotion(command.gesture || "Arm motion");
        publishRef.current(command);
      }
    };

    const process = (timestampMs: number) => {
      if (disposed || !gestureRecognizer || !poseLandmarker) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const gestureDue = timestampMs - lastGestureInferenceAt >= intervalMs;
        const poseDue = timestampMs - lastPoseInferenceAt >= intervalMs;
        try {
          if (gestureDue && poseDue) {
            if (preferredTask === "gesture") {
              lastGestureInferenceAt = timestampMs;
              processGesture(timestampMs);
              preferredTask = "pose";
            } else {
              lastPoseInferenceAt = timestampMs;
              processPose(timestampMs);
              preferredTask = "gesture";
            }
          } else if (gestureDue) {
            lastGestureInferenceAt = timestampMs;
            processGesture(timestampMs);
          } else if (poseDue) {
            lastPoseInferenceAt = timestampMs;
            processPose(timestampMs);
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(message);
          setStatus("error");
        }
      }
      animationFrame = requestAnimationFrame(process);
    };

    void (async () => {
      try {
        setStatus("requesting-camera");
        setError("");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 960 },
            height: { ideal: 540 },
            frameRate: { ideal: 24, max: 30 }
          },
          audio: false
        });
        if (disposed) return stop();
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        setStatus("loading-model");
        const imported = (await import(/* @vite-ignore */ moduleUrl)) as MediaPipeVisionModule;
        const fileset = await imported.FilesetResolver.forVisionTasks(wasmRoot);
        [gestureRecognizer, poseLandmarker] = await Promise.all([
          imported.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: gestureModelUrl },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
            cannedGesturesClassifierOptions: { scoreThreshold: 0.62 }
          }),
          imported.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: poseModelUrl },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: false
          })
        ]);
        if (disposed) return stop();
        setStatus("running");
        animationFrame = requestAnimationFrame(process);
      } catch (reason) {
        if (disposed) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        setStatus("error");
        stop();
      }
    })();

    return () => {
      disposed = true;
      stop();
    };
  }, [
    enabled,
    framesPerSecond,
    gestureModelUrl,
    homography,
    mirrorX,
    moduleUrl,
    poseModelUrl,
    seekSeconds,
    videoRef,
    wasmRoot
  ]);

  return {
    supported: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    status,
    lastGesture,
    lastArmMotion,
    error
  };
}
