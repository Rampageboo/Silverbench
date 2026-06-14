(function installEmbedTabSync() {
  if (!window.__YWB_EMBED__ || typeof switchTab !== "function" || window.__YWB_EMBED_TAB_SYNC__) return;
  const baseSwitchTab = switchTab;
  window.switchTab = function embedAwareSwitchTab(nextTab, options = {}) {
    baseSwitchTab(nextTab, options);
    if (!window.__YWB_EMBED_READY__ || options.notifyParent !== true) return;
    try {
      window.parent?.postMessage?.({ type: "ywb-embed-tab", tab: nextTab, fromUser: true }, "*");
    } catch (error) {
      console.warn("Embed tab sync:", error);
    }
  };
  window.__YWB_EMBED_TAB_SYNC__ = true;
})();

function readEmbedTabFromUrl(cfg) {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl) return fromUrl;
  } catch (error) {
    console.warn("Embed tab parse:", error);
  }
  return String(cfg?.tab || "video");
}

function normalizeEmbedTab(tab) {
  return typeof validSessionTab === "function" ? validSessionTab(tab) : tab;
}

function postEmbedProgress(progress, stage, detail) {
  try {
    window.parent?.postMessage?.(
      { type: "ywb-embed-progress", progress, stage, detail },
      "*"
    );
  } catch (error) {
    console.warn("Embed progress sync:", error);
  }
}

function markEmbedReady(tab, detail = "工具页已加载", options = {}) {
  document.documentElement.classList.remove("ywb-embed-booting");
  document.documentElement.classList.add("ywb-embed-ready");
  window.__YWB_EMBED_READY__ = true;
  try {
    window.parent?.postMessage?.(
      {
        type: "ywb-embed-ready",
        tab,
        detail,
        syncShellTab: options.syncShellTab === true
      },
      "*"
    );
  } catch (error) {
    console.warn("Embed ready sync:", error);
  }
}

async function restoreEmbedSessionForTab(tab) {
  if (typeof readWorkspaceSessionData !== "function") return;
  try {
    const session = await readWorkspaceSessionData({ lite: false });
    if (session && typeof applyAppSessionData === "function") {
      applyAppSessionData({ ...session, activeTab: tab });
    }
    if (tab === "pool-label" && typeof refreshYoloOrPoolLabelView === "function") {
      if (typeof applyPoolLabelResumeFieldsFromSession === "function") {
        applyPoolLabelResumeFieldsFromSession(session);
      }
      if (typeof primePoolLabelResumeForView === "function") {
        primePoolLabelResumeForView();
      }
      await refreshYoloOrPoolLabelView("pool-label", appShellTabSwitchSeq);
    } else if (tab === "image-pool") {
      if (typeof rebuildImagePoolPairs === "function") rebuildImagePoolPairs();
      if (typeof renderImagePoolGrid === "function") renderImagePoolGrid();
      if (typeof restoreImagePoolViewportIfNeeded === "function") restoreImagePoolViewportIfNeeded();
      if (typeof applyTopbarStatusForTab === "function") applyTopbarStatusForTab("image-pool");
    } else if (tab === "yolo" && typeof refreshYoloOrPoolLabelView === "function") {
      await refreshYoloOrPoolLabelView("yolo", appShellTabSwitchSeq);
    }
  } catch (error) {
    console.warn("Embed session restore:", error);
  }
}

async function activateEmbedTab(tab, options = {}) {
  const normalized = normalizeEmbedTab(tab);
  const showBooting = options.showBooting !== false;
  if (showBooting) {
    window.__YWB_EMBED_READY__ = false;
    document.documentElement.classList.add("ywb-embed-booting");
    document.documentElement.classList.remove("ywb-embed-ready");
  }

  if (typeof switchTab === "function") {
    switchTab(normalized, { deferViewRefresh: true, notifyParent: false });
  }

  try {
    await restoreEmbedSessionForTab(normalized);
  } catch (error) {
    console.warn("Embed session restore:", error);
  }

  if (typeof switchTab === "function") {
    switchTab(normalized, { deferViewRefresh: false, notifyParent: false });
  }

  if (options.emitReady !== false) {
    const readyDetail = options.readyDetail
      || (typeof state !== "undefined" && state.workspaceRoot
        ? `已恢复：${String(state.workspaceRoot).split(/[\\/]/).pop()}`
        : "工具页已加载");
    markEmbedReady(normalized, readyDetail, { syncShellTab: options.syncShellTab === true });
  }
  return normalized;
}

