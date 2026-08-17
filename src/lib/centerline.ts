import * as THREE from 'three'
import { angleSpec, cornerSpec, type Piece, type TubeVariant } from '../store'

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
const LOCAL_Y = new THREE.Vector3(0, 1, 0)
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

/** Two legs meeting at a break, as both connectors are built. */
interface Bent {
  /** Rigid leg up to the break, mm. */
  entry: number
  /** How far the run breaks there, degrees. */
  angle: number
  /** Leg past the break, mm. */
  exit: number
  /** Radius the break is rounded off with, mm; zero keeps it sharp. */
  fillet: number
}

/**
 * A two-legged connector, broken about `axis`. The angle connector breaks about
 * local +X, which tips the run up or down; the corner connector breaks about
 * local +Y — the tube's own up axis — which swings it right or left. The shape
 * is otherwise the same part, so both are built here.
 */
function bentLine({ entry, angle, exit, fillet }: Bent, axis: THREE.Vector3): Centerline {
  const theta = THREE.MathUtils.degToRad(angle)
  const corner = new THREE.Vector3(0, 0, entry)
  const exitDir = LOCAL_Z.clone().applyAxisAngle(axis, theta)
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
  const inward = LOCAL_Z.clone().applyAxisAngle(axis, Math.sign(theta) * (Math.PI / 2))
  const centre = arcStart.clone().addScaledVector(inward, radius)
  const spoke = new THREE.Vector3().subVectors(arcStart, centre)

  const chords = Math.max(ARC_MIN_CHORDS, Math.ceil(Math.abs(angle) / ARC_STEP_DEG))
  const points = [new THREE.Vector3(), arcStart]
  for (let i = 1; i <= chords; i++) {
    points.push(centre.clone().add(spoke.clone().applyAxisAngle(axis, (theta * i) / chords)))
  }
  points.push(end)

  return fromPoints(dedupe(points), corner)
}

/**
 * The centreline of one part. A plain tube is a single chord; a connector is
 * two legs meeting at a break, with the break optionally rounded into an arc
 * tangent to both.
 */
export function centerlineFor(piece: Piece): Centerline {
  // Falling is -Y, so a positive bend is a positive rotation about local +X.
  if (piece.type === 'angle') {
    const { entry, bend, exit, fillet } = angleSpec(piece)
    return bentLine({ entry, angle: bend, exit, fillet }, LOCAL_X)
  }
  // Right is +X, so a positive sweep is a positive rotation about local +Y.
  if (piece.type === 'corner') {
    const { entry, sweep, exit, fillet } = cornerSpec(piece)
    return bentLine({ entry, angle: sweep, exit, fillet }, LOCAL_Y)
  }
  return fromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, piece.length)], null)
}

/**
 * Everything about a part that changes its solid, and nothing that does not —
 * so two parts with the same key can share one mesh, and editing a part's
 * position or name never rebuilds it. `variant` is the style the part is
 * actually cut in, already resolved: two parts of the same shape in different
 * styles are different solids.
 */
export function shapeKey(piece: Piece, variant: TubeVariant): string {
  if (piece.type === 'angle') {
    const a = angleSpec(piece)
    return `${variant}:angle:${a.entry}:${a.bend}:${a.exit}:${a.fillet}`
  }
  if (piece.type === 'corner') {
    const c = cornerSpec(piece)
    return `${variant}:corner:${c.entry}:${c.sweep}:${c.exit}:${c.fillet}`
  }
  return `${variant}:straight:${piece.length}`
}

/** Centreline length of a part, mm — what it actually contributes to the run. */
export function pieceAxisLength(piece: Piece): number {
  return centerlineFor(piece).length
}
