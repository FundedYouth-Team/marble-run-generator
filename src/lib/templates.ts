import { UNTITLED_PROJECT, type LoadedProject } from '../store'
import { buildAssembly } from './layout'
import { PROJECT_FORMAT, parseProject } from './project'

/**
 * The templates shelf: whatever runs are sitting in the `templates` directory at
 * the root of the project.
 *
 * There is nothing built in. A template is a saved project — the very file Save
 * writes — dropped into that directory, optionally with a picture beside it
 * under the same name. Nothing else about it is written down: what the run is
 * called and what it says about itself are read out of the file, and how long it
 * is, how far it falls and how much bed it stands on are measured off the run
 * itself when the library opens.
 *
 * Both are picked up at build time, so adding a template is adding a file — the
 * dev server notices a new one on its own, and a production build carries
 * whatever was in the directory when it was built.
 */

/** Where the runs live, relative to the root of the project. */
export const TEMPLATE_DIR = 'templates'

/** What a picture beside a run may be saved as. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']

/**
 * One run off the shelf, before it has been read properly. The name and the
 * blurb are pulled straight out of the file so a card can be drawn without
 * walking the geometry; everything with a measurement in it waits for
 * {@link buildTemplate}.
 */
export interface Template {
  /** The file's own name, without the extension — unique within the directory. */
  id: string
  /** The file it came from, for anything that has to be said about it. */
  file: string
  /** What the run is called: its project name, or the filename if it has none. */
  name: string
  /** One line about the run, if the file carries a `description`. */
  blurb?: string
  /** The picture sitting beside it, if there is one. */
  image?: string
  /**
   * Why the file could not be read, for the files that could not be. A template
   * that is broken is still shown — a file dropped in the directory and then
   * silently ignored is worse than one that says what is wrong with it.
   */
  error?: string
  /** The file's contents, held for {@link buildTemplate}. */
  text: string
}

/** A template read in and measured: the run itself, and the figures its card reads out. */
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

/** `templates/first-run.mrun.json` → `first-run`. */
function idOf(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.mrun\.json$/i, '').replace(/\.json$/i, '')
}

/** `first-run` → `First Run`, for a file whose project has no name of its own. */
function titleOf(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The runs and the pictures beside them, as they were when the app was built.
 *
 * Read as text rather than imported as JSON so the file goes through the same
 * reader an opened project does — a template is a project file, and one with an
 * odd value in it should be repaired on the way in rather than crash the shelf.
 */
const FILES = import.meta.glob('/templates/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const IMAGES = import.meta.glob('/templates/*.{png,jpg,jpeg,webp,gif,svg,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** The pictures filed under the name of the run they belong to. */
const IMAGE_BY_ID: Record<string, string> = {}
for (const [path, url] of Object.entries(IMAGES)) {
  const file = path.slice(path.lastIndexOf('/') + 1)
  const cut = file.lastIndexOf('.')
  const ext = file.slice(cut + 1).toLowerCase()
  if (IMAGE_EXTENSIONS.includes(ext)) IMAGE_BY_ID[file.slice(0, cut)] = url
}

/**
 * What can be told about a file without walking the run in it: what it is
 * called, and whatever it says about itself.
 *
 * `description` is the one field a template may carry that a saved project does
 * not — write it in by hand and the card reads it out. Everything else about the
 * card is either the run's own name or measured off the run.
 */
function describe(id: string, file: string, text: string): Template {
  const base: Template = { id, file, name: titleOf(id), image: IMAGE_BY_ID[id], text }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ...base, error: 'That file is not JSON.' }
  }
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.format !== PROJECT_FORMAT) {
    return { ...base, error: 'That is not a Marble Run Generator project file.' }
  }

  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : ''
  const blurb = typeof o.description === 'string' ? o.description.trim().slice(0, 200) : ''
  return {
    ...base,
    // A file saved without ever being named carries the placeholder rather than
    // nothing, and the filename is the better answer than "Untitled run".
    ...(name && name !== UNTITLED_PROJECT ? { name } : {}),
    ...(blurb ? { blurb } : {}),
  }
}

/**
 * Everything in the directory, in the order the names sort. Sorted rather than
 * left in whatever order the glob came back in, so the shelf does not reshuffle
 * itself between builds.
 */
export const TEMPLATES: Template[] = Object.entries(FILES)
  .map(([path, text]) => describe(idOf(path), path.slice(path.lastIndexOf('/') + 1), text))
  .sort((a, b) => a.name.localeCompare(b.name))

/**
 * A template read in and measured, ready for the stage.
 *
 * The run arrives exactly as it was saved — every part where it was left, in the
 * tube it was cut from. A template is somebody's own run rather than a recipe,
 * so nothing here re-stands it or tidies it up.
 *
 * Throws with something worth showing when the file cannot be read at all.
 */
export function buildTemplate(t: Template): TemplateBuild {
  if (t.error) throw new Error(t.error)
  const project = parseProject(t.text)

  const outerR = project.innerDiameter / 2 + project.wallThickness
  const asm = buildAssembly(project.pieces)
  const box = asm.bounds

  return {
    project,
    parts: project.pieces.length,
    length: asm.totalLength,
    drop: box.max.y - box.min.y,
    width: box.max.x - box.min.x + outerR * 2,
    depth: box.max.z - box.min.z + outerR * 2,
  }
}
