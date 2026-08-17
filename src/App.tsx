import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Draft2D from './components/Draft2D'
import Scene3D from './components/Scene3D'
import ThemeToggle from './components/ThemeToggle'
import HelpOverlay from './components/HelpOverlay'
import PartLibrary from './components/PartLibrary'
import ProjectBar from './components/ProjectBar'
import { pieceAxisLength } from './lib/centerline'
import { useRun, tubeSpec, variantOf, VARIANT_LABEL } from './store'

/** Fields own their own undo stack — the run's only takes over outside them. */
function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null
  return !!t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
}

export default function App() {
  const { mode, setMode, pieces, innerDiameter, wallThickness, variant } = useRun()

  // The usual shortcuts, wherever you are — both stages share the one timeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      e.preventDefault()
      const { undo, redo } = useRun.getState()
      // Ctrl+Y is the Windows redo; Shift+Z is everyone else's.
      if (key === 'y' || e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const spec = tubeSpec(innerDiameter, wallThickness, variant)
  // Centreline length, so a bent part counts what it actually carries.
  const total = Math.round(pieces.reduce((a, p) => a + pieceAxisLength(p), 0))
  // Style is a part's own, so the strip only names one when the run agrees on it.
  const styles = new Set(pieces.map((p) => variantOf(p, variant)))
  const style = styles.size > 1 ? 'Mixed styles' : VARIANT_LABEL[[...styles][0] ?? variant]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          <div>
            <h1>
              Marble Run Generator
              {/* The app is still being built — said next to the name, where it is read first. */}
              <span className="beta" title="Under active development — press ? for what that means">
                Beta
              </span>
            </h1>
            <p>Parametric CAD Tool</p>
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
          <span>
            Ø{innerDiameter.toFixed(1)} bore / Ø{(spec.outerR * 2).toFixed(1)} outer
          </span>
          <span>{style}</span>
          <span>
            {pieces.length} pcs · {total} mm
          </span>
        </div>

        <PartLibrary />
        <HelpOverlay />
        <ThemeToggle />
      </header>

      <div className="workspace">
        <Sidebar />
        <main className="stage">{mode === '2d' ? <Draft2D /> : <Scene3D />}</main>
      </div>
    </div>
  )
}
