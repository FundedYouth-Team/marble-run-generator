import { useEffect } from 'react'
import LeftDock from './components/LeftDock'
import Draft2D from './components/Draft2D'
import Scene3D, { barHeight } from './components/Scene3D'
import ThemeToggle from './components/ThemeToggle'
import HelpOverlay from './components/HelpOverlay'
import PartLibrary from './components/PartLibrary'
import ProjectBar from './components/ProjectBar'
import ProjectDetails from './components/ProjectDetails'
import { useRun, chainsOf, type Piece } from './store'
import { actionFor, isTyping, toolForAction, type KeyedTool } from './lib/shortcuts'

/**
 * Whether a tool has anything to work on — the same test that greys its button
 * out in the bar, so a key never takes up a tool a click could not. Select is
 * the resting state and always answers, which is what makes it the way back out
 * of any of the others.
 */
function toolReady(tool: KeyedTool, pieces: Piece[]): boolean {
  if (tool === 'select') return true
  // Two parts to line up, and two runs to join: one of anything has nothing to
  // be brought to.
  if (tool === 'align') return pieces.length >= 2
  if (tool === 'connect') return chainsOf(pieces).length >= 2
  return pieces.length > 0
}

/**
 * How much room the open left menu takes off the stage — the 300px the
 * stylesheet gives `.sidebar`, plus the gap it stands off the rail by. What
 * steps aside for it clears the whole popup rather than stopping at its edge.
 */
const LEFT_MENU_WIDTH = 310

export default function App() {
  const { mode, setMode, tool, leftPanel } = useRun()
  /**
   * How far down the stage's own chrome starts, hung on the workspace rather
   * than on the stage: the left menu floats over the stage, and it has to know
   * where the toolbar ends to open under it rather than across it. The 2D draft
   * carries no such bar, so there it is nothing.
   */
  const barH = mode === '3d' ? barHeight(tool) : 0

  // The shortcuts, wherever you are — both stages share the one timeline. The
  // bindings are read at press time rather than watched, so re-binding one in
  // Settings takes effect on the next key press without re-hanging the listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = useRun.getState()
      const action = actionFor(e, s.shortcuts)
      // Delete and Backspace both mean "get rid of what is picked", the way they
      // do everywhere else. Bare keys, so they are the app's own rather than
      // something to bind — and only outside a field, where Backspace is still a
      // backspace. A binding that lands on either of them still wins, so nothing
      // set in Settings is quietly overruled here.
      if (
        !action &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'Delete' || e.key === 'Backspace')
      ) {
        // Swallowed either way: Backspace with nothing picked is the browser's
        // Back button on some setups, which would take the whole run with it.
        e.preventDefault()
        if (s.selectedIds.length) s.removeParts(s.selectedIds)
        return
      }
      // The five tool commands — S, M, R, J and L out of the box, whatever they
      // are bound to now. Only on the 3D stage, which is where the tools are:
      // in the draft the press is nobody's, so it is left alone rather than
      // swallowed.
      const wanted = action ? toolForAction(action) : null
      if (wanted) {
        if (s.mode !== '3d') return
        // Swallowed even when the tool cannot be taken up, so the press is the
        // app's either way rather than half of it reaching the page.
        e.preventDefault()
        if (toolReady(wanted, s.pieces)) s.setTool(wanted)
        return
      }
      // The library owns its own window, so it owns the key that opens it — and
      // that key closes it again, which only the window itself can do.
      if (action === 'openLibrary') return
      // Ctrl+Shift+Z is the redo every other app also takes, so it stands
      // alongside whatever Redo is bound to — unless something is bound over it.
      const altRedo =
        !action &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'z'
      if (!action && !altRedo) return
      e.preventDefault()
      if (altRedo || action === 'redo') s.redo()
      else if (action === 'undo') s.undo()
      // Nothing selected is nothing to copy, but the key is still ours: swallowing
      // it beats handing Ctrl+D back to the browser's bookmark bar mid-build.
      else if (action === 'duplicate') s.duplicateParts(s.selectedIds)
      else if (action === 'duplicateJoined') s.duplicateParts(s.selectedIds, { join: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          <div>
            <h1>
              Marble Run
              {/* The app is still being built — said next to the name, where it is read first. */}
              <span className="beta" title="Under active development — press ? for what that means">
                Beta v1
              </span>
            </h1>
            <p>Builder</p>
          </div>
        </div>

        <ProjectBar />

        <div className="segmented mode">
          <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>
            3D Mode
          </button>
          <button
            className={mode === '2d' ? 'on' : ''}
            onClick={() => setMode('2d')}
            title="Draft one part at a time — slope, turn and length"
          >
            2D Draft Mode
          </button>
        </div>

        <ProjectDetails />

        <PartLibrary />
        <HelpOverlay />
        <ThemeToggle />
      </header>

      <div
        className="workspace"
        style={
          {
            '--toolbar-h': `${barH}px`,
            // What the open menu covers, so the stage furniture standing where
            // it opens — the Active Parts tree — can step aside for it, the way
            // the furniture on the right steps aside for the panels there. The
            // view itself is untouched: only the tree moves.
            '--left-menu-w': leftPanel ? `${LEFT_MENU_WIDTH}px` : '0px',
          } as React.CSSProperties
        }
      >
        <LeftDock />
        <main className="stage">{mode === '2d' ? <Draft2D /> : <Scene3D />}</main>
      </div>
    </div>
  )
}
