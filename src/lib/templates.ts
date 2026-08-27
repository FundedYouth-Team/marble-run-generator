import {
  ANGLE_DEFAULTS,
  CORKSCREW_DEFAULTS,
  CORNER_DEFAULTS,
  FUNNEL_DEFAULTS,
  HOOK_DEFAULTS,
  HOOK_ROLL_EDGE,
  HOOK_ROLL_FLAT,
  HOOK_SLOPE_LIMIT,
  PIECE_LIMITS,
  STANDARD_BORE,
  STANDARD_MARBLE,
  exitSlope,
  makePiece,
  settleAll,
  slopeIsFixed,
  type LoadedProject,
  type Piece,
  type PieceType,
  type TubeVariant,
} from '../store'
import { buildAssembly } from './layout'

/**
 * Runs that come with the app — a handful of starters to build on, and finished
 * models to take apart and learn from.
 *
 * A template is written as the parts alone: what each one is and how big, and
 * nothing about where it sits. The run is welded up and stood on the workplane
 * here, so a template is authored the way a run is built — one part after the
 * next — rather than as a list of coordinates nobody could edit by hand.
 */

export type TemplateCategory = 'starter' | 'model'

/**
 * One part of a template. Everything a {@link Piece} has except the bookkeeping
 * a run adds around it: no id, and no placement or joint, since a template is
 * one run bonded head to tail and where it stands is worked out below.
 */
export type TemplatePart = Omit<Partial<Piece>, 'id' | 'at' | 'joined'> & {
  type: PieceType
  /**
   * An angle connector this steep on the way out, whatever it is handed on the
   * way in — the bend is worked out by {@link weld} rather than written down.
   *
   * This is what a template says instead of a bend, and it is said because a
   * turn does not hand on the fall it was given. A corner turns across the fall,
   * so the further it swings the shallower the run leaves; a hook stood on edge
   * comes out mirrored, climbing. Both are the parts doing exactly what they
   * are for, and both leave a run that has to be tipped downhill again — so the
   * connector after one is written as "back onto the run's fall" rather than
   * as a bend that would have to be recomputed by hand every time anything
   * upstream of it moved.
   *
   * Never stored on the piece: it is a note to the weld, not a measurement.
   */
  exitAt?: number
}

export interface Template {
  id: string
  /** What the template is called, in the library and once it is loaded. */
  name: string
  category: TemplateCategory
  /** One line: what the run is. Every card shows this and nothing more. */
  blurb: string
  /** The rest of it, behind a Details link — see the part library. */
  detail?: string
  /** The tube the whole run is cut from. */
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant
  marbleDiameter: number
  parts: TemplatePart[]
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Kills the float dust a chain of welds leaves on an angle, as the store does. */
const tidy = (deg: number) => Math.round(deg * 1e6) / 1e6

/**
 * How far a part's own fall may go. The store keeps the same range privately for
 * its own relinking; only the two that narrow it matter here — a hook falls
 * gently, and a part on a fall of its own has no range at all.
 */
function slopeRangeOf(piece: Piece) {
  if (piece.type === 'hook') return { min: -HOOK_SLOPE_LIMIT, max: HOOK_SLOPE_LIMIT }
  return PIECE_LIMITS.slope
}

/**
 * Pulls every joint in the run shut, the way the store does after an edit: each
 * part starts at the fall the one before it hands on.
 *
 * With one extra move the store has no call for. A corkscrew and a funnel state
 * their own fall — see `slopeIsFixed` — so the run cannot be swung to meet them
 * by setting their slope. Instead the connector standing in front of one is bent
 * until it hands on exactly what that part demands, which is how the same joint
 * is closed by hand in the sidebar. Every template therefore puts an angle
 * connector ahead of its coils and bowls, and this is what sets that connector.
 *
 * The same bending answers {@link TemplatePart.exitAt} on the way past, which is
 * the other half of the job: a connector asked to leave at a given fall is bent
 * to leave at it, however shallow the turn in front of it handed the run on.
 * `exits` runs alongside the parts, one entry each.
 */
function weld(pieces: Piece[], exits: (number | undefined)[]): Piece[] {
  const out = pieces.slice()
  const B = PIECE_LIMITS.bend
  /** Bends the connector at `i` until it hands the run on at `want`. */
  const aim = (i: number, want: number) => {
    if (out[i].type !== 'angle') return
    out[i] = { ...out[i], bend: clamp(tidy(want - out[i].slope), B.min, B.max) }
  }

  if (exits[0] !== undefined) aim(0, exits[0])
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]
    // A coil or a bowl states its own fall, so the connector in front of it is
    // aimed at that rather than the part being swung to meet the run.
    if (slopeIsFixed(out[i])) {
      aim(i - 1, out[i].slope)
      continue
    }
    const R = slopeRangeOf(out[i])
    out[i] = { ...out[i], slope: clamp(tidy(exitSlope(prev)), R.min, R.max) }
    const want = exits[i]
    if (want !== undefined) aim(i, want)
  }
  return out
}

