import * as THREE from 'three'
import type { Assembly, PlacedPiece, Segment } from './layout'
import { funnelShell } from './funnel'
import {
  OPEN_SIDE_ANGLE,
  funnelDrainSpec,
  funnelSpec,
  tubeSpec,
  type Piece,
  type TubeSpec,
} from '../store'

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
export interface Shell {
  seg: Segment
  innerR: number
  outerR: number
  /** Across the tube, world — `up × dir`, so the opening is measured in-plane. */
  right: THREE.Vector3
  /**
   * Half the opening, radians either side of {@link Shell.opens}. Nought on
   * closed tube, a right angle on a half pipe. Inside this arc there is no
   * material at any radius, which is how the marble gets into a trough from
   * above and out of one it is thrown clear of.
   */
  gap: number
  /**
   * Where that opening is centred, radians off the chord's up axis — nought for
   * a tube open on top, and a quarter turn either way for one opened onto its
   * side. See {@link OPEN_SIDE_ANGLE}, which this is read straight off: the
   * marble has to fall out of the side the part was actually cut open on.
   */
  opens: number
  /**
   * Whether the wall curls over the marble, so that the slot is a window rather
   * than a way through. A closed tube and a 3/4 one both are; a trough is not.
   * See {@link captive} — and note that it settles both ways at once, since a
   * marble that cannot be pulled out through the slot cannot be dropped in
   * through it either. Such a tube is solid to a marble in the air as well.
   */
  captive: boolean
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
  /**
   * The tube round each chord, for asking what a chord can hold. A chord with
   * no entry has no tube round it at all — a funnel's whirl, where the bowl does
   * the holding rather than a wall.
   */
  byChord: Map<Segment, Shell>
}

const UP = new THREE.Vector3(0, 1, 0)

/** An angle brought back into (-π, π], so "how far apart" is the short way round. */
export function wrapPi(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2)
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI
}

/**
 * The tube each of a part's chords is really cut from.
 *
 * Every part but the funnel is one tube from end to end, so the part's own spec
 * answers for all of it. A funnel is three things in a row, and only the middle
 * one is what the part's style describes:
 *
 * - the feed pipe, which is a hole let through the bowl's wall. A hole through a
 *   wall has no open side to give it, so the mesh builds it closed whatever the
 *   part is cut in — see `feedTubeGeometry` — and the marble has to be carried
 *   through it accordingly. Read as a trough it would drop the marble at the
 *   very rim of the bowl, out of a pipe that is plainly closed on screen.
 * - the whirl, which is no pipe at all and gets no shell.
 * - the drain, which may have been given a style of its own.
 */
function tubeAlong(placed: PlacedPiece, own: TubeSpec): (seg: Segment) => TubeSpec {
  if (placed.piece.type !== 'funnel') return () => own
  const feed = tubeSpec(own.innerR * 2, own.wall, 'closed', own.openSide)
  const drain = funnelDrainSpec(own, placed.piece)
  const { entry } = funnelSpec(placed.piece)
  // By arc length along the part rather than by counting chords, for the reason
  // `enclosedChords` gives: a funnel bent onto its joint has its feed split in
  // two, and everything counted from the front is then off by one.
  return (seg) => (seg.startS - placed.startS + seg.length / 2 < entry ? feed : drain)
}

/**
 * Reads the stage into surfaces. `spec` hands back the tube a part is cut from,
 * which is the run's unless the part has been sized on its own.
 */
export function buildWorld(asm: Assembly, spec: (piece: Piece) => TubeSpec): World {
  const shells: Shell[] = []
  const bowls: Bowl[] = []
  const byChord = new Map<Segment, Shell>()

  for (const placed of asm.placed) {
    const along = tubeAlong(placed, spec(placed.piece))
    for (const seg of placed.segments) {
      if (!seg.enclosed) continue
      const tube = along(seg)
      // The solid covers `sweep` of the circle, so what is left open is the rest
      // of it, half to either side of wherever it is centred.
      const gap = Math.max(0, (Math.PI * 2 - tube.sweep) / 2)
      const shell: Shell = {
        seg,
        innerR: tube.innerR,
        outerR: tube.outerR,
        right: new THREE.Vector3().crossVectors(seg.up, seg.dir),
        gap,
        opens: OPEN_SIDE_ANGLE[tube.openSide],
        captive: captive(gap),
      }
      shells.push(shell)
      byChord.set(seg, shell)
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

  return { shells, bowls, byChord }
}

/**
 * Whether a tube's wall curls over the marble — which is what makes a slot a
 * window rather than a way out.
 *
 * A tube that keeps more than half its wall has the two sides of its slot
 * leaning in over the widest part of the bore, and the marble under them is held
 * the way a snap fit holds one: to leave it would have to spring the walls
 * apart, which printed tube and a glass marble do not do to each other. So a 3/4
 * tube carries the marble exactly as a closed one does, whichever way up the
 * part is turned and however hard a bend throws it — the slot is there to see
 * through, and the marble still leaves at the ends and nowhere else.
 *
 * Only once the slot reaches half the circle do the walls stand straight up with
 * nothing overhanging, and the part stops being a tube with a window in it and
 * becomes a trough. A trough is open to whatever is above it, and a marble
 * pressed that way goes.
 */
function captive(gap: number): boolean {
  return gap < Math.PI / 2 - 1e-9
}

/**
 * Whether the tube round a chord holds a marble that is being pushed `push` way
 * — a unit vector in the world, which is where the marble's weight and whatever
 * a bend is throwing it out with add up to.
 *
 * A chord with no tube round it holds whatever is on it: the funnel's bowl is
 * the only such chord, and the bowl is a wall in its own right.
 */
export function holdsMarble(world: World, seg: Segment, push: THREE.Vector3 | null): boolean {
  const shell = world.byChord.get(seg)
  if (!shell || shell.captive) return true
  // Nothing pushing it anywhere is nothing pushing it out.
  if (!push) return true
  const angle = Math.atan2(push.dot(shell.right), push.dot(seg.up))
  // Wall where it is being pushed, so the wall takes it.
  return Math.abs(wrapPi(angle - shell.opens)) >= shell.gap
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

  // Measured off the up axis and turning towards the tube's left, which is the
  // frame the open side is named in — so the opening is the arc either side of
  // where that side sits, wrapped to the short way round. A captive tube has no
  // way through its slot in either direction, so it is solid all the way round
  // and this is not asked of it at all.
  if (!shell.captive) {
    const angle = Math.atan2(radial.dot(shell.right), radial.dot(seg.up))
    if (Math.abs(wrapPi(angle - shell.opens)) < shell.gap) return null
  }

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
 * open trough is exactly what dropping in through the gap leaves it — and when
 * the tube can actually hold it there, which `holds` answers. Without that
 * second question a trough turned on its back would catch the very marble it is
 * about to drop, over and over, and the marble would hang in mid-air. A bowl
 * catches it when it is anywhere in the cup at all, because a funnel has no bore
 * to be inside: what it has is a wall the marble is already running on, and the
 * whirl is where that wall takes it.
 */
export function landing(
  world: World,
  p: THREE.Vector3,
  r: number,
  holds: (seg: Segment) => boolean,
): Landing | null {
  for (const shell of world.shells) {
    rel.subVectors(p, shell.seg.start)
    const t = rel.dot(shell.seg.dir)
    if (t < 0 || t > shell.seg.length) continue
    radial.copy(rel).addScaledVector(shell.seg.dir, -t)
    if (radial.length() > shell.innerR - r) continue
    if (!holds(shell.seg)) continue
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
