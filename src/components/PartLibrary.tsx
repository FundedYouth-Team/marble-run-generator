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

/**
 * The turn seen from above: in one side, round, and back out the other — with a
 * dimension bar beside it for the one measurement the part is really about.
 */
function HookPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M5 7h12a8 8 0 0 1 0 16H5" />
      <path
        className="pp-arrow"
        d="M35.3 6h1.4v20h-1.4z M33 6h6v1.2h-6z M33 24.8h6v1.2h-6z"
      />
    </svg>
  )
}

/**
 * The tower seen from a little above: rings stacked and closing in, with a
 * dimension bar down the side for the height it is really there to lose.
 */
function CorkscrewPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      {/* Thinner than the rest of the previews: three rings this close would
          blob into one another at the stock weight. */}
      <g className="pp-line" strokeWidth="2.4">
        <ellipse cx="18" cy="8" rx="13" ry="4.2" />
        <ellipse cx="18" cy="15" rx="9.5" ry="3.4" />
        <ellipse cx="18" cy="21.5" rx="6" ry="2.6" />
      </g>
      <path className="pp-arrow" d="M39.3 4h1.4v22h-1.4z M37 4h6v1.2h-6z M37 24.8h6v1.2h-6z" />
    </svg>
  )
}

/**
 * The bowl seen from a little above: the collar round the mouth, the cone
 * closing in under it, and the spout out of the throat — with the feed tube
 * coming in over the rim, which is the whole of how the part is fed.
 */
function FunnelPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <g className="pp-line" strokeWidth="2.4">
        {/* The mouth, and the collar's far side dropping away behind it. */}
        <ellipse cx="23" cy="9" rx="13" ry="4.6" />
        <path d="M10 9v4a13 4.6 0 0 0 26 0V9" />
        {/* The cone in to the throat, and the spout under it. */}
        <path d="M10.6 15.4 21 24v4M35.4 15.4 25 24v4" />
        <path d="M21 28h4" />
      </g>
      {/* The feed box, let into the side of the bowl and running in dead level,
          which is the only way a funnel is ever fed. */}
      <path className="pp-arrow" d="M2 7.6h9v2.8H2z" />
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
    id: 'hook',
    name: 'Hook',
    category: 'track',
    axis: 'Turn Back',
    blurb:
      'Half-turn switchback that sends the run back the way it came. Flat, it comes back alongside itself one turn width over, falling the whole way round so it leaves on the slope it entered at; stood on edge, the same turn drops the run and brings it back underneath itself. Set how wide it swings, how far round it goes, and which plane it turns on.',
    preview: HookPreview,
    add: () => useRun.getState().addPiece('hook'),
  },
  {
    id: 'corkscrew',
    name: 'Corkscrew',
    category: 'feature',
    axis: 'Down',
    blurb:
      'Coil about a dead vertical axis that loses height in a small footprint. Set how far it drops and how wide it is at the top and at the bottom, and it counts the rings off the room the height leaves them; hold the count by hand instead and the same height over fewer rings is a steeper coil. Either way the fall it runs at follows from those, the same way a real printed helix has only one angle it can sit at.',
    preview: CorkscrewPreview,
    add: () => useRun.getState().addPiece('corkscrew'),
  },
  {
    id: 'funnel',
    name: 'Funnel',
    category: 'feature',
    axis: 'Down',
    blurb:
      'Open bowl fed through the side and drained down the throat. The feed is a square box let into the bowl’s wall — flush outside, round inside — with its bore coming out level with the inside of that wall, so the marble arrives already running round the collar and its own speed holds it there while the cone winds it down to the middle. Set how wide the mouth is, how deep the bowl goes, how high the collar stands and how many times round it whirls; or take the box off altogether for a bare bowl, and drop the marble in from above. A funnel is fed dead level and leaves dead vertical, and neither is the run’s to set — so the run has to be brought to it, and whatever hangs under the funnel starts by falling straight down.',
    preview: FunnelPreview,
    add: () => useRun.getState().addPiece('funnel'),
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
