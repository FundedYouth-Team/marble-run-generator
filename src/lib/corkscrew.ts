import * as THREE from 'three'
// The upright is the same idea a hook turns about — world up, written in the
// part's own tilted frame — so it is read from there rather than restated.
import { upright } from './hook'

/**
 * The geometry of a corkscrew, worked out in the part's own frame: it starts at
 * the origin heading down +Z, +Y is up (the opening side).
 *
 * A corkscrew is a coil about a dead vertical axis, wound from one width at the
 * top to another at the bottom over a given number of rings, losing a given
 * height on the way. Those four numbers are the part, and everything else about
 * it follows — including, unusually, the fall it runs at: a coil of a known
 * width and a known number of rings has a known length in plan, and dropping a
 * known height over that length leaves exactly one angle it can run at.
 *
 * That is the other way round from every other part, where the run says what
 * fall a part sits at and the part takes it. Here the part says it, and the run
 * has to meet it — which is only what a printed helix really is.
 *
 * This is plain numbers in and plain numbers out, so the store — which works
 * out where the run goes next — and the centreline — which draws the tube — can
 * both read from it without either having to know about the other.
 */
export interface CorkscrewCoil {
  /** Rigid stub up to the coil, mm. */
  entry: number
  /** Radius where the run comes in, mm. */
  topRadius: number
  /** Radius where the run leaves, mm. */
  bottomRadius: number
  /**
   * How many times round, between the two. The sign picks which way it winds.
   *
   * Given to the coil rather than chosen by it: the store counts the rings off
   * the room the height leaves them and the tube they are cut from — neither of
   * which this module has any business knowing about — and hands the answer
   * down here.
   */
  turns: number
  /**
   * How far the coil itself drops, top to bottom, mm. The stubs are extra.
   *
   * Signed: negative is a coil that climbs. Nobody asks for one of those, but a
   * run turned end for end is full of them — travel a descending coil backwards
   * and it is a climbing one, which is the only way the part can describe
   * itself from its far end.
   */
  height: number
  /** Stub past the coil, mm. */
  exit: number
}

const RAD = Math.PI / 180
const TAU = Math.PI * 2
const LOCAL_Y = new THREE.Vector3(0, 1, 0)
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

/**
 * Antiderivative of √(k² + r²) — how much line a spiral lays down as its radius
 * runs from one figure to another.
 */
function spiralArc(r: number, k: number): number {
  const h = Math.hypot(k, r)
  return (r * h + k * k * Math.log(r + h)) / 2
}

/**
 * How long the coil is seen from above, mm — the spiral drawn in plan, with the
 * drop taken out of it.
 *
 * A coil of one width is a circle repeated, and its plan length is the obvious
 * one. A coil that narrows as it goes is an Archimedean spiral instead, and
 * closes in a little on every ring, so it is a touch shorter than the average
 * of the two circles: this is that difference, taken exactly rather than
 * averaged, because the fall the part runs at is read straight off it.
 */
export function coilPlanLength(c: CorkscrewCoil): number {
  const angle = Math.abs(c.turns) * TAU
  const r0 = Math.max(c.topRadius, 0)
  const r1 = Math.max(c.bottomRadius, 0)
  if (angle < 1e-9) return 0
  const k = (r1 - r0) / angle
  // Straight-sided: no taper to integrate, so it is circles all the way down.
  if (Math.abs(k) < 1e-9) return r0 * angle
  return (spiralArc(r1, k) - spiralArc(r0, k)) / k
}

/**
 * The fall the coil runs at, degrees — the one angle it can run at, given how
 * far it goes round and how far it drops doing it.
 *
 * It is the same the whole way down. A cone narrows as it descends, so holding
 * one fall means the coils bunch up towards the tight end rather than sitting
 * at even heights — which is what keeps the marble on one steady pitch instead
 * of running out of slope where the coil is widest.
 *
 * Negative on a coil that climbs, which is what a descending one becomes when
 * the run it is in is turned end for end.
 */
export function corkscrewSlope(c: CorkscrewCoil): number {
  const plan = coilPlanLength(c)
  // Nothing to wind round: what is left is one straight length of tube.
  if (plan < 1e-6) return 0
  return Math.atan2(c.height, plan) / RAD
}

