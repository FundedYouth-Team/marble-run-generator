import { useEffect, useState } from 'react'
import NumberField from './NumberField'
import ColorField from './ColorField'
import InfoNote from './InfoNote'
import CollapsiblePanel from './CollapsiblePanel'
import ExportPanel from './ExportPanel'
import CalibrateScreen from './CalibrateScreen'
import {
  useRun,
  STANDARD_MARBLE,
  STANDARD_BORE,
  MARBLE_CLEARANCE,
  DEFAULT_MARBLE_COLOR,
} from '../store'
import { UNIT_NAME, formatDensity, formatLength, type Unit } from '../lib/units'

/** Millimetres first: it is the default, and what the model is kept in. */
const UNITS: Unit[] = ['mm', 'in']

/** First entry is the default, so clicking it restores the stock look. */
const MARBLE_SWATCHES = [DEFAULT_MARBLE_COLOR, '#2a9e35', '#f2c94c', '#e2464e', '#3fa9f5', '#f5f7fa']

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

/**
 * Slide-out settings: how the marble behaves and how the run leaves the app.
 * Everything here is about the run as a whole, not any one part — the parts
 * themselves live in the sidebar and the on-stage list.
 */
export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useRun()
  const [calibrating, setCalibrating] = useState(false)
  const standardFit = s.marbleDiameter === STANDARD_MARBLE && s.innerDiameter === STANDARD_BORE

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // Closed, it is only parked off-screen — inert keeps it out of the tab order too.
    <aside className={open ? 'parts-panel open' : 'parts-panel'} inert={!open}>
      <header className="parts-head">
        <h3>Settings</h3>
        <button className="help-close" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </header>

      <div className="parts-body">
        <CollapsiblePanel title="Units" defaultOpen={false}>
          <span className="field-label">
            Show measurements in
            <em>every length in the app, both stages and the sidebar</em>
          </span>
          <div className="segmented">
            {UNITS.map((u) => (
              <button
                key={u}
                className={s.units === u ? 'on' : ''}
                aria-pressed={s.units === u}
                onClick={() => s.setUnits(u)}
                title={`Show every measurement in ${UNIT_NAME[u].toLowerCase()}`}
              >
                {UNIT_NAME[u]}
              </button>
            ))}
          </div>
          <InfoNote label="Does this change my model?">
            No. The run is held in millimetres whichever you pick, and every exported STL or 3MF is
            in millimetres too — that is what slicers expect. This only changes the numbers you read
            and type: {formatLength(STANDARD_MARBLE, 'mm')} and{' '}
            {formatLength(STANDARD_MARBLE, 'in')} are the same marble.
          </InfoNote>
        </CollapsiblePanel>

        <CollapsiblePanel title="Marble Size & Color" defaultOpen={false}>
          <NumberField
            label="Marble diameter"
            hint={`a standard glass marble is ${formatLength(STANDARD_MARBLE, s.units)}`}
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
            A shop-bought glass marble is about {formatLength(STANDARD_MARBLE, s.units)} across.
            Reset sets the marble to that and opens the bore to{' '}
            {formatLength(STANDARD_BORE, s.units)} — {formatLength(MARBLE_CLEARANCE, s.units)} of
            slack so it rolls instead of jamming. Scale both however you like; this brings them back.
          </InfoNote>
          <ColorField
            label="Ball color"
            hint="3D view only"
            value={s.marbleColor}
            onChange={s.setMarbleColor}
            presets={MARBLE_SWATCHES}
          />
          {/* Sits with the size controls — it is the diameter, not the physics, that is wrong. */}
          {s.marbleDiameter >= s.innerDiameter && (
            <p className="warn">Marble is larger than the bore — it will not fit.</p>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel title="Marble Simulator" defaultOpen={false}>
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
        </CollapsiblePanel>

        <CollapsiblePanel title="Screen & Scale" defaultOpen={false}>
          <div className="setting-row">
            <span>{s.screenCalibrated ? 'Calibrated' : 'Not calibrated'}</span>
            <span className="setting-value">{formatDensity(s.screenPxPerMm, s.units)}</span>
          </div>
          <button onClick={() => setCalibrating(true)}>
            {s.screenCalibrated ? 'Re-calibrate screen…' : 'Calibrate screen…'}
          </button>
          <InfoNote label="Why does my run not measure right on screen?">
            A browser cannot ask your monitor how big it is, so out of the box the app assumes a
            standard density and is usually off by a third or more. Hold a bank card up to the
            calibration screen once and the 2D draft's <strong>1:1</strong> button will show your
            run at true physical size.
          </InfoNote>
        </CollapsiblePanel>

        <ExportPanel />
      </div>

      <CalibrateScreen open={calibrating} onClose={() => setCalibrating(false)} />
    </aside>
  )
}
