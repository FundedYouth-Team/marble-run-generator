import Sidebar from './components/Sidebar'
import Draft2D from './components/Draft2D'
import Scene3D from './components/Scene3D'
import ThemeToggle from './components/ThemeToggle'
import HelpOverlay from './components/HelpOverlay'
import PartLibrary from './components/PartLibrary'
import { useRun, tubeSpec, VARIANT_LABEL } from './store'

export default function App() {
  const { mode, setMode, pieces, innerDiameter, wallThickness, variant } = useRun()
  const spec = tubeSpec(innerDiameter, wallThickness, variant)
  const total = pieces.reduce((a, p) => a + p.length, 0)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          <div>
            <h1>Marble Run Generator</h1>
            <p>parametric tube CAD</p>
          </div>
        </div>

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
          <span>{VARIANT_LABEL[variant]}</span>
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
