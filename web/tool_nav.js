const WORKBENCH_TOOLS = [
  { tab: "image-pool", label: "Image Pool", labelZh: "图片库", keywords: "pool image 素材 图库 image_pool" },
  { tab: "pool-label", label: "Box Label", labelZh: "框标注", keywords: "label box 检测框 标注 track" },
  { tab: "video", label: "Video Capture", labelZh: "视频截帧", keywords: "video capture screenshot 视频 截帧" },
  { tab: "train-prep", label: "Dataset Prep", labelZh: "数据集准备", keywords: "prep split yaml train val 准备" },
  { tab: "train", label: "Auto Label", labelZh: "自动标注", keywords: "auto train pt model 自动标注 模型" },
  { tab: "crop", label: "Batch Crop", labelZh: "批量裁剪", keywords: "crop batch 裁剪" },
  { tab: "mask-noise", label: "Mask Cleanup", labelZh: "掩码清理", keywords: "mask noise cleanup 掩码 清理" },
  { tab: "merge", label: "Dataset Merge", labelZh: "数据集合并", keywords: "merge zip 合并 数据集" }
];

const toolNavState = {
  query: ""
};

function toolMatchesQuery(tool, query) {
  if (!query) return true;
  const haystack = [
    tool.tab,
    tool.label,
    tool.labelZh,
    tool.keywords
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function renderToolNavList() {
  const list = el.toolNavList;
  const empty = el.toolNavEmpty;
  if (!list) return;
  const query = toolNavState.query.trim().toLowerCase();
  const matches = WORKBENCH_TOOLS.filter(tool => toolMatchesQuery(tool, query));
  list.replaceChildren();
  if (empty) empty.hidden = matches.length > 0;
  for (const tool of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-nav-item";
    button.dataset.tab = tool.tab;
    button.title = `${tool.labelZh} · ${tool.label}`;
    button.classList.toggle("active", state.activeTab === tool.tab);
    button.innerHTML = `
      <span class="tool-nav-item-icon">${toolNavIconSvg(tool.tab)}</span>
      <span class="tool-nav-item-body">
        <span class="tool-nav-item-title">${tool.label}</span>
        <span class="tool-nav-item-sub">${tool.labelZh}</span>
      </span>
    `;
    button.addEventListener("click", () => switchTab(tool.tab));
    list.append(button);
  }
}

function syncToolNavActive(tab) {
  if (!el.toolNavList) return;
  for (const button of el.toolNavList.querySelectorAll(".tool-nav-item")) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
}

function openSettingsOverlay() {
  if (!el.settingsOverlay) return;
  el.settingsOverlay.hidden = false;
  readAppUiSettings().then(renderSettingsPanel).catch(() => {});
}

function closeSettingsOverlay() {
  if (el.settingsOverlay) el.settingsOverlay.hidden = true;
}

function renderSettingsPanel(settings = {}) {
  const mode = validStartupOverlayMode(settings.startupOverlayMode || readStartupOverlayModeFromStorage());
  for (const input of document.querySelectorAll('input[name="startupOverlayMode"]')) {
    input.checked = input.value === mode;
  }
}

async function onStartupOverlayModeChange(mode) {
  const normalized = validStartupOverlayMode(mode);
  mirrorStartupOverlayMode(normalized);
  await writeAppUiSettingsPatch({ startupOverlayMode: normalized });
}

function initSettingsNavButton() {
  const iconHost = el.settingsOpenBtn?.querySelector(".tabbar-settings-icon");
  if (iconHost) iconHost.innerHTML = toolNavIconSvg("settings", 18);
}

function setToolNavExpanded(expanded) {
  el.toolNav?.classList.toggle("tabbar--expanded", Boolean(expanded));
}

function bindToolNavEvents() {
  initSettingsNavButton();

  const nav = el.toolNav;
  const expandNav = () => setToolNavExpanded(true);
  const collapseNav = event => {
    const next = event?.relatedTarget;
    if (next && nav?.contains(next)) return;
    setToolNavExpanded(false);
  };

  nav?.addEventListener("mouseenter", expandNav);
  nav?.addEventListener("mouseleave", collapseNav);
  nav?.addEventListener("focusin", expandNav);
  nav?.addEventListener("focusout", collapseNav);

  el.toolNavSearch?.addEventListener("input", () => {
    toolNavState.query = el.toolNavSearch.value || "";
    renderToolNavList();
  });
  el.toolNavSearch?.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const first = el.toolNavList?.querySelector(".tool-nav-item");
    if (first) {
      event.preventDefault();
      switchTab(first.dataset.tab);
    }
  });
  el.settingsOpenBtn?.addEventListener("click", openSettingsOverlay);
  el.settingsCloseBtn?.addEventListener("click", closeSettingsOverlay);
  el.settingsOverlay?.addEventListener("click", event => {
    if (event.target === el.settingsOverlay) closeSettingsOverlay();
  });
  for (const input of document.querySelectorAll('input[name="startupOverlayMode"]')) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      onStartupOverlayModeChange(input.value).catch(error => console.warn("Settings save:", error));
    });
  }
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && el.settingsOverlay && !el.settingsOverlay.hidden) {
      closeSettingsOverlay();
    }
  });
  renderToolNavList();
}
