import * as THREE from 'three'
import { hookPath, skyward, upright } from './hook'
import { corkscrewPath } from './corkscrew'
import { funnelPath } from './funnel'
// Nothing here may read any of these while this module is being loaded. The
// store imports the layout, the layout imports this, and this imports the store
// — a cycle the three of them have always lived with, because every use is
// inside a function and so happens long after all three are up. Hoist one read
// to module scope and it comes back `undefined`, which is not an error anybody
// sees: it is a NaN that quietly deletes a part.
import {
  JOINT_LOCK,
  angleSpec,
  baseSpec,
  cornerSpec,
  corkscrewCage,
  corkscrewSpec,
  funnelSpec,
  hookSpec,
  jointFilletOf,
  socketReach,
  supportSpec,
  type Piece,
  type TubeSpec,
} from '../store'

/**
 * The centreline a part is built around, in the part's own frame: it starts at
 * the origin heading down +Z, +Y is up (the opening side), and every bend the
 * part has is already baked into it.
 *
 * One shape description serves all three consumers — the swept solid, the world
 * layout, and the 2D draft — so the mesh, the marble and the drawing can never
 * disagree about where a part actually goes.
 */
export interface Centerline {
  /** Vertices from the origin, in order. Always at least two. */
  points: THREE.Vector3[]
  /** Unit direction of each chord; one shorter than `points`. */
  dirs: THREE.Vector3[]
  /** Cumulative arc length at each vertex. */
  distances: number[]
  /** Total arc length, mm. */
  length: number
  /**
   * The sharp corner a bent part turns about, even when the corner is rounded
   * off — rounding cuts across it but leaves both ends of the part where they
   * were, so this stays the point the draft handles are hung from. Null on a
   * part that runs straight.
   */
  corner: THREE.Vector3 | null
  /**
   * Which way is up for each chord, when following the chords alone would get
   * it wrong. One per chord, alongside {@link Centerline.dirs}.
   *
   * The sweep carries the section from chord to chord by the shortest turn,
   * which is right for every bend that happens in one plane. A hook does not:
   * its turn is a helix, and carrying the section round one of those rolls it
   * steadily out of true — by the end the trough would be tipped on its side
   * and would meet the next part rolled over. Naming the up axis outright is
   * what keeps the opening facing the sky the whole way round.
   */
  ups?: THREE.Vector3[]
}

const LOCAL_X = new THREE.Vector3(1, 0, 0)
const LOCAL_Y = new THREE.Vector3(0, 1, 0)
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

/** How finely a rounded corner is chopped into chords. */
const ARC_STEP_DEG = 6
const ARC_MIN_CHORDS = 3
/**
 * The same, for a coil. A corkscrew goes round several times rather than part
 * of once, so it is chopped coarser: at these radii the chords still sit a
 * fraction of a millimetre off the true curve, and cutting them as fine as a
 * corner would multiply the whole part's mesh by the number of rings in it.
 */
const COIL_STEP_DEG = 12

/** Drops vertices that land on top of the one before, which would give a zero-length chord. */
function dedupe(points: THREE.Vector3[]): THREE.Vector3[] {
  return points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]) > 1e-12)
}

function fromPoints(
  points: THREE.Vector3[],
  corner: THREE.Vector3 | null,
  ups?: THREE.Vector3[],
): Centerline {
  const dirs: THREE.Vector3[] = []
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    const d = new THREE.Vector3().subVectors(points[i], points[i - 1])
    const len = d.length()
    dirs.push(len > 1e-9 ? d.divideScalar(len) : LOCAL_Z.clone())
    distances.push(distances[i - 1] + len)
  }
  return { points, dirs, distances, length: distances[distances.length - 1], corner, ups }
}

/** Two legs meeting at a break, as both connectors are built. */
interface Bent {
  /** Rigid leg up to the break, mm. */
  entry: number
  /** How far the run breaks there, degrees. */
  angle: number
  /** Leg past the break, mm. */
  exit: number
  /** Radius the break is rounded off with, mm; zero keeps it sharp. */
  fillet: number
}

