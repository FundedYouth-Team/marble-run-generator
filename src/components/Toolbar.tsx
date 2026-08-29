import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import HoverHint from './HoverHint'
import UndoRedo from './UndoRedo'
import {
  ConnectIcon,
  DisconnectIcon,
  DropToPlaneIcon,
  SupportIcon,
  DuplicateIcon,
  DuplicateJoinIcon,
  MoveIcon,
  RotateIcon,
  SelectIcon,
  TrashIcon,
} from './icons'
import { telemetry } from '../lib/telemetry'
import { UNIT_LABEL, UNIT_WORD, coarseText, fromMm, stepFor, toMm } from '../lib/units'
import { MOD_LABEL, formatShortcut } from '../lib/shortcuts'
import { exportPrintPlate } from '../lib/exporters'
import type { Assembly } from '../lib/layout'
import {
  JOINT_FILLET_DEFAULT,
  PIECE_LIMITS,
  ROTATE_STEPS,
  chainsOf,
  isStructure,
  exportBasename,
  isChainRoot,
  pieceLabel,
  rotateStepLabel,
  useRun,
  type Tool,
  type ToolScope,
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
 * One setting on the strip under the bar, named beside itself rather than above.
 *
 * The strip is a single line high, so a name stacked over its control the way
 * {@link ToolGroup} stacks one would double its height for nothing. Beside is
 * also how it reads: these are a sentence about the tool in hand, not another
 * list of buttons.
 */
function ToolOption({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="tool-option">
      <span className="tool-option-name">{name}</span>
      {children}
    </div>
  )
}

/**
 * How tall the bar is, and how much taller again it stands when the tool in hand
 * has settings of its own. Kept here rather than in the stylesheet because the
 * stage is set down below the bar by these numbers and the view cube is placed
 * inside the canvas, in pixels, where CSS cannot reach it.
 */
export const TOOLBAR_HEIGHT = 62
export const TOOL_OPTIONS_HEIGHT = 38

/**
 * Whether a tool brings a strip of its own settings with it — which is what says
 * how far down the stage starts.
 *
 * Only Rotate has any so far. A tool's settings go under the bar rather than in
 * it: the bar is already as wide as it can be, and a tool that pushed the
 * simulator or the export button off the end to make room for itself would be
 * taking away more than it added.
 */
export function hasToolOptions(tool: Tool): boolean {
  return tool === 'rotate'
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

/** One line of a {@link ToolMenuButton}'s menu. */
type ToolMenuItem = {
  label: string
  icon: ReactNode
  /** The longer line under the name, saying what this way of doing it does. */
  title: string
  /** The keyboard binding that does the same thing, if there is one. */
  hint?: string
  /**
   * Left unset by an item that does its thing and is done. Set by one that puts
   * the stage into a mode, so the menu says which mode it is in — and clicking
   * it again is what switches back out, the way the plain tools toggle.
   */
  on?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * A tool that does its thing more than one way, which asks which way on click
 * rather than taking a button in the bar for each.
 *
 * The menu is hung off the body rather than off the bar: the toolbar clips its
 * own overflow, so a menu drawn inside it would be cut off at the bar's edge —
 * the same reason the hover hints are portalled. It is placed in viewport pixels
 * under the button, and closes on a click anywhere else, on Escape, and on
 * anything that would move the button out from under it.
 */
function ToolMenuButton({
  on,
  label,
  icon,
  title,
  disabled,
  items,
}: {
  /** Set by a tool that is a mode, so the button reads as pressed while it holds. */
  on?: boolean
  label: string
  icon: ReactNode
  title: string
  disabled?: boolean
  items: ToolMenuItem[]
}) {
  const slot = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const open = at !== null

  useEffect(() => {
    if (!open) return
    const close = () => setAt(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // Pointer down rather than click, so the menu is gone before whatever was
    // clicked behind it acts — and the button itself is left out, since its own
    // handler is what toggles the menu shut.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (slot.current?.contains(t)) return
      if ((t as Element).closest?.('.tool-menu')) return
      close()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  // A tool that loses what it had to work on while its menu is open has nothing
  // left for the menu to act on.
  useEffect(() => {
    if (disabled) setAt(null)
  }, [disabled])

  const toggle = () => {
    if (open) return setAt(null)
    const r = slot.current?.getBoundingClientRect()
    if (r) setAt({ x: r.left, y: r.bottom + 6 })
  }

  return (
    <span className="tool-menu-slot" ref={slot}>
      <HoverHint label={label} hint={title} hideOnClick>
        <button
          className={['tool-btn', 'has-menu', on || open ? 'on' : ''].filter(Boolean).join(' ')}
          aria-label={label}
          aria-pressed={on}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={toggle}
        >
          {icon}
          {/* The mark that says there is more than one way to do this — small
              enough to sit in the button's corner without crowding the tool. */}
          <span className="tool-btn-caret" aria-hidden="true" />
        </button>
      </HoverHint>
      {at &&
        createPortal(
          <div className="part-menu tool-menu" style={{ left: at.x, top: at.y }} role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                aria-pressed={it.on}
                className={it.on ? 'on' : undefined}
                title={it.title}
                disabled={it.disabled}
                onClick={() => {
                  setAt(null)
                  it.onClick()
                }}
              >
                {it.icon}
                {it.label}
                {it.hint && <kbd className="part-menu-key">{it.hint}</kbd>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
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
    toolScope,
    setTool,
    pendingPort,
    pieces,
    selectedId,
    selectedIds,
    dropToWorkplane,
    braceEveryRun,
    duplicateParts,
    removeParts,
    running,
    toggleRunning,
    resetSim,
    exportFormat,
    shading,
    toggleShading,
    shortcuts,
    rotateStep,
    setRotateStep,
    jointFillet,
    setJointFillet,
  } = useRun()
  // Same name the Export panel would give it — the toolbar is just a shortcut.
  const basename = useRun(exportBasename)
  const units = useRun((s) => s.units)
  const [t, setT] = useState({ speed: 0, distance: 0, airborne: false, stuck: false })

  useEffect(() => {
    const id = setInterval(() => setT({ ...telemetry }), 100)
    return () => clearInterval(id)
  }, [])

  const selectedIndex = pieces.findIndex((p) => p.id === selectedId)
  const lead = selectedIndex >= 0 ? pieceLabel(pieces[selectedIndex], selectedIndex) : null
  // What the buttons that take the whole set are about — the one part by name
  // while that is all there is, and the count once picking has gone wider.
  const selected = !lead ? null : selectedIds.length > 1 ? `${selectedIds.length} parts` : lead
  // Two separate runs are what the Connector has to work with; one part on its
  // own has both an inlet and an outlet, but joining them to each other would
  // only close it into a loop.
  const chains = chainsOf(pieces)
  const runs = chains.length
  /**
   * Whether there is any actual run on the stage — tube, as against the ground
   * under it. A stage of nothing but plates and posts is a stage with nothing to
   * prop, and every chain on it is a run of one that no marble travels.
   */
  const anyRun = pieces.some((p) => !isStructure(p))
  const joined = pieces.some((p) => p.joined)
  // How many runs the handles have in hand: the runs the picked parts stand in,
  // counted once each however many of their parts were picked.
  const runsPicked = chains.filter((c) => c.some((i) => selectedIds.includes(pieces[i].id))).length

  // The part the Rotate tool's pivot setting is about: only a bonded one has an
  // inlet joint to round off, so a run's head is left out and the setting is
  // only remembered for the next part that does. At the wider reach the rings
  // stand on the head of the picked run rather than on the picked part, so there
  // is no inlet joint under them however deep in a run the pick was.
  const bonded =
    toolScope !== 'all' && selectedIndex >= 0 && !isChainRoot(pieces, selectedIndex)
      ? pieces[selectedIndex]
      : null
  // What that part's joint is cut at, or what the next one aimed will be. A part
  // that has never been told either way shows the setting, because the setting
  // is what its first swing will give it — see `aimPart`.
  const pivot = bonded?.jointFillet ?? jointFillet
  const setPivot = (mm: number) => setJointFillet(mm, bonded?.id)

  /**
   * What the tool in hand is waiting for, said in the bar rather than in a
   * tooltip. Kept to a couple of short lines — it is the last thing in the bar to
   * be given any width.
   */
  const hint = (): string => {
    // A set of parts is a set of runs to the handles, since a bonded part cannot
    // travel on its own — so the bar says what is actually about to move.
    if (tool === 'move') {
      // At the wider reach nothing has to be picked for the arrows to have
      // something to take hold of, so the bar says what they have rather than
      // asking for a part.
      if (toolScope === 'all') {
        return runs > 1
          ? `Drag an arrow to move all ${runs} runs together`
          : 'Drag an arrow to move the whole run'
      }
      if (!lead) return 'Select a part to move its run'
      return runsPicked > 1
        ? `Drag an arrow to move ${runsPicked} runs together`
        : `Drag an arrow to move ${lead}'s run`
    }
    if (tool === 'rotate') {
      if (toolScope === 'all') {
        return runs > 1
          ? `Drag the green ring to turn all ${runs} runs together`
          : 'Drag a ring to aim the head of the run, and the run with it'
      }
      if (!lead) return 'Select a part to aim it'
      // A bonded part bends the run where it stands; a run's head has nothing
      // in front of it to hold, so its rings still swing the whole run.
      if (!isChainRoot(pieces, selectedIndex)) {
        return `Drag a ring to swing ${lead} and everything past it`
      }
      return runsPicked > 1
        ? `Drag the green ring to turn ${runsPicked} runs about ${lead}`
        : `Drag a ring to aim ${lead}, and its run with it`
    }
    if (tool === 'connect') {
      if (runs < 2) return 'A joint needs two separate runs'
      // Order matters, so the bar says which end does what.
      return pendingPort ? 'Now pick the end it travels to' : 'Pick the end that should move'
    }
    if (tool === 'disconnect') {
      return joined ? 'Click a joint to break it open' : 'Nothing is joined yet'
    }
    if (tool === 'support') {
      // The ghost is the whole feedback loop, so the bar says to read it: a spot
      // that will not take a post shows nothing and takes no click either, and
      // without being told that, a click that does nothing reads as a fault.
      return anyRun
        ? 'Click a spot on the run to stand a post under it — no ghost, no room'
        : 'Nothing to prop yet — add a part first'
    }
    // Once a set is in hand the bar says so, since the two buttons that take the
    // whole set are the only place that shows.
    if (selectedIds.length > 1) {
      return `${selectedIds.length} parts picked — Duplicate and Delete take the set`
    }
    return `Pick a part — ${MOD_LABEL}-click to pick more`
  }

  // Taking up the tool already in hand, at the reach it is already at, puts it
  // back down — the same toggle the plain tool buttons have always had. Asking
  // the same tool for the other reach just switches the reach.
  const pick = (next: Tool, scope: ToolScope = 'selected') =>
    setTool(tool === next && toolScope === scope ? 'select' : next, scope)

  return (
    <div className="toolbar">
      <div className="toolbar-row">
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
        {/* Both handles ask how far they reach on click: taking hold of what is
            picked and taking hold of the lot are the same gesture asked of two
            different sets, so it is a question about the tool rather than a
            second tool that looks like it. */}
        <ToolMenuButton
          on={tool === 'move'}
          label="Move"
          icon={<MoveIcon />}
          title="Move runs about the workplane on the three axis arrows — either the runs you have picked, or every run on the stage"
          items={[
            {
              label: 'Move Selected',
              icon: <MoveIcon size={14} />,
              title:
                "Move the picked part's run about the workplane on the three axis arrows — pick parts in several runs and they all travel together",
              on: tool === 'move' && toolScope === 'selected',
              onClick: () => pick('move', 'selected'),
            },
            {
              label: 'Move All',
              icon: <MoveIcon size={14} />,
              title:
                'Move every run on the stage together on the three axis arrows, whatever is picked — they all travel the one distance, so the model keeps its shape',
              on: tool === 'move' && toolScope === 'all',
              disabled: !pieces.length,
              onClick: () => pick('move', 'all'),
            },
          ]}
        />
        <ToolMenuButton
          on={tool === 'rotate'}
          label="Rotate"
          icon={<RotateIcon />}
          title="Aim parts and swing runs on three rings, the same axes the move arrows travel on — either what you have picked, or every run on the stage. Its own settings appear on a strip under the bar while it is in hand"
          items={[
            {
              label: 'Rotate Selected',
              icon: <RotateIcon size={14} />,
              title:
                "Aim the picked part on three rings. A bonded part bends the run where it stands: everything ahead of it holds still and everything past it swings with it. A run's head has nothing in front of it, so its green ring turns the whole run",
              on: tool === 'rotate' && toolScope === 'selected',
              onClick: () => pick('rotate', 'selected'),
            },
            {
              label: 'Rotate All',
              icon: <RotateIcon size={14} />,
              title:
                'Turn every run on the stage about the head of the picked run on the green ring, whatever is picked — they all turn by the one angle, so the model keeps its arrangement. Red and blue still aim that head part, and tip its run with it',
              on: tool === 'rotate' && toolScope === 'all',
              disabled: !pieces.length,
              onClick: () => pick('rotate', 'all'),
            },
          ]}
        />
        <ToolButton
          label="Place on Workplane"
          icon={<DropToPlaneIcon />}
          disabled={!selectedId}
          title={
            lead
              ? `Set ${lead}'s run straight down on the workplane, until its lowest wall rests on it`
              : 'Select a part to set its run down on the workplane'
          }
          onClick={() => selectedId && dropToWorkplane(selectedId)}
        />
        {/* One rod at a time by hand, or the whole stage propped in one go, under
            the one button — the same question asked of two points or of
            everything, which is how Move and Duplicate are put together too.
            Striking leads, because choosing what a brace runs between is the
            part a person does far better than a rule: a rod down the outside of
            a coil, tying every turn on the way, is one gesture and no rule
            finds that line. */}
        <ToolMenuButton
          on={tool === 'support'}
          label="Rods"
          icon={<SupportIcon />}
          disabled={!anyRun}
          title={
            anyRun
              ? 'Brace the run with rods, so the tubes are held up rather than printed hanging in mid-air — one struck between two points you click, or a set dropped everywhere the stage will take them, from whichever side of the tube you pick'
              : 'Nothing to brace yet — add a part and its run can be propped'
          }
          items={[
            {
              label: 'Strike a Rod',
              icon: <SupportIcon size={14} />,
              title:
                'Click the two points you want braced and a rod is struck between them. The stage draws it from the first click to wherever the pointer is, so you see it before you commit; Escape lets go of a half-struck one',
              on: tool === 'support',
              onClick: () => pick('support'),
            },
            // Four braces rather than one, because where a rod leaves the tube
            // is the whole question on anything that curves: a coil braced up
            // its hollow middle keeps its outside clear to watch the marble
            // down, and one braced outside keeps the middle clear to look down
            // through. Under and over are the plain answers for everything else.
            {
              label: 'Brace Under the Run',
              icon: <SupportIcon size={14} />,
              title:
                'Drop a rod from the underside of the tube to the first thing beneath it, everywhere on the stage a rod will fit — the plate, or another turn of the run where the plate is taken',
              disabled: !anyRun,
              onClick: () => braceEveryRun('down'),
            },
            {
              label: 'Brace Outside the Bend',
              icon: <SupportIcon size={14} />,
              title:
                'Strike each rod from the outer flank of the tube instead, so a coil is tied down its outside and the view down its middle stays clear. The one to reach for on a coil that narrows as it falls, where the turns are closing in on each other inside',
              disabled: !anyRun,
              onClick: () => braceEveryRun('outward'),
            },
            {
              label: 'Brace Inside the Bend',
              icon: <SupportIcon size={14} />,
              title:
                'Strike each rod from the inner flank, so a coil is tied up its hollow middle and its outside is left clear to watch the marble go down',
              disabled: !anyRun,
              onClick: () => braceEveryRun('inward'),
            },
            {
              label: 'Brace Over the Run',
              icon: <SupportIcon size={14} />,
              title:
                'Strike each rod from the top of the tube and run it up to the first thing above — for hanging a run from what is over it rather than standing it on what is under it',
              disabled: !anyRun,
              onClick: () => braceEveryRun('up'),
            },
          ]}
        />
        {/* Both ways of copying under the one button: they are the same tool
            answering "where does the copy land", and asking that on click keeps
            the bar to one picture rather than two that look alike. */}
        <ToolMenuButton
          label="Duplicate"
          icon={<DuplicateIcon />}
          disabled={!selected}
          title={
            selected
              ? `Copy ${selected} — beside the run, or joined onto the end of it`
              : `Select a part to copy it — ${MOD_LABEL}-click picks more than one`
          }
          items={[
            {
              label: 'Duplicate',
              icon: <DuplicateIcon size={14} />,
              title: `Set a copy of ${selected ?? 'the part'} down beside the run, unjoined, and select it`,
              hint: formatShortcut(shortcuts.duplicate),
              onClick: () => duplicateParts(selectedIds),
            },
            {
              label: 'Duplicate and Join',
              icon: <DuplicateJoinIcon size={14} />,
              title: `Copy ${selected ?? 'the part'} onto the open end of the run, joined on where a new part would land`,
              hint: formatShortcut(shortcuts.duplicateJoined),
              onClick: () => duplicateParts(selectedIds, { join: true }),
            },
          ]}
        />
        <ToolButton
          danger
          label="Delete"
          icon={<TrashIcon size={17} />}
          disabled={!selected}
          title={
            selected
              ? `Take ${selected} out of the run — what was joined to it closes up`
              : 'Select a part to take it out of the run'
          }
          onClick={() => removeParts(selectedIds)}
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
          {/* Stuck outranks the other two: a marble at rest on a fall too shallow
              to start it again is the one state a speed of nought hides. */}
          <b className={t.stuck ? 'warn' : undefined}>
            {t.stuck ? 'STUCK' : t.airborne ? 'AIR' : 'IN TUBE'}
          </b>
          <span>state</span>
        </div>
      </div>
      </div>

      {/* The settings belonging to the tool in hand, on a strip of their own
          under the bar. Nothing in the bar moves to make room for them, which is
          the whole point: a tool that squeezed the simulator or the export
          button off the end to show its own controls would be taking away more
          than it gave. */}
      {tool === 'rotate' && (
        <div className="toolbar-row options">
          <span className="tool-options-tool">
            {toolScope === 'all' ? 'Rotate All' : 'Rotate'}
          </span>

          <ToolOption name="Step">
            <div className="segmented small">
              {ROTATE_STEPS.map((deg) => (
                <button
                  key={deg}
                  className={rotateStep === deg ? 'on' : ''}
                  onClick={() => setRotateStep(deg)}
                  title={
                    deg > 0
                      ? `Hold every swing to whole ${deg}° notches`
                      : 'Swing the rings to wherever they are dragged'
                  }
                >
                  {rotateStepLabel(deg)}
                </button>
              ))}
            </div>
          </ToolOption>

          <ToolOption name="Joint pivot">
            <div className="segmented small">
              <button
                className={pivot > 0 ? 'on' : ''}
                onClick={() => setPivot(pivot > 0 ? pivot : JOINT_FILLET_DEFAULT)}
                title="Round the break the joint bends at into an arc — the marble carries its speed through rather than slapping into a kink"
              >
                Rounded
              </button>
              <button
                className={pivot > 0 ? '' : 'on'}
                onClick={() => setPivot(0)}
                title="Leave the break the joint bends at a mitred corner"
              >
                Straight
              </button>
            </div>
            {pivot > 0 && (
              <label
                className="numbox"
                title="Radius the joint is rounded off with — a wide one costs turn, since its arc reaches further back down the lead"
              >
                <input
                  type="number"
                  value={Number(fromMm(pivot, units).toFixed(units === 'in' ? 3 : 1))}
                  min={fromMm(PIECE_LIMITS.jointFillet.min, units)}
                  max={fromMm(PIECE_LIMITS.jointFillet.max, units)}
                  step={stepFor(PIECE_LIMITS.jointFillet.step, units)}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setPivot(toMm(v, units))
                  }}
                />
                <i>{UNIT_LABEL[units]}</i>
              </label>
            )}
            {/* Which joint the pivot is about, so a setting that has just moved a
                part is never mistaken for one that is only being remembered. */}
            <span className="tool-option-note">
              {bonded
                ? `on ${pieceLabel(bonded, selectedIndex)}`
                : lead
                  ? 'run head — no inlet joint'
                  : 'for the next part aimed'}
            </span>
          </ToolOption>

        </div>
      )}
    </div>
  )
}
