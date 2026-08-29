import type { ComponentType } from 'react'
import Sidebar from './Sidebar'
import HoverHint from './HoverHint'
import { useRun, isStructure, pieceLabel, type LeftPanel } from '../store'
import {
  AngleJointIcon,
  MeasurementIcon,
  PartColorIcon,
  TubeSizeIcon,
  TubeStyleIcon,
} from './icons'

type MenuId = Exclude<LeftPanel, null>

interface Menu {
  id: MenuId
  /** Name in the header of the menu it opens, and in its hover hint. */
  label: string
  /** What the menu is for, said in a line — the hint under the name. */
  hint: string
  icon: ComponentType<{ size?: number }>
  /**
   * Whether the menu is about the tube itself. A base and a post are not cut
   * from tube and join nothing, so with one of those picked these have nothing
   * to set and their icons go dim.
   */
  tube?: boolean
}

/**
 * The five menus, in the order the rail offers them: what the tube is, how it
 * is cut, what colour it is, how big the part is, and how it meets the run.
 */
const MENUS: Menu[] = [
  {
    id: 'tubeSize',
    label: 'Tube Size',
    hint: 'The bore the marble rolls in and the wall around it — for the picked part, or for the whole run.',
    icon: TubeSizeIcon,
    tube: true,
  },
  {
    id: 'tubeStyle',
    label: 'Tube Style',
    hint: 'How far round the wall closes — half, three-quarter or full tube — and which way the opening faces.',
    icon: TubeStyleIcon,
    tube: true,
  },
  {
    id: 'color',
    label: 'Part Color',
    hint: 'What the part is painted on stage. 3D view only — colors are never exported.',
    icon: PartColorIcon,
  },
  {
    id: 'measurement',
    label: 'Measurement',
    hint: 'Every length, fall and turn the picked part is built to, typed in exactly.',
    icon: MeasurementIcon,
  },
  {
    id: 'angles',
    label: 'Angles and Joints',
    hint: 'The angle the part starts at, what it does in the middle, and the angle it hands on.',
    icon: AngleJointIcon,
    tube: true,
  },
]

/**
 * The left edge: a column of icons, one per menu, and the menu itself folded out
 * beside them.
 *
 * The rail is always there and always the same width, so the stage never moves
 * under the pointer when a menu opens — only the menu itself slides. One menu is
 * out at a time: they are five views of the same part, and having them all in a
 * scrolling column meant the one being read was rarely the one on screen.
 * Clicking the lit icon puts the menu away, so the same icon that opened it
 * closes it.
 */
export default function LeftDock() {
  const { leftPanel, setLeftPanel, toggleLeftPanel, pieces, selectedId } = useRun()
  const index = pieces.findIndex((p) => p.id === selectedId)
  const selected = index >= 0 ? pieces[index] : null
  // A slab or a post: no bore, no wall, no style, no joints.
  const structure = !!selected && isStructure(selected)
  const active = MENUS.find((m) => m.id === leftPanel) ?? null

  return (
    <div className={active ? 'left-dock open' : 'left-dock'}>
      <nav className="icon-rail" aria-label="Part parameters">
        <span className="rail-name" aria-hidden="true">
          Params
        </span>
        {MENUS.map((m) => {
          const off = !!m.tube && structure
          const on = leftPanel === m.id
          const Icon = m.icon
          return (
            <HoverHint
              key={m.id}
              label={m.label}
              hint={
                off
                  ? `${selected ? pieceLabel(selected, index) : 'This part'} is not cut from tube — it has no bore, wall, style or joints. Pick a length of run to set those.`
                  : m.hint
              }
            >
              <button
                className={on ? 'rail-btn on' : 'rail-btn'}
                onClick={() => toggleLeftPanel(m.id)}
                disabled={off}
                aria-label={m.label}
                aria-pressed={on}
              >
                <Icon />
              </button>
            </HoverHint>
          )
        })}
      </nav>

      <Sidebar panel={active?.id ?? null} title={active?.label ?? ''} onClose={() => setLeftPanel(null)} />
    </div>
  )
}
