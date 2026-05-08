// Balance constants and pure spawn-kind picker. Extracted from game.ts so
// the offline balance simulator (scripts/simulate.ts) can consume the
// same numbers and tier-dispatch logic the live game uses, without
// dragging Matter, Canvas, audio, or Game Center into a Node process.
//
// Keep this module DOM-free and engine-free. It owns the data; game.ts
// owns the rendering, physics, and state machine.

import type { ClusterKind, Difficulty } from "./types";
import type { Random } from "./rng";

// Difficulty knobs. Multipliers stack on top of the medium baseline:
// fall speed (initial cluster velocity), spawn interval (how often
// clusters arrive — bigger = slower), per-tier spawn weights, and
// timed-effect duration. `effectDurationMul` is the default for every
// timed effect; per-effect overrides (slow/fast/shield/drone) take
// precedence so hardcore can stretch fast while shrinking shields and
// drones independently.
//
// Spawn picker uses a two-tier model: a single uniform roll picks a
// tier (Sticky / Helpful / Challenge / Normal), then the kind is
// chosen uniformly among eligible kinds inside that tier.
//   Helpful   = coin, slow, tiny, shield, drone (defensive / reward)
//   Challenge = fast, big                       (risk → bank multiplier)
// `helpfulExclude` lets a difficulty drop a kind entirely (PAINFUL has
// no slow). Score gates inside a tier redistribute the tier weight
// among whichever kinds are currently eligible.
export interface DifficultyConfig {
  fallSpeedMul: number;
  spawnIntervalMul: number;
  stickyMul: number;
  helpfulMul: number;
  challengeMul: number;
  helpfulExclude?: readonly ClusterKind[];
  // Per-difficulty score gates for tiny/big. Override the global
  // *_MIN_SCORE defaults so easy can hold them back longer (gives the
  // player time to learn the basics) while medium/hard let them show
  // up alongside slow/fast.
  tinyMinScore?: number;
  bigMinScore?: number;
  effectDurationMul: number;
  slowDurationMul?: number;
  fastDurationMul?: number;
  shieldDurationMul?: number;
  droneDurationMul?: number;
  tinyDurationMul?: number;
  bigDurationMul?: number;
  // Score thresholds for wall variants. `narrowingScore` gates pinch
  // (the original "narrowing wave" hence the legacy name); zigzag and
  // narrow are the two later wall kinds. Hardcore shifts these way
  // earlier so the hostile geometry shows up almost immediately.
  narrowingScore: number;
  zigzagScore: number;
  narrowScore: number;
  // Player size at which the danger glow appears and blue hits become
  // lethal. Default 7; hardcore drops it to 3.
  dangerSize: number;
}

export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    fallSpeedMul: 0.8,
    spawnIntervalMul: 1.25,
    stickyMul: 1.5,
    helpfulMul: 1.32,
    challengeMul: 1.0,
    tinyMinScore: 300,
    bigMinScore: 300,
    effectDurationMul: 1.2,
    narrowingScore: 600,
    zigzagScore: 800,
    narrowScore: 1000,
    dangerSize: 7,
  },
  medium: {
    fallSpeedMul: 1.0,
    spawnIntervalMul: 1.0,
    stickyMul: 1.0,
    helpfulMul: 1.0,
    challengeMul: 1.0,
    tinyMinScore: 300,
    bigMinScore: 300,
    effectDurationMul: 1.0,
    narrowingScore: 600,
    zigzagScore: 800,
    narrowScore: 1000,
    dangerSize: 7,
  },
  hard: {
    fallSpeedMul: 1.35,
    spawnIntervalMul: 0.85,
    stickyMul: 0.6,
    helpfulMul: 0.84,
    challengeMul: 1.0,
    tinyMinScore: 0,
    bigMinScore: 0,
    effectDurationMul: 0.8,
    narrowingScore: 200,
    zigzagScore: 800,
    narrowScore: 1000,
    dangerSize: 7,
  },
  hardcore: {
    fallSpeedMul: 1.5,
    spawnIntervalMul: 0.75,
    stickyMul: 0.5,
    helpfulMul: 0.53,
    challengeMul: 1.0,
    // PAINFUL drops slow + tiny entirely. Slow softens the difficulty
    // (counter to the mode's intent) and tiny would let the player
    // out-shrink the dangerSize:3 ceiling.
    helpfulExclude: ["slow", "tiny"],
    effectDurationMul: 1.0,
    // Both challenge-tier bonuses (fast + big) run long on hardcore —
    // they're risk/reward levers and longer duration makes the bonus
    // pool more meaningful when you survive it.
    fastDurationMul: 2.0,
    bigDurationMul: 2.0,
    shieldDurationMul: 0.5,
    droneDurationMul: 0.5,
    narrowingScore: 100,
    zigzagScore: 200,
    narrowScore: 400,
    dangerSize: 3,
  },
};

