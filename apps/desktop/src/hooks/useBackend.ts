import { useEffect, useState } from "react";
import * as api from "../api";
import { errMessage } from "../lib/errors";

export type BackendHealth = {
  ok: boolean;
  app: string;
  backend: string;
};

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
          setError("");
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
    connected: Boolean(health?.ok),
    health,
    error
  };
}
