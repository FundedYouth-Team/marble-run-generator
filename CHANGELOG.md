# Changelog

All notable changes to the Marble Run Generator. Newest first.

This file is maintained automatically: a Claude Code hook records every file
Claude modifies and blocks the end of the turn until an entry lands here. It is
also injected into context before every prompt, so read it before asking for new
work — the answer to "did we already do this?" is usually here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Every key the app answers to is now in Settings → Shortcut Keys, and every
  one of them can be re-bound.** The list held four commands; it holds ten, under
  two headings — The run, and Tools and windows — so the panel is a full account
  of the keyboard rather than a corner of it.
- **Five tools answer to a bare key: S Select, M Move, R Rotate, J the
  Connector and L Align.** Every tool had to be reached for with the pointer,
  which meant leaving the run you were working on to travel to the bar and back
  for a switch you make dozens of times an hour. They are pressed on the 3D
  stage, where the tools are, and are ignored while you are typing in a field. J
  is for the join the Connector makes rather than for its name in the bar, which
  leaves C free.
- **P opens the part library, and closes it again.** The window every run is
  built out of was reachable only by travelling to the ＋ Add Part button in the
  top bar. P now opens it on the full shelf from either workspace — the 2D draft
  as well as the 3D stage, since the button sits in the top bar in both — and a
  second press puts it away, as Esc already did. It is ignored while you are
  typing, so the search field inside can still have a P in it.
- **Save, Open and New stay buttons, with no key of their own.** They were
  briefly bound to ⌘S, ⌘O and ⌘N — the keys every other app uses them on — and
  those are exactly the keys the browser has already spoken for: saving the
  page, opening a file into the tab, and opening a new window, which the page is
  not always even offered. Taking them leaves the app fighting the thing it runs
  inside, so the three sit in the top bar and nowhere else, and the list in
  Settings does not carry a row it cannot honour.
- **A key does nothing while its tool is greyed out** — the same test the
  buttons use, so M and R wait for a part to exist, L for two parts to line up
  and J for two runs to join. Select always answers, and is the way back out of
  any of the others. The press is swallowed either way, so half of it never
  reaches the page.
- **The key caps printed around the app are read off the bindings**, so
  re-binding one changes what every hint says: each tool's hover hint ends with
  the key that takes it up, ＋ Add Part carries P in its own tooltip, and the
  help sheet lists them beside the names.

### Changed

- **A binding no longer has to carry a modifier.** The panel used to refuse a
  bare letter — "Add ⌘, ⌥ or Shift" — on the grounds that a key on its own
  would fire as you work. Nothing fires while you are typing, so what that rule
  actually guarded was the commands that change the run, and those still ship
  behind a modifier for exactly that reason. It is where they start rather than
  a rule now: any row takes any key you press. Esc, Tab and Enter stay the
  app's own.
- **Strike a Rod draws nothing between the two clicks, and the pointer glows
  green while it is in hand.** The stage used to draw a live rod from the first
  click to wherever the pointer was, which on a curved run read as a bar
  wandering about the stage on its own rather than as a preview of anything, and
  left you unsure whether a rod had already been struck. The gesture is bare
  now: the first click drops its green mark and stops there, and the rod that
  appears on the second click is the real part rather than a drawing of one. The
  pointer carries a green ring with a glow around it in the mark's own green, so
  the tool is legible from the cursor rather than from the toolbar, and the
  status bar counts the two clicks off — "Click one end of the rod", then "Now
  click the other end" — since with nothing drawn between them the bar is the
  only thing that says which half you are in. Escape still lets go of a
  half-struck rod, and the four whole-stage braces are untouched.
- **The Move arrows and the Rotate rings stand in the middle of what you have
  picked, across it and up it both.** Both handles sat on the inlet of the part
  leading the selection — a part's own zero, which on a long bend or a tall coil
  is off one end of the thing you are pointing at, and on a set picked across
  the stage was wherever the first part happened to be. The middle of the box
  the picked parts fill is the one point that reads as belonging to the whole of
  what is in hand, from whichever side the camera is on.
- **The green ring on a run's head turns the picked set about that same middle**,
  rather than about the inlet of the lead part. A run picked on its own now
  swings about its own middle instead of pivoting off its top end, and a set
  picked across several runs turns about the middle of the set — each run still
  keeping its place in the arrangement. Everything else the rings do is
  unchanged: a bonded part still swings about the joint it is plugged into,
  which is fixed by the geometry rather than by where the rings are drawn.
