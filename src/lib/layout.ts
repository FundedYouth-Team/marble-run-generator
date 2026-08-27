import * as THREE from 'three'
import { centerlineFor, chordUps, type Centerline } from './centerline'
import { exitTurn, funnelSpec, isChainRoot, placementOf, type Piece } from '../store'

/**
 * One straight chord of the run. A plain tube is a single chord; a bent part
 * contributes several. Everything that walks the run — the marble, the draft —
 * works in chords, so a bend needs no special case anywhere downstream.
 */
export interface Segment {
  piece: Piece
  /** Index of the part this chord belongs to. */
  pieceIndex: number
  /** Which run this chord belongs to — its index in {@link Assembly.chains}. */
  chain: number
  /** Start of the chord, world mm. */
  start: THREE.Vector3
  /** End of the chord, world mm. */
  end: THREE.Vector3
  /** Unit direction (points downstream). */
  dir: THREE.Vector3
  length: number
  /** Cumulative axis length at the start of this chord, mm. */
  startS: number
  /** Pitch in radians, positive = falling. */
  pitch: number
  /**
   * Which way the section's up axis points here, world, square to the chord —
   * the same axis the solid's opening is centred on. What it buys the marble is
   * knowing where the trough's open side is, and so which way it can leave.
   */
  up: THREE.Vector3
  /**
   * Whether there is tube around this chord.
   *
   * True of every chord in the app but the funnel's whirl, which is the path the
   * marble takes across the inside of an open bowl rather than the axis of a
   * pipe — see `funnelLine`. The marble still runs it exactly as it runs any
   * other chord; what it may not do is treat it as a wall it can be caught by,
   * because there is no wall there to catch it.
   */
  enclosed: boolean
}

export interface PlacedPiece {
  piece: Piece
  index: number
  /** Start of the tube axis, world mm. */
  start: THREE.Vector3
  /** End of the tube axis, world mm. */
  end: THREE.Vector3
  /** The sharp corner a bent part turns about, world mm; null on a straight one. */
  corner: THREE.Vector3 | null
  /**
   * Unit direction the part starts in — which on a part carrying a joint lead
   * is the axis it plugs into, not the one its body runs on.
   */
  dir: THREE.Vector3
  /** Unit direction it hands on to the next part. */
  exitDir: THREE.Vector3
  /**
   * Entry frame: X = right, Y = up (opening side), Z along the axis the part
   * sets off on. The mesh is placed with it, and the centreline is drawn in it.
   */
  quaternion: THREE.Quaternion
  /** Cumulative axis length at the start of this piece, mm, along its own run. */
  startS: number
  /** Which run this part belongs to — its index in {@link Assembly.chains}. */
  chain: number
  /** Centreline length of the whole part, mm. */
  length: number
  /**
   * The part's own pitch in radians, positive = falling — what its body runs
   * at, which past a joint lead is not what it enters at. This is the angle the
   * draft hangs its slope handle off, so it stays the part's own.
   */
  pitch: number
  /** The part's own heading in radians, read the same way as {@link pitch}. */
  yaw: number
  /** The chords this part is made of, in order. */
  segments: Segment[]
  /** The part's own centreline, in its local frame. */
  line: Centerline
}

/** One run of bonded parts: the chords along it, in order, from its own zero. */
export interface Chain {
  /** Indices into {@link Assembly.placed}, head first. */
  pieces: number[]
  segments: Segment[]
  length: number
}

export interface Assembly {
  placed: PlacedPiece[]
  /**
   * Every run on the stage. A part that has not been joined onto anything is a
   * run of one — which is what a part is when it lands.
   */
  chains: Chain[]
  /**
   * The chords the marble travels, in order. That is the first run in the list:
   * with several runs on the stage the marble has to be given one, and the one
   * the parts list starts with is the one the run reads as starting from.
   */
  segments: Segment[]
  totalLength: number
  bounds: THREE.Box3
  /** Axis polyline, one point per chord end, run by run. */
  polyline: THREE.Vector3[]
}

