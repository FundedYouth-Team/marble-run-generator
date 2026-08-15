import { useEffect } from 'react'
import { useRun, PART_LABEL, pieceLabel } from '../store'

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 6.5h15M9.5 6.5V4.2h5v2.3" />
      <path d="M6.8 6.5 7.8 20h8.4l1-13.5" />
      <path d="M10.4 10v6.4M13.6 10v6.4" />
    </svg>
  )
}

/**
 * Slide-out list of every part in the run. Each row selects its part, and the
 * name is editable — the part type and its live dimensions stay on the row
 * underneath, so a renamed part is still readable at a glance.
 */
export default function PartsList({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pieces, selectedId, select, renamePiece, removePiece } = useRun()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // Closed, it is only parked off-screen — inert keeps it out of the tab order too.
    <aside className={open ? 'parts-panel open' : 'parts-panel'} inert={!open}>
      <header className="parts-head">
        <h3>Parts List</h3>
        <span className="parts-count">{pieces.length}</span>
        <button className="help-close" onClick={onClose} aria-label="Close parts list">
          ✕
        </button>
      </header>

      <div className="parts-body">
        {pieces.map((p, i) => {
          const on = p.id === selectedId
          const label = pieceLabel(p, i)
          return (
            <div
              key={p.id}
              className={on ? 'part-row on' : 'part-row'}
              onClick={() => select(on ? null : p.id)}
            >
              <span className="tag">{String(i + 1).padStart(2, '0')}</span>
              <div className="part-text">
                <input
                  className="part-name"
                  value={p.name ?? ''}
                  placeholder={label}
                  aria-label={`Name for ${label}`}
                  // The row toggles selection, so typing must not reach it.
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => renamePiece(p.id, e.target.value)}
                />
                <span className="part-dim">
                  {PART_LABEL[p.type]} · {p.length} mm · {p.slope}° slope · {p.turn}° turn
                </span>
              </div>
              <button
                className="part-delete"
                title={`Delete ${label}`}
                aria-label={`Delete ${label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  removePiece(p.id)
                }}
              >
                <TrashIcon />
              </button>
            </div>
          )
        })}
        {!pieces.length && <p className="note">No parts yet — pick one from Part Type in the sidebar.</p>}
      </div>
    </aside>
  )
}
