# CLAUDE.md

A pocket-arcade game where you steer a hex blob at the bottom of a portrait
play area. Polyhex clusters fall from above with real Matter.js physics —
angular momentum, restitution, gravity, the lot. Survive, collect, ramp the
score.

## Build & deploy

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc + vite build into ./dist (Railway, hexrain.xyz)
npm run ios:sync     # build:ios + cap sync ios + patch-cap-plugins
```

The web build is deployed by **Railway** (`railway.json`) — Nixpacks
runs `npm install --include=dev && npm run build` and the start
command static-serves `dist/`. Railway also stands up a per-PR preview
environment at `hexrain-hexrain-pr-N.up.railway.app`. `vite.config.ts`
pins `base: "/"` and `outDir: "dist"`. The iOS build uses `build:ios`
which only overrides `base="./"` (relative URLs are required inside
the WKWebView, served from a non-root origin).

Add `?debug=1` to the URL for **DEBUG buttons** on the menu that start a
fresh run at 199 / 399 / 599. Runs started this way don't bank a high
score. Debug also force-unlocks every challenge block + the editor + the
PAINFUL difficulty so test runs don't need IAP state in localStorage.

## Balance simulator

```sh
npx tsx scripts/simulate.ts                   # endless × 4 difficulties × 4 skills
npx tsx scripts/simulate.ts --challenges      # also roster mid-block sample
npx tsx scripts/simulate.ts --audit           # tier-share audit vs DIFFICULTY_CONFIG
npx tsx scripts/simulate.ts --json out.json   # emit raw stats
npx tsx scripts/simulate.ts --diff a.json b.json   # delta table for A/B tuning
```

Encounter-level model with a lookahead planner — not physics. Trust
relative deltas between configs more than absolute scores. Skill
profiles in `src/sim/skills.ts` are calibrated against Game Center
top-of-leaderboard data; recalibrate when telemetry changes.

## Module layout (`src/`)

| File | Purpose |
| --- | --- |
| `main.ts` | DOM bootstrap; instantiates `Game`; cold-launch CloudKit pull + subscription |
| `game.ts` | Engine, state machine, spawn/wave/score/effect logic, all challenge / editor / community UI |
| `player.ts` | Compound body that grows/shrinks; bounds-based clamps; auto-runs connectivity sweep on cell mutations |
| `cluster.ts` | Falling cluster bodies + render (hex / glowy blob / coin) |
| `debris.ts` | Free-floating tumbling fragments that fade out |
| `hex.ts` | Axial math + polyhex shape library + `pathHex` |
| `input.ts` | Keyboard, slider, slide-to-rotate, button bindings |
| `types.ts` | `ClusterKind`, `GameState`, etc. |
| `style.css` | Layout, HUD, touch controls, editor + community card styling |
| `analytics.ts` | GoatCounter pings for play / score / challenge starts |
| `audio.ts` | SFX + music with toggles |
| `rng.ts` | Canonical seeded mulberry32 + FNV-1a `hashSeed` (single source of truth) |
| `waveDsl.ts` | `parseWaveLine` + `composeWaveLine` (round-trip) + `validateChallenge` for the wave DSL |
| `wavePresets.ts` | Editor preset library (calm rain, scripted, etc.) |
| `wavePreview.ts` | Renders the small wave-preview canvas in the editor |
| `challenges.ts` | Roster of 30 hand-authored challenges, `ChallengeProgress` persistence, star thresholds |
| `customChallenges.ts` | Player-authored challenge store, publish/install metadata, validators |
| `storeKit.ts` | iOS StoreKit 2 bridge for the "Unlock All Challenges" IAP |
| `gameCenter.ts` | iOS Game Center bridge: auth, leaderboards, achievements, display name |
| `cloudKit.ts` | iOS CloudKit bridge — generic upsert/fetch/query/delete + subscription |
| `cloudWeb.ts` | Web read-only CloudKit Web Services REST client (uses `VITE_CLOUDKIT_API_TOKEN`) |
| `cloudSync.ts` | High-level sync: progress mirror, publish/install/leaderboard/upvote/report; dispatches reads to native or web |
| `share.ts` | `shareChallenge(name, recordName)` — Web Share API + clipboard fallback for deep links |
| `moderation.ts` | Client-side bad-words / length / non-printable check on community names |
| **`storage.ts`** | Typed wrappers: `loadString/saveString`, `loadBool/saveBool`, `loadJson/saveJson`, `removeKey`. Single chokepoint for all `localStorage` |
| **`storageKeys.ts`** | Registry of every `hexrain.*` key the app reads or writes |
| **`palettes.ts`** | All `ClusterKind` colour data: `blobPalette`, `hintPalette`, `debrisPalette` (re-exported from `cluster.ts` and used by `debris.ts`) |
| **`validation.ts`** | `clamp`, `clampDifficulty`, `clampStars`, `numOr` — shared by custom-challenge loader + CloudKit field marshalling |
| **`spawn.ts`** | `lateGameSpeedMul(score)` + `computeWaveParams(score, spawnIntervalMul)` — pure score-driven cadence |
| **`scoring.ts`** | `stepMilestones(score, tiers, startIdx)` + `highestTierCrossed(banked, tiers)` — pure milestone awards |
| **`spawnKind.ts`** | `DIFFICULTY_CONFIG`, tier-weight + score-gate constants, `pickKind` / `pickHelpfulKind` / `pickChallengeKind` — pure spawn-balance data shared by `game.ts` and the offline sim |
| **`sim/*.ts`** | Encounter-level offline simulator. `sim/types.ts`, `sim/skills.ts`, `sim/encounter.ts` (lookahead planner + pHit/pCatch resolver), `sim/endless.ts`, `sim/challenge.ts`, `sim/aggregate.ts` (percentiles, diff). Run via `tsx scripts/simulate.ts` |

iOS native plugins live in `ios/App/CapApp-SPM/Sources/CapApp-SPM/`:
`StoreKitPlugin.swift`, `GameCenterPlugin.swift`, `CloudKitPlugin.swift`.
`scripts/patch-cap-plugins.mjs` re-registers them in
`ios/App/App/capacitor.config.json` after each `cap sync` (Capacitor's
CLI scanner doesn't see plugins inside the app's own SPM target).

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

States: `menu`, `playing`, `paused`, `gameover`, `challengeSelect`,
`challengeIntro`, `challengeComplete`, `editorHome`, `editorEdit`.

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
the player always sees the warning frame before a fatal hit. Custom
challenges can lower `dangerSize` (e.g. hardcore-style runs).

### Late-game ramp

After score `LATE_RAMP_FLOOR_SCORE = 500`, base rate ramps `+10%` per 100
points (`LATE_RAMP_PER_100`), capped at 1.8× at score 1300+. Slow / fast /
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

Spawn weighting (per spawn during calm/non-swarm waves) is a two-tier
roll. A uniform draw picks a tier, then the kind is chosen uniformly
across whichever kinds inside that tier currently pass their score
gate (failed gates redistribute within the tier; failed sticky tier
falls through to Normal).

```
Sticky tier:    10%  (≥3)            → sticky
Helpful tier:   19%                  → coin (always),
                                       slow (≥5), tiny (≥cfg),
                                       shield (≥200), drone (≥400)
Challenge tier:  5%                  → fast (≥5), big (≥cfg)
Normal tier:    rest                 → blue
```

Tier weights live in `game.ts` as `SPAWN_*_TIER_WEIGHT` constants and
are tunables. Per-difficulty `stickyMul` / `helpfulMul` / `challengeMul`
scale each tier independently; `helpfulExclude` drops kinds entirely
(PAINFUL excludes `slow`). Resulting share at score ≥400 (all kinds
eligible):

| Difficulty | Sticky | Helpful | Challenge | Normal |
| --- | --- | --- | --- | --- |
| Easy    (×1.5 / ×1.32 / ×1.0) | 15% | ~25% | 5% | ~55% |
| Medium  (×1.0 / ×1.0  / ×1.0) | 10% | 19%  | 5% | 66%  |
| Hard    (×0.6 / ×0.84 / ×1.0) |  6% | ~16% | 5% | ~73% |
| PAINFUL (×0.5 / ×0.53 / ×1.0) |  5% | ~10% | 5% | ~80% |

Tier-share targets currently exact-restore the pre-BIG/TINY normal
share — expected to drift as we iterate.

Swarm waves (35% of waves) drop single-hex sequences at 0.18 s cadence;
12% of swarm hexes spawn as red heals (≥3) — only normal + sticky.

### Wave system (endless mode)

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

## Challenge mode

Three layers: roster (hand-authored, locked behind a 3-of-5 unlock
gate), custom (player-authored, locally stored), community
(player-published, hosted in iCloud).

### Roster (`src/challenges.ts`)

Thirty challenges in six blocks of five (`B-I` ids like `1-3`). Each
challenge is a `ChallengeDef`: `name`, `difficulty (1..5)`, `block`,
`index`, optional `effects` (per-effect duration overrides + `dangerSize`),
and a `waves: string[]` list parsed by the wave DSL.

`ChallengeProgress` is persisted at `localStorage["hexrain.challenges.v1"]`:

```
best:           Record<id, score>     // best score per challenge
bestPct:        Record<id, percent>   // best % completion (0-100)
stars:          Record<id, 0..3>      // best star count earned
completed:      string[]              // ids ever 100%-completed
unlockedBlocks: number[]              // [1] grows as 3-of-5 gates trip
purchasedUnlock: boolean              // iOS IAP flag (see below)
```

Star thresholds are derived per-challenge by `computeStarThresholds`
which walks the wave list, projects pickup yield, and spreads
1/2/3 across that range. `awardStars(score, thresholds)` runs at
completion.

Challenge blocks unlock organically (3 of 5 in block N → block N+1 unlocks)
or via the iOS in-app purchase **`com.hexrain.app.unlockall`**
("Unlock All Challenges"). The IAP is wired through `src/storeKit.ts` ↔
`StoreKitPlugin.swift`. The `purchasedUnlock` flag also unlocks PAINFUL
difficulty and the Challenge Editor. For local IAP testing add
`ios/App/App/Configuration.storekit` to the Xcode scheme (Run → StoreKit
Configuration). PAINFUL also unlocks organically by scoring
`HARDCORE_UNLOCK_SCORE = 1000` on Hard.

### Wave DSL (`src/waveDsl.ts`)

A wave is a single comma-separated line:

```
size=2-3, rate=0.7, speed=1.2, count=10, pct=normal:75,coin:25
```

Tokens:
- `size=` single value or `min-max` polyhex size range
- `rate=` seconds between spawns (probabilistic path)
- `slotRate=` seconds between slot tokens (scripted path)
- `speed=` base fall multiplier
- `count=` cap on probabilistic spawns; `count=0` disables that path
- `dur=` wave time-cap (seconds)
- `walls=none|pinch|zigzag|narrow` — wall variant + amplitude/period
- `safeCol=none|<n>` — locked safe column, or `none` to allow anywhere
- `origin=top|left|right` — spawn edge
- `dir=` / `dirRandom=1` — initial tilt
- `pct=kind:weight,kind:weight,…` — probabilistic kind mix
- Slot tokens (`<size><col><angleIdx>` like `137`, optionally prefixed
  with a kind letter like `S137` for sticky, `C230` for coin) — fire in
  sequence at `slotRate`. `000` is a skip.

`validateChallenge` rejects waves that would do nothing
(no count, no slots, no `dur+rate`).

### Custom Challenge Editor (`src/customChallenges.ts` + editor methods in `game.ts`)

Player-authored challenges live in `localStorage["hexrain.customChallenges.v1"]`.
Each `CustomChallenge` has its own seed (so replays are deterministic),
editable star thresholds, and the same wave list as the roster — fed
through the same `startChallenge()` pipeline as a synthetic
`ChallengeDef` via `toChallengeDef`.

Constants: `MAX_WAVES_PER_CUSTOM = 100`, `MAX_CUSTOM_NAME_LEN = 36`.
IDs use a `custom:` prefix (UUID) so they never collide with the
roster's `B-I` ids.

States: `editorHome` (list), `editorEdit` (single-challenge wave list).

**editorHome** lists every custom challenge as an action row with
PLAY / EDIT / PUBLISH / UPDATE / UNPUBLISH buttons. Below the player's
own list, a **Remix Existing** section lists every unlocked roster
challenge AND every installed community challenge as REMIX rows that
clone into a fresh editable copy (independent of the source — no
auto-update link). Rows support **swipe-left to delete** (96 px reveal,
red action button, confirmation dialog before destruction). Pointer
events cover both touch and mouse.

**editorEdit** shows the wave list with reorder/delete, a wave-add
button (preset picker → composes a wave-DSL line), a Custom Wave editor
(slot-grid for visual scripted patterns), a SETTINGS dialog for
difficulty + per-effect durations + `dangerSize` + manual/auto star
thresholds. Wave preview canvas renders a small graphical projection
of the current wave so the author can see what they're authoring before
playing it.

The editor is gated behind `purchasedUnlock || debugEnabled` plus
the `VITE_EDITOR_UNLOCKED` env flag (default `"1"` in `.env.example`)
which currently auto-unlocks the editor on iOS while the IAP flow
stabilises in TestFlight. Set it to `"0"` for a ship build that
re-locks the editor behind the IAP.

### Community challenges (CloudKit)

iOS-only. Players publish their custom challenges to a shared CloudKit
container so other players can browse, install, play (with their own
leaderboard entries), upvote, and report inappropriate content.

**Container:** `iCloud.com.hexrain.app` (the default container for the
bundle id). The schema lives in source control at
[`cloudkit/schema.ckdb`](cloudkit/schema.ckdb); see
[`cloudkit/README.md`](cloudkit/README.md) for the `cktool` workflow.

**Record types:**
- `Progress` (private) — single record per user, JSON blob mirroring
  `hexrain.challenges.v1`. Last-write-wins by `modifiedAt`.
- `CustomChallenge` (private) — one per local custom, mirrors the
  full editor record.
- `PublishedChallenge` (public) — author's published copy. Adds
  `authorId`, `authorName` (from Game Center display name at publish),
  `version`, `status` (`approved`|`pending`|`hidden`),
  `installCount`, `playCount`, `upvoteCount`, `reportCount`.
- `Score` (public) — one row per (player, challenge); stores best
  `score`, `pct`, and per-player `attempts` count. Upserted on every
  run end.
- `Upvote` (public) — one row per (player, challenge). Existence = liked.
- `Report` (public) — one row per (reporter, challenge). Consumed by
  `scripts/moderator.mjs`.

**TS layers:**
- `cloudKit.ts` — Capacitor bridge mirroring `storeKit.ts` shape.
  Generic `fetchRecord` / `upsertRecord` / `queryRecords` /
  `deleteRecord` / `subscribePublished` / `onPublishedUpdated`. All
  methods are no-ops on web; iOS errors are caught and turned into
  sentinel returns (no exceptions leak to the game loop).
- `cloudSync.ts` — high-level surface used by `game.ts`.
  - **Personal sync.** `syncProgressUp()` (debounced 3 s) is fired from
    `challenges.ts:save()` and `customChallenges.ts:saveStore()` so any
    write to the local stores eventually ends up in the user's private
    DB. `pullProgressDown()` runs once on cold launch (from `main.ts`)
    and replaces local with cloud only when `cloud.modifiedAt` >
    last-synced timestamp.
  - **Publish.** `publishChallenge(custom, authorName)` runs the
    moderation check on the name, then upserts a `PublishedChallenge`
    keyed deterministically on `(authorId, sourceCustomId)` so re-publish
    bumps `version` rather than creating duplicates. `unpublishChallenge`
    deletes the public record (subscribers keep their installed copy).
  - **Browse.** `queryCommunity({ sort })` returns the public corpus
    filtered to `status == "approved"`, sorted by `publishedAt` (NEW),
    `upvoteCount` (TOP), or `installCount` (ACTIVE). The `installed`
    filter renders the player's installed list locally (with a parallel
    fetch to refresh live counts) and works offline.
  - **Install.** `installCommunity(p)` writes a local `CustomChallenge`
    tagged with `installedFrom: recordName` and `installedVersion: N`.
    Bumps `installCount` best-effort.
  - **Live updates.** `subscribeToInstalledUpdates()` registers a
    CKQuerySubscription on the player's installed record names. On
    publish-side edits, `applyInstalledUpdate` patches the local copy
    in place — preserving local `best` / `bestPct` / `starsEarned`
    (silent auto-update with stat preservation, the model the user
    chose at planning time).
  - **Leaderboard.** `submitCommunityScore` upserts the per-player
    `Score` row (writes a new high score only when score > prev, but
    always bumps `attempts` and parent `playCount`). `topScores`
    returns the top 20 sorted by score desc.
  - **Upvote.** `upvote` / `removeUpvote` write/delete the per-player
    `Upvote` row and bump the denormalised `upvoteCount`. `hasUpvoted`
    drives the heart icon's filled state.
  - **Report.** `reportChallenge(rn, reason, note?)` writes a `Report`
    row and bumps `reportCount`.

**UI (game.ts):**
- Challenge select gets a **Community Challenges** collapsible
  alongside Official + My Challenges. Top of the body has four sort
  chips (`NEW / TOP / ACTIVE / INSTALLED`) — single row, equal-width.
  Each card uses the same `.challenge-card` chrome as Official + My
  Challenges (purple-tinted border) and shows `COMMUNITY` pill, name,
  `by AUTHOR`, difficulty hexes + wave count, `⬇ ▶ ♥` stats,
  `INSTALLED` pill when applicable, and an action stack of
  PLAY/INSTALL → REMIX → `♡ 🏆 ⚑` icon row.
- Editor Home's PUBLISH button is enabled whenever the CloudKit bridge
  is available (iOS) — UPDATE when already published, plus a sibling
  UNPUBLISH button. Published rows wear a green `PUBLISHED vN` badge.
- **Leaderboard sheet** lists top 20 with `rank · player · N PLAYS · score`.
- **Report dialog** is a radio (inappropriate name / offensive content /
  unplayable / other) + 240-char optional note + SUBMIT.
- Score submission for community runs fires from `completeChallenge` +
  `endChallengeRun` whenever the played challenge has `installedFrom`.

**Moderation:**
- `src/moderation.ts` is a small client-side speed bump: bad-words
  substring match (with leetspeak normalisation), length and
  non-printable character checks. Updated word list is in source.
- `scripts/moderator.mjs` is a Node CLI talking to CloudKit Web
  Services REST API. Subcommands: `list-reports [--since 7d]`,
  `hide <recordName>`, `unhide <recordName>`, `recount-upvotes
  <recordName>`, `recount-plays <recordName>`. Setup + workflow
  documented in [`MODERATION.md`](MODERATION.md). Server-to-server
  token lives at `~/.config/hexrain/moderator-token.json` (gitignored).
- Hidden records vanish from public queries (filter on
  `status == "approved"`); they're not deleted so they can be unhidden
  if a report turns out to be a false positive.

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
- **Aspect lock** — the play area locks to a portrait aspect ratio so
  ultrawide / very tall windows don't deform gameplay.

### HUD overlays

- Score / Best in the header. On iOS, tapping BEST opens the GameKit
  leaderboard sheet (pauses if a run is in progress).
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

## Game Center (iOS)

Wired via `src/gameCenter.ts` ↔ `GameCenterPlugin.swift`. Authenticates
on cold launch (no-op on web). Exposes:

- Three difficulty leaderboards (`easy`, `medium`, `hard`, `hardcore`).
- A 30-achievement set (score-club, fast-multiplier, bonus payout,
  trifecta, survivor, challenge-block-completion).
- Display name (used as `authorName` when publishing community
  challenges) via `getGameCenterDisplayName()`.
- Native sheet presenters for leaderboard + achievements (tap BEST
  on the HUD or any achievement badge on the menu).

Achievements are mirrored to localStorage so the menu's polyhex badge
strip survives reinstalls; on auth `syncAchievementsFromGameCenter`
replaces the local set with the canonical Game Center one.

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
HARDCORE_UNLOCK_SCORE                           PAINFUL difficulty unlock
ROTATE_SLIDE_SENS                               touch rotation feel
VITE_EDITOR_UNLOCKED (env)                      editor temp-unlock toggle
```
