const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function startServer() {
  const code = [
    'import yolo_label_viewer_server as s',
    "server=s.ThreadingHTTPServer(('127.0.0.1',0), s.Handler)",
    'port=server.server_address[1]',
    "print(f'URL=http://127.0.0.1:{port}/?apiToken={s.API_TOKEN}', flush=True)",
    'server.serve_forever()',
  ].join('; ');
  const child = spawn('python', ['-c', code], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start.\n${stderr}`)), 10_000);
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/URL=(http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited before ready with code ${code}.\n${stderr}`));
    });
  });

  return { child, ready };
}

test('web UI loads and connects to local backend', async ({ page }) => {
  const server = startServer();
  const url = await server.ready;
  const errors = [];

  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });

  try {
    await page.goto(url);
    await expect(page).toHaveTitle(/YoloWorkBench/);
    await expect(page.locator('#activeToolTitle')).toHaveText('Video Capture');
    await expect(page.locator('#status')).toContainText('Local backend connected.');
    await expect(page.locator('#openVideoBtn')).toBeVisible();
    await expect(page.locator('#yoloTabBtn')).toBeVisible();
    await expect(page.locator('#topbarActions button')).toHaveCount(0);
    await page.locator('#trainTabBtn').click();
    await expect(page.locator('#activeToolTitle')).toHaveText('Auto Label');
    await expect(page.locator('#topbarActions button')).toHaveCount(0);
    await page.locator('#yoloTabBtn').click();
    await expect(page.locator('#activeToolTitle')).toHaveText('YOLO View');
    await expect(page.locator('#topbarActions #openFolderBtn')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    server.child.kill();
  }
});
