import { useEffect, useState } from "react";
import { IconCopy } from "../../ui/icons";
import {
  galleryApi,
  galleryReferenceUrl,
  type GalleryBreakdown as Breakdown,
  type JsonObject,
  type ReferenceImage
} from "./galleryApi";
import { errorText } from "./useGallery";

type Props = {
  assetId: string;
  filename: string;
  onCopy: (text: string, what: string) => void;
};

function fmt(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "number" ? String(Math.round(value * 1000) / 1000) : String(value);
}

function Reference({
  assetId,
  image,
  configured
}: {
  assetId: string;
  image: ReferenceImage;
  configured: boolean;
}) {
  if (!image) return <span className="gal-muted">没有找到参考图节点</span>;
  if (image.found) {
    return (
      <a className="gal-ref" href={galleryReferenceUrl(assetId, image.node)} target="_blank" rel="noreferrer" title={image.path}>
        <img src={galleryReferenceUrl(assetId, image.node)} alt={image.filename} loading="lazy" />
        <span>{image.filename}</span>
      </a>
    );
  }
  return (
    <span className="gal-muted">
      参考图 {image.filename}：{configured ? "已不在 ComfyUI 的 input 文件夹" : "在设置里选择本机的 ComfyUI 文件夹后可找回"}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function samplerText(sampler: JsonObject) {
  const seed = sampler.seed ?? sampler.noise_seed;
  return [
    seed !== undefined ? `seed ${fmt(seed)}` : "",
    sampler.steps !== undefined ? `${fmt(sampler.steps)} 步` : "",
    sampler.cfg !== undefined ? `CFG ${fmt(sampler.cfg)}` : "",
    fmt(sampler.sampler_name),
    fmt(sampler.scheduler),
    sampler.denoise !== undefined && sampler.denoise !== 1 ? `denoise ${fmt(sampler.denoise)}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What produced this image: models, LoRAs, samplers, ControlNets with their reference images, and the workflow itself. */
export function GalleryBreakdown({ assetId, filename, onCopy }: Props) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    galleryApi
      .breakdown(assetId, controller.signal)
      .then(setData)
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err));
      });
    return () => controller.abort();
  }, [assetId]);

  async function downloadWorkflow() {
    // Through a blob: the backend is another origin, so a plain link would navigate instead of saving.
    try {
      const graph = await galleryApi.workflow(assetId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename.replace(/\.[^.]+$/, "") || assetId}.workflow.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function copyWorkflow() {
    try {
      onCopy(JSON.stringify(await galleryApi.workflow(assetId), null, 2), "工作流");
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (error) {
    return (
      <section className="gal-section">
        <h3 className="gal-section__title">生成拆解</h3>
        <p className="gal-detail__error">{error}</p>
      </section>
    );
  }
  if (!data || (data.format !== "comfyui" && data.format !== "a1111")) return null;

  const configured = data.comfyuiConfigured;
  const controlnets = data.controlnets ?? [];
  const ipadapters = data.ipadapters ?? [];
  const usedNodes = new Set(
    [...controlnets, ...ipadapters].map((unit) => unit.image?.node).filter((node): node is string => Boolean(node))
  );
  const otherInputs = (data.inputImages ?? []).filter((image) => !usedNodes.has(image.node));

  return (
    <section className="gal-section">
      <div className="gal-section__head">
        <h3 className="gal-section__title">生成拆解</h3>
        {data.workflowAvailable ? (
          <span className="gal-breakdown__actions">
            <button type="button" className="ui-btn--sm" onClick={() => void downloadWorkflow()} title="拖进 ComfyUI 即可还原节点">
              下载 workflow.json
            </button>
            <button type="button" className="ui-btn--ghost ui-btn--sm ui-btn--icon" onClick={() => void copyWorkflow()} title="复制工作流 JSON">
              <IconCopy size={13} />
            </button>
          </span>
        ) : null}
      </div>
      {data.workflowAvailable ? (
        <p className="gal-muted">原图本身也能直接拖进 ComfyUI；导出的 JSON 用于元数据可能丢失的场合。</p>
      ) : null}

      <dl className="gal-kv">
        {data.checkpoints?.map((item) => (
          <Row key={`ckpt-${item.node}`} label="模型">
            {item.name}
          </Row>
        ))}
        {data.vae?.map((item) => (
          <Row key={`vae-${item.node}`} label="VAE">
            {item.name}
          </Row>
        ))}
        {data.loras?.map((item, index) => (
          <Row key={`lora-${item.node}-${index}`} label="LoRA">
            {item.name}
            {item.strength_model !== undefined ? ` · ${fmt(item.strength_model)}` : ""}
            {item.strength_clip !== undefined && item.strength_clip !== item.strength_model ? ` / clip ${fmt(item.strength_clip)}` : ""}
          </Row>
        ))}
        {data.samplers?.map((item) => (
          <Row key={`sampler-${item.node}`} label={data.samplers!.length > 1 ? `采样 #${item.node}` : "采样"}>
            {samplerText(item)}
          </Row>
        ))}
        {data.upscalers?.map((item) => (
          <Row key={`up-${item.node}`} label="放大">
            {item.name}
          </Row>
        ))}
      </dl>

      {controlnets.length ? (
        <div className="gal-breakdown__units">
          {controlnets.map((unit, index) => (
            <div key={unit.node ?? `unit-${unit.unit ?? index}`} className="gal-breakdown__unit">
              <strong>ControlNet{unit.unit !== undefined ? ` ${unit.unit}` : ""}</strong>
              <span>{unit.model || "（未知模型）"}</span>
              <span className="gal-muted">
                {[
                  unit.preprocessor || unit.preprocessors?.join(" → "),
                  unit.strength !== undefined ? `强度 ${fmt(unit.strength)}` : unit.weight ? `权重 ${unit.weight}` : "",
                  unit.start_percent !== undefined || unit.end_percent !== undefined
                    ? `${fmt(unit.start_percent ?? 0)}–${fmt(unit.end_percent ?? 1)}`
                    : unit.start || unit.end
                      ? `${unit.start || 0}–${unit.end || 1}`
                      : ""
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {data.format === "comfyui" ? (
                <Reference assetId={assetId} image={unit.image} configured={configured} />
              ) : (
                <span className="gal-muted">A1111/Forge 不保存控制图本身</span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {ipadapters.length ? (
        <div className="gal-breakdown__units">
          {ipadapters.map((unit) => (
            <div key={unit.node} className="gal-breakdown__unit">
              <strong>{unit.type}</strong>
              <span className="gal-muted">
                {[unit.weight !== undefined ? `权重 ${fmt(unit.weight)}` : "", fmt(unit.weight_type), fmt(unit.preset)].filter(Boolean).join(" · ")}
              </span>
              <Reference assetId={assetId} image={unit.image} configured={configured} />
            </div>
          ))}
        </div>
      ) : null}

      {otherInputs.length ? (
        <div className="gal-breakdown__units">
          {otherInputs.map((image) => (
            <div key={image.node} className="gal-breakdown__unit">
              <strong>输入图（图生图 / 局部重绘等）</strong>
              <Reference assetId={assetId} image={image} configured={configured} />
            </div>
          ))}
        </div>
      ) : null}

      {data.adetailer && Object.keys(data.adetailer).length ? (
        <details className="gal-raw">
          <summary>ADetailer</summary>
          <dl className="gal-kv">
            {Object.entries(data.adetailer).map(([key, value]) => (
              <Row key={key} label={key}>
                {value}
              </Row>
            ))}
          </dl>
        </details>
      ) : null}
      {data.hires && Object.keys(data.hires).length ? (
        <details className="gal-raw">
          <summary>高清修复</summary>
          <dl className="gal-kv">
            {Object.entries(data.hires).map(([key, value]) => (
              <Row key={key} label={key}>
                {value}
              </Row>
            ))}
          </dl>
        </details>
      ) : null}
      {data.nodeTypes && Object.keys(data.nodeTypes).length ? (
        <details className="gal-raw">
          <summary>全部节点（{data.nodeCount}）</summary>
          <dl className="gal-kv">
            {Object.entries(data.nodeTypes).map(([kind, count]) => (
              <Row key={kind} label={String(count)}>
                {kind}
              </Row>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
