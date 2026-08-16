import NumberField from './NumberField'
import ColorField from './ColorField'
import {
  useRun,
  VARIANT_LABEL,
  PIECE_LIMITS,
  tubeSpec,
  jointSpec,
  pieceLabel,
  pieceTypeLabel,
  PART_LABEL,
  DEFAULT_PIECE_COLOR,
  type TubeVariant,
} from '../store'

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
  const spec = tubeSpec(s.innerDiameter, s.wallThickness, s.variant)
  const selectedIndex = s.pieces.findIndex((p) => p.id === s.selectedId)
  const selected = selectedIndex >= 0 ? s.pieces[selectedIndex] : null
  const totalLength = s.pieces.reduce((a, p) => a + p.length, 0)
  const joint = jointSpec(spec, selected?.length ?? 100)

  return (
    <aside className="sidebar">
      <p className="scope-note">
        Everything below configures the <b>selected part</b>
        {selected ? (
          <>
            {' '}
            — currently <b>{pieceLabel(selected, selectedIndex)}</b>.
          </>
        ) : (
          <>. Pick one in Active Parts or in the list below to edit it.</>
        )}
      </p>

      <section className="panel">
        <h2>Tube Front Face</h2>
        <NumberField
          label="Inner diameter"
          hint="bore the marble rolls in"
          value={s.innerDiameter}
          onChange={s.setInnerDiameter}
          min={6}
          max={80}
          step={0.5}
        />
        <NumberField
          label="Wall thickness"
          hint="outer minus inner"
          value={s.wallThickness}
          onChange={s.setWallThickness}
          min={1}
          max={12}
          step={0.5}
        />
        <div className="readout">
          <div>
            <b>{(spec.outerR * 2).toFixed(1)}</b>
            <span>Outer Ø mm</span>
          </div>
          <div>
            <b>{spec.innerR.toFixed(1)}</b>
            <span>Inner R mm</span>
          </div>
          <div>
            <b>{Math.round((spec.sweep * 180) / Math.PI)}°</b>
            <span>Wall sweep</span>
          </div>
        </div>

        <span className="field-label">Tube variation</span>
        <div className="segmented">
          {VARIANTS.map((v) => (
            <button
              key={v}
              className={s.variant === v ? 'on' : ''}
              onClick={() => s.setVariant(v)}
              title={VARIANT_NOTE[v]}
            >
              {VARIANT_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="note">{VARIANT_NOTE[s.variant]}</p>
      </section>

      <section className="panel">
        <h2>Object</h2>
        <ColorField
          label="Object color"
          hint="3D view only — not exported"
          value={s.pieceColor}
          onChange={s.setPieceColor}
          presets={PIECE_SWATCHES}
        />
        <button className="primary" onClick={s.addPiece}>
          + Add another tube
        </button>

        <div className="piece-list">
          {s.pieces.map((p, i) => {
            const on = p.id === s.selectedId
            return (
              <div key={p.id} className={`piece ${on ? 'on' : ''}`}>
                <button className="piece-head" onClick={() => s.select(on ? null : p.id)}>
                  <span className="tag">{String(i + 1).padStart(2, '0')}</span>
                  <span className="piece-name">{pieceLabel(p, i)}</span>
                  {/* Renamed in the tree — say what the part still is. */}
                  {pieceLabel(p, i) !== pieceTypeLabel(p, i) && (
                    <span className="piece-type">{PART_LABEL[p.type]}</span>
                  )}
                  <span className="piece-dim">
                    {p.length} mm · {p.slope}°
                  </span>
                </button>
                {on && (
                  <div className="piece-body">
                    <NumberField
                      label="Length"
                      value={p.length}
                      onChange={(v) => s.updatePiece(p.id, { length: v })}
                      {...PIECE_LIMITS.length}
                    />
                    <NumberField
                      label="Slope"
                      hint="downhill pitch"
                      value={p.slope}
                      onChange={(v) => s.updatePiece(p.id, { slope: v })}
                      {...PIECE_LIMITS.slope}
                      unit="°"
                    />
                    <NumberField
                      label="Turn"
                      hint="heading change at joint"
                      value={p.turn}
                      onChange={(v) => s.updatePiece(p.id, { turn: v })}
                      {...PIECE_LIMITS.turn}
                      unit="°"
                    />
                    <div className="row-btns">
                      <button onClick={() => s.movePiece(p.id, -1)} disabled={i === 0}>
                        ↑ Up
                      </button>
                      <button
                        onClick={() => s.movePiece(p.id, 1)}
                        disabled={i === s.pieces.length - 1}
                      >
                        ↓ Down
                      </button>
                      <button className="danger" onClick={() => s.removePiece(p.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!s.pieces.length && (
            <p className="note">No parts yet — pick one from Add Part in the top bar.</p>
          )}
        </div>

        <div className="readout">
          <div>
            <b>{s.pieces.length}</b>
            <span>Pieces</span>
          </div>
          <div>
            <b>{totalLength}</b>
            <span>Run length mm</span>
          </div>
          <div>
            <b>{joint.depth.toFixed(1)}</b>
            <span>Snap depth mm</span>
          </div>
        </div>
        <p className="note">
          Every piece is generated with a female socket at its inlet and a barbed male spigot at
          its outlet, so pieces clip together and the bore stays continuous across the joint.
        </p>
      </section>
    </aside>
  )
}
