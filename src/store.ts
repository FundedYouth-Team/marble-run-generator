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
import { buildAssembly, chainBox, placedBox, type Segment } from './lib/layout'
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
import {
  FUNNEL_EXIT_SLOPE,
  funnelExitTurn,
  funnelMouthLeast,
  funnelFall,
  funnelLength as funnelRunLength,
  funnelReach as funnelStubReach,
  funnelShell,
  type FunnelBowl,
  type FunnelShell,
} from './lib/funnel'

/**
 * All dimensions in this app are millimetres. The unit setting only changes how
 * they are written and read on screen — see `lib/units`.
 */
export type TubeVariant = 'half' | 'threequarter' | 'closed'
/**
 * Which way a cut tube's opening faces, in the part's own frame — read looking
 * along the run, the way the marble sees it. Top is up, and is what every open
 * tube was before the side could be chosen.
 *
 * A closed tube has no opening, so this says nothing about one; it is still kept
 * on the part, so a tube cut open again opens the side it was last set to.
 */
export type OpenSide = 'top' | 'right' | 'bottom' | 'left'
export type PieceType =
  | 'straight'
  | 'angle'
  | 'corner'
  | 'hook'
  | 'corkscrew'
  | 'funnel'
  | 'base'
  | 'support'
export type Mode = '2d' | '3d'
/**
 * What the left button does on the 3D stage. Picking a part is the resting
 * state; the other three are modal because each one reads a click as something
 * other than "select this" — a drag on the arrows, or one end of a joint.
 */
export type Tool = 'select' | 'move' | 'rotate' | 'connect' | 'disconnect'
/**
 * How wide a handle tool reaches: the runs that were picked, or every run on the
 * stage. See {@link RunState.toolScope} — the two handles do the same thing
 * either way, so this says what they do it to rather than what they do.
 */
export type ToolScope = 'selected' | 'all'
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
export type Overlay = 'axes' | 'mouse' | 'parts'
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
]

const THEME_KEY = 'mrg.theme'
const PIECE_COLOR_KEY = 'mrg.pieceColor'
const MARBLE_COLOR_KEY = 'mrg.marbleColor'
const WORKPLANE_KEY = 'mrg.workplane'
const SHADING_KEY = 'mrg.shading'
const SCREEN_KEY = 'mrg.screenPxPerMm'
const KEEP_CONNECTED_KEY = 'mrg.keepConnected'
const AUTO_ATTACH_KEY = 'mrg.autoAttach'
const UNITS_KEY = 'mrg.units'
const SHORTCUTS_KEY = 'mrg.shortcuts'
const OVERLAYS_KEY = 'mrg.overlays'
const ROTATE_STEP_KEY = 'mrg.rotateStep'
const JOINT_FILLET_KEY = 'mrg.jointFillet'

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

/**
 * What the workplane is made of in 3D: the sky above the horizon, and the land
 * the grid is ruled on below it. Two colours, so the horizon is a line between
 * them rather than the one flat field the stage used to be.
 */
export type WorkplaneColor = 'sky' | 'land'

/**
 * The stock pair, one per theme — a sky that reads right in daylight is glare at
 * night, and the same goes for the ground under it. Settings edits whichever
 * theme is on.
 */
export const DEFAULT_WORKPLANE: Record<Theme, Record<WorkplaneColor, string>> = {
  light: { sky: '#cfe4f7', land: '#e8edf3' },
  dark: { sky: '#0d141d', land: '#1c2734' },
}

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

/** Either theme keeps its own pair; anything missing or junk falls back to stock. */
function initialWorkplane(): Record<Theme, Record<WorkplaneColor, string>> {
  const w = { light: { ...DEFAULT_WORKPLANE.light }, dark: { ...DEFAULT_WORKPLANE.dark } }
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKPLANE_KEY) : null
  if (!saved) return w
  try {
    const stored = JSON.parse(saved) as Partial<Record<Theme, Partial<Record<WorkplaneColor, unknown>>>>
    for (const t of ['light', 'dark'] as Theme[]) {
      for (const c of ['sky', 'land'] as WorkplaneColor[]) {
        const hex = stored[t]?.[c]
        if (isHexColor(hex)) w[t][c] = hex
      }
    }
  } catch {
    // Unreadable storage just means the stock workplane.
  }
  return w
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

/**
 * Attached is the default: a part out of the library lands on the end of the
 * run rather than out in a field of its own, because that is where it was
 * almost always going to be dragged to anyway.
 */
function initialAutoAttach(): boolean {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTO_ATTACH_KEY) : null
  return saved !== 'off'
}

/**
 * The steps the rings snap to, degrees. Nought is the free swing the rings have
 * always had; the rest are the angles a run is actually built on — an eighth of
 * a turn, a quarter, and the two finer ones a joint is trimmed with.
 */
export const ROTATE_STEPS = [0, 1, 5, 15, 45, 90] as const

/** How a step is written where it is offered — nought is not an angle. */
export const rotateStepLabel = (deg: number) => (deg > 0 ? `${deg}°` : 'Free')

/** Free is the default: the rings swung to wherever they were dragged. */
function initialRotateStep(): number {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ROTATE_STEP_KEY) : null
  const step = Number(saved)
  return ROTATE_STEPS.includes(step as (typeof ROTATE_STEPS)[number]) ? step : 0
}

/**
 * The radius a joint is rounded off with when it is rounded at all, mm — what
 * the Rotate tool hands a part switched over to a rounded pivot.
 *
 * A shade under twice a stock tube's outer radius: wide enough that the arc
 * reads as a curve rather than a softened corner, tight enough that its tangent
 * still fits inside a stock part's lead at a useful turn.
 */
export const JOINT_FILLET_DEFAULT = 24

/** Sharp is the default: a joint is a mitred corner unless it is asked not to be. */
function initialJointFillet(): number {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(JOINT_FILLET_KEY) : null
  const radius = Number(saved)
  return Number.isFinite(radius) &&
    radius >= PIECE_LIMITS.jointFillet.min &&
    radius <= PIECE_LIMITS.jointFillet.max
    ? radius
    : 0
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
  const shown = { axes: true, mouse: true, parts: true }
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
   *
   * Base: how deep the slab is, front to back — its size along its own +Z, the
   * axis every other part runs down. See {@link Piece.width} for the other way
   * across it and {@link Piece.height} for how thick it is.
   *
   * Support: how long the post is along the run it carries — how much of the
   * tube sits in its cradle. Measured the same way a base's depth is, on the
   * part's own +Z, which for a support is the axis of the tube above it.
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
   *
   * Support: how far the cradle's arms wrap round the tube they carry, degrees
   * off the bottom of it. Nought is a flat seat the tube rests on; a right
   * angle is a half-round cup reaching up to the tube's widest point, which is
   * as far as arms can come before they start closing over it.
   */
  sweep?: number
  /**
   * Hook: how wide the turn is, measured on the plane it turns on to the
   * centreline, mm. The whole footprint of the part comes off this — a half
   * turn sets the outgoing run twice this far off the incoming one.
   *
   * Base: how far the four upright corners are rounded off, mm. Nought is a
   * square-cornered slab; anything more is an arc tangent to both sides it
   * meets, and it is held to half the shorter side — round a slab off any
   * further and the corners have eaten the middle. See {@link baseSpec}.
   *
   * Support: the same thing on a smaller plate — how far the four upright
   * corners of the post are rounded off, held the same way against the shorter
   * of its two spans. See {@link supportSpec}.
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
   * Support: how far above the workplane the axis of the tube the post *stands
   * on* sits, mm — nought for one standing on the ground.
   *
   * The mirror of {@link Piece.height}, and what lets runs be stacked. A post
   * cannot always reach the plate: on a run that folds back over itself the
   * floor under the upper level already has the lower level on it, and a column
   * driven down to the plate would go straight through the pipe it was meant to
   * pass. So it stands on that pipe instead — its underside is a saddle cut to
   * the same tube, straddling it exactly as the cradle at the top cups the one
   * above, and the load goes down through the run itself to whatever is holding
   * *that* up.
   *
   * Nought is not a tube at height nought; it is a flat foot on the plate, which
   * is what a post standing on the ground has.
   */
  foot?: number
  /**
   * Support: how far across the post the tube it stands on passes, mm — measured
   * on the post's own +X, so positive is to the right looking along the run.
   *
   * A post is centred under the tube it *carries*, because that is what puts the
   * cradle under the pipe. It is almost never centred over the tube it *stands
   * on*: two levels of a switchback cross at one point and are offset either
   * side of it, and the post has to stand where the upper level is. So the
   * saddle is cut off-centre by however far the lower pipe really passes, which
   * is a shift of the groove and nothing else — see `buildSupportGeometry`.
   */
  footShift?: number
  /**
   * Support: how far the saddle under the post is tipped off level, degrees —
   * the fall of the tube it is standing on, read along the post's own +Z.
   *
   * Its own field rather than {@link Piece.tilt} because the two ends of a post
   * are two different tubes: the classic case is a switchback, where the level
   * below runs back the other way, so the same fall seen along the post's own
   * axis is the opposite sign.
   */
  footTilt?: number
  /**
   * Support: how far the cradle is tipped off level, degrees, positive falling
   * — the fall of the tube it is holding up.
   *
   * It is the cradle that tips and not the post: a support stands dead upright
   * wherever it is put, the way a base lies dead flat, because a printed post
   * leaning over is a printed post that has to be supported itself. So the
   * groove is cut across the top at an angle instead, and the run drops through
   * it at the angle it was already falling at. That is why this is a field of
   * its own rather than {@link Piece.slope}: the slope is what stands a part up
   * in the world, and a support's is always nought.
   */
  tilt?: number
  /**
   * Base: how wide the slab is, side to side — its size along its own +X.
   *
   * The one dimension of a slab with no field of its own already: its depth is
   * {@link Piece.length} and its thickness {@link Piece.height}, both of which
   * mean the same on a slab as they mean everywhere else.
   *
   * Support: how thick the post is across the run — the way it is thinnest, and
   * the one span of it the printed part stands or falls on.
   */
  width?: number
  /**
   * Corkscrew: how far the coil drops from its top ring to its bottom one, mm.
   * The stubs either end of it fall as well, so the part as a whole loses a
   * little more than this.
   *
   * Funnel: how far the marble descends between the mouth and the throat — the
   * depth of the bowl, with the spout under it extra.
   *
   * Base: how thick the slab is — the only one of the three that is measured
   * upward, and the one that decides how far the workplane is buried.
   *
   * Support: how far above the workplane the axis of the tube it carries sits.
   * Not how tall the post is: the material stops a tube's radius short of this,
   * because that is where the cradle has to meet the pipe. Setting the seat
   * rather than the height is what lets a post be aimed at a run — the run
   * states where its centreline is, and this is that number.
   */
  height?: number
  /**
   * Corkscrew: how wide the coil is where the run comes into it, mm.
   *
   * Funnel: how wide the bowl's mouth is, measured inside the wall — what
   * anyone measuring a funnel would measure. The marble runs on a smaller
   * circle than this, because the feed is set in from the wall.
   */
  topDiameter?: number
  /** Corkscrew: how wide it is where the run leaves it, mm. */
  bottomDiameter?: number
  /**
   * Funnel: how high the straight collar round the mouth stands, mm — the band
   * the marble whirls against before the bowl starts closing in under it.
   */
  rim?: number
  /**
   * Funnel: whether the mouth is fed by a feed tube of its own. Unset is one,
   * which is what a funnel out of the library has.
   *
   * Without it the part is a plain funnel and the mouth is the inlet — something
   * else stands over it and the marble is let go into it. It also settles what
   * the bowl does with the marble: the tube's bore comes out square across the
   * bowl's radius, so a marble fed through one goes round the bowl, and a marble
   * let into a plain funnel goes down it.
   */
  leadIn?: boolean
  /**
   * Funnel: the style its lead-out is cut in. Unset follows the part's own
   * style, which in turn follows the run's — the same fallback
   * {@link Piece.variant} works on, one step further in.
   *
   * Only the drain has the choice. The feed is a pipe let through the bowl's
   * wall, and a hole through a wall has no open side to give it, so it is
   * enclosed whatever the rest of the part is cut in.
   */
  leadOutVariant?: TubeVariant
  /**
   * Corkscrew: how many times round the run goes between the two, in quarters
   * of a turn. Negative winds the other way about, the way a negative sweep
   * turns a corner the other way.
   *
   * Funnel: how many times round the marble whirls on its way to the throat,
   * counted the same way, and never nought — see {@link FUNNEL_TURN_LIMITS}.
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
   * Radius the break at this part's *inlet* is rounded off with, mm — the pivot
   * the Rotate tool swings the part about. Zero, or unset, is the mitred corner
   * every joint has always taken; anything more is an arc tangent to the axis
   * the part is fed on and the axis it runs on, so the marble carries its speed
   * through the joint rather than slapping into a kink.
   *
   * Not to be confused with {@link Piece.fillet}, which rounds a connector's own
   * break partway along it. This one is the break the joint puts in, and a part
   * that is not bonded onto anything has none — see {@link leadFor}.
   *
   * The radius costs straight tube: the arc reaches back down the lead by its
   * own tangent, which on a wide radius is a good deal further than a mitre
   * would, and that has to stop short of the socket. So rounding a joint both
   * lengthens its lead and holds the part to a shallower turn — see
   * {@link leadLengthFor} and {@link breakLimitFor}.
   */
  jointFillet?: number
  /**
   * This part's own tube style. Unset follows the run's style, so a part that
   * has never been styled on its own keeps up with whatever the run is set to.
   */
  variant?: TubeVariant
  /**
   * Which side this part's opening faces. Unset follows the run's, the same way
   * {@link Piece.variant} does, so a part that has never been turned on its own
   * keeps up with whatever the run is set to.
   *
   * Kept even while the part is cut closed: a closed tube has no opening to
   * face anywhere, and cutting it open again should put the opening back where
   * it was last asked for rather than on top.
   */
  openSide?: OpenSide
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
  /**
   * The fall the part is fed at, degrees — what the part before it hands on.
   * Set only when that is not already the fall the part itself runs at, or when
   * the part turns at its inlet: those are the two ways a joint would otherwise
   * come out bent, and this is what says by how much.
   *
   * Worked out from the joint and *stored*, the same way a coil's ring count is
   * — see {@link settle} — because the centreline is given nothing but the part,
   * and a part being exported on its own still has to be the shape it is in the
   * run. Never written to a project file: it is read back off the joints on the
   * way in, so it can never go stale against them. See {@link lockJoints}.
   */
  entrySlope?: number
  /**
   * How long that lead runs before the break, mm. {@link JOINT_LOCK} where the
   * part is barely turned off what it is fed, and longer where it is turned
   * hard: the mitre at the break reaches back down the lead and has to stop
   * short of the socket. Derived and stored alongside {@link Piece.entrySlope},
   * for the same reasons, and written to a file no more than that one is.
   */
  leadLength?: number
}

/**
 * How much of a part's inlet is held dead straight along the axis it plugs
 * into, mm — the lock.
 *
 * A snap joint is a socket and a spigot sharing one axis, and the deepest
 * socket this app cuts is 8 mm — see {@link jointSpec}. Bending the run
 * anywhere inside that is a joint that fights itself: on screen the two parts
 * still touch, but printed, the spigot binds on the socket wall and the barb
 * never seats. So the first stretch of every part runs straight out of the
 * socket it is plugged into, whatever the part is aimed at, and the part takes
 * up its own heading and fall at a break past the lock. Two millimetres of
 * margin over the deepest socket.
 *
 * A bend just past the connector is a bend in solid tube, which prints and
 * mates exactly as it reads. A bend *on* the connector is a part that will not
 * go together.
 */
export const JOINT_LOCK = 10

/**
 * How far the run's axis actually turns at a joint lead's break, degrees.
 *
 * The break is three rotations in a row — the fall the part is fed at taken
 * back off, the part's own turn, then its own fall laid back on — and part of
 * that is a twist about the tube rather than a bend across it. Only the bend
 * counts here: a twist costs the tube nothing, while a bend has to be mitred
 * and the mitre has to fit. Read off the composed rotation's effect on the
 * axis, which comes out in closed form.
 *
 * A part turned 90° off a run falling at 26.5° bends 78.5°, not 90° — the rest
 * of it is the twist.
 */
export function breakAngleOf(entrySlope: number, turn: number, slope: number): number {
  const t = (turn / 2) * RAD
  const x = Math.cos(t) * Math.sin(((slope - entrySlope) / 2) * RAD)
  const y = Math.sin(t) * Math.cos(((slope + entrySlope) / 2) * RAD)
  return tidy((Math.acos(clamp(1 - 2 * (x * x + y * y), -1, 1)) / RAD))
}

/**
 * How much straight tube a bend of `angle` eats off each side of itself, mm.
 *
 * Two tubes meeting at a break are mitred: the cut plane halves the angle, so
 * on the inside of the bend it runs back along each leg by the tube's own
 * radius times the tangent of the half angle. Turn a 26 mm tube 90° and the cut
 * reaches 13 mm back down both legs — which is why a sharp turn cannot be made
 * in a short one. Reach back past the socket and the cut takes the socket with
 * it, and there is no joint left to plug into.
 */
export function mitreBite(angle: number, outerR: number): number {
  return outerR * Math.tan((Math.min(Math.abs(angle), 179) / 2) * RAD)
}

