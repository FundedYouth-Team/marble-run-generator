/**
 * The runtime channel between the marble and the controls around the stage. A
 * plain object rather than store state: it changes every frame, and nothing
 * outside the render loop should re-render on it. The toolbar samples it on a
 * clock of its own instead.
 */

/**
 * Live readout, posted by the marble each frame. `stuck` is a marble that has
 * come to a halt on a slope too shallow to start it again — the one outcome a
 * speed of nought cannot be told apart from on its own.
 */
export const telemetry = { speed: 0, distance: 0, airborne: false, stuck: false }