/**
 * A two-legged connector, broken about `axis`. The angle connector breaks about
 * local +X, which tips the run up or down; the corner connector breaks about
 * local +Y — the tube's own up axis — which swings it right or left. The shape
 * is otherwise the same part, so both are built here.
 *
 * `up` is which way the sky lies in the part's own frame, and only the corner
 * passes it. A corner turns about the tube's own up axis, and on a falling run
 * that axis is not the upright: carry the section round such a turn and it comes
 * out rolled, so the channel leaves the part facing off to one side and the
 * marble runs into a wall at the next joint. Naming the way up at every chord is
 * what stops that — the same answer a hook already uses, and for the same reason.
 *
 * An angle connector passes null and keeps the carried section, which is already
 * right: it breaks about the level axis, so up stays in the plane of the break
 * the whole way through, exactly as the frame the next part is stood up in does.
 * Naming it here instead would flip the trough over the moment the outgoing leg
 * tipped past the vertical — the very thing that frame is written the way it is
 * to avoid. See `frameFor`.
 */
function bentLine(
  { entry, angle, exit, fillet }: Bent,
  axis: THREE.Vector3,
  up: THREE.Vector3 | null,
  lead: number,
): Centerline {
  const theta = THREE.MathUtils.degToRad(angle)
  const corner = new THREE.Vector3(0, 0, entry)
  const exitDir = LOCAL_Z.clone().applyAxisAngle(axis, theta)
  const end = corner.clone().addScaledVector(exitDir, exit)

  const facing = (line: Centerline): Centerline =>
    up ? { ...line, ups: line.dirs.map((d) => skyward(d, up)) } : line

  const half = Math.abs(theta) / 2
  const tan = Math.tan(half)
  // Straight through, or a break the user has asked to keep sharp.
  if (half < 1e-4 || fillet <= 0 || tan < 1e-6) {
    return facing(fromPoints(dedupe([new THREE.Vector3(), corner.clone(), end]), corner))
  }

  // Tangent length: how far back down each leg the arc starts. Each leg keeps a
  // lock to itself — the inlet's carries the socket and the joint lead, the
  // outlet's carries the spigot — so the arc rounds off as far as it can
  // between the two rather than running out over either. This used to be 85% of
  // the shorter leg, which on a stock 40 mm leg left barely 6 mm of straight for
  // an 8 mm spigot to stand on.
  const tangent = Math.min(
    fillet * tan,
    Math.max(0, Math.min(entry - lead, exit - JOINT_LOCK)),
  )
  // Legs too short to round off at all keep the sharp break they were given.
  if (tangent < 1e-6) {
    return facing(fromPoints(dedupe([new THREE.Vector3(), corner.clone(), end]), corner))
  }
  const radius = tangent / tan
  const arcStart = corner.clone().addScaledVector(LOCAL_Z, -tangent)
  // Square off the entry leg toward the inside of the bend to find the centre.
  const inward = LOCAL_Z.clone().applyAxisAngle(axis, Math.sign(theta) * (Math.PI / 2))
  const centre = arcStart.clone().addScaledVector(inward, radius)
  const spoke = new THREE.Vector3().subVectors(arcStart, centre)

  const chords = Math.max(ARC_MIN_CHORDS, Math.ceil(Math.abs(angle) / ARC_STEP_DEG))
  const points = [new THREE.Vector3(), arcStart]
  for (let i = 1; i <= chords; i++) {
    points.push(centre.clone().add(spoke.clone().applyAxisAngle(axis, (theta * i) / chords)))
  }
  points.push(end)

  return facing(fromPoints(dedupe(points), corner))
}

/**
 * A hook: two stub stubs with a turn between them, on a plane the part carries
 * with it. The turn itself is solved in `lib/hook` — it is the one shape here
 * that is worked out rather than described — and all this adds is the chopping
 * policy the rest of the drawing uses.
 *
 * The stubs are what the snap joint sits on: both ends of the part have to be
 * straight tube for the socket and spigot to mate with anything.
 */
function hookLine(piece: Piece): Centerline {
  const { points, ups } = hookPath(hookSpec(piece), ARC_STEP_DEG, ARC_MIN_CHORDS)
  return fromPoints(points, null, ups)
}

