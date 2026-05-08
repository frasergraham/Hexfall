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
    targetCol: 0,
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

// Resolve a single cluster at impact time. The player has been moving
// toward state.targetCol since the last decision point — call
// advancePlayerPosition first to position them. The encounter then
// reflects whether they're actually in the cluster's footprint.
//
// The lookahead planner (chooseTarget) already decided whether to
// dodge or chase this cluster. resolveEncounter just applies the
// outcome with a small accuracy fudge for hand-tremor / panic.
export function resolveEncounter(state: SimState, event: SpawnEvent): boolean {
  advancePlayerPosition(state, event.t);
  advanceTo(state, event.t);
  if (state.death !== null) return true;

  const fastActive = state.fastUntil > state.tNow;
  const shieldActive = state.shieldUntil > state.tNow && state.shieldHp > 0;
  const droneActive = state.droneUntil > state.tNow && state.droneHp > 0;
  const tinyActive = state.tinyUntil > state.tNow;
  const inDanger = state.size >= state.cfg.dangerSize;
  const playerSizeMul = state.bigUntil > state.tNow ? state.bigSize : tinyActive ? 0.5 : 1;
  const onCourse = isOnCourse(state.column, event.column, state.size, event.size, playerSizeMul);

  if (event.kind === "normal") {
    return resolveBlue(state, event, { onCourse, fastActive, shieldActive, droneActive, inDanger });
  }
  return resolveHelpful(state, event, { onCourse, fastActive, inDanger });
}

interface BlueCtx {
  onCourse: boolean;
  fastActive: boolean;
  shieldActive: boolean;
  droneActive: boolean;
  inDanger: boolean;
}

function resolveBlue(state: SimState, event: SpawnEvent, ctx: BlueCtx): boolean {
  if (!ctx.onCourse) {
    bankPass(state, 1);
    return false;
  }

  // On course — defenses fire in priority order.
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

  // Player is in the cluster's footprint at impact. Skilled players
  // can still micro-adjust at the last moment.
  let pHit = 0.4 + 0.4 * (1 - state.skill.accuracy);
  if (ctx.fastActive) pHit *= 0.7;
  if (ctx.inDanger) {
    // In danger: skilled players become MORE careful (they know one
    // more hit ends it), novices panic and slip up.
    pHit *= state.skill.accuracy >= 0.85 ? 0.6 : 1.3;
  }
  pHit = Math.min(1, pHit);

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
      state.loseCombo = 0;
    }
    return false;
  }

  bankPass(state, 1);
  state.loseCombo = Math.max(0, state.loseCombo - 1);
  return false;
}

interface HelpCtx {
  onCourse: boolean;
  fastActive: boolean;
  inDanger: boolean;
}

function resolveHelpful(state: SimState, event: SpawnEvent, ctx: HelpCtx): boolean {
  if (ctx.onCourse) {
    // Player committed to chasing — small accuracy slip lets some pickups
    // through their hands, but mostly: catch.
    const pCatch = 0.8 + 0.2 * state.skill.accuracy;
    if (state.rng() < pCatch) {
      applyHelpful(state, event);
      state.helpfulCaught += 1;
      return false;
    }
  }
  bankPass(state, 1);
  return false;
}

const HALF_COLS = 4;

function clampCol(col: number): number {
  return Math.max(-HALF_COLS, Math.min(HALF_COLS, col));
}

// Crude collision footprint check: half-widths added together. Player
// cells are ~1 col each; cluster size N spreads across sqrt(N) cols.
// The +0.6 buffer counts near-misses as collisions — Matter's SAT can
// land a contact with even tangential clusters, so a real player needs
// to dodge with margin, not graze.
function isOnCourse(
  playerCol: number,
  clusterCol: number,
  playerSize: number,
  clusterSize: number,
  playerSizeMul: number,
): boolean {
  const playerHalf = Math.sqrt(playerSize) * playerSizeMul * 0.5;
  const clusterHalf = Math.sqrt(clusterSize) * 0.5;
  return Math.abs(playerCol - clusterCol) <= playerHalf + clusterHalf + 0.6;
}

// Move state.column toward state.targetCol by skill.lateralColsPerSec
// for (t - state.tNow) seconds, capped at distance remaining.
export function advancePlayerPosition(state: SimState, t: number): void {
  const dt = t - state.tNow;
  if (dt <= 0) return;
  const remaining = state.targetCol - state.column;
  const dir = Math.sign(remaining);
  const maxMove = state.skill.lateralColsPerSec * dt;
  const move = Math.min(Math.abs(remaining), maxMove);
  state.column = clampCol(state.column + dir * move);
}

