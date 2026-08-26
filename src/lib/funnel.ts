import * as THREE from 'three'

/**
 * The geometry of a funnel, worked out in the part's own frame: it starts at the
 * origin heading down +Z, +Y is up (the opening side), and it states the fall it
 * runs at rather than taking one.
 *
 * That is the one thing to know about this part. Every other part takes whatever
 * fall the run hands it; a funnel cannot, because a bowl is only a bowl while it
 * is level. What it states is {@link FunnelBowl.tilt}: how steeply the lead-in
 * falls into the mouth, which is nought for a feed that runs in dead level and a
 * few degrees for one that runs downhill into it. The run has to come to that
 * figure, exactly as a corkscrew's coil states the fall its rings leave it at.
 *
 * The bowl itself is level whatever the lead-in does. The part's frame is tipped
 * by the tilt along with the rest of the run, so the bowl is built about
 * {@link funnelUp} — the way up in that tipped frame — rather than about the
 * frame's own +Y, and the mouth is spanned by {@link funnelForward} and local +X.
 * Level in the world is what those two mean; a funnel drawn against the frame
 * instead would tip its bowl with the feed and pour the marble out of the low
 * side.
 *
 * The tilt is held to a few degrees for a plain reason: the lead-in is let
 * through a hole in the collar, and a tube tipped far enough rises out of that
 * hole as it goes back, leaving a spout hanging over the bowl attached to
 * nothing. See {@link FUNNEL_TILT_LIMIT}.
 *
 * What happens inside is a conical spiral: the marble is delivered onto the
 * mouth travelling the way the run was already travelling, whirls round the
 * inside of the bowl, and closes in on the throat as it drops — the path of a
 * marble held out against the wall by its own speed. Wind it no times round at
 * all and the same spiral straightens into one slide down the wall, which is
 * what a marble dropped into a funnel does. The two are the same shape with the
 * turns wound out of it, not two parts.
 *
 * It leaves down the throat, dead vertical, because that is the only way out of
 * a funnel.
 *
 * This is plain numbers in and plain numbers out, so the store — which works out
 * where the run goes next — the centreline — which draws the path — and the
 * solid — which draws the bowl — can all read from it without any of them having
 * to know about the others.
 */
export interface FunnelBowl {
  /**
   * Rigid lead-in up to the mouth, mm — measured along the tube, whatever it
   * falls at. Nought on a funnel built without one — see {@link FunnelBowl.lead}.
   */
  entry: number
  /**
   * How steeply that lead-in falls into the mouth, degrees. Nought runs it in
   * level; a few degrees runs it downhill, and the whole part — bowl and all —
   * is stood up at that fall by the run. The bowl stays level regardless.
   */
  tilt: number
  /**
   * Radius the marble is delivered onto the mouth at, mm — measured across the
   * centreline, the way a corkscrew's widths are, so the bowl's own wall stands
   * one bore further out than this.
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
   * It is never shorter than the lead-in is tall: the tube's opening is a hole
   * cut through this band, and a band too short to hold that hole would let the
   * marble out under the tube instead of round it.
   */
  rim: number
  /**
   * How many times round the marble goes between the two. The sign picks which
   * way it whirls; nought is the marble dropped in rather than fed round, and
   * slides straight down the wall.
   */
  turns: number
  /** Straight drop out of the throat, mm. */
  exit: number
  /**
   * Whether the mouth is fed by a lead-in of its own.
   *
   * Without one the part is a bare bowl and the mouth is its inlet: something
   * else is stood over it and the marble is let go into it. The whirl needs the
   * lead-in — it is the tube's opening through the collar that sets the marble
   * off round the wall rather than into the middle — so a bowl with no lead-in
   * is a catch, whatever it is asked to do with its turns.
   */
  lead: boolean
}

const RAD = Math.PI / 180
const TAU = Math.PI * 2
const LOCAL_X = new THREE.Vector3(1, 0, 0)
const LOCAL_Y = new THREE.Vector3(0, 1, 0)

/**
 * The least cone the bowl is left with under its collar, mm. A collar taken
 * right down to the throat would be a straight cup with nothing to gather the
 * marble in, so the last of the depth is always cone.
 */
export const FUNNEL_LEAST_CONE = 8

