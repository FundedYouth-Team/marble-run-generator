import { create } from 'zustand'
import type { ExportFormat } from './lib/exporters'
import { formatLength, type Unit } from './lib/units'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  parseShortcuts,
  sameShortcut,
  type Shortcut,
  type ShortcutAction,
  type ShortcutMap,
} from './lib/shortcuts'
// Standing one run against another needs to know where its far end actually
// lands in the world, and the layout is the one place that works that out. It is
// only ever called from an action, so the two modules importing each other never
// meet at load time.
import { buildAssembly, chainBox } from './lib/layout'
// Plain geometry, and no idea this store exists — so the one part whose shape
// has to be solved rather than described can be solved in one place, and read
// here and by the centreline alike.
import { hookExit, hookFall, hookLength as hookRunLength, type HookTurn } from './lib/hook'
import {
  coilPlanLength,
  coilRingPitch,
  corkscrewExit,
  corkscrewFall,
  corkscrewLength as corkscrewRunLength,
  corkscrewSlope as coilSlope,
  type CorkscrewCoil,
} from './lib/corkscrew'

/**
 * All dimensions in this app are millimetres. The unit setting only changes how
 * they are written and read on screen — see `lib/units`.
 */
export type TubeVariant = 'half' | 'threequarter' | 'closed'
export type PieceType = 'straight' | 'angle' | 'corner' | 'hook' | 'corkscrew'
export type Mode = '2d' | '3d'
/**
 * What the left button does on the 3D stage. Picking a part is the resting
 * state; the other three are modal because each one reads a click as something
 * other than "select this" — a drag on the arrows, or one end of a joint.
 */
export type Tool = 'select' | 'move' | 'rotate' | 'connect' | 'disconnect'
/**
 * Which way the 2D draft looks at the run. The six ortho views are named for
 * the side of the model they are taken from, the same way the 3D view cube
 * names its faces — Left is the view from -X, Front the view from +Z.
 *
 * `developed` is the odd one out and the reason it is kept: it is not a
 * direction at all but a side-on section with every turn flattened out of it,
 * so a run that wanders still reads as one continuous fall.
 */
export type DraftView = 'developed' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export type Theme = 'light' | 'dark'
/** How the 3D pieces are shaded — see-through mode exposes the bore and the marble. */
export type Shading = 'solid' | 'transparent'
/** Which slide-out is showing on the right edge of the stage, if any. */
export type RightPanel = 'settings' | 'history' | 'ai' | null
/** Which column is folded out on the left edge of the workspace, if any. */
export type LeftPanel = 'parameters' | null

/**
 * A piece of on-screen furniture the user can switch off. None of these are
 * part of the run — they are readouts and helpers around it, and someone who
 * knows their way around may want the stage clear of them.
 */
export type Overlay = 'axes' | 'mouse' | 'parts' | 'scrubber'
export type OverlayMap = Record<Overlay, boolean>

/** Listed in the order they are offered in Settings. */
export const OVERLAYS: { id: Overlay; label: string; hint: string }[] = [
  {
    id: 'axes',
    label: 'Axis triad',
    hint: 'the red/green/blue X-Y-Z corner marker in 3D',
  },
  { id: 'mouse', label: 'Mouse guide', hint: 'what each button does, bottom right' },
  { id: 'parts', label: 'Active parts list', hint: 'the run’s parts, top left' },
  { id: 'scrubber', label: 'Simulator slider', hint: 'the transport bar along the bottom' },
]

const THEME_KEY = 'mrg.theme'
const PIECE_COLOR_KEY = 'mrg.pieceColor'
const MARBLE_COLOR_KEY = 'mrg.marbleColor'
const SHADING_KEY = 'mrg.shading'
const SCREEN_KEY = 'mrg.screenPxPerMm'
const KEEP_CONNECTED_KEY = 'mrg.keepConnected'
const UNITS_KEY = 'mrg.units'
const SHORTCUTS_KEY = 'mrg.shortcuts'
const OVERLAYS_KEY = 'mrg.overlays'

/**
 * CSS pins an inch to 96px no matter what the panel actually is, so this is
 * only a starting guess — real displays land anywhere from ~3 to ~6. Nothing
 * the browser exposes gives us the true figure; `devicePixelRatio` describes
 * CSS-to-device pixels, not physical size. Hence the calibration.
 */
export const NOMINAL_PX_PER_MM = 96 / 25.4

/** Outside this, it is a mis-drag rather than a display we believe in. */
export const PX_PER_MM_MIN = 2
export const PX_PER_MM_MAX = 7.5

/** ISO/IEC 7810 ID-1 — the bank card in everyone's pocket, to 0.1 mm. */
export const REFERENCE_CARD_MM = 85.6

/** Light is the default; only an explicit past choice flips it. */
function initialTheme(): Theme {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null
  return saved === 'dark' ? 'dark' : 'light'
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private-mode storage failures are not worth surfacing.
  }
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  remember(THEME_KEY, theme)
}

/** Appearance only — colours never reach the exported mesh. */
export const DEFAULT_PIECE_COLOR = '#8497aa'
export const DEFAULT_MARBLE_COLOR = '#ff7a45'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const HEX = /^#[0-9a-f]{6}$/i

/** A full 6-digit hex — what every colour in the app is stored as. */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v)
}

/** Falls back to the default unless a full 6-digit hex was stored. */
function initialColor(key: string, fallback: string): string {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  return isHexColor(saved) ? saved : fallback
}

/**
 * A stored value means the user has held something against the screen, so it
 * outranks the nominal guess. Junk or out-of-range falls back to uncalibrated.
 */
function initialScreen(): { pxPerMm: number; calibrated: boolean } {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(SCREEN_KEY) : null
  const n = saved === null ? NaN : Number(saved)
  return Number.isFinite(n) && n >= PX_PER_MM_MIN && n <= PX_PER_MM_MAX
    ? { pxPerMm: n, calibrated: true }
    : { pxPerMm: NOMINAL_PX_PER_MM, calibrated: false }
}

/** Solid is the default; only an explicit past choice flips it. */
function initialShading(): Shading {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(SHADING_KEY) : null
  return saved === 'transparent' ? 'transparent' : 'solid'
}

/** Connected is the default; the run is one assembly until you say otherwise. */
function initialKeepConnected(): boolean {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEEP_CONNECTED_KEY) : null
  return saved !== 'off'
}

/** Millimetres are the default; only an explicit past choice flips it. */
function initialUnits(): Unit {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(UNITS_KEY) : null
  return saved === 'in' ? 'in' : 'mm'
}

/**
 * Everything is on out of the box, so anything missing or unreadable in storage
 * reads as shown — an overlay is only hidden by an explicit past choice.
 */
function initialOverlays(): OverlayMap {
  const shown = { axes: true, mouse: true, parts: true, scrubber: true }
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(OVERLAYS_KEY) : null
  if (!saved) return shown
  try {
    const stored = JSON.parse(saved) as Partial<Record<Overlay, unknown>>
    for (const { id } of OVERLAYS) if (stored[id] === false) shown[id] = false
  } catch {
    // Junk in storage is no reason to start with a stripped stage.
  }
  return shown
}

/** The stock keys unless the user has re-bound something on this machine. */
function initialShortcuts(): ShortcutMap {
  return parseShortcuts(
    typeof localStorage !== 'undefined' ? localStorage.getItem(SHORTCUTS_KEY) : null,
  )
}

/**
 * The unit history steps are worded in, kept alongside the state so a label can
 * be written from module scope. Step labels are written once, when the edit
 * happens, and stand as written — a past step says what it said at the time.
 */
let labelUnits: Unit = initialUnits()

/**
 * Where a part that is not bonded to anything stands: the world point its inlet
 * sits on, and the heading it was set down facing. A part's own `turn` adds to
 * that heading, so the two together are where the run it starts sets off from.
 */
export interface Placement {
  x: number
  y: number
  z: number
  /** Heading the part is set down on, degrees. */
  yaw: number
}

export interface Piece {
  id: string
  type: PieceType
  /** Optional label from the parts list; blank falls back to the part name. */
  name?: string
  /**
   * Bonded onto the outlet of the part before it in the list. A part that is not
   * bonded stands on its own at {@link Piece.at} and starts a run of its own —
   * which is what every part is when it first lands on the stage. Joints are made
   * with the Connector tool and broken with the Disconnector.
   */
  joined?: boolean
  /**
   * Where the part stands while it is not bonded to anything. Ignored once it is
   * joined on: a bonded part takes its place from the part it is bonded to.
   */
  at?: Placement
  /**
   * Nominal run length along the tube axis, mm (excludes the snap spigot). On a
   * connector this is the rigid entry leg, up to the break.
   */
  length: number
  /** Downhill pitch of this piece, degrees. Positive = falling. */
  slope: number
  /** Heading change applied at the start of this piece, degrees. */
  turn: number
  /**
   * Angle connector: how far the run tips at the break, degrees. Positive
   * steepens the descent, negative lifts the outgoing leg back up.
   */
  bend?: number
  /**
   * Corner connector: how far the run swings at the break, degrees. Positive
   * turns right, negative left. The same idea as `bend`, laid on its side: the
   * break is about the tube's own up axis rather than across it.
   *
   * A hook carries its turn here too, and turns much further — right round and
   * back on itself. See {@link HOOK_SWEEP_LIMITS}.
   */
  sweep?: number
  /**
   * Hook: how wide the turn is, measured on the plane it turns on to the
   * centreline, mm. The whole footprint of the part comes off this — a half
   * turn sets the outgoing run twice this far off the incoming one.
   */
  radius?: number
  /**
   * Hook: how far the plane of the turn is rolled off level, degrees, right
   * the way round. Zero turns flat, the way a run wanders across a table; a
   * quarter turn stands the turn on edge, so it drops the run and brings it
   * back underneath itself; a half turn is flat again, the other way about;
   * three quarters is on edge again with the turn going the other way, up and
   * over the top; and a whole turn is back where it started.
   */
  roll?: number
  /**
   * Corkscrew: how far the coil drops from its top ring to its bottom one, mm.
   * The stubs either end of it fall as well, so the part as a whole loses a
   * little more than this.
   */
  height?: number
  /** Corkscrew: how wide the coil is where the run comes into it, mm. */
  topDiameter?: number
  /** Corkscrew: how wide it is where the run leaves it, mm. */
  bottomDiameter?: number
  /**
   * Corkscrew: how many times round the run goes between the two, in quarters
   * of a turn. Negative winds the other way about, the way a negative sweep
   * turns a corner the other way.
   */
  rings?: number
  /**
   * Corkscrew: whether the ring count above was set by hand rather than counted
   * off the room the height leaves — see {@link corkscrewRingsFor}.
   *
   * Counting is the ordinary case, and it is what an unset field means: the
   * coil packs its height as tightly as the tube allows and the fall follows.
   * Set by hand, the count stands wherever the height goes, which is how a coil
   * is given a fall of its own — fewer rings over the same height is a steeper
   * one, more is gentler.
   */
  ringsSet?: boolean
  /** Connectors: length of the leg after the break, mm. */
  exitLength?: number
  /**
   * Connectors: radius the break is rounded off with, mm. Zero is a sharp
   * corner; anything more is an arc tangent to both legs, so the marble carries
   * its speed through the change rather than slapping into a kink.
   */
  fillet?: number
  /**
   * This part's own tube style. Unset follows the run's style, so a part that
   * has never been styled on its own keeps up with whatever the run is set to.
   */
  variant?: TubeVariant
  /**
   * This part's own colour, as a 6-digit hex. Unset follows the run's colour,
   * so a part that has never been painted keeps up with whatever the run is set
   * to. Appearance only — colours never reach the exported mesh.
   */
  color?: string
  /**
   * This part's own bore, mm. Unset follows the run's, so a part that has never
   * been sized on its own keeps up with whatever the run is set to. A part sized
   * differently from the one it is bonded to steps at the joint — the two no
   * longer mate, which is what a bore change between parts really is.
   */
  innerDiameter?: number
  /** This part's own wall, mm. Unset follows the run's, like {@link Piece.innerDiameter}. */
  wallThickness?: number
  /** Hidden from the 3D view. Display only — the piece still shapes the run. */
  hidden?: boolean
}

/** Editing limits for a piece, shared by the sidebar fields and the draft handles. */
export const PIECE_LIMITS = {
  length: { min: 10, max: 600, step: 1 },
  // Straight down is as far as a part can point either way: past vertical it
  // would double back on itself, and the developed elevation has nowhere to
  // draw that.
  slope: { min: -90, max: 90, step: 0.5 },
  turn: { min: -90, max: 90, step: 1 },
  bend: { min: -90, max: 90, step: 1 },
  sweep: { min: -90, max: 90, step: 1 },
  exitLength: { min: 10, max: 600, step: 1 },
  fillet: { min: 0, max: 120, step: 1 },
  // Tighter than the bore is a turn the tube cannot be cut round; wider than
  // this is not a hook any more but a run that happens to bend.
  radius: { min: 20, max: 300, step: 1 },
  // The whole way round. Half a turn of roll is every *plane* there is — past
  // it the same planes come back the other way about — but the plane is not the
  // whole of it: rolled past the half turn, the axis points the other way, so a
  // turn that dropped the run underneath itself now takes it up and over
  // instead. Stopping at the half turn would mean only ever offering one of
  // those two, and a dial that jumped back to nothing halfway round.
  roll: { min: 0, max: 360, step: 1 },
  // A corkscrew's own four. Height is what the coil drops between its top and
  // bottom rings; the two widths are measured across the centreline, so a coil
  // narrower than the tube it is cut from would wind through itself.
  height: { min: 20, max: 800, step: 1 },
  topDiameter: { min: 40, max: 400, step: 1 },
  bottomDiameter: { min: 40, max: 400, step: 1 },
  // Rings are counted rather than set — see {@link corkscrewRingsFor} — but a
  // coil still has to stop somewhere: eight rings of tube is already longer
  // than any plate it could be printed on. Quarter rings, so the outlet lands
  // on a heading square to the inlet rather than wherever it happens to.
  rings: { min: -8, max: 8, step: 0.25 },
} as const

