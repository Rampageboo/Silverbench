import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../components/useToast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFolderPlus,
  IconGallery,
  IconRefresh,
  IconSearch,
  IconSliders,
  IconSparkle
} from "../../ui/icons";
import { GalleryApiError, galleryApi, type AssetQuery, type GalleryJob, type PromptOptions } from "./galleryApi";
import {
  AddRootDialog,
  BatchEditDialog,
  ExportDialog,
  ImageViewer,
  NewCollectionDialog,
  RulesDialog,
  SummaryDialog
} from "./GalleryDialogs";
import { GalleryDetail } from "./GalleryDetail";
import { GRID_GAP, GRID_PADDING, GalleryGrid } from "./GalleryGrid";
import { GalleryNav, type GalleryFilters } from "./GalleryNav";
import {
  DEFAULT_RULES,
  buildPromptOptions,
  draftFromAsset,
  draftPatch,
  isActiveJob,
  parsePersonalTags,
  shouldObscure,
  type AssetDraft,
  type GalleryMode,
  type GalleryRules
} from "./galleryDomain";
import { errorText, useAssetDetail, useAssetWindow, useGalleryStatus, usePromptPreview } from "./useGallery";
import { useVirtualGrid } from "../image-pool/virtualGrid";
import "./gallery.css";

type Props = { active?: boolean; onReady?: () => void };

const PREFS_KEY = "ywb.gallery.prefs";

type Prefs = { mode: GalleryMode; rules: GalleryRules; revealAll: boolean; tileSize: number };

function readPrefs(): Prefs {
  const fallback: Prefs = { mode: "prompt", rules: DEFAULT_RULES, revealAll: false, tileSize: 132 };
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
    return {
      mode: stored.mode === "train" ? "train" : "prompt",
      rules: { ...DEFAULT_RULES, ...(stored.rules ?? {}) },
      revealAll: stored.revealAll === true,
      tileSize: typeof stored.tileSize === "number" ? Math.min(240, Math.max(88, stored.tileSize)) : fallback.tileSize
    };
  } catch {
    return fallback;
  }
}

type DialogState =
  | { kind: "add-root" }
  | { kind: "new-collection" }
  | { kind: "rules" }
  | { kind: "batch" }
  | { kind: "summary"; ids: string[]; options: PromptOptions }
  | { kind: "export"; ids: string[]; options: PromptOptions }
  | null;

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(element?.isContentEditable);
}

