import * as THREE from 'three'
import { angleSpec, type Piece } from '../store'

/**
 * The centreline a part is built around, in the part's own frame: it starts at
 * the origin heading down +Z, +Y is up (the opening side), and every bend the
 * part has is already baked into it.
 *
 * One shape description serves all three consumers — the swept solid, the world
 * layout, and the 2D draft — so the mesh, the marble and the drawing can never
 * disagree about where a part actually goes.
 */
export interface Centerline {
  /** Vertices from the origin, in order. Always at least two. */
  points: THREE.Vector3[]
  /** Unit direction of each chord; one shorter than `points`. */
  dirs: THREE.Vector3[]
  /** Cumulative arc length at each vertex. */
  distances: number[]
  /** Total arc length, mm. */
  length: number
  /**
   * The sharp corner a bent part turns about, even when the corner is rounded
   * off — rounding cuts across it but leaves both ends of the part where they
   * were, so this stays the point the draft handles are hung from. Null on a
   * part that runs straight.
   */
  corner: THREE.Vector3 | null
}

const LOCAL_X = new THREE.Vector3(1, 0, 0)
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

/** How finely a rounded corner is chopped into chords. */
const ARC_STEP_DEG = 6
const ARC_MIN_CHORDS = 3
/**
 * A corner radius may eat this much of the shorter leg and no more, so a big
 * radius on a short connector rounds off as far as it can rather than running
 * off the end of the part.
 */
const LEG_BUDGET = 0.85

/** Drops vertices that land on top of the one before, which would give a zero-length chord. */
function dedupe(points: THREE.Vector3[]): THREE.Vector3[] {
  return points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]) > 1e-12)
}

function fromPoints(points: THREE.Vector3[], corner: THREE.Vector3 | null): Centerline {
  const dirs: THREE.Vector3[] = []
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    const d = new THREE.Vector3().subVectors(points[i], points[i - 1])
    const len = d.length()
    dirs.push(len > 1e-9 ? d.divideScalar(len) : LOCAL_Z.clone())
    distances.push(distances[i - 1] + len)
  }
  return { points, dirs, distances, length: distances[distances.length - 1], corner }
}

/**
 * The centreline of one part. A plain tube is a single chord; an angle
 * connector is two legs meeting at a break, with the break optionally rounded
 * into an arc tangent to both.
 */
export function centerlineFor(piece: Piece): Centerline {
  if (piece.type !== 'angle') {
    return fromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, piece.length)], null)
  }

  const { entry, bend, exit, fillet } = angleSpec(piece)
  // Falling is -Y, so a positive bend is a positive rotation about local +X.
  const theta = THREE.MathUtils.degToRad(bend)
  const corner = new THREE.Vector3(0, 0, entry)
  const exitDir = LOCAL_Z.clone().applyAxisAngle(LOCAL_X, theta)
  const end = corner.clone().addScaledVector(exitDir, exit)

  const half = Math.abs(theta) / 2
  const tan = Math.tan(half)
  // Straight through, or a break the user has asked to keep sharp.
  if (half < 1e-4 || fillet <= 0 || tan < 1e-6) {
    return fromPoints(dedupe([new THREE.Vector3(), corner.clone(), end]), corner)
  }

  // Tangent length: how far back down each leg the arc starts.
  const tangent = Math.min(fillet * tan, LEG_BUDGET * Math.min(entry, exit))
  const radius = tangent / tan
  const arcStart = corner.clone().addScaledVector(LOCAL_Z, -tangent)
  // Square off the entry leg toward the inside of the bend to find the centre.
  const inward = LOCAL_Z.clone().applyAxisAngle(LOCAL_X, Math.sign(theta) * (Math.PI / 2))
  const centre = arcStart.clone().addScaledVector(inward, radius)
  const spoke = new THREE.Vector3().subVectors(arcStart, centre)

  const chords = Math.max(ARC_MIN_CHORDS, Math.ceil(Math.abs(bend) / ARC_STEP_DEG))
  const points = [new THREE.Vector3(), arcStart]
  for (let i = 1; i <= chords; i++) {
    points.push(centre.clone().add(spoke.clone().applyAxisAngle(LOCAL_X, (theta * i) / chords)))
  }
  points.push(end)

  return fromPoints(dedupe(points), corner)
}

/**
 * Everything about a part that changes its solid, and nothing that does not —
 * so two parts with the same key can share one mesh, and editing a part's
 * position or name never rebuilds it.
 */
export function shapeKey(piece: Piece): string {
  if (piece.type !== 'angle') return `straight:${piece.length}`
  const a = angleSpec(piece)
  return `angle:${a.entry}:${a.bend}:${a.exit}:${a.fillet}`
}

/** Centreline length of a part, mm — what it actually contributes to the run. */
export function pieceAxisLength(piece: Piece): number {
  return centerlineFor(piece).length
}
