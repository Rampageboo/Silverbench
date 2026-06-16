type FolderPickerRowProps = {
  label: string;
  value: string;
  placeholder?: string;
  browseLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onBrowse: () => void | Promise<void>;
};

export function FolderPickerRow({
  label,
  value,
  placeholder,
  browseLabel = "Browse",
  disabled = false,
  readOnly = true,
  onChange,
  onBrowse
}: FolderPickerRowProps) {
  return (
    <label>
      {label}
      <div className="row">
        <input
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          readOnly={readOnly}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button type="button" onClick={() => void onBrowse()} disabled={disabled}>
          {browseLabel}
        </button>
      </div>
    </label>
  );
}