export function GalleryPage({ active = true, onReady }: Props) {
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const statusState = useGalleryStatus(active);
  const { status } = statusState;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [filters, setFilters] = useState<GalleryFilters>({ rootId: undefined, collection: undefined, minRating: 0, hasMetadata: undefined, needsReverse: false });
  const [listToken, setListToken] = useState(0);
  const [detailToken, setDetailToken] = useState(0);
  const [focus, setFocus] = useState<{ id: string; index: number } | null>(null);
  const focusedId = focus?.id ?? null;
  /** Keyboard moved onto a position whose chunk is still loading. */
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorIndexRef = useRef<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AssetDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // preference only
    }
  }, [prefs]);

  // The page is usable as soon as the status call answers (or fails visibly).
  useEffect(() => {
    if (readyRef.current || (!status && !statusState.error)) return;
    readyRef.current = true;
    onReady?.();
  }, [onReady, status, statusState.error]);

  // A job advanced or finished: refresh the page and the focused record. Drafts live
  // apart from the record, so this never resets what the user is typing.
  useEffect(() => {
    if (!statusState.changeToken) return;
    setListToken((value) => value + 1);
    setDetailToken((value) => value + 1);
  }, [statusState.changeToken]);

  const query = useMemo<AssetQuery>(() => {
    const value: AssetQuery = {};
    if (debouncedSearch) value.q = debouncedSearch;
    if (filters.rootId) value.rootId = filters.rootId;
    if (filters.collection !== undefined) value.collection = filters.collection;
    if (filters.minRating) value.minRating = filters.minRating;
    if (filters.hasMetadata !== undefined) value.hasMetadata = filters.hasMetadata;
    if (filters.needsReverse) value.needsReverse = true;
    return value;
  }, [debouncedSearch, filters]);

  const backendReady = Boolean(status);
  const [knownTotal, setKnownTotal] = useState(0);
  const { grid, containerRef, scrollToIndex, scrollToTop } = useVirtualGrid({
    itemCount: knownTotal,
    minColumnWidth: prefs.tileSize,
    gap: GRID_GAP,
    aspectRatio: 1,
    paddingX: GRID_PADDING * 2,
    paddingTop: GRID_PADDING,
    overscanRows: 3
  });
  const data = useAssetWindow(query, { start: grid.startIndex, end: grid.endIndex }, active && backendReady, listToken);
  const total = data.total ?? 0;
  useEffect(() => setKnownTotal(total), [total]);
  const pageError = data.error;

  // Synchronous mirrors: several key presses can arrive before React re-renders.
  const dataRef = useRef(data);
  dataRef.current = data;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const pendingFocusRef = useRef(pendingFocusIndex);
  pendingFocusRef.current = pendingFocusIndex;

  // New query: back to the top, nothing focused yet.
  useEffect(() => {
    scrollToTop();
    setFocus(null);
    setPendingFocusIndex(null);
    anchorIndexRef.current = null;
  }, [query, scrollToTop]);

  // Something always focused once the first item is in; keep the focused
  // index in step with refreshed data (inserts shift positions).
  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const item = data.getItem(pendingFocusIndex);
      if (item) {
        setFocus({ id: item.id, index: pendingFocusIndex });
        setPendingFocusIndex(null);
      }
      return;
    }
    if (!focus) {
      const first = data.getItem(0);
      if (first) setFocus({ id: first.id, index: 0 });
      return;
    }
    const index = data.indexOf(focus.id);
    if (index >= 0 && index !== focus.index) setFocus({ id: focus.id, index });
  }, [data, focus, pendingFocusIndex]);

  const { asset, setAsset, error: detailError } = useAssetDetail(focusedId, detailToken);
  const promptOptions = useMemo(() => buildPromptOptions(prefs.mode, prefs.rules), [prefs.mode, prefs.rules]);
  const { prompts, error: previewError } = usePromptPreview(asset, promptOptions);

  const draft = asset ? (drafts[asset.id] ?? draftFromAsset(asset)) : null;
  const dirty = Boolean(asset && draft && drafts[asset.id] && Object.keys(draftPatch(asset, draft)).length);

  const updateDraft = useCallback(
    (next: AssetDraft) => {
      if (!asset) return;
      setSaveError(null);
      setDrafts((current) => ({ ...current, [asset.id]: next }));
    },
    [asset]
  );

  const save = useCallback(async () => {
    if (!asset || !draft) return;
    const patch = draftPatch(asset, draft);
    if (!Object.keys(patch).length) return;
    const savedDraft = draft;
    const id = asset.id;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await galleryApi.editAsset(id, patch);
      // Only adopt the response if the user is still on the same image.
      setAsset((current) => (current?.id === id ? updated : current));
      // Drop the draft only if nothing was typed while the save was in flight.
      setDrafts((current) => {
        if (current[id] !== savedDraft) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
      setListToken((value) => value + 1);
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }, [asset, draft, setAsset]);

  const revert = useCallback(() => {
    if (!asset) return;
    setSaveError(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[asset.id];
      return next;
    });
  }, [asset]);

  const setRatingNow = useCallback(
    async (rating: number) => {
      if (!asset) return;
      const id = asset.id;
      try {
        const updated = await galleryApi.editAsset(id, { rating });
        setAsset((current) => (current?.id === id ? updated : current));
        setDrafts((current) => (current[id] ? { ...current, [id]: { ...current[id], rating } } : current));
        setListToken((value) => value + 1);
      } catch (err) {
        showToast(`评分失败：${errorText(err)}`, { variant: "error" });
      }
    },
    [asset, setAsset, showToast]
  );

  const step = useCallback(
    (delta: number) => {
      const count = dataRef.current.total ?? 0;
      if (!count) return;
      const from = pendingFocusRef.current ?? focusRef.current?.index ?? -1;
      const index = Math.max(0, Math.min(count - 1, from + delta));
      if (index === from) return;
      scrollToIndex(index);
      const item = dataRef.current.getItem(index);
      if (item) {
        focusRef.current = { id: item.id, index };
        pendingFocusRef.current = null;
        setFocus(focusRef.current);
        setPendingFocusIndex(null);
      } else {
        pendingFocusRef.current = index;
        setPendingFocusIndex(index);
      }
    },
    [scrollToIndex]
  );

  // Keyboard: ←/→ switch image, 0–5 rate (saved immediately), A select page.
  useEffect(() => {
    if (!active || dialog || viewerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        step(grid.columns);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        step(-grid.columns);
      } else if (/^[0-5]$/.test(event.key)) {
        event.preventDefault();
        void setRatingNow(Number(event.key));
      } else if (event.key === "Enter" && asset && !(shouldObscure(asset.contentRating, prefs.revealAll) && !revealed.has(asset.id))) {
        setViewerOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, asset, dialog, grid.columns, prefs.revealAll, revealed, setRatingNow, step, viewerOpen]);

  // Tile callbacks stay stable (memoized tiles); they read the latest data via refs.
  const focusTile = useCallback((id: string, index: number) => {
    anchorIndexRef.current = index;
    setPendingFocusIndex(null);
    setFocus({ id, index });
  }, []);

  const toggleSelect = useCallback((id: string, index: number) => {
    anchorIndexRef.current = index;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rangeSelect = useCallback(
    (index: number) => {
      const from = anchorIndexRef.current ?? focusRef.current?.index ?? index;
      const [a, b] = from < index ? [from, index] : [index, from];
      let missing = 0;
      const ids: string[] = [];
      for (let i = a; i <= b; i += 1) {
        const item = dataRef.current.getItem(i);
        if (item) ids.push(item.id);
        else missing += 1;
      }
      setSelected((current) => new Set([...current, ...ids]));
      if (missing) showToast(`范围内有 ${missing} 张尚未加载，未被选中；滚动经过后可再次选择。`, { variant: "error" });
    },
    [showToast]
  );

  const selectVisible = useCallback(() => {
    const ids: string[] = [];
    const first = grid.firstVisibleRow * grid.columns;
    const last = Math.min(total, (grid.lastVisibleRow + 1) * grid.columns);
    for (let i = first; i < last; i += 1) {
      const item = data.getItem(i);
      if (item) ids.push(item.id);
    }
    setSelected((current) => new Set([...current, ...ids]));
  }, [data, grid.columns, grid.firstVisibleRow, grid.lastVisibleRow, total]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  let selectedInView = 0;
  for (let i = grid.startIndex; i < grid.endIndex; i += 1) {
    const item = data.getItem(i);
    if (item && selected.has(item.id)) selectedInView += 1;
  }
  const offPage = selected.size - selectedInView;

  const capabilities = status?.capabilities;
  const wd = capabilities?.adapters?.wd_onnx ?? capabilities?.adapters?.wd;
  const wdReady = Boolean(wd?.ready);
  const wdBlockers = wd?.blockers?.length ? wd.blockers.join("；") : "WD 打标适配器未就绪（模型路径、onnxruntime-gpu 或 CUDA 未配置）。";

  async function runJob(job: GalleryJob, action: "pause" | "resume" | "cancel") {
    try {
      await galleryApi.controlJob(job.id, action);
      statusState.refresh();
    } catch (err) {
      showToast(errorText(err), { variant: "error" });
    }
  }

  async function rescan(rootId?: string) {
    try {
      await galleryApi.scan(rootId);
      showToast(rootId ? "已开始扫描该位置。" : "已开始扫描全部位置。");
      statusState.refresh();
    } catch (err) {
      showToast(errorText(err), { variant: "error" });
    }
  }

  async function processSelected() {
    try {
      await galleryApi.process(selectedIds);
      showToast(`已为 ${selectedIds.length} 张图排队 WD 打标。`);
      statusState.refresh();
    } catch (err) {
      showToast(errorText(err), { variant: "error" });
    }
  }

  async function applyBatch(patch: { rating?: number; collection?: string; addTags?: string[] }) {
    let failed = 0;
    for (const id of selectedIds) {
      try {
        const body: Parameters<typeof galleryApi.editAsset>[1] = {};
        if (patch.rating !== undefined) body.rating = patch.rating;
        if (patch.collection !== undefined) body.collection = patch.collection.trim();
        if (patch.addTags) {
          const current = await galleryApi.asset(id);
          body.personalTags = parsePersonalTags([...current.personalTags, ...patch.addTags].join(","));
        }
        const updated = await galleryApi.editAsset(id, body);
        setAsset((current) => (current?.id === id ? updated : current));
      } catch {
        failed += 1;
      }
    }
    setListToken((value) => value + 1);
    statusState.refresh();
    showToast(failed ? `已更新 ${selectedIds.length - failed} 张，${failed} 张失败。` : `已更新 ${selectedIds.length} 张。`, {
      variant: failed ? "error" : "info"
    });
  }

  function copy(text: string, what: string) {
    void navigator.clipboard.writeText(text).then(
      () => showToast(`已复制${what}。`),
      () => showToast("复制失败：剪贴板不可用。", { variant: "error" })
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!status) {
    const error = statusState.error;
    const missingRoutes = error instanceof GalleryApiError && error.status === 404;
    return (
      <div className="gal-page gal-page--blocked">
        {error ? (
          <div className="ui-empty-state">
            <strong>{missingRoutes ? "后端没有图库接口" : "无法连接图库接口"}</strong>
            <span>
              {missingRoutes
                ? "当前运行的后端版本过旧（缺少 /api/gallery）。请重启应用以启动新版后端。"
                : errorText(error)}
            </span>
            <button type="button" onClick={statusState.refresh}>
              <IconRefresh size={14} /> 重试
            </button>
          </div>
        ) : (
          <div className="page-loading">正在连接图库…</div>
        )}
      </div>
    );
  }

  const scanning = status.jobs.some((job) => job.type === "scan" && isActiveJob(job));
  const filtering = Boolean(debouncedSearch || filters.rootId || filters.collection !== undefined || filters.minRating || filters.hasMetadata !== undefined || filters.needsReverse);
  const emptyState = !status.roots.length ? (
    <div className="ui-empty-state">
      <span className="ui-empty-state__icon">
        <IconGallery size={20} />
      </span>
      <strong>图库还是空的</strong>
      <span>添加一个图片文件夹（ComfyUI 输出、下载的图集、训练集…），后台会增量扫描并读取生成元数据。</span>
      <button type="button" className="ui-btn--solid" onClick={() => setDialog({ kind: "add-root" })}>
        <IconFolderPlus size={14} /> 添加位置
      </button>
    </div>
  ) : filtering ? (
    <div className="ui-empty-state">
      <strong>没有符合条件的图片</strong>
      <button
        type="button"
        onClick={() => {
          setSearch("");
          setFilters({ rootId: undefined, collection: undefined, minRating: 0, hasMetadata: undefined, needsReverse: false });
        }}
      >
        清除搜索和筛选
      </button>
    </div>
  ) : scanning ? (
    <div className="ui-empty-state">
      <strong>正在扫描…</strong>
      <span>扫描完成的图片会自动出现在这里。</span>
    </div>
  ) : (
    <div className="ui-empty-state">
      <strong>这些位置里没有找到图片</strong>
      <span>支持 PNG、JPG、WEBP。可以检查路径或重新扫描。</span>
    </div>
  );

  const obscured = asset ? shouldObscure(asset.contentRating, prefs.revealAll) && !revealed.has(asset.id) : false;

  return (
    <div className="gal-page">
      <header className="gal-bar">
        <h1 className="gal-bar__title">图库与提示词</h1>
        <span className="gal-bar__count">{status.total} 张</span>
        <label className="gal-search">
          <IconSearch size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索文件名、提示词、标签、模型、备注"
            aria-label="搜索图库"
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearch("");
            }}
          />
        </label>
        <div className="ui-seg" role="radiogroup" aria-label="模式">
          <button type="button" aria-pressed={prefs.mode === "prompt"} onClick={() => setPrefs({ ...prefs, mode: "prompt" })} title="复现图片：取模型并集，保留全部描述">
            提示词模式
          </button>
          <button type="button" aria-pressed={prefs.mode === "train"} onClick={() => setPrefs({ ...prefs, mode: "train" })} title="LoRA 标注：取交集，删除绑定到触发词的特征">
            训练集模式
          </button>
        </div>
        <button type="button" className="ui-btn--sm" onClick={() => setDialog({ kind: "rules" })}>
          <IconSliders size={14} /> 规则
        </button>
        <span className="gal-bar__spacer" />
        <label className="gal-size" title="缩略图大小">
          <input
            type="range"
            min={88}
            max={240}
            step={4}
            value={prefs.tileSize}
            onChange={(event) => setPrefs({ ...prefs, tileSize: Number(event.target.value) })}
            aria-label="缩略图大小"
          />
        </label>
        <button
          type="button"
          className={`ui-btn--sm${prefs.revealAll ? " gal-bar__reveal-on" : ""}`}
          onClick={() => setPrefs({ ...prefs, revealAll: !prefs.revealAll })}
          title="未知分级和成人分级的图默认模糊"
          aria-pressed={prefs.revealAll}
        >
          {prefs.revealAll ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          {prefs.revealAll ? "显示全部分级" : "遮挡未知/成人分级"}
        </button>
      </header>

      <div className="gal-body">
        <GalleryNav
          roots={status.roots}
          collections={status.collections}
          jobs={status.jobs}
          filters={filters}
          onFiltersChange={setFilters}
          onAddRoot={() => setDialog({ kind: "add-root" })}
          onRescan={(rootId) => void rescan(rootId)}
          onAddCollection={() => setDialog({ kind: "new-collection" })}
          onJobAction={(job, action) => void runJob(job, action)}
          onMessage={(message) => showToast(message)}
        />

        <main className="gal-center">
          {selected.size ? (
            <div className="gal-selbar" role="toolbar" aria-label="批量操作">
              <strong>已选 {selected.size} 张</strong>
              {offPage > 0 ? <span className="gal-muted">（其中 {offPage} 张不在当前页）</span> : null}
              <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => setSelected(new Set())}>
                清除选择
              </button>
              <span className="gal-bar__spacer" />
              <button type="button" className="ui-btn--sm" onClick={() => setDialog({ kind: "batch" })}>
                整理
              </button>
              <button type="button" className="ui-btn--sm" onClick={() => setDialog({ kind: "summary", ids: selectedIds, options: promptOptions })}>
                汇总
              </button>
              <button type="button" className="ui-btn--sm" onClick={() => void processSelected()} disabled={!wdReady} title={wdReady ? "后台运行 WD 打标" : wdBlockers}>
                <IconSparkle size={14} /> 打标
              </button>
              <button type="button" className="ui-btn--sm primary" onClick={() => setDialog({ kind: "export", ids: selectedIds, options: promptOptions })}>
                <IconDownload size={14} /> 导出…
              </button>
            </div>
          ) : (
            <div className="gal-selbar gal-selbar--idle">
              <span className="gal-muted">{pageError || data.total === null ? null : `共 ${total} 张`}</span>
              <span className="gal-bar__spacer" />
              {total ? (
                <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={selectVisible}>
                  选择可见
                </button>
              ) : null}
              <span className="gal-muted gal-hint">Ctrl 点击多选 · Shift 范围选择 · 方向键切换 · 0–5 评分</span>
            </div>
          )}

          {pageError ? (
            <div className="ui-empty-state">
              <strong>读取图片列表失败</strong>
              <span>{errorText(pageError)}</span>
              <button type="button" onClick={() => setListToken((value) => value + 1)}>
                <IconRefresh size={14} /> 重试
              </button>
            </div>
          ) : (
            <GalleryGrid
              containerRef={containerRef}
              grid={grid}
              total={data.total}
              getItem={data.getItem}
              focusedId={focusedId}
              selected={selected}
              revealAll={prefs.revealAll}
              revealed={revealed}
              loading={data.loading}
              empty={emptyState}
              onFocus={focusTile}
              onToggleSelect={toggleSelect}
              onRangeSelect={rangeSelect}
            />
          )}
        </main>

        {asset && draft ? (
          <GalleryDetail
            key={asset.id}
            asset={asset}
            prompts={prompts}
            promptError={previewError ? errorText(previewError) : null}
            draft={draft}
            dirty={dirty}
            saving={saving}
            saveError={saveError}
            mode={prefs.mode}
            collections={status.collections}
            obscured={obscured}
            onReveal={() => setRevealed((current) => new Set(current).add(asset.id))}
            onOpenImage={() => setViewerOpen(true)}
            onDraftChange={updateDraft}
            onSave={() => void save()}
            onRevert={revert}
            onCopy={copy}
          />
        ) : (
          <aside className="gal-detail gal-detail--empty">
            {detailError ? (
              <div className="ui-empty-state">
                <strong>读取图片详情失败</strong>
                <span>{errorText(detailError)}</span>
              </div>
            ) : (
              <div className="ui-empty-state">{focusedId ? "加载中…" : "选择一张图片查看详情"}</div>
            )}
          </aside>
        )}
      </div>

      {dialog?.kind === "add-root" ? (
        <AddRootDialog
          onClose={() => setDialog(null)}
          onAdded={(message) => {
            showToast(message);
            statusState.refresh();
          }}
        />
      ) : null}
      {dialog?.kind === "new-collection" ? (
        <NewCollectionDialog
          onClose={() => setDialog(null)}
          onCreated={(name) => {
            showToast(`已创建集合「${name}」。`);
            statusState.refresh();
          }}
        />
      ) : null}
      {dialog?.kind === "rules" ? (
        <RulesDialog mode={prefs.mode} rules={prefs.rules} onChange={(rules) => setPrefs({ ...prefs, rules })} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "batch" ? (
        <BatchEditDialog count={selected.size} collections={status.collections} onApply={applyBatch} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "summary" ? (
        <SummaryDialog ids={dialog.ids} options={dialog.options} onClose={() => setDialog(null)} onCopy={copy} />
      ) : null}
      {dialog?.kind === "export" ? (
        <ExportDialog ids={dialog.ids} mode={prefs.mode} options={dialog.options} onClose={() => setDialog(null)} />
      ) : null}
      {viewerOpen && asset ? (
        <ImageViewer id={asset.id} filename={asset.filename} onClose={() => setViewerOpen(false)} onStep={step} />
      ) : null}
    </div>
  );
}