/** Editing limits for a piece, shared by the sidebar fields and the draft handles. */
export const PIECE_LIMITS = {
  // Two locks: a part needs its inlet held straight for the socket and its
  // outlet held straight for the spigot, and those two stretches cannot be the
  // same stretch of tube.
  length: { min: JOINT_LOCK * 2, max: 600, step: 1 },
  // Straight down is as far as a part can point either way: past vertical it
  // would double back on itself, and the developed elevation has nowhere to
  // draw that.
  slope: { min: -90, max: 90, step: 0.5 },
  turn: { min: -90, max: 90, step: 1 },
  bend: { min: -90, max: 90, step: 1 },
  sweep: { min: -90, max: 90, step: 1 },
  // A connector's outgoing leg carries the spigot, so it is held to a lock of
  // its own — the leg the break leaves behind has to be straight tube for the
  // next part to plug onto.
  exitLength: { min: JOINT_LOCK * 2, max: 600, step: 1 },
  fillet: { min: 0, max: 120, step: 1 },
  // The joint's own rounding. Held tighter than a connector's: this arc has to
  // fit inside the lead, between the socket it must not reach back into and the
  // body of the part past the break, and a lead is a lock or two of tube rather
  // than a whole leg.
  jointFillet: { min: 0, max: 80, step: 1 },
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
  // A funnel's collar. Nought is a plain cone with no lip on it at all; past
  // this the bowl is a cup rather than a funnel, and there is a floor under it
  // anyway — the last of the depth is always left as cone.
  rim: { min: 0, max: 120, step: 1 },
} as const

/**
 * How many times round a funnel whirls the marble.
 *
 * The step is the floor as well as the increment: a funnel with a feed tube
 * whirls at least this far, because the tube runs in square across the bowl and a
 * marble leaving it has nowhere to go but round. Dropping one straight in is
 * done by taking the tube off, not by winding the count down to nought.
 */
export const FUNNEL_TURN_LIMITS = { min: -6, max: 6, step: 0.25 } as const

/**
 * How big a base may be, mm.
 *
 * Its own three rather than {@link PIECE_LIMITS}: a slab is not a length of
 * tube, and the figures that hold a tube to something printable say nothing
 * about a plate. Wide enough to run a whole stage over — a base is there to
 * take up the space under everything, so its ceiling is the plate it will be
 * printed on rather than anything about the run. The floor on the thickness is
 * a plate that will not warp off the bed; the floor on the two spans is a tile
 * rather than a chip.
 *
 * The corner radius has no floor at all: nought is a square corner, which is a
 * base as much as a rounded one is. Its ceiling is held again per slab, against
 * the shorter of the two sides — see {@link baseSpec}.
 */
export const BASE_LIMITS = {
  width: { min: 20, max: 1200, step: 1 },
  depth: { min: 20, max: 1200, step: 1 },
  height: { min: 1, max: 200, step: 0.5 },
  radius: { min: 0, max: 300, step: 1 },
} as const

/**
 * How big a support may be, mm and degrees.
 *
 * Its own set again, for the reason a base has its own: a post is not a length
 * of tube either. The floor on the width is a wall a printer can actually lay
 * down and a post that will not snap off the plate; the ceiling on the seat is
 * as high as anything on this stage is ever going to stand.
 *
 * The wrap stops at a right angle because that is where the arms reach the
 * widest part of the tube. Past it they would start closing over the pipe, and
 * a cradle that closes over the pipe is not a cradle any more — it is a clamp
 * the run cannot be dropped into, and an overhang the printer cannot lay down.
 *
 * The tilt stops short of the upright, and well short: the groove is cut by a
 * cylinder lying across the post, and the steeper that cylinder is pitched the
 * longer the cut it takes out of the top. Past about here a post is more notch
 * than post, and a run falling that steeply wants a wall beside it rather than a
 * seat under it.
 */
export const SUPPORT_LIMITS = {
  width: { min: 3, max: 200, step: 0.5 },
  depth: { min: 4, max: 400, step: 1 },
  height: { min: 2, max: 1200, step: 0.5 },
  radius: { min: 0, max: 100, step: 0.5 },
  wrap: { min: 0, max: 90, step: 1 },
  tilt: { min: -70, max: 70, step: 0.5 },
  // A foot standing on the run rather than on the plate. Nought is the floor,
  // which is where every post stands until something is in the way of it.
  foot: { min: 0, max: 1200, step: 0.5 },
  footTilt: { min: -70, max: 70, step: 0.5 },
  // Shifted right off the post and the saddle is not on it at all, which is a
  // post standing beside its tube rather than on it. Held to a span rather than
  // to the post's own width because the width is the user's to change, and a
  // shift that quietly re-clamped every time the post was narrowed would be a
  // number that will not stay where it is put.
  footShift: { min: -200, max: 200, step: 0.5 },
} as const

/**
 * What a support is when it lands on the stage: a thin upright fin standing
 * across the run, cradling a tube half a hand above the plate, with its arms
 * reaching a little past halfway up the pipe so the run sits down in it rather
 * than balancing on it.
 *
 * The two spans are the shape of it, and they are the way round they are for a
 * reason. Across the run it has to be *wider than the tube*, or there is nowhere
 * for the arms to come up and the cradle is a scoop rather than a cup — see
 * {@link supportArms}. Along the run it wants to be thin: a post holds the tube
 * at a place, not over a stretch, and every millimetre of reach is filament
 * spent and plate taken up. A plate on edge is also the one thing a printer
 * makes best.
 *
 * Deliberately much smaller than a base. A base is sized to the whole stage and
 * arrives asking to be resized; a post is sized to one tube, and the size it
 * arrives at is very nearly always the size it stays.
 */
export const SUPPORT_DEFAULTS = {
  width: 26,
  depth: 10,
  height: 90,
  radius: 2,
  wrap: 55,
  tilt: 0,
  foot: 0,
  footTilt: 0,
  footShift: 0,
} as const

/**
 * A post, in the part's own frame: it stands on the workplane with its
 * underside at y = 0, centred on the origin in x and z, and its top is cut away
 * by the tube it carries.
 *
 * Everything the shape needs and nothing about where it stands — the same
 * bargain {@link baseSpec} and {@link funnelSpec} strike. The one thing it does
 * *not* carry is how fat that tube is: the cradle is cut to whatever the part
 * is set against, which is the run's tube or the post's own, and that is handed
 * in separately by whoever is building the shape.
 */
export interface SupportPost {
  /** Across the run, along the part's own +X. */
  width: number
  /** Along the run, along the part's own +Z. */
  depth: number
  /** How far above the workplane the axis of the tube it carries sits, mm. */
  height: number
  /** How far the four upright corners are rounded off, mm; nought is square. */
  radius: number
  /**
   * How far the arms wrap round the tube, degrees off the bottom of it — and, on
   * a post standing on the run, how far the saddle under it straddles down the
   * sides of the tube it is standing on. One figure for both ends: a post that
   * cups what it carries and grips what it stands on to the same degree is a
   * post described by one number instead of two that would never sensibly
   * differ.
   */
  wrap: number
  /** How far the cradle is tipped off level, degrees, positive falling. */
  tilt: number
  /**
   * How far above the workplane the axis of the tube the post stands on sits,
   * mm; nought is a flat foot on the plate.
   */
  foot: number
  /** How far the saddle under it is tipped off level, degrees. */
  footTilt: number
  /** How far across the post the tube it stands on passes, mm. */
  footShift: number
}

/**
 * The support's own numbers, with anything unset filled in and everything held
 * to something that can be built.
 *
 * The corner radius is held against the two spans exactly as a base's is, and
 * for the same reason: two corners share each side. Nothing here is held
 * against the tube — a post whose seat is lower than the pipe is fat is a post
 * with no material left in it, and that is answered where the shape is built
 * rather than here, because the tube is not part of the post's own numbers.
 */
export function supportSpec(piece: Piece): SupportPost {
  const S = SUPPORT_LIMITS
  const width = clamp(piece.width ?? SUPPORT_DEFAULTS.width, S.width.min, S.width.max)
  const depth = clamp(piece.length, S.depth.min, S.depth.max)
  const height = clamp(piece.height ?? SUPPORT_DEFAULTS.height, S.height.min, S.height.max)
  const radius = clamp(
    piece.radius ?? SUPPORT_DEFAULTS.radius,
    S.radius.min,
    Math.min(S.radius.max, Math.min(width, depth) / 2),
  )
  return {
    width,
    depth,
    height,
    radius,
    wrap: clamp(piece.sweep ?? SUPPORT_DEFAULTS.wrap, S.wrap.min, S.wrap.max),
    tilt: clamp(piece.tilt ?? SUPPORT_DEFAULTS.tilt, S.tilt.min, S.tilt.max),
    // Held under the seat as well as inside its own range: a post standing on
    // something higher than the thing it is carrying is upside down, and there
    // is no shape to build for that.
    foot: clamp(piece.foot ?? SUPPORT_DEFAULTS.foot, S.foot.min, Math.min(S.foot.max, height)),
    footTilt: clamp(
      piece.footTilt ?? SUPPORT_DEFAULTS.footTilt,
      S.footTilt.min,
      S.footTilt.max,
    ),
    footShift: clamp(
      piece.footShift ?? SUPPORT_DEFAULTS.footShift,
      S.footShift.min,
      S.footShift.max,
    ),
  }
}

/**
 * How far up the world a post reaches, mm — the top of the box it occupies.
 *
 * Its seat is where the tube's *axis* sits, and the material stops short of
 * that by a radius, so on a level post the box tops out under the seat. A
 * tilted one is the other way about: the groove is cut on a slope, so the end
 * the run comes in at stands higher than the seat by however far the slope has
 * risen over half the post's length.
 *
 * Read without knowing the tube at all, and deliberately generous where it is
 * uncertain: this is what frames the camera and bounds the drawing, and a box
 * that is a few millimetres too big crops nothing.
 */
/**
 * How wide a post has to be for its arms to come up at all, mm — the span
 * between the two points on the tube the wrap actually reaches.
 *
 * The wrap says how far round the pipe the cradle climbs, and how far round is
 * how far *out*: arms that reach a third of the way up a tube stand that much
 * wider apart than ones that only cup its underside. A post narrower than this
 * is cut clean through by the groove before the arms have started, so its top is
 * a scoop with no sides and its wrap does nothing at all — which is worth being
 * able to say on screen rather than leaving to be discovered.
 *
 * `cradle` is the outer radius of the tube the post is cut to carry.
 */
export function supportArms(post: SupportPost, cradle: number): number {
  return 2 * cradle * Math.sin(post.wrap * RAD)
}

/**
 * The band of the world a post fills, mm — the box it occupies, floor and
 * ceiling.
 *
 * Its seat is where the tube's *axis* sits, and the material stops short of that
 * by a radius, so on a level post the box tops out under the seat. A tilted one
 * is the other way about: the groove is cut on a slope, so the end the run comes
 * in at stands higher than the seat by however far the slope has risen over half
 * the post's length. The underside works the same way about its own tube, and on
 * a post standing on the plate it is simply the plate.
 *
 * Read without knowing the tube at all, and deliberately generous at both ends:
 * this is what frames the camera and bounds the drawing, and a box that is a few
 * millimetres too big crops nothing.
 */
export function supportBand(post: SupportPost): { low: number; high: number } {
  const swing = (deg: number) => (post.depth / 2) * Math.abs(Math.tan(deg * RAD))
  return {
    low: post.foot > 0 ? Math.max(0, post.foot - swing(post.footTilt)) : 0,
    high: post.height + swing(post.tilt),
  }
}

/** How far up the world a post reaches, mm — the top of the box it occupies. */
export function supportRise(post: SupportPost): number {
  return supportBand(post).high
}

/**
 * How far up the post there is solid material at its lowest, mm — the floor of
 * the cradle at the deepest the groove is cut, which on a tilted post is at
 * whichever end the run leaves by.
 *
 * This is the height a marble may safely be stopped by, and the reason it is the
 * *lowest* point rather than the seat: a box drawn up to the arms would stand in
 * the bore of the very tube the post is holding, and the marble running down
 * that tube would slam into its own support. Under the pipe there is nothing to
 * hit. See `buildWorld`, which meets a post as the band between this and
 * {@link supportLift}.
 *
 * `cradle` is the outer radius of the tube the post is cut to carry.
 */
export function supportFloor(post: SupportPost, cradle: number): number {
  const t = post.tilt * RAD
  return Math.max(
    supportLift(post, cradle),
    post.height - (cradle + (post.depth / 2) * Math.abs(Math.sin(t))) / Math.cos(t),
  )
}

/**
 * How far up the post's underside reaches at its highest, mm — the crown of the
 * saddle a stacked post straddles its tube with, and nought for one standing on
 * the plate.
 *
 * The same care as {@link supportFloor} and the same reason, upside down: the
 * saddle arches *over* the tube below, so a box drawn from the plate up would
 * fill the bore of that tube and the marble running down it would hit the post
 * standing on it. Over the pipe there is nothing to hit.
 */
export function supportLift(post: SupportPost, cradle: number): number {
  if (post.foot <= 0) return 0
  const t = post.footTilt * RAD
  return Math.max(
    0,
    post.foot + (cradle + (post.depth / 2) * Math.abs(Math.sin(t))) / Math.cos(t),
  )
}

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
 * What a funnel is when it lands on the stage: a wide level mouth, a collar to
 * whirl against, and two turns of bowl down to a short spout. The feed stub is
 * long because it has to reach out over the collar to be attached to it — see
 * {@link funnelReach} — rather than because the part needs the track.
 */
export const FUNNEL_DEFAULTS = {
  length: 60,
  mouthDiameter: 140,
  height: 90,
  rim: 18,
  turns: 2,
  exitLength: 30,
} as const

/** How many times round a funnel whirls out of the library. */
export const FUNNEL_TURNS_SPIRAL = FUNNEL_DEFAULTS.turns

/** Whether a funnel is fed by a feed tube of its own. Unset is one. */
export function funnelHasLead(piece: Piece): boolean {
  return piece.leadIn ?? true
}

/** The funnel's own numbers, with anything unset filled in. */
export function funnelSpec(piece: Piece): FunnelBowl {
  const depth = piece.height ?? FUNNEL_DEFAULTS.height
  const lead = funnelHasLead(piece)
  const turns = piece.rings ?? FUNNEL_DEFAULTS.turns
  return {
    // No feed tube, no stub: the mouth is the inlet, and the part starts there.
    entry: lead ? piece.length : 0,
    mouthRadius: (piece.topDiameter ?? FUNNEL_DEFAULTS.mouthDiameter) / 2,
    depth,
    // Held under the depth it is carved out of, so a collar dragged past the
    // bowl leaves a cone rather than a bottomless cup.
    rim: clamp(piece.rim ?? FUNNEL_DEFAULTS.rim, 0, Math.max(0, depth)),
    // A fed funnel always whirls and a plain funnel never does, and neither is a
    // choice: the tube runs in square across the bowl, so the marble leaves it
    // running round the bowl and there is no other way out of it, while a bare
    // bowl has nothing aimed across the mouth at all. So the count is held clear
    // of nought while there is a tube, and taken to nought when there is not —
    // kept on the part either way, so taking the tube off and putting it back
    // puts the whirl back with it.
    turns: lead
      ? Math.sign(turns || 1) * clamp(Math.abs(turns), FUNNEL_TURN_LIMITS.step, FUNNEL_TURN_LIMITS.max)
      : 0,
    exit: piece.exitLength ?? FUNNEL_DEFAULTS.exitLength,
    lead,
  }
}

/**
 * The tube one of a funnel's two stubs is cut from: its own style if it has been
 * given one, and otherwise the part's — which is itself the run's until the part
 * is styled on its own. Bore and wall are always the part's, since both stubs
 * carry the same marble through the same bowl.
 *
 * Only the drain is ever asked for. The feed is a pipe let through the bowl's
 * wall, and a hole through a wall has no open side to give it, so it is
 * enclosed whatever the rest of the part is cut in.
 *
 * `base` doubles as the fallback, so a stub with no style of its own hands back
 * the very spec it was given — same object, so a mesh keyed on it is not rebuilt.
 */
export function funnelDrainSpec(base: TubeSpec, piece: Piece): TubeSpec {
  const own = piece.leadOutVariant
  if (!own || own === base.variant) return base
  // The side is the part's throughout — only the style is the stub's own.
  return tubeSpec(base.innerR * 2, base.wall, own, base.openSide)
}

/** The style a funnel's drain is actually cut in. */
export function funnelDrainVariant(piece: Piece, runVariant: TubeVariant): TubeVariant {
  return piece.leadOutVariant ?? variantOf(piece, runVariant)
}

/**
 * Whether a funnel whirls the marble round rather than taking it straight in.
 *
 * Which is the same question as whether it has a feed tube, and no longer a
 * separate one: the tube runs in square across the bowl, so a marble leaving it
 * goes round; a plain funnel has nothing aimed across the mouth, so a marble let
 * into it goes down. See {@link funnelSpec}.
 */
export function funnelWhirls(piece: Piece): boolean {
  return funnelHasLead(piece)
}

/** Which way a funnel whirls: -1 to the left, +1 to the right. */
export function funnelHand(piece: Piece): number {
  return (piece.rings ?? FUNNEL_DEFAULTS.turns) < 0 ? -1 : 1
}

/** Centreline length of a funnel, mm — both stubs and the whirl between them. */
export function funnelLength(piece: Piece): number {
  return funnelRunLength(funnelSpec(piece))
}

/** How far a funnel's outlet sits below its inlet, mm — the bowl and the spout. */
export function funnelDrop(piece: Piece): number {
  return funnelFall(funnelSpec(piece))
}

/**
 * The bowl a funnel is actually cut as, off the tube it is cut from. Everything
 * about the solid that the sidebar reads out — how deep the collar really is,
 * how far the feed has to reach — comes through here.
 */
export function funnelBowlOf(piece: Piece, innerR: number, wall: number): FunnelShell {
  return funnelShell(funnelSpec(piece), innerR, wall)
}

