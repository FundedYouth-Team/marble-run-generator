import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { buildPieceGeometry } from './geometry'
import { centerlineFor, shapeKey } from './centerline'
import { buildThreeMF } from './threemf'
import type { PlacedPiece } from './layout'
import { angleSpec, pieceSpec, type Piece, type TubeSpec } from '../store'

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
 */
function layFlat(piece: Piece): THREE.Matrix4 {
  if (piece.type !== 'angle') return LAY_FLAT
  const half = THREE.MathUtils.degToRad(angleSpec(piece).bend) / 2
  return LAY_FLAT.clone().multiply(new THREE.Matrix4().makeRotationX(-half))
}

/** Gap between parts on the print plate, mm. */
const PLATE_GAP = 5

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
 * `spec` carries the run's bore and wall, and the style a part falls back to
 * when it has none of its own.
 */
function geometryCache(spec: TubeSpec) {
  const cache = new Map<string, THREE.BufferGeometry>()
  return {
    get(piece: Piece) {
      const own = pieceSpec(spec, piece)
      const key = shapeKey(piece, own.variant)
      let g = cache.get(key)
      if (!g) {
        g = buildPieceGeometry(own, centerlineFor(piece))
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
  const pitch = spec.outerR * 2 + PLATE_GAP

  // Longest first, so the plate reads tidily.
  const parts = placed.slice().sort((a, b) => b.length - a.length)
  parts.forEach((p, i) => {
    const mesh = new THREE.Mesh(cache.get(p.piece))
    mesh.applyMatrix4(layFlat(p.piece))
    mesh.position.set(0, i * pitch, 0)
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
  const geom = buildPieceGeometry(pieceSpec(spec, piece), line)
  const mesh = new THREE.Mesh(geom)
  mesh.applyMatrix4(layFlat(piece))

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
