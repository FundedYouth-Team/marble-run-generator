# AI / MCP Integration — Implementation Model

**Status: draft. Nothing here is built yet.** This is the plan of record for letting
someone describe a marble run in plain language and get a real, openable project back.

---

## 1. What "done" looks like

A user in Claude (Desktop, Code, or claude.ai) types:

> Build me a run that drops 300 mm over four switchbacks, 20 mm bore, and export it
> as a print plate.

…and gets back a `.mrun.json` they can open in this app, plus the sliced-ready meshes.
No hand-editing, no copying JSON around, and every number inside the run is one the
app would have accepted from the UI.

## 2. Why this repo is already most of the way there

The run is not locked inside React state — it is a plain, versioned document:

- [`ProjectFile`](../src/lib/project.ts) is the whole model: tube size, style, marble
  fit, and an ordered parts list. That interface **is** the API surface. Anything that
  can emit a valid `ProjectFile` can build a run.
- [`parseProject`](../src/lib/project.ts) already repairs rather than refuses — missing
  fields fall back to what a new part would have used, out-of-range values clamp. A
  model-authored file that is 95% right still opens.
- `PROJECT_VERSION` is a real compatibility gate, so an MCP server and the app can
  drift apart without silently mangling runs.
- The geometry and export code is pure TypeScript. Only the *download* tails touch the
  DOM ([exporters.ts](../src/lib/exporters.ts), [project.ts](../src/lib/project.ts)).

So the integration is mostly **packaging**, not new domain code.

---

## 3. Architecture

```
packages/core/          ← no DOM, no React. The run and everything that reasons about it.
  model.ts                Piece, Placement, makePiece, PIECE_LIMITS, TUBE_LIMITS,
                          ANGLE_DEFAULTS, CORNER_DEFAULTS, PART_LABEL, VARIANT_LABEL
  joints.ts               kinksOf, relink, exitSlope  (lifted out of store.ts)
  project.ts              serialiseProject, parseProject   (minus saveProjectFile)
  centerline.ts           unchanged
  geometry.ts             unchanged
  layout.ts               buildAssembly, sampleAssembly — the validation surface
  exporters.ts            byte/text producers, minus downloadBlob
  units.ts                unchanged

packages/mcp/           ← the MCP server. Node, stdio. Depends on core.
  server.ts               tool registration + dispatch
  schema.ts               JSON Schemas generated FROM core's limit tables
  document.ts             the one open run, autosaved to disk
  bin.ts                  #!/usr/bin/env node — the npx entry point

src/                    ← the existing Vite app. Also depends on core.
```

The rule: **`packages/core` never imports React, zustand, `three` renderers, or
anything off `window`.** `three` itself is fine (it is used headlessly for buffer
geometry), the DOM is not.

---

## 4. The one real refactor

[`src/store.ts`](../src/store.ts) is ~1,900 lines and mixes three things: zustand
plumbing, view state, and genuine domain logic. The server needs the third but must
not drag in the first two.

**Moves out to `packages/core`:**

| From `store.ts` | Why the server needs it |
|---|---|
| `Piece`, `Placement`, `PieceType`, `TubeVariant`, `TubeSpec`, `JointSpec` | The document shape |
| `makePiece` | Every added part must be built the same way the UI builds one |
| `PIECE_LIMITS`, `TUBE_LIMITS` | Generates the tool JSON Schemas — see §6 |
| `ANGLE_DEFAULTS`, `CORNER_DEFAULTS` | A part the model under-specifies still lands somewhere sane |
| `PART_LABEL`, `VARIANT_LABEL`, `UNTITLED_PROJECT` | Naming and validation |
| `kinksOf`, `relink`, `exitSlope` (currently private) | Adding a part mid-chain must relink downstream exactly as the UI does |
| `isHexColor`, `projectSlug`, `clamp`/`tidy` helpers | Shared validation |

**Stays in `store.ts`:** every `set(...)`, history/undo, camera, theme, tool
selection, `rightPanel`, simulation playback, and the DOM download helpers.

This refactor is worth doing on its own merits — it shrinks the store to state
management and makes the joint logic testable without React.

**Risk:** the joint/relink logic is subtle (a kink the user built on purpose is theirs
to keep). Extract it with characterisation tests written against the current behaviour
*before* moving it, not after.

---

## 5. Phasing

### Phase 0 — schema handoff, no server (½ day)

Publish the `ProjectFile` schema as a document and let Claude write `.mrun.json`
directly. The user opens it with the existing Open button.

This costs almost nothing and answers the only question that matters: **is a language
model any good at laying out a marble run?** If parts land in the wrong places or the
slopes are nonsense, no amount of MCP tooling fixes that — the fix is better tool
descriptions and a validation read-back, which Phase 1 provides. Do not skip this step;
it sets the tool surface.

### Phase 1 — local stdio MCP server (the main build)

`npx marble-run-mcp`, registered in the user's Claude client. Holds one open run,
mutates it through tools, writes `.mrun.json` and meshes to disk. Details in §6–§8.

### Phase 2 — live preview bridge

The server also opens a local WebSocket. The app connects and re-renders on every
mutation, so the user *watches* the run being built. This is the demo that sells it,
but it is strictly additive — build it after Phase 1 is stable.

