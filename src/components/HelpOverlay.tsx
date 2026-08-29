import { useEffect, useState } from 'react'
import { useRun, type Mode } from '../store'
import { PROJECT_EXT, PROJECT_VERSION } from '../lib/project'
import { MOD_LABEL, formatShortcut, type ShortcutMap } from '../lib/shortcuts'

/** One line of the cheat sheet: what you press, and what it does. */
interface Shortcut {
  /** Rendered as key caps; an entry starting with a glyph reads as an on-screen button. */
  keys: string[]
  action: string
  note?: string
}

interface Group {
  title: string
  rows: Shortcut[]
}

/**
 * A worked example: the question as it gets asked, and the clicks that answer
 * it. The cheat-sheet rows say what each control does one at a time; these are
 * for the jobs that take several of them in the right order.
 */
interface HowTo {
  question: string
  /** Said before the steps — usually why the obvious approach is not the one. */
  lead?: string
  steps: string[]
  note?: string
}

/**
 * The help is tabbed by what you are working on: the run as a whole, or one of
 * the two workspaces. Anything true of both workspaces lives in `alwaysGroup`
 * instead, so it is said once rather than in every tab.
 */
type HelpTab = 'project' | Mode

const HELP: Record<HelpTab, Group[]> = {
  project: [
    {
      title: 'The project',
      rows: [
        {
          keys: ['Project'],
          action: 'Name the run, in the top bar',
          note: 'every file it saves or exports is named after it; left blank it falls back to Untitled',
        },
        {
          keys: ['Save'],
          action: 'Write the run to a .mrun.json file on your machine',
          note: 'parts, tube size, style, marble fit and your shortcut keys — ready to open again',
        },
        {
          keys: ['Open'],
          action: 'Put a saved .mrun.json back on the stage',
          note: 'it asks first — opening replaces the run you have now',
        },
        {
          keys: ['New'],
          action: 'Clear the stage back to a single default part',
          note: 'it asks first; your theme, colours and screen calibration are left alone',
        },
        {
          keys: ['⤓ Print plate'],
          action: 'Export meshes for printing, from the sidebar',
          note: '3MF, STL or OBJ — printable files, not a project you can reopen',
        },
      ],
    },
    {
      title: 'History',
      rows: [
        {
          keys: ['History tab'],
          action: 'The last 10 changes to the run, newest first',
          note: 'the vertical tab on the right edge; Esc closes it',
        },
        {
          keys: ['Click a step'],
          action: 'Jump straight back — or forward — to it',
          note: 'the steps ahead stay listed, greyed, until the next edit drops them',
        },
        {
          keys: ['Undo', 'Redo'],
          action: 'Step one change at a time',
          note: 'at the top of the History panel, and on the 3D HUD',
        },
        {
          keys: ['Recorded'],
          action: 'Parts, tube size, style and marble fit — nothing else',
          note: 'camera, theme and playback stay put, so stepping back never moves your view',
        },
        {
          keys: ['Not recorded'],
          action: 'Saving, opening and starting a new project',
          note: 'each of those begins the timeline again rather than adding a step',
        },
      ],
    },
  ],
  '3d': [
    {
      title: 'Camera',
      rows: [
        { keys: ['Right-drag'], action: 'Rotate around the run' },
        { keys: ['Scroll'], action: 'Zoom in and out', note: 'pinch on a trackpad' },
        {
          keys: ['Middle-drag'],
          action: 'Pan the view',
          note: 'press the scroll wheel in and drag; shift + right-drag does it too',
        },
        {
          keys: ['View cube'],
          action: 'Click a face, edge or corner to swing round to it',
          note: 'top-right; left-drag the cube itself to spin the view',
        },
        { keys: ['Home button'], action: 'Reset to the home angle, whole run in frame', note: 'under the cube' },
        { keys: ['Fit button'], action: 'Re-frame the whole run from the current angle' },
      ],
    },
    {
      title: 'Parts',
      rows: [
        { keys: ['Left-click a part'], action: 'Select it and open its settings in the sidebar' },
        {
          keys: [`${MOD_LABEL}-click a part`],
          action: 'Add it to the selection, or take it back out',
          note: 'Shift does the same on the stage — in Active Parts it takes a range instead; Duplicate and Delete then take the whole set, while the settings, the arrows and the ring stay on the last part picked',
        },
        { keys: ['Left-click empty space'], action: 'Deselect' },
        {
          keys: ['Right-click a part'],
          action: 'Part menu — select, hide, rename, duplicate or delete it on the spot',
          note: 'a right-drag still rotates the camera; only a press that stays put opens the menu',
        },
        {
          keys: ['Active Parts'],
          action: 'Switch a part off to take it out of both views',
          note: 'it still holds its place in the run',
        },
        {
          keys: ['Tick a part', 'Shift-click a part'],
          action: 'Build a set in the list — one row at a time, or a whole run of rows at once',
          note: 'Shift takes everything between the row last picked and the row clicked',
        },
      ],
    },
    {
      title: 'Tools',
      rows: [
        {
          keys: ['Select'],
          action: 'Pick parts with the left button',
          note: 'the resting state — the other tools take the left button over until switched off',
        },
        {
          keys: ['Move'],
          action: 'Drag the three axis arrows to move the selected part about the workplane',
          note: `red is X, green Y, blue Z; anything joined to that part travels with it, and with a set picked (${MOD_LABEL}-click) every run in the set travels the same distance. The button asks how far the arrows reach: Move Selected, which is that, or Move All, which takes every run on the stage whatever is picked`,
        },
        {
          keys: ['Rotate'],
          action: 'Drag any of the three rings to aim the selected part — red X, green Y, blue Z, the same axes the arrows travel on',
          note: 'a bonded part bends the run where it stands: it swings about the joint it is plugged into, everything ahead of it holds still, and everything past it comes along holding its shape. On a run’s head, which has nothing in front of it to hold, the green ring turns the whole run instead — and carries any set picked alongside it round that same point. a strip appears under the bar while it is in hand, carrying its own two settings: Step, the notch every swing is held to, and Joint pivot, whether the break it bends at is rounded off or left a mitred corner. The button asks how far the rings reach: Rotate Selected, which is all of the above, or Rotate All, which stands the rings on the head of the picked run and turns every run on the stage about it',
        },
        {
          keys: ['Place on Workplane'],
          action: 'Set the selected part’s run straight down until its lowest wall rests on the plane',
          note: 'one click rather than a mode — nothing else about the run moves, and a run left sunk below the plane is lifted onto it instead; also on a part’s right-click menu',
        },
        {
          keys: ['⌶ Rods'],
          action: 'Click two points and strike a rod between them',
          note: 'a mode, like the two joint tools: while it is in hand the left button marks a point in space rather than picking a part. The first click is only remembered — nothing is built and nothing reaches the timeline until the second says what the rod is between — and the stage draws it from one to the other as you move. Escape lets go of a half-struck rod; the button’s menu holds Brace Every Run, which paces out the whole stage in one step',
        },
        {
          keys: ['Connector'],
          action: 'Join two parts: click the end you want to move, then the end it travels to',
          note: 'the first end picked is the one that moves; an inlet mates with an outlet, and the ends that cannot take the one in hand go grey',
        },
        {
          keys: ['Disconnector'],
          action: 'Click a joint to break it open',
          note: 'both sides stay exactly where they were — nothing springs back',
        },
      ],
    },
    {
      title: 'Toolbar',
      rows: [
        { keys: ['↶', '↷'], action: 'Step back and forward through the last 10 changes', note: 'listed in the History tab' },
        {
          keys: ['▶ Simulator'],
          action: 'Put the marble on the run and start it rolling',
          note: 'there is no marble on the stage until you press it; the same button pauses it',
        },
        { keys: ['↺ Reset'], action: 'Send the marble back to the start' },
        { keys: ['◉ Solid', '◍ Transparent'], action: 'See through the tube walls' },
        { keys: ['⤓ 3MF', '⤓ STL'], action: 'Export the print plate', note: 'format is set in the sidebar' },
      ],
    },
  ],
  '2d': [
    {
      title: 'Draft view',
      rows: [
        {
          keys: ['Developed'],
          action: 'Side-on, with every turn flattened out — edit slope',
          note: 'each part shows its true slope whichever way it heads; the view the draft opens on',
        },
        {
          keys: ['Front', 'Back', 'Left', 'Right'],
          action: 'True side views — edit slope',
          note: 'named for the side they are taken from, as on the 3D view cube; Left stands at -X, so the run reads left to right',
        },
        {
          keys: ['Top', 'Bottom'],
          action: 'From above and below — edit turn and corner sweep',
          note: 'a handle on a leg the view takes end-on is faded: there is no angle in the drawing to drag, so switch views',
        },
        { keys: ['Scroll'], action: 'Zoom about the pointer' },
        {
          keys: ['Right-drag', 'Middle-drag'],
          action: 'Pan the drawing',
          note: 'the wheel click pans too — press it in and drag',
        },
        { keys: ['Fit'], action: 'Re-frame whatever is on the paper' },
        {
          keys: ['Selected only'],
          action: 'Draw the parts you have picked and nothing else',
          note: 'on out of the box, so a plain pick puts one part on the sheet at a scale worth reading; with nothing picked the whole run is drawn',
        },
        {
          keys: ['Active Parts'],
          action: 'Draw only the parts you are working on',
          note: 'the same list, and the same switches, as the 3D view',
        },
        {
          keys: ['1:1'],
          action: 'Zoom to true physical size',
          note: 'calibrate your screen in Settings first, or it is only a guess',
        },
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: ['Click a piece'], action: 'Select it and open its settings in the sidebar' },
        {
          keys: [`${MOD_LABEL}-click a piece`],
          action: 'Add it to the selection, or take it back out',
          note: 'the same set the 3D stage picks — what is picked here is picked there',
        },
        { keys: ['Click empty space'], action: 'Clear the selection' },
        {
          keys: ['Angles and Joints'],
          action: 'Type any angle in exactly, instead of dragging for it',
          note: 'in the sidebar: start, middle and end angle for the selected part, and whether the joint behind it is closed',
        },
        {
          keys: ['Drag a joint'],
          action: 'Resize and swing the leg at once — the point follows the pointer',
          note: 'a side view sets slope, a top or bottom view sets turn; the part swings about the joint behind it and stretches to reach where you let go',
        },
        {
          keys: ['Drag a ring'],
          action: "Swing a part from its head, about its own far end",
          note: 'the run ahead of it comes round with it; nothing past the pivot moves, and the part resizes the same way',
        },
        {
          keys: ['Drag a square'],
          action: 'Stretch that leg and nothing else',
          note: 'this view holds no angle for that leg — a corner’s outgoing leg seen side-on, an angle connector’s entry leg seen from above — so its end only slides along itself',
        },
        {
          keys: ['Drag the break'],
          action: 'On a connector, swing one leg at a time',
          note: 'an angle in a side view: the break sets the entry slope, the outlet sets the bend — a corner in Top or Bottom: the break sets the turn, the outlet sets the sweep',
        },
        { keys: ['Shift', 'Drag'], action: 'Snap to 5° and 5mm' },
        { keys: ['Alt', 'Drag'], action: 'Hold the length — swing the angle only' },
        { keys: ['Esc'], action: 'Cancel the drag and restore the piece' },
      ],
    },
    {
      title: 'Reading the drawing',
      rows: [
        {
          keys: ['Tube Size'],
          action: 'Live cross-section of the tube the selected part is cut from',
          note: 'the second tab at the top of the drawing — scroll to zoom, right-drag or wheel-drag to pan, double-click or Fit to go back to the whole section',
        },
        { keys: ['Ghost circle'], action: 'The marble, shown resting in the bore' },
      ],
    },
  ],
}

