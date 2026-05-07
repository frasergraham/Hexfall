// Encounter-level resolver: for each spawned cluster, decide whether
// the simulated player gets hit (blue), catches it (helpful), or lets
// it pass. Effect timers, score, and lose-combo all live here.
//
// This is a model, not physics. The reachability check (reactionGap *
// lateralColsPerSec >= colDist) is a stand-in for finger physics. P(hit)
// and P(catch) are calibration knobs. Trust relative deltas between
// configs more than absolute scores.

import type { Difficulty } from "../types";
import type { Random } from "../rng";
import {
  type DifficultyConfig,
  BIG_DURATION,
  BIG_MULTIPLIER_BASE,
  BIG_MULTIPLIER_STEP,
  BIG_SIZE_BASE,
  BIG_SIZE_STEP,
  COIN_SCORE_BONUS,
  DRONE_DURATION,
  FAST_EFFECT_DURATION,
  FAST_MULTIPLIER_BASE,
  FAST_MULTIPLIER_STEP,
  LOSE_COMBO,
  SHIELD_DURATION,
  SLOW_EFFECT_DURATION,
  STICK_INVULN_MS,
  TINY_DURATION,
} from "../spawnKind";
import type { SimState, SkillProfile, SpawnEvent } from "./types";

export function initSimState(
  cfg: DifficultyConfig,
  difficulty: Difficulty,
  skill: SkillProfile,
  rng: Random,
): SimState {
  return {
    cfg,
    difficulty,
    skill,
    rng,
    score: 0,
    size: 1,
    column: 0,
    loseCombo: 0,
    invulnUntil: 0,
    slowUntil: 0,
    fastUntil: 0,
    fastMul: 1,
    fastStacks: 0,
    fastPool: 0,
    shieldUntil: 0,
    shieldHp: 0,
    droneUntil: 0,
    droneHp: 0,
    tinyUntil: 0,
    bigUntil: 0,
    bigSize: 1,
    bigMul: 1,
    bigStacks: 0,
    tNow: 0,
    bluesPassed: 0,
    helpfulCaught: 0,
    fastPayouts: 0,
    death: null,
  };
}

// Pay out the fast bonus pool, end the fast effect, reset multiplier.
function payOutFast(state: SimState): void {
  if (state.fastPool > 0) {
    state.score += Math.round(state.fastPool);
    state.fastPayouts += 1;
  }
  state.fastPool = 0;
  state.fastUntil = 0;
  state.fastMul = 1;
  state.fastStacks = 0;
}

// Forfeit the fast pool (blue hit during fast). Same as payOutFast but
// the points evaporate.
function forfeitFast(state: SimState): void {
  state.fastPool = 0;
  state.fastUntil = 0;
  state.fastMul = 1;
  state.fastStacks = 0;
}

// Advance state.tNow to the given time, expiring any timers that lapsed
// in between. Fast timer expiry triggers pool payout.
export function advanceTo(state: SimState, t: number): void {
  if (t <= state.tNow) {
    state.tNow = Math.max(state.tNow, t);
    return;
  }
  if (state.fastUntil > 0 && state.fastUntil <= t) {
    payOutFast(state);
  }
  if (state.slowUntil <= t) state.slowUntil = 0;
  if (state.shieldUntil <= t) {
    state.shieldUntil = 0;
    state.shieldHp = 0;
  }
  if (state.droneUntil <= t) {
    state.droneUntil = 0;
    state.droneHp = 0;
  }
  if (state.tinyUntil <= t) state.tinyUntil = 0;
  if (state.bigUntil <= t) {
    state.bigUntil = 0;
    state.bigStacks = 0;
    state.bigSize = 1;
    state.bigMul = 1;
  }
  state.tNow = t;
}

function passMul(state: SimState): number {
  return state.bigUntil > state.tNow ? state.bigMul : 1;
}

