import { useMemo } from 'react'
import * as THREE from 'three'
import NumberField from './NumberField'
import ColorField from './ColorField'
import CollapsiblePanel from './CollapsiblePanel'
import HoverHint from './HoverHint'
import { pieceAxisLength } from '../lib/centerline'
import { buildAssembly, placedBox } from '../lib/layout'
import { FUNNEL_LEAST_CONE, funnelFeedRadius } from '../lib/funnel'
import { coilTroughSide } from '../lib/cage'
import {
  useRun,
  VARIANT_LABEL,
  OPEN_SIDE_LABEL,
  OPEN_SIDES,
  PIECE_LIMITS,
  TUBE_LIMITS,
  ANGLE_DEFAULTS,
  BASE_DEFAULTS,
  BASE_LIMITS,
  PRINTER_BEDS,
  bedFor,
  SUPPORT_LIMITS,
  CORNER_DEFAULTS,
  angleSpec,
  baseSpec,
  supportSpec,
  rodIsRound,
  isStructure,
  cornerSpec,
  hookSpec,
  hookLength,
  hookDrop as hookDropOf,
  corkscrewSpec,
  corkscrewLength,
  corkscrewDrop as corkscrewDropOf,
  corkscrewPlan,
  corkscrewRingPitch,
  corkscrewRingSpacing,
  corkscrewRingsFor,
  corkscrewRingsForSlope,
  corkscrewSlopeRange,
  corkscrewCage,
  innerCageFits,
  CAGE_LIMITS,
  COIL_RING_GAP,
  HOOK_ROLL_FLAT,
  HOOK_ROLL_EDGE,
  FUNNEL_TURN_LIMITS,
  funnelSpec,
  funnelBowlOf,
  funnelDrop as funnelDropOf,
  funnelHand,
  funnelHasLead,
  funnelLength,
  funnelReach,
  funnelDrainVariant,
  funnelWhirls,
  slopeIsFixed,
  bendLimitsFor,
  slopeLimitsFor,
  sweepLimitsFor,
  degLabel,
  exitSlope,
  exitTurn,
  tubeSpec,
  boreOf,
  wallOf,
  colorOf,
  variantOf,
  openSideOf,
  jointSpec,
  pieceSpec,
  pieceLabel,
  pieceTypeLabel,
  PART_LABEL,
  DEFAULT_PIECE_COLOR,
  JOINT_FILLET_DEFAULT,
  JOINT_LOCK,
  breakAngleOf,
  mitreBite,
  turnLimitsFor,
  type OpenSide,
  type TubeVariant,
} from '../store'
import { UNIT_LABEL, UNIT_WORD, coarseText, formatCoarse, formatLength, lengthText } from '../lib/units'

const VARIANTS: TubeVariant[] = ['half', 'threequarter', 'closed']

/** First entry is the default, so clicking it restores the stock look. */
const PIECE_SWATCHES = [DEFAULT_PIECE_COLOR, '#2a9e35', '#2b6cb0', '#c2410c', '#e6e9ee', '#2a2f3a']

const VARIANT_NOTE: Record<TubeVariant, string> = {
  half: 'Open trough — 180° of wall. The marble sits in it rather than inside it, so it can leave through the open side.',
  threequarter: '70% wall with a slot to see through. The wall still curls over the marble, so it carries exactly as closed tube does.',
  closed: 'Full 360° tube — marble enclosed, and out of sight.',
}

/**
 * Which way each side faces, said as the marble sees it. Left and right are read
 * looking along the run rather than at the screen, which is the only reading
 * that survives a run turning back on itself.
 */
const OPEN_SIDE_NOTE: Record<OpenSide, string> = {
  top: 'Opening faces up — the marble is seen from above, and the part prints as it lies.',
  right: 'Opening faces right, looking along the run.',
  bottom: 'Opening faces down — the marble is seen from underneath. A half pipe turned this way drops it.',
  left: 'Opening faces left, looking along the run.',
}

/**
 * The four ways a coil can be braced, in the order the buttons offer them:
 * nothing, up the middle, round the outside, and both.
 *
 * Two toggles would be the same four answers, but read as two questions when
 * they are really one — a coil is braced *somewhere*, and where is the choice.
 */
const CAGE_CHOICES: [string, boolean, boolean, string][] = [
  ['None', false, false, 'No cage — the coil holds itself up, which printed it cannot'],
  ['Inside', true, false, 'A cage up the hollow middle, leaving the outside clear to watch'],
  ['Outside', false, true, 'A cage round the outside, leaving the middle clear to look down'],
  ['Both', true, true, 'Caged inside and out — every ring held at eight points'],
]

