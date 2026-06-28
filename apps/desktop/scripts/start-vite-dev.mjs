import { ensureUsableVitePort, startViteForeground, viteUrl, waitUntilInterrupted } from "./viteDevServer.mjs";

async function main() {
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
