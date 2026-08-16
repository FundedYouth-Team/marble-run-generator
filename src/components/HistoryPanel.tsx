import { useEffect } from 'react'
import { useRun, HISTORY_LIMIT } from '../store'
import { UndoIcon, RedoIcon } from './icons'

/** Clock time on the step, so a list of similar edits is still tellable apart. */
function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Slide-out history: the last ten model changes, newest at the top, with the
 * current one marked. Clicking a step jumps straight to it — the ones after it
 * stay listed and greyed until the next edit, which drops them.
 *
 * Only the model is recorded — parts, tube size, style and marble fit. Camera,
 * theme and playback are view state, so stepping back never moves the view.
 */
export default function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { history, historyIndex, gotoHistory, undo, redo } = useRun()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Newest first reads like a log, so the step you just took is under the header.
  const rows = history.map((entry, index) => ({ entry, index })).reverse()

  return (
    // Closed, it is only parked off-screen — inert keeps it out of the tab order too.
    <aside className={open ? 'parts-panel open' : 'parts-panel'} inert={!open}>
      <header className="parts-head">
        <h3>History</h3>
        <button className="help-close" onClick={onClose} aria-label="Close history">
          ✕
        </button>
      </header>

      <div className="history-actions">
        <button onClick={undo} disabled={historyIndex <= 0}>
          <UndoIcon /> Undo
        </button>
        <button onClick={redo} disabled={historyIndex >= history.length - 1}>
          <RedoIcon /> Redo
        </button>
      </div>

      <div className="parts-body history-body">
        <ol className="history-list">
          {rows.map(({ entry, index }) => {
            const classes = ['history-step']
            if (index === historyIndex) classes.push('on')
            // Undone steps are still there to walk back into, until the next edit.
            if (index > historyIndex) classes.push('ahead')
            return (
              <li key={entry.id}>
                <button
                  className={classes.join(' ')}
                  onClick={() => gotoHistory(index)}
                  aria-current={index === historyIndex}
                  title={
                    index === historyIndex
                      ? 'Where the run is now'
                      : `Go ${index < historyIndex ? 'back' : 'forward'} to this step`
                  }
                >
                  <span className="history-dot" aria-hidden="true" />
                  <span className="history-label">{entry.label}</span>
                  <span className="history-time">{clock(entry.at)}</span>
                </button>
              </li>
            )
          })}
        </ol>

        <p className="note">
          The last {HISTORY_LIMIT} changes to the run — parts, tube size, style and marble fit.
          Older steps drop off the end. Camera, theme and playback are not recorded, so stepping
          back never moves your view.
        </p>
      </div>
    </aside>
  )
}