- **The rings hold still for the length of a swing.** A box squared to the world
  does not stay put as the parts inside it turn, so the point is taken once when
  the drag begins and kept — otherwise the handle would creep out from under the
  pointer mid-turn. Nothing is measured off it; the swing is still read off the
  frame. The travel readout under the move arrows hangs from the middle now too,
  so the figures sit with the handle.

### Added

- **A button that cuts the tubes to whatever ball is on the run — on the parts
  you have picked, or on the whole stage.** Picking Glass Marbles or Steel Balls
  off the list already did the sum for everything; typing a diameter in the box
  under it did not, and there was no way at all to open out three parts and
  leave the rest. Both are one button now: **Fit Every Part to This Ball** under
  the diameter box in Settings → Marble Size & Color, and a fit button in the
  sidebar's Tube Size panel that reads **Fit This Part to Marble**, **Fit 3
  Picked Parts to Marble** or **Fit Every Part to Marble** according to what is
  in hand.
- **What it cuts to is the ball plus 4mm of slack** — the same sum
  `boreForMarble` does for the ball list, so a Steel Ball at Ø10 gets a Ø14
  bore and rolls instead of jamming. Walls are never touched: a part printed
  thicker is printed thicker whatever rolls through it, and plates and posts are
  passed over, having no bore to cut.
- **Fitting the whole stage puts every part back onto the run's bore**, the way
  picking a ball off the list does — a run is cut for one ball, and a part left
  on a bore of its own would neither take this one nor mate with its
  neighbours. Fitting picked parts leaves the rest exactly as they were, except
  that a part whose fit lands on the bore the run is already cut to is put back
  onto the run's rather than left holding a bore of its own saying the same
  thing.
- **The button greys out once there is nothing left to cut**, and the note under
  it says which parts it is about to take and what bore they are going to, so
  the state of the stage is readable without pressing anything. The "marble will
  not fit this bore" warning now names the bore the fit would open it to, and
  Help has the whole of it under *I changed the ball — how do I size the tubes
  to it?*

### Changed

- **Move and Rotate are one button each again, and each takes hold of what you
  have picked and nothing else.** Both were split-buttons asking how far they
  reached on the way in — Move Selected against Move All, Rotate Selected
  against Rotate All — which put a question in front of the tool that the
  selection had already answered. The reach is the selection now: to move more,
  pick more, which is the gesture you were going to make anyway.
- **Rotate All has gone with it, and with it the case where the rings stood
  somewhere other than on the part you picked.** At the wide reach they were
  moved onto the head of the picked run so the green ring had a head to swing
  about, so the handle appeared on a part you had not clicked and the Joint
  pivot setting went blank because the part under the rings was never a bonded
  one. The rings stand on the picked part in every case now, and Joint pivot is
  live whenever that part is bonded.
- **Nothing the wide reach did is lost** — picking every part and dragging is the
  same move, the same one step in the timeline, and it was always the several
  runs that travelled together rather than the parts. What is gone is a mode
  that moved runs you had not picked.
- **`toolScope` is out of the store**, along with the `ToolScope` type, the
  second argument to `setTool`, and `handleRuns` in the stage, which existed
  only to answer "which runs, at this reach" — both gizmos ask `pickedChains`
  directly. The toolbar's hints, the right-click menu's tick, and the two Tools
  entries in Help are all a case shorter for it.

### Added

- **The explanations under the controls in the Parameters column are kept to one
  line, and the rest of each opens in a card beside the column when the pointer
  rests on it.** The panels explain themselves as they go, and the explanations
  run longer than a 322px column is wide — so three controls in a row arrived as
  a wall of grey text with the controls buried in it. Every one of the 27 notes
  in the column now reads as a single line, ending in an ellipsis where there is
  more behind it.
- **A note that fits on its line is left exactly as it was.** Whether it is
  clipped is measured rather than guessed — the text is worked out from the
  model and changes under itself, so it is watched with a `ResizeObserver` and
  re-measured when the sentence is rewritten or the column resized. Only a
  clipped note is given the ⓘ mark, so the mark means "there is more here"
  rather than decorating every line.
- **Clicking the ⓘ pins the card open** — Escape or a click anywhere else
  dismisses it — which is the only way to read a note on a touch screen, and the
  way to keep one up while working from it. Keyboard travel opens it on focus,
  as the toolbar's hints do.
