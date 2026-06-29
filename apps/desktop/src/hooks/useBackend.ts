import { useEffect, useState } from "react";
import * as api from "../api";
import { errMessage } from "../lib/errors";

export type BackendHealth = api.BackendHealth;

export function useBackend(pollMs = 1500) {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const data = (await api.health()) as BackendHealth;
        if (!cancelled) {
          setHealth(data);
          const schema = Number(data.apiSchemaVersion || 0);
          setError(
            schema >= api.REQUIRED_API_SCHEMA_VERSION
              ? ""
              : `Backend is out of date (API schema ${schema || "unknown"}; need ${api.REQUIRED_API_SCHEMA_VERSION}). Restart YoloWorkBench.`
          );
        }
      } catch (err) {
        if (!cancelled) {
          setHealth(null);
          setError(errMessage(err));
        }
      }
    }

    checkHealth();
    const timer = window.setInterval(checkHealth, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return {
    connected: Boolean(
      health?.ok && Number(health.apiSchemaVersion || 0) >= api.REQUIRED_API_SCHEMA_VERSION
    ),
    health,
    error
  };
}
