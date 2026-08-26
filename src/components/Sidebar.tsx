import NumberField from './NumberField'
import ColorField from './ColorField'
import CollapsiblePanel from './CollapsiblePanel'
import HoverHint from './HoverHint'
import { pieceAxisLength } from '../lib/centerline'
import { FUNNEL_LEAST_CONE } from '../lib/funnel'
import {
  useRun,
  VARIANT_LABEL,
  PIECE_LIMITS,
  TUBE_LIMITS,
  ANGLE_DEFAULTS,
  CORNER_DEFAULTS,
  angleSpec,
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
  COIL_RING_GAP,
  HOOK_ROLL_FLAT,
  HOOK_ROLL_EDGE,
  FUNNEL_TILT_LIMITS,
  FUNNEL_TURN_LIMITS,
  FUNNEL_TURNS_DROP,
  FUNNEL_TURNS_SPIRAL,
  funnelSpec,
  funnelBowlOf,
  funnelDrop as funnelDropOf,
  funnelHand,
  funnelHasLead,
  funnelLength,
  funnelReach,
  funnelStubVariant,
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
  jointSpec,
  pieceLabel,
  pieceTypeLabel,
  PART_LABEL,
  DEFAULT_PIECE_COLOR,
  type TubeVariant,
} from '../store'
import { UNIT_LABEL, UNIT_WORD, coarseText, formatCoarse, formatLength, lengthText } from '../lib/units'

const VARIANTS: TubeVariant[] = ['half', 'threequarter', 'closed']

/** First entry is the default, so clicking it restores the stock look. */
const PIECE_SWATCHES = [DEFAULT_PIECE_COLOR, '#2a9e35', '#2b6cb0', '#c2410c', '#e6e9ee', '#2a2f3a']

