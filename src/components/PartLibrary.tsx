import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useRun, pieceLabel, type Piece, type Port } from '../store'

/**
 * Where the next part will be joined on, said in the parts' own names. The run
 * grows at the tail unless a joint has been armed in the 3D view, so this is
 * what tells you which it is before you pick anything.
 */
function describeTarget(pieces: Piece[], port: Port | null): string {
  if (!pieces.length) return 'at the start of the run'
  const label = (i: number) => pieceLabel(pieces[i], i)
  const last = pieces.length - 1
  const i = port ? pieces.findIndex((p) => p.id === port.pieceId) : -1
  if (!port || i < 0 || (port.end === 'out' && i === last)) return `at the end, after ${label(last)}`
  const at = port.end === 'in' ? i : i + 1
  if (at === 0) return `at the start, before ${label(0)}`
  return `between ${label(at - 1)} and ${label(at)}`
}

/** A plain length of pipe, drawn side-on as a simple outlined bar. */
function StraightLinePreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <rect className="pp-body" x="2" y="12" width="42" height="7" />
    </svg>
  )
}

/** Two legs meeting at a break, with the angle called out over the corner. */
function AngleConnectorPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-arc" d="M15 24 A 11 11 0 0 1 33.5 16" />
      <path className="pp-line" d="M6 24h20l14-15" />
    </svg>
  )
}

/** The same two legs seen from above, turning across the page rather than up it. */
function CornerConnectorPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-arc" d="M20 21 A 11 11 0 0 0 29 12" />
      <path className="pp-line" d="M4 26h13a9 9 0 0 0 9-9V4" />
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
    blurb:
      'Short two-leg connector that breaks the run to a new angle. The inlet stays rigid; the leg past the break tips up or down. Rounded at the corner by default, so the marble rolls through the change.',
    preview: AngleConnectorPreview,
    add: () => useRun.getState().addPiece('angle'),
  },
  {
    id: 'corner',
    name: 'Corner Connector',
    category: 'track',
    blurb:
      'Short two-leg connector that breaks the run to a new heading. The inlet stays rigid; the leg past the break swings right or left. Rounded at the corner by default, so the marble carries its speed round the turn.',
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
  const { pieces, armedPort, armPort } = useRun()

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
        (!q || p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q)),
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
                          {p.name}
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
                <b>Joining {describeTarget(pieces, armedPort)}.</b>{' '}
                {armedPort ? (
                  <>
                    Picked from the joint you armed in the 3D view.{' '}
                    <button className="link-btn" onClick={() => armPort(null)}>
                      build at the end instead
                    </button>
                    .
                  </>
                ) : (
                  <>Click a joint socket in the 3D view to build from somewhere else.</>
                )}{' '}
                The part is selected once it lands, so its measurements are ready to edit in the
                sidebar.
              </p>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