/**
 * A corkscrew: two stubs with a coil between them, wound about the upright. The
 * coil is solved in `lib/corkscrew` — it is the other shape here that is worked
 * out rather than described — and all this adds is the chopping policy.
 *
 * The stubs are what the snap joint sits on: both ends of the part have to be
 * straight tube for the socket and spigot to mate with anything.
 */
function corkscrewLine(piece: Piece): Centerline {
  const { points, ups } = corkscrewPath(corkscrewSpec(piece), COIL_STEP_DEG, ARC_MIN_CHORDS)
  return fromPoints(points, null, ups)
}

/**
 * A funnel: a level feed tube, the whirl down the bowl, and the drop out of the
 * throat. The whirl is solved in `lib/funnel` and chopped as coarsely as a coil,
 * for the same reason — it goes round several times rather than part of once.
 *
 * This is the one part whose centreline is not the axis of a tube. There is no
 * tube around it: the marble is loose in the bowl, and the line is the path it
 * takes across the wall. Everything downstream still reads it the same way, so
 * the marble runs it, the draft draws it and the run is measured along it
 * exactly as if it were a length of pipe — but the solid is not swept along it.
 * See `buildFunnelGeometry`.
 */
function funnelLine(piece: Piece): Centerline {
  const { points, ups } = funnelPath(funnelSpec(piece), COIL_STEP_DEG, ARC_MIN_CHORDS)
  return fromPoints(points, null, ups)
}

const DEG = Math.PI / 180

/**
 * How far a part's body is turned off the axis it plugs into, as a rotation in
 * the frame of that axis — or null when it is not turned off it at all.
 *
 * A frame is the run's heading turned about the upright and then its fall
 * tipped across that, so the step from the axis a part is fed on to the axis
 * the part itself runs on is: the incoming fall taken back off, the part's own
 * turn about the tube's up axis, then the part's own fall laid back on. It
 * comes out the same wherever on the compass the joint happens to lie, which is
 * why a part can carry it without knowing where in the world it stands.
 */
function leadBreak(piece: Piece): THREE.Quaternion | null {
  if (piece.entrySlope === undefined) return null
  const q = new THREE.Quaternion()
    .setFromAxisAngle(LOCAL_X, -piece.entrySlope * DEG)
    .multiply(new THREE.Quaternion().setFromAxisAngle(LOCAL_Y, piece.turn * DEG))
    .multiply(new THREE.Quaternion().setFromAxisAngle(LOCAL_X, piece.slope * DEG))
  // Rounding can leave a part nominally led but pointing exactly where it was.
  return Math.abs(q.w) > 1 - 1e-12 ? null : q
}

/**
 * A part re-aimed about the end of its lock: the first {@link JOINT_LOCK} mm
 * run straight on down +Z, along the axis the part plugs into, and everything
 * past that swung onto the part's own heading and fall.
 *
 * The part is not made longer and nothing is added to it — the lead is the
 * part's own first stretch of tube, and the part simply pivots about the far
 * end of it instead of about its socket. Every part in the library already
 * opens with a straight stub for its socket to sit on, so there is always
 * straight tube there to pivot about, and the total centreline length comes out
 * exactly as it was: turning a path about a point on it moves no chord's
 * length.
 *
 * What this buys is the whole point of the exercise. The socket, the spigot
 * inside it and the barb that retains it all lie inside that first stretch, and
 * they are now dead straight and coaxial with the part before whatever angle
 * the run is asking this part to stand at. The angle is still made — it is just
 * made in solid tube a centimetre downstream, where a bend is only a bend.
 */
/**
 * Which way is up along each chord of a part that does not name it: the section
 * starts square with the part's own frame and is carried from chord to chord by
 * the shortest turn.
 *
 * This is the walk `geometry.ts` does when a centreline hands it no up axis,
 * repeated here so that a lead can hand on the orientation the part would have
 * had without one. A lead's break is a turn in two axes at once, and a turn in
 * two axes has a twist in it: carried across it by the shortest turn, the
 * section comes out of the break rolled, and the trough leaves the part facing
 * somewhere other than up. Naming the axis outright is what stops that — the
 * same fix, and for the same reason, as {@link Centerline.ups} on a helix.
 */
