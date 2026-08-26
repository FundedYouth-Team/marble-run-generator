import * as THREE from 'three'

/**
 * The geometry of a funnel, worked out in the part's own frame: it starts at the
 * origin heading down +Z, +Y is up (the opening side), and it is always fed dead
 * level.
 *
 * That last point is the one thing to know about this part. Every other part
 * takes whatever fall the run hands it; a funnel cannot, because a bowl is only
 * a bowl while it is level, and its feed is let in through the bowl's own side
 * wall square across the fall. A feed tipped even a few degrees runs its bore
 * out through the rim before it reaches the mouth, so the fall a funnel states
 * is nought, and the run has to come to it — exactly as a corkscrew's coil
 * states the fall its rings leave it at.
 *
 * The feed is a plain round pipe, run in past the side of the bowl and stopped
 * dead where it breaks through the wall. It is not laid on the wall but set in
 * from it — see {@link FUNNEL_FEED_SKEW} — which is the difference between a
 * pipe that grazes the wall down a long thin slot and one that goes through it
 * cleanly. Nothing of the pipe stands past the wall, so the mouth is smooth all
 * the way round but for the hole itself, and the marble comes out travelling
 * along the wall rather than at the throat.
 *
 * What happens inside is a conical spiral: the marble is delivered onto the
 * mouth travelling the way the run was already travelling, whirls round the
 * inside of the bowl, and closes in on the throat as it drops — the path of a
 * marble held out against the wall by its own speed. It leaves down the throat,
 * dead vertical, because that is the only way out of a funnel.
 *
 * This is plain numbers in and plain numbers out, so the store — which works out
 * where the run goes next — the centreline — which draws the path — and the
 * solid — which draws the bowl — can all read from it without any of them having
 * to know about the others. In particular nothing here knows the bore of the
 * tube the part is cut from, which is why {@link FunnelBowl.mouthRadius} is the
 * marble's own circle rather than the bowl's wall.
 */
export interface FunnelBowl {
  /**
   * Rigid lead-in up to the mouth, mm — measured along the pipe, which runs
   * dead level. Nought on a funnel built without one — see
   * {@link FunnelBowl.lead}.
   */
  entry: number
  /**
   * Inside radius of the bowl at the mouth, mm — the wall itself, which is what
   * anyone measuring a funnel would measure.
   *
   * Not where the marble runs: the feed is set in from the wall, so the marble
   * arrives on the smaller circle {@link funnelFeedRadius} works out. That is a
   * plain fraction of this and needs nothing else to know it, which is what lets
   * the centreline place the whirl without knowing the tube the part is cut from.
   */
  mouthRadius: number
  /**
   * How far the marble descends between the mouth and the throat, mm. The stub
   * either end is extra, so the part as a whole loses rather more than this.
   */
  depth: number
  /**
   * How high the straight collar round the mouth stands, mm — the band the
   * marble whirls against before the bowl starts closing in under it, measured
   * from its top edge down to where the cone begins.
   *
   * It is never shorter than the feed pipe is thick: the pipe is let through
   * this band, and a band too short to hold it would drop the pipe into the
   * cone, where the wall is already leaning away under it.
   */
  rim: number
  /**
   * How many times round the marble goes between the two. The sign picks which
   * way it whirls.
   *
   * A funnel with a feed pipe always whirls, because the pipe runs in square
   * across the bowl's radius and there is no way for the marble to leave it but
   * round. A plain funnel
   * never does, because nothing is aimed across it. So this is only ever read for
   * the first of those, and the store holds it clear of nought there.
   */
  turns: number
  /** Straight drop out of the throat, mm. */
  exit: number
  /**
   * Whether the mouth is fed by a pipe of its own.
   *
   * Without one the part is a plain funnel and the mouth is its inlet: something
   * else is stood over it and the marble is let go into it. The whirl needs the
   * pipe — it is the bore coming out square across the bowl's radius that sets
   * the marble off round rather than into the middle — so a funnel with no pipe
   * is a catch.
   */
  lead: boolean
}

