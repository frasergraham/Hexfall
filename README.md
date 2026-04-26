# Hexfall

A small browser arcade game with real 2D physics (Matter.js). You control a
hexagon at the bottom of the screen. Clusters of 2–5 hexagons fall from above
with real gravity and spin. On contact the touching hex sticks onto your blob;
the rest break apart and tumble away, fading out. Get too big and the next
hit ends the run. Rare **sticky** (magenta) clusters do the opposite — they
rip a hex off you.

Score climbs each time a cluster passes without contact. The player blob
rotates freely and accumulates real angular momentum from off-centre hits.

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

Stack: Vite + TypeScript + Matter.js + Canvas 2D.

## Layout

```
src/
  main.ts      entry: mounts canvas, starts game
  game.ts     Matter engine, state machine, collisions, spawning, scoring
  player.ts    player compound body: cells, rebuild on grow/shrink
  cluster.ts   falling cluster compound bodies (normal + sticky)
  debris.ts    free-floating tumbling debris that fade out
  hex.ts       axial math, polyhex shape library, hex drawing
  input.ts     keyboard + touch button bindings
  types.ts     shared types
  style.css    layout, HUD, touch buttons
```
