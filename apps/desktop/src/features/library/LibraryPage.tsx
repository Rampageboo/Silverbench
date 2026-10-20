import { useEffect, useState } from "react";
import { NAV_GROUPS, type NavItem } from "../../app/navigation";
import { workspaceDisplayName } from "../../app/recentWorkspaces";
import { useWorkspace } from "../../app/useWorkspace";
import { IconChevronRight, IconLayers } from "../../ui/icons";
import { useImagePoolBadge } from "../image-pool/useImagePoolBadge";
import {
  createSnapshotVersion,
  initializeSnapshotVersioning,
  setActiveSnapshotVersion
} from "../workspace-versioning/workspaceSnapshotVersionApi";
import {
  listSnapshotVersions,
  nextSnapshotVersionId,
  type WorkspaceVersionId
} from "../workspace-versioning/workspaceSnapshotVersions";
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

function WorkspaceVersionsCard() {
  const { workspaceRoot, workspaceRootPath, activeVersionId, snapshotVersions, openWorkspacePath } =
    useWorkspace();
  const [busy, setBusy] = useState<"" | "init" | "create" | WorkspaceVersionId>("");
  const [error, setError] = useState("");
  const root = (workspaceRootPath || workspaceRoot).trim();
  const versions = snapshotVersions ? listSnapshotVersions(snapshotVersions) : [];
  const activeVersion = activeVersionId || snapshotVersions?.activeVersion || null;
  const nextVersion = snapshotVersions ? nextSnapshotVersionId(snapshotVersions) : "V1";

  async function run(action: "init" | "create" | WorkspaceVersionId, callback: () => Promise<void>) {
    if (!root || busy) return;
    setBusy(action);
    setError("");
    try {
      await callback();
      await openWorkspacePath(root);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="ui-card ov-versions">
      <div className="ui-card__head">
        <div>
          <div className="ui-card__title">Versions</div>
          <div className="ui-field__hint">
            Each version is a full copy of the workspace. Copying takes time and disk space.
          </div>
        </div>
        {snapshotVersions ? (
          <button
            type="button"
            onClick={() =>
              activeVersion &&
              void run("create", () => createSnapshotVersion(root, activeVersion).then(() => {}))
            }
            disabled={!activeVersion || busy !== ""}
          >
            {busy === "create" ? "Copying…" : `Branch ${nextVersion} from ${activeVersion}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run("init", () => initializeSnapshotVersioning(root).then(() => {}))}
            disabled={!root || busy !== ""}
          >
            {busy === "init" ? "Initializing…" : "Enable versioning"}
          </button>
        )}
      </div>
      <div className="ov-versions__list">
        {snapshotVersions ? (
          versions.map((version) => {
            const isActive = version.id === activeVersion;
            return (
              <div key={version.id} className={`ov-version${isActive ? " is-active" : ""}`}>
                <IconLayers size={15} />
                <strong>{version.id}</strong>
                <span className="ov-version__src">{version.source || "snapshot"}</span>
                {isActive ? (
                  <span className="ui-badge ui-badge--accent">Active</span>
                ) : (
                  <button
                    type="button"
                    className="ui-btn--ghost ui-btn--sm"
                    onClick={() =>
                      void run(version.id, () => setActiveSnapshotVersion(root, version.id).then(() => {}))
                    }
                    disabled={busy !== ""}
                  >
                    {busy === version.id ? "Switching…" : "Switch"}
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className="ov-versions__empty">
            Not versioned yet. Enabling versioning creates V1 as a full copy of the current workspace.
          </div>
        )}
      </div>
      {error ? <div className="ui-error ov-versions__error">{error}</div> : null}
    </section>
  );
}

export function LibraryPage({ onReady }: Props) {
  const { workspaceRoot, workspaceRootPath, activeVersionId, setActiveTab, setImageWorkspaceTab } =
    useWorkspace();
  const { imagePoolNewCount } = useImagePoolBadge();
  const { manifest, load } = useWorkspaceClasses(workspaceRoot);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (workspaceRoot.trim()) void load();
  }, [load, workspaceRoot]);

  const root = (workspaceRootPath || workspaceRoot).trim();
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
          <div className="ui-eyebrow">Workspace{activeVersionId ? ` · ${activeVersionId}` : ""}</div>
          <h1 className="ov-hero__name">{workspaceDisplayName(root)}</h1>
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

        <WorkspaceVersionsCard />
      </div>
    </div>
  );
}
