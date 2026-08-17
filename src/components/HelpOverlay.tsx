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
 * A worked example: the question as it gets asked, and the clicks that answer
 * it. The cheat-sheet rows say what each control does one at a time; these are
 * for the jobs that take several of them in the right order.
 */
interface HowTo {
  question: string
  /** Said before the steps — usually why the obvious approach is not the one. */
  lead?: string
  steps: string[]
  note?: string
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
        {
          keys: ['Right-click a part'],
          action: 'Part menu — select, hide, rename or delete it on the spot',
          note: 'a right-drag still rotates the camera; only a press that stays put opens the menu',
        },
        {
          keys: ['Click a joint'],
          action: 'Build there — the next part from the library is joined on at that joint',
          note: 'click it again to go back to building at the end of the run',
        },
        {
          keys: ['Active Parts'],
          action: 'Switch a part off to take it out of both views',
          note: 'it still holds its place in the run',
        },
      ],
    },
    {
      title: 'HUD',
      rows: [
        { keys: ['↶', '↷'], action: 'Step back and forward through the last 10 changes', note: 'listed in the History tab' },
        {
          keys: ['▶ Simulator'],
          action: 'Put the marble on the run and start it rolling',
          note: 'there is no marble on the stage until you press it; the same button pauses it',
        },
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
        {
          keys: ['Developed'],
          action: 'Side-on, with every turn flattened out — edit slope',
          note: 'each part shows its true slope whichever way it heads; the view the draft opens on',
        },
        {
          keys: ['Front', 'Back', 'Left', 'Right'],
          action: 'True side views — edit slope',
          note: 'named for the side they are taken from, as on the 3D view cube; Left stands at -X, so the run reads left to right',
        },
        {
          keys: ['Top', 'Bottom'],
          action: 'From above and below — edit turn and corner sweep',
          note: 'a handle on a leg the view takes end-on is faded: there is no angle in the drawing to drag, so switch views',
        },
        { keys: ['Scroll'], action: 'Zoom about the pointer' },
        {
          keys: ['Right-drag', 'Middle-drag'],
          action: 'Pan the drawing',
          note: 'the wheel click pans too — press it in and drag',
        },
        { keys: ['Fit'], action: 'Re-frame the whole run' },
        {
          keys: ['Active Parts'],
          action: 'Draw only the parts you are working on',
          note: 'the same list, and the same switches, as the 3D view',
        },
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
          keys: ['Angles and Joints'],
          action: 'Type any angle in exactly, instead of dragging for it',
          note: 'in the sidebar: start, middle and end angle for the selected part, and whether the joint behind it is closed',
        },
        {
          keys: ['Drag a joint'],
          action: 'Set slope or turn',
          note: 'a side view sets slope, a top or bottom view sets turn; the part swings about the joint behind it',
        },
        {
          keys: ['Drag a ring'],
          action: "Swing a part from its head, about its own far end",
          note: 'the run ahead of it comes round with it; nothing past the pivot moves',
        },
        {
          keys: ['Drag the break'],
          action: 'On a connector, swing one leg at a time',
          note: 'an angle in a side view: the break sets the entry slope, the outlet sets the bend — a corner in Top or Bottom: the break sets the turn, the outlet sets the sweep',
        },
        { keys: ['Shift', 'Drag'], action: 'Snap the angle to 5°' },
        { keys: ['Alt', 'Drag'], action: 'Stretch that leg as well' },
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

/**
 * Filed by tab, like the cheat sheet. A tab with nothing worked out for it is
 * simply left out rather than carrying an empty heading.
 */
const HOWTO: Partial<Record<HelpTab, HowTo[]>> = {
  '3d': [
    {
      question: 'How do I join one part to another?',
      lead: 'They already are. The run is a chain: every part is joined to the one before it, in the order they appear in Active Parts. Parts cannot be dragged around the stage on their own — you change the run by changing the chain.',
      steps: [
        'The joints are the coloured ends on the run — one at each end of every part, plus the one the run starts at.',
        'Blue is where the next part lands if you do nothing: the end of the run.',
        'Click any other joint to build there instead — it turns orange. Click it again to hand building back to the end.',
      ],
    },
    {
      question: 'How do I add a part at the start of the run instead of the end?',
      steps: [
        'Click the joint at the very start of the run — the coloured inlet on the first part. It turns orange.',
        'Open ＋ Add Part and pick the part you want.',
        'It is put in ahead of the old first part, entering at whatever angle leaves the rest of the run exactly as it was.',
      ],
      note: 'Add again and it carries on in the same direction, rather than stacking back into the same joint.',
    },
    {
      question: 'How do I move a part I have already placed to a different point in the run?',
      lead: 'There is no reorder yet — a part cannot be picked up and dropped elsewhere in the chain. Rebuild it where you want it instead.',
      steps: [
        'Select the part, in the viewport or in Active Parts, and Delete it from the sidebar. What followed it closes up onto the part before it.',
        'Click the joint you want it at, so it is armed and orange.',
        'Add the part again from ＋ Add Part, then set its length, slope and turn in the sidebar.',
      ],
      note: 'Ctrl+Z puts it back if the reshuffle is not what you wanted.',
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

function HowTos({ items }: { items: HowTo[] }) {
  return (
    <div className="help-group help-howto">
      <h4>How do I…</h4>
      {items.map((h) => (
        <article key={h.question}>
          <h5>{h.question}</h5>
          {h.lead && <p className="help-howto-lead">{h.lead}</p>}
          <ol>
            {h.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {h.note && <p className="help-howto-note">{h.note}</p>}
        </article>
      ))}
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
              {/* Worked examples sit under the controls they string together. */}
              {HOWTO[tab] && <HowTos items={HOWTO[tab]!} />}
              <Rows group={ALWAYS} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
