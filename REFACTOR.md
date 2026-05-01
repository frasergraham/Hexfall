# HexRain Refactor Plan

## Prime directive

**Do not change the game.** No new features, no balance tweaks, no behaviour
changes, no rendering changes. Every phase preserves the player-visible game
exactly as it ships today. The output is the same `docs/` bundle byte-for-byte
where possible, behaviourally identical everywhere else.

If a refactor would alter gameplay, **stop and revert** — the test suite exists
to catch this; the seeded determinism tests in particular are the canary.

---

## Why we're doing this

`game.ts` is **9,422 LOC**, the `Game` class has **~95 fields and ~155 methods**,
and the largest single method (`render()`, lines 8772–9422) is **651 LOC**.
There are zero tests. There are also two real bugs hidden in the duplication:

1. Two `mulberry32` implementations (`rng.ts:13` and `hex.ts:152`) on different
   import paths. The CLAUDE.md determinism guarantee is at risk.
2. `cloudSync.ts:writeLocalProgressFromCloud` writes directly to
   `localStorage["hexrain.challenges.v1"]` — the key `challenges.ts:save` owns.
   Two writers, no coordinator, no schema lock.

The goal is to make the codebase safely changeable without altering what's on
screen. Everything below is structured so each phase ends in a green build and
green tests, and any phase can be paused or reverted in isolation.

---

## Ground rules

These hold for every phase.

- **Behaviour-preserving.** No phase introduces, removes, or alters gameplay,
  visuals, audio, persistence shape, or network calls.
- **Green build, green tests, every PR.** `npm run build` must pass. From
  Phase 0 onwards, `npm test` must pass. CI enforces both.
- **One phase per branch, one concern per PR.** Phases are sequenced; PRs
  inside a phase can be parallel where independent.
- **No new features in this branch.** If a feature request lands, it gets
  rebased on top after the refactor merges.
- **No drive-by reformatting.** Diffs stay focused; reviewers can spot real
  changes.
- **All persisted data shapes stay byte-compatible.** localStorage keys,
  CloudKit record fields, serialized JSON shapes are frozen. If a key needs
  to move, write a migration test first.
- **Bundle-size budget.** `npm run build` output size must not grow by more
  than 5% from the pre-refactor baseline. Capture the baseline in Phase 0.

---

## Verification: how we know nothing broke

Every phase exits behind these gates:

| Gate | Tool | What it proves |
|---|---|---|
| TypeScript compiles | `tsc` (already in `npm run build`) | No type regressions |
| Unit tests pass | `vitest run` | Pure logic unchanged |
| Determinism pinned | `tests/determinism.test.ts` | Same seed → same RNG sequence → same wave sequence |
| DOM smoke pass | `vitest` (jsdom) | Each screen still renders & each `data-action` still routes |
| Integration smoke | `tests/integration/run.test.ts` | 200-tick golden-fixture run produces the same score & state-transition trace |
| Bundle size | `vite build` output report | Within 5% of baseline |
| Manual smoke | One human play-through on desktop + iOS simulator | Catches anything tests miss |

The integration smoke test is the load-bearing one. It boots `Game` with a
fixed seed, drives `update(dt)` for 200 ticks under a Matter.js fake, and
asserts the final score and the ordered list of state transitions matches a
golden fixture captured at Phase 0. **If that fixture changes, the refactor
broke something.**

---

## Phase 0 — Baseline & test harness

**Duration estimate:** 2–3 days.
**Risk:** none (no source changes outside `tests/`, `vitest.config.ts`, CI).

Establish the safety net before any code moves. Everything later depends on
this phase landing first.

### Work

1. Capture pre-refactor baselines:
   - `npm run build` → record `docs/` bundle size in `REFACTOR.md` appendix.
   - One manual play-through on web + iOS simulator → record any visual
     reference frames (screenshots) in `tests/golden/` for human review.
   - Run a 200-tick scripted session with a fixed seed; capture final score,
     `state` transitions, spawn count by kind, and floater fire order to
     `tests/golden/integration-run.json`. This is **the** behaviour anchor.
