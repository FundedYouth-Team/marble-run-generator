import * as THREE from 'three'
import { sampleChain, type Assembly, type Chain, type Segment } from './layout'
import { contact, landing, type World } from './collide'
import type { Piece } from '../store'

/** Gravity in mm/s². */
export const G = 9810
/** Solid sphere rolling without slipping: a = (5/7)·g·sinθ. */
const ROLL = 5 / 7

/**
 * The slowest the marble is ever taken to be really moving, mm/s — under this it
 * is asked whether it has anywhere left to go at all.
 *
 * Scaled by the step, because that is what sets it. One step of gravity moves
 * the speed by `G · dt` whatever the slope, so anything under that figure is
 * beneath what this integrator can tell apart from nought — and a marble in the
 * crease where a fall meets a climb sits exactly there, thrown back and forth
 * across the joint by a step's worth of acceleration each way. Left to a fixed
 * threshold it would rattle in that crease forever at a hundredth of a
 * millimetre, never slow enough to be called stopped. Measured against the step
 * it settles, and settles at whatever rate the run is being watched at.
 */
function stillness(dt: number): number {
  return Math.max(1, G * dt)
}

/**
 * How gently the marble has to be crossing a bore before the tube takes it over,
 * mm/s — about the speed a three millimetre drop gives it.
 *
 * This is what makes a landing look like a landing. Above it the marble is still
 * bouncing and stays in the air, so a drop into a trough rattles down to a roll
 * the way it should; below it there is nothing left worth simulating in three
 * dimensions and the tube has it.
 */
const SETTLE = 250

/** Where the marble is, and what it is doing. */
export interface MarbleState {
  /**
   * Which run it is on — an index into {@link Assembly.chains}. It starts on the
   * first and can be caught by any of them, which is what lets a marble thrown
   * off the end of one run land in another.
   */
  chain: number
  /** Arc length along that run, mm. */
  s: number
  /**
   * Speed along the run, mm/s — signed. Negative is travelling back the way it
   * came, which is what a marble does when it meets a climb it cannot make.
   */
  v: number
  /** True once the marble has left the run and is falling freely. */
  airborne: boolean
  /** True when it has come to a halt on the run and the run cannot restart it. */
  stuck: boolean
  position: THREE.Vector3
  velocity: THREE.Vector3
  spin: number
}

export function createMarble(): MarbleState {
  return {
    chain: 0,
    s: 0,
    v: 0,
    airborne: false,
    stuck: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: 0,
  }
}

/**
 * How far below the axis the marble rests, mm — asked of the part it is in,
 * since a part sized on its own has a floor of its own to sit on.
 */
export type RestOffset = (piece: Piece) => number

/** Everything about the marble and the tube that the step needs to know. */
export interface Physics {
  /** Rolling grip, shared by the run underfoot and by any wall it strikes. */
  friction: number
  /** How much of the speed into a wall comes back out of it, 0–1. */
  bounce: number
  /** The marble's own radius, mm. */
  radius: number
  rest: RestOffset
}

export function resetMarble(m: MarbleState, asm: Assembly, rest: RestOffset) {
  m.chain = 0
  m.s = 0
  m.v = 0
  m.airborne = false
  m.stuck = false
  m.velocity.set(0, 0, 0)
  m.spin = 0
  seat(m, asm, rest)
}

/** Places the marble on the floor of the bore at its current arc length. */
function seat(m: MarbleState, asm: Assembly, rest: RestOffset) {
  const { point, seg } = sampleChain(asm, m.chain, m.s)
  m.position.copy(point)
  if (seg) m.position.y -= rest(seg.piece)
}

/** What one chord hands the next: only the tangential part of the speed survives. */
function kink(from: Segment, to: Segment): number {
  return THREE.MathUtils.clamp(from.dir.dot(to.dir), 0, 1)
}

/** Downhill drive and the grip holding it back on one chord, both in mm/s². */
function forces(seg: Segment, friction: number) {
  return {
    drive: ROLL * G * Math.sin(seg.pitch),
    grip: friction * G * Math.cos(seg.pitch),
  }
}

