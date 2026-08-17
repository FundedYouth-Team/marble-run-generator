import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EyeOffIcon, MoveIcon, PencilIcon, PickIcon, RotateIcon, TrashIcon } from './icons'
import { useRun, pieceLabel, pieceTypeLabel, type Tool } from '../store'

/** Kept this far off the stage edges, so a menu opened in a corner still fits. */
const EDGE_PAD = 8

/** Where the menu was asked for: which part, and the point on the stage. */
export interface MenuTarget {
  pieceId: string
  /** Stage-relative, so the menu positions inside the stage no matter where it scrolls. */
  x: number
  y: number
}

/**
 * The right-click menu for a part in the 3D viewport: the handful of things you
 * reach for with a part already under the cursor, without crossing the screen to
 * the model tree or the right-hand panels. Rename happens in place here rather
 * than sending you to the tree, so the menu is never just a set of shortcuts to
 * somewhere else.
 *
 * Opened by Scene3D, which decides what counts as a click — a right-drag is an
 * orbit, and must not leave a menu behind.
 */
export default function PartContextMenu({
  target,
  onClose,
}: {
  target: MenuTarget
  onClose: () => void
}) {
  const { pieces, selectedId, select, tool, setTool, togglePieceHidden, renamePiece, removePiece } =
    useRun()
  const ref = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [pos, setPos] = useState({ x: target.x, y: target.y })

  const index = pieces.findIndex((p) => p.id === target.pieceId)
  const piece = index < 0 ? null : pieces[index]
  // The rename in flight has to survive the menu being dismissed from outside,
  // where the handler closes over its own render's state.
  const live = useRef({ renaming, draft })
  live.current = { renaming, draft }

  const commit = () => {
    if (live.current.renaming) renamePiece(target.pieceId, live.current.draft)
  }

  // Undone by the time it opens: the part it named has been deleted from under it.
  useEffect(() => {
    if (!piece) onClose()
  }, [piece, onClose])

  // Laid out before paint, so a menu near an edge never flashes at the point it
  // was asked for and then jumps. Re-run on the rename swap, which changes the height.
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.offsetParent as HTMLElement | null
    if (!el || !host) return
    const maxX = host.clientWidth - el.offsetWidth - EDGE_PAD
    const maxY = host.clientHeight - el.offsetHeight - EDGE_PAD
    setPos({
      x: Math.max(EDGE_PAD, Math.min(target.x, maxX)),
      y: Math.max(EDGE_PAD, Math.min(target.y, maxY)),
    })
  }, [target.x, target.y, renaming])

  // Anything that is not the menu dismisses it: a click elsewhere, a zoom, Escape.
  // A rename in flight is kept on the way out, the way the model tree's is on blur.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      commit()
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape out of the rename first — the menu itself is the second press.
      if (live.current.renaming) setRenaming(false)
      else onClose()
    }
    const zoom = () => {
      commit()
      onClose()
    }
    // Capture, so a press that lands on another part closes this menu before that
    // part gets a chance to open its own.
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key)
    window.addEventListener('wheel', zoom, { passive: true })
    window.addEventListener('resize', zoom)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('wheel', zoom)
      window.removeEventListener('resize', zoom)
    }
    // Mount-time only: the handlers read the live rename through the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  if (!piece) return null

  const typeLabel = pieceTypeLabel(piece, index)
  const label = pieceLabel(piece, index)
  const picked = piece.id === selectedId

  /** Every item does its one thing and gets out of the way. */
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  /**
   * Takes up a handle tool on this part, which is the pair of steps the toolbar
   * leaves to you: the part has to be picked before its handles are on stage, and
   * the part under the cursor is the one you meant. Pressing the tool already in
   * hand puts it back down, the way the toolbar buttons do — so the menu is also
   * the way back to plain picking, without a Select-tool item of its own.
   */
  const hold = (next: Tool) =>
    run(() => {
      if (picked && tool === next) {
        setTool('select')
        return
      }
      select(piece.id)
      setTool(next)
    })

  return (
    <div
      ref={ref}
      className="part-menu"
      role="menu"
      aria-label={`${label} actions`}
      style={{ left: pos.x, top: pos.y }}
      // A right-click on the menu is not a fresh ask for the menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="part-menu-head">
        <span className="part-menu-name">{label}</span>
        {label !== typeLabel && <span className="part-menu-type">{typeLabel}</span>}
      </div>

      {renaming ? (
        <div className="part-menu-rename">
          <input
            autoFocus
            value={draft}
            placeholder={typeLabel}
            aria-label={`Rename ${typeLabel}`}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Neither key is the viewport's to hear.
              e.stopPropagation()
              if (e.key === 'Enter') {
                renamePiece(target.pieceId, draft)
                setRenaming(false)
                onClose()
              } else if (e.key === 'Escape') {
                setRenaming(false)
              }
            }}
          />
          <p className="part-menu-hint">Enter to keep · Esc to drop · blank for the default name</p>
        </div>
      ) : (
        <>
          <button role="menuitem" onClick={run(() => select(picked ? null : piece.id))}>
            <PickIcon />
            {picked ? 'Deselect' : 'Select'}
          </button>
          <button
            className={picked && tool === 'move' ? 'on' : ''}
            role="menuitemcheckbox"
            aria-checked={picked && tool === 'move'}
            title="Pick this part and take up the arrows that move its run"
            onClick={hold('move')}
          >
            <MoveIcon size={14} />
            Move
          </button>
          <button
            className={picked && tool === 'rotate' ? 'on' : ''}
            role="menuitemcheckbox"
            aria-checked={picked && tool === 'rotate'}
            title="Pick this part and take up the ring that turns its run about the upright"
            onClick={hold('rotate')}
          >
            <RotateIcon size={14} />
            Rotate
          </button>

          <div className="part-menu-sep" role="separator" />

          <button role="menuitem" onClick={run(() => togglePieceHidden(piece.id))}>
            <EyeOffIcon />
            Hide
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDraft(piece.name?.trim() ?? '')
              setRenaming(true)
            }}
          >
            <PencilIcon size={14} />
            Rename
          </button>
          <button className="danger" role="menuitem" onClick={run(() => removePiece(piece.id))}>
            <TrashIcon />
            Delete
          </button>
        </>
      )}
    </div>
  )
}
