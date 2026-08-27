import { useState } from 'react'
import { EyeIcon, EyeOffIcon, PencilIcon } from './icons'
import {
  useRun,
  angleSpec,
  cornerSpec,
  hookSpec,
  corkscrewSpec,
  funnelSpec,
  funnelDrainVariant,
  degLabel,
  exitSlope,
  pieceLabel,
  pieceTypeLabel,
  variantOf,
  VARIANT_LABEL,
  type Piece,
  type TubeVariant,
} from '../store'
import { formatLength, lengthText, type Unit } from '../lib/units'
import { addsToSelection } from '../lib/shortcuts'

/** What the part is, in one line, for the row's tooltip. */
function summarise(p: Piece, style: TubeVariant, units: Unit): string {
  const tube = VARIANT_LABEL[style]
  const n = (mm: number) => lengthText(mm, units)
  if (p.type === 'angle') {
    const a = angleSpec(p)
    return `${n(a.entry)}+${formatLength(a.exit, units)} · ${degLabel(p.slope)}° in, ${degLabel(
      exitSlope(p),
    )}° out · ${a.fillet > 0 ? `r${n(a.fillet)} corner` : 'sharp corner'} · ${tube}`
  }
  if (p.type === 'corner') {
    const c = cornerSpec(p)
    return `${n(c.entry)}+${formatLength(c.exit, units)} · ${degLabel(c.sweep)}° ${
      c.sweep < 0 ? 'left' : 'right'
    } · ${degLabel(p.slope)}° in, ${degLabel(exitSlope(p))}° out · ${
      c.fillet > 0 ? `r${n(c.fillet)} corner` : 'sharp corner'
    } · ${tube}`
  }
  if (p.type === 'hook') {
    const h = hookSpec(p)
    // Every half turn of roll is flat again; the quarters between are on edge.
    const plane =
      h.roll % 180 === 0
        ? 'flat'
        : h.roll % 180 === 90
          ? `on edge${h.roll < 180 ? '' : ', over the top'}`
          : `${degLabel(h.roll)}° plane`
    return `${degLabel(Math.abs(h.sweep))}° ${h.sweep < 0 ? 'left' : 'right'} ${plane} · r${n(
      h.radius,
    )} · ${degLabel(p.slope)}° in, ${degLabel(exitSlope(p))}° out · ${tube}`
  }
  if (p.type === 'corkscrew') {
    const k = corkscrewSpec(p)
    return `${degLabel(Math.abs(k.turns))} rings${p.ringsSet ? '' : ' (counted)'} ${
      k.turns < 0 ? 'left' : 'right'
    } · Ø${n(
      k.topRadius * 2,
    )} to Ø${n(k.bottomRadius * 2)} · ${formatLength(k.height, units)} down at ${degLabel(
      exitSlope(p),
    )}° · ${tube}`
  }
  if (p.type === 'funnel') {
    const f = funnelSpec(p)
    const feed = f.lead
      ? `${degLabel(Math.abs(f.turns))} round ${f.turns < 0 ? 'left' : 'right'}`
      : 'plain funnel'
    // The feed tube is enclosed whatever the part is cut in, so only the drain
    // is ever worth naming on its own.
    const stubs = p.leadOutVariant
      ? `closed in / ${VARIANT_LABEL[funnelDrainVariant(p, style)]} out`
      : tube
    return `Ø${n(f.mouthRadius * 2)} mouth · ${feed} · ${formatLength(
      f.depth,
      units,
    )} deep · level in, straight down out · ${stubs}`
  }
  return `${formatLength(p.length, units)} · ${degLabel(p.slope)}° slope · ${degLabel(
    p.turn,
  )}° turn · ${tube}`
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
  const {
    pieces,
    variant,
    selectedId,
    selectedIds,
    pickPart,
    renamePiece,
    togglePieceHidden,
    showAllPieces,
    units,
  } = useRun()
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
        {/* A set is easy to lose track of once it is scrolled past, so the header
            says how many are in it. One on its own needs no saying. */}
        {open && selectedIds.length > 1 && (
          <span className="active-parts-picked">{selectedIds.length} picked</span>
        )}
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
          // Every picked row is marked; the one leading the set is marked again,
          // since that is the row the parameters panel is showing.
          if (selectedIds.includes(p.id)) classes.push('on')
          if (p.id === selectedId) classes.push('lead')
          if (!shown) classes.push('off')
          if (editing) classes.push('editing')
          return (
            <div
              key={p.id}
              className={classes.join(' ')}
              title={`${renamed ? `${label} — ` : ''}${typeLabel} · ${summarise(p, variantOf(p, variant), units)}`}
              onClick={(e) => !editing && pickPart(p.id, addsToSelection(e))}
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
