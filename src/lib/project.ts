import {
  PIECE_LIMITS,
  TUBE_LIMITS,
  UNTITLED_PROJECT,
  VARIANT_LABEL,
  makePiece,
  projectSlug,
  type LoadedProject,
  type Piece,
  type TubeVariant,
} from '../store'

/**
 * Saving and opening a run as a plain JSON file. This is the project itself —
 * the parts and the tube they are cut from — rather than the meshes the Export
 * panel writes, so a saved file can be opened again and carried on with.
 */

/** Stamped into every file so a stray JSON is told apart from one of ours. */
export const PROJECT_FORMAT = 'marble-run-generator'
/** Bumped only when the shape below changes in a way older readers can't take. */
export const PROJECT_VERSION = 1

/** Double-barrelled so a saved run reads as a project, not as loose data. */
export const PROJECT_EXT = '.mrun.json'

/** What a saved file holds. Everything else is a preference or a view, not the run. */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  savedAt: string
  name: string
  innerDiameter: number
  wallThickness: number
  variant: TubeVariant
  marbleDiameter: number
  pieces: Array<Omit<Piece, 'id'>>
}

/** The part of the store a save covers — the model, under its name. */
export type ProjectSource = LoadedProject

export function serialiseProject(s: ProjectSource): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    name: s.projectName.trim() || UNTITLED_PROJECT,
    innerDiameter: s.innerDiameter,
    wallThickness: s.wallThickness,
    variant: s.variant,
    marbleDiameter: s.marbleDiameter,
    // Ids are internal handles — they are minted fresh on the way back in.
    pieces: s.pieces.map(({ id: _id, ...rest }) => rest),
  }
  // Indented, because a run someone keeps is a file they may well open and read.
  return JSON.stringify(file, null, 2)
}

/** Writes the run to the user's downloads and reports what it was called. */
export function saveProjectFile(s: ProjectSource): string {
  const filename = `${projectSlug(s.projectName)}${PROJECT_EXT}`
  const blob = new Blob([serialiseProject(s)], { type: 'application/json' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on a delay so the download has picked the blob up.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)

  return filename
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** A finite number within range, or the fallback — hand-edited files miss both. */
function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback
}

function isVariant(v: unknown): v is TubeVariant {
  return typeof v === 'string' && v in VARIANT_LABEL
}

/**
 * A saved part, made safe to load: anything missing or out of range falls back
 * to what a new part would have used, so a hand-edited file still opens.
 */
function readPiece(raw: unknown): Piece {
  const o = (raw ?? {}) as Record<string, unknown>
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 60) : undefined
  return makePiece({
    type: 'straight',
    ...(name ? { name } : {}),
    length: num(o.length, PIECE_LIMITS.length.min, PIECE_LIMITS.length.max, 120),
    slope: num(o.slope, PIECE_LIMITS.slope.min, PIECE_LIMITS.slope.max, 6),
    turn: num(o.turn, PIECE_LIMITS.turn.min, PIECE_LIMITS.turn.max, 0),
    ...(o.hidden === true ? { hidden: true } : {}),
  })
}

/**
 * Reads a saved run back. Throws with something worth showing the user when
 * the file is not one of ours; past that it repairs rather than refuses, since
 * a run with one odd value in it is still the run they wanted back.
 */
export function parseProject(text: string): LoadedProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not JSON.')
  }

  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.format !== PROJECT_FORMAT) {
    throw new Error('That is not a Marble Run Generator project file.')
  }
  if (typeof o.version === 'number' && o.version > PROJECT_VERSION) {
    throw new Error('That project was saved by a newer version of the app.')
  }
  if (!Array.isArray(o.pieces) || o.pieces.length === 0) {
    throw new Error('That project file has no parts in it.')
  }

  const innerDiameter = num(
    o.innerDiameter,
    TUBE_LIMITS.innerDiameter.min,
    TUBE_LIMITS.innerDiameter.max,
    20,
  )
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : ''

  return {
    projectName: name || UNTITLED_PROJECT,
    innerDiameter,
    wallThickness: num(
      o.wallThickness,
      TUBE_LIMITS.wallThickness.min,
      TUBE_LIMITS.wallThickness.max,
      3,
    ),
    variant: isVariant(o.variant) ? o.variant : 'threequarter',
    // The marble has to stay inside whatever bore the file arrived with.
    marbleDiameter: num(o.marbleDiameter, 4, Math.max(4, innerDiameter - 1), 16),
    pieces: o.pieces.map(readPiece),
  }
}

/** Reads a picked file and hands back the run inside it. */
export async function readProjectFile(file: File): Promise<LoadedProject> {
  return parseProject(await file.text())
}
