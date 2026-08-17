import { create } from 'zustand'
import type { ExportFormat } from './lib/exporters'

/** All dimensions in this app are millimetres. */
export type TubeVariant = 'half' | 'threequarter' | 'closed'
export type PieceType = 'straight' | 'angle'
export type Mode = '2d' | '3d'
export type DraftView = 'elevation' | 'plan'
export type Theme = 'light' | 'dark'
/** How the 3D pieces are shaded — see-through mode exposes the bore and the marble. */
export type Shading = 'solid' | 'transparent'
/** Which slide-out is showing on the right edge of the stage, if any. */
export type RightPanel = 'settings' | 'history' | null

const THEME_KEY = 'mrg.theme'
const PIECE_COLOR_KEY = 'mrg.pieceColor'
const MARBLE_COLOR_KEY = 'mrg.marbleColor'
const SHADING_KEY = 'mrg.shading'
const SCREEN_KEY = 'mrg.screenPxPerMm'
const KEEP_CONNECTED_KEY = 'mrg.keepConnected'

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

export interface Piece {
  id: string
  type: PieceType
  /** Optional label from the parts list; blank falls back to the part name. */
  name?: string
  /**
   * Nominal run length along the tube axis, mm (excludes the snap spigot). On
   * an angle connector this is the rigid entry leg, up to the break.
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
  /** Angle connector: length of the leg after the break, mm. */
  exitLength?: number
  /**
   * Angle connector: radius the break is rounded off with, mm. Zero is a sharp
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
  exitLength: { min: 10, max: 600, step: 1 },
  fillet: { min: 0, max: 120, step: 1 },
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
 * The pitch a part hands on to whatever follows it. Only the angle connector
 * leaves at a different angle from the one it arrived at — that is the whole
 * point of it.
 */
export function exitSlope(piece: Piece): number {
  return piece.type === 'angle' ? piece.slope + angleSpec(piece).bend : piece.slope
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
  if (piece.type !== 'angle') return S
  const { bend } = angleSpec(piece)
  return { ...S, min: Math.max(S.min, S.min - bend), max: Math.min(S.max, S.max - bend) }
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

/**
 * Where a part added at `port` lands in the run. The inlet of a part means
 * "immediately before this one", its outlet "immediately after" — so any joint
 * in the run is a place to build from, not just the far end. Nothing armed
 * carries on at the tail, which is how the run has always grown.
 */
export function insertIndexAt(pieces: Piece[], port: Port | null): number {
  if (!port) return pieces.length
  const i = pieces.findIndex((p) => p.id === port.pieceId)
  if (i < 0) return pieces.length
  return port.end === 'in' ? i : i + 1
}

/**
 * The parts are bonded together, so a joint that holds has to keep holding.
 * When an edit swings what one part leaves at, everything downstream swings
 * with it by the same amount: a joint that was flush stays flush, and a kink
 * the user built on purpose is carried along rather than quietly closed up.
 *
 * The swing is the same for all of them: if one part would be taken past its
 * slope limit, the whole tail swings only as far as that part can, so the limit
 * shows up as the run refusing to go further rather than as a joint pulling
 * apart somewhere down the line.
 */
function carrySlope(pieces: Piece[], from: number, delta: number, connected: boolean): Piece[] {
  if (!connected || !delta || from + 1 >= pieces.length) return pieces
  const S = PIECE_LIMITS.slope
  let swing = delta
  for (let i = from + 1; i < pieces.length; i++) {
    const room = clamp(pieces[i].slope + delta, S.min, S.max) - pieces[i].slope
    if (Math.abs(room) < Math.abs(swing)) swing = room
  }
  if (!tidy(swing)) return pieces
  return pieces.map((p, i) => (i > from ? { ...p, slope: tidy(p.slope + swing) } : p))
}

/**
 * Pulls every joint in the run shut: each part starts at the angle the one
 * before it leaves at. This is what Keep connected does to a run that was drawn
 * with its joints free.
 */
function weldJoints(pieces: Piece[]): Piece[] {
  const S = PIECE_LIMITS.slope
  const next = pieces.slice()
  let changed = false
  for (let i = 1; i < next.length; i++) {
    // Each part is welded to the one already welded before it, so a single pass
    // carries a correction all the way down the run.
    const slope = tidy(clamp(exitSlope(next[i - 1]), S.min, S.max))
    if (slope === next[i].slope) continue
    next[i] = { ...next[i], slope }
    changed = true
  }
  return changed ? next : pieces
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
export const PART_LABEL: Record<PieceType, string> = { straight: 'Tube', angle: 'Angle' }

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
}

export function makePiece(partial: Partial<Piece> = {}): Piece {
  const type = partial.type ?? 'straight'
  return { id: nextId(), type, ...TYPE_DEFAULTS[type], ...partial }
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

const FIELD_LABEL: Record<string, string> = {
  length: 'length',
  slope: 'slope',
  turn: 'turn',
  bend: 'bend',
  exitLength: 'exit leg',
  fillet: 'corner radius',
}
const FIELD_UNIT: Record<string, string> = {
  length: ' mm',
  slope: '°',
  turn: '°',
  bend: '°',
  exitLength: ' mm',
  fillet: ' mm',
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
    .map(([k, v]) => `${FIELD_LABEL[k]} ${num(v as number)}${FIELD_UNIT[k]}`)
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

  // Tube front-face definition. Bore and wall are the run's throughout; the
  // style is only what a part falls back to when it has none of its own.
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant

  // Assembly
  pieces: Piece[]
  selectedId: string | null
  /**
   * The joint a part added from the Part Library is joined onto. Null builds at
   * the tail of the run, which is how it grew before ports existed.
   */
  armedPort: Port | null
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
  undo: () => void
  redo: () => void
  /** Jump straight to a step from the History list. */
  gotoHistory: (index: number) => void

  setMode: (m: Mode) => void
  setDraftView: (v: DraftView) => void
  toggleTheme: () => void
  setInnerDiameter: (v: number) => void
  setWallThickness: (v: number) => void
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

  /** Arms the joint the next part is built onto; null goes back to the tail. */
  armPort: (p: Port | null) => void
  addPiece: (type?: PieceType) => void
  duplicatePiece: (id: string) => void
  renamePiece: (id: string, name: string) => void
  togglePieceHidden: (id: string) => void
  showAllPieces: () => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  /**
   * Swings a part from its head. It turns through `delta` degrees about the far
   * end of the leg being dragged — the break on an angle connector, the outlet
   * on a plain tube — and on a connected run every part ahead of it turns by
   * the same amount, so the joints behind it hold. Nothing past the pivot moves
   * at all: this is the mirror of dragging a part's outlet, which holds the run
   * ahead still and swings everything after it.
   *
   * `holdExit` pins a connector's outgoing leg where it is by giving the bend
   * back whatever the entry leg takes, so only the entry swings and the pivot
   * really is the one point that does not move. `patch` carries whatever the
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
      const next = patch(s)
      if (!next) return s
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
    draftView: 'elevation',
    theme: initialTheme(),

    // Sized for a standard glass marble out of the box.
    innerDiameter: INITIAL_SNAPSHOT.innerDiameter,
    wallThickness: INITIAL_SNAPSHOT.wallThickness,
    variant: INITIAL_SNAPSHOT.variant,

    pieces: INITIAL_SNAPSHOT.pieces,
    selectedId: INITIAL_SNAPSHOT.selectedId,
    armedPort: null,

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
          armedPort: null,
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
    loadProject: ({ projectName, ...model }) =>
      set((s) => {
        recent = null
        const snap: Snapshot = { ...model, selectedId: null }
        return {
          ...snap,
          projectName,
          exportName: '',
          armedPort: null,
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
    setInnerDiameter: (innerDiameter) =>
      commit(
        `Bore \u00d8${num(innerDiameter)} mm`,
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
        `Wall ${num(wallThickness)} mm`,
        (s) => (s.wallThickness === wallThickness ? null : { wallThickness }),
        'wall',
      ),
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
        `Marble \u00d8${num(marbleDiameter)} mm`,
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

    armPort: (armedPort) => set({ armedPort }),

    addPiece: (type = 'straight') => {
      const s = get()
      const S = PIECE_LIMITS.slope
      const at = insertIndexAt(s.pieces, s.armedPort)
      const before = s.pieces[at - 1]
      const after = s.pieces[at]
      const bend = type === 'angle' ? ANGLE_DEFAULTS.bend : 0
      // Entering: carry on at the angle the run is already travelling at. Put in
      // at the head of the run there is nothing to carry on from, so the part
      // instead enters at whatever angle lets it hand the old first part the
      // angle it already had — the run gets longer without changing shape.
      const slope = before ? exitSlope(before) : after ? after.slope - bend : null
      const piece = makePiece({
        type,
        ...(slope === null ? {} : { slope: clamp(tidy(slope), S.min, S.max) }),
        // Length only carries over between plain tubes. A connector is meant to
        // stay short, and its own short entry leg is no guide to how long the
        // next tube should be.
        ...(before?.type === 'straight' && type === 'straight' ? { length: before.length } : {}),
      })
      // What the part now sitting downstream used to be handed. A tube changes
      // nothing; dropping a connector in tips everything after it by its bend.
      const handedOn = before ? exitSlope(before) : after ? after.slope : exitSlope(piece)
      const pieces = s.pieces.slice()
      pieces.splice(at, 0, piece)

      commit(`Add ${PART_LABEL[piece.type]}`, (cur) => ({
        pieces: carrySlope(pieces, at, tidy(exitSlope(piece) - handedOn), cur.keepConnected),
        selectedId: piece.id,
        // The port follows onto the part it just fed, so adding again carries on
        // in the same direction instead of stacking back into the same joint.
        ...(s.armedPort ? { armedPort: { pieceId: piece.id, end: s.armedPort.end } } : {}),
      }))
    },
    // The copy lands right after its original and takes over the selection.
    duplicatePiece: (id) =>
      commit(`Duplicate ${nameOf(get(), id)}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        if (i < 0) return null
        const original = s.pieces[i]
        const { id: _id, ...rest } = original
        const S = PIECE_LIMITS.slope
        // The copy is spliced into the run, not laid beside it, so on a
        // connected run it picks up where its original leaves off, exactly as a
        // freshly added part would.
        const copy = makePiece(
          s.keepConnected ? { ...rest, slope: clamp(exitSlope(original), S.min, S.max) } : rest,
        )
        const pieces = s.pieces.slice()
        pieces.splice(i + 1, 0, copy)
        return {
          pieces: carrySlope(
            pieces,
            i + 1,
            tidy(exitSlope(copy) - exitSlope(original)),
            s.keepConnected,
          ),
          selectedId: copy.id,
        }
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
          const edited = { ...piece, ...patch }
          const pieces = cur.pieces.slice()
          pieces[at] = edited
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
          const pieces = cur.pieces.slice()
          let swing = tidy(delta)

          if (axis === 'turn') {
            // Plan: a heading is only ever a change from the one before, so the
            // run takes the whole swing at its first part and the part past the
            // pivot gives it straight back. What is left is the head of the run
            // turned about the pivot, with everything after it untouched.
            const after = pieces[at + 1]
            swing = narrow(swing, roomFor(pieces[0].turn, swing, T))
            if (after) swing = narrow(swing, -roomFor(after.turn, -swing, T))
            if (tidy(swing)) {
              pieces[0] = { ...pieces[0], turn: tidy(pieces[0].turn + swing) }
              if (after) pieces[at + 1] = { ...after, turn: tidy(after.turn - swing) }
            }
          } else {
            // Elevation: the slope is the angle itself, so every part that comes
            // along takes the same delta and the run ahead stays rigid. Off a
            // connected run only the part under the pointer moves, and the joint
            // behind it is free to open.
            const from = cur.keepConnected ? 0 : at
            for (let i = from; i <= at; i++) {
              swing = narrow(swing, roomFor(pieces[i].slope, swing, S))
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
              for (let i = from; i <= at; i++) {
                pieces[i] = { ...pieces[i], slope: tidy(pieces[i].slope + swing) }
              }
              if (holdExit) {
                const bend = pieces[at].bend ?? ANGLE_DEFAULTS.bend
                pieces[at] = { ...pieces[at], bend: tidy(bend - swing) }
              }
            }
          }

          if (patch && Object.entries(patch).some(([k, v]) => pieces[at][k as keyof Piece] !== v)) {
            pieces[at] = { ...pieces[at], ...patch }
          }
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
        const pieces = s.pieces.filter((p) => p.id !== id)
        // What followed the deleted part now hangs off the part before it, so it
        // has to take up the angle the deleted one used to hand on.
        const delta = i > 0 ? tidy(exitSlope(s.pieces[i - 1]) - exitSlope(s.pieces[i])) : 0
        return {
          pieces: carrySlope(pieces, i - 1, delta, s.keepConnected),
          selectedId: s.selectedId === id ? null : s.selectedId,
          // The joint the port named has gone with the part.
          armedPort: s.armedPort?.pieceId === id ? null : s.armedPort,
        }
      }),
    movePiece: (id, dir) =>
      commit(`Move ${nameOf(get(), id)} ${dir < 0 ? 'up' : 'down'}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= s.pieces.length) return null
        const pieces = s.pieces.slice()
        ;[pieces[i], pieces[j]] = [pieces[j], pieces[i]]
        if (!s.keepConnected) return { pieces }
        const S = PIECE_LIMITS.slope
        const at = Math.min(i, j)
        // The two have traded places in the chain: each takes the angle its new
        // place hands it, and whatever follows swings by the difference.
        const was = exitSlope(s.pieces[at + 1])
        if (at > 0) {
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
 * One spec per style, off the run's bore and wall. Parts sharing a style get
 * the very same object back, which is what keeps a memoised mesh from being
 * rebuilt every time the run is touched.
 */
export function tubeSpecs(innerDiameter: number, wallThickness: number): Record<TubeVariant, TubeSpec> {
  return {
    half: tubeSpec(innerDiameter, wallThickness, 'half'),
    threequarter: tubeSpec(innerDiameter, wallThickness, 'threequarter'),
    closed: tubeSpec(innerDiameter, wallThickness, 'closed'),
  }
}

/**
 * The tube one part is cut from: the run's bore and wall, in that part's own
 * style. `base` doubles as the fallback, so an unstyled part hands back the
 * spec it was given.
 */
export function pieceSpec(base: TubeSpec, piece: Piece): TubeSpec {
  const variant = variantOf(piece, base.variant)
  return variant === base.variant ? base : tubeSpec(base.innerR * 2, base.wall, variant)
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
