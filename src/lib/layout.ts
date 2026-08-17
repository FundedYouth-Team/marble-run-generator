import * as THREE from 'three'
import { centerlineFor, type Centerline } from './centerline'
import type { Piece } from '../store'

/**
 * One straight chord of the run. A plain tube is a single chord; a bent part
 * contributes several. Everything that walks the run — the marble, the draft —
 * works in chords, so a bend needs no special case anywhere downstream.
 */
export interface Segment {
  piece: Piece
  /** Index of the part this chord belongs to. */
  pieceIndex: number
  /** Start of the chord, world mm. */
  start: THREE.Vector3
  /** End of the chord, world mm. */
  end: THREE.Vector3
  /** Unit direction (points downstream). */
  dir: THREE.Vector3
  length: number
  /** Cumulative axis length at the start of this chord, mm. */
  startS: number
  /** Pitch in radians, positive = falling. */
  pitch: number
}

export interface PlacedPiece {
  piece: Piece
  index: number
  /** Start of the tube axis, world mm. */
  start: THREE.Vector3
  /** End of the tube axis, world mm. */
  end: THREE.Vector3
  /** The sharp corner a bent part turns about, world mm; null on a straight one. */
  corner: THREE.Vector3 | null
  /** Unit direction the part starts in. */
  dir: THREE.Vector3
  /** Unit direction it hands on to the next part. */
  exitDir: THREE.Vector3
  /** Entry frame: X = right, Y = up (opening side), Z = dir. The mesh is placed with it. */
  quaternion: THREE.Quaternion
  /** Cumulative axis length at the start of this piece, mm. */
  startS: number
  /** Centreline length of the whole part, mm. */
  length: number
  /** Entry pitch in radians, positive = falling. */
  pitch: number
  /** Heading in radians. */
  yaw: number
  /** The chords this part is made of, in order. */
  segments: Segment[]
  /** The part's own centreline, in its local frame. */
  line: Centerline
}

export interface Assembly {
  placed: PlacedPiece[]
  /** Every chord in the run, in order — what the marble actually travels along. */
  segments: Segment[]
  totalLength: number
  bounds: THREE.Box3
  /** Axis polyline, one point per chord end. */
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
  const segments: Segment[] = []
  const polyline: THREE.Vector3[] = []
  const cursor = new THREE.Vector3(0, 0, 0)
  let yaw = 0
  let s = 0

  polyline.push(cursor.clone())

  pieces.forEach((piece, index) => {
    yaw += THREE.MathUtils.degToRad(piece.turn)
    const pitch = THREE.MathUtils.degToRad(piece.slope)
    const dir = directionFor(yaw, pitch)
    const quaternion = frameFor(dir)
    const start = cursor.clone()

    // The part carries its own shape; placing it is just standing that shape up
    // in the entry frame, so a bend of any kind lands in the world for free.
    const line = centerlineFor(piece)
    const world = line.points.map((p) => p.clone().applyQuaternion(quaternion).add(start))

    const own: Segment[] = []
    for (let i = 1; i < world.length; i++) {
      const from = world[i - 1]
      const to = world[i]
      const step = new THREE.Vector3().subVectors(to, from)
      const length = step.length()
      if (length < 1e-9) continue
      step.divideScalar(length)
      own.push({
        piece,
        pieceIndex: index,
        start: from,
        end: to,
        dir: step,
        length,
        startS: s,
        pitch: Math.asin(THREE.MathUtils.clamp(-step.y, -1, 1)),
      })
      s += length
      polyline.push(to.clone())
    }

    const end = world[world.length - 1]
    placed.push({
      piece,
      index,
      start,
      end,
      corner: line.corner ? line.corner.clone().applyQuaternion(quaternion).add(start) : null,
      dir,
      exitDir: own.length ? own[own.length - 1].dir.clone() : dir.clone(),
      quaternion,
      startS: own.length ? own[0].startS : s,
      length: line.length,
      pitch,
      yaw,
      segments: own,
      line,
    })
    segments.push(...own)
    cursor.copy(end)
  })

  const bounds = new THREE.Box3()
  if (polyline.length) bounds.setFromPoints(polyline)
  else bounds.set(new THREE.Vector3(), new THREE.Vector3())

  return { placed, segments, totalLength: s, bounds, polyline }
}

/** Point + direction at arc length `s` along the axis, and the chord it falls on. */
export function sampleAssembly(asm: Assembly, s: number) {
  if (!asm.segments.length) {
    return { point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), index: -1 }
  }
  const clamped = THREE.MathUtils.clamp(s, 0, asm.totalLength)
  let index = asm.segments.findIndex((seg) => clamped < seg.startS + seg.length)
  if (index < 0) index = asm.segments.length - 1
  const seg = asm.segments[index]
  return {
    point: seg.start.clone().addScaledVector(seg.dir, clamped - seg.startS),
    dir: seg.dir.clone(),
    index,
  }
}
