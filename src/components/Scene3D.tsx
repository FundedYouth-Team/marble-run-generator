import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  GizmoHelper,
  Grid,
  OrbitControls,
  TransformControls,
} from '@react-three/drei'
import * as THREE from 'three'
import ViewCube, { type CubePalette } from './ViewCube'
import MouseLegend from './MouseLegend'
import RightDock from './RightDock'
import Toolbar, { TOOLBAR_HEIGHT, TOOL_OPTIONS_HEIGHT, hasToolOptions } from './Toolbar'
import ActiveParts from './ActiveParts'
import PartContextMenu, { type MenuTarget } from './PartContextMenu'
import { FitIcon, HomeIcon } from './icons'
import { buildEndBandGeometry, buildPartGeometry } from '../lib/geometry'
import { centerlineFor, shapeKey } from '../lib/centerline'
import {
  buildAssembly,
  chainBox,
  directionFor,
  frameFor,
  partsBox,
  type Assembly,
} from '../lib/layout'
import { createMarble, resetMarble, stepMarble } from '../lib/sim'
import { buildWorld } from '../lib/collide'
import { telemetry } from '../lib/telemetry'
import {
  SPAN_AXIS,
  SPAN_KEYS,
  SPAN_LABEL,
  measure,
  spans,
  type MoveMeasure,
  type SizeMeasure,
  type SizeSpan,
} from '../lib/measure'
import { tidyGizmo, type GizmoControls } from '../lib/gizmo'
import { addsToSelection } from '../lib/shortcuts'
import { formatLength, type Unit } from '../lib/units'
import {
  useRun,
  boreOf,
  tubeSpec,
  canConnect,
  colorOf,
  pieceSpec,
  isStructure,
  isSupport,
  placementOf,
  rodBetween,
  samePort,
  type Piece,
  type Placement,
  type Port,
  type Tool,
  type ToolScope,
  type TubeSpec,
  type Theme,
} from '../store'

/** See-through opacity for the tube wall; the selected piece stays a touch more solid. */
const XRAY_OPACITY = 0.3
const XRAY_OPACITY_SELECTED = 0.55

/**
 * Joint ends, by what they are: open and free to bond, held by the Connector
 * waiting for its mate, out of reach for the end in hand, bonded shut, and about
 * to be broken open.
 */
const PORT_OPEN = '#4d9cf5'
const PORT_PICKED = '#ff7a45'
const PORT_IDLE = '#8aa0b4'
const PORT_JOINED = '#3fb87f'
const PORT_BREAK = '#e2574c'

/**
 * Scene colours live in JS, so they get their own light/dark palette. The sky is
 * not among them — that one is the user's, and lives in the store.
 */
interface ScenePalette {
  skyLight: string
  groundLight: string
  fillLight: string
  hemiIntensity: number
  keyIntensity: number
  cellColor: string
  sectionColor: string
  shadowOpacity: number
  /**
   * The measuring box. Held to the same value as `--dim-line` in the stylesheet,
   * because the box in the scene and the figures drawn over it are one drawing:
   * a wireframe in a different colour from its own dimensions reads as two.
   */
  dim: string
  cube: CubePalette
}

/**
 * Selection reads as the full-strength colour against washed-out neighbours: the
 * parts you have not picked sit lightened toward white, the picked ones deepen.
 * Works against any hue the user chooses.
 */
function shades(hex: string) {
  const base = new THREE.Color(hex)
  return {
    /**
     * Picked, but not the part leading the set: the colour as the user chose it,
     * so it stands clear of the washed-out ones without taking the eye off the
     * part the panels and the handles are following.
     */
    base,
    /** Every part you have not picked, washed out so the picked ones carry the eye. */
    idle: base.clone().lerp(new THREE.Color('#ffffff'), 0.45),
    selected: base.clone().lerp(new THREE.Color('#000000'), 0.22),
    /** Just enough self-lit colour to keep the deepened part from reading as black. */
    emissive: base.clone().multiplyScalar(0.12),
    /** Faint self-lit sheen, so the marble keeps its glassy look at any hue. */
    sheen: base.clone().multiplyScalar(0.22),
    black: new THREE.Color('#000000'),
  }
}

const PALETTE: Record<Theme, ScenePalette> = {
  light: {
    skyLight: '#ffffff',
    groundLight: '#b9c8d6',
    fillLight: '#cfe0ff',
    hemiIntensity: 1.5,
    keyIntensity: 1.7,
    cellColor: '#c6d3e0',
    sectionColor: '#93b0c9',
    shadowOpacity: 0.28,
    dim: '#5c748c',
    cube: { face: '#f7fafc', text: '#2c3d4f', line: '#aebfd0', hover: '#7fb2f5' },
  },
  dark: {
    skyLight: '#cfe6ff',
    groundLight: '#20303f',
    fillLight: '#7fb6ff',
    hemiIntensity: 1.1,
    keyIntensity: 2,
    cellColor: '#22364b',
    sectionColor: '#3b6a94',
    shadowOpacity: 0.45,
    dim: '#7fa3c1',
    cube: { face: '#1b2836', text: '#cfe0f0', line: '#3d5f80', hover: '#4d8fd6' },
  },
}

function PieceMesh({
  spec,
  piece,
  position,
  quaternion,
  selected,
  lead,
  tint,
  xray,
  pickable,
  onClick,
  onHoverAt,
  onRightDown,
}: {
  spec: TubeSpec
  piece: Piece
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** In the picked set, whether or not it leads it. */
  selected: boolean
  /** The one part of the set the panels and the handles follow. */
  lead: boolean
  tint: ReturnType<typeof shades>
  xray: boolean
  /**
   * Whether a left-click on the solid picks the part. False while a joint tool
   * has the left button: the joint marks sit on the very surface of the wall, and
   * a part that answered the click first would swallow every one of them.
   */
  pickable: boolean
  /** True when the click was held with the key that picks more than one part. */
  onClick: (additive: boolean) => void
  /**
   * Where on this part's wall the pointer is, world — null once it has left.
   *
   * Only wired up while a tool wants it, because it fires on every mouse move
   * over every part on the stage. What reads it is the Support tool, which has
   * to know the spot on the run rather than merely which part is under the
   * cursor: a post goes somewhere along a tube, not on a tube.
   */
  onHoverAt?: (at: THREE.Vector3 | null) => void
  /** A right-press landed here; the stage decides whether it becomes a menu or an orbit. */
  onRightDown: (x: number, y: number) => void
}) {
  // Keyed on the shape rather than the piece, so nudging a part it sits behind
  // in the run — or renaming it — never rebuilds the solid.
  const shape = shapeKey(piece, spec)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geom = useMemo(() => buildPartGeometry(spec, piece), [spec, shape])
  useEffect(() => () => geom.dispose(), [geom])

  return (
    <mesh
      geometry={geom}
      position={position}
      quaternion={quaternion}
      // A see-through wall casting a solid shadow reads as a bug, so shadows go with it.
      castShadow={!xray}
      receiveShadow={!xray}
      onClick={
        pickable
          ? (e) => {
              e.stopPropagation()
              onClick(addsToSelection(e.nativeEvent))
            }
          : undefined
      }
      onPointerMove={
        onHoverAt
          ? (e) => {
              e.stopPropagation()
              onHoverAt(e.point.clone())
            }
          : undefined
      }
      onPointerOut={onHoverAt ? () => onHoverAt(null) : undefined}
      // Only the nearest part under the cursor is the one the menu is about.
      onPointerDown={(e) => {
        if (e.button !== 2) return
        e.stopPropagation()
        onRightDown(e.nativeEvent.clientX, e.nativeEvent.clientY)
      }}
    >
      <meshStandardMaterial
        // Rebuilt on mode change — flipping `transparent` in place needs a shader recompile.
        key={xray ? 'xray' : 'solid'}
        color={lead ? tint.selected : selected ? tint.base : tint.idle}
        emissive={lead ? tint.emissive : tint.black}
        metalness={xray ? 0 : 0.15}
        roughness={xray ? 0.25 : 0.45}
        side={THREE.DoubleSide}
        flatShading={false}
        transparent={xray}
        // Skipping the depth write keeps overlapping pieces from popping as the camera orbits.
        depthWrite={!xray}
        opacity={xray ? (selected ? XRAY_OPACITY_SELECTED : XRAY_OPACITY) : 1}
      />
    </mesh>
  )
}

/**
 * How much of the tube's end is picked out in the joint colour, mm. Scaled off
 * the wall so a fat tube gets a cuff rather than a pinstripe, and clamped so a
 * thin one does not end up coloured along most of its length.
 */
const bandDepth = (spec: TubeSpec) => Math.max(2.5, Math.min(6, spec.outerR * 0.7))

/**
 * One joint, drawn as the end of the tube itself in the joint colour: the same
 * section on the same centreline, no shape of its own. It sits exactly on the
 * piece's wall and wins the depth test by a polygon offset, so it reads as that
 * stretch of tube being coloured in.
 */