// Lookahead horizon. Clusters typically have ~2.5s flight time, so a
// horizon below that means the player sees them mid-flight, not at
// spawn. Real-game telemetry showed top players grind Medium higher
// than Easy because they can read the queue from the moment a cluster
// appears — a 2.5s horizon captures that.
const LOOKAHEAD_HORIZON_SEC = 2.5;

export function chooseTarget(
  state: SimState,
  inFlight: ReadonlyArray<SpawnEvent>,
): void {
  const skill = state.skill;

  // Plan failure: even experts occasionally misread the queue. A failed
  // plan freezes the player at their current column for one event,
  // simulating a hesitation / brain-fart. Rate scales with skill,
  // run length (cognitive fatigue), and queue size (more clusters in
  // flight = more cognitive load).
  const fatigue = Math.max(0, (state.tNow - 60) / 60); // grows past 60s, unbounded
  const queueLoad = Math.max(0, inFlight.length - 2) * 0.02;
  const planFailureProb =
    (1 - skill.accuracy) * 0.4 + Math.min(0.4, fatigue * 0.04) + queueLoad;
  if (state.rng() < planFailureProb) {
    state.targetCol = state.column;
    return;
  }

  // Skill-scaled lookahead horizon. Spread is narrower now — even
  // novices read most of the queue, they just react slower to it.
  const skillFactor = 0.7 + 0.3 * skill.accuracy;
  // Late-game cognitive overload: at high score, the queue churns
  // faster than the player can re-plan. Horizon shrinks linearly past
  // score 600, floored at 50% of base.
  const overload = Math.max(0.5, 1 - Math.max(0, state.score - 600) / 2500);
  const horizon = LOOKAHEAD_HORIZON_SEC * skillFactor * overload;
  const horizonCutoff = state.tNow + horizon;
  const playerSizeMul = state.bigUntil > state.tNow ? state.bigSize : state.tinyUntil > state.tNow ? 0.5 : 1;
  const playerHalf = Math.sqrt(state.size) * playerSizeMul * 0.5;

  // Build a list of danger zones — columns that would be in collision
  // with a queued blue. Used by both passes to avoid moving the player
  // off one blue's path and onto another's.
  interface Danger { column: number; half: number; t: number }
  const dangers: Danger[] = [];
  for (const e of inFlight) {
    if (e.t > horizonCutoff) break;
    if (e.kind !== "normal") continue;
    const clusterHalf = Math.sqrt(e.size) * 0.5;
    dangers.push({ column: e.column, half: playerHalf + clusterHalf + 0.3, t: e.t });
  }

  const isSafe = (col: number, ignoreDanger?: Danger): boolean => {
    for (const d of dangers) {
      if (d === ignoreDanger) continue;
      if (Math.abs(col - d.column) <= d.half) return false;
    }
    return true;
  };

  // Pass 1: any imminent blue we're on course for → dodge to a column
  // that's also safe from ALL other queued blues. If no safe column is
  // within reach, accept the closest reachable refuge.
  let dodgeTarget: number | null = null;
  let dodgeUrgency = -Infinity;
  for (const e of inFlight) {
    if (e.t > horizonCutoff) break;
    if (e.kind !== "normal") continue;
    const tToImpact = e.t - state.tNow;
    if (tToImpact <= 0) continue;
    if (!isOnCourse(state.column, e.column, state.size, e.size, playerSizeMul)) continue;

    const reactionGap = Math.max(0, tToImpact - skill.reactionMs / 1000);
    const reach = reactionGap * skill.lateralColsPerSec;
    const myDanger = dangers.find((d) => d.column === e.column);
    const candidate = pickSafeDodgeCol(state.column, e, playerHalf, reach, isSafe, myDanger);
    if (candidate === null) continue;
    const urgency = 1 / Math.max(0.05, tToImpact);
    if (urgency > dodgeUrgency) {
      dodgeUrgency = urgency;
      dodgeTarget = candidate;
    }
  }
  if (dodgeTarget !== null) {
    state.targetCol = dodgeTarget;
    return;
  }

  // Pass 2: highest-value reachable helpful within the horizon, weighted
  // by greed. Skip helpfuls whose column is in a danger zone — chasing
  // a coin that sits next to a hex is a real-player no-no.
  let bestUtility = 0;
  let bestTarget = pickSafeIdleColumn(state.column, isSafe) ?? state.column;
  for (const e of inFlight) {
    if (e.t > horizonCutoff) break;
    if (e.kind === "normal") continue;
    const tToImpact = e.t - state.tNow;
    if (tToImpact <= 0) continue;
    const reactionGap = Math.max(0, tToImpact - skill.reactionMs / 1000);
    const colDist = Math.abs(e.column - state.column);
    if (reactionGap * skill.lateralColsPerSec < colDist) continue;
    if (!isSafe(e.column)) continue;

    const value = helpfulValue(state, e.kind);
    if (value <= 0) continue;
    const greedFactor = effectiveGreed(skill, e.kind, state);
    const urgency = 1 / Math.max(0.2, tToImpact);
    const utility = value * greedFactor * urgency;
    if (utility > bestUtility) {
      bestUtility = utility;
      bestTarget = clampCol(e.column);
    }
  }
  state.targetCol = bestTarget;
}

