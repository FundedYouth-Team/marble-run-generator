import * as THREE from 'three'
import { centerlineFor, type Centerline } from './centerline'
import { FUNNEL_SOCKET_KEEP, funnelShell, funnelSpoutUp, type FunnelBowl } from './funnel'
import { funnelDrainSpec, funnelSpec, jointSpec, type Piece, type TubeSpec } from '../store'

/**
 * A station is a cross-section of the extrusion at axial position `z`,
 * with an inner and outer wall radius. Two stations sharing a `z` produce a
 * flat annular step face — that is how the snap socket, shoulder and barb
 * are formed.
 */
export interface Station {
  z: number
  ri: number
  ro: number
}

/**
 * Which snap features a swept length of tube carries at its ends.
 *
 * A part on its own has both: a socket to be fed through and a spigot to plug
 * into whatever comes next. A length that runs into something else inside the
 * same part has neither at that end — a funnel's feed tube meets its own bowl
 * there, and a joint would be a joint with itself.
 */
export interface TubeEnds {
  /** Female socket at the start of the length. */
  socket: boolean
  /** Barbed male spigot past the end of it. */
  spigot: boolean
}

/** What a part standing on its own is: fed at one end, plugging in at the other. */
const BOTH_ENDS: TubeEnds = { socket: true, spigot: true }

/**
 * Axial profile of one straight piece, from the female socket at z=0 through
 * the body to the male spigot that plugs into the next piece.
 *
 *   |<-- socket -->|<------ body (length) ------>|<-- spigot -->|
 *
 * Either end may be left off, which cuts the tube square there instead.
 */
export function stationsFor(spec: TubeSpec, length: number, ends: TubeEnds = BOTH_ENDS): Station[] {
  const j = jointSpec(spec, length)
  const { innerR, outerR } = spec
  const socketR = Math.min(j.mateR + j.clearance, outerR - 0.4)
  const grooveR = Math.min(socketR + j.barb, outerR - 0.3)
  const barbR = Math.min(j.mateR + j.barb, outerR)
  const d = j.depth
  const g0 = d * 0.4 // retention face
  const g1 = d * 0.7 // end of the lead-in ramp

  const stations: Station[] = ends.socket
    ? [
        // Female socket bore, with a retention groove for the mating barb.
        { z: 0, ri: socketR, ro: outerR },
        { z: g0, ri: socketR, ro: outerR },
        { z: g0, ri: grooveR, ro: outerR },
        { z: g1, ri: grooveR, ro: outerR },
        { z: g1, ri: socketR, ro: outerR },
        { z: d, ri: socketR, ro: outerR },
        // Socket shoulder — the mating spigot bottoms out here.
        { z: d, ri: innerR, ro: outerR },
      ]
    : [{ z: 0, ri: innerR, ro: outerR }]

  // Full-wall body.
  stations.push({ z: length, ri: innerR, ro: outerR })
  if (!ends.spigot) return stations

  stations.push(
    // Spigot: outer half of the wall removed so the bore stays continuous.
    { z: length, ri: innerR, ro: j.mateR },
    { z: length + g0, ri: innerR, ro: j.mateR },
    // Snap barb: square retention face, then a lead-in ramp to the tip.
    { z: length + g0, ri: innerR, ro: barbR },
    { z: length + g1, ri: innerR, ro: j.mateR },
    { z: length + d, ri: innerR, ro: j.mateR },
  )
  return stations
}

function radialDivisions(spec: TubeSpec) {
  return Math.max(20, Math.round((spec.sweep / (Math.PI * 2)) * 72))
}

/** A point on the piece's profile, in the (axial, radial) half-plane. */
interface ProfilePoint {
  z: number
  r: number
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/**
 * The closed profile of the piece in the (z, r) half-plane: out along the
 * outer wall, back along the bore. Sweeping this loop about the axis is what
 * produces the solid, so every surface — walls, shoulders, barb, end caps —
 * comes from one consistently ordered loop.
 */
interface Profile {
  points: ProfilePoint[]
  /**
   * Where the bore chain starts. Everything before it runs out along the wall
   * with z increasing; everything from it on comes back along the bore with z
   * decreasing. Knowing the two chains apart is what lets the cut faces be
   * triangulated as the band they are — see {@link bandTriangles}.
   */
  split: number
}

function profilePolygon(spec: TubeSpec, length: number, ends: TubeEnds): Profile {
  const stations = stationsFor(spec, length, ends)
  const pts: ProfilePoint[] = []
  const wall: boolean[] = []
  const push = (z: number, r: number, onWall: boolean) => {
    const last = pts[pts.length - 1]
    if (last && near(last.z, z) && near(last.r, r)) return
    pts.push({ z, r })
    wall.push(onWall)
  }

  for (const s of stations) push(s.z, s.ro, true)
  for (let i = stations.length - 1; i >= 0; i--) push(stations[i].z, stations[i].ri, false)
  while (pts.length > 1) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (!near(first.z, last.z) || !near(first.r, last.r)) break
    pts.pop()
    wall.pop()
  }

