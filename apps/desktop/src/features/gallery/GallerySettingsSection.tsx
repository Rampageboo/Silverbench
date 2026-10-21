import { useEffect, useState } from "react";
import { PathField } from "../../components/PathField";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { galleryApi, type ComfyUiCheck, type GalleryCapabilities, type GallerySettings } from "./galleryApi";
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
  comfyuiPath: string;
  autoReverse: boolean;
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
    autoReverse: settings.autoReverse !== false
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

function ComfyUiStatus({ check }: { check: ComfyUiCheck | null }) {
  if (!check || !check.configured) return null;
  return check.ok ? (
    <span className="ui-field__hint gset-ok">
      已找到 ComfyUI{check.portable ? "（便携版）" : ""}：参考图从 {check.inputDir} 读取
    </span>
  ) : (
    <span className="ui-field__hint gset-bad">{check.error}</span>
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
          <h3>图库模型与路径</h3>
          <p>
            每台电脑各自保存（本机的应用数据里），换电脑时在这里重新选一次。软件不会自动下载权重，也不会悄悄退回 CPU。
          </p>
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
          <PathField
            label="ComfyUI 文件夹"
            value={fields.comfyuiPath}
            onChange={(value) => set({ comfyuiPath: value })}
            placeholder="D:\ComfyUI_windows_portable"
            status={<ComfyUiStatus check={comfyCheck} />}
            hint="用于找回 ControlNet / IPAdapter 参考图（PNG 里只记了文件名，图在 ComfyUI 的 input 文件夹）。选便携版外层或 ComfyUI 本体都可以。"
          />
          <label className="gal-check">
            <input type="checkbox" checked={fields.autoReverse} onChange={(event) => set({ autoReverse: event.target.checked })} />
            扫描后，没有生成元数据的图自动进入反推队列（打标模型就绪时运行）
          </label>
          <PathField
            label="WD 模型 (.onnx)"
            kind="file"
            filters={[{ name: "ONNX", extensions: ["onnx"] }]}
            value={fields.wdModelPath}
            onChange={(value) => set({ wdModelPath: value })}
            placeholder="N:\Models\.taggers\wd-eva02-large-v3\model.onnx"
          />
          <PathField
            label="WD 标签表 (selected_tags.csv)"
            kind="file"
            filters={[{ name: "CSV", extensions: ["csv"] }]}
            value={fields.wdTagsPath}
            onChange={(value) => set({ wdTagsPath: value })}
          />
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
          <PathField
            label="PixAI Tagger 权重"
            kind="file"
            value={fields.pixaiModelPath}
            onChange={(value) => set({ pixaiModelPath: value })}
            hint="需要本人在 Hugging Face 同意下载条款。仅填路径不会让尚未实现的适配器变为可用。"
          />
          <PathField
            label="描述模型"
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
