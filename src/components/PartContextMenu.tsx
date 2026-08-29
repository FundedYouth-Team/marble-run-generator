import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DropToPlaneIcon,
  DuplicateIcon,
  DuplicateJoinIcon,
  EyeOffIcon,
  MoveIcon,
  PencilIcon,
  PickIcon,
  RotateIcon,
  TrashIcon,
} from './icons'
import { formatShortcut } from '../lib/shortcuts'
import { useRun, isStructure, pieceLabel, pieceTypeLabel, type Tool } from '../store'

/** Kept this far off the stage edges, so a menu opened in a corner still fits. */
const EDGE_PAD = 8

/** Where the menu was asked for: which part, and the point on the stage. */
export interface MenuTarget {
  pieceId: string
  /** Stage-relative, so the menu positions inside the stage no matter where it scrolls. */
  x: number
  y: number
}

/** One thing the menu can do to the part it was opened on. */
export type MenuAction =
  | 'select'
  | 'move'
  | 'rotate'
  | 'drop'
  | 'hide'
  | 'rename'
  | 'duplicate'
  | 'duplicateJoined'
  | 'delete'

/**
 * What the 3D stage offers, which is everything: it has the handles the move and
 * rotate items take up, the workplane the drop item sets a run down on, and the
 * model tree the rename mirrors.
 */
const STAGE_ACTIONS: MenuAction[] = [
  'select',
  'move',
  'rotate',
  'drop',
  'hide',
  'rename',
  'duplicate',
  'duplicateJoined',
  'delete',
]

/** The items above the rule, so a view that offers neither group skips the rule. */
const UPPER: MenuAction[] = ['select', 'move', 'rotate', 'drop']

/**
 * The right-click menu for a part in the 3D viewport: the handful of things you
 * reach for with a part already under the cursor, without crossing the screen to
 * the model tree or the right-hand panels. Rename happens in place here rather
 * than sending you to the tree, so the menu is never just a set of shortcuts to
 * somewhere else.
 *
 * Opened by Scene3D, which decides what counts as a click — a right-drag is an
 * orbit, and must not leave a menu behind — and by the assembly draft, which
 * makes the same call about a right-drag that pans. The draft has no handles to
 * take up and no ring to turn, so it asks for the shorter list through `actions`
 * rather than showing items that would do nothing on flat paper.
 */
export default function PartContextMenu({
  target,
  actions = STAGE_ACTIONS,
  onClose,
}: {
  target: MenuTarget
  actions?: MenuAction[]
  onClose: () => void
}) {
  const {
    pieces,
    selectedId,
    selectedIds,
    select,
    toggleSelect,
    leadPart,
    tool,
    toolScope,
    setTool,
    dropToWorkplane,
    togglePieceHidden,
    renamePiece,
    duplicateParts,
    removeParts,
    shortcuts,
  } = useRun()
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
  /**
   * What the items that take a whole set act on: the selection when the part
   * under the cursor is in it, and that part alone when it is not — a right-click
   * out on its own is about the part it landed on, not about a set picked
   * somewhere else.
   */
  const inSet = selectedIds.includes(piece.id)
  const set = inSet ? selectedIds : [piece.id]
  const setLabel = set.length > 1 ? `${set.length} parts` : label

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
   *
   * A part already in a set only takes the lead, keeping the set: the handles
   * move and turn everything picked, so picking this one alone would quietly
   * drop the rest of what the drag was meant to take.
   */
  /**
   * Whether the item is the state the stage is actually in: this part in hand,
   * with that tool, reaching no further than what is picked. A handle spread
   * across the whole stage is a different thing from the one the item offers, so
   * the item is not ticked for it.
   */
  const held = (t: Tool) => picked && tool === t && toolScope === 'selected'

  const hold = (next: Tool) =>
    run(() => {
      // A handle reaching across the whole stage is not the one this item is
      // offering, so taking it up on a part brings it back to that part rather
      // than putting the tool down — the tool is the same, the reach is not.
      if (held(next)) {
        setTool('select')
        return
      }
      leadPart(piece.id)
      setTool(next)
    })

  /**
   * What this part actually offers. Structure is on the workplane by definition,
   * so there is nothing to drop it onto; and it has no ends, so there is no run
   * end for a joined copy to land on. Both items would sit there doing nothing.
   */
  const offered = isStructure(piece)
    ? actions.filter((a) => a !== 'drop' && a !== 'duplicateJoined')
    : actions
  const has = (a: MenuAction) => offered.includes(a)
  // A rule between two groups only, never one left hanging at an end.
  const ruled = UPPER.some(has) && offered.some((a) => !UPPER.includes(a))

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
          {has('select') && (
            <button
              role="menuitem"
              // In the set, the item takes this one part back out of it and
              // leaves the rest picked; outside it, it picks this part alone.
              onClick={run(() => (inSet ? toggleSelect(piece.id) : select(piece.id)))}
            >
              <PickIcon />
              {inSet ? 'Deselect' : 'Select'}
            </button>
          )}
          {has('move') && (
            <button
              className={held('move') ? 'on' : ''}
              role="menuitemcheckbox"
              aria-checked={held('move')}
              title={`Pick this part and take up the arrows that move ${set.length > 1 ? 'every run picked' : 'its run'}`}
              onClick={hold('move')}
            >
              <MoveIcon size={14} />
              Move
            </button>
          )}
          {has('rotate') && (
            <button
              className={held('rotate') ? 'on' : ''}
              role="menuitemcheckbox"
              aria-checked={held('rotate')}
              title={
                piece.joined && index > 0
                  ? 'Pick this part and take up the three rings that aim it — the run bends here, holding everything ahead of it still'
                  : `Pick this part and take up the rings that turn ${set.length > 1 ? 'every run picked, about this one' : 'its run'}`
              }
              onClick={hold('rotate')}
            >
              <RotateIcon size={14} />
              Rotate
            </button>
          )}
          {has('drop') && (
            <button
              role="menuitem"
              title="Set this part's run straight down on the workplane, until its lowest wall rests on it"
              onClick={run(() => dropToWorkplane(piece.id))}
            >
              <DropToPlaneIcon size={14} />
              Place on Workplane
            </button>
          )}

          {ruled && <div className="part-menu-sep" role="separator" />}

          {has('hide') && (
            <button role="menuitem" onClick={run(() => togglePieceHidden(piece.id))}>
              <EyeOffIcon />
              Hide
            </button>
          )}
          {has('rename') && (
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
          )}
          {has('duplicate') && (
            <button
              role="menuitem"
              title={`Set a copy of ${setLabel} down beside the run, unjoined, and select it`}
              onClick={run(() => duplicateParts(set))}
            >
              <DuplicateIcon size={14} />
              Duplicate
              {/* The same binding the toolbar prints, so the menu teaches the key
                  rather than only standing in for it. */}
              <kbd className="part-menu-key">{formatShortcut(shortcuts.duplicate)}</kbd>
            </button>
          )}
          {has('duplicateJoined') && (
            <button
              role="menuitem"
              title={`Copy ${setLabel} onto the open end of the run, joined on where a new part would land`}
              onClick={run(() => duplicateParts(set, { join: true }))}
            >
              <DuplicateJoinIcon size={14} />
              Duplicate Joined
              <kbd className="part-menu-key">{formatShortcut(shortcuts.duplicateJoined)}</kbd>
            </button>
          )}
          {has('delete') && (
            <button className="danger" role="menuitem" onClick={run(() => removeParts(set))}>
              <TrashIcon />
              {set.length > 1 ? `Delete ${set.length} Parts` : 'Delete'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