/**
 * Whether a marble standing still here has anywhere left to go.
 *
 * Both ways are asked, and of the chord it would actually set off along in each
 * — which at a joint is a different chord each way. That is what tells the two
 * kinds of halt apart. A marble that has run out of fall has a climb ahead of it
 * and the slope it came down behind it, so it takes the second and rolls back. A
 * marble in the crease where a fall meets a climb has neither: both chords drive
 * it back at the crease, and there it stays.
 *
 * The same comparison serves both — what gravity gets out of the slope against
 * what the tube holds back — which is the comparison `speedAt` and
 * {@link stallPoint} walk the run with, so the three can never disagree about
 * where a run gives out.
 */
function pinned(run: Chain, s: number, friction: number): boolean {
  const ahead = forces(run.segments[chordAt(run, s, true)], friction)
  const behind = forces(run.segments[chordAt(run, s, false)], friction)
  return ahead.drive <= ahead.grip && behind.drive >= -behind.grip
}

/**
 * The chord arc length `s` falls on, taken in the direction of travel.
 *
 * Which way matters only at a joint, where `s` belongs to both chords at once:
 * a marble arriving at one going forward carries on into the chord past it, and
 * one arriving going backward carries on into the chord before it.
 */
function chordAt(run: Chain, s: number, forward: boolean): number {
  if (forward) {
    const i = run.segments.findIndex((seg) => s < seg.startS + seg.length - 1e-9)
    return i < 0 ? run.segments.length - 1 : i
  }
  for (let i = run.segments.length - 1; i >= 0; i--) {
    if (s > run.segments[i].startS + 1e-9) return i
  }
  return 0
}

/**
 * The speed a marble released at the head of a run would be carrying by arc
 * length `s`, or null if the run stalls before it gets there.
 *
 * Over one straight chord the acceleration is constant, so v·dv/ds = a solves in
 * closed form and the whole run integrates chord by chord — no time-stepping.
 * That is what lets the scrubber drop the marble anywhere on the run and have it
 * carry on at the speed it would have had if it had rolled there.
 *
 * Null is the honest answer past a stall rather than nought: a marble cannot
 * reach that part of the run at all, and a scrubber that quietly reported nought
 * would be showing a stretch of run that never gets used as though it did.
 */
export function speedAt(asm: Assembly, chain: number, s: number, friction: number): number | null {
  const run = asm.chains[chain]
  if (!run) return 0
  const target = THREE.MathUtils.clamp(s, 0, run.length)
  let v2 = 0
  for (let i = 0; i < run.segments.length; i++) {
    const seg = run.segments[i]
    if (seg.startS >= target) break
    const span = Math.min(seg.length, target - seg.startS)
    const { drive, grip } = forces(seg, friction)
    const a = drive - grip
    if (a < 0) {
      // Losing speed, and it may run out before the chord does. Past that point
      // the run is not slow, it is unreachable: the marble stops there and — on
      // a climb — sets off back down. Nothing beyond is ever visited.
      const reach = v2 / (-2 * a)
      if (reach < span) return null
    }
    v2 = Math.max(0, v2 + 2 * a * span)
    if (span < seg.length) break
    const following = run.segments[i + 1]
    // Kink loss at the joint, squared because this walk is carrying v².
    if (following) {
      const cos = kink(seg, following)
      v2 *= cos * cos
    }
  }
  return Math.sqrt(v2)
}

/**
 * Where a run released at its head comes to a halt, mm along it — or null when
 * it runs clear to the end. What the scrubber shades out, and the plainest
 * answer to "why does my marble not get there".
 */
