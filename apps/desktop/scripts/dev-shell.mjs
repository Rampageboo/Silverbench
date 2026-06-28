import { spawn } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { ensureUsableVitePort, startViteForeground, viteUrl, waitUntilInterrupted } from "./viteDevServer.mjs";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

async function main() {
  await runNodeScript("scripts/start-backend-and-wait.mjs");

  if (await ensureUsableVitePort()) {
    await waitUntilInterrupted();
    return;
  }

  console.log("Starting Vite dev server:", viteUrl);
  await startViteForeground();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
