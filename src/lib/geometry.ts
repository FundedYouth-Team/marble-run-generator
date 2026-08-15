import * as THREE from 'three'
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
 * outer wall, back along the bore. Sweeping this polygon about the axis is
 * what produces the solid, so every surface — walls, shoulders, barb, end
 * caps — comes from one consistently ordered loop.
 */
function profilePolygon(spec: TubeSpec, length: number): ProfilePoint[] {
  const stations = stationsFor(spec, length)
  const pts: ProfilePoint[] = []
  const push = (z: number, r: number) => {
    const last = pts[pts.length - 1]
    if (last && near(last.z, z) && near(last.r, r)) return
    pts.push({ z, r })
  }

  for (const s of stations) push(s.z, s.ro)
  for (let i = stations.length - 1; i >= 0; i--) push(stations[i].z, stations[i].ri)
  while (pts.length > 1) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (!near(first.z, last.z) || !near(first.r, last.r)) break
    pts.pop()
  }

  // Drop points that lie on the straight line between their neighbours; they
  // would only add strips of coplanar triangles.
  const simplified = pts.filter((b, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length]
    const c = pts[(i + 1) % pts.length]
    const cross = (b.z - a.z) * (c.r - a.r) - (b.r - a.r) * (c.z - a.z)
    return Math.abs(cross) > 1e-9
  })
  return simplified.length >= 3 ? simplified : pts
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

/**
 * Builds one piece as a watertight solid by sweeping {@link profilePolygon}
 * about the axis. Local frame: +Z is the tube axis (downstream), +Y is up, so
 * the opening of a half / 3-4 tube faces +Y.
 */
export function buildPieceGeometry(spec: TubeSpec, length: number): THREE.BufferGeometry {
  const poly = profilePolygon(spec, length)
  const div = radialDivisions(spec)
  // A closed tube wraps, so the last angular sample *is* the first one.
  const samples = spec.closed ? div : div + 1
  const angles = Array.from(
    { length: samples },
    (_, i) => spec.startAngle + (spec.sweep * i) / div,
  )

  const positions: number[] = []
  const indices: number[] = []
  // Sweeping is right-handed about +Z, so a clockwise profile (negative area,
  // which is what out-along-the-wall / back-along-the-bore produces) would
  // turn the surface inside out.
  const flip = signedArea(poly) < 0

  // Lateral surface: one strip per profile edge.
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e]
    const b = poly[(e + 1) % poly.length]
    const base = positions.length / 3
    for (const ang of angles) positions.push(Math.cos(ang) * a.r, Math.sin(ang) * a.r, a.z)
    for (const ang of angles) positions.push(Math.cos(ang) * b.r, Math.sin(ang) * b.r, b.z)

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

  // Radial faces closing the cut ends of an open tube.
  if (!spec.closed) {
    const contour = poly.map((p) => new THREE.Vector2(p.z, p.r))
    const faces = THREE.ShapeUtils.triangulateShape(contour, [])

    for (const [ang, outward] of [
      [angles[0], -1],
      [angles[angles.length - 1], 1],
    ] as const) {
      const base = positions.length / 3
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      for (const p of poly) positions.push(c * p.r, s * p.r, p.z)

      // The face must look away from the material, i.e. along ±(-sin, cos, 0).
      const [i0, i1, i2] = faces[0]
      const v = (i: number) => new THREE.Vector3(c * poly[i].r, s * poly[i].r, poly[i].z)
      const n = new THREE.Vector3()
        .subVectors(v(i1), v(i0))
        .cross(new THREE.Vector3().subVectors(v(i2), v(i0)))
      const reverse = n.dot(new THREE.Vector3(-s, c, 0)) * outward < 0

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