function PortMark({
  spec,
  piece,
  end,
  position,
  quaternion,
  color,
  glow,
  live,
  onArm,
  onEnter,
  onLeave,
}: {
  spec: TubeSpec
  piece: Piece
  end: 'in' | 'out'
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  color: string
  glow: number
  live: boolean
  onArm: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  // Keyed on the shape, like the piece's own solid: the band only changes when
  // the end it covers does.
  const shape = shapeKey(piece, spec)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geom = useMemo(
    () => buildEndBandGeometry(spec, centerlineFor(piece), end, bandDepth(spec)),
    [spec, shape, end],
  )
  useEffect(() => () => geom.dispose(), [geom])

  return (
    <mesh
      geometry={geom}
      position={position}
      quaternion={quaternion}
      onClick={(e) => {
        e.stopPropagation()
        onArm()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        onEnter()
      }}
      onPointerOut={onLeave}
    >
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={glow}
        metalness={0.2}
        roughness={live ? 0.28 : 0.42}
        side={THREE.DoubleSide}
        // Coincident with the wall it colours, so it has to win the tie.
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}

/** One end offered up by whichever joint tool is in hand. */
interface JointMark {
  key: string
  port: Port
  piece: Piece
  end: 'in' | 'out'
  /** The band is built in the piece's own frame, so it is placed the way the piece is. */
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** Where the part stands, for a joint that is about to be broken open. */
  at: { x: number; y: number; z: number; yaw: number }
}

/**
 * The ends the joint tools work on, coloured on the tube itself. Nothing is
 * added to the run to mark them: on a stage whose whole subject is a rolling
 * sphere, a marker with a shape of its own reads as another marble or another
 * part, while colour on the tube says "this end" and nothing else.
 *
 * The Connector offers the open ends — the inlet each run starts at and the
 * outlet each one finishes on. Click one, then the end it mates with, and the
 * two are bonded. The Disconnector offers the joints instead, and a click takes
 * one open, leaving both sides standing where they were.
 *
 * With neither tool in hand nothing is drawn: the ends only matter while you are
 * working on them, and the run is easier to read without them.
 */
function Joints({ asm, specOf }: { asm: Assembly; specOf: (piece: Piece) => TubeSpec }) {
  const { tool, pieces, pendingPort, pickPort, breakJoint } = useRun()
  const [hovered, setHovered] = useState<string | null>(null)
  const breaking = tool === 'disconnect'

  const marks = useMemo(() => {
    if (tool !== 'connect' && tool !== 'disconnect') return []
    const list: JointMark[] = []
    // A switched-off part is not on the stage to be worked on, so its ends go
    // with it rather than hanging in the air on their own.
    const mark = (p: Assembly['placed'][number], end: 'in' | 'out'): JointMark => ({
      key: `${p.piece.id}:${end}`,
      port: { pieceId: p.piece.id, end },
      piece: p.piece,
      end,
      position: p.start,
      quaternion: p.quaternion,
      at: {
        x: p.start.x,
        y: p.start.y,
        z: p.start.z,
        yaw: (p.yaw * 180) / Math.PI,
      },
    })

    if (tool === 'disconnect') {
      for (const p of asm.placed) {
        // The joint is at the inlet of the part bonded on, which is the part that
        // comes away when it is broken.
        if (p.piece.joined && !p.piece.hidden) list.push(mark(p, 'in'))
      }
      return list
    }

    for (const chain of asm.chains) {
      const head = asm.placed[chain.pieces[0]]
      const tail = asm.placed[chain.pieces[chain.pieces.length - 1]]
      // Structure is a run of one with no ends: a base is the ground under the
      // run and a support is what holds it up, rather than a length of it, and
      // there is nothing on either to plug into.
      if (head && isStructure(head.piece)) continue
      if (head && !head.piece.hidden) list.push(mark(head, 'in'))
      if (tail && !tail.piece.hidden) list.push(mark(tail, 'out'))
    }
    return list
  }, [asm, tool])

  useEffect(() => () => void (document.body.style.cursor = ''), [])

  // A mark that leaves the stage — the tool changed, or the joint it named has
  // just been made — takes its hover with it. Without this the mark that was
  // under the pointer is unmounted before it can say the pointer has left, and
  // nothing is left to hand the cursor back.
  useEffect(() => {
    setHovered(null)
    document.body.style.cursor = ''
  }, [marks])

  return (
    <group>
      {marks.map(({ key, port, piece, end, position, quaternion, at }) => {
        const picked = samePort(pendingPort, port)
        // With an end already in hand, only the ones it can actually mate with
        // are live — a second outlet has nothing to offer it.
        const reachable = breaking || !pendingPort || picked || canConnect(pieces, pendingPort, port)
        const live = picked || key === hovered
        const color = breaking
          ? key === hovered
            ? PORT_BREAK
            : PORT_JOINED
          : picked
            ? PORT_PICKED
            : reachable
              ? PORT_OPEN
              : PORT_IDLE
        return (
          <PortMark
            key={key}
            spec={specOf(piece)}
            piece={piece}
            end={end}
            position={position}
            quaternion={quaternion}
            color={color}
            glow={live ? 0.9 : reachable ? 0.5 : 0.15}
            live={live}
            onArm={() => (breaking ? breakJoint(piece.id, at) : pickPort(port))}
            onEnter={() => {
              setHovered(key)
              document.body.style.cursor = 'pointer'
            }}
            onLeave={() => {
              setHovered((h) => (h === key ? null : h))
              document.body.style.cursor = ''
            }}
          />
        )
      })}
    </group>
  )
}

/** Scratch vector for the projection below, so the per-frame path allocates nothing. */
const ndc = new THREE.Vector3()

/**
 * Posts where the move figures belong on the glass, every frame.
 *
 * The points themselves are in the world — the foot of the drop line on the
 * workplane, its head on the underside of everything picked, and the part the
 * arrows sit on — so the figures stay pinned to the run as the camera swings
 * around it.
 * Only the projection happens here; the drawing is done in the DOM over the
 * canvas, where text stays crisp and unmirrored at any angle.
 */
function MoveProbe({
  foot,
  head,
  anchor,
  height,
  travel,
}: {
  foot: THREE.Vector3
  head: THREE.Vector3
  anchor: THREE.Vector3
  /** Underside of everything the arrows are holding, over the workplane, mm. */
  height: number
  /** Travel since the drag began, mm; null when the arrows are only sitting there. */
  travel: { x: number; y: number; z: number } | null
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  useFrame(() => {
    /** Onto the glass; false for a point that has gone behind the camera. */
    const put = (v: THREE.Vector3, out: { x: number; y: number }) => {
      ndc.copy(v).project(camera)
      out.x = (ndc.x * 0.5 + 0.5) * size.width
      out.y = (0.5 - ndc.y * 0.5) * size.height
      return ndc.z <= 1
    }
    const footOn = put(foot, measure.foot)
    const headOn = put(head, measure.head)
    measure.spanOn = footOn && headOn
    measure.anchorOn = put(anchor, measure.anchor)
    measure.height = height
    measure.dragging = travel !== null
    measure.travel.x = travel?.x ?? 0
    measure.travel.y = travel?.y ?? 0
    measure.travel.z = travel?.z ?? 0
    measure.live = true
  })

  // Nothing selected, or the tool put down: the figures go with the arrows.
  useEffect(() => () => void (measure.live = false), [])
  return null
}

/**
 * Scratch, so the measuring box's per-frame path allocates nothing either.
 */
const boxScratch = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  mid: new THREE.Vector3(),
}

/**
 * The twelve edges of a box, as a geometry to draw them with — what both the
 * measuring box and the alignment datum are drawn as, since both are the same
 * annotation: a frame round the parts in question that hides none of them.
 *
 * Held to the box it was built from and disposed with it, so panning the camera
 * round a stationary box rebuilds nothing.
 */
function useBoxWire(box: THREE.Box3) {
  const wire = useMemo(() => {
    const size = box.getSize(new THREE.Vector3())
    // A run drawn on one plane has a span of nought the third way, and a box
    // geometry of zero depth is a plane with no edges to draw. A hair of
    // thickness keeps all twelve, and is far under anything printable.
    const solid = new THREE.BoxGeometry(
      Math.max(size.x, 0.01),
      Math.max(size.y, 0.01),
      Math.max(size.z, 0.01),
    )
    const edges = new THREE.EdgesGeometry(solid)
    solid.dispose()
    return edges
  }, [box])
  useEffect(() => () => wire.dispose(), [wire])
  return wire
}

/**
 * The box drawn round what is being measured, and the three edges its spans are
 * dimensioned on.
 *
 * A wireframe rather than a solid, and drawn with the depth test off, so it
 * frames the run without hiding any of it — a measurement is an annotation on
 * the model, not another thing standing in front of it.
 *
 * Which three of the twelve edges carry the figures is decided from where the
 * camera is, so none of them ever goes round the back: the two spans across the
 * plan are dimensioned along the foot of the box on the two sides nearest the
 * eye, and the height up the upright at the far end of the width — the near face
 * carrying its width along the bottom and its height up one side, which is how
 * an elevation is dimensioned. Hung all three off the one corner they would
 * crowd into each other on a small part; a span apart, they never can.
 *
 * They only swap sides when the camera crosses a face of the box, which is the
 * one moment a figure that stayed put would be the wrong one to read.
 */
function MeasureBox({ box, color }: { box: THREE.Box3; color: string }) {
  const camera = useThree((s) => s.camera)
  const view = useThree((s) => s.size)
  const wire = useBoxWire(box)

  useFrame(() => {
    const { min, max } = box
    boxScratch.mid.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
    // The corner turned toward the camera on the plan, at the foot of the box —
    // and, for the height, the far end of the width, so the three figures are
    // spread along the near face rather than piled on one corner of it.
    const nx = camera.position.x >= boxScratch.mid.x ? max.x : min.x
    const nz = camera.position.z >= boxScratch.mid.z ? max.z : min.z
    const fx = nx === max.x ? min.x : max.x

    /** Onto the glass; false for a point that has gone behind the camera. */
    const put = (v: THREE.Vector3, out: { x: number; y: number }) => {
      ndc.copy(v).project(camera)
      out.x = (ndc.x * 0.5 + 0.5) * view.width
      out.y = (0.5 - ndc.y * 0.5) * view.height
      return ndc.z <= 1
    }
    const middle = { x: 0, y: 0 }
    put(boxScratch.mid, middle)

    /** Dimensions one edge, given its two ends in the world. */
    const dim = (span: SizeSpan, mm: number, a: THREE.Vector3, b: THREE.Vector3) => {
      span.mm = mm
      span.on = [put(a, span.a), put(b, span.b)].every(Boolean)
      const dx = span.b.x - span.a.x
      const dy = span.b.y - span.a.y
      const len = Math.hypot(dx, dy) || 1
      let px = -dy / len
      let py = dx / len
      // Thrown out on whichever side of the edge faces away from the middle of
      // the box, so the figure never lands back on top of what it measures.
      if (px * ((span.a.x + span.b.x) / 2 - middle.x) + py * ((span.a.y + span.b.y) / 2 - middle.y) < 0) {
        px = -px
        py = -py
      }
      span.off.x = px
      span.off.y = py
    }

    dim(
      spans.width,
      max.x - min.x,
      boxScratch.a.set(min.x, min.y, nz),
      boxScratch.b.set(max.x, min.y, nz),
    )
    dim(
      spans.length,
      max.z - min.z,
      boxScratch.a.set(nx, min.y, min.z),
      boxScratch.b.set(nx, min.y, max.z),
    )
    dim(
      spans.height,
      max.y - min.y,
      boxScratch.a.set(fx, min.y, nz),
      boxScratch.b.set(fx, max.y, nz),
    )
    spans.live = true
  })

  // The tool put down, or nothing left to measure: the figures go with the box.
  useEffect(() => () => void (spans.live = false), [])

  return (
    <lineSegments
      geometry={wire}
      position={[(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2]}
      renderOrder={3}
    >
      <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} toneMapped={false} />
    </lineSegments>
  )
}

/**
 * How far the datum plane is thrown out past the box it is read off, so it reads
 * as a plane the parts are being brought onto rather than as one more face of
 * that box. A fraction of the box, with a floor under it for a box small enough
 * that a fraction of it would be nothing.
 */
const DATUM_MARGIN = 0.18
const DATUM_MARGIN_MIN = 14

/**
 * The box the Align tool takes its datum off, and — while the pointer is resting
 * on one of the nine faces — the plane that face works out to.
 *
 * The box says what is being aligned *to*: the whole picked set, or the one part
 * the rest are coming to. Drawn the same way the measuring box is, and for the
 * same reason: it is an annotation on the model, not another thing standing in
 * front of it.
 *
 * The plane is the half the buttons cannot say. Nine buttons that all mean "line
 * these up" are told apart by which face each one means, and a face is a place in
 * the model — so it is shown in the model, before the click rather than after
 * it. It is thrown out past the box on all four sides, since the parts coming
 * onto it are by definition outside the face they are coming from.
 */
function AlignDatum({
  box,
  at,
  color,
}: {
  box: THREE.Box3
  at: { axis: 'x' | 'y' | 'z'; edge: 'min' | 'mid' | 'max' } | null
  color: string
}) {
  const wire = useBoxWire(box)

  // The plane's own two spans, where it stands, and how it is turned to face
  // down the axis. PlaneGeometry lies in XY looking down +Z, so Z needs no turn
  // at all and the other two are a quarter turn off it.
  const datum = useMemo(() => {
    if (!at) return null
    const size = box.getSize(new THREE.Vector3())
    const mid = box.getCenter(new THREE.Vector3())
    const pad = Math.max(Math.max(size.x, size.y, size.z) * DATUM_MARGIN, DATUM_MARGIN_MIN)
    const where =
      at.edge === 'min' ? box.min[at.axis] : at.edge === 'max' ? box.max[at.axis] : mid[at.axis]
    const position = mid.clone()
    position[at.axis] = where
    const [w, h, rotation]: [number, number, [number, number, number]] =
      at.axis === 'x'
        ? [size.z, size.y, [0, Math.PI / 2, 0]]
        : at.axis === 'y'
          ? [size.x, size.z, [-Math.PI / 2, 0, 0]]
          : [size.x, size.y, [0, 0, 0]]
    return {
      position: position.toArray() as [number, number, number],
      rotation,
      width: Math.max(w, 0.01) + pad * 2,
      height: Math.max(h, 0.01) + pad * 2,
    }
  }, [box, at])

  return (
    <>
      <lineSegments
        geometry={wire}
        position={[
          (box.min.x + box.max.x) / 2,
          (box.min.y + box.max.y) / 2,
          (box.min.z + box.max.z) / 2,
        ]}
        renderOrder={3}
      >
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} toneMapped={false} />
      </lineSegments>
      {datum && (
        <group position={datum.position} rotation={datum.rotation}>
          <DatumPlane width={datum.width} height={datum.height} color={color} />
        </group>
      )}
    </>
  )
}

/**
 * The face itself: a wash of colour with its own outline round it, square to
 * whichever axis the group it is in has been turned to.
 *
 * Faint enough to read the run through — it is a datum, not a wall — and outlined
 * at full strength so it has an edge rather than fading into a haze with no
 * boundary. Both geometries are built together and thrown away together, since
 * the outline is the fill's own edges.
 */
function DatumPlane({ width, height, color }: { width: number; height: number; color: string }) {
  const [face, outline] = useMemo(() => {
    const plane = new THREE.PlaneGeometry(width, height)
    return [plane, new THREE.EdgesGeometry(plane)] as const
  }, [width, height])
  useEffect(
    () => () => {
      face.dispose()
      outline.dispose()
    },
    [face, outline],
  )
  return (
    <>
      <mesh geometry={face} renderOrder={4}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.16}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={outline} renderOrder={5}>
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.9} toneMapped={false} />
      </lineSegments>
    </>
  )
}

