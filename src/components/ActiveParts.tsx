import { useState } from 'react'
import { useRun, angleSpec, pieceLabel, pieceTypeLabel, type Piece } from '../store'

/** What the part is, in one line, for the row's tooltip. */
function summarise(p: Piece): string {
  if (p.type !== 'angle') return `${p.length} mm · ${p.slope}° slope · ${p.turn}° turn`
  const a = angleSpec(p)
  return `${a.entry}+${a.exit} mm · ${p.slope}° in, ${p.slope + a.bend}° out · ${
    a.fillet > 0 ? `r${a.fillet} corner` : 'sharp corner'
  }`
}

/** Points down when the list is open, right when it is rolled up. */
function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.9 12S5.4 5.6 12 5.6 22.1 12 22.1 12 18.6 18.4 12 18.4 1.9 12 1.9 12z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.6 4.6 19.4 9.4" />
      <path d="M17 2.2a2.3 2.3 0 0 1 3.3 3.3L7.5 18.3l-4.4 1.1 1.1-4.4z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.6 6.1A9.6 9.6 0 0 1 12 5.8c6.6 0 10.1 6.2 10.1 6.2a17 17 0 0 1-3.4 4" />
      <path d="M6.1 7.9A17.4 17.4 0 0 0 1.9 12S5.4 18.2 12 18.2a9.9 9.9 0 0 0 4.1-.85" />
      <path d="M10 10a2.9 2.9 0 0 0 4.1 4.1" />
      <path d="M3.4 3.4 20.6 20.6" />
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
  const { pieces, selectedId, select, renamePiece, togglePieceHidden, showAllPieces } = useRun()
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
              title={`${renamed ? `${label} — ` : ''}${typeLabel} · ${summarise(p)}`}
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