/**
 * Filed by tab, like the cheat sheet. A tab with nothing worked out for it is
 * simply left out rather than carrying an empty heading.
 */
const HOWTO: Partial<Record<HelpTab, HowTo[]>> = {
  '3d': [
    {
      question: 'How do I join one part to another?',
      lead: 'With the Connector, in the Joints group of the toolbar — for the joints Add Part has not already made. A part out of the library lands bonded onto the end of the run, so the Connector is for joining two separate runs, and for parts that landed on their own.',
      steps: [
        'Click Connector. The open ends light up blue: the inlet each run starts at, and the outlet each one finishes on.',
        'Click the end of the part you want to move. It turns orange, and any end that cannot mate with it goes grey.',
        'Click the end it should travel to. That one stays exactly where it is; the first part swings round and lands on it, bonded flush.',
      ],
      note: 'Whatever was joined behind the part you picked comes with it: a run joins onto a run in one piece, keeping every angle it had.',
    },
    {
      question: 'How do I add a part somewhere other than the end of the run?',
      lead: 'Either say which end of a run every part goes on, or pick one end by hand. Join onto the run, at the foot of the library, has three answers: End grows the tail part after part, Start grows the head instead — the way a run is built backwards from the funnel it has to arrive at — and Not at all drops each part on its own for the Connector to join. For one part somewhere else, hold its end first.',
      steps: [
        'Click Connector and click the end you want to grow. It turns orange and stays held.',
        'Click ＋ Add Part and pick the part. It lands bonded on that end.',
      ],
      note: 'A held end outranks the setting, so it takes the one part and the setting has the rest. Without one, the reach is the Start or End of whatever run the selected part stands in.',
    },
    {
      question: 'How do I move a part around the stage?',
      lead: 'With the Move tool. It works on runs rather than single parts: a bonded part cannot travel on its own, which is what being bonded means.',
      steps: [
        'Select the part, in the viewport or in Active Parts.',
        'Click Move. The three axis arrows appear on it — red is X, green Y, blue Z.',
        'Drag an arrow. The whole run the part belongs to travels with it, holding its shape.',
      ],
      note: 'To move one part out of a run, break the joint with the Disconnector first — it comes away standing exactly where it was.',
    },
    {
      question: 'How do I bend a run partway along it?',
      lead: 'With the Rotate tool, on a part in the middle of the run. It aims that one part: its inlet does not move, so everything ahead of it stands exactly where it was, and everything joined behind it swings with it and holds its shape.',
      steps: [
        'Select the part the run should bend at, in the viewport or in Active Parts.',
        'Click Rotate. Three rings appear on it — red X, green Y, blue Z, the same axes the move arrows travel on.',
        'Drag any of them. The part swings about the joint it is plugged into and takes the rest of the run with it.',
      ],
      note: 'The joint itself stays dead straight — the bend is taken a lock further along, in solid tube, which is the only place a printed joint can take one. That is also its limit: turn a part further than its own tube can be cut round and the ring runs out of travel. Past that, bend the run with a Corner or a Hook, which are built to turn it.',
    },
    {
      question: 'How do I turn a whole run to face another way?',
      lead: 'With the Rotate tool, on the part at the head of the run — the one with nothing joined in front of it. That part has nothing to hold still, so its rings swing the run entire.',
      steps: [
        'Select the head of the run, in the viewport or in Active Parts.',
        'Click Rotate. The green ring is the one that lies in the workplane.',
        'Drag it. The whole run swings round that part, which stays exactly where it is.',
      ],
      note: 'Pick parts in several runs and the green ring carries them all, each keeping its place in the arrangement. To turn a run about a point partway along it, break the joint there with the Disconnector first.',
    },
    {
      question: 'How do I take a part back out of a run?',
      steps: [
        'Click Disconnector. Every joint on the stage turns green.',
        'Click the joint at the part’s inlet — it goes red under the pointer. The part and everything joined behind it comes away as its own run, standing where it stood.',
        'Break the joint on its far side too, and the part is on its own; then move it, delete it, or join it back on somewhere else.',
      ],
      note: 'Undo puts any of this back if it was not what you wanted — the ↺ button, or its shortcut.',
    },
    {
      question: 'Which run does the marble roll down?',
      lead: 'It sets off down the first one in Active Parts — there is one marble, so with several separate runs on the stage it has to be given one to start on. After that it goes wherever it lands: thrown off the end of one run it falls, and if it comes down inside another one, that run carries it on.',
      steps: [
        'Join the parts you want it to travel through into one run.',
        'Leave a gap where you want it to jump, and stand the catching run under where it lands.',
        'Press ▶ Simulator.',
      ],
      note: 'A marble in the air bounces off anything solid it meets on the way — the outside of a tube, the rim of a funnel — so a near miss deflects it rather than passing through.',
    },
    {
      question: 'How do I put a floor under the run?',
      lead: 'With a Base, in the Structure shelf of the part library. It is a flat plate that stands on the workplane and fills the space under everything — not a length of run: nothing plugs into it, the marble never travels it, and it takes no part in any joint.',
      steps: [
        'Click ＋ Add Part, open Structure and pick Base. It lands on the workplane on its own, whatever Join onto the run is set to.',
        'With it selected, press Fit Under the Run in Part Parameters. It sizes itself to everything on the stage that is not a base and slides under the middle of it.',
        'Or pick your machine from Printer bed above it — a Bambu A1, an A1 mini, a Sovol SV06 Plus — and the plate is sized to that bed instead. It is remembered, so the next base arrives on it.',
        'Set the thickness and the corner radius to taste, and use Move to slide it about — it stays on the plane however far it goes.',
      ],
      note: 'The marble bounces off a base the way it bounces off anything else solid, so a run that spills lands on the plinth rather than falling past it. Add as many as you like: each one is its own plate, and none of them are part of any run.',
    },
    {
      question: 'My tubes are floating in mid-air — how do I hold them up?',
      lead: 'With rods. A rod is a plain bar struck between two points you click — that is the whole of it, two ends and a thickness. Every run on this stage hangs in the air, and a printed tube hanging in the air falls on the floor, so this is what turns a run on screen into a run that can be built.',
      steps: [
        'Take up ⌶ Rods on the toolbar, click a spot on the run, then click what you want it braced against — the plate, a plinth, another turn of the run, or a rod already struck.',
        'The stage draws the rod from the first click to wherever the pointer is, so you see it before you commit. Escape lets go of a half-struck one.',
        'Or open the same button’s menu and pick one of the four braces, which do the whole stage in one step — Under the Run, Over it, or Outside or Inside the bend.',
      ],
      note: 'A rod is driven a whisker into both ends rather than merely touching them, so the two fuse when the plate is sliced. It knows nothing about what it braces, which is exactly what lets one part be a post down to the plate, a tie between two turns of a coil, and a spine down the outside of one from top to bottom.',
    },
    {
      question: 'How do I brace a corkscrew?',
      lead: 'It comes braced. Every turn of a coil hangs over the one below with nothing but air between, which is the hardest thing on this stage to print — so a corkscrew carries its own cage: a hoop at the top, a hoop at the bottom, and four posts standing between them, welded to every turn they pass and leaning with the coil the whole way down. It is part of the part, printed in the same lump.',
      steps: [
        'Pick the coil and set Support: Inside, Outside, Both or None. Braced up its hollow middle, the outside stays clear to watch the marble go down; braced outside, the middle stays clear to look down through. Both is what a tall coil in thin tube wants.',
        'Set the Bar to say how thick the hoops and posts are. Every bar stands flush with the channel — its face sits on the bore rather than in it — so a fatter one is stiffer without ever being in the marble’s way.',
        'A coil too tight to hold a cage inside it says so, and wants either a wider coil, a thinner bar, or the outside instead.',
        'Anything the cage does not cover is a job for ⌶ Rods, which go wherever you click: a leg out to a plinth, a tie to the run alongside, a spine down the outside of a coil already caged inside.',
      ],
      note: 'The hoops sit flush with the top and the bottom of the part, so the bottom one lands on whatever the coil is standing on — and on a bar thicker than the tube’s wall it stands a whisker proud of the tube, because a hoop hung any lower would reach down into the stub’s bore.',
    },
    {
      question: 'Why did my marble fall out of the tube?',
      lead: 'Because the part is a Half pipe, and a half pipe is a trough rather than a tube: its walls stand straight up with nothing overhanging, so the marble sits in it rather than inside it and can leave through the open side. Only a half pipe can do this. A 3/4 tube keeps more than half its wall, which curls over the marble and holds it exactly as closed tube does — its slot is there to see through, and the marble still leaves at the ends and nowhere else.',
      steps: [
        'Cut the part 3/4 Open under Tube Style: you still see the marble, and it cannot get out.',
        'Or check which side the half pipe opens on — turned onto its back it drops the marble straight away.',
        'Keep it a half pipe where you want the marble to leave, or to drop into the run from above.',
      ],
      note: 'A half pipe loses it to speed as well as to gravity. Taken over a crest fast enough the marble carries on straight and leaves the trough, the way a car leaves a humpback bridge — and swung round a bend hard enough it is held out against the far wall instead, so an upside-down trough on a tight bend can carry it through.',
    },
    {
      question: 'Why has my marble stopped halfway down?',
      lead: 'It has run out of fall. A marble is driven by how steeply the tube drops and held back by the tube’s grip, and below about five degrees at the stock grip the grip wins. It does not stop dead where it stands: on a climb it rolls back down, and it settles wherever it can go no further.',
      steps: [
        'Watch the readout at the end of the toolbar — it says STUCK once the marble can go no further.',
        'Steepen the parts before the stall, or drop the Tube grip in Settings.',
        'Check for a sharp corner just before it: a hard turn bleeds off speed the run then has to make up again.',
      ],
      note: 'A corkscrew stalls for the same reason and is steepened differently: it has no Start angle to raise, because its height and its widths already fix the one angle it can sit at. Set its Fall instead — the coil winds its rings in or out to suit, and keeps the height and the footprint it had.',
    },
    {
      question: 'How do I make the marble go faster down a corkscrew?',
      lead: 'Set the coil’s Fall. It is the one part on the stage whose angle is not a free field — a coil of a given height and width going round a given number of times has exactly one angle it can run at — so a corkscrew is steepened by winding it, and the Fall field is that wind stated as the angle you actually care about.',
      steps: [
        'Pick the coil and drag Fall, marked Slower to Faster. Fewer rings over the same height is a steeper coil; more is gentler.',
        'Nothing else about the part moves: the height, both widths and the drop are all held, so the run bonded under the coil stays exactly where it was and only the speed changes.',
        'The count goes in whole quarter turns, so the angle lands on the nearest one those can give and the field snaps to what it got. On a coil of a few rings that is a fraction of a degree; on a coil of one it is coarse.',
        'The two ends of the range are printed beside the field. Too gentle to reach means the coil is short or wide for the fall you want — raise the height, or narrow it.',
      ],
      note: 'Setting the Fall pins the ring count by hand, which is what the Rings switch was already offering: counted, the rings follow the height and the fall barely moves, because each new ring takes up exactly the room the extra height gave it.',
    },
  ],
}