const RAD = Math.PI / 180
const TAU = Math.PI * 2
/** Across the run, level. */
const LOCAL_X = new THREE.Vector3(1, 0, 0)
/** Up. A funnel is fed level, so the part's frame and the bowl's are the same. */
const LOCAL_Y = new THREE.Vector3(0, 1, 0)
/** The way the run is travelling. */
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

/**
 * The least cone the bowl is left with under its collar, mm. A collar taken
 * right down to the throat would be a straight cup with nothing to gather the
 * marble in, so the last of the depth is always cone.
 */
export const FUNNEL_LEAST_CONE = 8

/** The way out of a funnel: straight down, whatever it did on the way round. */
export const FUNNEL_EXIT_SLOPE = 90

/**
 * How much of the feed pipe's near end is kept back from the cut against the
 * bowl, mm — a quarter more than the deepest socket the app joints anything
 * with, so the cut never eats into the joint the marble arrives through.
 *
 * It is the floor on the cut as well as a term in the reach: the reach holds the
 * pipe long enough that the cut lands past it of its own accord, and the floor
 * is what a pipe shortened some other way falls back on. A pipe that pokes a
 * fraction into the bowl is a blemish; one with half its socket cut away is not
 * a joint at all.
 */
export const FUNNEL_SOCKET_KEEP = 10

/**
 * How obliquely the feed crosses the bowl's wall, degrees off square.
 *
 * This is the one number that says how far in from the wall the feed is set, and
 * it is stated as an angle rather than as a distance because the angle is what
 * the shape of the opening depends on. A pipe laid right on the wall crosses it
 * at ninety degrees off square — that is, not crossing it at all, but grazing —
 * and the hole it makes is a long thin slot with a knife edge each side, which
 * is a poor thing to print and a poor thing to look at. Pull the pipe in and the
 * hole shortens and fattens into a proper opening with material all round it.
 *
 * Forty degrees is a hole about half again as long as it is wide, which is about
 * as clean as it gets without pointing the feed at the middle of the bowl.
 *
 * Stated this way it also costs nothing to use: the offset it works out to is a
 * plain fraction of the bowl's radius, needing nothing about the tube the part
 * is cut from — which is what lets the centreline place the whirl on its own.
 * See {@link funnelFeedRadius}.
 */
export const FUNNEL_FEED_SKEW = 40

/**
 * The circle the marble is delivered onto, mm — where the feed's bore runs.
 *
 * Set in from the wall by the skew above: the feed's axis stands this far off
 * the bowl's, so the pipe crosses the wall at that angle rather than grazing it.
 */
export function funnelFeedRadius(f: FunnelBowl): number {
  return Math.max(f.mouthRadius, 0) * Math.sin(FUNNEL_FEED_SKEW * RAD)
}

/**
 * The least bowl a given tube can be fed into, mm across the inside.
 *
 * The feed stands {@link funnelFeedRadius} off the axis and is a whole tube
 * wide, so a bowl narrower than that has its wall broken through from the far
 * side — the pipe comes out of the back of it. The store holds every funnel to
 * this the same way it holds the feed to its reach.
 */
export function funnelMouthLeast(innerR: number, wall: number): number {
  return (2 * (innerR + wall)) / (1 - Math.sin(FUNNEL_FEED_SKEW * RAD))
}

/**
 * The whirl itself, solved once — a conical spiral about the upright, from the
 * mouth in to the throat.
 *
 * The marble arrives running round rather than in, because a pipe set square
 * across the bowl's radius can deliver it no other way, so the spiral has to set
 * off round too: its radius closes in at nought to begin with and quickens as it
 * goes, which is the whole of why the radius is squared below rather than run
 * down in a straight line. A straight-line taper would have the marble cutting
 * inward from the first millimetre, and at a quarter turn it would leave the
 * pipe pointing a good twenty degrees at the throat — which is the marble
 * dropping through the funnel rather than going round it.
 */