/**
 * The least bowl a funnel can be built with, mm across the inside — narrower
 * than this and the feed comes out of the back of it. See
 * {@link funnelMouthLeast}.
 */
export function funnelMouth(innerR: number, wall: number): number {
  return Math.min(PIECE_LIMITS.topDiameter.max, Math.ceil(funnelMouthLeast(innerR, wall)))
}

/** The least feed stub a funnel can be built with, mm. See {@link funnelStubReach}. */
export function funnelReach(piece: Piece, innerR: number, wall: number): number {
  // Whole millimetres, because the stub is a length the user types and a stop
  // that lands on 38.6274 would fight the stepper every time it is nudged.
  return Math.min(
    PIECE_LIMITS.length.max,
    Math.max(PIECE_LIMITS.length.min, Math.ceil(funnelStubReach(funnelSpec(piece), innerR, wall))),
  )
}

/* ------------------------------------------------------------------ */
/* The base                                                            */
/* ------------------------------------------------------------------ */

/**
 * What a base is when it lands on the stage: a square plate a couple of
 * hand-spans across, thick enough to read as a plinth rather than as a sheet,
 * and rounded off at the corners because a square corner on a printed plate is
 * the first thing to chip.
 *
 * It is deliberately bigger than any one part in the library. A base is not a
 * piece of the run — it is the ground the run stands on — so it arrives at a
 * size worth resizing rather than at a size worth ignoring.
 */
export const BASE_DEFAULTS = {
  width: 240,
  depth: 240,
  height: 8,
  radius: 12,
} as const

/**
 * A slab, in the part's own frame: it sits on the workplane with its bottom face
 * at y = 0, centred on the origin in x and z, and stands `height` mm up.
 *
 * Everything the shape needs and nothing about where it stands, so the mesh, the
 * marble and the drawing can all be handed the same four numbers — the same
 * bargain {@link funnelSpec} and {@link corkscrewSpec} strike.
 */
export interface BaseSlab {
  /** Side to side, along the part's own +X. */
  width: number
  /** Front to back, along the part's own +Z — the axis every other part runs down. */
  depth: number
  /** Up from the workplane, mm. */
  height: number
  /** How far the four upright corners are rounded off, mm; nought is square. */
  radius: number
}

/**
 * The base's own numbers, with anything unset filled in and everything held to
 * something that can be built.
 *
 * The corner radius is the one that has to be held against the others rather
 * than on its own: two corners share each side, so a radius past half the
 * shorter side is two arcs asking for the same material. Held there, a slab
 * rounded as far as it will go is a stadium — and one whose sides are equal is
 * a disc, which is a base as much as anything else is.
 */
export function baseSpec(piece: Piece): BaseSlab {
  const B = BASE_LIMITS
  const width = clamp(piece.width ?? BASE_DEFAULTS.width, B.width.min, B.width.max)
  const depth = clamp(piece.length, B.depth.min, B.depth.max)
  const height = clamp(piece.height ?? BASE_DEFAULTS.height, B.height.min, B.height.max)
  const radius = clamp(
    piece.radius ?? BASE_DEFAULTS.radius,
    B.radius.min,
    Math.min(B.radius.max, Math.min(width, depth) / 2),
  )
  return { width, depth, height, radius }
}

/**
 * Whether a part is a base — the one thing on the stage that is not a length of
 * tube and is not part of any run.
 *
 * Asked in a good many places, and worth a name in all of them: a base takes no
 * joints, carries no marble, has no bore and never leaves the workplane, and
 * every one of those is this same question.
 */
export function isBase(piece: Piece): boolean {
  return piece.type === 'base'
}

/** Whether a part is a support — a post standing under the run, holding it up. */
export function isSupport(piece: Piece): boolean {
  return piece.type === 'support'
}

/**
 * Whether a part is structure rather than run: something the marble travels
 * over the top of rather than through.
 *
 * The base and the support are the two, and nearly everything that used to ask
 * "is this a base" was really asking this. Neither takes a joint, neither
 * carries the marble, neither has a bore or a style, and neither ever leaves the
 * workplane — and every one of those is this same question. What is left to
 * {@link isBase} and {@link isSupport} is the handful of places that genuinely
 * mean one of the two shapes: a slab is not a post.
 */
export function isStructure(piece: Piece): boolean {
  return isBase(piece) || isSupport(piece)
}

/**
 * Whether a part's fall is its own to keep rather than the run's to set.
 *
 * Every other part takes whatever angle the part before it hands on. Two
 * cannot. A corkscrew's four numbers already fix how far it goes round and how
 * far it drops doing it, and those two between them leave exactly one angle the
 * coil can run at. A funnel is blunter about it: its bowl is only a bowl while
 * it is level, and its feed is a pipe let in through the bowl's own side wall,
 * which a feed tipped even a few degrees would run out through the rim. So the
 * only fall a funnel runs at is none.
 *
 * A base is the third, and the plainest of the three: it is a slab lying on the
 * workplane, and a slab on a slope is not lying on anything. A support is the
 * fourth and says the same thing standing up: a post leaning over is a post
 * that needs propping itself, so it stands square whatever the run above it is
 * doing — see {@link Piece.tilt}, which is where the run's fall actually goes.
 *
 * Either way the part states its fall and the run has to meet it — a printed
 * part is a fixed thing, and this is what makes it behave like one.
 */
export function slopeIsFixed(piece: Piece): boolean {
  return piece.type === 'corkscrew' || piece.type === 'funnel' || isStructure(piece)
}

/** The one fall a part with a fall of its own may sit at, degrees. */
function fixedSlopeOf(piece: Piece): number {
  return piece.type === 'corkscrew' ? corkscrewPitch(piece) : 0
}

/**
 * A part put back on the shape its own numbers demand: a coil's rings and the
 * fall they leave it running at, a funnel's feed tube and the level it is fed at,
 * and — whatever the part — a fall it can actually stand at.
 *
 * That last one matters more than it reads. A hook is drawn from a fall held
 * inside its own limit, so a part left holding a steeper one draws at one angle
 * and reports handing on the angle it would have had at another: the joint past
 * it is then measured against a figure nothing on screen is standing at. The
 * sidebar and the drag handles have always held the field down to the part's own
 * range, so this only ever caught a run arriving from a file — but the fall a
 * part is *stored* at is the one every joint is worked out from, so this is
 * where it has to be true.
 *
 * `innerR` and `wall` are the tube this part is actually cut from, which is what
 * says how much room a ring takes up and how far a feed has to reach. Both
 * answers are worked out here and then *stored* rather than derived on demand,
 * because the centreline — the one description of a part's shape — is given
 * nothing but the part, and knows nothing about the tube the run is set to.
 */
function settle(piece: Piece, innerR: number, wall: number): Piece {
  // Structure is settled against nothing but itself: neither a slab nor a post
  // is cut from the tube, so the bore and the wall have no bearing on either.
  // The post's *cradle* is cut to the tube, but that is a face of the shape
  // rather than a number on the part — see {@link supportSpec}.
  if (isBase(piece)) return slab(piece)
  if (isSupport(piece)) return post(piece)
  const wound = !slopeIsFixed(piece)
    ? piece
    : piece.type === 'funnel'
      ? reach(piece, innerR, wall)
      : wind(piece, innerR + wall)
  // A part with a fall of its own has a range of exactly that one fall, so this
  // is what pins a coil to its coil and a bowl to the level — the same clamp,
  // rather than a case of its own. See {@link slopeRange}.
  const range = slopeRange(wound)
  const slope = clamp(wound.slope, range.min, range.max)
  return holdLegs(wound.slope === slope ? wound : { ...wound, slope })
}

/**
 * A part held long enough to carry a joint at each end.
 *
 * Two locks is the least any part can be: one at the inlet for the socket and
 * the lead that runs out of it, one at the outlet for the spigot, and they
 * cannot be the same stretch of tube. The fields are already held to this on
 * the way in — see {@link PIECE_LIMITS} — so what this catches is a run
 * arriving from a file written before the lock existed, where a part may be
 * shorter than its own joints.
 *
 * Held up rather than clamped both ways: a long leg is nobody's business.
 */
function holdLegs(piece: Piece): Piece {
  const least = JOINT_LOCK * 2
  // A plain funnel's inlet is its open mouth: nothing plugs into it, so its
  // stub is not a leg and is left to {@link reach}.
  const feeds = piece.type !== 'funnel' || funnelHasLead(piece)
  const length = feeds ? Math.max(piece.length, least) : piece.length
  // Only the parts built from two legs have an outgoing one to hold.
  const exit =
    piece.exitLength === undefined ? undefined : Math.max(piece.exitLength, least)
  if (length === piece.length && exit === piece.exitLength) return piece
  return { ...piece, length, ...(exit === undefined ? {} : { exitLength: exit }) }
}

/**
 * A base put back on a slab that can actually be built: every side inside its
 * own limits, the corners rounded no further than the shorter side allows, and
 * lying dead flat.
 *
 * Written back onto the part rather than worked out on demand, for the reason
 * every other settled figure is: the shape is asked for in places that are given
 * nothing but the part, and a slab held only at the sidebar would come back off
 * a file holding whatever the file said.
 */
function slab(piece: Piece): Piece {
  const { width, depth, height, radius } = baseSpec(piece)
  const flat = piece.slope === 0 ? piece : { ...piece, slope: 0 }
  if (
    flat.width === width &&
    flat.length === depth &&
    flat.height === height &&
    flat.radius === radius
  ) {
    return flat
  }
  return { ...flat, width, length: depth, height, radius }
}

/**
 * A support put back on a post that can actually be built: every span inside its
 * own limits, the corners rounded no further than the shorter span allows, the
 * arms and the tilt held where a cradle is still a cradle, and standing dead
 * upright.
 *
 * Written back onto the part for the reason a slab's numbers are: the shape is
 * asked for in places that are handed nothing but the part, so a post held only
 * at the sidebar would come back off a file holding whatever the file said.
 */
function post(piece: Piece): Piece {
  const { width, depth, height, radius, wrap, tilt, foot, footTilt, footShift } =
    supportSpec(piece)
  const square = piece.slope === 0 ? piece : { ...piece, slope: 0 }
  if (
    square.width === width &&
    square.length === depth &&
    square.height === height &&
    square.radius === radius &&
    square.sweep === wrap &&
    square.tilt === tilt &&
    square.foot === foot &&
    square.footTilt === footTilt &&
    square.footShift === footShift
  ) {
    return square
  }
  return {
    ...square,
    width,
    length: depth,
    height,
    radius,
    sweep: wrap,
    tilt,
    foot,
    footTilt,
    footShift,
  }
}

/** A coil on the ring count its height and its tube leave it. */
function wind(piece: Piece, outerR: number): Piece {
  const height = piece.height ?? CORKSCREW_DEFAULTS.height
  const R = PIECE_LIMITS.rings
  // A count set by hand stands as it was given; otherwise it is counted off the
  // room the height leaves. Which way the coil winds is a choice either way, so
  // the sign is carried across rather than taken from the count.
  const count = piece.ringsSet
    ? clamp(Math.abs(piece.rings ?? 1), R.step, R.max)
    : corkscrewRingsFor(height, outerR)
  const rings = count * corkscrewHand(piece)
  return piece.rings === rings ? piece : { ...piece, rings }
}

/**
 * A funnel with a feed tube long enough to stand clear of the bowl. Held up to
 * the reach rather than clamped both ways: a longer tube is a run of track into
 * the mouth and is nobody's business but the user's, while a shorter one has its
 * socket half swallowed by the bowl it is feeding.
 */
function reach(piece: Piece, innerR: number, wall: number): Piece {
  // The bowl comes first: how far the feed has to run is measured off it, so a
  // bowl too narrow for the tube would be sizing the feed against a shape that
  // cannot be built. Held up rather than clamped both ways — a wider bowl is
  // nobody's business but the user's.
  const mouth = funnelMouth(innerR, wall)
  const wide =
    (piece.topDiameter ?? FUNNEL_DEFAULTS.mouthDiameter) >= mouth
      ? piece
      : { ...piece, topDiameter: mouth }
  // A plain funnel has no feed tube to hold up, so its stub is nobody's business.
  if (!funnelHasLead(wide)) return wide
  const least = funnelReach(wide, innerR, wall)
  return wide.length >= least ? wide : { ...wide, length: least }
}

/**
 * Every part in the list settled against the tube it is cut from — its own if
 * it has been sized on its own, and otherwise the run's.
 *
 * This runs on the way out of every edit, so nothing has to remember which
 * fields a coil or a bowl watches: changing a height settles it, and so does
 * changing the tube under it from the other side of the sidebar.
 */
