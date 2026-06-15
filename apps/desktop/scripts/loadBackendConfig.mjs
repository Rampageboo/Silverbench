import { readFileSync } from "fs";
import { join } from "path";

export function loadBackendConfig(desktopDir) {
  const config = JSON.parse(readFileSync(join(desktopDir, "backend.config.json"), "utf8"));
  const envPort = Number(process.env.YWB_BACKEND_PORT);
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : Number(config.port) || 8765;
  const host = String(config.host || "127.0.0.1");
  return {
    host,
    port,
    healthUrl: `http://${host}:${port}/health`,
    origin: `http://${host}:${port}`
  };
}
