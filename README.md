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

## Scoring

Each cluster that drops past the player without contact awards points equal
to its size (a 5-hex cluster is a 5x bonus). Stick with a cluster on contact
and you score nothing. Survive long enough to grow into the danger zone and
the next sticky hit either rips you back to safety or ends the run.

## Game Center (iOS)

When running as a native iOS app the game authenticates the local player
against Game Center on launch and reports to a leaderboard plus a set of
achievements. On the web build Game Center is a no-op.

The IDs the JS code reports are defined in `src/gameCenter.ts`. To make them
live in production you need to create matching entries in App Store Connect:

| Kind        | Identifier                | Description                                |
| ----------- | ------------------------- | ------------------------------------------ |
| Leaderboard | `hex_rain.high_score`     | High score, integer, higher is better      |
| Achievement | `hex_rain.score_200`      | Reach 200 points                           |
| Achievement | `hex_rain.score_400`      | Reach 400 points                           |
| Achievement | `hex_rain.score_600`      | Reach 600 points                           |
| Achievement | `hex_rain.score_800`      | Reach 800 points                           |
| Achievement | `hex_rain.score_1000`     | Reach 1000 points                          |
| Achievement | `hex_rain.bonus_3x`       | Score a 3x bonus (3-hex cluster pass)      |
| Achievement | `hex_rain.bonus_4x`       | Score a 4x bonus (4-hex cluster pass)      |
| Achievement | `hex_rain.bonus_5x`       | Score a 5x bonus (5-hex cluster pass)      |
| Achievement | `hex_rain.survivor`       | Reach the danger zone and claw back to one |

Until those entries exist in App Store Connect (or until you sign in with a
sandbox Game Center account on the simulator) the report calls fail silently
and the rest of the game keeps working.

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

A GitHub Actions workflow that builds the iOS app on every push and pull
request on a `macos-14` runner is provided as a template at
`ci-templates/ios.yml.txt`. To enable it, copy that file to
`.github/workflows/ios.yml` and commit it. It runs the web build, syncs
Capacitor, and produces an unsigned simulator `.app` artefact.

(The template lives outside `.github/workflows/` because Claude's GitHub
OAuth app does not hold the `workflow` scope and so cannot push files into
that directory directly.)
