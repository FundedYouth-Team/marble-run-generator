# Marble Run Generator

A parametric, CAD-style web app for designing snap-together marble-run tubing.
Vite + React + TypeScript + three.js, managed with pnpm.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production bundle
```

## The two modes

**2D Draft Mode** — a drafting grid with two views:

- *Section A–A* — the tube front face, dimensioned. You set the **inner
  diameter** (the bore the marble rolls in) and the **wall thickness**; outer
  diameter is derived. The **tube variation** picks how much of the
  circumference is solid wall:
  | Variation | Wall sweep | Notes |
  |---|---|---|
  | Half | 180° | open trough, marble fully exposed |
  | 3/4 Open | 252° (70%) | slot on top to see into the tube |
  | Closed | 360° | fully enclosed |
  A dashed ghost circle shows the marble's fit in the bore.
- *Assembly draft* — the chained pieces to scale, in **Elevation** (developed
  side view) or **Plan** (top-down). Scroll to zoom, drag to pan, `Fit` to
  reframe. Click a piece to select it. A scale bar tracks the current zoom.

**3D Mode** — the generated solids in an orbit/zoom/pan viewport, plus the
marble simulator.

## Objects

Only **Straight Line** is implemented, as specified. Each piece takes:

- **Length** — mm along the tube axis.
- **Slope** — downhill pitch in degrees. *(Added beyond the brief: without a
  slope the marble has no gravity component to roll on.)*
- **Turn** — heading change applied at the joint, so runs can change direction
  in plan.

## Snap-fit joints

Every piece is generated with a joint at both ends, so pieces clip together:

```
|<-- socket -->|<-------- body (length) -------->|<-- spigot -->|
```

- The **female socket** at the inlet is counterbored to the wall mid-radius
  plus a 0.15 mm slip clearance, with a retention **groove**.
- The **male spigot** at the outlet keeps the bore at the inner radius and
  removes the outer half of the wall, so the marble channel stays continuous
  and unstepped across the joint.
- A **snap barb** on the spigot — square retention face, lead-in ramp toward
  the tip — engages the socket groove. Barb height scales with wall thickness.

Joint depth is `clamp(length × 0.35, 3, 8)` mm. Pieces are chained so that
piece *N*'s spigot occupies piece *N+1*'s socket; nominal run length is the sum
of the piece lengths.

## Export — STL, 3MF, OBJ

Step 4 in the sidebar, plus a shortcut in the 3D HUD that follows the chosen
format. Everything is written at 1 unit = 1 mm, rotated to Z-up and seated on
the build plate at z = 0.

| Target | What you get |
|---|---|
| **Print plate** | every piece laid flat and separated, axis along X, opening upward — no supports needed for Half and 3/4 |
| **Assembly** | the run exactly as designed, for checking fit |
| **Selected piece** | one piece, laid flat at the origin |

| Format | Notes |
|---|---|
| **3MF** | default. Declares `unit="millimeter"` in the file, so nothing has to guess the scale, and stores repeated pieces once as instanced objects. Roughly 8× smaller than STL. |
| **STL** | binary. Universally supported but unitless. |
| **OBJ** | text, with normals. Convenient for mesh editors; unitless and by far the largest. |

Filenames carry the profile, e.g.
`marble-run-plate-4pc-id18-w3-threequarter.3mf`. The panel reports part count,
triangle count, instanced-object count (3MF) and file size after each export.

three.js has no 3MF exporter, so `src/lib/threemf.ts` writes the OPC package
directly: `[Content_Types].xml`, `_rels/.rels` and `3D/3dmodel.model`, zipped
with `fflate`. Because 3MF wants a connected manifold mesh — where the render
geometry deliberately duplicates vertices along each profile edge to keep
normals crisp — vertices are welded on the way out (765 verts instead of
~2,200 for a piece).

Verified on the actual exported files: package structure and `unit` correct;
every mesh watertight (0 unpaired edges, 0 opposed-winding edges, 0 degenerate
triangles, positive signed volume); a 4-piece plate with two matching lengths
writes 3 objects / 4 build items; world-space bounding boxes identical across
all three formats; and the 3MF reads back through three's own `3MFLoader` with
matching mesh and triangle counts.

The assembly export is closed but is *several overlapping shells* — each
piece's spigot sits inside the next piece's socket, so coincident faces appear
at the joints. Slicers union them, but print from the plate.

## Simulator

The marble is modelled as a solid sphere rolling without slipping along the
tube axis:

- `a = (5/7)·g·sinθ − µ·g·cosθ` (the 5/7 is the solid-sphere rolling inertia)
- At each joint only the tangential velocity component survives —
  `v ← v·cos(Δdirection)` — so sharp turns cost speed, as they would in reality.
- Off the end of the last piece the marble switches to free flight under
  gravity, then resets if **Loop** is on.

Adjustable: marble diameter, rolling friction µ, and sim speed. The HUD reads
out speed (m/s), distance travelled, and whether the marble is in the tube or
airborne.

## Layout

| Path | Purpose |
|---|---|
| `src/store.ts` | app state (zustand), tube + joint specs |
| `src/lib/geometry.ts` | axial station profile → solid `BufferGeometry`; 2D section path |
| `src/lib/exporters.ts` | STL / 3MF / OBJ output, plate layout, Z-up seating |
| `src/lib/threemf.ts` | 3MF package writer (vertex welding + instancing) |
| `src/lib/layout.ts` | chains pieces head-to-tail, builds per-piece frames |
| `src/lib/sim.ts` | marble physics |
| `src/components/Draft2D.tsx` | 2D draft mode |
| `src/components/Scene3D.tsx` | 3D viewport + simulator |

The solid is built from a list of *stations* — cross-sections at an axial
position with an inner and outer radius. Two stations sharing a `z` produce a
flat annular step, which is how the socket shoulder, spigot shoulder and barb
are formed. Adding a new joint feature means adding stations, not new meshing
code.

Those stations become a single closed polygon in the (axial, radial)
half-plane — out along the outer wall, back along the bore — which is then
swept about the axis, lathe-style. Because every surface comes from one
consistently ordered loop, face winding follows from the polygon's signed area
rather than from per-surface special cases, which is what makes the export
watertight. Open variants additionally cap the two cut ends by earcutting the
same polygon.

## Not yet built

Curve and drop objects (the type dropdown lists them as disabled), STEP
export, and collision-based physics (the marble is constrained to the axis
rather than free inside the bore).
