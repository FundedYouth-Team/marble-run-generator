import * as THREE from 'three'
import {
  coilAxisAt,
  coilDirAt,
  coilHeightAt,
  coilPointAt,
  coilRadiusAt,
  coilRadiusAtHeight,
  type CoilSpine,
} from './corkscrew'
import { CAGE_CLEARANCE, CAGE_HOLE, cageReach, type CoilCage, type TubeSpec } from '../store'

/**
 * The cage that braces a corkscrew: two hoops and the posts between them, built
 * as bars and laid against the coil.
 *
 * The whole of it is boxes. A cage is doing nothing but holding a coil still,
 * and a square bar braces as well as a round one, prints rather better lying on
 * its side, and reads as structure rather than as somewhere the marble might
 * go — which is worth having on a part the marble winds right through.
 *
 * Everything here is worked out in the part's own frame, on the coil's own axis:
 * `up` is the upright the coil winds about, and heights are measured along it
 * from the part's origin. That is the same frame the tube is swept in, so the
 * two go together without either being moved.
 *
 * Two rules hold the whole shape together:
 *
 *   - **The bars stand flush with the channel.** The face of every bar looking
 *     at the coil sits a whisker off the bore's own surface, so it bites into
 *     the wall behind it for very nearly the wall's whole thickness and stops
 *     dead where the marble starts. Nothing the marble touches is moved and
 *     nothing it could hit is added. See {@link CAGE_CLEARANCE} for the whisker,
 *     which is there because a straight bar laid against a helix is flush with
 *     it at the turns and a hair proud of it between them.
 *   - **The bars lean with the coil.** A cage inside a coil that narrows as it
 *     falls is a cone, not a cylinder: the posts follow the coil's own taper,
 *     turn by turn, so a post meets every ring it passes at exactly the same
 *     depth as the one above.
 *
 * What the tube's open side does to that is the one thing that varies, and it
 * varies per side rather than per part. A trough facing up or down leaves the
 * lips of the channel at the coil's inner and outer extremes, which is where the
 * bars are: both cages weld to those lips and nothing else is needed. A trough
 * facing away from the cage presents a closed wall, which is better still. A
 * trough facing *into* the cage is the awkward one — the wall the bar wants is
 * the wall that was cut away to open the channel, and reaching in far enough to
 * find material would put the bar across the marble's path. So on that side
 * alone the post does not meet the tube at all: a tie is laid under the channel
 * at every turn instead, from the post to the lower lip, passing beneath the
 * bore where there is nothing to obstruct. See {@link cageWelds}.
 */

/** How finely a hoop is chopped, degrees. */
const HOOP_STEP = 8

/**
 * How far a tie reaches past the lip it grabs, as a share of the wall.
 *
 * Solids in this app are laid against one another rather than cut together — see
 * `mergeSolids` — so an overlap is what makes two of them one lump rather than
 * two touching at a plane. Written against the wall because that is the material
 * there is to bite into: the lip is a wall thick, and a tie reaching a whole one
 * past it has grabbed the lip rather than brushed it.
 */
const TIE_BITE = 1

/**
 * One bar: a rectangle carried along a rail, with its own idea of which way is
 * up at each station.
 *
 * The section is held square to the rail by construction — `v` is the reference
 * squared against the way the bar is going, and `u` follows from the two — so a
 * bar that bends stays the same thickness through the bend.
 */
