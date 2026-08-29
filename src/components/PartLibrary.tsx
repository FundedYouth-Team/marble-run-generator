import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { attachPort, pieceLabel, useRun, UNTITLED_PROJECT, type JoinEnd } from '../store'
import {
  TEMPLATES,
  TEMPLATE_DIR,
  buildTemplate,
  type Template,
  type TemplateBuild,
} from '../lib/templates'
import HoverHint from './HoverHint'
import { PROJECT_EXT } from '../lib/project'
import { formatCoarse } from '../lib/units'
import { actionFor, isTyping } from '../lib/shortcuts'

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

/**
 * The plinth seen from a little above: a plate with its corners rounded off,
 * with the thickness showing along the front edge and a dimension bar under it
 * for the span it is really there to cover.
 */
function BasePreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <g className="pp-line" strokeWidth="2.4">
        {/* The top face, in plan-ish perspective — rounded at all four corners. */}
        <path d="M13 4h14a5 5 0 0 1 4 2l7 8a2.6 2.6 0 0 1-2 4H10a2.6 2.6 0 0 1-2-4l7-8a5 5 0 0 1 4-2z" />
        {/* The front edge dropping away, which is the whole of its thickness. */}
        <path d="M8.4 17.4v3.4a2.6 2.6 0 0 0 2.6 2.6h24a2.6 2.6 0 0 0 2.6-2.6v-3.4" />
      </g>
      <path className="pp-arrow" d="M5 26.4h36v1.2H5z M4.4 24h1.2v6H4.4z M40.4 24h1.2v6h-1.2z" />
    </svg>
  )
}

/**
 * A rod struck between two turns of a run, seen side on: the bar itself, and the
 * two pipes it is holding apart.
 */
function SupportPreview() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <g className="pp-line" strokeWidth="2.4">
        {/* The two things it braces, seen end on. */}
        <path d="M8 5h30" />
        <path d="M8 25h30" />
      </g>
      {/* The rod, driven a whisker into both. */}
      <path className="pp-arrow" d="M21 3.6h4v22.8h-4z" />
    </svg>
  )
}

type Category = 'track' | 'feature' | 'structure'

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
      'Set how far it drops and how wide it is at the top and at the bottom, and it counts the rings off the room the height leaves them; hold the count by hand instead and the same height over fewer rings is a steeper coil. Either way the fall it runs at follows from those, the same way a real printed helix has only one angle it can sit at — so to speed the marble up or slow it down you set that fall and the coil winds its rings to suit, keeping the height and the footprint it had. It arrives braced up its hollow middle by a cage of its own — two hoops and four posts, welded to every turn — which can be moved to the outside, put on both sides, or taken off.',
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
  {
    id: 'base',
    name: 'Base',
    category: 'structure',
    axis: 'Ground',
    blurb: 'Flat plate that fills the space under the run and stands on the workplane.',
    detail:
      'Not a length of run: nothing plugs into it, the marble never travels it, and it takes no part in any joint — it is the ground the rest of it stands on. Set how wide, how deep and how thick it is, and how far the four upright corners are rounded off; rounded as far as it will go, a square plate is a disc. It is the one part whose size is a question about your printer rather than about the run, so the sidebar offers the beds by name — an A1, an A1 mini, an SV06 Plus — and sizes the plate to whichever you pick. That choice is remembered, so every base after it arrives on the same bed. It sits on the workplane and stays there — the move arrows slide it about and the green ring turns it, but nothing lifts it off the plane or buries it under one. The marble bounces off it like any other wall, so a run that spills lands on the plinth rather than falling through the floor.',
    preview: BasePreview,
    add: () => useRun.getState().addPiece('base'),
  },
  {
    id: 'support',
    name: 'Rod',
    category: 'structure',
    axis: 'Brace',
    blurb: 'Plain bar struck between two points, to hold them apart.',
    detail:
      'The other half of the base, and the reason a run can be printed at all: every tube on this stage is hanging in mid-air, and a printed tube hanging in mid-air falls on the floor. A rod is two ends and a thickness and nothing else — it knows nothing about what it is bracing, which is exactly what lets one part be a post down to the plate, a tie between two turns of a coil, and a spine run down the outside of one from top to bottom. Set how long it is, how thick, and how far its four long corners are rounded; rounded to half the thickness it is a round bar, and left square it is the flattest thing there is to print. It goes where you strike it: take up the Rods tool, click the two points you want held apart, and it arrives pointing where it was struck, driven a whisker into both so it fuses with them rather than merely touching. That button’s menu also braces the whole stage in one press, from whichever side of the tube you pick — under the run, over it, or outside or inside the bend, which on a coil is the difference between keeping its middle clear to look down through and keeping its outside clear to watch the marble.',
    preview: SupportPreview,
    add: () => useRun.getState().addPiece('support'),
  },
]

