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
import Toolbar from './Toolbar'
import ActiveParts from './ActiveParts'
import PartContextMenu, { type MenuTarget } from './PartContextMenu'
import { FitIcon, HomeIcon } from './icons'
import { buildEndBandGeometry, buildPartGeometry } from '../lib/geometry'
import { centerlineFor, shapeKey } from '../lib/centerline'
import { buildAssembly, chainBox, type Assembly } from '../lib/layout'
import { createMarble, resetMarble, seekMarble, stallPoint, stepMarble } from '../lib/sim'
import { buildWorld } from '../lib/collide'
import { scrub, telemetry } from '../lib/telemetry'
import { measure, type MoveMeasure } from '../lib/measure'
import { tidyGizmo, type GizmoControls } from '../lib/gizmo'
import { addsToSelection } from '../lib/shortcuts'
import { coarseText, formatCoarse, formatLength, type Unit } from '../lib/units'
import {
  useRun,
  boreOf,
  tubeSpec,
  canConnect,
  colorOf,
  pieceSpec,
  placementOf,
  samePort,
  type Piece,
  type Placement,
  type Port,
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
 * Puts the gizmo corrections on whichever handle is on stage — the arrows and
 * the turn ring are the same object underneath, so both are held to the same
 * rules. Hands back the ref callback the control is mounted with.
 */
function useTidyGizmo() {
  const [controls, setControls] = useState<GizmoControls | null>(null)
  useEffect(() => (controls ? tidyGizmo(controls) : undefined), [controls])
  // Taken as the plain object it is on the way in: three-stdlib marks the fields
  // the corrections read as private, and the class itself is drei's to import,
  // not ours.
  return useCallback(
    (instance: THREE.Object3D | null) => setControls(instance as GizmoControls | null),
    [],
  )
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
  const { selectedId, selectedIds, placeChains } = useRun()
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  /**
   * Where every run being dragged stood when the drag began; null between drags.
   * The travel is measured off these rather than off the last frame, so a drag
   * of a hundred frames lands exactly where one of one would, and the figure
   * reports the whole of it.
   */
  const from = useRef<{ pieceId: string; at: Placement }[] | null>(null)
  const [origin, setOrigin] = useState<Placement | null>(null)
  const setControls = useTidyGizmo()
  const placed = asm.placed.find((p) => p.piece.id === selectedId)
  const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
  const at = root === undefined ? null : placementOf(asm.placed[root].piece)

  if (!placed || !at || !selectedId) return null
  // Where the head of the run under the arrows stands relative to the part they
  // sit on. The run is rigid, so this holds for the whole drag.
  const dx = at.x - placed.start.x
  const dy = at.y - placed.start.y
  const dz = at.z - placed.start.z

  // The drop line hangs from the middle of the footprint of everything picked:
  // an edge would have to be chosen afresh every time the camera swung past it,
  // and the middle is the one point that reads the same from every side.
  const box = new THREE.Box3()
  for (const chain of new Set(
    asm.placed.filter((p) => selectedIds.includes(p.piece.id)).map((p) => p.chain),
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
            from.current = pickedChains(asm, selectedIds, selectedId)
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
            const runs = from.current ?? pickedChains(asm, selectedIds, selectedId)
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
 * The turn ring, on the part leading the selection. Dragging it swings every run
 * that has a part picked in it, for the same reason the arrows move whole runs: a
 * bonded part cannot turn on its own.
 *
 * Only the upright is offered. A run is set down on a heading and nothing else —
 * its climbs and its corners are the parts' own angles — so a roll or a tip
 * about the other two axes would have nowhere to be written.
 *
 * The ring is centred on the part that was picked and everything turns about it,
 * so the part under the pointer stands still while the rest swings round it —
 * the runs picked alongside it are carried round that same point, rather than
 * each turning on the spot, so the set keeps the arrangement it was standing in.
 * That means writing the head of every run a new place as well as a new heading.
 */
function RotateGizmo({ asm }: { asm: Assembly }) {
  const { selectedId, selectedIds, placeChains } = useRun()
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  /**
   * Where the runs stood when the drag began, and what they are turning about.
   * The whole drag is measured off these rather than off the last frame, so
   * rounding the placements never accumulates into a drift over a long swing.
   */
  const from = useRef<{
    runs: { pieceId: string; at: Placement }[]
    pivot: THREE.Vector3
    angle: number
  } | null>(null)
  const setControls = useTidyGizmo()
  const placed = asm.placed.find((p) => p.piece.id === selectedId)
  const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
  const at = root === undefined ? null : placementOf(asm.placed[root].piece)

  if (!placed || !at || !selectedId) return null

  return (
    <>
      <object3D ref={setProxy} position={[placed.start.x, placed.start.y, placed.start.z]} />
      {proxy && (
        <TransformControls
          ref={setControls}
          object={proxy}
          mode="rotate"
          space="world"
          size={0.85}
          showX={false}
          showZ={false}
          onMouseDown={() => {
            from.current = {
              runs: pickedChains(asm, selectedIds, selectedId),
              pivot: placed.start.clone(),
              angle: proxy.rotation.y,
            }
          }}
          onMouseUp={() => {
            from.current = null
          }}
          onObjectChange={() => {
            const f = from.current
            if (!f) return
            // Y-only, so the proxy's rotation stays a pure heading and the Euler
            // reads straight off it. Wrapping past ±180° is harmless: both the
            // heading and the swing about the pivot repeat every turn.
            const d = proxy.rotation.y - f.angle
            const c = Math.cos(d)
            const s = Math.sin(d)
            const deg = THREE.MathUtils.radToDeg(d)
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
                    yaw: tidyYaw(was.yaw + deg),
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
    scrub.s = 0
    scrub.chain = 0
  }, [asm, rest, resetToken])

  // Off stage means no readout to give — leave the HUD at zero, not at the last run's numbers.
  useEffect(
    () => () => {
      telemetry.speed = 0
      telemetry.distance = 0
      telemetry.airborne = false
      telemetry.stuck = false
      scrub.seek = null
      scrub.s = 0
      scrub.chain = 0
      scrub.total = 0
    },
    [],
  )

  useFrame((_, delta) => {
    const m = state.current
    // The scrubber has the wheel whenever it has posted somewhere to be.
    if (scrub.seek !== null) {
      seekMarble(m, asm, scrub.seek, phys)
      scrub.seek = null
    } else if (running) {
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
    // The slider measures the run the marble is actually on, which is not always
    // the one it set off down. In the air there is no arc length to report, so
    // it holds where it left the run.
    scrub.chain = m.chain
    scrub.total = asm.chains[m.chain]?.length ?? 0
    if (!m.airborne) scrub.s = m.s
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

/**
 * The transport bar along the bottom of the workplane: run and pause, and a
 * slider from the start of the run to its end that both follows the marble and
 * drives it. Scrubbing pauses, so a drag is never fighting the simulation, and
 * the marble is re-seated at the speed the run would have given it there — let
 * go anywhere and it carries on as if it had rolled to that point.
 */
function Scrubber({ asm, shifted }: { asm: Assembly; shifted: boolean }) {
  const { running, toggleRunning, scrubSim, resetSim, units, friction } = useRun()
  const [s, setS] = useState(0)
  /**
   * The run the marble is on and how long it is. Held in state rather than read
   * off the assembly, because the marble can be caught by a run other than the
   * one it set off down and the slider has to follow it there.
   */
  const [run, setRun] = useState({ chain: 0, total: asm.chains[0]?.length ?? 0 })
  /**
   * Where the thumb has been dragged to, held until the marble reports back from
   * there — without it the slider snaps back for the frame between asking and
   * arriving. `age` is the escape hatch: if the marble never turns up (a reset
   * landed in between, or it is not on stage yet) the thumb stops waiting.
   */
  const pending = useRef<{ at: number; age: number } | null>(null)

  // Per frame, not the HUD's 100 ms poll — a slider that steps ten times a
  // second reads as broken. Identical values are dropped by React, so a paused
  // run costs nothing.
  useEffect(() => {
    let id = 0
    const tick = () => {
      const want = pending.current
      if (!want) setS(scrub.s)
      else if (Math.abs(scrub.s - want.at) < 0.5 || ++want.age > 10) pending.current = null
      setRun((was) =>
        was.chain === scrub.chain && was.total === scrub.total
          ? was
          : { chain: scrub.chain, total: scrub.total },
      )
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

  /**
   * How far a marble let go at the head of this run actually gets before the
   * fall runs out from under it. Everything past it is run the marble cannot
   * reach on its own, which is worth showing rather than leaving to be
   * discovered.
   */
  const stall = useMemo(
    () => stallPoint(asm, run.chain, friction),
    [asm, run.chain, friction],
  )

  const total = run.total || asm.chains[0]?.length || 0

  // A run with nothing on it has no timeline to scrub.
  if (total <= 0) return null

  const seek = (value: number) => {
    const at = Math.max(0, Math.min(value, total))
    pending.current = { at, age: 0 }
    scrub.seek = at
    setS(at)
    scrubSim()
  }

  const pct = Math.round((s / total) * 100)

  return (
    <div className={shifted ? 'scrubber shifted' : 'scrubber'}>
      <button
        className={running ? 'scrub-play on' : 'scrub-play'}
        onClick={toggleRunning}
        title={running ? 'Pause the marble' : 'Run the marble'}
        aria-label={running ? 'Pause' : 'Run'}
      >
        {running ? '❚❚' : '▶'}
      </button>
      <div className="scrub-track">
        <div className="scrub-rail">
          {stall !== null && (
            // Dead ground: the marble stops here and rolls back, so the run past
            // it never gets used. Behind the slider, so the thumb still reads.
            <div
              className="scrub-stall"
              style={{ left: `${(stall / total) * 100}%` }}
              title={`The marble stalls here — the fall past ${formatCoarse(stall, units)} is too shallow to carry it`}
            />
          )}
          <input
            type="range"
            min={0}
            max={total}
            step={0.1}
            value={s}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Marble position along the run"
            aria-valuetext={`${coarseText(s, units)} of ${formatCoarse(total, units)}`}
          />
        </div>
        <div className="scrub-ends">
          <span>Start · {formatCoarse(0, units)}</span>
          <b>
            {formatCoarse(s, units)} · {pct}%
          </b>
          <span>
            {stall !== null ? `Stalls · ${formatCoarse(stall, units)}` : `End · ${formatCoarse(total, units)}`}
          </span>
        </div>
      </div>
      <button
        className="scrub-play"
        onClick={resetSim}
        title="Send the marble back to the start"
        aria-label="Back to start"
      >
        ↺
      </button>
    </div>
  )
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
 * Sampled on its own clock, like the scrubber: the numbers are rewritten every
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

/** Width of the slide-out settings panel; the corner controls step aside by this much. */
const SETTINGS_WIDTH = 312

/**
 * Height of the toolbar across the top of the stage. The bar is snapped under
 * the project bar and spans the full width, so everything else on the stage —
 * the model tree, the view cube, the workplane tag — is set down below it. Kept
 * here as well as in the stylesheet because the view cube is placed inside the
 * canvas, in pixels from its edge, where CSS cannot reach it.
 */
const TOOLBAR_HEIGHT = 62

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
  const { pieces, innerDiameter, wallThickness, variant, selectedId, selectedIds, select, pickPart, theme, pieceColor, shading, rightPanel, simStarted, tool, overlays, workplane } =
    useRun()
  // Either slide-out takes the same gutter, so the corner controls step aside for both.
  const docked = rightPanel !== null
  // A joint tool owns the left button while it is in hand: a click belongs to the
  // gesture, not to picking parts.
  const picking = tool === 'select' || tool === 'move' || tool === 'rotate'
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
    () => tubeSpec(innerDiameter, wallThickness, variant),
    [innerDiameter, wallThickness, variant],
  )
  // One spec per tube actually in play, so parts cut alike share a spec — and
  // with it a mesh — however mixed the run is.
  const specOf = useMemo(() => {
    const cache = new Map<string, TubeSpec>()
    return (piece: Piece) => {
      const own = pieceSpec(spec, piece)
      const key = `${own.variant}:${own.innerR}:${own.wall}`
      const shared = cache.get(key)
      if (shared) return shared
      cache.set(key, own)
      return own
    }
  }, [spec])
  const asm = useMemo(() => buildAssembly(pieces), [pieces])
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
  const selectionBox = () => {
    const box = new THREE.Box3()
    for (const p of asm.placed) {
      if (!selectedIds.includes(p.piece.id)) continue
      // Every chord, so a bent part frames on what it really occupies.
      const points = [p.start, p.end, ...p.segments.map((seg) => seg.end)]
      // Padded out to that part's own wall, which is not the run's if it has
      // been sized on its own.
      box.union(new THREE.Box3().setFromPoints(points).expandByScalar(specOf(p.piece).outerR))
    }
    return box.isEmpty() ? null : box
  }

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
          '--toolbar-h': `${TOOLBAR_HEIGHT}px`,
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
            pickable={picking}
            onClick={(additive) => pickPart(p.piece.id, additive)}
            onRightDown={(x, y) => (pressed.current = { pieceId: p.piece.id, x, y })}
          />
        ))}

        {/* No marble until the Simulator button has asked for one. */}
        {simStarted && asm.placed.length > 0 && <Marble asm={asm} specOf={specOf} />}
        <Joints asm={asm} specOf={specOf} />
        {/* The handles are the tools themselves, so each is only on stage with its own in hand. */}
        {tool === 'move' && <MoveGizmo asm={asm} specOf={specOf} />}
        {tool === 'rotate' && <RotateGizmo asm={asm} />}

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
          margin={[docked ? 64 + SETTINGS_WIDTH : 64, 64 + TOOLBAR_HEIGHT]}
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
      <Toolbar spec={spec} asm={asm} />
      {overlays.scrubber && <Scrubber asm={asm} shifted={docked} />}
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
