import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./boxLabel.css";

export type ShortcutDropdownOption = {
  value: string;
  label: string;
  searchText?: string;
  selected?: boolean;
};

function normalizeSearch(value: string) {
  return String(value || "").trim().toLowerCase();
}

function searchTerms(query: string) {
  return normalizeSearch(query).split(" ").filter(Boolean);
}

type BoxLabelShortcutDropdownProps = {
  label: string;
  title: string;
  options: ShortcutDropdownOption[];
  className?: string;
  active?: boolean;
  recording?: boolean;
  onSelect: (value: string) => void;
};

export function BoxLabelShortcutDropdown({
  label,
  title,
  options,
  className = "",
  active = false,
  recording = false,
  onSelect
}: BoxLabelShortcutDropdownProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const terms = searchTerms(query);
  const filtered = options.filter((option) => {
    if (!terms.length) return true;
    const text = normalizeSearch(option.searchText || option.label);
    return terms.every((term) => text.includes(term));
  });

  useLayoutEffect(() => {
    if (!open || !inputRef.current || !menuRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 230);
    const maxHeight = Math.min(310, Math.max(120, window.innerHeight - rect.bottom - 12));
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      top: rect.bottom + 4,
      width,
      maxHeight,
      zIndex: 2147483000
    });
  }, [open, query, options.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`pool-label-shortcut-dropdown${open ? " open" : ""}${active ? " active" : ""}${recording ? " recording" : ""} ${className}`.trim()}
    >
      <input
        ref={inputRef}
        type="search"
        className="pool-label-shortcut-button"
        title={title}
        aria-label={title}
        value={open ? query : label}
        data-label={label}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          requestAnimationFrame(() => inputRef.current?.select());
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open
        ? createPortal(
            <div ref={menuRef} className="pool-label-shortcut-menu open" style={menuStyle}>
              {filtered.length ? (
                filtered.map((option) => (
                  <button
                    key={`${option.value}-${option.label}`}
                    type="button"
                    className={`pool-label-shortcut-option${option.selected ? " selected" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      setQuery("");
                      onSelect(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))
              ) : (
                <div className="pool-label-shortcut-empty">No matching classes</div>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
