import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { errMessage } from "../lib/errors";

export type BackendHealth = api.BackendHealth;

export function shouldKeepBackendConnectedAfterPollFailure(lastHealthyAt: number, now: number, disconnectGraceMs: number) {
  return lastHealthyAt > 0 && now - lastHealthyAt < disconnectGraceMs;
}

export function useBackend(pollMs = 1500, disconnectGraceMs = 4500) {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const lastHealthyAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const data = (await api.health()) as BackendHealth;
        if (!cancelled) {
          setHealth(data);
          const schema = Number(data.apiSchemaVersion || 0);
          const schemaCurrent = schema >= api.REQUIRED_API_SCHEMA_VERSION;
          if (data.ok && schemaCurrent) {
            lastHealthyAtRef.current = Date.now();
            setConnected(true);
            setError("");
          } else {
            setConnected(false);
            setError(
              `Backend is out of date (API schema ${schema || "unknown"}; need ${api.REQUIRED_API_SCHEMA_VERSION}). Restart RampageWorkbench.`
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          const wasRecentlyHealthy = shouldKeepBackendConnectedAfterPollFailure(
            lastHealthyAtRef.current,
            Date.now(),
            disconnectGraceMs
          );
          setHealth(null);
          setError(errMessage(err));
          setConnected(wasRecentlyHealthy);
        }
      }
    }

    checkHealth();
    const timer = window.setInterval(checkHealth, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [disconnectGraceMs, pollMs]);

  return {
    connected,
    health,
    error
  };
}
