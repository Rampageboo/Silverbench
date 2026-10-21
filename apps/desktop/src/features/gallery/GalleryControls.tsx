import { useEffect, useState } from "react";
import {
  CONTROL_KIND_LABELS,
  galleryApi,
  galleryControlUrl,
  type ControlKind,
  type ControlMap
} from "./galleryApi";
import { errorText } from "./useGallery";

type Props = {
  assetId: string;
  /** Changes when background jobs advance, so freshly made maps appear. */
  refreshKey: number;
  onMessage: (message: string) => void;
};

/**
 * Control maps derived from the image on the user's ComfyUI (pose, depth, lineart, canny).
 * Images without metadata get them through the reverse queue; any image can get them here.
 */
export function GalleryControls({ assetId, refreshKey, onMessage }: Props) {
  const [maps, setMaps] = useState<ControlMap[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    galleryApi
      .controls(assetId, controller.signal)
      .then((result) => {
        setMaps(result);
        setError("");
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err));
      });
    return () => controller.abort();
  }, [assetId, refreshKey]);

  async function make() {
    setBusy("make");
    try {
      const job = await galleryApi.queueControls([assetId]);
      onMessage(`已在 ComfyUI 排队生成控制图（任务 ${job.id.slice(0, 6)}）。完成后会出现在这里。`);
    } catch (err) {
      onMessage(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function toComfyUi(kind: ControlKind) {
    setBusy(kind);
    try {
      const { name } = await galleryApi.controlToComfyUi(assetId, kind);
      onMessage(`已放进 ComfyUI 的 input：在 LoadImage 里选 ${name}`);
    } catch (err) {
      onMessage(errorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="gal-section">
      <div className="gal-section__head">
        <h3 className="gal-section__title">控制图</h3>
        <button type="button" className="ui-btn--sm" onClick={() => void make()} disabled={busy !== ""} title="用 ComfyUI 的预处理器从这张图生成">
          {busy === "make" ? "排队中…" : maps?.length ? "重新补齐" : "生成控制图"}
        </button>
      </div>
      {error ? <p className="gal-detail__error">{error}</p> : null}
      {maps && !maps.length ? (
        <p className="gal-muted">
          还没有。生成后可直接放进 ComfyUI 的 LoadImage，配合 ControlNet 复现姿势、构图和线条。
        </p>
      ) : null}
      {maps?.length ? (
        <div className="gal-controls">
          {maps.map((map) => (
            <figure key={map.kind} className="gal-control">
              <a href={galleryControlUrl(assetId, map.kind, map.createdAt)} target="_blank" rel="noreferrer" title={map.preprocessor}>
                <img src={galleryControlUrl(assetId, map.kind, map.createdAt)} alt={CONTROL_KIND_LABELS[map.kind]} loading="lazy" />
              </a>
              <figcaption>
                <span>{CONTROL_KIND_LABELS[map.kind] ?? map.kind}</span>
                <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => void toComfyUi(map.kind)} disabled={busy !== ""}>
                  {busy === map.kind ? "上传中…" : "放进 ComfyUI"}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </section>
  );
}