2. Add tooling:
   - `vitest`, `@vitest/coverage-v8`, `jsdom` to `devDependencies`.
   - `vitest.config.ts` with `environment: "jsdom"` and
     `setupFiles: ["./tests/setup.ts"]`.
   - `tests/setup.ts` polyfills: deterministic `requestAnimationFrame`, no-op
     `ResizeObserver`, no-op `matchMedia`, stub
     `HTMLCanvasElement.prototype.getContext` returning a no-op 2D context,
     a fresh `localStorage` per test.
3. Add CI:
   - `.github/workflows/test.yml`: `npm ci`, `npm run build`, `npm test`.
   - Coverage report uploaded as artifact (no gate yet — ratchet later).
4. Add the **pinned determinism test** as the very first test:
   - `tests/determinism.test.ts` calls both `mulberry32` implementations
     (the one in `rng.ts` and the one in `hex.ts`) with the same seed,
     compares 1024-iteration sequences against a hard-coded array.
   - This locks in the **current** behaviour of both implementations. If
     they differ today, the test records that fact rather than asserting
     equality — the goal is to detect future drift, not to assert a
     pre-existing fix.
5. First batch of unit tests (purely additive, no source changes):
   - `tests/rng.test.ts`, `tests/hex.test.ts`,
     `tests/waveDsl.test.ts`, `tests/moderation.test.ts`,
     `tests/wavePresets.test.ts`.

### Exit criteria

- [ ] `npm test` runs green in CI on a fresh clone.
- [ ] Pre-refactor bundle size recorded in this file.
- [ ] `tests/golden/integration-run.json` committed.
- [ ] `tests/determinism.test.ts` committed and green.
- [ ] At least 30 unit tests committed and green covering `rng`, `hex`,
      `waveDsl`, `moderation`, `wavePresets`.
- [ ] No file in `src/` modified.

### Manual verification