Shape: server broadcasts the full `ProjectFile` on change (the documents are small;
diffing is not worth the complexity). App calls `loadProject` on receipt. Guard behind
an explicit "Connect" action in the AI / MCP panel — never auto-connect.

### Phase 3 — remote server

Reaching claude.ai users means HTTP transport, hosting, and auth instead of stdio.
Same tools. Defer until Phase 1 has actual users.

---

## 6. Tool surface

Small and semantic. One open document per server process, file-backed and autosaved —
a stateless "pass the whole project in and out" design burns tokens and invites the
model to silently drop parts it forgot to echo.

| Tool | Inputs | Returns |
|---|---|---|
| `new_run` | `name`, `innerDiameter`, `wallThickness`, `variant`, `marbleDiameter` | run summary |
| `open_run` | `path` | run summary |
| `describe_run` | — | parts, sizes, chains, **warnings** |
| `add_part` | `type` + per-type params, `joined` \| `at`, `color`, `variant` | new part index + warnings |
| `update_part` | `index` \| `name`, partial params | warnings |
| `remove_part` | `index` \| `name` | — |
| `save_run` | `path?` | written path |
| `export_run` | `format: stl\|3mf\|obj`, `scope: assembly\|plate\|piece`, `path?` | written path, triangle count |

Deliberately **not** tools: camera, theme, units, simulator settings. Those are view
state; exposing them adds surface area with no payoff.

### Schemas come from the limit tables

`packages/mcp/schema.ts` must **generate** each tool's `input_schema` from
`PIECE_LIMITS` / `TUBE_LIMITS` rather than restating the numbers. With `strict: true`
on the tool definition, the model then cannot emit a slope, bend, or sweep outside the
legal range — and the range is never written down twice.

```ts
// sketch
const partSchema = (type: PieceType) => ({
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: Object.keys(PART_LABEL) },
    length: numeric(PIECE_LIMITS.length, 'Axial length of the part, mm'),
    slope: numeric(PIECE_LIMITS.slope, 'Downhill angle, degrees. Positive drops.'),
    ...(type === 'angle' ? { bend: numeric(PIECE_LIMITS.bend, '…') } : {}),
    ...(type === 'corner' ? { sweep: numeric(PIECE_LIMITS.sweep, '…') } : {}),
  },
})
```

### Descriptions state *when*, not just *what*

Tool descriptions are the only thing steering the model's choices. Write them
prescriptively — "Use `corner` when the run must change heading while staying level;
use `angle` when it must change slope" — not as a restatement of the field names.

---

## 7. The feedback loop is the whole trick

`describe_run` is what turns this from "generates plausible JSON" into "builds runs
that work". It must return, alongside the parts list:

- **Chain structure** from `buildAssembly` — which parts are actually joined, and where
  each free-standing chain starts.
- **Joint warnings** from the kink logic — a joint whose entry slope does not match the
  previous part's exit, with the size of the mismatch.
- **Fit warnings** — marble larger than bore, a part whose own `innerDiameter` does not
  mate with its neighbour's.
- **Reachability** — a downhill run that goes uphill, or a slope too shallow to keep the
  marble moving. `sampleAssembly` plus the simulator's friction model can answer this.

With that read-back, the model adds a part, sees "the corner's exit is 4° off the next
part's entry", and fixes it itself. Without it, it guesses and the user gets a run that
looks right and does not roll.

**Return warnings from the mutation tools too**, not only from `describe_run` — it
halves the round trips.

---

## 8. Distribution

- Publish `packages/mcp` to npm as `marble-run-mcp` with a `bin` entry.
- Users register it with `claude mcp add marble-run -- npx -y marble-run-mcp`, or the
  equivalent block in `claude_desktop_config.json`.
- Ship a `README` section with the copy-paste config and one worked example prompt.
- Version the server against `PROJECT_VERSION`: refuse to open a file from a newer
  format, exactly as `parseProject` does today.

---

## 9. Open questions

1. **Placement vs joints.** Should the model be allowed to set `at` (free placement) at
   all, or only `joined`? Free placement is far harder to get right from text and is
   where wrong-looking output will come from. Leaning toward: joints only in v1, `at`
   behind an explicit "place this chain at…" tool.
2. **Does it need the simulator?** Running the marble is the real correctness test, but
   it means porting `sim.ts` to run headlessly and deciding how many steps is enough.
   Probably Phase 2.
3. **Multi-chain runs.** `describe_run` needs a stable way to name chains so the model
   can talk about "the second chain" without index churn after every insert.
4. **Undo.** Server-side mutations bypass the app's history. If the live bridge lands,
   an incoming project should probably push one history entry, not replace the stack.

---

## 10. Order of work

1. Characterisation tests for `kinksOf` / `relink` against current behaviour.
2. Phase 0 — publish the schema, try it by hand, keep the transcripts.
3. Extract `packages/core`; app keeps working, no behaviour change.
4. `packages/mcp` with `new_run` / `add_part` / `describe_run` only.
5. Add `export_run` and `save_run`.
6. Ship to npm, dogfood, tune tool descriptions against the Phase 0 transcripts.
7. Phase 2 live bridge, if it still seems worth it.
