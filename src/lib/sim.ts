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
