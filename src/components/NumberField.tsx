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
  /** Plain-English captions for the two ends of the slider, e.g. ['Slow', 'Fast']. */
  ends?: [string, string]
  /**
   * A number the part works out for itself — shown so it can be read off, but
   * not a handle on anything, because nothing here is free to set it.
   */
  readOnly?: boolean
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
  ends,
  readOnly = false,
}: Props) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  return (
    <label className={readOnly ? 'field read-only' : 'field'}>
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <span className="field-row">
        {slider && (
          <span className="slider-wrap">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={clamp(value)}
              disabled={readOnly}
              onChange={(e) => onChange(clamp(Number(e.target.value)))}
            />
            {ends && (
              <span className="field-ends">
                <span>{ends[0]}</span>
                <span>{ends[1]}</span>
              </span>
            )}
          </span>
        )}
        <span className="numbox">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(3))}
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange(clamp(n))
            }}
          />
          {unit && <i>{unit}</i>}
        </span>
      </span>
    </label>
  )
}
