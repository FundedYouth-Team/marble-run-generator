import { useEffect, useMemo, useState } from 'react'
import {
  useRun,
  chainsOf,
  tubeSpec,
  pieceSpec,
  variantOf,
  openSideOf,
  sizedLikeRun,
  boreOf,
  wallOf,
  marbleFor,
  boreForMarble,
  isStructure,
  UNTITLED_PROJECT,
  OPEN_SIDE_LABEL,
  PART_LABEL,
  VARIANT_LABEL,
  type Piece,
  type PieceType,
} from '../store'
import { buildAssembly, partsBox } from '../lib/layout'
import { pieceAxisLength } from '../lib/centerline'
import { coarseText, formatCoarse, formatLength, lengthText, type Unit } from '../lib/units'
import HoverHint from './HoverHint'

/** One line of the sheet: what is being said, and what it says. */
interface Row {
  term: string
  value: string
  /** Said under the figure, in the smaller face — why it is that, or what it excludes. */
  note?: string
  /** Something the run cannot be printed as it stands — drawn in the warning colour. */
  warn?: boolean
}

interface Section {
  title: string
  rows: Row[]
}

/**
 * The whole of what the top bar used to carry in three chips, and the rest of
 * what those chips could not fit: the run measured, the tube it is cut from, the
 * ball it is cut for, and a count of what is on the stage.
 *
 * Worked out only while the sheet is open — the box in particular walks every
 * part, and the bar has no use for it closed.
 */
function detailsFor(s: ReturnType<typeof useRun.getState>): Section[] {
  const { pieces, innerDiameter, wallThickness, variant, openSide, marbleDiameter, units } = s
  const spec = tubeSpec(innerDiameter, wallThickness, variant, openSide)

  // Style and tube size are each a part's own, so the run only quotes one while
  // every part agrees on it — the same test the top bar used to make.
  const styles = new Set(pieces.map((p) => variantOf(p, variant)))
  const oneStyle = styles.size > 1 ? null : ([...styles][0] ?? variant)
  const sides = new Set(pieces.map((p) => openSideOf(p, openSide)))
  const oneSide = sides.size > 1 ? null : ([...sides][0] ?? openSide)
  const mixedTube = pieces.some((p) => !sizedLikeRun(p, innerDiameter, wallThickness))

  // Centreline length, so a bent part counts what it actually carries — and the
  // structure left out of it, having no channel for the marble to travel.
  const run = pieces.filter((p) => !isStructure(p))
  const total = run.reduce((a, p) => a + pieceAxisLength(p), 0)
  const chains = chainsOf(pieces).length
  const hidden = pieces.filter((p) => p.hidden).length

  // Squared to the world and measured to the outside of the tube, exactly as the
  // Measure tool reads it: the room the run actually needs.
  const box = partsBox(buildAssembly(pieces), null, (p) => pieceSpec(spec, p).outerR)
  const size = box
    ? `${coarseText(box.max.x - box.min.x, units)} × ${coarseText(box.max.z - box.min.z, units)} × ${formatCoarse(box.max.y - box.min.y, units)}`
    : '—'

  const ball = marbleFor(marbleDiameter, innerDiameter)
  const fits = innerDiameter >= boreForMarble(marbleDiameter)

  const counts = new Map<PieceType, number>()
  for (const p of pieces) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)

  const sections: Section[] = [
    {
      title: 'The run',
      rows: [
        { term: 'Project', value: s.projectName.trim() || UNTITLED_PROJECT },
        {
          term: 'Parts',
          value: `${pieces.length}`,
          note: hidden ? `${hidden} switched off in Active Parts` : undefined,
        },
        {
          term: 'Separate runs',
          value: `${chains}`,
          note:
            chains > 1
              ? 'the marble sets off down the first one in Active Parts'
              : 'everything on the stage is joined into one',
        },
        {
          term: 'Length',
          value: formatCoarse(total, units),
          note: 'down the centreline, so a bend counts what it carries; bases and rods are left out',
        },
        {
          term: 'Size',
          value: size,
          note: 'width × length × height — squared to the world, measured to the outside of the tube',
        },
      ],
    },
    {
      title: 'Tube',
      rows: mixedTube
        ? [
            {
              term: 'Bore and wall',
              value: 'Mixed',
              note: 'parts cut to different bores do not mate at the joint — the sizes below are what is on the stage',
              warn: true,
            },
            ...tubeSizes(pieces, innerDiameter, wallThickness, units),
          ]
        : [
            {
              term: 'Bore',
              value: formatLength(innerDiameter, units),
              note: 'what the marble rolls in',
            },
            { term: 'Wall', value: formatLength(wallThickness, units) },
            { term: 'Outer', value: formatLength(spec.outerR * 2, units) },
          ],
    },
    {
      title: 'Style',
      rows: [
        {
          term: 'Tube style',
          value: oneStyle === null ? 'Mixed styles' : VARIANT_LABEL[oneStyle],
        },
        ...(oneStyle === 'closed'
          ? []
          : [
              {
                term: 'Opens',
                value: oneSide ? OPEN_SIDE_LABEL[oneSide] : 'Mixed sides',
                note:
                  oneStyle === 'half'
                    ? 'a half pipe is a trough — the marble can leave through the open side'
                    : undefined,
              },
            ]),
      ],
    },
    {
      title: 'Marble',
      rows: [
        { term: 'Ball', value: ball ? ball.name : 'Custom', note: ball?.note },
        { term: 'Diameter', value: formatLength(marbleDiameter, units) },
        {
          term: 'Fit',
          value: fits
            ? `${lengthText(innerDiameter - marbleDiameter, units)} ${units} of slack in the bore`
            : 'Larger than the bore',
          note: fits
            ? undefined
            : `this ball wants a bore of ${formatLength(boreForMarble(marbleDiameter), units)} — fit the run to it in Settings`,
          warn: !fits,
        },
      ],
    },
  ]

  if (counts.size) {
    sections.push({
      title: 'What is on the stage',
      rows: [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => ({ term: PART_LABEL[type], value: `${n}` })),
    })
  }

  return sections
}

