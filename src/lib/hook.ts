import * as THREE from 'three'

/**
 * The geometry of a hook's turn, worked out in the part's own frame: it starts
 * at the origin heading down +Z, +Y is up (the opening side), and the run comes
 * in at `slope`.
 *
 * A hook turns about one fixed axis. Which axis that is, is the whole of the
 * part: level with the world, the run turns flat and comes back alongside
 * itself; stood on edge, the same turn takes the run down and back underneath
 * itself. Everything between is a turn on a plane tipped part way over.
 *
 * This is plain numbers in and plain numbers out, so the store — which works
 * out where the run goes next — and the centreline — which draws the tube —
 * can both read from it without either having to know about the other.
 */
export interface HookTurn {
  /** Rigid stub up to the turn, mm. */
  entry: number
  /** Radius of the turn, measured on its own plane, mm. */
  radius: number
  /** How far round it goes, degrees. The sign picks which way it turns. */
  sweep: number
  /** Stub past the turn, mm. */
  exit: number
  /** The fall the run comes in at, degrees. Positive is falling. */
  slope: number
  /**
   * How far the plane of the turn is rolled off level, degrees. Zero turns
   * flat; a quarter turn stands it on edge; a half turn is flat again, the
   * other way about.
   */
  roll: number
}

const RAD = Math.PI / 180
const LOCAL_X = new THREE.Vector3(1, 0, 0)
const LOCAL_Y = new THREE.Vector3(0, 1, 0)
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

/** Which way is up in the part's own frame — the frame is tipped by the slope. */
export function upright(slope: number): THREE.Vector3 {
  const p = slope * RAD
  return new THREE.Vector3(0, Math.cos(p), -Math.sin(p))
}

/**
 * The axis the turn runs about, which is the whole of what the roll sets.
 *
 * Two axes name themselves: the upright, which turns the run flat, and the
 * level axis lying across the run, which stands the turn on its edge. They are
 * square to one another, so between them they reach every plane a turn can be
 * put on, and the roll is how far round from one to the other it is. Half a
 * turn of roll comes back to the upright pointing the other way — the flat turn
 * again, going the other way about — which is why that is where the roll stops.
 *
 * Local +X is that level axis: the layout stands every part up with its X level
 * and square to the run's own upright plane.
 */
export function turnAxis(slope: number, roll: number): THREE.Vector3 {
  const r = roll * RAD
  return upright(slope).multiplyScalar(Math.cos(r)).addScaledVector(LOCAL_X, Math.sin(r))
}

/**
 * The frame a part is stood up in, as the layout builds it: Z along the run, X
 * level, Y toward the sky. This is the one the next part along will be placed
 * with, so it is what a hook has to leave its outlet sitting in.
 */
function skyward(dir: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
  const x = new THREE.Vector3().crossVectors(up, dir)
  // Running dead vertical, there is no heading to read the frame off, and the
  // run carries on with the one it came in on.
  if (x.lengthSq() < 1e-12) x.copy(LOCAL_X)
  else x.normalize()
  return new THREE.Vector3().crossVectors(dir, x)
}

/** How far `from` has to turn about `about` to land on `to`, radians. */
function twist(from: THREE.Vector3, to: THREE.Vector3, about: THREE.Vector3): number {
  return Math.atan2(new THREE.Vector3().crossVectors(from, to).dot(about), from.dot(to))
}

/**
 * The turn itself, solved once — a circular helix about {@link turnAxis}.
 *
 * The helix rather than a flat circle is what keeps the run running: a circle
 * about the upright would come back round at the height it set off from, so the
 * turn creeps along its own axis as it goes, by exactly as much as the entry
 * slope asks for. Stood on edge that creep steps the outgoing run to one side
 * of the incoming one instead, which is the same thing seen from another angle
 * — and either way the run leaves on the tangent it would have reached had it
 * simply been turned about that axis.
 */
interface Turned {
  /** The axis, wound so that turning about it by `angle` always goes forward. */
  axis: THREE.Vector3
  /** How far round, radians — always positive; `axis` carries which way. */
  angle: number
  /** Centre of the circle the turn runs on. */
  centre: THREE.Vector3
  /** From that centre out to where the turn starts. */
  spoke: THREE.Vector3
  /** How far the turn creeps along its own axis, per radian. */
  creep: number
  /** Arc length per radian. */
  rate: number
}

function solve(t: HookTurn): Turned | null {
  const angle = Math.abs(t.sweep) * RAD
  // Nothing left to turn: what remains is one straight length of tube.
  if (angle < 1e-6 || t.radius < 1e-6) return null

  const axis = turnAxis(t.slope, t.roll).multiplyScalar(t.sweep < 0 ? -1 : 1)
  // The run, split into the part that runs along the axis and the part that
  // goes round it. The first is what the turn has to creep to keep up with.
  const along = axis.dot(LOCAL_Z)
  const across = LOCAL_Z.clone().addScaledVector(axis, -along)
  const reach = across.length()
  // Running straight up its own axis, a turn has nothing to go round.
  if (reach < 1e-6) return null
  across.divideScalar(reach)

  const rate = t.radius / reach
  // Square off the run against the axis to find which side the centre is on.
  const spoke = new THREE.Vector3().crossVectors(across, axis).multiplyScalar(t.radius)
  const start = new THREE.Vector3(0, 0, t.entry)
  return { axis, angle, centre: start.sub(spoke), spoke, creep: along * rate, rate }
}

