# Changelog

All notable changes to the Marble Run Generator. Newest first.

This file is maintained automatically: a Claude Code hook records every file
Claude modifies and blocks the end of the turn until an entry lands here. It is
also injected into context before every prompt, so read it before asking for new
work — the answer to "did we already do this?" is usually here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
