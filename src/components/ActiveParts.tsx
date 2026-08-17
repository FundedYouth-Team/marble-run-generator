import { useState } from 'react'
import { EyeIcon, EyeOffIcon, PencilIcon } from './icons'
import {
  useRun,
  angleSpec,
  cornerSpec,
  degLabel,
  exitSlope,
  pieceLabel,
  pieceTypeLabel,
  variantOf,
  VARIANT_LABEL,
  type Piece,
  type TubeVariant,
} from '../store'

/** What the part is, in one line, for the row's tooltip. */
function summarise(p: Piece, style: TubeVariant): string {
  const tube = VARIANT_LABEL[style]
  if (p.type === 'angle') {
    const a = angleSpec(p)
    return `${a.entry}+${a.exit} mm · ${degLabel(p.slope)}° in, ${degLabel(exitSlope(p))}° out · ${
      a.fillet > 0 ? `r${a.fillet} corner` : 'sharp corner'
    } · ${tube}`
  }
  if (p.type === 'corner') {
    const c = cornerSpec(p)
    return `${c.entry}+${c.exit} mm · ${degLabel(c.sweep)}° ${
      c.sweep < 0 ? 'left' : 'right'
    } · ${degLabel(p.slope)}° in, ${degLabel(exitSlope(p))}° out · ${
      c.fillet > 0 ? `r${c.fillet} corner` : 'sharp corner'
    } · ${tube}`
  }
  return `${p.length} mm · ${degLabel(p.slope)}° slope · ${degLabel(p.turn)}° turn · ${tube}`
}

/** Points down when the list is open, right when it is rolled up. */
function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}

/**
 * CAD-style model tree parked in the top-left of both stages: every part in the
 * run, with an eye toggle that takes it out of the 3D viewport and the 2D draft
 * alike — one switch per part, so the two views always show the same set.
 * Switching a part off is display only — the part still shapes the run, so
 * nothing downstream of it moves. The whole
 * tree rolls up to its header, for when the viewport matters more than the list.
 * Rows rename in place (double-click, or the pencil), and a renamed part keeps a
 * tag of what it actually is, so "Big Drop" is still visibly Tube 2.
 */
export default function ActiveParts() {
  const { pieces, variant, selectedId, select, renamePiece, togglePieceHidden, showAllPieces } =
    useRun()
  const [open, setOpen] = useState(true)
  /** Which row is being renamed, and the in-flight text — committed on Enter or blur. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const hiddenCount = pieces.filter((p) => p.hidden).length

  function startEdit(id: string, name?: string) {
    setEditingId(id)
    setDraft(name?.trim() ?? '')
  }

  function commit() {
    if (editingId) renamePiece(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className={open ? 'active-parts' : 'active-parts collapsed'}>
      {/* The whole bar is the hit target; the controls on it stop the bubble. */}
      <header className="active-parts-head" onClick={() => setOpen((v) => !v)}>
        <button
          className="active-parts-toggle"
          aria-expanded={open}
          aria-label={open ? 'Collapse active parts' : 'Expand active parts'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          <ChevronIcon />
        </button>
        <h3>Active Parts</h3>
        {open && hiddenCount > 0 && (
          <button
            className="active-parts-all"
            title={`Show all — ${hiddenCount} part${hiddenCount > 1 ? 's are' : ' is'} hidden`}
            onClick={(e) => {
              e.stopPropagation()
              showAllPieces()
            }}
          >
            show all
          </button>
        )}
        <span className="active-parts-count">{pieces.length}</span>
      </header>

      <div className="active-parts-body" hidden={!open}>
        {pieces.map((p, i) => {
          const typeLabel = pieceTypeLabel(p, i)
          const label = pieceLabel(p, i)
          const renamed = label !== typeLabel
          const editing = p.id === editingId
          const shown = !p.hidden
          const classes = ['active-part']
          if (p.id === selectedId) classes.push('on')
          if (!shown) classes.push('off')
          if (editing) classes.push('editing')
          return (
            <div
              key={p.id}
              className={classes.join(' ')}
              title={`${renamed ? `${label} — ` : ''}${typeLabel} · ${summarise(p, variantOf(p, variant))}`}
              onClick={() => !editing && select(p.id === selectedId ? null : p.id)}
              onDoubleClick={() => startEdit(p.id, p.name)}
            >
              <button
                className="active-part-eye"
                aria-pressed={shown}
                aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
                title={`${shown ? 'Hide' : 'Show'} ${label}`}
                // The row toggles selection, so the eye must not reach it.
                onClick={(e) => {
                  e.stopPropagation()
                  togglePieceHidden(p.id)
                }}
              >
                {shown ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              {editing ? (
                <input
                  className="active-part-input"
                  autoFocus
                  value={draft}
                  placeholder={typeLabel}
                  aria-label={`Rename ${typeLabel}`}
                  maxLength={40}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    // Enter keeps the edit, Escape drops it; neither reaches the viewport.
                    e.stopPropagation()
                    if (e.key === 'Enter') e.currentTarget.blur()
                    else if (e.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <>
                  <span className="active-part-name">{label}</span>
                  {/* A renamed part still says what it is, and where it sits in the run. */}
                  {renamed && <span className="active-part-type">{typeLabel}</span>}
                  <button
                    className="active-part-rename"
                    aria-label={`Rename ${label}`}
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(p.id, p.name)
                    }}
                  >
                    <PencilIcon />
                  </button>
                </>
              )}
            </div>
          )
        })}
        {!pieces.length && <p className="active-parts-empty">No parts yet</p>}
      </div>
    </div>
  )
}
