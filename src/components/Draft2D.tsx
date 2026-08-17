import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import HoverHint from './HoverHint'
import MouseLegend, { type MouseConfig } from './MouseLegend'
import RightDock from './RightDock'
import ActiveParts from './ActiveParts'
import UndoRedo from './UndoRedo'
import { FitIcon } from './icons'
import { crossSectionPath } from '../lib/geometry'
import { buildAssembly } from '../lib/layout'
import {
  VIEWS,
  VIEW_ORDER,
  EDGE_ON,
  dot3,
  headingOf,
  legReach,
  showsRun as showsRunFor,
} from '../lib/draftViews'
import {
  useRun,
  tubeSpec,
  angleSpec,
  cornerSpec,
  headingAt,
  isChainRoot,
  degLabel,
  pieceSpec,
  PIECE_LIMITS,
  slopeLimitsFor,
  bendLimitsFor,
  entrySwingLimitsFor,
  VARIANT_LABEL,
  type Piece,
  type DraftView,
} from '../store'
import { formatLength, lengthText } from '../lib/units'

/* ------------------------------------------------------------------ */
/* Shared drafting primitives                                          */
/* ------------------------------------------------------------------ */

function Defs({
  id,
  hatch = 6,
  grid = 5,
  lw = 1,
}: {
  id: string
  /** Hatch spacing, in this SVG's user units. */
  hatch?: number
  /** Grid pitch, in this SVG's user units. */
  grid?: number
  /** Line weight for the pattern strokes, in user units. */
  lw?: number
}) {
  return (
    <defs>
      <marker
        id={`${id}-arrow`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
      {/* Dimension terminator: a pipe square across the line, not an arrowhead.
          Square markerWidth/Height keeps the 10×10 viewBox from letterboxing. */}
      <marker
        id={`${id}-tick`}
        viewBox="0 0 10 10"
        refX="5"
        refY="5"
        markerWidth="9"
        markerHeight="9"
        orient="auto"
      >
        <line x1="5" y1="0.6" x2="5" y2="9.4" stroke="currentColor" strokeWidth="1.8" />
      </marker>
      <pattern
        id={`${id}-hatch`}
        width={hatch}
        height={hatch}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line className="hatch-line" x1="0" y1="0" x2="0" y2={hatch} strokeWidth={lw * 0.55} />
      </pattern>
      <pattern id={`${id}-grid`} width={grid} height={grid} patternUnits="userSpaceOnUse">
        <path
          className="grid-line"
          d={`M ${grid} 0 L 0 0 0 ${grid}`}
          fill="none"
          strokeWidth={lw * 0.4}
        />
      </pattern>
    </defs>
  )
}

/** Linear dimension drawn in screen space between two points. */
function Dim({
  x1,
  y1,
  x2,
  y2,
  label,
  markerId,
  off = 6,
  upright = false,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  markerId: string
  /** Text offset from the dimension line, in this SVG's user units. */
  off?: number
  /**
   * Keep the figure level however the dimension line runs, and set it clear
   * above the bar. A wall thickness is a bar a millimetre or two long: a number
   * turned along it reads sideways and lands on top of the line, so it is
   * lifted off the top end instead.
   */
  upright?: boolean
}) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  if (angle > 90 || angle < -90) angle += 180
  return (
    <g className="dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart={`url(#${markerId}-tick)`} markerEnd={`url(#${markerId}-tick)`} />
      {upright ? (
        <text x={mx} y={Math.min(y1, y2) - off}>
          {label}
        </text>
      ) : (
        <text x={mx} y={my} transform={`rotate(${angle} ${mx} ${my}) translate(0 ${-off})`}>
          {label}
        </text>
      )}
    </g>
  )
}

/**
 * Angular dimension at a connector's break, drawn in screen space.
 *
 * A bent part is called out by its deviation — how far the run turns off the
 * way it came in — and the arc that carries that number is swung between the
 * two legs' own radii: a line square across each leg, which meet at exactly the
 * angle the break turns through. Swinging it that way puts the arc out in clear
 * air off the corner, where an arc drawn between the legs themselves would be
 * buried in the tube for any bend shallower than a right angle.
 *
 * It is thrown on the far side of the run from the length bars, so the two
 * never sit on top of one another however the part is bent.
 */
function AngleDim({
  x,
  y,
  fromX,
  fromY,
  toX,
  toY,
  clear,
  label,
  markerId,
}: {
  /** The break itself. */
  x: number
  y: number
  /** Where the leg coming in starts. */
  fromX: number
  fromY: number
  /** Where the leg leaving ends. */
  toX: number
  toY: number
  /** How far the tube's wall reaches from the axis, in screen px. */
  clear: number
  label: string
  markerId: string
}) {
  const inLen = Math.hypot(x - fromX, y - fromY)
  const outLen = Math.hypot(toX - x, toY - y)
  // A leg the view has collapsed to a point has no direction to square off, so
  // it borrows the other's. There is no angle left on the paper then, and what
  // is left to draw is the number itself.
  const along =
    inLen > 1e-6
      ? { x: (x - fromX) / inLen, y: (y - fromY) / inLen }
      : outLen > 1e-6
        ? { x: (toX - x) / outLen, y: (toY - y) / outLen }
        : null
  if (!along) return null
  const leave = outLen > 1e-6 ? { x: (toX - x) / outLen, y: (toY - y) / outLen } : along
  // Square across each leg, on the side the length bars are not offset to.
  const ax = along.y
  const ay = -along.x
  const bx = leave.y
  const by = -leave.x
  // Signed, so the arc is swung the way the run actually breaks. Squaring both
  // legs off the same way leaves the angle between them the break's own.
  const swept = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
  const r = clear + 22

  // Under a few degrees on the paper there is no arc worth drawing: the view is
  // taking the break end-on. The number is still the part's, so it is stood off
  // the corner on its own.
  if (Math.abs(swept) < 0.05) {
    return (
      <g className="dim angle">
        <text
          x={x + ax * (r + 12)}
          y={y + ay * (r + 12)}
          dominantBaseline="middle"
          style={{ textAnchor: ax > 0.3 ? 'start' : ax < -0.3 ? 'end' : 'middle' }}
        >
          {label}
        </text>
      </g>
    )
  }

  const half = swept / 2
  // The bisector of the swept angle — where the caption sits, past both radii.
  const mx = ax * Math.cos(half) - ay * Math.sin(half)
  const my = ax * Math.sin(half) + ay * Math.cos(half)
  const lead = r + 12
  /** A radius, from just clear of the wall out to a little past the arc. */
  const spoke = (ux: number, uy: number) => ({
    x1: x + ux * (clear + 3),
    y1: y + uy * (clear + 3),
    x2: x + ux * (r + 9),
    y2: y + uy * (r + 9),
  })

  return (
    <g className="dim angle">
      <line className="ext" {...spoke(ax, ay)} />
      <line className="ext" {...spoke(bx, by)} />
      <path
        fill="none"
        d={`M ${x + ax * r} ${y + ay * r} A ${r} ${r} 0 0 ${swept > 0 ? 1 : 0} ${x + bx * r} ${y + by * r}`}
        markerStart={`url(#${markerId}-tick)`}
        markerEnd={`url(#${markerId}-tick)`}
      />
      <text
        x={x + mx * lead}
        y={y + my * lead}
        dominantBaseline="middle"
        style={{ textAnchor: mx > 0.3 ? 'start' : mx < -0.3 ? 'end' : 'middle' }}
      >
        {label}
      </text>
    </g>
  )
}

/**
 * Chevrons marching down a segment axis, pointing the way the marble rolls.
 * Drawn in screen space, so the spacing stays readable at any zoom.
 */
function FlowArrows({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
}) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  // Below a chevron's own footprint there is nothing useful to draw.
  if (len < 24) return null
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const count = clamp(Math.round(len / 56), 1, 10)
  const step = len / (count + 1)
  const a = 5.5 // half-length along the axis
  const w = 4.5 // half-width across it

  return (
    <g className="flow">
      {Array.from({ length: count }, (_, i) => {
        const t = step * (i + 1)
        const cx = x1 + ux * t
        const cy = y1 + uy * t
        const tx = cx + ux * a
        const ty = cy + uy * a
        const bx = cx - ux * a
        const by = cy - uy * a
        return (
          <polyline
            key={i}
            points={`${bx + nx * w},${by + ny * w} ${tx},${ty} ${bx - nx * w},${by - ny * w}`}
          />
        )
      })}
    </g>
  )
}

