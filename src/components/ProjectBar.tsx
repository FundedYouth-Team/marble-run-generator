import { useEffect, useRef, useState } from 'react'
import { useRun, UNTITLED_PROJECT, type LoadedProject } from '../store'
import { PROJECT_EXT, readProjectFile, saveProjectFile } from '../lib/project'
import ExportDialog from './ExportDialog'
import HoverHint from './HoverHint'

/**
 * A run pending an Open — read off disk and checked over, but not on the stage
 * until the swap is agreed to.
 */
interface Incoming {
  project: LoadedProject
  filename: string
}

/**
 * The run's name, editable in place, and everything that acts on the run as a
 * whole — save it, open one, or start again. The name is what every file is
 * called, so this sits in the top bar next to the brand rather than in a panel.
 *
 * All three are buttons and nothing else. The keys they would want — the command
 * modifier with S, O and N — belong to the browser for saving, opening and
 * newing its own window, and a page that took them would be fighting the thing
 * it runs inside.
 */
export default function ProjectBar() {
  const s = useRun()
  const { projectName, setProjectName, newProject, loadProject } = s
  const [confirming, setConfirming] = useState(false)
  const [incoming, setIncoming] = useState<Incoming | null>(null)
  const [exporting, setExporting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const dialog = confirming || incoming !== null

  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setConfirming(false)
      setIncoming(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  // Whatever was last said about a save or an open stops being news shortly after.
  useEffect(() => {
    if (!note && !error) return
    const t = setTimeout(() => {
      setNote(null)
      setError(null)
    }, 6000)
    return () => clearTimeout(t)
  }, [note, error])

  const save = () => {
    setError(null)
    try {
      setNote(`Saved ${saveProjectFile(s)}`)
    } catch (e) {
      setNote(null)
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setNote(null)
    setError(null)
    try {
      setIncoming({ project: await readProjectFile(file), filename: file.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be opened')
    }
  }

  return (
    <div className="project">
      <label className="project-name">
        <span>Project</span>
        <input
          type="text"
          value={projectName}
          placeholder={UNTITLED_PROJECT}
          maxLength={60}
          aria-label="Project name"
          title="Names the run, and every file it exports"
          onChange={(e) => setProjectName(e.target.value)}
          // A run always has a name — emptying the field falls back to Untitled.
          onBlur={() => !projectName.trim() && setProjectName(UNTITLED_PROJECT)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      </label>

      <div className="project-btns">
        <HoverHint
          label="Save"
          hint={
            <>
              Writes the run to your computer as a <b>{PROJECT_EXT}</b> file, so you can come back to
              it later. Use Open to load it again.
            </>
          }
        >
          <button onClick={save}>Save</button>
        </HoverHint>
        <HoverHint
          label="Open"
          hint={
            <>
              Loads a <b>{PROJECT_EXT}</b> project file you saved earlier from your computer, putting
              that run back on the stage.
            </>
          }
        >
          <button onClick={() => fileInput.current?.click()}>Open</button>
        </HoverHint>
        <HoverHint
          label="New"
          hint="Clears the workspace and starts a fresh project. This cannot be undone — save first if you want to keep this run."
        >
          <button onClick={() => setConfirming(true)}>New</button>
        </HoverHint>
        {/* The one button here that leads to something to print rather than
            something to reopen. It named the format and wrote the plate on the
            spot, which meant the format and the file name had to be set
            somewhere else first — in a panel folded into Settings. Both now
            live behind this button, in the window it opens. */}
        <HoverHint
          label="Export"
          hint="Opens the export window: pick what to write — every part laid out separately, the run as assembled, or just the part you have selected — then the format and the file name."
          hideOnClick
        >
          <button className="download-btn" onClick={() => setExporting(true)}>
            Export
          </button>
        </HoverHint>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0])
          // Cleared so picking the same file twice running still counts as a pick.
          e.target.value = ''
        }}
      />

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}

      {(note || error) && (
        <span className={error ? 'project-status warn' : 'project-status'}>{error ?? note}</span>
      )}

      {/* Neither swap can be undone once done, so both are asked for rather than assumed. */}
      {confirming && (
        <div className="help-backdrop" onClick={() => setConfirming(false)}>
          <div
            className="confirm-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Start a new project"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Start a new project?</h3>
            <p className="note">
              This clears the stage back to a single default part and drops the history for{' '}
              <b>{projectName.trim() || UNTITLED_PROJECT}</b>. Save anything you want to keep first.
              Your theme, colours and screen calibration are left alone.
            </p>
            <div className="confirm-btns">
              <button onClick={() => setConfirming(false)}>Cancel</button>
              <button
                className="danger"
                autoFocus
                onClick={() => {
                  newProject()
                  setConfirming(false)
                }}
              >
                New project
              </button>
            </div>
          </div>
        </div>
      )}

      {incoming && (
        <div className="help-backdrop" onClick={() => setIncoming(null)}>
          <div
            className="confirm-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Open a saved project"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Open {incoming.project.projectName}?</h3>
            <p className="note">
              <b>{incoming.filename}</b> holds {incoming.project.pieces.length} part
              {incoming.project.pieces.length === 1 ? '' : 's'}. Opening it replaces what is on the
              stage now and drops the history for{' '}
              <b>{projectName.trim() || UNTITLED_PROJECT}</b>.
            </p>
            <div className="confirm-btns">
              <button onClick={() => setIncoming(null)}>Cancel</button>
              <button
                className="danger"
                autoFocus
                onClick={() => {
                  loadProject(incoming.project)
                  setNote(`Opened ${incoming.filename}`)
                  setIncoming(null)
                }}
              >
                Open project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