export function stallPoint(asm: Assembly, chain: number, friction: number): number | null {
  const run = asm.chains[chain]
  if (!run) return null
  let v2 = 0
  for (let i = 0; i < run.segments.length; i++) {
    const seg = run.segments[i]
    const { drive, grip } = forces(seg, friction)
    const a = drive - grip
    if (a < 0) {
      const reach = v2 / (-2 * a)
      if (reach < seg.length) return seg.startS + reach
    }
    v2 = Math.max(0, v2 + 2 * a * seg.length)
    const following = run.segments[i + 1]
    if (following) {
      const cos = kink(seg, following)
      v2 *= cos * cos
    }
  }
  return null
}

/** Drops the marble at arc length `s`, moving at whatever speed the run gives it there. */
export function seekMarble(m: MarbleState, asm: Assembly, s: number, phys: Physics) {
  const run = asm.chains[m.chain] ?? asm.chains[0]
  if (!run) return
  m.chain = asm.chains.indexOf(run)
  m.s = THREE.MathUtils.clamp(s, 0, run.length)
  // Past a stall the run gives it nothing, so it is put down at rest — and if
  // the slope there will not hold it, it sets off back down of its own accord.
  m.v = speedAt(asm, m.chain, m.s, phys.friction) ?? 0
  m.airborne = false
  m.stuck = false
  m.velocity.set(0, 0, 0)
  // Rolling without slipping ties spin to distance, so scrubbing back unrolls it.
  m.spin = m.s / Math.max(phys.radius, 0.1)
  seat(m, asm, phys.rest)
}

export interface StepResult {
  /** True when the marble has fallen far enough to warrant a reset. */
  lost: boolean
}

/**
 * How far past the end of a chord the marble is set down when it leaves one, mm.
 *
 * A marble handed to free flight standing exactly on the last chord's end is
 * still, by the width of a rounding error, inside that chord — and the very next
 * thing flight does is look for a tube to be caught by, which would find the one
 * it has just left. A hundredth of a millimetre puts it unambiguously outside.
 */
const CLEAR = 0.01

export function stepMarble(
  m: MarbleState,
  dt: number,
  asm: Assembly,
  world: World,
  phys: Physics,
): StepResult {
  if (!asm.chains.length) return { lost: false }
  return m.airborne ? fly(m, dt, asm, world, phys) : roll(m, dt, asm, phys)
}

/** One step along the run the marble is on. */
function roll(m: MarbleState, dt: number, asm: Assembly, phys: Physics): StepResult {
  const run = asm.chains[m.chain]
  if (!run || !run.segments.length) return { lost: false }

  // Standing still with nowhere to go is the end of the run for this marble; it
  // is asked afresh every step, so widening the fall under it sets it off again.
  if (Math.abs(m.v) < stillness(dt) && pinned(run, m.s, phys.friction)) {
    m.v = 0
    m.stuck = true
    seat(m, asm, phys.rest)
    return { lost: false }
  }
  m.stuck = false

  const seg = run.segments[chordAt(run, m.s, m.v >= 0)]
  const { drive, grip } = forces(seg, phys.friction)
  const was = Math.sign(m.v)
  // Standing still, there is no motion for grip to oppose — only the slope acts,
  // and which way it tips the marble is which way it sets off.
  const next = m.v + (drive - grip * was) * dt
  // Grip slows a marble down; it never drags one backwards. A step that would
  // carry the speed through nought lands it on nought instead, and the standing
  // test above has the next word on whether it stays there.
  m.v = was !== 0 && Math.sign(next) !== was ? 0 : next

  const outcome = travel(m, run, m.v * dt, stillness(dt))
  m.spin += (m.v / Math.max(phys.radius, 0.1)) * dt

  if (outcome === 'on') {
    seat(m, asm, phys.rest)
    return { lost: false }
  }

  // Off one end of the run or the other, and into the air travelling the way the
  // chord it left was pointing — forwards off the tail, backwards off the head.
  const edge = run.segments[outcome === 'tail' ? run.segments.length - 1 : 0]
  seat(m, asm, phys.rest)
  m.position.addScaledVector(edge.dir, outcome === 'tail' ? CLEAR : -CLEAR)
  m.airborne = true
  m.velocity.copy(edge.dir).multiplyScalar(m.v)
  return { lost: false }
}

