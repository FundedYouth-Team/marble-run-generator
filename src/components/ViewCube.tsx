import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

/** Cube colours, themed alongside the rest of the scene. */
export interface CubePalette {
  face: string
  text: string
  line: string
  /** Multiplied over the face texture, so it reads as a tint rather than a repaint. */
  hover: string
}

/** Material order on a BoxGeometry: +X, -X, +Y, -Y, +Z, -Z. */
const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK']

const CUBE_SCALE = 58
/** Half a unit cube minus half a hotspot, so edges and corners sit flush with the faces. */
const OFFSET = 0.38
const EDGE_UNITS: [number, number, number][] = [
  [1, 1, 0], [1, 0, 1], [1, 0, -1], [1, -1, 0],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
  [-1, 1, 0], [-1, 0, 1], [-1, 0, -1], [-1, -1, 0],
]
const CORNER_UNITS: [number, number, number][] = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
]

/** A hotspot is thin across the axes it hugs and long across the one it spans. */
function hotspotSize(unit: [number, number, number]): [number, number, number] {
  return unit.map((axis) => (axis === 0 ? 0.5 : 0.25)) as [number, number, number]
}

const SPOTS = [
  ...EDGE_UNITS.map((u) => ({ unit: u, size: hotspotSize(u) })),
  ...CORNER_UNITS.map((u) => ({ unit: u, size: [0.25, 0.25, 0.25] as [number, number, number] })),
]

/** A face label, drawn once into a canvas and reused as a texture. */
function useFaceTextures(palette: CubePalette) {
  const gl = useThree((s) => s.gl)
  const anisotropy = gl.capabilities.getMaxAnisotropy() || 1

  const textures = useMemo(() => {
    return FACE_LABELS.map((label) => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 160
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = palette.face
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = palette.line
      ctx.lineWidth = 5
      ctx.strokeRect(2.5, 2.5, canvas.width - 5, canvas.height - 5)
      ctx.font = '600 26px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = palette.text
      ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 1)

      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = anisotropy
      return tex
    })
  }, [palette.face, palette.line, palette.text, anisotropy])

  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures])
  return textures
}

/**
 * The orientation cube, meant to live inside drei's `GizmoHelper`. Dragging it
 * orbits the scene (OrbitControls listens on the canvas underneath); a click on
 * a face, edge or corner reports that direction so the camera can swing round.
 */
export default function ViewCube({
  palette,
  onPick,
  onOrbit,
}: {
  palette: CubePalette
  onPick: (direction: THREE.Vector3) => void
  /** Pixel deltas from a left-drag on the cube itself. */
  onOrbit: (dx: number, dy: number) => void
}) {
  const textures = useFaceTextures(palette)
  const [hoverFace, setHoverFace] = useState<number | null>(null)
  const [hoverSpot, setHoverSpot] = useState<number | null>(null)
  // Where the press started, so an orbit drag that ends on the cube is not a click.
  const press = useRef<{ x: number; y: number } | null>(null)
  // Last position of a left-drag that began on the cube; null when not dragging.
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => (press.current = { x: e.clientX, y: e.clientY })
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  // Left-drag on the cube spins the view, even though left-drag on the stage does not.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const last = drag.current
      if (!last) return
      onOrbit(e.clientX - last.x, e.clientY - last.y)
      drag.current = { x: e.clientX, y: e.clientY }
    }
    const stop = () => (drag.current = null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [onOrbit])

  const hovering = hoverFace !== null || hoverSpot !== null
  useEffect(() => {
    if (!hovering) return
    const previous = document.body.style.cursor
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = previous
    }
  }, [hovering])

  const pick = (e: ThreeEvent<MouseEvent>, direction: THREE.Vector3) => {
    e.stopPropagation()
    const start = press.current
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return
    onPick(direction)
  }

  return (
    <group
      scale={CUBE_SCALE}
      // Bubbles up from whichever face, edge or corner was pressed.
      onPointerDown={(e) => {
        if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <mesh
        onPointerMove={(e) => {
          e.stopPropagation()
          setHoverFace(e.faceIndex == null ? null : Math.floor(e.faceIndex / 2))
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHoverFace(null)
        }}
        onClick={(e) => e.face && pick(e, e.face.normal.clone())}
      >
        <boxGeometry />
        {textures.map((tex, i) => (
          <meshBasicMaterial
            key={i}
            attach={`material-${i}`}
            map={tex}
            color={hoverFace === i && hoverSpot === null ? palette.hover : '#ffffff'}
            toneMapped={false}
          />
        ))}
      </mesh>

      {SPOTS.map((spot, i) => (
        <mesh
          key={i}
          // A hair proud of the faces, so the highlight is not swallowed by z-fighting.
          scale={1.02}
          position={[spot.unit[0] * OFFSET, spot.unit[1] * OFFSET, spot.unit[2] * OFFSET]}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHoverSpot(i)
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            setHoverSpot((s) => (s === i ? null : s))
          }}
          onClick={(e) => pick(e, new THREE.Vector3(...spot.unit).normalize())}
        >
          <boxGeometry args={spot.size} />
          <meshBasicMaterial
            color={palette.hover}
            transparent
            opacity={0.75}
            visible={hoverSpot === i}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}
