import NumberField from './NumberField'
import ColorField from './ColorField'
import CollapsiblePanel from './CollapsiblePanel'
import HoverHint from './HoverHint'
import { pieceAxisLength } from '../lib/centerline'
import {
  useRun,
  VARIANT_LABEL,
  PIECE_LIMITS,
  TUBE_LIMITS,
  ANGLE_DEFAULTS,
  CORNER_DEFAULTS,
  angleSpec,
  cornerSpec,
  bendLimitsFor,
  slopeLimitsFor,
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

      <CollapsiblePanel title="Tube Diameter">
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
                ) : (
                  <NumberField
                    label="Length"
                    value={selected.length}
                    onChange={(v) => s.updatePiece(selected.id, { length: v })}
                    {...PIECE_LIMITS.length}
                  />
                )}
                <div className="row-btns">
                  <button className="danger" onClick={() => s.removePiece(selected.id)}>
                    Delete
                  </button>
                </div>
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
          its outlet, so pieces clip together and the bore stays continuous across the joint.
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
                {angle
                  ? 'start, break, end'
                  : corner
                    ? 'start, break, end'
                    : 'a tube leaves at the angle it enters'}
              </em>
            </span>

            <NumberField
              label="Start angle"
              hint={
                angle || corner
                  ? 'the fall the entry leg arrives at'
                  : 'the fall it runs at — negative climbs'
              }
              unit="°"
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
                {...PIECE_LIMITS.sweep}
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
              {(angle || corner) && (
                <div>
                  <b>{degLabel(angle ? angle.bend : corner!.sweep)}°</b>
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
                </>
              ) : (
                <>
                  Sits flush on {pieceLabel(upstream, selectedIndex - 1)} — both sides of the joint
                  are at {degLabel(handedOn)}°.
                </>
              )}
            </p>
            <button
              onClick={() => {
                const L = slopeLimitsFor(selected)
                s.updatePiece(selected.id, {
                  slope: Math.min(L.max, Math.max(L.min, handedOn)),
                })
              }}
              disabled={!open}
              title={
                open
                  ? 'Set the start angle to whatever the part before hands on'
                  : 'The joint is already closed'
              }
            >
              Match the Part Before
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

      <CollapsiblePanel title="Duplicate Part">
        <button
          className="primary"
          onClick={() => selected && s.duplicatePiece(selected.id)}
          disabled={!selected}
          title={selected ? undefined : 'Select a part first'}
        >
          + Duplicate Selected Part
        </button>
        <p className="note">
          {selected
            ? `Sets a copy of ${pieceLabel(selected, selectedIndex)} down beside the run, unjoined, and selects it.`
            : 'Select a part to copy it.'}
        </p>
      </CollapsiblePanel>
    </aside>
  )
}