/** How much daylight a template is left standing on above the workplane, mm. */
const GROUND_CLEARANCE = 0

/** A template built: the run itself, and the figures its card reads out. */
export interface TemplateBuild {
  /** Ready to hand to `loadProject`. */
  project: LoadedProject
  /** How many parts the run is made of. */
  parts: number
  /** How far the marble travels along the whole run, mm. */
  length: number
  /** How far the run falls from its highest point to its lowest, mm. */
  drop: number
  /** How much of the bed it stands on, mm — the tube's own thickness included. */
  width: number
  depth: number
}

/**
 * A template turned into a run ready to go on the stage: every part bonded to
 * the one before it, every joint welded shut, and the whole thing stood on the
 * workplane centred on the origin.
 *
 * It is stood by measuring rather than by arithmetic in the template: how far a
 * run falls is the sum of every coil, bowl and slope in it, and asking the
 * assembly is both shorter and right. The figures on the card fall out of the
 * same measurement.
 */
export function buildTemplate(t: Template): TemplateBuild {
  const exits = t.parts.map((p) => p.exitAt)
  const raw = t.parts.map(({ exitAt: _exitAt, ...part }, i) =>
    makePiece({ ...part, ...(i ? { joined: true } : { at: { x: 0, y: 0, z: 0, yaw: 0 } }) }),
  )
  // Settled first: a coil's rings — and so the fall it runs at — come off the
  // tube it is cut from, and the weld has to know that fall before it can bend
  // the connector in front of it to match. Settled again after, because the
  // weld moves the falls the bowls and coils are then measured against.
  const settled = settleAll(raw, t.innerDiameter, t.wallThickness)
  const pieces = settleAll(weld(settled, exits), t.innerDiameter, t.wallThickness)

  const outerR = t.innerDiameter / 2 + t.wallThickness
  const asm = buildAssembly(pieces)
  const box = asm.bounds
  const at = {
    // Centred on the origin in plan, and resting on the workplane rather than
    // sunk through it — the centreline runs a tube's radius above the floor.
    x: -Math.round((box.min.x + box.max.x) / 2),
    // Rounded up rather than to nearest, so a run always clears the plane —
    // rounding the other way sinks the lowest half-millimetre of it through.
    y: Math.ceil(outerR + GROUND_CLEARANCE - box.min.y),
    z: -Math.round((box.min.z + box.max.z) / 2),
    yaw: 0,
  }

  return {
    project: {
      projectName: t.name,
      innerDiameter: t.innerDiameter,
      wallThickness: t.wallThickness,
      variant: t.variant,
      marbleDiameter: t.marbleDiameter,
      pieces: pieces.map((p, i) => (i ? p : { ...p, at })),
    },
    parts: pieces.length,
    length: asm.totalLength,
    drop: box.max.y - box.min.y,
    width: box.max.x - box.min.x + outerR * 2,
    depth: box.max.z - box.min.z + outerR * 2,
  }
}

/* ---------------- the catalogue ---------------- */

/**
 * The fall a template runs at wherever nothing else decides it, degrees.
 *
 * Chosen against the simulator rather than by eye. A marble rolling without
 * slipping is driven by (5/7)·g·sinθ and held back by µ·g·cosθ, so at the stock
 * friction it stops dead below about five degrees — see `lib/sim`. Every fall in
 * this file is kept clear of that, which is also why a connector follows every
 * turn: a corner turns across the fall and hands the run on shallower than it
 * took it, and two corners in a row would put a template under the stall.
 */
