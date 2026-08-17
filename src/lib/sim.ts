import * as THREE from 'three'
import { sampleAssembly, type Assembly } from './layout'

/** Gravity in mm/s². */
export const G = 9810
/** Solid sphere rolling without slipping: a = (5/7)·g·sinθ. */
const ROLL = 5 / 7

export interface MarbleState {
  /** Arc length along the tube axis, mm. */
  s: number
  /** Speed along the axis, mm/s. */
  v: number
  /** True once the marble has left the last piece. */
  airborne: boolean
  position: THREE.Vector3
  velocity: THREE.Vector3
  spin: number
}

export function createMarble(): MarbleState {
  return {
    s: 0,
    v: 0,
    airborne: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: 0,
  }
}

export function resetMarble(m: MarbleState, asm: Assembly, restOffset: number) {
  m.s = 0
  m.v = 0
  m.airborne = false
  m.velocity.set(0, 0, 0)
  m.spin = 0
  seat(m, asm, restOffset)
}

/** Places the marble on the floor of the bore at its current arc length. */
function seat(m: MarbleState, asm: Assembly, restOffset: number) {
  const { point } = sampleAssembly(asm, m.s)
  m.position.copy(point)
  m.position.y -= restOffset
}

/**
 * The speed a marble released at the top would be carrying by arc length `s`.
 *
 * Over one straight chord the acceleration is constant, so v·dv/ds = a solves in
 * closed form and the whole run integrates chord by chord — no time-stepping.
 * That is what lets the scrubber drop the marble anywhere on the run and have it
 * carry on at the speed it would have had if it had rolled there.
 */
export function speedAt(asm: Assembly, s: number, friction: number) {
  const target = THREE.MathUtils.clamp(s, 0, asm.totalLength)
  let v2 = 0
  for (let i = 0; i < asm.segments.length; i++) {
    const seg = asm.segments[i]
    if (seg.startS >= target) break
    const span = Math.min(seg.length, target - seg.startS)
    const a = ROLL * G * Math.sin(seg.pitch) - friction * G * Math.cos(seg.pitch)
    // Clamped at rest, the same stall the stepper gives a climb it cannot make.
    v2 = Math.max(0, v2 + 2 * a * span)
    if (span < seg.length) break
    const following = asm.segments[i + 1]
    // Kink loss at the joint, squared because this walk is carrying v².
    if (following) {
      const cos = THREE.MathUtils.clamp(seg.dir.dot(following.dir), 0, 1)
      v2 *= cos * cos
    }
  }
  return Math.sqrt(v2)
}

/** Drops the marble at arc length `s`, moving at whatever speed the run gives it there. */
export function seekMarble(
  m: MarbleState,
  asm: Assembly,
  s: number,
  friction: number,
  restOffset: number,
  radius: number,
) {
  m.s = THREE.MathUtils.clamp(s, 0, asm.totalLength)
  m.v = speedAt(asm, m.s, friction)
  m.airborne = false
  m.velocity.set(0, 0, 0)
  // Rolling without slipping ties spin to distance, so scrubbing back unrolls it.
  m.spin = m.s / Math.max(radius, 0.1)
  seat(m, asm, restOffset)
}

export interface StepResult {
  /** True when the marble has fallen far enough to warrant a reset. */
  lost: boolean
}

export function stepMarble(
  m: MarbleState,
  dt: number,
  asm: Assembly,
  friction: number,
  restOffset: number,
  radius: number,
): StepResult {
  if (!asm.segments.length) return { lost: false }

  if (m.airborne) {
    m.velocity.y -= G * dt
    m.position.addScaledVector(m.velocity, dt)
    m.spin += (m.velocity.length() / Math.max(radius, 0.1)) * dt
    const floor = asm.bounds.min.y - 400
    return { lost: m.position.y < floor }
  }

  const { index } = sampleAssembly(asm, m.s)
  const p = asm.segments[index]
  const drive = ROLL * G * Math.sin(p.pitch)
  const drag = friction * G * Math.cos(p.pitch) * Math.sign(m.v)
  m.v = Math.max(0, m.v + (drive - drag) * dt)

  let next = m.s + m.v * dt
  const segEnd = p.startS + p.length

  if (next >= segEnd) {
    const following = asm.segments[index + 1]
    if (following) {
      // Kink loss at the joint: only the tangential component survives. A
      // rounded corner is chopped fine enough that this costs it almost
      // nothing; a sharp one is meant to bleed speed.
      const cos = THREE.MathUtils.clamp(p.dir.dot(following.dir), 0, 1)
      m.v *= cos
    } else {
      // Off the end of the run — hand over to free flight.
      m.s = asm.totalLength
      seat(m, asm, restOffset)
      m.airborne = true
      m.velocity.copy(p.dir).multiplyScalar(m.v)
      return { lost: false }
    }
  }

  next = Math.min(next, asm.totalLength)
  m.s = next
  m.spin += (m.v / Math.max(radius, 0.1)) * dt
  seat(m, asm, restOffset)
  return { lost: false }
}
