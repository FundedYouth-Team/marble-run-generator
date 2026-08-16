import NumberField from './NumberField'
import ColorField from './ColorField'
import CollapsiblePanel from './CollapsiblePanel'
import {
  useRun,
  VARIANT_LABEL,
  PIECE_LIMITS,
  TUBE_LIMITS,
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
      <header className="scope-head">
        <h2>
          Selected Part Details
          <span className={selected ? 'scope-name' : 'scope-name none'}>
            {selected ? pieceLabel(selected, selectedIndex) : 'none'}
          </span>
        </h2>
        {/* Only length is per-piece — the rest of the sidebar is run-wide. */}
        <p className="scope-note">
          {selected ? (
            <>
              Length belongs to this part alone. Tube diameter, style, and color apply to every
              part in the run.
            </>
          ) : (
            <>
              Pick a part in Active Parts or the list below to edit its length. Tube diameter,
              style, and color apply to every part in the run.
            </>
          )}
        </p>
      </header>

      <CollapsiblePanel title="Tube Diameter">
        <NumberField
          label="Inner diameter"
          hint="bore the marble rolls in"
          value={s.innerDiameter}
          onChange={s.setInnerDiameter}
          {...TUBE_LIMITS.innerDiameter}
        />
        <NumberField
          label="Wall thickness"
          hint="outer minus inner"
          value={s.wallThickness}
          onChange={s.setWallThickness}
          {...TUBE_LIMITS.wallThickness}
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
      </CollapsiblePanel>

      <CollapsiblePanel title="Tube Style">
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
      </CollapsiblePanel>

      <CollapsiblePanel title="Color">
        <ColorField
          label="Object color"
          hint="3D view only — not exported"
          value={s.pieceColor}
          onChange={s.setPieceColor}
          presets={PIECE_SWATCHES}
        />
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
                <span className="piece-dim">{selected.length} mm</span>
              </div>
              <div className="piece-body">
                <NumberField
                  label="Length"
                  value={selected.length}
                  onChange={(v) => s.updatePiece(selected.id, { length: v })}
                  {...PIECE_LIMITS.length}
                />
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
            ? `Adds a copy of ${pieceLabel(selected, selectedIndex)} right after it, and selects the copy.`
            : 'Select a part to copy it.'}
        </p>
      </CollapsiblePanel>
    </aside>
  )
}