function carriedUps(line: Centerline): THREE.Vector3[] {
  const ups = [LOCAL_Y.clone()]
  for (let i = 1; i < line.dirs.length; i++) {
    const q = new THREE.Quaternion().setFromUnitVectors(line.dirs[i - 1], line.dirs[i])
    ups.push(ups[i - 1].clone().applyQuaternion(q))
  }
  return ups
}

/**
 * Which way is up along each chord, squared against the chord — the axis the
 * section is stood on, and so the axis the tube's opening is measured off.
 *
 * A part that names its own up is taken at its word and everything else is
 * carried; squaring afterwards costs the carried walk nothing, because it starts
 * square and every step of it is a rotation. What it does do is keep a named
 * axis honest where the part leans it out of true with its own chord.
 *
 * The solid sweeps its section on this and the marble reads its opening off it,
 * so the two can never disagree about which way a trough faces — which matters
 * now that the marble can leave a part through its open side.
 */
export function chordUps(line: Centerline): THREE.Vector3[] {
  const own = line.ups ?? carriedUps(line)
  return own.map((up, i) => {
    const dir = line.dirs[i]
    const y = up.clone().addScaledVector(dir, -up.dot(dir))
    return y.lengthSq() < 1e-12 ? up.clone() : y.normalize()
  })
}

/**
 * The swing a joint's lead puts on a part's body: the pivot it turns about, on
 * the axis it plugs into, and how far round it goes. Null where the part runs
 * straight out of its socket and there is no break at all.
 *
 * Read out on its own as well as applied to the line, because the centreline is
 * no longer the only thing a part's body is built from: a corkscrew's cage
 * stands on the coil's own axis, which is solved from the coil rather than read
 * off the finished path, and it has to be swung by exactly what swung the coil.
 */
export function leadSwing(
  piece: Piece,
): { pivot: THREE.Vector3; rotation: THREE.Quaternion } | null {
  return swingOf(ownLine(piece), piece)
}

function swingOf(
  line: Centerline,
  piece: Piece,
): { pivot: THREE.Vector3; rotation: THREE.Quaternion } | null {
  const brk = leadBreak(piece)
  if (!brk) return null
  const first = line.distances[1] ?? 0
  // As long as the break needs, which on a hard turn is a good deal more than
  // the bare lock — see `leadLengthFor`. A part with no straight to give — a
  // funnel fed by its own open mouth has no stub and no socket either — is left
  // exactly as it was drawn.
  const lock = Math.min(piece.leadLength ?? JOINT_LOCK, first)
  if (lock < 1e-6) return null
  return { pivot: new THREE.Vector3(0, 0, lock), rotation: brk }
}

function withLead(line: Centerline, piece: Piece): Centerline {
  const swung = swingOf(line, piece)
  if (!swung) return line
  const brk = swung.rotation
  const pivot = swung.pivot
  const lock = pivot.z
  const first = line.distances[1] ?? 0

  const swing = (p: THREE.Vector3) => p.clone().sub(pivot).applyQuaternion(brk).add(pivot)
  const turned = (v: THREE.Vector3) => v.clone().applyQuaternion(brk)
  // The lock lands inside the opening chord unless that chord *is* the lock, in
  // which case the chord is the lead entire and there is no stub of it left
  // over to carry on with.
  const split = first > lock + 1e-6
  const rest = line.points.slice(1)
  const points = [
    new THREE.Vector3(),
    ...(split ? [pivot.clone()] : []),
    ...rest.map((p, i) => (split || i > 0 ? swing(p) : p.clone())),
  ]
  // Named outright even where the part left it to be carried, because the lead
  // is exactly where carrying it goes wrong — see {@link carriedUps}. The lead
  // itself keeps the part's own opening; everything past the break turns with
  // the body, so the part's trough faces where it always would have.
  const own = line.ups ?? carriedUps(line)
  const ups = split
    ? [own[0].clone(), ...own.map(turned)]
    : [own[0].clone(), ...own.slice(1).map(turned)]
  const led = fromPoints(points, line.corner ? swing(line.corner) : null, ups)
  return roundLead(led, jointFilletOf(piece), socketReach(piece))
}

