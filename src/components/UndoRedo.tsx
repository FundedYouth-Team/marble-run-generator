import { useRun } from '../store'
import HoverHint from './HoverHint'
import { UndoIcon, RedoIcon } from './icons'

/**
 * The pair of step buttons, shared by the 3D HUD and the 2D draft toolbar so
 * both stages walk the same timeline. The steps themselves are listed in the
 * History panel behind the right-edge tab.
 *
 * Both say what the next step back or forward actually is, rather than just
 * "Undo": the label is the one on the history step, so you know what you are
 * about to take back before you take it back.
 */
export default function UndoRedo({ className = '' }: { className?: string }) {
  const { history, historyIndex, undo, redo, shortcuts } = useRun()
  const back = historyIndex > 0 ? history[historyIndex].label : null
  const forward = historyIndex < history.length - 1 ? history[historyIndex + 1].label : null

  return (
    <div className={`undo-redo ${className}`.trim()}>
      <HoverHint
        label="Undo"
        hint={back ? `Step back, undoing ${back.toLowerCase()}` : 'Nothing to undo yet'}
        keys={back ? shortcuts.undo : undefined}
      >
        <button onClick={undo} disabled={!back} aria-label="Undo">
          <UndoIcon />
        </button>
      </HoverHint>
      <HoverHint
        label="Redo"
        hint={forward ? `Step forward again, into ${forward.toLowerCase()}` : 'Nothing to redo'}
        keys={forward ? shortcuts.redo : undefined}
      >
        <button onClick={redo} disabled={!forward} aria-label="Redo">
          <RedoIcon />
        </button>
      </HoverHint>
    </div>
  )
}
