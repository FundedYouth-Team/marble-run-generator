import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import HoverHint from './HoverHint'
import UndoRedo from './UndoRedo'
import {
  AlignFaceIcon,
  AlignIcon,
  ConnectIcon,
  DisconnectIcon,
  DropToPlaneIcon,
  MeasureIcon,
  SupportIcon,
  DuplicateIcon,
  DuplicateJoinIcon,
  MoveIcon,
  RotateIcon,
  SelectIcon,
  TrashIcon,
} from './icons'
import { telemetry } from '../lib/telemetry'
import { UNIT_LABEL, UNIT_WORD, coarseText, formatLength, fromMm, stepFor, toMm } from '../lib/units'
import { MOD_LABEL, TOOL_ACTION, formatShortcut } from '../lib/shortcuts'
import { partsBox, type Assembly } from '../lib/layout'
import {
  ALIGN_AXES,
  JOINT_FILLET_DEFAULT,
  PIECE_LIMITS,
  ROTATE_STEPS,
  chainsOf,
  isStructure,
  isChainRoot,
  pieceLabel,
  pieceSpec,
  rotateStepLabel,
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
 * Rotate has settings; Measure has a readout, which wants the same strip for the
 * same reason — the hint line in the bar is two short lines wide and cuts off
 * the third figure of three. Align has both at once: its nine faces are its only
 * controls, and there is no room in the bar for nine of anything. A tool's own
 * row goes under the bar rather than in it: the bar is already as wide as it can
 * be, and a tool that pushed the simulator or the readout off the end to make
 * room for itself would be taking away more than it added.
 */
export function hasToolOptions(tool: Tool): boolean {
  return tool === 'rotate' || tool === 'measure' || tool === 'align'
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
  keyCap,
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
  /** The bare key that takes this tool up, for a tool that has one. */
  keyCap?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    // The picture the click was aimed at is gone the moment it lands; a hint
    // still hanging under it would be about a tool that is no longer in hand.
    <HoverHint
      label={label}
      hint={
        // Said on the hint rather than on the button, which has room for the
        // picture and nothing else — and left unsaid while the tool is greyed
        // out, when the key does nothing either.
        keyCap && !disabled ? (
          <>
            {title} — or press <kbd>{keyCap}</kbd>
          </>
        ) : (
          title
        )
      }
      hideOnClick
    >
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
    setTool,
    pendingPort,
    pendingSpot,
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
    shading,
    toggleShading,
    shortcuts,
    rotateStep,
    setRotateStep,
    jointFillet,
    setJointFillet,
    alignTo,
    setAlignTo,
    setAlignHover,
    alignParts,
  } = useRun()
  const units = useRun((s) => s.units)
  /** Which end the view-type switch is at: solid walls, or see-through ones. */
  const xray = shading === 'transparent'
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
  // What the Align tool has to work with. A face is only a datum once there is
  // something else to bring onto it: one part is already lined up with itself,
  // and one part aligned onto the part leading the set is that same part twice.
  const alignable = selectedIds.length > 1
  // The part the rest come to, where the datum is a part rather than the set —
  // which is the one picked last, since that is the one that leads.
  const anchor = alignTo === 'lead' ? lead : null
  // How many actually travel: the set, less the one they are all coming to.
  const alignMovers = selectedIds.length - (alignTo === 'lead' ? 1 : 0)

  // The part the Rotate tool's pivot setting is about: only a bonded one has an
  // inlet joint to round off, so a run's head is left out and the setting is
  // only remembered for the next part that does.
  const bonded =
    selectedIndex >= 0 && !isChainRoot(pieces, selectedIndex) ? pieces[selectedIndex] : null
  // What that part's joint is cut at, or what the next one aimed will be. A part
  // that has never been told either way shows the setting, because the setting
  // is what its first swing will give it — see `aimPart`.
  const pivot = bonded?.jointFillet ?? jointFillet
  const setPivot = (mm: number) => setJointFillet(mm, bonded?.id)

  /**
   * The box the Measure tool is reading, so the bar can put its three spans in
   * words beside the figures the stage draws on it — a number you can read off
   * without hunting for which corner it is hanging on, and the one place the
   * three are written out together.
   *
   * The same box the stage draws, worked out the same way: what is picked, or
   * everything when nothing is. Only while the tool is in hand — there is
   * nothing to say about a box nobody has asked for.
   */
  const measured = useMemo(
    () =>
      tool === 'measure'
        ? partsBox(asm, selectedIds.length ? selectedIds : null, (piece) =>
            pieceSpec(spec, piece).outerR,
          )
        : null,
    [tool, asm, selectedIds, spec],
  )

  /**
   * What the tool in hand is waiting for, said in the bar rather than in a
   * tooltip. Kept to a couple of short lines — it is the last thing in the bar to
   * be given any width.
   */
  const hint = (): string => {
    // A set of parts is a set of runs to the handles, since a bonded part cannot
    // travel on its own — so the bar says what is actually about to move.
    if (tool === 'move') {
      if (!lead) return 'Select a part to move its run'
      return runsPicked > 1
        ? `Drag an arrow to move ${runsPicked} runs together`
        : `Drag an arrow to move ${lead}'s run`
    }
    if (tool === 'rotate') {
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
    // The figures themselves are on the strip under the bar, which has room for
    // all three; the hint says what to do to change what they are about.
    if (tool === 'measure') {
      if (!measured) return 'Nothing on the stage to measure yet — add a part'
      return lead
        ? `${MOD_LABEL}-click to take another part in`
        : 'Pick a part to box it instead of the stage'
    }
    // The nine faces are on the strip; the hint says what they will be measured
    // against, which is the half of the tool the buttons cannot show.
    if (tool === 'align') {
      if (!alignable) {
        return selectedIds.length
          ? `${MOD_LABEL}-click a second part to line ${lead} up with`
          : `Pick the parts to line up — ${MOD_LABEL}-click to take more in`
      }
      return anchor
        ? `${alignMovers} ${alignMovers === 1 ? 'part comes' : 'parts come'} to ${anchor} — pick the reference part last`
        : `${alignMovers} parts close up on their own outermost face`
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
      // Two clicks, and the bar counts them off: nothing is drawn between them,
      // so which half of the gesture you are in is a thing the bar has to say
      // rather than something the stage shows.
      if (!anyRun) return 'Nothing to prop yet — add a part first'
      return pendingSpot
        ? 'Now click the other end and the rod is struck — Escape lets go of it'
        : 'Click one end of the rod'
    }
    // Once a set is in hand the bar says so, since the two buttons that take the
    // whole set are the only place that shows.
    if (selectedIds.length > 1) {
      return `${selectedIds.length} parts picked — Duplicate and Delete take the set`
    }
    return `Pick a part — ${MOD_LABEL}-click to pick more`
  }

  // Taking up the tool already in hand puts it back down — the same toggle the
  // tool buttons have always had.
  const pick = (next: Tool) => setTool(tool === next ? 'select' : next)

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
          keyCap={formatShortcut(shortcuts[TOOL_ACTION.select])}
          onClick={() => setTool('select')}
        />
        {/* Both handles take hold of what is picked and of nothing else, so each
            is the one button it looks like: there is nothing to ask on the way
            in, and picking wider is how you move more — which is the gesture you
            were going to make anyway. The left button goes on picking while
            either is in hand, so the tool can be taken up before the part it is
            to work on, and the handles follow the pick from run to run. */}
        <ToolButton
          on={tool === 'move'}
          label="Move"
          icon={<MoveIcon />}
          disabled={!pieces.length}
          title={
            !pieces.length
              ? 'Nothing to move yet — add a part first'
              : "Move the picked part's run about the workplane on the three axis arrows, which stand in the middle of what is picked — pick parts in several runs and they all travel together, by the one distance, so the model keeps its shape"
          }
          keyCap={formatShortcut(shortcuts[TOOL_ACTION.move])}
          onClick={() => pick('move')}
        />
        <ToolButton
          on={tool === 'rotate'}
          label="Rotate"
          icon={<RotateIcon />}
          disabled={!pieces.length}
          title={
            !pieces.length
              ? 'Nothing to aim yet — add a part first'
              : "Aim the picked part on three rings, standing in the middle of what is picked, on the same axes the move arrows travel on. A bonded part bends the run where it stands: everything ahead of it holds still and everything past it swings with it. A run's head has nothing in front of it, so its green ring turns the whole run — about that middle, carrying any other run picked alongside it round the same point. Its own settings appear on a strip under the bar while it is in hand"
          }
          keyCap={formatShortcut(shortcuts[TOOL_ACTION.rotate])}
          onClick={() => pick('rotate')}
        />
        {/* A mode rather than a click, because what it measures is whatever you
            pick next: the left button goes on picking parts while it is in hand,
            and the box follows the pick from part to part. It differs from the
            handles in taking the parts themselves rather than the runs they
            stand in, and in taking the whole stage when nothing is picked —
            there is always a box worth reading, where there is nothing to move
            until something is picked to move. */}
        <ToolButton
          on={tool === 'measure'}
          label="Measure"
          icon={<MeasureIcon />}
          disabled={!pieces.length}
          title={
            pieces.length
              ? 'Box what you have picked and read its width, length and height off it — squared to the world, and measured to the outside of the tube. Pick nothing and it takes the whole stage; keep picking with it in hand and the box follows'
              : 'Nothing to measure yet — add a part first'
          }
          onClick={() => pick('measure')}
        />
        {/* A mode for the same reason Measure is one, and it sits beside it
            because it is the same box asked a second question: Measure reads the
            box off what is picked, and this brings what is picked onto one face
            of it. So the left button goes on picking here too — changing the
            pick is how you say what is being lined up, and the nine faces are on
            the strip rather than in the bar because nine of anything would fill
            the bar on its own. */}
        <ToolButton
          on={tool === 'align'}
          label="Align"
          icon={<AlignIcon />}
          disabled={pieces.length < 2}
          title={
            pieces.length < 2
              ? 'Nothing to line up yet — alignment needs two parts'
              : 'Line the picked parts up on one face — their own outermost, or the face of the part you picked last. Keep picking with it in hand and the datum follows'
          }
          keyCap={formatShortcut(shortcuts[TOOL_ACTION.align])}
          onClick={() => pick('align')}
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
                'Click the two points you want braced and a rod is struck between them. The first click drops a green mark and nothing more; the rod appears when the second one lands. Escape lets go of a half-struck one',
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
          keyCap={formatShortcut(shortcuts[TOOL_ACTION.connect])}
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

      <ToolGroup name="View Type">
        {/* Both states named either side of the switch rather than one label
            that changes: a button reading "Solid" says nothing about what
            pressing it gets you, where a switch between two named ends says
            where it is and where it would go at a glance. The whole control
            takes the click, so either word flips it as readily as the track. */}
        <button
          className="slide-toggle"
          role="switch"
          aria-checked={xray}
          aria-label="See through the tube walls"
          title={
            xray
              ? 'Switch back to solid shading'
              : 'See through the tube walls to watch the marble inside'
          }
          onClick={toggleShading}
        >
          <span className={xray ? 'slide-word' : 'slide-word on'}>Solid</span>
          <span className="slide-track">
            <span className="slide-thumb" />
          </span>
          <span className={xray ? 'slide-word on' : 'slide-word'}>Transparent</span>
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
          the whole point: a tool that squeezed the simulator or the readout
          off the end to show its own controls would be taking away more than it
          gave. */}
      {tool === 'measure' && (
        <div className="toolbar-row options">
          <span className="tool-options-tool">Measure</span>
          {measured ? (
            <>
              {/* Named and lettered both, because nothing but the axis tells
                  width and length apart — the same pair the figures on the
                  stage carry, so the strip and the box read as one drawing. */}
              {(
                [
                  ['Width', 'X', measured.max.x - measured.min.x],
                  ['Length', 'Z', measured.max.z - measured.min.z],
                  ['Height', 'Y', measured.max.y - measured.min.y],
                ] as const
              ).map(([name, axis, mm]) => (
                <ToolOption key={name} name={name}>
                  <b className="tool-figure">
                    <i>{axis}</i>
                    {formatLength(mm, units)}
                  </b>
                </ToolOption>
              ))}
              {/* What the box was drawn round, so a figure is never read as
                  being about something it is not. */}
              <span className="tool-option-note">
                {!lead
                  ? 'the whole stage — nothing picked'
                  : selectedIds.length > 1
                    ? `${selectedIds.length} parts picked`
                    : `on ${lead}`}
              </span>
            </>
          ) : (
            <span className="tool-option-note">nothing on the stage to measure yet</span>
          )}
        </div>
      )}

      {tool === 'align' && (
        <div className="toolbar-row options">
          <span className="tool-options-tool">Align</span>

          {/* Asked first, because it is what the nine faces are measured
              against: the same button means two different places depending on
              the answer, so the answer comes before the buttons rather than
              after them. */}
          <ToolOption name="Onto">
            <div className="segmented small">
              <button
                className={alignTo === 'selection' ? 'on' : ''}
                onClick={() => setAlignTo('selection')}
                title="Line the picked parts up on their own outermost face — they close up on each other, and none travels further than it has to"
              >
                The set
              </button>
              <button
                className={alignTo === 'lead' ? 'on' : ''}
                onClick={() => setAlignTo('lead')}
                title={`Bring every other picked part onto the face of the part leading the set — ${MOD_LABEL}-click the reference part last and it stays exactly where it is`}
              >
                {/* Named whichever datum is in force, so the button says what
                    switching to it would do rather than only what it has
                    already done. */}
                {lead ?? 'Lead part'}
              </button>
            </div>
          </ToolOption>

          {/* Three rows of three, laid out the way the axes are: across, up,
              along. Each is a click that does its thing — there is no state to
              be left in, so nothing here is ever drawn as pressed.

              Drawn rather than named. "Left" is a word for a picture, and nine
              of those words across three rows is a wall of text on a strip one
              line high — so each button is that picture instead, and the word
              lives on in the hover and in the label anything reading the page
              aloud will use. Resting on one also draws the face it means on the
              stage, which is the whole answer rather than a glyph of it. */}
          {ALIGN_AXES.map((row) => (
            <ToolOption key={row.axis} name={row.name}>
              <div className="segmented small icons">
                {row.edges.map((e) => (
                  <button
                    key={e.edge}
                    disabled={!alignable}
                    aria-label={`${e.label} — ${row.name} ${row.letter}`}
                    title={`${e.label} — ${e.hint} ${anchor ? `of ${anchor}` : 'of the picked set'}`}
                    onMouseEnter={() => setAlignHover({ axis: row.axis, edge: e.edge })}
                    onMouseLeave={() => setAlignHover(null)}
                    onFocus={() => setAlignHover({ axis: row.axis, edge: e.edge })}
                    onBlur={() => setAlignHover(null)}
                    onClick={() => alignParts(row.axis, e.edge)}
                  >
                    <AlignFaceIcon axis={row.axis} edge={e.edge} />
                  </button>
                ))}
              </div>
              <i className="tool-axis">{row.letter}</i>
            </ToolOption>
          ))}

          {/* What is about to move, so a click is never aimed at a set that is
              not the one you think you have. */}
          <span className="tool-option-note">
            {!alignable
              ? selectedIds.length
                ? 'one part picked — pick another to line it up with'
                : 'nothing picked yet'
              : anchor
                ? `${alignMovers} ${alignMovers === 1 ? 'part' : 'parts'} → ${anchor}`
                : `${alignMovers} parts picked`}
          </span>
        </div>
      )}

      {tool === 'rotate' && (
        <div className="toolbar-row options">
          <span className="tool-options-tool">Rotate</span>

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