/**
 * How far apart the rings sit, mm — bare height per turn, before the tube. A
 * climbing coil stacks its rings exactly as a falling one does, so this is the
 * distance either way round.
 */
export function coilRingPitch(c: CorkscrewCoil): number {
  const turns = Math.abs(c.turns)
  return turns < 1e-9 ? 0 : Math.abs(c.height) / turns
}

/**
 * The coil itself, solved once — a conical helix about the upright.
 *
 * The radius closes in at a steady rate per radian and the drop keeps pace with
 * the plan length rather than with the angle, which is what holds the fall
 * even. Where the coil sets off from is not a free choice: the run comes in
 * along local +Z, so the spoke has to be canted off dead-across by exactly as
 * much as the taper pulls the coil inward, or the part would start with a kink
 * in it.
 */
interface Coiled {
  /** Dead up in the part's own frame — the axis the coil winds about. */
  up: THREE.Vector3
  /** The same axis, wound so that turning about it by `phi` always goes forward. */
  axis: THREE.Vector3
  /** How far round in all, radians — always positive; `axis` carries which way. */
  angle: number
  /** Centre of the coil, on its axis, level with where it starts. */
  centre: THREE.Vector3
  /** Unit spoke, from that centre out to where the coil starts. */
  spoke: THREE.Vector3
  /** Radius at the top, mm, and how fast it closes in, mm per radian. */
  r0: number
  k: number
  /** How far the coil drops per mm of plan length. */
  fall: number
  /** The fall it runs at, degrees. */
  slope: number
}

function solve(c: CorkscrewCoil): Coiled | null {
  const angle = Math.abs(c.turns) * TAU
  const plan = coilPlanLength(c)
  if (angle < 1e-6 || plan < 1e-6) return null

  const r0 = c.topRadius
  const k = (c.bottomRadius - r0) / angle
  const slope = Math.atan2(c.height, plan) / RAD
  const up = upright(slope)
  const hand = c.turns < 0 ? -1 : 1

  // The run laid flat against the axis: the way the coil travels in plan where
  // it starts. Winding dead up its own axis, a coil has nothing to go round.
  const across = LOCAL_Z.clone().addScaledVector(up, -up.dot(LOCAL_Z))
  const reach = across.length()
  if (reach < 1e-6) return null
  across.divideScalar(reach)

  // Square off that heading against the axis, and the coil's plane is spanned.
  const side = new THREE.Vector3().crossVectors(up, across)
  // Where the spoke has to point for the coil to set off along the run. On a
  // coil of one width that is dead across it; a taper drags the start inward as
  // well, so the spoke leans forward by as much as the taper pulls.
  const rho = Math.hypot(k, r0)
  const spoke = across
    .clone()
    .multiplyScalar(k / rho)
    .addScaledVector(side, (-hand * r0) / rho)

  const start = new THREE.Vector3(0, 0, c.entry)
  return {
    up,
    axis: up.clone().multiplyScalar(hand),
    angle,
    centre: start.addScaledVector(spoke, -r0),
    spoke,
    r0,
    k,
    fall: c.height / plan,
    slope,
  }
}

/** How wide the coil is, `phi` radians in. */
function radiusAt(C: Coiled, phi: number): number {
  return C.r0 + C.k * phi
}

/** How much plan length the coil has laid down, `phi` radians in. */
function planAt(C: Coiled, phi: number): number {
  if (Math.abs(C.k) < 1e-9) return C.r0 * phi
  return (spiralArc(radiusAt(C, phi), C.k) - spiralArc(C.r0, C.k)) / C.k
}

/** Where the coil has got to, `phi` radians in. */
function pointAt(C: Coiled, phi: number): THREE.Vector3 {
  const out = C.spoke.clone().applyAxisAngle(C.axis, phi)
  return C.centre
    .clone()
    .addScaledVector(out, radiusAt(C, phi))
    .addScaledVector(C.up, -C.fall * planAt(C, phi))
}