/**
 * Moves the marble `distance` mm along its run, chord by chord, taking the kink
 * loss at every joint it crosses. Signed: negative walks it back up the run.
 *
 * Chord by chord rather than in one jump because a fast marble can cross several
 * in a step, and each joint it passes is a joint that should cost it something.
 */
function travel(
  m: MarbleState,
  run: Chain,
  distance: number,
  still: number,
): 'on' | 'head' | 'tail' {
  let left = distance
  // A step cannot cross more joints than the run has; the count is only here so
  // that no arrangement of zero-length chords can spin this forever.
  let guard = run.segments.length + 2

  while (Math.abs(left) > 1e-9 && guard-- > 0) {
    const forward = left > 0
    const index = chordAt(run, m.s, forward)
    const seg = run.segments[index]
    const edge = forward ? seg.startS + seg.length : seg.startS
    const target = m.s + left

    if (forward ? target < edge : target > edge) {
      m.s = target
      return 'on'
    }

    left -= edge - m.s
    m.s = edge
    const onward = run.segments[index + (forward ? 1 : -1)]
    if (!onward) return forward ? 'tail' : 'head'
    // The joint takes its cut of the speed, and of what is left of the step with
    // it — the marble is slower now, so it has less of this step's travel to go.
    const cos = kink(seg, onward)
    m.v *= cos
    left *= cos
    // Arrived at the corner with nothing left, so the corner is where it stays.
    // Leaving it a hair past the joint instead would put it on one of the two
    // slopes, and in the crease where a fall meets a climb both of them drive it
    // straight back — which is a marble rocking in the corner forever rather
    // than sitting in it. Stopping square on the joint is what lets the standing
    // test see the crease for what it is. See {@link pinned}.
    if (Math.abs(m.v) < still) return 'on'
  }

  return 'on'
}

/** One step of free flight, including anything it runs into on the way. */
function fly(
  m: MarbleState,
  dt: number,
  asm: Assembly,
  world: World,
  phys: Physics,
): StepResult {
  m.velocity.y -= G * dt
  m.position.addScaledVector(m.velocity, dt)
  m.spin += (m.velocity.length() / Math.max(phys.radius, 0.1)) * dt

  // One wall per pass, deepest first, a few passes: enough to see a marble out
  // of the crease where two surfaces meet without solving them as a set.
  for (let i = 0; i < 4; i++) {
    const hit = contact(world, m.position, phys.radius)
    if (!hit) break
    m.position.addScaledVector(hit.normal, hit.depth)
    const into = m.velocity.dot(hit.normal)
    if (into >= 0) break
    // Split the blow into the part going through the wall and the part running
    // along it. The first comes back as bounce; the second is rubbed down by the
    // same grip the run rolls on, capped by how hard the marble hit — which is
    // Coulomb's rule, and is why a glancing blow barely slows it and a square
    // one nearly stops it dead.
    const tangent = m.velocity.clone().addScaledVector(hit.normal, -into)
    const speed = tangent.length()
    if (speed > 1e-6) {
      tangent.multiplyScalar(Math.max(0, speed - phys.friction * -into) / speed)
    }
    m.velocity.copy(tangent).addScaledVector(hit.normal, -into * phys.bounce)
  }

  // Anything it has fallen into, once it has stopped rattling around in it.
  const caught = landing(world, m.position, phys.radius)
  if (caught) {
    const { dir } = sampleChain(asm, caught.chain, caught.s)
    const along = m.velocity.dot(dir)
    const across = m.velocity.clone().addScaledVector(dir, -along).length()
    if (across < SETTLE) {
      m.chain = caught.chain
      m.s = caught.s
      m.v = along
      m.airborne = false
      m.stuck = false
      m.velocity.set(0, 0, 0)
      seat(m, asm, phys.rest)
      return { lost: false }
    }
  }

  const floor = asm.bounds.min.y - 400
  return { lost: m.position.y < floor }
}
