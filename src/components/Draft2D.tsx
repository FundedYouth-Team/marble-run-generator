import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MouseLegend, { type MouseConfig } from './MouseLegend'
import SettingsPanel from './SettingsPanel'
import { FitIcon } from './icons'
import { crossSectionPath } from '../lib/geometry'
import { buildAssembly } from '../lib/layout'
import { useRun, tubeSpec, PIECE_LIMITS, VARIANT_LABEL, type Piece } from '../store'

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
  const { innerDiameter, wallThickness, variant, marbleDiameter } = useRun()
  const spec = tubeSpec(innerDiameter, wallThickness, variant)
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
        {spec.closed ? 'Closed tube — 360° wall' : `${openDeg}° open — ${VARIANT_LABEL[variant]}`}
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Assembly draft                                                      */
/* ------------------------------------------------------------------ */

interface Seg {
  id: string
  index: number
  ax: number
  ay: number
  bx: number
  by: number
  length: number
  slope: number
  turn: number
  /** Pitch in radians, needed to map a plan-view drag back to a run length. */
  pitch: number
  /** Heading in radians before this piece's own turn is applied. */
  yawPrev: number
}

/** Grab state for a joint handle: the piece it edits and that piece's fixed start. */
interface Handle {
  id: string
  ox: number
  oy: number
  pitch: number
  yawPrev: number
  /** Values to restore if the drag is cancelled with Escape. */
  original: Pick<Piece, 'length' | 'slope' | 'turn'>
}