/**
 * What an angle connector is when it lands on the stage. Both legs are short
 * because the part exists to change the angle, not to carry the run, and the
 * corner arrives rounded so the marble rolls through the break instead of
 * hitting it.
 */
export const ANGLE_DEFAULTS = {
  length: 40,
  bend: 20,
  exitLength: 40,
  fillet: 18,
} as const

/** The angle connector's own numbers, with anything unset filled in. */
export function angleSpec(piece: Piece) {
  return {
    entry: piece.length,
    bend: piece.bend ?? ANGLE_DEFAULTS.bend,
    exit: piece.exitLength ?? ANGLE_DEFAULTS.exitLength,
    fillet: piece.fillet ?? ANGLE_DEFAULTS.fillet,
  }
}

/**
 * What a corner connector is when it lands on the stage. The same short legs
 * and rounded break as the angle connector — it is the same part turned on its
 * side — opening at a quarter of a quarter-turn, which is a change you can see
 * without being so tight the marble scrubs off all its speed.
 */
export const CORNER_DEFAULTS = {
  length: 40,
  sweep: 45,
  exitLength: 40,
  fillet: 18,
} as const

/** The corner connector's own numbers, with anything unset filled in. */
export function cornerSpec(piece: Piece) {
  return {
    entry: piece.length,
    sweep: piece.sweep ?? CORNER_DEFAULTS.sweep,
    exit: piece.exitLength ?? CORNER_DEFAULTS.exitLength,
    fillet: piece.fillet ?? CORNER_DEFAULTS.fillet,
  }
}

/**
 * What a hook is when it lands on the stage: a half turn, which is the whole
 * point of the part — the run leaves heading back the way it came, one turn
 * width to the side and lower down. The legs either side are stubs rather than
 * track, long enough to give the snap joint straight tube to sit on and no
 * longer, so the part is the turn and nothing else.
 */
export const HOOK_DEFAULTS = {
  length: 20,
  radius: 60,
  sweep: 180,
  exitLength: 20,
  /** Flat out of the library: the turn a run makes across a table. */
  roll: 0,
} as const

/** How far the turn is rolled at each of the two the buttons offer. */
export const HOOK_ROLL_FLAT = 0
export const HOOK_ROLL_EDGE = 90

/**
 * The hook's own numbers, with anything unset filled in — everything the turn
 * is solved from, which is why the entry slope travels with it.
 */
export function hookSpec(piece: Piece): HookTurn {
  return {
    entry: piece.length,
    radius: piece.radius ?? HOOK_DEFAULTS.radius,
    sweep: piece.sweep ?? HOOK_DEFAULTS.sweep,
    exit: piece.exitLength ?? HOOK_DEFAULTS.exitLength,
    slope: hookSlope(piece),
    roll: piece.roll ?? HOOK_DEFAULTS.roll,
  }
}

/**
 * A hook may turn the run right round, either way — which is further than a
 * corner's break is ever allowed to go, so it keeps limits of its own.
 */
export const HOOK_SWEEP_LIMITS = { min: -180, max: 180, step: 1 } as const

/**
 * The steepest a hook may come into its turn, degrees. Turning flat it falls
 * all the way round, which stretches the arc by 1/cos(slope): past this the
 * part is more drop than turn, and at vertical it would never come round at
 * all. A turn stood on edge does not stretch — but a hook is one part with one
 * limit, and a run falling at more than this has other problems.
 */
export const HOOK_SLOPE_LIMIT = 60

const RAD = Math.PI / 180

/** The fall a hook actually turns at, held inside what a helix can be built on. */
export function hookSlope(piece: Piece): number {
  return clamp(piece.slope, -HOOK_SLOPE_LIMIT, HOOK_SLOPE_LIMIT)
}

/** Centreline length of a hook, mm — both stubs and the turn between them. */
export function hookLength(piece: Piece): number {
  return hookRunLength(hookSpec(piece))
}

/** How far a hook's outlet sits below its inlet, mm. Negative climbs. */
export function hookDrop(piece: Piece): number {
  return hookFall(hookSpec(piece))
}

/**
 * What a corkscrew is when it lands on the stage: three rings winding down and
 * in, losing rather more height than a length of track would in the same
 * footprint — which is the whole point of the part. The stubs either end are
 * the same as a hook's, long enough to give the snap joint straight tube to sit
 * on and no longer.
 */
export const CORKSCREW_DEFAULTS = {
  length: 20,
  height: 180,
  topDiameter: 120,
  bottomDiameter: 70,
  exitLength: 20,
} as const

/**
 * Air left between one ring and the next, mm.
 *
 * Rings that touch make a solid tower: nothing to see the marble through, and
 * on an open trough the ring above comes down right on the slot the marble runs
 * in. This is the daylight between the two tubes, over and above the tube
 * itself.
 */
export const COIL_RING_GAP = 6

/** How far apart the rings have to sit, mm — a whole tube across, plus the air. */
export function corkscrewRingSpacing(outerR: number): number {
  return outerR * 2 + COIL_RING_GAP
}

/**
 * How many rings a coil of this height has room for, out of tube this thick.
 *
 * The rings are counted rather than set: a corkscrew is a stack of them, and
 * how many will stack is a question its height and its tube answer between
 * them, not one there is a free choice about. Give it more height and another
 * ring goes in; cut it from fatter tube and one comes out.
 *
 * Counted down to whole quarter turns, which is what keeps the outlet on a
 * heading square to the inlet — a coil that stopped wherever the arithmetic
 * landed would leave the run pointing 104° round from where it went in. The
 * quarter left over is spread back through the coil rather than dropped, so the
 * rings still sit a little further apart than the very least they could.
 */
export function corkscrewRingsFor(height: number, outerR: number): number {
  const step = PIECE_LIMITS.rings.step
  // A climbing coil — a descending one travelled backwards — stacks its rings
  // exactly as it did falling, so the count goes by the bare height.
  const fits = Math.floor(Math.abs(height) / corkscrewRingSpacing(outerR) / step) * step
  // Below a quarter turn there is no coil left to speak of, so that is the
  // floor — and a corkscrew squeezed that far is the one case where the rings
  // really can wind through one another.
  return clamp(fits, step, PIECE_LIMITS.rings.max)
}

/**
 * The corkscrew's own numbers, with anything unset filled in.
 *
 * The rings here are the ones the part is carrying, which is the count its
 * space allowed when it was last settled — see {@link settle}. Everything that
 * draws or measures the part reads it from here, so the shape a part has is one
 * thing rather than something each caller works out again off a tube it may not
 * know about.
 */
export function corkscrewSpec(piece: Piece): CorkscrewCoil {
  return {
    entry: piece.length,
    topRadius: (piece.topDiameter ?? CORKSCREW_DEFAULTS.topDiameter) / 2,
    bottomRadius: (piece.bottomDiameter ?? CORKSCREW_DEFAULTS.bottomDiameter) / 2,
    turns: piece.rings ?? 1,
    height: piece.height ?? CORKSCREW_DEFAULTS.height,
    exit: piece.exitLength ?? CORKSCREW_DEFAULTS.exitLength,
  }
}

/** Which way a coil winds: -1 for a left-hand one, +1 for a right-hand one. */
export function corkscrewHand(piece: Piece): number {
  return (piece.rings ?? 1) < 0 ? -1 : 1
}

/**
 * The fall a corkscrew runs at, degrees — worked out from the coil rather than
 * given to it. See {@link slopeIsFixed}.
 */
export function corkscrewPitch(piece: Piece): number {
  return tidy(coilSlope(corkscrewSpec(piece)))
}

/** Centreline length of a corkscrew, mm — both stubs and the coil between them. */
export function corkscrewLength(piece: Piece): number {
  return corkscrewRunLength(corkscrewSpec(piece))
}

/** How far a corkscrew's outlet sits below its inlet, mm. */
export function corkscrewDrop(piece: Piece): number {
  return corkscrewFall(corkscrewSpec(piece))
}

/** How long one lap of the coil is in plan, mm — the tape measure round it. */
export function corkscrewPlan(piece: Piece): number {
  return coilPlanLength(corkscrewSpec(piece))
}

/** How far apart the rings sit, mm, centre to centre of the tube. */
export function corkscrewRingPitch(piece: Piece): number {
  return coilRingPitch(corkscrewSpec(piece))
}

/**
 * Whether a part's fall is its own to keep rather than the run's to set.
 *
 * Every other part takes whatever angle the part before it hands on. A
 * corkscrew cannot: its four numbers already fix how far it goes round and how
 * far it drops doing it, and those two between them leave exactly one angle the
 * coil can run at. So the part states its fall and the run has to meet it — a
 * printed helix is a fixed thing, and this is what makes it behave like one.
 */
export function slopeIsFixed(piece: Piece): boolean {
  return piece.type === 'corkscrew'
}

/**
 * A part put back on the shape its own numbers demand: the rings its height has
 * room for, and the fall those rings leave it running at. Only a corkscrew has
 * either; everything else is handed its fall by the run and is left alone.
 *
 * `outerR` is the tube this part is actually cut from, which is what says how
 * much room a ring takes up. The count is worked out here and then *stored*
 * rather than derived on demand, because the centreline — the one description
 * of a part's shape — is given nothing but the part, and knows nothing about
 * the tube the run is set to.
 */
function settle(piece: Piece, outerR: number): Piece {
  if (!slopeIsFixed(piece)) return piece
  const height = piece.height ?? CORKSCREW_DEFAULTS.height
  const R = PIECE_LIMITS.rings
  // A count set by hand stands as it was given; otherwise it is counted off the
  // room the height leaves. Which way the coil winds is a choice either way, so
  // the sign is carried across rather than taken from the count.
  const count = piece.ringsSet
    ? clamp(Math.abs(piece.rings ?? 1), R.step, R.max)
    : corkscrewRingsFor(height, outerR)
  const rings = count * corkscrewHand(piece)
  const wound = piece.rings === rings ? piece : { ...piece, rings }
  const slope = corkscrewPitch(wound)
  return wound.slope === slope ? wound : { ...wound, slope }
}

/**
 * Every part in the list settled against the tube it is cut from — its own if
 * it has been sized on its own, and otherwise the run's.
 *
 * This runs on the way out of every edit, so nothing has to remember which
 * fields a coil watches: changing its height settles it, and so does changing
 * the tube under it from the other side of the sidebar.
 */
function settleAll(pieces: Piece[], runBore: number, runWall: number): Piece[] {
  if (!pieces.some(slopeIsFixed)) return pieces
  let changed = false
  const next = pieces.map((p) => {
    const settled = settle(p, boreOf(p, runBore) / 2 + wallOf(p, runWall))
    if (settled !== p) changed = true
    return settled
  })
  return changed ? next : pieces
}

/**
 * The pitch a part hands on to whatever follows it. A plain tube leaves at the
 * angle it arrived at; the two connectors are the parts that do not.
 *
 * A corner turns in its own plane, and that plane is tipped over by the slope
 * the corner enters at, so the further it swings the shallower the run leaves:
 * a quarter turn puts the exit leg dead across the fall, and it comes out
 * level. That is what a flat elbow really does when you tilt it downhill.
 *
 * A hook turning flat is the answer to that: its turn is a helix about the
 * upright rather than a tipped plane, so it falls at one steady angle the whole
 * way round and hands on exactly what it was given — which is the only way a
 * part can turn the run right round and still be running downhill when it lets
 * go. Roll that turn onto its edge and it is a different part again: end over
 * end, the fall comes out mirrored. Either way the answer is read off the turn
 * itself rather than described here.
 */
export function exitSlope(piece: Piece): number {
  if (piece.type === 'angle') return piece.slope + angleSpec(piece).bend
  if (piece.type === 'hook') return tidy(hookExit(hookSpec(piece)).slope)
  // A coil holds one fall the whole way down, so it hands on the one it runs
  // at — which is its own rather than whatever it was handed.
  if (piece.type === 'corkscrew') return corkscrewPitch(piece)
  if (piece.type === 'corner') {
    const drop = Math.sin(piece.slope * RAD) * Math.cos(cornerSpec(piece).sweep * RAD)
    return tidy(Math.asin(clamp(drop, -1, 1)) / RAD)
  }
  return piece.slope
}

/**
 * How far a part swings the run's heading between its inlet and its outlet,
 * degrees — the plan-view companion to {@link exitSlope}. Two parts do.
 *
 * A hook turning flat turns about the upright itself, so the heading moves by
 * exactly the turn it was given, however steeply the run is falling through it.
 * Rolled onto its edge the same turn barely swings the heading at all until it
 * is far enough round to come back the other way, so the turn is solved rather
 * than assumed. A corner turns in the tipped plane instead, and on a falling
 * run that swings the heading a little further than its own sweep: heading is
 * measured about the vertical, and the corner's plane is not.
 */
