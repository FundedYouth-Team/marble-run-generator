import * as THREE from 'three'
import { zipSync, strToU8 } from 'fflate'

/**
 * A minimal 3MF (core spec) writer. three.js ships a 3MF *loader* but no
 * exporter, so this builds the OPC package by hand.
 *
 * Two things 3MF gives us that STL cannot:
 *  - `unit="millimeter"` is declared in the file, so no importer has to guess.
 *  - Objects are instanced: pieces sharing a geometry are stored once and
 *    referenced by the build items with their own transforms.
 */

const MODEL_PATH = '3D/3dmodel.model'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Target="/${MODEL_PATH}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

/** Compact fixed-point formatting — 3MF disallows exponent notation. */
function num(v: number) {
  let s = v.toFixed(5)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' || s === '' ? '0' : s
}

/**
 * Merges coincident vertices. The render meshes duplicate vertices along every
 * profile edge so normals stay crisp; 3MF wants a connected, manifold mesh.
 */
function weld(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const lookup = new Map<string, number>()
  const vertices: number[] = []
  const remap = new Uint32Array(position.count)

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`
    let id = lookup.get(key)
    if (id === undefined) {
      id = vertices.length / 3
      lookup.set(key, id)
      vertices.push(x, y, z)
    }
    remap[i] = id
  }

  const triangles: number[] = []
  const count = index ? index.count : position.count
  for (let i = 0; i < count; i += 3) {
    const a = remap[index ? index.getX(i) : i]
    const b = remap[index ? index.getX(i + 1) : i + 1]
    const c = remap[index ? index.getX(i + 2) : i + 2]
    if (a === b || b === c || a === c) continue
    triangles.push(a, b, c)
  }

  return { vertices, triangles }
}

/**
 * three.js matrices are column-major and multiply column vectors; 3MF stores a
 * 4x3 row-major matrix that multiplies row vectors. So each 3MF row is one
 * three.js basis column.
 */
function transformAttr(m: THREE.Matrix4) {
  const e = m.elements
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]]
    .map(num)
    .join(' ')
}

export interface ThreeMFStats {
  data: Uint8Array
  /** Distinct geometries stored. */
  objects: number
  /** Build items referencing them. */
  items: number
  triangles: number
}

export function buildThreeMF(root: THREE.Object3D, application: string): ThreeMFStats {
  root.updateMatrixWorld(true)

  const ids = new Map<string, number>()
  const objects: string[] = []
  const items: string[] = []
  let triangles = 0
  let nextId = 1

  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    let id = ids.get(mesh.geometry.uuid)
    if (id === undefined) {
      id = nextId++
      ids.set(mesh.geometry.uuid, id)

      const { vertices, triangles: tris } = weld(mesh.geometry)
      const v: string[] = []
      for (let i = 0; i < vertices.length; i += 3) {
        v.push(
          `          <vertex x="${num(vertices[i])}" y="${num(vertices[i + 1])}" z="${num(vertices[i + 2])}"/>`,
        )
      }
      const t: string[] = []
      for (let i = 0; i < tris.length; i += 3) {
        t.push(`          <triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`)
      }

      objects.push(
        `    <object id="${id}" type="model">\n` +
          `      <mesh>\n` +
          `        <vertices>\n${v.join('\n')}\n        </vertices>\n` +
          `        <triangles>\n${t.join('\n')}\n        </triangles>\n` +
          `      </mesh>\n` +
          `    </object>`,
      )
    }

    // Every instance counts toward the printed total, not just unique meshes.
    const geometryIndex = mesh.geometry.getIndex()
    triangles += geometryIndex
      ? geometryIndex.count / 3
      : mesh.geometry.getAttribute('position').count / 3

    items.push(`    <item objectid="${id}" transform="${transformAttr(mesh.matrixWorld)}"/>`)
  })

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
    `  <metadata name="Application">${application}</metadata>\n` +
    `  <resources>\n${objects.join('\n')}\n  </resources>\n` +
    `  <build>\n${items.join('\n')}\n  </build>\n` +
    `</model>\n`

  const data = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      [MODEL_PATH]: strToU8(model),
    },
    { level: 6 },
  )

  return { data, objects: objects.length, items: items.length, triangles }
}
