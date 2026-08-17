import { useEffect, useState, type ReactNode } from 'react'
import HoverHint from './HoverHint'
import UndoRedo from './UndoRedo'
import {
  ConnectIcon,
  DisconnectIcon,
  DropToPlaneIcon,
  DuplicateIcon,
  MoveIcon,
  RotateIcon,
  SelectIcon,
  TrashIcon,
} from './icons'
import { telemetry } from '../lib/telemetry'
import { UNIT_WORD, coarseText } from '../lib/units'
import { formatShortcut } from '../lib/shortcuts'
import { exportPrintPlate } from '../lib/exporters'
import type { Assembly } from '../lib/layout'
import {
  chainsOf,
  exportBasename,
  pieceLabel,
  useRun,
  type Tool,
  type TubeSpec,
} from '../store'

/**
 * A band of the toolbar, under the name of what it does. The border on the left
 * is what separates one from the next, so the bar reads as a few short lists
 * rather than one long row of buttons.
 */
function ToolGroup({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="tool-group">
      <span className="tool-group-name">{name}</span>
      <div className="tool-group-row">{children}</div>
    </div>
  )
}

/**
 * One of the tools. A modal one reads as pressed while it holds the left button,
 * because until it is switched off every click on the stage belongs to it; one
 * that does its thing and hands the button straight back leaves `on` off
 * altogether, so it is never described as a state the stage is in.
 *
 * Only the picture is in the bar — the tools earn their width back for the hint
 * line and the readout — and what it means is said on hover instead, in a
 * HoverHint.
 */
function ToolButton({
  on,
  danger,
  label,
  icon,
  title,
  disabled,
  onClick,
}: {
  /** Left unset by a tool that is an action rather than a mode. */
  on?: boolean
  /** Set by the one tool that undoes work, so it is drawn as one. */
  danger?: boolean
  label: string
  icon: ReactNode
  /** The longer line under the name, saying what the tool does. */
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    // The picture the click was aimed at is gone the moment it lands; a hint
    // still hanging under it would be about a tool that is no longer in hand.
    <HoverHint label={label} hint={title} hideOnClick>
      <button
        className={['tool-btn', on ? 'on' : '', danger ? 'danger' : ''].filter(Boolean).join(' ')}
        aria-pressed={on}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
      </button>
    </HoverHint>
  )
}

/**
 * The bar across the top of the stage: the timeline, the tools that read a click
 * on the stage as something other than "select this", the simulator transport,
 * and the live readout at the far end.
 *
 * It is snapped under the top bar and runs the full width, so the tools sit
 * where the eye already is after the project bar rather than floating over the
 * workplane. Everything else on the stage — the model tree, the view cube, the
 * workplane itself — is set down below it.
 */