/**
 * Puts the gizmo corrections on whichever handle is on stage — the arrows and
 * the turn rings are the same object underneath, so both are held to the same
 * rules. Hands back the ref callback the control is mounted with, and the
 * control itself: which handle is in hand is the gizmo's to say, and the rings
 * need to know, since one of the three does something the other two do not.
 */
function useTidyGizmo() {
  const [controls, setControls] = useState<GizmoControls | null>(null)
  useEffect(() => (controls ? tidyGizmo(controls) : undefined), [controls])
  // Taken as the plain object it is on the way in: three-stdlib marks the fields
  // the corrections read as private, and the class itself is drei's to import,
  // not ours.
  const ref = useCallback(
    (instance: THREE.Object3D | null) => setControls(instance as GizmoControls | null),
    [],
  )
  return [ref, controls] as const
}

/**
 * The runs the picked parts stand in, each named by one of the parts that picked
 * it and paired with where its head stands right now.
 *
 * A bonded part cannot travel on its own — that is what being bonded means — so
 * the handles work on runs rather than on parts, and a set of parts spanning
 * three runs is three runs to move. The part leading the selection comes first,
 * so the run under the handle is the one the timeline step is named after.
 */
function pickedChains(asm: Assembly, ids: string[], lead: string | null) {
  const order = lead ? [lead, ...ids.filter((id) => id !== lead)] : ids
  const seen = new Set<number>()
  const runs: { pieceId: string; at: Placement }[] = []
  for (const id of order) {
    const placed = asm.placed.find((p) => p.piece.id === id)
    const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
    if (root === undefined || seen.has(root)) continue
    seen.add(root)
    runs.push({ pieceId: id, at: placementOf(asm.placed[root].piece) })
  }
  return runs
}

/**
 * Which part the handles stand on and which runs they take hold of, at the reach
 * the tool was taken up with.
 *
 * At `selected` reach that is the part picked last, and the runs the picked
 * parts stand in — what {@link pickedChains} already works out. At `all` it is
 * every run on the stage, and the handle moves to the head of the run the pick
 * was in: the rings only swing whole runs about a run's head, so a reach that
 * takes everything has to stand on one to mean it. With nothing picked it stands
 * on the head of the first run, which is the one the marble sets off down.
 */
function handleRuns(
  asm: Assembly,
  ids: string[],
  lead: string | null,
  scope: ToolScope,
): { lead: string | null; runs: { pieceId: string; at: Placement }[] } {
  if (scope !== 'all') return { lead, runs: pickedChains(asm, ids, lead) }
  const from = lead ? asm.placed.find((p) => p.piece.id === lead)?.chain ?? 0 : 0
  // The picked run first, so the handle stands on it and the timeline step is
  // named after it — the same order pickedChains puts the lead in.
  const order = [from, ...asm.chains.map((_, i) => i).filter((i) => i !== from)]
  const runs = order.flatMap((i) => {
    const root = asm.chains[i]?.pieces[0]
    if (root === undefined) return []
    return [{ pieceId: asm.placed[root].piece.id, at: placementOf(asm.placed[root].piece) }]
  })
  return { lead: runs[0]?.pieceId ?? null, runs }
}

/** Tenths of a millimetre — finer than anything printable, and it keeps the
 *  numbers in the timeline readable. */
const tidyMm = (v: number) => Math.round(v * 10) / 10

/**
 * The three axis arrows, on the part leading the selection. Dragging one moves
 * every run that has a part picked in it: the arrows write a fresh placement at
 * the head of each, and everything joined to them follows.
 *
 * The whole set travels by the one distance, so the runs in it hold the
 * arrangement they were standing in — several runs moved together are still
 * several runs, not a run that has been rearranged.
 *
 * The handle is put on the part that was picked rather than at the head of its
 * run, so it is where the pointer already is; the fixed offset between the two
 * is what turns a drag there into a placement here.
 */
