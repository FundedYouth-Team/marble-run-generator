import { useRun } from '../store'
import { formatShortcut } from '../lib/shortcuts'
import { UndoIcon, RedoIcon } from './icons'

/**
 * The pair of step buttons, shared by the 3D HUD and the 2D draft toolbar so
 * both stages walk the same timeline. The steps themselves are listed in the
 * History panel behind the right-edge tab.
 */
export default function UndoRedo({ className = '' }: { className?: string }) {
  const { history, historyIndex, undo, redo, shortcuts } = useRun()
  const back = historyIndex > 0 ? history[historyIndex].label : null
  const forward = historyIndex < history.length - 1 ? history[historyIndex + 1].label : null

  return (
    <div className={`undo-redo ${className}`.trim()}>
      <button
        onClick={undo}
        disabled={!back}
        aria-label="Undo"
        title={back ? `Undo ${back} — ${formatShortcut(shortcuts.undo)}` : 'Nothing to undo'}
      >
        <UndoIcon />
      </button>
      <button
        onClick={redo}
        disabled={!forward}
        aria-label="Redo"
        title={forward ? `Redo ${forward} — ${formatShortcut(shortcuts.redo)}` : 'Nothing to redo'}
      >
        <RedoIcon />
      </button>
    </div>
  )
}