interface Whirl {
  /** The axis, wound so that turning about it by `phi` always goes forward. */
  axis: THREE.Vector3
  /** How far round in all, radians — always positive; `axis` carries which way. */
  angle: number
  /** Centre of the bowl, on its axis, level with the run that feeds it. */
  centre: THREE.Vector3
  /** Unit spoke, from that centre out to where the marble lands. */
  spoke: THREE.Vector3
  /** Radius at the mouth, mm. */
  r0: number
  /** How far the path drops per radian, mm. */
  fall: number
}

function solve(f: FunnelBowl): Whirl | null {
  const angle = Math.abs(f.turns) * TAU
  // The marble sets off on the feed's own circle, not on the wall — the feed is
  // set in from it. See {@link funnelFeedRadius}.
  const r0 = funnelFeedRadius(f)
  // No width to go round, or no going round at all: what is left is the straight
  // slide down the wall, which a plain funnel does instead.
  if (angle < 1e-6 || r0 < 1e-6) return null

  const hand = f.turns < 0 ? -1 : 1
  // Dead across the run, with no cant in it at all. The bowl's axis stands
  // directly off to one side of the feed, so the spoke out to where the marble
  // lands is square to the way the run is travelling and the marble sets off
  // along its circle rather than across it.
  const spoke = LOCAL_X.clone().multiplyScalar(-hand)
  const mouth = mouthPoint(f)
  return {
    axis: LOCAL_Y.clone().multiplyScalar(hand),
    angle,
    centre: mouth.addScaledVector(spoke, -r0),
    spoke,
    r0,
    fall: f.depth / angle,
  }
}

/** Where the marble is delivered onto the mouth, in the part's own frame. */
function mouthPoint(f: FunnelBowl): THREE.Vector3 {
  return new THREE.Vector3(0, 0, f.entry)
}

/**
 * Where the bowl's axis stands, for a plain funnel — dead ahead of the inlet, so
 * the marble carries on the way it was going and slides down the far wall.
 */
function slideCentre(f: FunnelBowl): THREE.Vector3 {
  return mouthPoint(f).addScaledVector(LOCAL_Z, funnelFeedRadius(f))
}

/** How wide the whirl is, `phi` radians in — see {@link Whirl}. */
function radiusAt(W: Whirl, phi: number): number {
  const t = phi / W.angle
  return W.r0 * (1 - t * t)
}

/** How fast it is closing in there, mm per radian — nought at the mouth. */
function radiusRate(W: Whirl, phi: number): number {
  return (-2 * W.r0 * phi) / (W.angle * W.angle)
}

/** Where the marble has got to, `phi` radians in. */
function pointAt(W: Whirl, phi: number): THREE.Vector3 {
  const out = W.spoke.clone().applyAxisAngle(W.axis, phi)
  return W.centre
    .clone()
    .addScaledVector(out, radiusAt(W, phi))
    .addScaledVector(LOCAL_Y, -W.fall * phi)
}

/** The throat — where the spiral lands on the axis, in the part's own frame. */
export function funnelThroat(f: FunnelBowl): THREE.Vector3 {
  const W = solve(f)
  const centre = W ? W.centre.clone() : slideCentre(f)
  return centre.addScaledVector(LOCAL_Y, -f.depth)
}

/**
 * How far the run's heading has come round by the time the marble reaches the
 * throat, degrees.
 *
 * Read off the way it was last travelling in plan rather than counted out of the
 * turns, because the two are not the same: the spiral does not leave the mouth
 * going round and arrive at the throat still going round — by the end it is
 * heading almost straight in at the axis, and that is the heading the spout
 * hands on. A plain funnel hands on nothing at all, which is exactly right for a
 * marble that went straight in.
 *
 * Whole turns fold away of their own accord, the same way they do everywhere
 * else a heading is measured: a heading is only ever known to the turn.
 */
export function funnelExitTurn(f: FunnelBowl): number {
  const W = solve(f)
  if (!W) return 0
  // At the throat the radius has gone, so all that is left of the plan heading
  // is the taper — pointing straight in at the axis.
  const now = W.spoke.clone().applyAxisAngle(W.axis, W.angle).multiplyScalar(radiusRate(W, W.angle))
  if (now.lengthSq() < 1e-12) return 0
  // Measured off local +Z about local +Y, which is all the general form comes to
  // once the part is known to be level.
  return Math.atan2(now.x, now.z) / RAD
}