function MoveGizmo({ asm, specOf }: { asm: Assembly; specOf: (piece: Piece) => TubeSpec }) {
  const { selectedId, selectedIds, toolScope, placeChains } = useRun()
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  /**
   * Where every run being dragged stood when the drag began; null between drags.
   * The travel is measured off these rather than off the last frame, so a drag
   * of a hundred frames lands exactly where one of one would, and the figure
   * reports the whole of it.
   */
  const from = useRef<{ pieceId: string; at: Placement }[] | null>(null)
  const [origin, setOrigin] = useState<Placement | null>(null)
  const [setControls] = useTidyGizmo()
  const reach = handleRuns(asm, selectedIds, selectedId, toolScope)
  const placed = asm.placed.find((p) => p.piece.id === reach.lead)
  const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
  const at = root === undefined ? null : placementOf(asm.placed[root].piece)

  if (!placed || !at || !reach.lead) return null
  // Where the head of the run under the arrows stands relative to the part they
  // sit on. The run is rigid, so this holds for the whole drag.
  const dx = at.x - placed.start.x
  const dy = at.y - placed.start.y
  const dz = at.z - placed.start.z

  // The drop line hangs from the middle of the footprint of everything the
  // arrows have hold of: an edge would have to be chosen afresh every time the
  // camera swung past it, and the middle is the one point that reads the same
  // from every side.
  const box = new THREE.Box3()
  for (const chain of new Set(
    asm.placed
      .filter((p) => toolScope === 'all' || selectedIds.includes(p.piece.id))
      .map((p) => p.chain),
  )) {
    box.union(chainBox(asm, chain, (piece) => specOf(piece).outerR))
  }
  const midX = (box.min.x + box.max.x) / 2
  const midZ = (box.min.z + box.max.z) / 2
  const head = new THREE.Vector3(midX, box.min.y, midZ)
  const foot = new THREE.Vector3(midX, 0, midZ)

  return (
    <>
      <object3D ref={setProxy} position={[placed.start.x, placed.start.y, placed.start.z]} />
      {proxy && (
        <TransformControls
          ref={setControls}
          object={proxy}
          mode="translate"
          space="world"
          size={0.85}
          onMouseDown={() => {
            from.current = reach.runs
            setOrigin(at)
          }}
          onMouseUp={() => {
            from.current = null
            setOrigin(null)
          }}
          onObjectChange={() => {
            // The run under the arrows goes where the drag has put it; the rest
            // go the same distance from where they each began.
            const lead = { x: tidyMm(proxy.position.x + dx), y: tidyMm(proxy.position.y + dy), z: tidyMm(proxy.position.z + dz) }
            const runs = from.current ?? reach.runs
            const anchor = runs[0]?.at ?? at
            const gx = lead.x - anchor.x
            const gy = lead.y - anchor.y
            const gz = lead.z - anchor.z
            placeChains(
              runs.map(({ pieceId, at: was }) => ({
                pieceId,
                at: {
                  ...was,
                  x: tidyMm(was.x + gx),
                  y: tidyMm(was.y + gy),
                  z: tidyMm(was.z + gz),
                },
              })),
              'move',
            )
          }}
        />
      )}
      <MoveProbe
        foot={foot}
        head={head}
        anchor={placed.start}
        height={box.min.y}
        travel={origin && { x: at.x - origin.x, y: at.y - origin.y, z: at.z - origin.z }}
      />
    </>
  )
}

/**
 * A heading, tidied: folded back into (-180, 180] so a run swung round and round
 * never ends up carrying a four-figure angle, and cut to tenths of a degree,
 * which is as fine as anything reads it.
 */
const tidyYaw = (deg: number) => {
  const wrapped = (((deg + 180) % 360) + 360) % 360 - 180
  return Math.round(wrapped * 10) / 10
}

/**
 * The heading and fall a direction works out to, radians — {@link directionFor}
 * read backwards, which is how a ring drag becomes angles a part can hold.
 *
 * Straight up or down has no heading of its own: every heading points there
 * equally, and `atan2` of nothing is a lie dressed as an answer. So the heading
 * the part already had is kept, which is what stops a part dragged through the
 * vertical from spinning on the way past.
 */
function aimOf(dir: THREE.Vector3, keepYaw: number) {
  const level = Math.hypot(dir.x, dir.z)
  return {
    yaw: level > 1e-6 ? Math.atan2(dir.x, dir.z) : keepYaw,
    slope: Math.asin(THREE.MathUtils.clamp(-dir.y, -1, 1)),
  }
}

/**
 * The three turn rings, on the part leading the selection — the world's own
 * axes, the same three the move arrows travel on, so red is X, green Y and blue
 * Z on both handles.
 *
 * What a drag does depends on whether the part is bonded onto anything, because
 * those are two different questions with the same gesture behind them.
 *
 * **A part in the middle of a run** is aimed where the ring points it, and the
 * run bends there. Its inlet does not move, so every part ahead of it stands
 * exactly where it was; the part swings about that joint and everything bonded
 * behind it comes along rigidly, holding its shape. The joint itself stays
 * straight — what the swing opens up is taken by a break a lock past it, which
 * is the bend the tube is really cut with, sharp or rounded as the tool is set.
 *
 * **A part at the head of a run** has nothing in front of it to hold, so the
 * green ring still swings whole runs: every run with a part picked in it turns
 * about this one, which stands still, so a set picked across several runs keeps
 * the arrangement it was standing in. That means writing the head of every run
 * a new place as well as a new heading. Red and blue aim that part the same way
 * they aim a bonded one — from a run's head, which comes to the same thing as
 * tipping the run.
 *
 * Whichever ring is dragged, what is written is a heading and a fall: those are
 * the two angles a part has, and the ring's turn is read back into them off the
 * direction it leaves the part's axis pointing. A part cannot be rolled about
 * its own axis — a roll is a part's own shape, a hook's turn plane and nothing
 * at all on anything else — so a ring turning about the axis the part already
 * runs down has nothing to write and the part holds still. That is the one
 * place the rings do less than they look like they should.
 */
function RotateGizmo({ asm }: { asm: Assembly }) {
  const { selectedId, selectedIds, toolScope, placeChains, aimPart, rotateStep } = useRun()
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  /**
   * Where the runs stood when the drag began, what they are turning about, and
   * the aim the part itself set off from. The whole drag is measured off these
   * rather than off the last frame, so rounding never accumulates into a drift
   * over a long swing, and a swing held against a limit never creeps past it.
   */
  const from = useRef<{
    runs: { pieceId: string; at: Placement }[]
    pivot: THREE.Vector3
    frame: THREE.Quaternion
    /** Which way the part's body ran — what the ring turns. */
    dir: THREE.Vector3
    /** The heading the part is fed at, radians: its own turn measured off this. */
    fed: number
    turn: number
    slope: number
    /** The ring in hand. Only the green one on a run's head is a special case. */
    axis: string | null
  } | null>(null)
  const [setControls, controls] = useTidyGizmo()
  const reach = handleRuns(asm, selectedIds, selectedId, toolScope)
  const lead = reach.lead
  const placed = asm.placed.find((p) => p.piece.id === lead)
  const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
  const at = root === undefined ? null : placementOf(asm.placed[root].piece)

  if (!placed || !at || !lead || root === undefined) return null
  const piece = placed.piece
  // A run's head is the one part with nothing in front of it to hold still, so
  // it is the one part whose green ring still swings the run it stands in. At
  // `all` reach the handle is always stood on one, so the green ring always does.
  const head = asm.placed[root].piece.id === lead
  const snap = (deg: number) => (rotateStep > 0 ? Math.round(deg / rotateStep) * rotateStep : deg)

  return (
    <>
      <object3D
        ref={setProxy}
        position={[placed.start.x, placed.start.y, placed.start.z]}
        quaternion={frameFor(placed.yaw, placed.pitch)}
      />
      {proxy && (
        <TransformControls
          ref={setControls}
          object={proxy}
          mode="rotate"
          // The rings are the world's axes, so they read the same as the arrows
          // and stay where they are as the part swings under them.
          space="world"
          size={0.85}
          // The notch the tool is set to, in the radians the gizmo counts in.
          // Unset — which is what nought means — leaves the swing free.
          rotationSnap={rotateStep > 0 ? THREE.MathUtils.degToRad(rotateStep) : null}
          onMouseDown={() => {
            from.current = {
              runs: reach.runs,
              pivot: placed.start.clone(),
              frame: proxy.quaternion.clone(),
              dir: directionFor(placed.yaw, placed.pitch),
              fed: placed.yaw - THREE.MathUtils.degToRad(piece.turn),
              turn: piece.turn,
              slope: piece.slope,
              axis: controls?.axis ?? null,
            }
          }}
          onMouseUp={() => {
            from.current = null
          }}
          onObjectChange={() => {
            const f = from.current
            if (!f) return
            // The turn the ring has made, in the world: the frame it has carried
            // the proxy to, less the one it started from. The proxy is stood back
            // up on the part every frame, so this has to be measured against the
            // frame the drag began on rather than the last one drawn.
            const swung = proxy.quaternion.clone().multiply(f.frame.clone().invert())
            const aim = aimOf(
              f.dir.clone().applyQuaternion(swung),
              f.fed + THREE.MathUtils.degToRad(f.turn),
            )
            // Snapped as a movement rather than as an angle, so a part standing
            // at 3.7° does not jump to nought the moment it is touched.
            const turn = tidyYaw(f.turn + snap(THREE.MathUtils.radToDeg(aim.yaw - f.fed) - f.turn))
            const slope = tidyYaw(
              f.slope + snap(THREE.MathUtils.radToDeg(aim.slope) - f.slope),
            )
            // The green ring on a run's head is the one gesture that moves whole
            // runs: there is nothing in front of that part to hold still, and it
            // is the only handle that can carry a set picked across several runs
            // round together.
            if (!head || f.axis !== 'Y') {
              aimPart(lead, { turn, slope })
              return
            }
            const d = THREE.MathUtils.degToRad(turn - f.turn)
            const c = Math.cos(d)
            const s = Math.sin(d)
            placeChains(
              f.runs.map(({ pieceId, at: was }) => {
                const px = was.x - f.pivot.x
                const pz = was.z - f.pivot.z
                return {
                  pieceId,
                  at: {
                    // The same turn the heading takes, applied to where the head
                    // of that run stands relative to the point being turned about.
                    x: tidyMm(f.pivot.x + px * c + pz * s),
                    y: was.y,
                    z: tidyMm(f.pivot.z - px * s + pz * c),
                    yaw: tidyYaw(was.yaw + THREE.MathUtils.radToDeg(d)),
                  },
                }
              }),
              'rotate',
            )
          }}
        />
      )}
    </>
  )
}