/**
 * How far a lead-in may be tipped downhill, degrees.
 *
 * The tube is let through a hole in the collar and grown into its sides, and
 * that is the whole of what holds it on. Tipped, it rises out of that hole as it
 * goes back: gently, it is still buried in the band where it matters — at the
 * mouth, where it is lowest — and past this it is a spout leaning over the bowl
 * on the strength of its last few millimetres.
 */
export const FUNNEL_TILT_LIMIT = 15

/**
 * Which way is up in the part's own frame — the frame is tipped by the tilt, so
 * the bowl has to be built about this rather than about the frame's own +Y.
 */
export function funnelUp(tilt: number): THREE.Vector3 {
  const t = tilt * RAD
  return new THREE.Vector3(0, Math.cos(t), -Math.sin(t))
}

/**
 * The way the run is travelling in plan, in the part's own frame: local +Z with
 * the fall taken out of it. This and local +X — which the layout always stands
 * level — span the mouth, and every plan measurement about the bowl is taken on
 * those two.
 */
export function funnelForward(tilt: number): THREE.Vector3 {
  const t = tilt * RAD
  return new THREE.Vector3(0, Math.sin(t), Math.cos(t))
}

/** The way out of a funnel: straight down, whatever it did on the way round. */
export const FUNNEL_EXIT_SLOPE = 90

/**
 * The whirl itself, solved once — a conical spiral about the upright, from the
 * mouth in to the throat.
 *
 * The radius closes in at a steady rate per radian and the drop keeps pace with
 * it, which is what puts the path on a straight-sided cone: at a given depth the
 * marble is always the same distance in from the wall. Where the whirl sets off
 * from is not a free choice — the run comes in along local +Z, so the spoke has
 * to be canted off dead-across by exactly as much as the taper pulls the path
 * inward, or the marble would arrive at the mouth sideways.
 *
 * That cant is also what makes one part of two. Wound many times, the taper is
 * gentle and the spoke lies dead across the run: the bowl sits beside the feed
 * and the marble goes round it. Wound not at all, the taper is everything and
 * the spoke lies along the run: the bowl sits ahead of the feed and the marble
 * goes straight into it. Everything between is the same formula.
 */
interface Whirl {
  /** The axis, wound so that turning about it by `phi` always goes forward. */
  axis: THREE.Vector3
  /** The upright the bowl is built about — the axis with its hand taken back off. */
  up: THREE.Vector3
  /** The level heading the mouth is measured from. */
  forward: THREE.Vector3
  /** How far round in all, radians — always positive; `axis` carries which way. */
  angle: number
  /** Centre of the bowl, on its axis, level with the run that feeds it. */
  centre: THREE.Vector3
  /** Unit spoke, from that centre out to where the marble lands. */
  spoke: THREE.Vector3
  /** Radius at the mouth, mm, and how fast it closes in, mm per radian. */
  r0: number
  k: number
  /** How far the path drops per radian, mm. */
  fall: number
}

function solve(f: FunnelBowl): Whirl | null {
  const angle = Math.abs(f.turns) * TAU
  const r0 = Math.max(f.mouthRadius, 0)
  // No width to go round, or no going round at all: what is left is the straight
  // slide down the wall, which {@link slide} draws instead.
  if (angle < 1e-6 || r0 < 1e-6) return null

  const hand = f.turns < 0 ? -1 : 1
  // The path closes right in on the throat, so the taper is the whole radius
  // spread over the whole turn.
  const k = -r0 / angle
  const rho = Math.hypot(k, r0)
  const up = funnelUp(f.tilt)
  const forward = funnelForward(f.tilt)
  // Local +X is the level axis across the run — the layout stands every part up
  // with its X level — so this pair spans the mouth's plane.
  const spoke = forward
    .clone()
    .multiplyScalar(k / rho)
    .addScaledVector(LOCAL_X, (-hand * r0) / rho)

  const mouth = mouthPoint(f)
  return {
    axis: up.clone().multiplyScalar(hand),
    up,
    forward,
    angle,
    centre: mouth.addScaledVector(spoke, -r0),
    spoke,
    r0,
    k,
    fall: f.depth / angle,
  }
}

/** Where the marble is delivered onto the mouth, in the part's own frame. */
function mouthPoint(f: FunnelBowl): THREE.Vector3 {
  return new THREE.Vector3(0, 0, f.entry)
}