- **The card is thrown beside the column rather than under the note**, so it
  covers the stage instead of the controls the note is about, and drops below
  the note only when the window is too narrow for that. It is placed in window
  pixels and follows the note as the column scrolls, since the column clips its
  own overflow and a card inside it would be cut off at the edge.
- **The clipping is done in the paint only**: the whole sentence stays in the
  page, so anything reading the page aloud is given it entire, and the card is
  marked as the picture of it that it is. The red warnings are left spelled out
  in full — they fire rarely and mean something is wrong with the model right
  now, which is no time to be hiding the reason behind a hover.

- **A ball to pick, at the top of Marble Size & Color: Glass Marbles at 16mm or
  Steel Balls at 10mm, and the tube cut to whichever you pick.** The two numbers
  a run is built around are the ball and the bore it rolls in, and the second is
  only ever the first plus four millimetres of slack. That is one sum, done
  twice in two different boxes, and getting it wrong shows up as a marble that
  jams or a ball that rattles — so it is now done once, under the name of the
  thing you tipped out of the bag.
- **Picking one also brings any part with a bore of its own back onto the
  run's** — the same rule Apply to All Parts goes by, and for the same reason: a
  run carries one ball, and a part left on its own bore would neither take this
  one nor mate with its neighbours at the joint. Walls are left alone, a part
  printed thicker being printed thicker whatever rolls through it.
- **The boxes underneath are still the real control.** The list is a shortcut to
  the two sizes nearly every run is built for, not the set of sizes allowed:
  type any diameter or any bore you like and the list reads back **Custom**,
  with the pair it is currently cut to spelled out beside the word. Picking
  Glass Marbles is the way back, and is one step in the timeline like any other
  — the reset button it replaces did the same job for one of the two sizes.

- **Align, beside Measure in the Tools band: bring the parts you have picked
  onto one face.** Measure draws a box round what is picked and reads it; this
  is that same box asked the next question — line these up on it. Until now the
  only way to get two runs standing level, or a coil centred over the plate
  under it, was to read a figure off one and type it into the other, and a
  figure typed to a tenth is only ever nearly right.
- **Nine faces, three to an axis** — Left, Centre and Right across X, Bottom,
  Middle and Top up Y, Back, Centre and Front along Z. Named the way the view
  cube names its faces, so Left is -X and Front is +Z, and each row carries its
  axis letter: Left and Back are both "sideways" until something says which way,
  and nothing but the letter tells the two centres apart.
- **The nine are drawn rather than named**: each button is a little picture of
  the alignment it makes — three parts of different sizes brought flush against
  a datum, with the datum drawn where that face actually is, and a centreline
  through the middle of them for the three that centre. "Left" is a word for a
  picture in the first place, and nine of those words across three rows is a
  wall of text on a strip one line high. The words survive on hover and for
  anything reading the page aloud. X and Z share the one form, since they are
  the same alignment on two axes and a plan has no up in it to tell them apart
  by — the axis letter beside the row is what does that, as it does for the two
  centres.
- **Two datums, asked before the faces, because the same button means two
  different places depending on the answer.** *The set* lines the picked parts
  up on their own outermost face, so they close up on each other and none
  travels further than it has to. *The lead part* — the one picked last — stays
  exactly where it is while every other picked part comes to it, which is how
  you say "line these up on that one": pick the reference part last.
- **Resting on any of the nine draws that face on the stage.** Nine buttons that
  all mean "line these up" are told apart only by which face each one means, and
  a face is a place in the model — so it is shown in the model, before the click
  rather than after it. The datum plane is thrown out past the box on all four
  sides, since the parts coming onto it are by definition outside the face they
  are coming from.
- **It takes no click of its own**, the way Measure takes none: the left button
  goes on picking parts while it is in hand, and the datum follows the pick.
- **What travels is runs, not parts** — the same rule the move arrows go by,
  because a bonded part cannot go anywhere on its own. Each picked part slides
  the whole run it stands in, holding its shape, and two picked parts of the one
  run cannot send it two ways: the first picked is the one that lands on the
  datum. Where the lead is the datum its own run is pinned before any of that,
  so the part you aligned onto is never dragged out from under the alignment.
- **Faces are measured to the outside of the tube**, the same box Measure reads
  and the camera frames, so parts of different bores line up on the pipe you can
  see rather than on the axis you cannot. A base only ever travels on the plan:
  it is held on the workplane, so a set with a slab in it lines up on Y around
  the slab rather than lifting it off the ground.

