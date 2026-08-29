import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { shortcutParts, type Shortcut } from '../lib/shortcuts'

/** How long the pointer has to rest on a control before its hint appears, ms. */
const HINT_DELAY = 240
/** Half the hint's widest, plus a margin: how near an edge it may be centred. */
const HINT_INSET = 130

/**
 * A hint that opens under whatever it wraps once the pointer has rested on it.
 *
 * The hint is hung off the body rather than off the control: the bars it is used
 * in clip their own overflow, and a hint that sat inside one would be cut off at
 * the bar's edge. The pointer is watched on the wrapper rather than on the
 * control so a greyed-out button still says why it is greyed out — a disabled
 * button is given no pointer events of its own.
 *
 * A control that also answers to a key says so on its own line under the
 * description, drawn as key caps rather than written into the sentence: the caps
 * are read at a glance, they are the same caps Settings → Shortcut Keys shows,
 * and passing the binding itself means a re-bound key is right here without the
 * caller having to remember to re-word anything.
 */
export default function HoverHint({
  label,
  hint,
  keys,
  className,
  hideOnClick,
  children,
}: {
  /** The control's name, in bold on the first line. */
  label: string
  /** The longer line under the name, saying what the control does. */
  hint: ReactNode
  /**
   * The binding this control also answers to, if it has one. Left off while the
   * control is greyed out — the key does nothing either, so saying it would be
   * offering a way in that is not open.
   */
  keys?: Shortcut
  /** Put on the wrapper, for the few places the slot itself has to be placed. */
  className?: string
  /** For a control whose picture changes on click: what it said no longer holds. */
  hideOnClick?: boolean
  children: ReactNode
}) {
  const slot = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef(0)

  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = slot.current?.getBoundingClientRect()
      if (!r) return
      const x = Math.min(
        Math.max(r.left + r.width / 2, HINT_INSET),
        Math.max(window.innerWidth - HINT_INSET, HINT_INSET),
      )
      setTip({ x, y: r.bottom + 8 })
    }, HINT_DELAY)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setTip(null)
  }
  // A hint left in flight when the bar is torn down has nothing to open onto.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <span
      className={className ? `tool-slot ${className}` : 'tool-slot'}
      ref={slot}
      onPointerEnter={show}
      onPointerLeave={hide}
      // Keyboard travel through the bar reads the same hints the pointer does.
      onFocus={show}
      onBlur={hide}
      onClick={hideOnClick ? hide : undefined}
    >
      {children}
      {tip &&
        createPortal(
          <div className="tool-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
            <b>{label}</b>
            <span>{hint}</span>
            {keys && (
              <span className="tool-tip-keys">
                Press
                {shortcutParts(keys).map((part, i) => (
                  <span key={`${part}-${i}`}>
                    {i > 0 && <span className="tool-tip-plus">+</span>}
                    <kbd>{part}</kbd>
                  </span>
                ))}
              </span>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}
