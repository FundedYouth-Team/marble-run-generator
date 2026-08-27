import * as THREE from 'three'
import type { Assembly, Segment } from './layout'
import { funnelShell } from './funnel'
import { funnelSpec, type Piece, type TubeSpec } from '../store'

/**
 * The stage as the flying marble meets it: every surface on it, solved rather
 * than sampled.
 *
 * Nothing here is a mesh. Every part in the library is one of two shapes — a
 * section swept along a chord, or a profile turned about an upright — and both
 * answer "how far is this point from your surface, and which way is out" in
 * closed form. So a marble in the air is tested against the parts themselves
 * rather than against a triangle soup built from them: no tunnelling at speed,
 * no dependence on how finely a bend happens to be chopped, and the same answer
 * every time it is asked. It also costs nothing to keep up to date, because it
 * is read straight off the layout the stage is already drawing from.
 *
 * The one thing it is not is a rigid-body engine. The marble has no angular
 * momentum here and the walls never move, which between them are the reason a
 * closed form is possible at all.
 */

/** A length of tube: the chord it runs on, and the annulus swept along it. */
interface Shell {
  seg: Segment
  innerR: number
  outerR: number
  /** Across the tube, world — `up × dir`, so the opening is measured in-plane. */
  right: THREE.Vector3
  /**
   * Half the opening, radians either side of the chord's up axis. Nought on
   * closed tube, a right angle on a half pipe. Inside this arc there is no
   * material at any radius, which is how the marble gets into a trough from
   * above and out of one it is thrown clear of.
   */
  gap: number
}

/**
 * A funnel's bowl: a closed profile in (radius, height) turned about the
 * upright. The profile runs down the inside from the rim, out across the
 * throat, back up the outside and in across the top — so it bounds the solid,
 * and one distance-to-polyline answers for the cup, the cone, the outer face
 * and the lip round the top alike.
 */
interface Bowl {
  /** Where the bowl's axis stands, world. */
  centre: THREE.Vector3
  /** The part's own frame, for taking a world point into the profile's plane. */
  inverse: THREE.Quaternion
  /** The bowl's axis in the world — the height axis of the profile's plane. */
  up: THREE.Vector3
  /** The part's frame, for handing a direction back out to the world. */
  quaternion: THREE.Quaternion
  /** Closed profile, (radius, height above the run's level), in the part's frame. */
  profile: THREE.Vector2[]
  /** Inside face only, top to throat — what tells the bowl it has caught something. */
  cavity: THREE.Vector2[]
  /** Which run the whirl inside this bowl belongs to, and the chords of it. */
  chain: number
  whirl: Segment[]
}