// Find a column adjacent to the cluster that's outside its footprint
// AND safe from any other queued blues. Returns null if no reachable
// safe column exists.
function pickSafeDodgeCol(
  playerCol: number,
  cluster: SpawnEvent,
  playerHalf: number,
  reach: number,
  isSafe: (col: number, ignore?: { column: number; half: number; t: number }) => boolean,
  myDanger?: { column: number; half: number; t: number },
): number | null {
  const clusterHalf = Math.sqrt(cluster.size) * 0.5;
  const requiredOffset = playerHalf + clusterHalf + 1.0;
  // Candidates: just outside the cluster on each side, plus board edges.
  const candidates = [
    cluster.column + requiredOffset,
    cluster.column - requiredOffset,
    cluster.column + requiredOffset + 1,
    cluster.column - requiredOffset - 1,
    HALF_COLS,
    -HALF_COLS,
  ];
  // Sort by reach distance ascending so we prefer closer safe spots.
  candidates.sort((a, b) => Math.abs(a - playerCol) - Math.abs(b - playerCol));
  for (const raw of candidates) {
    const col = clampCol(raw);
    if (Math.abs(col - cluster.column) < requiredOffset - 0.05) continue;
    if (Math.abs(col - playerCol) > reach) continue;
    if (!isSafe(col, myDanger)) continue;
    return col;
  }
  // No multi-safe column reachable. Fall back to any reachable column
  // outside the cluster's footprint, even if conflicting with another.
  for (const raw of candidates) {
    const col = clampCol(raw);
    if (Math.abs(col - cluster.column) < requiredOffset - 0.05) continue;
    if (Math.abs(col - playerCol) > reach) continue;
    return col;
  }
  return null;
}

// When idle, default to a column that's safe from all queued blues.
// Prefer staying put if current column is already safe.
function pickSafeIdleColumn(
  current: number,
  isSafe: (col: number) => boolean,
): number | null {
  if (isSafe(current)) return current;
  const candidates = [0, current + 1, current - 1, current + 2, current - 2, HALF_COLS, -HALF_COLS];
  for (const raw of candidates) {
    const col = clampCol(raw);
    if (isSafe(col)) return col;
  }
  return null;
}

function helpfulValue(state: SimState, kind: SpawnEvent["kind"]): number {
  const inDanger = state.size >= state.cfg.dangerSize;
  const sizeNearDanger = state.size >= state.cfg.dangerSize - 2;
  const fastActive = state.fastUntil > state.tNow;
  switch (kind) {
    case "coin":   return 3;
    case "sticky": return state.size >= 5 ? 10 : state.size >= 3 ? 5 : 1.5;
    case "shield": return inDanger ? 12 : sizeNearDanger ? 6 : 2;
    case "drone":  return sizeNearDanger ? 5 : 2.5;
    case "slow":   return fastActive ? 6 : 1.5;
    case "fast":   return state.size <= 4 ? 2.5 : 0.5;
    case "tiny":   return 2;
    case "big":    return state.size <= 3 ? 2 : 0.5;
    default:       return 0;
  }
}

// For survival-critical items, treat greed as if it were closer to 1.0
// — real players grab a heal-when-large or shield-when-in-danger
// reflexively, not based on personality.
function effectiveGreed(skill: SkillProfile, kind: SpawnEvent["kind"], state: SimState): number {
  const inDanger = state.size >= state.cfg.dangerSize;
  const sizeNearDanger = state.size >= state.cfg.dangerSize - 2;
  const fastActive = state.fastUntil > state.tNow;
  const survival =
    (kind === "sticky" && state.size >= 5) ||
    (kind === "shield" && (inDanger || sizeNearDanger)) ||
    (kind === "slow" && fastActive);
  if (survival) return Math.max(skill.greed, 0.85);
  return skill.greed;
}

// Pay out any pending fast pool (called at run end so the pool isn't
// lost to truncation).
export function finalizeRun(state: SimState): void {
  if (state.fastUntil > 0 && state.fastPool > 0) {
    payOutFast(state);
  }
}