export function settleAll(pieces: Piece[], runBore: number, runWall: number): Piece[] {
  let changed = false
  const next = pieces.map((p) => {
    const settled = settle(p, boreOf(p, runBore) / 2, wallOf(p, runWall))
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
  // The way out of a funnel is straight down the throat, and there is no other.
  if (piece.type === 'funnel') return FUNNEL_EXIT_SLOPE
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
  // A funnel hands on the way the marble was last travelling as it fell into
  // the throat, which is nothing at all when it went straight in.
  if (piece.type === 'funnel') return tidy(funnelExitTurn(funnelSpec(piece)))
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
  if (piece.type === 'hook' || slopeIsFixed(piece)) return { ...S, ...slopeRange(piece) }
  if (piece.type !== 'angle') return S
  const { bend } = angleSpec(piece)
  return { ...S, min: Math.max(S.min, S.min - bend), max: Math.min(S.max, S.max - bend) }
}

/**
 * How far a part's own slope may go, as the walks along a run read it. A hook
 * narrows it — see {@link HOOK_SLOPE_LIMIT} — and a part on a fall of its own
 * closes it to that one angle, which is what pins a coil or a bowl wherever the
 * run tries to swing it. An angle connector's extra room is the bend's business
 * rather than the walk's, so it is not applied here.
 */
const slopeRange = (piece: Piece) =>
  piece.type === 'hook'
    ? { min: -HOOK_SLOPE_LIMIT, max: HOOK_SLOPE_LIMIT }
    : slopeIsFixed(piece)
      ? { min: fixedSlopeOf(piece), max: fixedSlopeOf(piece) }
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
  // Read through {@link groundSeat}, so a base or a support is on the workplane
  // wherever the question is asked from — the layout, the gizmos, the draft —
  // and not merely wherever it was last written.
  return groundSeat(piece, piece.at ?? ORIGIN_PLACEMENT)
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
  // Structure has no ends at all. A slab standing under the run and a post
  // holding it up are not lengths of it: neither has a socket to be fed through
  // or a spigot to plug in, so neither of their ends is open — they are not
  // ends.
  if (isStructure(pieces[i])) return false
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
 * Two cannot. A hook rolled off both the flat and the edge is the awkward one:
 * its turn runs about an axis the part is only able to name in the plane square
 * to the way it came in — and turned round, the way it came in is somewhere
 * else. On the quarter planes that works out: the axis is either dead upright or
 * dead across, and both of those still lie in the new plane. Rolled between them
 * it does not, and there is no hook that lies on the same ground backwards.
 * Measured, not argued: off the quarters the nearest hook to the mirror is tens
 * of millimetres from it.
 *
 * A funnel is the plain one: it is a bowl. A bowl travelled backwards is a
 * marble climbing out of a throat and being flung up a wall, and there is no
 * shape to describe that with — the part is not symmetrical about anything.
 */
export function canReverse(piece: Piece): boolean {
  // Structure is not travelled at all, so there is no other way round to
  // describe it from. It is also never inside a run, so nothing ever asks.
  if (piece.type === 'funnel' || isStructure(piece)) return false
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
 * The end a part fresh out of the library is bonded onto, or null if the stage
 * is empty and there is nothing to bond it to.
 *
 * The end held by the Connector comes first: picking one is the user saying, in
 * so many words, where the next part goes. Failing that it is the far end of
 * whichever run the part leading the selection belongs to, and failing that the
 * far end of the last run on the stage — which on a run built part by part is
 * the same end either way, and is the one the hand was reaching for.
 *
 * The lead rather than the whole set, even where a whole set is being copied
 * onto the run: a set can span several runs, and the end a copy lands on has to
 * be one end.
 *
 * A head can be picked as well as a tail. Pick one and the new part lands in
 * front of the run rather than behind it, which is the only way to build a run
 * backwards from the funnel it has to arrive at.
 *
 * A base is passed over wherever it would otherwise be the answer. It has no
 * ends to bond to, so the reach falls back past it to the last run on the stage
 * that has — and a stage holding nothing but bases has nowhere to attach at all.
 */
export function attachPort(s: {
  pieces: Piece[]
  pendingPort: Port | null
  selectedId: string | null
}): Port | null {
  if (s.pendingPort && isOpenPort(s.pieces, s.pendingPort)) return s.pendingPort
  const lead = s.selectedId ? s.pieces.findIndex((p) => p.id === s.selectedId) : -1
  const from = lead >= 0 && !isStructure(s.pieces[lead]) ? lead : lastRunEnd(s.pieces)
  if (from < 0) return null
  return { pieceId: s.pieces[chainTailOf(s.pieces, from)].id, end: 'out' }
}

/** The last part on the stage that is actually a length of run; -1 if there is none. */
function lastRunEnd(pieces: Piece[]): number {
  for (let i = pieces.length - 1; i >= 0; i--) if (!isStructure(pieces[i])) return i
  return -1
}

/**
 * The selection, given a set of parts: the whole set, and the last one named
 * leading it. Every hand on the selection goes through here, so the lead and the
 * set can never drift apart — see {@link RunState.selectedId}.
 */
function picked(ids: string[]): { selectedIds: string[]; selectedId: string | null } {
  return { selectedIds: ids, selectedId: ids[ids.length - 1] ?? null }
}

/**
 * The two ends bonded together, or null if the pair cannot take a joint.
 *
 * Two like ends have nothing to mate: a spigot needs a socket. The end named
 * first is the one that travels, so its run is the one turned end for end —
 * which leaves that same end of that same part now facing the other way, and
 * the pair a spigot and a socket after all.
 *
 * Split out of {@link RunState.connectPorts} because a part out of the library
 * takes this very same joint on the way in — see {@link RunState.addPiece}. A
 * joint made two ways is a joint that drifts apart.
 */
function joinPorts(
  pieces: Piece[],
  a: Port,
  b: Port,
  keepConnected: boolean,
  tube: TubeOf,
): Piece[] | null {
  if (!canConnect(pieces, a, b)) return null
  const flip = a.end === b.end
  const held = flip ? turnRunAround(pieces, a) : pieces
  const first = flip ? otherEnd(a) : a
  const outlet = first.end === 'out' ? first : b
  const inlet = first.end === 'in' ? first : b
  // Named by its inlet, the run behind it is carried onto the outlet anyway —
  // that is what welding it on does. Named by its outlet, it is the run in
  // front that has to come round, so it is swung and set down against the other
  // one first, and the weld below then has nothing left to move.
  const base = first.end === 'out' ? alignRun(held, outlet, inlet, tube) : held
  const from = base.findIndex((p) => p.id === outlet.pieceId)
  const head = base.findIndex((p) => p.id === inlet.pieceId)
  // The whole run hanging off that inlet travels, not just the one part.
  const tail = chainTailOf(base, head)
  const block = base.slice(head, tail + 1)
  const rest = [...base.slice(0, head), ...base.slice(tail + 1)]
  // Bonded parts follow the part they are bonded to, so the run that arrives is
  // filed straight after the outlet it now hangs off.
  const at = rest.findIndex((p) => p.id === outlet.pieceId) + 1
  const S = PIECE_LIMITS.slope
  // A snap-fit joint is coaxial: the part bonded on takes the angle the outlet
  // hands over and picks up its heading, so the two sit flush.
  //
  // Unless it has a fall of its own — a coil's is its coil's, a bowl's is dead
  // level — in which case it keeps that fall and it is the run it is landing on
  // that comes round to meet it, just below.
  block[0] = {
    ...block[0],
    joined: true,
    at: undefined,
    slope: slopeIsFixed(block[0])
      ? block[0].slope
      : clamp(exitSlope(base[from]), S.min, S.max),
    turn: 0,
  }
  const joint = [...rest.slice(0, at), ...block, ...rest.slice(at)]
  // Joining a part on is the user acting on this one joint, so this is a moment
  // the run may fairly be swung to close it. See {@link meetFixed}.
  const next = meetFixed(joint, at, keepConnected, tube)
  if (!keepConnected || block.length < 2) return next
  // Measured before anything moved, so the run that arrived keeps every kink it
  // had rather than being pulled straight by the joint.
  const was = kinksOf(base)
  const kinks = next.map((_, i) => (i > at && i < at + block.length ? was[head + i - at] : 0))
  return relink(next, kinks, at + 1, at + block.length - 1, tube)
}

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
function relink(
  pieces: Piece[],
  kinks: number[],
  from: number,
  to: number,
  tube: TubeOf,
): Piece[] {
  const next = pieces.slice()
  let changed = false
  for (let i = Math.max(1, from); i <= Math.min(to, next.length - 1); i++) {
    if (!next[i].joined) continue
    // Each part is relinked to the one already relinked before it, so a single
    // pass carries a correction all the way down the run.
    const S = slopeRange(next[i])
    // A kink the user built on purpose is theirs to keep, but only as far as
    // the tube can be cut round it: past that the joint's mitre reaches back
    // through its own socket and there is nothing left to plug into. So the
    // kink runs out of travel here rather than the part quietly becoming
    // unbuildable. See {@link breakLimitFor}.
    const most = breakLimitFor(next[i], tube(next[i]))
    const kink = clamp(kinks[i], -most, most)
    const slope = tidy(clamp(exitSlope(next[i - 1]) + kink, S.min, S.max))
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
function carrySlope(
  pieces: Piece[],
  from: number,
  delta: number,
  connected: boolean,
  tube: TubeOf,
): Piece[] {
  if (!connected || !delta || from + 1 >= pieces.length) return pieces
  const kinks = kinksOf(pieces)
  // The joint just past the edit was standing where the part used to leave it.
  kinks[from + 1] = tidy(kinks[from + 1] + delta)
  return relink(pieces, kinks, from + 1, pieces.length - 1, tube)
}

/**
 * Pulls every joint in the run shut: each part starts at the angle the one
 * before it leaves at. This is what Keep connected does to a run that was drawn
 * with its joints free.
 */
function weldJoints(pieces: Piece[], tube: TubeOf): Piece[] {
  return relink(pieces, pieces.map(() => 0), 1, pieces.length - 1, tube)
}

/**
 * What a part is fed at, or nothing if it is fed at exactly what it runs at.
 *
 * Two things can put a joint out of true: a part standing at a different fall
 * from the one the part before hands on, and a part turned at its inlet. Either
 * one, and the part needs a lead — see {@link JOINT_LOCK} — so the answer is
 * the fall it is fed at, which is what the lead runs along. Neither, and the
 * part runs exactly as it is drawn and needs nothing.
 *
 * A part at the head of a run is fed by nothing at all: it stands where it was
 * set down, and its own fall is the one the run sets off at.
 */
function leadFor(pieces: Piece[], i: number): number | undefined {
  if (isChainRoot(pieces, i)) return undefined
  const from = exitSlope(pieces[i - 1])
  const piece = pieces[i]
  return !piece.turn && !tidy(from - piece.slope) ? undefined : from
}

/**
 * How deep the socket at a part's inlet runs, mm — {@link jointSpec} without
 * needing the whole tube, since only the length bears on it.
 */
function socketDepth(length: number): number {
  return Math.max(3, Math.min(8, length * 0.35))
}

/**
 * The straight run a part opens with, mm: the leg or stub its socket sits in,
 * before the part's own shape starts bending. Every part in the library has
 * one, and it is `length` in every case — the entry leg of a connector, the
 * stub of a hook or a coil, the feed tube of a funnel.
 *
 * A plain funnel is fed by its open mouth rather than a socket, so it has no
 * such run and nothing can be plugged into it anyway.
 */
function entryRunOf(piece: Piece): number {
  if (piece.type === 'funnel' && !funnelHasLead(piece)) return 0
  // Structure has no inlet either, and its `length` is a span across a slab or
  // along a post rather than a run of tube — reading it as one would be sizing a
  // socket to a plate.
  if (isStructure(piece)) return 0
  return piece.length
}

/**
 * How much of a part's lead the socket has already spoken for, mm — the depth
 * the spigot sits in, and the clearance left standing past its shoulder.
 *
 * Nothing the joint's break does may reach back into this: it is the stretch
 * the snap itself lives in, and a cut through it is a joint that will not go
 * together. Read by the centreline as the far end of what an arc may round off.
 */
export function socketReach(piece: Piece): number {
  return socketDepth(piece.length) + MITRE_CLEARANCE
}

/**
 * How much of that opening straight is already spoken for at the far end, mm.
 *
 * A plain tube is one straight from socket to spigot, so the lock its spigot
 * stands on comes out of the very same run the lead does — put the break too
 * far along and it lands inside the *next* joint instead. Every other part
 * keeps its outlet on a leg or a stub of its own, which the break never
 * reaches.
 */
function inletOwes(piece: Piece): number {
  return piece.type === 'straight' ? JOINT_LOCK : 0
}

/**
 * How long a part's joint lead has to be, mm — the straight it runs before it
 * comes round to its own aim.
 *
 * {@link JOINT_LOCK} is the floor, and a bend needs more than the floor: the
 * mitre at the break reaches back down the lead by {@link mitreBite}, and it
 * must stop short of the socket or it cuts the socket open. So the lead is the
 * socket, a little clearance, and the bite — which on a part barely turned is
 * less than the lock and on a part turned hard is a good deal more.
 *
 * A joint rounded off reaches back by its arc's tangent instead, which on a
 * radius wider than the tube is further again — see {@link jointBite}.
 *
 * This is the "additional spacing" half of the answer. The other half is that a
 * part can only give so much of itself over to it — see {@link turnLimitsFor}.
 */
export function leadLengthFor(piece: Piece, outerR: number): number {
  if (piece.entrySlope === undefined) return JOINT_LOCK
  const bend = breakAngleOf(piece.entrySlope, piece.turn, piece.slope)
  const bite = jointBite(piece, bend, outerR)
  const need = socketDepth(piece.length) + MITRE_CLEARANCE + bite
  // Never past what the part has to give: the mitre reaches forward as far as
  // it reaches back, and on a plain tube the spigot's own lock comes out of the
  // same straight. A break asked for beyond that is one the part cannot hold —
  // it is held here so that at worst the joint it belongs to is strained, and
  // never the joint at the other end of the part. See {@link breakLimitFor}.
  const cap = Math.max(JOINT_LOCK, entryRunOf(piece) - inletOwes(piece) - bite)
  return Math.min(Math.max(JOINT_LOCK, need), cap)
}

/** Straight tube left standing between the socket's shoulder and the mitre, mm. */
const MITRE_CLEARANCE = 2

/**
 * The radius a part's inlet break is really cut at, mm — its own where it has
 * been rounded off, and nothing where it is left as a mitred corner.
 *
 * Read through here rather than off the field, so that everything measuring the
 * break agrees about which of the two it is looking at.
 */
export function jointFilletOf(piece: Piece): number {
  return piece.jointFillet ?? 0
}

/**
 * How far a part's inlet break reaches back down its lead, mm.
 *
 * A mitred corner reaches back by the tube's own radius times the tangent of the
 * half angle — the cut plane halves the angle, so the inside of the bend runs
 * back that far. An arc reaches back by its tangent length, which is the same
 * sum with the arc's radius in place of the tube's. Either way it is what has to
 * clear the socket, so the wider of the two is the one that governs: rounding a
 * break off tighter than the tube would still leave a mitre's worth of tube cut
 * away either side of it.
 */
export function jointBite(piece: Piece, bend: number, outerR: number): number {
  return mitreBite(bend, Math.max(outerR, jointFilletOf(piece)))
}

/**
 * How far a bonded part may be turned off the run before the bend it would take
 * is one its own tube cannot be cut round.
 *
 * A break needs the socket, a little clearance, and a mitre bite either side of
 * it, and all of that has to come out of the straight the part opens with. Work
 * the biggest bend that fits back through {@link breakAngleOf} and out comes the
 * turn that reaches it. Past that the run has to be turned by a part built to
 * turn it — a corner or a hook, whose legs are long enough to mitre.
 *
 * A part at the head of a run is bonded to nothing and turns as freely as it
 * likes: its heading is where the run sets off, not a bend in any tube.
 */
/**
 * The outer radius of the tube a part is actually cut from — its own where it
 * has been sized on its own, and the run's otherwise. The walks along a run all
 * take one of these, because how far a joint may be bent comes off the tube it
 * is cut in and nothing else. Built once per edit from the run's settings.
 */
export type TubeOf = (piece: Piece) => number

export const tubeRadiusOf =
  (runBore: number, runWall: number): TubeOf =>
  (piece) =>
    boreOf(piece, runBore) / 2 + wallOf(piece, runWall)

/**
 * The sharpest break a part can take at its inlet, degrees — how far the run
 * may bend a lock past the socket before the mitre eats the socket itself.
 *
 * A break needs a bite of straight tube either side of it, and both bites come
 * out of the straight the part opens with, less what the socket and its
 * clearance have already taken. Turn a stock tube more than this and there is
 * no joint left: the answer is a corner or a hook, built to turn, with legs long
 * enough to mitre.
 *
 * A break rounded off is held tighter still, and by the same sum read with the
 * arc's radius in it: an arc reaches back down the lead by its tangent, so the
 * wider it is rounded the less of a turn there is room for. Ask for a gentle
 * joint on a stock tube and it is the turn that gives way, which is the trade
 * the setting is there to make.
 */
export function breakLimitFor(piece: Piece, outerR: number): number {
  const run = entryRunOf(piece)
  if (!run) return 180
  // Half the straight left over once the socket and its clearance are taken:
  // the break needs the same bite on both sides of itself.
  const bite = (run - socketDepth(piece.length) - MITRE_CLEARANCE - inletOwes(piece)) / 2
  const radius = Math.max(outerR, jointFilletOf(piece))
  return bite <= 0 ? 0 : tidy((2 * Math.atan(bite / radius)) / RAD)
}

export function turnLimitsFor(piece: Piece, entrySlope: number | undefined, outerR: number) {
  const T = PIECE_LIMITS.turn
  if (entrySlope === undefined && !piece.joined) return T
  const from = entrySlope ?? piece.slope
  if (!entryRunOf(piece)) return T
  const most = breakLimitFor(piece, outerR) * RAD
  if (most <= 0) return { ...T, min: 0, max: 0 }
  // breakAngleOf, read backwards for the turn. The fall the part already stands
  // off by spends part of the bend before the turn spends any of it.
  const k1 = Math.sin(((piece.slope - from) / 2) * RAD) ** 2
  const k2 = Math.cos(((piece.slope + from) / 2) * RAD) ** 2
  const target = (1 - Math.cos(most)) / 2
  // Turning the part does not always steepen the bend — square to the fall it
  // barely does — and where it does not, nothing here holds it back.
  if (k2 - k1 <= 1e-9) return T
  const u = (target - k1) / (k2 - k1)
  if (u >= 1) return T
  if (u <= 0) return { ...T, min: 0, max: 0 }
  const limit = tidy((2 * Math.asin(Math.sqrt(u))) / RAD)
  return { ...T, min: Math.max(T.min, -limit), max: Math.min(T.max, limit) }
}

/**
 * Every part told what it is fed at, so the first {@link JOINT_LOCK} mm of it
 * can run straight out of the socket it plugs into and the connector comes out
 * dead straight however the part is aimed.
 *
 * This runs on the way out of every edit, *after* the parts have settled onto
 * their own shapes — a coil that has just re-counted its rings runs at a new
 * fall, and the joint above it has to be measured off that rather than off what
 * it was before. Anything the run could close it has already closed by the time
 * this is reached; what is left over is what the lead is for.
 */
export function lockJoints(pieces: Piece[], runBore: number, runWall: number): Piece[] {
  let changed = false
  const next = pieces.map((piece, i) => {
    const entrySlope = leadFor(pieces, i)
    const outerR = boreOf(piece, runBore) / 2 + wallOf(piece, runWall)
    // Held to a turn its own tube can be cut round, before the lead is measured
    // off it — the lead has to be long enough for the bend that is actually
    // there, not for one the part was asked for and cannot make.
    const T = turnLimitsFor(piece, entrySlope, outerR)
    const turn = clamp(piece.turn, T.min, T.max)
    const led = { ...piece, turn, entrySlope }
    const leadLength = entrySlope === undefined ? undefined : leadLengthFor(led, outerR)
    if (piece.entrySlope === entrySlope && piece.turn === turn && piece.leadLength === leadLength) {
      return piece
    }
    changed = true
    if (entrySlope !== undefined) return { ...led, leadLength }
    const { entrySlope: _e, leadLength: _l, ...rest } = led
    return rest
  })
  return changed ? next : pieces
}

/**
 * Brings the run behind a part with a fall of its own round to meet it.
 *
 * A coil runs at the fall its own coil makes and a funnel is fed dead level:
 * neither can be swung to meet the part above, so it is the part above that has
 * to come down to them. That is exactly what {@link swingBehind} does, and this
 * is the wrapper that works out by how much.
 *
 * Fired only where the user is acting on that joint — joining the part on, or
 * editing the part itself — and never as a sweep over the whole run. A sweep
 * would mean that dragging a tube at the head of a run with a coil in it sprang
 * straight back to the coil's fall, which reads as the drag being broken. Left
 * alone, that joint takes a lead instead and the connector is straight anyway.
 */
function meetFixed(pieces: Piece[], at: number, connected: boolean, tube: TubeOf): Piece[] {
  if (!connected || at < 1 || !slopeIsFixed(pieces[at]) || !pieces[at].joined) return pieces
  return swingBehind(pieces, at, tidy(pieces[at].slope - exitSlope(pieces[at - 1])), true, tube)
}

/**
 * Swings a whole run in elevation, from its head. Every joint along it is left
 * standing at the angle it already had, so the run turns as one piece rather
 * than opening up somewhere in the middle.
 */
function swingRun(
  pieces: Piece[],
  root: number,
  tail: number,
  delta: number,
  tube: TubeOf,
): Piece[] {
  const S = slopeRange(pieces[root])
  const kinks = kinksOf(pieces)
  const next = pieces.slice()
  next[root] = { ...next[root], slope: clamp(tidy(next[root].slope + delta), S.min, S.max) }
  return relink(next, kinks, root + 1, tail, tube)
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
function swingBehind(
  pieces: Piece[],
  at: number,
  delta: number,
  connected: boolean,
  tube: TubeOf,
): Piece[] {
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
    const before = next
    next = swingRun(next, from, at - 1, step, tube)
    const now = exitSlope(next[at - 1])
    const left = tidy(target - now)
    if (Math.abs(left) < ALIGN_TOLERANCE) break
    // Nothing bought means the run is held at a stop somewhere and no further
    // pass will shift it: the joint opens rather than the run turning for ever.
    // The pass that bought nothing is put back as well — it moved parts and got
    // nothing for it, which is not what closing a joint was asked to do.
    const bought = (now - was) / step
    if (Math.abs(bought) < 1e-6) {
      next = before
      break
    }
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
function alignRun(pieces: Piece[], outlet: Port, inlet: Port, tube: TubeOf): Piece[] {
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
    const before = next
    next = swingRun(next, root, from, step, tube)
    const now = exitSlope(next[from])
    const left = tidy(target.slope - now)
    if (Math.abs(left) < ALIGN_TOLERANCE) break
    // How much of that swing the run actually handed on. Nothing at all means
    // it is held at a stop somewhere and no further pass will shift it — and
    // the pass that bought nothing is put back, rather than left standing as a
    // run swung right over for no gain. A run ending in a funnel is the plain
    // case: it hands on dead vertical whatever is done to it, so the first pass
    // would otherwise heel the whole run over by the best part of a right angle
    // on its way to finding that out.
    const bought = (now - was) / step
    if (Math.abs(bought) < 1e-6) {
      next = before
      break
    }
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

export const OPEN_SIDE_LABEL: Record<OpenSide, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
}

/** The four sides in the order they are offered, top first. */
export const OPEN_SIDES: OpenSide[] = ['top', 'right', 'bottom', 'left']

/**
 * Where the opening is centred, radians, measured off the tube's own up axis
 * and turning towards its left — which is the axis `up × direction`, since a
 * marble running down local +Z with local +Y overhead has local +X to its left.
 *
 * So it reads as the marble does: right is a quarter turn clockwise seen from
 * behind, and the run's own bends and rolls carry it along without any of this
 * having to know about them.
 */
export const OPEN_SIDE_ANGLE: Record<OpenSide, number> = {
  top: 0,
  right: -Math.PI / 2,
  bottom: Math.PI,
  left: Math.PI / 2,
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
 * Which side a part's opening actually faces: its own, if it has been turned,
 * and otherwise the run's — the same fallback the style works on.
 */
export function openSideOf(piece: Piece, runSide: OpenSide): OpenSide {
  return piece.openSide ?? runSide
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
  funnel: 'Funnel',
  base: 'Base',
  support: 'Support',
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
  // A funnel is fed dead level and states that fall itself — see
  // {@link slopeIsFixed} — so unlike every other part this one starts on nought
  // rather than on the gentle fall a new part is set down at. The feed tube is
  // put right by {@link settle}, which knows the tube it has to stand clear of
  // and this far out cannot.
  funnel: {
    length: FUNNEL_DEFAULTS.length,
    slope: 0,
    turn: 0,
    height: FUNNEL_DEFAULTS.height,
    topDiameter: FUNNEL_DEFAULTS.mouthDiameter,
    rim: FUNNEL_DEFAULTS.rim,
    rings: FUNNEL_DEFAULTS.turns,
    exitLength: FUNNEL_DEFAULTS.exitLength,
  },
  // A base is the one part with no angles to it. Its fall is nought because a
  // slab lies flat — see {@link slopeIsFixed} — and its `length` is how deep the
  // plate is rather than how far anything runs.
  base: {
    length: BASE_DEFAULTS.depth,
    slope: 0,
    turn: 0,
    width: BASE_DEFAULTS.width,
    height: BASE_DEFAULTS.height,
    radius: BASE_DEFAULTS.radius,
  },
  // A support stands square for the same reason a base lies flat, so its fall is
  // nought too. Its `length` is how far it reaches along the run rather than how
  // far anything runs down it, and its `height` is where the tube's axis sits
  // rather than how tall the post is — see {@link Piece.height}. The fall of the
  // run it carries goes in `tilt`, and a fresh post is cut level: it is aimed at
  // a run once it has one to aim at, and until then it is a level seat.
  support: {
    length: SUPPORT_DEFAULTS.depth,
    slope: 0,
    turn: 0,
    width: SUPPORT_DEFAULTS.width,
    height: SUPPORT_DEFAULTS.height,
    radius: SUPPORT_DEFAULTS.radius,
    sweep: SUPPORT_DEFAULTS.wrap,
    tilt: SUPPORT_DEFAULTS.tilt,
    foot: SUPPORT_DEFAULTS.foot,
    footTilt: SUPPORT_DEFAULTS.footTilt,
    footShift: SUPPORT_DEFAULTS.footShift,
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
  if (piece.type === 'funnel') return funnelDrop(piece)
  // Structure descends nothing: a slab lies flat and a post stands square, and
  // the frame of each already sits it on the workplane rather than on a
  // centreline.
  if (isStructure(piece)) return 0
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
    // Structure's own frame stands on its bottom face, so it is already sitting
    // on the plane at nought — and nought is the only height it is ever at. See
    // {@link groundSeat}.
    y: isStructure(piece) ? 0 : Math.round((outerR + Math.max(0, dropOf(piece))) * 10) / 10,
    z: 0,
    yaw: 0,
  }
}

/**
 * A placement with structure held down on the workplane.
 *
 * A base lies on the ground by definition and a support stands on it by
 * definition — that is the whole of what each of them is — so however either is
 * dragged, dropped or read back off a file, its bottom face sits at nought.
 * Everything that writes a placement goes through here, so there is no gesture
 * anywhere that can lift one off the plane or bury it under one.
 *
 * A post sunk into the plate it stands on is not an exception to that: the plate
 * is above the plane and the post is on it, so the two overlap by the plate's
 * thickness and print as one solid. That is the whole trick of standing a
 * support on a base — neither part has to know the other is there.
 *
 * Only the height is touched. Both slide about and turn like anything else; it
 * is the one axis that is not the user's to set.
 */
export function groundSeat(piece: Piece, at: Placement): Placement {
  return isStructure(piece) && at.y !== 0 ? { ...at, y: 0 } : at
}

/**
 * Fresh copies of the parts named, in run order, ready to be stood on the stage.
 *
 * A joint is only copied when both ends of it were named: a part whose
 * neighbour in the run came along too keeps that joint, so a whole run copied
 * arrives as a run rather than as a heap of loose parts, while a part taken out
 * of the middle of one arrives standing on its own. The copies come back grouped
 * the same way — one list per run they make up — because it is those runs, not
 * the parts inside them, that the joining copy has ends to offer.
 *
 * Each new run is stood in clear space beside the ones already on the stage, and
 * on its own tube: a part sized on its own carries that size into its copy, so
 * its clearance has to be measured off that rather than off the run's.
 */
function copyParts(
  s: { pieces: Piece[]; innerDiameter: number; wallThickness: number },
  ids: string[],
): Piece[][] {
  const runs: Piece[][] = []
  // Standing them down one at a time against the growing stage, rather than all
  // at once against the old one: two copies that both measured their clearance
  // off the same stage would be stood in the very same place.
  let standing = s.pieces
  let last = -2
  s.pieces.forEach((source, i) => {
    if (!ids.includes(source.id)) return
    const { id: _id, joined: _joined, at: _at, ...rest } = source
    const innerR = boreOf(source, s.innerDiameter) / 2
    const wall = wallOf(source, s.wallThickness)
    const shape = settle(makePiece(rest), innerR, wall)
    const carries = i === last + 1 && source.joined
    const copy: Piece = carries
      ? { ...shape, joined: true }
      : { ...shape, at: spawnPlacement(standing, shape, innerR + wall) }
    if (carries) runs[runs.length - 1].push(copy)
    else runs.push([copy])
    // A bonded copy has to follow the one it is bonded to in the list, which is
    // exactly the order they are made in.
    standing = [...standing, copy]
    last = i
  })
  return runs
}

/* ------------------------------------------------------------------ */
/* Standing posts under the run                                        */
/* ------------------------------------------------------------------ */

/**
 * How far apart posts are set along the run, mm — measured along the tube
 * rather than across the floor, so a steep drop is propped as often as a level
 * stretch is.
 *
 * A span of tube printed in one piece will bridge a good deal further than
 * this before it sags. What this is really pitched at is the joints: a run this
 * app builds is a chain of short parts pushed together, and a joint with
 * nothing under it is a hinge. About a hand's width puts a post near enough
 * every joint on a stage of ordinary parts without putting one under every
 * single joint, which would be a forest.
 */
const SUPPORT_PITCH = 90

/**
 * How far in from the ends of a run the first and last posts stand, mm.
 *
 * Not nought, because the very tip of a run is the socket or the spigot: a
 * cradle sat across a joint holds the two halves of it apart, which is the one
 * place a post can do harm rather than good.
 */
const SUPPORT_INSET = 20

/**
 * How much air there has to be under a tube before it is worth propping, mm.
 *
 * Under this the run is already lying on the plate, or buried in the base, and
 * whatever is holding it up is holding it up. A post a millimetre high is not a
 * post — it is a burr on the plate.
 */
const SUPPORT_LEAST_AIR = 3

/**
 * How much clear air there has to be between two tubes before a post will be
 * stood between them, mm.
 *
 * More than {@link SUPPORT_LEAST_AIR}, and for a different reason: that one asks
 * whether a tube needs propping at all, this one asks whether there is room to
 * prop it. Two levels of a run this close together are held apart by a wafer,
 * and a wafer is not a post — it is a thin plate the printer lays down in one
 * pass and the first knock breaks. Below this the spot is left alone and the run
 * is propped from the next place along it.
 */
const SUPPORT_LEAST_POST = 8

/** How much daylight a post leaves round anything it is not holding up, mm. */
const SUPPORT_CLEARANCE = 2

/** One chord of run, with the tube it is actually cut from. */
interface RunSpan {
  seg: Segment
  outerR: number
  /**
   * The bore and wall the part it belongs to was sized on its own to, if it was
   * — undefined where the part is cut from the run's own tube.
   *
   * Carried through to whatever post ends up under it, so a post propping a part
   * that was sized on its own has a cradle cut to *that* pipe rather than to the
   * run's. A post over ordinary run keeps neither, so it follows the run's tube
   * the way every other part does and follows it still when the run is resized.
   */
  bore?: number
  wall?: number
}

/** Every chord on the stage that is run, each with its own tube. */
function runSpans(
  pieces: Piece[],
  runBore: number,
  runWall: number,
  asm = buildAssembly(pieces),
): RunSpan[] {
  const spans: RunSpan[] = []
  for (const p of asm.placed) {
    if (isStructure(p.piece)) continue
    const outerR = boreOf(p.piece, runBore) / 2 + wallOf(p.piece, runWall)
    const own = { bore: p.piece.innerDiameter, wall: p.piece.wallThickness }
    for (const seg of p.segments) {
      // A chord with no tube round it is not run a post can meet: the funnel's
      // whirl is the path the marble takes across an open bowl, and there is
      // neither anything there to cradle nor anything there to stand on.
      if (!seg.enclosed) continue
      spans.push({ seg, outerR, ...own })
    }
  }
  return spans
}

/**
 * How much solid post there would be between one footing and one seat, mm.
 *
 * The seat and the foot are both *axes* — where the middle of a tube is — so the
 * post itself is what is left between the two pipes, and a tilt at either end
 * eats into it further, since a groove cut on a slope is cut deeper. This is the
 * same figure {@link supportFloor} and {@link supportLift} give for a post that
 * already exists; it is worked out here from the seating instead, because the
 * question is asked before there is a post to ask it of.
 *
 * `depth` is how far the post would reach along the run.
 */
function postBody(seat: Seating, footing: Footing, depth: number): number {
  const bite = (radius: number, deg: number) =>
    (radius + (depth / 2) * Math.abs(Math.sin(deg * RAD))) / Math.cos(deg * RAD)
  const floor = seat.seat - bite(seat.outerR, seat.tilt)
  const lift = footing.foot > 0 ? footing.foot + bite(footing.outerR, footing.footTilt) : 0
  return floor - lift
}

/** Where a post stands and what it has to hold when it gets there. */
export interface Seating {
  x: number
  z: number
  /** How far above the workplane the tube's axis is here, mm. */
  seat: number
  /** The tube's own fall here, degrees. */
  tilt: number
  /** The heading it is running on here, degrees. */
  yaw: number
  /** How fat the tube is here, mm. */
  outerR: number
  /** The tube's own bore and wall, where the part carrying it has its own. */
  bore?: number
  wall?: number
}

/**
 * Reads a chord at one point along it: where the axis is, which way it is
 * pointing and how far it is falling.
 *
 * `along` is how far past the chord's own start the reading is taken, mm.
 */
function seatingOn(span: RunSpan, along: number): Seating {
  const { seg } = span
  const t = clamp(along, 0, seg.length)
  return {
    x: seg.start.x + seg.dir.x * t,
    z: seg.start.z + seg.dir.z * t,
    seat: seg.start.y + seg.dir.y * t,
    tilt: tidy((seg.pitch * 180) / Math.PI),
    yaw: tidy((Math.atan2(seg.dir.x, seg.dir.z) * 180) / Math.PI),
    outerR: span.outerR,
    bore: span.bore,
    wall: span.wall,
  }
}

/**
 * How far a point in plan is from a chord's plan, and where along that chord
 * the nearest approach falls — the two questions every test below asks.
 */
function planApproach(seg: Segment, x: number, z: number) {
  const dx = seg.end.x - seg.start.x
  const dz = seg.end.z - seg.start.z
  const span = dx * dx + dz * dz
  // A chord running dead up or down has no plan to measure along, so its start
  // is as near as it gets anywhere.
  const t = span < 1e-9 ? 0 : clamp(((x - seg.start.x) * dx + (z - seg.start.z) * dz) / span, 0, 1)
  const near = { x: seg.start.x + dx * t, z: seg.start.z + dz * t }
  return {
    /** How far along the chord, mm. */
    along: t * seg.length,
    /** Where on the chord's plan the nearest approach falls, world. */
    at: { x: near.x, y: seg.start.y + (seg.end.y - seg.start.y) * t, z: near.z },
    /** Height of the axis at the nearest approach, mm. */
    y: seg.start.y + (seg.end.y - seg.start.y) * t,
    distance: Math.hypot(x - near.x, z - near.z),
  }
}

/**
 * How far off parallel the tube a post stands on may run from the tube it
 * carries, degrees in plan.
 *
 * The saddle under a stacked post is a groove cut along the post's own axis, and
 * the post's axis is set by the tube in its cradle. So the tube it is standing
 * on has to be running roughly the same way — either way round, since a groove
 * has no front and back. Two levels of a switchback are exactly anti-parallel
 * and two levels of a spiral tower are near enough parallel, which between them
 * are what stacking is for. A run crossing underneath at a sharp angle is not:
 * the groove would sit across it on two points rather than along it, and that is
 * a post balancing on a pipe rather than standing on it.
 */
const SUPPORT_STACK_SQUARE = 15

/** What a post standing here would have to stand on. */
interface Footing {
  /** Axis height of the tube it stands on, mm; nought is the plate. */
  foot: number
  /** That tube's fall, read along the post's own axis, degrees. */
  footTilt: number
  /** How far across the post that tube passes, mm. */
  footShift: number
  /** How fat that tube is, mm — nought on the plate. */
  outerR: number
}

const ON_THE_GROUND: Footing = { foot: 0, footTilt: 0, footShift: 0, outerR: 0 }

/** What a post standing on one spot would find over its head and under its feet. */
export interface Overhead {
  /** The tube it would carry, and everything about it a post needs. */
  seat: Seating
  /**
   * What it would stand on to reach that tube, or null if it cannot stand there
   * at all — see {@link footingFor}. Null does not stop the top of the post being
   * fitted; it only means the foot is nobody's to work out but the user's.
   */
  footing: Footing | null
}

/**
 * What a post standing here would rest on — the plate, the run, or nothing it
 * can rest on at all.
 *
 * The post is a column from its footing up to the underside of the tube it is
 * holding, as wide as its own footprint reaches at the corners. Anything the run
 * does inside that column has to be reckoned with. The one thing that does not
 * count is the tube the post is there for, which is picked out by arc length
 * rather than by geometry — see {@link SUPPORT_WINDOW}.
 *
 * With the column clear, the post stands on the plate. With something in it, the
 * post stands on the *highest* of those somethings instead: that is the one it
 * would meet first coming down, everything else is below it and therefore no
 * longer in the way, and the load goes down through the run to whatever is
 * holding that up. It is how a stacked run gets propped at all — see
 * {@link Piece.foot}.
 *
 * Null is the answer when it cannot stand: what is under it is crossing at too
 * sharp an angle to be stood on ({@link SUPPORT_STACK_SQUARE}), or there is not
 * enough daylight between the two tubes to put a post in.
 *
 * `held` names the chord being propped and how far along it the post stands, so
 * that stretch of run and its immediate neighbours are not read as being in the
 * way of the post holding them up.
 */
function footingFor(
  spans: RunSpan[],
  seat: Seating,
  half: { width: number; depth: number },
): Footing | null {
  const top = seat.seat - seat.outerR
  // The post's own two level axes, in the world: +Z along the run it carries,
  // +X across it. Everything below is read in these, because the saddle is cut
  // in them — see {@link Piece.footShift}.
  const ahead = { x: Math.sin(seat.yaw * RAD), z: Math.cos(seat.yaw * RAD) }
  const across = { x: Math.cos(seat.yaw * RAD), z: -Math.sin(seat.yaw * RAD) }
  // The line the tube it is carrying runs on. What the post's cradle is cut to
  // follow, and so the one line under it that is not in its way.
  const fall = Math.cos(seat.tilt * RAD)
  const held = {
    dir: { x: ahead.x * fall, y: -Math.sin(seat.tilt * RAD), z: ahead.z * fall },
    at: { x: seat.x, y: seat.seat, z: seat.z },
  }
  let perch: { span: RunSpan; at: { x: number; y: number; z: number } } | null = null
  let second = -Infinity
  for (const span of spans) {
    const near = planApproach(span.seg, seat.x, seat.z)
    // How near it comes to the post's own footprint, rather than to the point in
    // the middle of it. A post is a fin — wide across the run and thin along it
    // — so a circle round its middle would reckon a tube a stride further down
    // the run to be as close as one right beside it.
    const away = Math.max(1e-9, near.distance)
    const ux = ((near.at.x - seat.x) * across.x + (near.at.z - seat.z) * across.z) / away
    const uz = ((near.at.x - seat.x) * ahead.x + (near.at.z - seat.z) * ahead.z) / away
    const spread = Math.abs(ux) * half.width + Math.abs(uz) * half.depth
    if (near.distance > span.outerR + spread + SUPPORT_CLEARANCE) continue
    // Run that only dips under the column is the same pipe carrying on down: the
    // cradle is cut on the very slope it is falling at, so the post follows it
    // rather than going into it. A whole tube's radius below is another matter.
    if (near.y > top - span.outerR) continue
    // And run on the very line the post is holding is that pipe however far it
    // has fallen by the time it gets there — the far end of a steep drop, or the
    // next chord of a curve the post is cradling. Only run that has gone off
    // somewhere and come back underneath is in the way.
    const ox = near.at.x - held.at.x
    const oy = near.y - held.at.y
    const oz = near.at.z - held.at.z
    const along = ox * held.dir.x + oy * held.dir.y + oz * held.dir.z
    const stray = ox * ox + oy * oy + oz * oz - along * along
    if (stray < span.outerR * span.outerR) continue
    if (perch) second = Math.max(second, Math.min(near.y, perch.at.y))
    if (!perch || near.y > perch.at.y) perch = { span, at: near.at }
  }
  if (!perch) return ON_THE_GROUND

  // Only one thing may be under a post, and it has to be clear of everything
  // else. Two tubes at much the same height under the same post means standing
  // on one and hanging into the other, and there is no saddle that answers for
  // both — better to leave this spot and prop the run from the next one along.
  if (second > perch.at.y - perch.span.outerR * 2) return null

  const dir = perch.span.seg.dir
  // The tube below, in the post's own frame. A groove has no front and back, so
  // one running the other way about — which is exactly what the level below a
  // switchback does — is turned round to face the same way the post does, and
  // its fall comes out the other sign, which is right: descending in the world
  // and climbing along the post's own axis are the same thing said twice.
  const flip = dir.x * ahead.x + dir.z * ahead.z < 0 ? -1 : 1
  const eX = (dir.x * across.x + dir.z * across.z) * flip
  const eY = dir.y * flip
  const eZ = (dir.x * ahead.x + dir.z * ahead.z) * flip
  // How squarely it runs with the post, in plan. A pipe crossing at an angle
  // would sit in the groove on two points rather than along it, which is a post
  // balancing on a tube rather than standing on it.
  const plan = Math.hypot(eX, eZ)
  if (plan < 1e-6 || eZ / plan < Math.cos(SUPPORT_STACK_SQUARE * RAD)) return null

  // Where that tube crosses the post's own middle. The nearest approach in plan
  // lands wherever it lands along the post; stepping along the tube to the plane
  // the saddle is described in is what turns it into the two numbers the shape
  // is cut from.
  const dx = perch.at.x - seat.x
  const dz = perch.at.z - seat.z
  const localX = dx * across.x + dz * across.z
  const localZ = dx * ahead.x + dz * ahead.z
  const step = -localZ / eZ
  const foot = perch.at.y + step * eY
  const footShift = localX + step * eX
  const footTilt = tidy((Math.asin(clamp(-eY, -1, 1)) * 180) / Math.PI)

  const T = SUPPORT_LIMITS.footTilt
  const S = SUPPORT_LIMITS.footShift
  if (footTilt < T.min || footTilt > T.max) return null
  if (footShift < S.min || footShift > S.max) return null
  // One post, one groove radius: the cradle on top and the saddle underneath are
  // both cut to the tube the post is set against, so a post cannot stand on a
  // pipe of a different size from the one it is carrying — the saddle would be
  // cut for the wrong tube and would bite into it. Rare, since it takes a run
  // built from two tube sizes *and* stacked over itself, and the answer where it
  // does happen is to prop that stretch from somewhere else along it.
  if (Math.abs(perch.span.outerR - seat.outerR) > 0.05) return null
  return { foot, footTilt, footShift: tidy(footShift), outerR: perch.span.outerR }
}

/**
 * A post standing at one seating, cut to the same pattern as `like`.
 *
 * The pattern is how a stage of posts comes out matching. Everything about a
 * support except where it stands and what it is holding — how thick it is, how
 * far it reaches along the run, how its corners are cut and how far its arms
 * wrap — is a preference, and the last one made carries that preference on.
 */
function standPost(seat: Seating, footing: Footing, like: Piece | null): Piece {
  const pattern: SupportPost = like ? supportSpec(like) : SUPPORT_DEFAULTS
  return makePiece({
    type: 'support',
    length: pattern.depth,
    width: pattern.width,
    radius: pattern.radius,
    sweep: pattern.wrap,
    slope: 0,
    turn: 0,
    height: clamp(tidy(seat.seat), SUPPORT_LIMITS.height.min, SUPPORT_LIMITS.height.max),
    tilt: clamp(seat.tilt, SUPPORT_LIMITS.tilt.min, SUPPORT_LIMITS.tilt.max),
    foot: clamp(tidy(footing.foot), SUPPORT_LIMITS.foot.min, SUPPORT_LIMITS.foot.max),
    footTilt: clamp(footing.footTilt, SUPPORT_LIMITS.footTilt.min, SUPPORT_LIMITS.footTilt.max),
    footShift: clamp(
      footing.footShift,
      SUPPORT_LIMITS.footShift.min,
      SUPPORT_LIMITS.footShift.max,
    ),
    at: { x: tidy(seat.x), y: 0, z: tidy(seat.z), yaw: seat.yaw },
    ...(seat.bore === undefined ? {} : { innerDiameter: seat.bore }),
    ...(seat.wall === undefined ? {} : { wallThickness: seat.wall }),
  })
}

/** How far a post reaches from its own middle, each way across its footprint, mm. */
export function postHalf(piece: Piece | null): { width: number; depth: number } {
  const p: SupportPost = piece ? supportSpec(piece) : SUPPORT_DEFAULTS
  return { width: p.width / 2, depth: p.depth / 2 }
}

/**
 * What a post standing on this spot would find over its head, or null if there
 * is nothing over it worth holding up.
 *
 * The *lowest* tube passing overhead, not the nearest and not the highest. A
 * post props what is immediately above it; on a run that folds back over itself
 * the upper level is somebody else's post's job, and a column driven up to it
 * would go straight through the lower one on the way.
 *
 * `half` is how far the post spreads each way from its middle, which is what
 * says whether a tube counts as being overhead at all.
 */
export function tubeOverPost(
  s: { pieces: Piece[]; innerDiameter: number; wallThickness: number },
  x: number,
  z: number,
  half: { width: number; depth: number },
): Overhead | null {
  const spans = runSpans(s.pieces, s.innerDiameter, s.wallThickness)
  const corner = Math.hypot(half.width, half.depth)
  let best: Overhead | null = null
  for (const span of spans) {
    const near = planApproach(span.seg, x, z)
    if (near.distance > span.outerR + corner) continue
    if (near.y - span.outerR < SUPPORT_LEAST_AIR) continue
    const seat = seatingOn(span, near.along)
    if (best && seat.seat >= best.seat.seat) continue
    best = { seat, footing: footingFor(spans, seat, half) }
  }
  return best
}

/**
 * Every post the run is asking for, worked out from scratch — the whole of what
 * pressing Add Supports does.
 *
 * The walk is along the run rather than across the floor: each run is paced out
 * from a little inside one end to a little inside the other, and a post is
 * offered at every pace. Three things turn an offer down.
 *
 * - There is no air under the tube there. It is already lying on the plate, or
 *   sunk in the base, and something is already holding it up.
 * - Something is standing there already. Posts a few millimetres apart are one
 *   post and a waste of filament, so a spot within half a pace of one already
 *   placed — including one placed by this very walk — is left to it.
 * - The column would go through the run to get there. See {@link postIsFouled},
 *   which is what keeps a post out of the middle of a coil and off the lower
 *   level of a switchback.
 *
 * What it does not do is take a view about whether a span really needs propping.
 * Every part of this app makes a fixed printed thing, and a fixed printed thing
 * hanging in the air is the one failure this exists to prevent — so it props
 * everything it can reach and leaves the pruning to whoever is looking at it.
 */
function plantSupports(s: {
  pieces: Piece[]
  innerDiameter: number
  wallThickness: number
}): Piece[] {
  const asm = buildAssembly(s.pieces)
  const spans = runSpans(s.pieces, s.innerDiameter, s.wallThickness, asm)
  if (!spans.length) return []
  // The pattern every new post is cut to, and every post already standing —
  // which is both what stops a second one landing on the first and what a new
  // one takes its shape from.
  const like = [...s.pieces].reverse().find(isSupport) ?? null
  const half = postHalf(like)
  const standing: { x: number; z: number }[] = []
  for (const p of asm.placed) {
    if (isSupport(p.piece)) standing.push({ x: p.start.x, z: p.start.z })
  }

  const T = SUPPORT_LIMITS.tilt
  const planted: Piece[] = []
  for (const run of asm.chains) {
    if (!run.segments.length) continue
    // Paced out from inside one end to inside the other, and a run too short for
    // even that gets the one post at its middle rather than none at all.
    const first = Math.min(SUPPORT_INSET, run.length / 2)
    const last = Math.max(first, run.length - SUPPORT_INSET)
    const paces = Math.max(1, Math.round((last - first) / SUPPORT_PITCH) + 1)
    for (let i = 0; i < paces; i++) {
      const arc = paces === 1 ? (first + last) / 2 : first + ((last - first) * i) / (paces - 1)
      const span =
        run.segments.find((seg) => arc < seg.startS + seg.length) ??
        run.segments[run.segments.length - 1]
      const held = spans.find((r) => r.seg === span)
      if (!held) continue
      const seat = seatingOn(held, arc - span.startS)
      // A cradle is a seat, and a run falling this steeply is past being seated:
      // what it wants is a wall beside it, which is not this part.
      if (seat.tilt < T.min || seat.tilt > T.max) continue
      if (seat.seat > SUPPORT_LIMITS.height.max) continue
      if (standing.some((p) => Math.hypot(p.x - seat.x, p.z - seat.z) < SUPPORT_PITCH / 2)) continue
      // Where it would stand: the plate, or the run under it on a stacked stage.
      // Null is a spot no post can be put in at all, and the run there is left
      // to be propped from somewhere else along it.
      const footing = footingFor(spans, seat, half)
      if (!footing) continue
      // And whether there is a post's worth of room between the two once both
      // grooves have been cut. This is the one test that catches a tube lying
      // all but on the plate and two levels all but touching alike — both are
      // the same question, which is whether anything would be left to print.
      if (postBody(seat, footing, half.depth * 2) < SUPPORT_LEAST_POST) continue
      standing.push({ x: seat.x, z: seat.z })
      planted.push(standPost(seat, footing, like))
    }
  }
  return planted
}

/**
 * The parts with one of them taken out, or null if there is no such part.
 *
 * Split out of {@link RunState.removePiece} so a set of parts can be taken out
 * one after another and still be one step in the timeline — a delete that
 * closed the run up two different ways would be a delete that drifts.
 */
function dropPart(
  s: { pieces: Piece[]; keepConnected: boolean; innerDiameter: number; wallThickness: number },
  id: string,
): Piece[] | null {
  const i = s.pieces.findIndex((p) => p.id === id)
  if (i < 0) return null
  const gone = s.pieces[i]
  const next = s.pieces[i + 1]
  const root = isChainRoot(s.pieces, i)
  const pieces = s.pieces.filter((p) => p.id !== id)
  // Deleting the part a run starts at leaves the next one standing where the
  // deleted part stood — the run closes up onto the ground the deleted part was
  // holding, still pointing the way it was.
  if (root && next?.joined) {
    const at = placementOf(gone)
    pieces[i] = {
      ...next,
      joined: undefined,
      at: { ...at, yaw: tidy(at.yaw + gone.turn + exitTurn(gone)) },
    }
  }
  // Mid-run, what followed now hangs off the part before, so it has to take up
  // the angle the deleted one used to hand on.
  const delta = root ? 0 : tidy(exitSlope(s.pieces[i - 1]) - exitSlope(gone))
  return carrySlope(
    pieces,
    i - 1,
    delta,
    s.keepConnected,
    tubeRadiusOf(s.innerDiameter, s.wallThickness),
  )
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
  selectedIds: string[]
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant
  openSide: OpenSide
  marbleDiameter: number
}

/** A run read back off disk: the model, under the name it was saved with. */
export interface LoadedProject extends Omit<Snapshot, 'selectedId' | 'selectedIds'> {
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
    selectedIds: s.selectedIds,
    innerDiameter: s.innerDiameter,
    wallThickness: s.wallThickness,
    variant: s.variant,
    openSide: s.openSide,
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
  jointFillet: 'joint pivot',
  radius: 'turn radius',
  roll: 'turn plane',
  height: 'height',
  topDiameter: 'top Ø',
  bottomDiameter: 'bottom Ø',
  rim: 'rim wall',
  leadIn: 'feed tube',
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
  // Nought is not a radius of nought — it is the joint left as a mitred corner,
  // which is what the step should say it was set to.
  jointFillet: (v) => (v > 0 ? `rounded ${len(v)}` : 'straight'),
  radius: len,
  roll: (v) => `${num(v)}°`,
  height: len,
  topDiameter: len,
  bottomDiameter: len,
  rim: len,
  // The count and which way it winds are one field, so a step says both. A coil
  // is allowed nought of them, and nought has no hand to report.
  rings: (v) => (v ? `${num(Math.abs(v))} ${v < 0 ? 'left' : 'right'}` : 'straight in'),
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
    // A field that is a choice rather than a figure says which way it went; the
    // rest are written out in whatever unit was on show at the time.
    .map(([k, v]) =>
      typeof v === 'boolean'
        ? `${FIELD_LABEL[k]} ${v ? 'on' : 'off'}`
        : `${FIELD_LABEL[k]} ${FIELD_VALUE[k](v as number)}`,
    )
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
  // style and the side it opens are only what a part falls back to when it has
  // none of its own.
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant
  openSide: OpenSide

  // Assembly
  pieces: Piece[]
  /**
   * The part that leads the selection — the last one picked, and the one every
   * command that can only mean one part follows: the parameters panel, the move
   * arrows, the turn ring, the drop to the workplane. Null with nothing picked,
   * and always the last entry of {@link RunState.selectedIds}.
   */
  selectedId: string | null
  /**
   * Every part picked, in the order they were picked, the lead last. A plain
   * click is a set of one; holding the command key or Shift adds to the set and
   * takes away from it. What acts on the whole set rather than the lead alone is
   * what a set is any use for — Duplicate and Delete.
   */
  selectedIds: string[]
  /** What the left button does on the 3D stage. */
  tool: Tool
  /**
   * How wide the handle tools reach — what the arrows and the rings take hold of
   * when they are dragged. The two handles are the same gesture asked of two
   * different sets, so which set it is belongs to the tool rather than to the
   * selection, and is picked from the tool's own menu when it is taken up.
   *
   * `selected` is the resting answer: the runs the picked parts stand in. `all`
   * takes every run on the stage, whatever is picked — the handle still sits on
   * a part, since a drag has to start somewhere, but nothing is left behind.
   *
   * Only Move and Rotate read it; the other tools leave it as they found it.
   */
  toolScope: ToolScope
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
  /**
   * Whether a part out of the library lands bonded onto the run. On — which is
   * how it ships — it arrives on the end named by {@link attachPort} and the
   * run grows by one part. Off, it lands on its own in clear space and joining
   * it is the Connector's job.
   */
  autoAttach: boolean
  /**
   * How far the Rotate tool's rings move per notch, degrees — the "how much"
   * half of the tool's settings. Nought is a free swing; anything else holds
   * every drag to whole multiples of it, so a run can be built on square angles
   * without any of them being typed.
   *
   * A preference rather than part of the run: it says how the handles behave,
   * and nothing about what is on the stage. So it outlives the project and is
   * not a step in the timeline.
   */
  rotateStep: number
  /**
   * The radius the Rotate tool rounds a joint off with, mm — the "pivot" half.
   * Nought leaves the break a mitred corner, which is what every joint has
   * always been.
   *
   * This is the setting the tool works with, not the shape of any one joint:
   * it is written onto {@link Piece.jointFillet} of whatever part is being
   * aimed, and reads back off the part in hand so that picking a rounded joint
   * shows a rounded joint. Held here so the next part aimed is rounded the same
   * way without asking again.
   */
  jointFillet: number

  // 3D appearance. The piece colour is only what a part falls back to when it
  // has none of its own — a preference that outlives any one project.
  pieceColor: string
  marbleColor: string
  /** The sky and the land the 3D stage is drawn on, held per theme. */
  workplane: Record<Theme, Record<WorkplaneColor, string>>
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
  /**
   * How much of the speed into a wall comes back out of it, 0–1 — what a marble
   * that leaves one part and lands on another does when it arrives. Glass on
   * printed plastic is a dead landing rather than a lively one, so the stock
   * figure is low; the slider is there because a run designed around a catch is
   * a different run from one designed around a drop.
   */
  bounce: number
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
  /** The side parts open on — every part with none of its own follows it. */
  setOpenSide: (v: OpenSide) => void
  /** Turns one part's opening on its own, leaving the rest of the run as it is. */
  setPieceOpenSide: (id: string, v: OpenSide) => void
  /**
   * Puts one side on the whole run: it becomes the run's, and every part's own
   * is dropped, so the parts are back to following it from here on.
   */
  applyOpenSideToAll: (v: OpenSide) => void
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
  /** Paints the sky or the land — the theme on screen is the one it changes. */
  setWorkplaneColor: (which: WorkplaneColor, v: string) => void
  /** Puts the current theme's sky and land back to stock, both together. */
  resetWorkplane: () => void
  setShading: (v: Shading) => void
  /** Turning it on pulls whatever joints have come open back together. */
  setKeepConnected: (v: boolean) => void
  /**
   * Switches whether a new part lands bonded onto the run or on its own. It
   * says where the *next* part goes; nothing already on the stage moves.
   */
  setAutoAttach: (v: boolean) => void
  /** Sets the notch the Rotate tool's rings move in, degrees; nought is free. */
  setRotateStep: (deg: number) => void
  /**
   * Sets the radius the Rotate tool rounds a joint off with, mm — nought for a
   * mitred corner. `id` names a part to put it on there and then, which is what
   * the tool does while a part is in hand; without one the setting is only
   * remembered for the next part aimed.
   *
   * Putting it on a part is a step in the timeline, because it is a change to
   * the shape that part prints as. Setting it alone is not.
   */
  setJointFillet: (mm: number, id?: string) => void
  toggleShading: () => void
  setMarbleDiameter: (v: number) => void
  resetMarbleFit: () => void
  setTimeScale: (v: number) => void
  setFriction: (v: number) => void
  setBounce: (v: number) => void
  toggleRunning: () => void
  setLoop: (v: boolean) => void
  resetSim: () => void
  setExportFormat: (v: ExportFormat) => void
  setScreenPxPerMm: (v: number) => void
  resetScreenCalibration: () => void

  /**
   * Switches what the left button does on the 3D stage; any half-made joint is
   * dropped. A handle tool is taken up with the reach it is to work at — see
   * {@link RunState.toolScope} — and anything else puts that back to `selected`,
   * so a reach picked once never quietly outlives the tool it was picked for.
   */
  setTool: (t: Tool, scope?: ToolScope) => void
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
   * Stands whole runs on fresh placements — a new place, and a new heading with
   * it — as one step in the timeline. Each entry names any part of a run and
   * where that run's first part is to have its inlet; two parts of the one run
   * ask for one placement, and the first named is the one the step is called
   * after.
   *
   * Runs rather than parts, because a bonded part cannot travel on its own —
   * that is what being bonded means. Several runs at once, because the arrows
   * and the ring take everything picked: a set of parts spanning three runs
   * moves all three, holding the arrangement they were in.
   *
   * Only the stage knows what dragging a handle on screen works out to at the
   * head of each run, so it hands down the answers rather than the gesture, and
   * `gesture` is only what the step is called and how a drag of many frames is
   * folded into one.
   */
  placeChains: (places: { pieceId: string; at: Placement }[], gesture: 'move' | 'rotate') => void
  /**
   * Sets the run `pieceId` belongs to down on the workplane: it falls straight
   * down the upright until its lowest wall rests on y = 0, and nothing else
   * about it moves — same place on the plan, same heading, same angles. A run
   * that has been left sunk below the plane is lifted onto it instead, which is
   * the same thing said the other way round.
   *
   * The whole run travels, for the reason {@link RunState.placeChains} does: a
   * bonded part cannot be moved on its own.
   */
  dropToWorkplane: (pieceId: string) => void
  /**
   * Sizes a base to cover everything on the stage that is not a base, and slides
   * it under the middle of that — the plate's whole reason for being, done in one
   * step rather than by reading three figures off the run and typing them in.
   *
   * Measured to the outside of the tube rather than to the centreline, so the
   * plate reaches past the pipe rather than stopping under its axis, and squared
   * to the world: a base fitted this way is put back on a heading of nought,
   * since a box measured on the world's axes is only the right box while the
   * plate lies on them.
   *
   * Its thickness and its corners are left exactly as they were — this is a
   * question about footprint, and nothing else about the slab is any of its
   * business. Does nothing at all if the part named is not a base, or if the
   * stage holds nothing but ground.
   */
  fitBaseToRun: (pieceId: string) => void
  /**
   * Stands a support up to whatever tube is passing over it: it takes the height
   * of that tube's axis, the fall it is running at and the heading it is running
   * on, so the cradle lies along the pipe and the pipe sits down in it.
   *
   * Where it stands is left alone. That is the whole division of labour on this
   * part — sliding a post about the floor is a thing you can see yourself doing
   * and do better than any rule; reading a height off a run to a tenth of a
   * millimetre is not.
   *
   * The lowest tube overhead wins, not the nearest: on a run that folds back
   * over itself the level above is another post's job, and reaching for it would
   * mean going through the level below. Does nothing if the part named is not a
   * support, or if there is nothing but sky over it.
   */
  fitSupportToRun: (pieceId: string) => void
  /**
   * Paces out every run on the stage and stands a post under it wherever one
   * will fit — the printable answer to a run that is hanging in mid-air, done in
   * one step rather than a post at a time.
   *
   * The posts are cut to match the last one on the stage, so setting one up by
   * hand and then pressing this gives a stage of posts that agree with it. See
   * {@link plantSupports} for what makes it decline a spot; in short, it will not
   * put a post where the ground already is, where a post already stands, or
   * where the column would have to go through the run to get there.
   */
  addSupports: () => void
  addPiece: (type?: PieceType) => void
  /**
   * Copies the parts named and hands the selection over to the copies, so the
   * next thing you do lands on what you just made.
   *
   * A joint between two parts that were both named is copied with them; a joint
   * to a part left behind is not — see {@link copyParts}. `join` then bonds what
   * was copied onto the run, at the end {@link attachPort} names, exactly as a
   * part out of the library is bonded on; without it the copies stand in clear
   * space beside the run, which is where a copy has always landed.
   */
  duplicateParts: (ids: string[], opts?: { join?: boolean }) => void
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
   * Aims a part where it has just been pointed, and lets the run behind it
   * follow. This is the mirror of {@link RunState.swingHead}: that one pivots on
   * a part's far end and brings the run in front of it round, this one pivots on
   * its near end and takes the run behind it along.
   *
   * The part swings about its own inlet, so the joint it is plugged into stays
   * exactly where it is and every part ahead of it in the run stands still.
   * Everything bonded behind it comes with it rigidly, holding whatever kinks it
   * already had. What the swing opens up at the inlet is taken by the break a
   * lock past that joint — see {@link JOINT_LOCK} — which is the bend the tube
   * is really cut with, and the reason the joint itself stays straight.
   *
   * `turn` is the heading the part is aimed on, measured off what the part
   * before hands over; `slope` is its own fall. Either may be left out, and both
   * are held to what the part's own tube can be cut round — see
   * {@link turnLimitsFor}.
   */
  aimPart: (id: string, aim: { turn?: number; slope?: number }) => void
  /**
   * Puts every part back as it stood when a drag began. A swing moves parts
   * either side of the one under the pointer, so cancelling it has to restore
   * the run, not just the part that was grabbed.
   */
  restoreDrag: (id: string, pieces: Piece[]) => void
  removePiece: (id: string) => void
  /** Takes every part named out of the run, one after another, as one step. */
  removeParts: (ids: string[]) => void
  movePiece: (id: string, dir: -1 | 1) => void
  /** Picks one part and lets go of everything else — a plain click. */
  select: (id: string | null) => void
  /**
   * Adds a part to the selection or takes it out again — a click with the
   * command key or Shift held. Added, it leads the set; taken out, whatever was
   * picked before it leads again.
   */
  toggleSelect: (id: string) => void
  /**
   * Picks a whole run of parts at once — a Shift-click down the parts list,
   * which takes everything between the part last clicked and the one clicked
   * now. The last id given leads the set, so the parameters panel shows the row
   * the sweep ended on. Ids that are not parts of the run are dropped.
   */
  selectParts: (ids: string[]) => void
  /**
   * A click on a part, wherever it landed — the 3D stage, the draft, the parts
   * list. `additive` is the key that builds a set being held. Without it the part
   * is picked on its own, and clicking the one part already picked lets go of it:
   * clicking the same part twice is how a selection is put down.
   */
  pickPart: (id: string, additive: boolean) => void
  /**
   * Hands a part the lead of the selection. Already in the set, it takes the
   * lead and the rest of the set is kept — which is what taking up the arrows or
   * the ring on one part of a picked set has to do, since the handles work on the
   * whole of it. Outside the set, it is picked on its own.
   */
  leadPart: (id: string) => void
}

/** The model a project opens on — an empty plane, waiting for its first part. */
function freshSnapshot(): Snapshot {
  return {
    pieces: [],
    selectedId: null,
    selectedIds: [],
    innerDiameter: STANDARD_BORE,
    wallThickness: 3,
    // Every pipe is a closed pipe until it is asked to open: a run prints and
    // runs as tube, and cutting one open is a choice made about a part or about
    // the run, along with which side it opens.
    variant: 'closed',
    openSide: 'top',
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
      // Settled first and locked last, both after the edit rather than inside
      // it: a coil settles onto a new fall, and only then is whatever is still
      // out of true across a joint handed to the leads. Settling last would
      // tear open the very joints the edit had just closed, which is what it
      // used to do.
      const settled = settleAll(merged.pieces, merged.innerDiameter, merged.wallThickness)
      const pieces = lockJoints(settled, merged.innerDiameter, merged.wallThickness)
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
    openSide: INITIAL_SNAPSHOT.openSide,

    pieces: INITIAL_SNAPSHOT.pieces,
    selectedId: INITIAL_SNAPSHOT.selectedId,
    selectedIds: INITIAL_SNAPSHOT.selectedIds,
    tool: 'select',
    toolScope: 'selected',
    pendingPort: null,

    pieceColor: initialColor(PIECE_COLOR_KEY, DEFAULT_PIECE_COLOR),
    marbleColor: initialColor(MARBLE_COLOR_KEY, DEFAULT_MARBLE_COLOR),
    workplane: initialWorkplane(),
    shading: initialShading(),
    keepConnected: initialKeepConnected(),
    autoAttach: initialAutoAttach(),
    rotateStep: initialRotateStep(),
    jointFillet: initialJointFillet(),

    marbleDiameter: INITIAL_SNAPSHOT.marbleDiameter,
    running: false,
    simStarted: false,
    loop: true,
    timeScale: 1,
    friction: 0.06,
    bounce: 0.25,
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
        // The leads are read back off the joints for the same reason, and one
        // more besides: they are never written to a file, so a run saved by an
        // older build comes back with its connectors locked straight.
        //
        // Nothing is *swung* here, though. A file is what it is, and a run that
        // came back standing at angles other than the ones it was saved at would
        // be a file that had been quietly edited on the way in. The leads make
        // it buildable without moving any of it.
        const settled = settleAll(model.pieces, model.innerDiameter, model.wallThickness)
        const snap: Snapshot = {
          ...model,
          pieces: lockJoints(settled, model.innerDiameter, model.wallThickness),
          ...picked([]),
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
    setOpenSide: (openSide) =>
      commit(`Opens: ${OPEN_SIDE_LABEL[openSide]}`, (s) =>
        s.openSide === openSide ? null : { openSide },
      ),
    setPieceOpenSide: (id, openSide) =>
      commit(`${nameOf(get(), id)} opens: ${OPEN_SIDE_LABEL[openSide]}`, (s) => {
        const piece = s.pieces.find((p) => p.id === id)
        // Picking the side a part already opens on changes nothing, whether it
        // holds that side itself or follows the run's.
        if (!piece || openSideOf(piece, s.openSide) === openSide) return null
        return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, openSide } : p)) }
      }),
    applyOpenSideToAll: (openSide) =>
      commit(`Opens all: ${OPEN_SIDE_LABEL[openSide]}`, (s) => {
        const turned = s.pieces.some((p) => p.openSide !== undefined)
        if (s.openSide === openSide && !turned) return null
        return {
          openSide,
          // Dropping each part's own is what makes this stick: the run opens
          // one way, and stays that way as the side is changed again.
          pieces: turned ? s.pieces.map(({ openSide: _o, ...rest }) => rest) : s.pieces,
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
    setWorkplaneColor: (which, color) => {
      const theme = get().theme
      const workplane = { ...get().workplane, [theme]: { ...get().workplane[theme], [which]: color } }
      remember(WORKPLANE_KEY, JSON.stringify(workplane))
      set({ workplane })
    },
    resetWorkplane: () => {
      const theme = get().theme
      const workplane = { ...get().workplane, [theme]: { ...DEFAULT_WORKPLANE[theme] } }
      remember(WORKPLANE_KEY, JSON.stringify(workplane))
      set({ workplane })
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
          const pieces = weldJoints(s.pieces, tubeRadiusOf(s.innerDiameter, s.wallThickness))
          return pieces === s.pieces ? null : { pieces }
        })
      }
    },
    // A preference about the next part, not a change to this one: nothing on the
    // stage moves, so there is nothing to file in the timeline.
    setAutoAttach: (autoAttach) => {
      if (get().autoAttach === autoAttach) return
      remember(AUTO_ATTACH_KEY, autoAttach ? 'on' : 'off')
      set({ autoAttach })
    },
    // How the rings behave, not what they have done: no step, and remembered
    // past the project the way the rest of the handle settings are.
    setRotateStep: (rotateStep) => {
      if (get().rotateStep === rotateStep) return
      remember(ROTATE_STEP_KEY, String(rotateStep))
      set({ rotateStep })
    },
    setJointFillet: (mm, id) => {
      const jointFillet = clamp(mm, PIECE_LIMITS.jointFillet.min, PIECE_LIMITS.jointFillet.max)
      if (get().jointFillet !== jointFillet) {
        remember(JOINT_FILLET_KEY, String(jointFillet))
        set({ jointFillet })
      }
      // Put on a part, it is a change to what that part prints as, so it goes
      // through the same door every other shape edit does — the lead is
      // re-measured on the way out, because a rounded break reaches further back
      // down it than a mitred one.
      if (id) get().updatePiece(id, { jointFillet })
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
    setBounce: (bounce) => set({ bounce }),
    // Starting is also what puts the marble on stage the first time.
    toggleRunning: () => set((s) => ({ running: !s.running, simStarted: true })),
    setLoop: (loop) => set({ loop }),
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
    setTool: (tool, scope = 'selected') =>
      set((s) =>
        s.tool === tool && s.toolScope === scope
          ? s
          : { tool, toolScope: scope, pendingPort: null },
      ),

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
        const pieces = joinPorts(
          s.pieces,
          a,
          b,
          s.keepConnected,
          tubeRadiusOf(s.innerDiameter, s.wallThickness),
        )
        return pieces ? { pieces, pendingPort: null } : null
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

    placeChains: (places, gesture) => {
      const first = places[0]
      if (!first) return
      const s0 = get()
      // Named by the one run while that is all that is travelling, and counted
      // once the handle has more than one in hand. Counted in runs rather than
      // in the parts that named them: two parts of the one run are one run to
      // move, and a step that said two would be counting the picking, not the
      // moving.
      const runs = new Set<number>()
      for (const { pieceId } of places) {
        const i = s0.pieces.findIndex((p) => p.id === pieceId)
        if (i >= 0) runs.add(chainRootOf(s0.pieces, i))
      }
      const what = runs.size > 1 ? `${runs.size} runs` : nameOf(s0, first.pieceId)
      commit(
        `${gesture === 'move' ? 'Move' : 'Rotate'} ${what}`,
        (s) => {
          // Where each run is to stand, filed under the part it stands at: two
          // parts of the one run cannot send it two places, and the first named
          // is the one that wins if they try.
          const seats = new Map<number, Placement>()
          for (const { pieceId, at } of places) {
            const i = s.pieces.findIndex((p) => p.id === pieceId)
            if (i < 0) continue
            const root = chainRootOf(s.pieces, i)
            if (!seats.has(root)) seats.set(root, at)
          }
          let moved = false
          const pieces = s.pieces.map((p, j) => {
            const seat = seats.get(j)
            if (!seat) return p
            // A base slides and turns with the rest of the stage but never
            // leaves the ground, so the arrows' vertical is taken back off it
            // here rather than being left to spring back somewhere later.
            const at = groundSeat(p, seat)
            const was = placementOf(p)
            // Drag traffic repeats the place a run already stands in — not a step.
            if (was.x === at.x && was.y === at.y && was.z === at.z && was.yaw === at.yaw) return p
            moved = true
            return { ...p, at }
          })
          return moved ? { pieces } : null
        },
        // One drag of the handle is one step, however far it goes and however
        // many runs it takes with it.
        `chains:${first.pieceId}:${gesture}`,
      )
    },

    dropToWorkplane: (pieceId) =>
      commit(`Drop ${nameOf(get(), pieceId)} to the workplane`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === pieceId)
        if (i < 0) return null
        const root = chainRootOf(s.pieces, i)
        // Structure is already down: a base and a post alike are held on the
        // plane wherever they are put, so there is nothing here to drop and
        // nothing worth a step in the timeline.
        if (isStructure(s.pieces[root])) return null
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

    fitBaseToRun: (pieceId) =>
      commit(`Fit ${nameOf(get(), pieceId)} under the run`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === pieceId)
        if (i < 0 || !isBase(s.pieces[i])) return null
        // The plan of everything that is not ground, in the world's own axes.
        // The posts are ground as much as the plate is: a base sized to its own
        // supports would grow to cover parts that are only standing on it.
        const span = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
        for (const p of buildAssembly(s.pieces).placed) {
          if (isStructure(p.piece)) continue
          const box = placedBox(
            p,
            boreOf(p.piece, s.innerDiameter) / 2 + wallOf(p.piece, s.wallThickness),
          )
          span.x0 = Math.min(span.x0, box.min.x)
          span.x1 = Math.max(span.x1, box.max.x)
          span.z0 = Math.min(span.z0, box.min.z)
          span.z1 = Math.max(span.z1, box.max.z)
        }
        if (!Number.isFinite(span.x0)) return null
        const B = BASE_LIMITS
        const width = clamp(Math.ceil(span.x1 - span.x0), B.width.min, B.width.max)
        const depth = clamp(Math.ceil(span.z1 - span.z0), B.depth.min, B.depth.max)
        // Squared to the world, because the box it is being fitted to is: a plate
        // left on a heading of its own would be sized to a footprint measured on
        // somebody else's axes.
        const at: Placement = {
          x: tidy((span.x0 + span.x1) / 2),
          y: 0,
          z: tidy((span.z0 + span.z1) / 2),
          yaw: 0,
        }
        const was = s.pieces[i]
        const now = baseSpec(was)
        const seat = placementOf(was)
        if (
          now.width === width &&
          now.depth === depth &&
          seat.x === at.x &&
          seat.z === at.z &&
          seat.yaw === 0 &&
          !was.turn
        ) {
          return null
        }
        return {
          pieces: s.pieces.map((p, j) =>
            j === i ? { ...p, width, length: depth, turn: 0, at } : p,
          ),
        }
      }),

    fitSupportToRun: (pieceId) =>
      commit(`Fit ${nameOf(get(), pieceId)} to the run above it`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === pieceId)
        if (i < 0 || !isSupport(s.pieces[i])) return null
        const was = s.pieces[i]
        const at = placementOf(was)
        const over = tubeOverPost(s, at.x, at.z, postHalf(was))
        if (!over) return null
        const { seat, footing } = over
        const height = clamp(
          tidy(seat.seat),
          SUPPORT_LIMITS.height.min,
          SUPPORT_LIMITS.height.max,
        )
        const tilt = clamp(seat.tilt, SUPPORT_LIMITS.tilt.min, SUPPORT_LIMITS.tilt.max)
        const post = supportSpec(was)
        // The foot only moves when there is an answer for where it should be.
        // Where the run underneath crosses at too sharp an angle to be stood on
        // there is no honest answer, and a foot the user typed is left standing.
        const foot = footing
          ? clamp(tidy(footing.foot), SUPPORT_LIMITS.foot.min, SUPPORT_LIMITS.foot.max)
          : post.foot
        const footTilt = footing
          ? clamp(footing.footTilt, SUPPORT_LIMITS.footTilt.min, SUPPORT_LIMITS.footTilt.max)
          : post.footTilt
        const footShift = footing
          ? clamp(footing.footShift, SUPPORT_LIMITS.footShift.min, SUPPORT_LIMITS.footShift.max)
          : post.footShift
        if (
          post.height === height &&
          post.tilt === tilt &&
          post.foot === foot &&
          post.footTilt === footTilt &&
          post.footShift === footShift &&
          at.yaw === seat.yaw &&
          !was.turn &&
          was.innerDiameter === seat.bore &&
          was.wallThickness === seat.wall
        ) {
          return null
        }
        // Squared onto the tube in plan as well as in height: a cradle cut along
        // the post's own +Z only lies along the pipe while the post is facing the
        // way the pipe is running. Sliding the post is the user's business, so
        // that is the one thing left exactly as it was.
        return {
          pieces: s.pieces.map((p, j) =>
            j === i
              ? {
                  ...p,
                  height,
                  tilt,
                  foot,
                  footTilt,
                  footShift,
                  turn: 0,
                  at: { ...at, yaw: seat.yaw },
                  // The cradle is cut to the pipe it is actually holding, which
                  // on a part sized on its own is not the run's pipe.
                  innerDiameter: seat.bore,
                  wallThickness: seat.wall,
                }
              : p,
          ),
        }
      }),

    addSupports: () => {
      const s0 = get()
      const posts = plantSupports(s0)
      if (!posts.length) return
      const label = posts.length === 1 ? 'Add 1 support' : `Add ${posts.length} supports`
      commit(`${label} under the run`, (s) => {
        // Worked out again against the run as it stands at the moment the step
        // lands, rather than trusting the count taken above: everything else in
        // here reads the state it is handed, and a stage that moved between the
        // two would otherwise be propped where it used to be.
        const fresh = plantSupports(s)
        if (!fresh.length) return null
        return { pieces: [...s.pieces, ...fresh], ...picked(fresh.map((p) => p.id)) }
      })
    },

    addPiece: (type = 'straight') => {
      const s0 = get()
      // Settled before it is stood down, not after: how far a coil falls is
      // what says how high off the workplane it has to start.
      const outerR = s0.innerDiameter / 2 + s0.wallThickness
      const shape = settle(makePiece({ type }), s0.innerDiameter / 2, s0.wallThickness)
      const piece = {
        ...shape,
        at: spawnPlacement(s0.pieces, shape, outerR),
      }
      // Where it is going to be bonded, settled before the commit so the label
      // in the timeline can say so — and so that a part landing on its own says
      // that instead. A base is never bonded: it has no ends, so it always lands
      // on its own and the label says only that.
      const target = s0.autoAttach && !isStructure(piece) ? attachPort(s0) : null
      const label = target
        ? `Add ${PART_LABEL[piece.type]} onto ${nameOf(s0, target.pieceId)}`
        : `Add ${PART_LABEL[piece.type]}`
      commit(label, (s) => {
        // Stood down in clear space first and bonded on second, rather than
        // placed at the joint outright: the joint is then made by exactly the
        // code the Connector makes it with, kinks, welds, swings and all.
        const standing = [...s.pieces, piece]
        if (target) {
          // The new part is the one that travels, so it is the end named first.
          // Onto a tail it goes by its inlet; onto a head, by its outlet, and it
          // lands in front of the run rather than behind it.
          const own: Port = { pieceId: piece.id, end: target.end === 'out' ? 'in' : 'out' }
          const pieces = joinPorts(
            standing,
            own,
            target,
            s.keepConnected,
            tubeRadiusOf(s.innerDiameter, s.wallThickness),
          )
          // A pair that cannot take a joint — a run that will not turn end for
          // end, say — still gets its part: it lands on its own, which is what
          // this did before there was anywhere to land on.
          if (pieces) {
            // Growing a run's head is a direction rather than a one-off, so the
            // new head is held ready for the next part. Left to the selection
            // alone the next one would land at the far end of the run instead,
            // and a run being built backwards would come apart at the second
            // part. Growing a tail needs none of this: the far end of the part
            // just added is the far end of the run.
            const carry: Port | null = target.end === 'in' ? { pieceId: piece.id, end: 'in' } : null
            return { pieces, ...picked([piece.id]), pendingPort: carry }
          }
        }
        return { pieces: standing, ...picked([piece.id]) }
      })
    },
    duplicateParts: (ids, opts) => {
      const s0 = get()
      // Named in run order however they were picked, and only the ones still on
      // the stage: the copy is of the run, not of the order it was clicked in.
      const list = s0.pieces.filter((p) => ids.includes(p.id)).map((p) => p.id)
      if (!list.length) return
      // Where the copies are going to be bonded, settled before the commit so the
      // label in the timeline can say so — the same way a part out of the library
      // works out its landing before it lands. See {@link RunState.addPiece}.
      const target = opts?.join ? attachPort(s0) : null
      const what = list.length > 1 ? `${list.length} parts` : nameOf(s0, list[0])
      const label = target ? `Duplicate ${what} onto ${nameOf(s0, target.pieceId)}` : `Duplicate ${what}`
      commit(label, (s) => {
        const runs = copyParts(s, list)
        const copies = runs.flat()
        if (!copies.length) return null
        let pieces = [...s.pieces, ...copies]
        if (!target) return { pieces, ...picked(copies.map((c) => c.id)) }
        const tube = tubeRadiusOf(s.innerDiameter, s.wallThickness)
        // Onto a tail the runs go in the order they were copied in; onto a head
        // they go in the reverse of it, since each one lands in front of the last
        // — either way the set comes out in the order it stood in.
        const order = target.end === 'in' ? [...runs].reverse() : runs
        let port: Port | null = target
        for (const run of order) {
          if (!port) break
          const head = run[0]
          const tail = run[run.length - 1]
          // The copy is the one that travels, so it is the end named first. Onto
          // a tail it goes by its inlet; onto a head, by its outlet.
          const own: Port =
            port.end === 'out' ? { pieceId: head.id, end: 'in' } : { pieceId: tail.id, end: 'out' }
          const bonded = joinPorts(pieces, own, port, s.keepConnected, tube)
          // A pair that cannot take a joint leaves its copy standing where it was
          // put, which is what a copy did before there was anywhere to land on.
          if (!bonded) break
          pieces = bonded
          // The end the next one goes on: growing a tail, the far end of what just
          // landed; growing a head, its near end.
          port =
            target.end === 'out' ? { pieceId: tail.id, end: 'out' } : { pieceId: head.id, end: 'in' }
        }
        // Growing a run's head is a direction rather than a one-off, so the new
        // head is held ready for whatever is added next — the reason
        // {@link RunState.addPiece} holds one.
        const carry = target.end === 'in' ? port : null
        return { pieces, ...picked(copies.map((c) => c.id)), pendingPort: carry }
      })
    },
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
          // the fall it runs at; widening a bowl moves the collar its feed has
          // to reach out over — so the part is put straight back on its own
          // shape here, before the joints either side are measured off it.
          const edited = settle(
            { ...piece, ...patch },
            boreOf(piece, cur.innerDiameter) / 2,
            wallOf(piece, cur.wallThickness),
          )
          const tube = tubeRadiusOf(cur.innerDiameter, cur.wallThickness)
          let pieces = cur.pieces.slice()
          pieces[at] = edited
          // Keep connected holds both of a part's joints, not just the one in
          // front of it. Setting the angle a part starts at moves it off the
          // part it is bonded to, so the run behind is brought round by the
          // same amount and the inlet stays flush — the run swings instead of
          // one joint tearing open.
          //
          // Measured off what the part actually ended up at rather than off
          // what was typed: raising a coil re-counts its rings and puts it on a
          // fall nobody asked for in so many words, and the run above it has to
          // come round to that too. Watching the patch alone is what used to
          // leave those joints standing open.
          pieces = swingBehind(
            pieces,
            at,
            tidy(edited.slope - piece.slope),
            cur.keepConnected,
            tube,
          )
          // Swinging this part's slope or bend swings the run hanging off it.
          return {
            pieces: carrySlope(
              pieces,
              at,
              tidy(exitSlope(edited) - exitSlope(piece)),
              cur.keepConnected,
              tube,
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
          const tube = tubeRadiusOf(cur.innerDiameter, cur.wallThickness)
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
                  tube,
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
              pieces = relink(pieces, kinks, from + 1, at, tube)
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
          if (cur.keepConnected) pieces = relink(pieces, kinks, at + 1, pieces.length - 1, tube)
          // Drag traffic repeats the angle it already sits at, and a swing held
          // against its limits repeats it too — neither is a step.
          if (pieces.every((p, i) => p === cur.pieces[i])) return null
          return { pieces }
        },
        // One gesture is one step, however many parts it carries with it.
        `piece:${id}:swing`,
      ),

    aimPart: (id, aim) =>
      commit(
        `Aim ${nameOf(get(), id)}`,
        (cur) => {
          const at = cur.pieces.findIndex((p) => p.id === id)
          if (at < 0) return null
          const piece = cur.pieces[at]
          const tube = tubeRadiusOf(cur.innerDiameter, cur.wallThickness)
          // The fall the part is fed at. That is what its break is measured off,
          // and so what says how far it may be turned before the mitre eats the
          // socket it plugs into. A run's head is fed by nothing and turns as
          // freely as it likes.
          const fed = at > 0 && piece.joined ? exitSlope(cur.pieces[at - 1]) : undefined
          // A joint that has never been told either way takes the pivot the tool
          // is set to, so what the settings say a joint will be is what the first
          // swing of it actually makes. Told once — rounded or sharp, either is a
          // choice — it keeps what it was told, and only that control changes it.
          const jointFillet = piece.jointFillet ?? cur.jointFillet
          const S = slopeLimitsFor(piece)
          const slope = aim.slope === undefined ? piece.slope : tidy(clamp(aim.slope, S.min, S.max))
          // Measured against the fall and the pivot the part is landing on rather
          // than the ones it left: turning, tipping and rounding all spend the
          // same straight, and the turn is what gives way where they do not all fit.
          const T = turnLimitsFor({ ...piece, slope, jointFillet }, fed, tube(piece))
          const turn = aim.turn === undefined ? piece.turn : tidy(clamp(aim.turn, T.min, T.max))
          // Drag traffic repeats the aim the part already sits on, and an aim
          // held against its limits repeats it too — neither is a step.
          if (slope === piece.slope && turn === piece.turn && jointFillet === piece.jointFillet) {
            return null
          }
          const aimed = { ...piece, slope, turn, jointFillet }
          const pieces = cur.pieces.slice()
          pieces[at] = aimed
          // Only the run behind it follows, and the heading half of that carries
          // itself: a turn is a change from the part before, so everything after
          // this part is already measured off the new one. The fall is not —
          // each part holds an angle of its own — so the joints behind are
          // walked back into line at the kinks they were standing at.
          return {
            pieces: carrySlope(
              pieces,
              at,
              tidy(exitSlope(aimed) - exitSlope(piece)),
              cur.keepConnected,
              tube,
            ),
          }
        },
        // One drag of the ring is one step, however far it swings the run.
        `piece:${id}:aim`,
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

    removePiece: (id) => get().removeParts([id]),
    removeParts: (ids) => {
      const s0 = get()
      const list = s0.pieces.filter((p) => ids.includes(p.id)).map((p) => p.id)
      if (!list.length) return
      const what = list.length > 1 ? `${list.length} parts` : nameOf(s0, list[0])
      commit(`Delete ${what}`, (s) => {
        // Taken out one at a time, each off the run the one before it left: a
        // part in the middle of a run hands its angle to the part behind it, and
        // that part may well be the next one to go.
        let pieces = s.pieces
        for (const id of list) {
          pieces = dropPart({ ...s, pieces }, id) ?? pieces
        }
        if (pieces === s.pieces) return null
        return {
          pieces,
          ...picked(s.selectedIds.filter((x) => !list.includes(x))),
          // The joint the port named has gone with the part.
          pendingPort: list.includes(s.pendingPort?.pieceId ?? '') ? null : s.pendingPort,
        }
      })
    },
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
        return {
          pieces: carrySlope(
            pieces,
            at + 1,
            tidy(exitSlope(pieces[at + 1]) - was),
            true,
            tubeRadiusOf(s.innerDiameter, s.wallThickness),
          ),
        }
      }),
    // Picking a part is not a model change, so it never lands in the history.
    select: (id) => set(picked(id ? [id] : [])),
    toggleSelect: (id) =>
      set((s) => {
        if (!s.pieces.some((p) => p.id === id)) return s
        const without = s.selectedIds.filter((x) => x !== id)
        // Held down on a part already in the set, the key takes it out again;
        // otherwise the part goes on the end, where the lead is.
        return picked(without.length === s.selectedIds.length ? [...without, id] : without)
      }),
    selectParts: (ids) =>
      set((s) => {
        // A part named twice keeps only its last place, so the row the sweep
        // ended on is the one that leads.
        const known = ids.filter(
          (id, i) => ids.indexOf(id, i + 1) === -1 && s.pieces.some((p) => p.id === id),
        )
        return known.length ? picked(known) : s
      }),
    pickPart: (id, additive) => {
      const s = get()
      if (additive) s.toggleSelect(id)
      // Narrowing a set of several down to the one clicked is not letting go of
      // it — only a click on a part that was already the whole selection is.
      else s.select(s.selectedIds.length === 1 && s.selectedId === id ? null : id)
    },
    leadPart: (id) =>
      set((s) => {
        if (s.selectedId === id || !s.pieces.some((p) => p.id === id)) return s
        const without = s.selectedIds.filter((x) => x !== id)
        // Only a part already in the set brings the rest of it along; one from
        // outside is picked on its own, as a plain click on it would pick it.
        return picked(without.length === s.selectedIds.length ? [id] : [...without, id])
      }),
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
  /** Which side the opening faces — nothing to a closed tube, which has none. */
  openSide: OpenSide
}

export function tubeSpec(
  innerDiameter: number,
  wallThickness: number,
  variant: TubeVariant,
  openSide: OpenSide = 'top',
): TubeSpec {
  const innerR = innerDiameter / 2
  const outerR = innerR + wallThickness
  const coverage = VARIANT_COVERAGE[variant]
  const sweep = Math.PI * 2 * coverage
  // The opening is centred on the side asked for. Section angles are measured
  // off local +X and turn towards +Y (up), so up itself is 90° and the side's
  // own angle — measured the other way about, off up — is taken back off it.
  const gap = Math.PI * 2 - sweep
  const startAngle = Math.PI / 2 - OPEN_SIDE_ANGLE[openSide] + gap / 2
  return {
    innerR,
    outerR,
    wall: wallThickness,
    startAngle,
    sweep,
    closed: variant === 'closed',
    variant,
    openSide,
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
  const openSide = openSideOf(piece, base.openSide)
  const innerDiameter = boreOf(piece, base.innerR * 2)
  const wall = wallOf(piece, base.wall)
  return variant === base.variant &&
    openSide === base.openSide &&
    innerDiameter === base.innerR * 2 &&
    wall === base.wall
    ? base
    : tubeSpec(innerDiameter, wall, variant, openSide)
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
