import config from "../../backend.config.json";

export type BackendConfig = {
  host: string;
  port: number;
};

function normalizedOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

/** Return the configured host and port from backend.config.json. */
export function resolveBackendConfig(): BackendConfig {
  return {
    host: String(config.host || "127.0.0.1"),
    port: Number(config.port) || 8765
  };
}

/** Resolve the local FastAPI origin, allowing explicit query/global overrides for development. */
export function backendBaseUrl(resolved?: BackendConfig) {
  const { host: configuredHost, port: configuredPort } = resolved ?? resolveBackendConfig();
  if (typeof window === "undefined") return `http://${configuredHost}:${configuredPort}`;

  const queryOverride = new URLSearchParams(window.location.search).get("backendUrl") || "";
  const globalOverride = String(
    (window as Window & { __YWB_BACKEND_URL__?: string }).__YWB_BACKEND_URL__ || ""
  );
  const storedOverride = window.localStorage.getItem("ywb.backendUrl") || "";
  const override = queryOverride || globalOverride || storedOverride;
  return normalizedOrigin(override || `http://${configuredHost}:${configuredPort}`);
}

declare global {
  interface Window {
    __YWB_BACKEND_URL__?: string;
  }
}
