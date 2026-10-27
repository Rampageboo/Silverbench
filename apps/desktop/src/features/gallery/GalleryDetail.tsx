import { useState } from "react";
import {
  galleryImageUrl,
  type GalleryAssetDetail,
  type GalleryPrompt,
  type GalleryPrompts,
  type JsonObject
} from "./galleryApi";
import {
  METADATA_FORMAT_LABELS,
  TAG_CATEGORY_LABELS,
  contentRatingLabel,
  formatProbability,
  groupTags,
  promptOverride,
  promptSourceLabel,
  rootSourceLabel,
  withPromptOverride,
  type AssetDraft,
  type GalleryMode,
  type PromptField,
  type PromptFormat
} from "./galleryDomain";
import { IconAlert, IconCopy, IconEyeOff, IconStar } from "../../ui/icons";
import { GalleryBreakdown } from "./GalleryBreakdown";
import { GalleryControls } from "./GalleryControls";

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
  /** Changes when background jobs advance, so generated control maps show up. */
  refreshKey: number;
  onMessage: (message: string) => void;
};

const FORMAT_LABELS: Record<PromptFormat, string> = { noobai: "NoobAI", anima: "Anima" };

function SourceBadge({ source }: { source: string }) {
  const meta = promptSourceLabel(source);
  return <span className={`gal-src gal-src--${meta.tone}`}>{meta.label}</span>;
}

