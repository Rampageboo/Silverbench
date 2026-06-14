import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteUrl = "http://127.0.0.1:5173";
const viteBin = join(desktopDir, "node_modules", "vite", "bin", "vite.js");

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitUrl(url, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // Vite may still be starting.
    }
    await sleep(250);
  }
  return false;
}

function waitUntilInterrupted() {
  return new Promise(() => {
    const onExit = (code = 0) => process.exit(code);
    process.on("SIGINT", () => onExit(0));
    process.on("SIGTERM", () => onExit(0));
    process.on("SIGHUP", () => onExit(0));
  });
}

function runNodeScript(relativePath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [relativePath], {
      cwd: desktopDir,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${relativePath} exited with code ${code}`));
    });
  });
}

function startViteForeground() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [viteBin, "--host", "127.0.0.1"], {
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
      if (code === 0 || code === null) resolveRun();
      else rejectRun(new Error(`Vite exited (code ${code}${signal ? `, signal ${signal}` : ""})`));
    });
  });
}

async function main() {
  await runNodeScript("scripts/start-backend-and-wait.mjs");

  if (await waitUrl(viteUrl, 1500)) {
    console.log("Vite dev server already running:", viteUrl);
    await waitUntilInterrupted();
    return;
  }

  if (!existsSync(viteBin)) {
    console.error("Vite is not installed. Run npm install in apps/desktop first.");
    process.exit(1);
  }

  console.log("Starting Vite dev server...");
  await startViteForeground();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
