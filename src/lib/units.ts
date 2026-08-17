/**
 * The unit a length is shown in.
 *
 * The model itself is millimetres throughout — geometry, layout, the simulation
 * and every exported file. This is a lens laid over the top: it changes how a
 * number is written out and how a typed one is read back, and nothing else. A
 * run drawn in inches is the same run, and slices to the same plate.
 */
export type Unit = 'mm' | 'in'

export const MM_PER_INCH = 25.4

/** The suffix each unit is written with. */
export const UNIT_LABEL: Record<Unit, string> = { mm: 'mm', in: 'in' }

/** Spelt out, for the setting itself — 'mm' is not a word everyone reads. */
export const UNIT_NAME: Record<Unit, string> = { mm: 'Millimeters', in: 'Inches' }

/**
 * The unit inside a phrase, where the suffix will not do: "in travelled" reads
 * as a preposition, "inches travelled" as a measurement.
 */
export const UNIT_WORD: Record<Unit, string> = { mm: 'mm', in: 'inches' }

/**
 * How many decimals a length is written to. A thousandth of an inch is about a
 * fortieth of a millimetre, so the two are as fine as one another to read.
 */
const DECIMALS: Record<Unit, number> = { mm: 1, in: 3 }

/**
 * The same, for read-outs that only want the gist — a total, a distance
 * travelled, a part's length in a list. Whole millimetres, hundredths of an inch.
 */
const COARSE_DECIMALS: Record<Unit, number> = { mm: 0, in: 2 }

/** Millimetres — how they are stored — to the unit they are shown in. */
export const fromMm = (mm: number, unit: Unit) => (unit === 'in' ? mm / MM_PER_INCH : mm)

/** A number as typed, in the unit on show, back to the millimetres we keep. */
export const toMm = (v: number, unit: Unit) => (unit === 'in' ? v * MM_PER_INCH : v)

/** Trailing zeros read as noise — 140, not 140.0. */
const trim = (v: number, decimals: number) => String(Number(v.toFixed(decimals)))

/** A length as a bare number in the unit on show: `140`, or `5.512`. */
export function lengthText(mm: number, unit: Unit, decimals = DECIMALS[unit]): string {
  return trim(fromMm(mm, unit), decimals)
}

/** A length with its unit: `140 mm`, or `5.512 in`. */
export function formatLength(mm: number, unit: Unit, decimals = DECIMALS[unit]): string {
  return `${lengthText(mm, unit, decimals)} ${UNIT_LABEL[unit]}`
}

/** A length rounded to what a read-out needs: `140 mm`, or `5.51 in`. */
export function formatCoarse(mm: number, unit: Unit): string {
  return formatLength(mm, unit, COARSE_DECIMALS[unit])
}

/** The same, without the unit — for a figure that already carries its label. */
export function coarseText(mm: number, unit: Unit): string {
  return lengthText(mm, unit, COARSE_DECIMALS[unit])
}

/**
 * Steps an inch dial is worth having, coarsest last. Dividing a millimetre step
 * by 25.4 lands on numbers nobody would choose — 0.0394 — so a slider in inches
 * is given the nearest handy fraction rather than the arithmetic one.
 */
const INCH_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.125, 0.25]

/** The step a control uses once its millimetre step is put into `unit`. */
export function stepFor(mmStep: number, unit: Unit): number {
  if (unit === 'mm') return mmStep
  const want = mmStep / MM_PER_INCH
  // The finest step is the floor: a coarser dial than asked for would lose
  // travel the millimetre one had.
  let step = INCH_STEPS[0]
  for (const s of INCH_STEPS) if (s <= want) step = s
  return step
}

/**
 * Screen density, in the unit on show. Per inch it is just dpi, which is the
 * figure an inch-minded user already has a feel for.
 */
export function formatDensity(pxPerMm: number, unit: Unit): string {
  return unit === 'in'
    ? `${Math.round(pxPerMm * MM_PER_INCH)} px / in`
    : `${pxPerMm.toFixed(2)} px / mm`
}