/**
 * Where the bowl's axis stands, for a funnel with no whirl in it — dead ahead of
 * the feed, so the marble carries on the way it was going and slides down the
 * far wall. This is what {@link solve}'s canted spoke settles on as the turns
 * are wound out of it, written out on its own because the spiral itself has
 * nothing left to solve at that point.
 *
 * Dead ahead in plan, not along the tube: a tipped feed is still pointed at the
 * far wall, and the bowl it drops into stands upright under that heading.
 */
function slideCentre(f: FunnelBowl): THREE.Vector3 {
  return mouthPoint(f).addScaledVector(funnelForward(f.tilt), Math.max(f.mouthRadius, 0))
}

/** How wide the whirl is, `phi` radians in. */
function radiusAt(W: Whirl, phi: number): number {
  return W.r0 + W.k * phi
}

/** Where the marble has got to, `phi` radians in. */
function pointAt(W: Whirl, phi: number): THREE.Vector3 {
  const out = W.spoke.clone().applyAxisAngle(W.axis, phi)
  return W.centre
    .clone()
    .addScaledVector(out, radiusAt(W, phi))
    .addScaledVector(W.up, -W.fall * phi)
}

/** The throat — where the spiral lands on the axis, in the part's own frame. */
export function funnelThroat(f: FunnelBowl): THREE.Vector3 {
  const W = solve(f)
  const centre = W ? W.centre.clone() : slideCentre(f)
  return centre.addScaledVector(funnelUp(f.tilt), -f.depth)
}

/**
 * How far the run's heading has come round by the time the marble reaches the
 * throat, degrees.
 *
 * Read off the way it was last travelling in plan rather than counted out of the
 * turns, because the two are not the same: the spiral does not leave the mouth
 * going round and arrive at the throat still going round — by the end it is
 * heading almost straight in at the axis, and that is the heading the spout
 * hands on. A funnel with no whirl in it hands on nothing at all, which is
 * exactly right for a marble that went straight in.
 *
 * Whole turns fold away of their own accord, the same way they do everywhere
 * else a heading is measured: a heading is only ever known to the turn.
 */
export function funnelExitTurn(f: FunnelBowl): number {
  const W = solve(f)
  if (!W) return 0
  // At the throat the radius has gone, so all that is left of the plan heading
  // is the taper — pointing straight in at the axis.
  const now = W.spoke.clone().applyAxisAngle(W.axis, W.angle).multiplyScalar(W.k)
  if (now.lengthSq() < 1e-12) return 0
  return (
    Math.atan2(
      new THREE.Vector3().crossVectors(W.forward, now).dot(W.up),
      W.forward.dot(now),
    ) / RAD
  )
}

/**
 * Antiderivative of √(a² + r²) — how much line a spiral lays down as its radius
 * runs from one figure to another, with the drop already folded into `a`.
 */
function arcTo(r: number, a: number): number {
  const h = Math.hypot(a, r)
  return (r * h + a * a * Math.log(r + h)) / 2
}

/** Centreline length of the whole part, mm — both stubs and the whirl between. */
export function funnelLength(f: FunnelBowl): number {
  const W = solve(f)
  // Straight down the wall: one chord, as long as the wall is steep.
  if (!W) return f.entry + Math.hypot(Math.max(f.mouthRadius, 0), f.depth) + f.exit
  // Closing in and dropping at steady rates per radian, so both fold into one
  // constant and the spiral integrates exactly rather than chord by chord.
  const a = Math.hypot(W.k, W.fall)
  return f.entry + (arcTo(0, a) - arcTo(W.r0, a)) / W.k + f.exit
}

/**
 * How far the outlet sits below the inlet, mm — the lead-in's own fall, then the
 * bowl and the spout under it. A funnel fed level drops nothing before the mouth
 * and this is the bowl and the spout alone.
 */
export function funnelFall(f: FunnelBowl): number {
  return f.entry * Math.sin(f.tilt * RAD) + f.depth + f.exit
}

/**
 * The bowl as a solid rather than as a path: where its axis stands, and the
 * radii and heights its surface of revolution is drawn from. All of it is
 * measured off the tube the part is cut from, which is why it is worked out here
 * rather than carried in {@link FunnelBowl} — the same funnel cut from fatter
 * tube is a slightly different bowl.
 *
 * Heights run downward from the run's own level, which is where the feed tube
 * sits and where the marble is let go.
 */
