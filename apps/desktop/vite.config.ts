import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)));
const fileConfig = JSON.parse(readFileSync(resolve(desktopDir, "backend.config.json"), "utf8")) as {
  host: string;
  port: number;
};

function resolveBackendSettings(mode: string) {
  const env = loadEnv(mode, desktopDir, "");
  const envPort = Number(process.env.YWB_BACKEND_PORT || env.YWB_BACKEND_PORT);
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : fileConfig.port;
  const host = fileConfig.host || "127.0.0.1";
  return { host, port };
}

export default defineConfig(({ mode }) => {
  const backend = resolveBackendSettings(mode);
  return {
    plugins: [react()],
    define: {
      __YWB_BACKEND_HOST__: JSON.stringify(backend.host),
      __YWB_BACKEND_PORT__: JSON.stringify(String(backend.port))
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      define: {
        __YWB_BACKEND_HOST__: JSON.stringify(backend.host),
        __YWB_BACKEND_PORT__: JSON.stringify(String(backend.port))
      }
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      fs: {
        allow: ["..", "../..", "../../.."]
      },
      watch: {
        // Network/mapped drives (e.g. Z:) often break native fs watchers on Windows.
        usePolling: true,
        interval: 1000,
        ignored: ["**/src-tauri/target/**"]
      }
    },
    clearScreen: false
  };
});
