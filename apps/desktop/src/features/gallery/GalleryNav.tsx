import { useEffect, useState } from "react";
import { galleryApi, type GalleryJob, type GalleryRoot, type ReverseStatus } from "./galleryApi";
import {
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  isActiveJob,
  jobProgressText,
  rootSourceLabel
} from "./galleryDomain";
import { IconClose, IconFolder, IconPause, IconPlay, IconPlus, IconRefresh, IconStar } from "../../ui/icons";

export type GalleryFilters = {
  rootId: string | undefined;
  /** undefined = all collections; "" = assets not in any collection. */
  collection: string | undefined;
  minRating: number;
  hasMetadata: boolean | undefined;
  /** Images without generation metadata that no model has tagged yet. */
  needsReverse: boolean;
};

type Props = {
  roots: GalleryRoot[];
  collections: string[];
  jobs: GalleryJob[];
  filters: GalleryFilters;
  onFiltersChange: (filters: GalleryFilters) => void;
  onAddRoot: () => void;
  onRescan: (rootId?: string) => void;
  onAddCollection: () => void;
  onJobAction: (job: GalleryJob, action: "pause" | "resume" | "cancel") => void;
  onMessage: (message: string) => void;
};

/**
 * Metadata first: images that carry no generation metadata wait here for the tagger.
 * Refreshes whenever the job list changes (a scan or a tagging run finished).
 */