function barSolid(
  rail: THREE.Vector3[],
  refs: THREE.Vector3[],
  wide: number,
  tall: number,
  closed: boolean,
): THREE.BufferGeometry | null {
  if (rail.length < 2) return null
  const positions: number[] = []
  const indices: number[] = []
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]

  const rings: number[] = []
  for (let i = 0; i < rail.length; i++) {
    // The way the bar is going here: the chord ahead, the chord behind, or the
    // two averaged where it turns — which is what carries a mitred corner.
    const back = rail[(i - 1 + rail.length) % rail.length]
    const on = rail[(i + 1) % rail.length]
    const first = !closed && i === 0
    const last = !closed && i === rail.length - 1
    const d = new THREE.Vector3()
    if (!first) d.add(new THREE.Vector3().subVectors(rail[i], back).normalize())
    if (!last) d.add(new THREE.Vector3().subVectors(on, rail[i]).normalize())
    if (d.lengthSq() < 1e-12) continue
    d.normalize()

    const v = refs[i].clone().addScaledVector(d, -refs[i].dot(d))
    if (v.lengthSq() < 1e-12) continue
    v.normalize()
    const u = new THREE.Vector3().crossVectors(v, d)

    rings.push(positions.length / 3)
    for (const [a, b] of corners) {
      const p = rail[i]
        .clone()
        .addScaledVector(u, (a * wide) / 2)
        .addScaledVector(v, (b * tall) / 2)
      positions.push(p.x, p.y, p.z)
    }
  }
  if (rings.length < 2) return null

  // The wall. `u × v` is the way the bar is going, so the section reads
  // anticlockwise looked at from the far end, and every quad is wound to face
  // out of the bar rather than into it.
  const spans = closed ? rings.length : rings.length - 1
  for (let i = 0; i < spans; i++) {
    const a = rings[i]
    const b = rings[(i + 1) % rings.length]
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4
      indices.push(a + k, a + k2, b + k2)
      indices.push(a + k, b + k2, b + k)
    }
  }

  // The two ends, where the bar has them. Fanned across the section, which is a
  // rectangle and so convex however the bar is turned.
  if (!closed) {
    const back = rings[0]
    const front = rings[rings.length - 1]
    indices.push(back, back + 2, back + 1, back, back + 3, back + 2)
    indices.push(front, front + 1, front + 2, front, front + 2, front + 3)
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  geom.computeBoundingSphere()
  return geom
}

/**
 * Whether a bar standing flush with the channel on this side of the coil finds
 * any material to weld itself to.
 *
 * The bar's face sits a bore's radius off the tube's centreline. Material
 * reaches that far out only within `acos(bore / wall's outside)` of straight
 * along — past that the tube's own curve has already fallen inside the face — so
 * what settles it is whether the opening's gap swallows that whole band. A
 * closed tube has no gap and always welds; a trough facing the other way welds
 * on its closed back; a trough facing this way does not weld at all.
 */
export function cageWelds(spec: TubeSpec, toward: number): boolean {
  if (spec.closed) return true
  const gap = Math.PI * 2 - spec.sweep
  // Where the opening is centred, in the same section angles `toward` is given
  // in: material runs from `startAngle` for `sweep`, so the gap is the rest of
  // the circle and sits half to either side of the seam between the two.
  const open = spec.startAngle - gap / 2
  const off = Math.abs(Math.atan2(Math.sin(toward - open), Math.cos(toward - open)))
  const band = Math.acos(Math.min(1, spec.innerR / spec.outerR))
  return off > gap / 2 - band
}

/**
 * Which way the section's +X looks on a coil: at its own axis where it winds to
 * the right, away from it where it winds to the left.
 *
 * The section is stood on the upright crossed into the way the run is heading,
 * and a coil that winds the other way is heading the other way round.
 */
const inward = (hand: number) => (hand > 0 ? 0 : Math.PI)

/**
 * Which side of a coil its trough faces, of the two a cage can stand on — or
 * null where it faces neither, which is a trough facing up or down and is what
 * every coil in the library does.
 *
 * Worth asking outside this module: it is the one thing about a cage that the
 * open side changes, and the part of it worth saying out loud.
 */
export function coilTroughSide(spec: TubeSpec, hand: number): 'inner' | 'outer' | null {
  if (!cageWelds(spec, inward(hand))) return 'inner'
  if (!cageWelds(spec, inward(-hand))) return 'outer'
  return null
}

