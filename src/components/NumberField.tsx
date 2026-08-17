import { useRun } from '../store'
import { UNIT_LABEL, fromMm, stepFor, toMm } from '../lib/units'

interface Props {
  label: string
  /** Always millimetres for a length field, whatever unit is on show. */
  value: number
  /** Hands back millimetres too — the conversion never leaves this component. */
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  /**
   * What the number is. The default, `'mm'`, marks it as a length: it is shown
   * and typed in whichever unit the run is set to, and converted back here.
   * Anything else — degrees, a multiplier, nothing at all — is left alone.
   */
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
  const units = useRun((s) => s.units)
  // Only a length answers to the unit setting; degrees are degrees everywhere.
  const isLength = unit === 'mm'
  const shown = isLength ? units : null

  /** The control's own numbers, in whatever it is showing. */
  const out = (mm: number) => (shown ? fromMm(mm, shown) : mm)
  /** And back to the millimetres the model is kept in, clamped to the field. */
  const back = (v: number) => Math.min(max, Math.max(min, shown ? toMm(v, shown) : v))

  const lo = out(min)
  const hi = out(max)
  const dial = shown ? stepFor(step, shown) : step
  // Inches need finer digits than millimetres to say the same thing.
  const digits = shown === 'in' ? 4 : 3
  const round = (v: number) => Number(v.toFixed(digits))
  // The box reads the value as it stands, even if something else has pushed it
  // past the limits; only the slider, which has nowhere to draw that, clamps.
  const shownValue = round(out(value))
  const dialValue = round(out(Math.min(max, Math.max(min, value))))
  const suffix = isLength ? UNIT_LABEL[units] : unit

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
              min={lo}
              max={hi}
              step={dial}
              value={dialValue}
              disabled={readOnly}
              onChange={(e) => onChange(back(Number(e.target.value)))}
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
            min={lo}
            max={hi}
            step={dial}
            value={shownValue}
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange(back(n))
            }}
          />
          {suffix && <i>{suffix}</i>}
        </span>
      </span>
    </label>
  )
}