const FALL = 8

/** The tube every template in the catalogue is cut from — the app's own stock. */
const STOCK = {
  innerDiameter: STANDARD_BORE,
  wallThickness: 3,
  variant: 'threequarter' as TubeVariant,
  marbleDiameter: STANDARD_MARBLE,
}

/** A plain length of pipe. */
const tube = (length: number, slope = FALL): TemplatePart => ({ type: 'straight', length, slope })

/**
 * A corner, swinging the run by `sweep`. Positive turns right. The legs are the
 * library's own, so a template reads as a run built out of stock parts.
 */
const corner = (sweep: number): TemplatePart => ({
  type: 'corner',
  length: CORNER_DEFAULTS.length,
  exitLength: CORNER_DEFAULTS.exitLength,
  fillet: CORNER_DEFAULTS.fillet,
  sweep,
  slope: FALL,
})

/**
 * An angle connector, tipping the run by `bend`. Ahead of a coil or a bowl the
 * bend given here is only a starting point — {@link weld} sets it to whatever
 * that part demands.
 */
const angle = (bend: number): TemplatePart => ({
  type: 'angle',
  length: ANGLE_DEFAULTS.length,
  exitLength: ANGLE_DEFAULTS.exitLength,
  fillet: ANGLE_DEFAULTS.fillet,
  bend,
  slope: FALL,
})

/**
 * An angle connector that puts the run back on a fall of `slope`, whatever it
 * was handed. This is what follows every turn: see {@link TemplatePart.exitAt}.
 */
const pitch = (slope = FALL): TemplatePart => ({ ...angle(0), exitAt: slope })

/** A hook: `radius` wide, `sweep` round, on the plane `roll` names. */
const hook = (radius: number, sweep: number, roll: number): TemplatePart => ({
  type: 'hook',
  length: HOOK_DEFAULTS.length,
  exitLength: HOOK_DEFAULTS.exitLength,
  radius,
  sweep,
  roll,
  slope: FALL,
})

/**
 * A coil dropping `height`, tapering from `top` across to `bottom`, over
 * `rings` turns.
 *
 * The count is given rather than counted off the height, which is the one place
 * a template overrides the part's own instinct. Left to count, a coil packs in
 * every ring the height has room for — a handsome tower, but the same drop
 * spread over three times the track, and that is a fall of about five degrees:
 * right on the stall. Held to a few turns instead, the coil is open enough to
 * see the marble through and steep enough to carry it.
 */
const corkscrew = (height: number, top: number, bottom: number, rings: number): TemplatePart => ({
  type: 'corkscrew',
  length: CORKSCREW_DEFAULTS.length,
  exitLength: CORKSCREW_DEFAULTS.exitLength,
  height,
  topDiameter: top,
  bottomDiameter: bottom,
  rings,
  ringsSet: true,
  slope: FALL,
})

/** A bowl `mouth` across and `depth` deep, whirling `turns` times round. */
const funnel = (mouth: number, depth: number, turns: number): TemplatePart => ({
  type: 'funnel',
  length: FUNNEL_DEFAULTS.length,
  exitLength: FUNNEL_DEFAULTS.exitLength,
  topDiameter: mouth,
  height: depth,
  rim: FUNNEL_DEFAULTS.rim,
  rings: turns,
  slope: 0,
})

/**
 * The drop out of a funnel's throat. A funnel hands the run on dead vertical and
 * there is no other way out of it, so whatever hangs under one starts by falling
 * straight down — this is that fall, and the connector that flattens it out
 * again onto a rollable slope.
 */
const fromFunnel = (drop: number, onto = FALL): TemplatePart[] => [
  { type: 'straight', length: drop, slope: 90 },
  pitch(onto),
]

