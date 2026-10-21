import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PathField } from "../../components/PathField";
import { IconClose, IconCopy } from "../../ui/icons";
import { galleryApi, galleryImageUrl, type GalleryExportResult, type GallerySummary, type PromptOptions } from "./galleryApi";
import {
  DEFAULT_RULES,
  MODE_THRESHOLDS,
  TAG_CATEGORY_LABELS,
  parsePersonalTags,
  type GalleryMode,
  type GalleryRules
} from "./galleryDomain";
import { errorText } from "./useGallery";

const ROOT_SOURCES = ["ComfyUI 输出", "下载图集", "训练集", "Blender 渲染", "其他"];

function Dialog({
  title,
  wide,
  onClose,
  children,
  footer
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ui-dialog-scrim" role="presentation" onPointerDown={onClose}>
      <section
        className={`ui-dialog${wide ? " ui-dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="ui-dialog__head">
          <h2 className="ui-dialog__title">{title}</h2>
          <button type="button" className="ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={onClose} aria-label="关闭">
            <IconClose size={14} />
          </button>
        </header>
        <div className="ui-dialog__body">{children}</div>
        {footer ? <footer className="ui-dialog__foot">{footer}</footer> : null}
      </section>
    </div>
  );
}

// ── Add location ─────────────────────────────────────────────────────────────

export function AddRootDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (message: string) => void }) {
  const [path, setPath] = useState("");
  const [source, setSource] = useState(ROOT_SOURCES[0]);
  const [recursive, setRecursive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const root = await galleryApi.addRoot({ path: path.trim(), source, recursive });
      onAdded(`已添加 ${root.path}，后台开始扫描。`);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="添加图片位置"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ui-btn--solid" onClick={() => void submit()} disabled={busy || !path.trim()}>
            {busy ? "添加中…" : "添加并扫描"}
          </button>
        </>
      }
    >
      <PathField label="文件夹" value={path} onChange={setPath} hint="本机路径或已挂载的 NAS。只读取，不改动原图；与已有位置重叠会被拒绝。" />
      <div className="ui-field">
        <span className="ui-field__label">来源</span>
        <div className="ui-seg gal-seg-wrap">
          {ROOT_SOURCES.map((item) => (
            <button key={item} type="button" aria-pressed={source === item} onClick={() => setSource(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <label className="gal-check">
        <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
        包含子文件夹
      </label>
      {error ? <div className="ui-error">{error}</div> : null}
    </Dialog>
  );
}

// ── New collection ───────────────────────────────────────────────────────────

export function NewCollectionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await galleryApi.addCollection(name.trim());
      onCreated(name.trim());
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="新建集合"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ui-btn--solid" onClick={() => void submit()} disabled={busy || !name.trim()}>
            创建
          </button>
        </>
      }
    >
      <label className="ui-field">
        <span className="ui-field__label">名称</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void submit();
          }}
        />
        <span className="ui-field__hint">目前每张图只能属于一个集合。</span>
      </label>
      {error ? <div className="ui-error">{error}</div> : null}
    </Dialog>
  );
}

// ── Rules (mode options) ─────────────────────────────────────────────────────

function ThresholdInput({
  label,
  value,
  fallback,
  onChange
}: {
  label: string;
  value: number | null;
  fallback: number;
  onChange: (value: number | null) => void;
}) {
  const current = value ?? fallback;
  return (
    <div className="gal-threshold">
      <span>{label}</span>
      <input type="range" min={0.05} max={0.95} step={0.01} value={current} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="gal-threshold__value">{current.toFixed(2)}</span>
      <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => onChange(null)} disabled={value === null}>
        {value === null ? "默认" : "恢复默认"}
      </button>
    </div>
  );
}

export function RulesDialog({
  mode,
  rules,
  onChange,
  onClose
}: {
  mode: GalleryMode;
  rules: GalleryRules;
  onChange: (rules: GalleryRules) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<GalleryRules>) => onChange({ ...rules, ...patch });
  const defaults = MODE_THRESHOLDS[mode];
  return (
    <Dialog
      title={mode === "train" ? "训练集模式规则" : "提示词模式规则"}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={() => onChange(DEFAULT_RULES)}>
            全部恢复默认
          </button>
          <button type="button" className="ui-btn--solid" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      <p className="gal-muted">
        只影响预览、汇总和导出的组装方式，不会重新打标。{mode === "train" ? "训练集模式取多模型交集。" : "提示词模式取多模型并集。"}
        默认阈值来自规则文件（未改动时为 general {defaults.general} / character {defaults.character}）。
      </p>
      <ThresholdInput label="general 阈值" value={rules.generalThreshold} fallback={defaults.general} onChange={(value) => set({ generalThreshold: value })} />
      <ThresholdInput
        label="character 阈值"
        value={rules.characterThreshold}
        fallback={defaults.character}
        onChange={(value) => set({ characterThreshold: value })}
      />
      <div className="ui-field">
        <span className="ui-field__label">标注写法</span>
        <div className="ui-seg">
          {(
            [
              ["mixed", "tag + 描述"],
              ["tags", "仅 tag"],
              ["natural", "仅自然语言"]
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={rules.captionStyle === value} onClick={() => set({ captionStyle: value })}>
              {label}
            </button>
          ))}
        </div>
        <span className="ui-field__hint">描述只使用已保存的 caption；自动描述模型尚未接入。</span>
      </div>

      {mode === "train" ? (
        <>
          <div className="ui-field-row">
            <label className="ui-field">
              <span className="ui-field__label">角色触发词</span>
              <input value={rules.trigger} placeholder="remielle" onChange={(event) => set({ trigger: event.target.value })} />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">服装触发词</span>
              <input value={rules.outfitTrigger} placeholder="remielle white outfit" onChange={(event) => set({ outfitTrigger: event.target.value })} />
            </label>
          </div>
          <div className="ui-field-row">
            <div className="ui-field">
              <span className="ui-field__label">LoRA 类型</span>
              <div className="ui-seg">
                <button type="button" aria-pressed={rules.trainingKind === "character"} onClick={() => set({ trainingKind: "character" })}>
                  角色（去画师）
                </button>
                <button type="button" aria-pressed={rules.trainingKind === "style"} onClick={() => set({ trainingKind: "style" })}>
                  画风（留画师）
                </button>
              </div>
            </div>
            <label className="ui-field">
              <span className="ui-field__label">来源标记</span>
              <input value={rules.sourceTag} placeholder="例如 3d" onChange={(event) => set({ sourceTag: event.target.value })} />
            </label>
          </div>
          <label className="ui-field">
            <span className="ui-field__label">固定特征（从标注中删除）</span>
            <textarea
              rows={2}
              value={rules.removeTags}
              placeholder="wings, white wings, blue eyes"
              onChange={(event) => set({ removeTags: event.target.value })}
            />
            <span className="ui-field__hint">逗号分隔。自然语言描述里的固定特征无法可靠自动删除，导出时会提示复核。</span>
          </label>
          <label className="ui-field">
            <span className="ui-field__label">纠错表</span>
            <textarea
              rows={2}
              value={rules.corrections}
              placeholder="cross = star (symbol)"
              onChange={(event) => set({ corrections: event.target.value })}
            />
            <span className="ui-field__hint">每行一条“错标 = 正确写法”，右侧留空表示删除。</span>
          </label>
        </>
      ) : null}
    </Dialog>
  );
}

// ── Batch organize ───────────────────────────────────────────────────────────

export function BatchEditDialog({
  count,
  collections,
  onApply,
  onClose
}: {
  count: number;
  collections: string[];
  onApply: (patch: { rating?: number; collection?: string; addTags?: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const addTags = parsePersonalTags(tags);
  const nothing = rating === null && collection === null && !addTags.length;

  async function apply() {
    setBusy(true);
    await onApply({
      rating: rating ?? undefined,
      collection: collection ?? undefined,
      addTags: addTags.length ? addTags : undefined
    });
    setBusy(false);
    onClose();
  }

  return (
    <Dialog
      title={`批量整理 ${count} 张`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ui-btn--solid" onClick={() => void apply()} disabled={busy || nothing}>
            {busy ? "应用中…" : "应用"}
          </button>
        </>
      }
    >
      <div className="ui-field">
        <span className="ui-field__label">评分</span>
        <div className="ui-seg">
          <button type="button" aria-pressed={rating === null} onClick={() => setRating(null)}>
            不改
          </button>
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" aria-pressed={rating === value} onClick={() => setRating(value)}>
              {value === 0 ? "清除" : `${value}★`}
            </button>
          ))}
        </div>
      </div>
      <label className="ui-field">
        <span className="ui-field__label">集合</span>
        <div className="ui-input-row">
          <input
            list="gallery-batch-collections"
            value={collection ?? ""}
            placeholder="不改"
            onChange={(event) => setCollection(event.target.value)}
          />
          <button type="button" className="ui-btn--ghost" onClick={() => setCollection(null)} disabled={collection === null}>
            不改
          </button>
        </div>
        <datalist id="gallery-batch-collections">
          {collections.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <span className="ui-field__hint">输入空白并应用表示移出集合。</span>
      </label>
      <label className="ui-field">
        <span className="ui-field__label">追加个人标签</span>
        <input value={tags} placeholder="逗号分隔" onChange={(event) => setTags(event.target.value)} />
      </label>
    </Dialog>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function SummaryDialog({
  ids,
  options,
  onClose,
  onCopy
}: {
  ids: string[];
  options: PromptOptions;
  onClose: () => void;
  onCopy: (text: string, what: string) => void;
}) {
  const [summary, setSummary] = useState<GallerySummary | null>(null);
  const [error, setError] = useState("");
  const [threshold, setThreshold] = useState(0.8);

  useEffect(() => {
    const controller = new AbortController();
    galleryApi
      .summary(ids, options, controller.signal)
      .then(setSummary)
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err));
      });
    return () => controller.abort();
  }, [ids, options]);

  const [common, varied] = useMemo(() => {
    const list = summary?.tagFrequencies ?? [];
    return [list.filter((tag) => tag.frequency >= threshold), list.filter((tag) => tag.frequency < threshold)];
  }, [summary, threshold]);

  return (
    <Dialog title={`图集汇总 · ${ids.length} 张`} wide onClose={onClose}>
      {error ? <div className="ui-error">{error}</div> : null}
      {!summary && !error ? <p className="gal-muted">统计中…（只汇总已有标签，不会重新打标）</p> : null}
      {summary ? (
        <>
          <div className="gal-threshold">
            <span>“几乎每张都有”</span>
            <input type="range" min={0.5} max={1} step={0.05} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
            <span className="gal-threshold__value">≥ {Math.round(threshold * 100)}%</span>
          </div>
          <div className="gal-summary">
            <div>
              <h4>共有 · {common.length}</h4>
              <div className="gal-freq">
                {common.map((tag) => (
                  <span key={`${tag.category}:${tag.name}`} className="gal-freq__row" title={TAG_CATEGORY_LABELS[tag.category]}>
                    <span>{tag.name}</span>
                    <em>{Math.round(tag.frequency * 100)}%</em>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h4>各自不同 · {varied.length}</h4>
              <div className="gal-freq">
                {varied.map((tag) => (
                  <span key={`${tag.category}:${tag.name}`} className="gal-freq__row" title={TAG_CATEGORY_LABELS[tag.category]}>
                    <span>{tag.name}</span>
                    <em>{Math.round(tag.frequency * 100)}%</em>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="ui-field">
            <span className="ui-field__label">100% 出现的标签</span>
            <p className="gal-mono">{summary.sharedTags.length ? summary.sharedTags.join(", ") : "—"}</p>
          </div>
          {(["noobai", "anima"] as const).map((key) => (
            <div key={key} className="ui-field">
              <span className="ui-field__label">
                {key === "noobai" ? "NoobAI" : "Anima"} 共同文字前缀
                <button type="button" className="ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={() => onCopy(summary.sharedPrefix[key], "共同前缀")} disabled={!summary.sharedPrefix[key]}>
                  <IconCopy size={12} />
                </button>
              </span>
              <p className="gal-mono">{summary.sharedPrefix[key] || "—"}</p>
            </div>
          ))}
          <p className="gal-muted">“共同文字前缀”是逐字的公共开头，不是上面按比例统计的结果。</p>
          {summary.warnings.length ? (
            <ul className="gal-warn-list">
              {summary.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

export function ExportDialog({
  ids,
  mode,
  options,
  onClose
}: {
  ids: string[];
  mode: GalleryMode;
  options: PromptOptions;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState("");
  const [format, setFormat] = useState<"noobai" | "anima">("anima");
  const [extension, setExtension] = useState<".txt" | ".atxt">(".atxt");
  const [artifact, setArtifact] = useState<"all" | "captions" | "json" | "csv">("all");
  const [copyImages, setCopyImages] = useState(mode === "train");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GalleryExportResult | null>(null);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await galleryApi.export({ ...options, ids, destination: destination.trim(), format, extension, artifact, copyImages })
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Dialog
        title="导出完成"
        wide
        onClose={onClose}
        footer={
          <button type="button" className="ui-btn--solid" onClick={onClose}>
            完成
          </button>
        }
      >
        <p>
          已导出 <strong>{result.count}</strong> 条记录到 <code>{result.destination}</code>，共 {result.files.length} 个文件。
        </p>
        {result.warnings.length ? (
          <div className="ui-field">
            <span className="ui-field__label">需要复核</span>
            <ul className="gal-warn-list">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="ui-field">
          <span className="ui-field__label">文件</span>
          <ul className="gal-files">
            {result.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      </Dialog>
    );
  }

  const tomlNote = mode === "train" && copyImages;
  return (
    <Dialog
      title={`导出 ${ids.length} 张`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="ui-btn--solid" onClick={() => void submit()} disabled={busy || !destination.trim() || !ids.length}>
            {busy ? "导出中…" : `确认导出 ${ids.length} 张`}
          </button>
        </>
      }
    >
      <PathField
        label="目标文件夹"
        value={destination}
        onChange={setDestination}
        hint={tomlNote ? "训练集模式 + 复制图片会生成 dataset.toml，目标文件夹必须为空。" : "必须是已存在的绝对路径。不会覆盖已有文件，也不改动原图。"}
      />
      <div className="ui-field-row">
        <div className="ui-field">
          <span className="ui-field__label">写法</span>
          <div className="ui-seg">
            <button type="button" aria-pressed={format === "noobai"} onClick={() => setFormat("noobai")}>
              NoobAI
            </button>
            <button type="button" aria-pressed={format === "anima"} onClick={() => setFormat("anima")}>
              Anima
            </button>
          </div>
        </div>
        <div className="ui-field">
          <span className="ui-field__label">标注扩展名</span>
          <div className="ui-seg">
            {([".txt", ".atxt"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={extension === value} onClick={() => setExtension(value)}>
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ui-field">
        <span className="ui-field__label">生成内容</span>
        <div className="ui-seg gal-seg-wrap">
          {(
            [
              ["all", "标注 + results.json + results.csv"],
              ["captions", "仅同名标注"],
              ["json", "仅 JSON"],
              ["csv", "仅 CSV"]
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={artifact === value} onClick={() => setArtifact(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="gal-check">
        <input type="checkbox" checked={copyImages} onChange={(event) => setCopyImages(event.target.checked)} />
        同时复制图片（与标注同名）
      </label>
      <div className="gal-export-summary">
        <div>
          <span>用途</span>
          <strong>{mode === "train" ? "训练集标注（只含正面）" : "提示词（含 Negative prompt 行）"}</strong>
        </div>
        <div>
          <span>数量</span>
          <strong>{ids.length} 张</strong>
        </div>
        {mode === "train" ? (
          <>
            <div>
              <span>触发词</span>
              <strong>{[options.trigger, options.outfitTrigger].filter(Boolean).join(" / ") || "未设置"}</strong>
            </div>
            <div>
              <span>删除固定特征</span>
              <strong>{options.removeTags?.length ? options.removeTags.join(", ") : "无"}</strong>
            </div>
          </>
        ) : null}
      </div>
      {error ? <div className="ui-error">{error}</div> : null}
    </Dialog>
  );
}

// ── Image viewer ─────────────────────────────────────────────────────────────

export function ImageViewer({
  id,
  filename,
  onClose,
  onStep
}: {
  id: string;
  filename: string;
  onClose: () => void;
  onStep: (delta: -1 | 1) => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") onStep(-1);
      else if (event.key === "ArrowRight") onStep(1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onStep]);

  return (
    <div className="gal-viewer" role="dialog" aria-modal="true" aria-label={filename} onPointerDown={onClose}>
      <header onPointerDown={(event) => event.stopPropagation()}>
        <span>{filename}</span>
        <span className="gal-muted">← → 切换 · Esc 关闭</span>
        <button type="button" className="ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={onClose} aria-label="关闭">
          <IconClose size={14} />
        </button>
      </header>
      {failed ? (
        <p className="gal-viewer__error">无法读取原图：文件可能离线、已移动或已损坏。</p>
      ) : (
        <img src={galleryImageUrl(id, true)} alt={filename} onPointerDown={(event) => event.stopPropagation()} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
