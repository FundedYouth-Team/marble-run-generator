import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useRun } from '../store'

/** A plain length of pipe, drawn side-on as a simple outlined bar. */
function StraightLinePreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <rect className="pp-body" x="2" y="12" width="42" height="7" />
    </svg>
  )
}

/**
 * Two legs meeting at a break, seen side-on, with a double arrow for the axis
 * the far leg is free to move on. The arrow is what tells this apart from the
 * corner at a glance — the silhouettes alone are near enough identical.
 */
function AngleConnectorPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M3 24h12l10-11" />
      <path
        className="pp-arrow"
        d="M38 3 L43 9.5 L39.8 9.5 L39.8 20.5 L43 20.5 L38 27 L33 20.5 L36.2 20.5 L36.2 9.5 L33 9.5 Z"
      />
    </svg>
  )
}

/** The same two legs seen from above, so the break swings across the page. */
function CornerConnectorPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M2 24h9a9 9 0 0 0 9-9V4" />
      <path
        className="pp-arrow"
        d="M26 15 L32.5 9 L32.5 12.8 L38.5 12.8 L38.5 9 L45 15 L38.5 21 L38.5 17.2 L32.5 17.2 L32.5 21 Z"
      />
    </svg>
  )
}

function CurvePreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M6 24c0-9 8-16 17-16 9 0 17 4 17 9" />
    </svg>
  )
}

function DropPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M12 5c10 0 10 6 0 6s-10 6 0 6 12 4 12 8" />
    </svg>
  )
}

function FunnelPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M7 6h32l-13 9v10" />
    </svg>
  )
}

type Category = 'track' | 'feature'

interface Part {
  id: string
  name: string
  category: Category
  /**
   * The axis the part breaks on, for the pair that are otherwise told apart
   * only by that. Sits beside the name rather than inside it, so the short name
   * still matches what a piece is called once it is on the stage.
   */
  axis?: string
  blurb: string
  preview: () => ReactElement
  /** Undefined while the generator for this part is still to be written. */
  add?: () => void
}

const PARTS: Part[] = [
  {
    id: 'tube',
    name: 'Straight Line',
    category: 'track',
    blurb: 'Straight run of pipe. Length, slope and turn are set per piece once it is on the stage.',
    preview: StraightLinePreview,
    add: () => useRun.getState().addPiece(),
  },
  {
    id: 'angle',
    name: 'Angle Connector',
    category: 'track',
    axis: 'Up / Down',
    blurb:
      'Short two-leg connector that breaks the run up or down to a new slope. The inlet stays rigid; the leg past the break tips above or below it. Rounded at the corner by default, so the marble rolls through the change.',
    preview: AngleConnectorPreview,
    add: () => useRun.getState().addPiece('angle'),
  },
  {
    id: 'corner',
    name: 'Corner Connector',
    category: 'track',
    axis: 'Left / Right',
    blurb:
      'Short two-leg connector that breaks the run left or right to a new heading. The inlet stays rigid; the leg past the break swings to one side of it. Rounded at the corner by default, so the marble carries its speed round the turn.',
    preview: CornerConnectorPreview,
    add: () => useRun.getState().addPiece('corner'),
  },
  {
    id: 'curve',
    name: 'Curve',
    category: 'track',
    blurb: 'Constant-radius bend that sweeps the run round without breaking the bore.',
    preview: CurvePreview,
  },
  {
    id: 'drop',
    name: 'Drop',
    category: 'feature',
    blurb: 'Vertical spiral that loses height in a small footprint.',
    preview: DropPreview,
  },
  {
    id: 'funnel',
    name: 'Funnel',
    category: 'feature',
    blurb: 'Wide catch mouth that gathers the marble back into the bore.',
    preview: FunnelPreview,
  },
]

const CATEGORY_LABEL: Record<Category | 'all', string> = {
  all: 'All parts',
  track: 'Track',
  feature: 'Features',
}

const CATEGORIES: (Category | 'all')[] = ['all', 'track', 'feature']

/** Browse the catalogue and drop a part on the stage. Opened from the top bar. */
export default function PartLibrary() {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const { pieces, setTool } = useRun()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Reopening should start from a clean slate rather than the last search.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setCategory('all')
    }
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PARTS.filter(
      (p) =>
        (category === 'all' || p.category === category) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.blurb.toLowerCase().includes(q) ||
          !!p.axis?.toLowerCase().includes(q)),
    )
  }, [category, query])

  const pick = (part: Part) => {
    if (!part.add) return
    part.add()
    setOpen(false)
  }

  return (
    <>
      <button className="add-part-btn" onClick={() => setOpen(true)} title="Browse the part library">
        <span aria-hidden="true">＋</span> Add Part
      </button>

      {open && (
        <div className="lib-backdrop" onClick={() => setOpen(false)}>
          <div
            className="lib-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Part library"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="lib-head">
              <h3>Part Library</h3>
              <input
                className="lib-search"
                type="search"
                placeholder="Search parts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <button className="lib-close" onClick={() => setOpen(false)} aria-label="Close part library">
                ✕
              </button>
            </header>

            <div className="lib-main">
              <nav className="lib-cats">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    className={category === c ? 'on' : ''}
                    onClick={() => setCategory(c)}
                  >
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </nav>

              <div className="lib-body">
                <div className="lib-grid">
                  {shown.map((p) => {
                    const Preview = p.preview
                    return (
                      <button
                        key={p.id}
                        className="lib-card"
                        disabled={!p.add}
                        onClick={() => pick(p)}
                        title={p.add ? `Add a ${p.name.toLowerCase()} to the stage` : 'Not available yet'}
                      >
                        <div className="lib-card-art">
                          <Preview />
                        </div>
                        <span className="lib-card-name">
                          <b>{p.name}</b>
                          {p.axis && <i className="lib-card-axis">{p.axis}</i>}
                          {!p.add && <em>soon</em>}
                        </span>
                        <span className="lib-card-blurb">{p.blurb}</span>
                      </button>
                    )
                  })}
                </div>
                {!shown.length && <p className="note">No parts match “{query}”.</p>}
              </div>
            </div>

            <footer className="lib-foot">
              <p className="note">
                <b>The part lands on its own, in clear space beside the run.</b> Nothing already on
                the stage moves to make room for it, and nothing is joined to it yet — take the{' '}
                <button className="link-btn" onClick={() => setTool('connect')}>
                  Connector
                </button>{' '}
                from the toolbar and click the two ends you want bonded together. The part is
                selected once it lands, so its measurements are ready to edit in the sidebar
                {pieces.length ? ', and the Move tool carries it about the workplane' : ''}.
              </p>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
