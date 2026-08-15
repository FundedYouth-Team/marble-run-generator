import * as THREE from 'three'
import type { Piece } from '../store'

export interface PlacedPiece {
  piece: Piece
  index: number
  /** Start of the tube axis, world mm. */
  start: THREE.Vector3
  /** End of the tube axis, world mm. */
  end: THREE.Vector3
  /** Unit axis direction (points downstream). */
  dir: THREE.Vector3
  /** Local frame: X = right, Y = up (opening side), Z = dir. */
  quaternion: THREE.Quaternion
  /** Cumulative axis length at the start of this piece, mm. */
  startS: number
  /** Pitch in radians, positive = falling. */
  pitch: number
  /** Heading in radians. */
  yaw: number
}

export interface Assembly {
  placed: PlacedPiece[]
  totalLength: number
  bounds: THREE.Box3
  /** Axis polyline, one point per joint. */
  polyline: THREE.Vector3[]
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)

export function directionFor(yaw: number, pitch: number) {
  const c = Math.cos(pitch)
  return new THREE.Vector3(Math.sin(yaw) * c, -Math.sin(pitch), Math.cos(yaw) * c)
}

/** Orientation with Z along the axis and Y kept as close to world-up as possible. */
export function frameFor(dir: THREE.Vector3) {
  const z = dir.clone().normalize()
  let x = new THREE.Vector3().crossVectors(WORLD_UP, z)
  if (x.lengthSq() < 1e-8) x = new THREE.Vector3(1, 0, 0)
  x.normalize()
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/** Chain the pieces head-to-tail from the origin. */
export function buildAssembly(pieces: Piece[]): Assembly {
  const placed: PlacedPiece[] = []
  const polyline: THREE.Vector3[] = []
  const cursor = new THREE.Vector3(0, 0, 0)
  let yaw = 0
  let s = 0

  polyline.push(cursor.clone())

  pieces.forEach((piece, index) => {
    yaw += THREE.MathUtils.degToRad(piece.turn)
    const pitch = THREE.MathUtils.degToRad(piece.slope)
    const dir = directionFor(yaw, pitch)
    const start = cursor.clone()
    const end = start.clone().addScaledVector(dir, piece.length)

    placed.push({
      piece,
      index,
      start,
      end,
      dir,
      quaternion: frameFor(dir),
      startS: s,
      pitch,
      yaw,
    })

    cursor.copy(end)
    polyline.push(end.clone())
    s += piece.length
  })

  const bounds = new THREE.Box3()
  if (polyline.length) bounds.setFromPoints(polyline)
  else bounds.set(new THREE.Vector3(), new THREE.Vector3())

  return { placed, totalLength: s, bounds, polyline }
}

/** Point + direction at arc length `s` along the axis. */
export function sampleAssembly(asm: Assembly, s: number) {
  if (!asm.placed.length) {
    return { point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), index: -1 }
  }
  const clamped = THREE.MathUtils.clamp(s, 0, asm.totalLength)
  let index = asm.placed.findIndex((p) => clamped < p.startS + p.piece.length)
  if (index < 0) index = asm.placed.length - 1
  const p = asm.placed[index]
  const local = clamped - p.startS
  return {
    point: p.start.clone().addScaledVector(p.dir, local),
    dir: p.dir.clone(),
    index,
  }
}