/* ---------------- templates ---------------- */

/**
 * What a template shows when no picture was left beside it: levels folding back
 * over one another, seen side-on. It stands for a run rather than describing the
 * one on the card — the file itself says nothing about what it looks like, and a
 * template that wants a likeness gets a screenshot dropped in next to it.
 */
function TemplateGlyph() {
  return (
    <svg width="78" height="50" viewBox="0 0 46 30" aria-hidden="true">
      <path
        className="pp-line"
        strokeWidth="2.6"
        d="M4 4h26a4.5 4.5 0 0 1 0 5.5H8a4.5 4.5 0 0 0 0 5.5h26a4.5 4.5 0 0 1 0 5.5H8a4.5 4.5 0 0 0 0 5.5h30"
      />
    </svg>
  )
}

/** A template read in, or why it could not be. */
type BuildResult = { ok: true; build: TemplateBuild } | { ok: false; message: string }

/* ---------------- the rail ---------------- */

/**
 * What the rail on the left is showing. The parts and the templates are two
 * catalogues rather than one — a part is dropped beside the run, a template
 * *is* the run — so they are filed under headings of their own rather than
 * mixed into a single list of categories.
 */
type Section = 'all' | Category | 'templates'

const SECTION_LABEL: Record<Section, string> = {
  all: 'All parts',
  track: 'Track',
  feature: 'Features',
  structure: 'Structure',
  templates: 'Saved runs',
}

const RAIL: { heading: string; sections: Section[] }[] = [
  { heading: 'Parts', sections: ['all', 'track', 'feature', 'structure'] },
  { heading: 'Templates', sections: ['templates'] },
]

const isTemplateSection = (s: Section): s is 'templates' => s === 'templates'

/**
 * The three places a part out of the library can land, in the order the buttons
 * offer them: in front of the run, behind it, or nowhere near it.
 *
 * A switch and a side would be the same three answers, but read as two
 * questions when they are really one — a part lands *somewhere*, and where is
 * the choice. Start comes first because it is the end of a run that reads as its
 * beginning, however few runs are built from it.
 */
const JOIN_CHOICES: [JoinEnd, string, string][] = [
  ['start', 'Start', 'The part lands in front of the run, feeding into what is already there'],
  ['end', 'End', 'The part lands on the end of the run, carrying on from what is already there'],
  ['off', 'Not at all', 'The part lands on its own in clear space, bonded to nothing'],
]

/** What each of them does, under the heading — the sentence the buttons answer. */
const JOIN_NOTE: Record<JoinEnd, string> = {
  start: 'grown by the head, which is how a run is built backwards from the funnel it arrives at',
  end: 'grown by the tail, part after part, which is how most of them are built',
  off: 'parts land on their own and the Connector joins them by hand',
}

/**
 * Browse the catalogue and drop a part on the stage — or take a whole run off
 * the shelf. Opened from the top bar, by either of the two buttons: they open
 * the same window on different shelves of it.
 */
