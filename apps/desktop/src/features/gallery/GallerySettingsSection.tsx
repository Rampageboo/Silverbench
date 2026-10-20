import { useEffect, useState } from "react";
import { galleryApi, type GalleryCapabilities, type GallerySettings } from "./galleryApi";
import { errorText } from "./useGallery";
import "./gallery.css";

const UNIMPLEMENTED_LABELS: Record<string, string> = {
  "watch/poll ingestion": "文件夹监视 / NAS 轮询入库",
  "semantic search": "语义搜索 / 以图搜图",
  "near-duplicate search": "近似去重",
  "artist references": "画师参考与候选",
  "two-machine workers": "双机工作节点",
  "GPU scheduling": "跨应用显存调度",
  "ComfyUI roundtrip": "ComfyUI 回环验证"
};

type Fields = {
  wdModelPath: string;
  wdTagsPath: string;
  wdModelId: string;
  deviceId: string;
  wdProfileV3: boolean;
  pixaiModelPath: string;
  captionModelPath: string;
};

function fieldsFrom(settings: GallerySettings): Fields {
  return {
    wdModelPath: settings.wdModelPath ?? "",
    wdTagsPath: settings.wdTagsPath ?? "",
    wdModelId: settings.wdModelId ?? "",
    deviceId: settings.deviceId === undefined ? "" : String(settings.deviceId),
    wdProfileV3: settings.wdProfile === "wd-v3",
    pixaiModelPath: settings.pixaiModelPath ?? "",
    captionModelPath: settings.captionModelPath ?? ""
  };
}

function AdapterState({ name, adapter }: { name: string; adapter: GalleryCapabilities["adapters"][string] }) {
  const state = adapter.runtimeVerified ? "实机验证过" : adapter.ready ? "可尝试运行（未验证）" : adapter.implemented ? "已实现，前提不足" : "未实现";
  const tone = adapter.runtimeVerified ? "ok" : adapter.ready ? "info" : adapter.implemented ? "warn" : "muted";
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

/** Gallery model paths and an honest readout of what can actually run. */
export function GallerySettingsSection({ open }: { open: boolean }) {
  const [settings, setSettings] = useState<GallerySettings | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [capabilities, setCapabilities] = useState<GalleryCapabilities | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
          <h3>图库模型</h3>
          <p>本地打标与描述模型。软件不会自动下载权重，也不会悄悄退回 CPU。</p>
        </div>
        <button type="button" className="ui-btn--sm" onClick={() => void save()} disabled={!fields || saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      {error ? <div className="ui-error">{error}</div> : null}
      {saved ? <p className="settings-muted">已保存并重新检查能力。</p> : null}
      {!fields ? (
        error ? null : <p className="settings-muted">读取中…</p>
      ) : (
        <div className="gset-fields">
          <label className="ui-field">
            <span className="ui-field__label">WD 模型 (.onnx)</span>
            <input value={fields.wdModelPath} placeholder="N:\Models\.taggers\wd-eva02-large-v3\model.onnx" onChange={(event) => set({ wdModelPath: event.target.value })} spellCheck={false} />
          </label>
          <label className="ui-field">
            <span className="ui-field__label">WD 标签表 (selected_tags.csv)</span>
            <input value={fields.wdTagsPath} onChange={(event) => set({ wdTagsPath: event.target.value })} spellCheck={false} />
          </label>
          <div className="ui-field-row">
            <label className="ui-field">
              <span className="ui-field__label">WD 模型 ID</span>
              <input value={fields.wdModelId} placeholder="SmilingWolf/wd-eva02-large-tagger-v3" onChange={(event) => set({ wdModelId: event.target.value })} spellCheck={false} />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">GPU 编号</span>
              <input type="number" min={0} value={fields.deviceId} placeholder="0" onChange={(event) => set({ deviceId: event.target.value })} />
            </label>
          </div>
          <label className="gal-check">
            <input type="checkbox" checked={fields.wdProfileV3} onChange={(event) => set({ wdProfileV3: event.target.checked })} />
            这是 WD v3 ONNX 模型与对应标签表（wd-v3 规格）
          </label>
          <label className="ui-field">
            <span className="ui-field__label">PixAI Tagger 权重</span>
            <input value={fields.pixaiModelPath} onChange={(event) => set({ pixaiModelPath: event.target.value })} spellCheck={false} />
            <span className="ui-field__hint">需要本人在 Hugging Face 同意下载条款。仅填路径不会让尚未实现的适配器变为可用。</span>
          </label>
          <label className="ui-field">
            <span className="ui-field__label">描述模型</span>
            <input value={fields.captionModelPath} onChange={(event) => set({ captionModelPath: event.target.value })} spellCheck={false} />
          </label>
        </div>
      )}
      {capabilities ? (
        <div className="gset-caps">
          {Object.entries(capabilities.adapters ?? {}).map(([name, adapter]) => (
            <AdapterState key={name} name={name} adapter={adapter} />
          ))}
          {capabilities.selectionBlockers?.length ? (
            <p className="settings-muted">模型组合与阈值尚未验收：{capabilities.selectionBlockers.join("；")}</p>
          ) : null}
          {capabilities.unimplemented?.length ? (
            <p className="settings-muted">
              尚未接入：{capabilities.unimplemented.map((item) => UNIMPLEMENTED_LABELS[item] ?? item).join("、")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
