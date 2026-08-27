# Changelog

All notable changes to the Marble Run Generator. Newest first.

This file is maintained automatically: a Claude Code hook records every file
Claude modifies and blocks the end of the turn until an entry lands here. It is
also injected into context before every prompt, so read it before asking for new
work — the answer to "did we already do this?" is usually here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **The Support.** A post that stands on the ground and cradles the tube above
  it — the other half of the base, and the part that makes a run printable at
  all: every tube on this stage hangs in mid-air, and a printed tube hanging in
  mid-air falls on the floor. The groove across its top is cut to the shape of
  the pipe it carries, a shade wide so the tube beds down in it rather than
  perching on the arms. Set how high the tube it holds sits, how thick the post
  is across the run and how far it reaches along it, how far the arms wrap round
  — from a flat seat to a half-round cup — and how far its own corners are
  rounded. Found under Structure, beside the base.
- **It stands square.** A printed post leaning over is a post that needs propping
  itself, so a support stands dead upright whatever the run above it is doing and
  the fall of that run goes into the *cradle* instead: the groove is cut on the
  slope and drops through the top at the angle the tube is already falling at. It
  states its own fall the way a base and a coil do, and the fall it states is
  none. Its underside is on the workplane and stays there — stand one on a base
  and the two overlap and print as one solid.
- **Where the run is stacked over itself, the posts stack too.** The floor under
  the upper level of a switchback already has the lower level on it, and a post
  driven down to the plate would go straight through the pipe it was meant to
  pass. So it stands on that pipe: its underside becomes a saddle cut to the same
  tube, straddling it by the same wrap the cradle cups with, and the load goes
  down through the run to whatever is holding *that* up. Posts stack as many deep
  as the run does. The saddle is cut where the lower pipe really passes rather
  than through the middle of the post, because a post is centred under what it
  carries and almost never over what it stands on.
- **⌶ Supports**, on the toolbar: paces out every run on the stage and stands a
  post wherever one will fit. It declines three kinds of spot — where the ground
  is already holding the tube up, where a post is standing already, and where the
  column would have to go through the run to get there. Where the last is only
  true of the *plate*, it stacks instead. New posts are cut to match the last one
  on the stage, so shaping one by hand and pressing it again gives a stage of
  posts that agree. Three spots it declines outright, and says so: a tube
  crossing underneath at more than a few degrees off parallel, which a straight
  groove would balance on rather than sit along; a gap between two levels too
  small to leave a post worth printing; and a lower tube of a different size from
  the one being carried, since one post cuts one groove radius. In each case that
  stretch is propped from the next place along it.
- **Fit to the Run Above**, in Part Parameters: reads the height, the fall and
  the heading straight off whatever tube is passing over the post, and works out
  whether it should be standing on the plate or on the run. Where it stands in
  plan is left alone — sliding a post about the floor is something you can see
  yourself doing, and reading a height off a run to a tenth of a millimetre is
  not.
- The cradle and the saddle are solved rather than carved. A cylinder lying
  across a post cuts a surface that is straight in one axis at every point across
  the other, so one closed form gives the whole of the top face at once — the
  groove, the two arms, the flat shoulders outside them and the way all four tilt
  with the run — and the same form upside down gives the underside. The solid is
  those slices lofted, which makes it watertight by construction whatever the
  numbers.
- The marble meets a post as a rounded box, like a base, but only between the
  crown of its saddle and the floor of its cradle: over the pipe and under the
  pipe there is nothing to hit, and a box drawn any further would stand in the
  bore of the very tube the post is holding.
- It goes everywhere a part goes: picked and moved on the stage, listed in Active
  Parts, drawn in the six ortho views of the 2D draft, saved with the project,
  and laid on the print plate standing the way it prints — flat footprint down,
  cradle looking at the ceiling, every wall square. Project files are now v11.

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