export interface FunnelShell {
  /** Where the axis stands, level with the run that feeds it. */
  centre: THREE.Vector3
  /** Inner radius of the mouth — the collar the marble whirls against. */
  mouthR: number
  /** Inner radius of the throat — the bore the spout carries on with. */
  throatR: number
  /** How far the collar's top edge stands above the run's own level, mm. */
  crown: number
  /**
   * How far below that the collar's crown band reaches, mm — the band the
   * lead-in is grown into.
   *
   * It stops half a wall short of the underside of the tube, so the tube's lower
   * wall is buried in the bowl under it and its bore is left that same half-wall
   * clear of the join.
   */
  sill: number
  /** Height of the straight collar in all, crown down to the cone, mm. */
  rim: number
  /** Drop of the cone under the collar, mm. */
  cone: number
  /** How far out the outer surface is offset from the inner one, mm. */
  offset: number
  /**
   * The arc the crown band is actually spun through: where it starts and how far
   * it goes, radians about the axis. Null on a bowl with no lead-in to make room
   * for, where the band goes right round like everything else.
   *
   * What is left out is the lead-in's *bore* and nothing besides — not the tube.
   * The two solids are laid together rather than cut against one another, so the
   * band is free to run straight through the tube's wall and does: it closes on
   * the bore from every side, and the only daylight in the rim is the opening
   * the marble actually comes out of. Cutting the tube's whole width away
   * instead — which is what this used to do — left the rim notched wider than
   * the tube wherever it crossed obliquely, and the tube read as a separate
   * thing dropped into the gap.
   */
  gate: { from: number; sweep: number } | null
}

/** How finely the lead-in's opening is felt for round the collar. */
const GATE_STEPS = 1440

/**
 * The arc of collar left standing once the lead-in's bore has been let through
 * it — or null when there is nothing to let through.
 *
 * Worked out by feeling round the collar rather than by trigonometry, because
 * what has to be left out depends on how obliquely the tube crosses the band,
 * and that runs from very nearly square — a marble dropped straight in, needing
 * barely more than a round hole — to very nearly tangent, where the bore lies
 * along the wall for a good part of a quadrant and the opening is a long slot.
 * Both are the same question: at this angle, is there bore where the collar
 * wants to be?
 */
function gateFor(
  f: FunnelBowl,
  centre: THREE.Vector3,
  band: [number, number],
  bore: number,
): { from: number; sweep: number } | null {
  if (!f.lead || f.entry <= 0) return null
  const [inner, outer] = band
  const forward = funnelForward(f.tilt)
  // How far the lead-in reaches in plan. Tipped, it covers less ground than its
  // own length, and the hole it needs is the shorter one it actually crosses.
  const run = f.entry * Math.cos(f.tilt * RAD)
  const blocked: boolean[] = []
  for (let i = 0; i < GATE_STEPS; i++) {
    const a = (TAU * i) / GATE_STEPS
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    let hit = false
    // Across the band as well as round it: a bore crossing obliquely can be past
    // the outside of the collar while the inside is still clear of it.
    for (let j = 0; j <= 3 && !hit; j++) {
      const r = inner + ((outer - inner) * j) / 3
      const p = centre
        .clone()
        .addScaledVector(LOCAL_X, r * ca)
        .addScaledVector(forward, r * sa)
      // The lead-in runs from the origin along the heading, so in plan its bore
      // is simply a strip — which makes the test two comparisons, taken on the
      // mouth's own pair of axes rather than on the tipped frame's.
      const across = p.dot(LOCAL_X)
      const along = p.dot(forward)
      hit = Math.abs(across) <= bore && along >= -1e-6 && along <= run + 1e-6
    }
    blocked.push(hit)
  }
  if (!blocked.some(Boolean)) return null
  if (blocked.every(Boolean)) return { from: 0, sweep: 0 }

  // The longest unbroken stretch of collar is the collar; whatever is left is
  // the opening. Walked twice round so a stretch straddling the seam is found
  // whole rather than as two short ones.
  let best = { at: 0, run: 0 }
  let run2 = 0
  for (let i = 0; i < GATE_STEPS * 2; i++) {
    if (blocked[i % GATE_STEPS]) {
      run2 = 0
      continue
    }
    run2++
    if (run2 > best.run) best = { at: i - run2 + 1, run: run2 }
  }
  const step = TAU / GATE_STEPS
  return { from: best.at * step, sweep: Math.min(best.run, GATE_STEPS) * step }
}

