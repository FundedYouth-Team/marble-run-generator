import { useEffect, useState } from 'react'
import InfoNote from './InfoNote'
import { useRun } from '../store'
import {
  DEFAULT_SHORTCUTS,
  IS_MAC,
  MOD_LABEL,
  SHORTCUT_ACTIONS,
  SHORTCUT_HINT,
  SHORTCUT_LABEL,
  captureShortcut,
  formatShortcut,
  sameShortcut,
  sameShortcuts,
  shortcutParts,
  type ShortcutAction,
} from '../lib/shortcuts'

/**
 * The keys each command answers to, and the one row per command that re-binds
 * them. Recording is a mode rather than a text field: the row waits, you press
 * the combination you want, and that is what it becomes — typing "Ctrl+Z" into a
 * box would only be a second thing to get wrong.
 */
export default function ShortcutsPanel() {
  const shortcuts = useRun((s) => s.shortcuts)
  const setShortcut = useRun((s) => s.setShortcut)
  const resetShortcuts = useRun((s) => s.resetShortcuts)
  /** Which row is listening, if any — only ever one at a time. */
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  /** Why the last press was not taken, shown until the next one is. */
  const [problem, setProblem] = useState<string | null>(null)
  /** What the last change did beyond the row it was made on. */
  const [note, setNote] = useState<string | null>(null)
  const stock = sameShortcuts(shortcuts, DEFAULT_SHORTCUTS)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      // Every press belongs to the recording while it is on, so nothing else in
      // the app — least of all the command being re-bound — acts on it.
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        setProblem(null)
        return
      }
      const got = captureShortcut(e)
      // Still only modifiers down: the combination is half-pressed, so wait.
      if (!got) return
      if (!got.ok) {
        setProblem(got.why)
        return
      }
      // Said before the swap happens, while the old binding is still readable.
      const clash = SHORTCUT_ACTIONS.find(
        (a) => a !== recording && sameShortcut(shortcuts[a], got.shortcut),
      )
      setNote(
        clash
          ? `${formatShortcut(got.shortcut)} was ${SHORTCUT_LABEL[clash]} — the two have swapped, so ${SHORTCUT_LABEL[clash]} is now ${formatShortcut(shortcuts[recording])}.`
          : null,
      )
      setShortcut(recording, got.shortcut)
      setRecording(null)
      setProblem(null)
    }
    // Captured on the way down, so the app's own handler never sees the press.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, shortcuts, setShortcut])

  return (
    <>
      {/* The panel heading already says what these are, so this only says how. */}
      <p className="note">
        {recording
          ? 'Press the combination you want, or Esc to leave it as it was.'
          : "Click a row's keys, then press the combination you want it to answer to."}
      </p>

      <div className="shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => {
          const live = recording === action
          return (
            <div key={action} className="shortcut-row">
              <span className="shortcut-name">
                {SHORTCUT_LABEL[action]}
                <em>{SHORTCUT_HINT[action]}</em>
              </span>
              <button
                className={live ? 'shortcut-keys recording' : 'shortcut-keys'}
                aria-label={`${SHORTCUT_LABEL[action]} shortcut: ${formatShortcut(shortcuts[action])}. Click to change`}
                title={
                  live
                    ? 'Press the keys you want — Esc to leave it as it was'
                    : `Change the ${SHORTCUT_LABEL[action].toLowerCase()} shortcut`
                }
                onClick={() => {
                  setNote(null)
                  setProblem(null)
                  setRecording(live ? null : action)
                }}
              >
                {live ? (
                  <span className="shortcut-waiting">Press keys…</span>
                ) : (
                  shortcutParts(shortcuts[action]).map((part, i) => (
                    <span key={`${part}-${i}`}>
                      {i > 0 && <span className="shortcut-plus">+</span>}
                      <kbd>{part}</kbd>
                    </span>
                  ))
                )}
              </button>
            </div>
          )
        })}
      </div>

      {problem && <p className="warn">{problem}</p>}
      {note && !recording && <p className="note">{note}</p>}

      <button onClick={resetShortcuts} disabled={stock}>
        ↺ {stock ? 'Stock shortcuts' : 'Reset to stock shortcuts'}
      </button>

      <InfoNote label="Where do these keys live?">
        On this machine, and in the run. They are remembered in this browser, and
        they are written into the project file when you press Save — so opening
        that file on another machine brings the keys with it. Opening an older
        file, saved before shortcuts could be changed, leaves yours alone.
      </InfoNote>
      <InfoNote label={`Why does it say ${MOD_LABEL}?`}>
        {IS_MAC
          ? 'Because this is a Mac, where ⌘ is the command key. On Windows and Linux the same shortcut reads as Ctrl, and a run saved here opens there with Ctrl — it is the one key under two names. Either one works on either machine.'
          : 'Ctrl is the command key here. On a Mac the same shortcut reads as ⌘, and a run saved here opens there with ⌘ — it is the one key under two names. Either one works on either machine.'}
      </InfoNote>
    </>
  )
}