/**
 * The arrow that feeds into the first joint, or off the end of the last one.
 * `ux`/`uy` are the downstream direction in screen space.
 */
function FlowCap({
  x,
  y,
  ux,
  uy,
  kind,
  markerId,
}: {
  x: number
  y: number
  ux: number
  uy: number
  kind: 'in' | 'out'
  markerId: string
}) {
  const gap = 9
  const len = 32
  // The inlet arrow arrives from upstream; the outlet one carries on downstream.
  const sign = kind === 'in' ? -1 : 1
  const near = kind === 'in' ? gap + len : gap
  const far = kind === 'in' ? gap : gap + len
  const x1 = x + ux * sign * near
  const y1 = y + uy * sign * near
  const x2 = x + ux * sign * far
  const y2 = y + uy * sign * far
  // Park the caption past the tail so the arrow itself stays clear.
  const lx = x + ux * sign * (kind === 'in' ? near + 8 : far + 8)
  const ly = y + uy * sign * (kind === 'in' ? near + 8 : far + 8)
  const away = lx - x
  const anchor = away > 4 ? 'start' : away < -4 ? 'end' : 'middle'

  return (
    <g className={`flow-cap ${kind}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={`url(#${markerId}-arrow)`} />
      <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle">
        {kind === 'in' ? 'START' : 'END'}
      </text>
    </g>
  )
}

/* ------------------------------------------------------------------ */
/* Front face / cross-section                                          */
/* ------------------------------------------------------------------ */

function CrossSection() {
  const { innerDiameter, wallThickness, variant, marbleDiameter, pieces, selectedId, units } =
    useRun()
  // Bore, wall and style are each a part's own, so the front face is the section
  // of the selected part — and the run's own tube whenever nothing is picked.
  const selected = pieces.find((p) => p.id === selectedId)
  const run = tubeSpec(innerDiameter, wallThickness, variant)
  const spec = selected ? pieceSpec(run, selected) : run
  const style = spec.variant
  const marbleR = marbleDiameter / 2
  const openDeg = Math.round(360 - (spec.sweep * 180) / Math.PI)

  // Everything is drawn in a normalised 100-unit-wide frame so that text and
  // line weights stay legible whatever the tube size. `k` converts mm to units.
  const R = spec.outerR
  const pad = R * 0.55 + 6
  const halfW = R + pad * 1.35
  const k = 50 / halfW
  const u = (mm: number) => mm * k

  const top = -(R + pad * 1.1) * k
  const dimY1 = u(R + pad * 0.5)
  const dimY2 = u(R + pad * 1.05)
  const wallX = -u(R + pad * 0.85)
  const bottom = dimY2 + u(pad * 0.55)
  const ri = u(spec.innerR)
  const ro = u(R)
  const path = crossSectionPath(spec, k)

  // The frame the section is drawn in, before any zoom.
  const frameH = bottom - top
  const frameCy = top + frameH / 2

  /**
   * Where the scroll wheel has taken the view: how far in, and how far the
   * middle of what is shown has moved off the middle of the frame. Both are
   * held in the section's own units and relative to the frame, so a tube that
   * resizes under the view — another part picked, a bore typed — keeps whatever
   * you were looking at rather than jumping.
   */
  const [view, setView] = useState({ z: 1, dx: 0, dy: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const vw = 100 / view.z
  const vh = frameH / view.z

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const z = clamp(view.z * Math.exp(-e.deltaY * 0.0015), 1, 12)
    // All the way back out is the frame itself, however far the view wandered
    // while it was in.
    if (z === 1) return setView({ z: 1, dx: 0, dy: 0 })
    // Whatever sits under the pointer is what has to stay under it.
    const fx = (e.clientX - rect.left) / rect.width - 0.5
    const fy = (e.clientY - rect.top) / rect.height - 0.5
    const ux = view.dx + fx * vw
    const uy = view.dy + fy * vh
    setView({ z, dx: ux - (fx * 100) / z, dy: uy - (fy * frameH) / z })
  }

  // Only worth dragging once there is something off-frame to drag into view.
  const onPointerDown = (e: React.PointerEvent) => {
    if (view.z === 1 || e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const rect = svgRef.current?.getBoundingClientRect()
    if (!d || !rect) return
    // The drawing follows the pointer, so the frame moves against it.
    setView({
      z: view.z,
      dx: clamp(d.dx - ((e.clientX - d.x) / rect.width) * vw, -50, 50),
      dy: clamp(d.dy - ((e.clientY - d.y) / rect.height) * vh, -frameH / 2, frameH / 2),
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div className="draft-wrap section-sheet">
      {/* The same row the assembly draft carries, in the same place: switching
          tabs changes the drawing, not where the tools are. Only the ones this
          drawing has any use for are on it. */}
      <div className="draft-toolbar">
        <span className="spacer" />
        <UndoRedo />
        <button
          className="view-tool"
          onClick={() => setView({ z: 1, dx: 0, dy: 0 })}
          title="Fit view — frame the whole section"
          aria-label="Fit view"
        >
          <FitIcon />
        </button>
      </div>
      <div className="section-stage">
        <svg
          ref={svgRef}
          className={view.z > 1 ? 'section-svg zoomed' : 'section-svg'}
          viewBox={`${view.dx - vw / 2} ${frameCy + view.dy - vh / 2} ${vw} ${vh}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => setView({ z: 1, dx: 0, dy: 0 })}
        >
          <Defs id="xs" hatch={1.6} grid={u(5)} lw={0.5} />
          <rect x={-50} y={top} width={100} height={bottom - top} fill="url(#xs-grid)" />

          {/* Centre lines */}
          <g className="centerline">
            <line x1={-ro * 1.4} y1={0} x2={ro * 1.4} y2={0} />
            <line x1={0} y1={-ro * 1.4} x2={0} y2={ro * 1.4} />
          </g>

          {/* Marble fit ghost */}
          <circle className="ghost-marble" cx={0} cy={u(spec.innerR - marbleR)} r={u(marbleR)} />

          {/* Section */}
          <path className="section" d={path} fillRule="evenodd" fill="url(#xs-hatch)" />
          <path className="section-outline" d={path} fillRule="evenodd" />

          {/* Diameters */}
          <g className="ext">
            <line x1={-ri} y1={0} x2={-ri} y2={dimY1 + 1.5} />
            <line x1={ri} y1={0} x2={ri} y2={dimY1 + 1.5} />
            <line x1={-ro} y1={0} x2={-ro} y2={dimY2 + 1.5} />
            <line x1={ro} y1={0} x2={ro} y2={dimY2 + 1.5} />
          </g>
          <Dim
            markerId="xs"
            x1={-ri}
            y1={dimY1}
            x2={ri}
            y2={dimY1}
            label={formatLength(spec.innerR * 2, units)}
            off={1.4}
          />
          <Dim
            markerId="xs"
            x1={-ro}
            y1={dimY2}
            x2={ro}
            y2={dimY2}
            label={formatLength(R * 2, units)}
            off={1.4}
          />

          {/* Wall thickness, taken at the bottom of the section */}
          <g className="ext">
            <line x1={0} y1={ri} x2={wallX - 1.5} y2={ri} />
            <line x1={0} y1={ro} x2={wallX - 1.5} y2={ro} />
          </g>
          <Dim
            markerId="xs"
            x1={wallX}
            y1={ri}
            x2={wallX}
            y2={ro}
            label={`t ${formatLength(spec.wall, units)}`}
            off={1.4}
            upright
          />

          {/* Opening callout */}
          <text className="callout" x={0} y={top + 5} textAnchor="middle">
            {spec.closed ? 'Closed tube — 360° wall' : `${openDeg}° open — ${VARIANT_LABEL[style]}`}
          </text>
        </svg>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Assembly draft                                                      */
/* ------------------------------------------------------------------ */

interface Pt {
  x: number
  y: number
}


/**
 * A part as drawn: its axis, in whichever coordinates the current view uses,
 * and the dimension called out beside it. A straight part is two points; a bent
 * one carries a point per chord of its bend.
 */
interface DraftPart {
  id: string
  index: number
  points: Pt[]
  /** Which run this part belongs to — parts joined together share one polyline. */
  chain: number
  /** Where this part's first point sits in that run's own polyline. */
  from: number
  /** False when the part's eye is off in the parts list — it holds its place but is not drawn. */
  shown: boolean
  /**
   * The sharp corner a bent part turns about, in the same coordinates as
   * `points` — null on a straight one. A rounded break is still measured to the
   * corner it was rounded off, which is what the part's leg lengths are given to.
   */
  breakAt: Pt | null
  /**
   * A caption per leg, called out along the leg itself: one on a plain tube,
   * one either side of the break on a connector.
   */
  legs: string[]
  /** What the break is called out as — how far it turns, and the radius it is rounded to. */
  angle: string | null
}

/**
 * A draggable joint. Which piece field the drag writes depends on where the
 * joint sits: a part's outlet swings the whole part, while the break in an
 * angle connector swings only the leg after it — the entry leg is what makes
 * the connector rigid against the part before it.
 */
interface Grip {
  key: string
  id: string
  /**
   * Which end of the leg this handle is on. A tail handle holds the joint
   * behind it and swings the run downstream; a head handle holds the joint
   * ahead of it — the break on a connector — and brings the run upstream round
   * with it, so the pivot and everything past it stay put.
   */
  grab: 'tail' | 'head'
  /** Where the handle is drawn. */
  x: number
  y: number
  /** The fixed point the drag angle is measured from. */
  ox: number
  oy: number
  /**
   * Where the stretch is measured from, when that is not the angle's own pivot.
   * A connector's outgoing leg swings the whole part about its start but is
   * itself measured from the break. Unset means the two are the same point.
   */
  lx?: number
  ly?: number
  /** What the drag angle sets, or null on a handle that only stretches its leg. */
  angleField: 'slope' | 'bend' | 'turn' | 'sweep' | null
  /** How far that angle may go — narrowed to what the rest of the run can take. */
  angleLimits: { min: number; max: number; step: number }
  /** What the drag stretches, if there is anything sensible to stretch. */
  lengthField: 'length' | 'exitLength' | null
  /**
   * Drawn length of this leg ÷ its true length. Only a stretch-only handle
   * needs it: with no angle to follow, the leg keeps the direction it is drawn
   * in, so one number puts the view's foreshortening back.
   */
  foreshorten?: number
  /** Pitch of the leg being stretched — a plan drag only shows its horizontal run. */
  pitch: number
  /**
   * How much of this leg's horizontal run the view shows: 1 square-on, 0
   * end-on, negative when the view has the run going the other way. An
   * elevation drag divides it back out, so a leg heading across the view still
   * reads its true slope for as long as the view shows any of it.
   */
  showsRun: number
  /** The view takes this leg end-on: there is no angle in the drawing to drag. */
  edgeOn: boolean
  /** Heading in radians before this part's own turn is applied. */
  yawPrev: number
  /**
   * The angle a connector's break is measured off: the entry slope for a bend
   * in elevation, the entry heading for a sweep in plan. Degrees either way.
   */
  base: number
  /**
   * Head handles only: hold the connector's outgoing leg where it is, so the
   * break gives back whatever the entry leg takes and it is the one point in
   * the drawing that does not move.
   */
  holdExit: boolean
  title: string
}

const DEG = 180 / Math.PI
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const snapTo = (v: number, step: number) => Math.round(v / step) * step
/** Fold an angle in degrees into (-180, 180]. */
const wrapDeg = (d: number) => d - 360 * Math.round(d / 360)

/** How far a mitre may run out at a sharp corner before it is cut off square. */
const MITRE_LIMIT = 4

/**
 * How far a head handle is stood off its joint, in screen px. A part's head sits
 * exactly where the part before it ends, so the two handles would land on top of
 * one another; standing the head handle off along its own leg keeps both
 * grabbable and says which part each one swings.
 */
const HEAD_STANDOFF = 15

/**
 * A handle on a leg this view holds no angle for: a corner's outgoing leg seen
 * side-on, or an angle connector's entry leg seen from above. Both are rigid in
 * that view, so there is nothing to swing — but the leg is drawn full length,
 * and dragging its end along that line is exactly a resize.
 *
 * Null when the view draws that leg down to nothing: there is no line left to
 * slide along, and a handle there would only sit on top of the round one at the
 * joint it has collapsed onto and swallow its presses.
 */
function stretchGrip(
  id: string,
  key: string,
  from: Pt,
  to: Pt,
  field: 'length' | 'exitLength',
  trueLen: number,
  title: string,
): Grip | null {
  const drawn = Math.hypot(to.x - from.x, to.y - from.y)
  const foreshorten = trueLen > 1e-6 ? drawn / trueLen : 0
  if (foreshorten < EDGE_ON) return null
  return {
    id,
    key,
    grab: 'tail',
    x: to.x,
    y: to.y,
    ox: from.x,
    oy: from.y,
    angleField: null,
    // Nothing reads these on a stretch-only handle; the leg's own limits stand
    // in so the shape of a Grip stays the one shape.
    angleLimits: PIECE_LIMITS[field],
    lengthField: field,
    foreshorten,
    pitch: 0,
    showsRun: 1,
    // A leg too foreshortened to pull on never gets a handle in the first place,
    // so the one that is here is always live.
    edgeOn: false,
    yawPrev: 0,
    base: 0,
    holdExit: false,
    title,
  }
}

/**
 * A path parallel to `pts`, offset sideways by `r` model mm — negative goes the
 * other way. Corners are mitred, so a bent part draws as one continuous wall
 * rather than a stack of overlapping rectangles.
 */
function offsetPath(pts: Pt[], r: number): Pt[] {
  // A chord the view has collapsed to a point faces nowhere of its own, so it
  // borrows the nearest chord that does. Left to face nowhere it would read as
  // square to its neighbour, and the corner between them would run all the way
  // out to the mitre limit — a dimension line shooting off across the paper.
  const faces: (Pt | null)[] = []
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    const len = Math.hypot(dx, dy)
    faces.push(len > 1e-9 ? { x: -dy / len, y: dx / len } : null)
  }
  for (let i = 1; i < faces.length; i++) faces[i] ??= faces[i - 1]
  for (let i = faces.length - 2; i >= 0; i--) faces[i] ??= faces[i + 1]
  // Every point of the path is the same point: there is no path to run beside.
  if (!faces[0]) return pts.map((p) => ({ ...p }))
  const normals = faces as Pt[]

  return pts.map((p, i) => {
    const a = normals[i - 1]
    const b = normals[i]
    const n = a && b ? { x: a.x + b.x, y: a.y + b.y } : (a ?? b)
    const len = Math.hypot(n.x, n.y)
    if (len < 1e-9) return { x: p.x + (a ?? b).x * r, y: p.y + (a ?? b).y * r }
    const ux = n.x / len
    const uy = n.y / len
    // The mitre runs out as 1/cos of the half-angle between the two edges.
    const cos = a && b ? ux * a.x + uy * a.y : 1
    const reach = r / Math.max(Math.abs(cos), 1 / MITRE_LIMIT)
    return { x: p.x + ux * reach, y: p.y + uy * reach }
  })
}

/**
 * Mouse bindings for the drafting canvas. Flat paper has nothing to orbit, so
 * both the right button and the wheel click pan; the left button is left to
 * picking and editing joints. `joint` names whichever angle a handle drag edits
 * in the current view.
 */
const draftMouse = (joint: string): MouseConfig => ({
  buttons: { left: 'Select', right: 'Pan', wheel: 'Pan' },
  scroll: 'Zoom',
  hints: [
    ['left-click', 'select part'],
    ['click empty', 'deselect'],
    ['right-drag', 'pan'],
    ['middle-drag', 'pan'],
    ['scroll', 'zoom'],
    ['drag joint', `${joint} + length`],
    ['drag ring', 'swing from the head'],
    ['drag square', 'length only'],
    ['shift-drag', 'snap 5° / 5mm'],
    ['alt-drag', 'angle only'],
    ['esc', 'cancel drag'],
  ],
})

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}

/** `shifted` steps the corner captions aside when the settings panel is out. */
function AssemblyDraft({ shifted }: { shifted: boolean }) {
  const {
    pieces,
    innerDiameter,
    wallThickness,
    variant,
    draftView,
    setDraftView,
    selectedId,
    select,
    updatePiece,
    swingHead,
    restoreDrag,
    screenPxPerMm,
    screenCalibrated,
    keepConnected,
    setKeepConnected,
    units,
  } = useRun()
  // The tube the run is cut from — what a part with no size of its own follows.
  const spec = useMemo(
    () => tubeSpec(innerDiameter, wallThickness, variant),
    [innerDiameter, wallThickness, variant],
  )
  const proj = VIEWS[draftView]
  const { ref, size } = useSize<HTMLDivElement>()
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; panning: boolean } | null>(null)
  const handle = useRef<Grip | null>(null)
  /**
   * Where a head drag's pivot sits on the glass. The pivot moves through the
   * model as the run ahead of it swings, so the drawing is slid back under it
   * every frame — and the drag itself is measured from this fixed point rather
   * than from a model position that is out of date the moment it is read.
   */
  const pinned = useRef<{ x: number; y: number } | null>(null)
  /** The run and the framing as they stood when the handle was grabbed. */
  const before = useRef<{ pieces: Piece[]; tx: number; ty: number } | null>(null)
  const [grabbed, setGrabbed] = useState<string | null>(null)

  const { parts, chains, grips } = useMemo(() => {
    const asm = buildAssembly(pieces)
    const flat = proj.developed === true
    const parts: DraftPart[] = []
    const grips: Grip[] = []
    // Developed elevation: x is horizontal run, so every turn is flattened out
    // of the drawing and the run reads as one continuous side-on section. Every
    // other view lays the world down on the page along its own two axes.
    let developed = 0
    const at = (w: { x: number; y: number; z: number }, run: number): Pt => ({
      x: flat ? run : dot3(w, proj.right),
      y: dot3(w, proj.down),
    })
    const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(b.x - a.x, b.z - a.z)

    for (const p of asm.placed) {
      const piece = p.piece
      const angle = piece.type === 'angle'
      const corner = piece.type === 'corner'
      // A hidden part is still laid out — it holds the run's shape either side
      // of it — it is simply not drawn, and has no handles to grab.
      const shown = !piece.hidden
      const a = angleSpec(piece)
      const c = cornerSpec(piece)

      const points: Pt[] = []
      for (const [i, seg] of p.segments.entries()) {
        if (i === 0) points.push(at(seg.start, developed))
        developed += seg.length * Math.cos(seg.pitch)
        points.push(at(seg.end, developed))
      }
      if (points.length < 2) continue

      const startX = points[0].x
      const startY = points[0].y
      const last = points[points.length - 1]
      // A part joined onto another picks up on the joint that one ended at, so a
      // run is one polyline and its parts are windows onto it. A part standing on
      // its own starts a polyline of its own instead.
      const previous = parts[parts.length - 1]
      const root = isChainRoot(pieces, p.index)
      // The break, wherever the view has put it.
      const breakAt = p.corner
        ? flat
          ? { x: startX + horizontal(p.start, p.corner), y: dot3(p.corner, proj.down) }
          : at(p.corner, 0)
        : null
      // The two legs of a connector, whichever kind of break it turns about.
      // Both are measured to the sharp corner, rounded or not.
      const bent = angle
        ? { entry: a.entry, exit: a.exit, turn: a.bend, fillet: a.fillet }
        : corner
          ? { entry: c.entry, exit: c.exit, turn: c.sweep, fillet: c.fillet }
          : null
      // A part is dimensioned leg by leg, so a bend reads as two lengths meeting
      // at an angle rather than as one bar spanning a corner it never follows.
      const slope = `∠${degLabel(piece.slope)}°`
      parts.push({
        id: piece.id,
        index: p.index,
        points,
        chain: previous ? previous.chain + (root ? 1 : 0) : 0,
        from: previous && !root ? previous.from + previous.points.length - 1 : 0,
        shown,
        breakAt: bent ? breakAt : null,
        legs:
          bent && breakAt
            ? [`${formatLength(bent.entry, units)}  ${slope}`, formatLength(bent.exit, units)]
            : [
                `${formatLength(bent ? bent.entry : piece.length, units)}  ${slope}${piece.turn ? `  ↻${degLabel(piece.turn)}°` : ''}`,
              ],
        // The glyph the bar used to carry is the arc's job now.
        angle: bent
          ? `${degLabel(bent.turn)}°${bent.fillet ? `  r${lengthText(bent.fillet, units)}` : '  sharp'}`
          : null,
      })

      const yawPrev = p.yaw - (piece.turn * Math.PI) / 180
      // How much of this part's horizontal run the view shows. A developed
      // elevation shows all of it by construction; a view taking the part
      // across itself shows a fraction, and one taking it end-on shows none.
      const showsRun = showsRunFor(proj, p.yaw)
      /** Whether a leg at `pitch` has an angle in this drawing worth dragging. */
      const edgeOnAt = (pitch: number) =>
        proj.plan ? Math.abs(Math.cos(pitch)) < EDGE_ON : Math.abs(showsRun) < EDGE_ON
      const common = {
        id: piece.id,
        pitch: p.pitch,
        yawPrev,
        // A sweep is measured off the heading the corner entered at, the way a
        // bend is measured off the slope it entered at.
        base: corner ? p.yaw * DEG : piece.slope,
        holdExit: false,
        showsRun,
        edgeOn: edgeOnAt(p.pitch),
      }

      if (!shown) continue

      if (proj.plan) {
        if (corner && breakAt) {
          const cornerX = breakAt.x
          const cornerY = breakAt.y
          // The pitch the outgoing leg actually leaves at — a corner turning
          // across the fall comes out shallower than it went in, and the plan
          // shows any leg foreshortened by its own pitch.
          const exitPitch = p.segments[p.segments.length - 1]?.pitch ?? p.pitch
          // The start: the break holds still and the entry leg swings about it,
          // so the sweep takes back whatever the entry gives and the outgoing
          // leg — with the whole run past it — never moves.
          grips.push({
            ...common,
            key: `${piece.id}:head`,
            grab: 'head',
            x: startX,
            y: startY,
            ox: cornerX,
            oy: cornerY,
            angleField: 'turn',
            angleLimits: PIECE_LIMITS.turn,
            lengthField: 'length',
            holdExit: true,
            title: `Drag the start to swing the entry leg about the break (turning ${degLabel(piece.turn)}° in)`,
          })
          // The entry leg: rigid against the part before it, so swinging it is
          // the same edit as swinging a plain tube.
          grips.push({
            ...common,
            key: `${piece.id}:break`,
            grab: 'tail',
            x: cornerX,
            y: cornerY,
            ox: startX,
            oy: startY,
            angleField: 'turn',
            angleLimits: PIECE_LIMITS.turn,
            lengthField: 'length',
            title: `Drag to set turn (${degLabel(piece.turn)}°)`,
          })
          // The outlet: only the leg past the break moves, which is the sweep.
          grips.push({
            ...common,
            key: piece.id,
            grab: 'tail',
            x: last.x,
            y: last.y,
            ox: cornerX,
            oy: cornerY,
            pitch: exitPitch,
            edgeOn: edgeOnAt(exitPitch),
            angleField: 'sweep',
            angleLimits: PIECE_LIMITS.sweep,
            lengthField: 'exitLength',
            title: `Drag to set sweep (${degLabel(c.sweep)}°, turning ${c.sweep < 0 ? 'left' : 'right'})`,
          })
          continue
        }
        // Plan shows only the heading, so one handle per end swings the lot.
        grips.push({
          ...common,
          key: piece.id,
          grab: 'tail',
          x: last.x,
          y: last.y,
          ox: startX,
          oy: startY,
          // An angle connector's two legs run along one line up here, so the end
          // handle stretches the leg it actually sits on — measured from the
          // break, not from the start of the part.
          ...(angle && breakAt
            ? {
                lx: breakAt.x,
                ly: breakAt.y,
                pitch: p.segments[p.segments.length - 1]?.pitch ?? p.pitch,
              }
            : null),
          angleField: 'turn',
          angleLimits: PIECE_LIMITS.turn,
          lengthField: angle ? 'exitLength' : 'length',
          title: angle
            ? `Drag to set turn (${degLabel(piece.turn)}°) and stretch the exit leg`
            : `Drag to set turn (${degLabel(piece.turn)}°)`,
        })
        grips.push({
          ...common,
          key: `${piece.id}:head`,
          grab: 'head',
          x: startX,
          y: startY,
          ox: last.x,
          oy: last.y,
          angleField: 'turn',
          angleLimits: PIECE_LIMITS.turn,
          // Swinging from the head reaches the far end of the part, which on a
          // connector spans both legs — the break handle is what stretches the
          // entry leg from up here.
          lengthField: angle ? null : 'length',
          title: 'Drag the start to swing this part about its end — the run ahead comes with it',
        })
        // The break is rigid in plan — an angle connector bends in elevation, not
        // across — so the handle there does the one thing left: the entry leg.
        if (angle && breakAt) {
          const entry = stretchGrip(
            piece.id,
            `${piece.id}:break`,
            { x: startX, y: startY },
            breakAt,
            'length',
            a.entry,
            `Drag the break to stretch the entry leg (${lengthText(a.entry, units)})`,
          )
          if (entry) grips.push(entry)
        }
        continue
      }

      if (angle && breakAt) {
        const cornerX = breakAt.x
        const cornerY = breakAt.y
        // The start: the break holds still and the entry leg swings about it,
        // so the bend takes back whatever the entry gives and the outgoing leg
        // — with the whole run past it — never moves.
        grips.push({
          ...common,
          key: `${piece.id}:head`,
          grab: 'head',
          x: startX,
          y: startY,
          ox: cornerX,
          oy: cornerY,
          angleField: 'slope',
          angleLimits: entrySwingLimitsFor(piece),
          lengthField: 'length',
          holdExit: true,
          title: `Drag the start to swing the entry leg about the break (entering at ${degLabel(piece.slope)}°)`,
        })
        // The entry leg: rigid against the part before it, so swinging it is
        // the same edit as swinging a plain tube.
        grips.push({
          ...common,
          key: `${piece.id}:break`,
          grab: 'tail',
          x: cornerX,
          y: cornerY,
          ox: startX,
          oy: startY,
          angleField: 'slope',
          angleLimits: slopeLimitsFor(piece),
          lengthField: 'length',
          title: `Drag to set the entry slope (${degLabel(piece.slope)}°)`,
        })
        // The outlet: only the leg past the break moves, which is the bend.
        grips.push({
          ...common,
          key: piece.id,
          grab: 'tail',
          x: last.x,
          y: last.y,
          ox: cornerX,
          oy: cornerY,
          angleField: 'bend',
          angleLimits: bendLimitsFor(piece),
          lengthField: 'exitLength',
          title: `Drag to set bend (${degLabel(a.bend)}°, leaving at ${degLabel(piece.slope + a.bend)}°)`,
        })
      } else {
        grips.push({
          ...common,
          key: `${piece.id}:head`,
          grab: 'head',
          x: startX,
          y: startY,
          ox: last.x,
          oy: last.y,
          angleField: 'slope',
          angleLimits: PIECE_LIMITS.slope,
          lengthField: 'length',
          title: 'Drag the start to swing this part about its end — the run ahead comes with it',
        })
        // A corner is rigid in elevation — its sweep is a plan edit — so the
        // slope handle sits on the break, where the leg it actually sets ends.
        // Past the break the run has turned, and a leg that has turned no
        // longer draws its own slope in this drawing.
        const tail = corner && breakAt ? breakAt : last
        grips.push({
          ...common,
          key: piece.id,
          grab: 'tail',
          x: tail.x,
          y: tail.y,
          ox: startX,
          oy: startY,
          angleField: 'slope',
          angleLimits: slopeLimitsFor(piece),
          lengthField: 'length',
          title: corner
            ? `Drag to set the entry slope (${degLabel(piece.slope)}°)`
            : `Drag to set slope (${degLabel(piece.slope)}°)`,
        })
        // Past a corner's break the run has turned, and a leg that has turned
        // draws no slope of its own here — but it draws its full length, so the
        // end of it is still the place to pull that leg longer or shorter.
        if (corner && breakAt) {
          const exit = stretchGrip(
            piece.id,
            `${piece.id}:exit`,
            breakAt,
            last,
            'exitLength',
            c.exit,
            `Drag the end to stretch the exit leg (${lengthText(c.exit, units)})`,
          )
          if (exit) grips.push(exit)
        }
      }
    }

    // The joint between two parts is one point, not two — walls offset from this
    // mitre at every joint alike, so nothing gaps or overlaps where parts meet.
    // Two parts that are not joined share no such point, so each run is gathered
    // on its own and offset on its own.
    const chains: Pt[][] = []
    for (const part of parts) {
      const line = (chains[part.chain] ??= [])
      line.push(...(part.from === 0 ? part.points : part.points.slice(1)))
    }

    return { parts, chains, grips }
  }, [pieces, draftView])

  /**
   * A part's walls and bore. Each run is offset along the whole of it, once per
   * radius actually used on it: parts cut from the same tube share the offset,
   * so the joints between them still mitre to one point and are drawn exactly
   * once, while a part sized on its own gets a wall of its own — which simply
   * steps at the joint, because that is what a change of bore between two parts
   * really does.
   */
  const walls = useMemo(() => {
    const sizes = new Map(pieces.map((p) => [p.id, pieceSpec(spec, p)]))
    const cache = chains.map(() => new Map<number, [Pt[], Pt[]]>())
    const offsetAt = (chain: number, r: number): [Pt[], Pt[]] | null => {
      const line = chains[chain]
      if (!line || line.length < 2) return null
      let pair = cache[chain].get(r)
      if (!pair) {
        pair = [offsetPath(line, r), offsetPath(line, -r)]
        cache[chain].set(r, pair)
      }
      return pair
    }
    return (part: DraftPart) => {
      const own = sizes.get(part.id)
      if (!own) return null
      const outer = offsetAt(part.chain, own.outerR)
      const bore = offsetAt(part.chain, own.innerR)
      return outer && bore ? { outer, bore, outerR: own.outerR } : null
    }
  }, [chains, pieces, spec])

  /** The fattest part on the paper — what the framing has to leave room for. */
  const outerReach = useMemo(
    () => pieces.reduce((r, p) => Math.max(r, pieceSpec(spec, p).outerR), spec.outerR),
    [pieces, spec],
  )

  /** Only the parts whose eye is on — what the drawing is actually about. */
  const visible = useMemo(() => parts.filter((p) => p.shown), [parts])

  const fit = useCallback(() => {
    const pts = visible.flatMap((p) => p.points)
    if (!pts.length) {
      setView({ scale: 1, tx: size.w / 2, ty: size.h / 2 })
      return
    }
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const m = outerReach + 26
    const minX = Math.min(...xs) - m
    const maxX = Math.max(...xs) + m
    const minY = Math.min(...ys) - m
    const maxY = Math.max(...ys) + m
    const scale = Math.min(size.w / (maxX - minX), size.h / (maxY - minY)) * 0.88
    setView({
      scale,
      tx: size.w / 2 - ((minX + maxX) / 2) * scale,
      ty: size.h / 2 - ((minY + maxY) / 2) * scale,
    })
  }, [visible, size.w, size.h, outerReach])

  // Re-framed when the drawn set changes, so switching parts off zooms in on
  // whatever is left rather than leaving it adrift in the old frame.
  useEffect(fit, [size.w, size.h, draftView, pieces.length, visible.length])

  /**
   * True physical size: one model mm becomes one real mm on the glass. Zooms
   * about the canvas centre so whatever you were studying stays put.
   */
  const actualSize = useCallback(() => {
    setView((v) => {
      const cx = size.w / 2
      const cy = size.h / 2
      const r = screenPxPerMm / v.scale
      return { scale: screenPxPerMm, tx: cx - (cx - v.tx) * r, ty: cy - (cy - v.ty) * r }
    })
  }, [screenPxPerMm, size.w, size.h])

  const px = (x: number) => x * view.scale + view.tx
  const py = (y: number) => y * view.scale + view.ty

  const onWheel = (e: React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const k = Math.exp(-e.deltaY * 0.0015)
    const scale = Math.min(24, Math.max(0.08, view.scale * k))
    const r = scale / view.scale
    setView({ scale, tx: mx - (mx - view.tx) * r, ty: my - (my - view.ty) * r })
  }

  /** Pointer → a point on the canvas, in the same px the drawing is laid out in. */
  const toCanvas = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect()
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null
  }

  /** Screen point → model mm, in the current view's coordinates. */
  const toModel = (clientX: number, clientY: number) => {
    const c = toCanvas(clientX, clientY)
    return c ? { x: (c.x - view.tx) / view.scale, y: (c.y - view.ty) / view.scale } : null
  }

  const onHandleDown = (e: React.PointerEvent, grip: Grip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    // A leg the view takes end-on has no angle in the drawing to grab, so the
    // handle only picks the part — it is the view that has to change.
    if (grip.edgeOn) return select(grip.id)
    ref.current?.setPointerCapture(e.pointerId)
    handle.current = grip
    // A head drag pins its pivot where it is on the glass; a tail drag leaves
    // the framing alone, because its pivot does not move in the first place.
    pinned.current = grip.grab === 'head' ? { x: px(grip.ox), y: py(grip.oy) } : null
    before.current = { pieces: useRun.getState().pieces, tx: view.tx, ty: view.ty }
    setGrabbed(grip.key)
    select(grip.id)
  }

  /**
   * Drag a part by its head: the far end of the leg holds still on the glass and
   * the part swings about it, bringing the run ahead of it round as it goes.
   * Measured in canvas px from the pinned pivot, so the drawing sliding under
   * the pointer never feeds back into the angle being read.
   */
  const dragHead = (h: Grip, e: React.PointerEvent) => {
    const pivot = pinned.current
    const c = toCanvas(e.clientX, e.clientY)
    if (!pivot || !c) return
    // From the pivot back to the pointer, so the leg reads the way it is drawn:
    // the head lies behind the pivot, not in front of it.
    const dx = pivot.x - c.x
    const dy = pivot.y - c.y
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-3) return
    const pieces = useRun.getState().pieces
    const at = pieces.findIndex((p) => p.id === h.id)
    if (at < 0) return

    const A = h.angleLimits
    const step = e.shiftKey ? 5 : A.step
    let delta: number
    if (h.angleField === 'turn') {
      // Plan: every turn up to this part — and every corner swung through on
      // the way — add up to where it points.
      delta = wrapDeg(snapTo(headingOf(proj, dx, dy), step) - headingAt(pieces, at))
    } else {
      const { forward, drop } = legReach(h.showsRun, dx, dy)
      delta = clamp(snapTo(Math.atan2(drop, forward) * DEG, step), A.min, A.max) - pieces[at].slope
    }

    // The handle follows the pointer, so the leg takes its length from where the
    // pointer is as well as its angle. Alt pins the length and leaves a pure
    // swing, which is what a joint drag used to be.
    let patch: Partial<Piece> | undefined
    if (!e.altKey && h.lengthField) {
      const L = PIECE_LIMITS[h.lengthField]
      const mm = dist / view.scale
      let reach = mm
      if (h.angleField === 'turn') {
        // The plan only shows the horizontal run, so divide the pitch back out.
        const cos = Math.cos(h.pitch)
        if (cos > 1e-3) reach = mm / cos
      } else {
        const { forward, drop } = legReach(h.showsRun, dx / view.scale, dy / view.scale)
        reach = Math.hypot(forward, drop)
      }
      patch = { [h.lengthField]: clamp(snapTo(reach, e.shiftKey ? 5 : L.step), L.min, L.max) }
    }

    swingHead(h.id, h.angleField === 'turn' ? 'turn' : 'slope', delta, {
      holdExit: h.holdExit,
      patch,
    })
  }

  /**
   * A handle with no angle in this view to follow: the leg keeps the direction
   * it is drawn in, and only how far the pointer has come along that line
   * counts — with the view's foreshortening divided back out of it.
   */
  const stretchLeg = (h: Grip, m: Pt, e: React.PointerEvent) => {
    if (!h.lengthField || !h.foreshorten) return
    const ox = h.lx ?? h.ox
    const oy = h.ly ?? h.oy
    const ax = h.x - ox
    const ay = h.y - oy
    const len = Math.hypot(ax, ay)
    if (len < 1e-6) return
    const along = ((m.x - ox) * ax + (m.y - oy) * ay) / len / h.foreshorten
    const L = PIECE_LIMITS[h.lengthField]
    updatePiece(h.id, {
      [h.lengthField]: clamp(snapTo(along, e.shiftKey ? 5 : L.step), L.min, L.max),
    })
  }

  /** Drag a joint: the point follows the pointer, so the leg swings and resizes. */
  const dragHandle = (h: Grip, e: React.PointerEvent) => {
    if (h.grab === 'head') return dragHead(h, e)
    const m = toModel(e.clientX, e.clientY)
    if (!m) return
    if (h.angleField === null) return stretchLeg(h, m, e)
    const dx = m.x - h.ox
    const dy = m.y - h.oy
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-3) return
    // A leg that does not start at the angle's own pivot is measured from its
    // own end of the part instead — a connector's outgoing leg, from the break.
    const sx = m.x - (h.lx ?? h.ox)
    const sy = m.y - (h.ly ?? h.oy)
    const patch: Partial<Piece> = {}
    /** How far along the leg the pointer is, in mm of piece length. */
    let reach = Math.hypot(sx, sy)

    if (h.angleField === 'turn' || h.angleField === 'sweep') {
      // Taken from above or below, the drawing is the horizontal plane itself,
      // so the pointer gives a heading directly. A turn is measured off the
      // heading the part was handed; a sweep off the one its corner entered at.
      const A = h.angleLimits
      const deg = headingOf(proj, dx, dy)
      const off = h.angleField === 'sweep' ? h.base : h.yawPrev * DEG
      const set = clamp(snapTo(wrapDeg(deg - off), e.shiftKey ? 5 : A.step), A.min, A.max)
      if (h.angleField === 'sweep') patch.sweep = set
      else patch.turn = set
      // The plan only shows the horizontal run, so divide the pitch back out.
      const cos = Math.cos(h.pitch)
      if (cos > 1e-3) reach /= cos
    } else {
      // Elevation: the run is length·cos(pitch) and the drop length·sin(pitch),
      // so the pointer offset maps straight onto pitch and length once the
      // view's own share of the run is divided back out.
      // A leg is drawn by its horizontal run, which only ever goes forward, so
      // the pointer reads straight down as vertical and no further.
      const { forward, drop } = legReach(h.showsRun, dx, dy)
      const deg = Math.atan2(drop, forward) * DEG
      const A = h.angleLimits
      if (h.angleField === 'bend') {
        // The bend is what the outgoing leg does relative to the entry leg, so
        // the entry slope comes back out of the angle the pointer is at.
        patch.bend = clamp(snapTo(deg - h.base, e.shiftKey ? 5 : A.step), A.min, A.max)
      } else {
        patch.slope = clamp(snapTo(deg, e.shiftKey ? 5 : A.step), A.min, A.max)
      }
      const own = legReach(h.showsRun, sx, sy)
      reach = Math.hypot(own.forward, own.drop)
    }

    // The joint follows the pointer, so the leg takes its length from where the
    // pointer is as well as its angle. Alt pins the length and leaves a pure
    // swing, which is what a joint drag used to be.
    if (!e.altKey && h.lengthField) {
      const L = PIECE_LIMITS[h.lengthField]
      patch[h.lengthField] = clamp(snapTo(reach, e.shiftKey ? 5 : L.step), L.min, L.max)
    }
    updatePiece(h.id, patch)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // The right button and the wheel click pan — the left button is reserved for
    // picking and for dragging joints.
    if (e.button !== 1 && e.button !== 2) return
    // Keep the browser's middle-click autoscroll out of the canvas.
    e.preventDefault()
    // Capture is claimed lazily on the first real move so that a plain click still
    // reaches the segment underneath.
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, panning: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const h = handle.current
    if (h) {
      dragHandle(h, e)
      return
    }
    const d = drag.current
    if (!d) return
    if (!d.panning) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 3) return
      d.panning = true
      ref.current?.classList.add('panning')
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }))
  }

  const endDrag = () => {
    drag.current = null
    handle.current = null
    pinned.current = null
    before.current = null
    ref.current?.classList.remove('panning')
    setGrabbed(null)
  }

  /**
   * Holds a head drag's pivot on the glass. The parts ahead of it have just
   * swung, which in the model moves the pivot itself, so the framing is slid to
   * put it back where it was — before the browser paints, so what the eye sees
   * is one leg swinging about a point that never budges.
   */
  useLayoutEffect(() => {
    const pivot = pinned.current
    const h = handle.current
    if (!pivot || !h) return
    const g = grips.find((q) => q.key === h.key)
    if (!g) return
    setView((v) => {
      const tx = pivot.x - g.ox * v.scale
      const ty = pivot.y - g.oy * v.scale
      return Math.abs(tx - v.tx) < 0.01 && Math.abs(ty - v.ty) < 0.01 ? v : { ...v, tx, ty }
    })
  }, [grips])

  const onPointerUp = (e: React.PointerEvent) => {
    // A left click on bare workplane clears the selection. Pans and joint drags
    // capture the pointer on the canvas itself, so they would pass the hit test
    // below — rule them out first.
    const stray = drag.current?.panning || handle.current
    if (
      e.button === 0 &&
      selectedId &&
      !stray &&
      !(e.target as Element).closest('.seg, .joint-handle')
    ) {
      select(null)
    }
    endDrag()
  }

  // Escape puts the run — and the framing a head drag slid — back as they were
  // when the handle was grabbed. The whole run, because a drag swings the parts
  // either side of the one under the pointer as well as the part itself.
  useEffect(() => {
    if (!grabbed) return
    const onKey = (e: KeyboardEvent) => {
      const h = handle.current
      const was = before.current
      if (e.key !== 'Escape' || !h || !was) return
      restoreDrag(h.id, was.pieces)
      setView((v) => ({ ...v, tx: was.tx, ty: was.ty }))
      endDrag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grabbed, restoreDrag])

  const mouse = useMemo(
    () => draftMouse(VIEWS[draftView].plan ? 'turn / sweep' : 'slope / bend'),
    [draftView],
  )

  const gridStep = 10 * view.scale
  // Sub-pixel-per-mm slack, so the button stays lit through rounding.
  const atActualSize = Math.abs(view.scale - screenPxPerMm) < 0.005

  /** One view button, so both groups draw theirs the same way. */
  const viewButton = (v: DraftView) => (
    <button
      key={v}
      className={draftView === v ? 'on' : ''}
      onClick={() => setDraftView(v)}
      title={VIEWS[v].title}
      aria-pressed={draftView === v}
    >
      {VIEWS[v].label}
    </button>
  )

  return (
    <div className="draft-wrap">
      <div className="draft-toolbar">
        {/* The six ortho views are named for the side of the model they are
            taken from, the same as the faces of the 3D view cube. Developed is
            the one that is not a direction — it flattens the turns out — so it
            sits in its own group, set apart from the places to stand. */}
        <div className="view-groups">
          <div
            className="segmented small views"
            role="group"
            aria-label="Draft view, flattened"
          >
            {VIEW_ORDER.filter((v) => VIEWS[v].developed).map(viewButton)}
          </div>
          <div
            className="segmented small views"
            role="group"
            aria-label="Draft view, from a side"
          >
            {VIEW_ORDER.filter((v) => !VIEWS[v].developed).map(viewButton)}
          </div>
        </div>
        {/* The joints are dragged on this canvas, so the rule that holds them
            together belongs beside the views rather than buried in a panel. */}
        <HoverHint
          label="Keep connected"
          hint={
            <>
              On, the run is one assembly: swinging any part swings every part after it, so
              the joints stay shut. Drag the first tube down 10° and the whole run tips with
              it. Off, only the part you drag moves and the joint behind it opens up.
            </>
          }
        >
          <button
            className={keepConnected ? 'view-tool wide on' : 'view-tool wide'}
            onClick={() => setKeepConnected(!keepConnected)}
            aria-label="Keep parts connected"
            aria-pressed={keepConnected}
          >
            Keep connected
          </button>
        </HoverHint>
        <span className="spacer" />
        <UndoRedo />
        {/* Reads "on" only once the zoom actually is life-size, so it doubles as
            a readout of whether what you are looking at is true to scale. */}
        <button
          className={atActualSize ? 'view-tool wide on' : 'view-tool wide'}
          onClick={actualSize}
          title={
            screenCalibrated
              ? 'Actual size — show the run at true physical size'
              : 'Actual size — approximate until you calibrate your screen in Settings'
          }
          aria-label="Actual size"
          aria-pressed={atActualSize}
        >
          1:1
        </button>
        {/* Same glyph as the 3D corner control, for the same action. */}
        <button
          className="view-tool"
          onClick={fit}
          title="Fit view — frame the whole run"
          aria-label="Fit view"
        >
          <FitIcon />
        </button>
      </div>

      <div
        className="draft-canvas"
        ref={ref}
        onWheel={onWheel}
        // The right button pans here, so its menu would land on every pan.
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
      >
        <svg width={size.w} height={size.h}>
          <Defs id="asm" />
          <defs>
            <pattern
              id="grid-fine"
              width={gridStep}
              height={gridStep}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${view.tx % gridStep} ${view.ty % gridStep})`}
            >
              <path className="grid-line" d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" strokeWidth="1" />
            </pattern>
            <pattern
              id="grid-coarse"
              width={gridStep * 5}
              height={gridStep * 5}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${view.tx % (gridStep * 5)} ${view.ty % (gridStep * 5)})`}
            >
              <rect width={gridStep * 5} height={gridStep * 5} fill="url(#grid-fine)" />
              <path
                className="grid-line coarse"
                d={`M ${gridStep * 5} 0 L 0 0 0 ${gridStep * 5}`}
                fill="none"
                strokeWidth="1.2"
              />
            </pattern>
          </defs>
          <rect width={size.w} height={size.h} fill="url(#grid-coarse)" />

          {visible.map((part) => {
            const tube = walls(part)
            if (!tube) return null
            const on = part.id === selectedId
            /** Model-space path → an SVG point list in screen space. */
            const screen = (pts: Pt[]) => pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')
            /** This part's stretch of a path drawn along the whole of its run. */
            const span = (path: Pt[]) => path.slice(part.from, part.from + part.points.length)
            // Out along one wall and back along the other closes the part.
            const wall = [...span(tube.outer[0]), ...span(tube.outer[1]).reverse()]
            const bores = tube.bore.map(span)

            return (
              <g
                key={part.id}
                className={`seg ${on ? 'on' : ''}`}
                onPointerUp={(e) => {
                  // Picking is a left-button gesture; releasing a pan here selects nothing.
                  if (e.button !== 0) return
                  select(on ? null : part.id)
                }}
              >
                <polygon className="wall" points={screen(wall)} />
                {bores.map((bore, i) => (
                  <polyline key={i} className="bore" fill="none" points={screen(bore)} />
                ))}
                <polyline className="axis" fill="none" points={screen(part.points)} />
              </g>
            )
          })}

          {/* Every part's dimensions, over the top of all of them: a view that
              has the run heading away piles the parts on one another, and a
              figure buried under the part in front is no use to anybody. */}
          <g className="dim-layer">
            {visible.map((part) => {
              const tube = walls(part)
              if (!tube) return null
              // A part is dimensioned along its legs: one bar on a plain tube,
              // and one either side of the break on a connector — mitred at the
              // corner, so the pair runs beside the part rather than cutting
              // across the bend.
              const head = part.points[0]
              const tail = part.points[part.points.length - 1]
              const spine = part.breakAt ? [head, part.breakAt, tail] : [head, tail]
              const d = offsetPath(spine, tube.outerR + 16)
              return (
                <g key={part.id}>
                  {part.legs.map((leg, i) => (
                    <Dim
                      key={i}
                      markerId="asm"
                      x1={px(d[i].x)}
                      y1={py(d[i].y)}
                      x2={px(d[i + 1].x)}
                      y2={py(d[i + 1].y)}
                      label={leg}
                    />
                  ))}
                  {part.breakAt && part.angle && (
                    <AngleDim
                      markerId="asm"
                      x={px(part.breakAt.x)}
                      y={py(part.breakAt.y)}
                      fromX={px(head.x)}
                      fromY={py(head.y)}
                      toX={px(tail.x)}
                      toY={py(tail.y)}
                      clear={tube.outerR * view.scale}
                      label={part.angle}
                    />
                  )}
                </g>
              )
            })}
          </g>

          {/* Travel direction: chevrons down every axis, plus START/END caps.
              Drawn over the walls but under the handles, and deaf to the mouse. */}
          {visible.length > 0 && (
            <g className="flow-layer">
              {visible.flatMap((part) =>
                part.points.slice(1).map((b, i) => {
                  const a = part.points[i]
                  return (
                    <FlowArrows
                      key={`${part.id}:${i}`}
                      x1={px(a.x)}
                      y1={py(a.y)}
                      x2={px(b.x)}
                      y2={py(b.y)}
                    />
                  )
                }),
              )}
              {(() => {
                // The caps mark where the drawn run starts and ends, so with
                // parts switched off they move in to whatever is still shown.
                // With several runs on the paper they belong to the one the
                // marble travels — the first — rather than spanning two runs
                // that have nothing to do with each other.
                const run = visible.filter((p) => p.chain === visible[0].chain)
                const head = run[0].points
                const tail = run[run.length - 1].points
                const dir = (a: Pt, b: Pt) => {
                  const dx = b.x - a.x
                  const dy = b.y - a.y
                  const len = Math.hypot(dx, dy) || 1
                  return { ux: dx / len, uy: dy / len }
                }
                const a = dir(head[0], head[1])
                const b = dir(tail[tail.length - 2], tail[tail.length - 1])
                return (
                  <>
                    <FlowCap
                      x={px(head[0].x)}
                      y={py(head[0].y)}
                      ux={a.ux}
                      uy={a.uy}
                      kind="in"
                      markerId="asm"
                    />
                    <FlowCap
                      x={px(tail[tail.length - 1].x)}
                      y={py(tail[tail.length - 1].y)}
                      ux={b.ux}
                      uy={b.uy}
                      kind="out"
                      markerId="asm"
                    />
                  </>
                )
              })()}
            </g>
          )}

          {/* The run starts where it starts — that joint is the one fixed point.
              With the first part switched off there is nothing to anchor. */}
          {parts.length > 0 && parts[0].shown && (
            <circle
              className="joint anchor"
              cx={px(parts[0].points[0].x)}
              cy={py(parts[0].points[0].y)}
              r={4}
            >
              <title>Origin — fixed</title>
            </circle>
          )}

          {/* Joint handles sit above the segments so they stay grabbable. */}
          {grips.map((g) => {
            const on = g.id === selectedId
            const live = grabbed === g.key
            const head = g.grab === 'head'
            // A handle that only stretches has no angle to hold still, so the
            // hint that Alt would hold it makes no sense on one.
            const stretchOnly = g.angleField === null
            const leg = g.lengthField === 'exitLength' ? 'the exit leg' : 'this leg'
            const hint = stretchOnly
              ? ` · stretches ${leg}`
              : g.lengthField
                ? ` · stretches ${leg} · Alt = angle only`
                : ''
            // A head handle shares its joint with the tail handle of the part
            // before it, so it is stood off along its own leg: neither handle
            // covers the other, and each one sits on the part it swings.
            const dx = g.ox - g.x
            const dy = g.oy - g.y
            const len = Math.hypot(dx, dy) || 1
            // Zoomed out far enough, a short leg is worth less than the standoff
            // itself — the ring stays on its own leg rather than sliding past the
            // joint at the other end of it.
            const off = head ? Math.min(HEAD_STANDOFF, len * view.scale * 0.4) / len : 0
            const cx = px(g.x) + dx * off
            const cy = py(g.y) + dy * off
            return (
              <g
                key={g.key}
                className={`joint-handle ${head ? 'head ' : ''}${stretchOnly ? 'stretch ' : ''}${g.edgeOn ? 'flat ' : ''}${on ? 'on' : ''} ${live ? 'live' : ''}`}
                onPointerDown={(e) => onHandleDown(e, g)}
              >
                {head && <line className="stem" x1={px(g.x)} y1={py(g.y)} x2={cx} y2={cy} />}
                <circle className="hit" cx={cx} cy={cy} r={11} />
                {/* A square says the handle only slides along its own leg; a
                    ring or a disc says there is an angle in it to swing. */}
                {stretchOnly ? (
                  <rect
                    className="joint"
                    x={cx - (live ? 5 : 3.6)}
                    y={cy - (live ? 5 : 3.6)}
                    width={live ? 10 : 7.2}
                    height={live ? 10 : 7.2}
                    rx={1.2}
                  />
                ) : (
                  <circle className="joint" cx={cx} cy={cy} r={live ? 5.5 : 4} />
                )}
                <title>
                  {g.edgeOn
                    ? `End-on in the ${proj.label} view — nothing to drag here. Switch views to set it.`
                    : `${g.title}${hint} · Shift = snap · Esc = cancel`}
                </title>
              </g>
            )
          })}

          {!visible.length && (
            <text className="empty" x={size.w / 2} y={size.h / 2} textAnchor="middle">
              {parts.length
                ? 'Every part is switched off — turn one back on in Active Parts'
                : 'Add a part to begin drafting'}
            </text>
          )}

        </svg>

        {/* The same model tree as the 3D stage: what it switches off here is
            what it switches off there, so both views show the one set of parts. */}
        <ActiveParts />

        {/* Names the drawing plane, parked beside the legend as it is in 3D —
            and in 2D the plane is whichever view is on, so it says which. */}
        <div className={shifted ? 'workplane-tag shifted' : 'workplane-tag'} aria-hidden="true">
          {proj.developed ? 'Developed elevation' : `${proj.label} view`}
        </div>

        {/* Bottom-right of the canvas, opposite the scale bar. */}
        <MouseLegend stage={ref} config={mouse} shifted={shifted} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** Width of the slide-out settings panel; matches the 3D stage. */
const SETTINGS_WIDTH = 312

/** The two drawings 2D mode holds, in the order they are tabbed. */
const DRAFT_TABS = [
  { key: 'assembly', label: 'Assembly draft', meta: 'parts in the run' },
  { key: 'section', label: 'Tube face', meta: 'tube cross-section' },
] as const

type DraftTab = (typeof DRAFT_TABS)[number]['key']

export default function Draft2D() {
  // Either slide-out takes the same gutter, so the pane steps aside for both.
  const docked = useRun((s) => s.rightPanel !== null)
  // The assembly is what 2D mode is for — the section is a reference taken off
  // whichever part is picked in it — so the run opens on the assembly.
  const [tab, setTab] = useState<DraftTab>('assembly')

  return (
    <div className="stage-2d" style={{ '--parts-w': `${SETTINGS_WIDTH}px` } as React.CSSProperties}>
      {/* The panel slides over this pane's right edge, so its header row and
          toolbar step aside to keep the Fit button reachable. */}
      <div className={docked ? 'pane grow shifted' : 'pane grow'}>
        <header className="pane-head">
          {/* The same toggle the top bar switches 2D and 3D with — a drawing
              is picked the same way a mode is. */}
          <div className="segmented tabs" role="tablist" aria-label="2D drawing">
            {DRAFT_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                className={tab === t.key ? 'on' : undefined}
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span>{DRAFT_TABS.find((t) => t.key === tab)?.meta}</span>
        </header>
        {/* The assembly is left mounted under the section rather than swapped
            out for it: its view is where you panned and zoomed it to, and a
            look at the tube it is cut from should not cost you that. */}
        <div className="pane-body">
          <AssemblyDraft shifted={docked} />
          {tab === 'section' && <CrossSection />}
        </div>
      </div>

      <RightDock />
    </div>
  )
}
