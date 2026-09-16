# Agent Contracts — who owns what

Three.js Studio uses domain-scoped specialists. Each specialist owns a
slice of the scene DSL. Cross-domain mutations must go through the
correct agent — the Director enforces this by choosing whom to delegate
to.

## Ownership matrix

| Concern | Owner | DSL fields it may mutate |
|---|---|---|
| Node creation / hierarchy / transforms | **Layout** | `nodes[].{type,geometry,materialId?,parent,position,rotation,scale,castShadow,receiveShadow,visible}` |
| Materials, shaders, textures | **Material** | `materials.*`, `nodes[].materialId` |
| Lights, HDRI, tone mapping, exposure | **Lighting** | `nodes[].{type:light}`, `background`, `tone` |
| Camera type / framing / controls | **Camera** | `camera.*` |
| Approved brief / plan | **Plan** (read-only) | — |
| HTML validity fixes | **Reviewer** | `index.html` (last-mile only) |
| MP4 export | **Renderer** | (no scene mutation; writes video file) |
| One-shot custom code | **Developer** (fallback) | writes full `index.html` (bypasses DSL) |

## Cross-cutting rules

1. **Always read before writing.** Every specialist starts with
   `get_scene(slug)` — the DSL may have changed since it was last
   invoked. Do not assume ids are stable across turns unless the
   Director provided them explicitly.

2. **One domain per delegation.** The Director does not stack more than
   one specialist per turn. After each one finishes, the Director
   re-reads the scene and decides the next step. Compounded delegations
   cause id collisions and lost work.

3. **Snapshot before large changes.** If a specialist is about to remove
   or rewrite >5 nodes, call `snapshot_scene(slug, label)` first —
   snapshots are cheap and reversible.

4. **Named ids where possible.** `chair_1`, `table`, `floor`, `sun` >
   auto-generated `m1`, `n7`. Named ids survive across sessions and
   make handoffs readable.

5. **Compiler is source of truth for HTML.** No specialist writes to
   `index.html`. The Reviewer can patch trivial HTML issues in place
   (last-mile only), but should prefer DSL fixes when the fault is
   in the scene definition.

## Handoff format

Every specialist ends its turn with a structured handoff:

```
<AGENT>_HANDOFF
Task: <one sentence restating the request>
Created / Updated / Deleted: <ids and counts>
State summary: <compact fact about the current scene, e.g. "12 nodes, 3 materials">
Next agent: layout | material | lighting | camera | critic | director
```

The Director reads only this handoff — the full tool trace is not
forwarded. So the handoff must be self-contained.

## Escalation

If a specialist cannot complete its task because:

- **Missing prerequisite** (e.g. Material Agent asked to color a node
  that doesn't exist): return handoff with `Next agent: layout` and a
  precise ask (create node with id `X`, geometry `Y`).
- **Ambiguous brief**: return handoff with `Next agent: director` and a
  concrete question — do not guess.
- **Out-of-scope**: return handoff pointing to the correct specialist.
  Never do another agent's job even if you could.

## Boundaries — quick reference

| Task | Right agent |
|---|---|
| "Add a chair" | Layout |
| "Make the chair leather red" | Material |
| "Warmer light" | Lighting |
| "Zoom in on the chair" | Camera |
| "Add physics so the chair falls over" | Developer (fallback) |
| "Render a 10s video" | Renderer (via Director) |
| "Fix the black screen" | Lighting (usually — check for lights) |
| "Nothing renders" | Reviewer (HTML validity) |
