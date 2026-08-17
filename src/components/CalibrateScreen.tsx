import { useEffect, useState } from 'react'
import {
  useRun,
  NOMINAL_PX_PER_MM,
  PX_PER_MM_MIN,
  PX_PER_MM_MAX,
  REFERENCE_CARD_MM,
} from '../store'
import { formatDensity, formatLength } from '../lib/units'

/**
 * Teaches the app how big a millimetre is on this particular screen.
 *
 * There is no way to ask: CSS fixes an inch at 96px whatever the panel really
 * is, and `devicePixelRatio` reports CSS-to-device pixels, not physical size.
 * So the measurement has to come from the one instrument the user already has
 * — a bank card, which is the same 85.6mm the world over.
 */
export default function CalibrateScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stored = useRun((s) => s.screenPxPerMm)
  const units = useRun((s) => s.units)
  const setScreenPxPerMm = useRun((s) => s.setScreenPxPerMm)
  const resetScreenCalibration = useRun((s) => s.resetScreenCalibration)

  // Local until saved, so backing out leaves the stored value untouched.
  const [pxPerMm, setPxPerMm] = useState(stored)

  // Re-open always starts from what is actually in force, not last session's fiddling.
  useEffect(() => {
    if (open) setPxPerMm(stored)
  }, [open, stored])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const cardW = pxPerMm * REFERENCE_CARD_MM
  // ID-1 is 85.6 x 53.98; keeping the real ratio makes a mismatch obvious.
  const cardH = cardW * (53.98 / 85.6)
  const dpi = Math.round(pxPerMm * 25.4)

  const save = () => {
    setScreenPxPerMm(pxPerMm)
    onClose()
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-sheet calibrate-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Calibrate screen"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="help-head">
          <h3>Calibrate Screen</h3>
          <button className="help-close" onClick={onClose} aria-label="Close calibration">
            ✕
          </button>
        </header>

        <div className="help-body calibrate-body">
          <p className="calibrate-lead">
            Hold a bank card, library card, or any ID card flat against your screen and drag the
            slider until the outline below is exactly the same size as the card.
          </p>

          <div className="calibrate-stage">
            <div className="calibrate-card" style={{ width: cardW, height: cardH }}>
              <span>{formatLength(REFERENCE_CARD_MM, units)}</span>
            </div>
          </div>

          <input
            className="calibrate-slider"
            type="range"
            min={PX_PER_MM_MIN}
            max={PX_PER_MM_MAX}
            step={0.01}
            value={pxPerMm}
            onChange={(e) => setPxPerMm(Number(e.target.value))}
            aria-label="Card width"
          />

          <div className="calibrate-readout">
            <span>
              {formatDensity(pxPerMm, units)} · about {dpi} dpi
            </span>
            <button
              className="link-btn"
              onClick={() => setPxPerMm(NOMINAL_PX_PER_MM)}
              disabled={Math.abs(pxPerMm - NOMINAL_PX_PER_MM) < 0.005}
            >
              Back to default
            </button>
          </div>

          <p className="calibrate-note">
            Once saved, the <strong>1:1</strong> button in the 2D draft toolbar sets the zoom so the
            drawing is true physical size — a ruler held to the screen will match. Calibration is
            per-display, so redo it if you move the window to another monitor.
          </p>
        </div>

        <footer className="calibrate-foot">
          <button
            className="link-btn"
            onClick={() => {
              resetScreenCalibration()
              onClose()
            }}
          >
            Clear calibration
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
