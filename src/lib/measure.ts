/**
 * The move readout's channel from the stage to the figures drawn over it.
 *
 * A plain object rather than store state, for the same reason the marble's
 * telemetry is one: it is rewritten every frame — the camera alone moves the
 * figures across the glass — and nothing outside the render loop should
 * re-render on that. The overlay samples it on its own clock instead.
 *
 * Screen positions are in canvas pixels, measured from the top-left of the
 * stage, which is what the canvas fills.
 */

export interface Point {
  x: number
  y: number
}

export interface MoveMeasure {
  /** Whether there is anything to draw at all — the arrows are on a part. */
  live: boolean
  /** Whether they are being dragged right now, which is what the travel figure reports. */
  dragging: boolean
  /**
   * Whether the drop line is in front of the camera. Zoomed inside the run,
   * a point behind it projects to a mirrored place on the glass, so what has
   * gone behind is dropped rather than drawn somewhere it is not.
   */
  spanOn: boolean
  /** The same, for the part the arrows are on. */
  anchorOn: boolean
  /** How high the underside of the run stands over the workplane, mm. Negative below it. */
  height: number
  /** How far it has travelled since this drag began, mm, per world axis. */
  travel: { x: number; y: number; z: number }
  /** Foot of the drop line, on the workplane. */
  foot: Point
  /** Its head, on the underside of the run. */
  head: Point
  /** The part the arrows are on — where the travel figure hangs. */
  anchor: Point
}

export const measure: MoveMeasure = {
  live: false,
  dragging: false,
  spanOn: false,
  anchorOn: false,
  height: 0,
  travel: { x: 0, y: 0, z: 0 },
  foot: { x: 0, y: 0 },
  head: { x: 0, y: 0 },
  anchor: { x: 0, y: 0 },
}