/**
 * The lead's break, rounded off into an arc tangent to both sides of it — the
 * same rounding {@link bentLine} gives a connector's own break, applied to the
 * break a bonded part takes at its inlet.
 *
 * The arc cuts across the corner rather than moving either side of it: the
 * socket still sits square on the axis it plugs into and the body still runs
 * where the part is aimed, so the aim the joint was given is the aim it keeps.
 * That is why this is done last, to the led shape rather than inside it — the
 * aim is settled first and the rounding is a cut across the result.
 *
 * What it does cost is a little centreline length, which is what rounding a
 * corner always costs, and — through `leadLengthFor` rather than through
 * anything here — a longer lead, because an arc reaches further back down the
 * lead than a mitre does. That second one is what actually moves the part's far
 * end: the break happens later along, so everything past it does too.
 *
 * The arc is trimmed to what there is room for. It may not reach back into the
 * socket — `keep` is what the socket and its clearance have already taken — and
 * it may not run out over the far end of the leg past the break, which has its
 * own joint to stand on. Nothing left over and the break stays sharp, the same
 * answer a connector gives on legs too short to round.
 */
function roundLead(line: Centerline, radius: number, keep: number): Centerline {
  if (radius <= 0 || line.points.length < 3) return line
  const inDir = line.dirs[0]
  const outDir = line.dirs[1]
  const theta = Math.acos(THREE.MathUtils.clamp(inDir.dot(outDir), -1, 1))
  const tan = Math.tan(theta / 2)
  // Straight through: a lead with no break in it has no corner to round.
  if (theta < 1e-4 || tan < 1e-6) return line

  const before = line.distances[1]
  const after = line.distances[2] - line.distances[1]
  const tangent = Math.min(radius * tan, Math.max(0, before - keep), Math.max(0, after - JOINT_LOCK))
  if (tangent < 1e-6) return line

  const corner = line.points[1]
  const r = tangent / tan
  // The break turns from one direction to the other, so the two together name
  // the axis it turns about and the plane the arc lies in. Squaring the incoming
  // leg off toward the far side of that turn finds the centre.
  const axis = new THREE.Vector3().crossVectors(inDir, outDir).normalize()
  const arcStart = corner.clone().addScaledVector(inDir, -tangent)
  const inward = inDir.clone().applyAxisAngle(axis, Math.PI / 2)
  const centre = arcStart.clone().addScaledVector(inward, r)
  const spoke = new THREE.Vector3().subVectors(arcStart, centre)
  const chords = Math.max(ARC_MIN_CHORDS, Math.ceil(theta / DEG / ARC_STEP_DEG))

  const arc: THREE.Vector3[] = []
  for (let i = 1; i <= chords; i++) {
    arc.push(centre.clone().add(spoke.clone().applyAxisAngle(axis, (theta * i) / chords)))
  }

  // The way up either side of the break is already worked out — see
  // {@link withLead} — so the arc's job is only to get from the one to the
  // other. The bend takes it most of the way; what is left over is the twist a
  // two-axis break carries, and both are laid on in step with the arc so the
  // trough winds round rather than flicking over somewhere in the middle.
  const own = line.ups ?? carriedUps(line)
  const bent = own[0].clone().applyAxisAngle(axis, theta)
  const twist = Math.atan2(
    new THREE.Vector3().crossVectors(bent, own[1]).dot(outDir),
    bent.dot(own[1]),
  )
  const arcUps: THREE.Vector3[] = []
  for (let i = 0; i < chords; i++) {
    const f = (i + 0.5) / chords
    const dir = inDir.clone().applyAxisAngle(axis, theta * f)
    arcUps.push(own[0].clone().applyAxisAngle(axis, theta * f).applyAxisAngle(dir, twist * f))
  }

  return fromPoints(
    [line.points[0], arcStart, ...arc, ...line.points.slice(2)],
    line.corner,
    [own[0].clone(), ...arcUps, ...own.slice(1)],
  )
}

/**
 * The centreline of one part. A plain tube is a single chord; a connector is
 * two legs meeting at a break, with the break optionally rounded into an arc
 * tangent to both; a hook turns the run right round on a helix; a corkscrew
 * winds it down a tower of them.
 *
 * Whatever the part is, it comes back standing on the axis it plugs into rather
 * than on its own, with the step between the two taken at the end of its lock —
 * see {@link withLead}. A part fed at exactly the angle it runs at, which is
 * most of them most of the time, is handed back untouched.
 */
