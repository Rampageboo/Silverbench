import { useCallback, useRef, useState } from "react";
import { IconChevronDown, IconFolder, IconFolderPlus, IconHistory } from "../../ui/icons";
import { useDismiss } from "../../ui/useDismiss";
import { sameWorkspacePath, workspaceDisplayName } from "../../workspace/layout";
import { useWorkspace } from "../useWorkspace";
import { useWorkspaceLauncher } from "./WorkspaceLauncher";

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspaceRoot: root } = useWorkspace();
  const launcher = useWorkspaceLauncher();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [triggerRef, menuRef], close);

  const name = root ? workspaceDisplayName(root) : "No workspace";
  const otherRecent = launcher.recent.filter((path) => !sameWorkspacePath(path, root)).slice(0, 5);

  function run(action: () => void | Promise<void>) {
    setOpen(false);
    void action();
  }

  return (
    <div className="shell-ws">
      <button
        ref={triggerRef}
        type="button"
        className={`shell-ws__trigger${root ? "" : " is-empty"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={root || "Open a workspace"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="shell-ws__monogram" aria-hidden="true">
          {root ? name.slice(0, 2).toUpperCase() : "—"}
        </span>
        {collapsed ? null : (
          <>
            <span className="shell-ws__text">
              <span className="shell-ws__name">{name}</span>
              <span className="shell-ws__path">{root || "Open or create a workspace"}</span>
            </span>
            <IconChevronDown size={14} className="shell-ws__chev" />
          </>
        )}
      </button>

      {open ? (
        <div ref={menuRef} className="ui-menu shell-ws__menu" role="menu">
          {root ? (
            <>
              <div className="ui-menu__label ui-eyebrow">Current</div>
              <div className="shell-ws__current">
                <strong>{name}</strong>
                <span>{root}</span>
              </div>
            </>
          ) : null}

          <div className="ui-menu__sep" />
          <button
            type="button"
            role="menuitem"
            className="ui-menu__item"
            onClick={() => run(launcher.openFolder)}
          >
            <IconFolder />
            <span>Open folder…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ui-menu__item"
            onClick={() => run(launcher.requestCreate)}
          >
            <IconFolderPlus />
            <span>New workspace…</span>
          </button>

          {otherRecent.length ? (
            <>
              <div className="ui-menu__sep" />
              <div className="ui-menu__label ui-eyebrow">Recent</div>
              {otherRecent.map((path) => (
                <button
                  key={path}
                  type="button"
                  role="menuitem"
                  className="ui-menu__item"
                  title={path}
                  onClick={() => run(() => launcher.openRecent(path))}
                >
                  <IconHistory />
                  <span className="ui-menu__item-text">
                    <span>{workspaceDisplayName(path)}</span>
                    <span className="ui-menu__item-sub">{path}</span>
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