/** How finely the whirl is integrated for its length. Simpson, so even. */
const ARC_STEPS = 512

/** Centreline length of the whole part, mm — both stubs and the whirl between. */
export function funnelLength(f: FunnelBowl): number {
  const W = solve(f)
  // Straight down the wall: one chord, as long as the wall is steep.
  if (!W) return f.entry + Math.hypot(funnelFeedRadius(f), f.depth) + f.exit
  // The squared taper puts the arc past anything with a closed form, so it is
  // integrated instead — Simpson over a smooth, well behaved integrand, which
  // lands well inside the millimetre this is ever read to.
  const speed = (phi: number) => Math.hypot(radiusRate(W, phi), radiusAt(W, phi), W.fall)
  const h = W.angle / ARC_STEPS
  let sum = speed(0) + speed(W.angle)
  for (let i = 1; i < ARC_STEPS; i++) sum += speed(i * h) * (i % 2 ? 4 : 2)
  return f.entry + (sum * h) / 3 + f.exit
}

/** How far the outlet sits below the inlet, mm — the bowl, and the spout under it. */
export function funnelFall(f: FunnelBowl): number {
  return f.depth + f.exit
}

/**
 * The bowl as a solid rather than as a path: where its axis stands, and the
 * radii and heights its surface of revolution is drawn from. All of it is
 * measured off the tube the part is cut from, which is why it is worked out here
 * rather than carried in {@link FunnelBowl} — the same funnel cut from fatter
 * tube is a slightly different bowl.
 *
 * Heights run downward from the run's own level, which is where the feed pipe
 * sits and where the marble is let go.
 */
export interface FunnelShell {
  /** Where the axis stands, level with the run that feeds it. */
  centre: THREE.Vector3
  /** Inner radius of the mouth — the collar the marble whirls against. */
  mouthR: number
  /** Inner radius of the throat — the bore the spout carries on with. */
  throatR: number
  /**
   * How far the collar's top edge stands above the run's own level, mm.
   *
   * This is also the feed pipe's outer radius, and the two are equal for a
   * reason rather than by luck: the pipe's bore is centred on the run and its
   * crown is set to graze the rim. So the rim stands a bore and a wall over the
   * run, which is exactly how thick half a pipe is.
   */
  crown: number
  /**
   * How far below the crown the collar's crown band reaches, mm — the band the
   * feed pipe is let through, and so exactly as deep as the pipe is thick.
   */
  sill: number
  /** Height of the straight collar in all, crown down to the cone, mm. */
  rim: number
  /** Drop of the cone under the collar, mm. */
  cone: number
  /**
   * How far out the *cone's* outer surface is offset from its inner one, mm.
   *
   * Radially, not squarely, so a sloping cone keeps its wall thickness — which
   * makes this more than the wall, and a great deal more on a bowl that gathers
   * in steeply. The collar above it is upright, where radially and squarely are
   * the same thing, so that is walled at the plain {@link FunnelShell.wall} and
   * the outside runs out from one to the other over the straight of the collar.
   *
   * Which is what keeps the wall the feed goes through an honest thickness: a
   * collar carrying the cone's offset instead would be two centimetres thick on
   * a steep bowl, and the feed would be tunnelling rather than passing through.
   */
  offset: number
  /** The plain wall the collar and the feed pipe are both built to, mm. */
  wall: number
}

export function funnelShell(f: FunnelBowl, innerR: number, wall: number): FunnelShell {
  const W = solve(f)
  const centre = W ? W.centre.clone() : slideCentre(f)
  const depth = Math.max(0, f.depth)
  const mouthR = Math.max(f.mouthRadius, 0)

  // Half a box: a bore and a wall. See {@link FunnelShell.crown}.
  const crown = innerR + wall
  // ...and the band that holds the box is the whole box, top to bottom.
  const sill = 2 * crown
  // Crown, collar and cone share out the depth exactly, so the throat the bowl
  // is built down to is the throat the path arrives at. The cone is what
  // actually gathers the marble in, so it is the one kept back when a shallow
  // bowl runs out of room.
  const rim = Math.min(Math.max(f.rim, sill), Math.max(sill, depth + crown - FUNNEL_LEAST_CONE))
  const cone = Math.max(depth + crown - rim, 1e-3)
  const offset = wall * Math.hypot(1, (mouthR - innerR) / cone)

  return { centre, mouthR, throatR: innerR, crown, sill, rim, cone, offset, wall }
}

