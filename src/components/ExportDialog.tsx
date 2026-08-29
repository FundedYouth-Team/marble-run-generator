import { useEffect, useMemo, useState } from 'react'
import { buildAssembly } from '../lib/layout'
import {
  EXPORT_TYPES,
  FALLBACK_FORMAT,
  FORMATS,
  exportAssembly,
  exportPiece,
  exportPrintPlate,
  exportStem,
  formatBytes,
  formatCarries,
  type ExportResult,
  type ExportType,
} from '../lib/exporters'
import { useRun, tubeSpec, projectSlug, exportBasename } from '../store'
import HoverHint from './HoverHint'

/**
 * Everything that writes a printable file, in a window of its own.
 *
 * It used to be the last panel in Settings, which put the exports behind a
 * scroll and a fold in a column that is otherwise about how the run is built.
 * Exporting is the end of a session rather than part of designing one, so it is
 * opened from the top bar's Export button and closed again when it is done.
 *
 * The window asks in the order the answers depend on each other: what to write
 * first, then what to write it as — because the format is the choice the type
 * can rule out, not the other way round. A format that cannot carry the chosen
 * type is greyed where it stands rather than hidden, so the reason it is out is
 * readable instead of the choice simply going missing.
 *
 * Every option says what it does on hover — the paragraph under a control is
 * read once, the hint is there every time — and a greyed-out one says why it is
 * greyed out.
 *
 * Mounted only while it is open, which is also what clears the last file it
 * wrote: closing the window and opening it again is a fresh start, and it costs
 * nothing to lay the run out for a plate while nobody is asking for one.
 */
export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const {
    pieces,
    innerDiameter,
    wallThickness,
    variant,
    openSide,
    selectedId,
    exportFormat,
    setExportFormat,
    projectName,
    exportName,
    setExportName,
  } = useRun()
  const spec = useMemo(
    () => tubeSpec(innerDiameter, wallThickness, variant, openSide),
    [innerDiameter, wallThickness, variant, openSide],
  )
  const asm = useMemo(() => buildAssembly(pieces), [pieces])
  const [type, setType] = useState<ExportType>('parts')
  const [last, setLast] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The type is the choice that stands; a format left over from last time that
  // cannot carry it steps aside rather than being written and quietly wrong.
  useEffect(() => {
    if (!formatCarries(exportFormat, type)) setExportFormat(FALLBACK_FORMAT)
  }, [type, exportFormat, setExportFormat])

  const selectedIndex = pieces.findIndex((p) => p.id === selectedId)
  const empty = pieces.length === 0
  const formatNote = FORMATS.find((f) => f.id === exportFormat)?.note
  const typeNote = EXPORT_TYPES.find((t) => t.id === type)?.note
  const typeLabel = EXPORT_TYPES.find((t) => t.id === type)?.label ?? ''

  // What stops this export, if anything does — the one sentence the greyed-out
  // button and the missing file name both answer to.
  const blocked =
    type === 'piece'
      ? selectedIndex < 0
        ? 'No part is selected — click a part on the stage, then come back.'
        : null
      : empty
        ? 'Nothing to write yet — add a part to the run first.'
        : null

  // The project name is the standing default; typing here overrides it until cleared.
  const fromProject = projectSlug(projectName)
  const basename = exportBasename({ projectName, exportName })
  // A single part is named after its own length, so until one is picked there is
  // no file name to show — everything else can be named before it is written.
  const filename =
    type === 'piece' && selectedIndex < 0
      ? null
      : `${exportStem(basename, type, {
          count: pieces.length,
          piece: pieces[selectedIndex],
          index: selectedIndex,
        })}.${exportFormat}`

  const write = () => {
    if (blocked) return
    try {
      setError(null)
      setLast(
        type === 'assembly'
          ? exportAssembly(spec, asm.placed, exportFormat, basename)
          : type === 'piece'
            ? exportPiece(spec, pieces[selectedIndex], selectedIndex, exportFormat, basename)
            : exportPrintPlate(spec, asm.placed, exportFormat, basename),
      )
    } catch (e) {
      setLast(null)
      setError(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-sheet export-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="help-head">
          <h3>Export</h3>
          <button className="help-close" onClick={onClose} aria-label="Close export">
            ✕
          </button>
        </header>

        <div className="help-body export-body">
          <div>
            <span className="field-label">Type</span>
            <div className="segmented">
              {EXPORT_TYPES.map((t) => (
                <HoverHint key={t.id} label={t.label} hint={t.note}>
                  <button className={type === t.id ? 'on' : ''} onClick={() => setType(t.id)}>
                    {t.label}
                  </button>
                </HoverHint>
              ))}
            </div>
            <p className="note">{typeNote}</p>
          </div>

          <div>
            <span className="field-label">File format</span>
            <div className="segmented">
              {FORMATS.map((f) => {
                const carries = formatCarries(f.id, type)
                return (
                  <HoverHint
                    key={f.id}
                    label={f.label}
                    hint={
                      carries
                        ? f.note
                        : `${f.label} keeps no boundary between one object and the next, so ${typeLabel} would arrive welded into a single shell. Pick 3MF or OBJ for that, or export the Assembly or a Selected Part instead.`
                    }
                  >
                    <button
                      className={exportFormat === f.id ? 'on' : ''}
                      disabled={!carries}
                      onClick={() => setExportFormat(f.id)}
                    >
                      {f.label}
                    </button>
                  </HoverHint>
                )
              })}
            </div>
            <p className="note">{formatNote}</p>
          </div>

          <label className="field">
            <span className="field-label">
              File name
              <em>from the project name</em>
            </span>
            <input
              className="text-field"
              type="text"
              value={exportName}
              placeholder={fromProject}
              maxLength={60}
              aria-label="Export file name"
              onChange={(e) => setExportName(e.target.value)}
            />
          </label>
          <p className="note">
            {filename ? (
              <>
                Writes <b>{filename}</b> — each export adds what it is to the name.
              </>
            ) : (
              <>Each export adds what it is to the name, a single part its own length.</>
            )}{' '}
            Leave this blank to follow the project name. 1 unit = 1 mm, Z up, whichever unit you
            design in.
          </p>

          <HoverHint
            className="export-go"
            label={`Export ${typeLabel}`}
            hint={blocked ?? `Writes ${filename} to your downloads. ${typeNote}`}
          >
            <button className="primary" disabled={blocked !== null} onClick={write}>
              ⤓ Export {typeLabel}
            </button>
          </HoverHint>

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
        </div>
      </div>
    </div>
  )
}
