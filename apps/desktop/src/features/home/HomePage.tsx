import { useEffect } from "react";
import { sameWorkspacePath, workspaceDisplayName } from "../../workspace/layout";
import { useWorkspaceLauncher } from "../../app/shell/WorkspaceLauncher";
import { useWorkspace } from "../../app/useWorkspace";
import { IconChevronRight, IconClose, IconFolder, IconFolderPlus, IconHistory } from "../../ui/icons";
import "./home.css";

type Props = {
  onReady?: () => void;
};

export function HomePage({ onReady }: Props) {
  const { workspaceRoot: currentRoot, setActiveTab } = useWorkspace();
  const launcher = useWorkspaceLauncher();
  const recent = launcher.recent.filter((path) => !sameWorkspacePath(path, currentRoot));

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <div className="ui-page start-page">
      <div className="start">
        <header className="start__hero">
          <img src="/assets/app-icon.svg" width={40} height={40} alt="" />
          <div>
            <h1 className="start__title">RampageWorkbench</h1>
            <p className="start__sub">视觉数据与创作工作台</p>
          </div>
        </header>

        {currentRoot ? (
          <button type="button" className="start__continue" onClick={() => setActiveTab("label")}>
            <span className="ui-eyebrow">Continue</span>
            <span className="start__continue-name">{workspaceDisplayName(currentRoot)}</span>
            <span className="start__continue-path">{currentRoot}</span>
            <IconChevronRight size={18} className="start__continue-chev" />
          </button>
        ) : null}

        <div className="start__actions">
          <button type="button" className="start__action" onClick={() => void launcher.openFolder()}>
            <IconFolder size={20} />
            <span>
              <strong>Open folder</strong>
              <small>Use an existing workspace or dataset folder</small>
            </span>
          </button>
          <button type="button" className="start__action" onClick={launcher.requestCreate}>
            <IconFolderPlus size={20} />
            <span>
              <strong>New workspace</strong>
              <small>Set up folders, task type and classes</small>
            </span>
          </button>
        </div>
        {launcher.error ? <div className="ui-error">{launcher.error}</div> : null}

        <section className="start__recent">
          <div className="ui-eyebrow">Recent</div>
          {recent.length ? (
            <ul>
              {recent.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="start__recent-open"
                    title={path}
                    onClick={() => void launcher.openRecent(path)}
                  >
                    <IconHistory size={15} />
                    <span className="start__recent-name">{workspaceDisplayName(path)}</span>
                    <span className="start__recent-path">{path}</span>
                  </button>
                  <button
                    type="button"
                    className="ui-btn--ghost ui-btn--sm ui-btn--icon start__recent-remove"
                    onClick={() => launcher.removeRecent(path)}
                    title="Remove from recent"
                    aria-label={`Remove ${path} from recent`}
                  >
                    <IconClose size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="start__recent-empty">Workspaces you open will appear here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
