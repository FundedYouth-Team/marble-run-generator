import Sidebar from './Sidebar'
import { useRun, type LeftPanel } from '../store'

const TABS: { id: Exclude<LeftPanel, null>; label: string; title: string }[] = [
  { id: 'parameters', label: 'Parameters', title: 'Measurements, tube size, style and color' },
]

/**
 * The filing tabs on the left edge and the column behind them — the right
 * dock's tabs, mirrored. The tabs ride on the column's inner edge, so they stay
 * against the stage whether the column is out or folded away, and the stage
 * takes the width back the moment it folds.
 */
export default function LeftDock() {
  const { leftPanel, toggleLeftPanel } = useRun()
  const open = leftPanel !== null

  return (
    <div className={open ? 'left-dock open' : 'left-dock'}>
      <Sidebar />

      <div className="left-dock-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={leftPanel === t.id ? 'dock-tab left on' : 'dock-tab left'}
            onClick={() => toggleLeftPanel(t.id)}
            title={leftPanel === t.id ? `Hide ${t.label.toLowerCase()}` : t.title}
            aria-label={t.label}
            aria-expanded={leftPanel === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
