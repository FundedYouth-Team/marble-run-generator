import type { DraftView } from '../store'

/**
 * How the 2D draft lays the world down on the paper, and how a drag on the
 * paper is read back out into the world. One place, because the two have to be
 * exact inverses of each other: a handle dragged to a point must set the angle
 * that puts the drawing back under the pointer.
 */

/** A world direction, as the drawing's own axes are given. */
export type Axis3 = readonly [number, number, number]

export const dot3 = (w: { x: number; y: number; z: number }, a: Axis3) =>
  w.x * a[0] + w.y * a[1] + w.z * a[2]

/**
 * A view: which way is right on the page, which way is down, and whether a
 * drag on a joint reads a heading (the views taken from above and below) or a
 * pitch (everything else).
 *
 * The six ortho views are named for the side of the model they are taken from,
 * matching the faces of the 3D view cube: Left stands at -X and lays +Z out to
 * the right, which is how a plain run has always been drawn. `developed` is
 * the odd one out — its across axis is the run's own horizontal travel rather
 * than any world direction, so every turn is flattened out of the drawing and
 * a run that wanders still reads as one continuous fall.
 */
export interface DraftProjection {
  label: string
  /** Which way the page's right runs, in world. Unused when developed. */
  right: Axis3
  /** Which way the page's down runs, in world. */
  down: Axis3
  /** Taken from above or below: joint drags set a heading, not a pitch. */
  plan: boolean
  /** Turns flattened out of the drawing rather than projected away. */
  developed?: true
  title: string
}

export const VIEWS: Record<DraftView, DraftProjection> = {
  developed: {
    label: 'Developed',
    right: [0, 0, 0],
    down: [0, -1, 0],
    plan: false,
    developed: true,
    title:
      'Developed elevation — side-on with every turn flattened out, so each part shows its true slope wherever it heads',
  },
  front: {
    label: 'Front',
    right: [1, 0, 0],
    down: [0, -1, 0],
    plan: false,
    title: 'Front view — from +Z, looking back up the run',
  },
  back: {
    label: 'Back',
    right: [-1, 0, 0],
    down: [0, -1, 0],
    plan: false,
    title: 'Back view — from −Z, looking down the run',
  },
  left: {
    label: 'Left',
    right: [0, 0, 1],
    down: [0, -1, 0],
    plan: false,
    title: 'Left view — from −X, the run reading left to right',
  },
  right: {
    label: 'Right',
    right: [0, 0, -1],
    down: [0, -1, 0],
    plan: false,
    title: 'Right view — from +X, the run reading right to left',
  },
  top: {
    label: 'Top',
    right: [1, 0, 0],
    down: [0, 0, 1],
    plan: true,
    title: 'Top view — from above, where turns and corner sweeps are set',
  },
  bottom: {
    label: 'Bottom',
    right: [1, 0, 0],
    down: [0, 0, -1],
    plan: true,
    title: 'Bottom view — from below, the top view mirrored',
  },
}

/** Developed first, then round the model — the order the switcher lists them. */
export const VIEW_ORDER: DraftView[] = [
  'developed',
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
]

/**
 * How far the view stands off a leg heading `yaw`: 1 square-on, 0 end-on, and
 * negative when the view has the run going the other way. This is the fraction
 * of a leg's horizontal run that reaches the paper, so it is both what an
 * elevation drag divides back out and what says whether there is anything
 * there to drag.
 */
export function showsRun(proj: DraftProjection, yaw: number): number {
  if (proj.developed) return 1
  return Math.sin(yaw) * proj.right[0] + Math.cos(yaw) * proj.right[2]
}

/**
 * How square-on a leg has to sit before a view is worth dragging it in. Below
 * this the leg is all but end-on: it draws as a stub, and the angle read off it
 * would swing wildly for a pixel of pointer travel.
 */
export const EDGE_ON = 0.12

/**
 * A pointer offset in the drawing, read back as a heading in the world. The
 * page's own axes put it there, so the heading comes out the same whichever
 * way round a view has the run — the bottom view is the top view mirrored, and
 * a drag in it turns the part the way the pointer went.
 */
export function headingOf(proj: DraftProjection, dx: number, dy: number): number {
  const x = dx * proj.right[0] + dy * proj.down[0]
  const z = dx * proj.right[2] + dy * proj.down[2]
  return (Math.atan2(x, z) * 180) / Math.PI
}

/**
 * How far a pointer offset has come along a leg's own horizontal run, and how
 * far it has dropped. A view that takes the leg at an angle only draws part of
 * its run, so that fraction is divided back out and the leg reads its true
 * slope; forward is whichever way this view has the run going. A leg is drawn
 * by its horizontal run, which only ever goes forward, so the pointer reads
 * straight down as vertical and no further.
 */
export function legReach(shows: number, dx: number, dy: number) {
  return { forward: Math.max(dx / shows, 1e-6), drop: dy }
}
