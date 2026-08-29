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

/**
 * One of the three spans of the measuring box, dimensioned on an edge of it.
 *
 * The edge is chosen in the world and projected here, so the figure stays on the
 * box as the camera swings round it — the same arrangement the move figures use,
 * and for the same reason.
 */
export interface SizeSpan {
  /** The span itself, mm. */
  mm: number
  /** Whether both ends are in front of the camera — see {@link MoveMeasure.spanOn}. */
  on: boolean
  /** The edge's two ends, on the glass. */
  a: Point
  b: Point
  /**
   * Square to the edge on the glass, unit length, pointing away from the middle
   * of the box: which side the dimension line is thrown out on, so it never
   * lands back on what it is measuring.
   */
  off: Point
}

/**
 * The measuring box's channel from the stage to the figures drawn over it.
 *
 * A plain object rather than store state, for the reason {@link measure} is one:
 * all three figures are re-projected every frame the camera moves, and the
 * overlay samples that on a clock of its own rather than re-rendering on it.
 */
export interface SizeMeasure {
  /** Whether there is a box to draw at all — the tool is in hand, on something. */
  live: boolean
  /** Across the world's X. */
  width: SizeSpan
  /** Along the world's Z. */
  length: SizeSpan
  /** Up the world's Y. */
  height: SizeSpan
}

const blankSpan = (): SizeSpan => ({
  mm: 0,
  on: false,
  a: { x: 0, y: 0 },
  b: { x: 0, y: 0 },
  off: { x: 0, y: 0 },
})

export const spans: SizeMeasure = {
  live: false,
  width: blankSpan(),
  length: blankSpan(),
  height: blankSpan(),
}

/** The three, in the order they are read out: width, then length, then height. */
export const SPAN_KEYS = ['width', 'length', 'height'] as const
export type SpanKey = (typeof SPAN_KEYS)[number]

/** What each span is called on the figures and in the bar. */
export const SPAN_LABEL: Record<SpanKey, string> = {
  width: 'Width',
  length: 'Length',
  height: 'Height',
}

/**
 * The world axis each span is taken along, said beside the name. Width and
 * length are both "across the plan" and nothing but the axis tells them apart,
 * so the axis travels with the figure rather than being left to be guessed at.
 */
export const SPAN_AXIS: Record<SpanKey, string> = { width: 'X', length: 'Z', height: 'Y' }
