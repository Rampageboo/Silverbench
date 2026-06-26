import { useEffect, useRef, useState } from "react";
import { createCommandEnvelope, type CommandEnvelope } from "./commands";
import { parseVoiceCommand } from "./voiceCommandParser";

type SpeechAlternativeLike = { transcript: string; confidence: number };
type SpeechResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternativeLike;
};
type SpeechResultListLike = {
  length: number;
  [index: number]: SpeechResultLike;
};
type SpeechEventLike = Event & { resultIndex: number; results: SpeechResultListLike };
type SpeechErrorLike = Event & { error?: string; message?: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechErrorLike) => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type BrowserSpeechStatus = "disabled" | "unsupported" | "starting" | "listening" | "error";

export function useBrowserSpeechCommands({
  enabled,
  publish,
  lang = "zh-CN",
  requireWakeWord = true,
  defaultStepSeconds = 0.1
}: {
  enabled: boolean;
  publish: (envelope: CommandEnvelope) => void;
  lang?: string;
  requireWakeWord?: boolean;
  defaultStepSeconds?: number;
}) {
  const [status, setStatus] = useState<BrowserSpeechStatus>("disabled");
  const [lastTranscript, setLastTranscript] = useState("");
  const enabledRef = useRef(enabled);
  const restartTimerRef = useRef<number | null>(null);
  enabledRef.current = enabled;

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!enabled) {
      setStatus("disabled");
      return;
    }
    if (!Recognition) {
      setStatus("unsupported");
      return;
    }

    let disposed = false;
    let recognition: SpeechRecognitionLike | null = null;
    let blocked = false;

    const clearRestart = () => {
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
    };

    const scheduleRestart = () => {
      clearRestart();
      if (disposed || blocked || !enabledRef.current) return;
      restartTimerRef.current = window.setTimeout(() => start(), 500);
    };

    const start = () => {
      if (disposed || blocked || !enabledRef.current) return;
      clearRestart();
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.lang = lang;
      recognition.onstart = () => setStatus("listening");
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result?.isFinal || !result[0]) continue;
          const transcript = result[0].transcript.trim();
          setLastTranscript(transcript);
          const parsed = parseVoiceCommand(transcript, { requireWakeWord, defaultStepSeconds });
          if (!parsed) continue;
          publish(
            createCommandEnvelope("voice", parsed.command, {
              confidence: result[0].confidence > 0 ? result[0].confidence : 0.85,
              transcript,
              createdAt: Date.now()
            })
          );
        }
      };
      recognition.onerror = (event) => {
        const code = String(event.error || "unknown");
        if (code === "not-allowed" || code === "service-not-allowed") blocked = true;
        if (code !== "no-speech" && code !== "aborted") setStatus("error");
      };
      recognition.onend = () => {
        recognition = null;
        scheduleRestart();
      };
      try {
        setStatus("starting");
        recognition.start();
      } catch {
        scheduleRestart();
      }
    };

    start();
    return () => {
      disposed = true;
      clearRestart();
      const active = recognition;
      recognition = null;
      if (active) {
        active.onend = null;
        active.onerror = null;
        active.onresult = null;
        try {
          active.abort();
        } catch {
          // Already stopped.
        }
      }
    };
  }, [defaultStepSeconds, enabled, lang, publish, requireWakeWord]);

  return {
    supported: typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    status,
    lastTranscript
  };
}