  // Drop points that lie on the straight line between their neighbours; they
  // would only add strips of coplanar triangles.
  const keep = pts.map((b, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length]
    const c = pts[(i + 1) % pts.length]
    const cross = (b.z - a.z) * (c.r - a.r) - (b.r - a.r) * (c.z - a.z)
    return Math.abs(cross) > 1e-9
  })
  const simplify = keep.filter(Boolean).length >= 3
  const points = simplify ? pts.filter((_, i) => keep[i]) : pts
  const flags = simplify ? wall.filter((_, i) => keep[i]) : wall
  const split = flags.indexOf(false)
  return { points, split: split < 0 ? points.length : split }
}

function signedArea(poly: ProfilePoint[]) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.z * q.r - q.z * p.r
  }
  return a / 2
}

/* ------------------------------------------------------------------ */
/* Sweeping the profile along a centreline                             */
/* ------------------------------------------------------------------ */

/**
 * Where one ring of the swept section sits: the point on the centreline, and
 * the two axes the section is drawn on there.
 */
interface Ring {
  o: THREE.Vector3
  x: THREE.Vector3
  y: THREE.Vector3
  /**
   * Set only at a corner of the centreline. The two chords meeting there want
   * different rings, which would leave a wedge of daylight between them, so the
   * ring is instead mitred onto the plane that bisects the corner — one shared
   * loop both chords land on, exactly as a mitred pipe joint is cut.
   */
  miter: { normal: THREE.Vector3; along: THREE.Vector3 } | null
}

/**
 * Section axes carried along the centreline. Each chord inherits the previous
 * chord's axes turned by the same rotation the direction took, so the section
 * follows the bend without spiralling round the tube as it goes.
 *
 * A centreline that names its own up axis is taken at its word instead: on a
 * helix, carrying the section chord by chord rolls it steadily out of true —
 * see {@link Centerline.ups}.
 */
function chordFrames(line: Centerline) {
  const xs: THREE.Vector3[] = []
  const ys: THREE.Vector3[] = []
  if (line.ups) {
    for (const [i, dir] of line.dirs.entries()) {
      // Squared up against the chord, so the section sits across the tube even
      // where the named up axis leans out of true with it.
      const y = line.ups[i].clone().addScaledVector(dir, -line.ups[i].dot(dir)).normalize()
      ys.push(y)
      xs.push(new THREE.Vector3().crossVectors(y, dir))
    }
    return { xs, ys }
  }
  xs.push(new THREE.Vector3(1, 0, 0))
  ys.push(new THREE.Vector3(0, 1, 0))
  for (let i = 1; i < line.dirs.length; i++) {
    const q = new THREE.Quaternion().setFromUnitVectors(line.dirs[i - 1], line.dirs[i])
    xs.push(xs[i - 1].clone().applyQuaternion(q))
    ys.push(ys[i - 1].clone().applyQuaternion(q))
  }
  return { xs, ys }
}

/**
 * The ring at axial position `z`. Positions outside the centreline — the socket
 * before it and the spigot past its end — run on along the first and last
 * chords, which is where those features belong anyway.
 */
function ringAt(line: Centerline, frames: ReturnType<typeof chordFrames>, z: number): Ring {
  const { points, dirs, distances } = line

  for (let j = 1; j < points.length - 1; j++) {
    if (Math.abs(distances[j] - z) < 1e-6) {
      return {
        o: points[j].clone(),
        x: frames.xs[j - 1],
        y: frames.ys[j - 1],
        miter: {
          normal: dirs[j - 1].clone().add(dirs[j]).normalize(),
          along: dirs[j - 1],
        },
      }
    }
  }

  let i = 0
  while (i < dirs.length - 1 && distances[i + 1] <= z) i++
  return {
    o: points[i].clone().addScaledVector(dirs[i], z - distances[i]),
    x: frames.xs[i],
    y: frames.ys[i],
    miter: null,
  }
}

/** Scratch for {@link surfacePoint} — the sweep runs to thousands of vertices. */
const pt = [0, 0, 0]

/** One point on the swept surface: `r` out from the centreline at angle (ca, sa). */
function surfacePoint(ring: Ring, r: number, ca: number, sa: number) {
  const ux = ring.x.x * ca * r + ring.y.x * sa * r
  const uy = ring.x.y * ca * r + ring.y.y * sa * r
  const uz = ring.x.z * ca * r + ring.y.z * sa * r

  let t = 0
  const m = ring.miter
  if (m) {
    // Slide along the incoming chord until the offset meets the bisecting plane.
    const denom = m.along.dot(m.normal)
    if (Math.abs(denom) > 1e-6) {
      t = -(ux * m.normal.x + uy * m.normal.y + uz * m.normal.z) / denom
    }
  }

  pt[0] = ring.o.x + ux + (m ? m.along.x * t : 0)
  pt[1] = ring.o.y + uy + (m ? m.along.y * t : 0)
  pt[2] = ring.o.z + uz + (m ? m.along.z * t : 0)
  return pt
}

/**
 * Splits the profile at every corner of the centreline, so no strip of the
 * sweep straddles a bend. Without this the body would be one long strip drawn
 * straight between its two ends, cutting the corner off entirely.
 */
function subdivide(profile: Profile, line: Centerline): Profile {
  const breaks = line.distances.slice(1, -1)
  if (!breaks.length) return profile

  const poly = profile.points
  const out: ProfilePoint[] = []
  let split = poly.length
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (i === profile.split) split = out.length
    out.push(a)
    if (near(a.z, b.z)) continue
    const lo = Math.min(a.z, b.z)
    const hi = Math.max(a.z, b.z)
    const inside = breaks.filter((z) => z > lo + 1e-6 && z < hi - 1e-6)
    // Along the edge, not along the axis — half the loop runs back down the bore.
    inside.sort((p, q) => (b.z > a.z ? p - q : q - p))
    for (const z of inside) out.push({ z, r: a.r + ((b.r - a.r) * (z - a.z)) / (b.z - a.z) })
  }
  return { points: out, split }
}

