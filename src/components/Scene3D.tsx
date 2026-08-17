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
import { buildEndBandGeometry, buildPieceGeometry } from '../lib/geometry'
import { centerlineFor, shapeKey } from '../lib/centerline'
import { buildAssembly, type Assembly } from '../lib/layout'
import { createMarble, resetMarble, seekMarble, stepMarble } from '../lib/sim'
import { scrub, telemetry } from '../lib/telemetry'
import { coarseText, formatCoarse } from '../lib/units'
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

/** Scene colours live in JS, so they get their own light/dark palette. */
interface ScenePalette {
  background: string
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
 * Selection reads as a brighter, self-lit version of whatever colour the user
 * picked, so it stays legible against any hue.
 */
function shades(hex: string) {
  const base = new THREE.Color(hex)
  return {
    base,
    selected: base.clone().lerp(new THREE.Color('#ffffff'), 0.32),
    emissive: base.clone().multiplyScalar(0.42),
    /** Faint self-lit sheen, so the marble keeps its glassy look at any hue. */
    sheen: base.clone().multiplyScalar(0.22),
    black: new THREE.Color('#000000'),
  }
}

const PALETTE: Record<Theme, ScenePalette> = {
  light: {
    background: '#e3eaf1',
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
    background: '#0d141d',
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
  selected: boolean
  tint: ReturnType<typeof shades>
  xray: boolean
  /**
   * Whether a left-click on the solid picks the part. False while a joint tool
   * has the left button: the joint marks sit on the very surface of the wall, and
   * a part that answered the click first would swallow every one of them.
   */
  pickable: boolean
  onClick: () => void
  /** A right-press landed here; the stage decides whether it becomes a menu or an orbit. */
  onRightDown: (x: number, y: number) => void
}) {
  // Keyed on the shape rather than the piece, so nudging a part it sits behind
  // in the run — or renaming it — never rebuilds the solid.
  const shape = shapeKey(piece, spec)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geom = useMemo(() => buildPieceGeometry(spec, centerlineFor(piece)), [spec, shape])
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
              onClick()
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
        color={selected ? tint.selected : tint.base}
        emissive={selected ? tint.emissive : tint.black}
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

/**
 * The three axis arrows, on the selected part. Dragging one moves the whole run
 * that part belongs to: a bonded part cannot travel on its own, which is what
 * being bonded means, so the arrows write the placement at the head of the run
 * and everything joined to it follows.
 *
 * The handle is put on the part that was picked rather than at the head of the
 * run, so it is where the pointer already is; the fixed offset between the two
 * is what turns a drag there into a placement here.
 */
function MoveGizmo({ asm }: { asm: Assembly }) {
  const { selectedId, moveChain } = useRun()
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  const placed = asm.placed.find((p) => p.piece.id === selectedId)
  const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
  const at = root === undefined ? null : placementOf(asm.placed[root].piece)

  if (!placed || !at || !selectedId) return null
  // Where the head of the run stands relative to the part under the arrows. The
  // run is rigid, so this holds for the whole drag.
  const dx = at.x - placed.start.x
  const dy = at.y - placed.start.y
  const dz = at.z - placed.start.z
  // Tenths of a millimetre — finer than anything printable, and it keeps the
  // numbers in the timeline readable.
  const tidy = (v: number) => Math.round(v * 10) / 10

  return (
    <>
      <object3D ref={setProxy} position={[placed.start.x, placed.start.y, placed.start.z]} />
      {proxy && (
        <TransformControls
          object={proxy}
          mode="translate"
          space="world"
          size={0.85}
          onObjectChange={() =>
            moveChain(
              selectedId,
              tidy(proxy.position.x + dx),
              tidy(proxy.position.y + dy),
              tidy(proxy.position.z + dz),
            )
          }
        />
      )}
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
 * The turn ring, on the selected part. Dragging it swings the whole run that
 * part belongs to, for the same reason the arrows move the whole run: a bonded
 * part cannot turn on its own.
 *
 * Only the upright is offered. A run is set down on a heading and nothing else —
 * its climbs and its corners are the parts' own angles — so a roll or a tip
 * about the other two axes would have nowhere to be written.
 *
 * The ring is centred on the part that was picked and the run turns about it, so
 * the part under the pointer stands still while the rest swings round it. That
 * means writing the head of the run a new place as well as a new heading: it is
 * carried round the pivot by the same turn.
 */
function RotateGizmo({ asm }: { asm: Assembly }) {
  const { selectedId, rotateChain } = useRun()
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null)
  /**
   * Where the run stood when the drag began. The whole drag is measured off it
   * rather than off the last frame, so rounding the placement never accumulates
   * into a drift over a long swing.
   */
  const from = useRef<{ at: Placement; pivot: THREE.Vector3; angle: number } | null>(null)
  const placed = asm.placed.find((p) => p.piece.id === selectedId)
  const root = placed ? asm.chains[placed.chain]?.pieces[0] : undefined
  const at = root === undefined ? null : placementOf(asm.placed[root].piece)

  if (!placed || !at || !selectedId) return null
  // Tenths of a millimetre, as the arrows use — finer than anything printable.
  const tidy = (v: number) => Math.round(v * 10) / 10

  return (
    <>
      <object3D ref={setProxy} position={[placed.start.x, placed.start.y, placed.start.z]} />
      {proxy && (
        <TransformControls
          object={proxy}
          mode="rotate"
          space="world"
          size={0.85}
          showX={false}
          showZ={false}
          onMouseDown={() => {
            from.current = { at, pivot: placed.start.clone(), angle: proxy.rotation.y }
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
            const px = f.at.x - f.pivot.x
            const pz = f.at.z - f.pivot.z
            rotateChain(selectedId, {
              // The same turn the heading takes, applied to where the head of
              // the run stands relative to the part being turned about.
              x: tidy(f.pivot.x + px * c + pz * s),
              y: f.at.y,
              z: tidy(f.pivot.z - px * s + pz * c),
              yaw: tidyYaw(f.at.yaw + THREE.MathUtils.radToDeg(d)),
            })
          }}
        />
      )}
    </>
  )
}

function Marble({ asm }: { asm: Assembly }) {
  const { marbleDiameter, marbleColor, running, loop, timeScale, friction, resetToken, innerDiameter } =
    useRun()
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

  useLayoutEffect(() => {
    resetMarble(state.current, asm, rest)
    mesh.current?.position.copy(state.current.position)
    scrub.s = 0
  }, [asm, rest, resetToken])

  // Off stage means no readout to give — leave the HUD at zero, not at the last run's numbers.
  useEffect(
    () => () => {
      telemetry.speed = 0
      telemetry.distance = 0
      telemetry.airborne = false
      scrub.seek = null
      scrub.s = 0
    },
    [],
  )

  useFrame((_, delta) => {
    const m = state.current
    // The scrubber has the wheel whenever it has posted somewhere to be.
    if (scrub.seek !== null) {
      seekMarble(m, asm, scrub.seek, friction, rest, radius)
      scrub.seek = null
    } else if (running) {
      const dt = Math.min(delta, 1 / 30) * timeScale
      // Fixed sub-steps keep the joint hand-off stable at high speed.
      const steps = 4
      for (let i = 0; i < steps; i++) {
        const { lost } = stepMarble(m, dt / steps, asm, friction, rest, radius)
        if (lost) {
          if (loop) resetMarble(m, asm, rest)
          break
        }
      }
    }
    mesh.current?.position.copy(m.position)
    if (mesh.current) mesh.current.rotation.x = m.spin
    telemetry.speed = m.airborne ? m.velocity.length() : m.v
    telemetry.distance = m.s
    telemetry.airborne = m.airborne
    // Off the end there is no arc length left to report, so the slider sits at the stop.
    scrub.s = m.airborne ? asm.totalLength : m.s
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
 * The angle the home button returns to. A run with no turns travels down +Z,
 * so the camera stands on the -X side: from there +Z projects to screen right
 * and the marble reads start-on-the-left, the same way the 2D elevation
 * develops. Mirroring this to +X silently reverses the run on screen.
 */
const HOME_DIR = new THREE.Vector3(-0.62, 0.5, 0.6).normalize()

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
  const { running, toggleRunning, scrubSim, resetSim, units } = useRun()
  const total = asm.totalLength
  const [s, setS] = useState(0)
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
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])

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
        <div className="scrub-ends">
          <span>Start · {formatCoarse(0, units)}</span>
          <b>
            {formatCoarse(s, units)} · {pct}%
          </b>
          <span>End · {formatCoarse(total, units)}</span>
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

export default function Scene3D() {
  const { pieces, innerDiameter, wallThickness, variant, selectedId, select, theme, pieceColor, shading, rightPanel, simStarted, tool } =
    useRun()
  // Either slide-out takes the same gutter, so the corner controls step aside for both.
  const docked = rightPanel !== null
  // A joint tool owns the left button while it is in hand: a click belongs to the
  // gesture, not to picking parts.
  const picking = tool === 'select' || tool === 'move' || tool === 'rotate'
  const xray = shading === 'transparent'
  const palette = PALETTE[theme]
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

  /** The selected piece's own bounds, padded out to the tube wall; null if nothing is picked. */
  const selectionBox = () => {
    const p = asm.placed.find((x) => x.piece.id === selectedId)
    if (!p) return null
    // Every chord, so a bent part frames on what it really occupies.
    const points = [p.start, p.end, ...p.segments.map((seg) => seg.end)]
    // Padded out to that part's own wall, which is not the run's if it has been
    // sized on its own.
    return new THREE.Box3().setFromPoints(points).expandByScalar(specOf(p.piece).outerR)
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
        camera={{ fov: 45, position: [-200, 160, 260] }}
        // Only the left button selects, so only the left button clears the
        // selection — and only while the left button is still ours to pick with.
        onPointerMissed={(e) => e.button === 0 && picking && select(null)}
      >
        <color attach="background" args={[palette.background]} />
        <fog attach="fog" args={[palette.background, 1200, 4200]} />

        <hemisphereLight args={[palette.skyLight, palette.groundLight, palette.hemiIntensity]} />
        {/* Key and fill are mirrored in X along with the home camera, so the run
            keeps the same lit/shaded sides relative to the viewer. */}
        <directionalLight
          position={[-300, 500, 250]}
          intensity={palette.keyIntensity}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[250, 180, -200]} intensity={0.5} color={palette.fillLight} />

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
            selected={p.piece.id === selectedId}
            tint={tints.get(colorOf(p.piece, pieceColor))!}
            xray={xray}
            pickable={picking}
            onClick={() => select(p.piece.id === selectedId ? null : p.piece.id)}
            onRightDown={(x, y) => (pressed.current = { pieceId: p.piece.id, x, y })}
          />
        ))}

        {/* No marble until the Simulator button has asked for one. */}
        {simStarted && asm.placed.length > 0 && <Marble asm={asm} />}
        <Joints asm={asm} specOf={specOf} />
        {/* The handles are the tools themselves, so each is only on stage with its own in hand. */}
        {tool === 'move' && <MoveGizmo asm={asm} />}
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
      </Canvas>

      <Toolbar spec={spec} asm={asm} />
      <Scrubber asm={asm} shifted={docked} />
      <ActiveParts />
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
      <div className={docked ? 'workplane-tag shifted' : 'workplane-tag'} aria-hidden="true">
        Workplane
      </div>
      <MouseLegend stage={stage} shifted={docked} />
      <RightDock />
      {/* Keyed on the part, so a menu opened on a second part starts fresh
          rather than inheriting a rename left open on the first. */}
      {menu && (
        <PartContextMenu key={menu.pieceId} target={menu} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
