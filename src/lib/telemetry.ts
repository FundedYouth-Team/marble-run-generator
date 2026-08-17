/**
 * The two runtime channels between the marble and the controls around the stage.
 * Plain objects rather than store state: both change every frame, and nothing
 * outside the render loop should re-render on them. The toolbar and the scrubber
 * sample them on their own clocks instead.
 */

/** Live readout, posted by the marble each frame. */
export const telemetry = { speed: 0, distance: 0, airborne: false }

/**
 * The scrubber's channel to the marble, both ways: the marble posts where it is
 * every frame, and the slider posts where it should be next.
 */
export const scrub = { s: 0, seek: null as number | null }