/** One side of a cage: which way it stands off the coil, and its section angle. */
interface CageSide {
  /** +1 outside the coil, -1 up its middle. */
  sign: number
  /**
   * Which way that is, as an angle in the tube's own section — the frame the
   * open side is measured in. The section's +X is `up × direction`, which on a
   * right-hand coil points at the axis and on a left-hand one points away.
   */
  toward: number
}

/**
 * The cage as a heap of solids, in the part's own frame.
 *
 * `crown` and `floor` are how high the run's own centreline reaches at its
 * highest and lowest, measured along the coil's upright. The hoops are set
 * flush with the ends of the part those describe — the bottom one lands on
 * whatever the coil is standing on and the top one caps it — except where being
 * flush would put a hoop through the channel, which is the one thing a cage may
 * never do.
 *
 * That exception is the stubs. Everything a hoop passes at its own height is a
 * turn of the coil, which it stands off by the same figure the posts do — but
 * the highest and lowest points of a corkscrew are not the coil at all: they are
 * the stubs that run in and out of it, and a stub heads *out* of the coil rather
 * than round it, so it crosses a hoop's line at whatever radius it likes. A hoop
 * a bar thick, hung off the very top of a tube, reaches a bar's thickness down
 * past the crown of that stub and into its bore. So a hoop is held off the
 * channel first and set flush second: on any bar thicker than the wall it stands
 * a whisker proud of the part rather than a whisker inside the marble's way.
 */
export function coilCageSolids(
  C: CoilSpine,
  cage: CoilCage,
  spec: TubeSpec,
  crown: number,
  floor: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const w = cage.width
  // Flush with the part is a bar's half-thickness inside its skin; clear of the
  // channel is a bar's half-thickness outside the bore. Whichever is further out
  // wins, which on a bar no thicker than the wall is the first of the two.
  const stand = Math.max(spec.outerR - w / 2, spec.innerR + CAGE_CLEARANCE + w / 2)
  // The two hoops, by their own middles.
  const hoops = [floor - stand, crown + stand]
  if (hoops[1] - hoops[0] < w * 2 + 1) return out

  // Which way round the coil winds decides which way its section faces: the
  // section's +X is the upright crossed into the run's heading, so it looks at
  // the axis on a coil that winds to the right and away from it on one that
  // winds to the left.
  const hand = C.axis.dot(C.up) < 0 ? -1 : 1
  const sides: CageSide[] = []
  if (cage.inner) sides.push({ sign: -1, toward: inward(hand) })
  if (cage.outer) sides.push({ sign: 1, toward: inward(-hand) })

  const reach = cageReach(cage, spec.innerR)
  const least = Math.min(coilRadiusAt(C, 0), coilRadiusAt(C, C.angle))

  for (const side of sides) {
    // Only the inside can run out of room: outside a coil there is always more
    // of it further out.
    if (side.sign < 0 && least - reach < CAGE_HOLE) continue

    /** Where a bar's own middle stands at a height, measured off the axis. */
    const off = spec.innerR + CAGE_CLEARANCE + w / 2
    const at = (y: number) => coilRadiusAtHeight(C, y) + side.sign * off
    /** Which way is out from the axis, `phi` round from where the coil starts. */
    const spokeAt = (phi: number) => C.spoke.clone().applyAxisAngle(C.axis, phi)
    /** A point on that bar, `phi` round from where the coil starts. */
    const on = (y: number, phi: number) => coilAxisAt(C, y).addScaledVector(spokeAt(phi), at(y))

    for (const y of hoops) {
      const chords = Math.max(16, Math.ceil(360 / HOOP_STEP))
      const rail: THREE.Vector3[] = []
      for (let i = 0; i < chords; i++) rail.push(on(y, (Math.PI * 2 * i) / chords))
      const solid = barSolid(rail, rail.map(() => C.up), w, w, true)
      if (solid) out.push(solid)
    }

    // The posts. Set half a quarter-turn round from where the coil starts, so
    // none of them stands in line with the stubs that run in and out of it.
    const welds = cageWelds(spec, side.toward)
    for (let i = 0; i < cage.posts; i++) {
      const phi = (Math.PI * 2 * (i + 0.5)) / cage.posts
      // Every turn this post passes, taken at the exact angle it passes it: the
      // post is straight between them and dead on the coil at each, so it meets
      // one ring exactly as it meets the next however hard the coil tapers.
      const crossings: number[] = []
      for (let n = 0; phi + Math.PI * 2 * n <= C.angle + 1e-9; n++) {
        crossings.push(phi + Math.PI * 2 * n)
      }
      const heights = crossings
        .map((at) => coilHeightAt(C, at))
        .filter((y) => y > hoops[0] + w && y < hoops[1] - w)
      const rail = [hoops[0], ...heights, hoops[1]]
        .sort((a, b) => a - b)
        .map((y) => on(y, phi))
      // A post stands up the coil's own axis, or near enough, so the upright is
      // no use to it as a reference — it is the way the bar is going. The spoke
      // is, and it is the axis the section wants anyway: a post is as thick
      // across the coil as it is round it.
      const spoke = spokeAt(phi)
      const solid = barSolid(
        rail,
        rail.map(() => spoke),
        w,
        w,
        false,
      )
      if (solid) out.push(solid)

      // Where the trough faces into this cage there is no wall for the post to
      // weld to — the wall it wants is the one cut away to open the channel — so
      // each turn is tied to the post under its own lower lip instead, below the
      // bore, where there is nothing for a tie to be in the way of.
      if (!welds) {
        for (const at of crossings) {
          const tie = cageTie(C, spec, side, at, w)
          if (tie) out.push(tie)
        }
      }
    }
  }

  return out
}

