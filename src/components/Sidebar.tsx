import NumberField from './NumberField'
import ColorField from './ColorField'
import InfoNote from './InfoNote'
import CollapsiblePanel from './CollapsiblePanel'
import ExportPanel from './ExportPanel'
import {
  useRun,
  VARIANT_LABEL,
  PIECE_LIMITS,
  tubeSpec,
  jointSpec,
  pieceLabel,
  STANDARD_MARBLE,
  STANDARD_BORE,
  MARBLE_CLEARANCE,
  DEFAULT_PIECE_COLOR,
  DEFAULT_MARBLE_COLOR,
  type TubeVariant,
} from '../store'

const VARIANTS: TubeVariant[] = ['half', 'threequarter', 'closed']

/** First entry is the default, so clicking it restores the stock look. */
const PIECE_SWATCHES = [DEFAULT_PIECE_COLOR, '#2a9e35', '#2b6cb0', '#c2410c', '#e6e9ee', '#2a2f3a']
const MARBLE_SWATCHES = [DEFAULT_MARBLE_COLOR, '#2a9e35', '#f2c94c', '#e2464e', '#3fa9f5', '#f5f7fa']

const VARIANT_NOTE: Record<TubeVariant, string> = {
  half: 'Open trough — 180° of wall, marble fully visible.',
  threequarter: '70% wall with a slot on top to see into the tube.',
  closed: 'Full 360° tube — marble enclosed.',
}

/** A plain length of pipe: flat-cut ends, with the bore showing at the near end. */
function TubePreview() {
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true">
      <rect className="pp-body" x="6" y="8" width="30" height="15" />
      <ellipse className="pp-bore" cx="36" cy="15.5" rx="4" ry="7.5" />
      <ellipse className="pp-hole" cx="36" cy="15.5" rx="2" ry="4.3" />
    </svg>
  )
}

function CurvePreview() {
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M6 24c0-9 8-16 17-16 9 0 17 4 17 9" />
    </svg>
  )
}

function DropPreview() {
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true">
      <path className="pp-line" d="M12 5c10 0 10 6 0 6s-10 6 0 6 12 4 12 8" />
    </svg>
  )
}

/** Plain-English read-out for the grip slider, so the number is never the only clue. */
function gripWord(friction: number) {
  if (friction <= 0.04) return 'like ice'
  if (friction <= 0.12) return 'fast roll'
  if (friction <= 0.24) return 'steady roll'
  return 'slow, draggy roll'
}

function speedWord(timeScale: number) {
  if (timeScale < 0.7) return 'slow motion'
  if (timeScale <= 1.3) return 'normal speed'
  if (timeScale <= 2) return 'quick'
  return 'super fast'
}

export default function Sidebar() {
  const s = useRun()
  const spec = tubeSpec(s.innerDiameter, s.wallThickness, s.variant)
  const selected = s.pieces.find((p) => p.id === s.selectedId) ?? null
  const totalLength = s.pieces.reduce((a, p) => a + p.length, 0)
  const joint = jointSpec(spec, selected?.length ?? 100)
  const standardFit = s.marbleDiameter === STANDARD_MARBLE && s.innerDiameter === STANDARD_BORE

  return (
    <aside className="sidebar">
      <section className="panel">
        <h2>Part Type</h2>
        <div className="part-grid">
          <button className="part-card" onClick={s.addPiece} title="Add a tube to the stage">
            <TubePreview />
            <span>Tube</span>
          </button>
          <button className="part-card" disabled title="Not available yet">
            <CurvePreview />
            <span>Curve</span>
            <em>soon</em>
          </button>
          <button className="part-card" disabled title="Not available yet">
            <DropPreview />
            <span>Drop</span>
            <em>soon</em>
          </button>
        </div>
        <p className="note">Click a part to drop it on the stage at the end of the run.</p>
      </section>

      <CollapsiblePanel title="Marble & Simulator" defaultOpen={false}>
        <NumberField
          label="Marble diameter"
          hint={`a standard glass marble is ${STANDARD_MARBLE} mm`}
          value={s.marbleDiameter}
          onChange={s.setMarbleDiameter}
          min={3}
          max={Math.max(4, s.innerDiameter - 1)}
          step={0.5}
        />
        <button onClick={s.resetMarbleFit} disabled={standardFit}>
          ↺ {standardFit ? 'Standard marble size' : 'Reset to standard marble'}
        </button>
        <InfoNote label="What is the standard marble size?">
          A shop-bought glass marble is about {STANDARD_MARBLE} mm across. Reset sets the marble to
          that and opens the bore to {STANDARD_BORE} mm — {MARBLE_CLEARANCE} mm of slack so it rolls
          instead of jamming. Scale both however you like; this brings them back.
        </InfoNote>
        <ColorField
          label="Ball color"
          hint="3D view only"
          value={s.marbleColor}
          onChange={s.setMarbleColor}
          presets={MARBLE_SWATCHES}
        />
        <NumberField
          label="Tube grip"
          hint={gripWord(s.friction)}
          value={s.friction}
          onChange={s.setFriction}
          min={0}
          max={0.4}
          step={0.01}
          unit=""
          ends={['Slippery — fast roll', 'Grippy — slow roll']}
        />
        <InfoNote label="What does grip do?">
          How much the tube slows the marble down. Slippery tubes let it fly; grippy ones hold it
          back. This changes the run itself — a grippy tube may not make it round a loop.
        </InfoNote>
        <NumberField
          label="Watch speed"
          hint={speedWord(s.timeScale)}
          value={s.timeScale}
          onChange={s.setTimeScale}
          min={0.1}
          max={3}
          step={0.1}
          unit="×"
          ends={['Slow-mo', 'Fast-forward']}
        />
        <InfoNote label="What does watch speed do?">
          Only changes how fast you watch, like slow-mo on a video. The marble itself rolls the
          same either way.
        </InfoNote>
        <label className="check">
          <input type="checkbox" checked={s.loop} onChange={(e) => s.setLoop(e.target.checked)} />
          Loop the marble
        </label>
        {s.marbleDiameter >= s.innerDiameter && (
          <p className="warn">Marble is larger than the bore — it will not fit.</p>
        )}
      </CollapsiblePanel>

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
          {!s.pieces.length && <p className="note">No parts yet — pick one from Part Type above.</p>}
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

      <ExportPanel />
    </aside>
  )
}