// Endless mode initial cluster fall velocities (Matter px/ms units).
// MAX_FALL_SPEED is the cap that BASE_FALL_SPEED + score × SPEED_RAMP
// charges into. Reduced to 3.5 (from 5.5) once CCD substepping landed
// — the old cap relied on the discrete physics step "smoothing" deep
// penetrations, which it didn't, and late-game runs felt too fast
// regardless. With CCD on we don't need the speed for difficulty.
export const BASE_FALL_SPEED = 1.6;
export const SPEED_RAMP = 0.04; // px/ms per score
export const MAX_FALL_SPEED = 3.5;

// Challenge clusters maintain a constant fall velocity (gravity is
// re-cancelled each frame) so `speed=` in the wave DSL is the literal
// fall rate. CHALLENGE_BASE_FALL_SPEED is tuned so that `speed=1.0`
// feels close to gravity-driven endless mode (which lands near
// ~12 px/step after the first half-second).
export const CHALLENGE_BASE_FALL_SPEED = 12;
export const CHALLENGE_MAX_FALL_SPEED = 60;

// Lose rule: number of consecutive blue-cluster hits while in the
// danger band before the run ends. Brief invuln after gaining a hex
// prevents a single physics frame from racking up multiple combo
// counts off the same impact.
export const LOSE_COMBO = 2;
export const STICK_INVULN_MS = 180;

// Spawn picker tier weights at the medium baseline. A uniform roll
// picks a tier; per-kind weight inside the tier is uniform across
// whichever kinds are currently eligible (score-gated). Failed tier
// gates fall through to Normal. Tunable — exact-restore of pre-BIG/TINY
// normal share at score ≥400, but expected to drift as we iterate.
export const SPAWN_STICKY_TIER_WEIGHT = 0.10;
export const SPAWN_HELPFUL_TIER_WEIGHT = 0.19;
export const SPAWN_CHALLENGE_TIER_WEIGHT = 0.05;

export const STICKY_MIN_SCORE = 3;
export const COIN_SCORE_BONUS = 5;
export const POWERUP_MIN_SCORE = 5;
export const SHIELD_MIN_SCORE = 200;
export const SHIELD_DURATION = 10; // seconds
export const DRONE_MIN_SCORE = 400;
export const DRONE_DURATION = 10; // seconds
export const TINY_MIN_SCORE = 5;
export const TINY_DURATION = 5; // seconds
export const TINY_PLAYER_SCALE = 0.5; // player hex-size multiplier while tiny is active
export const TINY_REHIT_BONUS = 2; // points awarded if a second tiny is hit while still tiny
export const BIG_MIN_SCORE = 5;
export const BIG_DURATION = 5; // seconds
export const BIG_SIZE_BASE = 1.5; // first big pickup grows the player by 50%
export const BIG_SIZE_STEP = 0.15; // each subsequent big pickup adds 15% more
export const BIG_MULTIPLIER_BASE = 3; // first big pickup multiplies passes 3x
export const BIG_MULTIPLIER_STEP = 1; // each stack bumps the multiplier by 1

