import { useEffect, useState } from "react";
import { galleryApi, type GalleryJob, type GalleryRoot, type ReverseStatus } from "./galleryApi";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, isActiveJob, jobProgressText } from "./galleryDomain";
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
function ReverseQueue({ jobs, onShow, onMessage }: { jobs: GalleryJob[]; onShow: () => void; onMessage: (message: string) => void }) {
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
  const waiting = status.pending - status.queued;

  async function start() {
    setBusy(true);
    try {
      const result = await galleryApi.queueReverse();
      setStatus(result);
      onMessage(result.job ? `已加入反推：${result.job.progress.total ?? waiting} 张` : "没有需要反推的图。");
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gal-reverse">
      <button type="button" className="gal-reverse__count" onClick={onShow} title="只看这些图">
        {status.pending} 张无元数据{status.queued ? `（${status.queued} 张反推中）` : ""}
      </button>
      {waiting > 0 ? (
        status.ready ? (
          <button type="button" className="ui-btn--sm" onClick={() => void start()} disabled={busy}>
            {busy ? "加入中…" : "开始反推"}
          </button>
        ) : (
          <span className="gal-muted" title={status.blockers.join("\n")}>
            打标模型未就绪，在设置里配置后自动开始
          </span>
        )
      ) : null}
    </div>
  );
}

function rootLabel(path: string) {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) || path;
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
    <aside className="gal-nav" aria-label="图库导航">
      <section className="gal-nav__section">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">位置</span>
          <button type="button" className="ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={onAddRoot} title="添加位置">
            <IconPlus size={14} />
          </button>
        </header>
        <button
          type="button"
          className={`gal-nav__item${filters.rootId === undefined ? " is-active" : ""}`}
          onClick={() => set({ rootId: undefined })}
        >
          <IconFolder size={14} />
          <span className="gal-nav__text">全部位置</span>
        </button>
        {roots.map((root) => (
          <div key={root.id} className={`gal-nav__row${filters.rootId === root.id ? " is-active" : ""}`}>
            <button type="button" className="gal-nav__item" onClick={() => set({ rootId: root.id })} title={root.path}>
              <IconFolder size={14} />
              <span className="gal-nav__text">
                <span>{rootLabel(root.path)}</span>
                <small>
                  {root.source}
                  {root.recursive ? "" : " · 不含子目录"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="ui-btn--ghost ui-btn--icon ui-btn--sm gal-nav__row-action"
              onClick={() => onRescan(root.id)}
              title="增量扫描此位置"
              aria-label={`扫描 ${root.path}`}
            >
              <IconRefresh size={13} />
            </button>
          </div>
        ))}
        {roots.length ? null : <p className="gal-nav__empty">还没有添加图片位置。</p>}
      </section>

      <section className="gal-nav__section">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">集合</span>
          <button type="button" className="ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={onAddCollection} title="新建集合">
            <IconPlus size={14} />
          </button>
        </header>
        <button
          type="button"
          className={`gal-nav__item${filters.collection === undefined ? " is-active" : ""}`}
          onClick={() => set({ collection: undefined })}
        >
          <span className="gal-nav__text">全部</span>
        </button>
        <button
          type="button"
          className={`gal-nav__item${filters.collection === "" ? " is-active" : ""}`}
          onClick={() => set({ collection: "" })}
        >
          <span className="gal-nav__text gal-nav__text--muted">未归集</span>
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
          <span className="ui-eyebrow">筛选</span>
          {filters.minRating || filters.hasMetadata !== undefined || filters.needsReverse ? (
            <button
              type="button"
              className="ui-btn--ghost ui-btn--sm"
              onClick={() => set({ minRating: 0, hasMetadata: undefined, needsReverse: false })}
            >
              清除
            </button>
          ) : null}
        </header>
        <div className="gal-nav__field">
          <span>最低评分</span>
          <div className="gal-stars" role="radiogroup" aria-label="最低评分">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filters.minRating === value}
                className={`gal-stars__star${value <= filters.minRating ? " is-on" : ""}`}
                onClick={() => set({ minRating: filters.minRating === value ? 0 : value })}
                title={`≥ ${value} 星`}
              >
                <IconStar size={14} />
              </button>
            ))}
          </div>
        </div>
        <div className="gal-nav__field">
          <span>生成元数据</span>
          <div className="ui-seg">
            {(
              [
                [undefined, "全部"],
                [true, "有"],
                [false, "无"]
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
              title="没有生成元数据、也还没被模型打标的图"
              onClick={() => set({ hasMetadata: undefined, needsReverse: true })}
            >
              待反推
            </button>
          </div>
        </div>
      </section>

      <section className="gal-nav__section gal-nav__jobs">
        <header className="gal-nav__head">
          <span className="ui-eyebrow">后台任务</span>
          {roots.length ? (
            <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => onRescan()} title="增量扫描全部位置">
              全部扫描
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
              {job.status === "running" || job.status === "queued" ? <div className="gal-job__bar" aria-hidden="true" /> : null}
              <div className="gal-job__text">{jobProgressText(job)}</div>
              {job.progress?.currentPath && job.status === "running" ? (
                <div className="gal-job__path" title={job.progress.currentPath}>
                  {job.progress.currentPath}
                </div>
              ) : null}
              {job.progress?.errors?.length ? (
                <details className="gal-job__errors">
                  <summary>{job.progress.errors.length} 个文件出错</summary>
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
                      <IconPlay size={12} /> 继续
                    </button>
                  ) : (
                    <button type="button" className="ui-btn--sm" onClick={() => onJobAction(job, "pause")}>
                      <IconPause size={12} /> 暂停
                    </button>
                  )}
                  <button type="button" className="ui-btn--sm ui-btn--ghost" onClick={() => onJobAction(job, "cancel")}>
                    <IconClose size={12} /> 取消
                  </button>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="gal-nav__empty">没有任务。</p>
        )}
      </section>
    </aside>
  );
}
