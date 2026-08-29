import { useEffect } from 'react'
import LeftDock from './components/LeftDock'
import Draft2D from './components/Draft2D'
import Scene3D from './components/Scene3D'
import ThemeToggle from './components/ThemeToggle'
import HelpOverlay from './components/HelpOverlay'
import PartLibrary from './components/PartLibrary'
import ProjectBar from './components/ProjectBar'
import { pieceAxisLength } from './lib/centerline'
import {
  useRun,
  chainsOf,
  tubeSpec,
  variantOf,
  openSideOf,
  sizedLikeRun,
  OPEN_SIDE_LABEL,
  VARIANT_LABEL,
  type Piece,
} from './store'
import { formatCoarse, lengthText } from './lib/units'
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

export default function App() {
  const { mode, setMode, pieces, innerDiameter, wallThickness, variant, openSide, units } = useRun()

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
  const spec = tubeSpec(innerDiameter, wallThickness, variant, openSide)
  // Centreline length, so a bent part counts what it actually carries.
  const total = pieces.reduce((a, p) => a + pieceAxisLength(p), 0)
  // Style is a part's own, so the strip only names one when the run agrees on it.
  const styles = new Set(pieces.map((p) => variantOf(p, variant)))
  const oneStyle = styles.size > 1 ? null : ([...styles][0] ?? variant)
  // The side an open tube faces, said alongside it on the same terms — and left
  // unsaid on a closed run, which has no opening to face anywhere.
  const sides = new Set(pieces.map((p) => openSideOf(p, openSide)))
  const oneSide = sides.size > 1 ? null : ([...sides][0] ?? openSide)
  const style =
    oneStyle === null
      ? 'Mixed styles'
      : oneStyle === 'closed'
        ? VARIANT_LABEL[oneStyle]
        : `${VARIANT_LABEL[oneStyle]} · opens ${oneSide ? OPEN_SIDE_LABEL[oneSide].toLowerCase() : 'mixed sides'}`
  // Same for the tube itself: one size is only worth quoting while every part is
  // cut to it.
  const mixedTube = pieces.some((p) => !sizedLikeRun(p, innerDiameter, wallThickness))
  const size = mixedTube
    ? 'Mixed tube sizes'
    : `Ø${lengthText(innerDiameter, units)} bore / Ø${lengthText(spec.outerR * 2, units)} outer`

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
                Beta
              </span>
            </h1>
            <p>Parametric CAD Builder</p>
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

        <div className="spec-strip">
          <span>{size}</span>
          <span>{style}</span>
          <span>
            {pieces.length} pcs · {formatCoarse(total, units)}
          </span>
        </div>

        <PartLibrary />
        <HelpOverlay />
        <ThemeToggle />
      </header>

      <div className="workspace">
        <LeftDock />
        <main className="stage">{mode === '2d' ? <Draft2D /> : <Scene3D />}</main>
      </div>
    </div>
  )
}