- **Measure, in the Tools band of the toolbar: how much room the parts you have
  picked actually take up.** The run has always known its own centreline length,
  and that is the wrong figure for nearly every question anybody asks about a
  finished model — whether it clears a shelf, whether it goes in the box, whether
  the coil is really as tall as it looks. Those are questions about a cube, so
  the tool draws one: a wireframe box round what is picked, squared to the world,
  with its width, its length and its height read off it.
- **Measured to the outside of the tube, not to its centreline**, so the box is
  the room the run needs rather than the room its axis needs — and each part
  padded out to its own wall, which is not the run's if it has been sized on its
  own. A base is boxed on its slab and a rod on the bar itself, neither having a
  wall to be padded out to.
- **The three figures hang on the box, in the drafting way**: a dimension line
  struck between two extension lines, with the figure set into it. Width along
  the foot of the near face, height up its far side, length going back along the
  side nearest you — spread along the box rather than piled on one corner of it,
  so they stay apart on a part small enough that they would otherwise collide.
  They swap sides as the camera crosses the box, which is the one moment a figure
  that stayed put would be the wrong one to read. All three are written out again
  on a strip under the toolbar, where they can be read as text.
- **It takes no click of its own.** The left button goes on picking parts while
  it is in hand, and the box follows the pick from part to part — changing the
  pick is the whole gesture. `Cmd`-click takes several parts and the box takes
  them all in. Pick nothing and it boxes the whole stage, the same answer the 2D
  draft gives when it is asked to isolate a selection there is none of.
- Width is X, length is Z, height is Y, and each figure carries its axis letter
  beside its name — nothing else tells width and length apart.

### Changed

- **Reset to Standard Marble is gone from Marble Size & Color, and the new ball
  list is the way back.** The button set the marble to 16mm and the bore to
  20mm, which is precisely what picking Glass Marbles now does — and does for
  parts sized on their own as well, which the button never reached. Two controls
  setting the same pair of numbers in one panel reads as a bug rather than as a
  choice, so the one that also says which ball you are cutting for is the one
  left standing.

- **Drop to Workplane is now Place on Workplane.** "Drop" reads as letting go of
  something, and the button does the opposite — it sets the run down deliberately,
  and lifts one that had sunk below the plane back onto it. Renamed on the
  toolbar, on a part's right-click menu, in Help, and in the undo history, which
  now reads *Place Tube 2 on the workplane*. Nothing about what it does changed.

- **The 2D draft is now a drawing of the part you have picked, not of the whole
  run.** A draft sheet is where a part is measured and set, and a run of forty
  tubes shrunk to fit one sheet is a picture of a run rather than a drawing of
  anything: the dimensions pile up, the legs are a few pixels long, and the one
  part you came to look at is lost in it. Picked, that part now has the paper to
  itself, framed and at a scale its figures can be read at. Pick several and the
  sheet holds those; pick nothing and the whole run is drawn, because there is
  nothing to isolate.
- **The run either side of it is still there, it is simply not drawn.** The part
  stands exactly where the run puts it, and its walls still mitre into the joints
  at both ends the way they always did — the drawing is a window onto the run,
  not the part lifted out of it.
- **Selected only**, beside Keep connected, turns it off for the old whole-run
  sheet, and is remembered past the project like the rest of the view settings.
  It ships on. Switching the pick re-frames the sheet on whatever is now on it,
  the same way switching a part off always has.
- The handles come with the drawing, so only the drawn parts carry joints to
  drag — and the flow caps say **IN** and **OUT** on a slice cut from the middle
  of a run, keeping **START** and **END** for the sheet that really does draw the
  run's own two ends.
- **Join onto the run is now a choice of three: Start, End, or Not at all.**
  The tickbox at the foot of the library said only whether a new part joins on,
  and joining on always meant the tail. Which end is a real question — a run is
  built down from the top, or backwards from the funnel it has to arrive at —
  and it was only answerable one part at a time, by picking that end with the
  Connector before every trip to the library. Now it is said once and holds.
- **End is what the tick always did** and is still how it ships, so nothing
  changes for anyone who was not asking for this. **Not at all** is the old
  untick: parts land on their own for the Connector to join. **Start** puts each
  new part in front of the run, feeding into it — the same joint the Connector
  has always made on a head, made for you.
- The setting is remembered past the project like the rest of the handle
  preferences, and a browser that had the old switch on comes back on End.
