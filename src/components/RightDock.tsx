import SettingsPanel from './SettingsPanel'
import HistoryPanel from './HistoryPanel'
import AiMcpPanel from './AiMcpPanel'
import { useRun, type RightPanel } from '../store'

const TABS: { id: Exclude<RightPanel, null>; label: string; title: string }[] = [
  { id: 'history', label: 'History', title: 'The last changes to the run — step back or forward' },
  { id: 'settings', label: 'Settings', title: 'Marble, screen and export settings' },
  { id: 'ai', label: 'Chat', title: 'Planned: build a run by describing it — not built yet' },
]

/**
 * The filing tabs on the right edge and the panels behind them. One panel is
 * out at a time, so both stages can share the single `--parts-w` gutter that
 * the corner controls step aside by. The tabs ride out with the open panel.
 */
export default function RightDock() {
  const { rightPanel, setRightPanel, toggleRightPanel } = useRun()
  const open = rightPanel !== null

  return (
    <>
      <div className={open ? 'dock-tabs shifted' : 'dock-tabs'}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={rightPanel === t.id ? 'dock-tab on' : 'dock-tab'}
            onClick={() => toggleRightPanel(t.id)}
            title={rightPanel === t.id ? `Hide ${t.label.toLowerCase()}` : t.title}
            aria-label={t.label}
            aria-expanded={rightPanel === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SettingsPanel open={rightPanel === 'settings'} onClose={() => setRightPanel(null)} />
      <HistoryPanel open={rightPanel === 'history'} onClose={() => setRightPanel(null)} />
      <AiMcpPanel open={rightPanel === 'ai'} onClose={() => setRightPanel(null)} />
    </>
  )
}