export function exitTurn(piece: Piece): number {
  if (piece.type === 'hook') return tidy(hookExit(hookSpec(piece)).turn)
  // Very nearly the rings turned into degrees, and only nearly: a coil that
  // narrows meets its own radius at a different angle top and bottom.
  if (piece.type === 'corkscrew') return tidy(corkscrewExit(corkscrewSpec(piece)).turn)
  if (piece.type !== 'corner') return 0
  const sweep = cornerSpec(piece).sweep * RAD
  return tidy(
    Math.atan2(Math.sin(sweep), Math.cos(sweep) * Math.cos(piece.slope * RAD)) / RAD,
  )
}

/**
 * The sweep a corner needs to swing the run's heading by `turn` when it enters
 * at `slope` — {@link exitTurn} read backwards, for the drags that are given a
 * heading and have to find the sweep that lands on it.
 */
export function sweepForTurn(turn: number, slope: number): number {
  const t = turn * RAD
  return tidy(Math.atan2(Math.sin(t) * Math.cos(slope * RAD), Math.cos(t)) / RAD)
}

/**
 * The heading a part enters at, degrees: the heading its run was set down on,
 * plus every turn ahead of it in that run and every corner those parts swung
 * through. A part on its own is measured from its own placement, so one run's
 * heading says nothing about the next one's.
 */
export function headingAt(pieces: Piece[], index: number): number {
  if (index < 0 || index >= pieces.length) return 0
  const from = chainRootOf(pieces, index)
  let yaw = placementOf(pieces[from]).yaw
  for (let i = from; i <= index; i++) {
    if (i > from) yaw += exitTurn(pieces[i - 1])
    yaw += pieces[i].turn
  }
  return tidy(yaw)
}

/**
 * How far a part's entry may swing, and how far a connector may break. Both are
 * held to what the run can actually take up: a connector leaves at slope+bend,
 * and the part hanging off it has to be able to sit at that angle. Offering a
 * bend the next part cannot match is what tears a joint open — the run should
 * run out of travel instead, at the handle the user is dragging.
 */
export function slopeLimitsFor(piece: Piece) {
  const S = PIECE_LIMITS.slope
  if (piece.type === 'hook' || piece.type === 'corkscrew') return { ...S, ...slopeRange(piece) }
  if (piece.type !== 'angle') return S
  const { bend } = angleSpec(piece)
  return { ...S, min: Math.max(S.min, S.min - bend), max: Math.min(S.max, S.max - bend) }
}

/**
 * How far a part's own slope may go, as the walks along a run read it. A hook
 * narrows it — see {@link HOOK_SLOPE_LIMIT} — and a corkscrew closes it to the
 * single angle its coil runs at, which is what pins the part to its own fall
 * wherever the run tries to swing it. An angle connector's extra room is the
 * bend's business rather than the walk's, so it is not applied here.
 */
const slopeRange = (piece: Piece) =>
  piece.type === 'hook'
    ? { min: -HOOK_SLOPE_LIMIT, max: HOOK_SLOPE_LIMIT }
    : piece.type === 'corkscrew'
      ? { min: corkscrewPitch(piece), max: corkscrewPitch(piece) }
      : PIECE_LIMITS.slope

/** How far a part's break may swing — a hook turns much further than a corner. */
export function sweepLimitsFor(piece: Piece) {
  return piece.type === 'hook' ? HOOK_SWEEP_LIMITS : PIECE_LIMITS.sweep
}

export function bendLimitsFor(piece: Piece) {
  const S = PIECE_LIMITS.slope
  const B = PIECE_LIMITS.bend
  return { ...B, min: Math.max(B.min, S.min - piece.slope), max: Math.min(B.max, S.max - piece.slope) }
}

/**
 * How far a connector's entry leg may swing while the outgoing leg is held
 * where it is. Whatever the entry takes, the bend gives back, so the leg runs
 * out of travel at whichever of the two limits comes first.
 */
export function entrySwingLimitsFor(piece: Piece) {
  const S = PIECE_LIMITS.slope
  const B = PIECE_LIMITS.bend
  const exit = exitSlope(piece)
  return { ...S, min: Math.max(S.min, exit - B.max), max: Math.min(S.max, exit - B.min) }
}

/** Kills the float dust a chain of additions leaves on an angle. */
const tidy = (deg: number) => Math.round(deg * 1e6) / 1e6

/**
 * An angle as it is shown. A corner hands on angles that are no longer round
 * numbers — a run welded to one lands on 4.238756° and means it — but a tenth
 * of a degree is as fine as a drawing reads, so that is what is drawn.
 */
export const degLabel = (deg: number) => String(Math.round(deg * 10) / 10)

/** How much of `swing` a value can take before it runs into its own limits. */
const roomFor = (value: number, swing: number, lim: { min: number; max: number }) =>
  clamp(value + swing, lim.min, lim.max) - value

/** Holds a swing down to the least any one part it moves can give it. */
const narrow = (swing: number, room: number) => (Math.abs(room) < Math.abs(swing) ? room : swing)

/**
 * A place another part can be joined on: the inlet a part is fed through, or
 * the outlet it hands the marble out of. Naming the part rather than an index
 * keeps a port pointing at the same joint while the run is edited around it.
 */
export interface Port {
  pieceId: string
  end: 'in' | 'out'
}

/** Two ports name the same end of the same part. */
export function samePort(a: Port | null, b: Port | null): boolean {
  return !!a && !!b && a.pieceId === b.pieceId && a.end === b.end
}

/** Where a part stands on its own — the origin, for one that has never been set down. */
export const ORIGIN_PLACEMENT: Placement = { x: 0, y: 0, z: 0, yaw: 0 }

export function placementOf(piece: Piece): Placement {
  return piece.at ?? ORIGIN_PLACEMENT
}

/**
 * Whether the part at `index` starts a run of its own: nothing is bonded to its
 * inlet, so it stands where it was put rather than off the end of the part
 * before it. The first part in the list is always one — there is nothing ahead
 * of it to be bonded to.
 */
export function isChainRoot(pieces: Piece[], index: number): boolean {
  return index === 0 || !pieces[index].joined
}

/**
 * The runs the parts make up, each as its own list of indices in order. A part
 * that has never been joined onto anything is a run of one, which is how it
 * lands on the stage.
 */
export function chainsOf(pieces: Piece[]): number[][] {
  const chains: number[][] = []
  pieces.forEach((_, i) => {
    if (isChainRoot(pieces, i)) chains.push([i])
    else chains[chains.length - 1].push(i)
  })
  return chains
}

/** The part the run containing `index` starts at. */
export function chainRootOf(pieces: Piece[], index: number): number {
  let i = index
  while (i > 0 && !isChainRoot(pieces, i)) i--
  return i
}

/** The last part of the run containing `index` — the end nothing is bonded to. */
export function chainTailOf(pieces: Piece[], index: number): number {
  let i = index
  while (i + 1 < pieces.length && pieces[i + 1].joined) i++
  return i
}

/**
 * Whether a port has nothing bonded to it: the inlet of a part that starts a
 * run, or the outlet at the end of one. Those are the only two ends the
 * Connector has anything to do — every other port is already inside a joint.
 */
export function isOpenPort(pieces: Piece[], port: Port): boolean {
  const i = pieces.findIndex((p) => p.id === port.pieceId)
  if (i < 0) return false
  return port.end === 'in' ? isChainRoot(pieces, i) : chainTailOf(pieces, i) === i
}

/**
 * The shape a part takes when it is described from its far end instead of its
 * near one — the very same piece of tube, travelled the other way.
 *
 * Both legs swap over, since the leg you leave by is the leg you now arrive on.
 * Past that it goes by what the break is measured about. An angle connector
 * breaks about the level axis across the run, and turning the part round turns
 * that axis round with it, so the break keeps its sign. A corner breaks about
 * the tube's own up axis, which stays pointing up however the part is turned,
 * so its break changes sign — and so does a hook's turn, and the wind of a
 * coil. A coil's two widths swap over with its legs, and its drop becomes a
 * climb.
 *
 * All of this is measured rather than assumed: a mirrored part is only right if
 * it lies on exactly the ground the original did, walked backwards.
 */
function reverseShape(piece: Piece): Partial<Piece> {
  const legs = { length: piece.exitLength ?? piece.length, exitLength: piece.length }
  if (piece.type === 'angle') return legs
  if (piece.type === 'corner' || piece.type === 'hook') {
    return { ...legs, sweep: tidy(-(piece.sweep ?? 0)) }
  }
  if (piece.type === 'corkscrew') {
    return {
      ...legs,
      topDiameter: piece.bottomDiameter,
      bottomDiameter: piece.topDiameter,
      height: -(piece.height ?? CORKSCREW_DEFAULTS.height),
      rings: -(piece.rings ?? 1),
    }
  }
  return {}
}

/**
 * Whether a part can be described from its far end at all.
 *
 * Only a hook cannot, and only when it is rolled off both the flat and the
 * edge. A hook's turn runs about an axis the part is only able to name in the
 * plane square to the way it came in — and turned round, the way it came in is
 * somewhere else. On the quarter planes that works out: the axis is either dead
 * upright or dead across, and both of those still lie in the new plane. Rolled
 * between them it does not, and there is no hook that lies on the same ground
 * backwards. Measured, not argued: off the quarters the nearest hook to the
 * mirror is tens of millimetres from it.
 */
export function canReverse(piece: Piece): boolean {
  return piece.type !== 'hook' || (piece.roll ?? HOOK_DEFAULTS.roll) % 90 === 0
}

/** Whether the whole run a part belongs to can be turned end for end. */
export function canReverseChain(pieces: Piece[], index: number): boolean {
  const tail = chainTailOf(pieces, index)
  for (let i = chainRootOf(pieces, index); i <= tail; i++) {
    if (!canReverse(pieces[i])) return false
  }
  return true
}

/**
 * A run turned end for end: the same parts in the opposite order, each one
 * described from its far end, so the marble now travels it the other way.
 *
 * Two things have to be walked back along with the parts. A part's fall is the
 * angle it stands at, so turned round it starts at the negation of what it used
 * to leave at. And a part's turn is the heading it picks up at its own inlet,
 * which turned round is the one the part that used to follow it picked up —
 * negated, since the run now comes at it from the other side. The old tail
 * becomes the new head, and a head takes its heading from where it stands
 * rather than from a part in front of it, so its turn goes to nothing.
 *
 * A corner is the one part this is not exact for. Its break is measured on a
 * plane the entry slope tips over, and turned round it enters at a different
 * slope, so the plane tips differently: on a run falling at 6° a mirrored
 * corner lands within a millimetre or two of where it was, and a good deal
 * further out on a steep one. The joints are welded shut afterwards, so the run
 * stays whole — it is the odd millimetre of its shape that moves, not its
 * joints.
 */
function reverseChain(pieces: Piece[], root: number, tail: number): Piece[] {
  const run = pieces.slice(root, tail + 1)
  return run
    .map((piece, i) => ({
      ...piece,
      ...reverseShape(piece),
      slope: tidy(-exitSlope(piece)),
      turn: i === run.length - 1 ? 0 : tidy(-run[i + 1].turn),
    }))
    .reverse()
    .map((piece, j) => ({ ...piece, joined: j > 0 ? true : undefined, at: undefined }))
}

/**
 * The run a port belongs to, turned end for end and stood back down on exactly
 * the ground it was on: the new head starts where the old tail's outlet was,
 * facing back the way that outlet pointed.
 */
function turnRunAround(pieces: Piece[], port: Port): Piece[] {
  const i = pieces.findIndex((p) => p.id === port.pieceId)
  if (i < 0) return pieces
  const root = chainRootOf(pieces, i)
  const tail = chainTailOf(pieces, i)
  const far = buildAssembly(pieces).placed.find((p) => p.index === tail)
  const run = reverseChain(pieces, root, tail)
  if (far) {
    run[0] = {
      ...run[0],
      at: {
        x: tidy(far.end.x),
        y: tidy(far.end.y),
        z: tidy(far.end.z),
        yaw: tidy((Math.atan2(-far.exitDir.x, -far.exitDir.z) * 180) / Math.PI),
      },
    }
  }
  return [...pieces.slice(0, root), ...run, ...pieces.slice(tail + 1)]
}

/**
 * Whether two open ports can be bonded together. Joining a run's own tail back
 * onto its own head would close it into a loop, which a marble run is not.
 *
 * Two like ends have nothing to mate as they stand — a spigot needs a socket —
 * so one of the two runs has to be turned end for end first. The run picked
 * first is the one that travels, so that is the one turned round, and the pair
 * only takes a joint if it can be. See {@link reverseChain}.
 */
export function canConnect(pieces: Piece[], a: Port, b: Port): boolean {
  if (!isOpenPort(pieces, a) || !isOpenPort(pieces, b)) return false
  const ia = pieces.findIndex((p) => p.id === a.pieceId)
  const ib = pieces.findIndex((p) => p.id === b.pieceId)
  if (ia < 0 || ib < 0) return false
  if (chainRootOf(pieces, ia) === chainRootOf(pieces, ib)) return false
  return a.end === b.end ? canReverseChain(pieces, ia) : true
}

/** The other end of a part from the one named. */
const otherEnd = (port: Port): Port => ({
  pieceId: port.pieceId,
  end: port.end === 'out' ? 'in' : 'out',
})

/**
 * The angle each joint stands at: what a part enters at, less what the part
 * before it leaves at. Zero is a joint pulled shut; anything else is a kink,
 * and a kink the user built on purpose is theirs to keep. A part that starts a
 * run has no joint behind it to measure.
 */
