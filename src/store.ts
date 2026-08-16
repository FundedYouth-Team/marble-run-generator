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

const THEME_KEY = 'mrg.theme'
const PIECE_COLOR_KEY = 'mrg.pieceColor'
const MARBLE_COLOR_KEY = 'mrg.marbleColor'
const SHADING_KEY = 'mrg.shading'

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

interface RunState {
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

  addPiece: () => void
  renamePiece: (id: string, name: string) => void
  togglePieceHidden: (id: string) => void
  showAllPieces: () => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  removePiece: (id: string) => void
  movePiece: (id: string, dir: -1 | 1) => void
  select: (id: string | null) => void
}

export const useRun = create<RunState>((set, get) => ({
  // 3D is where a run is built; the 2D draft is for working a single part.
  mode: '3d',
  draftView: 'elevation',
  theme: initialTheme(),

  // Sized for a standard glass marble out of the box.
  innerDiameter: STANDARD_BORE,
  wallThickness: 3,
  variant: 'threequarter',

  pieces: [makePiece({ length: 140, slope: 8 })],
  selectedId: null,

  pieceColor: initialColor(PIECE_COLOR_KEY, DEFAULT_PIECE_COLOR),
  marbleColor: initialColor(MARBLE_COLOR_KEY, DEFAULT_MARBLE_COLOR),
  shading: initialShading(),

  marbleDiameter: STANDARD_MARBLE,
  running: false,
  loop: true,
  timeScale: 1,
  friction: 0.06,
  resetToken: 0,
  exportFormat: '3mf',

  setMode: (mode) => set({ mode }),
  setDraftView: (draftView) => set({ draftView }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light'
      applyTheme(theme)
      return { theme }
    }),
  setInnerDiameter: (innerDiameter) =>
    set((s) => ({
      innerDiameter,
      // Keep the marble inside the bore.
      marbleDiameter: Math.min(s.marbleDiameter, innerDiameter - 2),
    })),
  setWallThickness: (wallThickness) => set({ wallThickness }),
  setVariant: (variant) => set({ variant }),
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
  setMarbleDiameter: (marbleDiameter) => set({ marbleDiameter }),
  // Bore and marble move together, so the fit is right whatever they were scaled to.
  resetMarbleFit: () => set({ marbleDiameter: STANDARD_MARBLE, innerDiameter: STANDARD_BORE }),
  setTimeScale: (timeScale) => set({ timeScale }),
  setFriction: (friction) => set({ friction }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setLoop: (loop) => set({ loop }),
  resetSim: () => set((s) => ({ resetToken: s.resetToken + 1 })),
  setExportFormat: (exportFormat) => set({ exportFormat }),

  addPiece: () => {
    const prev = get().pieces.at(-1)
    const piece = makePiece(prev ? { length: prev.length, slope: prev.slope } : {})
    set((s) => ({ pieces: [...s.pieces, piece], selectedId: piece.id }))
  },
  // A blank name is stored as none at all, so the part falls back to its default label.
  renamePiece: (id, name) =>
    set((s) => ({
      pieces: s.pieces.map((p) => (p.id === id ? { ...p, name: name.trim() ? name : undefined } : p)),
    })),
  // Visibility is a view filter only — a hidden piece still positions the ones after it.
  togglePieceHidden: (id) =>
    set((s) => ({
      pieces: s.pieces.map((p) => (p.id === id ? { ...p, hidden: !p.hidden } : p)),
    })),
  showAllPieces: () =>
    set((s) => ({ pieces: s.pieces.map((p) => (p.hidden ? { ...p, hidden: false } : p)) })),
  updatePiece: (id, patch) =>
    set((s) => ({ pieces: s.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  removePiece: (id) =>
    set((s) => ({
      pieces: s.pieces.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  movePiece: (id, dir) =>
    set((s) => {
      const i = s.pieces.findIndex((p) => p.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.pieces.length) return s
      const pieces = s.pieces.slice()
      ;[pieces[i], pieces[j]] = [pieces[j], pieces[i]]
      return { ...s, pieces }
    }),
  select: (selectedId) => set({ selectedId }),
}))

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