export interface World {
  shells: Shell[]
  bowls: Bowl[]
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Reads the stage into surfaces. `spec` hands back the tube a part is cut from,
 * which is the run's unless the part has been sized on its own.
 */
export function buildWorld(asm: Assembly, spec: (piece: Piece) => TubeSpec): World {
  const shells: Shell[] = []
  const bowls: Bowl[] = []

  for (const run of asm.chains) {
    for (const seg of run.segments) {
      if (!seg.enclosed) continue
      const tube = spec(seg.piece)
      shells.push({
        seg,
        innerR: tube.innerR,
        outerR: tube.outerR,
        right: new THREE.Vector3().crossVectors(seg.up, seg.dir),
        // The solid covers `sweep` of the circle centred on up, so what is left
        // open is the rest of it, half to either side.
        gap: Math.max(0, (Math.PI * 2 - tube.sweep) / 2),
      })
    }
  }

  for (const placed of asm.placed) {
    if (placed.piece.type !== 'funnel') continue
    const tube = spec(placed.piece)
    const shell = funnelShell(funnelSpec(placed.piece), tube.innerR, tube.wall)
    // The bowl is drawn about its own axis in the part's frame; standing it up
    // is the same step the mesh takes, so the two land in the same place.
    const centre = shell.centre.clone().applyQuaternion(placed.quaternion).add(placed.start)
    const floor = shell.crown - shell.rim - shell.cone
    const cavity = [
      new THREE.Vector2(shell.mouthR, shell.crown),
      new THREE.Vector2(shell.mouthR, shell.crown - shell.rim),
      new THREE.Vector2(shell.throatR, floor),
    ]
    bowls.push({
      centre,
      inverse: placed.quaternion.clone().invert(),
      up: UP.clone().applyQuaternion(placed.quaternion),
      quaternion: placed.quaternion.clone(),
      // Down the inside, across the throat, up the outside, in across the lip.
      profile: [
        ...cavity,
        new THREE.Vector2(shell.throatR + shell.offset, floor),
        new THREE.Vector2(shell.mouthR + shell.offset, shell.crown - shell.rim),
        new THREE.Vector2(shell.mouthR + shell.wall, shell.crown),
      ],
      cavity,
      chain: placed.chain,
      whirl: placed.segments.filter((seg) => !seg.enclosed),
    })
  }

  return { shells, bowls }
}

/** Where a surface was met, and which way the marble has to go to get off it. */
export interface Contact {
  /** Unit normal, pointing out of the material. */
  normal: THREE.Vector3
  /** How far the marble is overlapping, mm. */
  depth: number
}

/**
 * The deepest surface the marble is overlapping, or null if it is in clear air.
 *
 * Deepest rather than nearest, and one at a time: a marble in a corner is pushed
 * off the wall it is furthest into, and the step after that off the next one.
 * Resolving them together would need the walls solved as a set, which is a
 * solver rather than a query, and two frames apart is quick enough that nobody
 * watching can tell.
 */
export function contact(world: World, p: THREE.Vector3, r: number): Contact | null {
  let best: Contact | null = null
  const keep = (hit: Contact | null) => {
    if (hit && (!best || hit.depth > best.depth)) best = hit
  }
  for (const shell of world.shells) keep(shellContact(shell, p, r))
  for (const bowl of world.bowls) keep(bowlContact(bowl, p, r))
  return best
}

/** Scratch, so a frame's worth of tests allocates nothing. */
const rel = new THREE.Vector3()
const radial = new THREE.Vector3()
const local = new THREE.Vector3()

function shellContact(shell: Shell, p: THREE.Vector3, r: number): Contact | null {
  const { seg, innerR, outerR } = shell
  rel.subVectors(p, seg.start)
  const t = rel.dot(seg.dir)
  // Only across the chord's own stretch. The cut faces at either end are left
  // out on purpose: a marble aimed at the open mouth of a tube has to be able to
  // fly in, and a rim a wall thick is not worth the bounce it would cost.
  if (t < 0 || t > seg.length) return null

  radial.copy(rel).addScaledVector(seg.dir, -t)
  const rho = radial.length()
  // Dead on the axis there is no direction to be pushed in, and nothing to push
  // off: the marble is as far inside the bore as it can get.
  if (rho < 1e-6) return null
  radial.divideScalar(rho)

  // Measured off the up axis, so the opening — which is centred on up — is the
  // arc either side of nought.
  const angle = Math.atan2(radial.dot(shell.right), radial.dot(seg.up))
  if (Math.abs(angle) < shell.gap) return null

  if (rho <= innerR) {
    const depth = rho + r - innerR
    return depth > 0 ? { normal: radial.clone().negate(), depth } : null
  }
  if (rho >= outerR) {
    const depth = outerR - (rho - r)
    return depth > 0 ? { normal: radial.clone(), depth } : null
  }
  // Caught in the wall itself — only reachable through a gap or a wall thinner
  // than a time step. Out the nearer way.
  return rho - innerR < outerR - rho
    ? { normal: radial.clone().negate(), depth: rho + r - innerR }
    : { normal: radial.clone(), depth: outerR - rho + r }
}

function bowlContact(bowl: Bowl, p: THREE.Vector3, r: number): Contact | null {
  const { rho, height, spoke } = bowlFrame(bowl, p)
  const here = new THREE.Vector2(rho, height)
  const near = nearestOnLoop(bowl.profile, here)
  const inside = withinLoop(bowl.profile, here)
  if (!inside && near.distance > r) return null

  // Out of the material: away from the surface where the marble is clear of it,
  // and back the way it came where it has sunk in.
  const out = inside
    ? new THREE.Vector2().subVectors(near.point, here)
    : new THREE.Vector2().subVectors(here, near.point)
  if (out.lengthSq() < 1e-12) return null
  out.normalize()

  return {
    // The profile is turned about the upright, so its radial axis in the part's
    // frame is the spoke out to the marble and its height axis is that frame's
    // own up. Both are already world here.
    normal: spoke.clone().multiplyScalar(out.x).addScaledVector(bowl.up, out.y).normalize(),
    depth: inside ? r + near.distance : r - near.distance,
  }
}

/**
 * A world point in the bowl's own terms: how far out from the axis it stands,
 * how high it is above the run's level, and which way "out" points in the world.
 */
function bowlFrame(bowl: Bowl, p: THREE.Vector3) {
  local.subVectors(p, bowl.centre).applyQuaternion(bowl.inverse)
  const height = local.y
  local.y = 0
  const rho = local.length()
  const spoke = rho < 1e-6 ? new THREE.Vector3(1, 0, 0) : local.clone().divideScalar(rho)
  // Back into the world, where the rest of the sum is done.
  return { rho, height, spoke: spoke.applyQuaternion(bowl.quaternion) }
}

/** Closest point on a closed polyline, and how far off it the query point is. */
function nearestOnLoop(loop: THREE.Vector2[], q: THREE.Vector2) {
  let point = loop[0]
  let distance = Infinity
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const ab = new THREE.Vector2().subVectors(b, a)
    const len2 = ab.lengthSq()
    const t = len2 < 1e-12 ? 0 : THREE.MathUtils.clamp(new THREE.Vector2().subVectors(q, a).dot(ab) / len2, 0, 1)
    const on = a.clone().addScaledVector(ab, t)
    const d = on.distanceTo(q)
    if (d < distance) {
      distance = d
      point = on
    }
  }
  return { point, distance }
}