- An end held by the Connector still outranks it, so one part can still be sent
  somewhere else without changing the setting. Turning the setting now drops a
  held end, since it is the newer answer to the same question — otherwise the
  next part would go to the end you had just said you were done with.
- The footer says which end a part is about to land on and reads back the run's
  own name for it, so the promise and what happens cannot come apart. Duplicate
  onto the run follows the same choice.

### Added

- **A base is now sized by naming your printer.** The plate is the one part on
  the stage whose size is not a question about the run at all — it is printed
  flat in one piece, so what it may be is whatever the bed will take. **Printer
  bed**, at the top of a base's parameters, lists the beds by the machine they
  belong to: an A1 mini at 180 square, an Ender 3 at 220, a MK4S at 250 × 210, a
  Bambu A1 at 256, an SV06 Plus at 300, an Ender 5 Plus at 350, a Prusa XL at
  360. Pick one and the plate is that bed, corner to corner.
- **The two spans only.** The thickness and the corners are left exactly as they
  were, for the reason **Fit Under the Run** leaves them: a bed says how much
  floor there is and nothing whatever about how thick the plate standing on it
  should be. Both are one step in the history — *Size Base 1 to the Bambu Lab A1
  mini bed* — so Undo puts the old plate back.
- **One entry per bed, not per printer.** A bed is two numbers, and two machines
  that share them share a line: an A1 mini and a Prusa MINI+ print the same
  plate, and the note says as much. Anything not on the list is still typed into
  the two boxes underneath, and the drop-down reads back **Custom** with the size
  it actually is — nudge a bed plate by a millimetre and it says Custom again.
- **The bed is remembered, so it is asked once.** Whichever is picked is the one
  the next base out of the library arrives on, kept past the project like the
  rest of the workshop's settings — the printer on the bench does not change
  between runs. Nothing picked yet is the old 240 square plate, which is a size
  worth resizing rather than any real machine's bed.
- Sized right to the edge, a plate leaves nothing for a brim or a skirt to stand
  in, and the note under the drop-down says so: take a few mm off if the slicer
  complains. The bed sizes are the beds, not the beds less a margin.

- **A corkscrew's fall is now something you set.** Drag **Fall**, marked Slower
  to Faster, and the marble comes down the coil as fast as you want it to. It is
  the one part on the stage whose angle was never a field: a coil of a given
  height and width going round a given number of times has exactly one angle it
  can run at, so its Start angle has always been a readout. This is that
  equation read backwards — you state the angle, and the coil winds its rings in
  or out to be a coil that runs at it.
- **Nothing else about the coil moves.** The height, both widths and the drop are
  all held, so the footprint is the footprint it was and every part bonded under
  the coil stays exactly where it was standing. All that changes is how many
  times the marble goes round on the way down, which is the whole of what makes
  it faster or slower.
- The count still goes in whole quarter turns, so the outlet still lands on a
  heading square to the inlet — which means the angle lands on the nearest one a
  quarter turn can give and the field snaps to what it got. On a coil of a few
  rings that is a fraction of a degree; on a coil of one it is coarse, and says
  so. The gentlest and steepest falls that height and width can reach are printed
  beside the field.
- Setting the fall pins the ring count by hand, which is what the Rings switch
  was already offering — left counted, the rings follow the height and the fall
  barely moves, because each new ring takes up exactly the room the extra height
  gave it. Under **Rings**, and beside the Start angle readout, which now says
  where to go.
- **A corkscrew brings its own cage.** Two hoops and four posts standing between
  them, welded to every turn they pass, printed in the same lump as the coil. A
  coil is the one part in the library that cannot stand up on its own — every
  ring hangs over the one below with nothing between them — and a rod struck by
  hand fixes one turn at a time. This fixes all of them, and it arrives already
  fixed: every corkscrew now comes braced up its hollow middle.
- **Support: Inside, Outside, Both or None**, under the coil's own figures.
  Which side is a real choice rather than a preference. Braced up the middle, the
  outside stays clear to watch the marble come down; braced round the outside,
  the middle stays clear to look down through; both is what a tall coil in thin
  tube wants. Set the bar's thickness beside it — square in section, like a rod
  left unrounded.
- **The cage leans with the coil.** A coil that narrows as it falls is a cone,
  and a cage standing square inside one would meet the tube at the top and be
  nowhere near it at the bottom. Instead each post follows the coil's own taper
  turn by turn, so it meets every ring it passes at exactly the depth it met the
  one above.
