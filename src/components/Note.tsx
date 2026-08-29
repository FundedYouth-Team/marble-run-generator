import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** How long the pointer has to rest on a note before the rest of it opens, ms. */
const POP_DELAY = 200
/** The card's width, in the layout as well as in the stylesheet. */
const POP_WIDTH = 268
/** How near the window's edge the card may come. */
const POP_EDGE = 8

/**
 * An explanation under a control, kept to one line.
 *
 * The panels explain themselves as they go, and the explanations are longer than
 * the column is wide — so a run of three controls arrives as a wall of grey text
 * with the controls buried in it. The text is all still here: it is clipped to
 * the first line, and the whole of it opens in a card beside the column once the
 * pointer rests on it. The card is a picture of what is already in the page, so
 * it is hidden from anything reading the page aloud — the clipping is visual,
 * and a screen reader is given the note entire.
 *
 * A note that fits on its line gets no button and no card: there is nothing
 * behind it to open.
 */
export default function Note({ children }: { children: ReactNode }) {
  const line = useRef<HTMLSpanElement>(null)
  const anchor = useRef<HTMLParagraphElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const timer = useRef(0)

  /** Whether the line is actually clipped — no clipping, nothing to open. */
  const [clipped, setClipped] = useState(false)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  /** Clicked open, so it stays open until dismissed — how touch reads a note. */
  const [pinned, setPinned] = useState(false)

  // The note's text is worked out from the model, so it changes under us: the
  // observer catches both the column resizing and the sentence being rewritten.
  useLayoutEffect(() => {
    const el = line.current
    if (!el) return
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  })

  const place = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    // Beside the column by preference, so the card covers the stage rather than
    // the controls the note is about. Under it when the window is too narrow
    // for that.
    const beside = r.right + 12
    const x = beside + POP_WIDTH + POP_EDGE <= window.innerWidth
      ? beside
      : Math.max(POP_EDGE, Math.min(r.left, window.innerWidth - POP_WIDTH - POP_EDGE))
    const y = x === beside ? r.top - 7 : r.bottom + 8
    setAt({ x, y })
  }, [])

  const open = useCallback(
    (now = false) => {
      window.clearTimeout(timer.current)
      if (now) place()
      else timer.current = window.setTimeout(place, POP_DELAY)
    },
    [place],
  )

  const close = useCallback(() => {
    window.clearTimeout(timer.current)
    setPinned(false)
    setAt(null)
  }, [])

  // A card left in flight when the panel folds has nothing to open onto.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // The column scrolls under the card, and the card is placed in window pixels:
  // it follows the note rather than hanging where the note used to be.
  useEffect(() => {
    if (!at) return
    const follow = () => place()
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [at, place])

  // Pinned open, it is dismissed the way any small overlay is: Escape, or a
  // click on anything else.
  useEffect(() => {
    if (!pinned) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const away = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', away)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', away)
    }
  }, [pinned, close])

  // Once the card is up, hold it inside the window: it is placed from the
  // note's top, and a note near the bottom would hang off the edge.
  useLayoutEffect(() => {
    if (!at || !pop.current) return
    const h = pop.current.offsetHeight
    const y = Math.max(POP_EDGE, Math.min(at.y, window.innerHeight - h - POP_EDGE))
    if (Math.abs(y - at.y) > 0.5) setAt({ x: at.x, y })
  }, [at])

  return (
    <p
      className="note note-clip"
      ref={anchor}
      onPointerEnter={clipped ? () => open() : undefined}
      onPointerLeave={pinned ? undefined : close}
    >
      <span className="note-line" ref={line}>
        {children}
      </span>
      {clipped && (
        <button
          className={at ? 'note-more on' : 'note-more'}
          // The note itself is the label: the button only says it is longer
          // than it looks.
          aria-label="Read the whole note"
          aria-expanded={at !== null}
          onClick={() => {
            if (pinned) close()
            else {
              setPinned(true)
              open(true)
            }
          }}
          onFocus={() => open(true)}
          onBlur={pinned ? undefined : close}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 11v5.5" />
            <path d="M12 7.6h.01" />
          </svg>
        </button>
      )}
      {at &&
        createPortal(
          // A picture of the line above, so it is kept out of the reading order.
          <div className="note-pop" ref={pop} style={{ left: at.x, top: at.y }} aria-hidden="true">
            {children}
          </div>,
          document.body,
        )}
    </p>
  )
}
