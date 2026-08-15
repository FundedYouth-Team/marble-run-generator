import { useMemo, useState } from 'react'
import { buildAssembly } from '../lib/layout'
import {
  FORMATS,
  exportAssembly,
  exportPiece,
  exportPrintPlate,
  formatBytes,
  type ExportResult,
} from '../lib/exporters'
import { useRun, tubeSpec } from '../store'

export default function ExportPanel() {
  const { pieces, innerDiameter, wallThickness, variant, selectedId, exportFormat, setExportFormat } =
    useRun()
  const spec = useMemo(
    () => tubeSpec(innerDiameter, wallThickness, variant),
    [innerDiameter, wallThickness, variant],
  )
  const asm = useMemo(() => buildAssembly(pieces), [pieces])
  const [last, setLast] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedIndex = pieces.findIndex((p) => p.id === selectedId)
  const empty = pieces.length === 0
  const formatNote = FORMATS.find((f) => f.id === exportFormat)?.note

  const run = (fn: () => ExportResult) => {
    try {
      setError(null)
      setLast(fn())
    } catch (e) {
      setLast(null)
      setError(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <section className="panel">
      <h2>Export</h2>

      <span className="field-label">Format</span>
      <div className="segmented">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className={exportFormat === f.id ? 'on' : ''}
            onClick={() => setExportFormat(f.id)}
            title={f.note}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="note">{formatNote}</p>

      <div className="export-btns">
        <button
          className="primary"
          disabled={empty}
          onClick={() => run(() => exportPrintPlate(spec, asm.placed, exportFormat))}
        >
          ⤓ Print plate
        </button>
        <button
          disabled={empty}
          onClick={() => run(() => exportAssembly(spec, asm.placed, exportFormat))}
        >
          ⤓ Assembly
        </button>
        <button
          disabled={selectedIndex < 0}
          onClick={() =>
            run(() => exportPiece(spec, pieces[selectedIndex].length, selectedIndex, exportFormat))
          }
        >
          ⤓ Selected piece
        </button>
      </div>

      <p className="note">
        <b>Print plate</b> lays every piece flat and separated, opening upward — no supports
        needed for the Half and 3/4 variants. <b>Assembly</b> exports the run as designed, for
        checking fit rather than printing. 1 unit = 1 mm, Z up.
      </p>

      {last && (
        <p className="export-status">
          <b>{last.filename}</b>
          <span>
            {last.parts} part{last.parts === 1 ? '' : 's'}
            {last.instanced !== undefined && last.instanced < last.parts
              ? ` (${last.instanced} instanced)`
              : ''}{' '}
            · {last.triangles.toLocaleString()} triangles · {formatBytes(last.bytes)}
          </span>
        </p>
      )}
      {error && <p className="warn">{error}</p>}
    </section>
  )
}