/**
 * Triangulates the profile as the band it actually is: the wall chain and the
 * bore chain walked together in step, so every triangle spans one step of one
 * chain and no more.
 *
 * The cut faces of an open tube are the one part of the solid that is a filled
 * region rather than a strip, and on a bent part that region is not flat — it
 * follows the centreline. Triangulating the loop as a free polygon would let a
 * triangle join the socket end to the spigot end, which on a bend cuts straight
 * across the corner and leaves a sail of material hanging off the outside of
 * it. Stepping the two chains keeps every triangle inside a single chord, where
 * the face really is flat. {@link subdivide} has already planted a point on
 * both chains at every bend, so the steps line up.
 */
function bandTriangles(profile: Profile): [number, number, number][] {
  const { points, split } = profile
  const wall = points.map((_, i) => i).slice(0, split)
  // The bore chain was laid down coming back, so walk it in reverse to run
  // alongside the wall rather than against it.
  const bore: number[] = []
  for (let i = points.length - 1; i >= split; i--) bore.push(i)
  if (wall.length < 2 || bore.length < 2) return []

  const tris: [number, number, number][] = []
  let i = 0
  let j = 0
  while (i < wall.length - 1 || j < bore.length - 1) {
    // Advance whichever chain is lagging in z, so the rungs stay square-ish.
    const stepWall =
      j >= bore.length - 1 ||
      (i < wall.length - 1 && points[wall[i + 1]].z <= points[bore[j + 1]].z)
    if (stepWall) tris.push([wall[i], bore[j], wall[++i]])
    else tris.push([wall[i], bore[j], bore[++j]])
  }
  return tris
}

/**
 * Builds one piece as a watertight solid by sweeping {@link profilePolygon}
 * along `line`. Local frame: +Z is the tube axis where the part starts, +Y is
 * up, so the opening of a half / 3-4 tube faces +Y.
 */
export function buildPieceGeometry(
  spec: TubeSpec,
  line: Centerline,
  ends: TubeEnds = BOTH_ENDS,
): THREE.BufferGeometry {
  return sweepProfile(spec, line, subdivide(profilePolygon(spec, line.length, ends), line))
}

/**
 * One part as a solid, whichever kind of part it is.
 *
 * Every part but one is a length of tube swept along its own centreline, and
 * this is where that stops being true: a funnel's centreline is the path a
 * marble takes across an open bowl, and there is no section to carry along it.
 * So the bowl is built as the bowl it is — see {@link buildFunnelGeometry} — and
 * everything that wants a solid asks here rather than sweeping for itself.
 */
export function buildPartGeometry(spec: TubeSpec, piece: Piece): THREE.BufferGeometry {
  if (piece.type === 'funnel') {
    // The bowl and the feed tube are cut to the part's own tube; the spout may be
    // styled on its own, so it is asked for separately.
    return buildFunnelGeometry(spec, funnelSpec(piece), funnelDrainSpec(spec, piece))
  }
  return buildPieceGeometry(spec, centerlineFor(piece))
}

/**
 * The last `depth` mm of the piece at one end, as its own surface: the same
 * section, on the same centreline, over the same radii. Drawn in the joint
 * colour it picks the end of the tube out rather than adding a shape to it, so
 * the marker cannot be mistaken for a part or for the marble.
 *
 * It is coincident with the piece's own wall by design — the material it is
 * drawn with wins the depth test with a polygon offset, which is what keeps the
 * two from fighting over the pixels.
 */
export function buildEndBandGeometry(
  spec: TubeSpec,
  line: Centerline,
  end: 'in' | 'out',
  depth: number,
): THREE.BufferGeometry {
  const span = Math.min(depth, line.length)
  const zA = end === 'in' ? 0 : line.length - span
  const zB = end === 'in' ? span : line.length
  // Out along the wall, back along the bore — the ordering the sweep expects.
  const points: ProfilePoint[] = [
    { z: zA, r: spec.outerR },
    { z: zB, r: spec.outerR },
    { z: zB, r: spec.innerR },
    { z: zA, r: spec.innerR },
  ]
  return sweepProfile(spec, line, subdivide({ points, split: 2 }, line))
}

/* ------------------------------------------------------------------ */
/* The one part that is not a swept tube                               */
/* ------------------------------------------------------------------ */

/** How finely a bowl is spun about its axis. */
const BOWL_DIVISIONS = 72

/**
 * How fine the grid round the feed's opening has to be, as a share of the wall.
 *
 * A cell the bore touches at all is dropped whole, so the hole comes out a
 * staircase somewhere between the bore and one cell outside it — never smaller,
 * which is the right way to be wrong, since the marble is never pinched.
 *
 * What matters is that the staircase stays *under the tube*. The tube's own cut
 * end is a flat ring lying in the bowl's wall, a whole wall thick, and it covers
 * the ragged edge completely so long as the edge never reaches past it. Let the
 * cells grow to about the wall and it does reach past, in the odd place, and
 * those places are the teeth that show round the opening. At a third of the wall
 * a cell's diagonal is under half of it and the edge stays buried.
 *
 * It is a share of the wall rather than a flat figure because that is what it is
 * hiding behind: a funnel cut from fat tube can afford a coarser grid than one
 * cut from thin, and both want the same answer.
 */
