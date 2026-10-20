import { spawn } from "child_process";
import { existsSync } from "fs";
import { createConnection } from "net";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const viteHost = process.env.YWB_VITE_HOST || "127.0.0.1";
export const vitePort = Number(process.env.YWB_VITE_PORT || "5173");
export const viteUrl = `http://${viteHost}:${vitePort}`;
export const viteBin = join(desktopDir, "node_modules", "vite", "bin", "vite.js");

export function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function readText(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isCurrentFrontend() {
  const html = await readText(viteUrl);
  return Boolean(html?.includes("<title>RampageWorkbench</title>") && html.includes("/src/main.tsx"));
}

async function isPortOpen(timeoutMs = 1000) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: viteHost, port: vitePort });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: desktopDir,
      windowsHide: true,
      ...options
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function stopFrontendOnPort() {
  if (process.env.YWB_DEV_STOP_STALE_PORT === "0") {
    throw new Error(
      `${viteUrl} is occupied by a different service. Stop it or unset YWB_DEV_STOP_STALE_PORT=0.`
    );
  }
  if (process.platform !== "win32") {
    throw new Error(`${viteUrl} is occupied by a different service. Stop it before starting RampageWorkbench.`);
  }
  await runCommand(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$ids = Get-NetTCPConnection -LocalPort ${vitePort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($id in $ids) { if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }`
    ],
    { stdio: "ignore" }
  );
}

async function waitForPortRelease(timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isPortOpen())) return true;
    await sleep(200);
  }
  return false;
}

export async function ensureUsableVitePort() {
  if (await isCurrentFrontend()) {
    console.log("Vite dev server already running:", viteUrl);
    return true;
  }

  if (await isPortOpen()) {
    console.log(`Stopping stale or unrelated process on ${viteUrl}...`);
    await stopFrontendOnPort();
    if (!(await waitForPortRelease())) {
      throw new Error(`Timed out waiting for ${viteUrl} to be released.`);
    }
  }

  return false;
}

export function waitUntilInterrupted() {
  return new Promise(() => {
    const onExit = (code = 0) => process.exit(code);
    process.on("SIGINT", () => onExit(0));
    process.on("SIGTERM", () => onExit(0));
    process.on("SIGHUP", () => onExit(0));
  });
}

export function startViteForeground() {
  if (!existsSync(viteBin)) {
    console.error("Vite is not installed. Run npm install in apps/desktop first.");
    process.exit(1);
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [viteBin, "--host", viteHost, "--port", String(vitePort), "--strictPort"], {
      cwd: desktopDir,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        CHOKIDAR_USEPOLLING: "1"
      }
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0 || code === null || (process.platform === "win32" && code === 4294967295)) resolveRun();
      else rejectRun(new Error(`Vite exited (code ${code}${signal ? `, signal ${signal}` : ""})`));
    });
  });
}