/** Every distinct bore and wall on the stage, with how many parts are cut to it. */
function tubeSizes(
  pieces: Piece[],
  runBore: number,
  runWall: number,
  units: Unit,
): Row[] {
  const seen = new Map<string, number>()
  for (const p of pieces) {
    const key = `${boreOf(p, runBore)}/${wallOf(p, runWall)}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen].map(([key, n]) => {
    const [bore, wall] = key.split('/').map(Number)
    return {
      term: `Ø${lengthText(bore, units)} bore / ${lengthText(wall, units)} wall`,
      value: `${n} part${n === 1 ? '' : 's'}`,
    }
  })
}

/**
 * The run's figures, behind one button in the top bar.
 *
 * They used to sit out on the bar as three chips, which is three lines of
 * measurement to read past on the way to everything else up there — and only
 * three, since the bar had no room for a fourth. Folded into a sheet they can be
 * as long as they are worth being, and the bar keeps its width for the controls.
 */
export default function ProjectDetails() {
  const [open, setOpen] = useState(false)
  // Subscribed to the whole store: every figure on the sheet is read off it, so
  // the sheet is live while it is up rather than a snapshot of when it opened.
  const s = useRun()
  const sections = useMemo(() => (open ? detailsFor(s) : null), [open, s])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <HoverHint
        label="Details"
        hint="Everything the run measures — its length and the room it needs, the tube it is cut from, the ball it is cut for, and a count of the parts on the stage."
      >
        <button className="details-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Details
        </button>
      </HoverHint>

      {open && sections && (
        <div className="help-backdrop" onClick={() => setOpen(false)}>
          <div
            className="help-sheet details-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Project details"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="help-head">
              <h3>Project Details</h3>
              <button
                className="help-close"
                onClick={() => setOpen(false)}
                aria-label="Close details"
              >
                ✕
              </button>
            </header>

            <div className="help-body">
              {sections.map((sec) => (
                <section key={sec.title} className="details-group">
                  <h4>{sec.title}</h4>
                  <dl>
                    {sec.rows.map((r) => (
                      <div key={r.term} className="details-row">
                        <dt>{r.term}</dt>
                        <dd className={r.warn ? 'warn' : undefined}>
                          {r.value}
                          {r.note && <em>{r.note}</em>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