function kinksOf(pieces: Piece[]): number[] {
  return pieces.map((p, i) =>
    isChainRoot(pieces, i) ? 0 : tidy(p.slope - exitSlope(pieces[i - 1])),
  )
}

/**
 * Walks a stretch of the run and puts each part back on the angle its own joint
 * had: the exit of the part before it, plus whatever kink was already there.
 *
 * A tube hands on exactly what it was swung by, so on a run of tubes this is
 * the same uniform swing it has always been. A corner does not — it turns
 * across the fall, so it hands on less than it takes — and this walk is what
 * keeps the joint after one shut. A part taken past vertical stops there; the
 * run runs out of travel at that part rather than everywhere at once.
 *
 * A part that is not bonded to the one before it is left alone, and with it
 * everything bonded behind it: a swing travels along one run and stops where
 * that run ends, rather than dragging every other part on the stage with it.
 */
function relink(pieces: Piece[], kinks: number[], from: number, to: number): Piece[] {
  const next = pieces.slice()
  let changed = false
  for (let i = Math.max(1, from); i <= Math.min(to, next.length - 1); i++) {
    if (!next[i].joined) continue
    // Each part is relinked to the one already relinked before it, so a single
    // pass carries a correction all the way down the run.
    const S = slopeRange(next[i])
    const slope = tidy(clamp(exitSlope(next[i - 1]) + kinks[i], S.min, S.max))
    if (slope === next[i].slope) continue
    next[i] = { ...next[i], slope }
    changed = true
  }
  return changed ? next : pieces
}

/**
 * The parts are bonded together, so a joint that holds has to keep holding.
 * When an edit swings what one part leaves at, the run downstream is walked
 * back into line behind it: a joint that was flush stays flush, and a kink the
 * user built on purpose is carried along rather than quietly closed up.
 *
 * `delta` is how far the part at `from` has just moved what it hands on, which
 * is what the joint right behind it has to be measured off — that part has
 * already been edited by the time this is called.
 */
function carrySlope(pieces: Piece[], from: number, delta: number, connected: boolean): Piece[] {
  if (!connected || !delta || from + 1 >= pieces.length) return pieces
  const kinks = kinksOf(pieces)
  // The joint just past the edit was standing where the part used to leave it.
  kinks[from + 1] = tidy(kinks[from + 1] + delta)
  return relink(pieces, kinks, from + 1, pieces.length - 1)
}

/**
 * Pulls every joint in the run shut: each part starts at the angle the one
 * before it leaves at. This is what Keep connected does to a run that was drawn
 * with its joints free.
 */
function weldJoints(pieces: Piece[]): Piece[] {
  return relink(pieces, pieces.map(() => 0), 1, pieces.length - 1)
}

/**
 * Swings a whole run in elevation, from its head. Every joint along it is left
 * standing at the angle it already had, so the run turns as one piece rather
 * than opening up somewhere in the middle.
 */
function swingRun(pieces: Piece[], root: number, tail: number, delta: number): Piece[] {
  const S = slopeRange(pieces[root])
  const kinks = kinksOf(pieces)
  const next = pieces.slice()
  next[root] = { ...next[root], slope: clamp(tidy(next[root].slope + delta), S.min, S.max) }
  return relink(next, kinks, root + 1, tail)
}

/** How close a swing has to land on the angle it was aiming at, degrees. */
const ALIGN_TOLERANCE = 1e-4
/** Runs of turns are closed in on rather than solved; this is the give-up point. */
const ALIGN_PASSES = 8

/**
 * The other half of {@link carrySlope}, for the joint at a part's inlet.
 *
 * A part's fall is the angle it stands at, not the angle it makes with the one
 * before it, so putting it on a new fall moves it away from whatever it is
 * bonded to. `carrySlope` brings the run in front along; this brings the run
 * behind — back to the head of its own run — until the part before it hands on
 * exactly what the part now starts at. The run swings as one piece rather than
 * tearing at that one joint, and between the two a part can be put on any fall
 * with both of its joints holding.
 *
 * It closes the joint rather than carrying whatever angle it stood at, which is
 * what Keep connected promises: turning it on pulls every joint in the run shut
 * — see {@link weldJoints} — so a joint left standing open under it is one that
 * could not be closed, not one anybody asked for.
 *
 * A part on a fall of its own — a corkscrew's is set by its coil — cannot be
 * swung, and stands as the far end of the swing rather than killing it: the run
 * between it and the part being moved still comes round, and the joint at the
 * coil is the one that opens.
 */
function swingBehind(pieces: Piece[], at: number, delta: number, connected: boolean): Piece[] {
  if (!connected || !delta || at < 1 || !pieces[at].joined) return pieces
  const root = chainRootOf(pieces, at)
  let from = root
  for (let i = at - 1; i >= root; i--) {
    if (!slopeIsFixed(pieces[i])) continue
    from = i + 1
    break
  }
  if (from >= at) return pieces
  let next = pieces.slice()
  let was = exitSlope(next[at - 1])
  // What the part before has to end up handing on, for the joint to sit flush.
  const target = pieces[at].slope
  // A turn among the parts being brought round hands on less than it was swung
  // by — a hook can hand on a fall that moves the other way entirely — so each
  // pass measures what the last one bought and takes the next step off that,
  // the same closing-in {@link alignRun} does and for the same reason. A run of
  // tubes and angle connectors moves one for one and lands on the first pass.
  let step = tidy(target - was)
  for (let i = 0; i < ALIGN_PASSES && Math.abs(step) >= ALIGN_TOLERANCE; i++) {
    next = swingRun(next, from, at - 1, step)
    const now = exitSlope(next[at - 1])
    const left = tidy(target - now)
    if (Math.abs(left) < ALIGN_TOLERANCE) break
    // Nothing bought means the run is held at a stop somewhere and no further
    // pass will shift it: the joint opens rather than the run turning for ever.
    const bought = (now - was) / step
    if (Math.abs(bought) < 1e-6) break
    was = now
    step = tidy(left / bought)
  }
  return next
}

/**
 * Brings the run that ends at `outlet` round to meet `inlet`, which does not
 * move: the run is swung until it leaves at the angle and heading the other one
 * enters at, then set down so the two ends touch.
 *
 * This is what lets the end picked first be the one that travels. A joint has to
 * bring two frames into line, and only one of the two runs can keep its own —
 * whichever end was picked second is the one that keeps it.
 *
 * A run with a turn in it cannot be swung in elevation exactly: a corner tipped
 * further over turns across a different amount of the fall, so the angle it hands
 * on does not move one for one with the swing — and a hook stood on edge hands
 * on a fall that moves the *other* way, since end over end mirrors it. So each
 * pass measures what the last one actually bought and takes the next step off
 * that. A run of tubes and angle connectors moves one for one and lands first
 * time, as it always did.
 */
function alignRun(pieces: Piece[], outlet: Port, inlet: Port): Piece[] {
  const from = pieces.findIndex((p) => p.id === outlet.pieceId)
  const onto = pieces.findIndex((p) => p.id === inlet.pieceId)
  if (from < 0 || onto < 0) return pieces
  const root = chainRootOf(pieces, from)
  const target = pieces[onto]
  // The run being joined onto stands where it was set down — its inlet could not
  // have been free to join if it were anything but a run's head.
  const seat = placementOf(target)
  let next = pieces.slice()

  // The first step assumes the run hands on whatever it is swung by, which is
  // exactly true of tubes and angle connectors and the right opening guess for
  // everything else.
  let was = exitSlope(next[from])
  let step = tidy(target.slope - was)
  for (let i = 0; i < ALIGN_PASSES && Math.abs(step) >= ALIGN_TOLERANCE; i++) {
    next = swingRun(next, root, from, step)
    const now = exitSlope(next[from])
    const left = tidy(target.slope - now)
    if (Math.abs(left) < ALIGN_TOLERANCE) break
    // How much of that swing the run actually handed on. Nothing at all means
    // it is held at a stop somewhere and no further pass will shift it.
    const bought = (now - was) / step
    if (Math.abs(bought) < 1e-6) break
    was = now
    step = tidy(left / bought)
  }

  // Heading: a run's placement carries the whole swing round, so this is one
  // number rather than a walk along the parts.
  const swung = placementOf(next[root])
  const yaw = tidy(
    swung.yaw +
      tidy(seat.yaw + target.turn) -
      tidy(headingAt(next, from) + exitTurn(next[from])),
  )
  next[root] = { ...next[root], at: { ...swung, yaw } }

  // Position: pointing the right way at last, the run slides along until its
  // outlet is on the other one's inlet.
  const placed = buildAssembly(next.slice(root, from + 1)).placed
  const end = placed[placed.length - 1]?.end
  if (end) {
    next[root] = {
      ...next[root],
      at: {
        x: tidy(swung.x + seat.x - end.x),
        y: tidy(swung.y + seat.y - end.y),
        z: tidy(swung.z + seat.z - end.z),
        yaw,
      },
    }
  }
  return next
}

/** Editing limits for the tube every part is cut from, shared by the sidebar and file loading. */
export const TUBE_LIMITS = {
  innerDiameter: { min: 6, max: 80, step: 0.5 },
  wallThickness: { min: 1, max: 12, step: 0.5 },
} as const

export const VARIANT_LABEL: Record<TubeVariant, string> = {
  half: 'Half',
  threequarter: '3/4 Open',
  closed: 'Closed',
}

/** Fraction of the circumference that is solid wall. */
export const VARIANT_COVERAGE: Record<TubeVariant, number> = {
  half: 0.5,
  threequarter: 0.7,
  closed: 1,
}

/**
 * The style a part is actually cut in: its own, if it has been given one, and
 * otherwise the run's — which is what lets one setting still carry every part
 * that has not been styled on its own.
 */
export function variantOf(piece: Piece, runVariant: TubeVariant): TubeVariant {
  return piece.variant ?? runVariant
}

/**
 * The colour a part is actually drawn in: its own, if it has been painted, and
 * otherwise the run's — the same fallback the tube style works on, so one
 * setting still carries every part that has not been painted on its own.
 */
export function colorOf(piece: Piece, runColor: string): string {
  return piece.color ?? runColor
}

/**
 * The bore a part is actually cut to: its own, if it has been sized, and
 * otherwise the run's — the same fallback style and colour work on.
 */
export function boreOf(piece: Piece, runBore: number): number {
  return piece.innerDiameter ?? runBore
}

/** The wall a part is actually cut to: its own if it has one, else the run's. */
export function wallOf(piece: Piece, runWall: number): number {
  return piece.wallThickness ?? runWall
}

/** Whether a part is cut from the very tube the run is set to — no size of its own. */
export function sizedLikeRun(piece: Piece, runBore: number, runWall: number): boolean {
  return boreOf(piece, runBore) === runBore && wallOf(piece, runWall) === runWall
}

/** A standard glass marble — the 5/8" size sold by the bag. */
export const STANDARD_MARBLE = 16
/** Diametral slack around the marble, so it rolls freely instead of binding. */
export const MARBLE_CLEARANCE = 4
/** Bore that a standard marble rolls through comfortably. */
export const STANDARD_BORE = STANDARD_MARBLE + MARBLE_CLEARANCE

/** What every new project is called until it is given a name. */
export const UNTITLED_PROJECT = 'Untitled'

/**
 * Filename-safe form of the project name — this is what exports are named
 * after, so "Big Drop v2" writes `big-drop-v2-plate-3pc.3mf`.
 */
export function projectSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

/**
 * The name every export is written under: whatever was typed in the Export
 * panel, and the project's own name whenever that field is left blank.
 */
export function exportBasename(s: { projectName: string; exportName: string }): string {
  return projectSlug(s.exportName.trim() ? s.exportName : s.projectName)
}

/** What each part type is called wherever a piece is listed. */
export const PART_LABEL: Record<PieceType, string> = {
  straight: 'Tube',
  angle: 'Angle',
  corner: 'Corner',
  hook: 'Hook',
  corkscrew: 'Corkscrew',
}

/** What the part is, by type and position — "Tube 2" and friends. */
export function pieceTypeLabel(piece: Piece, index: number): string {
  return `${PART_LABEL[piece.type]} ${index + 1}`
}

/** The user's own label if they gave one, otherwise the part's own name. */
export function pieceLabel(piece: Piece, index: number): string {
  return piece.name?.trim() || pieceTypeLabel(piece, index)
}

let seq = 0
const nextId = () => `p${++seq}`

/** What each part type starts life as. */
const TYPE_DEFAULTS: Record<PieceType, Omit<Piece, 'id' | 'type'>> = {
  straight: { length: 120, slope: 6, turn: 0 },
  angle: {
    length: ANGLE_DEFAULTS.length,
    slope: 6,
    turn: 0,
    bend: ANGLE_DEFAULTS.bend,
    exitLength: ANGLE_DEFAULTS.exitLength,
    fillet: ANGLE_DEFAULTS.fillet,
  },
  corner: {
    length: CORNER_DEFAULTS.length,
    slope: 6,
    turn: 0,
    sweep: CORNER_DEFAULTS.sweep,
    exitLength: CORNER_DEFAULTS.exitLength,
    fillet: CORNER_DEFAULTS.fillet,
  },
  hook: {
    length: HOOK_DEFAULTS.length,
    slope: 6,
    turn: 0,
    radius: HOOK_DEFAULTS.radius,
    sweep: HOOK_DEFAULTS.sweep,
    exitLength: HOOK_DEFAULTS.exitLength,
    roll: HOOK_DEFAULTS.roll,
  },
  // The rings and the slope here are placeholders. A corkscrew's rings are
  // counted off the room its height leaves them and its fall comes off those,
  // so both are put right by {@link settle} — which needs to know the tube the
  // part is cut from, and so cannot run this far out. All that survives of the
  // ring count is its sign: a new coil winds to the right.
  corkscrew: {
    length: CORKSCREW_DEFAULTS.length,
    slope: 6,
    turn: 0,
    height: CORKSCREW_DEFAULTS.height,
    topDiameter: CORKSCREW_DEFAULTS.topDiameter,
    bottomDiameter: CORKSCREW_DEFAULTS.bottomDiameter,
    rings: 1,
    exitLength: CORKSCREW_DEFAULTS.exitLength,
  },
}

