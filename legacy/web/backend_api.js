var pyBackend = {
  bridge: null,
  ready: false,
  readyPromise: null,
  mode: "",
  heartbeatTimer: null
};
window.pyBackend = pyBackend;

function wrapHttpBackendBridge() {
  return new Proxy({ mode: "http" }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "then") return undefined;
      return true;
    }
  });
}

function wrapQtBackendBridge(raw) {
  const core = {
    ping: raw.ping.bind(raw),
    apiCall: raw.apiCall.bind(raw),
    openBrowserWebUI: raw.openBrowserWebUI?.bind(raw),
    chooseVideoFile: raw.chooseVideoFile?.bind(raw)
  };
  return new Proxy(core, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "then") return undefined;
      if (target.apiCall) return true;
      return undefined;
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function runEmbedBootWhenReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (typeof window.bootstrapEmbedWorkbench === "function") {
      await window.bootstrapEmbedWorkbench();
      return;
    }
    await sleep(100);
  }
  throw new Error("Embed bootstrap is not available.");
}

async function pingHttpBackend(attempt = 0) {
  try {
    const response = await fetch("/api", {
      method: "POST",
      headers: httpBackendHeaders(),
      body: JSON.stringify({ method: "ping", args: [] })
    });
    const data = await response.json();
    if (Boolean(data.ok && data.result === "python-backend-ready")) return data;
  } catch {
    // Backend may still be starting in the Tauri desktop shell.
  }
  if (attempt >= 40) return { ok: false };
  await sleep(250);
  return pingHttpBackend(attempt + 1);
}

function initPythonBackend() {
  if (pyBackend.readyPromise) return pyBackend.readyPromise;
  window.setStartupProgress?.(90, "连接后端...", "正在检测 Python 后端");
  if (location.protocol === "http:" || location.protocol === "https:") {
    pyBackend.readyPromise = pingHttpBackend()
      .then(data => {
        const ready = Boolean(data.ok && data.result === "python-backend-ready");
        pyBackend.ready = ready;
        pyBackend.mode = ready ? "http" : "";
        pyBackend.bridge = ready ? wrapHttpBackendBridge() : null;
        if (ready) {
          startHttpBackendHeartbeat();
          setStatus("Local backend connected.");
          syncAppUiSettingsFromBackend?.().catch(error => console.warn("App settings sync:", error));
          if (window.__YWB_EMBED__) {
            window.setStartupProgress?.(95, "嵌入模式...", "加载工具页");
            runEmbedBootWhenReady()
              .catch(error => console.warn("Embed boot:", error))
              .finally(() => window.finishStartupOverlay?.("嵌入模式"));
          } else {
            window.setStartupProgress?.(95, "恢复工作区...", "加载上次打开的状态");
            restoreLastOpenedFolderOnStartup()
              .catch(error => console.warn("Folder restore:", error))
              .finally(() => window.finishStartupOverlay?.("本地后端已连接"));
          }
        } else {
          window.finishStartupOverlay?.("后端不可用");
        }
        return ready;
      })
      .catch(() => {
        window.finishStartupOverlay?.("后端不可用");
        return false;
      });
    return pyBackend.readyPromise;
  }
  pyBackend.readyPromise = new Promise(resolve => {
    if (!window.qt || !window.QWebChannel) {
      window.finishStartupOverlay?.("后端不可用");
      resolve(false);
      return;
    }
    window.setStartupProgress?.(92, "连接后端...", "打开 Qt WebChannel");
    new QWebChannel(qt.webChannelTransport, channel => {
      const raw = channel.objects.backend;
      pyBackend.bridge = raw?.apiCall ? wrapQtBackendBridge(raw) : raw;
      pyBackend.ready = Boolean(pyBackend.bridge);
      if (!pyBackend.ready) {
        window.finishStartupOverlay?.("后端不可用");
        resolve(false);
        return;
      }
      window.setStartupProgress?.(94, "连接后端...", "正在检测 Qt 后端");
      pyBackend.bridge.ping(result => {
        const ready = result === "python-backend-ready";
        pyBackend.ready = ready;
        if (ready) {
          setStatus("Python backend connected.");
          const browserBtn = document.getElementById("openBrowserWebBtn");
          if (browserBtn) browserBtn.hidden = false;
          syncAppUiSettingsFromBackend?.().catch(error => console.warn("App settings sync:", error));
          window.setStartupProgress?.(96, "恢复工作区...", "加载上次打开的状态");
          restoreLastOpenedFolderOnStartup()
            .catch(error => console.warn("Folder restore:", error))
            .finally(() => window.finishStartupOverlay?.("Python 后端已连接"));
        } else {
          window.finishStartupOverlay?.("后端不可用");
        }
        resolve(ready);
      });
    });
  });
  return pyBackend.readyPromise;
}

async function ensurePythonBackend() {
  if (pyBackend.ready) return true;
  return Boolean(await initPythonBackend());
}

function usesHttpBackend() {
  return pyBackend.mode === "http";
}

function startHttpBackendHeartbeat() {
  if (pyBackend.heartbeatTimer || pyBackend.mode !== "http") return;
  const sendHeartbeat = () => {
    fetch("/api", {
      method: "POST",
      headers: httpBackendHeaders(),
      body: JSON.stringify({ method: "__heartbeat", args: [] })
    }).catch(() => {});
  };
  sendHeartbeat();
  pyBackend.heartbeatTimer = setInterval(sendHeartbeat, 5000);
}

function normalizeBackendResult(result) {
  if (result != null && typeof result === "object") {
    return JSON.stringify(result);
  }
  return result;
}

function parseBackendPayload(raw, method) {
  const data = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
  if (!data.ok) {
    const error = data.error || `Backend call failed: ${method}`;
    if (error.includes("Unknown API method")) {
      throw new Error(`${error}\n\nRestart run.bat (or the legacy server) so the backend loads the latest API.`);
    }
    throw new Error(error);
  }
  return normalizeBackendResult(data.result);
}

function backendCall(method, ...args) {
  if (pyBackend.mode === "http") return httpBackendCall(method, args);
  return new Promise((resolve, reject) => {
    if (!pyBackend.bridge?.apiCall) {
      reject(new Error(`Backend apiCall is not available for: ${method}. Restart the Python app so the backend matches the refreshed frontend.`));
      return;
    }
    pyBackend.bridge.apiCall(method, JSON.stringify(args), raw => {
      try {
        resolve(parseBackendPayload(raw, method));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function httpBackendCall(method, args) {
  const response = await fetch("/api", {
    method: "POST",
    headers: httpBackendHeaders(),
    body: JSON.stringify({ method, args })
  });
  const data = await response.json();
  if (!data.ok) {
    const error = data.error || `Backend call failed: ${method}`;
    if (error.includes("Unknown API method")) {
      throw new Error(`${error}\n\nRestart run.bat (or the legacy server) so the backend loads the latest API.`);
    }
    throw new Error(error);
  }
  return normalizeBackendResult(data.result);
}
