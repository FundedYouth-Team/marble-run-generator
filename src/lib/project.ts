import {
  ANGLE_DEFAULTS,
  CORNER_DEFAULTS,
  PART_LABEL,
  PIECE_LIMITS,
  TUBE_LIMITS,
  UNTITLED_PROJECT,
  VARIANT_LABEL,
  isHexColor,
  makePiece,
  projectSlug,
  type LoadedProject,
  type Piece,
  type Placement,
  type PieceType,
  type TubeVariant,
} from '../store'

/**
 * Saving and opening a run as a plain JSON file. This is the project itself —
 * the parts and the tube they are cut from — rather than the meshes the Export
 * panel writes, so a saved file can be opened again and carried on with.
 */

/** Stamped into every file so a stray JSON is told apart from one of ours. */
export const PROJECT_FORMAT = 'marble-run-generator'
/**
 * Bumped only when the shape below changes in a way older readers can't take.
 * v2 added part types: a v1 reader would silently turn every angle connector
 * into a straight tube, so it is told to stay out rather than mangle the run.
 * v3 gave each part its own tube style, which a v2 reader would drop — every
 * part would come back in the run's one style.
 * Per-part colour rides along inside v3 without a bump: an older reader ignores
 * it and draws the run in one colour, which is only how it always looked and
 * never touches the parts themselves.
 * v4 added the corner connector, which a v3 reader would turn into a straight
 * tube — the run would come back with its turns missing.
 * v5 gave each part a joint of its own and a place to stand: parts are only in
 * the same run if they are joined together. A v4 reader chains every part
 * head-to-tail, so it would weld separate runs into one and lose wherever they
 * were standing. Read the other way round, a file from v4 or earlier has no
 * joints in it and every part in it was welded to the one before, which is what
 * {@link parseProject} puts back.
 * v6 gave each part its own bore and wall. A v5 reader drops them and cuts every
 * part to the run's tube, so a run built from more than one size would come back
 * the wrong size — parts that were never meant to mate would look as though they
 * did.
 */
export const PROJECT_VERSION = 6

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
  /** The run's style — what a part with none of its own is cut in. */
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

/**
 * A number that is really in range, rather than one clamped into it. Used where
 * the field is optional and following the run is the better answer than pinning
 * a part to the nearest legal size.
 */
function inRange(v: unknown, limits: { min: number; max: number }): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= limits.min && v <= limits.max
}

function isVariant(v: unknown): v is TubeVariant {
  return typeof v === 'string' && v in VARIANT_LABEL
}

function isType(v: unknown): v is PieceType {
  return typeof v === 'string' && v in PART_LABEL
}

/** How far from the origin a part may be stood down, mm — past this it is junk. */
const PLACEMENT_LIMIT = 100_000

/**
 * Where a saved part was standing. Anything missing or unreadable puts it on the
 * origin, which is where a part with no placement of its own stands anyway.
 */
function readPlacement(raw: unknown): Placement | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  return {
    x: num(o.x, -PLACEMENT_LIMIT, PLACEMENT_LIMIT, 0),
    y: num(o.y, -PLACEMENT_LIMIT, PLACEMENT_LIMIT, 0),
    z: num(o.z, -PLACEMENT_LIMIT, PLACEMENT_LIMIT, 0),
    yaw: num(o.yaw, -360, 360, 0),
  }
}

/**
 * A saved part, made safe to load: anything missing or out of range falls back
 * to what a new part would have used, so a hand-edited file still opens. A file
 * from before part types had been added has no `type` at all, and every part in
 * it was a straight tube. `joined` is passed in rather than trusted, so a file
 * written before joints existed comes back as the one welded run it was.
 */
function readPiece(raw: unknown, joined: boolean): Piece {
  const o = (raw ?? {}) as Record<string, unknown>
  const at = joined ? undefined : readPlacement(o.at)
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 60) : undefined
  const type: PieceType = isType(o.type) ? o.type : 'straight'
  return makePiece({
    type,
    ...(name ? { name } : {}),
    length: num(
      o.length,
      PIECE_LIMITS.length.min,
      PIECE_LIMITS.length.max,
      type === 'angle' ? ANGLE_DEFAULTS.length : type === 'corner' ? CORNER_DEFAULTS.length : 120,
    ),
    slope: num(o.slope, PIECE_LIMITS.slope.min, PIECE_LIMITS.slope.max, 6),
    turn: num(o.turn, PIECE_LIMITS.turn.min, PIECE_LIMITS.turn.max, 0),
    // Both connectors are two legs meeting at a break; only which way the break
    // goes — bend for the angle, sweep for the corner — tells them apart.
    ...(type === 'angle'
      ? { bend: num(o.bend, PIECE_LIMITS.bend.min, PIECE_LIMITS.bend.max, ANGLE_DEFAULTS.bend) }
      : {}),
    ...(type === 'corner'
      ? { sweep: num(o.sweep, PIECE_LIMITS.sweep.min, PIECE_LIMITS.sweep.max, CORNER_DEFAULTS.sweep) }
      : {}),
    ...(type === 'angle' || type === 'corner'
      ? {
          exitLength: num(
            o.exitLength,
            PIECE_LIMITS.exitLength.min,
            PIECE_LIMITS.exitLength.max,
            type === 'angle' ? ANGLE_DEFAULTS.exitLength : CORNER_DEFAULTS.exitLength,
          ),
          fillet: num(
            o.fillet,
            PIECE_LIMITS.fillet.min,
            PIECE_LIMITS.fillet.max,
            type === 'angle' ? ANGLE_DEFAULTS.fillet : CORNER_DEFAULTS.fillet,
          ),
        }
      : {}),
    // No style of its own is the normal case — that part follows the run's.
    ...(isVariant(o.variant) ? { variant: o.variant } : {}),
    // Same for colour, and a part painted something unreadable simply follows it too.
    ...(isHexColor(o.color) ? { color: o.color.toLowerCase() } : {}),
    // Bore and wall the same way: only a part that was sized on its own carries
    // one, and an unreadable size drops back to following the run rather than
    // landing the part somewhere it could never be cut.
    ...(inRange(o.innerDiameter, TUBE_LIMITS.innerDiameter)
      ? { innerDiameter: o.innerDiameter as number }
      : {}),
    ...(inRange(o.wallThickness, TUBE_LIMITS.wallThickness)
      ? { wallThickness: o.wallThickness as number }
      : {}),
    ...(o.hidden === true ? { hidden: true } : {}),
    // Bonded onto the part before it, or standing on its own somewhere — never
    // both, so a file that says both is read as the joint it claims.
    ...(joined ? { joined: true } : at ? { at } : {}),
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
  // An empty run is a real one to save and reopen, so only a missing list is wrong.
  if (!Array.isArray(o.pieces)) {
    throw new Error('That project file has no parts list in it.')
  }

  const innerDiameter = num(
    o.innerDiameter,
    TUBE_LIMITS.innerDiameter.min,
    TUBE_LIMITS.innerDiameter.max,
    20,
  )
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : ''
  // Before joints, the parts list *was* the run: every part after the first was
  // welded to the one before it, so that is how a file from back then opens.
  const welded = typeof o.version === 'number' ? o.version < 5 : true

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
    // The first part is never joined to anything: there is nothing ahead of it.
    pieces: o.pieces.map((raw, i) =>
      readPiece(raw, i > 0 && (welded || (raw as Record<string, unknown> | null)?.joined === true)),
    ),
  }
}

/** Reads a picked file and hands back the run inside it. */
export async function readProjectFile(file: File): Promise<LoadedProject> {
  return parseProject(await file.text())
}