export default function Toolbar({ spec, asm }: { spec: TubeSpec; asm: Assembly }) {
  const {
    tool,
    setTool,
    pendingPort,
    pieces,
    selectedId,
    dropToWorkplane,
    duplicatePiece,
    removePiece,
    running,
    toggleRunning,
    resetSim,
    exportFormat,
    shading,
    toggleShading,
    shortcuts,
  } = useRun()
  // Same name the Export panel would give it — the toolbar is just a shortcut.
  const basename = useRun(exportBasename)
  const units = useRun((s) => s.units)
  const [t, setT] = useState({ speed: 0, distance: 0, airborne: false })

  useEffect(() => {
    const id = setInterval(() => setT({ ...telemetry }), 100)
    return () => clearInterval(id)
  }, [])

  const selectedIndex = pieces.findIndex((p) => p.id === selectedId)
  const selected = selectedIndex >= 0 ? pieceLabel(pieces[selectedIndex], selectedIndex) : null
  // Two separate runs are what the Connector has to work with; one part on its
  // own has both an inlet and an outlet, but joining them to each other would
  // only close it into a loop.
  const runs = chainsOf(pieces).length
  const joined = pieces.some((p) => p.joined)

  /**
   * What the tool in hand is waiting for, said in the bar rather than in a
   * tooltip. Kept to a couple of short lines — it is the last thing in the bar to
   * be given any width.
   */
  const hint = (): string => {
    if (tool === 'move') {
      return selected ? `Drag an arrow to move ${selected}'s run` : 'Select a part to move its run'
    }
    if (tool === 'rotate') {
      return selected ? `Drag the ring to turn ${selected}'s run` : 'Select a part to turn its run'
    }
    if (tool === 'connect') {
      if (runs < 2) return 'A joint needs two separate runs'
      // Order matters, so the bar says which end does what.
      return pendingPort ? 'Now pick the end it travels to' : 'Pick the end that should move'
    }
    if (tool === 'disconnect') {
      return joined ? 'Click a joint to break it open' : 'Nothing is joined yet'
    }
    return 'Pick a part — parts land unjoined'
  }

  const pick = (next: Tool) => setTool(tool === next ? 'select' : next)

  return (
    <div className="toolbar">
      <ToolGroup name="History">
        <UndoRedo />
      </ToolGroup>

      <ToolGroup name="Tools">
        <ToolButton
          on={tool === 'select'}
          label="Select"
          icon={<SelectIcon />}
          title="Pick parts with the left button — the resting state"
          onClick={() => setTool('select')}
        />
        <ToolButton
          on={tool === 'move'}
          label="Move"
          icon={<MoveIcon />}
          title="Move the selected part's run about the workplane on the three axis arrows"
          onClick={() => pick('move')}
        />
        <ToolButton
          on={tool === 'rotate'}
          label="Rotate"
          icon={<RotateIcon />}
          title="Turn the selected part's run about the upright, with the part you picked standing still"
          onClick={() => pick('rotate')}
        />
        <ToolButton
          label="Drop to Workplane"
          icon={<DropToPlaneIcon />}
          disabled={!selectedId}
          title={
            selected
              ? `Set ${selected}'s run straight down on the workplane, until its lowest wall rests on it`
              : 'Select a part to set its run down on the workplane'
          }
          onClick={() => selectedId && dropToWorkplane(selectedId)}
        />
        <ToolButton
          label="Duplicate"
          icon={<DuplicateIcon />}
          disabled={!selectedId}
          title={
            selected
              ? `Set a copy of ${selected} down beside the run, unjoined, and select it — ${formatShortcut(shortcuts.duplicate)}`
              : 'Select a part to copy it'
          }
          onClick={() => selectedId && duplicatePiece(selectedId)}
        />
        <ToolButton
          danger
          label="Delete"
          icon={<TrashIcon size={17} />}
          disabled={!selectedId}
          title={
            selected
              ? `Take ${selected} out of the run — what was joined to it closes up`
              : 'Select a part to take it out of the run'
          }
          onClick={() => selectedId && removePiece(selectedId)}
        />
      </ToolGroup>

      <ToolGroup name="Joints">
        <ToolButton
          on={tool === 'connect'}
          label="Connector"
          icon={<ConnectIcon />}
          disabled={runs < 2}
          title={
            runs < 2
              ? 'Nothing to join yet — a joint needs two parts that are not already in the same run'
              : 'Join two parts: click the end you want to move, then the end it travels to'
          }
          onClick={() => pick('connect')}
        />
        <ToolButton
          on={tool === 'disconnect'}
          label="Disconnector"
          icon={<DisconnectIcon />}
          disabled={!joined}
          title={
            joined
              ? 'Break a joint: click it, and what was hanging off it stays where it is'
              : 'No joints to break — nothing is joined together yet'
          }
          onClick={() => pick('disconnect')}
        />
      </ToolGroup>

      <ToolGroup name="Simulator">
        {/* Orange only while running — idle it stays a plain toolbar button. */}
        <button className={running ? 'primary on' : ''} onClick={toggleRunning}>
          {running ? '❚❚ Simulator' : '▶ Simulator'}
        </button>
        <button onClick={resetSim}>↺ Reset</button>
      </ToolGroup>

      <ToolGroup name="Model">
        <button
          className={shading === 'transparent' ? 'on' : ''}
          aria-pressed={shading === 'transparent'}
          title={
            shading === 'transparent'
              ? 'Switch back to solid shading'
              : 'See through the tube walls to watch the marble inside'
          }
          onClick={toggleShading}
        >
          {shading === 'transparent' ? '◍ Transparent' : '◉ Solid'}
        </button>
        <button
          disabled={!asm.placed.length}
          title={`Print plate as ${exportFormat.toUpperCase()} — every piece laid flat and separated, ready to slice`}
          onClick={() => exportPrintPlate(spec, asm.placed, exportFormat, basename)}
        >
          ⤓ {exportFormat.toUpperCase()}
        </button>
      </ToolGroup>

      <p className="tool-hint">{hint()}</p>

      <div className="telemetry">
        <div>
          <b>{(t.speed / 1000).toFixed(2)}</b>
          <span>m/s</span>
        </div>
        <div>
          <b>{coarseText(t.distance, units)}</b>
          <span>{UNIT_WORD[units]} travelled</span>
        </div>
        <div>
          <b>{t.airborne ? 'AIR' : 'IN TUBE'}</b>
          <span>state</span>
        </div>
      </div>
    </div>
  )
}
