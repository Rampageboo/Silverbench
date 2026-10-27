import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PathField } from "../../components/PathField";
import { IconClose, IconCopy } from "../../ui/icons";
import {
  galleryApi,
  galleryImageUrl,
  type GalleryExportResult,
  type GallerySummary,
  type PromptOptions
} from "./galleryApi";
import {
  DEFAULT_RULES,
  MODE_THRESHOLDS,
  TAG_CATEGORY_LABELS,
  parsePersonalTags,
  type GalleryMode,
  type GalleryRules
} from "./galleryDomain";
import { errorText } from "./useGallery";

const ROOT_SOURCES = ["ComfyUI output", "Downloads", "Training set", "Blender renders", "Other"];

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
          <button
            type="button"
            className="ui-btn--ghost ui-btn--icon ui-btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
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

export function AddRootDialog({
  onClose,
  onAdded
}: {
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
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
      onAdded(`Added ${root.path}, scanning`);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Add location"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn--solid"
            onClick={() => void submit()}
            disabled={busy || !path.trim()}
          >
            {busy ? "Adding…" : "Add and scan"}
          </button>
        </>
      }
    >
      <PathField label="Folder" value={path} onChange={setPath} />
      <div className="ui-field">
        <span className="ui-field__label">Source</span>
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
        Include subfolders
      </label>
      {error ? <div className="ui-error">{error}</div> : null}
    </Dialog>
  );
}

// ── New collection ───────────────────────────────────────────────────────────

