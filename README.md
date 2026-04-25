# Hexfall

A small browser arcade game. You control a hexagon at the bottom of the screen.
Clusters of 2–5 hexagons fall from above. If a cluster hits you, the touching
hex sticks onto your blob. Get too big and the next hit ends the run. Rare
**sticky** (magenta) clusters do the opposite — they rip a hex off you.

Score climbs each time a cluster passes without contact.

## Controls

**Desktop**

| Key | Action |
| --- | --- |
| `A` / `←` | Move left |
| `D` / `→` | Move right |
| `Q` / `Z` | Rotate counter-clockwise |
| `E` / `X` | Rotate clockwise |
| `Space` / `Enter` | Start / restart |
| `P` | Pause |

**Mobile** — use the four buttons under the play area.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build
```

Stack: Vite + TypeScript + Canvas 2D. No frameworks.

## Layout

```
src/
  main.ts      entry: mounts canvas, starts game
  game.ts      state machine, main loop, collisions, scoring
  player.ts    player blob: cells, rotation, movement
  cluster.ts   falling clusters (normal + sticky), shape rendering
  hex.ts       axial math, polyhex shape library, hex drawing
  input.ts     keyboard + touch button bindings
  types.ts     shared types
  style.css    layout, HUD, touch buttons
```
