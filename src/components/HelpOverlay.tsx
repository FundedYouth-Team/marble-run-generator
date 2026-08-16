import { useEffect, useState } from 'react'
import { useRun, type Mode } from '../store'

/** One line of the cheat sheet: what you press, and what it does. */
interface Shortcut {
  /** Rendered as key caps; an entry starting with a glyph reads as an on-screen button. */
  keys: string[]
  action: string
  note?: string
}

interface Group {
  title: string
  rows: Shortcut[]
}

const HELP: Record<Mode, Group[]> = {
  '3d': [
    {
      title: 'Camera',
      rows: [
        { keys: ['Right-drag'], action: 'Rotate around the run' },
        { keys: ['Scroll'], action: 'Zoom in and out', note: 'pinch on a trackpad' },
        {
          keys: ['Middle-drag'],
          action: 'Pan the view',
          note: 'press the scroll wheel in and drag; shift + right-drag does it too',
        },
        {
          keys: ['View cube'],
          action: 'Click a face, edge or corner to swing round to it',
          note: 'top-right; left-drag the cube itself to spin the view',
        },
        { keys: ['Home button'], action: 'Reset to the home angle, whole run in frame', note: 'under the cube' },
        { keys: ['Fit button'], action: 'Re-frame the whole run from the current angle' },
      ],
    },
    {
      title: 'Parts',
      rows: [
        { keys: ['Left-click a part'], action: 'Select it and open its settings in the sidebar' },
        { keys: ['Left-click empty space'], action: 'Deselect' },
        {
          keys: ['Settings tab', 'History tab'],
          action: 'Slide out the settings, or the last changes to the run',
          note: 'the vertical tabs on the right edge; Esc closes them',
        },
      ],
    },
    {
      title: 'HUD',
      rows: [
        { keys: ['↶', '↷'], action: 'Step back and forward through the last 10 changes', note: 'listed in the History tab' },
        { keys: ['▶ Run marble'], action: 'Start the simulation', note: 'the same button pauses it' },
        { keys: ['↺ Reset'], action: 'Send the marble back to the start' },
        { keys: ['◉ Solid', '◍ Transparent'], action: 'See through the tube walls' },
        { keys: ['⤓ 3MF', '⤓ STL'], action: 'Export the print plate', note: 'format is set in the sidebar' },
      ],
    },
  ],
  '2d': [
    {
      title: 'Draft view',
      rows: [
        { keys: ['Elevation'], action: 'Side-on view — edit slope' },
        { keys: ['Plan'], action: 'Top-down view — edit turn' },
        { keys: ['Scroll'], action: 'Zoom about the pointer' },
        {
          keys: ['Right-drag', 'Middle-drag'],
          action: 'Pan the drawing',
          note: 'the wheel click pans too — press it in and drag',
        },
        { keys: ['Fit'], action: 'Re-frame the whole run' },
        {
          keys: ['1:1'],
          action: 'Zoom to true physical size',
          note: 'calibrate your screen in Settings first, or it is only a guess',
        },
        {
          keys: ['Settings tab', 'History tab'],
          action: 'Slide out the settings, or the last changes to the run',
          note: 'the vertical tabs on the right edge; Esc closes them',
        },
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: ['Click a piece'], action: 'Select it and open its settings in the sidebar' },
        { keys: ['Click empty space'], action: 'Clear the selection' },
        {
          keys: ['Drag a joint'],
          action: 'Set slope or turn',
          note: 'which one depends on the view; the first joint is a fixed origin',
        },
        { keys: ['Shift', 'Drag'], action: 'Snap the angle to 5°' },
        { keys: ['Alt', 'Drag'], action: 'Stretch the piece length as well' },
        { keys: ['Esc'], action: 'Cancel the drag and restore the piece' },
      ],
    },
    {
      title: 'Reading the drawing',
      rows: [
        { keys: ['Section A–A'], action: 'Live cross-section of the tube front face' },
        { keys: ['Ghost circle'], action: 'The marble, shown resting in the bore' },
      ],
    },
  ],
}

const ALWAYS: Group = {
  title: 'Anywhere',
  rows: [
    { keys: ['＋ Add Part'], action: 'Browse the part library and drop a part on the stage', note: 'top of the window' },
    { keys: ['2D Draft Mode', '3D Mode'], action: 'Switch workspace', note: 'top of the window' },
    { keys: ['Ctrl', 'Z'], action: 'Undo the last change', note: 'Ctrl+Shift+Z redoes it; ⌘ on a Mac' },
    { keys: ['?'], action: 'Open this help' },
    { keys: ['Esc'], action: 'Close this help' },
  ],
}

const MODE_LABEL: Record<Mode, string> = { '2d': '2D Draft', '3d': '3D View' }

function Rows({ group }: { group: Group }) {
  return (
    <div className="help-group">
      <h4>{group.title}</h4>
      <dl>
        {group.rows.map((r) => (
          <div key={r.action} className="help-row">
            <dt>
              {r.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="help-sep">or</span>}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>
              {r.action}
              {r.note && <em> — {r.note}</em>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Cheat sheet for both workspaces; opens on the tab matching the current mode. */
export default function HelpOverlay() {
  const mode = useRun((s) => s.mode)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Mode>(mode)

  // Follow the workspace while closed, so opening always lands on what you are looking at.
  useEffect(() => {
    if (!open) setTab(mode)
  }, [mode, open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      // Ignore the shortcut while the user is typing into a field.
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        className="help-btn"
        onClick={() => setOpen(true)}
        title="Controls and shortcuts (?)"
        aria-label="Controls and shortcuts"
      >
        ?
      </button>

      {open && (
        <div className="help-backdrop" onClick={() => setOpen(false)}>
          <div
            className="help-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Controls and shortcuts"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="help-head">
              <h3>Controls</h3>
              <div className="segmented small">
                {(['2d', '3d'] as Mode[]).map((m) => (
                  <button key={m} className={tab === m ? 'on' : ''} onClick={() => setTab(m)}>
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
              <button className="help-close" onClick={() => setOpen(false)} aria-label="Close help">
                ✕
              </button>
            </header>

            <div className="help-body">
              {HELP[tab].map((g) => (
                <Rows key={g.title} group={g} />
              ))}
              <Rows group={ALWAYS} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
