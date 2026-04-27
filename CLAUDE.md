# CLAUDE.md

A pocket-arcade game where you steer a hex blob at the bottom of a portrait
play area. Polyhex clusters fall from above with real Matter.js physics —
angular momentum, restitution, gravity, the lot. Survive, collect, ramp the
score.

## Build & deploy

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build into ./docs (GitHub Pages)
```

The site is published from `docs/` on `main` to
`https://frasergraham.github.io/Hexfall/`. `vite.config.ts` pins
`base: "/Hexfall/"` and `outDir: "docs"`.

Add `?debug=1` to the URL for **DEBUG buttons** on the menu that start a
fresh run at 199 / 399 / 599. Runs started this way don't bank a high score.

## Module layout (`src/`)

| File | Purpose |
| --- | --- |
| `main.ts` | DOM bootstrap; instantiates `Game` |
| `game.ts` | Engine, state machine, spawn/wave/score/effect logic |
| `player.ts` | Compound body that grows/shrinks; bounds-based clamps |
| `cluster.ts` | Falling cluster bodies + render (hex / glowy blob / coin) |
| `debris.ts` | Free-floating tumbling fragments that fade out |
| `hex.ts` | Axial math + polyhex shape library + `pathHex` |
| `input.ts` | Keyboard, slider, slide-to-rotate, button bindings |
| `types.ts` | `ClusterKind`, `GameState`, etc. |
| `style.css` | Layout, HUD, touch controls |

## Game loop & state

`update(dt)` runs every rAF tick:

1. Drift starfield + age floaters (always).
2. **menu** → run input + a slim physics step so the player can practise.
3. **paused** → return.
4. **gameover** → physics keeps stepping so wreckage tumbles behind the
   overlay; `cleanupOffscreenBodies` trims off-screen things.
5. **playing** → input, hold-repeat, wave/pinch progression, spawn,
   physics, contacts, score-on-pass, lose check.

`Engine.update` is fed `gameDt = dt × effectiveScale`. `effectiveScale`
is `min(timeScale, hint?, tutorial?) × lateGameSpeedMul()`.

### Scoring

- Each cluster passing the player without contact: **+1**.
- Coin pickup: **+5** (banks immediately).
- During fast: base +1 per pass still banks, but the *extra* multiplier
  points (`(mul-1)` per pass, plus `5×(mul-1)` per coin) accumulate
  into a separate **bonus pool**.
  - Survive the timer: pool pays out as a single dramatic `+N` floater
    above the HUD.
  - **Hit a blue cluster**: pool is forfeited, scattered as red `-N`
    fragments, fast effect ends, multiplier resets.
  - Picking up a slow during fast cleanly ends fast and pays out.

### Lose rule

`DANGER_SIZE = 7`, `LOSE_COMBO = 2`. The danger glow appears at size ≥ 7;
combo only counts blue-cluster hits taken **while already in danger**, so
the player always sees the warning frame before a fatal hit.

### Late-game ramp

After score `LATE_RAMP_FLOOR_SCORE = 500`, base rate ramps `+10%` per 100
points (`LATE_RAMP_PER_100`), capped at 2.5× at score 2500+. Slow / fast /
hint / tutorial modifiers stack multiplicatively on top.

## Cluster kinds (`ClusterKind`)

| Kind | Look | Behaviour |
| --- | --- | --- |
| `normal` | Blue hex | Avoid. Sticks one hex onto the player on contact. Triggers a 2 s 0.5× recovery slow-mo. Also breaks a fast-bonus pool. |
| `sticky` | Magenta blob ("HEAL") | N-hex cluster rips N-1 closest hexes off the player (floor 1, capped at size-1). Resets combo. Disconnected components prune to debris. |
| `slow` | Yellow blob ("SLOW") | 5 s of `0.5×` time. While active, falling clusters trail rising bubbles. |
| `fast` | Green blob ("FAST") | 5 s of `1.25×` time the first time, +`0.1×`/+`1×` mul per stack. Bonus pool. Speed lines trail clusters. |
| `coin` | Orange spinning disc ("COLLECT") | +5 score. Bursts into 6 tiny radial shards. |
| `shield` | Cyan blob ("SHIELD") | 10 s bubble around the player; absorbs blue hits at 1 s of shield per hit. Sticky still rips. |
| `drone` | Violet sentinel ("DRONE") | Spawns a small mid-screen sensor body that oscillates left/right and shatters blue clusters on contact. 10 s lifetime, `-1 s` per intercept. Only blue. |

