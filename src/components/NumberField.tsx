interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  slider?: boolean
  hint?: string
}

export default function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = 'mm',
  slider = true,
  hint,
}: Props) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <span className="field-row">
        {slider && (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value)))}
          />
        )}
        <span className="numbox">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(3))}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange(clamp(n))
            }}
          />
          <i>{unit}</i>
        </span>
      </span>
    </label>
  )
}