function startEmbedWorkspaceRestore(workspaceRoot = "") {
  if (typeof window.restoreEmbedWorkspaceOnly !== "function") return Promise.resolve();
  return window.restoreEmbedWorkspaceOnly(workspaceRoot).catch(error => {
    console.warn("Embed workspace restore:", error);
  });
}

window.bootstrapEmbedWorkbench = async function bootstrapEmbedWorkbench() {
  const cfg = window.__YWB_EMBED__;
  if (!cfg) return;

  const fallbackTab = normalizeEmbedTab(readEmbedTabFromUrl(cfg));

  postEmbedProgress(52, "正在恢复工作区...", "打开上次工作区");
  try {
    await startEmbedWorkspaceRestore(cfg.workspaceRoot || "");
  } catch (error) {
    console.warn("Embed workspace restore:", error);
  }

  postEmbedProgress(82, "正在恢复会话...", "恢复上次界面");
  window.startupRestoreInProgress = true;
  const imageWorkspaceTabs = new Set(["image-pool", "inbox", "yolo"]);
  let restoredTab = fallbackTab;
  try {
    if (typeof readWorkspaceSessionData === "function" && typeof window.restoreWorkspaceSessionTab === "function") {
      const session = await readWorkspaceSessionData({ lite: true });
      await window.restoreWorkspaceSessionTab(session);
      if (imageWorkspaceTabs.has(fallbackTab)) {
        restoredTab = fallbackTab;
      } else {
        restoredTab = normalizeEmbedTab(
          typeof state !== "undefined" && state.activeTab ? state.activeTab : session?.activeTab || fallbackTab
        );
      }
    } else {
      await activateEmbedTab(fallbackTab, { showBooting: true, syncShellTab: true });
      return;
    }
  } catch (error) {
    console.warn("Embed session restore:", error);
    await activateEmbedTab(fallbackTab, { showBooting: true, syncShellTab: true });
    return;
  } finally {
    window.startupRestoreInProgress = false;
  }

  if (typeof switchTab === "function") {
    switchTab(restoredTab, { deferViewRefresh: false, notifyParent: false });
  }

  const readyDetail = typeof state !== "undefined" && state.workspaceRoot
    ? `已恢复：${String(state.workspaceRoot).split(/[\\/]/).pop()}`
    : "工具页已加载";
  markEmbedReady(restoredTab, readyDetail, { syncShellTab: true });
  if ((restoredTab === "pool-label" || restoredTab === "yolo") && typeof restoreGalleryScrollForSession === "function") {
    restoreGalleryScrollForSession();
  }
};

(function installEmbedShellBridge() {
  if (!window.__YWB_EMBED__) return;
  window.addEventListener("message", event => {
    const allowedOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];
    if (!allowedOrigins.includes(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "ywb-shell-tab") {
      const nextTab = normalizeEmbedTab(data.tab);
      if (typeof state !== "undefined" && state.activeTab === nextTab && window.__YWB_EMBED_READY__) {
        return;
      }
      activateEmbedTab(nextTab, { showBooting: false }).catch(error => {
        console.warn("Embed shell tab:", error);
      });
      return;
    }

    if (data.type === "ywb-open-settings" && typeof openSettingsOverlay === "function") {
      openSettingsOverlay();
      return;
    }

    if (data.type === "ywb-focus-image" && data.imagePath && typeof openImageInYoloView === "function") {
      const filename = String(data.imagePath).replace(/^image_pool\//, "");
      openImageInYoloView(filename).catch(error => console.warn("Embed focus image:", error));
    }
  });
})();