/** Which way the run is heading, `phi` radians into the coil. */
function dirAt(C: Coiled, phi: number): THREE.Vector3 {
  const out = C.spoke.clone().applyAxisAngle(C.axis, phi)
  const round = new THREE.Vector3().crossVectors(C.axis, out)
  const r = radiusAt(C, phi)
  // In plan the coil both goes round and closes in; the drop keeps pace with
  // however much line those two lay down together.
  const rho = Math.hypot(C.k, r)
  return new THREE.Vector3()
    .addScaledVector(out, C.k)
    .addScaledVector(round, r)
    .addScaledVector(C.up, -C.fall * rho)
    .normalize()
}

/** Which way the run leaves, in the part's own frame. */
export function corkscrewExitDir(c: CorkscrewCoil): THREE.Vector3 {
  const C = solve(c)
  return C ? dirAt(C, C.angle) : LOCAL_Z.clone()
}

/**
 * What the run is doing as it leaves: the fall it is on, and how far its
 * heading has come round — the two numbers the rest of the app lays the next
 * part down with.
 *
 * The fall is the one the coil runs at throughout, so a corkscrew hands on
 * exactly what it takes. The heading is very nearly the rings turned into
 * degrees, and only *nearly*: a tapered coil leaves a little off that, because
 * the spiral meets its own radius at a different angle at each end.
 */
export function corkscrewExit(c: CorkscrewCoil): { slope: number; turn: number } {
  const C = solve(c)
  if (!C) return { slope: 0, turn: 0 }
  const dir = dirAt(C, C.angle)
  // Heading is measured about the upright, so both directions are laid flat
  // against it first.
  const flat = (v: THREE.Vector3) => v.clone().addScaledVector(C.up, -v.dot(C.up))
  const was = flat(LOCAL_Z)
  const now = flat(dir)
  if (was.lengthSq() < 1e-12 || now.lengthSq() < 1e-12) return { slope: C.slope, turn: 0 }
  const turn = Math.atan2(new THREE.Vector3().crossVectors(was, now).dot(C.up), was.dot(now))
  return { slope: C.slope, turn: turn / RAD }
}

/** Where the run has got to by the time it leaves, in the part's own frame. */
function endPoint(c: CorkscrewCoil): THREE.Vector3 {
  const C = solve(c)
  if (!C) return new THREE.Vector3(0, 0, c.entry + c.exit)
  return pointAt(C, C.angle).addScaledVector(dirAt(C, C.angle), c.exit)
}

/** Centreline length of the whole part, mm — both stubs and the coil between. */
export function corkscrewLength(c: CorkscrewCoil): number {
  const plan = coilPlanLength(c)
  // The coil is its plan length and its drop, squared off against each other:
  // one steady fall makes the whole thing one long right-angled triangle.
  return c.entry + Math.hypot(plan, c.height) + c.exit
}

/** How far the outlet sits below the inlet, mm. Negative climbs. */
export function corkscrewFall(c: CorkscrewCoil): number {
  return -endPoint(c).dot(upright(corkscrewSlope(c)))
}

/**
 * The part's centreline, chopped into chords no longer than `step` degrees of
 * turn, with the way up named at each one.
 *
 * The way up is dead up the whole way down, which is the whole trick of a coil
 * about a vertical axis: the trough keeps facing the sky ring after ring, and
 * the outlet lands square with the frame the next part is stood in without any
 * unwinding at the end — where a hook, turning on a tipped plane, has to have
 * its roll wound back out of it.
 */
export function corkscrewPath(c: CorkscrewCoil, step: number, least: number) {
  const C = solve(c)
  if (!C) {
    return {
      points: [new THREE.Vector3(), new THREE.Vector3(0, 0, c.entry + c.exit)],
      ups: [LOCAL_Y.clone()],
    }
  }

  const chords = Math.max(least, Math.ceil(C.angle / RAD / step))
  const points = [new THREE.Vector3(), new THREE.Vector3(0, 0, c.entry)]
  // The stub runs along the part's own axis, where dead up is simply +Y.
  const ups = [LOCAL_Y.clone()]
  for (let i = 1; i <= chords; i++) {
    points.push(pointAt(C, (C.angle * i) / chords))
    ups.push(C.up.clone())
  }
  points.push(points[points.length - 1].clone().addScaledVector(dirAt(C, C.angle), c.exit))
  ups.push(C.up.clone())
  return { points, ups }
}