/** Where the turn has got to, `phi` radians in. */
function pointAt(T: Turned, phi: number): THREE.Vector3 {
  return T.centre
    .clone()
    .add(T.spoke.clone().applyAxisAngle(T.axis, phi))
    .addScaledVector(T.axis, T.creep * phi)
}

/** Which way the run is heading, `phi` radians into the turn. */
function dirAt(T: Turned, phi: number): THREE.Vector3 {
  return LOCAL_Z.clone().applyAxisAngle(T.axis, phi)
}

/** Which way the run leaves, in the part's own frame. */
export function hookExitDir(t: HookTurn): THREE.Vector3 {
  const T = solve(t)
  return T ? dirAt(T, T.angle) : LOCAL_Z.clone()
}

/**
 * What the run is doing as it leaves: the fall it is on, and how far its
 * heading has come round — the two numbers the rest of the app lays the next
 * part down with.
 *
 * Turning flat, this is the slope it came in at and the whole sweep, which is
 * what a hook is for. Stood on edge it is the other way about: a half turn on
 * edge sends the run back the way it came at the fall it came in at, mirrored
 * — which is what turning a length of pipe end over end really does to it.
 */
export function hookExit(t: HookTurn): { slope: number; turn: number } {
  const dir = hookExitDir(t)
  const up = upright(t.slope)
  const slope = -Math.asin(THREE.MathUtils.clamp(dir.dot(up), -1, 1)) / RAD
  // Heading is measured about the upright, so both directions are laid flat
  // against it first. A run leaving dead vertical has no heading to read, and
  // carries on with the one it came in on.
  const flat = (v: THREE.Vector3) => v.clone().addScaledVector(up, -v.dot(up))
  const was = flat(LOCAL_Z)
  const now = flat(dir)
  if (now.lengthSq() < 1e-12 || was.lengthSq() < 1e-12) return { slope, turn: 0 }
  return { slope, turn: twist(was, now, up) / RAD }
}

/** Where the run has got to by the time it leaves, in the part's own frame. */
function endPoint(t: HookTurn): THREE.Vector3 {
  const T = solve(t)
  if (!T) return new THREE.Vector3(0, 0, t.entry + t.exit)
  return pointAt(T, T.angle).addScaledVector(dirAt(T, T.angle), t.exit)
}

/** Centreline length of the whole part, mm — both stubs and the turn between. */
export function hookLength(t: HookTurn): number {
  const T = solve(t)
  return t.entry + (T ? T.rate * T.angle : 0) + t.exit
}

/** How far the outlet sits below the inlet, mm. Negative climbs. */
export function hookFall(t: HookTurn): number {
  return -endPoint(t).dot(upright(t.slope))
}

/**
 * The part's centreline, chopped into chords no longer than `step` degrees of
 * turn, with the way up named at each one.
 *
 * Carrying the section round the turn the way the run goes leaves it rolled
 * over against the frame the next part will be stood in — a half turn on edge
 * lands the trough upside down, which is what happens to any open channel bent
 * end over end. All of that roll is wound back out across the turn, spread
 * evenly: the outlet ends up square with the next part, and the twist is a
 * gentle one along the whole turn rather than a wring at one end of it.
 */
export function hookPath(t: HookTurn, step: number, least: number) {
  const start = new THREE.Vector3(0, 0, t.entry)
  const T = solve(t)
  if (!T) {
    return {
      points: [new THREE.Vector3(), new THREE.Vector3(0, 0, t.entry + t.exit)],
      ups: [LOCAL_Y.clone()],
    }
  }

  const up = upright(t.slope)
  const endDir = dirAt(T, T.angle)
  const wanted = skyward(endDir, up)
  const wind = twist(LOCAL_Y.clone().applyAxisAngle(T.axis, T.angle), wanted, endDir)

  const chords = Math.max(least, Math.ceil(T.angle / RAD / step))
  const points = [new THREE.Vector3(), start]
  const ups = [LOCAL_Y.clone()]
  for (let i = 1; i <= chords; i++) {
    points.push(pointAt(T, (T.angle * i) / chords))
    // A chord runs between two points on the turn, so it lies along the tangent
    // halfway round it — which is where its section is squarest to the tube.
    const half = (i - 0.5) / chords
    ups.push(
      LOCAL_Y.clone()
        .applyAxisAngle(T.axis, T.angle * half)
        .applyAxisAngle(dirAt(T, T.angle * half), wind * half),
    )
  }
  points.push(points[points.length - 1].clone().addScaledVector(endDir, t.exit))
  ups.push(wanted)
  return { points, ups }
}
