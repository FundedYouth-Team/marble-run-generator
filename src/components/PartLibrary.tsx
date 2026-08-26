import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useRun } from '../store'

/**
 * A plain length of pipe seen side-on, with a dimension bar under it for the
 * one measurement the part is really about.
 *
 * Drawn in the same weight as every other preview rather than as an outlined
 * bar of its own: a card that draws its part differently from the rest reads as
 * a different kind of thing, and this is the plainest part there is.
 */
function StraightLinePreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M4 9h38" />
      <path
        className="pp-arrow"
        d="M4 19.4h38v1.2H4z M3.4 16.5h1.2v7H3.4z M41.4 16.5h1.2v7h-1.2z"
      />
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
 * closing in under it, the spout out of the throat, and the feed coming in at
 * the side. Drawn fed, because that is what one lands as; the feed comes off in
 * the sidebar rather than from a tile of its own.
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
      {/* The feed pipe, let in through the side of the collar and running dead
          level, which is the only way a funnel is ever fed. */}
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
  /** One line: what the part is. Every card shows this and nothing more. */
  blurb: string
  /**
   * The rest of it, for the parts that have a rest — behind a Details link
   * rather than on the card, so a grid of cards stays a grid of cards and the
   * eye can run down the names.
   *
   * Left off where the blurb already says the whole of it, and the card then
   * shows no link at all. A part with nothing more to say should not look as
   * though it is hiding something.
   */
  detail?: string
  preview: () => ReactElement
  /** Undefined while the generator for this part is still to be written. */
  add?: () => void
}

const PARTS: Part[] = [
  {
    id: 'tube',
    name: 'Straight Line',
    category: 'track',
    blurb: 'Straight run of pipe — length, slope and turn set per piece.',
    preview: StraightLinePreview,
    add: () => useRun.getState().addPiece(),
  },
  {
    id: 'angle',
    name: 'Angle Connector',
    category: 'track',
    axis: 'Up / Down',
    blurb: 'Breaks the run up or down to a new slope.',
    detail:
      'Two short legs meeting at the break. The inlet stays rigid; the leg past it tips above or below. Rounded at the corner by default, so the marble rolls through the change rather than hitting it.',
    preview: AngleConnectorPreview,
    add: () => useRun.getState().addPiece('angle'),
  },
  {
    id: 'corner',
    name: 'Corner Connector',
    category: 'track',
    axis: 'Left / Right',
    blurb: 'Breaks the run left or right to a new heading.',
    detail:
      'Two short legs meeting at the break. The inlet stays rigid; the leg past it swings to one side. Rounded at the corner by default, so the marble carries its speed round the turn.',
    preview: CornerConnectorPreview,
    add: () => useRun.getState().addPiece('corner'),
  },
  {
    id: 'hook',
    name: 'Hook',
    category: 'track',
    axis: 'Turn Back',
    blurb: 'Half-turn switchback that sends the run back the way it came.',
    detail:
      'Flat, it comes back alongside itself one turn width over, falling the whole way round so it leaves on the slope it entered at. Stood on edge, the same turn drops the run and brings it back underneath itself. Set how wide it swings, how far round it goes, and which plane it turns on.',
    preview: HookPreview,
    add: () => useRun.getState().addPiece('hook'),
  },
  {
    id: 'corkscrew',
    name: 'Corkscrew',
    category: 'feature',
    axis: 'Down',
    blurb: 'Coil about a dead vertical axis that loses height in a small footprint.',
    detail:
      'Set how far it drops and how wide it is at the top and at the bottom, and it counts the rings off the room the height leaves them; hold the count by hand instead and the same height over fewer rings is a steeper coil. Either way the fall it runs at follows from those, the same way a real printed helix has only one angle it can sit at.',
    preview: CorkscrewPreview,
    add: () => useRun.getState().addPiece('corkscrew'),
  },
  {
    id: 'funnel',
    name: 'Funnel',
    category: 'feature',
    axis: 'Down',
    blurb: 'Open bowl fed through the side and drained down the throat.',
    detail:
      'The feed is a plain round pipe let in through the bowl’s wall, square across its radius and set in a little from the wall so it goes through cleanly rather than grazing down a long slot. The marble comes out going round rather than at the middle, and its own speed carries it out onto the collar while the cone winds it down to the throat. Nothing of the pipe stands past the wall: inside, the mouth is smooth all the way round but for the hole. Set how wide the mouth is, how deep the bowl goes, how high the collar stands and how many times round it whirls — or take the feed off in the sidebar for a plain funnel, and let the marble go into the mouth from above. A funnel is fed dead level and leaves dead vertical, and neither is the run’s to set: the run has to be brought to it, and whatever hangs under the funnel starts by falling straight down.',
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
  /**
   * Which card has its details showing — one at a time, because a card grows
   * when it opens and two of them growing at once pushes the rest about the
   * grid for no gain.
   */
  const [detailId, setDetailId] = useState<string | null>(null)
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
      setDetailId(null)
    }
  }, [open])

  // A card that has been filtered away cannot be closed again, so it is closed
  // for the user rather than left open behind the search.
  useEffect(() => setDetailId(null), [category, query])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PARTS.filter(
      (p) =>
        (category === 'all' || p.category === category) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.blurb.toLowerCase().includes(q) ||
          // Searched even though it is folded away: a part is still the part
          // that mentions the word, whether or not the card is showing it.
          !!p.detail?.toLowerCase().includes(q) ||
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
                    const showing = detailId === p.id
                    return (
                      /* The card is a box holding two controls rather than one
                         big button: a button cannot have another button inside
                         it, and Details has to be its own. */
                      <div key={p.id} className="lib-card">
                        <button
                          className="lib-card-pick"
                          disabled={!p.add}
                          onClick={() => pick(p)}
                          title={
                            p.add ? `Add a ${p.name.toLowerCase()} to the stage` : 'Not available yet'
                          }
                        >
                          <span className="lib-card-art">
                            <Preview />
                          </span>
                          <span className="lib-card-name">
                            <b>{p.name}</b>
                            {p.axis && <i className="lib-card-axis">{p.axis}</i>}
                            {!p.add && <em>soon</em>}
                          </span>
                          <span className="lib-card-blurb">{p.blurb}</span>
                        </button>
                        {p.detail && (
                          <>
                            <button
                              className="link-btn lib-card-more"
                              aria-expanded={showing}
                              onClick={() => setDetailId(showing ? null : p.id)}
                            >
                              {showing ? 'Less' : 'Details'}
                            </button>
                            {showing && <p className="lib-card-detail">{p.detail}</p>}
                          </>
                        )}
                      </div>
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
