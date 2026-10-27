import { useEffect, useState } from "react";
import { PathField } from "../../components/PathField";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  CONTROL_KIND_LABELS,
  galleryApi,
  type ComfyServerCheck,
  type ComfyUiCheck,
  type ControlKind,
  type GalleryCapabilities,
  type GallerySettings
} from "./galleryApi";

const ALL_KINDS: ControlKind[] = ["pose", "depth", "lineart", "canny"];
const DEFAULT_KINDS: ControlKind[] = ["pose", "depth", "lineart"];
import { errorText } from "./useGallery";
import "./gallery.css";

type Fields = {
  wdModelPath: string;
  wdTagsPath: string;
  wdModelId: string;
  deviceId: string;
  wdProfileV3: boolean;
  pixaiModelPath: string;
  captionModelPath: string;
  comfyuiPath: string;
  autoReverse: boolean;
  comfyuiUrl: string;
  controlKinds: ControlKind[];
};

function fieldsFrom(settings: GallerySettings): Fields {
  return {
    wdModelPath: settings.wdModelPath ?? "",
    wdTagsPath: settings.wdTagsPath ?? "",
    wdModelId: settings.wdModelId ?? "",
    deviceId: settings.deviceId === undefined ? "" : String(settings.deviceId),
    wdProfileV3: settings.wdProfile === "wd-v3",
    pixaiModelPath: settings.pixaiModelPath ?? "",
    captionModelPath: settings.captionModelPath ?? "",
    comfyuiPath: settings.comfyuiPath ?? "",
    autoReverse: settings.autoReverse !== false,
    comfyuiUrl: settings.comfyuiUrl ?? "",
    controlKinds: settings.controlKinds ?? DEFAULT_KINDS
  };
}