- **Every bar stands flush with the channel.** Its face looking at the coil sits
  a whisker off the bore, so it welds into the wall behind it for very nearly the
  wall's whole thickness and stops dead where the marble starts. Nothing the
  marble touches is moved and nothing it could hit is added — which is what lets
  a fatter bar be stiffer rather than more in the way.
- **A trough facing the cage is tied under its own lip.** The one thing the open
  side changes: on the side a coil's trough opens onto, the wall a post wants to
  weld to is the wall that was cut away to open the channel. Reaching in far
  enough to find material would put the bar across the marble's path, so on that
  side alone the post stands clear and each turn is tied to it underneath, below
  the bore, where there is nothing to be in the way of. Every other side — up,
  down, or facing away — welds to the lips and needs no tie.
- The hoops sit flush with the top and the bottom of the part, so the bottom one
  lands on whatever the coil is standing on. On a bar thicker than the tube's
  wall a hoop stands a whisker proud of the tube instead: hung any lower it would
  reach down past the crown of the stub that runs into the coil and into that
  stub's bore, which is the one place a hoop can meet a tube that is heading out
  of the coil rather than round it.
- A coil too tight to hold a cage up its middle says so and stays unbraced there
  — the inside is the one side that can run out of room, since outside a coil
  there is always more of it further out.
- The cage goes wherever the coil goes: swung with the body to meet a joint,
  keyed into the part's shape so two alike still share one mesh, carried into
  every export, and saved with the project — which needs no new file version, a
  coil from an older file simply opening with the cage every corkscrew now has.
- **Delete throws away what is picked.** Press Delete or Backspace on either
  stage and the selected parts go, the run closing up behind them exactly as the
  right-click Delete closes it — one step in the timeline, so Undo puts them
  back. It is the app's own key rather than a bindable one, and it stands down
  inside a field, where Backspace is still a backspace. With nothing picked the
  press is swallowed anyway: on some setups a bare Backspace is the browser's
  Back button, which would take the whole run with it.
- **The Rod.** A plain bar struck between two points — the other half of the
  base, and the part that makes a run printable at all: every tube on this stage
  hangs in mid-air, and a printed tube hanging in mid-air falls on the floor. Two
  ends and a thickness is the whole of it. It knows nothing about what it is
  bracing, and that is exactly what lets one part be a post down to the plate, a
  tie between two turns of a coil, and a spine run down the outside of one from
  top to bottom. Found under Structure, beside the base.
- **⌶ Rods**, on the toolbar, is a tool you click with, and it takes two clicks:
  the first is only remembered, the second says what the rod is between. The
  stage draws it from one to the other as you move, so you see it before you
  commit; Escape lets go of a half-struck one. Anything solid answers a click —
  the run, a plinth, the workplane, or a rod already struck — so braces can be
  tied onto braces. Each rod is its own step in the timeline.
- **A corkscrew can be braced.** Every turn of a coil hangs over the one below
  with nothing between, and no rule was ever going to find the line that fixes
  it: one rod down the outside from the top turn to the plate, tying every turn
  it passes. That is a single gesture. Ties between turns, inside or out, are the
  same gesture repeated.
- **Four braces**, in the same button's menu, each doing the whole stage in one
  press: Under the Run, Over it, and Outside or Inside the bend. Where a rod
  leaves the tube is the whole question on anything that curves — a coil braced
  up its hollow middle keeps its outside clear to watch the marble go down, and
  one braced outside keeps the middle clear to look down through. A coil that
  narrows as it falls wants the outside, since inside it the turns are closing in
  on one another. Under and over are the plain answers for everything else, and
  are what a run with no bend in it gets whichever is picked. All four leave rods
  already struck alone, skip a tube that is already resting on something, and
  never drop one that would have to go through the run to get where it is going.
- **A coil is braced once a turn, staggered.** One tie is enough to hold a turn
  and more than one is a fence round the very thing a coil is built to watch, so
  the stretch of a run that is corkscrew is paced by its own turns rather than by
  the stride the rest of the stage gets. Each rod sits a little further round the
  coil than the one before it, so they spiral rather than stacking into a ladder
  up one side — and where the turns would divide neatly enough for that to happen
  anyway, one more rod is struck, which shifts them all round again.
- Set a rod's length, its thickness, and how far its four long corners are
  rounded: to half the thickness it is a round bar, and left square it is the
  flattest thing there is to print. It is driven a whisker past both points it
  was struck between, so it fuses with them rather than merely touching.