Spawn weighting (per spawn during calm/non-swarm waves):

```
coin: 7%        slow: 5% (≥5)      fast: 5% (≥5)
sticky: 10% (≥3)   shield: 5% (≥200)   drone: 2% (≥400)
```

Swarm waves (35% of waves) drop single-hex sequences at 0.18 s cadence;
12% of swarm hexes spawn as red heals (≥3) — only normal + sticky.

### Wave system

Alternates `calm` ↔ `wave`. Each wave start:

- Picks a **safe column** (-half..+half) that new spawns avoid → no
  impossible setups.
- 35% chance of being a swarm.
- After score 600, 50% chance of being a **pinched** wave (red-tinted
  inset panels narrow the playable area; spawn columns and player rail
  clamp inward).

Score-gated extras for normal cluster spawns:
- ≥200: ~30% drop at a non-vertical angle.
- ≥400: ~18% spawn from the left/right edge at a downward diagonal,
  always entering in the upper half.

## UI / controls

### Desktop
`A`/`←` `D`/`→` move · `Q`/`Z` `E`/`X` rotate · `Space`/`Enter` start
or restart · `P` pause.

### Mobile
- **Slider** (full width, slim pill) at the bottom: thumb position →
  player x via `setX` (direct, no lag).
- **Slide-to-rotate** anywhere on the canvas. Horizontal `dx` × `0.02`
  rad/px → `Body.setAngle`. A 22 px green dot indicator follows the
  finger. Multi-touch via `touchIdentifier`.

### HUD overlays

- Score / Best in the header.
- Top-of-board countdown bar while a slow/fast effect is active.
- Below the bar, while fast: `{N}X · +{pool}` running tally.
- First-appearance kind hints (per page session; cleared on reload):
  big block-cap glowing labels above the cluster (AVOID / HEAL / SLOW /
  FAST / COLLECT / SHIELD / DRONE) with the game forced to 0.5× while
  any hint cluster is on screen.
- Rotate tutorial: first 1→2 growth this session shows a horizontal
  double-headed arrow + "ROTATE" label and forces 0.25×.
- `+5`, `3X`, `+N`, `-N` floaters (rise, scale-in, fade); the fast
  bonus payout uses the **grand** profile (huge font, ease-out cubic
  pop, slow drift up).

### Cosmetic
Two-plane parallax starfield (back: `±8 px` parallax, front: `±22 px`)
that drifts downward at 6 / 18 px/s for a "moving forward" feel.

## Tunables

All in `game.ts`:

```
HEX_SIZE_BASE, BOARD_COLS                       layout
BASE_FALL_SPEED, MAX_FALL_SPEED, SPEED_RAMP     fall velocities
SPAWN_INTERVAL_*, SWARM_*                       cadence
DANGER_SIZE, LOSE_COMBO, STICK_INVULN_MS        lose / hit rules
SLOW_/FAST_/STICK_SLOW_BUFFER_*                 effect durations
SLOW_TIMESCALE, FAST_TIMESCALE_BASE/_STEP,
  FAST_MULTIPLIER_BASE/_STEP                    effect rates
SHIELD_/DRONE_*                                 shield + drone
LATE_RAMP_FLOOR_SCORE, LATE_RAMP_PER_100        endless ramp
ROTATE_SLIDE_SENS                               touch rotation feel
```