export function funnelShell(f: FunnelBowl, innerR: number, wall: number): FunnelShell {
  const W = solve(f)
  const centre = W ? W.centre.clone() : slideCentre(f)
  const depth = Math.max(0, f.depth)
  const outerR = innerR + wall
  // The mouth is the bowl's own opening, and the marble is delivered onto that
  // wall rather than a bore's width inside it. That is what puts the lead-in
  // *outside* the bowl: the tube runs tangent to the wall and only breaks
  // through where it meets it, instead of crossing the rim early and hanging
  // over the middle for most of its length.
  const mouthR = Math.max(f.mouthRadius, 0)

  // The collar stands a wall's thickness proud of the lead-in, so there is a
  // rim of bowl over the opening rather than a lip flush with it — the tube
  // comes in through the wall, and the mouth stays a whole ring above it.
  const crown = outerR + wall
  // ...and the band it is let into reaches half a wall past its underside.
  const sill = crown + outerR - wall / 2
  // Crown, collar and cone share out the depth exactly, so the throat the bowl
  // is built down to is the throat the path arrives at. The cone is what
  // actually gathers the marble in, so it is the one kept back when a shallow
  // bowl runs out of room.
  const rim = Math.min(Math.max(f.rim, sill), Math.max(sill, depth + crown - FUNNEL_LEAST_CONE))
  const cone = Math.max(depth + crown - rim, 1e-3)
  // The outer surface is the inner one pushed out radially, not vertically, so
  // the wall stands the same thickness all the way down a sloping cone.
  const offset = wall * Math.hypot(1, (mouthR - innerR) / cone)

  return {
    centre,
    mouthR,
    throatR: innerR,
    crown,
    sill,
    rim,
    cone,
    offset,
    gate: gateFor(f, centre, [mouthR, mouthR + offset], innerR),
  }
}

/**
 * The least the feed stub may be, mm — how far it has to run to reach the
 * outside of the collar.
 *
 * A shorter one stops inside the bowl, where there is nothing under it: the tube
 * would be a spout hanging in mid-air, joined to the part it is printed with
 * only where it happens to graze the rim. So the stub is held to this, and the
 * part stays one piece. Fed straight in, it is barely a wall's worth; fed right
 * round, the tube comes in along the tangent and has most of the mouth to cross
 * before it is over anything.
 */
export function funnelReach(f: FunnelBowl, innerR: number, wall: number): number {
  const shell = funnelShell(f, innerR, wall)
  const W = solve(f)
  const r0 = Math.max(f.mouthRadius, 0)
  const out = shell.mouthR + shell.offset
  if (out <= 0) return 0
  // How much of the spoke lies along the run — a tangential feed has none of it,
  // a straight-in feed is all of it and pointing back the other way.
  const along = W ? W.spoke.dot(W.forward) : -1
  // Walking back down the stub from the mouth until the collar is underneath it.
  const reach = r0 * along + Math.sqrt(Math.max(0, r0 * r0 * along * along + out * out - r0 * r0))
  // That much ground covered, and a tipped stub covers ground more slowly than
  // it runs — so it has that much further to run to be over the same collar.
  return Math.max(0, reach / Math.cos(f.tilt * RAD))
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
  // With no lead-in the mouth is the inlet, so the part starts there and there
  // is no stub to draw — one point, not two on top of one another.
  const points = f.entry > 0 ? [new THREE.Vector3(), mouthPoint(f)] : [mouthPoint(f)]
  // The lead-in is a length of tube like any other, so its up is the frame's:
  // that is the way its opening faces, and the way the part before it left off.
  const ups = f.entry > 0 ? [LOCAL_Y.clone()] : []
  const up = funnelUp(f.tilt)
  const W = solve(f)

  if (!W) {
    points.push(funnelThroat(f))
    ups.push(up.clone())
  } else {
    const chords = Math.max(least, Math.ceil(W.angle / RAD / step))
    for (let i = 1; i <= chords; i++) {
      points.push(pointAt(W, (W.angle * i) / chords))
      ups.push(up.clone())
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
  return funnelForward(f.tilt).applyAxisAngle(funnelUp(f.tilt), funnelExitTurn(f) * RAD)
}