/**
 * The least feed pipe a funnel can be built with, mm — how far it has to run
 * for its outer end to be clear of the bowl.
 *
 * A shorter one has its socket buried in the collar, where the marble would
 * arrive at a joint half swallowed by the bowl it is feeding. So the pipe is
 * held to this, and its end face stands proud.
 *
 * Solved rather than searched. The pipe runs in parallel to nothing and square
 * to nothing, but its near flank — the one that meets the bowl first — stands a
 * fixed distance across from the bowl's axis, and a right angle on that distance
 * and the bowl's radius gives how far along the pipe the two meet.
 *
 * Held clear of the socket besides, because a pipe cut back into its own socket
 * is worse than one that stands a little proud — see the cut in
 * `feedTubeGeometry`.
 */
export function funnelReach(f: FunnelBowl, innerR: number, wall: number): number {
  if (!f.lead) return 0
  const shell = funnelShell(f, innerR, wall)
  // How far the pipe's near flank — the one that meets the bowl first — stands
  // across from the bowl's axis. Everything below is Pythagoras on that.
  const across = Math.abs(funnelFeedRadius(f) - shell.crown)
  // Far enough for the end face to be clear of the collar altogether...
  const clear = Math.sqrt(Math.max(0, (shell.mouthR + shell.wall) ** 2 - across ** 2))
  // ...and far enough that the cut against the bowl's wall — which bites first
  // on that same flank — lands past the socket rather than in it.
  const socket = FUNNEL_SOCKET_KEEP + Math.sqrt(Math.max(0, shell.mouthR ** 2 - across ** 2))
  return Math.max(clear, socket)
}

/**
 * The part's centreline, chopped into chords no longer than `step` degrees of
 * turn, with the way up named at each one.
 *
 * The way up is dead up all the way round, which is the whole trick of a spiral
 * about a vertical axis — and the same reason a corkscrew needs no unwinding at
 * its outlet. The spout is the exception: it runs dead vertical, where there is
 * no up left to name and the section is squared off against the heading instead,
 * which is the frame the part hanging under it will be stood in.
 */
export function funnelPath(f: FunnelBowl, step: number, least: number) {
  // With no feed pipe the mouth is the inlet, so the part starts there and there
  // is no stub to draw — one point, not two on top of one another.
  const points = f.entry > 0 ? [new THREE.Vector3(), mouthPoint(f)] : [mouthPoint(f)]
  // The pipe is a length of level track like any other, so its up is the frame's:
  // that is the way its bore faces, and the way the part before it left off.
  const ups = f.entry > 0 ? [LOCAL_Y.clone()] : []
  const W = solve(f)

  if (!W) {
    points.push(funnelThroat(f))
    ups.push(LOCAL_Y.clone())
  } else {
    const chords = Math.max(least, Math.ceil(W.angle / RAD / step))
    for (let i = 1; i <= chords; i++) {
      points.push(pointAt(W, (W.angle * i) / chords))
      ups.push(LOCAL_Y.clone())
    }
  }

  const throat = points[points.length - 1]
  points.push(throat.clone().addScaledVector(LOCAL_Y, -f.exit))
  ups.push(funnelSpoutUp(f))
  return { points, ups }
}

/**
 * Which way the spout's opening faces, in the part's own frame — along the
 * heading the funnel hands on, which is where a part stood up dead vertical
 * carries its own opening. Getting this right is what lets the next part down
 * mate with the spout rather than meet it rolled over.
 */
export function funnelSpoutUp(f: FunnelBowl): THREE.Vector3 {
  return LOCAL_Z.clone().applyAxisAngle(LOCAL_Y, funnelExitTurn(f) * RAD)
}