export const TEMPLATES: Template[] = [
  {
    id: 'first-run',
    name: 'First Run',
    category: 'starter',
    blurb: 'A straight, a corner and a straight — the smallest run worth printing.',
    detail:
      'Everything is bonded already, so it is a run rather than four loose parts: select any piece and the sidebar edits it in place, and the joints either side keep up. The angle connector after the corner is the part worth understanding — a corner turns across the fall, so it always hands the run on shallower than it took it, and something has to tip it downhill again or the marble runs out of hill.',
    ...STOCK,
    parts: [tube(200), corner(60), pitch(), tube(240)],
  },
  {
    id: 'switchback',
    name: 'Switchback',
    category: 'starter',
    blurb: 'Out, round a flat hook, and back alongside itself.',
    detail:
      'The hook is the part that turns a run right round without losing the fall: it comes back one turn width over and keeps rolling. Two of these stacked is how a long drop is folded into a small footprint — copy the middle three parts and bond them on the end to see it.',
    ...STOCK,
    parts: [tube(200), hook(70, 180, HOOK_ROLL_FLAT), tube(200)],
  },
  {
    id: 'tower-drop',
    name: 'Tower Drop',
    category: 'starter',
    blurb: 'A feed into a tapering corkscrew, and a run-out under it.',
    detail:
      'A coil states the fall it runs at rather than taking one, so the angle connector ahead of it is bent to hand on exactly that — which is why the run tips before it reaches the tower. Its three turns were chosen rather than counted: left to itself a coil packs in every ring the height has room for, which is a taller-looking tower running at half the fall.',
    ...STOCK,
    parts: [tube(200), angle(0), corkscrew(220, 130, 80, 3), tube(220)],
  },
  {
    id: 'bowl-feed',
    name: 'Bowl Feed',
    category: 'starter',
    blurb: 'A funnel fed level, whirled twice round, and drained straight down.',
    detail:
      'A funnel is the fussiest part to bond by hand: it is fed dead level and leaves dead vertical, and neither is the run’s to set. Here the connector in front of it is already flat and the drop under it already vertical, with a second connector to flatten the run back out — the arrangement every funnel needs. The approach is long on purpose: the feed is level, so whatever crosses it does so on the speed it arrived with.',
    ...STOCK,
    parts: [
      tube(340),
      angle(-FALL),
      funnel(FUNNEL_DEFAULTS.mouthDiameter, FUNNEL_DEFAULTS.height, 2),
      ...fromFunnel(140),
      tube(220),
    ],
  },
  {
    id: 'grand-tour',
    name: 'Grand Tour',
    category: 'model',
    blurb:
      'Four levels wrapping right round the footprint, using every part in the library.',
    detail:
      'A finished run to take apart: it sets off across the top, folds back on a flat hook, whirls down a funnel onto the second level, wraps the footprint again, drops the third on a tapering corkscrew, ducks under itself on a hook stood on edge, and runs out along the floor. Straight, angle, corner, hook, corkscrew and funnel are all in it, most of them more than once — select any part and the sidebar shows what it was set to.',
    ...STOCK,
    parts: [
      /* ---- level one: out along the top, folded back on a flat hook ---- */
      tube(190),
      corner(75),
      pitch(),
      tube(210),
      hook(80, 180, HOOK_ROLL_FLAT),
      tube(150),
      corner(-75),
      pitch(),
      /* Long, because what comes next is fed level: the marble crosses the feed
         on the speed it arrives with and nothing else. */
      tube(300),

      /* ---- the funnel, down onto level two ---- */
      angle(-FALL),
      funnel(150, 100, 2),
      ...fromFunnel(150),

      /* ---- level two: right round the footprint ---- */
      tube(170),
      corner(80),
      pitch(),
      tube(200),
      corner(80),
      pitch(),
      tube(150),

      /* ---- the corkscrew, down onto level three ---- */
      angle(0),
      corkscrew(240, 140, 85, 3),
      tube(140),
      pitch(),

      /* ---- level three: back across, ducking under itself on edge ----
         A hook stood on edge hands the fall back mirrored, so entered downhill
         it would let go climbing. Entered level it is the part at its best: a
         clean drop of twice its own width, the run reversed, and the marble
         handed on level again to be tipped downhill by the connector after. */
      corner(70),
      pitch(),
      tube(180),
      pitch(0),
      hook(70, 180, HOOK_ROLL_EDGE),
      pitch(),
      tube(160),

      /* ---- level four: the run-out, turning back in under the start ---- */
      corner(-70),
      pitch(),
      tube(220),
      corner(80),
      pitch(),
      tube(210),
    ],
  },
]

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory | 'all', string> = {
  all: 'All templates',
  starter: 'Starters',
  model: 'Finished models',
}