- A rod is the one piece of structure that neither lies flat nor stands square.
  It takes no joint, carries no marble and is no part of any run, like a base —
  but it goes where it was struck, at whatever angle, however far off the floor.
  That split is two questions rather than one now: whether a part is *run*, and
  whether it is *on the floor*.
- The marble meets a rod as the bar it is: a box with its long edges rounded off,
  held in the rod's own frame, which is already tipped onto whatever line it was
  struck along.
- It goes everywhere a part goes: picked and moved on the stage, listed in Active
  Parts, drawn in the six ortho views of the 2D draft, saved with the project,
  and laid on the print plate the way it prints — on its side, a bar flat on the
  plate with no overhang anywhere in it, whatever line it was struck along up in
  the air. Project files are now v13.

- **The Base.** A flat plate that stands on the workplane and fills the space
  under the run. It is the first part in the library that is not a length of
  tube: nothing plugs into it, the marble never travels it, it takes no part in
  any joint, and it has no bore, no wall and no style. Set how wide, how deep
  and how thick it is, and how far the four upright corners are rounded — a
  square plate rounded as far as it goes is a disc. Found under Structure, a new
  shelf in the part library.
- **It stays on the ground.** A base's underside is the workplane, and that is a
  fact about the part rather than somewhere it happens to have been put: the
  move arrows slide it about and the green ring turns it, and nothing — a drag,
  a dropped run, a saved file — lifts it off the plane or buries it under one.
  It also states its own fall, the way a corkscrew and a funnel do, and the fall
  it states is none.
- **Fit Under the Run**, in Part Parameters: sizes the plate to everything on the
  stage that is not a base and slides it under the middle of it, measured to the
  outside of the tube rather than to the centreline. Thickness and corners are
  left alone — it is a question about footprint and nothing else.
- The marble meets a base the way it meets any other wall, solved rather than
  sampled: a slab is a rounded rectangle in plan pulled up through its own
  thickness, so one closed form answers for its faces, its edges and its corners
  at once. A run that spills lands on the plinth rather than falling past it.
- It goes everywhere a part goes: picked and moved on the stage, listed in Active
  Parts, drawn as a solid outline in the six ortho views of the 2D draft — left
  off the developed elevation, which has no place for something that travels
  nowhere — saved with the project, and written to the print plate lying the way
  it prints. Project files are now v10.

- **Open side.** A cut tube can now open on any of its four sides — top, right,
  bottom or left, read looking along the run — instead of always on top. Set on
  the run in the Tube Style panel, overridable per part, with Apply to All, and
  saved with the project.
- The side follows through everywhere the opening mattered: the 3D solid and the
  2D section, the shape key parts share meshes on, the sim (the marble falls out
  of the side actually cut open, not the top), and the print plate, which rolls
  each part about its own axis so its opening still faces up.

- **A trough only carries what it can hold.** The marble no longer sticks to the
  centreline of a half pipe that has nothing under it: one turned on its back
  drops it, and it falls from there like any other marble in the air. Speed
  counts both ways — swung round a bend hard enough it is held out against the
  far wall and carried through, and taken over a crest too fast it leaves the
  trough the way a car leaves a humpback bridge.
- **A 3/4 tube is a closed tube with a window in it.** Its wall curls over the
  marble, so it carries one exactly as closed tube does — whichever way up the
  part is turned, and however hard a bend throws it. The marble leaves at the
  ends and nowhere else, and it cannot be dropped in through the slot either.
  Only a half pipe, whose walls stand straight up with nothing overhanging, is
  open to what is above it.
- **Funnels read their own tube again.** A funnel is three things in a row and
  only the middle one is what the part's style describes, but the sim was
  reading that style onto all three. Cut Half, its feed pipe — a hole let
  through the bowl's wall, which the mesh builds closed — was taken for a trough
  and dropped the marble at the rim; and the throat, where the whirl meets the
  spout, was read as a viciously tight bend, so the spout spent the whole drop
  flinging the marble at its own open side and catching it again. Both fixed:
  the feed is always enclosed, the drain follows its own style, and a bend is
  only measured where there is tube on both sides of it.
- The marble now rides where it actually sits in the bore — on the floor of a
  steep tube rather than pushed through its wall, and up the outside of a bend.

### Changed

- **The simulator is just gravity now.** The transport bar along the bottom of
  the stage is gone, along with its slider, its stall marker and the Simulator
  slider setting. ▶ Simulator on the toolbar starts the marble and pauses it,
  ↺ Reset sends it back to the start, and everything in between is the physics.
