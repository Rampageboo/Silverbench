import { useEffect, useState } from "react";
import { AiControls, type AiOptions } from "./AiControls";
import { aiRequest, correctedTags, type AiRecord, type AiResult } from "./aiApi";
import type { GalleryAssetDetail } from "../gallery/galleryApi";
import { parsePersonalTags, type AssetDraft } from "../gallery/galleryDomain";

export function GalleryAiReview({
  asset,
  draft,
  onDraftChange
}: {
  asset: GalleryAssetDetail;
  draft: AssetDraft;
  onDraftChange: (draft: AssetDraft) => void;
}) {
  const [result, setResult] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  function adopt(next: AiResult) {
    setResult(next);
    setCaption(next.caption ?? "");
    setAddTags(next.tags?.join(", ") ?? "");
    setRemoveTags([]);
  }
  useEffect(() => {
    const controller = new AbortController();
    aiRequest<{ requests: AiRecord[] }>("/ledger?limit=200", undefined, controller.signal)
      .then(({ requests }) => {
        const row = requests.find(
          (row) =>
            row.status === "completed" &&
            row.record.task === "gallery_caption" &&
            row.record.asset_id === asset.id
        );
        if (row?.record.result && row.record.result.review_status !== "rejected")
          adopt({ ...row.record.result, cost_usd_estimate: row.charged });
        setMessage("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [asset.id, asset.modifiedAt]);
  async function run(options: AiOptions) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await aiRequest<AiResult>("/caption", {
        ...options,
        asset_id: asset.id,
        batch_id: "desktop-gallery"
      });
      if (next.reason || next.caption === undefined) throw new Error(next.reason || "No caption returned.");
      adopt(next);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ai-review" aria-label="AI caption review">
      <h3>AI caption & tag review</h3>
      <p>Suggestions stay separate from metadata. Edit them, then apply to your draft and Save changes.</p>
      <AiControls busy={busy} onRun={run} />
      {error ? (
        <p role="alert" className="ui-error">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="ai-proposal">
          <p>
            {result.provider} · {result.review_status} · estimated $
            {result.cost_usd_estimate?.toFixed(6) ?? "unknown"}
          </p>
          <label>
            Suggested caption
            <textarea
              className="ai-caption-edit"
              aria-label="Suggested caption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
          <label>
            Suggested tags
            <input
              aria-label="Suggested tags"
              value={addTags}
              onChange={(event) => setAddTags(event.target.value)}
            />
          </label>
          {result.remove_tags?.length ? (
            <div>
              <p>Review proposed tag removals (none selected automatically):</p>
              {result.remove_tags.map((tag) => (
                <label className="ai-check" key={tag}>
                  <input
                    type="checkbox"
                    checked={removeTags.includes(tag)}
                    onChange={(event) =>
                      setRemoveTags((current) =>
                        event.target.checked ? [...current, tag] : current.filter((value) => value !== tag)
                      )
                    }
                  />
                  Remove “{tag}”
                </label>
              ))}
            </div>
          ) : null}
          <p>{result.uncertainty}</p>
          <div className="ai-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onDraftChange({
                  ...draft,
                  aiRequestId: result.id,
                  caption,
                  personalTags: correctedTags(
                    parsePersonalTags(draft.personalTags),
                    parsePersonalTags(addTags),
                    removeTags
                  ).join(", ")
                });
                setMessage("Applied to draft. Save to persist, or Discard to undo.");
              }}
            >
              Apply suggestions to draft
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void aiRequest(`/requests/${result.id}/caption-decision`, { decision: "rejected" })
                  .then(() => {
                    setResult(null);
                    setMessage("Suggestions rejected. Your saved caption and tags are unchanged.");
                  })
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Reject suggestions
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