export function directionFor(yaw: number, pitch: number) {
  const c = Math.cos(pitch)
  return new THREE.Vector3(Math.sin(yaw) * c, -Math.sin(pitch), Math.cos(yaw) * c)
}

/**
 * Orientation with Z along the axis and Y up. Taken from the heading and pitch
 * rather than from the direction alone: away from vertical the two agree, but a
 * straight drop points along world-up, and a direction on its own cannot say
 * which way round the opening should face — it would snap to a fixed axis and
 * roll the part as the run steepened past 90°. Coming off the heading, the
 * opening keeps facing the way the run was already travelling.
 */
export function frameFor(yaw: number, pitch: number) {
  const z = directionFor(yaw, pitch)
  const x = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/**
 * Which of a part's chords have tube around them — see {@link Segment.enclosed}.
 *
 * Every part but the funnel is a solid swept the whole way along its centreline,
 * so the answer is yes throughout. A funnel is three things in a row: a feed
 * pipe, the open bowl, and the spout under it, of which only the first and last
 * are pipe. They are picked out by arc length rather than by counting chords,
 * because a funnel bent onto its joint has its feed split in two and everything
 * counted from the front would then be off by one — see `withLead`.
 */
function enclosedChords(piece: Piece, line: Centerline): (chord: number) => boolean {
  if (piece.type !== 'funnel') return () => true
  const f = funnelSpec(piece)
  const spout = line.length - f.exit
  return (chord) => {
    const mid = (line.distances[chord] + line.distances[chord + 1]) / 2
    return mid < f.entry - 1e-6 || mid > spout + 1e-6
  }
}

/**
 * Stands every part up in the world. Parts bonded together are chained
 * head-to-tail, and a part that is bonded to nothing starts a fresh run where it
 * was set down — so the stage holds as many runs as there are unbonded parts,
 * each measured from its own zero.
 */
export function buildAssembly(pieces: Piece[]): Assembly {
  const placed: PlacedPiece[] = []
  const chains: Chain[] = []
  const polyline: THREE.Vector3[] = []
  const cursor = new THREE.Vector3(0, 0, 0)
  let yaw = 0
  let s = 0
  let chain: Chain | null = null

  pieces.forEach((piece, index) => {
    // A part on its own is a run of its own: it starts where it was put, facing
    // the way it was set down, with its own arc length running from zero.
    if (isChainRoot(pieces, index) || !chain) {
      const at = placementOf(piece)
      cursor.set(at.x, at.y, at.z)
      yaw = THREE.MathUtils.degToRad(at.yaw)
      s = 0
      chain = { pieces: [], segments: [], length: 0 }
      chains.push(chain)
      polyline.push(cursor.clone())
    }
    yaw += THREE.MathUtils.degToRad(piece.turn)
    const pitch = THREE.MathUtils.degToRad(piece.slope)
    // A part carrying a joint lead is stood up on the axis it plugs into rather
    // than on its own: its centreline runs straight out of the socket and takes
    // up the part's own heading and fall at the break past the lock. So the
    // frame the mesh is placed with is the one the part before hands over, and
    // the part's own aim is already baked into the shape. Everything past this
    // — where the part ends, what it hands on, what the marble runs down — is
    // read off the centreline, so none of it needs telling either way.
    const quaternion =
      piece.entrySlope === undefined
        ? frameFor(yaw, pitch)
        : frameFor(
            yaw - THREE.MathUtils.degToRad(piece.turn),
            THREE.MathUtils.degToRad(piece.entrySlope),
          )
    const start = cursor.clone()

    // The part carries its own shape; placing it is just standing that shape up
    // in the entry frame, so a bend of any kind lands in the world for free.
    const line = centerlineFor(piece)
    const world = line.points.map((p) => p.clone().applyQuaternion(quaternion).add(start))
    const ups = chordUps(line).map((up) => up.clone().applyQuaternion(quaternion))
    const walled = enclosedChords(piece, line)

    const own: Segment[] = []
    for (let i = 1; i < world.length; i++) {
      const from = world[i - 1]
      const to = world[i]
      const step = new THREE.Vector3().subVectors(to, from)
      const length = step.length()
      if (length < 1e-9) continue
      step.divideScalar(length)
      own.push({
        piece,
        pieceIndex: index,
        chain: chains.length - 1,
        start: from,
        end: to,
        dir: step,
        length,
        startS: s,
        pitch: Math.asin(THREE.MathUtils.clamp(-step.y, -1, 1)),
        up: ups[i - 1] ?? new THREE.Vector3(0, 1, 0),
        enclosed: walled(i - 1),
      })
      s += length
      polyline.push(to.clone())
    }

    const end = world[world.length - 1]
    // Read off the shape rather than assumed from the aim: a part with a lead
    // sets off along the axis it plugs into, and only comes round to its own
    // heading and fall a lock later.
    const dir = own.length ? own[0].dir.clone() : directionFor(yaw, pitch)
    chain.pieces.push(placed.length)
    placed.push({
      piece,
      index,
      start,
      end,
      corner: line.corner ? line.corner.clone().applyQuaternion(quaternion).add(start) : null,
      dir,
      exitDir: own.length ? own[own.length - 1].dir.clone() : dir.clone(),
      quaternion,
      startS: own.length ? own[0].startS : s,
      chain: chains.length - 1,
      length: line.length,
      pitch,
      yaw,
      segments: own,
      line,
    })
    chain.segments.push(...own)
    chain.length = s
    cursor.copy(end)
    // A corner hands the run on at a new heading, so the next part is measured
    // from there rather than from the heading this one came in on. Pitch needs
    // no such carry: every part holds the slope it was given, and the store is
    // what keeps that slope level with the part before it.
    yaw += THREE.MathUtils.degToRad(exitTurn(piece))
  })

  const bounds = new THREE.Box3()
  if (polyline.length) bounds.setFromPoints(polyline)
  else bounds.set(new THREE.Vector3(), new THREE.Vector3())

  // The marble is given the first run; the rest are parts waiting to be joined
  // on, and there is only one marble.
  const run = chains[0]
  return {
    placed,
    chains,
    segments: run ? run.segments : [],
    totalLength: run ? run.length : 0,
    bounds,
    polyline,
  }
}

/**
 * Where a whole run stands in the world: every part bonded into it, padded out
 * to its own wall. This is what the height figure under the move arrows is
 * measured off, and what setting a run down on the workplane goes by, so a run
 * that has been dropped reads zero rather than half a tube high.
 *
 * `radiusOf` hands back the outer radius the part is cut to, which is not the
 * run's if that part has been sized on its own.
 */
export function chainBox(
  asm: Assembly,
  chain: number,
  radiusOf: (piece: Piece) => number,
): THREE.Box3 {
  const box = new THREE.Box3()
  for (const i of asm.chains[chain]?.pieces ?? []) {
    const p = asm.placed[i]
    // Every chord, so a bent part counts on what it really occupies.
    const points = [p.start, p.end, ...p.segments.map((seg) => seg.end)]
    box.union(new THREE.Box3().setFromPoints(points).expandByScalar(radiusOf(p.piece)))
  }
  return box
}

/**
 * Point + direction at arc length `s` along one run, and the chord it falls on.
 *
 * Every run measures from its own zero — see {@link Assembly.chains} — so which
 * run is being walked has to be said. A run that is not there hands back the
 * origin and no chord, the same answer an empty stage gives.
 */
export function sampleChain(asm: Assembly, chain: number, s: number) {
  const run = asm.chains[chain]
  if (!run || !run.segments.length) {
    return { point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), index: -1, seg: null }
  }
  const clamped = THREE.MathUtils.clamp(s, 0, run.length)
  let index = run.segments.findIndex((seg) => clamped < seg.startS + seg.length)
  if (index < 0) index = run.segments.length - 1
  const seg = run.segments[index]
  return {
    point: seg.start.clone().addScaledVector(seg.dir, clamped - seg.startS),
    dir: seg.dir.clone(),
    index,
    seg,
  }
}

