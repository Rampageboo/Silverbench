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

function initPythonBackend() {
  if (pyBackend.readyPromise) return pyBackend.readyPromise;
  window.setStartupProgress?.(90, "Connecting backend...", "Pinging Python backend");
  if (location.protocol === "http:" || location.protocol === "https:") {
    pyBackend.readyPromise = fetch("/api", {
      method: "POST",
      headers: httpBackendHeaders(),
      body: JSON.stringify({ method: "ping", args: [] })
    })
      .then(response => response.json())
      .then(data => {
        const ready = Boolean(data.ok && data.result === "python-backend-ready");
        pyBackend.ready = ready;
        pyBackend.mode = ready ? "http" : "";
        pyBackend.bridge = ready ? wrapHttpBackendBridge() : null;
        if (ready) {
          startHttpBackendHeartbeat();
          setStatus("Local backend connected.");
          window.setStartupProgress?.(95, "Restoring workspace...", "Loading previous workspace state");
          restoreLastOpenedFolderOnStartup()
            .catch(error => console.warn("Folder restore:", error))
            .finally(() => window.finishStartupOverlay?.("Local backend connected"));
        } else {
          window.finishStartupOverlay?.("Backend unavailable");
        }
        return ready;
      })
      .catch(() => {
        window.finishStartupOverlay?.("Backend unavailable");
        return false;
      });
    return pyBackend.readyPromise;
  }
  pyBackend.readyPromise = new Promise(resolve => {
    if (!window.qt || !window.QWebChannel) {
      window.finishStartupOverlay?.("Backend unavailable");
      resolve(false);
      return;
    }
    window.setStartupProgress?.(92, "Connecting backend...", "Opening Qt web channel");
    new QWebChannel(qt.webChannelTransport, channel => {
      const raw = channel.objects.backend;
      pyBackend.bridge = raw?.apiCall ? wrapQtBackendBridge(raw) : raw;
      pyBackend.ready = Boolean(pyBackend.bridge);
      if (!pyBackend.ready) {
        window.finishStartupOverlay?.("Backend unavailable");
        resolve(false);
        return;
      }
      window.setStartupProgress?.(94, "Connecting backend...", "Pinging Qt backend");
      pyBackend.bridge.ping(result => {
        const ready = result === "python-backend-ready";
        pyBackend.ready = ready;
        if (ready) {
          setStatus("Python backend connected.");
          const browserBtn = document.getElementById("openBrowserWebBtn");
          if (browserBtn) browserBtn.hidden = false;
          window.setStartupProgress?.(96, "Restoring workspace...", "Loading previous workspace state");
          restoreLastOpenedFolderOnStartup()
            .catch(error => console.warn("Folder restore:", error))
            .finally(() => window.finishStartupOverlay?.("Python backend connected"));
        } else {
          window.finishStartupOverlay?.("Backend unavailable");
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

function parseBackendPayload(raw, method) {
  const data = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
  if (!data.ok) {
    const error = data.error || `Backend call failed: ${method}`;
    if (error.includes("Unknown API method")) {
      throw new Error(`${error}\n\nRestart yolo_label_viewer_server.py / yolo_label_viewer_web_app.py so the backend loads the latest API.`);
    }
    throw new Error(error);
  }
  return data.result;
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
      throw new Error(`${error}\n\nRestart yolo_label_viewer_server.py / yolo_label_viewer_web_app.py so the backend loads the latest API.`);
    }
    throw new Error(error);
  }
  return data.result;
}
