import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, openSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { loadBackendConfig } from "./loadBackendConfig.mjs";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = loadBackendConfig(desktopDir);
const projectRoot = resolve(desktopDir, "..", "..");
const logsDir = join(projectRoot, "logs");
const backendLogPath = join(logsDir, "backend.log");
const healthUrl = backend.healthUrl;
// Keep in sync with API_SCHEMA_VERSION in backend_api/main.py.
const REQUIRED_API_SCHEMA_VERSION = 3;

function pythonCandidates() {
  const candidates = [];
  const windowsPython = join(projectRoot, ".venv", "Scripts", "python.exe");
  const unixPython = join(projectRoot, ".venv", "bin", "python");
  if (process.platform === "win32" && existsSync(windowsPython)) {
    candidates.push({ command: windowsPython, prefixArgs: [] });
  }
  if (existsSync(unixPython)) {
    candidates.push({ command: unixPython, prefixArgs: [] });
  }
  if (process.platform === "win32") {
    candidates.push({ command: "py", prefixArgs: ["-3"] });
    candidates.push({ command: "python", prefixArgs: [] });
  } else {
    candidates.push({ command: "python3", prefixArgs: [] });
    candidates.push({ command: "python", prefixArgs: [] });
  }
  return candidates;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
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

function canRunPython(command, prefixArgs) {
  return new Promise((resolveRun) => {
    const child = spawn(command, [...prefixArgs, "--version"], {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolveRun(false));
    child.on("exit", (code) => resolveRun(code === 0));
  });
}

async function resolvePython() {
  for (const candidate of pythonCandidates()) {
    if (await canRunPython(candidate.command, candidate.prefixArgs)) {
      return candidate;
    }
  }
  throw new Error("No working Python interpreter found. Run run.bat once to set up Python.");
}

async function ensurePythonDeps(python) {
  const markers = [
    [...python.prefixArgs, "-c", "import fastapi, uvicorn"],
    [...python.prefixArgs, "-c", "import PIL, numpy, cv2"]
  ];
  for (const args of markers) {
    try {
      await runCommand(python.command, args, { stdio: "ignore" });
    } catch {
      console.log("Installing Python requirements for the desktop backend...");
      await runCommand(
        python.command,
        [...python.prefixArgs, "-m", "pip", "install", "-r", "requirements.txt"],
        { stdio: "inherit" }
      );
      return;
    }
  }
}

async function readHealth() {
  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function isCurrentBackend() {
  const data = await readHealth();
  return Boolean(
    data?.ok &&
      data?.backend === "fastapi" &&
      data?.ui === "web" &&
      data?.apiSchemaVersion === REQUIRED_API_SCHEMA_VERSION
  );
}

async function stopBackendOnPort() {
  if (process.platform !== "win32") return;
  try {
    await runCommand(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-NetTCPConnection -LocalPort ${backend.port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($id in $p) { if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }`
      ],
      { stdio: "ignore" }
    );
  } catch {
    // Best effort; a stale backend may still block the port.
  }
}

async function waitForHealthy(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isCurrentBackend()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return false;
}

function ensureLogsDir() {
  mkdirSync(logsDir, { recursive: true });
}

function appendBackendLog(message) {
  ensureLogsDir();
  appendFileSync(backendLogPath, message, "utf8");
}

async function main() {
  if (await isCurrentBackend()) {
    console.log(`FastAPI backend already running on ${backend.origin}`);
    return;
  }

  if (await readHealth()) {
    console.log(`Stopping outdated FastAPI backend on ${backend.origin}...`);
    await stopBackendOnPort();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  const python = await resolvePython();
  await ensurePythonDeps(python);

  const uvicornArgs = [
    ...python.prefixArgs,
    "-m",
    "uvicorn",
    "backend_api.main:app",
    "--host",
    backend.host,
    "--port",
    String(backend.port)
  ];

  ensureLogsDir();
  appendBackendLog(`\n[${new Date().toISOString()}] Starting FastAPI backend\n`);
  const logFd = openSync(backendLogPath, "a");

  const child = spawn(python.command, uvicornArgs, {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONPATH: projectRoot,
      YWB_DESKTOP: "1"
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });
  child.unref();

  const ready = await waitForHealthy();
  if (!ready) {
    console.error("Timed out waiting for FastAPI backend:", healthUrl);
    console.error("Try deleting .venv and running run.bat again if Python setup is broken.");
    process.exit(1);
  }

  console.log("FastAPI backend ready:", healthUrl, `(logs/backend.log)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
