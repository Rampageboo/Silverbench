type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
};

export function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  disabled = false,
  placeholder
}: NumberFieldProps) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