/** A handful of names in a sentence — "a, b and c" rather than "a, b, c". */
function listWords(words: string[]): string {
  if (words.length < 2) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export default function Sidebar() {
  const s = useRun()
  const selectedIndex = s.pieces.findIndex((p) => p.id === s.selectedId)
  const selected = selectedIndex >= 0 ? s.pieces[selectedIndex] : null
  // The style the buttons show and act on: the selected part's, or the run's
  // when nothing is picked.
  const style = selected ? variantOf(selected, s.variant) : s.variant
  // Whether Apply to All has anything left to do — some part is cut differently.
  const mixed = s.pieces.some((p) => variantOf(p, s.variant) !== style)
  // The side the opening faces works the same way again: the selected part's
  // own, or the run's when nothing is picked.
  const side = selected ? openSideOf(selected, s.openSide) : s.openSide
  const mixedSide = s.pieces.some((p) => openSideOf(p, s.openSide) !== side)
  /**
   * Whether what is being set has any opening to face anywhere. A closed part
   * plainly has none; the run only has none while every part following it is
   * closed too, since a part cut open on its own still takes the run's side.
   */
  const noOpening = selected
    ? style === 'closed'
    : style === 'closed' && s.pieces.every((p) => variantOf(p, s.variant) === 'closed')
  // Colour works the same way: the selected part's own, or the run's when
  // nothing is picked, and Apply to All is live while some part differs.
  const color = selected ? colorOf(selected, s.pieceColor) : s.pieceColor
  const mixedColor = s.pieces.some((p) => colorOf(p, s.pieceColor) !== color)
  // Bore and wall work the same way again: the selected part's own, or the
  // run's when nothing is picked, and Apply to All is live while some part is
  // cut from another tube.
  const bore = selected ? boreOf(selected, s.innerDiameter) : s.innerDiameter
  const wall = selected ? wallOf(selected, s.wallThickness) : s.wallThickness
  const mixedTube = s.pieces.some(
    (p) => boreOf(p, s.innerDiameter) !== bore || wallOf(p, s.wallThickness) !== wall,
  )
  const spec = tubeSpec(bore, wall, style, side)
  // Centreline length, so a bent part counts what it actually carries — and
  // structure counts nothing, having no run down it to carry anything.
  const totalLength = s.pieces.reduce(
    (a, p) => a + (isStructure(p) ? 0 : pieceAxisLength(p)),
    0,
  )
  const selectedLength = selected ? pieceAxisLength(selected) : 100
  const joint = jointSpec(spec, selectedLength)
  const angle = selected && selected.type === 'angle' ? angleSpec(selected) : null
  const corner = selected && selected.type === 'corner' ? cornerSpec(selected) : null
  const hook = selected && selected.type === 'hook' ? hookSpec(selected) : null
  const hookDrop = selected && hook ? hookDropOf(selected) : 0
  const coil = selected && selected.type === 'corkscrew' ? corkscrewSpec(selected) : null
  const coilDrop = selected && coil ? corkscrewDropOf(selected) : 0
  /** A coil in a run that has been turned end for end goes up rather than down. */
  const coilClimbs = !!coil && coil.height < 0
  /** Whether the rings are counted off the height or were set by hand. */
  const coilCounted = !!coil && !selected?.ringsSet
  /** What counting would give, which the By hand field starts from. */
  const coilFits = coil ? corkscrewRingsFor(coil.height, spec.outerR) : 0
  /** The height one ring of this tube takes up — what the count is worked out of. */
  const coilNeeds = corkscrewRingSpacing(spec.outerR)
  /**
   * The air left between one ring and the next. The rings sit `height / rings`
   * apart centre to centre, so anything short of a full tube across is one ring
   * winding through the one below it — which the count only allows where a coil
   * has not the height for even the quarter turn it is floored at.
   */
  const coilGap = selected && coil ? corkscrewRingPitch(selected) - spec.outerR * 2 : 0
  /** The gentlest and steepest fall this coil's height and widths can give it. */
  const coilFalls = selected && coil ? corkscrewSlopeRange(selected) : { min: 0, max: 90 }
  /** The cage bracing the coil, when a coil is what is picked. */
  const cage = selected && coil ? corkscrewCage(selected) : null
  /** Whether there is room up the middle of it for the inner one. */
  const cageFits = !!selected && !!coil && innerCageFits(selected, spec.innerR)
  /** Which side of the coil the trough faces, of the two that can be braced. */
  const cageFaces = coil ? coilTroughSide(spec, coil.turns < 0 ? -1 : 1) : null
  /**
   * The slab, when a base is what is picked. It is the one part here that is not
   * cut from the tube at all, so where it is showing the panels that describe the
   * tube — its size, its style, and the angles it meets the run at — are put away:
   * every one of them would be a control that does nothing.
   */
  const slab = selected && selected.type === 'base' ? baseSpec(selected) : null
  /**
   * The printer the plate is exactly the bed of, if it is anybody's — a reading
   * taken off its two spans rather than anything the slab remembers, so a plate
   * typed to 256 square reads as an A1 whether it was picked from the list or
   * not, and one nudged a millimetre off reads as Custom again.
   */
  const bed = slab ? bedFor(slab.width, slab.depth) : null
  /**
   * The post, when a support is what is picked — the other part on the stage
   * that is not cut from the tube. The tube panels go away for it exactly as
   * they go away for a slab, and for one more reason besides: what a post is cut
   * to is not a choice but a reading, taken off whatever run it was fitted to.
   */
  const post = selected && selected.type === 'support' ? supportSpec(selected) : null
  /** Whether what is picked is structure rather than run — see {@link isStructure}. */
  const ground = !!slab || !!post
  /**
   * What the run standing on the stage covers, x and z, or null if there is no
   * run to cover — a stage of nothing but bases has no footprint to fit to.
   * Padded out to the tube, so a plate sized to it is under the whole pipe rather
   * than under its centreline.
   */
  const footprint = useMemo(() => {
    const run = tubeSpec(s.innerDiameter, s.wallThickness, s.variant, s.openSide)
    const asm = buildAssembly(s.pieces)
    const box = new THREE.Box3()
    for (const p of asm.placed) {
      // The posts are ground as much as the plate is: a base sized to its own
      // supports would grow to cover parts that are only standing on it.
      if (isStructure(p.piece)) continue
      box.union(placedBox(p, pieceSpec(run, p.piece).outerR))
    }
    return box.isEmpty() ? null : box
  }, [s.pieces, s.innerDiameter, s.wallThickness, s.variant, s.openSide])
  const funnel = selected && selected.type === 'funnel' ? funnelSpec(selected) : null
  const funnelFall = selected && funnel ? funnelDropOf(selected) : 0
  /** The bowl as it is actually cut, off this part's own tube. */
  const bowl = selected && funnel ? funnelBowlOf(selected, spec.innerR, spec.wall) : null
  /** How far the feed tube has to run to stand clear of the bowl. */
  const funnelLeast = selected && funnel ? funnelReach(selected, spec.innerR, spec.wall) : 0
  /** Whether the marble is whirled round the bowl rather than dropped straight in. */
  const whirls = !!selected && !!funnel && funnelWhirls(selected)
  /** Whether the funnel is fed by a tube of its own, or is a plain funnel. */
  const hasLead = !!selected && !!funnel && funnelHasLead(selected)
  /** What the drain is actually cut in — its own style, or the part's. */
  const leadOutStyle = selected && funnel ? funnelDrainVariant(selected, s.variant) : style
  /**
   * How high the collar may stand. The bowl shares its depth out between the
   * clearance the feed rides over, the collar, and the cone under it — and the
   * cone is what actually gathers the marble in, so it is the one kept back.
   */
  const rimRoom = bowl ? Math.max(0, bowl.rim + bowl.cone - FUNNEL_LEAST_CONE) : 0
  // A part whose fall comes off its own shape has no start angle to set.
  const fixedSlope = !!selected && slopeIsFixed(selected)
  /**
   * A turn rolled right over is flat again, the other way about, and rolled the
   * whole way round is back where it started — so every half turn of roll is a
   * flat turn, and the quarters between them are the ones stood on edge.
   */
  const hookLevel = !!hook && hook.roll % 180 === 0
  const hookEdge = !!hook && hook.roll % 180 === 90
  const hookPlane = !hook
    ? ''
    : hookLevel
      ? 'lying flat'
      : hookEdge
        ? // Past the half turn the axis points the other way, so the same sweep
          // takes the run up and over rather than down and under.
          hook.roll < 180
          ? 'stood on edge'
          : 'stood on edge the other way about'
        : `rolled ${degLabel(hook.roll)}° off level`
  // What the part before hands this one, if the two are actually joined. An
  // unjoined part has no joint behind it at all.
  const upstream =
    selected && selectedIndex > 0 && selected.joined ? s.pieces[selectedIndex - 1] : null
  const handedOn = upstream ? exitSlope(upstream) : 0
  // How far this part stands off what it is fed — in fall, and in heading. The
  // connector itself is straight either way: what this really measures is the
  // break the part takes a lock past its socket to come round to its own aim.
  // See JOINT_LOCK. Zero on both counts and the part runs straight through.
  const kink = selected && upstream ? selected.slope - handedOn : 0
  const swing = selected && upstream ? selected.turn : 0
  const led = Math.abs(kink) > 0.05 || Math.abs(swing) > 0.05
  // The angle a connector leaves at is its two legs added up, so it can be set
  // from either end: type the exit angle and the break takes up the difference.
  const bendLimits = selected ? bendLimitsFor(selected) : PIECE_LIMITS.bend
  const exitLimits = selected
    ? { min: selected.slope + bendLimits.min, max: selected.slope + bendLimits.max, step: bendLimits.step }
    : PIECE_LIMITS.slope

  /**
   * Which side of the inlet joint is free to move, if either.
   *
   * Normally it is this part: it comes to the angle the one before hands on. A
   * part on a fall of its own cannot, so the part before has to be brought to
   * it instead — which only works where that part's own exit is something we
   * can set. A tube leaves at the angle it runs at, and an angle connector's
   * break makes up whatever difference is left; a corner or a hook works its
   * exit out from its own turn, and there is no one number here that lands it.
   */
  const matchable =
    !fixedSlope ||
    // A heading is this part's own however its fall is pinned, so a break that
    // is only a turn is always ours to straighten out.
    Math.abs(kink) <= 0.05 ||
    (!!upstream && (upstream.type === 'straight' || upstream.type === 'angle'))

  const hold = (v: number, lim: { min: number; max: number }) =>
    Math.min(lim.max, Math.max(lim.min, v))

  // How far this part may be turned off the run before the bend would be one
  // its own tube cannot be cut round. Wide open at the head of a run, where the
  // heading is where the run sets off rather than a bend in anything.
  const turnLimits = selected
    ? turnLimitsFor(
        selected,
        selected.entrySlope ?? (upstream ? handedOn : undefined),
        boreOf(selected, s.innerDiameter) / 2 + wallOf(selected, s.wallThickness),
      )
    : PIECE_LIMITS.turn

  // What this part's inlet break is cut at — its own where it has been told,
  // and what the Rotate tool would give it the first time it is swung where it
  // has not. See `aimPart`.
  const pivot = selected ? (selected.jointFillet ?? s.jointFillet) : 0

  const closeJoint = () => {
    if (!selected) return
    if (!fixedSlope) {
      // The heading goes back to straight-on with the fall: both halves of the
      // break, so the part comes out running straight through.
      s.updatePiece(selected.id, { slope: hold(handedOn, slopeLimitsFor(selected)), turn: 0 })
      return
    }
    // A part on a fall of its own still gets its heading straightened here —
    // that half of the break is nobody's but this part's.
    if (selected.turn) s.updatePiece(selected.id, { turn: 0 })
    if (!upstream) return
    if (upstream.type === 'angle') {
      const wanted = Math.round((selected.slope - upstream.slope) * 1e3) / 1e3
      s.updatePiece(upstream.id, { bend: hold(wanted, bendLimitsFor(upstream)) })
    } else if (upstream.type === 'straight') {
      s.updatePiece(upstream.id, { slope: hold(selected.slope, slopeLimitsFor(upstream)) })
    }
  }

  return (
    <aside className="sidebar">
      {/* Measurements, tube and colour are all a part's own; with nothing picked
          the same fields set what the run — and every part following it — is
          made to. That is worth saying, but only once it is asked for: the
          heading carries it as a hover hint rather than standing text, so the
          fields themselves start at the top of the column. */}
      <header className="scope-head">
        <HoverHint
          label="Part Parameters"
          hint={
            selected
              ? 'Measurements, tube size, style and color belong to this part alone. Apply to All Parts puts any of them on the whole run.'
              : 'Pick a part in Active Parts or the list below to edit its measurements, tube size, style and color. With nothing picked, these set the run — every part that has none of its own follows it.'
          }
        >
          <h2>
            Part Parameters
            <span className={selected ? 'scope-name' : 'scope-name none'}>
              {selected ? pieceLabel(selected, selectedIndex) : 'none'}
            </span>
          </h2>
        </HoverHint>
      </header>

      {/* The three panels that describe the tube, and the one that describes how a
          part meets the run. A base has none of that — no bore, no wall, no
          style, no joints — so with one picked they are put away rather than
          left standing as controls that would do nothing to what is selected. */}
      {!ground && (
      <CollapsiblePanel title="Tube Size">
        <span className="field-label">
          {selected ? pieceLabel(selected, selectedIndex) : 'Run tube'}
          <em>
            {selected
              ? 'this part only'
              : 'every part that has not been sized on its own, and every part added next'}
          </em>
        </span>
        <NumberField
          label="Inner diameter"
          hint="bore the marble rolls in"
          value={bore}
          onChange={(v) => (selected ? s.setPieceBore(selected.id, v) : s.setInnerDiameter(v))}
          {...TUBE_LIMITS.innerDiameter}
        />
        <NumberField
          label="Wall thickness"
          hint="outer minus inner"
          value={wall}
          onChange={(v) => (selected ? s.setPieceWall(selected.id, v) : s.setWallThickness(v))}
          {...TUBE_LIMITS.wallThickness}
        />
        <div className="readout">
          <div>
            <b>{lengthText(spec.outerR * 2, s.units)}</b>
            <span>Outer Ø {UNIT_LABEL[s.units]}</span>
          </div>
          <div>
            <b>{lengthText(spec.innerR, s.units)}</b>
            <span>Inner R {UNIT_LABEL[s.units]}</span>
          </div>
          <div>
            <b>{Math.round((spec.sweep * 180) / Math.PI)}°</b>
            <span>Wall sweep</span>
          </div>
        </div>
        <button onClick={() => s.applyTubeToAll(bore, wall)} disabled={!mixedTube}>
          Apply to All Parts
        </button>
        <p className="note">
          {mixedTube
            ? `Cuts all ${s.pieces.length} parts — and every part added next — from Ø${lengthText(bore, s.units)} bore with a ${formatLength(wall, s.units)} wall.`
            : s.pieces.length
              ? `Every part is already Ø${lengthText(bore, s.units)} bore, ${formatLength(wall, s.units)} wall.`
              : 'No parts yet — this is the tube the first one is cut from.'}
        </p>
        {/* A part is only ever printed against the parts it mates with, so a bore
            of its own is worth saying out loud rather than leaving to be noticed
            at the joint. */}
        {mixedTube && (
          <p className="warn">
            Parts cut from different tubes do not mate — their sockets and spigots step at the
            joint.
          </p>
        )}
        {s.marbleDiameter >= bore && (
          <p className="warn">
            Marble is Ø{formatLength(s.marbleDiameter, s.units)} — it will not fit this bore.
          </p>
        )}
      </CollapsiblePanel>
      )}

      {!ground && (
      <CollapsiblePanel title="Tube Style">
        <span className="field-label">
          {selected ? pieceLabel(selected, selectedIndex) : 'Run style'}
          <em>
            {selected
              ? 'this part only'
              : 'every part that has not been styled on its own, and every part added next'}
          </em>
        </span>
        <div className="segmented">
          {VARIANTS.map((v) => (
            <button
              key={v}
              className={style === v ? 'on' : ''}
              onClick={() => (selected ? s.setPieceVariant(selected.id, v) : s.setVariant(v))}
              title={VARIANT_NOTE[v]}
            >
              {VARIANT_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="note">{VARIANT_NOTE[style]}</p>
        <button onClick={() => s.applyVariantToAll(style)} disabled={!mixed}>
          Apply to All Parts
        </button>
        <p className="note">
          {mixed
            ? `Puts ${VARIANT_LABEL[style]} on all ${s.pieces.length} parts, and on every part added next.`
            : s.pieces.length
              ? `Every part is already ${VARIANT_LABEL[style]}.`
              : 'No parts yet — this is the style the first one arrives in.'}
        </p>

        {/* Which side that opening faces. Every part is a closed pipe until it
            is cut open, so this only has anything to say once one has been —
            but the choice is remembered either way, so a part cut open again
            opens the side it was last set to. */}
        <span className="field-label">
          Opens
          <em>{noOpening ? 'nothing to open — this is closed tube' : 'looking along the run'}</em>
        </span>
        <div className="segmented">
          {OPEN_SIDES.map((v) => (
            <button
              key={v}
              className={side === v ? 'on' : ''}
              disabled={noOpening}
              onClick={() => (selected ? s.setPieceOpenSide(selected.id, v) : s.setOpenSide(v))}
              title={OPEN_SIDE_NOTE[v]}
            >
              {OPEN_SIDE_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="note">
          {noOpening
            ? 'A closed tube has no opening. Cut it Half or 3/4 to choose a side.'
            : OPEN_SIDE_NOTE[side]}
        </p>
        <button onClick={() => s.applyOpenSideToAll(side)} disabled={!mixedSide}>
          Apply to All Parts
        </button>
        <p className="note">
          {mixedSide
            ? `Opens all ${s.pieces.length} parts on the ${OPEN_SIDE_LABEL[side].toLowerCase()}, and every part added next.`
            : s.pieces.length
              ? `Every part already opens on the ${OPEN_SIDE_LABEL[side].toLowerCase()}.`
              : 'No parts yet — this is the side the first one opens on.'}
        </p>
      </CollapsiblePanel>
      )}

      <CollapsiblePanel title="Color">
        <ColorField
          label={selected ? pieceLabel(selected, selectedIndex) : 'Run color'}
          hint={
            selected
              ? 'this part only'
              : 'every part that has not been painted on its own, and every part added next'
          }
          value={color}
          onChange={(v) => (selected ? s.setPartColor(selected.id, v) : s.setPieceColor(v))}
          presets={PIECE_SWATCHES}
        />
        <button onClick={() => s.applyColorToAll(color)} disabled={!mixedColor}>
          Apply to All Parts
        </button>
        <p className="note">
          {mixedColor
            ? `Puts ${color} on all ${s.pieces.length} parts, and on every part added next.`
            : s.pieces.length
              ? 'Every part is already this color.'
              : 'No parts yet — this is the color the first one arrives in.'}{' '}
          3D view only — colors are never exported.
        </p>
      </CollapsiblePanel>

      <CollapsiblePanel title="Measurement">
        {/* Only the selected part is editable here — Active Parts is the full list. */}
        <div className="piece-list">
          {selected ? (
            <div className="piece on">
              <div className="piece-head">
                <span className="tag">{String(selectedIndex + 1).padStart(2, '0')}</span>
                <span className="piece-name">{pieceLabel(selected, selectedIndex)}</span>
                {/* Renamed in the tree — say what the part still is. */}
                {pieceLabel(selected, selectedIndex) !== pieceTypeLabel(selected, selectedIndex) && (
                  <span className="piece-type">{PART_LABEL[selected.type]}</span>
                )}
                <span className="piece-dim">
                  {slab
                    ? `${formatCoarse(slab.width, s.units)} × ${formatCoarse(slab.depth, s.units)}`
                    : formatCoarse(selectedLength, s.units)}
                </span>
              </div>
              <div className="piece-body">
                {angle ? (
                  <>
                    <NumberField
                      label="Entry leg"
                      hint="rigid — carries on from the part before"
                      value={angle.entry}
                      onChange={(v) => s.updatePiece(selected.id, { length: v })}
                      {...PIECE_LIMITS.length}
                    />
                    <NumberField
                      label="Bend"
                      hint="up or down at the break"
                      unit="°"
                      value={angle.bend}
                      onChange={(v) => s.updatePiece(selected.id, { bend: v })}
                      {...bendLimitsFor(selected)}
                    />
                    <NumberField
                      label="Exit leg"
                      hint="after the break"
                      value={angle.exit}
                      onChange={(v) => s.updatePiece(selected.id, { exitLength: v })}
                      {...PIECE_LIMITS.exitLength}
                    />
                    <span className="field-label">
                      Corner
                      <em>rounded carries the marble's speed through</em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={angle.fillet > 0 ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { fillet: ANGLE_DEFAULTS.fillet })
                        }
                        title="Round the break off with an arc tangent to both legs"
                      >
                        Rounded
                      </button>
                      <button
                        className={angle.fillet > 0 ? '' : 'on'}
                        onClick={() => s.updatePiece(selected.id, { fillet: 0 })}
                        title="Meet the two legs at a mitred corner"
                      >
                        Sharp
                      </button>
                    </div>
                    <NumberField
                      label="Corner radius"
                      hint="0 is a sharp break"
                      value={angle.fillet}
                      onChange={(v) => s.updatePiece(selected.id, { fillet: v })}
                      {...PIECE_LIMITS.fillet}
                    />
                    <p className="note">
                      Enters at {degLabel(selected.slope)}° and leaves at{' '}
                      {degLabel(exitSlope(selected))}°. A big radius on short legs is trimmed back
                      to what the legs can give it.
                    </p>
                  </>
                ) : corner ? (
                  <>
                    <NumberField
                      label="Entry leg"
                      hint="rigid — carries on from the part before"
                      value={corner.entry}
                      onChange={(v) => s.updatePiece(selected.id, { length: v })}
                      {...PIECE_LIMITS.length}
                    />
                    <NumberField
                      label="Sweep"
                      hint="right or left at the break"
                      unit="°"
                      value={corner.sweep}
                      onChange={(v) => s.updatePiece(selected.id, { sweep: v })}
                      {...PIECE_LIMITS.sweep}
                    />
                    <NumberField
                      label="Exit leg"
                      hint="after the break"
                      value={corner.exit}
                      onChange={(v) => s.updatePiece(selected.id, { exitLength: v })}
                      {...PIECE_LIMITS.exitLength}
                    />
                    <span className="field-label">
                      Corner
                      <em>rounded carries the marble's speed through</em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={corner.fillet > 0 ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { fillet: CORNER_DEFAULTS.fillet })
                        }
                        title="Round the break off with an arc tangent to both legs"
                      >
                        Rounded
                      </button>
                      <button
                        className={corner.fillet > 0 ? '' : 'on'}
                        onClick={() => s.updatePiece(selected.id, { fillet: 0 })}
                        title="Meet the two legs at a mitred corner"
                      >
                        Sharp
                      </button>
                    </div>
                    <NumberField
                      label="Corner radius"
                      hint="0 is a sharp break"
                      value={corner.fillet}
                      onChange={(v) => s.updatePiece(selected.id, { fillet: v })}
                      {...PIECE_LIMITS.fillet}
                    />
                    <p className="note">
                      Swings the run {degLabel(Math.abs(exitTurn(selected)))}° to the{' '}
                      {corner.sweep < 0 ? 'left' : 'right'} and, turning across the fall, leaves at{' '}
                      {degLabel(exitSlope(selected))}° where it entered at{' '}
                      {degLabel(selected.slope)}°. A big radius on short legs is trimmed back to
                      what the legs can give it.
                    </p>
                  </>
                ) : hook ? (
                  <>
                    <NumberField
                      label="Entry stub"
                      hint="rigid — carries on from the part before"
                      value={hook.entry}
                      onChange={(v) => s.updatePiece(selected.id, { length: v })}
                      {...PIECE_LIMITS.length}
                    />
                    <NumberField
                      label="Turn radius"
                      hint="how wide it swings, measured in plan"
                      value={hook.radius}
                      onChange={(v) => s.updatePiece(selected.id, { radius: v })}
                      {...PIECE_LIMITS.radius}
                    />
                    <NumberField
                      label="Turn"
                      hint="how far round — 180° sends the run back the way it came"
                      unit="°"
                      value={hook.sweep}
                      onChange={(v) => s.updatePiece(selected.id, { sweep: v })}
                      {...sweepLimitsFor(selected)}
                    />
                    <NumberField
                      label="Exit stub"
                      hint="after the turn"
                      value={hook.exit}
                      onChange={(v) => s.updatePiece(selected.id, { exitLength: v })}
                      {...PIECE_LIMITS.exitLength}
                    />
                    <span className="field-label">
                      Turn plane
                      <em>flat wanders across the table, on edge doubles back under itself</em>
                    </span>
                    {/* Both buttons land on the nearest plane of their kind
                        rather than on one fixed angle: a hook already rolled
                        three quarters is on edge, and clicking On edge should
                        leave it exactly where it is rather than flipping the
                        turn over to the near edge. */}
                    <div className="segmented small">
                      <button
                        className={hookLevel ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, {
                            roll: hookLevel ? hook.roll : HOOK_ROLL_FLAT,
                          })
                        }
                        title="Turn flat — the run comes back alongside itself, one turn width over"
                      >
                        Flat
                      </button>
                      <button
                        className={hookEdge ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, {
                            roll: hookEdge ? hook.roll : HOOK_ROLL_EDGE,
                          })
                        }
                        title="Stand the turn on edge — the run drops and comes back underneath itself"
                      >
                        On edge
                      </button>
                    </div>
                    <NumberField
                      label="Turn plane"
                      hint="0° flat, 90° on edge, 180° flat the other way, 270° on edge going up and over"
                      unit="°"
                      value={hook.roll}
                      onChange={(v) => s.updatePiece(selected.id, { roll: v })}
                      {...PIECE_LIMITS.roll}
                    />
                    <div className="readout">
                      <div>
                        <b>{lengthText(hook.radius * 2, s.units)}</b>
                        <span>Turn Ø {UNIT_LABEL[s.units]}</span>
                      </div>
                      <div>
                        <b>{coarseText(hookLength(selected), s.units)}</b>
                        <span>Run length {UNIT_WORD[s.units]}</span>
                      </div>
                      <div>
                        <b>{coarseText(Math.abs(hookDrop), s.units)}</b>
                        <span>
                          {hookDrop < 0 ? 'Climb' : 'Drop'} {UNIT_WORD[s.units]}
                        </span>
                      </div>
                    </div>
                    <p className="note">
                      Turns {degLabel(Math.abs(hook.sweep))}° to the{' '}
                      {hook.sweep < 0 ? 'left' : 'right'} on a plane {hookPlane}, and comes out{' '}
                      {Math.abs(exitTurn(selected)) < 0.05
                        ? 'still heading the way it went in'
                        : `${degLabel(Math.abs(exitTurn(selected)))}° round to the ${
                            exitTurn(selected) < 0 ? 'left' : 'right'
                          }`}
                      , {formatCoarse(Math.abs(hookDrop), s.units)}{' '}
                      {hookDrop < 0 ? 'higher' : 'lower'}, at {degLabel(exitSlope(selected))}° where
                      it entered at {degLabel(selected.slope)}°.{' '}
                      {hookLevel
                        ? 'Falling as it turns is what lets it come out on the slope it went in on.'
                        : 'Turning end over end mirrors the fall, so a run that comes in falling leaves climbing — a level run into it, or an angle connector after it, is what settles that.'}
                    </p>
                    {/* Bending a channel out of the flat rolls it over as it
                        goes, which is a thing about bent channels rather than
                        about this part — but it is the marble that pays for it,
                        so it is said here rather than left to be discovered. */}
                    {!hookLevel && style !== 'closed' && (
                      <p className="warn">
                        Off the flat the tube rolls over as it turns — a quarter turn of it on
                        edge — so the marble leaves an open trough partway round. Cut this part
                        from a closed tube.
                      </p>
                    )}
                  </>
                ) : coil ? (
                  <>
                    <NumberField
                      label="Entry stub"
                      hint="rigid — carries on from the part before"
                      value={coil.entry}
                      onChange={(v) => s.updatePiece(selected.id, { length: v })}
                      {...PIECE_LIMITS.length}
                    />
                    {/* The size of the height is set here; its sign is which
                        way the coil faces, and that is the Connector's to
                        change — a coil in a run turned end for end climbs. So
                        the field works in bare height and hands the sign back
                        exactly as it found it. */}
                    <NumberField
                      label="Height"
                      hint={
                        coilClimbs
                          ? 'bottom ring to top ring — this coil climbs, its run having been turned round'
                          : coilCounted
                            ? 'top ring to bottom ring — the room the rings are counted into'
                            : 'top ring to bottom ring — the rings are held, so this sets the fall'
                      }
                      value={Math.abs(coil.height)}
                      onChange={(v) =>
                        s.updatePiece(selected.id, { height: coilClimbs ? -v : v })
                      }
                      {...PIECE_LIMITS.height}
                    />
                    <NumberField
                      label="Top width"
                      hint="across the coil where the run comes in"
                      value={coil.topRadius * 2}
                      onChange={(v) => s.updatePiece(selected.id, { topDiameter: v })}
                      {...PIECE_LIMITS.topDiameter}
                    />
                    <NumberField
                      label="Bottom width"
                      hint="across the coil where the run leaves"
                      value={coil.bottomRadius * 2}
                      onChange={(v) => s.updatePiece(selected.id, { bottomDiameter: v })}
                      {...PIECE_LIMITS.bottomDiameter}
                    />
                    {/* Counted is the ordinary case; setting the count by hand
                        is how a coil is given a fall of its own, since fewer
                        rings over the same height is a steeper one. */}
                    <span className="field-label">
                      Rings
                      <em>
                        {coilCounted
                          ? `counted — ${formatCoarse(Math.abs(coil.height), s.units)} has room for ${degLabel(coilFits)}`
                          : `set by hand — counting would give ${degLabel(coilFits)}`}
                      </em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={coilCounted ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, {
                            ringsSet: false,
                            rings: coilFits * (coil.turns < 0 ? -1 : 1),
                          })
                        }
                        title="Count the rings off the room the height leaves them"
                      >
                        Counted
                      </button>
                      <button
                        className={coilCounted ? '' : 'on'}
                        onClick={() =>
                          s.updatePiece(selected.id, { ringsSet: true, rings: coil.turns })
                        }
                        title="Set the ring count by hand and hold it wherever the height goes"
                      >
                        By hand
                      </button>
                    </div>
                    <NumberField
                      label="Ring count"
                      hint={
                        coilCounted
                          ? 'counted off the height — switch to By hand to set it'
                          : 'times round between the top and the bottom'
                      }
                      readOnly={coilCounted}
                      value={Math.abs(coil.turns)}
                      onChange={(v) =>
                        s.updatePiece(selected.id, {
                          ringsSet: true,
                          rings: v * (coil.turns < 0 ? -1 : 1),
                        })
                      }
                      unit=""
                      min={PIECE_LIMITS.rings.step}
                      max={PIECE_LIMITS.rings.max}
                      step={PIECE_LIMITS.rings.step}
                    />
                    {/* The one part whose fall is not a field of its own — so
                        here it is, made one. A coil's height, its two widths and
                        how far round it goes fix the single angle it can sit at,
                        which means asking for an angle is asking one of those
                        four to give way. The rings are the one that can: the
                        height and the footprint stay exactly as they were, so
                        nothing under the coil moves and all that changes is how
                        fast the marble gets down it. */}
                    <NumberField
                      label={coilClimbs ? 'Climb' : 'Fall'}
                      hint={`how fast the marble comes ${coilClimbs ? 'up' : 'down'} — sets the rings, holding the height and both widths. ${degLabel(coilFalls.min)}° to ${degLabel(coilFalls.max)}° at this size`}
                      unit="°"
                      ends={['Slower', 'Faster']}
                      value={Math.abs(exitSlope(selected))}
                      onChange={(v) =>
                        s.updatePiece(selected.id, {
                          ringsSet: true,
                          rings:
                            corkscrewRingsForSlope(selected, v) * (coil.turns < 0 ? -1 : 1),
                        })
                      }
                      min={coilFalls.min}
                      max={coilFalls.max}
                      step={0.5}
                    />
                    <span className="field-label">
                      Wind
                      <em>which way round it goes on the way down</em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={coil.turns >= 0 ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { rings: Math.abs(coil.turns) })
                        }
                        title="Wind to the right — clockwise seen from above"
                      >
                        Right
                      </button>
                      <button
                        className={coil.turns < 0 ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { rings: -Math.abs(coil.turns) })
                        }
                        title="Wind to the left — anticlockwise seen from above"
                      >
                        Left
                      </button>
                    </div>
                    <NumberField
                      label="Exit stub"
                      hint="after the coil"
                      value={coil.exit}
                      onChange={(v) => s.updatePiece(selected.id, { exitLength: v })}
                      {...PIECE_LIMITS.exitLength}
                    />
                    {/* The cage. A coil is the one part in the library that
                        cannot stand up on its own — every ring hangs over the
                        one below with nothing between them — so this is the
                        only question here whose answer decides whether the part
                        can be printed at all. Which side it is braced on is a
                        real choice: whichever one is caged is the one you stop
                        being able to see the marble through. */}
                    {cage && (
                      <>
                        <span className="field-label">
                          Support
                          <em>
                            {cage.inner && cage.outer
                              ? 'braced inside and out — every ring held at eight points'
                              : cage.inner
                                ? 'braced up the middle, leaving the outside clear to watch it come down'
                                : cage.outer
                                  ? 'braced round the outside, leaving the middle clear to look down through'
                                  : 'nothing holding the rings up — a bare coil prints as a spring carrying its own weight'}
                          </em>
                        </span>
                        <div className="segmented small">
                          {CAGE_CHOICES.map(([label, inner, outer, why]) => (
                            <button
                              key={label}
                              className={cage.inner === inner && cage.outer === outer ? 'on' : ''}
                              onClick={() =>
                                s.updatePiece(selected.id, {
                                  innerCage: inner,
                                  outerCage: outer,
                                })
                              }
                              title={why}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {(cage.inner || cage.outer) && (
                          <NumberField
                            label="Bar"
                            hint="how thick the hoops and posts are, square in section"
                            value={cage.width}
                            onChange={(v) => s.updatePiece(selected.id, { width: v })}
                            {...CAGE_LIMITS.width}
                          />
                        )}
                      </>
                    )}
                    {/* An inner cage stands its bars flush with the channel, so
                        what it needs is the bore plus the bar — and a coil
                        tighter than that has no middle left to put one in. */}
                    {cage?.inner && !cageFits && (
                      <p className="warn">
                        This coil is too tight to brace inside: at{' '}
                        {formatCoarse(Math.min(coil.topRadius, coil.bottomRadius) * 2, s.units)}{' '}
                        across at its narrowest there is no room up the middle for a{' '}
                        {formatLength(cage.width, s.units)} bar standing clear of the channel.
                        Widen it, use a thinner bar, or brace it round the outside instead.
                      </p>
                    )}
                    {/* The one thing the open side changes about a cage, and
                        worth saying: the trough facing the cage is the trough
                        whose wall was cut away where the post wants to weld. */}
                    {cage && (cage.inner || cage.outer) && cageFaces && (
                      <p className="note">
                        This trough opens{' '}
                        {cageFaces === 'inner' ? 'into the middle' : 'away from the middle'}, so the{' '}
                        {cageFaces} cage has no wall to weld to — the posts stand clear of the
                        channel and each turn is tied to them underneath instead, below the bore
                        where nothing is in the marble's way.
                      </p>
                    )}
                    {/* Rings are counted rather than set, so they are read off
                        here alongside the two figures that count them: how much
                        room each one needs, and how much it actually got. */}
                    <div className="readout">
                      <div>
                        <b>{degLabel(Math.abs(coil.turns))}</b>
                        <span>Rings</span>
                      </div>
                      <div>
                        <b>{coarseText(corkscrewRingPitch(selected), s.units)}</b>
                        <span>Ring gap {UNIT_WORD[s.units]}</span>
                      </div>
                      <div>
                        <b>{degLabel(Math.abs(exitSlope(selected)))}°</b>
                        <span>{coilClimbs ? 'Climb' : 'Fall'}</span>
                      </div>
                    </div>
                    <div className="readout">
                      <div>
                        <b>{coarseText(corkscrewPlan(selected), s.units)}</b>
                        <span>Coil in plan {UNIT_WORD[s.units]}</span>
                      </div>
                      <div>
                        <b>{coarseText(corkscrewLength(selected), s.units)}</b>
                        <span>Run length {UNIT_WORD[s.units]}</span>
                      </div>
                      <div>
                        <b>{coarseText(Math.abs(coilDrop), s.units)}</b>
                        <span>
                          {coilDrop < 0 ? 'Rise' : 'Drop'} {UNIT_WORD[s.units]}
                        </span>
                      </div>
                    </div>
                    <p className="note">
                      {coilCounted ? (
                        <>
                          <b>The rings are counted.</b> One needs{' '}
                          {formatCoarse(coilNeeds, s.units)} of height — a whole Ø
                          {formatLength(spec.outerR * 2, s.units)} tube across, and{' '}
                          {formatLength(COIL_RING_GAP, s.units)} of air over it — so{' '}
                          {formatCoarse(Math.abs(coil.height), s.units)} has room for{' '}
                          {degLabel(coilFits)} of them, counted down to whole quarter turns so the
                          outlet lands square to the inlet. Raise the height and another ring goes
                          in; cut the part from fatter tube and one comes out.
                        </>
                      ) : (
                        <>
                          <b>The rings are yours.</b> {degLabel(Math.abs(coil.turns))} of them over{' '}
                          {formatCoarse(Math.abs(coil.height), s.units)} puts them{' '}
                          {formatCoarse(corkscrewRingPitch(selected), s.units)} apart, where
                          counting would have given {degLabel(coilFits)} at{' '}
                          {formatCoarse(coilNeeds, s.units)}. The count stands wherever the height
                          goes, which is what lets the coil be given a fall of its own: fewer rings
                          over the same height is a steeper one, more is gentler. Set that fall
                          under Fall and this count follows it.
                        </>
                      )}
                    </p>
                    <p className="note">
                      Those {degLabel(Math.abs(coil.turns))} rings wind to the{' '}
                      {coil.turns < 0 ? 'left' : 'right'} over{' '}
                      {formatCoarse(corkscrewPlan(selected), s.units)} of coil measured in plan,
                      and {formatCoarse(Math.abs(coil.height), s.units)} of{' '}
                      {coilClimbs ? 'climb' : 'drop'} over that length is what leaves it running at{' '}
                      {degLabel(Math.abs(exitSlope(selected)))}°. That angle is the part's own: the
                      coil holds it the whole way {coilClimbs ? 'up' : 'down'}, so a corkscrew hands
                      on exactly what it runs at, and the run either side has to meet it rather
                      than set it.
                    </p>
                    {/* A coil only ever climbs because the run it sits in was
                        turned end for end at a joint. Worth saying plainly:
                        otherwise it reads as a part that has gone wrong. */}
                    {coilClimbs && (
                      <p className="warn">
                        This coil climbs — its run has been turned end for end, so every part in it
                        now goes the other way. A marble cannot run up it: swing the run round the
                        other way, or re-angle it from the head.
                      </p>
                    )}
                    {/* Counted, the only coil that still clashes is one too
                        short for the quarter turn the count is floored at. Set
                        by hand, any count past what fits will — which is the
                        cost of holding the count, and worth saying rather than
                        leaving to be spotted in the viewport. */}
                    {coilGap < 0 && (
                      <p className="warn">
                        The rings sit {formatLength(corkscrewRingPitch(selected), s.units)} apart
                        and the tube is Ø{formatLength(spec.outerR * 2, s.units)} across — they
                        wind through one another.{' '}
                        {coilCounted
                          ? `${formatCoarse(Math.abs(coil.height), s.units)} is not enough height for even the quarter turn the count is floored at: raise it to at least ${formatCoarse(coilNeeds / 4, s.units)}, or cut this part from thinner tube.`
                          : `${degLabel(Math.abs(coil.turns))} rings is more than this height holds — drop to ${degLabel(coilFits)}, raise the height to ${formatCoarse(coilNeeds * Math.abs(coil.turns), s.units)}, or let the count be counted.`}
                      </p>
                    )}
                    {/* Bending a channel round a coil rolls it the same way it
                        rolls round a hook — but a coil about the upright rolls
                        it back out again every ring, so the trough stays facing
                        the sky. Worth saying, because the hook next to it in the
                        library does not. */}
                    {!coilClimbs && Math.abs(exitSlope(selected)) > 40 && (
                      <p className="warn">
                        Running at {degLabel(exitSlope(selected))}°, this is more drop than coil —
                        the marble will be falling rather than rolling. Widen it or raise it to
                        take the same height more gently.
                      </p>
                    )}
                  </>
                ) : funnel && bowl ? (
                  <>
                    {/* The feed tube is what makes a funnel a whirl rather than
                        a catch, so it is the first thing settled here — and it
                        is the whole of that choice, since a tube set square
                        across the bowl can only deliver the marble round it, and
                        a plain funnel can only drop it. */}
                    <span className="field-label">
                      Feed
                      <em>
                        {hasLead
                          ? 'a pipe let in through the side of the bowl, square across its radius — the marble comes out going round'
                          : 'a plain funnel — stand something over the mouth and let the marble go into it'}
                      </em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={hasLead ? 'on' : ''}
                        onClick={() => s.updatePiece(selected.id, { leadIn: true })}
                        title="Feed the mouth through a pipe of the funnel's own, let in through the bowl's side wall"
                      >
                        Tube
                      </button>
                      <button
                        className={hasLead ? '' : 'on'}
                        onClick={() => s.updatePiece(selected.id, { leadIn: false })}
                        title="Leave the feed off — a plain funnel, with the mouth for an inlet"
                      >
                        None
                      </button>
                    </div>
                    {hasLead && (
                      /* The one length here that is not a free choice at the
                         bottom end: the tube has to run far enough for its
                         socket to be clear of the bowl it feeds. */
                      <NumberField
                        label="Feed length"
                        hint={`in to the mouth — at least ${formatLength(funnelLeast, s.units)} to stand clear of the bowl`}
                        value={funnel.entry}
                        onChange={(v) => s.updatePiece(selected.id, { length: v })}
                        {...PIECE_LIMITS.length}
                        min={funnelLeast}
                      />
                    )}
                    <NumberField
                      label="Mouth width"
                      hint={`the bowl's opening, inside the wall — the marble runs a smaller circle than this, Ø${lengthText(funnelFeedRadius(funnel) * 2, s.units)}`}
                      value={funnel.mouthRadius * 2}
                      onChange={(v) => s.updatePiece(selected.id, { topDiameter: v })}
                      {...PIECE_LIMITS.topDiameter}
                    />
                    <NumberField
                      label="Bowl depth"
                      hint="mouth down to the throat"
                      value={funnel.depth}
                      onChange={(v) => s.updatePiece(selected.id, { height: v })}
                      {...PIECE_LIMITS.height}
                    />
                    <NumberField
                      label="Rim wall"
                      hint={`the band the marble whirls against — at least ${formatLength(bowl.sill, s.units)}, to hold the feed tube's opening`}
                      value={bowl.rim}
                      onChange={(v) => s.updatePiece(selected.id, { rim: v })}
                      {...PIECE_LIMITS.rim}
                      min={bowl.sill}
                      max={Math.max(bowl.sill, Math.min(PIECE_LIMITS.rim.max, rimRoom))}
                    />
                    {hasLead && (
                      <NumberField
                        label="Times round"
                        hint="how far the marble whirls before it reaches the throat"
                        value={Math.abs(funnel.turns)}
                        onChange={(v) =>
                          s.updatePiece(selected.id, { rings: v * (funnelHand(selected) < 0 ? -1 : 1) })
                        }
                        unit=""
                        min={FUNNEL_TURN_LIMITS.step}
                        max={FUNNEL_TURN_LIMITS.max}
                        step={FUNNEL_TURN_LIMITS.step}
                      />
                    )}
                    {whirls && (
                      <>
                        <span className="field-label">
                          Whirl
                          <em>which way round it goes on the way down</em>
                        </span>
                        <div className="segmented small">
                          <button
                            className={funnel.turns >= 0 ? 'on' : ''}
                            onClick={() =>
                              s.updatePiece(selected.id, { rings: Math.abs(funnel.turns) })
                            }
                            title="Whirl to the right — clockwise seen from above"
                          >
                            Right
                          </button>
                          <button
                            className={funnel.turns < 0 ? 'on' : ''}
                            onClick={() =>
                              s.updatePiece(selected.id, { rings: -Math.abs(funnel.turns) })
                            }
                            title="Whirl to the left — anticlockwise seen from above"
                          >
                            Left
                          </button>
                        </div>
                      </>
                    )}
                    <NumberField
                      label="Lead-out length"
                      hint="the spout — straight down out of the throat"
                      value={funnel.exit}
                      onChange={(v) => s.updatePiece(selected.id, { exitLength: v })}
                      {...PIECE_LIMITS.exitLength}
                    />
                    {/* Only the drain has a style to choose. The feed is a box
                        let into the bowl's wall, and a hole through a wall has
                        no open side to give it. Unset follows the part, which is
                        what Follow the part puts it back to. */}
                    <span className="field-label">
                      Lead-out tube
                      <em>
                        {selected.leadOutVariant
                          ? 'this stub only'
                          : `following the part — ${VARIANT_LABEL[style]}`}
                      </em>
                    </span>
                    <div className="segmented small">
                      {VARIANTS.map((v) => (
                        <button
                          key={v}
                          className={leadOutStyle === v ? 'on' : ''}
                          onClick={() =>
                            s.updatePiece(selected.id, {
                              leadOutVariant: selected.leadOutVariant === v ? undefined : v,
                            })
                          }
                          title={`${VARIANT_NOTE[v]} Click again to follow the part.`}
                        >
                          {VARIANT_LABEL[v]}
                        </button>
                      ))}
                    </div>
                    <div className="readout">
                      <div>
                        <b>{lengthText(funnel.mouthRadius * 2, s.units)}</b>
                        <span>Mouth Ø {UNIT_LABEL[s.units]}</span>
                      </div>
                      <div>
                        <b>{degLabel(Math.abs(funnel.turns))}</b>
                        <span>Times round</span>
                      </div>
                      <div>
                        <b>{coarseText(funnelFall, s.units)}</b>
                        <span>Drop {UNIT_WORD[s.units]}</span>
                      </div>
                    </div>
                    <div className="readout">
                      <div>
                        <b>{coarseText(bowl.rim, s.units)}</b>
                        <span>Rim wall {UNIT_WORD[s.units]}</span>
                      </div>
                      <div>
                        <b>{coarseText(bowl.cone, s.units)}</b>
                        <span>Cone {UNIT_WORD[s.units]}</span>
                      </div>
                      <div>
                        <b>{coarseText(funnelLength(selected), s.units)}</b>
                        <span>Run length {UNIT_WORD[s.units]}</span>
                      </div>
                    </div>
                    <p className="note">
                      {hasLead ? (
                        <>
                          <b>The marble is whirled.</b> The feed is a plain Ø
                          {lengthText(spec.innerR * 2, s.units)} pipe let in through the side of the
                          bowl, square across its radius and set in from the wall so it goes through
                          cleanly rather than grazing down a long slot. So the marble comes out
                          going round rather than at the middle, on a Ø
                          {lengthText(funnelFeedRadius(funnel) * 2, s.units)} circle, and takes{' '}
                          {degLabel(Math.abs(funnel.turns))} turns to the{' '}
                          {funnel.turns < 0 ? 'left' : 'right'} closing in on the throat as it
                          drops. There is no aiming it anywhere else: a bore square across the
                          radius can deliver it no other way. Inside, nothing of the pipe stands
                          past the wall — the mouth is smooth all the way round but for the hole.
                        </>
                      ) : (
                        <>
                          <b>This is a plain funnel.</b> With no feed tube there is nothing aimed
                          across the mouth to set the marble whirling, so it goes in and down — the
                          mouth itself is the inlet. The count is kept for when the tube comes
                          back.
                        </>
                      )}{' '}
                      Either way it leaves down the lead-out, dead vertical: that is the only way
                      out of a funnel, so whatever is bonded under this one starts at 90°.
                    </p>
                    <p className="note">
                      <b>The bowl is level, and so is the feed.</b> A bowl only holds what is level,
                      and a pipe let in through the bowl's own side wall runs its bore out through
                      the rim the moment it is tipped. So the one fall this part runs at is none,
                      stated the way a corkscrew states its own, and the run in front has to be
                      brought to it.{' '}
                      {!hasLead
                        ? 'Nothing mates at the inlet on a plain funnel — stand it under whatever is feeding it, or put the tube back.'
                        : funnel.entry <= funnelLeast
                          ? `The feed is at its shortest here: ${formatLength(funnelLeast, s.units)} is what it takes for the pipe's end to stand clear of a Ø${lengthText(bowl.mouthR * 2, s.units)} bowl, and a shorter one would have its socket half swallowed by it.`
                          : `Anything past ${formatLength(funnelLeast, s.units)} of feed is track into the mouth, and yours.`}
                    </p>
                    {whirls && funnelFeedRadius(funnel) < s.marbleDiameter && (
                      <p className="warn">
                        The marble runs Ø{formatLength(funnelFeedRadius(funnel) * 2, s.units)} round
                        a mouth barely wider than the marble itself — there is nothing here to whirl
                        round. Widen the mouth, or take the feed tube off and drop the marble in.
                      </p>
                    )}
                    {whirls && funnel.depth / Math.abs(funnel.turns) > funnelFeedRadius(funnel) && (
                      <p className="warn">
                        {formatCoarse(funnel.depth, s.units)} of bowl in{' '}
                        {degLabel(Math.abs(funnel.turns))} times round is more drop than whirl — the
                        marble will fall through rather than run round the wall. Add turns, or take
                        some of the depth out.
                      </p>
                    )}
                    <p className="note">
                      The bowl itself is a bowl whatever the run is cut as — closed all the way
                      round, because an open one would let the marble out sideways at the first
                      turn. The feed tube is closed for the same reason and has no style to choose:
                      it is a hole through that wall, and a hole has no open side. Only the drain
                      carries one.
                    </p>
                  </>
                ) : slab ? (
                  <>
                    {/* Above the two spans it sets, because it is those two
                        spans said in one word — the machine the plate has to
                        come off. Everything under it stays typeable. */}
                    <span className="field-label">
                      Printer bed
                      <em>sizes the plate to the machine it prints on</em>
                    </span>
                    <select
                      className="bed-select"
                      value={bed?.id ?? ''}
                      onChange={(e) => s.setBaseBed(selected.id, e.target.value)}
                      title={
                        bed
                          ? `${coarseText(slab.width, s.units)} × ${formatCoarse(slab.depth, s.units)} — the ${bed.name} bed`
                          : 'This plate is not the size of any bed on the list'
                      }
                    >
                      {/* Only ever a read-out: Custom is what the two boxes
                          below say when they say something no printer here
                          has, and there is nothing for picking it to do. */}
                      <option value="" disabled>
                        Custom — {coarseText(slab.width, s.units)} ×{' '}
                        {formatCoarse(slab.depth, s.units)}
                      </option>
                      {PRINTER_BEDS.map((b) => (
                        <option
                          key={b.id}
                          value={b.id}
                          title={b.also.length ? `Same bed: ${b.also.join(', ')}` : b.name}
                        >
                          {b.name} — {coarseText(b.width, s.units)} ×{' '}
                          {formatCoarse(b.depth, s.units)}
                        </option>
                      ))}
                    </select>
                    <p className="note">
                      {bed ? (
                        <>
                          <b>The plate is a {bed.name} bed, corner to corner.</b>{' '}
                          {bed.also.length ? (
                            <>
                              The same bed as {listWords(bed.also)} — one entry, because a plate
                              sized to one is sized to the other.{' '}
                            </>
                          ) : null}
                          Sized right to the edge it leaves nothing for a brim or a skirt to stand
                          in, so take a few {UNIT_WORD[s.units]} off below if the slicer complains.
                        </>
                      ) : (
                        <>
                          <b>Not the size of any bed on the list.</b> Pick one and the plate is
                          sized to it — the two spans only, since a bed says how much floor there
                          is and nothing about how thick the plate on it should be.
                        </>
                      )}{' '}
                      Whichever is picked is remembered: the next base out of the library arrives
                      on that bed.
                    </p>
                    <NumberField
                      label="Width"
                      hint="side to side"
                      value={slab.width}
                      onChange={(v) => s.updatePiece(selected.id, { width: v })}
                      {...BASE_LIMITS.width}
                    />
                    <NumberField
                      label="Depth"
                      hint="front to back"
                      value={slab.depth}
                      onChange={(v) => s.updatePiece(selected.id, { length: v })}
                      {...BASE_LIMITS.depth}
                    />
                    <NumberField
                      label="Thickness"
                      hint="up off the workplane"
                      value={slab.height}
                      onChange={(v) => s.updatePiece(selected.id, { height: v })}
                      {...BASE_LIMITS.height}
                    />
                    <span className="field-label">
                      Corners
                      <em>rounded takes the sharp edge off a printed plate</em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={slab.radius > 0 ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { radius: BASE_DEFAULTS.radius })
                        }
                        title="Round the four upright corners off with an arc tangent to both sides"
                      >
                        Rounded
                      </button>
                      <button
                        className={slab.radius > 0 ? '' : 'on'}
                        onClick={() => s.updatePiece(selected.id, { radius: 0 })}
                        title="Leave the four upright corners square"
                      >
                        Square
                      </button>
                    </div>
                    <NumberField
                      label="Corner radius"
                      hint="0 is a square corner"
                      value={slab.radius}
                      onChange={(v) => s.updatePiece(selected.id, { radius: v })}
                      {...BASE_LIMITS.radius}
                      max={Math.min(BASE_LIMITS.radius.max, Math.min(slab.width, slab.depth) / 2)}
                    />
                    <button
                      onClick={() => footprint && s.fitBaseToRun(selected.id)}
                      disabled={!footprint}
                    >
                      Fit Under the Run
                    </button>
                    <p className="note">
                      {footprint ? (
                        <>
                          Sizes the plate to everything on the stage that is not a base and slides
                          it under the middle of it —{' '}
                          {formatCoarse(footprint.max.x - footprint.min.x, s.units)} ×{' '}
                          {formatCoarse(footprint.max.z - footprint.min.z, s.units)} as it stands,
                          measured to the outside of the tube. The thickness and the corners are
                          left as they are.
                        </>
                      ) : (
                        <>
                          Nothing to fit to yet — there is no run on the stage, only ground. Add a
                          part and the plate can be sized to what it covers.
                        </>
                      )}
                    </p>
                    <p className="note">
                      <b>A base is not part of the run.</b> Nothing plugs into it, the marble never
                      travels it, and it takes no part in any joint — it is the ground the run
                      stands on, which is why it has no bore, no style and no angles. Its underside
                      sits on the workplane and stays there: the move arrows slide it about and the
                      green ring turns it, and neither lifts it off the plane.
                    </p>
                    {slab.radius >= Math.min(slab.width, slab.depth) / 2 - 1e-6 && (
                      <p className="note">
                        Rounded as far as this plate will take —{' '}
                        {slab.width === slab.depth
                          ? 'a square rounded this far is a disc.'
                          : 'the two ends are half-round, which is as far as the short side goes.'}
                      </p>
                    )}
                  </>
                ) : post ? (
                  <>
                    <NumberField
                      label="Length"
                      hint="how far the rod runs"
                      value={post.length}
                      onChange={(v) => s.updatePiece(selected.id, { length: v })}
                      {...SUPPORT_LIMITS.length}
                    />
                    <NumberField
                      label="Thickness"
                      hint="the same both ways across it"
                      value={post.width}
                      onChange={(v) => s.updatePiece(selected.id, { width: v })}
                      {...SUPPORT_LIMITS.width}
                    />
                    <span className="field-label">
                      Section
                      <em>rounded off to half the thickness is a round bar</em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={rodIsRound(post) ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { radius: post.width / 2 })
                        }
                        title="A round bar"
                      >
                        Round
                      </button>
                      <button
                        className={post.radius > 0 && !rodIsRound(post) ? 'on' : ''}
                        onClick={() =>
                          s.updatePiece(selected.id, { radius: Math.min(2, post.width / 4) })
                        }
                        title="A square bar with its four long corners taken off"
                      >
                        Eased
                      </button>
                      <button
                        className={post.radius > 0 ? '' : 'on'}
                        onClick={() => s.updatePiece(selected.id, { radius: 0 })}
                        title="A square bar — the flattest thing to print, lying on its side"
                      >
                        Square
                      </button>
                    </div>
                    <NumberField
                      label="Corner radius"
                      hint="0 is a square bar"
                      value={post.radius}
                      onChange={(v) => s.updatePiece(selected.id, { radius: v })}
                      {...SUPPORT_LIMITS.radius}
                      max={Math.min(SUPPORT_LIMITS.radius.max, post.width / 2)}
                    />
                    <p className="note">
                      <b>A rod is not part of the run.</b> Nothing plugs into it and the marble
                      never travels it — it is a brace, and the whole of what it is is two ends and
                      a thickness. It knows nothing about what it is holding apart, which is what
                      lets one part be a post down to the plate, a tie between two turns of a coil,
                      and a spine run down the outside of one from top to bottom.
                    </p>
                    <p className="note">
                      <b>Where it goes is the Rod tool's business, not this panel's.</b> Take it up
                      and click the two points you want braced; the rod arrives pointing where it
                      was struck, and it is driven a whisker into both ends so it fuses with them
                      rather than merely touching. Slide it afterwards with Move and turn it with
                      the rings, like anything else.
                    </p>
                    <p className="note">
                      It prints lying on its side: a bar flat on the plate with no overhang
                      anywhere in it, whatever line it was struck along up in the air.
                    </p>
                  </>
                ) : (
                  <NumberField
                    label="Length"
                    value={selected.length}
                    onChange={(v) => s.updatePiece(selected.id, { length: v })}
                    {...PIECE_LIMITS.length}
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="note">
              {s.pieces.length
                ? 'No part selected — pick one in Active Parts to edit its length.'
                : 'No parts yet — pick one from Add Part in the top bar.'}
            </p>
          )}
        </div>

        <div className="readout">
          <div>
            <b>{s.pieces.length}</b>
            <span>Pieces</span>
          </div>
          <div>
            <b>{coarseText(totalLength, s.units)}</b>
            <span>Run length {UNIT_WORD[s.units]}</span>
          </div>
          <div>
            <b>{lengthText(joint.depth, s.units)}</b>
            <span>Snap depth {UNIT_WORD[s.units]}</span>
          </div>
        </div>
        <p className="note">
          Every piece is generated with a female socket at its inlet and a barbed male spigot at
          its outlet, so pieces clip together and the bore stays continuous across the joint. Pick
          two ends of the same kind with the Connector and the run you picked first is turned end
          for end to meet the other — same parts, travelled the other way.
        </p>
      </CollapsiblePanel>

      {/* Every angle the draft sets by dragging a joint, typed in exactly —
          read along the run: the angle it starts at, what it does in the
          middle, and the angle it hands on. */}
      {!ground && (
      <CollapsiblePanel title="Angles and Joints">
        {selected ? (
          <>
            <span className="field-label">
              {pieceLabel(selected, selectedIndex)}
              <em>
                {angle || corner
                  ? 'start, break, end'
                  : hook
                    ? `start, turn, end — ${hookLevel ? 'a flat hook leaves at the angle it enters' : 'on edge it leaves at the mirror of it'}`
                    : coil
                      ? 'start and end are the same, and neither is yours to set'
                      : funnel
                        ? 'dead level in, straight down out — neither is yours to set here'
                        : 'a tube leaves at the angle it enters'}
              </em>
            </span>

            <NumberField
              label="Start angle"
              hint={
                angle || corner
                  ? 'the fall the entry leg arrives at'
                  : hook
                    ? 'the fall it comes into the turn at'
                    : coil
                      ? 'worked out — the coil has one fall it can run at. Set it under Fall, which winds the rings to suit'
                      : funnel
                        ? 'a funnel is fed dead level — tip the feed and its bore runs out through the rim'
                        : 'the fall it runs at — negative climbs'
              }
              unit="°"
              readOnly={fixedSlope}
              value={selected.slope}
              onChange={(v) => s.updatePiece(selected.id, { slope: v })}
              {...slopeLimitsFor(selected)}
            />

            {/* Only a connector has a break in it to set. */}
            {angle && (
              <NumberField
                label="Middle angle"
                hint="the break — positive tips the exit leg further down"
                unit="°"
                value={angle.bend}
                onChange={(v) => s.updatePiece(selected.id, { bend: v })}
                {...bendLimits}
              />
            )}
            {corner && (
              <NumberField
                label="Middle angle"
                hint="the break — positive swings the run right"
                unit="°"
                value={corner.sweep}
                onChange={(v) => s.updatePiece(selected.id, { sweep: v })}
                {...sweepLimitsFor(selected)}
              />
            )}
            {hook && (
              <NumberField
                label="Middle angle"
                hint="the turn — positive swings the run right, 180° sends it back"
                unit="°"
                value={hook.sweep}
                onChange={(v) => s.updatePiece(selected.id, { sweep: v })}
                {...sweepLimitsFor(selected)}
              />
            )}

            {/* An angle connector leaves at start + middle, so it can be set
                from either end: type the end angle and the break makes it up.
                The other two parts have no say in what they leave at. */}
            {angle ? (
              <NumberField
                label="End angle"
                hint="the fall it leaves at — the break takes up the difference"
                unit="°"
                value={exitSlope(selected)}
                onChange={(v) =>
                  s.updatePiece(selected.id, { bend: Math.round((v - selected.slope) * 1e3) / 1e3 })
                }
                {...exitLimits}
              />
            ) : (
              <NumberField
                label="End angle"
                hint={
                  corner
                    ? 'worked out — turning across the fall flattens it'
                    : hook
                      ? 'worked out — which way the turn is rolled says what it hands on'
                      : coil
                        ? 'worked out — the coil holds one fall the whole way down'
                        : funnel
                          ? 'straight down the throat — the only way out of a funnel'
                          : 'a straight part leaves at the angle it enters'
                }
                unit="°"
                readOnly
                value={exitSlope(selected)}
                onChange={() => {}}
                {...PIECE_LIMITS.slope}
              />
            )}

            <NumberField
              label="Turn"
              hint={
                !upstream
                  ? 'heading the run sets off on'
                  : turnLimits.max < PIECE_LIMITS.turn.max
                    ? `heading off the part before it — held to ±${degLabel(turnLimits.max)}°, as far as this part's tube can be cut round`
                    : `heading off the part before it — taken up past the socket, not on it`
              }
              unit="°"
              value={selected.turn}
              onChange={(v) => s.updatePiece(selected.id, { turn: v })}
              {...turnLimits}
            />

            <div className="readout">
              <div>
                <b>{degLabel(selected.slope)}°</b>
                <span>Start</span>
              </div>
              {(angle || corner || hook) && (
                <div>
                  <b>{degLabel(angle ? angle.bend : corner ? corner.sweep : hook!.sweep)}°</b>
                  <span>Middle</span>
                </div>
              )}
              <div>
                <b>{degLabel(exitSlope(selected))}°</b>
                <span>End</span>
              </div>
            </div>

            {/* The joint behind this part. The connector itself is always
                straight — see JOINT_LOCK — so what this reports is where the
                part takes up its own aim, and one button for moving that break
                out of the part altogether. */}
            <span className="field-label">
              Inlet joint
              <em>{upstream ? pieceLabel(upstream, selectedIndex - 1) : 'not joined'}</em>
            </span>
            <p className="note">
              {!upstream ? (
                <>
                  Nothing is joined to this part's inlet, so it starts a run of its own — its start
                  angle is the one that run sets off at. Join it on with the Connector in the
                  toolbar.
                </>
              ) : led ? (
                <>
                  {pieceLabel(upstream, selectedIndex - 1)} hands on {degLabel(handedOn)}° and this
                  part {Math.abs(kink) > 0.05 ? `runs at ${degLabel(selected.slope)}°` : ''}
                  {Math.abs(kink) > 0.05 && Math.abs(swing) > 0.05 ? ' and ' : ''}
                  {Math.abs(swing) > 0.05 ? `turns ${degLabel(Math.abs(swing))}°` : ''}, so it plugs
                  in straight and comes round {JOINT_LOCK} mm past the socket. The connector is
                  sound — the bend is in solid tube, clear of the snap.
                  {fixedSlope && (
                    <>
                      {' '}
                      The break is in this part because it cannot be anywhere else —{' '}
                      {funnel
                        ? 'a funnel is fed dead level, and its bowl has to stay level'
                        : 'its fall is its coil’s'}
                      {matchable
                        ? ' — so straightening it out means swinging the part before.'
                        : `, and ${PART_LABEL[upstream.type]} leaves at an angle worked out from its own turn. Put a tube or an angle connector between the two.`}
                    </>
                  )}
                </>
              ) : (
                <>
                  Runs straight on out of {pieceLabel(upstream, selectedIndex - 1)} — both sides of
                  the joint are at {degLabel(handedOn)}°, and the part carries on the way it is fed
                  with no break in it at all.
                </>
              )}
            </p>
            {/* What that break is cut as. Only a bonded part has one — a run's
                head plugs into nothing — and it is the same setting the Rotate
                tool carries in the toolbar, on the part rather than on the tool. */}
            {upstream && (
              <>
                <span className="field-label">
                  Joint pivot
                  <em>rounded carries the marble's speed through the joint</em>
                </span>
                <div className="segmented small">
                  <button
                    className={pivot > 0 ? 'on' : ''}
                    onClick={() => s.setJointFillet(pivot > 0 ? pivot : JOINT_FILLET_DEFAULT, selected.id)}
                    title="Round the break off with an arc tangent to the axis it plugs into and the one it runs on"
                  >
                    Rounded
                  </button>
                  <button
                    className={pivot > 0 ? '' : 'on'}
                    onClick={() => s.setJointFillet(0, selected.id)}
                    title="Meet the two axes at a mitred corner"
                  >
                    Straight
                  </button>
                </div>
                <NumberField
                  label="Joint radius"
                  hint="0 is a mitred corner"
                  value={pivot}
                  onChange={(v) => s.setJointFillet(v, selected.id)}
                  {...PIECE_LIMITS.jointFillet}
                />
                <p className="note">
                  {pivot > 0
                    ? `Rounded off at ${formatLength(pivot, s.units)}. The arc reaches ${formatLength(
                        mitreBite(breakAngleOf(handedOn, selected.turn, selected.slope), pivot),
                        s.units,
                      )} back down the lead, which is straight this part cannot also turn in — so a wider radius holds it to a shallower turn. Right now it may turn ±${degLabel(turnLimits.max)}°.`
                    : `Mitred, which is how a joint is cut unless it is asked not to be. Rounding it off spends lead on the arc, so this part could then turn less than the ±${degLabel(turnLimits.max)}° it can now.`}
                </p>
              </>
            )}
            <button
              onClick={closeJoint}
              disabled={!led || !matchable}
              title={
                !led
                  ? 'This part already runs straight on out of the one before'
                  : !matchable
                    ? 'Neither side of this joint is free to move'
                    : fixedSlope
                      ? funnel
                        ? 'Swing the part before until it hands on the level this funnel is fed at'
                        : 'Swing the part before until it hands on the angle this coil runs at'
                      : 'Set the start angle to whatever the part before hands on'
              }
            >
              {fixedSlope ? 'Bring the Part Before to It' : 'Match the Part Before'}
            </button>
          </>
        ) : (
          <p className="note">
            {s.pieces.length
              ? 'No part selected — pick one in Active Parts to set its angles.'
              : 'No parts yet — pick one from Add Part in the top bar.'}
          </p>
        )}
      </CollapsiblePanel>
      )}
    </aside>
  )
}