const PIERCE_CELL = 1 / 4

/** Ceilings on the grid, so an extreme bowl cannot run the triangle count away. */
const PIERCE_MAX_ROWS = 240
const PIERCE_MAX_COLUMNS = 1440

/**
 * How far either side of the opening the fine grid is carried, in coarse arcs.
 * One is enough to catch a hole that starts just inside an arc the sweep missed.
 */
const PIERCE_MARGIN = 1

/**
 * The straight collar round the mouth, with a hole poked through it where the
 * feed tube's bore comes in — and nothing else taken out of it.
 *
 * The wall is closed. That is the whole point of building this band as a grid
 * rather than as a lathe spun part of the way round: a lathe can only leave a
 * gap by stopping and starting again, which takes out the wall's whole height
 * over the arc it skips and leaves the mouth notched. Here the wall is laid out
 * as it really is — round by up — and only the cells the bore actually passes
 * through are dropped, so what is left is a closed shell with a hole in its side
 * the size of the tube, exactly as if one had been drilled.
 *
 * The hole is lined by the tube itself, which runs on through it, so the two
 * solids together carry the bore across the wall without either of them being
 * cut against the other.
 */
function collarGeometry(
  centre: THREE.Vector3,
  frame: BowlFrame,
  rIn: number,
  rOut: number,
  yLo: number,
  yHi: number,
  pierce: ((p: THREE.Vector3) => boolean) | null,
  wall: number,
): THREE.BufferGeometry {
  const { x: bx, up, forward } = frame
  const point = (a: number, y: number, r: number) =>
    new THREE.Vector3()
      .copy(centre)
      .addScaledVector(bx, r * Math.cos(a))
      .addScaledVector(forward, r * Math.sin(a))
      .addScaledVector(up, y)

  // How big a cell may be, and so how many rows the band is cut into. The rows
  // run right round rather than only where the hole is: a column carrying fewer
  // of them would meet its neighbours halfway along their edges and leave the
  // shell split down the seam.
  const cell = Math.max(wall * PIERCE_CELL, 1e-3)
  let rows = pierce ? Math.min(PIERCE_MAX_ROWS, Math.max(1, Math.ceil((yHi - yLo) / cell))) : 1
  // The bowl under the collar has its own top edge a wall up from the bottom of
  // this band, at the same two radii. A row line landing exactly on it welds the
  // two solids along a shared ring — four faces to an edge, where a mesh wants
  // two — so the band is cut into one more row rather than share it.
  while (rows < PIERCE_MAX_ROWS && Number.isInteger((wall * rows) / (yHi - yLo))) rows++

  // Where round the band the grid has to be fine. Swept coarsely first, because
  // the opening covers a few degrees of a bowl and gridding the other three
  // hundred to the same fineness would be most of a part's triangles spent on
  // wall with nothing in it.
  const near: boolean[] = new Array(BOWL_DIVISIONS).fill(false)
  if (pierce) {
    for (let k = 0; k < BOWL_DIVISIONS; k++) {
      for (let s = 0; s <= 2 && !near[k]; s++) {
        const a = (Math.PI * 2 * (k + s / 2)) / BOWL_DIVISIONS
        for (let j = 0; j <= rows && !near[k]; j++) {
          const y = yLo + ((yHi - yLo) * j) / rows
          near[k] = pierce(point(a, y, rIn)) || pierce(point(a, y, rOut))
        }
      }
    }
  }
  const wanted = near.map(
    (_, k) =>
      near[(k - PIERCE_MARGIN + BOWL_DIVISIONS) % BOWL_DIVISIONS] ||
      near[k] ||
      near[(k + PIERCE_MARGIN) % BOWL_DIVISIONS],
  )

  // The columns themselves: one per coarse arc, cut finer over the opening.
  const angles: number[] = []
  const arc = (Math.PI * 2) / BOWL_DIVISIONS
  const fine = Math.min(
    Math.ceil(PIERCE_MAX_COLUMNS / BOWL_DIVISIONS),
    Math.max(1, Math.ceil((arc * rOut) / cell)),
  )
  for (let k = 0; k < BOWL_DIVISIONS; k++) {
    const steps = wanted[k] ? fine : 1
    for (let s = 0; s < steps; s++) angles.push(arc * (k + s / steps))
  }
  const cols = angles.length

  const at = (i: number, j: number, r: number) =>
    point(angles[i % cols], yLo + ((yHi - yLo) * j) / rows, r)
  /** Outward, at this column — the way the wall faces there. */
  const radial = (i: number) => {
    const a = angles[i % cols]
    return new THREE.Vector3()
      .addScaledVector(bx, Math.cos(a))
      .addScaledVector(forward, Math.sin(a))
  }

  // Which grid corners the bore reaches, at either face of the wall.
  const hit: boolean[][] = []
  for (let i = 0; i <= cols; i++) {
    const column: boolean[] = []
    for (let j = 0; j <= rows; j++) {
      column.push(!!pierce && (pierce(at(i, j, rIn)) || pierce(at(i, j, rOut))))
    }
    hit.push(column)
  }
  // A cell the bore touches at all is dropped, so the hole is never smaller than
  // the bore it has to pass.
  const open = (i: number, j: number) =>
    j >= 0 &&
    j < rows &&
    (hit[i % cols][j] ||
      hit[(i + 1) % cols][j] ||
      hit[i % cols][j + 1] ||
      hit[(i + 1) % cols][j + 1])

  const positions: number[] = []
  const indices: number[] = []
  /** One quad, wound so that it faces `away`. */
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, away: THREE.Vector3) => {
    const base = positions.length / 3
    for (const p of [a, b, c, d]) positions.push(p.x, p.y, p.z)
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
    if (normal.dot(away) < 0) indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  for (let i = 0; i < cols; i++) {
    const out = radial(i)
    const inward = out.clone().negate()
    for (let j = 0; j < rows; j++) {
      if (open(i, j)) {
        // The sides of the hole: wherever a dropped cell meets a standing one,
        // the wall's two faces are joined across its thickness.
        for (const [di, dj] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const ni = (i + di + cols) % cols
          const nj = j + dj
          // Off the top or bottom of the band there is a cap rather than a
          // neighbour, and the cap has already been left out under the hole.
          if (nj >= 0 && nj < rows && !open(ni, nj)) {
            const [p, q] =
              di !== 0
                ? [[di > 0 ? i + 1 : i, j], [di > 0 ? i + 1 : i, j + 1]]
                : [[i, dj > 0 ? j + 1 : j], [i + 1, dj > 0 ? j + 1 : j]]
            quad(
              at(p[0], p[1], rIn),
              at(p[0], p[1], rOut),
              at(q[0], q[1], rOut),
              at(q[0], q[1], rIn),
              // Into the hole, away from the wall that is left standing.
              new THREE.Vector3()
                .subVectors(at(i, j, (rIn + rOut) / 2), at(ni, nj, (rIn + rOut) / 2)),
            )
          }
        }
        continue
      }
      // The wall itself, inside and out.
      quad(at(i, j, rOut), at(i + 1, j, rOut), at(i + 1, j + 1, rOut), at(i, j + 1, rOut), out)
      quad(at(i, j, rIn), at(i + 1, j, rIn), at(i + 1, j + 1, rIn), at(i, j + 1, rIn), inward)
      // ...and the rim at either end of it.
      if (j === rows - 1) {
        quad(at(i, j + 1, rIn), at(i, j + 1, rOut), at(i + 1, j + 1, rOut), at(i + 1, j + 1, rIn), up)
      }
      if (j === 0) {
        quad(at(i, 0, rIn), at(i, 0, rOut), at(i + 1, 0, rOut), at(i + 1, 0, rIn), up.clone().negate())
      }
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  return geom
}

/** One point on a bowl's profile, in the (radial, axial) half-plane. */
interface BowlPoint {
  r: number
  y: number
}

/**
 * The frame a bowl is spun in: its own upright, and the pair of level axes its
 * mouth is spanned by. A funnel fed downhill is stood at that fall along with
 * the rest of the run, so this is what keeps the bowl inside it level — see
 * {@link funnelUp}.
 */
interface BowlFrame {
  x: THREE.Vector3
  up: THREE.Vector3
  forward: THREE.Vector3
}

/** How finely the feed tube is sampled round its section. */
const FEED_SAMPLES = 72

/**
 * How many steps the tube's far end is stepped across in, bore out to wall.
 *
 * That end is not a flat face: it lies on the bowl's inner wall, which is
 * curved, so walking across it in one step would chord the curve and push a
 * fraction of a millimetre of tube into the marble's way. Stepped, every point
 * on it is put back on the wall.
 */
const FEED_CAP_STEPS = 8

/**
 * The feed tube, cut off against the inside of the bowl.
 *
 * A plain round pipe, run in square across the bowl's radius and stopped dead
 * where it breaks through the wall. It is set in from the wall rather than laid
 * on it — see {@link FUNNEL_FEED_SKEW} — so it goes through cleanly instead of
 * grazing down a long thin slot, and it still puts the marble round the bowl
 * rather than at the throat, because a bore square across the radius can deliver
 * it no other way.
 *
 * Where it meets the bowl every line along it stops where it would break
 * through, and the end it is left with is put back on that wall step by step
 * rather than chorded across. So nothing of the tube stands inside the mouth:
 * the wall reads as unbroken and smooth all the way round, and the only daylight
 * in it is the round hole the bore comes out of.
 *
 * Enclosed whatever style the rest of the part is cut in — it is a hole through
 * a wall, and a hole has no open side to give it — and fed through the same
 * socket every other part is, so whatever comes before plugs into it in the
 * ordinary way.
 *
 * Solved rather than sampled: a line along the tube is straight and the wall is
 * a cylinder, so where the two meet is a quadratic and the near root is the
 * answer.
 */
function feedTubeGeometry(
  spec: TubeSpec,
  f: FunnelBowl,
  centre: THREE.Vector3,
  mouthR: number,
): THREE.BufferGeometry {
  const stations = stationsFor(spec, f.entry, { socket: true, spigot: false })
  // A funnel is fed dead level, so the bowl's axis is a plain vertical line and
  // how far a point is across it is the one coordinate the cut depends on.
  const cx = centre.x
  const cz = centre.z
  // Never cut back into the socket: a tube that meets the wall that early is one
  // the reach should have stopped, and a stub with no socket is worse than a
  // stub that pokes in. See {@link FUNNEL_SOCKET_KEEP}.
  const floor = FUNNEL_SOCKET_KEEP

  /** How far a line along the tube may run before it is inside the bowl. */
  const stopAt = (x: number) => {
    const across = x - cx
    const room = mouthR * mouthR - across * across
    // This line passes outside the mouth altogether — it never breaks through.
    if (room <= 0) return Infinity
    return Math.max(floor, cz - Math.sqrt(room))
  }

  // The section, walked out along the wall and back down the bore, exactly as a
  // swept length of tube is. The far end is a band rather than a single edge:
  // it is the cut against the bowl, stepped so it lands on the curve.
  const L = f.entry
  const poly: ProfilePoint[] = [
    { z: 0, r: spec.outerR },
    { z: L, r: spec.outerR },
  ]
  for (let i = 1; i < FEED_CAP_STEPS; i++) {
    poly.push({ z: L, r: spec.outerR + ((spec.innerR - spec.outerR) * i) / FEED_CAP_STEPS })
  }
  for (let i = stations.length - 1; i >= 0; i--) poly.push({ z: stations[i].z, r: stations[i].ri })

  const flip = signedArea(poly) < 0
  const positions: number[] = []
  const indices: number[] = []
  const ring: number[][] = []
  for (const p of poly) {
    const at: number[] = []
    for (let i = 0; i < FEED_SAMPLES; i++) {
      const a = (Math.PI * 2 * i) / FEED_SAMPLES
      const x = p.r * Math.cos(a)
      at.push(positions.length / 3)
      positions.push(x, p.r * Math.sin(a), Math.min(p.z, stopAt(x)))
    }
    ring.push(at)
  }

  for (let e = 0; e < poly.length; e++) {
    const g = (e + 1) % poly.length
    for (let j = 0; j < FEED_SAMPLES; j++) {
      const k = (j + 1) % FEED_SAMPLES
      const a0 = ring[e][j]
      const a1 = ring[e][k]
      const b0 = ring[g][j]
      const b1 = ring[g][k]
      if (flip) indices.push(a0, b1, b0, a0, a1, b1)
      else indices.push(a0, b0, b1, a0, b1, a1)
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  return geom
}

/**
 * Whether a point is inside the feed tube's bore — the test the collar is
 * pierced by. The tube runs from the origin down local +Z, so this is its
 * distance off that axis and how far along it has got, and nothing more.
 *
 * The clearance allowed round the bore is a whole cell of the grid the collar is
 * pierced on, and that is not slack: the grid drops whole cells, so a cell the
 * bore only clips a corner of survives, and without the clearance it would
 * survive standing most of a cell's width into the marble's way. A cell wide is
 * what it takes for such a cell to be caught.
 */
function boreOf(f: FunnelBowl, innerR: number, clearance: number) {
  const clear = innerR + clearance
  return (p: THREE.Vector3) => Math.hypot(p.x, p.y) <= clear && p.z >= 0 && p.z <= f.entry
}

/** A straight length of centreline, for the two stubs a bowl is fed and drained by. */
function straightLine(from: THREE.Vector3, to: THREE.Vector3, up?: THREE.Vector3): Centerline {
  const step = new THREE.Vector3().subVectors(to, from)
  const length = step.length()
  return {
    points: [from.clone(), to.clone()],
    dirs: [length > 1e-9 ? step.divideScalar(length) : new THREE.Vector3(0, 0, 1)],
    distances: [0, length],
    length,
    corner: null,
    ups: up ? [up.clone()] : undefined,
  }
}

/**
 * A closed profile spun about an upright axis at `centre` — the bowl itself,
 * built the way a bowl is rather than swept along the path through it.
 *
 * The profile runs down the inside, across the throat, back up the outside and
 * across the rim, so the solid it makes is a shell with the throat open right
 * through it. Which way round the triangles face is read off the profile rather
 * than assumed, so a profile listed the other way about still comes out with its
 * surface pointing outward.
 *
 * `arc` spins it part of the way round instead, and closes the two ends off with
 * flat faces — which is how the collar is given the opening the feed tube's bore
 * comes out through.
 */
function bowlGeometry(
  raw: BowlPoint[],
  centre: THREE.Vector3,
  frame: BowlFrame,
  arc?: { from: number; sweep: number },
): THREE.BufferGeometry {
  // A collar exactly as tall as its crown band leaves the two coincident, which
  // would only add a ring of slivers.
  const profile = raw.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p.r - raw[i - 1].r) > 1e-6 ||
      Math.abs(p.y - raw[i - 1].y) > 1e-6,
  )
  const n = profile.length
  const sweep = arc ? arc.sweep : Math.PI * 2
  const round = !arc
  const segs = Math.max(3, Math.ceil((BOWL_DIVISIONS * sweep) / (Math.PI * 2)))
  // A closed spin wraps, so the last ring *is* the first one.
  const rings = round ? segs : segs + 1

  const { x: bx, up, forward } = frame
  const positions: number[] = []
  for (let i = 0; i < rings; i++) {
    const a = (arc ? arc.from : 0) + (sweep * i) / segs
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (const p of profile) {
      positions.push(
        centre.x + bx.x * p.r * ca + forward.x * p.r * sa + up.x * p.y,
        centre.y + bx.y * p.r * ca + forward.y * p.r * sa + up.y * p.y,
        centre.z + bx.z * p.r * ca + forward.z * p.r * sa + up.z * p.y,
      )
    }
  }

  let area = 0
  for (let j = 0; j < n; j++) {
    const p = profile[j]
    const q = profile[(j + 1) % n]
    area += p.r * q.y - q.r * p.y
  }
  const out = area > 0

  const indices: number[] = []
  for (let i = 0; i < segs; i++) {
    const ring = i * n
    const next = ((i + 1) % rings) * n
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n
      const a = ring + j
      const b = next + j
      const c = next + k
      const d = ring + k
      if (out) indices.push(a, c, b, a, d, c)
      else indices.push(a, b, c, a, c, d)
    }
  }

  // The two cut ends of a part-way spin. The profile is the plain rectangle of a
  // collar band, so a fan off its first corner covers it; which way the fan
  // faces is measured rather than assumed, and turned about if it has come out
  // looking back into the material.
  if (arc) {
    const v = (at: number) => new THREE.Vector3().fromArray(positions, at * 3)
    for (const [ring, side] of [
      [0, -1],
      [segs * n, 1],
    ] as const) {
      const fan: [number, number, number][] = []
      for (let j = 1; j < n - 1; j++) fan.push([ring, ring + j, ring + j + 1])
      if (!fan.length) continue
      // The way the spin is travelling at this end; the face has to look along
      // it at the far end and back down it at the near one.
      const a = arc.from + (side > 0 ? sweep : 0)
      const away = bx
        .clone()
        .multiplyScalar(-Math.sin(a))
        .addScaledVector(forward, Math.cos(a))
        .multiplyScalar(side)
      const [p, q, r] = fan[Math.floor(fan.length / 2)]
      const normal = new THREE.Vector3()
        .subVectors(v(q), v(p))
        .cross(new THREE.Vector3().subVectors(v(r), v(p)))
      const flip = normal.dot(away) < 0
      for (const [x, y, z] of fan) {
        if (flip) indices.push(x, z, y)
        else indices.push(x, y, z)
      }
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  return geom
}

/**
 * Several solids as one. They are laid alongside one another rather than cut
 * against one another — a feed tube buried a half-wall into a collar overlaps
 * it, and stays overlapping it — which is what a slicer takes a model to mean
 * anyway: material is material, and two solids sharing some of it print as the
 * one lump they are.
 */
function mergeSolids(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const part of parts) {
    const base = positions.length / 3
    const pos = part.getAttribute('position')
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    const index = part.getIndex()
    if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i))
    else for (let i = 0; i < pos.count; i++) indices.push(base + i)
    part.dispose()
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  geom.computeBoundingSphere()
  return geom
}

/**
 * A funnel as a solid: the feed tube that fills the mouth, the bowl, and the
 * lead-out under the throat.
 *
 * They are built apart and laid together, because the part is genuinely several
 * things rather than one section carried along a line.
 *
 * The feed tube runs level from its socket to the side of the bowl, lying along
 * the outside of it, with its bore's far side on the inside of the wall — so the
 * marble comes out already running along that wall and goes round the bowl
 * rather than at the throat. See {@link feedTubeGeometry}. The collar it is let
 * into is a closed wall with nothing taken out of it but that bore, so what
 * shows in the mouth is the round hole the marble comes out of and nothing else,
 * and the wall reads as unbroken over it and under it.
 *
 * The bowl proper is a shell spun about its own axis, collar then cone, open
 * right through at the throat. The lead-out picks that bore up a wall's
 * thickness inside the cone, so the two are properly grown together rather than
 * left touching at a single plane, and carries it down to the spigot.
 *
 * The drain is cut to its own spec, which is how a funnel can be drained into an
 * open tube. The feed tube is always enclosed — it is a hole through a wall, and
 * a hole has no open side to give it.
 */
export function buildFunnelGeometry(
  spec: TubeSpec,
  f: FunnelBowl,
  drain: TubeSpec = spec,
): THREE.BufferGeometry {
  const shell = funnelShell(f, spec.innerR, spec.wall)
  const crown = shell.crown
  const sill = crown - shell.sill
  const waist = crown - shell.rim
  const throat = -f.depth
  // The cone is walled radially, so its wall lies further out than the plain
  // one; the collar above it is upright, where the two are the same thing. The
  // outside runs from one to the other over the straight of the collar, which is
  // what leaves the feed tube a plain-walled collar to lie along.
  const out = shell.offset
  const band = shell.wall
  // A funnel is fed dead level, so the bowl's own frame and the part's are the
  // same frame — which is the whole reason the feed tube goes in square.
  const frame: BowlFrame = {
    x: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    forward: new THREE.Vector3(0, 0, 1),
  }
  const parts: THREE.BufferGeometry[] = []

  if (f.lead && f.entry > 0) {
    parts.push(feedTubeGeometry(spec, f, shell.centre, shell.mouthR))
  }

  // The collar: a closed wall with a hole poked through it where the feed tube's
  // bore comes in, and nothing else taken out of it — see {@link collarGeometry}.
  // It reaches a wall's thickness below the sill so it and the bowl under it are
  // grown together rather than left touching at a plane.
  parts.push(
    collarGeometry(
      shell.centre,
      frame,
      shell.mouthR,
      shell.mouthR + band,
      sill - spec.wall,
      crown,
      f.lead && f.entry > 0 ? boreOf(f, spec.innerR, spec.wall * PIERCE_CELL) : null,
      spec.wall,
    ),
  )

  // The bowl under it: the rest of the collar, then the cone in to the throat.
  parts.push(
    bowlGeometry(
      [
        { r: shell.mouthR, y: sill },
        { r: shell.mouthR, y: waist },
        { r: shell.throatR, y: throat },
        { r: shell.throatR + out, y: throat },
        { r: shell.mouthR + out, y: waist },
        { r: shell.mouthR + band, y: sill },
      ],
      shell.centre,
      frame,
    ),
  )

  // The spout starts inside the cone rather than under it, so the extra wall's
  // worth is added to its body and the spigot still lands where the path ends.
  const head = shell.centre.clone().addScaledVector(frame.up, throat + spec.wall)
  const spout = straightLine(
    head,
    head.clone().addScaledVector(frame.up, -(f.exit + spec.wall)),
    funnelSpoutUp(f),
  )
  parts.push(buildPieceGeometry(drain, spout, { socket: false, spigot: true }))

  return mergeSolids(parts)
}

/** Sweeps one closed (z, r) profile about `line` into a solid. */
function sweepProfile(spec: TubeSpec, line: Centerline, profile: Profile): THREE.BufferGeometry {
  const poly = profile.points
  const frames = chordFrames(line)
  const rings = poly.map((p) => ringAt(line, frames, p.z))

  const div = radialDivisions(spec)
  // A closed tube wraps, so the last angular sample *is* the first one.
  const samples = spec.closed ? div : div + 1
  const cos: number[] = []
  const sin: number[] = []
  for (let i = 0; i < samples; i++) {
    const a = spec.startAngle + (spec.sweep * i) / div
    cos.push(Math.cos(a))
    sin.push(Math.sin(a))
  }

  const positions: number[] = []
  const indices: number[] = []
  // Sweeping is right-handed about the axis, so a clockwise profile (negative
  // area, which is what out-along-the-wall / back-along-the-bore produces)
  // would turn the surface inside out.
  const flip = signedArea(poly) < 0

  // Lateral surface: one strip per profile edge.
  for (let e = 0; e < poly.length; e++) {
    const f = (e + 1) % poly.length
    const base = positions.length / 3
    for (let i = 0; i < samples; i++) positions.push(...surfacePoint(rings[e], poly[e].r, cos[i], sin[i]))
    for (let i = 0; i < samples; i++) positions.push(...surfacePoint(rings[f], poly[f].r, cos[i], sin[i]))

    for (let j = 0; j < div; j++) {
      const j2 = (j + 1) % samples
      const a0 = base + j
      const a1 = base + j2
      const b0 = base + samples + j
      const b1 = base + samples + j2
      if (flip) indices.push(a0, b1, b0, a0, a1, b1)
      else indices.push(a0, b0, b1, a0, b1, a1)
    }
  }

  // Radial faces closing the cut edges of an open tube.
  if (!spec.closed) {
    const faces = bandTriangles(profile)

    for (const [i, outward] of [
      [0, -1],
      [samples - 1, 1],
    ] as const) {
      const ca = cos[i]
      const sa = sin[i]
      const base = positions.length / 3
      for (let k = 0; k < poly.length; k++) positions.push(...surfacePoint(rings[k], poly[k].r, ca, sa))

      // The face has to look away from the material, i.e. across the cut. Take
      // the sign off the fattest triangle — the split can leave slivers whose
      // own normal is too small to trust.
      const v = (k: number) => new THREE.Vector3().fromArray(positions, (base + k) * 3)
      const n = new THREE.Vector3()
      let best = -1
      let bestFace = faces[0]
      for (const f of faces) {
        const c = new THREE.Vector3()
          .subVectors(v(f[1]), v(f[0]))
          .cross(new THREE.Vector3().subVectors(v(f[2]), v(f[0])))
        if (c.lengthSq() > best) {
          best = c.lengthSq()
          bestFace = f
          n.copy(c)
        }
      }
      const ref = rings[bestFace[0]]
      const away = new THREE.Vector3().addScaledVector(ref.x, -sa).addScaledVector(ref.y, ca)
      const reverse = n.dot(away) * outward < 0

      for (const [x, y, z] of faces) {
        if (reverse) indices.push(base + x, base + z, base + y)
        else indices.push(base + x, base + y, base + z)
      }
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  geom.computeBoundingSphere()
  return geom
}

/**
 * Outline of the front face, for the 2D cross-section draft.
 * `scale` normalises mm into the draft's own drawing units.
 */
export function crossSectionPath(spec: TubeSpec, scale = 1, div = 96) {
  const outer: [number, number][] = []
  const inner: [number, number][] = []
  for (let i = 0; i <= div; i++) {
    const a = spec.startAngle + (spec.sweep * i) / div
    outer.push([Math.cos(a) * spec.outerR * scale, Math.sin(a) * spec.outerR * scale])
    inner.push([Math.cos(a) * spec.innerR * scale, Math.sin(a) * spec.innerR * scale])
  }
  // SVG y grows downward, so the section is mirrored in y.
  const sub = (pts: [number, number][]) =>
    `M ${pts.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join(' L ')} Z`

  // A closed tube is an annulus: two subpaths + even-odd fill.
  if (spec.closed) return `${sub(outer)} ${sub(inner)}`
  return sub([...outer, ...inner.reverse()])
}
