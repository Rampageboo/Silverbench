import config from "../../backend.config.json";

export type BackendConfig = { host: string; port: number };

export function resolveBackendConfig(): BackendConfig {
  return {
    host: String(config.host || "127.0.0.1"),
    port: Number(config.port) || 8765
  };
}

function normalizedOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

/** Resolve the local FastAPI origin, allowing explicit query/global overrides for development. */
export function backendBaseUrl(resolved?: BackendConfig) {
  const { host, port } = resolved ?? resolveBackendConfig();
  if (typeof window === "undefined") return `http://${host}:${port}`;

  const queryOverride = new URLSearchParams(window.location.search).get("backendUrl") || "";
  const globalOverride = String(
    (window as Window & { __YWB_BACKEND_URL__?: string }).__YWB_BACKEND_URL__ || ""
  );
  const storedOverride = window.localStorage.getItem("ywb.backendUrl") || "";
  const override = queryOverride || globalOverride || storedOverride;
  return normalizedOrigin(override || `http://${host}:${port}`);
}

declare global {
  interface Window {
    __YWB_BACKEND_URL__?: string;
  }
}
