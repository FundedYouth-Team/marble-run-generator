import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { buildPartGeometry } from './geometry'
import { centerlineFor, shapeKey } from './centerline'
import { buildThreeMF } from './threemf'
import type { PlacedPiece } from './layout'
import {
  OPEN_SIDE_ANGLE,
  angleSpec,
  baseSpec,
  pieceSpec,
  supportSpec,
  type Piece,
  type TubeSpec,
} from '../store'

/**
 * All three formats are written at 1 unit = 1 mm, which is already this app's
 * working unit, so nothing is scaled on export. Only 3MF records that unit in
 * the file; STL and OBJ are unitless and rely on the importer assuming mm.
 *
 * The app's world is Y-up (three.js); slicers are Z-up. Every export path
 * rotates into Z-up and drops the result onto the build plate at z = 0.
 */

export type ExportFormat = 'stl' | '3mf' | 'obj'

export const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  {
    id: 'stl',
    label: 'STL',
    note: 'Binary STL. Universally supported, unitless — importers assume mm.',
  },
  {
    id: '3mf',
    label: '3MF',
    note: 'Compressed, records millimetres in the file, and stores repeated pieces once as instances. Best choice if your slicer takes it.',
  },
  {
    id: 'obj',
    label: 'OBJ',
    note: 'Text OBJ with normals. Handy for mesh editors; unitless, and larger than the other two.',
  },
]

const APP = 'Marble Run Generator'

const MIME: Record<ExportFormat, string> = {
  stl: 'model/stl',
  '3mf': 'model/3mf',
  obj: 'model/obj',
}

/** Y-up → Z-up. */
const Y_TO_Z = new THREE.Matrix4().makeRotationX(Math.PI / 2)

/** Piece-local (Z = axis, Y = opening) → axis along +X, opening up +Z. */
const LAY_FLAT = new THREE.Matrix4()
  .makeRotationX(Math.PI / 2)
  .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))

/**
 * How a part is laid on the print plate: opening upward, which needs no support
 * for the half and 3/4 variants. A bent part still arches — its opening has to
 * follow the bend — so it is tipped back by half its bend first, which sits
 * both legs the same height off the plate instead of standing one of them up.
 *
 * A part cut open on its side is rolled about its own axis until that side is
 * the one facing up, which is the whole point of the setting for printing: the
 * slot still wants to be the face that needs no support. The roll goes on
 * *outside* the tip, so a bend is squared up in its own plane first and the
 * whole arch is then rolled — which for a part opened onto its side stands that
 * arch on edge, exactly as it has to be for the slot to look at the ceiling.
 *
 * A funnel is the one part not rolled: it prints mouth-up or not at all, and its
 * mouth is not the opening this setting names. Standing the part's own up axis
 * on the plate is what {@link LAY_FLAT} already does — a funnel is fed dead
 * level, so its own up axis and the world's are the same one.
 */
function layFlat(piece: Piece, own: TubeSpec): THREE.Matrix4 {
  // A base is already lying the way it prints: flat on its own underside, with
  // nothing overhanging and no opening to point anywhere. All it wants is the
  // turn from this app's Y-up world into the slicer's Z-up one, which is the
  // very same turn the assembly export gives the whole stage.
  if (piece.type === 'base') return Y_TO_Z.clone()
  // A rod is laid down flat, exactly as a length of tube is and by the same
  // turn: on its side along the plate, where it is a bar with no overhang
  // anywhere in it whatever line it was struck along in the world. It takes no
  // roll — a bar has no opening to point anywhere — and no tip, having no bend.
  if (piece.type === 'support') return LAY_FLAT.clone()
  const roll = own.closed || piece.type === 'funnel' ? 0 : OPEN_SIDE_ANGLE[own.openSide]
  const m = roll === 0 ? LAY_FLAT.clone() : LAY_FLAT.clone().multiply(new THREE.Matrix4().makeRotationZ(roll))
  if (piece.type !== 'angle') return m
  const half = THREE.MathUtils.degToRad(angleSpec(piece).bend) / 2
  return m.multiply(new THREE.Matrix4().makeRotationX(-half))
}

/** Gap between parts on the print plate, mm. */
const PLATE_GAP = 5

/**
 * How far a part reaches either side of the row it is laid in, mm — half its
 * width across the plate, which is what the rows are stepped by.
 *
 * A tube reaches its own outer radius, whichever way its bend arches, because
 * the rows run along the axis it is laid on. A base reaches half its depth: laid
 * flat by {@link layFlat} its own +Z ends up along the row axis, and a plate the
 * width of a table stepped by a tube's radius would land on top of the next four
 * parts.
 */
function plateReach(piece: Piece, own: TubeSpec): number {
  if (piece.type === 'base') return baseSpec(piece).depth / 2
  // A rod lies along the row like a length of tube, so what it reaches across
  // one is its own half thickness.
  if (piece.type === 'support') return supportSpec(piece).width / 2
  return own.outerR
}

export interface ExportResult {
  filename: string
  parts: number
  triangles: number
  bytes: number
  /** 3MF only: distinct geometries stored, when fewer than `parts`. */
  instanced?: number
}

