import * as THREE from 'three'
import type { Centerline } from './centerline'
import { jointSpec, type TubeSpec } from '../store'

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
 * Axial profile of one straight piece, from the female socket at z=0 through
 * the body to the male spigot that plugs into the next piece.
 *
 *   |<-- socket -->|<------ body (length) ------>|<-- spigot -->|
 */
export function stationsFor(spec: TubeSpec, length: number): Station[] {
  const j = jointSpec(spec, length)
  const { innerR, outerR } = spec
  const socketR = Math.min(j.mateR + j.clearance, outerR - 0.4)
  const grooveR = Math.min(socketR + j.barb, outerR - 0.3)
  const barbR = Math.min(j.mateR + j.barb, outerR)
  const d = j.depth
  const g0 = d * 0.4 // retention face
  const g1 = d * 0.7 // end of the lead-in ramp

  return [
    // Female socket bore, with a retention groove for the mating barb.
    { z: 0, ri: socketR, ro: outerR },
    { z: g0, ri: socketR, ro: outerR },
    { z: g0, ri: grooveR, ro: outerR },
    { z: g1, ri: grooveR, ro: outerR },
    { z: g1, ri: socketR, ro: outerR },
    { z: d, ri: socketR, ro: outerR },
    // Socket shoulder — the mating spigot bottoms out here.
    { z: d, ri: innerR, ro: outerR },
    // Full-wall body.
    { z: length, ri: innerR, ro: outerR },
    // Spigot: outer half of the wall removed so the bore stays continuous.
    { z: length, ri: innerR, ro: j.mateR },
    { z: length + g0, ri: innerR, ro: j.mateR },
    // Snap barb: square retention face, then a lead-in ramp to the tip.
    { z: length + g0, ri: innerR, ro: barbR },
    { z: length + g1, ri: innerR, ro: j.mateR },
    { z: length + d, ri: innerR, ro: j.mateR },
  ]
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

function profilePolygon(spec: TubeSpec, length: number): Profile {
  const stations = stationsFor(spec, length)
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
export function buildPieceGeometry(spec: TubeSpec, line: Centerline): THREE.BufferGeometry {
  return sweepProfile(spec, line, subdivide(profilePolygon(spec, line.length), line))
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