function AdapterState({ name, adapter }: { name: string; adapter: GalleryCapabilities["adapters"][string] }) {
  const state = adapter.runtimeVerified
    ? "Verified"
    : adapter.ready
      ? "Ready (unverified)"
      : adapter.implemented
        ? "Not ready"
        : "Not implemented";
  const tone = adapter.runtimeVerified
    ? "ok"
    : adapter.ready
      ? "info"
      : adapter.implemented
        ? "warn"
        : "muted";
  return (
    <div className="gset-adapter">
      <div className="gset-adapter__head">
        <strong>{name}</strong>
        <span className={`gal-src gal-src--${tone}`}>{state}</span>
      </div>
      {adapter.blockers?.length ? (
        <ul>
          {adapter.blockers.map((blocker, index) => (
            <li key={index}>{blocker}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ComfyUiStatus({ check }: { check: ComfyUiCheck | null }) {
  if (!check || !check.configured) return null;
  return check.ok ? (
    <span className="ui-field__hint gset-ok">
      ComfyUI found{check.portable ? " (portable)" : ""}: {check.inputDir}
    </span>
  ) : (
    <span className="ui-field__hint gset-bad">{check.error}</span>
  );
}

function ServerStatus({ check }: { check: ComfyServerCheck | null }) {
  if (!check) return null;
  if (!check.ok) return <span className="ui-field__hint gset-bad">{check.error}</span>;
  const available = ALL_KINDS.filter((kind) => check.preprocessors[kind]);
  return (
    <span className={`ui-field__hint ${check.warning ? "gset-warn" : "gset-ok"}`}>
      Connected to ComfyUI {check.version}; available:{" "}
      {available.map((kind) => `${CONTROL_KIND_LABELS[kind]} (${check.preprocessors[kind]})`).join(", ") ||
        "none"}
      {check.warning ? `. ${check.warning}` : ""}
    </span>
  );
}

/** Gallery model paths and an honest readout of what can actually run. */
export function GallerySettingsSection({ open }: { open: boolean }) {
  const [settings, setSettings] = useState<GallerySettings | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [capabilities, setCapabilities] = useState<GalleryCapabilities | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comfyCheck, setComfyCheck] = useState<ComfyUiCheck | null>(null);
  const comfyPath = useDebouncedValue(fields?.comfyuiPath ?? "", 300);
  const [serverCheck, setServerCheck] = useState<ComfyServerCheck | null>(null);
  const comfyUrl = useDebouncedValue(fields?.comfyuiUrl ?? "", 500);

  useEffect(() => {
    if (!open || !comfyUrl.trim()) {
      setServerCheck(null);
      return;
    }
    const controller = new AbortController();
    galleryApi
      .checkComfyServer(comfyUrl.trim(), controller.signal)
      .then(setServerCheck)
      .catch(() => setServerCheck(null));
    return () => controller.abort();
  }, [comfyUrl, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    galleryApi
      .checkComfyUi(comfyPath, controller.signal)
      .then(setComfyCheck)
      .catch(() => setComfyCheck(null));
    return () => controller.abort();
  }, [comfyPath, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    Promise.all([galleryApi.settings(controller.signal), galleryApi.capabilities(controller.signal)])
      .then(([nextSettings, nextCapabilities]) => {
        setSettings(nextSettings);
        setFields(fieldsFrom(nextSettings));
        setCapabilities(nextCapabilities);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err));
      });
    return () => controller.abort();
  }, [open]);

  async function save() {
    if (!settings || !fields) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Read-merge-write: the endpoint replaces the whole settings object.
      const current = await galleryApi.settings();
      const next: GallerySettings = { ...current };
      const assign = (key: keyof Fields, value: string) => {
        if (value.trim()) (next as Record<string, unknown>)[key] = value.trim();
        else delete (next as Record<string, unknown>)[key];
      };
      assign("wdModelPath", fields.wdModelPath);
      assign("wdTagsPath", fields.wdTagsPath);
      assign("wdModelId", fields.wdModelId);
      assign("pixaiModelPath", fields.pixaiModelPath);
      assign("captionModelPath", fields.captionModelPath);
      assign("comfyuiPath", fields.comfyuiPath);
      next.autoReverse = fields.autoReverse;
      assign("comfyuiUrl", fields.comfyuiUrl);
      next.controlKinds = fields.controlKinds;
      if (fields.deviceId.trim()) next.deviceId = Number(fields.deviceId);
      else delete next.deviceId;
      // Explicit only: the backend refuses to infer the model profile from a filename.
      if (fields.wdProfileV3) next.wdProfile = "wd-v3";
      else delete next.wdProfile;
      const result = await galleryApi.saveSettings(next);
      setSettings(result);
      setFields(fieldsFrom(result));
      setCapabilities(await galleryApi.capabilities());
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<Fields>) => {
    setSaved(false);
    setFields((current) => (current ? { ...current, ...patch } : current));
  };

  return (
    <section className="settings-group">
      <div className="settings-group__head settings-group__head--row">
        <div>
          <h3>Gallery models and paths</h3>
        </div>
        <button type="button" className="ui-btn--sm" onClick={() => void save()} disabled={!fields || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error ? <div className="ui-error">{error}</div> : null}
      {saved ? <p className="settings-muted">Saved</p> : null}
      {!fields ? (
        error ? null : (
          <p className="settings-muted">Loading…</p>
        )
      ) : (
        <div className="gset-fields">
          <PathField
            label="ComfyUI folder"
            value={fields.comfyuiPath}
            onChange={(value) => set({ comfyuiPath: value })}
            placeholder="D:\ComfyUI_windows_portable"
            status={<ComfyUiStatus check={comfyCheck} />}
          />
          <label className="ui-field">
            <span className="ui-field__label">ComfyUI URL</span>
            <input
              value={fields.comfyuiUrl}
              onChange={(event) => set({ comfyuiUrl: event.target.value })}
              placeholder="http://127.0.0.1:8188"
              spellCheck={false}
            />
            <ServerStatus check={serverCheck} />
          </label>
          <div className="ui-field">
            <span className="ui-field__label">Control maps for images without metadata</span>
            <div className="gset-kinds">
              {ALL_KINDS.map((kind) => (
                <label key={kind} className="gal-check">
                  <input
                    type="checkbox"
                    checked={fields.controlKinds.includes(kind)}
                    onChange={(event) =>
                      set({
                        controlKinds: event.target.checked
                          ? ALL_KINDS.filter((item) => item === kind || fields.controlKinds.includes(item))
                          : fields.controlKinds.filter((item) => item !== kind)
                      })
                    }
                  />
                  {CONTROL_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>
          <label className="gal-check">
            <input
              type="checkbox"
              checked={fields.autoReverse}
              onChange={(event) => set({ autoReverse: event.target.checked })}
            />
            Queue images without metadata for reverse after each scan
          </label>
          <PathField
            label="WD model (.onnx)"
            kind="file"
            filters={[{ name: "ONNX", extensions: ["onnx"] }]}
            value={fields.wdModelPath}
            onChange={(value) => set({ wdModelPath: value })}
            placeholder="N:\Models\.taggers\wd-eva02-large-v3\model.onnx"
          />
          <PathField
            label="WD tag list (selected_tags.csv)"
            kind="file"
            filters={[{ name: "CSV", extensions: ["csv"] }]}
            value={fields.wdTagsPath}
            onChange={(value) => set({ wdTagsPath: value })}
          />
          <div className="ui-field-row">
            <label className="ui-field">
              <span className="ui-field__label">WD model ID</span>
              <input
                value={fields.wdModelId}
                placeholder="SmilingWolf/wd-eva02-large-tagger-v3"
                onChange={(event) => set({ wdModelId: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">GPU index</span>
              <input
                type="number"
                min={0}
                value={fields.deviceId}
                placeholder="0"
                onChange={(event) => set({ deviceId: event.target.value })}
              />
            </label>
          </div>
          <label className="gal-check">
            <input
              type="checkbox"
              checked={fields.wdProfileV3}
              onChange={(event) => set({ wdProfileV3: event.target.checked })}
            />
            WD v3 ONNX model and tag list (wd-v3 profile)
          </label>
          <PathField
            label="PixAI Tagger weights"
            kind="file"
            value={fields.pixaiModelPath}
            onChange={(value) => set({ pixaiModelPath: value })}
          />
          <PathField
            label="Caption model"
            kind="file"
            value={fields.captionModelPath}
            onChange={(value) => set({ captionModelPath: value })}
          />
        </div>
      )}
      {capabilities ? (
        <div className="gset-caps">
          {Object.entries(capabilities.adapters ?? {}).map(([name, adapter]) => (
            <AdapterState key={name} name={name} adapter={adapter} />
          ))}
          {capabilities.selectionBlockers?.length ? (
            <p className="settings-muted">
              Model selection not validated: {capabilities.selectionBlockers.join("; ")}
            </p>
          ) : null}
          {capabilities.unimplemented?.length ? (
            <p className="settings-muted">Not available yet: {capabilities.unimplemented.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
