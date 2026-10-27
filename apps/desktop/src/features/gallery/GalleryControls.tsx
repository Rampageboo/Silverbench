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
      onMessage(`Queued control maps on ComfyUI (job ${job.id.slice(0, 6)})`);
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
      onMessage(`Sent to ComfyUI input: pick ${name} in LoadImage`);
    } catch (err) {
      onMessage(errorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="gal-section">
      <div className="gal-section__head">
        <h3 className="gal-section__title">Control maps</h3>
        <button type="button" className="ui-btn--sm" onClick={() => void make()} disabled={busy !== ""}>
          {busy === "make" ? "Queuing…" : maps?.length ? "Fill missing" : "Generate"}
        </button>
      </div>
      {error ? <p className="gal-detail__error">{error}</p> : null}
      {maps && !maps.length ? <p className="gal-muted">None yet</p> : null}
      {maps?.length ? (
        <div className="gal-controls">
          {maps.map((map) => (
            <figure key={map.kind} className="gal-control">
              <a
                href={galleryControlUrl(assetId, map.kind, map.createdAt)}
                target="_blank"
                rel="noreferrer"
                title={map.preprocessor}
              >
                <img
                  src={galleryControlUrl(assetId, map.kind, map.createdAt)}
                  alt={CONTROL_KIND_LABELS[map.kind]}
                  loading="lazy"
                />
              </a>
              <figcaption>
                <span>{CONTROL_KIND_LABELS[map.kind] ?? map.kind}</span>
                <button
                  type="button"
                  className="ui-btn--ghost ui-btn--sm"
                  onClick={() => void toComfyUi(map.kind)}
                  disabled={busy !== ""}
                >
                  {busy === map.kind ? "Sending…" : "Send to ComfyUI"}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </section>
  );
}
