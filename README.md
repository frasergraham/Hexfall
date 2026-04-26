# Hex Rain

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

## iOS (Capacitor)

The game is wrapped as a native iOS app via [Capacitor](https://capacitorjs.com/).
The web build is copied into the iOS project as the embedded web view content.

### Setup (macOS only)

iOS development requires a Mac with Xcode 15+ and CocoaPods. The Xcode project
lives under `ios/` and is committed. From a fresh clone:

```sh
npm install
npm run ios:sync   # build web → copy into ios/App + pod install
npm run ios:open   # opens the project in Xcode
```

From Xcode, choose a simulator or a connected device and press ▶︎. To produce a
release `.ipa`, archive the `App` scheme (Product → Archive) and use the
Organizer to export.

If you ever need to regenerate the iOS project from scratch (e.g. after a major
Capacitor upgrade), delete `ios/` and run `npm run ios:add`.

### CI

`.github/workflows/ios.yml` builds the iOS app on every push and pull request
on a `macos-14` runner. It runs the web build, syncs Capacitor, and produces an
unsigned simulator `.app` artefact.