export function makePiece(partial: Partial<Piece> = {}): Piece {
  const type = partial.type ?? 'straight'
  return { id: nextId(), type, ...TYPE_DEFAULTS[type], ...partial }
}

/** How far apart parts are set down, mm — side by side, clear of one another. */
const SPAWN_STEP = 160

/**
 * How far a part falls from its inlet to its outlet, mm. The rounding at a
 * connector's break is left out: this is for standing a part clear of the
 * workplane, where a millimetre either way makes no odds.
 */
function dropOf(piece: Piece): number {
  const sin = (deg: number) => Math.sin(deg * RAD)
  if (piece.type === 'angle') {
    const a = angleSpec(piece)
    return a.entry * sin(piece.slope) + a.exit * sin(piece.slope + a.bend)
  }
  if (piece.type === 'corner') {
    const c = cornerSpec(piece)
    return c.entry * sin(piece.slope) + c.exit * sin(exitSlope(piece))
  }
  if (piece.type === 'hook') return hookDrop(piece)
  if (piece.type === 'corkscrew') return corkscrewDrop(piece)
  return piece.length * sin(piece.slope)
}

/**
 * Where a part fresh out of the library is set down: standing on the workplane,
 * a step along from whatever is already out there on its own, so it lands in
 * free space rather than inside another part.
 *
 * It is raised by its own fall plus the tube's radius, so the part rests on the
 * plane rather than sinking through it — a part that descends is lifted by as
 * much as it descends. `outerR` is the tube the run is cut from.
 */
function spawnPlacement(pieces: Piece[], piece: Piece, outerR: number): Placement {
  const xs = pieces.filter((_, i) => isChainRoot(pieces, i)).map((p) => placementOf(p).x)
  return {
    x: xs.length ? Math.max(...xs) + SPAWN_STEP : 0,
    y: Math.round((outerR + Math.max(0, dropOf(piece))) * 10) / 10,
    z: 0,
    yaw: 0,
  }
}

/* ---------------- history ---------------- */

/** How far back the History panel can walk. Ten steps, plus the state they started from. */
export const HISTORY_LIMIT = 10

/**
 * A run of the same edit inside this window folds into one step, so dragging a
 * slider or a joint handle costs one entry rather than a hundred.
 */
const COALESCE_MS = 700

/**
 * The part of the store undo restores: the model itself. View state — camera,
 * theme, mode, sim playback, export format — is deliberately outside it, so
 * stepping back never yanks the viewport around.
 */
interface Snapshot {
  pieces: Piece[]
  selectedId: string | null
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant
  marbleDiameter: number
}

/** A run read back off disk: the model, under the name it was saved with. */
export interface LoadedProject extends Omit<Snapshot, 'selectedId'> {
  projectName: string
  /**
   * The keys the file was saved with. Absent on a file written before shortcuts
   * were settable, and absent means "leave this machine's keys alone" rather
   * than "put them back to stock".
   */
  shortcuts?: ShortcutMap
}

export interface HistoryEntry {
  id: number
  /** What the step did, as shown in the History list. */
  label: string
  at: number
  snap: Snapshot
}

function snapshot(s: Snapshot): Snapshot {
  return {
    pieces: s.pieces,
    selectedId: s.selectedId,
    innerDiameter: s.innerDiameter,
    wallThickness: s.wallThickness,
    variant: s.variant,
    marbleDiameter: s.marbleDiameter,
  }
}

/** Trailing zeros read as noise in a step label — 140, not 140.0. */
const num = (v: number) => String(Math.round(v * 100) / 100)

/** A length in a step label, written in whatever unit was on show at the time. */
const len = (mm: number) => formatLength(mm, labelUnits)

const FIELD_LABEL: Record<string, string> = {
  length: 'length',
  slope: 'slope',
  turn: 'turn',
  bend: 'bend',
  sweep: 'sweep',
  exitLength: 'exit leg',
  fillet: 'corner radius',
  radius: 'turn radius',
  roll: 'turn plane',
  height: 'height',
  topDiameter: 'top Ø',
  bottomDiameter: 'bottom Ø',
  rings: 'rings',
}
/** How each field's value is written out — lengths follow the unit setting. */
const FIELD_VALUE: Record<string, (v: number) => string> = {
  length: len,
  slope: (v) => `${num(v)}°`,
  turn: (v) => `${num(v)}°`,
  bend: (v) => `${num(v)}°`,
  sweep: (v) => `${num(v)}°`,
  exitLength: len,
  fillet: len,
  radius: len,
  roll: (v) => `${num(v)}°`,
  height: len,
  topDiameter: len,
  bottomDiameter: len,
  // The count and which way it winds are one field, so a step says both.
  rings: (v) => `${num(Math.abs(v))} ${v < 0 ? 'left' : 'right'}`,
}

/** What a part is called right now, for a step label. */
function nameOf(s: { pieces: Piece[] }, id: string): string {
  const i = s.pieces.findIndex((p) => p.id === id)
  return i < 0 ? 'part' : pieceLabel(s.pieces[i], i)
}

/** "Tube 2 length 140 mm" — what changed, on which part, to what. */
function editLabel(name: string, patch: Partial<Piece>): string {
  const parts = Object.entries(patch)
    .filter(([k]) => k in FIELD_LABEL)
    .map(([k, v]) => `${FIELD_LABEL[k]} ${FIELD_VALUE[k](v as number)}`)
  return parts.length ? `${name} ${parts.join(', ')}` : `Edit ${name}`
}

interface RunState {
  /** Names the run in the top bar, and every file it exports. */
  projectName: string
  /** Export file name typed in the Export panel; blank follows the project name. */
  exportName: string

  mode: Mode
  draftView: DraftView
  theme: Theme
  /**
   * The unit every length on screen is written and typed in. The model stays
   * millimetres whichever this is — see `lib/units`.
   */
  units: Unit
  /**
   * What the keyboard reaches — the key each command answers to. A preference
   * rather than part of the run, like the theme, but it rides along in a saved
   * file so a project opens with the keys it was built with.
   */
  shortcuts: ShortcutMap

  // Tube front-face definition. Bore and wall are the run's throughout; the
  // style is only what a part falls back to when it has none of its own.
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant

  // Assembly
  pieces: Piece[]
  selectedId: string | null
  /** What the left button does on the 3D stage. */
  tool: Tool
  /**
   * The first end the Connector has been given, waiting for the one it is to be
   * bonded to. Null with nothing picked yet, and cleared the moment a joint is
   * made — one click is half a joint, not a mode.
   */
  pendingPort: Port | null
  /**
   * Whether the run is held together as one assembly: connected, a part starts
   * where the one before it ends, and swinging a joint swings everything
   * downstream with it. Off, each part holds the angle it was given and a joint
   * is free to open up.
   */
  keepConnected: boolean

  // 3D appearance. The piece colour is only what a part falls back to when it
  // has none of its own — a preference that outlives any one project.
  pieceColor: string
  marbleColor: string
  shading: Shading

  // Simulator
  marbleDiameter: number
  running: boolean
  /**
   * False until the Simulator button has been pressed for this run. The marble
   * only exists on stage once it has been asked for, so an idle run is just the
   * pieces; pausing keeps it where it stopped rather than making it vanish.
   */
  simStarted: boolean
  loop: boolean
  timeScale: number
  friction: number
  resetToken: number
  exportFormat: ExportFormat

  /** CSS px per real millimetre on this display — powers the 1:1 draft zoom. */
  screenPxPerMm: number
  /** False while `screenPxPerMm` is still the nominal guess, not a measurement. */
  screenCalibrated: boolean

  /** Which slide-out is open on the right edge — one at a time, shared by both stages. */
  rightPanel: RightPanel

  /** Which column is out on the left edge — the part parameters, folded away or not. */
  leftPanel: LeftPanel

  /** Which pieces of on-screen furniture are showing. Kept per machine, not per run. */
  overlays: OverlayMap

  /** Oldest first; the entry at `historyIndex` is the model on screen. */
  history: HistoryEntry[]
  historyIndex: number

  setProjectName: (v: string) => void
  setExportName: (v: string) => void
  /** Clears the stage back to a single default part under a fresh Untitled name. */
  newProject: () => void
  /** Replaces the stage with a run read back from a saved file. */
  loadProject: (project: LoadedProject) => void

  setRightPanel: (p: RightPanel) => void
  toggleRightPanel: (p: Exclude<RightPanel, null>) => void
  setLeftPanel: (p: LeftPanel) => void
  toggleLeftPanel: (p: Exclude<LeftPanel, null>) => void
  undo: () => void
  redo: () => void
  /** Jump straight to a step from the History list. */
  gotoHistory: (index: number) => void

  setMode: (m: Mode) => void
  setDraftView: (v: DraftView) => void
  toggleTheme: () => void
  /**
   * Switches what unit lengths are shown in, everywhere at once. Nothing about
   * the run changes, so this is not a step on the timeline.
   */
  setUnits: (v: Unit) => void
  /**
   * Shows or hides one piece of on-screen furniture. A preference about the
   * view, not the run, so it stays off the timeline and is remembered here.
   */
  setOverlay: (id: Overlay, shown: boolean) => void
  /**
   * Re-binds one command. A key another command already holds is swapped rather
   * than shared: the two trade bindings, so nothing is ever left unreachable and
   * one key never means two things.
   */
  setShortcut: (action: ShortcutAction, shortcut: Shortcut) => void
  /** Puts every command back on its stock key. */
  resetShortcuts: () => void
  /** The bore parts fall back to — every part that has none of its own follows it. */
  setInnerDiameter: (v: number) => void
  /** The wall parts fall back to — every part that has none of its own follows it. */
  setWallThickness: (v: number) => void
  /** Sizes one part's bore on its own, leaving the rest of the run as it is. */
  setPieceBore: (id: string, v: number) => void
  /** Sizes one part's wall on its own, leaving the rest of the run as it is. */
  setPieceWall: (id: string, v: number) => void
  /**
   * Cuts the whole run from one tube: the bore and wall become the run's, and
   * every part's own is dropped, so the parts are back to following it from
   * here on.
   */
  applyTubeToAll: (innerDiameter: number, wallThickness: number) => void
  /** The style parts fall back to — every part that has none of its own follows it. */
  setVariant: (v: TubeVariant) => void
  /** Styles one part on its own, leaving the rest of the run as it is. */
  setPieceVariant: (id: string, v: TubeVariant) => void
  /**
   * Puts one style on the whole run: it becomes the run's, and every part's own
   * is dropped, so the parts are back to following it from here on.
   */
  applyVariantToAll: (v: TubeVariant) => void
  /** The colour parts fall back to — every part that has none of its own follows it. */
  setPieceColor: (v: string) => void
  /** Paints one part on its own, leaving the rest of the run as it is. */
  setPartColor: (id: string, v: string) => void
  /**
   * Puts one colour on the whole run: it becomes the run's, and every part's own
   * is dropped, so the parts are back to following it from here on.
   */
  applyColorToAll: (v: string) => void
  setMarbleColor: (v: string) => void
  setShading: (v: Shading) => void
  /** Turning it on pulls whatever joints have come open back together. */
  setKeepConnected: (v: boolean) => void
  toggleShading: () => void
  setMarbleDiameter: (v: number) => void
  resetMarbleFit: () => void
  setTimeScale: (v: number) => void
  setFriction: (v: number) => void
  toggleRunning: () => void
  setLoop: (v: boolean) => void
  /** Called as the scrubber is grabbed: pauses the run and puts the marble on stage. */
  scrubSim: () => void
  resetSim: () => void
  setExportFormat: (v: ExportFormat) => void
  setScreenPxPerMm: (v: number) => void
  resetScreenCalibration: () => void

