import { useEffect, useState } from 'react'

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  /** Quick picks shown as dots; the first one is treated as the default. */
  presets: readonly string[]
  hint?: string
}

const HEX = /^#[0-9a-f]{6}$/i

export default function ColorField({ label, value, onChange, presets, hint }: Props) {
  // The text box holds partial input while typing, so it can't push it upstream.
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = (raw: string) => {
    const hex = raw.startsWith('#') ? raw : `#${raw}`
    if (HEX.test(hex)) onChange(hex.toLowerCase())
    else setDraft(value)
  }

  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <span className="field-row">
        <span className="swatch" style={{ background: value }}>
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
          />
        </span>
        <span className="numbox hexbox">
          <input
            value={draft}
            spellCheck={false}
            maxLength={7}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
          />
        </span>
        <span className="presets">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={`preset ${p.toLowerCase() === value.toLowerCase() ? 'on' : ''}`}
              style={{ background: p }}
              title={p}
              onClick={() => onChange(p)}
            />
          ))}
        </span>
      </span>
    </label>
  )
}