// Bank a "+1 per pass" credit. During fast, additionally accumulate the
// (mul - 1) component into the bonus pool. Coins call this with passes=5.
function bankPass(state: SimState, passes: number): void {
  state.bluesPassed += 1;
  const pm = passMul(state);
  state.score += passes * pm;
  if (state.fastUntil > state.tNow) {
    state.fastPool += passes * (state.fastMul - 1) * pm;
  }
}

function applyHelpful(state: SimState, event: SpawnEvent): void {
  const cfg = state.cfg;
  const t = state.tNow;
  const dur = (override?: number): number =>
    cfg.effectDurationMul * (override ?? 1);

  switch (event.kind) {
    case "coin": {
      const pm = passMul(state);
      state.score += COIN_SCORE_BONUS * pm;
      if (state.fastUntil > t) {
        state.fastPool += COIN_SCORE_BONUS * (state.fastMul - 1) * pm;
      }
      break;
    }
    case "slow": {
      // Slow during fast cleanly ends fast and pays out the pool.
      if (state.fastUntil > t) payOutFast(state);
      state.slowUntil = t + SLOW_EFFECT_DURATION * dur(cfg.slowDurationMul);
      break;
    }
    case "fast": {
      state.fastStacks += 1;
      state.fastMul = FAST_MULTIPLIER_BASE + (state.fastStacks - 1) * FAST_MULTIPLIER_STEP;
      state.fastUntil = t + FAST_EFFECT_DURATION * dur(cfg.fastDurationMul);
      break;
    }
    case "shield": {
      state.shieldUntil = t + SHIELD_DURATION * dur(cfg.shieldDurationMul);
      state.shieldHp = SHIELD_DURATION; // ~1 sec absorbed per blue hit
      break;
    }
    case "drone": {
      state.droneUntil = t + DRONE_DURATION * dur(cfg.droneDurationMul);
      // -1s per intercept; 10s lifetime → up to ~10 blue interceptions.
      state.droneHp = DRONE_DURATION;
      break;
    }
    case "tiny": {
      state.tinyUntil = t + TINY_DURATION * dur(cfg.tinyDurationMul);
      break;
    }
    case "big": {
      state.bigStacks += 1;
      state.bigSize = BIG_SIZE_BASE + (state.bigStacks - 1) * BIG_SIZE_STEP;
      state.bigMul = BIG_MULTIPLIER_BASE + (state.bigStacks - 1) * BIG_MULTIPLIER_STEP;
      state.bigUntil = t + BIG_DURATION * dur(cfg.bigDurationMul);
      break;
    }
    case "sticky": {
      const remove = Math.max(1, Math.min(event.size - 1, state.size - 1));
      state.size = Math.max(1, state.size - remove);
      state.loseCombo = 0;
      break;
    }
    default:
      break;
  }
}

// Resolve a single spawned cluster against current state. Mutates state.
// Returns true if the run ended (death set).
export function resolveEncounter(state: SimState, event: SpawnEvent): boolean {
  advanceTo(state, event.t);
  if (state.death !== null) return true;

  const skill = state.skill;
  const tBudget = Math.max(0, event.reactionWindow - skill.reactionMs / 1000);
  const colDist = Math.abs(event.column - state.column);
  const reachable = tBudget * skill.lateralColsPerSec >= colDist;

  const fastActive = state.fastUntil > state.tNow;
  const shieldActive = state.shieldUntil > state.tNow && state.shieldHp > 0;
  const droneActive = state.droneUntil > state.tNow && state.droneHp > 0;
  const tinyActive = state.tinyUntil > state.tNow;
  const inDanger = state.size >= state.cfg.dangerSize;
  const playerSizeMul = state.bigUntil > state.tNow ? state.bigSize : tinyActive ? 0.5 : 1;

  if (event.kind === "normal") {
    return resolveBlue(state, event, {
      reachable,
      colDist,
      fastActive,
      shieldActive,
      droneActive,
      inDanger,
      playerSizeMul,
    });
  }
  return resolveHelpful(state, event, { reachable, fastActive, inDanger });
}