  /** Switches what the left button does on the 3D stage; any half-made joint is dropped. */
  setTool: (t: Tool) => void
  /**
   * Hands the Connector an end. The first one is held; the second makes the
   * joint if the two can take one, and is ignored if they cannot. Null lets go
   * of whatever was held.
   */
  pickPort: (p: Port | null) => void
  /**
   * Bonds an outlet to an inlet, in either order. The run hanging off the inlet
   * comes along and swings into line as one piece: it is welded flush onto the
   * outlet, and every kink it already had is kept.
   */
  connectPorts: (a: Port, b: Port) => void
  /**
   * Breaks the joint at a part's inlet, leaving that part and everything bonded
   * behind it standing exactly where they were. `at` is where the part is now,
   * which only the stage knows — the store holds shapes and joints, not the
   * layout they work out to.
   */
  breakJoint: (pieceId: string, at: Placement) => void
  /**
   * Sets the run `pieceId` belongs to down with its first part's inlet at
   * `x, y, z`. A bonded part cannot be moved on its own — the whole run travels,
   * which is what being bonded means.
   */
  moveChain: (pieceId: string, x: number, y: number, z: number) => void
  /**
   * Sets the run `pieceId` belongs to down on the workplane: it falls straight
   * down the upright until its lowest wall rests on y = 0, and nothing else
   * about it moves — same place on the plan, same heading, same angles. A run
   * that has been left sunk below the plane is lifted onto it instead, which is
   * the same thing said the other way round.
   *
   * The whole run travels, for the reason {@link RunState.moveChain} does: a
   * bonded part cannot be moved on its own.
   */
  dropToWorkplane: (pieceId: string) => void
  /**
   * Stands the run `pieceId` belongs to on a fresh placement — the same job
   * {@link RunState.moveChain} does, with the heading in it as well. Only the
   * stage knows what turning about a part on screen works out to at the head of
   * the run, so it hands the answer down rather than the gesture.
   */
  rotateChain: (pieceId: string, at: Placement) => void
  addPiece: (type?: PieceType) => void
  duplicatePiece: (id: string) => void
  renamePiece: (id: string, name: string) => void
  togglePieceHidden: (id: string) => void
  showAllPieces: () => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  /**
   * Swings a part from its head. It turns through `delta` degrees about the far
   * end of the leg being dragged — the break on a connector, the outlet on a
   * plain tube — and on a connected run every part ahead of it turns by
   * the same amount, so the joints behind it hold. Nothing past the pivot moves
   * at all: this is the mirror of dragging a part's outlet, which holds the run
   * ahead still and swings everything after it.
   *
   * `holdExit` pins a connector's outgoing leg where it is by giving the break
   * back whatever the entry leg takes — the bend in elevation, the sweep in
   * plan — so only the entry swings and the pivot really is the one point that
   * does not move. `patch` carries whatever the
   * same gesture stretches, so an Alt-drag is still one step in the timeline.
   */
  swingHead: (
    id: string,
    axis: 'slope' | 'turn',
    delta: number,
    opts?: { holdExit?: boolean; patch?: Partial<Piece> },
  ) => void
  /**
   * Puts every part back as it stood when a drag began. A swing moves parts
   * either side of the one under the pointer, so cancelling it has to restore
   * the run, not just the part that was grabbed.
   */
  restoreDrag: (id: string, pieces: Piece[]) => void
  removePiece: (id: string) => void
  movePiece: (id: string, dir: -1 | 1) => void
  select: (id: string | null) => void
}

/** The model a project opens on — an empty plane, waiting for its first part. */
function freshSnapshot(): Snapshot {
  return {
    pieces: [],
    selectedId: null,
    innerDiameter: STANDARD_BORE,
    wallThickness: 3,
    variant: 'threequarter',
    marbleDiameter: STANDARD_MARBLE,
  }
}

const INITIAL_SNAPSHOT: Snapshot = freshSnapshot()

let entrySeq = 0