function ReverseQueue({
  jobs,
  onShow,
  onMessage
}: {
  jobs: GalleryJob[];
  onShow: () => void;
  onMessage: (message: string) => void;
}) {
  const [status, setStatus] = useState<ReverseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const jobKey = jobs.map((job) => `${job.id}:${job.status}`).join(",");

  useEffect(() => {
    const controller = new AbortController();
    galleryApi
      .reverseStatus(controller.signal)
      .then(setStatus)
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, [jobKey]);

  if (!status || !status.pending) return null;
  // Offer to start only when a stage that can run actually has unqueued work.
  const runnable =
    (status.ready && status.tags.pending > status.tags.queued) ||
    (status.controls.ready && status.controls.pending > status.controls.queued);

  async function start() {
    setBusy(true);
    try {
      const result = await galleryApi.queueReverse();
      setStatus(result);
      onMessage(
        result.jobs.length
          ? `Queued: ${result.jobs.map((job) => `${job.type === "control" ? "control maps" : "tags"} for ${job.progress.total ?? 0} images`).join(", ")}`
          : result.blocked.length
            ? `Cannot reverse yet: ${result.blocked.join("; ")}`
            : "Nothing to reverse"
      );
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gal-reverse">
      <button type="button" className="gal-reverse__count" onClick={onShow} title="Show these images">
        {status.pending} without metadata{status.queued ? ` (${status.queued} in progress)` : ""}
      </button>
      <span className="gal-reverse__stage" title={status.ready ? "" : status.blockers.join("\n")}>
        Tags: {status.tags.pending} pending{status.ready ? "" : " (tagger not ready)"}
      </span>
      {status.controls.enabled ? (
        <span className="gal-reverse__stage" title={status.controls.error}>
          Control maps: {status.controls.pending} pending
          {status.controls.ready ? "" : " (ComfyUI not connected)"}
        </span>
      ) : (
        <span className="gal-reverse__stage gal-muted">Control maps: set a ComfyUI URL in Settings</span>
      )}
      {runnable ? (
        <button type="button" className="ui-btn--sm" onClick={() => void start()} disabled={busy}>
          {busy ? "Queuing…" : "Start reverse"}
        </button>
      ) : null}
    </div>
  );
}

function rootLabel(path: string) {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .at(-1) || path
  );
}

export function GalleryNav({
  roots,
  collections,
  jobs,
  filters,
  onFiltersChange,
  onAddRoot,
  onRescan,
  onAddCollection,
  onJobAction,
  onMessage
}: Props) {
  const set = (patch: Partial<GalleryFilters>) => onFiltersChange({ ...filters, ...patch });
  const activeJobs = jobs.filter(isActiveJob);
  const recentJobs = jobs.filter((job) => !isActiveJob(job)).slice(0, 3);

  return (
    <aside className="gal-nav" aria-label="Gallery navigation">
      <section className="gal-nav__section">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">Locations</span>
          <button
            type="button"
            className="ui-btn--ghost ui-btn--icon ui-btn--sm"
            onClick={onAddRoot}
            title="Add location"
          >
            <IconPlus size={14} />
          </button>
        </header>
        <button
          type="button"
          className={`gal-nav__item${filters.rootId === undefined ? " is-active" : ""}`}
          onClick={() => set({ rootId: undefined })}
        >
          <IconFolder size={14} />
          <span className="gal-nav__text">All locations</span>
        </button>
        {roots.map((root) => (
          <div key={root.id} className={`gal-nav__row${filters.rootId === root.id ? " is-active" : ""}`}>
            <button
              type="button"
              className="gal-nav__item"
              onClick={() => set({ rootId: root.id })}
              title={root.path}
            >
              <IconFolder size={14} />
              <span className="gal-nav__text">
                <span>{rootLabel(root.path)}</span>
                <small>
                  {rootSourceLabel(root.source)}
                  {root.recursive ? "" : " · No subfolders"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="ui-btn--ghost ui-btn--icon ui-btn--sm gal-nav__row-action"
              onClick={() => onRescan(root.id)}
              title="Rescan"
              aria-label={`Rescan ${root.path}`}
            >
              <IconRefresh size={13} />
            </button>
          </div>
        ))}
        {roots.length ? null : <p className="gal-nav__empty">No locations</p>}
      </section>

      <section className="gal-nav__section">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">Collections</span>
          <button
            type="button"
            className="ui-btn--ghost ui-btn--icon ui-btn--sm"
            onClick={onAddCollection}
            title="New collection"
          >
            <IconPlus size={14} />
          </button>
        </header>
        <button
          type="button"
          className={`gal-nav__item${filters.collection === undefined ? " is-active" : ""}`}
          onClick={() => set({ collection: undefined })}
        >
          <span className="gal-nav__text">All</span>
        </button>
        <button
          type="button"
          className={`gal-nav__item${filters.collection === "" ? " is-active" : ""}`}
          onClick={() => set({ collection: "" })}
        >
          <span className="gal-nav__text gal-nav__text--muted">Unsorted</span>
        </button>
        {collections.map((name) => (
          <button
            key={name}
            type="button"
            className={`gal-nav__item${filters.collection === name ? " is-active" : ""}`}
            onClick={() => set({ collection: name })}
          >
            <span className="gal-nav__text">{name}</span>
          </button>
        ))}
      </section>

      <section className="gal-nav__section">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">Filters</span>
          {filters.minRating || filters.hasMetadata !== undefined || filters.needsReverse ? (
            <button
              type="button"
              className="ui-btn--ghost ui-btn--sm"
              onClick={() => set({ minRating: 0, hasMetadata: undefined, needsReverse: false })}
            >
              Clear
            </button>
          ) : null}
        </header>
        <div className="gal-nav__field">
          <span>Min rating</span>
          <div className="gal-stars" role="radiogroup" aria-label="Min rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filters.minRating === value}
                className={`gal-stars__star${value <= filters.minRating ? " is-on" : ""}`}
                onClick={() => set({ minRating: filters.minRating === value ? 0 : value })}
                title={`≥ ${value} stars`}
              >
                <IconStar size={14} />
              </button>
            ))}
          </div>
        </div>
        <div className="gal-nav__field">
          <span>Metadata</span>
          <div className="ui-seg">
            {(
              [
                [undefined, "All"],
                [true, "Yes"],
                [false, "No"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={!filters.needsReverse && filters.hasMetadata === value}
                onClick={() => set({ hasMetadata: value, needsReverse: false })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={filters.needsReverse}
              title="No metadata and not tagged yet"
              onClick={() => set({ hasMetadata: undefined, needsReverse: true })}
            >
              To reverse
            </button>
          </div>
        </div>
      </section>

      <section className="gal-nav__section gal-nav__jobs">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">Jobs</span>
          {roots.length ? (
            <button
              type="button"
              className="ui-btn--ghost ui-btn--sm"
              onClick={() => onRescan()}
              title="Rescan all locations"
            >
              Rescan all
            </button>
          ) : null}
        </header>
        <ReverseQueue
          jobs={jobs}
          onShow={() => set({ hasMetadata: undefined, needsReverse: true })}
          onMessage={onMessage}
        />
        {activeJobs.length || recentJobs.length ? (
          [...activeJobs, ...recentJobs].map((job) => (
            <div key={job.id} className={`gal-job gal-job--${job.status}`}>
              <div className="gal-job__head">
                <strong>{JOB_TYPE_LABELS[job.type] ?? job.type}</strong>
                <span className="gal-job__status">{JOB_STATUS_LABELS[job.status] ?? job.status}</span>
              </div>
              {job.status === "running" || job.status === "queued" ? (
                <div className="gal-job__bar" aria-hidden="true" />
              ) : null}
              <div className="gal-job__text">{jobProgressText(job)}</div>
              {job.progress?.currentPath && job.status === "running" ? (
                <div className="gal-job__path" title={job.progress.currentPath}>
                  {job.progress.currentPath}
                </div>
              ) : null}
              {job.progress?.errors?.length ? (
                <details className="gal-job__errors">
                  <summary>{job.progress.errors.length} files failed</summary>
                  <ul>
                    {job.progress.errors.slice(0, 20).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {isActiveJob(job) ? (
                <div className="gal-job__actions">
                  {job.status === "paused" ? (
                    <button type="button" className="ui-btn--sm" onClick={() => onJobAction(job, "resume")}>
                      <IconPlay size={12} /> Resume
                    </button>
                  ) : (
                    <button type="button" className="ui-btn--sm" onClick={() => onJobAction(job, "pause")}>
                      <IconPause size={12} /> Pause
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-btn--sm ui-btn--ghost"
                    onClick={() => onJobAction(job, "cancel")}
                  >
                    <IconClose size={12} /> Cancel
                  </button>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="gal-nav__empty">No jobs</p>
        )}
      </section>
    </aside>
  );
}