// Time-effect tuning.
export const SLOW_EFFECT_DURATION = 5;
export const FAST_EFFECT_DURATION = 5;
export const STICK_SLOW_BUFFER = 1; // brief slow-mo after gaining a hex
export const SLOW_TIMESCALE = 0.5;
export const FAST_TIMESCALE_BASE = 1.25; // first fast pickup
export const FAST_TIMESCALE_STEP = 0.1; // each subsequent stack adds this much speed
export const FAST_MULTIPLIER_BASE = 3; // first fast pickup multiplies passes 3x
export const FAST_MULTIPLIER_STEP = 1; // each stack bumps the multiplier by 1

// Wave variants.
export const SWARM_WAVE_CHANCE = 0.35; // chance any given wave is a single-hex swarm
export const SWARM_SPAWN_INTERVAL = 0.18; // very short interval during swarms
export const SWARM_STICKY_CHANCE = 0.12; // chance a swarm hex spawns as a heal instead of blue

// Score thresholds for advanced spawn mechanics.
export const ANGLED_SPAWNS_SCORE = 200;
export const SIDE_SPAWNS_SCORE = 400;

// --- Pure pick functions ---
//
// Two-tier roll: a single uniform draw picks a tier, then the kind is
// chosen uniformly across whichever kinds inside that tier currently
// pass their score gate. Failed tier gates fall through to Normal;
// failed sticky tier (score < STICKY_MIN_SCORE) also falls through.
//
// Both `pickHelpfulKind` and `pickChallengeKind` take an `rng` so
// callers can deterministically reproduce a sequence (the simulator
// passes a seeded mulberry32; the live game passes Math.random for
// zero behaviour change vs the in-Game implementation).

export function pickHelpfulKind(
  cfg: DifficultyConfig,
  score: number,
  rng: Random,
): ClusterKind | null {
  const exclude = cfg.helpfulExclude;
  const pool: ClusterKind[] = [];
  const allow = (k: ClusterKind, gate: boolean) => {
    if (gate && !(exclude && exclude.includes(k))) pool.push(k);
  };
  allow("coin", true);
  allow("slow", score >= POWERUP_MIN_SCORE);
  allow("tiny", score >= (cfg.tinyMinScore ?? TINY_MIN_SCORE));
  allow("shield", score >= SHIELD_MIN_SCORE);
  allow("drone", score >= DRONE_MIN_SCORE);
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

export function pickChallengeKind(
  cfg: DifficultyConfig,
  score: number,
  rng: Random,
): ClusterKind | null {
  const pool: ClusterKind[] = [];
  if (score >= POWERUP_MIN_SCORE) pool.push("fast");
  if (score >= (cfg.bigMinScore ?? BIG_MIN_SCORE)) pool.push("big");
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

// Full tier-dispatch. Returns the cluster kind for a single non-swarm
// spawn at the given score under the given difficulty, given an rng
// source. Swarm spawns bypass this and are decided by the caller.
export function pickKind(
  cfg: DifficultyConfig,
  score: number,
  rng: Random,
): ClusterKind {
  const stickyEnd = SPAWN_STICKY_TIER_WEIGHT * cfg.stickyMul;
  const helpfulEnd = stickyEnd + SPAWN_HELPFUL_TIER_WEIGHT * cfg.helpfulMul;
  const challengeEnd = helpfulEnd + SPAWN_CHALLENGE_TIER_WEIGHT * cfg.challengeMul;
  const r = rng();
  if (r < stickyEnd) {
    if (score >= STICKY_MIN_SCORE) return "sticky";
    return "normal";
  }
  if (r < helpfulEnd) {
    return pickHelpfulKind(cfg, score, rng) ?? "normal";
  }
  if (r < challengeEnd) {
    return pickChallengeKind(cfg, score, rng) ?? "normal";
  }
  return "normal";
}
