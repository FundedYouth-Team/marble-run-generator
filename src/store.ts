import { create } from 'zustand'
import type { ExportFormat } from './lib/exporters'

/** All dimensions in this app are millimetres. */
export type TubeVariant = 'half' | 'threequarter' | 'closed'
export type PieceType = 'straight'
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

const HEX = /^#[0-9a-f]{6}$/i

/** Falls back to the default unless a full 6-digit hex was stored. */
function initialColor(key: string, fallback: string): string {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  return saved && HEX.test(saved) ? saved : fallback
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

export interface Piece {
  id: string
  type: PieceType
  /** Optional label from the parts list; blank falls back to the part name. */
  name?: string
  /** Nominal run length along the tube axis, mm (excludes the snap spigot). */
  length: number
  /** Downhill pitch of this piece, degrees. Positive = falling. */
  slope: number
  /** Heading change applied at the start of this piece, degrees. */
  turn: number
  /** Hidden from the 3D view. Display only — the piece still shapes the run. */
  hidden?: boolean
}

/** Editing limits for a straight piece, shared by the sidebar fields and the draft handles. */
export const PIECE_LIMITS = {
  length: { min: 10, max: 600, step: 1 },
  slope: { min: -30, max: 60, step: 0.5 },
  turn: { min: -90, max: 90, step: 1 },
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
export const PART_LABEL: Record<PieceType, string> = { straight: 'Tube' }

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

export function makePiece(partial: Partial<Piece> = {}): Piece {
  return { id: nextId(), type: 'straight', length: 120, slope: 6, turn: 0, ...partial }
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

const FIELD_LABEL: Record<string, string> = { length: 'length', slope: 'slope', turn: 'turn' }
const FIELD_UNIT: Record<string, string> = { length: ' mm', slope: '°', turn: '°' }

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

  // Tube front-face definition
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant

  // Assembly
  pieces: Piece[]
  selectedId: string | null

  // 3D appearance
  pieceColor: string
  marbleColor: string
  shading: Shading

  // Simulator
  marbleDiameter: number
  running: boolean
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
  setVariant: (v: TubeVariant) => void
  setPieceColor: (v: string) => void
  setMarbleColor: (v: string) => void
  setShading: (v: Shading) => void
  toggleShading: () => void
  setMarbleDiameter: (v: number) => void
  resetMarbleFit: () => void
  setTimeScale: (v: number) => void
  setFriction: (v: number) => void
  toggleRunning: () => void
  setLoop: (v: boolean) => void
  resetSim: () => void
  setExportFormat: (v: ExportFormat) => void
  setScreenPxPerMm: (v: number) => void
  resetScreenCalibration: () => void

  addPiece: () => void
  duplicatePiece: (id: string) => void
  renamePiece: (id: string, name: string) => void
  togglePieceHidden: (id: string) => void
  showAllPieces: () => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  removePiece: (id: string) => void
  movePiece: (id: string, dir: -1 | 1) => void
  select: (id: string | null) => void
}

/** The model a project opens on — a new one each call, so ids never repeat. */
function freshSnapshot(): Snapshot {
  return {
    pieces: [makePiece({ length: 140, slope: 8 })],
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

    pieceColor: initialColor(PIECE_COLOR_KEY, DEFAULT_PIECE_COLOR),
    marbleColor: initialColor(MARBLE_COLOR_KEY, DEFAULT_MARBLE_COLOR),
    shading: initialShading(),

    marbleDiameter: INITIAL_SNAPSHOT.marbleDiameter,
    running: false,
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
          running: false,
          resetToken: s.resetToken + 1,
          history: [{ id: ++entrySeq, label: 'New project', at: Date.now(), snap }],
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
    setPieceColor: (pieceColor) => {
      remember(PIECE_COLOR_KEY, pieceColor)
      set({ pieceColor })
    },
    setMarbleColor: (marbleColor) => {
      remember(MARBLE_COLOR_KEY, marbleColor)
      set({ marbleColor })
    },
    setShading: (shading) => {
      remember(SHADING_KEY, shading)
      set({ shading })
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
    toggleRunning: () => set((s) => ({ running: !s.running })),
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

    addPiece: () => {
      const prev = get().pieces.at(-1)
      const piece = makePiece(prev ? { length: prev.length, slope: prev.slope } : {})
      commit(`Add ${PART_LABEL[piece.type]}`, (s) => ({
        pieces: [...s.pieces, piece],
        selectedId: piece.id,
      }))
    },
    // The copy lands right after its original and takes over the selection.
    duplicatePiece: (id) =>
      commit(`Duplicate ${nameOf(get(), id)}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        if (i < 0) return null
        const { id: _id, ...rest } = s.pieces[i]
        const copy = makePiece(rest)
        const pieces = s.pieces.slice()
        pieces.splice(i + 1, 0, copy)
        return { pieces, selectedId: copy.id }
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
          const piece = cur.pieces.find((p) => p.id === id)
          // Slider and drag traffic repeats the value it already has \u2014 not a step.
          if (!piece || Object.entries(patch).every(([k, v]) => piece[k as keyof Piece] === v)) {
            return null
          }
          return { pieces: cur.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
        },
        // Held-down drags of the same field on the same part fold into one step.
        `piece:${id}:${Object.keys(patch).sort().join(',')}`,
      )
    },
    removePiece: (id) =>
      commit(`Delete ${nameOf(get(), id)}`, (s) =>
        s.pieces.some((p) => p.id === id)
          ? {
              pieces: s.pieces.filter((p) => p.id !== id),
              selectedId: s.selectedId === id ? null : s.selectedId,
            }
          : null,
      ),
    movePiece: (id, dir) =>
      commit(`Move ${nameOf(get(), id)} ${dir < 0 ? 'up' : 'down'}`, (s) => {
        const i = s.pieces.findIndex((p) => p.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= s.pieces.length) return null
        const pieces = s.pieces.slice()
        ;[pieces[i], pieces[j]] = [pieces[j], pieces[i]]
        return { pieces }
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