interface BlueCtx {
  reachable: boolean;
  colDist: number;
  fastActive: boolean;
  shieldActive: boolean;
  droneActive: boolean;
  inDanger: boolean;
  playerSizeMul: number;
}

function resolveBlue(
  state: SimState,
  event: SpawnEvent,
  ctx: BlueCtx,
): boolean {
  // Crude collision footprint: half-widths added together. If the
  // cluster would land outside that footprint, it's not on a course
  // that needs dodging in the first place.
  const playerHalf = Math.sqrt(state.size) * ctx.playerSizeMul * 0.5;
  const clusterHalf = Math.sqrt(event.size) * 0.5;
  const onCourse = ctx.colDist <= playerHalf + clusterHalf + 0.5;

  if (!onCourse) {
    bankPass(state, 1);
    return false;
  }

  if (ctx.droneActive) {
    state.droneHp -= 1;
    bankPass(state, 1);
    return false;
  }

  if (ctx.shieldActive) {
    state.shieldHp -= 1;
    bankPass(state, 1);
    return false;
  }

  if (state.invulnUntil > state.tNow) {
    bankPass(state, 1);
    return false;
  }

  let pHit: number;
  if (!ctx.reachable) {
    pHit = 0.92; // forced hit — too close, can't cover the distance
  } else {
    pHit = 1 - state.skill.accuracy;
    if (ctx.fastActive) pHit *= 0.5; // extra care to preserve pool
    if (ctx.inDanger) pHit *= 1.3;   // pressure penalty in danger band
  }

  if (state.rng() < pHit) {
    state.size += event.size;
    state.invulnUntil = state.tNow + STICK_INVULN_MS / 1000;
    if (ctx.fastActive) forfeitFast(state);
    if (state.size >= state.cfg.dangerSize) {
      state.loseCombo += 1;
      if (state.loseCombo >= LOSE_COMBO) {
        state.death = "combo";
        return true;
      }
    } else {
      // Below danger size, hits don't combo but do count as failure
      state.loseCombo = 0;
    }
    return false;
  }

  // Successful dodge — bank +1 and dodge to a clear column nearby.
  bankPass(state, 1);
  state.loseCombo = Math.max(0, state.loseCombo - 1);
  // Move toward a column that doesn't overlap the cluster.
  const dodgeTarget = event.column < 0 ? event.column + 2 : event.column - 2;
  state.column = clampCol(dodgeTarget);
  return false;
}

interface HelpCtx {
  reachable: boolean;
  fastActive: boolean;
  inDanger: boolean;
}

function resolveHelpful(
  state: SimState,
  event: SpawnEvent,
  ctx: HelpCtx,
): boolean {
  // Priority: shield is gold when in danger; sticky valuable when large;
  // slow valuable while fast (pool payout). Coin/tiny/big/drone neutral.
  let priorityMul = 1;
  if (event.kind === "shield" && ctx.inDanger) priorityMul = 1.6;
  else if (event.kind === "sticky" && state.size >= 5) priorityMul = 1.5;
  else if (event.kind === "slow" && ctx.fastActive) priorityMul = 1.3;

  let pCatch = ctx.reachable ? state.skill.accuracy * state.skill.greed * priorityMul : 0;
  if (pCatch > 1) pCatch = 1;

  if (state.rng() < pCatch) {
    applyHelpful(state, event);
    state.helpfulCaught += 1;
    state.column = clampCol(event.column);
  } else {
    bankPass(state, 1);
  }
  return false;
}

const HALF_COLS = 4;

function clampCol(col: number): number {
  return Math.max(-HALF_COLS, Math.min(HALF_COLS, col));
}

// Pay out any pending fast pool (called at run end so the pool isn't
// lost to truncation).
export function finalizeRun(state: SimState): void {
  if (state.fastUntil > 0 && state.fastPool > 0) {
    payOutFast(state);
  }
}