function KeyValues({ value, empty }: { value: JsonObject | undefined; empty: string }) {
  const entries = Object.entries(value ?? {}).filter(
    ([, item]) => item !== null && item !== undefined && item !== ""
  );
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
  const source =
    override !== undefined
      ? "user"
      : prompt
        ? field === "positive"
          ? prompt.source
          : prompt.negativeSource
        : "none";

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
            title="Discard the manual edit"
            onClick={() =>
              onDraftChange({
                ...draft,
                userEdits: withPromptOverride(draft.userEdits, format, field, undefined)
              })
            }
          >
            Use auto
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm"
          title={`Copy ${label.toLowerCase()} prompt`}
          aria-label={`Copy ${label.toLowerCase()} prompt`}
          onClick={() => onCopy(value, `${label.toLowerCase()} prompt`)}
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
        placeholder={prompt ? "(empty)" : "Generating preview…"}
        onChange={(event) =>
          onDraftChange({
            ...draft,
            userEdits: withPromptOverride(draft.userEdits, format, field, event.target.value)
          })
        }
      />
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
  onCopy,
  refreshKey,
  onMessage
}: Props) {
  const [format, setFormat] = useState<PromptFormat>("noobai");
  const prompt = prompts ? prompts[format] : null;
  const metadata = asset.metadata;
  const tagGroups = prompts ? groupTags(prompts.tags) : [];
  const recommendations = prompt?.recommendations;
  const originalParameters = metadata?.source === "metadata" ? metadata.parameters : undefined;

  return (
    <aside className="gal-detail" aria-label="Image details">
      <div className="gal-detail__scroll">
        <button
          type="button"
          className="gal-detail__preview"
          onClick={obscured ? onReveal : onOpenImage}
          title={obscured ? "Show image" : "Open full size"}
        >
          <img
            src={galleryImageUrl(asset.id)}
            alt=""
            className={obscured ? "is-obscured" : undefined}
            draggable={false}
          />
          {obscured ? (
            <span className="gal-tile__veil">
              <IconEyeOff size={18} />
              <span>{contentRatingLabel(asset.contentRating)} · Click to show</span>
            </span>
          ) : null}
        </button>

        <header className="gal-detail__title">
          <h2 title={asset.filename}>{asset.filename}</h2>
          <p className="gal-detail__path" title={asset.path}>
            {asset.path}
          </p>
          <p className="gal-detail__facts">
            {asset.width}×{asset.height} · {asset.format.toUpperCase()} ·{" "}
            {asset.source ? rootSourceLabel(asset.source) : "No source"} ·{" "}
            {contentRatingLabel(asset.contentRating)}
          </p>
          {asset.missing ? (
            <p className="gal-warn">
              <IconAlert size={14} />
              Source file unavailable (offline or moved). Your edits are kept
            </p>
          ) : null}
        </header>

        <section className="gal-section">
          <h3 className="gal-section__title">Organize</h3>
          <div className="gal-field gal-field--inline">
            <span>Rating</span>
            <div className="gal-stars gal-stars--lg" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.rating === value}
                  className={`gal-stars__star${value <= draft.rating ? " is-on" : ""}`}
                  onClick={() => onDraftChange({ ...draft, rating: draft.rating === value ? 0 : value })}
                  title={`${value} stars (key ${value})`}
                >
                  <IconStar size={16} />
                </button>
              ))}
            </div>
          </div>
          <label className="gal-field">
            <span>Collection</span>
            <input
              list="gallery-collections"
              value={draft.collection}
              placeholder="Unsorted"
              onChange={(event) => onDraftChange({ ...draft, collection: event.target.value })}
            />
            <datalist id="gallery-collections">
              {collections.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="gal-field">
            <span>Personal tags</span>
            <input
              value={draft.personalTags}
              placeholder="Comma separated"
              onChange={(event) => onDraftChange({ ...draft, personalTags: event.target.value })}
            />
          </label>
          <label className="gal-field">
            <span>Notes</span>
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })}
            />
          </label>
        </section>

        <section className="gal-section">
          <div className="gal-section__head">
            <h3 className="gal-section__title">Prompts</h3>
            <div className="ui-seg" role="tablist" aria-label="Prompt format">
              {(Object.keys(FORMAT_LABELS) as PromptFormat[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={format === key}
                  onClick={() => setFormat(key)}
                >
                  {FORMAT_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
          {promptError ? <div className="ui-error">Preview failed: {promptError}</div> : null}
          <PromptEditor
            label="Positive"
            prompt={prompt}
            field="positive"
            format={format}
            draft={draft}
            onDraftChange={onDraftChange}
            onCopy={onCopy}
          />
          <PromptEditor
            label="Negative"
            prompt={prompt}
            field="negative"
            format={format}
            draft={draft}
            onDraftChange={onDraftChange}
            onCopy={onCopy}
          />
          {mode === "train" && promptOverride(draft.userEdits, format, "positive") !== undefined ? (
            <p className="gal-warn">
              <IconAlert size={14} />
              Edited positive prompts are exported as-is; training rules do not apply to them
            </p>
          ) : null}
          <div className="gal-params">
            <div>
              <h4>Original parameters</h4>
              <KeyValues value={originalParameters} empty="None" />
            </div>
            <div>
              <h4>Suggested parameters</h4>
              <KeyValues value={recommendations} empty="—" />
            </div>
          </div>
          {originalParameters && Object.keys(originalParameters).length ? (
            <button
              type="button"
              className="ui-btn--sm"
              onClick={() =>
                onCopy(
                  Object.entries(originalParameters)
                    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                    .join(", "),
                  "original parameters"
                )
              }
            >
              <IconCopy size={13} /> Copy original parameters
            </button>
          ) : null}
        </section>

        {prompts?.warnings.length ? (
          <section className="gal-section">
            <h3 className="gal-section__title">Needs review</h3>
            <ul className="gal-warn-list">
              {prompts.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="gal-section">
          <h3 className="gal-section__title">Tags</h3>
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
                          tag.selected ? "Used" : "Below threshold, not used",
                          `Source: ${promptSourceLabel(tag.source).label}`,
                          ...Object.entries(tag.probabilities ?? {}).map(
                            ([model, value]) => `${model}: ${Math.round(value * 100)}%`
                          )
                        ].join("\n")}
                      >
                        {tag.name}
                        {probability ? <em>{probability}</em> : <em className="gal-tag__meta">metadata</em>}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <p className="gal-muted">{prompts ? "No tags yet" : "Loading…"}</p>
          )}
        </section>

        <GalleryBreakdown assetId={asset.id} filename={asset.filename} onCopy={onCopy} />
        <GalleryControls assetId={asset.id} refreshKey={refreshKey} onMessage={onMessage} />

        <section className="gal-section">
          <h3 className="gal-section__title">Original metadata</h3>
          <dl className="gal-kv">
            <div>
              <dt>Format</dt>
              <dd>{METADATA_FORMAT_LABELS[metadata?.format ?? "none"] ?? metadata?.format}</dd>
            </div>
            {metadata?.model ? (
              <div>
                <dt>Model</dt>
                <dd>{metadata.model}</dd>
              </div>
            ) : null}
            {metadata?.loras?.length ? (
              <div>
                <dt>LoRA</dt>
                <dd>
                  {metadata.loras
                    .map(
                      (lora) =>
                        `${String(lora.name ?? lora.path ?? "?")}${lora.weight !== undefined ? `:${String(lora.weight)}` : ""}`
                    )
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
          {metadata?.raw && Object.keys(metadata.raw).length ? (
            <details className="gal-raw">
              <summary>Raw data</summary>
              <pre>{JSON.stringify(metadata.raw, null, 2)}</pre>
            </details>
          ) : null}
        </section>
      </div>

      <footer className={`gal-detail__foot${dirty ? " is-dirty" : ""}`}>
        {saveError ? (
          <span className="gal-detail__error">{saveError}</span>
        ) : (
          <span className="gal-muted">{dirty ? "Unsaved changes" : "Saved"}</span>
        )}
        <button
          type="button"
          className="ui-btn--ghost ui-btn--sm"
          onClick={onRevert}
          disabled={!dirty || saving}
        >
          Discard
        </button>
        <button
          type="button"
          className="ui-btn--solid ui-btn--sm"
          onClick={onSave}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </aside>
  );
}