/**
 * The rows every tab ends with. The key ones are worked out from the bindings
 * rather than written in: they are the user's to change in Settings, so the sheet
 * has to say whatever they are set to now.
 */
function alwaysGroup(keys: ShortcutMap): Group {
  return {
    title: 'Anywhere',
    rows: [
      {
        keys: ['＋ Add Part'],
        action: 'Browse the part library and drop a part on the stage',
        note: 'top of the window; it lands bonded onto the end of the run — Join onto the run, at the foot of the library, moves that to the start of the run or has parts land on their own instead',
      },
      { keys: ['2D Draft Mode', '3D Mode'], action: 'Switch workspace', note: 'top of the window' },
      {
        keys: ['Settings tab', 'History tab'],
        action: 'Slide out the settings, or the last changes to the run',
        note: 'the vertical tabs on the right edge; Esc closes them',
      },
      {
        keys: ['Settings', 'Units'],
        action: 'Read and type every measurement in millimeters or inches',
        note: 'display only — the run is held in millimeters, and exports are always millimeters',
      },
      {
        // One cap rather than two: the rows either side read as alternatives, and
        // this is a path — the panel, then the section inside it.
        keys: ['Settings → Shortcut Keys'],
        action: 'Change any of the keys below',
        note: 'click the keys on the row you want, then press the new combination',
      },
      {
        keys: [formatShortcut(keys.undo)],
        action: 'Undo the last change',
        note: `${formatShortcut(keys.redo)} redoes it, and so does ${MOD_LABEL}+Shift+Z`,
      },
      {
        keys: [formatShortcut(keys.duplicate)],
        action: 'Duplicate what is selected',
        note: 'the copies land unjoined, beside the run — a joint between two parts that were both picked comes over with them',
      },
      {
        keys: [formatShortcut(keys.duplicateJoined)],
        action: 'Duplicate what is selected, joined onto the run',
        note: 'the copies land on the open end a new part would land on, bonded there',
      },
      {
        keys: ['Del', '⌫'],
        action: 'Delete what is selected',
        note: 'the run closes up behind it, and Undo puts it back',
      },
      { keys: ['?'], action: 'Open this help' },
      { keys: ['Esc'], action: 'Close this help' },
    ],
  }
}

