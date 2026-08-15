import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { buildPieceGeometry } from './geometry'
import { buildThreeMF } from './threemf'
import type { PlacedPiece } from './layout'
import type { TubeSpec } from '../store'

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

function geometryCache(spec: TubeSpec) {
  const cache = new Map<number, THREE.BufferGeometry>()
  return {
    get(length: number) {
      let g = cache.get(length)
      if (!g) {
        g = buildPieceGeometry(spec, length)
        cache.set(length, g)
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

const slug = (spec: TubeSpec) => `id${spec.innerR * 2}-w${spec.wall}-${spec.variant}`

/** The whole run, assembled exactly as designed. */
export function exportAssembly(
  spec: TubeSpec,
  placed: PlacedPiece[],
  format: ExportFormat,
): ExportResult {
  const cache = geometryCache(spec)
  const inner = new THREE.Group()

  for (const p of placed) {
    const mesh = new THREE.Mesh(cache.get(p.piece.length))
    mesh.position.copy(p.start)
    mesh.quaternion.copy(p.quaternion)
    inner.add(mesh)
  }

  const group = new THREE.Group()
  group.add(inner)
  inner.applyMatrix4(Y_TO_Z)
  seatOnPlate(group)

  const result = write(group, `marble-run-assembly-${slug(spec)}`, format)
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
): ExportResult {
  const cache = geometryCache(spec)
  const group = new THREE.Group()
  const pitch = spec.outerR * 2 + PLATE_GAP

  // Longest first, so the plate reads tidily.
  const lengths = placed.map((p) => p.piece.length).sort((a, b) => b - a)
  lengths.forEach((length, i) => {
    const mesh = new THREE.Mesh(cache.get(length))
    mesh.applyMatrix4(LAY_FLAT)
    mesh.position.set(0, i * pitch, 0)
    group.add(mesh)
  })

  seatOnPlate(group)
  const result = write(group, `marble-run-plate-${lengths.length}pc-${slug(spec)}`, format)
  cache.dispose()
  return result
}

/** A single piece, laid flat at the origin. */
export function exportPiece(
  spec: TubeSpec,
  length: number,
  index: number,
  format: ExportFormat,
): ExportResult {
  const geom = buildPieceGeometry(spec, length)
  const mesh = new THREE.Mesh(geom)
  mesh.applyMatrix4(LAY_FLAT)

  const group = new THREE.Group()
  group.add(mesh)
  seatOnPlate(group)

  const name = `marble-run-piece${String(index + 1).padStart(2, '0')}-${length}mm-${slug(spec)}`
  const result = write(group, name, format)
  geom.dispose()
  return result
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