export function NewCollectionDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
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
      title="New collection"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn--solid"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
          >
            Create
          </button>
        </>
      }
    >
      <label className="ui-field">
        <span className="ui-field__label">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void submit();
          }}
        />
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
      <input
        type="range"
        min={0.05}
        max={0.95}
        step={0.01}
        value={current}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="gal-threshold__value">{current.toFixed(2)}</span>
      <button
        type="button"
        className="ui-btn--ghost ui-btn--sm"
        onClick={() => onChange(null)}
        disabled={value === null}
      >
        {value === null ? "Default" : "Reset"}
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
      title={mode === "train" ? "Training mode rules" : "Prompt mode rules"}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={() => onChange(DEFAULT_RULES)}>
            Reset all
          </button>
          <button type="button" className="ui-btn--solid" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <ThresholdInput
        label="General threshold"
        value={rules.generalThreshold}
        fallback={defaults.general}
        onChange={(value) => set({ generalThreshold: value })}
      />
      <ThresholdInput
        label="Character threshold"
        value={rules.characterThreshold}
        fallback={defaults.character}
        onChange={(value) => set({ characterThreshold: value })}
      />
      <div className="ui-field">
        <span className="ui-field__label">Caption style</span>
        <div className="ui-seg">
          {(
            [
              ["mixed", "Tags + caption"],
              ["tags", "Tags only"],
              ["natural", "Natural language only"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={rules.captionStyle === value}
              onClick={() => set({ captionStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "train" ? (
        <>
          <div className="ui-field-row">
            <label className="ui-field">
              <span className="ui-field__label">Character trigger</span>
              <input
                value={rules.trigger}
                placeholder="remielle"
                onChange={(event) => set({ trigger: event.target.value })}
              />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">Outfit trigger</span>
              <input
                value={rules.outfitTrigger}
                placeholder="remielle white outfit"
                onChange={(event) => set({ outfitTrigger: event.target.value })}
              />
            </label>
          </div>
          <div className="ui-field-row">
            <div className="ui-field">
              <span className="ui-field__label">LoRA type</span>
              <div className="ui-seg">
                <button
                  type="button"
                  aria-pressed={rules.trainingKind === "character"}
                  onClick={() => set({ trainingKind: "character" })}
                >
                  Character (drop artist)
                </button>
                <button
                  type="button"
                  aria-pressed={rules.trainingKind === "style"}
                  onClick={() => set({ trainingKind: "style" })}
                >
                  Style (keep artist)
                </button>
              </div>
            </div>
            <label className="ui-field">
              <span className="ui-field__label">Source tag</span>
              <input
                value={rules.sourceTag}
                placeholder="e.g. 3d"
                onChange={(event) => set({ sourceTag: event.target.value })}
              />
            </label>
          </div>
          <label className="ui-field">
            <span className="ui-field__label">Fixed traits (removed from captions)</span>
            <textarea
              rows={2}
              value={rules.removeTags}
              placeholder="wings, white wings, blue eyes"
              onChange={(event) => set({ removeTags: event.target.value })}
            />
          </label>
          <label className="ui-field">
            <span className="ui-field__label">Corrections</span>
            <textarea
              rows={2}
              value={rules.corrections}
              placeholder={"cross = star (symbol)\nwatermark ="}
              onChange={(event) => set({ corrections: event.target.value })}
            />
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
      title={`Organize ${count} images`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn--solid"
            onClick={() => void apply()}
            disabled={busy || nothing}
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        </>
      }
    >
      <div className="ui-field">
        <span className="ui-field__label">Rating</span>
        <div className="ui-seg">
          <button type="button" aria-pressed={rating === null} onClick={() => setRating(null)}>
            Keep
          </button>
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
            >
              {value === 0 ? "Clear" : `${value}★`}
            </button>
          ))}
        </div>
      </div>
      <label className="ui-field">
        <span className="ui-field__label">Collection</span>
        <div className="ui-input-row">
          <input
            list="gallery-batch-collections"
            value={collection ?? ""}
            placeholder="Keep"
            onChange={(event) => setCollection(event.target.value)}
          />
          <button
            type="button"
            className="ui-btn--ghost"
            onClick={() => setCollection(null)}
            disabled={collection === null}
          >
            Keep
          </button>
        </div>
        <datalist id="gallery-batch-collections">
          {collections.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <span className="ui-field__hint">Applying an empty value removes images from their collection</span>
      </label>
      <label className="ui-field">
        <span className="ui-field__label">Add personal tags</span>
        <input value={tags} placeholder="Comma separated" onChange={(event) => setTags(event.target.value)} />
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
    return [
      list.filter((tag) => tag.frequency >= threshold),
      list.filter((tag) => tag.frequency < threshold)
    ];
  }, [summary, threshold]);

  return (
    <Dialog title={`Summary · ${ids.length} images`} wide onClose={onClose}>
      {error ? <div className="ui-error">{error}</div> : null}
      {!summary && !error ? <p className="gal-muted">Summarizing…</p> : null}
      {summary ? (
        <>
          <div className="gal-threshold">
            <span>Common at</span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <span className="gal-threshold__value">≥ {Math.round(threshold * 100)}%</span>
          </div>
          <div className="gal-summary">
            <div>
              <h4>Common · {common.length}</h4>
              <div className="gal-freq">
                {common.map((tag) => (
                  <span
                    key={`${tag.category}:${tag.name}`}
                    className="gal-freq__row"
                    title={TAG_CATEGORY_LABELS[tag.category]}
                  >
                    <span>{tag.name}</span>
                    <em>{Math.round(tag.frequency * 100)}%</em>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h4>Varied · {varied.length}</h4>
              <div className="gal-freq">
                {varied.map((tag) => (
                  <span
                    key={`${tag.category}:${tag.name}`}
                    className="gal-freq__row"
                    title={TAG_CATEGORY_LABELS[tag.category]}
                  >
                    <span>{tag.name}</span>
                    <em>{Math.round(tag.frequency * 100)}%</em>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="ui-field">
            <span className="ui-field__label">Tags in every image</span>
            <p className="gal-mono">{summary.sharedTags.length ? summary.sharedTags.join(", ") : "—"}</p>
          </div>
          {(["noobai", "anima"] as const).map((key) => (
            <div key={key} className="ui-field">
              <span className="ui-field__label">
                {key === "noobai" ? "NoobAI" : "Anima"} shared prefix
                <button
                  type="button"
                  className="ui-btn--ghost ui-btn--icon ui-btn--sm"
                  onClick={() => onCopy(summary.sharedPrefix[key], "shared prefix")}
                  disabled={!summary.sharedPrefix[key]}
                >
                  <IconCopy size={12} />
                </button>
              </span>
              <p className="gal-mono">{summary.sharedPrefix[key] || "—"}</p>
            </div>
          ))}
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
        await galleryApi.export({
          ...options,
          ids,
          destination: destination.trim(),
          format,
          extension,
          artifact,
          copyImages
        })
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
        title="Export complete"
        wide
        onClose={onClose}
        footer={
          <button type="button" className="ui-btn--solid" onClick={onClose}>
            Done
          </button>
        }
      >
        <p>
          Exported <strong>{result.count}</strong> records to <code>{result.destination}</code> (
          {result.files.length} files)
        </p>
        {result.warnings.length ? (
          <div className="ui-field">
            <span className="ui-field__label">Needs review</span>
            <ul className="gal-warn-list">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="ui-field">
          <span className="ui-field__label">Files</span>
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
      title={`Export ${ids.length} images`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn--solid"
            onClick={() => void submit()}
            disabled={busy || !destination.trim() || !ids.length}
          >
            {busy ? "Exporting…" : `Export ${ids.length} images`}
          </button>
        </>
      }
    >
      <PathField
        label="Destination folder"
        value={destination}
        onChange={setDestination}
        hint={tomlNote ? "Must be an empty folder (dataset.toml is written)" : undefined}
      />
      <div className="ui-field-row">
        <div className="ui-field">
          <span className="ui-field__label">Format</span>
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
          <span className="ui-field__label">Caption extension</span>
          <div className="ui-seg">
            {([".txt", ".atxt"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={extension === value}
                onClick={() => setExtension(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ui-field">
        <span className="ui-field__label">Output</span>
        <div className="ui-seg gal-seg-wrap">
          {(
            [
              ["all", "Captions + results.json + results.csv"],
              ["captions", "Captions only"],
              ["json", "JSON only"],
              ["csv", "CSV only"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={artifact === value}
              onClick={() => setArtifact(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="gal-check">
        <input
          type="checkbox"
          checked={copyImages}
          onChange={(event) => setCopyImages(event.target.checked)}
        />
        Copy images too
      </label>
      <div className="gal-export-summary">
        <div>
          <span>Content</span>
          <strong>
            {mode === "train" ? "Training captions (positive only)" : "Prompts (with Negative prompt line)"}
          </strong>
        </div>
        <div>
          <span>Images</span>
          <strong>{ids.length}</strong>
        </div>
        {mode === "train" ? (
          <>
            <div>
              <span>Triggers</span>
              <strong>
                {[options.trigger, options.outfitTrigger].filter(Boolean).join(" / ") || "Not set"}
              </strong>
            </div>
            <div>
              <span>Removed traits</span>
              <strong>{options.removeTags?.length ? options.removeTags.join(", ") : "None"}</strong>
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
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm"
          onClick={onClose}
          aria-label="Close"
        >
          <IconClose size={14} />
        </button>
      </header>
      {failed ? (
        <p className="gal-viewer__error">Cannot load the image: the file may be offline, moved or damaged</p>
      ) : (
        <img
          src={galleryImageUrl(id, true)}
          alt={filename}
          onPointerDown={(event) => event.stopPropagation()}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