- **Every pipe starts closed.** A new run's stock style is Closed rather than
  3/4 Open; cutting a tube open is now a deliberate choice, along with the side
  it opens on. Saved files are unaffected — they carry their own style — and one
  written before the side existed opens on the top, where every opening was.

### Fixed

- **A rod knows how tall a pipe is where it actually passes.** Bracing measured
  every tube as though it were at full height however far off to the side it
  passed, so the floor under a coil came out a couple of millimetres below the
  turn above it and every rod between those two was refused for being too short
  to be worth striking. That is why a tapering coil came back with a bare stretch
  down the middle of it. A pipe is round: its surface is highest on its own
  centreline and falls away to either side, and that is what is read now.
- **How far round a coil has gone is counted by its turning, not by its length.**
  An outer turn of a tapering coil is half as long again as an inner one, so
  sharing the run out evenly put two rods on one turn and none on the next. The
  turning is added up from the run's own heading instead, chord by chord, which
  needs no knowing where the coil's axis is — and the ties come out one a turn,
  evenly spread, whatever the taper.
- A coil's straight stubs are no longer counted as part of its coil. They are
  ordinary run and are paced with the rest of it; counted as turns they threw
  every station along the whole coil off.

- **A corkscrew gets braced now.** Bracing the stage in one press used to walk
  straight past every coil on it and leave a couple of props under the bottom
  turn — the one part whose whole length floats was the one part that never got
  held up. Brace Every Run now ties each turn to the one below it, and a rod
  struck by hand down the outside does the job properly in one go.

### Tooling

- Automated changelog. Claude Code hooks now log every edited file, block the
  end of a turn until an entry is written here, and inject this file's recent
  history into context before each prompt. Config in `.claude/settings.json`,
  scripts in `.claude/hooks/`.

Uncommitted working-tree changes (13 files, ~1300 insertions). Summarized from
the diff, not from a commit message:

### Added

- Tool options bar below the toolbar (`TOOL_OPTIONS_HEIGHT`, `ToolMenuButton`,
  `ToolOption`, `hasToolOptions`, `ToolScope`) — per-tool settings surfaced
  inline instead of in the sidebar.
- Rotation step presets (`ROTATE_STEPS`, `rotateStepLabel`, `initialRotateStep`)
  for snapped part rotation.
- Joint fillets between connected pieces (`JOINT_FILLET_DEFAULT`,
  `jointFilletOf`, `jointBite`, `initialJointFillet`) in `src/lib/centerline.ts`.
- Socket reach calculation (`socketReach`) for part-to-part connection.
- `CheckIcon` in the icon set.

### Changed

- `Scene3D`, `Toolbar`, and `store` carry the bulk of the change; sidebar,
  context menu, help overlay, gizmo, shortcuts, and styles updated to match.

## [2026-08-26] Physics + Group Select

- Marble physics simulation.
- Group selection of multiple parts.

## [2026-08-26] Templates + Part Joining

- Templates section in the part library.
- Adding a part joins it onto the end of the existing run.

## [2026-08-25] Funnel

- Funnel part working end to end.
- Part detail panel shortened.
- Straight-line icon updated.

## [2026-08-25] Part Selection + Environment

- Part selection.
- Environment colors.
- Camera workplane rotate made transparent.

## [2026-08-25] Corkscrew

- New corkscrew part; ring count derived from available space or set by hand.
- Hook turn plane rotates a full 360°.
- Connect like ends by turning a run end for end.
- Project format v8.

## [2026-08-25] Hook Part

- New hook part (180° turnaround).
- Rotatable turn plane, flat or on edge.
- Project format v7.

## [2026-08-17] 2D/3D Mode Tooling

- 2D mode tube face; 3D mode tools.
- Duplicate, keyboard shortcuts, delete button in the toolbar.
- Settings to show/hide features; left nav toggle.
- 2D mode resize that keeps connections; bend measurements cleaned up.
- MCP AI integration plans drafted (see [docs/mcp-integration.md](docs/mcp-integration.md)).

## [2026-08-17] Tools, Units, Angles

- New tools; tube diameter "apply to all"; units.
- Updated chain links; manual degree angles.
- Corner connector part with updated icons; 3D mode right-click context popup.
- 2D mode multi view.

## [2026-08-16] Foundations

- Angle connector part.
- Tube style, connector kink resolution, simulator bar.
- New project starts from a blank workplane.
- Save and open.
