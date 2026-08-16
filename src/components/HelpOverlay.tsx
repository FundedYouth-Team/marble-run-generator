import { useEffect, useState } from 'react'
import { useRun, type Mode } from '../store'
import { PROJECT_EXT, PROJECT_VERSION } from '../lib/project'

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

/**
 * The help is tabbed by what you are working on: the run as a whole, or one of
 * the two workspaces. Anything true of both workspaces lives in `ALWAYS`
 * instead, so it is said once rather than in every tab.
 */
type HelpTab = 'project' | Mode

const HELP: Record<HelpTab, Group[]> = {
  project: [
    {
      title: 'The project',
      rows: [
        {
          keys: ['Project'],
          action: 'Name the run, in the top bar',
          note: 'every file it saves or exports is named after it; left blank it falls back to Untitled',
        },
        {
          keys: ['Save'],
          action: 'Write the run to a .mrun.json file on your machine',
          note: 'parts, tube size, style and marble fit — the run itself, ready to open again',
        },
        {
          keys: ['Open'],
          action: 'Put a saved .mrun.json back on the stage',
          note: 'it asks first — opening replaces the run you have now',
        },
        {
          keys: ['New'],
          action: 'Clear the stage back to a single default part',
          note: 'it asks first; your theme, colours and screen calibration are left alone',
        },
        {
          keys: ['⤓ Print plate'],
          action: 'Export meshes for printing, from the sidebar',
          note: '3MF, STL or OBJ — printable files, not a project you can reopen',
        },
      ],
    },
    {
      title: 'History',
      rows: [
        {
          keys: ['History tab'],
          action: 'The last 10 changes to the run, newest first',
          note: 'the vertical tab on the right edge; Esc closes it',
        },
        {
          keys: ['Click a step'],
          action: 'Jump straight back — or forward — to it',
          note: 'the steps ahead stay listed, greyed, until the next edit drops them',
        },
        {
          keys: ['Undo', 'Redo'],
          action: 'Step one change at a time',
          note: 'at the top of the History panel, and on the 3D HUD',
        },
        {
          keys: ['Recorded'],
          action: 'Parts, tube size, style and marble fit — nothing else',
          note: 'camera, theme and playback stay put, so stepping back never moves your view',
        },
        {
          keys: ['Not recorded'],
          action: 'Saving, opening and starting a new project',
          note: 'each of those begins the timeline again rather than adding a step',
        },
      ],
    },
  ],
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
      ],
    },
    {
      title: 'HUD',
      rows: [
        { keys: ['↶', '↷'], action: 'Step back and forward through the last 10 changes', note: 'listed in the History tab' },
        { keys: ['▶ Simulator'], action: 'Start the simulation', note: 'the same button pauses it' },
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
    {
      keys: ['Settings tab', 'History tab'],
      action: 'Slide out the settings, or the last changes to the run',
      note: 'the vertical tabs on the right edge; Esc closes them',
    },
    { keys: ['Ctrl', 'Z'], action: 'Undo the last change', note: 'Ctrl+Shift+Z redoes it; ⌘ on a Mac' },
    { keys: ['?'], action: 'Open this help' },
    { keys: ['Esc'], action: 'Close this help' },
  ],
}

/**
 * What the Beta badge in the top bar is promising — and what it is not. Shown
 * above every tab rather than filed under one, because it is true of the whole
 * app, not of one workspace.
 */
const BETA: { heading: string; body: string }[] = [
  {
    heading: 'It is still being built',
    body: 'Parts, settings and buttons are added, renamed and moved between versions. Something that is here today may work differently — or sit somewhere else — tomorrow.',
  },
  {
    heading: 'Keep your own copies',
    body: `The saved ${PROJECT_EXT} format is at version ${PROJECT_VERSION} and may change. Older files are meant to keep opening, but nothing is guaranteed yet, so keep the printable exports of anything you care about rather than trusting the project file alone.`,
  },
  {
    heading: 'Check before you print',
    body: 'Geometry, fits and the marble simulation are approximations. Test-print a single joint and check the marble runs before committing a full plate of filament.',
  },
  {
    heading: 'Expect rough edges',
    body: 'Bugs, missing parts and half-finished corners are expected at this stage. Nothing leaves your machine — the run lives in the browser until you save or export it.',
  },
]

const TAB_LABEL: Record<HelpTab, string> = {
  project: 'Project',
  '2d': '2D Draft',
  '3d': '3D View',
}

const TABS: HelpTab[] = ['project', '2d', '3d']

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

/**
 * Cheat sheet for the run and for both workspaces; opens on the tab matching
 * the current mode.
 */
export default function HelpOverlay() {
  const mode = useRun((s) => s.mode)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<HelpTab>(mode)

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
        title="General help (?)"
        aria-label="General help"
      >
        ?
      </button>

      {open && (
        <div className="help-backdrop" onClick={() => setOpen(false)}>
          <div
            className="help-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="General help"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="help-head">
              <h3>General Help</h3>
              <div className="segmented small">
                {TABS.map((t) => (
                  <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
              <button className="help-close" onClick={() => setOpen(false)} aria-label="Close help">
                ✕
              </button>
            </header>

            <div className="help-body">
              <section className="help-beta">
                <h4>
                  <span className="beta">Beta</span> This is a work in progress
                </h4>
                <dl>
                  {BETA.map((b) => (
                    <div key={b.heading}>
                      <dt>{b.heading}</dt>
                      <dd>{b.body}</dd>
                    </div>
                  ))}
                </dl>
              </section>

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
