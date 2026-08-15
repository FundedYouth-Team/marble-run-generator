import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
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
  gizmoLabel: string
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
    gizmoLabel: '#f4f8fb',
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
    gizmoLabel: '#0d141d',
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

function CameraRig({ asm, token }: { asm: Assembly; token: number }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null

  useEffect(() => {
    const box = asm.bounds.clone()
    if (box.isEmpty()) return
    const cam = camera as THREE.PerspectiveCamera
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 60)

    // Frame the bounding sphere on whichever of the two FOVs is tighter.
    const vFov = THREE.MathUtils.degToRad(cam.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect)
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.12

    const eye = new THREE.Vector3(0.62, 0.5, 0.6).normalize().multiplyScalar(dist)
    cam.position.copy(center).add(eye)
    cam.near = Math.max(dist / 800, 0.5)
    cam.far = dist * 12
    cam.updateProjectionMatrix()
    cam.lookAt(center)
    if (controls) {
      controls.target.copy(center)
      controls.update()
    }
  }, [token, controls, camera, asm])

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

export default function Scene3D() {
  const { pieces, innerDiameter, wallThickness, variant, selectedId, select, theme, pieceColor, shading } =
    useRun()
  const xray = shading === 'transparent'
  const palette = PALETTE[theme]
  const tint = useMemo(() => shades(pieceColor), [pieceColor])
  const spec = useMemo(
    () => tubeSpec(innerDiameter, wallThickness, variant),
    [innerDiameter, wallThickness, variant],
  )
  const asm = useMemo(() => buildAssembly(pieces), [pieces])
  const [fitToken, setFitToken] = useState(0)

  // Re-frame the camera when the run's overall shape changes.
  useEffect(() => setFitToken((n) => n + 1), [pieces.length])

  const groundY = (asm.bounds.isEmpty() ? 0 : asm.bounds.min.y) - spec.outerR - 20

  return (
    <div className="stage-3d">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 45, position: [200, 160, 260] }} onPointerMissed={() => select(null)}>
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

        <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxDistance={6000} />
        <CameraRig asm={asm} token={fitToken} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff6b6b', '#8ce99a', '#4dabf7']} labelColor={palette.gizmoLabel} />
        </GizmoHelper>
      </Canvas>

      <Hud spec={spec} asm={asm} />
      <button className="fit-btn" onClick={() => setFitToken((n) => n + 1)}>
        ⤢ Fit view
      </button>
      <div className="viewcube-hint">drag = orbit · scroll = zoom · right-drag = pan</div>
    </div>
  )
}