const DEG = 180 / Math.PI
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const snapTo = (v: number, step: number) => Math.round(v / step) * step
/** Fold an angle in degrees into (-180, 180]. */
const wrapDeg = (d: number) => d - 360 * Math.round(d / 360)

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
  } = useRun()
  const spec = tubeSpec(innerDiameter, wallThickness, variant)
  const { ref, size } = useSize<HTMLDivElement>()
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; panning: boolean } | null>(null)
  const handle = useRef<Handle | null>(null)
  const [grabbed, setGrabbed] = useState<string | null>(null)

  const segs = useMemo<Seg[]>(() => {
    const asm = buildAssembly(pieces)
    let developed = 0
    return asm.placed.map((p) => {
      let ax: number, ay: number, bx: number, by: number
      if (draftView === 'elevation') {
        const run = p.piece.length * Math.cos(p.pitch)
        ax = developed
        ay = -p.start.y
        bx = developed + run
        by = -p.end.y
        developed += run
      } else {
        ax = p.start.x
        ay = p.start.z
        bx = p.end.x
        by = p.end.z
      }
      return {
        id: p.piece.id,
        index: p.index,
        ax,
        ay,
        bx,
        by,
        length: p.piece.length,
        slope: p.piece.slope,
        turn: p.piece.turn,
        pitch: p.pitch,
        yawPrev: p.yaw - (p.piece.turn * Math.PI) / 180,
      }
    })
  }, [pieces, draftView])

  /** One handle per joint; joint 0 is the fixed origin, joint i+1 ends segment i. */
  const joints = useMemo(
    () =>
      segs.flatMap((s, i) => [
        ...(i === 0 ? [{ key: 'origin', x: s.ax, y: s.ay, seg: null as Seg | null }] : []),
        { key: s.id, x: s.bx, y: s.by, seg: s as Seg | null },
      ]),
    [segs],
  )

  const fit = useCallback(() => {
    if (!segs.length) {
      setView({ scale: 1, tx: size.w / 2, ty: size.h / 2 })
      return
    }
    const xs = segs.flatMap((s) => [s.ax, s.bx])
    const ys = segs.flatMap((s) => [s.ay, s.by])
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
  }, [segs, size.w, size.h, spec.outerR])

  useEffect(fit, [size.w, size.h, draftView, pieces.length])

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

  /** Screen point → model mm, in the current view's coordinates. */
  const toModel = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    }
  }

  const onHandleDown = (e: React.PointerEvent, seg: Seg) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ref.current?.setPointerCapture(e.pointerId)
    handle.current = {
      id: seg.id,
      ox: seg.ax,
      oy: seg.ay,
      pitch: seg.pitch,
      yawPrev: seg.yawPrev,
      original: { length: seg.length, slope: seg.slope, turn: seg.turn },
    }
    setGrabbed(seg.id)
    select(seg.id)
  }

  /** Drag a joint: the angle follows the pointer, Alt also stretches the piece. */
  const dragHandle = (h: Handle, e: React.PointerEvent) => {
    const m = toModel(e.clientX, e.clientY)
    if (!m) return
    const dx = m.x - h.ox
    const dy = m.y - h.oy
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-3) return
    const L = PIECE_LIMITS.length
    const patch: Partial<Piece> = {}

    if (draftView === 'elevation') {
      // Developed elevation: the run is length·cos(pitch) and the drop length·sin(pitch),
      // so the pointer offset maps straight onto pitch and length.
      const S = PIECE_LIMITS.slope
      patch.slope = clamp(
        snapTo(Math.atan2(dy, Math.max(dx, 1e-6)) * DEG, e.shiftKey ? 5 : S.step),
        S.min,
        S.max,
      )
      if (e.altKey) patch.length = clamp(snapTo(dist, L.step), L.min, L.max)
    } else {
      // Plan: +X is right, +Z is down, so the heading is measured from +Z.
      const T = PIECE_LIMITS.turn
      patch.turn = clamp(
        snapTo(wrapDeg(Math.atan2(dx, dy) * DEG - h.yawPrev * DEG), e.shiftKey ? 5 : T.step),
        T.min,
        T.max,
      )
      // The plan only shows the horizontal run, so divide the pitch back out.
      const cos = Math.cos(h.pitch)
      if (e.altKey && cos > 1e-3) patch.length = clamp(snapTo(dist / cos, L.step), L.min, L.max)
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
    ref.current?.classList.remove('panning')
    setGrabbed(null)
  }

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

  // Escape restores the piece to what it was when the handle was grabbed.
  useEffect(() => {
    if (!grabbed) return
    const onKey = (e: KeyboardEvent) => {
      const h = handle.current
      if (e.key !== 'Escape' || !h) return
      updatePiece(h.id, h.original)
      endDrag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grabbed, updatePiece])

  const mouse = useMemo(() => draftMouse(draftView === 'elevation' ? 'slope' : 'turn'), [draftView])

  // Scale bar: pick a round number of mm that lands near 120 px.
  const barMm = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((v) => v * view.scale > 90) ?? 1000
  const gridStep = 10 * view.scale

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
        <span className="spacer" />
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

          {segs.map((s) => {
            const dx = s.bx - s.ax
            const dy = s.by - s.ay
            const len = Math.hypot(dx, dy) || 1
            const nx = -dy / len
            const ny = dx / len
            const off = (r: number, sign: number) => ({
              x1: px(s.ax + nx * r * sign),
              y1: py(s.ay + ny * r * sign),
              x2: px(s.bx + nx * r * sign),
              y2: py(s.by + ny * r * sign),
            })
            const o1 = off(spec.outerR, 1)
            const o2 = off(spec.outerR, -1)
            const i1 = off(spec.innerR, 1)
            const i2 = off(spec.innerR, -1)
            const d = off(spec.outerR + 16, 1)
            const on = s.id === selectedId

            return (
              <g
                key={s.id}
                className={`seg ${on ? 'on' : ''}`}
                onPointerUp={(e) => {
                  // Picking is a left-button gesture; releasing a pan here selects nothing.
                  if (e.button !== 0) return
                  select(on ? null : s.id)
                }}
              >
                <polygon
                  className="wall"
                  points={`${o1.x1},${o1.y1} ${o1.x2},${o1.y2} ${o2.x2},${o2.y2} ${o2.x1},${o2.y1}`}
                />
                <line className="bore" x1={i1.x1} y1={i1.y1} x2={i1.x2} y2={i1.y2} />
                <line className="bore" x1={i2.x1} y1={i2.y1} x2={i2.x2} y2={i2.y2} />
                <line
                  className="axis"
                  x1={px(s.ax)}
                  y1={py(s.ay)}
                  x2={px(s.bx)}
                  y2={py(s.by)}
                />
                <Dim
                  markerId="asm"
                  x1={d.x1}
                  y1={d.y1}
                  x2={d.x2}
                  y2={d.y2}
                  label={`${s.length} mm  ∠${s.slope}°${s.turn ? `  ↻${s.turn}°` : ''}`}
                />
              </g>
            )
          })}

          {/* Travel direction: chevrons down every axis, plus START/END caps.
              Drawn over the walls but under the handles, and deaf to the mouse. */}
          {segs.length > 0 && (
            <g className="flow-layer">
              {segs.map((s) => (
                <FlowArrows
                  key={s.id}
                  x1={px(s.ax)}
                  y1={py(s.ay)}
                  x2={px(s.bx)}
                  y2={py(s.by)}
                />
              ))}
              {(() => {
                const first = segs[0]
                const last = segs[segs.length - 1]
                const dir = (s: Seg) => {
                  const dx = s.bx - s.ax
                  const dy = s.by - s.ay
                  const len = Math.hypot(dx, dy) || 1
                  return { ux: dx / len, uy: dy / len }
                }
                const a = dir(first)
                const b = dir(last)
                return (
                  <>
                    <FlowCap
                      x={px(first.ax)}
                      y={py(first.ay)}
                      ux={a.ux}
                      uy={a.uy}
                      kind="in"
                      markerId="asm"
                    />
                    <FlowCap
                      x={px(last.bx)}
                      y={py(last.by)}
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

          {/* Joint handles sit above the segments so they stay grabbable. */}
          {joints.map((j) => {
            const seg = j.seg
            if (!seg) {
              return (
                <circle key={j.key} className="joint anchor" cx={px(j.x)} cy={py(j.y)} r={4}>
                  <title>Origin — fixed</title>
                </circle>
              )
            }
            const on = seg.id === selectedId
            const live = grabbed === seg.id
            return (
              <g
                key={j.key}
                className={`joint-handle ${on ? 'on' : ''} ${live ? 'live' : ''}`}
                onPointerDown={(e) => onHandleDown(e, seg)}
              >
                <circle className="hit" cx={px(j.x)} cy={py(j.y)} r={11} />
                <circle className="joint" cx={px(j.x)} cy={py(j.y)} r={live ? 5.5 : 4} />
                <title>
                  {draftView === 'elevation'
                    ? `Drag to set slope (${seg.slope}°)`
                    : `Drag to set turn (${seg.turn}°)`}
                  {' · Shift = 5° · Alt = length · Esc = cancel'}
                </title>
              </g>
            )
          })}

          {!segs.length && (
            <text className="empty" x={size.w / 2} y={size.h / 2} textAnchor="middle">
              Add a straight piece to begin drafting
            </text>
          )}

          {/* Scale bar */}
          <g className="scalebar" transform={`translate(20 ${size.h - 28})`}>
            <line x1={0} y1={0} x2={barMm * view.scale} y2={0} />
            <line x1={0} y1={-5} x2={0} y2={5} />
            <line x1={barMm * view.scale} y1={-5} x2={barMm * view.scale} y2={5} />
            <text x={barMm * view.scale / 2} y={-10} textAnchor="middle">
              {barMm} mm
            </text>
          </g>
        </svg>

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
  const [settingsOpen, setSettingsOpen] = useState(false)

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
      <div className={settingsOpen ? 'pane grow shifted' : 'pane grow'}>
        <header className="pane-head">
          <h3>Assembly draft</h3>
          <span>straight line objects</span>
        </header>
        <div className="pane-body">
          <AssemblyDraft shifted={settingsOpen} />
        </div>
      </div>

      {/* Filing-tab handle on the right edge — rides out with the panel so it
          always sits against whichever edge the panel is showing. */}
      <button
        className={settingsOpen ? 'settings-tab shifted' : 'settings-tab'}
        onClick={() => setSettingsOpen((v) => !v)}
        title={settingsOpen ? 'Hide settings' : 'Show settings'}
        aria-label="Settings"
        aria-expanded={settingsOpen}
      >
        Settings
      </button>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
