import * as THREE from 'three'

/**
 * Three corrections to the transform gizmo behind drei's `TransformControls`.
 *
 * The gizmo itself is good — it is the drag maths we want, and rewriting that to
 * change how three arrows look would be a poor trade. But three of the things it
 * draws read wrong on this stage, and none of them is a prop:
 *
 * 1. **Each arrow points the way its axis goes.** The gizmo mirrors any handle
 *    whose name carries an axis letter onto whichever side of the origin faces
 *    the camera, so the handle is never behind the model. That leaves the red
 *    arrow pointing down -X while red still *means* +X — and it silently swaps
 *    ends as the camera crosses the axis. On a stage where the run is built to a
 *    coordinate system, an arrow that does not point along its own axis is worse
 *    than one that is sometimes behind the tube; the gizmo draws with the depth
 *    test off, so it stays visible either way.
 * 2. **The axis in hand keeps its colour.** The gizmo washes the picked handle
 *    halfway to white and fades the other two to a quarter opacity, so grabbing
 *    the red arrow turns it pink. Here the picked axis stays its own colour at
 *    full strength and the others only fade — the colour is how you tell which
 *    axis you have.
 * 3. **The drag guide line sits beside the axis, not on it.** The gizmo draws a
 *    long white line straight down the axis being dragged, through the model and
 *    under the arrow, where it reads as part of the arrow rather than as a guide.
 *    It is thrown to one side instead, square to the axis on screen.
 *
 * All three are applied by wrapping the gizmo's own `updateMatrixWorld`, which is
 * where it makes these decisions, once per frame.
 */

/** How far the guide line is thrown to the side, in gizmo handle widths. */
const GUIDE_OFFSET = 0.45

/** What the axes not in hand fade to. The gizmo's own figure is 0.25. */
const IDLE_OPACITY = 0.45

/**
 * Below this a handle has been squashed to nothing rather than scaled — the
 * gizmo's way of hiding an axis being looked straight down, or a plane turned
 * edge-on. Those calls are left alone; only the mirroring is undone.
 */
const SQUASHED = 1e-12

/** Above this the guide line is clearly sloped on screen, so "below it" means something. */
const SLOPED = 0.2

/** The guide lines the move handle draws are named for the axis they run down. */
const AXIS_NAMES = ['X', 'Y', 'Z']

/**
 * What this module reaches for on the gizmo. Written out here rather than
 * imported: the class belongs to three-stdlib, which is drei's dependency and
 * not ours, so there is nothing to import it from.
 */
interface GizmoMaterial extends THREE.Material {
  color?: THREE.Color
  /** The gizmo's own record of the colour and opacity a handle started with. */
  tempColor?: THREE.Color
  tempOpacity?: number
}

interface GizmoHandle extends THREE.Object3D {
  /** `fwd` and `bwd` are the two arrowheads on an axis; `helper` is a guide. */
  tag?: string
  material?: GizmoMaterial
}

export interface GizmoControls extends THREE.Object3D {
  /** The handle under the pointer or in hand — `X`, `XY`, `XYZ` — or null. */
  axis: string | null
  /** Unit vector from the gizmo towards the camera. */
  eye: THREE.Vector3
  camera: THREE.Camera
  gizmo: THREE.Object3D & { updateMatrixWorld: (force?: boolean) => void }
}

const side = new THREE.Vector3()
const axisDir = new THREE.Vector3()
const camUp = new THREE.Vector3()
const camRight = new THREE.Vector3()

/** Whether a handle is the one the pointer is on: `XY` lights its `X` and `Y` too. */
function inHand(name: string, axis: string): boolean {
  return name === axis || (name.length === 1 && axis.includes(name))
}

function restyle(controls: GizmoControls) {
  const axis = controls.axis
  controls.gizmo.traverse((object) => {
    const handle = object as GizmoHandle
    const material = handle.material
    if (!material) return

    // 1. Unmirror. Nothing about a gizmo wants a negative scale, so the sign is
    //    the mirroring and nothing else; with it gone, the outward arrowhead is
    //    the one to show.
    handle.scale.set(
      Math.abs(handle.scale.x),
      Math.abs(handle.scale.y),
      Math.abs(handle.scale.z),
    )
    if (handle.scale.lengthSq() > SQUASHED) {
      if (handle.tag === 'fwd') handle.visible = true
      else if (handle.tag === 'bwd') handle.visible = false
    }

    // 2. Colour. The gizmo stashes what each handle started as on the first
    //    frame, which is what both of these put back.
    if (material.tempColor && material.color) material.color.copy(material.tempColor)
    if (material.tempOpacity !== undefined) material.opacity = material.tempOpacity
    // A guide is only drawn when it is wanted, so it is never the dim one.
    if (axis && handle.tag !== 'helper') {
      if (inHand(handle.name, axis)) material.opacity = 1
      else material.opacity *= IDLE_OPACITY
    }

    // 3. The guide line, off to one side. Everything else the gizmo puts on the
    //    axis belongs there; this is the one thing that is only a reference.
    //    The rotate handle's own guide (named `AXIS`) is left where it is: that
    //    one is the axis being turned about, so beside it would be a lie.
    if (handle.tag === 'helper' && handle.visible && AXIS_NAMES.includes(handle.name)) {
      // The line the gizmo draws for an axis is named for it; which way that
      // points is the handle's own rotation, which is the run's in local space
      // and nothing at all in world space.
      axisDir
        .set(handle.name === 'X' ? 1 : 0, handle.name === 'Y' ? 1 : 0, handle.name === 'Z' ? 1 : 0)
        .applyQuaternion(handle.quaternion)
      // Square to both the axis and the line of sight, which on screen is square
      // to the line: the offset reads as beside it from wherever you are looking.
      side.copy(axisDir).cross(controls.eye)
      if (side.lengthSq() > 1e-6) {
        side.normalize()
        camUp.set(0, 1, 0).applyQuaternion(controls.camera.quaternion)
        camRight.set(1, 0, 0).applyQuaternion(controls.camera.quaternion)
        // Thrown to the high side where there is one: the workplane is below and
        // the run stands on it, so up is the side that is usually clear. A line
        // already square up the screen has no high side, so those go to the right
        // instead. Either way it is the same side every frame, which is what
        // stops it flicking over as the camera swings.
        const bias = side.dot(camUp)
        if (Math.abs(bias) > SLOPED ? bias < 0 : side.dot(camRight) < 0) side.negate()
        handle.position.addScaledVector(side, GUIDE_OFFSET * Math.abs(handle.scale.y))
      }
    }
  })
}

/**
 * Applies the corrections above for as long as the gizmo is on stage, and hands
 * back the undo.
 *
 * The gizmo works its handles out and bakes their matrices in the one call, so
 * there is nowhere to stand in the middle of it: the corrections are made after
 * it has finished and the matrices are then baked a second time from the values
 * it was left with. Two bakes of a dozen objects a frame is nothing, and it
 * keeps every one of the gizmo's own judgements — which axis is edge-on, which
 * plane is turned away — as it made them.
 */
export function tidyGizmo(controls: GizmoControls): () => void {
  const gizmo = controls.gizmo
  const original = gizmo.updateMatrixWorld
  gizmo.updateMatrixWorld = (force?: boolean) => {
    original(force)
    restyle(controls)
    THREE.Object3D.prototype.updateMatrixWorld.call(gizmo, true)
  }
  return () => {
    gizmo.updateMatrixWorld = original
  }
}
