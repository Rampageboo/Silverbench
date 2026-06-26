import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import { CommandArbiter, type CommandDecision } from "./commandArbiter";
import { MultimodalCommandBus, type CommandListener } from "./commandBus";
import { createCommandEnvelope, type CommandEnvelope } from "./commands";
import type { Homography } from "./homography";
import { useBrowserSpeechCommands, type BrowserSpeechStatus } from "./useBrowserSpeechCommands";
import { useMediaPipeGestureCommands, type GestureCameraStatus } from "./useMediaPipeGestureCommands";

const STORAGE_PREFIX = "ywb.multimodal.";

function readBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  if (value == null) return fallback;
  return value === "true";
}

function readHomography(): Homography | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}homography`) || "null") as unknown;
    if (!Array.isArray(value) || value.length !== 9 || !value.every(Number.isFinite)) return null;
    return value as unknown as Homography;
  } catch {
    return null;
  }
}

function writeBoolean(key: string, value: boolean) {
  window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
}

type MultimodalControlContextValue = {
  armed: boolean;
  setArmed: (value: boolean) => void;
  voiceEnabled: boolean;
  setVoiceEnabled: (value: boolean) => void;
  gestureEnabled: boolean;
  setGestureEnabled: (value: boolean) => void;
  requireWakeWord: boolean;
  setRequireWakeWord: (value: boolean) => void;
  mirrorCamera: boolean;
  setMirrorCamera: (value: boolean) => void;
  homography: Homography | null;
  setHomography: (value: Homography | null) => void;
  voiceStatus: BrowserSpeechStatus;
  lastTranscript: string;
  gestureStatus: GestureCameraStatus;
  lastGesture: string;
  lastArmMotion: string;
  gestureError: string;
  lastDecision: CommandDecision | null;
  cameraVideoRef: RefObject<HTMLVideoElement>;
  publish: (envelope: CommandEnvelope) => CommandDecision;
  subscribe: (listener: CommandListener) => () => void;
};

const MultimodalControlContext = createContext<MultimodalControlContextValue | null>(null);

export function MultimodalControlProvider({ children }: { children: ReactNode }) {
  const busRef = useRef<MultimodalCommandBus | null>(null);
  if (!busRef.current) busRef.current = new MultimodalCommandBus(new CommandArbiter());
  const bus = busRef.current;
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const [armed, setArmedState] = useState(false);
  const [voiceEnabled, setVoiceEnabledState] = useState(() => readBoolean("voiceEnabled", false));
  const [gestureEnabled, setGestureEnabledState] = useState(() => readBoolean("gestureEnabled", false));
  const [requireWakeWord, setRequireWakeWordState] = useState(() => readBoolean("requireWakeWord", true));
  const [mirrorCamera, setMirrorCameraState] = useState(() => readBoolean("mirrorCamera", true));
  const [homography, setHomographyState] = useState<Homography | null>(readHomography);
  const [lastDecision, setLastDecision] = useState<CommandDecision | null>(null);

  const publish = useCallback((envelope: CommandEnvelope) => bus.publish(envelope), [bus]);
  const subscribe = useCallback((listener: CommandListener) => bus.subscribe(listener), [bus]);

  useEffect(
    () =>
      bus.subscribeDecisions((decision) => {
        setLastDecision(decision);
        setArmedState(bus.isArmed());
      }),
    [bus]
  );

  const speech = useBrowserSpeechCommands({
    enabled: voiceEnabled,
    publish,
    requireWakeWord,
    defaultStepSeconds: 0.1
  });
  const gesture = useMediaPipeGestureCommands({
    enabled: gestureEnabled,
    videoRef: cameraVideoRef,
    publish,
    homography,
    mirrorX: mirrorCamera,
    seekSeconds: 0.1
  });

  const setArmed = useCallback(
    (value: boolean) => {
      publish(createCommandEnvelope("ui", { type: value ? "controls.arm" : "controls.disarm" }));
    },
    [publish]
  );

  const setVoiceEnabled = useCallback((value: boolean) => {
    setVoiceEnabledState(value);
    writeBoolean("voiceEnabled", value);
  }, []);

  const setGestureEnabled = useCallback((value: boolean) => {
    setGestureEnabledState(value);
    writeBoolean("gestureEnabled", value);
  }, []);

  const setRequireWakeWord = useCallback((value: boolean) => {
    setRequireWakeWordState(value);
    writeBoolean("requireWakeWord", value);
  }, []);

  const setMirrorCamera = useCallback((value: boolean) => {
    setMirrorCameraState(value);
    writeBoolean("mirrorCamera", value);
  }, []);

  const setHomography = useCallback((value: Homography | null) => {
    setHomographyState(value);
    if (value) window.localStorage.setItem(`${STORAGE_PREFIX}homography`, JSON.stringify(value));
    else window.localStorage.removeItem(`${STORAGE_PREFIX}homography`);
  }, []);

  const contextValue = useMemo<MultimodalControlContextValue>(
    () => ({
      armed,
      setArmed,
      voiceEnabled,
      setVoiceEnabled,
      gestureEnabled,
      setGestureEnabled,
      requireWakeWord,
      setRequireWakeWord,
      mirrorCamera,
      setMirrorCamera,
      homography,
      setHomography,
      voiceStatus: speech.status,
      lastTranscript: speech.lastTranscript,
      gestureStatus: gesture.status,
      lastGesture: gesture.lastGesture,
      lastArmMotion: gesture.lastArmMotion,
      gestureError: gesture.error,
      lastDecision,
      cameraVideoRef,
      publish,
      subscribe
    }),
    [
      armed,
      gesture.error,
      gesture.lastArmMotion,
      gesture.lastGesture,
      gesture.status,
      gestureEnabled,
      homography,
      lastDecision,
      mirrorCamera,
      publish,
      requireWakeWord,
      setArmed,
      setGestureEnabled,
      setHomography,
      setMirrorCamera,
      setRequireWakeWord,
      setVoiceEnabled,
      speech.lastTranscript,
      speech.status,
      subscribe,
      voiceEnabled
    ]
  );

  return <MultimodalControlContext.Provider value={contextValue}>{children}</MultimodalControlContext.Provider>;
}

export function useMultimodalControls() {
  const value = useContext(MultimodalControlContext);
  if (!value) throw new Error("useMultimodalControls must be used within MultimodalControlProvider.");
  return value;
}

export function useWorkbenchCommands(listener: CommandListener) {
  const { subscribe } = useMultimodalControls();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => subscribe((envelope) => listenerRef.current(envelope)), [subscribe]);
}
