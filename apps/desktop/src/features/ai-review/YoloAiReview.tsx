import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PtDetectPrediction } from "../../api";
import { backendBaseUrl } from "../../lib/backendConfig";
import { AiControls, type AiOptions } from "./AiControls";
import { aiRequest, boxPrediction, type AiRecord, type AiResult } from "./aiApi";

type Props = {
  workspaceRoot: string;
  filename: string;
  onAccept: (prediction: PtDetectPrediction) => Promise<unknown>;
};

export function YoloAiReview({ workspaceRoot, filename, onAccept }: Props) {
  const [review, setReview] = useState<AiRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (expanded && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [expanded]);
  useEffect(() => {
    const controller = new AbortController();
    aiRequest<{ requests: AiRecord[] }>("/ledger?limit=200", undefined, controller.signal)
      .then(({ requests }) => {
        setReview(
          requests.find(
            (row) =>
              row.status === "completed" &&
              row.record.workspace_root === workspaceRoot &&
              row.record.filename === filename &&
              row.record.task === "box_review"
          ) ?? null
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [workspaceRoot, filename]);
  async function run(options: AiOptions) {
    setBusy(true);
    setError("");
    try {
      const result = await aiRequest<AiResult>("/review", {
        ...options,
        workspace_root: workspaceRoot,
        filename,
        batch_id: "desktop-yolo"
      });
      if (!result.id || result.reason) throw new Error(result.reason || "No review result.");
      setReview(await aiRequest<AiRecord>(`/requests/${result.id}`));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function decide(index: number, decision: "accepted" | "rejected") {
    if (!review) return;
    const object = review.record.result?.objects?.[index];
    if (!object || object.review_status !== "pending") return;
    setBusy(true);
    setError("");
    try {
      if (decision === "accepted") {
        await aiRequest(`/requests/${review.id}/verify`, {});
        await onAccept(boxPrediction(object));
        setReview({
          ...review,
          record: {
            ...review.record,
            result: {
              ...review.record.result!,
              objects: review.record.result!.objects!.map((item, i) =>
                i === index ? { ...item, review_status: decision } : item
              )
            }
          }
        });
      }
      setReview(await aiRequest<AiRecord>(`/requests/${review.id}/decision`, { index, decision }));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const result = review?.record.result;
  const [width, height] = review?.record.original_size ?? [1, 1];
  const params = new URLSearchParams({ workspaceRoot, filename });
  const content = (
    <section className="ai-review ai-review-layout" aria-label="AI box review">
      <div>
        <h3>AI box review</h3>
        <p>
          Approximate proposals only. Accept to append a label, then refine it on the canvas. Image review
          status stays unchanged.
        </p>
        <AiControls busy={busy} onRun={run} />
        {error ? (
          <p className="ui-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div>
        {review && result ? (
          <>
            <p>
              {review.model} · estimated ${review.charged.toFixed(6)} · {result.uncertainty}
            </p>
            <svg
              className="ai-box-preview"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="AI candidate boxes on original image"
            >
              <image
                href={`${backendBaseUrl()}/api/images/preview?${params}`}
                width={width}
                height={height}
              />
              {result.objects?.map((object, index) =>
                object.review_status === "rejected" ? null : (
                  <g key={index}>
                    <rect
                      x={object.pixel_box[0]}
                      y={object.pixel_box[1]}
                      width={object.pixel_box[2] - object.pixel_box[0]}
                      height={object.pixel_box[3] - object.pixel_box[1]}
                      fill="none"
                      stroke={object.review_status === "accepted" ? "#52da9c" : "#ffc15a"}
                      strokeWidth={Math.max(width / 250, 1)}
                    />
                    <text
                      x={object.pixel_box[0]}
                      y={Math.max(20, object.pixel_box[1] - 6)}
                      fill="#111"
                      stroke="#fff"
                      strokeWidth={0.5}
                      fontSize={Math.max(width / 35, 12)}
                    >
                      {index + 1}
                    </text>
                  </g>
                )
              )}
            </svg>
            {result.objects?.length ? (
              result.objects.map((object, index) => (
                <div className="ai-proposal" key={index}>
                  <strong>
                    {index + 1}.{" "}
                    {review.record.classes.find((item) => item.id === object.class_id)?.name ??
                      object.class_id}
                  </strong>
                  <p>{object.evidence}</p>
                  <span>{object.review_status}</span>
                  <div className="ai-actions">
                    <button
                      type="button"
                      disabled={busy || object.review_status !== "pending"}
                      onClick={() => void decide(index, "accepted")}
                    >
                      Accept box {index + 1}
                    </button>
                    <button
                      type="button"
                      disabled={busy || object.review_status !== "pending"}
                      onClick={() => void decide(index, "rejected")}
                    >
                      Reject box {index + 1}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p>No candidates. This image has not been marked as a negative sample.</p>
            )}
          </>
        ) : (
          <p>Select an image and request a review. Nothing is uploaded automatically.</p>
        )}
      </div>
    </section>
  );
  return (
    <div className="ai-review">
      <strong>AI review · {filename}</strong>
      <p>
        {result?.objects?.length ?? 0} candidate(s). Open the review workspace to inspect, accept or reject
        boxes.
      </p>
      <button type="button" onClick={() => setExpanded(true)}>
        Open full review
      </button>
      {expanded
        ? createPortal(
            <dialog
              ref={dialogRef}
              aria-label="YOLO AI review"
              className="ai-review-dialog"
              onCancel={(event) => {
                if (busy) event.preventDefault();
                else setExpanded(false);
              }}
            >
              <header className="ai-dialog-head">
                <strong>YOLO · {filename}</strong>
                <button type="button" disabled={busy} onClick={() => setExpanded(false)}>
                  Close review
                </button>
              </header>
              {content}
            </dialog>,
            document.body
          )
        : null}
    </div>
  );
}