/** Even–odd crossing test — whether the point is in the solid the loop bounds. */
function withinLoop(loop: THREE.Vector2[], q: THREE.Vector2): boolean {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** A run the marble has landed in, and how far along it it came down. */
export interface Landing {
  chain: number
  s: number
}

/**
 * Which run, if any, the marble is now inside.
 *
 * A tube catches it when its whole width fits within the bore — which for an
 * open trough is exactly what dropping in through the gap leaves it. A bowl
 * catches it when it is anywhere in the cup at all, because a funnel has no bore
 * to be inside: what it has is a wall the marble is already running on, and the
 * whirl is where that wall takes it.
 */
export function landing(world: World, p: THREE.Vector3, r: number): Landing | null {
  for (const shell of world.shells) {
    rel.subVectors(p, shell.seg.start)
    const t = rel.dot(shell.seg.dir)
    if (t < 0 || t > shell.seg.length) continue
    radial.copy(rel).addScaledVector(shell.seg.dir, -t)
    if (radial.length() > shell.innerR - r) continue
    return { chain: shell.seg.chain, s: shell.seg.startS + t }
  }

  for (const bowl of world.bowls) {
    if (!bowl.whirl.length) continue
    const { rho, height } = bowlFrame(bowl, p)
    if (height > bowl.cavity[0].y || height < bowl.cavity[bowl.cavity.length - 1].y) continue
    if (rho > cavityRadius(bowl.cavity, height) - r) continue
    return { chain: bowl.chain, s: nearestAlong(bowl.whirl, p) }
  }

  return null
}

/** How wide the cup is at a given height — the inside face, read off its profile. */
function cavityRadius(cavity: THREE.Vector2[], height: number): number {
  for (let i = 1; i < cavity.length; i++) {
    const a = cavity[i - 1]
    const b = cavity[i]
    if (height <= a.y && height >= b.y) {
      const span = a.y - b.y
      const t = span < 1e-9 ? 0 : (a.y - height) / span
      return THREE.MathUtils.lerp(a.x, b.x, t)
    }
  }
  return cavity[cavity.length - 1].x
}

/** Arc length of the point on these chords nearest `p`, in their run's own terms. */
function nearestAlong(segments: Segment[], p: THREE.Vector3): number {
  let best = segments[0].startS
  let distance = Infinity
  for (const seg of segments) {
    rel.subVectors(p, seg.start)
    const t = THREE.MathUtils.clamp(rel.dot(seg.dir), 0, seg.length)
    const d = rel.addScaledVector(seg.dir, -t).length()
    if (d < distance) {
      distance = d
      best = seg.startS + t
    }
  }
  return best
}
