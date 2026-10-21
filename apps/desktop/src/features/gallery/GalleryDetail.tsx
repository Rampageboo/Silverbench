import { useState } from "react";
import { galleryImageUrl, type GalleryAssetDetail, type GalleryPrompt, type GalleryPrompts, type JsonObject } from "./galleryApi";
import {
  METADATA_FORMAT_LABELS,
  TAG_CATEGORY_LABELS,
  contentRatingLabel,
  formatProbability,
  groupTags,
  promptOverride,
  promptSourceLabel,
  withPromptOverride,
  type AssetDraft,
  type GalleryMode,
  type PromptField,
  type PromptFormat
} from "./galleryDomain";
import { IconAlert, IconCopy, IconEyeOff, IconStar } from "../../ui/icons";
import { GalleryBreakdown } from "./GalleryBreakdown";

type Props = {
  asset: GalleryAssetDetail;
  prompts: GalleryPrompts | null;
  promptError: string | null;
  draft: AssetDraft;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  mode: GalleryMode;
  collections: string[];
  obscured: boolean;
  onReveal: () => void;
  onOpenImage: () => void;
  onDraftChange: (draft: AssetDraft) => void;
  onSave: () => void;
  onRevert: () => void;
  onCopy: (text: string, what: string) => void;
};

const FORMAT_LABELS: Record<PromptFormat, string> = { noobai: "NoobAI", anima: "Anima" };

function SourceBadge({ source }: { source: string }) {
  const meta = promptSourceLabel(source);
  return <span className={`gal-src gal-src--${meta.tone}`}>{meta.label}</span>;
}