Play the game on desktop and iOS simulator. Confirm nothing has changed
(it can't have — but verify the muscle memory anyway, this is the last
chance to flag pre-existing issues that aren't part of the refactor scope).

---

## Phase 1 — Pure-logic extraction

**Duration estimate:** 1 week.
**Risk:** low (mechanical code moves, behaviour identical, tests as net).

Extract side-effect-free logic from `game.ts` into modules that can be
imported and tested in isolation. **No call-site behaviour changes** — every
moved function keeps the same signature and is re-imported back into
`game.ts` at its old location.

### Work

PRs in this phase may land in parallel.

#### PR 1.1 — Unify `mulberry32` and the FNV-1a hash

- Delete `mulberry32` and `hashString` from `hex.ts`.
- Re-export from `rng.ts` if needed (`hashSeed` already exists there;
  check for naming consistency).
- Update `hex.ts` consumers (and any direct importers) to import from
  `rng.ts`.
- The determinism test from Phase 0 must still pass. **If the two
  implementations produced different sequences before this PR, you must
  decide which one is canonical, then update the test fixture in the
  same PR with a written justification in the PR description.**

#### PR 1.2 — `src/storage.ts` typed wrapper

- Single `<T>(key, fallback, codec?)` helper that wraps `localStorage`
  with try/catch quota handling and JSON serialisation.
- Migrate `audio.ts:loadPref/savePref`, `game.ts:loadSeenHints/saveSeenHints`,
  `game.ts:loadCollapsed/saveCollapsed`, `challenges.ts:save/loadChallengeProgress`,
  `customChallenges.ts:loadCustomChallenges/saveStore`,
  `cloudSync.ts:writeLocalProgressFromCloud` to use it.
- Centralise all `hexrain.*` storage keys into `src/storageKeys.ts` as a
  typed const map.
- Migration test: write a value with the old API, read it with the new
  API, assert equality.

#### PR 1.3 — Unify `ClusterKind` palettes

- Merge `cluster.ts:blobPalette`, `cluster.ts:hintPalette`, and
  `debris.ts:debrisPalette` into `src/palettes.ts`.
- Re-export the original three accessor names from `palettes.ts` so call
  sites are unchanged.
- Snapshot test: every `ClusterKind` resolves all three palette shapes to
  the **same colour values they had before** (golden hex strings).

#### PR 1.4 — Extract pure scoring logic

- New `src/scoring.ts`: `awardFastBonus`, `loseFastBonus`, `awardBigBonus`,
  `loseBigBonus`, milestone detection. Pure functions taking state-in,
  returning state-out. No `this.*` access, no DOM, no audio, no floater
  spawning side-effects (those stay in `Game`, called from the same call
  sites).
- `Game` methods become thin wrappers: pure compute via `scoring.ts`,
  then run the side effects locally.
- Tests: ~15 unit tests covering pool accumulation, payout math,
  milestone boundaries, edge cases at score 0, 200, 600, 1000, 1300.

#### PR 1.5 — Extract pure spawn helpers

- New `src/spawn.ts`: `pickSpawnColumn`, `shapeColumnFootprint`,
  `chooseWallForEndlessWave`, `currentSpawnInterval`, `computeFallSpeed`,
  `lateGameSpeedMul`. Take config + RNG + score, return values.
- Tests: ~10 unit tests including late-game ramp at score 500/600/1300.

#### PR 1.6 — Move `composeWaveLine` next to `parseWaveLine`

- Move `game.ts:composeWaveLine` (line 9012) into `waveDsl.ts`.
- Add round-trip property test: `parse(compose(parse(line))) === parse(line)`
  for a fixture set of 30 representative lines drawn from `challenges.ts`.

#### PR 1.7 — Promote `clamp*` helpers

- Move `clampDifficulty` and `clampStars` from `customChallenges.ts:180,184`
  and `cloudSync.ts:726,730` into a new `src/validation.ts`.
- Both old sites import from there.

### Exit criteria

- [ ] All 7 PRs merged.
- [ ] `mulberry32` and FNV-1a hash exist in exactly one place.
- [ ] All `localStorage` reads/writes go through `src/storage.ts`.
- [ ] All `hexrain.*` keys defined in `src/storageKeys.ts`.
- [ ] No duplicated palette / clamp / hash / RNG functions remain.
- [ ] `composeWaveLine` lives in `waveDsl.ts`; round-trip test green.
- [ ] Phase 0 tests still pass.
- [ ] Integration smoke fixture **unchanged** (final score, state-transition
      trace, spawn order all identical to baseline).
- [ ] Bundle size within 5% of baseline.
- [ ] Test count: ~110 (Phase 0's 30 + ~80 from Phase 1 modules).

### Manual verification

Play through 5 challenges on web + iOS, confirm no perceptible change.
Verify the determinism test still passes byte-for-byte.

---

## Phase 2 — Screen extraction

**Duration estimate:** 1.5–2 weeks.
**Risk:** medium (DOM lifecycle changes; mitigated by per-screen DOM tests).

Carve overlay UI into screen modules. The 1164-LOC `Game` constructor's
178-`data-action` event router gets distributed across screen-owned
handlers. Listener leaks (17 unbalanced `addEventListener` calls on
`this.overlay`) are eliminated by construction.

The HTML produced by each screen must be **byte-identical** to what
`game.ts` produces today — or different only in inconsequential whitespace.
DOM tests assert this with snapshots.

### Work

PR 2.0 lands first (the controller), then per-screen PRs land in any order.

#### PR 2.0 — `OverlayController`

- New `src/ui/OverlayController.ts`: `mount(screen)`, `dispose()`,
  delegated event routing, listener cleanup on screen change.
- Empty screens: each existing `render*()` method moves behind a
  thin `screen` interface (`render(props): string`,
  `bind(root, deps): () => void`) but the **bodies stay in `Game`** for
  this PR. Logic move happens in subsequent PRs.

#### PR 2.1–2.13 — One screen per PR

Each PR moves one screen out of `game.ts` into `src/ui/screens/<name>.ts`
and adds DOM tests for it. Order is flexible; suggested grouping:

- 2.1 `menu`
- 2.2 `unlockShop`
- 2.3 `blocksGuide`
- 2.4 `challengeSelect` (incl. community body sub-render)
- 2.5 `challengeIntro`
- 2.6 `challengeComplete`
- 2.7 `editorHome` (incl. the swipe-to-delete component)
- 2.8 `editorEdit`
- 2.9 `waveDialog` (the 632-LOC monster — split into
      `WaveDialog` + `WaveDialogAdvanced` + `ClusterMix`)
- 2.10 `customWaveDialog`
- 2.11 `settingsDialog`
- 2.12 `leaderboardSheet`
- 2.13 `reportSheet`

Shared components (`src/ui/components/`):

- `dialogHeader.ts` — the `← Back / title / spacer` trio used in 3+ places.
- `challengeCard.ts` — single card template used by Official, My, Community,
  Remix.
- `swipeRow.ts` — already centralised; export it.
- `stepperButton.ts` — used by 6+ bumper sites.
- `presetChip.ts` — used by wave dialog.

Each screen PR:

1. Move the `render*()` template into the screen module verbatim.
2. Move its `data-action` handlers from the constructor's giant click
   router into the screen's `bind()` function.
3. Snapshot test the rendered HTML against the pre-move output for
   representative inputs.
4. DOM test each `data-action` still fires the correct callback.

### Exit criteria

- [ ] All 13 screens live in `src/ui/screens/`.
- [ ] `Game` constructor under 200 LOC (was 1164).
- [ ] Constructor's giant click router gone — each screen owns its own
      handlers.
- [ ] No `addEventListener` on `this.overlay` outside of
      `OverlayController`.
- [ ] DOM snapshot tests assert HTML output is unchanged from baseline.
- [ ] All Phase 0/1 tests still pass.
- [ ] Integration smoke fixture **unchanged**.
- [ ] Bundle size within 5% of baseline.
- [ ] Test count: ~160 (~50 added DOM tests).

### Manual verification

Click through every screen on desktop. Repeat on iOS simulator. Pay
particular attention to:

- Swipe-to-delete on editor rows.
- Wave dialog preset chips and the advanced toggle.
- Custom-wave cell picker positioning (`positionCustomCellPicker` viewport
  clamp).
- Achievement banner queue (load 3 milestones in quick succession in dev
  mode).
- Pause / resume countdown.

---

## Phase 3 — Collaborator split

**Duration estimate:** 1.5–2 weeks.
**Risk:** medium-high (this is where gameplay logic moves; integration
smoke is the load-bearing safety net).

With pure logic and UI extracted, split the residual `Game` class into
focused collaborators. Behaviour preservation is verified by the integration
smoke fixture and by per-collaborator functional tests using a Matter.js
fake.

### Work

PRs in this phase land **sequentially**, one collaborator at a time.
Parallel work risks merge conflicts in `Game`.

#### PR 3.1 — `Renderer` (highest leverage)

- Extract the 651-LOC `render()` and ~10 `draw*` helpers into
  `src/Renderer.ts`.
- `Renderer.draw(state, dt)` takes a read-only view of `Game` state and
  draws one frame. No mutation of game state.
- Internal split: `drawBackground / drawWorld / drawHud / drawOverlays`
  (each ~150 LOC).
- No visual changes. Snapshot test: render to an off-screen canvas at a
  pinned game state, compare pixel diff against a baseline image. Allow
  zero-pixel tolerance — this is canvas math, it's deterministic.

#### PR 3.2 — `EffectsManager`

- Owns `slow / fast / shield / drone / tiny / big` timers, durations,
  multiplier math.
- ~24 methods identified at `game.ts:5477–6133` and `8397–8445`.
- `Game` holds an `EffectsManager` instance and asks it questions
  instead of reading 8 timer fields directly.
- Functional tests: stack a fast pickup, then another, assert multiplier
  follows `FAST_MULTIPLIER_BASE + N * FAST_MULTIPLIER_STEP`.

#### PR 3.3 — `Spawner`

- Extracts `spawnCluster`, `spawnFirstClusterCentered`, `spawnDrone`,
  `spawnDebris`, `spawnStickInFlight`, `spawnFloater`.
- Takes `Engine`, RNG, and current game stats; returns spawned bodies for
  `Game` to track. No `localStorage` reads.
- Functional tests: seeded RNG produces deterministic spawn sequences.

#### PR 3.4 — `CollisionRouter`

- Extracts `onCollisionStart`, `handlePendingContacts`, and the 6
  `handle*Contact` methods (`game.ts:6320–7264`).
- Takes a `cluster: FallingCluster`, dispatches to the right handler,
  emits events the `Game` consumes.
- Functional tests: every contact kind (normal, sticky, shield, drone,
  tiny, big, coin, powerup) has a happy-path test against a Matter.js
  fake.

#### PR 3.5 — `WaveDirector` (endless mode)

- Extracts `advanceWavePhase`, `startWave`, `startCalm`, swarm/wave
  selection, late-game ramp.
- Functional tests: deterministic wave alternation under a seeded RNG;
  pinch-wave probability boundary at score 600.

#### PR 3.6 — `ChallengeRunner` (challenge mode)

- Extracts `beginChallengeWave`, `advanceChallenge`, `spawnFromSlot`,
  `spawnChallengeProbabilistic`, `completeChallenge`, `endChallengeRun`,
  `updateChallengeFinishing`, `clampChallengeFallVelocities`.
- Fed by an injected `ChallengeDef` and seeded RNG.
- Functional tests: every shipped challenge in `challenges.ts` runs to
  completion under a fixed seed and produces the same wave sequence as
  the baseline (golden fixture per challenge id).

#### PR 3.7 — Editor-dialog state union

- Collapse the ~18 `editorDialog*` and `editorCustomWave*` instance fields
  into a single `editorDialog: WaveDialogState | CustomWaveDialogState |
  SettingsDialogState | null` discriminated union.
- Pure refactor: no behaviour change, just tighter typing.

### Exit criteria

- [ ] `game.ts` under 1000 LOC.
- [ ] `Game` class under 50 fields, under 30 methods.
- [ ] `update()` is a 12–20 line dispatch into collaborators.
- [ ] Each collaborator has its own functional test file.
- [ ] All Phase 0/1/2 tests still pass.
- [ ] Integration smoke fixture **unchanged**.
- [ ] Per-challenge golden fixtures (one per shipped challenge) all pass.
- [ ] Bundle size within 5% of baseline.
- [ ] Test count: ~190.

### Manual verification

- Full play-through of every difficulty (easy / medium / hard / hardcore).
- Full play-through of at least one challenge from each block (1-1, 2-1,
  3-1, 4-1, 5-1, 6-1).
- Custom challenge: create, play, edit, publish (iOS simulator), unpublish.
- Community challenge: install, play, leaderboard, upvote, report.
- Pause / resume / quit-to-menu / restart from menu.
- Achievement banner trigger (force a milestone via debug mode).

---

## Phase 4 — Cleanup

**Duration estimate:** 3–4 days.
**Risk:** low.

Wrap-up that wasn't worth doing while the structural work was in flight.

### Work

#### PR 4.1 — Dev-only validation block

- Move the `if (import.meta.env?.DEV)` block at `challenges.ts:797`
  into a Vitest test (`tests/challenges-defs.test.ts`).
- Run it in CI on every PR. Remove the runtime block.

#### PR 4.2 — Remove `EDITOR_TEMP_UNLOCKED_ON_IOS`

- Replace the `game.ts:103` constant with a Vite `import.meta.env`
  feature flag (`VITE_EDITOR_UNLOCKED`). Default false in production.
- Document in `CLAUDE.md`.

#### PR 4.3 — `cloudSync` field-mapping consolidation

- The two near-identical record-to-domain converters at
  `cloudSync.ts:572–682` (`fieldsToCustomChallenge`, `recordToPublished`)
  share ~80 LOC.
- Extract a schema-driven mapper. Test round-trip: `domain → fields →
  domain` for both shapes.

#### PR 4.4 — `validateCustomChallenge` flatten

- The 8-level nested function at `customChallenges.ts:334` splits into
  `validateName`, `validateWaveCount`, `validateWaveLines`,
  `validateStarThresholds`. Pure refactor.
- Table-driven tests for every failure mode.

#### PR 4.5 — Coverage ratchet

- Set CI gate at the current coverage baseline (whatever it lands at —
  likely 60–70 % statement, 50–60 % branch). PRs cannot regress
  coverage.

### Exit criteria

- [ ] No runtime DEV-only blocks in `src/`.
- [ ] No `TEMP_*` flags in shipped code.
- [ ] CloudKit field marshalling lives in one place.
- [ ] `validateCustomChallenge` ≤ 3 levels deep.
- [ ] Coverage gate enforced in CI.
- [ ] Bundle size within 5% of baseline.

---

## Phase 5 — Type tightening (optional, do last)

**Duration estimate:** 3–5 days.
**Risk:** low.

Replace the stringly-typed `data-action="X"` system with a typed action
router so handler/dispatch pairs are linked at compile time. Nice to have,
not load-bearing. Skip if running short on time.

### Exit criteria

- [ ] Every `data-action` value is a typed enum member.
- [ ] `tsc` would catch a typo in `data-action="editro-publish"`.
- [ ] All Phase 0/1/2/3/4 tests still pass.

---

## What this plan does not do

Out of scope for this refactor; capture as separate issues if desired.

- New gameplay features.
- New cluster kinds, new challenges, new walls.
- Visual / audio redesign.
- Any change to the wave DSL grammar.
- Migrating to a UI framework (React, Lit, etc.) — the lightweight
  `OverlayController` pattern is sufficient.
- Replacing Matter.js.
- Migrating away from Capacitor / iOS native plugins.
- Server-side moderation.
- Multiplayer.

---

## Per-phase quick reference

| Phase | LOC delta in `game.ts` | New files | Test count target | Risk |
|---|---|---|---|---|
| 0 — Harness | 0 | `tests/`, `vitest.config.ts`, CI | 30 | None |
| 1 — Pure logic | ~−500 (helpers move out) | `storage.ts`, `storageKeys.ts`, `palettes.ts`, `scoring.ts`, `spawn.ts`, `validation.ts` | 110 | Low |
| 2 — Screens | ~−4500 (UI moves out) | `src/ui/**` (15+ files) | 160 | Medium |
| 3 — Collaborators | ~−3500 (logic moves out) | `Renderer.ts`, `EffectsManager.ts`, `Spawner.ts`, `CollisionRouter.ts`, `WaveDirector.ts`, `ChallengeRunner.ts` | 190 | Medium-high |
| 4 — Cleanup | small | none | 200+ | Low |
| 5 — Type tightening | small | one action-types file | 200+ | Low |

End state: `game.ts` under 1000 LOC, `Game` class is a coordinator, every
piece of pure logic and every screen is independently testable, and the
game on screen is **identical to the day this branch started**.

---

## Appendix — baselines

Captured 2026-05-01 on `refactor/game-decomposition`.

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` | 387.86 kB | 110.07 kB |
| `web-*.js` | 0.84 kB | 0.40 kB |
| `index-*.css` | 57.73 kB | 10.75 kB |

Headroom: 5% bundle-size budget per Phase ⇒ JS ≤ 407 kB, CSS ≤ 60.6 kB.

Test suite at end of Phase 0: **62 tests** (target: 30+). Determinism
fingerprints pinned via `toMatchInlineSnapshot` in
`tests/determinism.test.ts`; both `mulberry32` implementations agree
under every tested seed.