/**
 * What the Beta badge in the top bar is promising — and what it is not. Shown
 * above every tab rather than filed under one, because it is true of the whole
 * app, not of one workspace.
 */
const BETA: { heading: string; body: string }[] = [
  {
    heading: 'It is still being built',
    body: 'Parts, settings and buttons are added, renamed and moved between versions. Something that is here today may work differently — or sit somewhere else — tomorrow.',
  },
  {
    heading: 'Keep your own copies',
    body: `The saved ${PROJECT_EXT} format is at version ${PROJECT_VERSION} and may change. Older files are meant to keep opening, but nothing is guaranteed yet, so keep the printable exports of anything you care about rather than trusting the project file alone.`,
  },
  {
    heading: 'Check before you print',
    body: 'Geometry, fits and the marble simulation are approximations. Test-print a single joint and check the marble runs before committing a full plate of filament.',
  },
  {
    heading: 'Expect rough edges',
    body: 'Bugs, missing parts and half-finished corners are expected at this stage. Nothing leaves your machine — the run lives in the browser until you save or export it.',
  },
]

const TAB_LABEL: Record<HelpTab, string> = {
  project: 'Project',
  '2d': '2D Draft',
  '3d': '3D View',
}

const TABS: HelpTab[] = ['project', '2d', '3d']

