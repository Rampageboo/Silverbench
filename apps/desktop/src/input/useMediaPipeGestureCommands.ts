import { useEffect, useRef, useState, type RefObject } from "react";
import { GestureCommandInterpreter, type GestureObservation, type HandLandmark } from "./gestureInterpreter";
import type { CommandEnvelope } from "./commands";
import type { Homography } from "./homography";

const DEFAULT_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";
const DEFAULT_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const DEFAULT_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

type CategoryLike = { categoryName?: string; score?: number; displayName?: string };
type GestureResultLike = {
  gestures?: CategoryLike[][];
  landmarks?: HandLandmark[][];
  handedness?: CategoryLike[][];
};
type GestureRecognizerLike = {
  recognizeForVideo: (video: HTMLVideoElement, timestampMs?: number) => GestureResultLike;
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
  framesPerSecond = 8,
  moduleUrl = DEFAULT_MODULE_URL,
  wasmRoot = DEFAULT_WASM_ROOT,
  modelUrl = DEFAULT_MODEL_URL
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
  modelUrl?: string;
}) {
  const [status, setStatus] = useState<GestureCameraStatus>("disabled");
  const [lastGesture, setLastGesture] = useState("");
  const [error, setError] = useState("");
  const publishRef = useRef(publish);
  publishRef.current = publish;

  useEffect(() => {
    if (!enabled) {
      setStatus("disabled");
      setLastGesture("");
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
    let recognizer: GestureRecognizerLike | null = null;
    let animationFrame = 0;
    let lastInferenceAt = Number.NEGATIVE_INFINITY;
    const intervalMs = 1000 / Math.max(1, framesPerSecond);
    const interpreter = new GestureCommandInterpreter({ mirrorX, seekSeconds, homography: homography || null });

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      recognizer?.close?.();
      recognizer = null;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      video.pause();
      video.srcObject = null;
    };

    const process = (timestampMs: number) => {
      if (disposed || !recognizer) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && timestampMs - lastInferenceAt >= intervalMs) {
        lastInferenceAt = timestampMs;
        try {
          const result = recognizer.recognizeForVideo(video, timestampMs);
          const landmarks = result.landmarks?.[0] || [];
          if (landmarks.length) {
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
            for (const command of interpreter.consume(observation)) publishRef.current(command);
          } else {
            setLastGesture("");
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
        recognizer = await imported.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          cannedGesturesClassifierOptions: { scoreThreshold: 0.65 }
        });
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
  }, [enabled, framesPerSecond, homography, mirrorX, modelUrl, moduleUrl, seekSeconds, videoRef, wasmRoot]);

  return {
    supported: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    status,
    lastGesture,
    error
  };
}