const VARIANT_NOTE: Record<TubeVariant, string> = {
  half: 'Open trough — 180° of wall, marble fully visible.',
  threequarter: '70% wall with a slot on top to see into the tube.',
  closed: 'Full 360° tube — marble enclosed.',
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
  const spec = tubeSpec(bore, wall, style)
  // Centreline length, so a bent part counts what it actually carries.
  const totalLength = s.pieces.reduce((a, p) => a + pieceAxisLength(p), 0)
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
  const funnel = selected && selected.type === 'funnel' ? funnelSpec(selected) : null
  const funnelFall = selected && funnel ? funnelDropOf(selected) : 0
  /** The bowl as it is actually cut, off this part's own tube. */
  const bowl = selected && funnel ? funnelBowlOf(selected, spec.innerR, spec.wall) : null
  /** How far the feed has to run before there is collar underneath it. */
  const funnelLeast = selected && funnel ? funnelReach(selected, spec.innerR, spec.wall) : 0
  /** Whether the marble is whirled round the bowl rather than dropped straight in. */
  const whirls = !!selected && !!funnel && funnelWhirls(selected)
  /** Whether the funnel is fed by a lead-in of its own, or is a bare bowl. */
  const hasLead = !!selected && !!funnel && funnelHasLead(selected)
  /** What each stub is actually cut in — its own style, or the part's. */
  const leadInStyle = selected && funnel ? funnelStubVariant(selected, s.variant, 'lead') : style
  const leadOutStyle = selected && funnel ? funnelStubVariant(selected, s.variant, 'drain') : style
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
  // What the part before hands this one, if the two are actually joined. With
  // Keep connected off they can drift apart, and the joint is what opens up; an
  // unjoined part has no joint behind it at all.
  const upstream =
    selected && selectedIndex > 0 && selected.joined ? s.pieces[selectedIndex - 1] : null
  const handedOn = upstream ? exitSlope(upstream) : 0
  const kink = selected && upstream ? selected.slope - handedOn : 0
  const open = Math.abs(kink) > 0.05
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
    !fixedSlope || (!!upstream && (upstream.type === 'straight' || upstream.type === 'angle'))

  const hold = (v: number, lim: { min: number; max: number }) =>
    Math.min(lim.max, Math.max(lim.min, v))

  const closeJoint = () => {
    if (!selected) return
    if (!fixedSlope) {
      s.updatePiece(selected.id, { slope: hold(handedOn, slopeLimitsFor(selected)) })
      return
    }
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
      </CollapsiblePanel>

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
                <span className="piece-dim">{formatCoarse(selectedLength, s.units)}</span>
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
                          goes, so this is where a coil is given a fall of its own: fewer rings
                          over the same height is a steeper one, more is gentler.
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
                    {/* The lead-in is what makes a funnel a whirl rather than a
                        catch, so it is the first thing settled here. */}
                    <span className="field-label">
                      Lead-in
                      <em>the tube that feeds the mouth, and points the marble round it</em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={hasLead ? 'on' : ''}
                        onClick={() => s.updatePiece(selected.id, { leadIn: true })}
                        title="Feed the mouth through a tube of the funnel's own, cut in through the collar"
                      >
                        Tube
                      </button>
                      <button
                        className={hasLead ? '' : 'on'}
                        onClick={() => s.updatePiece(selected.id, { leadIn: false })}
                        title="Leave the lead-in off — a bare bowl, with the mouth for an inlet"
                      >
                        None
                      </button>
                    </div>
                    {hasLead && (
                      /* The one length here that is not a free choice at the
                         bottom end: the lead-in has to reach out through the
                         collar before there is anything holding it up. */
                      <NumberField
                        label="Lead-in length"
                        hint={`in to the mouth — at least ${formatLength(funnelLeast, s.units)} to reach the collar`}
                        value={funnel.entry}
                        onChange={(v) => s.updatePiece(selected.id, { length: v })}
                        {...PIECE_LIMITS.length}
                        min={funnelLeast}
                      />
                    )}
                    {hasLead && (
                      /* The one angle a funnel has. It is the part's own fall —
                         the run is brought to it — and the bowl stays level
                         under it whatever it is set to. */
                      <NumberField
                        label="Feed tilt"
                        hint={
                          funnel.tilt
                            ? 'the lead-in runs downhill into the mouth; the bowl stays level'
                            : 'the lead-in runs in level — tip it to feed the mouth downhill'
                        }
                        value={funnel.tilt}
                        onChange={(v) => s.updatePiece(selected.id, { tilt: v })}
                        unit="°"
                        {...FUNNEL_TILT_LIMITS}
                        ends={['Level', `${FUNNEL_TILT_LIMITS.max}° down`]}
                      />
                    )}
                    <NumberField
                      label="Mouth width"
                      hint="the bowl's opening, inside the wall — the marble is let go onto it"
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
                      hint={`the band the marble whirls against — at least ${formatLength(bowl.sill, s.units)}, to hold the lead-in's opening`}
                      value={bowl.rim}
                      onChange={(v) => s.updatePiece(selected.id, { rim: v })}
                      {...PIECE_LIMITS.rim}
                      min={bowl.sill}
                      max={Math.max(bowl.sill, Math.min(PIECE_LIMITS.rim.max, rimRoom))}
                    />
                    {/* Whirled or dropped is one number — how many times round —
                        so the two buttons set that number rather than a mode of
                        their own. Nought of them is the marble going straight in,
                        and so is having no lead-in to point it round. */}
                    <span className="field-label">
                      Feed
                      <em>
                        {hasLead
                          ? 'round the wall on its own speed, or straight down into it'
                          : 'a bare bowl takes it straight in — nothing is aimed across the mouth'}
                      </em>
                    </span>
                    <div className="segmented small">
                      <button
                        className={whirls ? 'on' : ''}
                        disabled={!hasLead}
                        onClick={() =>
                          s.updatePiece(selected.id, {
                            rings: whirls
                              ? funnel.turns
                              : FUNNEL_TURNS_SPIRAL * (funnelHand(selected) < 0 ? -1 : 1),
                          })
                        }
                        title={
                          hasLead
                            ? 'Deliver the marble across the mouth, so it whirls round the bowl on its way down'
                            : 'A bare bowl has no lead-in to whirl the marble with'
                        }
                      >
                        Whirl
                      </button>
                      <button
                        className={whirls ? '' : 'on'}
                        disabled={!hasLead}
                        onClick={() => s.updatePiece(selected.id, { rings: FUNNEL_TURNS_DROP })}
                        title="Deliver the marble straight into the bowl, so it slides down the wall"
                      >
                        Drop in
                      </button>
                    </div>
                    {hasLead && (
                      <NumberField
                        label="Times round"
                        hint="how far the marble whirls before it reaches the throat — 0 goes straight in"
                        value={Math.abs(funnel.turns)}
                        onChange={(v) =>
                          s.updatePiece(selected.id, { rings: v * (funnelHand(selected) < 0 ? -1 : 1) })
                        }
                        unit=""
                        min={0}
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
                    {/* The two ends of a funnel do different jobs, so each is cut
                        in a style of its own rather than both following the
                        part's. Unset is that fallback, which is what Follow the
                        part puts them back to. */}
                    {hasLead && (
                      <>
                        <span className="field-label">
                          Lead-in tube
                          <em>
                            {selected.leadInVariant
                              ? 'this stub only'
                              : `following the part — ${VARIANT_LABEL[style]}`}
                          </em>
                        </span>
                        <div className="segmented small">
                          {VARIANTS.map((v) => (
                            <button
                              key={v}
                              className={leadInStyle === v ? 'on' : ''}
                              onClick={() =>
                                s.updatePiece(selected.id, {
                                  leadInVariant: selected.leadInVariant === v ? undefined : v,
                                })
                              }
                              title={`${VARIANT_NOTE[v]} Click again to follow the part.`}
                            >
                              {VARIANT_LABEL[v]}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
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
                      {whirls ? (
                        <>
                          <b>The marble is whirled.</b> The lead-in comes in through a hole cut in
                          the collar and stops just past the wall, aimed across the mouth rather
                          than at it — so the marble leaves it still travelling the way the run
                          was, goes {degLabel(Math.abs(funnel.turns))} times round to the{' '}
                          {funnel.turns < 0 ? 'left' : 'right'} against the collar, and closes in
                          on the throat as it drops. Held out against the wall by its own speed the
                          whole way, which is what a funnel is really for.
                        </>
                      ) : hasLead ? (
                        <>
                          <b>The marble is dropped in.</b> The lead-in opens through the collar
                          pointing at the middle, and the marble slides straight down the far wall
                          to the throat. This is the same bowl with the whirl wound out of it — put
                          any number of times round back in and the mouth swings round beside the
                          lead-in instead of sitting ahead of it.
                        </>
                      ) : (
                        <>
                          <b>This is a bare bowl.</b> With no lead-in there is nothing aimed across
                          the mouth to set the marble whirling, so it goes in and down whatever the
                          count says — the mouth itself is the inlet, and the count is kept for
                          when the lead-in comes back.
                        </>
                      )}{' '}
                      Either way it leaves down the lead-out, dead vertical: that is the only way
                      out of a funnel, so whatever is bonded under this one starts at 90°.
                    </p>
                    <p className="note">
                      <b>The bowl is level and stays level.</b> A bowl only holds what is level, so
                      the one angle this part has is the lead-in's: tip the feed and the whole part
                      is stood at that fall with the bowl built back to level inside it. Past a few
                      degrees the lead-in climbs out of the collar it is let through and hangs over
                      the bowl joined to nothing, which is why the tilt stops where it does. Either
                      way this part states its fall the way a corkscrew states its own, and the run
                      in front has to be brought to it.{' '}
                      {!hasLead
                        ? 'Nothing mates at the inlet on a bare bowl — stand it under whatever is feeding it, or put the lead-in back.'
                        : funnel.entry <= funnelLeast
                          ? `The lead-in is at its shortest here: ${formatLength(funnelLeast, s.units)} is what it takes to reach out through a Ø${lengthText(funnel.mouthRadius * 2, s.units)} collar ${whirls ? 'along the tangent' : 'straight on'}, and a shorter one would stop inside the bowl with nothing holding it.`
                          : `Anything past ${formatLength(funnelLeast, s.units)} of lead-in is track into the mouth, and yours.`}
                    </p>
                    {whirls && funnel.mouthRadius < s.marbleDiameter && (
                      <p className="warn">
                        The marble runs Ø{formatLength(funnel.mouthRadius * 2, s.units)} round a
                        mouth barely wider than the marble itself — there is nothing here to whirl
                        round. Widen the mouth, or drop the marble straight in.
                      </p>
                    )}
                    {whirls && funnel.depth / Math.abs(funnel.turns) > funnel.mouthRadius && (
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
                      turn. Only the two stubs carry a style, and each carries its own.
                      {whirls && leadInStyle !== 'closed'
                        ? ' A lead-in aimed across the mouth is worth closing: an open one lets the marble go before it has been pointed anywhere.'
                        : ''}
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
                        ? 'in at the feed tilt, straight down out — neither is yours to set here'
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
                      ? 'worked out — the coil has one fall it can run at'
                      : funnel
                        ? 'the lead-in’s own tilt — set it with Feed tilt above'
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
              hint="heading at the inlet, off the part before it"
              unit="°"
              value={selected.turn}
              onChange={(v) => s.updatePiece(selected.id, { turn: v })}
              {...PIECE_LIMITS.turn}
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

            {/* The joint behind this part: two angles that should agree, and
                one button for when they do not. */}
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
              ) : open ? (
                <>
                  {pieceLabel(upstream, selectedIndex - 1)} hands on {degLabel(handedOn)}° and this
                  part starts at {degLabel(selected.slope)}° — the joint is open by{' '}
                  {degLabel(Math.abs(kink))}°.
                  {fixedSlope && (
                    <>
                      {' '}
                      This part cannot come to meet it —{' '}
                      {funnel
                        ? 'its fall is its lead-in’s tilt, and its bowl has to stay level'
                        : 'its fall is its coil’s'}{' '}
                      — so it is the part before that has to be brought round
                      {matchable
                        ? '.'
                        : `, and ${PART_LABEL[upstream.type]} leaves at an angle worked out from its own turn. Put a tube or an angle connector between the two.`}
                    </>
                  )}
                </>
              ) : (
                <>
                  Sits flush on {pieceLabel(upstream, selectedIndex - 1)} — both sides of the joint
                  are at {degLabel(handedOn)}°.
                </>
              )}
            </p>
            <button
              onClick={closeJoint}
              disabled={!open || !matchable}
              title={
                !open
                  ? 'The joint is already closed'
                  : !matchable
                    ? 'Neither side of this joint is free to move'
                    : fixedSlope
                      ? funnel
                        ? 'Swing the part before until it hands on the tilt this funnel is fed at'
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
    </aside>
  )
}