function Rows({ group }: { group: Group }) {
  return (
    <div className="help-group">
      <h4>{group.title}</h4>
      <dl>
        {group.rows.map((r) => (
          <div key={r.action} className="help-row">
            <dt>
              {r.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="help-sep">or</span>}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>
              {r.action}
              {r.note && <em> — {r.note}</em>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function HowTos({ items }: { items: HowTo[] }) {
  return (
    <div className="help-group help-howto">
      <h4>How do I…</h4>
      {items.map((h) => (
        <article key={h.question}>
          <h5>{h.question}</h5>
          {h.lead && <p className="help-howto-lead">{h.lead}</p>}
          <ol>
            {h.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {h.note && <p className="help-howto-note">{h.note}</p>}
        </article>
      ))}
    </div>
  )
}

/**
 * Cheat sheet for the run and for both workspaces; opens on the tab matching
 * the current mode.
 */
export default function HelpOverlay() {
  const mode = useRun((s) => s.mode)
  const shortcuts = useRun((s) => s.shortcuts)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<HelpTab>(mode)

  // Follow the workspace while closed, so opening always lands on what you are looking at.
  useEffect(() => {
    if (!open) setTab(mode)
  }, [mode, open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      // Ignore the shortcut while the user is typing into a field.
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        className="help-btn"
        onClick={() => setOpen(true)}
        title="General help (?)"
        aria-label="General help"
      >
        ?
      </button>

      {open && (
        <div className="help-backdrop" onClick={() => setOpen(false)}>
          <div
            className="help-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="General help"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="help-head">
              <h3>General Help</h3>
              <div className="segmented small">
                {TABS.map((t) => (
                  <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
              <button className="help-close" onClick={() => setOpen(false)} aria-label="Close help">
                ✕
              </button>
            </header>

            <div className="help-body">
              <section className="help-beta">
                <h4>
                  <span className="beta">Beta</span> This is a work in progress
                </h4>
                <dl>
                  {BETA.map((b) => (
                    <div key={b.heading}>
                      <dt>{b.heading}</dt>
                      <dd>{b.body}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {HELP[tab].map((g) => (
                <Rows key={g.title} group={g} />
              ))}
              {/* Worked examples sit under the controls they string together. */}
              {HOWTO[tab] && <HowTos items={HOWTO[tab]!} />}
              <Rows group={alwaysGroup(shortcuts)} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
