import { useCallback, useEffect, useState } from "react";
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  openDirectory,
  restoreSnapshot,
  type ExportResult,
  type WorkspaceSnapshot
} from "../../api";
import { NAV_GROUPS, type NavItem } from "../../app/navigation";
import { workspaceDisplayName } from "../../workspace/layout";
import { useWorkspace } from "../../app/useWorkspace";
import { IconChevronRight, IconLayers } from "../../ui/icons";
import { useImagePoolBadge } from "../image-pool/useImagePoolBadge";
import { runExportDatasetJob } from "../inbox/exportJob";
import { errMessage } from "../../lib/errors";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import { activeClfClassDefs, activeDetectClassDefs } from "../workspace/workspaceClassTaxonomy";
import "./library.css";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

const STAGE_COPY: Record<string, string> = {
  data: "Bring images and video frames into the workspace.",
  annotate: "Draw boxes and assign classes, by hand or with a model.",
  curate: "Filter, fix and clean what has been labeled.",
  ship: "Split, merge and write datasets for training.",
  automate: "Author UI maps and decision flows from trained models."
};

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Datasets are products of the workspace: written fresh into exports/dataset on demand. */
function ExportCard({ root }: { root: string }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Partial<ExportResult> | null>(null);
  const [error, setError] = useState("");

  async function exportDataset() {
    setError("");
    setResult(null);
    setProgress({ done: 0, total: 1 });
    try {
      setResult(await runExportDatasetJob(root, { rebuild: true }, (done, total) => setProgress({ done, total })));
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="ui-card ov-versions">
      <div className="ui-card__head">
        <div>
          <div className="ui-card__title">Dataset export</div>
          <div className="ui-field__hint">
            Writes a YOLO detect + classify dataset to exports/dataset from the current labels and classes, decoding
            annotated video timestamps into frames. Edit the workspace, then export again — the export is rebuilt each
            time.
          </div>
        </div>
        <button type="button" onClick={() => void exportDataset()} disabled={progress !== null}>
          {progress ? `Exporting ${progress.done}/${progress.total}…` : "Export dataset"}
        </button>
      </div>
      {result ? (
        <div className="ov-export">
          <span>
            {result.detectImages ?? 0} detect images · {result.clfImages ?? 0} classify images
            {result.videoFrames ? ` (incl. ${result.videoFrames} video frames)` : ""} ·{" "}
            {result.labelsPlaced ?? 0} labels
            {result.skippedRows ? ` · ${result.skippedRows} skipped` : ""}
          </span>
          {result.exportRoot ? (
            <button type="button" className="ui-btn--ghost ui-btn--sm" onClick={() => void openDirectory(result.exportRoot!)}>
              Open folder
            </button>
          ) : null}
          {result.warnings?.length ? (
            <ul className="ov-export__warnings">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="ui-error ov-versions__error">{error}</div> : null}
    </section>
  );
}

/** Annotation snapshots: labels and classes only, so they are cheap to take often. */
function SnapshotsCard({ root }: { root: string }) {
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSnapshots((await listSnapshots(root)).snapshots);
    } catch (err) {
      setError(errMessage(err));
    }
  }, [root]);

  useEffect(() => {
    setSnapshots(null);
    setNotice("");
    void refresh();
  }, [refresh]);

  async function run(action: string, callback: () => Promise<void>) {
    if (busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await callback();
      await refresh();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy("");
    }
  }

  const restore = (id: string) =>
    run(id, async () => {
      if (!window.confirm(`Replace the current labels and classes with ${id}? The current state is snapshotted first.`)) return;
      await restoreSnapshot(root, id);
      // Open editors hold labels in memory; reload so nothing stale is saved over the restored files.
      window.location.reload();
    });

  const remove = (id: string) =>
    run(id, async () => {
      if (!window.confirm(`Delete snapshot ${id}? This cannot be undone.`)) return;
      await deleteSnapshot(root, id);
    });

  const list = snapshots ? [...snapshots].reverse() : [];

  return (
    <section className="ui-card ov-versions">
      <div className="ui-card__head">
        <div>
          <div className="ui-card__title">Snapshots</div>
          <div className="ui-field__hint">
            A snapshot saves the labels and classes (not the media), so it takes a moment and little space.
          </div>
        </div>
      </div>
      <form
        className="ov-versions__new"
        onSubmit={(event) => {
          event.preventDefault();
          void run("create", async () => {
            const created = await createSnapshot(root, note.trim());
            setNote("");
            setNotice(`Saved ${created.created.id}.`);
          });
        }}
      >
        <input
          type="text"
          value={note}
          placeholder="Note (optional), e.g. before relabeling cars"
          onChange={(event) => setNote(event.target.value)}
          disabled={busy !== ""}
        />
        <button type="submit" disabled={busy !== ""}>
          {busy === "create" ? "Saving…" : "Take snapshot"}
        </button>
      </form>
      <div className="ov-versions__list">
        {snapshots === null ? (
          <div className="ov-versions__empty">Loading…</div>
        ) : list.length === 0 ? (
          <div className="ov-versions__empty">No snapshots yet.</div>
        ) : (
          list.map((snapshot) => (
            <div key={snapshot.id} className="ov-version">
              <IconLayers size={15} />
              <strong>{snapshot.id}</strong>
              <span className="ov-version__src">
                {snapshot.note || formatTime(snapshot.createdAt)}
                {snapshot.note ? ` · ${formatTime(snapshot.createdAt)}` : ""} · {snapshot.imageLabels} image labels
                {snapshot.videoLabels ? `, ${snapshot.videoLabels} videos` : ""}
              </span>
              <button
                type="button"
                className="ui-btn--ghost ui-btn--sm"
                onClick={() => void restore(snapshot.id)}
                disabled={busy !== ""}
              >
                {busy === snapshot.id ? "Working…" : "Restore"}
              </button>
              <button
                type="button"
                className="ui-btn--ghost ui-btn--sm"
                onClick={() => void remove(snapshot.id)}
                disabled={busy !== ""}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
      {notice ? <div className="ui-field__hint">{notice}</div> : null}
      {error ? <div className="ui-error ov-versions__error">{error}</div> : null}
    </section>
  );
}

export function LibraryPage({ onReady }: Props) {
  const { workspaceRoot, setActiveTab, setImageWorkspaceTab } = useWorkspace();
  const { imagePoolNewCount } = useImagePoolBadge();
  const { manifest, load } = useWorkspaceClasses(workspaceRoot);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (workspaceRoot.trim()) void load();
  }, [load, workspaceRoot]);

  const detectCount = manifest ? activeDetectClassDefs(manifest).length : null;
  const clfCount = manifest ? activeClfClassDefs(manifest).length : null;

  function go(item: NavItem) {
    if (item.target.imageTab) setImageWorkspaceTab(item.target.imageTab);
    setActiveTab(item.target.tab);
  }

  const stages = NAV_GROUPS.filter((group) => group.id in STAGE_COPY);

  return (
    <div className="ui-page">
      <div className="ui-page__inner ov-page">
        <header className="ov-hero">
          <div className="ui-eyebrow">Workspace</div>
          <h1 className="ov-hero__name">{workspaceDisplayName(workspaceRoot)}</h1>
          <code className="ov-hero__path">{workspaceRoot}</code>
          <div className="ov-hero__stats">
            <button type="button" className="ov-stat" onClick={() => setActiveTab("classes")}>
              <span className="ov-stat__value">{detectCount ?? "—"}</span>
              <span className="ov-stat__label">detection classes</span>
            </button>
            <button type="button" className="ov-stat" onClick={() => setActiveTab("classes")}>
              <span className="ov-stat__value">{clfCount ?? "—"}</span>
              <span className="ov-stat__label">classification classes</span>
            </button>
            <button
              type="button"
              className="ov-stat"
              onClick={() => {
                setImageWorkspaceTab("image-pool");
                setActiveTab("image-pool");
              }}
            >
              <span className="ov-stat__value">{imagePoolNewCount}</span>
              <span className="ov-stat__label">new in image pool</span>
            </button>
          </div>
        </header>

        <section className="ov-pipeline" aria-label="Pipeline">
          {stages.map((group, index) => (
            <div key={group.id} className="ov-stage">
              <div className="ov-stage__head">
                <span className="ov-stage__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="ov-stage__title">{group.label}</span>
              </div>
              <p className="ov-stage__copy">{STAGE_COPY[group.id]}</p>
              <div className="ov-stage__tools">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.id} type="button" className="ov-tool" onClick={() => go(item)}>
                      <Icon size={15} />
                      <span className="ov-tool__label">{item.label}</span>
                      <IconChevronRight size={14} className="ov-tool__chev" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {workspaceRoot ? <ExportCard root={workspaceRoot} /> : null}
        {workspaceRoot ? <SnapshotsCard root={workspaceRoot} /> : null}
      </div>
    </div>
  );
}
