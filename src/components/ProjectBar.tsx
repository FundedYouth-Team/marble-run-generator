import { useEffect, useState } from 'react'
import { useRun, UNTITLED_PROJECT } from '../store'

/**
 * The run's name, editable in place, and the button that starts a fresh one.
 * The name is what every export is called, so it sits in the top bar next to
 * the brand rather than inside a panel.
 */
export default function ProjectBar() {
  const { projectName, setProjectName, newProject } = useRun()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

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

      <button
        className="new-project-btn"
        onClick={() => setConfirming(true)}
        title="Clear the stage and start a new project"
      >
        New
      </button>

      {/* Nothing here is undoable once done, so it is asked for rather than assumed. */}
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
              <b>{projectName.trim() || UNTITLED_PROJECT}</b>. Export anything you want to keep
              first. Your theme, colours and screen calibration are left alone.
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
    </div>
  )
}
