import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconChevronRight, IconSearch } from "../../ui/icons";

export type PaletteCommand = {
  id: string;
  section: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon?: ReactNode;
  disabled?: boolean;
  run: () => void;
};

type Props = {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
};

/** Every query word must appear in label, hint, section or keywords. */
export function filterPaletteCommands(commands: PaletteCommand[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((command) => {
    const haystack =
      `${command.label} ${command.hint ?? ""} ${command.section} ${command.keywords ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => filterPaletteCommands(commands, query).filter((command) => !command.disabled),
    [commands, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  function runAt(index: number) {
    const command = results[index];
    if (!command) return;
    onClose();
    command.run();
  }

  let lastSection = "";

  return (
    <div className="ui-dialog-scrim shell-palette-scrim" onPointerDown={onClose}>
      <div
        className="shell-palette"
        role="dialog"
        aria-label="Command palette"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((value) => Math.min(results.length - 1, value + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((value) => Math.max(0, value - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            runAt(cursor);
          }
          // Keep tool shortcuts (A/D, digits…) from firing underneath.
          event.stopPropagation();
        }}
      >
        <div className="shell-palette__input">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Go to a tool or run an action…"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search commands"
            aria-activedescendant={results[cursor] ? `palette-${results[cursor].id}` : undefined}
          />
          <kbd className="ui-kbd">Esc</kbd>
        </div>
        <div ref={listRef} className="shell-palette__list" role="listbox">
          {results.length ? (
            results.map((command, index) => {
              const header = command.section !== lastSection ? command.section : null;
              lastSection = command.section;
              return (
                <div key={command.id}>
                  {header ? <div className="shell-palette__section ui-eyebrow">{header}</div> : null}
                  <button
                    id={`palette-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === cursor}
                    data-index={index}
                    data-active={index === cursor}
                    className="ui-menu__item shell-palette__item"
                    onPointerMove={() => setCursor(index)}
                    onClick={() => runAt(index)}
                  >
                    {command.icon ?? <IconChevronRight />}
                    <span className="ui-menu__item-text">
                      <span>{command.label}</span>
                    </span>
                    {command.hint ? <span className="ui-menu__item-sub">{command.hint}</span> : null}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="shell-palette__empty">No matches for “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