export function centerlineFor(piece: Piece): Centerline {
  return withLead(ownLine(piece), piece)
}

/**
 * The straight a part has to keep clear at its inlet: its joint lead where it
 * carries one, and the bare lock where it does not. A fillet may not round off
 * into it — the socket, and the break the lead exists to hold clear of the
 * socket, both live in there.
 */
function leadOf(piece: Piece): number {
  return Math.max(JOINT_LOCK, piece.leadLength ?? 0)
}

/** The part's own shape, in its own frame, before the joint has any say in it. */
function ownLine(piece: Piece): Centerline {
  // Falling is -Y, so a positive bend is a positive rotation about local +X.
  if (piece.type === 'angle') {
    const { entry, bend, exit, fillet } = angleSpec(piece)
    return bentLine({ entry, angle: bend, exit, fillet }, LOCAL_X, null, leadOf(piece))
  }
  // Right is +X, so a positive sweep is a positive rotation about local +Y.
  if (piece.type === 'corner') {
    const { entry, sweep, exit, fillet } = cornerSpec(piece)
    return bentLine({ entry, angle: sweep, exit, fillet }, LOCAL_Y, upright(piece.slope), leadOf(piece))
  }
  if (piece.type === 'hook') return hookLine(piece)
  if (piece.type === 'corkscrew') return corkscrewLine(piece)
  if (piece.type === 'funnel') return funnelLine(piece)
  if (piece.type === 'base') return baseLine(piece)
  if (piece.type === 'support') return supportLine(piece)
  return fromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, piece.length)], null)
}

/**
 * A base's line, such as it is: the slab's bottom face down its middle, from the
 * front edge to the back one.
 *
 * A base has no centreline in the sense the rest of the app means — nothing runs
 * along it, and the marble is never on it. What it needs is a frame, because
 * everything that stands a part up in the world does so on one: the origin sits
 * on the workplane at the middle of the plate, +Z runs into the page and +Y is
 * the way the slab is thick. That is the same frame every other part is stood up
 * in, which is what lets a base be moved, turned, drawn and exported by exactly
 * the code that moves, turns, draws and exports a length of tube.
 *
 * Nothing sweeps it. The solid is built from the slab's own four numbers — see
 * `buildBaseGeometry` — and the layout drops the chords this describes on the
 * floor rather than handing them to the marble, so a base is never a stretch of
 * run that something could roll down.
 */
function baseLine(piece: Piece): Centerline {
  const half = baseSpec(piece).depth / 2
  return fromPoints([new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half)], null)
}

/**
 * A support's line: the rod itself, from the end it starts at to the end it
 * finishes at.
 *
 * The one piece of structure whose line is a real line. Nothing travels down it
 * — a rod is not run, takes no joint and carries no marble — but unlike a plate
 * or a post it genuinely is a thing with a direction and a length, and that is
 * exactly what a centreline says. So a rod is stood up in the world by the very
 * code that stands up a length of tube, off the same placement and the same
 * fall.
 */
function supportLine(piece: Piece): Centerline {
  return fromPoints(
    [new THREE.Vector3(), new THREE.Vector3(0, 0, supportSpec(piece).length)],
    null,
  )
}

/**
 * Everything about a part that changes its solid, and nothing that does not —
 * so two parts with the same key can share one mesh, and editing a part's
 * position or name never rebuilds it. `spec` is the tube the part is actually
 * cut from, already resolved: same shape in another style, bore or wall is
 * another solid, so all three are in the key.
 *
 * The lead is in it too, and has to be: a part bent past its lock to meet the
 * joint it hangs off is a different solid from the same part run straight, and
 * two of them in one run may well be bent differently. All three angles the
 * break is built from go in, whether or not the part's own shape already names
 * them — see {@link leadBreak}.
 */