export const useRun = create<RunState>((set, get) => {
  /** The last coalescable edit, so a continuing drag folds into its own step. */
  let recent: { key: string; at: number } | null = null

  /**
   * Applies a model change and files it as one step in the timeline. `patch`
   * returning null means nothing actually moved, so nothing is recorded.
   * `coalesce` keys the fold — repeats of the same key inside COALESCE_MS
   * rewrite the step they started rather than stacking new ones.
   */
  const commit = (
    label: string,
    patch: (s: RunState) => Partial<RunState> | null,
    coalesce?: string,
  ) =>
    set((s) => {
      const raw = patch(s)
      if (!raw) return s
      // Every edit lands here, so this is the one place a coil has to be put
      // back on the shape its space allows — whether the edit was to the coil
      // itself or to the tube it is cut from.
      const merged = { ...s, ...raw }
      const pieces = settleAll(merged.pieces, merged.innerDiameter, merged.wallThickness)
      const next = pieces === merged.pieces ? raw : { ...raw, pieces }
      const snap = snapshot({ ...s, ...next })
      const now = Date.now()
      // Never fold into the opening state — that one has to stay reachable.
      const fold =
        coalesce !== undefined &&
        recent?.key === coalesce &&
        now - recent.at < COALESCE_MS &&
        s.historyIndex > 0
      recent = coalesce === undefined ? null : { key: coalesce, at: now }

      // Anything that was redoable is gone the moment a new step lands.
      const history = s.history.slice(0, s.historyIndex + 1)
      if (fold) {
        history[history.length - 1] = { ...history[history.length - 1], label, at: now, snap }
      } else {
        history.push({ id: ++entrySeq, label, at: now, snap })
        // One spare for the state the ten steps started from.
        if (history.length > HISTORY_LIMIT + 1) history.splice(0, history.length - HISTORY_LIMIT - 1)
      }
      return { ...next, history, historyIndex: history.length - 1 }
    })

  /** Restores the model recorded at `index`; view state is left alone. */
  const goto = (index: number) =>
    set((s) => {
      if (index < 0 || index >= s.history.length || index === s.historyIndex) return s
      // A step of its own ends any drag-fold in progress.
      recent = null
      return { ...s.history[index].snap, historyIndex: index }
    })

  return {
    projectName: UNTITLED_PROJECT,
    exportName: '',

    // 3D is where a run is built; the 2D draft is for working a single part.
    mode: '3d',
    draftView: 'developed',
    theme: initialTheme(),
    units: labelUnits,
    shortcuts: initialShortcuts(),
    overlays: initialOverlays(),

    // Sized for a standard glass marble out of the box.
    innerDiameter: INITIAL_SNAPSHOT.innerDiameter,
    wallThickness: INITIAL_SNAPSHOT.wallThickness,
    variant: INITIAL_SNAPSHOT.variant,

    pieces: INITIAL_SNAPSHOT.pieces,
    selectedId: INITIAL_SNAPSHOT.selectedId,
    tool: 'select',
    pendingPort: null,

    pieceColor: initialColor(PIECE_COLOR_KEY, DEFAULT_PIECE_COLOR),
    marbleColor: initialColor(MARBLE_COLOR_KEY, DEFAULT_MARBLE_COLOR),
    shading: initialShading(),
    keepConnected: initialKeepConnected(),

    marbleDiameter: INITIAL_SNAPSHOT.marbleDiameter,
    running: false,
    simStarted: false,
    loop: true,
    timeScale: 1,
    friction: 0.06,
    resetToken: 0,
    exportFormat: '3mf',

    ...(() => {
      const { pxPerMm, calibrated } = initialScreen()
      return { screenPxPerMm: pxPerMm, screenCalibrated: calibrated }
    })(),

    rightPanel: null,
    // The parameters are what most of the work is typed into, so the column
    // starts out — the tab is there to win the width back, not to find it.
    leftPanel: 'parameters',

    // The run always has somewhere to step back to, even before the first edit.
    history: [{ id: ++entrySeq, label: 'Opening state', at: Date.now(), snap: INITIAL_SNAPSHOT }],
    historyIndex: 0,

    // Naming the run is not a change to the run, so neither of these is a step.
    setProjectName: (projectName) => set({ projectName }),
    setExportName: (exportName) => set({ exportName }),

    /**
     * A clean sheet: the default model, the default name, and a timeline with
     * nothing behind it. Preferences that outlive a project — theme, colours,
     * screen calibration — are left as they are.
     */
    newProject: () =>
      set((s) => {
        recent = null
        const snap = freshSnapshot()
        return {
          ...snap,
          projectName: UNTITLED_PROJECT,
          exportName: '',
          pendingPort: null,
          running: false,
          simStarted: false,
          resetToken: s.resetToken + 1,
          history: [{ id: ++entrySeq, label: 'New project', at: Date.now(), snap }],
          historyIndex: 0,
        }
      }),

    /**
     * Opening a file is a new start rather than a step: the run that arrives is
     * the whole model, so the timeline starts again from it and there is
     * nothing behind it to step back to.
     */
    loadProject: ({ projectName, shortcuts, ...model }) =>
      set((s) => {
        recent = null
        // Opening a file skips `commit`, so the coils are settled here instead:
        // a saved ring count is only what fitted the tube it was saved with.
        const snap: Snapshot = {
          ...model,
          pieces: settleAll(model.pieces, model.innerDiameter, model.wallThickness),
          selectedId: null,
        }
        // The keys in the file are a preference the file happens to carry, so
        // they are taken on and kept for this machine — but only if it had any.
        if (shortcuts) remember(SHORTCUTS_KEY, JSON.stringify(shortcuts))
        return {
          ...snap,
          ...(shortcuts ? { shortcuts } : {}),
          projectName,
          exportName: '',
          pendingPort: null,
          running: false,
          simStarted: false,
          resetToken: s.resetToken + 1,
          history: [{ id: ++entrySeq, label: `Opened ${projectName}`, at: Date.now(), snap }],
          historyIndex: 0,
        }
      }),

    setRightPanel: (rightPanel) => set({ rightPanel }),
    // Clicking the open panel's own tab closes it — the tab is a toggle, not a switch.
    toggleRightPanel: (p) => set((s) => ({ rightPanel: s.rightPanel === p ? null : p })),
    setLeftPanel: (leftPanel) => set({ leftPanel }),
    toggleLeftPanel: (p) => set((s) => ({ leftPanel: s.leftPanel === p ? null : p })),
    undo: () => goto(get().historyIndex - 1),
    redo: () => goto(get().historyIndex + 1),
    gotoHistory: goto,

    setMode: (mode) => set({ mode }),
    setDraftView: (draftView) => set({ draftView }),
    toggleTheme: () =>
      set((s) => {
        const theme: Theme = s.theme === 'light' ? 'dark' : 'light'
        applyTheme(theme)
        return { theme }
      }),
    setUnits: (units) => {
      labelUnits = units
      remember(UNITS_KEY, units)
      set({ units })
    },
    setOverlay: (id, shown) => {
      const overlays = { ...get().overlays, [id]: shown }
      remember(OVERLAYS_KEY, JSON.stringify(overlays))
      set({ overlays })
    },
    // Re-binding is a preference, not a change to the run, so it stays off the
    // timeline: undo walks the model, and the key that walks it is not part of it.
    setShortcut: (action, shortcut) => {
      const current = get().shortcuts
      if (sameShortcut(current[action], shortcut)) return
      const shortcuts = { ...current, [action]: shortcut }
      // Whoever held that key takes the one being given up, so the pair trade
      // rather than both answering to it.
      const clash = SHORTCUT_ACTIONS.find(
        (a) => a !== action && sameShortcut(current[a], shortcut),
      )
      if (clash) shortcuts[clash] = current[action]
      remember(SHORTCUTS_KEY, JSON.stringify(shortcuts))
      set({ shortcuts })
    },
    resetShortcuts: () => {
      const shortcuts = { ...DEFAULT_SHORTCUTS }
      remember(SHORTCUTS_KEY, JSON.stringify(shortcuts))
      set({ shortcuts })
    },
    setInnerDiameter: (innerDiameter) =>
      commit(
        `Bore \u00d8${len(innerDiameter)}`,
        (s) =>
          s.innerDiameter === innerDiameter
            ? null
            : {
                innerDiameter,
                // Keep the marble inside the bore.
                marbleDiameter: Math.min(s.marbleDiameter, innerDiameter - 2),
              },
        'bore',
      ),
    setWallThickness: (wallThickness) =>
      commit(
        `Wall ${len(wallThickness)}`,
        (s) => (s.wallThickness === wallThickness ? null : { wallThickness }),
        'wall',
      ),
    setPieceBore: (id, innerDiameter) =>
      commit(
        `${nameOf(get(), id)} bore Ø${len(innerDiameter)}`,
        (s) => {
          const piece = s.pieces.find((p) => p.id === id)
          // Typing the bore a part already has changes nothing, whether it holds
          // that bore itself or follows the run's.
          if (!piece || boreOf(piece, s.innerDiameter) === innerDiameter) return null
          return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, innerDiameter } : p)) }
        },
        // Holding the stepper down folds into one step, like every other field.
        `bore:${id}`,
      ),
    setPieceWall: (id, wallThickness) =>
      commit(
        `${nameOf(get(), id)} wall ${len(wallThickness)}`,
        (s) => {
          const piece = s.pieces.find((p) => p.id === id)
          if (!piece || wallOf(piece, s.wallThickness) === wallThickness) return null
          return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, wallThickness } : p)) }
        },
        `wall:${id}`,
      ),
    applyTubeToAll: (innerDiameter, wallThickness) =>
      commit(`Tube all: Ø${len(innerDiameter)} bore / ${len(wallThickness)} wall`, (s) => {
        const sized = s.pieces.some(
          (p) => p.innerDiameter !== undefined || p.wallThickness !== undefined,
        )
        if (s.innerDiameter === innerDiameter && s.wallThickness === wallThickness && !sized) {
          return null
        }
        return {
          innerDiameter,
          wallThickness,
          // Keep the marble inside the bore, as setting the run's bore does.
          marbleDiameter: Math.min(s.marbleDiameter, innerDiameter - 2),
          // Dropping each part's own is what makes this stick: the run is cut
          // from one tube, and stays that way as the tube is changed again.
          pieces: sized
            ? s.pieces.map(({ innerDiameter: _d, wallThickness: _w, ...rest }) => rest)
            : s.pieces,
        }
      }),
    setVariant: (variant) =>
      commit(`Style: ${VARIANT_LABEL[variant]}`, (s) => (s.variant === variant ? null : { variant })),
    setPieceVariant: (id, variant) =>
      commit(`${nameOf(get(), id)} style: ${VARIANT_LABEL[variant]}`, (s) => {
        const piece = s.pieces.find((p) => p.id === id)
        // Picking the style a part is already cut in changes nothing, whether it
        // holds that style itself or follows the run's.
        if (!piece || variantOf(piece, s.variant) === variant) return null
        return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, variant } : p)) }
      }),
    applyVariantToAll: (variant) =>
      commit(`Style all: ${VARIANT_LABEL[variant]}`, (s) => {
        const styled = s.pieces.some((p) => p.variant !== undefined)
        if (s.variant === variant && !styled) return null
        return {
          variant,
          // Dropping each part's own is what makes this stick: the run is of one
          // style, and stays that way as the style is changed again.
          pieces: styled ? s.pieces.map(({ variant: _v, ...rest }) => rest) : s.pieces,
        }
      }),
    setPieceColor: (pieceColor) => {
      remember(PIECE_COLOR_KEY, pieceColor)
      set({ pieceColor })
    },
    setPartColor: (id, color) =>
      commit(
        `${nameOf(get(), id)} color: ${color}`,
        (s) => {
          const piece = s.pieces.find((p) => p.id === id)
          // Picking the colour a part is already drawn in changes nothing, whether
          // it holds that colour itself or follows the run's.
          if (!piece || colorOf(piece, s.pieceColor) === color) return null
          return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, color } : p)) }
        },
        // Dragging around the colour picker folds into one step.
        `color:${id}`,
      ),
    applyColorToAll: (color) => {
      // The run's colour is a preference rather than part of the model, so it is
      // set the same way as ever and stays where the user put it. Dropping each
      // part's own is the model change, and that is what lands in the timeline.
      get().setPieceColor(color)
      commit('Color all parts', (s) =>
        s.pieces.some((p) => p.color !== undefined)
          ? { pieces: s.pieces.map(({ color: _c, ...rest }) => rest) }
          : null,
      )
    },
    setMarbleColor: (marbleColor) => {
      remember(MARBLE_COLOR_KEY, marbleColor)
      set({ marbleColor })
    },
    setShading: (shading) => {
      remember(SHADING_KEY, shading)
      set({ shading })
    },
    setKeepConnected: (keepConnected) => {
      if (get().keepConnected === keepConnected) return
      remember(KEEP_CONNECTED_KEY, keepConnected ? 'on' : 'off')
      set({ keepConnected })
      // Reconnecting a run that was drawn with its joints free closes them up;
      // that is a model change, so it lands in the timeline and can be undone.
      if (keepConnected) {
        commit('Reconnect parts', (s) => {
          const pieces = weldJoints(s.pieces)
          return pieces === s.pieces ? null : { pieces }
        })
      }
    },
    toggleShading: () =>
      set((s) => {
        const shading: Shading = s.shading === 'solid' ? 'transparent' : 'solid'
        remember(SHADING_KEY, shading)
        return { shading }
      }),
    setMarbleDiameter: (marbleDiameter) =>
      commit(
        `Marble \u00d8${len(marbleDiameter)}`,
        (s) => (s.marbleDiameter === marbleDiameter ? null : { marbleDiameter }),
        'marble',
      ),
    // Bore and marble move together, so the fit is right whatever they were scaled to.
    resetMarbleFit: () =>
      commit('Reset marble fit', (s) =>
        s.marbleDiameter === STANDARD_MARBLE && s.innerDiameter === STANDARD_BORE
          ? null
          : { marbleDiameter: STANDARD_MARBLE, innerDiameter: STANDARD_BORE },
      ),
    setTimeScale: (timeScale) => set({ timeScale }),
    setFriction: (friction) => set({ friction }),
    // Starting is also what puts the marble on stage the first time.
    toggleRunning: () => set((s) => ({ running: !s.running, simStarted: true })),
    setLoop: (loop) => set({ loop }),
    // Taking hold of the scrubber hands the marble to the user: it goes on stage
    // if it was not there yet, and the run stops so the slider is the only thing
    // moving it.
    // Every drag event calls this, so it only writes when something actually changes.
    scrubSim: () => {
      const s = get()
      if (s.running || !s.simStarted) set({ running: false, simStarted: true })
    },
    resetSim: () => set((s) => ({ resetToken: s.resetToken + 1 })),
    setExportFormat: (exportFormat) => set({ exportFormat }),

    setScreenPxPerMm: (v) => {
      const screenPxPerMm = Math.min(PX_PER_MM_MAX, Math.max(PX_PER_MM_MIN, v))
      remember(SCREEN_KEY, String(screenPxPerMm))
      set({ screenPxPerMm, screenCalibrated: true })
    },

    resetScreenCalibration: () => {
      try {
        localStorage.removeItem(SCREEN_KEY)
      } catch {
        // Same as `remember` \u2014 a storage failure is not worth surfacing.
      }
      set({ screenPxPerMm: NOMINAL_PX_PER_MM, screenCalibrated: false })
    },

    // Changing tool drops any half-made joint: the end you picked belonged to the
    // gesture you have just walked away from.
    setTool: (tool) => set((s) => (s.tool === tool ? s : { tool, pendingPort: null })),

    pickPort: (port) => {
      const s = get()
      // Clicking the held end again lets go of it.
      if (!port || samePort(s.pendingPort, port)) {
        set({ pendingPort: null })
        return
      }
      if (!s.pendingPort) {
        set({ pendingPort: port })
        return
      }
      if (canConnect(s.pieces, s.pendingPort, port)) get().connectPorts(s.pendingPort, port)
      // Two ends that cannot take a joint: the newer one is the one being asked
      // for, so it takes over rather than the click doing nothing at all.
      else set({ pendingPort: port })
    },

    connectPorts: (a, b) =>
      commit(`Join ${nameOf(get(), a.pieceId)} to ${nameOf(get(), b.pieceId)}`, (s) => {
        if (!canConnect(s.pieces, a, b)) return null
        // Two like ends have nothing to mate: a spigot needs a socket. The end
        // picked first is the one that travels, so its run is the one turned
        // end for end — which leaves that same end of that same part now facing
        // the other way, and the pair a spigot and a socket after all.
        const flip = a.end === b.end
        const held = flip ? turnRunAround(s.pieces, a) : s.pieces
        const first = flip ? otherEnd(a) : a
        const outlet = first.end === 'out' ? first : b
        const inlet = first.end === 'in' ? first : b
        // Picked by its inlet, the run behind it is carried onto the outlet
        // anyway — that is what welding it on does. Picked by its outlet, it is
        // the run in front that has to come round, so it is swung and set down
        // against the other one first, and the weld below then has nothing left
        // to move.
        const base = first.end === 'out' ? alignRun(held, outlet, inlet) : held
        const from = base.findIndex((p) => p.id === outlet.pieceId)
        const head = base.findIndex((p) => p.id === inlet.pieceId)
        // The whole run hanging off that inlet travels, not just the one part.
        const tail = chainTailOf(base, head)
        const block = base.slice(head, tail + 1)
        const rest = [...base.slice(0, head), ...base.slice(tail + 1)]
        // Bonded parts follow the part they are bonded to, so the run that
        // arrives is filed straight after the outlet it now hangs off.
        const at = rest.findIndex((p) => p.id === outlet.pieceId) + 1
        const S = PIECE_LIMITS.slope
        // A snap-fit joint is coaxial: the part bonded on takes the angle the
        // outlet hands over and picks up its heading, so the two sit flush.
        block[0] = {
          ...block[0],
          joined: true,
          at: undefined,
          slope: clamp(exitSlope(base[from]), S.min, S.max),
          turn: 0,
        }
        const pieces = [...rest.slice(0, at), ...block, ...rest.slice(at)]
        if (!s.keepConnected || block.length < 2) return { pieces, pendingPort: null }
        // Measured before anything moved, so the run that arrived keeps every
        // kink it had rather than being pulled straight by the joint.
        const was = kinksOf(base)
        const kinks = pieces.map((_, i) =>
          i > at && i < at + block.length ? was[head + i - at] : 0,
        )
        return { pieces: relink(pieces, kinks, at + 1, at + block.length - 1), pendingPort: null }
      }),

    breakJoint: (pieceId, at) =>
      commit(`Unjoin ${nameOf(get(), pieceId)}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === pieceId)
        if (i < 0 || isChainRoot(s.pieces, i)) return null
        const piece = s.pieces[i]
        return {
          pieces: s.pieces.map((p, j) =>
            j === i
              ? // Its own turn still counts towards where it points, so the
                // placement takes the heading less that turn and the part comes
                // out of the joint aimed exactly where it already was.
                { ...p, joined: undefined, at: { ...at, yaw: tidy(at.yaw - piece.turn) } }
              : p,
          ),
          pendingPort: null,
        }
      }),

    moveChain: (pieceId, x, y, z) =>
      commit(
        `Move ${nameOf(get(), pieceId)}`,
        (s) => {
          const i = s.pieces.findIndex((p) => p.id === pieceId)
          if (i < 0) return null
          const root = chainRootOf(s.pieces, i)
          const at = placementOf(s.pieces[root])
          if (at.x === x && at.y === y && at.z === z) return null
          return {
            pieces: s.pieces.map((p, j) => (j === root ? { ...p, at: { ...at, x, y, z } } : p)),
          }
        },
        // One drag of the arrows is one step, however far it travels.
        `piece:${pieceId}:move`,
      ),

    dropToWorkplane: (pieceId) =>
      commit(`Drop ${nameOf(get(), pieceId)} to the workplane`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === pieceId)
        if (i < 0) return null
        const root = chainRootOf(s.pieces, i)
        const at = placementOf(s.pieces[root])
        // The run on its own, stood up where it actually is: only the parts
        // bonded into it are being set down, and the rest of the stage stays
        // where it is. The head of the slice is a run's head by construction,
        // so it is laid out from this very placement.
        const asm = buildAssembly(s.pieces.slice(root, chainTailOf(s.pieces, i) + 1))
        const floor = chainBox(
          asm,
          0,
          (p) => boreOf(p, s.innerDiameter) / 2 + wallOf(p, s.wallThickness),
        ).min.y
        if (!Number.isFinite(floor)) return null
        // Tenths of a millimetre, like every other placement. A run already
        // standing within a tenth of the plane is left exactly where it is: that
        // is as fine as any height on screen is written, so nudging it would be
        // a step in the timeline for a move nothing can see.
        const y = Math.round((at.y - floor) * 10) / 10
        if (y === at.y) return null
        return {
          pieces: s.pieces.map((p, j) => (j === root ? { ...p, at: { ...at, y } } : p)),
        }
      }),

    rotateChain: (pieceId, at) =>
      commit(
        `Rotate ${nameOf(get(), pieceId)}`,
        (s) => {
          const i = s.pieces.findIndex((p) => p.id === pieceId)
          if (i < 0) return null
          const root = chainRootOf(s.pieces, i)
          const was = placementOf(s.pieces[root])
          if (was.x === at.x && was.y === at.y && was.z === at.z && was.yaw === at.yaw) return null
          return { pieces: s.pieces.map((p, j) => (j === root ? { ...p, at } : p)) }
        },
        // One drag of the ring is one step, however far it turns.
        `piece:${pieceId}:rotate`,
      ),

    addPiece: (type = 'straight') => {
      const s0 = get()
      // Settled before it is stood down, not after: how far a coil falls is
      // what says how high off the workplane it has to start.
      const outerR = s0.innerDiameter / 2 + s0.wallThickness
      const shape = settle(makePiece({ type }), outerR)
      const piece = {
        ...shape,
        at: spawnPlacement(s0.pieces, shape, outerR),
      }
      // A part lands on its own, in clear space: joining it to the run is the
      // Connector's job, so nothing already on the stage moves when one arrives.
      commit(`Add ${PART_LABEL[piece.type]}`, (s) => ({
        pieces: [...s.pieces, piece],
        selectedId: piece.id,
      }))
    },
    // The copy lands beside the run rather than in it, the same as a part fresh
    // out of the library, and takes over the selection.
    duplicatePiece: (id) =>
      commit(`Duplicate ${nameOf(get(), id)}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        if (i < 0) return null
        const { id: _id, joined: _joined, at: _at, ...rest } = s.pieces[i]
        // Stood clear on the copy's own tube — it carries the original's size,
        // which is not the run's if that part was sized on its own.
        const outerR =
          boreOf(s.pieces[i], s.innerDiameter) / 2 + wallOf(s.pieces[i], s.wallThickness)
        const shape = settle(makePiece(rest), outerR)
        const copy = { ...shape, at: spawnPlacement(s.pieces, shape, outerR) }
        return { pieces: [...s.pieces, copy], selectedId: copy.id }
      }),
    // A blank name is stored as none at all, so the part falls back to its default label.
    renamePiece: (id, name) =>
      commit(`Rename to ${name.trim() || 'default'}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        const next = name.trim() ? name : undefined
        if (i < 0 || s.pieces[i].name === next) return null
        return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, name: next } : p)) }
      }),
    // Visibility is a view filter only \u2014 a hidden piece still positions the ones after it.
    togglePieceHidden: (id) =>
      commit(
        `${get().pieces.find((p) => p.id === id)?.hidden ? 'Show' : 'Hide'} ${nameOf(get(), id)}`,
        (s) => {
          const i = s.pieces.findIndex((p) => p.id === id)
          if (i < 0) return null
          return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, hidden: !p.hidden } : p)) }
        },
      ),
    showAllPieces: () =>
      commit('Show all parts', (s) =>
        s.pieces.some((p) => p.hidden)
          ? { pieces: s.pieces.map((p) => (p.hidden ? { ...p, hidden: false } : p)) }
          : null,
      ),
    updatePiece: (id, patch) => {
      const s = get()
      const i = s.pieces.findIndex((p) => p.id === id)
      if (i < 0) return
      const label = editLabel(pieceLabel(s.pieces[i], i), patch)
      commit(
        label,
        (cur) => {
          const at = cur.pieces.findIndex((p) => p.id === id)
          const piece = cur.pieces[at]
          // Slider and drag traffic repeats the value it already has \u2014 not a step.
          if (!piece || Object.entries(patch).every(([k, v]) => piece[k as keyof Piece] === v)) {
            return null
          }
          // Raising a coil gives it room for another ring, and either changes
          // the fall it runs at — so the part is put straight back on its own
          // shape here, before the joints either side are measured off it.
          const edited = settle(
            { ...piece, ...patch },
            boreOf(piece, cur.innerDiameter) / 2 + wallOf(piece, cur.wallThickness),
          )
          let pieces = cur.pieces.slice()
          pieces[at] = edited
          // Keep connected holds both of a part's joints, not just the one in
          // front of it. Setting the angle a part starts at moves it off the
          // part it is bonded to, so the run behind is brought round by the
          // same amount and the inlet stays flush — the run swings instead of
          // one joint tearing open. Only an angle asked for outright counts:
          // a fall that follows from the part's own shape, as a coil's does,
          // is the part before's to be brought to rather than something to
          // swing the whole run by.
          if ('slope' in patch) {
            pieces = swingBehind(pieces, at, tidy(edited.slope - piece.slope), cur.keepConnected)
          }
          // Swinging this part's slope or bend swings the run hanging off it.
          return {
            pieces: carrySlope(
              pieces,
              at,
              tidy(exitSlope(edited) - exitSlope(piece)),
              cur.keepConnected,
            ),
          }
        },
        // Held-down drags of the same field on the same part fold into one step.
        `piece:${id}:${Object.keys(patch).sort().join(',')}`,
      )
    },
    swingHead: (id, axis, delta, opts = {}) =>
      commit(
        `Swing ${nameOf(get(), id)} from the head`,
        (cur) => {
          const at = cur.pieces.findIndex((p) => p.id === id)
          if (at < 0) return null
          const { holdExit = false, patch } = opts
          const S = PIECE_LIMITS.slope
          const T = PIECE_LIMITS.turn
          const B = PIECE_LIMITS.bend
          const W = PIECE_LIMITS.sweep
          let pieces = cur.pieces.slice()
          let swing = tidy(delta)
          // Everything here works within the run the part belongs to: a swing
          // travels to the head of its own run and no further.
          const root = chainRootOf(cur.pieces, at)
          // The angle every joint stood at before the drag started, so whatever
          // the swing does to what the dragged part hands on can be walked back
          // down the run afterwards with each joint left as it was found.
          const kinks = kinksOf(cur.pieces)

          if (axis === 'turn') {
            // Plan: a heading is only ever a change from the one before, so the
            // run takes the whole swing at its first part and the part past the
            // pivot gives it straight back. What is left is the head of the run
            // turned about the pivot, with everything after it untouched.
            //
            // On a corner held by its outgoing leg the giveback is the sweep
            // instead: the break is the pivot, so what the entry leg takes the
            // sweep hands back and the leg past it never moves.
            const after = holdExit || !pieces[at + 1]?.joined ? null : pieces[at + 1]
            swing = narrow(swing, roomFor(pieces[root].turn, swing, T))
            if (after) swing = narrow(swing, -roomFor(after.turn, -swing, T))
            // The giveback is measured in heading, not in sweep: on a falling
            // run a corner swings the heading further than its own sweep, so
            // the sweep that hands exactly this much back is solved for. Held
            // at its stop it gives back less, and the swing shrinks to match.
            let held = pieces[at].sweep ?? CORNER_DEFAULTS.sweep
            if (holdExit) {
              const was = exitTurn(pieces[at])
              held = clamp(sweepForTurn(was - swing, pieces[at].slope), W.min, W.max)
              swing = tidy(was - exitTurn({ ...pieces[at], sweep: held }))
            }
            if (tidy(swing)) {
              pieces[root] = { ...pieces[root], turn: tidy(pieces[root].turn + swing) }
              if (after) pieces[at + 1] = { ...after, turn: tidy(after.turn - swing) }
              if (holdExit) {
                pieces[at] = { ...pieces[at], sweep: held }
                // Swinging the sweep tips how much of the fall the corner turns
                // across, so what it hands the run behind it moves as well.
                pieces = carrySlope(
                  pieces,
                  at,
                  tidy(exitSlope(pieces[at]) - exitSlope(cur.pieces[at])),
                  cur.keepConnected,
                )
              }
            }
          } else {
            // Elevation: the slope is the angle itself, so every part that comes
            // along takes the same delta and the run ahead stays rigid. Off a
            // connected run only the part under the pointer moves, and the joint
            // behind it is free to open.
            let from = cur.keepConnected ? root : at
            // A part on a fall of its own — a corkscrew's is set by its coil —
            // cannot be swung, and stands as the far end of the swing rather
            // than killing it: the run past it still moves, and the joint at
            // the coil is the one that opens. Without this a single corkscrew
            // would freeze every part behind it in the run.
            for (let i = at; i >= from; i--) {
              if (!slopeIsFixed(pieces[i])) continue
              from = i + 1
              break
            }
            for (let i = from; i <= at; i++) {
              swing = narrow(swing, roomFor(pieces[i].slope, swing, slopeRange(pieces[i])))
              // A connector carried along swings what it hands on as well, and
              // that has to stay somewhere the next part can sit.
              if (pieces[i].type === 'angle' && !(holdExit && i === at)) {
                swing = narrow(swing, roomFor(exitSlope(pieces[i]), swing, S))
              }
            }
            if (holdExit) {
              const bend = pieces[at].bend ?? ANGLE_DEFAULTS.bend
              swing = narrow(swing, -roomFor(bend, -swing, B))
            }
            if (tidy(swing)) {
              // What the connector at the far end hands on, before any of this
              // — a held outgoing leg has to come back to exactly that.
              const wasExit = exitSlope(pieces[at])
              for (let i = from; i <= at; i++) {
                pieces[i] = { ...pieces[i], slope: tidy(pieces[i].slope + swing) }
              }
              // A corner among the parts being carried hands on less than it
              // was swung by, so the stretch is walked back into line behind
              // it: the swing is shared out rather than tearing a joint open
              // halfway along the run being dragged.
              pieces = relink(pieces, kinks, from + 1, at)
              if (holdExit) {
                const bend = clamp(tidy(wasExit - pieces[at].slope), B.min, B.max)
                pieces[at] = { ...pieces[at], bend }
              }
            }
          }

          if (patch && Object.entries(patch).some(([k, v]) => pieces[at][k as keyof Piece] !== v)) {
            pieces[at] = { ...pieces[at], ...patch }
          }
          // The run in front of the dragged part is bonded to it, so it comes
          // along too: every joint past the drag is put back at the angle it was
          // standing at, measured off whatever the part now hands on.
          //
          // Only the parts behind were carried above, which is enough while a
          // part hands on exactly what it was swung by. A corner does not, and a
          // hook can hand on a fall that moves the other way entirely — so
          // without this walk the joint right past the drag is left standing
          // open, which is Keep connected not being kept. Off a connected run
          // the joints are the user's to open, and nothing is carried.
          if (cur.keepConnected) pieces = relink(pieces, kinks, at + 1, pieces.length - 1)
          // Drag traffic repeats the angle it already sits at, and a swing held
          // against its limits repeats it too — neither is a step.
          if (pieces.every((p, i) => p === cur.pieces[i])) return null
          return { pieces }
        },
        // One gesture is one step, however many parts it carries with it.
        `piece:${id}:swing`,
      ),

    restoreDrag: (id, pieces) =>
      commit(
        `Cancel ${nameOf(get(), id)} drag`,
        (cur) =>
          pieces.length === cur.pieces.length && pieces.every((p, i) => p === cur.pieces[i])
            ? null
            : { pieces },
        `piece:${id}:cancel`,
      ),

    removePiece: (id) =>
      commit(`Delete ${nameOf(get(), id)}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        if (i < 0) return null
        const gone = s.pieces[i]
        const next = s.pieces[i + 1]
        const root = isChainRoot(s.pieces, i)
        const pieces = s.pieces.filter((p) => p.id !== id)
        // Deleting the part a run starts at leaves the next one standing where
        // the deleted part stood — the run closes up onto the ground the deleted
        // part was holding, still pointing the way it was.
        if (root && next?.joined) {
          const at = placementOf(gone)
          pieces[i] = {
            ...next,
            joined: undefined,
            at: { ...at, yaw: tidy(at.yaw + gone.turn + exitTurn(gone)) },
          }
        }
        // Mid-run, what followed now hangs off the part before, so it has to
        // take up the angle the deleted one used to hand on.
        const delta = root ? 0 : tidy(exitSlope(s.pieces[i - 1]) - exitSlope(gone))
        return {
          pieces: carrySlope(pieces, i - 1, delta, s.keepConnected),
          selectedId: s.selectedId === id ? null : s.selectedId,
          // The joint the port named has gone with the part.
          pendingPort: s.pendingPort?.pieceId === id ? null : s.pendingPort,
        }
      }),
    movePiece: (id, dir) =>
      commit(`Move ${nameOf(get(), id)} ${dir < 0 ? 'up' : 'down'}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= s.pieces.length) return null
        const at = Math.min(i, j)
        // Only two parts of the same run can trade places: the list order is
        // what says which part is bonded to which, so a swap across two runs
        // would tear both of them apart.
        if (!s.pieces[at + 1].joined) return null
        const pieces = s.pieces.slice()
        ;[pieces[i], pieces[j]] = [pieces[j], pieces[i]]
        // Where a run stands belongs to the place at the head of it, not to
        // whichever part is standing there, so the placement stays behind.
        if (isChainRoot(s.pieces, at)) {
          pieces[at] = { ...pieces[at], joined: undefined, at: s.pieces[at].at }
          pieces[at + 1] = { ...pieces[at + 1], joined: true, at: undefined }
        }
        if (!s.keepConnected) return { pieces }
        const S = PIECE_LIMITS.slope
        // The two have traded places in the chain: each takes the angle its new
        // place hands it, and whatever follows swings by the difference.
        const was = exitSlope(s.pieces[at + 1])
        // The part at the head of a run holds the angle it was set down on.
        if (!isChainRoot(pieces, at)) {
          pieces[at] = { ...pieces[at], slope: clamp(exitSlope(pieces[at - 1]), S.min, S.max) }
        }
        pieces[at + 1] = { ...pieces[at + 1], slope: clamp(exitSlope(pieces[at]), S.min, S.max) }
        return { pieces: carrySlope(pieces, at + 1, tidy(exitSlope(pieces[at + 1]) - was), true) }
      }),
    // Picking a part is not a model change, so it never lands in the history.
    select: (selectedId) => set({ selectedId }),
  }
})

/** Derived tube dimensions shared by the 2D draft and the 3D solid. */
export interface TubeSpec {
  innerR: number
  outerR: number
  wall: number
  /** Start of the solid material, radians, measured CCW from +X. */
  startAngle: number
  /** Angular extent of solid material, radians. */
  sweep: number
  closed: boolean
  variant: TubeVariant
}

export function tubeSpec(innerDiameter: number, wallThickness: number, variant: TubeVariant): TubeSpec {
  const innerR = innerDiameter / 2
  const outerR = innerR + wallThickness
  const coverage = VARIANT_COVERAGE[variant]
  const sweep = Math.PI * 2 * coverage
  // The opening is always centred on top (+Y, i.e. 90°).
  const gap = Math.PI * 2 - sweep
  const startAngle = Math.PI / 2 + gap / 2
  return {
    innerR,
    outerR,
    wall: wallThickness,
    startAngle,
    sweep,
    closed: variant === 'closed',
    variant,
  }
}

/**
 * The tube one part is cut from — its own bore, wall and style, each falling
 * back to the run's. `base` doubles as that fallback, so a part with nothing of
 * its own hands back the very spec it was given: same object, so a mesh keyed
 * on it is not rebuilt.
 */
export function pieceSpec(base: TubeSpec, piece: Piece): TubeSpec {
  const variant = variantOf(piece, base.variant)
  const innerDiameter = boreOf(piece, base.innerR * 2)
  const wall = wallOf(piece, base.wall)
  return variant === base.variant && innerDiameter === base.innerR * 2 && wall === base.wall
    ? base
    : tubeSpec(innerDiameter, wall, variant)
}

/** Snap-fit joint geometry, derived from the tube wall. */
export interface JointSpec {
  /** Spigot length / socket depth, mm. */
  depth: number
  /** Radius of the mating surface between spigot OD and socket ID. */
  mateR: number
  /** Diametral slip fit clearance, mm. */
  clearance: number
  /** Height of the snap barb, mm. */
  barb: number
}

export function jointSpec(spec: TubeSpec, length: number): JointSpec {
  const depth = Math.max(3, Math.min(8, length * 0.35))
  return {
    depth,
    mateR: spec.innerR + spec.wall / 2,
    clearance: 0.15,
    barb: Math.min(0.6, spec.wall * 0.22),
  }
}