/**
 * The tie between a post and one turn of a coil the post cannot reach: a block
 * laid across under the channel, from inside the tube's lower lip out to the
 * post's far face.
 *
 * It is built in the tube's own section rather than on the level, which matters
 * more than it reads: the section stands square to a run falling at twenty or
 * thirty degrees, and a block laid level under a tube that steep would cut into
 * the bore however far under the centreline it was put. Squared to the section,
 * "below the bore" means below it.
 */
function cageTie(
  C: CoilSpine,
  spec: TubeSpec,
  side: CageSide,
  phi: number,
  w: number,
): THREE.BufferGeometry | null {
  const o = coilPointAt(C, phi)
  const dir = coilDirAt(C, phi)
  // The section's own axes: up squared against the run, and the axis across the
  // two — which is level, and points at the coil's axis or away from it.
  const v = C.up.clone().addScaledVector(dir, -C.up.dot(dir))
  if (v.lengthSq() < 1e-12) return null
  v.normalize()
  const across = new THREE.Vector3().crossVectors(v, dir)
  // Pointed the way this cage stands, whichever way round the section faces:
  // in at the coil's own axis for a cage up the middle, out for one outside it.
  const toward = coilAxisAt(C, o.dot(C.up)).sub(o).multiplyScalar(side.sign < 0 ? 1 : -1)
  const x = across.multiplyScalar(across.dot(toward) >= 0 ? 1 : -1)

  // The band under the channel: from the outside of the wall up to the bore,
  // which is solid on a trough facing any way at all, and clear of the marble
  // whatever it is doing.
  const under = -(spec.outerR + spec.innerR) / 2
  const foot = o.clone().addScaledVector(v, under)
  return barSolid(
    [
      foot.clone().addScaledVector(x, -TIE_BITE * spec.wall),
      foot.clone().addScaledVector(x, spec.innerR + CAGE_CLEARANCE + w),
    ],
    [v, v],
    w,
    spec.wall,
    false,
  )
}
