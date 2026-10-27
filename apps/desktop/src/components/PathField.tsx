import { useState, type ReactNode } from "react";
import { chooseDirectory, chooseFile, type FileFilter } from "../lib/tauri";
import { IconFolder } from "../ui/icons";

type PathFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Pick a folder (default) or a single file. */
  kind?: "folder" | "file";
  filters?: FileFilter[];
  placeholder?: string;
  hint?: ReactNode;
  /** Shown under the field, e.g. a validation result for the current path. */
  status?: ReactNode;
  disabled?: boolean;
};

/**
 * An absolute path with a Browse button. Typing stays possible (network shares,
 * pasting), but browsing is the normal way in: these paths differ per computer.
 */
export function PathField({
  label,
  value,
  onChange,
  kind = "folder",
  filters,
  placeholder,
  hint,
  status,
  disabled
}: PathFieldProps) {
  const [picking, setPicking] = useState(false);

  async function browse() {
    setPicking(true);
    try {
      const picked = kind === "folder" ? await chooseDirectory(label) : await chooseFile(label, filters);
      if (picked) onChange(picked);
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}</span>
      <div className="ui-input-row">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? (kind === "folder" ? "D:\\Folder" : "D:\\Folder\\file")}
          spellCheck={false}
          disabled={disabled}
        />
        <button type="button" onClick={() => void browse()} disabled={disabled || picking}>
          <IconFolder size={14} /> {picking ? "Choosing…" : "Browse…"}
        </button>
      </div>
      {status}
      {hint ? <span className="ui-field__hint">{hint}</span> : null}
    </div>
  );
}