function Marble({ asm, specOf }: { asm: Assembly; specOf: (piece: Piece) => TubeSpec }) {
  const {
    marbleDiameter,
    marbleColor,
    running,
    loop,
    timeScale,
    friction,
    bounce,
    resetToken,
    innerDiameter,
  } = useRun()
  const tint = useMemo(() => shades(marbleColor), [marbleColor])
  const mesh = useRef<THREE.Mesh>(null)
  const state = useRef(createMarble())
  const radius = marbleDiameter / 2
  // The floor is the bore of whichever part the marble is in, so it drops as it
  // rolls into a part sized wider than the run and rides up in a narrower one.
  const rest = useCallback(
    (piece: Piece) => Math.max(boreOf(piece, innerDiameter) / 2 - radius, 0),
    [innerDiameter, radius],
  )
  // Every surface on the stage, solved from the same layout the meshes are drawn
  // from — so what the marble hits in the air is exactly what is on screen.
  const world = useMemo(() => buildWorld(asm, specOf), [asm, specOf])
  const phys = useMemo(
    () => ({ friction, bounce, radius, rest }),
    [friction, bounce, radius, rest],
  )

  useLayoutEffect(() => {
    resetMarble(state.current, asm, rest)
    mesh.current?.position.copy(state.current.position)
  }, [asm, rest, resetToken])

  // Off stage means no readout to give — leave the HUD at zero, not at the last run's numbers.
  useEffect(
    () => () => {
      telemetry.speed = 0
      telemetry.distance = 0
      telemetry.airborne = false
      telemetry.stuck = false
    },
    [],
  )

  useFrame((_, delta) => {
    const m = state.current
    if (running) {
      const dt = Math.min(delta, 1 / 30) * timeScale
      // Fixed sub-steps keep the joint hand-off stable at high speed, and keep a
      // fast marble from stepping clean through a wall between two frames.
      const steps = 4
      for (let i = 0; i < steps; i++) {
        const { lost } = stepMarble(m, dt / steps, asm, world, phys)
        if (lost) {
          if (loop) resetMarble(m, asm, rest)
          break
        }
      }
    }
    mesh.current?.position.copy(m.position)
    if (mesh.current) mesh.current.rotation.x = m.spin
    telemetry.speed = m.airborne ? m.velocity.length() : Math.abs(m.v)
    telemetry.distance = m.s
    telemetry.airborne = m.airborne
    telemetry.stuck = m.stuck
  })

  return (
    <mesh ref={mesh} castShadow>
      <sphereGeometry args={[radius, 32, 24]} />
      <meshStandardMaterial
        color={tint.base}
        metalness={0.6}
        roughness={0.18}
        emissive={tint.sheen}
      />
    </mesh>
  )
}

/**
 * The triad rides in a corner viewport of its own, where a unit is a screen
 * pixel rather than a millimetre — so these are the size it draws on screen, at
 * any zoom. Roughly half the view cube in the opposite corner.
 */
const AXIS_LENGTH = 26
/** Shaft radius, and the head it opens out into at the tip. */
const AXIS_SHAFT_R = 1.1
const AXIS_HEAD_R = 3.2
const AXIS_HEAD_LEN = 8

/** RGB in axis order, the convention every CAD package shares. */
const AXIS_COLORS = { x: '#e5484d', y: '#3fb950', z: '#4a8fe7' } as const

/**
 * A letter drawn to a canvas, for the sprite at an arrow's tip. Painted white on
 * transparent and tinted by the sprite's own colour, so all three share one
 * texture rather than one apiece.
 */
function letterTexture(letter: string) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 48px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, size / 2, size / 2 + 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * One arrow of the triad: a shaft along +Y in its own space, turned onto the
 * axis it names by the caller's rotation, with a billboarded letter parked past
 * the tip. Unlit, so the colour reads the same in either theme, and unpickable,
 * so it never eats a click meant for the run behind it.
 */
