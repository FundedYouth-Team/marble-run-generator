import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, GizmoHelper, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import ViewCube, { type CubePalette } from './ViewCube'
import MouseLegend from './MouseLegend'
import PartsList from './PartsList'
import { buildPieceGeometry } from '../lib/geometry'
import { buildAssembly, type Assembly } from '../lib/layout'
import { createMarble, resetMarble, stepMarble } from '../lib/sim'
import { exportPrintPlate } from '../lib/exporters'
import { useRun, tubeSpec, type TubeSpec, type Theme } from '../store'

/** See-through opacity for the tube wall; the selected piece stays a touch more solid. */
const XRAY_OPACITY = 0.3
const XRAY_OPACITY_SELECTED = 0.55

/** Live telemetry, read by the HUD outside the render loop. */
const telemetry = { speed: 0, distance: 0, airborne: false }

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
  length,
  position,
  quaternion,
  selected,
  tint,
  xray,
  onClick,
}: {
  spec: TubeSpec
  length: number
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  selected: boolean
  tint: ReturnType<typeof shades>
  xray: boolean
  onClick: () => void
}) {
  const geom = useMemo(() => buildPieceGeometry(spec, length), [spec, length])
  useEffect(() => () => geom.dispose(), [geom])

  return (
    <mesh
      geometry={geom}
      position={position}
      quaternion={quaternion}
      // A see-through wall casting a solid shadow reads as a bug, so shadows go with it.
      castShadow={!xray}
      receiveShadow={!xray}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
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

function Marble({ asm, spec }: { asm: Assembly; spec: TubeSpec }) {
  const { marbleDiameter, marbleColor, running, loop, timeScale, friction, resetToken } = useRun()
  const tint = useMemo(() => shades(marbleColor), [marbleColor])
  const mesh = useRef<THREE.Mesh>(null)
  const state = useRef(createMarble())
  const radius = marbleDiameter / 2
  const restOffset = Math.max(spec.innerR - radius, 0)

  useLayoutEffect(() => {
    resetMarble(state.current, asm, restOffset)
    mesh.current?.position.copy(state.current.position)
  }, [asm, restOffset, resetToken])

  useFrame((_, delta) => {
    const m = state.current
    if (running) {
      const dt = Math.min(delta, 1 / 30) * timeScale
      // Fixed sub-steps keep the joint hand-off stable at high speed.
      const steps = 4
      for (let i = 0; i < steps; i++) {
        const { lost } = stepMarble(m, dt / steps, asm, friction, restOffset, radius)
        if (lost) {
          if (loop) resetMarble(m, asm, restOffset)
          break
        }
      }
    }
    mesh.current?.position.copy(m.position)
    if (mesh.current) mesh.current.rotation.x = m.spin
    telemetry.speed = m.airborne ? m.velocity.length() : m.v
    telemetry.distance = m.s
    telemetry.airborne = m.airborne
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

/** The angle the home button returns to. */
const HOME_DIR = new THREE.Vector3(0.62, 0.5, 0.6).normalize()

/** One camera move, asked for by a button or by a click on the view cube. */
interface ViewGoal {
  /** Bumped per request, so repeating the same move still fires. */
  token: number
  /** Where the camera should end up looking from; null keeps the current angle. */
  dir: THREE.Vector3 | null
  /** Re-frame the whole run, rather than keeping the current distance. */
  frame: boolean
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
    const box = asmRef.current.bounds
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
      toRadius = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.12
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

function Hud({ spec, asm }: { spec: TubeSpec; asm: Assembly }) {
  const { running, toggleRunning, resetSim, exportFormat, shading, toggleShading } = useRun()
  const [t, setT] = useState({ speed: 0, distance: 0, airborne: false })

  useEffect(() => {
    const id = setInterval(() => setT({ ...telemetry }), 100)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud">
      <button className={running ? 'primary on' : 'primary'} onClick={toggleRunning}>
        {running ? '❚❚ Pause' : '▶ Run marble'}
      </button>
      <button onClick={resetSim}>↺ Reset</button>
      <button
        className={shading === 'transparent' ? 'on' : ''}
        aria-pressed={shading === 'transparent'}
        title={
          shading === 'transparent'
            ? 'Switch back to solid shading'
            : 'See through the tube walls to watch the marble inside'
        }
        onClick={toggleShading}
      >
        {shading === 'transparent' ? '◍ Transparent' : '◉ Solid'}
      </button>
      <button
        disabled={!asm.placed.length}
        title={`Print plate as ${exportFormat.toUpperCase()} — every piece laid flat and separated, ready to slice`}
        onClick={() => exportPrintPlate(spec, asm.placed, exportFormat)}
      >
        ⤓ {exportFormat.toUpperCase()}
      </button>
      <div className="telemetry">
        <div>
          <b>{(t.speed / 1000).toFixed(2)}</b>
          <span>m/s</span>
        </div>
        <div>
          <b>{Math.round(t.distance)}</b>
          <span>mm travelled</span>
        </div>
        <div>
          <b>{t.airborne ? 'AIR' : 'IN TUBE'}</b>
          <span>state</span>
        </div>
      </div>
    </div>
  )
}

function HomeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.4 10.9 12 3.6l8.6 7.3" />
      <path d="M5.6 9.8V20h12.8V9.8" />
      <path d="M9.6 20v-5.6h4.8V20" />
    </svg>
  )
}

/** Corner brackets closing in on the run — "frame what is there". */
function FitIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 8.4V3.6h4.8M15.6 3.6h4.8v4.8M20.4 15.6v4.8h-4.8M8.4 20.4H3.6v-4.8" />
      <path d="M12 8.8 15.2 12 12 15.2 8.8 12z" />
    </svg>
  )
}

/** Stacked sheets — the parts list. */
function PartsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2.8 8.6 4.6L12 12 3.4 7.4z" />
      <path d="m3.4 12 8.6 4.6L20.6 12" />
      <path d="m3.4 16.6 8.6 4.6 8.6-4.6" />
    </svg>
  )
}

/** Width of the slide-out parts list; the corner controls step aside by this much. */
const PARTS_WIDTH = 264

export default function Scene3D() {
  const { pieces, innerDiameter, wallThickness, variant, selectedId, select, theme, pieceColor, shading } =
    useRun()
  const [partsOpen, setPartsOpen] = useState(false)
  const xray = shading === 'transparent'
  const palette = PALETTE[theme]
  const tint = useMemo(() => shades(pieceColor), [pieceColor])
  const spec = useMemo(
    () => tubeSpec(innerDiameter, wallThickness, variant),
    [innerDiameter, wallThickness, variant],
  )
  const asm = useMemo(() => buildAssembly(pieces), [pieces])
  const [goal, setGoal] = useState<ViewGoal>({ token: 0, dir: HOME_DIR, frame: true })

  const home = () => setGoal((g) => ({ token: g.token + 1, dir: HOME_DIR, frame: true }))
  const fit = () => setGoal((g) => ({ token: g.token + 1, dir: null, frame: true }))
  const snapTo = (dir: THREE.Vector3) => setGoal((g) => ({ token: g.token + 1, dir, frame: false }))

  // Owned by CameraRig, which is the only thing inside the canvas that can move the camera.
  const orbitRef = useRef<OrbitFn | null>(null)
  const orbit = useCallback((dx: number, dy: number) => orbitRef.current?.(dx, dy), [])

  // Re-frame the camera when the run gains or loses a piece; the first framing is the
  // initial goal above, so mounting does not queue a second one.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    setGoal((g) => ({ token: g.token + 1, dir: null, frame: true }))
  }, [pieces.length])

  const groundY = (asm.bounds.isEmpty() ? 0 : asm.bounds.min.y) - spec.outerR - 20
  const stage = useRef<HTMLDivElement>(null)

  return (
    <div
      className="stage-3d"
      ref={stage}
      style={{ '--parts-w': `${PARTS_WIDTH}px` } as React.CSSProperties}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 45, position: [200, 160, 260] }}
        // Only the left button selects, so only the left button clears the selection.
        onPointerMissed={(e) => e.button === 0 && select(null)}
      >
        <color attach="background" args={[palette.background]} />
        <fog attach="fog" args={[palette.background, 1200, 4200]} />

        <hemisphereLight args={[palette.skyLight, palette.groundLight, palette.hemiIntensity]} />
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

        {asm.placed.map((p) => (
          <PieceMesh
            key={p.piece.id}
            spec={spec}
            length={p.piece.length}
            position={p.start}
            quaternion={p.quaternion}
            selected={p.piece.id === selectedId}
            tint={tint}
            xray={xray}
            onClick={() => select(p.piece.id === selectedId ? null : p.piece.id)}
          />
        ))}

        {asm.placed.length > 0 && <Marble asm={asm} spec={spec} />}

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
        {/* Margin is the cube's centre; .view-tools is positioned to hang below it.
            The open parts list pushes the whole corner cluster clear of it. */}
        <GizmoHelper alignment="top-right" margin={[64, partsOpen ? 64 + PARTS_WIDTH : 64]}>
          <ViewCube palette={palette.cube} onPick={snapTo} onOrbit={orbit} />
        </GizmoHelper>
      </Canvas>

      <Hud spec={spec} asm={asm} />
      <div className={partsOpen ? 'view-tools shifted' : 'view-tools'}>
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
          title="Fit view — frame the whole run from the angle you are looking from"
          aria-label="Fit view"
        >
          <FitIcon />
        </button>
        <button
          className={partsOpen ? 'view-tool on' : 'view-tool'}
          onClick={() => setPartsOpen((v) => !v)}
          title="Parts list — every part in the run, with its name and size"
          aria-label="Parts list"
          aria-pressed={partsOpen}
        >
          <PartsIcon />
        </button>
      </div>
      <div className="viewcube-hint">
        left-click = select · right-drag = rotate · middle-drag = pan · scroll = zoom · click a cube
        face to snap
      </div>
      <MouseLegend stage={stage} shifted={partsOpen} />
      <PartsList open={partsOpen} onClose={() => setPartsOpen(false)} />
    </div>
  )
}