function KeyValues({ value, empty }: { value: JsonObject | undefined; empty: string }) {
  const entries = Object.entries(value ?? {}).filter(([, item]) => item !== null && item !== undefined && item !== "");
  if (!entries.length) return <p className="gal-muted">{empty}</p>;
  return (
    <dl className="gal-kv">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof item === "object" ? JSON.stringify(item) : String(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PromptEditor({
  label,
  prompt,
  field,
  format,
  draft,
  onDraftChange,
  onCopy
}: {
  label: string;
  prompt: GalleryPrompt | null;
  field: PromptField;
  format: PromptFormat;
  draft: AssetDraft;
  onDraftChange: (draft: AssetDraft) => void;
  onCopy: (text: string, what: string) => void;
}) {
  const override = promptOverride(draft.userEdits, format, field);
  const auto = prompt ? (field === "positive" ? prompt.positive : prompt.negative) : "";
  const value = override ?? auto;
  const source = override !== undefined ? "user" : prompt ? (field === "positive" ? prompt.source : prompt.negativeSource) : "none";

  return (
    <div className="gal-prompt">
      <div className="gal-prompt__head">
        <span className="gal-prompt__label">{label}</span>
        <SourceBadge source={source} />
        <span className="gal-prompt__spacer" />
        {override !== undefined ? (
          <button
            type="button"
            className="ui-btn--ghost ui-btn--sm"
            title="去掉人工覆盖，使用自动结果"
            onClick={() => onDraftChange({ ...draft, userEdits: withPromptOverride(draft.userEdits, format, field, undefined) })}
          >
            恢复自动
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm"
          title={`复制${label}`}
          aria-label={`复制${label}`}
          onClick={() => onCopy(value, label)}
          disabled={!value}
        >
          <IconCopy size={13} />
        </button>
      </div>
      <textarea
        className="gal-prompt__text"
        value={value}
        spellCheck={false}
        rows={field === "positive" ? 5 : 3}
        placeholder={prompt ? "（空）" : "正在生成预览…"}
        onChange={(event) =>
          onDraftChange({ ...draft, userEdits: withPromptOverride(draft.userEdits, format, field, event.target.value) })
        }
      />
      {override === "" ? <p className="gal-note">已人工清空，导出时保持为空。</p> : null}
    </div>
  );
}

export function GalleryDetail({
  asset,
  prompts,
  promptError,
  draft,
  dirty,
  saving,
  saveError,
  mode,
  collections,
  obscured,
  onReveal,
  onOpenImage,
  onDraftChange,
  onSave,
  onRevert,
  onCopy
}: Props) {
  const [format, setFormat] = useState<PromptFormat>("noobai");
  const prompt = prompts ? prompts[format] : null;
  const metadata = asset.metadata;
  const tagGroups = prompts ? groupTags(prompts.tags) : [];
  const recommendations = prompt?.recommendations;
  const originalParameters = metadata?.source === "metadata" ? metadata.parameters : undefined;

  return (
    <aside className="gal-detail" aria-label="图片详情">
      <div className="gal-detail__scroll">
        <button type="button" className="gal-detail__preview" onClick={obscured ? onReveal : onOpenImage} title={obscured ? "显示此图" : "查看原图"}>
          <img src={galleryImageUrl(asset.id)} alt="" className={obscured ? "is-obscured" : undefined} draggable={false} />
          {obscured ? (
            <span className="gal-tile__veil">
              <IconEyeOff size={18} />
              <span>{contentRatingLabel(asset.contentRating)} · 点击显示</span>
            </span>
          ) : null}
        </button>

        <header className="gal-detail__title">
          <h2 title={asset.filename}>{asset.filename}</h2>
          <p className="gal-detail__path" title={asset.path}>
            {asset.path}
          </p>
          <p className="gal-detail__facts">
            {asset.width}×{asset.height} · {asset.format.toUpperCase()} · {asset.source || "未标来源"} · 分级 {contentRatingLabel(asset.contentRating)}
          </p>
          {asset.missing ? (
            <p className="gal-warn">
              <IconAlert size={14} />
              源文件当前不可用：NAS 可能离线，或文件被移动后尚未重新扫描。记录与修改会保留。
            </p>
          ) : null}
        </header>

        <section className="gal-section">
          <h3 className="gal-section__title">整理</h3>
          <div className="gal-field gal-field--inline">
            <span>评分</span>
            <div className="gal-stars gal-stars--lg" role="radiogroup" aria-label="评分">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.rating === value}
                  className={`gal-stars__star${value <= draft.rating ? " is-on" : ""}`}
                  onClick={() => onDraftChange({ ...draft, rating: draft.rating === value ? 0 : value })}
                  title={`${value} 星（数字键 ${value}）`}
                >
                  <IconStar size={16} />
                </button>
              ))}
            </div>
          </div>
          <label className="gal-field">
            <span>集合</span>
            <input
              list="gallery-collections"
              value={draft.collection}
              placeholder="未归集"
              onChange={(event) => onDraftChange({ ...draft, collection: event.target.value })}
            />
            <datalist id="gallery-collections">
              {collections.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="gal-field">
            <span>个人标签</span>
            <input
              value={draft.personalTags}
              placeholder="用逗号分隔，与 Danbooru tag 分开"
              onChange={(event) => onDraftChange({ ...draft, personalTags: event.target.value })}
            />
          </label>
          <label className="gal-field">
            <span>备注</span>
            <textarea rows={2} value={draft.notes} onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })} />
          </label>
        </section>

        <section className="gal-section">
          <div className="gal-section__head">
            <h3 className="gal-section__title">提示词 · {mode === "train" ? "训练集模式" : "提示词模式"}</h3>
            <div className="ui-seg" role="tablist" aria-label="提示词写法">
              {(Object.keys(FORMAT_LABELS) as PromptFormat[]).map((key) => (
                <button key={key} type="button" role="tab" aria-selected={format === key} onClick={() => setFormat(key)}>
                  {FORMAT_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
          {promptError ? <div className="ui-error">预览失败：{promptError}</div> : null}
          <PromptEditor label="正面" prompt={prompt} field="positive" format={format} draft={draft} onDraftChange={onDraftChange} onCopy={onCopy} />
          <PromptEditor label="负面" prompt={prompt} field="negative" format={format} draft={draft} onDraftChange={onDraftChange} onCopy={onCopy} />
          {mode === "train" && promptOverride(draft.userEdits, format, "positive") !== undefined ? (
            <p className="gal-warn">
              <IconAlert size={14} />
              人工覆盖的正面提示词会原样导出，训练集删除规则不会改写它，请自行复核。
            </p>
          ) : null}
          <div className="gal-params">
            <div>
              <h4>原始参数</h4>
              <KeyValues value={originalParameters} empty="无原始生成参数（无元数据）。" />
            </div>
            <div>
              <h4>建议参数</h4>
              <KeyValues value={recommendations} empty="—" />
            </div>
          </div>
          {originalParameters && Object.keys(originalParameters).length ? (
            <button
              type="button"
              className="ui-btn--sm"
              onClick={() => onCopy(Object.entries(originalParameters).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", "), "原始参数")}
            >
              <IconCopy size={13} /> 复制原始参数
            </button>
          ) : null}
        </section>

        {prompts?.warnings.length ? (
          <section className="gal-section">
            <h3 className="gal-section__title">需要复核</h3>
            <ul className="gal-warn-list">
              {prompts.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="gal-section">
          <h3 className="gal-section__title">标签</h3>
          {tagGroups.length ? (
            tagGroups.map((group) => (
              <div key={group.category} className="gal-tags">
                <span className="gal-tags__cat">{TAG_CATEGORY_LABELS[group.category] ?? group.category}</span>
                <div className="gal-tags__list">
                  {group.tags.map((tag) => {
                    const probability = formatProbability(tag.probability);
                    const strength = tag.probability ?? 1;
                    return (
                      <span
                        key={`${tag.category}:${tag.name}`}
                        className={`gal-tag${tag.selected ? "" : " is-dropped"}${tag.metadata ? " is-meta" : ""}`}
                        style={{ ["--p" as string]: String(Math.max(0.15, Math.min(1, strength))) }}
                        title={[
                          tag.selected ? "已采用" : "低于当前阈值，未采用",
                          `来源：${promptSourceLabel(tag.source).label}`,
                          ...Object.entries(tag.probabilities ?? {}).map(([model, value]) => `${model}: ${Math.round(value * 100)}%`)
                        ].join("\n")}
                      >
                        {tag.name}
                        {probability ? <em>{probability}</em> : <em className="gal-tag__meta">元数据</em>}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <p className="gal-muted">{prompts ? "没有标签：既无元数据标签，也还没有模型打标结果。" : "加载中…"}</p>
          )}
        </section>

        <GalleryBreakdown assetId={asset.id} filename={asset.filename} onCopy={onCopy} />

        <section className="gal-section">
          <h3 className="gal-section__title">原始元数据</h3>
          <dl className="gal-kv">
            <div>
              <dt>格式</dt>
              <dd>{METADATA_FORMAT_LABELS[metadata?.format ?? "none"] ?? metadata?.format}</dd>
            </div>
            {metadata?.model ? (
              <div>
                <dt>模型</dt>
                <dd>{metadata.model}</dd>
              </div>
            ) : null}
            {metadata?.loras?.length ? (
              <div>
                <dt>LoRA</dt>
                <dd>
                  {metadata.loras
                    .map((lora) => `${String(lora.name ?? lora.path ?? "?")}${lora.weight !== undefined ? `:${String(lora.weight)}` : ""}`)
                    .join(", ")}
                </dd>
              </div>
            ) : null}
          </dl>
          {metadata?.warnings?.length ? (
            <ul className="gal-warn-list">
              {metadata.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {metadata?.source === "none" ? <p className="gal-muted">无元数据：上面的提示词来自格式转换或模型反推，不等于原作者写法。</p> : null}
          {metadata?.raw && Object.keys(metadata.raw).length ? (
            <details className="gal-raw">
              <summary>原始数据</summary>
              <pre>{JSON.stringify(metadata.raw, null, 2)}</pre>
            </details>
          ) : null}
        </section>
      </div>

      <footer className={`gal-detail__foot${dirty ? " is-dirty" : ""}`}>
        {saveError ? <span className="gal-detail__error">{saveError}</span> : <span className="gal-muted">{dirty ? "有未保存的修改" : "已保存"}</span>}
        <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={onRevert} disabled={!dirty || saving}>
          放弃
        </button>
        <button type="button" className="ui-btn--solid ui-btn--sm" onClick={onSave} disabled={!dirty || saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </footer>
    </aside>
  );
}