export default function PartLibrary() {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('all')
  const [query, setQuery] = useState('')
  /**
   * A template waiting to be agreed to. Loading one replaces the stage, so it
   * is asked for rather than done on the click — the same as opening a file.
   */
  const [pending, setPending] = useState<{ template: Template; build: TemplateBuild } | null>(null)
  /**
   * Which card has its details showing — one at a time, because a card grows
   * when it opens and two of them growing at once pushes the rest about the
   * grid for no gain.
   */
  const [detailId, setDetailId] = useState<string | null>(null)
  const {
    pieces,
    setTool,
    joinOnAdd,
    setJoinOnAdd,
    pendingPort,
    selectedId,
    projectName,
    loadProject,
    units,
    shortcuts,
  } = useRun()

  /**
   * Every template read in and measured, once. A build walks the whole run, so
   * doing it on the first open beats doing it per card — and the figures each
   * card reads out fall out of the same walk.
   *
   * A file that cannot be read keeps its card and says why instead: these are
   * files somebody dropped into a directory by hand, and one that quietly failed
   * to appear would leave them with nothing to go on.
   */
  const builds = useMemo(
    () =>
      open
        ? new Map<string, BuildResult>(
            TEMPLATES.map((t) => {
              try {
                return [t.id, { ok: true, build: buildTemplate(t) }]
              } catch (err) {
                return [t.id, { ok: false, message: (err as Error).message }]
              }
            }),
          )
        : null,
    [open],
  )

  /**
   * The end the next part would land on, worked out by the very function the
   * store adds it with — so what the footer promises and what actually happens
   * cannot come apart.
   */
  const target = useMemo(
    () =>
      joinOnAdd === 'off' ? null : attachPort({ pieces, pendingPort, selectedId }, joinOnAdd),
    [joinOnAdd, pieces, pendingPort, selectedId],
  )

  /** That end in words — "the outlet of Tube 3" — for the footer and the button. */
  const targetName = useMemo(() => {
    if (!target) return null
    const i = pieces.findIndex((p) => p.id === target.pieceId)
    if (i < 0) return null
    return `the ${target.end === 'out' ? 'outlet' : 'inlet'} of ${pieceLabel(pieces[i], i)}`
  }, [target, pieces])

  // P opens the library and closes it again — the same kind of bare key the
  // tools answer to, since every run is built out of this window. It listens
  // whether or not the window is open, so the key is the way in as well as the
  // way out, and it is ignored while you are typing: the search field inside is
  // full of parts with a P in them. The binding is read at press time, so
  // re-binding it in Settings takes effect on the next press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e.target) && actionFor(e, useRun.getState().shortcuts) === 'openLibrary') {
        e.preventDefault()
        if (open) return setOpen(false)
        setSection('all')
        setOpen(true)
        return
      }
      if (!open || e.key !== 'Escape') return
      // The question on top is what Escape answers; the window under it stays.
      if (pending) setPending(null)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending])

  // Reopening should start from a clean slate rather than the last search. The
  // shelf is left where it was: someone browsing templates is likely to want
  // them again, and the two buttons say which shelf they meant anyway.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setDetailId(null)
      setPending(null)
    }
  }, [open])

  // A card that has been filtered away cannot be closed again, so it is closed
  // for the user rather than left open behind the search.
  useEffect(() => setDetailId(null), [section, query])

  const matches = (q: string, ...fields: (string | undefined)[]) =>
    !q || fields.some((f) => f?.toLowerCase().includes(q))

  const shownParts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (isTemplateSection(section)) return []
    return PARTS.filter(
      (p) =>
        (section === 'all' || p.category === section) &&
        // The detail is searched even though it is folded away: a part is still
        // the part that mentions the word, whether or not the card shows it.
        matches(q, p.name, p.blurb, p.detail, p.axis),
    )
  }, [section, query])

  const shownTemplates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!isTemplateSection(section)) return []
    return TEMPLATES.filter((t) => matches(q, t.name, t.blurb, t.file))
  }, [section, query])

  const pick = (part: Part) => {
    if (!part.add) return
    part.add()
    setOpen(false)
  }

  /** Opens the library on a shelf — the same shelves the window itself lists. */
  const openOn = (s: Section) => {
    setSection(s)
    setOpen(true)
  }

  return (
    <>
      <HoverHint
        className="add-part-slot"
        label="Add Part"
        hint={
          targetName
            ? `Browse the part library — the next part joins onto ${targetName}`
            : 'Browse the part library and set a part on the stage'
        }
        keys={shortcuts.openLibrary}
      >
        <button className="add-part-btn" onClick={() => openOn('all')}>
          <span aria-hidden="true">＋</span> Add Part
        </button>
      </HoverHint>

      {open && (
        <div className="lib-backdrop" onClick={() => setOpen(false)}>
          <div
            className="lib-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Library"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="lib-head">
              <h3>Library</h3>
              <input
                className="lib-search"
                type="search"
                placeholder={isTemplateSection(section) ? 'Search templates…' : 'Search parts…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <button className="lib-close" onClick={() => setOpen(false)} aria-label="Close library">
                ✕
              </button>
            </header>

            <div className="lib-main">
              <nav className="lib-cats">
                {RAIL.map((group) => (
                  <div key={group.heading} className="lib-cat-group">
                    <h4>{group.heading}</h4>
                    {group.sections.map((s) => (
                      <button
                        key={s}
                        className={section === s ? 'on' : ''}
                        onClick={() => setSection(s)}
                      >
                        {SECTION_LABEL[s]}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              <div className="lib-body">
                <div className="lib-grid">
                  {shownTemplates.map((t) => {
                    const result = builds?.get(t.id)
                    const build = result?.ok ? result.build : null
                    const problem = result && !result.ok ? result.message : null
                    return (
                      <div key={t.id} className="lib-card">
                        <button
                          className="lib-card-pick"
                          disabled={!build}
                          onClick={() => build && setPending({ template: t, build })}
                          title={problem ? t.file : `Put ${t.name} on the stage`}
                        >
                          <span className="lib-card-art">
                            {t.image ? (
                              /* The picture the user left beside the run, shown
                                 as they saved it — cropped to the tile rather
                                 than squashed into it, since a screenshot of a
                                 run is any shape at all. */
                              <img className="lib-card-shot" src={t.image} alt="" />
                            ) : (
                              <TemplateGlyph />
                            )}
                          </span>
                          <span className="lib-card-name">
                            <b>{t.name}</b>
                          </span>
                          {build && (
                            <span className="lib-card-stats">
                              {build.parts} pcs · {formatCoarse(build.length, units)} ·{' '}
                              {formatCoarse(build.drop, units)} drop
                            </span>
                          )}
                          {t.blurb && <span className="lib-card-blurb">{t.blurb}</span>}
                          {problem && (
                            <span className="lib-card-blurb lib-card-bad">
                              {t.file} could not be read — {problem}
                            </span>
                          )}
                        </button>
                      </div>
                    )
                  })}

                  {shownParts.map((p) => {
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
                {/* An empty shelf and a search that found nothing are different
                    things to be told: there is nothing built in here, so a shelf
                    with nothing on it is the normal state until somebody puts a
                    run on it, and it says how. */}
                {isTemplateSection(section) && !TEMPLATES.length ? (
                  <p className="note">
                    <b>Nothing on the shelf yet.</b> Templates are your own runs:{' '}
                    <b>Save</b> a project and drop the <code>{PROJECT_EXT}</code> file into the{' '}
                    <code>{TEMPLATE_DIR}/</code> directory at the root of the app, and it turns up
                    here. Leave a picture beside it under the same name — say{' '}
                    <code>my-run.png</code> — and the card shows that instead of the outline.
                  </p>
                ) : (
                  !shownParts.length &&
                  !shownTemplates.length && (
                    <p className="note">
                      No {isTemplateSection(section) ? 'templates' : 'parts'} match “{query}”.
                    </p>
                  )
                )}
              </div>
            </div>

            <footer className="lib-foot">
              {isTemplateSection(section) ? (
                <p className="note">
                  <b>A template is a whole run, so taking one replaces what is on the stage.</b>{' '}
                  It arrives exactly as it was saved, under its own name — every part in it is
                  yours to edit, move, disconnect or delete, and Save writes it out like any other
                  project. Save what you have first if you want to keep it. These are your own
                  runs: anything saved into <code>{TEMPLATE_DIR}/</code> is on this shelf, with an
                  image of the same name beside it if you want one on the card.
                </p>
              ) : (
                <>
                  {/* The choice sits over the sentence that describes what it does,
                      rather than off in Settings: this is the one place a part is
                      ever added, so it is the one place the question comes up. */}
                  <div className="lib-attach">
                    <span className="field-label">
                      Join onto the run
                      <em>{JOIN_NOTE[joinOnAdd]}</em>
                    </span>
                    <div className="segmented small">
                      {JOIN_CHOICES.map(([value, label, why]) => (
                        <button
                          key={value}
                          className={joinOnAdd === value ? 'on' : ''}
                          onClick={() => setJoinOnAdd(value)}
                          title={why}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {joinOnAdd !== 'off' ? (
                    <p className="note">
                      {targetName ? (
                        <>
                          <b>The part lands bonded onto {targetName}</b>, welded flush and{' '}
                          {joinOnAdd === 'start'
                            ? 'feeding into it along the line that end came in on — the run grows by one in front of everything already on it'
                            : 'pointing where that end pointed — the run grows by one behind everything already on it'}
                          , and nothing else on the stage moves. To grow some other end instead,
                          take the{' '}
                          <button className="link-btn" onClick={() => setTool('connect')}>
                            Connector
                          </button>{' '}
                          and click that end before opening this window; a held end outranks this
                          setting, and the part follows it. Otherwise it is the{' '}
                          {joinOnAdd === 'start' ? 'head' : 'far end'} of whatever run the selected
                          part stands in.
                        </>
                      ) : (
                        <>
                          <b>The first part lands on its own, at the middle of the workplane.</b>{' '}
                          There is nothing out there yet for it to be bonded to — everything after
                          it joins onto the {joinOnAdd === 'start' ? 'start' : 'end'} of the run as
                          it arrives.
                        </>
                      )}{' '}
                      The part is selected once it lands, so its measurements are ready to edit in
                      the sidebar. A base is the one exception to all of it: it has no ends to be
                      bonded by, so it always lands on its own, on the workplane.
                    </p>
                  ) : (
                    <p className="note">
                      <b>The part lands on its own, in clear space beside the run.</b> Nothing
                      already on the stage moves to make room for it, and nothing is joined to it
                      yet — take the{' '}
                      <button className="link-btn" onClick={() => setTool('connect')}>
                        Connector
                      </button>{' '}
                      from the toolbar and click the two ends you want bonded together. The part is
                      selected once it lands, so its measurements are ready to edit in the sidebar
                      {pieces.length ? ', and the Move tool carries it about the workplane' : ''}.
                    </p>
                  )}
                </>
              )}
            </footer>
          </div>

          {/* Above the library rather than instead of it: the question is about
              one card in a window the user is still standing in. */}
          {pending && (
            <div
              className="help-backdrop lib-confirm"
              // Stopped here, or dismissing the question would close the library
              // under it as well — the click would carry on to its backdrop.
              onClick={(e) => {
                e.stopPropagation()
                setPending(null)
              }}
            >
              <div
                className="confirm-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Load a template"
                onClick={(e) => e.stopPropagation()}
              >
                <h3>Load {pending.template.name}?</h3>
                <p className="note">
                  {pending.template.name} is {pending.build.parts} parts bonded into one run,{' '}
                  {formatCoarse(pending.build.length, units)} of track falling{' '}
                  {formatCoarse(pending.build.drop, units)} over a footprint of{' '}
                  {formatCoarse(pending.build.width, units)} by{' '}
                  {formatCoarse(pending.build.depth, units)}. Loading it replaces what is on the
                  stage now and drops the history for{' '}
                  <b>{projectName.trim() || UNTITLED_PROJECT}</b>.
                </p>
                <div className="confirm-btns">
                  <button onClick={() => setPending(null)}>Cancel</button>
                  <button
                    className="danger"
                    autoFocus
                    onClick={() => {
                      loadProject(pending.build.project)
                      setPending(null)
                      setOpen(false)
                    }}
                  >
                    Load template
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