export function shapeKey(piece: Piece, spec: TubeSpec): string {
  // A base is cut from nothing: it has no bore, no wall and no style, so the
  // tube is left out of its key entirely and two slabs of a size share one mesh
  // however the run around them is set.
  if (piece.type === 'base') {
    const b = baseSpec(piece)
    return `base:${b.width}:${b.depth}:${b.height}:${b.radius}`
  }
  // A support is cut from nothing at all — no bore, no wall, no style, and now
  // not even the tube it braces, since a rod is only ever two ends and a
  // thickness. Two of them alike share one mesh however the run around them is
  // set, and however differently the two are aimed.
  if (piece.type === 'support') {
    const t = supportSpec(piece)
    return `rod:${t.width}:${t.length}:${t.radius}`
  }
  // All three angles the break is built from, and the radius it is cut at: a
  // joint rounded off is a different solid from the same joint mitred.
  const lead =
    piece.entrySlope === undefined
      ? ''
      : `${piece.entrySlope}>${piece.turn}>${piece.slope}~${jointFilletOf(piece)}`
  // The side the tube opens is part of the solid, not part of how it is stood
  // up: the opening is cut into the section itself, so two parts alike but for
  // it are two different shapes. A closed tube has no opening, and its side is
  // left out of the key so the same solid is shared however it is set.
  const side = spec.closed ? '-' : spec.openSide
  const tube = `${spec.variant}:${side}:${spec.innerR}:${spec.wall}:${lead}`
  if (piece.type === 'angle') {
    const a = angleSpec(piece)
    return `${tube}:angle:${a.entry}:${a.bend}:${a.exit}:${a.fillet}`
  }
  // A corner's fall is part of its shape, the way a hook's is: it turns about
  // the tube's own up axis, and how far that axis is off the upright — which is
  // how far the trough has to wind through the turn to stay open to the sky — is
  // exactly the fall. Two corners bent the same but tipped differently are two
  // different solids.
  if (piece.type === 'corner') {
    const c = cornerSpec(piece)
    return `${tube}:corner:${c.entry}:${c.sweep}:${c.exit}:${c.fillet}:${piece.slope}`
  }
  // The one shape whose slope is part of the shape: a hook falls as it turns,
  // so how steeply it falls is how tightly the turn winds — and which way the
  // turn is rolled is the plane it winds on.
  if (piece.type === 'hook') {
    const h = hookSpec(piece)
    return `${tube}:hook:${h.entry}:${h.radius}:${h.sweep}:${h.exit}:${h.slope}:${h.roll}`
  }
  // A corkscrew's fall is not part of its key: the coil sets that rather than
  // taking it, so the four numbers of the coil already say everything about it.
  if (piece.type === 'corkscrew') {
    const k = corkscrewSpec(piece)
    // The cage is part of the coil's solid rather than a part beside it, so
    // which sides are braced and how thick the bars are tell two coils apart as
    // surely as their widths do.
    const g = corkscrewCage(piece)
    const cage = g.inner || g.outer ? `${g.inner ? 'i' : ''}${g.outer ? 'o' : ''}${g.width}` : '-'
    return `${tube}:coil:${k.entry}:${k.topRadius}:${k.bottomRadius}:${k.turns}:${k.height}:${k.exit}:${cage}`
  }
  // A funnel's fall is not part of its key either, and for a blunter reason:
  // it has none. What is here besides is the bowl's own numbers and the drain's
  // style — the feed tube is enclosed whatever the part is cut in, so only one
  // end of this part can differ from the tube at the head of the key.
  if (piece.type === 'funnel') {
    const f = funnelSpec(piece)
    // A drain cut open while the part itself is closed is the one way a side can
    // still tell two solids apart after `side` has collapsed it, so it goes in
    // here rather than being lost with the rest.
    const drain = piece.leadOutVariant ?? '-'
    const drainSide = drain !== '-' && drain !== 'closed' ? spec.openSide : '-'
    return `${tube}:funnel:${f.entry}:${f.mouthRadius}:${f.depth}:${f.rim}:${f.turns}:${f.exit}:${f.lead}:${drain}:${drainSide}`
  }
  return `${tube}:straight:${piece.length}`
}

/** Centreline length of a part, mm — what it actually contributes to the run. */
export function pieceAxisLength(piece: Piece): number {
  return centerlineFor(piece).length
}
