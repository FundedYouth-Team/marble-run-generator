import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MouseLegend, { type MouseConfig } from './MouseLegend'
import RightDock from './RightDock'
import ActiveParts from './ActiveParts'
import UndoRedo from './UndoRedo'
import { FitIcon } from './icons'
import { crossSectionPath } from '../lib/geometry'
import { buildAssembly } from '../lib/layout'
import {
  useRun,
  tubeSpec,
  angleSpec,
  variantOf,
  PIECE_LIMITS,
  slopeLimitsFor,
  bendLimitsFor,
  entrySwingLimitsFor,
  VARIANT_LABEL,
  type Piece,
} from '../store'

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
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  markerId: string
  /** Text offset from the dimension line, in this SVG's user units. */
  off?: number
}) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  if (angle > 90 || angle < -90) angle += 180
  return (
    <g className="dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart={`url(#${markerId}-tick)`} markerEnd={`url(#${markerId}-tick)`} />
      <text x={mx} y={my} transform={`rotate(${angle} ${mx} ${my}) translate(0 ${-off})`}>
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
  const { innerDiameter, wallThickness, variant, marbleDiameter, pieces, selectedId } = useRun()
  // Style is a part's own, so the front face is the selected part's — and the
  // run's own style whenever nothing is picked.
  const selected = pieces.find((p) => p.id === selectedId)
  const style = selected ? variantOf(selected, variant) : variant
  const spec = tubeSpec(innerDiameter, wallThickness, style)
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

  return (
    <svg className="section-svg" viewBox={`-50 ${top} 100 ${bottom - top}`}>
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
        label={`Ø${innerDiameter.toFixed(1)} bore`}
        off={1.4}
      />
      <Dim
        markerId="xs"
        x1={-ro}
        y1={dimY2}
        x2={ro}
        y2={dimY2}
        label={`Ø${(R * 2).toFixed(1)} outer`}
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
        label={`t ${wallThickness.toFixed(1)}`}
        off={1.4}
      />

      {/* Opening callout */}
      <text className="callout" x={0} y={top + 5} textAnchor="middle">
        {spec.closed ? 'Closed tube — 360° wall' : `${openDeg}° open — ${VARIANT_LABEL[style]}`}
      </text>
    </svg>
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
  /** Where this part's first point sits in the run's own polyline. */
  from: number
  /** False when the part's eye is off in the parts list — it holds its place but is not drawn. */
  shown: boolean
  label: string
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
  /** What the drag angle sets. */
  angleField: 'slope' | 'bend' | 'turn'
  /** How far that angle may go — narrowed to what the rest of the run can take. */
  angleLimits: { min: number; max: number; step: number }
  /** What an Alt-drag stretches, if there is anything sensible to stretch. */
  lengthField: 'length' | 'exitLength' | null
  /** Pitch of the leg being stretched — a plan drag only shows its horizontal run. */
  pitch: number
  /** Heading in radians before this part's own turn is applied. */
  yawPrev: number
  /** Slope the bend is measured off, degrees. */
  base: number
  /**
   * Head handles only: hold the connector's outgoing leg where it is, so the
   * bend gives back whatever the entry leg takes and the break is the one point
   * in the drawing that does not move.
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
 * A path parallel to `pts`, offset sideways by `r` model mm — negative goes the
 * other way. Corners are mitred, so a bent part draws as one continuous wall
 * rather than a stack of overlapping rectangles.
 */
function offsetPath(pts: Pt[], r: number): Pt[] {
  const normals: Pt[] = []
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    const len = Math.hypot(dx, dy) || 1
    normals.push({ x: -dy / len, y: dx / len })
  }

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
    ['drag joint', joint],
    ['drag ring', 'swing from the head'],
    ['shift-drag', 'snap 5°'],
    ['alt-drag', 'length'],
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
  } = useRun()
  const spec = tubeSpec(innerDiameter, wallThickness, variant)
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

  const { parts, chain, grips } = useMemo(() => {
    const asm = buildAssembly(pieces)
    const elevation = draftView === 'elevation'
    const parts: DraftPart[] = []
    const grips: Grip[] = []
    // Developed elevation: x is horizontal run, so every turn is flattened out
    // of the drawing and the run reads as one continuous side-on section.
    let developed = 0
    const run = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(b.x - a.x, b.z - a.z)

    for (const p of asm.placed) {
      const piece = p.piece
      const angle = piece.type === 'angle'
      // A hidden part is still laid out — it holds the run's shape either side
      // of it — it is simply not drawn, and has no handles to grab.
      const shown = !piece.hidden
      const a = angleSpec(piece)
      const startX = elevation ? developed : p.start.x
      const startY = elevation ? -p.start.y : p.start.z

      const points: Pt[] = []
      for (const [i, seg] of p.segments.entries()) {
        if (i === 0) points.push({ x: startX, y: startY })
        if (elevation) developed += seg.length * Math.cos(seg.pitch)
        points.push({
          x: elevation ? developed : seg.end.x,
          y: elevation ? -seg.end.y : seg.end.z,
        })
      }
      if (points.length < 2) continue

      const last = points[points.length - 1]
      // Each part picks up on the joint the one before it ended at, so the run
      // is one polyline and the parts are windows onto it.
      const previous = parts[parts.length - 1]
      parts.push({
        id: piece.id,
        index: p.index,
        points,
        from: previous ? previous.from + previous.points.length - 1 : 0,
        shown,
        label: angle
          ? `${a.entry}+${a.exit} mm  ∠${piece.slope}°  ⌐${a.bend}°${a.fillet ? `  r${a.fillet}` : '  sharp'}`
          : `${piece.length} mm  ∠${piece.slope}°${piece.turn ? `  ↻${piece.turn}°` : ''}`,
      })

      const yawPrev = p.yaw - (piece.turn * Math.PI) / 180
      const common = {
        id: piece.id,
        pitch: p.pitch,
        yawPrev,
        base: piece.slope,
        holdExit: false,
      }

      if (!shown) continue

      if (!elevation) {
        // Plan shows only the heading, so one handle per end swings the lot.
        grips.push({
          ...common,
          key: piece.id,
          grab: 'tail',
          x: last.x,
          y: last.y,
          ox: startX,
          oy: startY,
          angleField: 'turn',
          angleLimits: PIECE_LIMITS.turn,
          // A connector has two legs stacked along the same plan line — there is
          // no telling from up here which one a stretch was meant for.
          lengthField: angle ? null : 'length',
          title: `Drag to set turn (${piece.turn}°)`,
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
          lengthField: angle ? null : 'length',
          title: 'Drag the start to swing this part about its end — the run ahead comes with it',
        })
        continue
      }

      if (angle && p.corner) {
        const cornerX = startX + run(p.start, p.corner)
        const cornerY = -p.corner.y
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
          title: `Drag the start to swing the entry leg about the break (entering at ${piece.slope}°)`,
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
          title: `Drag to set the entry slope (${piece.slope}°)`,
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
          title: `Drag to set bend (${a.bend}°, leaving at ${piece.slope + a.bend}°)`,
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
        grips.push({
          ...common,
          key: piece.id,
          grab: 'tail',
          x: last.x,
          y: last.y,
          ox: startX,
          oy: startY,
          angleField: 'slope',
          angleLimits: slopeLimitsFor(piece),
          lengthField: 'length',
          title: `Drag to set slope (${piece.slope}°)`,
        })
      }
    }

    // The joint between two parts is one point, not two — walls offset from this
    // mitre at every joint alike, so nothing gaps or overlaps where parts meet.
    const chain = parts.flatMap((part, i) => (i === 0 ? part.points : part.points.slice(1)))

    return { parts, chain, grips }
  }, [pieces, draftView])

  /**
   * The run's walls and bores, offset once along the whole chain. Each part is
   * then drawn from its own stretch of them, so a part is still its own pickable
   * shape while the joints it shares are drawn exactly once.
   */
  const walls = useMemo(
    () =>
      chain.length < 2
        ? null
        : {
            outer: [offsetPath(chain, spec.outerR), offsetPath(chain, -spec.outerR)],
            bore: [offsetPath(chain, spec.innerR), offsetPath(chain, -spec.innerR)],
          },
    [chain, spec.outerR, spec.innerR],
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
    const m = spec.outerR + 26
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
  }, [visible, size.w, size.h, spec.outerR])

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
      // Plan: the headings of every part up to this one add up to where it points.
      const yaw = pieces.slice(0, at + 1).reduce((sum, p) => sum + p.turn, 0)
      delta = wrapDeg(snapTo(Math.atan2(dx, dy) * DEG, step) - yaw)
    } else {
      delta = clamp(snapTo(Math.atan2(dy, Math.max(dx, 1e-6)) * DEG, step), A.min, A.max) - pieces[at].slope
    }

    let patch: Partial<Piece> | undefined
    if (e.altKey && h.lengthField) {
      const L = PIECE_LIMITS[h.lengthField]
      const mm = dist / view.scale
      // The plan only shows the horizontal run, so divide the pitch back out.
      const cos = Math.cos(h.pitch)
      const reach = h.angleField === 'turn' && cos > 1e-3 ? mm / cos : mm
      patch = { [h.lengthField]: clamp(snapTo(reach, L.step), L.min, L.max) }
    }

    swingHead(h.id, h.angleField === 'turn' ? 'turn' : 'slope', delta, {
      holdExit: h.holdExit,
      patch,
    })
  }

  /** Drag a joint: the angle follows the pointer, Alt also stretches the leg. */
  const dragHandle = (h: Grip, e: React.PointerEvent) => {
    if (h.grab === 'head') return dragHead(h, e)
    const m = toModel(e.clientX, e.clientY)
    if (!m) return
    const dx = m.x - h.ox
    const dy = m.y - h.oy
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-3) return
    const patch: Partial<Piece> = {}
    /** How far along the leg the pointer is, in mm of piece length. */
    let reach = dist

    if (h.angleField === 'turn') {
      // Plan: +X is right, +Z is down, so the heading is measured from +Z.
      const T = PIECE_LIMITS.turn
      patch.turn = clamp(
        snapTo(wrapDeg(Math.atan2(dx, dy) * DEG - h.yawPrev * DEG), e.shiftKey ? 5 : T.step),
        T.min,
        T.max,
      )
      // The plan only shows the horizontal run, so divide the pitch back out.
      const cos = Math.cos(h.pitch)
      reach = cos > 1e-3 ? dist / cos : dist
    } else {
      // Developed elevation: the run is length·cos(pitch) and the drop length·sin(pitch),
      // so the pointer offset maps straight onto pitch and length.
      // A leg is drawn by its horizontal run, which only ever goes forward, so
      // the pointer reads straight down as vertical and no further.
      const deg = Math.atan2(dy, Math.max(dx, 1e-6)) * DEG
      const A = h.angleLimits
      if (h.angleField === 'bend') {
        // The bend is what the outgoing leg does relative to the entry leg, so
        // the entry slope comes back out of the angle the pointer is at.
        patch.bend = clamp(snapTo(deg - h.base, e.shiftKey ? 5 : A.step), A.min, A.max)
      } else {
        patch.slope = clamp(snapTo(deg, e.shiftKey ? 5 : A.step), A.min, A.max)
      }
    }

    if (e.altKey && h.lengthField) {
      const L = PIECE_LIMITS[h.lengthField]
      patch[h.lengthField] = clamp(snapTo(reach, L.step), L.min, L.max)
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
    () => draftMouse(draftView === 'elevation' ? 'slope / bend' : 'turn'),
    [draftView],
  )

  const gridStep = 10 * view.scale
  // Sub-pixel-per-mm slack, so the button stays lit through rounding.
  const atActualSize = Math.abs(view.scale - screenPxPerMm) < 0.005

  return (
    <div className="draft-wrap">
      <div className="draft-toolbar">
        <div className="segmented small">
          <button className={draftView === 'elevation' ? 'on' : ''} onClick={() => setDraftView('elevation')}>
            Elevation
          </button>
          <button className={draftView === 'plan' ? 'on' : ''} onClick={() => setDraftView('plan')}>
            Plan
          </button>
        </div>
        {/* The joints are dragged on this canvas, so the rule that holds them
            together belongs beside the views rather than buried in a panel. */}
        <button
          className={keepConnected ? 'view-tool wide on' : 'view-tool wide'}
          onClick={() => setKeepConnected(!keepConnected)}
          title={
            keepConnected
              ? 'Keep connected — the run is one assembly: swinging a joint swings every part after it'
              : 'Keep connected — off: each part holds its own angle and joints are free to open up'
          }
          aria-label="Keep parts connected"
          aria-pressed={keepConnected}
        >
          Keep connected
        </button>
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

          {walls && visible.map((part) => {
            const on = part.id === selectedId
            /** Model-space path → an SVG point list in screen space. */
            const screen = (pts: Pt[]) => pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')
            /** This part's stretch of a path drawn along the whole run. */
            const span = (path: Pt[]) => path.slice(part.from, part.from + part.points.length)
            // Out along one wall and back along the other closes the part.
            const wall = [...span(walls.outer[0]), ...span(walls.outer[1]).reverse()]
            const bores = walls.bore.map(span)
            // The dimension spans the whole part, however many chords it bends through.
            const head = part.points[0]
            const tail = part.points[part.points.length - 1]
            const d = offsetPath([head, tail], spec.outerR + 16)

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
                <Dim
                  markerId="asm"
                  x1={px(d[0].x)}
                  y1={py(d[0].y)}
                  x2={px(d[1].x)}
                  y2={py(d[1].y)}
                  label={part.label}
                />
              </g>
            )
          })}

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
                const head = visible[0].points
                const tail = visible[visible.length - 1].points
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
            const stretch = g.lengthField === 'exitLength' ? ' · Alt = exit leg' : g.lengthField ? ' · Alt = length' : ''
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
                className={`joint-handle ${head ? 'head ' : ''}${on ? 'on' : ''} ${live ? 'live' : ''}`}
                onPointerDown={(e) => onHandleDown(e, g)}
              >
                {head && <line className="stem" x1={px(g.x)} y1={py(g.y)} x2={cx} y2={cy} />}
                <circle className="hit" cx={cx} cy={cy} r={11} />
                <circle className="joint" cx={cx} cy={cy} r={live ? 5.5 : 4} />
                <title>
                  {g.title}
                  {` · Shift = 5°${stretch} · Esc = cancel`}
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

        {/* Names the drawing plane, parked beside the legend as it is in 3D. */}
        <div className={shifted ? 'workplane-tag shifted' : 'workplane-tag'} aria-hidden="true">
          Workplane
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

export default function Draft2D() {
  // Either slide-out takes the same gutter, so the panes step aside for both.
  const docked = useRun((s) => s.rightPanel !== null)

  return (
    <div className="stage-2d" style={{ '--parts-w': `${SETTINGS_WIDTH}px` } as React.CSSProperties}>
      <div className="pane">
        <header className="pane-head">
          <h3>Section A–A · Tube front face</h3>
          <span>1:1 mm</span>
        </header>
        <div className="pane-body center">
          <CrossSection />
        </div>
      </div>
      {/* The panel slides over this pane's right edge, so its header row and
          toolbar step aside to keep the Fit button reachable. */}
      <div className={docked ? 'pane grow shifted' : 'pane grow'}>
        <header className="pane-head">
          <h3>Assembly draft</h3>
          <span>parts in the run</span>
        </header>
        <div className="pane-body">
          <AssemblyDraft shifted={docked} />
        </div>
      </div>

      <RightDock />
    </div>
  )
}