function Axis({ axis, rotation }: { axis: 'x' | 'y' | 'z'; rotation: [number, number, number] }) {
  const color = AXIS_COLORS[axis]
  const label = useMemo(() => letterTexture(axis.toUpperCase()), [axis])
  useEffect(() => () => label.dispose(), [label])
  const shaftLen = AXIS_LENGTH - AXIS_HEAD_LEN

  return (
    <group rotation={rotation}>
      <mesh position={[0, shaftLen / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[AXIS_SHAFT_R, AXIS_SHAFT_R, shaftLen, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, shaftLen + AXIS_HEAD_LEN / 2, 0]} raycast={() => null}>
        <coneGeometry args={[AXIS_HEAD_R, AXIS_HEAD_LEN, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <sprite position={[0, AXIS_LENGTH + 7, 0]} scale={[10, 10, 10]} raycast={() => null}>
        <spriteMaterial map={label} color={color} toneMapped={false} depthTest={false} />
      </sprite>
    </group>
  )
}

/**
 * Where the first of a rod's two clicks landed, marked on the stage.
 *
 * A small unlit ball, drawn in front of everything and answering no click of its
 * own — it is a note about the gesture in hand rather than a thing on the stage,
 * and it goes as soon as the second click lands or Escape is pressed.
 */
function SpotMark({ at }: { at: { x: number; y: number; z: number } }) {
  return (
    <mesh position={[at.x, at.y, at.z]} raycast={() => null}>
      <sphereGeometry args={[2.4, 16, 12]} />
      <meshBasicMaterial color="#3fbf9f" toneMapped={false} depthTest={false} transparent />
    </mesh>
  )
}

/** How solid the ghost post under the pointer is drawn, 0–1. */
const GHOST_OPACITY = 0.55

/**
 * The post that would be stood where the pointer is, drawn where it would
 * stand — the whole of what the Support tool shows before you commit to it.
 *
 * It is the real solid, built from the real numbers, and not a marker standing
 * in for one: the thing worth seeing before you click is whether the cradle
 * actually reaches the pipe, whether the post is a post or a wafer, and — on a
 * stacked run — which level it has decided to stand on. A box or a crosshair
 * would answer none of those.
 *
 * Unpickable, so it never eats the click it is previewing, and drawn without
 * writing depth so the run stays visible through it.
 */
function SupportGhost({ spec, piece, color }: { spec: TubeSpec; piece: Piece; color: string }) {
  const shape = shapeKey(piece, spec)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geom = useMemo(() => buildPartGeometry(spec, piece), [spec, shape])
  useEffect(() => () => geom.dispose(), [geom])
  const at = placementOf(piece)
  const quaternion = useMemo(
    () => frameFor(THREE.MathUtils.degToRad(at.yaw + piece.turn), 0),
    [at.yaw, piece.turn],
  )

  return (
    <mesh
      geometry={geom}
      position={[at.x, at.y, at.z]}
      quaternion={quaternion}
      raycast={() => null}
    >
      <meshStandardMaterial
        color={color}
        transparent
        opacity={GHOST_OPACITY}
        depthWrite={false}
        roughness={0.4}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/**
 * Which way is X, Y and Z. It sits in a corner rather than out in the run, and
 * turns with the camera instead of the run turning under it, so it stays the
 * same size in the same place however far you have zoomed or orbited. +Y is up;
 * X and Z lie in the workplane.
 */
function AxisTriad() {
  return (
    <group>
      {/* The arrow is modelled along +Y, so X and Z are that same arrow tipped over. */}
      <Axis axis="x" rotation={[0, 0, -Math.PI / 2]} />
      <Axis axis="y" rotation={[0, 0, 0]} />
      <Axis axis="z" rotation={[Math.PI / 2, 0, 0]} />
      <mesh raycast={() => null}>
        <sphereGeometry args={[AXIS_SHAFT_R * 1.8, 16, 12]} />
        <meshBasicMaterial color="#8a97a5" toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * The angle the home button returns to. The camera stands on the +X side, the
 * standard front-top-right that every CAD package opens on: from there the
 * triad spreads out — Y up, X down to the right, Z down to the left — which is
 * the whole point of having one. The cost is that a run with no turns travels
 * down +Z, so it reads right-to-left on this stage, mirrored from the way the
 * 2D elevation develops. Mirroring this back to -X un-spreads the triad.
 */
const HOME_DIR = new THREE.Vector3(0.62, 0.5, 0.6).normalize()

/**
 * Headroom left around whatever is being framed. Fit crops in close on its
 * subject; home deliberately stands well back, so the run reads in the context
 * of the workplane around it rather than filling the view.
 */
const FIT_PAD = 1.12
const HOME_PAD = 2.4

/** One camera move, asked for by a button or by a click on the view cube. */
interface ViewGoal {
  /** Bumped per request, so repeating the same move still fires. */
  token: number
  /** Where the camera should end up looking from; null keeps the current angle. */
  dir: THREE.Vector3 | null
  /** Re-frame on `box`, rather than keeping the current distance. */
  frame: boolean
  /** What to put in frame; null means the whole run. */
  box: THREE.Box3 | null
  /** Headroom multiplier around the framed subject. */
  pad: number
}

interface OrbitLike {
  target: THREE.Vector3
  update: () => void
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
}

interface Move {
  fromDir: THREE.Vector3
  turn: THREE.Quaternion
  fromRadius: number
  toRadius: number
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  t: number
}

const MOVE_SECONDS = 0.45
/** Roughly 0.6° of orbit per pixel dragged on the cube. */
const CUBE_ORBIT_RATE = 0.0105
/** Never let the camera reach the poles, where the orbit azimuth goes undefined. */
const POLE_GUARD = 0.02

type OrbitFn = (dx: number, dy: number) => void
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Scratch objects, so the per-frame path allocates nothing. */
const scratch = {
  q: new THREE.Quaternion(),
  dir: new THREE.Vector3(),
  target: new THREE.Vector3(),
}

function CameraRig({
  asm,
  goal,
  orbitRef,
}: {
  asm: Assembly
  goal: ViewGoal
  /** Filled in with an orbit function the view cube can drive. */
  orbitRef: React.RefObject<OrbitFn | null>
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as OrbitLike | null
  const move = useRef<Move | null>(null)
  // The very first framing is a jump, not a swing — there is nothing to swing from.
  const settled = useRef(false)
  // Read inside the effect without re-framing every time a piece is nudged.
  const asmRef = useRef(asm)
  asmRef.current = asm

  const place = (m: Move, e: number) => {
    scratch.q.identity().slerp(m.turn, e)
    scratch.dir.copy(m.fromDir).applyQuaternion(scratch.q)
    scratch.target.copy(m.fromTarget).lerp(m.toTarget, e)
    camera.position.copy(scratch.target).addScaledVector(scratch.dir, THREE.MathUtils.lerp(m.fromRadius, m.toRadius, e))
    camera.up.set(0, 1, 0)
    camera.lookAt(scratch.target)
    if (controls) {
      controls.target.copy(scratch.target)
      controls.update()
    }
  }

  useEffect(() => {
    orbitRef.current = (dx, dy) => {
      // A drag on the cube beats an animation in flight.
      move.current = null
      const target = controls ? controls.target : scratch.target.set(0, 0, 0)
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target))
      sph.theta -= dx * CUBE_ORBIT_RATE
      sph.phi = THREE.MathUtils.clamp(sph.phi - dy * CUBE_ORBIT_RATE, POLE_GUARD, Math.PI - POLE_GUARD)
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph))
      camera.up.set(0, 1, 0)
      camera.lookAt(target)
      controls?.update()
    }
    return () => {
      orbitRef.current = null
    }
  }, [camera, controls, orbitRef])

  // A drag beats an animation in flight — the user has taken the wheel.
  useEffect(() => {
    if (!controls) return
    const stop = () => (move.current = null)
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useEffect(() => {
    const box = goal.box ?? asmRef.current.bounds
    const fromTarget = controls ? controls.target.clone() : new THREE.Vector3()
    const offset = camera.position.clone().sub(fromTarget)
    const fromRadius = Math.max(offset.length(), 1e-3)
    const fromDir = offset.divideScalar(fromRadius)

    const toTarget = goal.frame && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : fromTarget.clone()
    const toDir = goal.dir ? goal.dir.clone().normalize() : fromDir.clone()
    // Straight down or straight up leaves the orbit azimuth undefined, so tip it a hair.
    if (Math.abs(toDir.y) > 0.9999) toDir.setZ(toDir.z + 0.0015).normalize()

    let toRadius = fromRadius
    if (goal.frame) {
      const radius = Math.max(box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length() / 2, 60)
      // Frame the bounding sphere on whichever of the two FOVs is tighter.
      const vFov = THREE.MathUtils.degToRad(camera.fov)
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
      toRadius = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * goal.pad
      camera.near = Math.max(toRadius / 800, 0.5)
      camera.far = toRadius * 12
      camera.updateProjectionMatrix()
    }

    const m: Move = {
      fromDir,
      turn: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
      fromRadius,
      toRadius,
      fromTarget,
      toTarget,
      t: 0,
    }
    if (settled.current) {
      move.current = m
    } else {
      settled.current = true
      move.current = null
      place(m, 1)
    }
    // Only a fresh request moves the camera; editing a piece must not yank the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, controls, camera])

  useFrame((_, delta) => {
    const m = move.current
    if (!m) return
    m.t = Math.min(m.t + delta / MOVE_SECONDS, 1)
    place(m, easeInOut(m.t))
    if (m.t >= 1) move.current = null
  })

  return null
}

/** How far the height figure stands off the drop line it belongs to, in px. */
const FIGURE_OFF = 46

/** How far past the figure the extension lines reach, in px. */
const EXT_OVER = 14

/** Movement below this is nothing anyone asked for, so the axis is left out. */
const TRAVEL_EPSILON = 0.05

const AXES = ['x', 'y', 'z'] as const

/** A travel figure carries its direction with it: `+12 mm`, or `-2 mm`. */
const signed = (mm: number, unit: Unit) =>
  `${mm >= 0 ? '+' : '-'}${formatLength(Math.abs(mm), unit)}`

/**
 * The two figures the move arrows are read by, drawn over the canvas rather
 * than in it: where the run stands, and how far this drag has taken it.
 *
 * They answer different questions and so are placed apart. The height is a
 * property of the run — how far its underside clears the workplane — so it is
 * dimensioned against the workplane in the drafting way, a drop line squared off
 * at both ends with the figure on it. The travel is a property of the drag, so
 * it rides beside the arrows being dragged and leaves with them.
 *
 * Sampled on a clock of its own: the numbers are rewritten every
 * frame from inside the render loop, and an identical frame is dropped before it
 * can cost a render, so a stage nobody is touching costs nothing.
 */
function MoveFigures() {
  const { units } = useRun()
  const [m, setM] = useState<MoveMeasure | null>(null)
  /** What was last drawn, so an unchanged frame never re-renders. */
  const stamp = useRef('')

  useEffect(() => {
    let id = 0
    const tick = () => {
      const key = measure.live
        ? [
            Math.round(measure.foot.x),
            Math.round(measure.foot.y),
            Math.round(measure.head.x),
            Math.round(measure.head.y),
            Math.round(measure.anchor.x),
            Math.round(measure.anchor.y),
            measure.height,
            measure.dragging,
            measure.spanOn,
            measure.anchorOn,
            measure.travel.x,
            measure.travel.y,
            measure.travel.z,
          ].join(',')
        : ''
      if (key !== stamp.current) {
        stamp.current = key
        setM(
          measure.live
            ? {
                ...measure,
                travel: { ...measure.travel },
                foot: { ...measure.foot },
                head: { ...measure.head },
                anchor: { ...measure.anchor },
              }
            : null,
        )
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

  if (!m) return null

  const lx = m.head.x - m.foot.x
  const ly = m.head.y - m.foot.y
  // A run sitting on the workplane has no drop line to square off; the figure
  // still belongs there, reading zero, so it is hung straight off the foot.
  const len = Math.hypot(lx, ly) || 1
  // Square across the drop line, always thrown to the right of it, so the figure
  // never lands back on the run it is measuring.
  let px = -ly / len
  let py = lx / len
  if (px < 0) {
    px = -px
    py = -py
  }
  const ox = px * FIGURE_OFF
  const oy = py * FIGURE_OFF
  const over = FIGURE_OFF + EXT_OVER
  const moved = AXES.filter((a) => Math.abs(m.travel[a]) >= TRAVEL_EPSILON)

  return (
    <div className="move-figures" aria-hidden="true">
      {m.spanOn && (
        <>
          <svg className="move-dim">
            <defs>
              {/* One head, turned about on the near end, so both point outward
                  onto the lines they are measured between — the drafting way
                  round. */}
              <marker
                id="move-tick"
                markerWidth="9"
                markerHeight="9"
                refX="8.5"
                refY="4.5"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 1 1 L 8.5 4.5 L 1 8 z" />
              </marker>
            </defs>
            <line
              className="ext"
              x1={m.foot.x}
              y1={m.foot.y}
              x2={m.foot.x + px * over}
              y2={m.foot.y + py * over}
            />
            <line
              className="ext"
              x1={m.head.x}
              y1={m.head.y}
              x2={m.head.x + px * over}
              y2={m.head.y + py * over}
            />
            <line
              className="bar"
              x1={m.foot.x + ox}
              y1={m.foot.y + oy}
              x2={m.head.x + ox}
              y2={m.head.y + oy}
              markerStart="url(#move-tick)"
              markerEnd="url(#move-tick)"
            />
          </svg>
          {/* Centred on the dimension line: the plate breaks the bar where it
              sits, which is how a figure is set into one on a drawing. */}
          <div
            className="move-figure"
            style={{ left: (m.foot.x + m.head.x) / 2 + ox, top: (m.foot.y + m.head.y) / 2 + oy }}
          >
            <span className="cap">Over workplane</span>
            <b>{formatLength(m.height, units)}</b>
          </div>
        </>
      )}
      {m.dragging && m.anchorOn && (
        <div className="move-figure travel" style={{ left: m.anchor.x, top: m.anchor.y }}>
          <span className="cap">Moved</span>
          {moved.length ? (
            moved.map((a) => (
              <b key={a}>
                <i>{a.toUpperCase()}</i>
                {signed(m.travel[a], units)}
              </b>
            ))
          ) : (
            <b>{formatLength(0, units)}</b>
          )}
        </div>
      )}
    </div>
  )
}

/** How far the size figures stand off the edge they dimension, in px. */
const SIZE_OFF = 34

/**
 * The three figures the measuring box is read by: its width, its length and its
 * height, each set into a dimension line struck along the edge it is taken from.
 *
 * Drawn over the canvas rather than in it for the reason {@link MoveFigures} is —
 * the text stays crisp and the right way up however the camera is swung — and
 * sampled on the same clock, so a stage nobody is touching costs nothing.
 */
function SizeFigures() {
  const { units } = useRun()
  const [m, setM] = useState<SizeMeasure | null>(null)
  /** What was last drawn, so an unchanged frame never re-renders. */
  const stamp = useRef('')

  useEffect(() => {
    let id = 0
    const tick = () => {
      const key = spans.live
        ? SPAN_KEYS.flatMap((k) => {
            const s = spans[k]
            return [s.mm, s.on, Math.round(s.a.x), Math.round(s.a.y), Math.round(s.b.x), Math.round(s.b.y)]
          }).join(',')
        : ''
      if (key !== stamp.current) {
        stamp.current = key
        setM(
          spans.live
            ? {
                live: true,
                width: { ...spans.width, a: { ...spans.width.a }, b: { ...spans.width.b }, off: { ...spans.width.off } },
                length: { ...spans.length, a: { ...spans.length.a }, b: { ...spans.length.b }, off: { ...spans.length.off } },
                height: { ...spans.height, a: { ...spans.height.a }, b: { ...spans.height.b }, off: { ...spans.height.off } },
              }
            : null,
        )
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

  if (!m) return null

  /** One dimension line, offset off its edge, with its figure set into it. */
  const draw = (key: (typeof SPAN_KEYS)[number], span: SizeSpan) => {
    const ox = span.off.x * SIZE_OFF
    const oy = span.off.y * SIZE_OFF
    const over = SIZE_OFF + EXT_OVER
    return (
      <g key={key}>
        <line className="ext" x1={span.a.x} y1={span.a.y} x2={span.a.x + span.off.x * over} y2={span.a.y + span.off.y * over} />
        <line className="ext" x1={span.b.x} y1={span.b.y} x2={span.b.x + span.off.x * over} y2={span.b.y + span.off.y * over} />
        <line
          className="bar"
          x1={span.a.x + ox}
          y1={span.a.y + oy}
          x2={span.b.x + ox}
          y2={span.b.y + oy}
          markerStart="url(#size-tick)"
          markerEnd="url(#size-tick)"
        />
      </g>
    )
  }

  const shown = SPAN_KEYS.filter((k) => m[k].on)

  return (
    <div className="move-figures" aria-hidden="true">
      <svg className="move-dim">
        <defs>
          {/* The same head both ends, turned about on the near one, so the pair
              point outward onto the lines they are measured between. */}
          <marker id="size-tick" markerWidth="9" markerHeight="9" refX="8.5" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M 1 1 L 8.5 4.5 L 1 8 z" />
          </marker>
        </defs>
        {shown.map((k) => draw(k, m[k]))}
      </svg>
      {shown.map((k) => {
        const span = m[k]
        return (
          <div
            className="move-figure"
            key={k}
            style={{
              left: (span.a.x + span.b.x) / 2 + span.off.x * SIZE_OFF,
              top: (span.a.y + span.b.y) / 2 + span.off.y * SIZE_OFF,
            }}
          >
            <span className="cap">{SPAN_LABEL[k]}</span>
            <b>
              <i>{SPAN_AXIS[k]}</i>
              {formatLength(span.mm, units)}
            </b>
          </div>
        )
      })}
    </div>
  )
}

/** Width of the slide-out settings panel; the corner controls step aside by this much. */
const SETTINGS_WIDTH = 312

/**
 * How far down the stage starts: the toolbar, plus the strip of settings a tool
 * with any of its own hangs under it.
 *
 * The bar is snapped under the project bar and spans the full width, so
 * everything else on the stage — the model tree, the view cube, the workplane
 * tag — is set down below it. The strip pushes all of that down again while the
 * tool that owns it is in hand, rather than the bar squeezing itself to fit its
 * settings in: nothing already in the bar should have to give up its place to a
 * tool that has just been picked up.
 */
const barHeight = (tool: Tool) => TOOLBAR_HEIGHT + (hasToolOptions(tool) ? TOOL_OPTIONS_HEIGHT : 0)

/** How far the pointer may wander between press and release and still count as a click, in px. */
const CLICK_SLOP = 4

/**
 * The land the grid is ruled on — everything below the horizon, as against the
 * sky the canvas is cleared to.
 *
 * It is held under the camera rather than pinned to the origin, so however far
 * the view travels there is always ground out to where the eye stops, and it is
 * painted flat: no fog on it, so the horizon reads as the line it is instead of
 * dissolving into the sky a little way out. Drawn first and writing no depth,
 * it is a backdrop rather than a surface — the grid, the shadow and the parts
 * all land on top of it without any of them fighting it for the same pixels.
 *
 * Two-sided, so orbiting under the workplane shows the land overhead rather than
 * open sky: from below, the ground you were standing on is a ceiling.
 */
function Land({ color, y }: { color: string; y: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(({ camera }) => {
    if (mesh.current) mesh.current.position.set(camera.position.x, y, camera.position.z)
  })
  return (
    <mesh ref={mesh} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[100000, 100000]} />
      {/* Left out of the tone mapping as well as the fog: this is the colour the
          user picked, and it has the sky — which the canvas is simply cleared to
          — right beside it to be told apart from. */}
      <meshBasicMaterial
        color={color}
        fog={false}
        toneMapped={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export default function Scene3D() {
  const { pieces, innerDiameter, wallThickness, variant, openSide, selectedId, selectedIds, select, pickPart, theme, pieceColor, shading, rightPanel, simStarted, tool, overlays, workplane, pendingSpot, strikeRod, dropSpot, alignTo, alignHover } =
    useRun()
  // Either slide-out takes the same gutter, so the corner controls step aside for both.
  const docked = rightPanel !== null
  // A joint tool owns the left button while it is in hand: a click belongs to the
  // gesture, not to picking parts.
  // Measure and Align are in here too, and not as an afterthought: neither reads
  // a click of its own, and changing the pick is the only way to ask either of
  // them about something else.
  const picking =
    tool === 'select' ||
    tool === 'move' ||
    tool === 'rotate' ||
    tool === 'measure' ||
    tool === 'align'
  /** Whether the left button is standing posts rather than picking parts. */
  const propping = tool === 'support'
  // Escape lets go of a half-struck rod without putting the tool down, and so
  // does taking the tool down — a point remembered from a gesture you have
  // walked away from would land the next click somewhere baffling.
  useEffect(() => {
    if (!propping) {
      dropSpot()
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dropSpot()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [propping, dropSpot])
  const xray = shading === 'transparent'
  const palette = PALETTE[theme]
  const { sky: skyColor, land: landColor } = workplane[theme]
  // One set of shades per colour in play, so parts painted alike share theirs
  // and nothing is rebuilt while the run is only being moved around.
  const tints = useMemo(() => {
    const map = new Map<string, ReturnType<typeof shades>>()
    for (const c of [pieceColor, ...pieces.map((p) => colorOf(p, pieceColor))]) {
      if (!map.has(c)) map.set(c, shades(c))
    }
    return map
  }, [pieceColor, pieces])
  // The tube the run is cut from: what a part with no bore, wall or style of
  // its own is made to, and what the spec strip and the camera work in.
  const spec = useMemo(
    () => tubeSpec(innerDiameter, wallThickness, variant, openSide),
    [innerDiameter, wallThickness, variant, openSide],
  )
  // One spec per tube actually in play, so parts cut alike share a spec — and
  // with it a mesh — however mixed the run is.
  const specOf = useMemo(() => {
    const cache = new Map<string, TubeSpec>()
    return (piece: Piece) => {
      const own = pieceSpec(spec, piece)
      // A closed tube has no opening, so which side it would open on is left out
      // and every closed part of one size shares the one spec.
      const key = `${own.variant}:${own.closed ? '-' : own.openSide}:${own.innerR}:${own.wall}`
      const shared = cache.get(key)
      if (shared) return shared
      cache.set(key, own)
      return own
    }
  }, [spec])
  const asm = useMemo(() => buildAssembly(pieces), [pieces])

  /**
   * Where the pointer last was on the run, world — only tracked while the
   * Support tool is in hand, and dropped the moment it is put down so the ghost
   * cannot be left hanging about the stage.
   */
  const [propAt, setPropAt] = useState<THREE.Vector3 | null>(null)
  useEffect(() => {
    if (!propping) setPropAt(null)
  }, [propping])
  // A crosshair while the tool is in hand, because the left button is aiming at
  // a spot rather than at a thing — and put back the moment it is put down, or
  // the stage is left wearing it.
  useEffect(() => {
    if (!propping) return
    document.body.style.cursor = 'crosshair'
    return () => void (document.body.style.cursor = '')
  }, [propping])
  /**
   * The rod the pointer is asking for, once the first of the two clicks has
   * landed — from where that one struck to wherever the pointer is now.
   *
   * Null before the first click and null where the two are all but on top of
   * each other, which is exactly what the stage should be showing: nothing drawn
   * means nothing would be built.
   */
  const ghost = useMemo(
    () =>
      pendingSpot && propAt
        ? rodBetween(pendingSpot, propAt, [...pieces].reverse().find(isSupport) ?? null)
        : null,
    [pendingSpot, propAt, pieces],
  )
  const [goal, setGoal] = useState<ViewGoal>({
    token: 0,
    dir: HOME_DIR,
    frame: true,
    box: null,
    pad: HOME_PAD,
  })

  /**
   * The bounds of everything picked, padded out to the tube wall; null if
   * nothing is. A set frames as one, so Fit on several parts takes them all in
   * rather than cropping to whichever one leads.
   */
  // Padded out to each part's own wall, which is not the run's if it has been
  // sized on its own — and a base, having no wall, framed on its slab.
  const selectionBox = () => partsBox(asm, selectedIds, (piece) => specOf(piece).outerR)

  /**
   * The box the Measure tool draws and reads its three spans off: what is
   * picked, or the whole stage when nothing is.
   *
   * Falling back to everything is the same answer the 2D draft gives when its
   * sheet is asked to isolate a selection there is none of — with nothing
   * picked there is nothing to single out, and the size of the model entire is
   * the question you were most likely asking anyway.
   *
   * Held rather than rebuilt each render, because the box in the scene is built
   * from it: a fresh one every frame would rebuild the wireframe every frame.
   */
  const measureBox = useMemo(
    () =>
      tool === 'measure'
        ? partsBox(asm, selectedIds.length ? selectedIds : null, (piece) => specOf(piece).outerR)
        : null,
    [tool, asm, selectedIds, specOf],
  )

  /**
   * The box the Align tool reads its datum off: the whole picked set, or the one
   * part leading it that the rest are coming to.
   *
   * The same box, worked out the same way, as the one the store aligns against —
   * so what the stage draws is the thing the click will actually measure to,
   * rather than a picture of it. Nothing at all under two picked parts, because
   * under two there is nothing the tool would do.
   *
   * Held rather than rebuilt each render, for the reason the measuring box is:
   * the wireframe in the scene is built from it.
   */
  const alignBox = useMemo(() => {
    if (tool !== 'align' || selectedIds.length < 2) return null
    const from = alignTo === 'lead' && selectedId ? [selectedId] : selectedIds
    return partsBox(asm, from, (piece) => specOf(piece).outerR)
  }, [tool, alignTo, asm, selectedId, selectedIds, specOf])

  // Home stands back at the fixed angle and takes in the whole workplane.
  const home = () =>
    setGoal((g) => ({ token: g.token + 1, dir: HOME_DIR, frame: true, box: null, pad: HOME_PAD }))
  // Fit crops in from where you are — on the selected piece if there is one, else the run.
  const fit = () =>
    setGoal((g) => ({ token: g.token + 1, dir: null, frame: true, box: selectionBox(), pad: FIT_PAD }))
  const snapTo = (dir: THREE.Vector3) =>
    setGoal((g) => ({ ...g, token: g.token + 1, dir, frame: false }))

  // Owned by CameraRig, which is the only thing inside the canvas that can move the camera.
  const orbitRef = useRef<OrbitFn | null>(null)
  const orbit = useCallback((dx: number, dy: number) => orbitRef.current?.(dx, dy), [])

  // Re-frame the camera when the stage gains or loses a piece, or when a joint is
  // made or broken — each of those moves whole parts about, rather than nudging
  // one. Editing a part's own angles is deliberately not in here: that must never
  // yank the view. The first framing is the initial goal above, so mounting does
  // not queue a second one.
  const joints = pieces.reduce((n, p) => n + (p.joined ? 1 : 0), 0)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    // Always the whole stage — adding a piece must not crop the view to the selection.
    setGoal((g) => ({ token: g.token + 1, dir: null, frame: true, box: null, pad: FIT_PAD }))
  }, [pieces.length, joints])

  // The workplane is a datum, not a floor: it stays on the world's y = 0 plane
  // whatever the parts do. Hung off the model's own bounds it travelled with a
  // part being lifted, and a plane that moves with the thing you are measuring
  // against it is no reference at all — a part dragged up the green arrow read
  // as the ground sinking rather than the part rising.
  const groundY = 0
  const stage = useRef<HTMLDivElement>(null)

  /**
   * The right button does two jobs on this stage: it orbits the camera, and on a
   * part it opens that part's menu. Which one it was is only known on release —
   * a press that stayed put is a click, a press that travelled was an orbit — so
   * the part under the press is parked here until then.
   */
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const pressed = useRef<{ pieceId: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const up = (e: PointerEvent) => {
      const hit = pressed.current
      pressed.current = null
      if (e.button !== 2 || !hit) return
      if (Math.hypot(e.clientX - hit.x, e.clientY - hit.y) > CLICK_SLOP) return
      const box = stage.current?.getBoundingClientRect()
      setMenu({ pieceId: hit.pieceId, x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) })
    }
    // Released off the canvas — the press is spent either way.
    const cancel = () => (pressed.current = null)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [])

  // A part that has gone — deleted, or switched off — takes its menu with it.
  useEffect(() => {
    if (menu && !pieces.some((p) => p.id === menu.pieceId && !p.hidden)) setMenu(null)
  }, [pieces, menu])

  return (
    <div
      className="stage-3d"
      ref={stage}
      style={
        {
          '--parts-w': `${SETTINGS_WIDTH}px`,
          '--toolbar-h': `${barHeight(tool)}px`,
        } as React.CSSProperties
      }
      // Ahead of the canvas, so a right-press that lands on nothing has already
      // cleared the last one by the time the parts get their say.
      onPointerDownCapture={(e) => {
        if (e.button === 2) pressed.current = null
      }}
      // The stage has its own menu; the browser's would only cover it.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        // Opening pose, kept on the same side as HOME_DIR.
        camera={{ fov: 45, position: [200, 160, 260] }}
        // Only the left button selects, so only the left button clears the
        // selection — and only while the left button is still ours to pick with.
        onPointerMissed={(e) => e.button === 0 && picking && select(null)}
      >
        {/* The sky is the user's, so the haze the run recedes into follows it —
            otherwise the far end of a long run would fade out into a colour that
            is no longer up there. The land is drawn rather than cleared to, and
            is left out of the fog on purpose — see {@link Land}. */}
        <color attach="background" args={[skyColor]} />
        <fog attach="fog" args={[skyColor, 1200, 4200]} />
        <Land color={landColor} y={groundY - 0.5} />

        <hemisphereLight args={[palette.skyLight, palette.groundLight, palette.hemiIntensity]} />
        {/* Key and fill are mirrored in X along with the home camera, so the run
            keeps the same lit/shaded sides relative to the viewer. */}
        <directionalLight
          position={[300, 500, 250]}
          intensity={palette.keyIntensity}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-250, 180, -200]} intensity={0.5} color={palette.fillLight} />

        <Grid
          position={[0, groundY, 0]}
          args={[10, 10]}
          cellSize={10}
          cellThickness={0.6}
          cellColor={palette.cellColor}
          sectionSize={100}
          sectionThickness={1.1}
          sectionColor={palette.sectionColor}
          fadeDistance={3000}
          fadeStrength={1.2}
          // Ruled on both faces, so orbiting under the workplane shows it
          // overhead — the grid goes with the land it is ruled on.
          side={THREE.DoubleSide}
          infiniteGrid
          followCamera={false}
        />
        <ContactShadows
          position={[0, groundY + 0.5, 0]}
          // The blob shadow ignores per-mesh casting, so it is faded by hand in x-ray mode.
          opacity={xray ? palette.shadowOpacity * 0.4 : palette.shadowOpacity}
          scale={2000}
          blur={2.2}
          far={600}
        />

        {/* A hidden piece still holds its place in the layout — it just is not drawn. */}
        {asm.placed.filter((p) => !p.piece.hidden).map((p) => (
          <PieceMesh
            key={p.piece.id}
            spec={specOf(p.piece)}
            piece={p.piece}
            position={p.start}
            quaternion={p.quaternion}
            selected={selectedIds.includes(p.piece.id)}
            lead={p.piece.id === selectedId}
            tint={tints.get(colorOf(p.piece, pieceColor))!}
            xray={xray}
            pickable={picking || propping}
            onClick={(additive) =>
              // With the Rod tool in hand a click is a point in space rather
              // than a part: two of them make a rod between them. Anything solid
              // answers — a plate and a rod already struck as much as the run, so
              // a brace can be run down to the plinth or tied onto another rod.
              propping ? propAt && strikeRod(propAt) : pickPart(p.piece.id, additive)
            }
            onHoverAt={propping ? setPropAt : undefined}
            onRightDown={(x, y) => (pressed.current = { pieceId: p.piece.id, x, y })}
          />
        ))}

        {/* No marble until the Simulator button has asked for one. */}
        {simStarted && asm.placed.length > 0 && <Marble asm={asm} specOf={specOf} />}
        <Joints asm={asm} specOf={specOf} />
        {/* The handles are the tools themselves, so each is only on stage with its own in hand. */}
        {tool === 'move' && <MoveGizmo asm={asm} specOf={specOf} />}
        {tool === 'rotate' && <RotateGizmo asm={asm} />}
        {measureBox && <MeasureBox box={measureBox} color={palette.dim} />}
        {alignBox && <AlignDatum box={alignBox} at={alignHover} color={palette.dim} />}
        {/* The workplane answers a click too while the tool is in hand, so a rod
            can be run down to the floor rather than only between two parts. */}
        {propping && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, groundY, 0]}
            onClick={(e) => {
              e.stopPropagation()
              strikeRod({ x: e.point.x, y: 0, z: e.point.z })
            }}
            onPointerMove={(e) => {
              e.stopPropagation()
              setPropAt(new THREE.Vector3(e.point.x, 0, e.point.z))
            }}
          >
            <planeGeometry args={[4000, 4000]} />
            <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
          </mesh>
        )}
        {propping && pendingSpot && <SpotMark at={pendingSpot} />}
        {propping && ghost && (
          <SupportGhost
            spec={specOf(ghost)}
            piece={ghost}
            color={colorOf(ghost, pieceColor)}
          />
        )}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxDistance={6000}
          // Left is for picking parts only; the camera lives on the other two buttons.
          // Shift or ctrl with a right-drag pans too, for anyone without a middle button.
          // No action on LEFT leaves the button free for picking.
          mouseButtons={{ LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
        />
        <CameraRig asm={asm} goal={goal} orbitRef={orbitRef} />
        {/* Margin is the cube's centre — in from the right, and down from the top
            far enough to clear the toolbar. .view-tools is positioned to hang
            below it, and the open parts list pushes the whole corner cluster
            clear of the panel. */}
        <GizmoHelper
          alignment="top-right"
          margin={[docked ? 64 + SETTINGS_WIDTH : 64, 64 + barHeight(tool)]}
        >
          <ViewCube palette={palette.cube} onPick={snapTo} onOrbit={orbit} />
        </GizmoHelper>
        {/* Bottom left — the one corner with nothing else in it. Each gizmo draws
            in a pass of its own, so this one takes the later priority: the first
            pass draws the run, and a second one that also cleared it would wipe
            the cube out. */}
        {overlays.axes && (
          <GizmoHelper alignment="bottom-left" margin={[62, 62]} renderPriority={2}>
            <AxisTriad />
          </GizmoHelper>
        )}
      </Canvas>

      {/* Over the canvas, under the furniture around it: the figures belong to
          the run, but nothing they say is worth covering a control for. */}
      <MoveFigures />
      <SizeFigures />
      <Toolbar spec={spec} asm={asm} />
      {overlays.parts && <ActiveParts />}
      <div className={docked ? 'view-tools shifted' : 'view-tools'}>
        <button
          className="view-tool"
          onClick={home}
          title="Reset view — back to the home angle with the whole run in frame"
          aria-label="Reset view"
        >
          <HomeIcon />
        </button>
        <button
          className="view-tool"
          onClick={fit}
          title="Fit view — frame the selected piece, or the whole run, from the angle you are looking from"
          aria-label="Fit view"
        >
          <FitIcon />
        </button>
      </div>
      {/* Names the ground plane. Rides beside the mouse legend rather than sitting
          in the scene, so it stays legible and unmirrored at any camera angle. */}
      <div
        className={`workplane-tag${docked ? ' shifted' : ''}${overlays.mouse ? '' : ' bare'}`}
        aria-hidden="true"
      >
        Workplane
      </div>
      {overlays.mouse && <MouseLegend stage={stage} shifted={docked} />}
      <RightDock />
      {/* Keyed on the part, so a menu opened on a second part starts fresh
          rather than inheriting a rename left open on the first. */}
      {menu && (
        <PartContextMenu key={menu.pieceId} target={menu} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
