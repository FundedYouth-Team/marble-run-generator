/**
 * The two runtime channels between the marble and the controls around the stage.
 * Plain objects rather than store state: both change every frame, and nothing
 * outside the render loop should re-render on them. The toolbar and the scrubber
 * sample them on their own clocks instead.
 */

/**
 * Live readout, posted by the marble each frame. `stuck` is a marble that has
 * come to a halt on a slope too shallow to start it again — the one outcome a
 * speed of nought cannot be told apart from on its own.
 */
export const telemetry = { speed: 0, distance: 0, airborne: false, stuck: false }

/**
 * The scrubber's channel to the marble, both ways: the marble posts where it is
 * every frame, and the slider posts where it should be next.
 *
 * The marble posts the run it is on as well as its place along it, because it
 * can be caught by a run other than the one it set off down and the slider has
 * to be measuring the right one — how far down that run the marble can actually
 * get is the slider's own sum, off the same layout.
 */
export const scrub = {
  s: 0,
  chain: 0,
  total: 0,
  seek: null as number | null,
}
