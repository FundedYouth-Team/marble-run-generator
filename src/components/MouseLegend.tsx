import { useEffect, useRef, useState } from 'react'

/** Which parts of the mouse are lit up right now. */
interface Lit {
  left: boolean
  right: boolean
  wheel: boolean
}

const DARK: Lit = { left: false, right: false, wheel: false }
/** A scroll has no "release", so the wheel stays lit for a beat after the last tick. */
const WHEEL_LINGER = 400

/**
 * What the mouse does in one particular view. Every mode wires up its own, so
 * the diagram always names the bindings actually in force.
 */
export interface MouseConfig {
  /** Label shown while an input is engaged; `null` means it does nothing here. */
  buttons: Record<keyof Lit, string | null>
  /** Label for spinning the wheel. */
  scroll: string | null
  /** The full cheat sheet, folded away behind the hint button until asked for. */
  hints: [string, string][]
}

/** Orbit-camera bindings — the 3D stage. */
export const ORBIT_MOUSE: MouseConfig = {
  buttons: { left: 'Select', right: 'Rotate', wheel: 'Pan' },
  scroll: 'Zoom',
  hints: [
    ['left-click', 'select'],
    ['click end', 'join / unjoin'],
    ['drag arrow', 'move the run'],
    ['drag ring', 'turn the run'],
    ['right-click part', 'part menu'],
    ['right-drag', 'rotate'],
    ['middle-drag', 'pan'],
    ['scroll', 'zoom'],
    ['cube face', 'snap view'],
  ],
}

/**
 * Live mouse diagram: whichever button you are holding — or the wheel you are
 * spinning — lights up, so the controls are discoverable by fiddling.
 */
export default function MouseLegend({
  stage,
  config = ORBIT_MOUSE,
  shifted = false,
}: {
  stage: React.RefObject<HTMLElement | null>
  /** Bindings for the view this legend belongs to. */
  config?: MouseConfig
  /** Step aside when the parts list is out. */
  shifted?: boolean
}) {
  const [lit, setLit] = useState<Lit>(DARK)
  const [action, setAction] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const wheelTimer = useRef<number | undefined>(undefined)
  /** A held button outranks a scroll, so spinning mid-drag can't relabel it. */
  const held = useRef(false)

  useEffect(() => {
    const el = stage.current
    if (!el) return

    const onDown = (e: PointerEvent) => {
      // A middle-button press is the wheel being clicked, so it lights the wheel.
      const part = e.button === 2 ? 'right' : e.button === 1 ? 'wheel' : 'left'
      const does = config.buttons[part]
      // Working in the view dismisses the cheat sheet — it has served its purpose.
      setOpen(false)
      // A button bound to nothing in this view stays dark rather than lying.
      if (!does) return
      held.current = true
      window.clearTimeout(wheelTimer.current)
      setLit((l) => ({ ...l, [part]: true }))
      setAction(does)
    }
    // Release anywhere counts — the pointer often leaves the stage mid-drag.
    const onUp = () => {
      held.current = false
      setLit(DARK)
      setAction(null)
    }
    const onWheel = () => {
      if (held.current) return
      setOpen(false)
      if (!config.scroll) return
      setLit((l) => (l.wheel ? l : { ...l, wheel: true }))
      setAction(config.scroll)
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        setLit((l) => ({ ...l, wheel: false }))
        setAction(null)
      }, WHEEL_LINGER)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      window.clearTimeout(wheelTimer.current)
    }
  }, [stage, config])

  return (
    <div className={shifted ? 'mouse-legend shifted' : 'mouse-legend'}>
      {/* Floats clear of the box so naming the action never nudges the diagram. */}
      <div className={action ? 'mouse-action on' : 'mouse-action'} aria-hidden="true">
        {action ?? ''}
      </div>
      {open && (
        <ul className="mouse-hints">
          {config.hints.map(([key, does]) => (
            <li key={key}>
              <span>{key}</span>
              {does}
            </li>
          ))}
        </ul>
      )}
      <button
        className={open ? 'mouse-hint-btn on' : 'mouse-hint-btn'}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        title="Mouse controls"
        aria-label="Mouse controls"
        aria-expanded={open}
      >
        ?
      </button>
      <svg width="38" height="56" viewBox="0 0 40 60" aria-hidden="true">
        {/* Buttons first, so the body outline draws over their seams. */}
        <path className={lit.left ? 'mouse-btn on' : 'mouse-btn'} d="M2 24V20A18 18 0 0 1 20 2v22z" />
        <path className={lit.right ? 'mouse-btn on' : 'mouse-btn'} d="M38 24V20A18 18 0 0 0 20 2v22z" />
        <rect
          className={lit.wheel ? 'mouse-wheel on' : 'mouse-wheel'}
          x="17"
          y="7"
          width="6"
          height="12"
          rx="3"
        />
        <path className="mouse-body" d="M20 2a18 18 0 0 1 18 18v20a18 18 0 0 1-36 0V20A18 18 0 0 1 20 2z" />
        {/* The button split runs above and below the wheel, not through it. */}
        <path className="mouse-seam" d="M2 24h36M20 2v5M20 19v5" />
      </svg>
    </div>
  )
}