/**
 * One mesh per distinct shape. 3MF instancing keys off geometry identity, so
 * sharing here is also what lets a plate of identical parts store them once.
 * `spec` is the tube the run is cut from — the bore, wall and style a part
 * falls back to when it has none of its own.
 */
function geometryCache(spec: TubeSpec) {
  const cache = new Map<string, THREE.BufferGeometry>()
  return {
    get(piece: Piece) {
      const own = pieceSpec(spec, piece)
      const key = shapeKey(piece, own)
      let g = cache.get(key)
      if (!g) {
        g = buildPartGeometry(own, piece)
        cache.set(key, g)
      }
      return g
    },
    dispose() {
      cache.forEach((g) => g.dispose())
      cache.clear()
    },
  }
}

function countTriangles(root: THREE.Object3D) {
  let n = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const index = mesh.geometry.index
    n += index ? index.count / 3 : mesh.geometry.getAttribute('position').count / 3
  })
  return n
}

/** Sits the group on the build plate and centres it over the origin in x/y. */
function seatOnPlate(group: THREE.Group) {
  group.updateMatrixWorld(true)
  // `precise` walks the vertices — the cheap path unions transformed AABBs,
  // which overshoots badly once pieces are rotated.
  const box = new THREE.Box3().setFromObject(group, true)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  group.position.set(-center.x, -center.y, -box.min.z)
  group.updateMatrixWorld(true)
}

function serialise(group: THREE.Group, format: ExportFormat) {
  if (format === '3mf') {
    const { data, objects, triangles } = buildThreeMF(group, APP)
    return { blob: new Blob([data as BlobPart], { type: MIME['3mf'] }), triangles, instanced: objects }
  }

  const triangles = countTriangles(group)
  if (format === 'obj') {
    const text = new OBJExporter().parse(group)
    return { blob: new Blob([text], { type: MIME.obj }), triangles, instanced: undefined }
  }

  const view = new STLExporter().parse(group, { binary: true })
  const bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  return {
    blob: new Blob([bytes as ArrayBuffer], { type: MIME.stl }),
    triangles,
    instanced: undefined,
  }
}

function write(group: THREE.Group, basename: string, format: ExportFormat): ExportResult {
  group.updateMatrixWorld(true)
  const { blob, triangles, instanced } = serialise(group, format)
  const filename = `${basename}.${format}`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on a delay so the download has picked the blob up.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)

  return { filename, parts: group.children.length, triangles, bytes: blob.size, instanced }
}

/**
 * Every export is named after the project, then after what it is — so a
 * project called "Big Drop" writes `big-drop-plate-4pc.3mf` next to
 * `big-drop-assembly.3mf`.
 */
export function exportAssembly(
  spec: TubeSpec,
  placed: PlacedPiece[],
  format: ExportFormat,
  name: string,
): ExportResult {
  const cache = geometryCache(spec)
  const inner = new THREE.Group()

  for (const p of placed) {
    const mesh = new THREE.Mesh(cache.get(p.piece))
    mesh.position.copy(p.start)
    mesh.quaternion.copy(p.quaternion)
    inner.add(mesh)
  }

  const group = new THREE.Group()
  group.add(inner)
  inner.applyMatrix4(Y_TO_Z)
  seatOnPlate(group)

  const result = write(group, `${name}-assembly`, format)
  cache.dispose()
  return { ...result, parts: placed.length }
}

/**
 * Every piece laid flat and separated, ready to slice. Pieces print
 * opening-upward, which needs no support for the half and 3/4 variants.
 */
export function exportPrintPlate(
  spec: TubeSpec,
  placed: PlacedPiece[],
  format: ExportFormat,
  name: string,
): ExportResult {
  const cache = geometryCache(spec)
  const group = new THREE.Group()

  // Longest first, so the plate reads tidily.
  const parts = placed.slice().sort((a, b) => b.length - a.length)
  // Rows are stepped by the two parts either side of the gap rather than by one
  // pitch, so a part sized on its own still lands clear of its neighbours.
  let y = 0
  let previousR = 0
  parts.forEach((p, i) => {
    const own = pieceSpec(spec, p.piece)
    const r = plateReach(p.piece, own)
    if (i > 0) y += previousR + r + PLATE_GAP
    previousR = r
    const mesh = new THREE.Mesh(cache.get(p.piece))
    mesh.applyMatrix4(layFlat(p.piece, own))
    mesh.position.set(0, y, 0)
    group.add(mesh)
  })

  seatOnPlate(group)
  const result = write(group, `${name}-plate-${parts.length}pc`, format)
  cache.dispose()
  return result
}

/** A single piece, laid flat at the origin. */
export function exportPiece(
  spec: TubeSpec,
  piece: Piece,
  index: number,
  format: ExportFormat,
  name: string,
): ExportResult {
  const line = centerlineFor(piece)
  const own = pieceSpec(spec, piece)
  const geom = buildPartGeometry(own, piece)
  const mesh = new THREE.Mesh(geom)
  mesh.applyMatrix4(layFlat(piece, own))

  const group = new THREE.Group()
  group.add(mesh)
  seatOnPlate(group)

  const basename = `${name}-piece${String(index + 1).padStart(2, '0')}-${Math.round(line.length)}mm`
  const result = write(group, basename, format)
  geom.dispose()
  return result
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
