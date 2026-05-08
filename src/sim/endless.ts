// Endless-mode run loop. Maintains an in-flight queue of clusters
// sorted by impact time. The lookahead planner (chooseTarget) decides
// what column to head toward each time a cluster spawns or impacts.
// The player's column evolves between events at lateralColsPerSec.

import type { Difficulty } from "../types";
import { mulberry32 } from "../rng";
import {
  DIFFICULTY_CONFIG,
  type DifficultyConfig,
  pickKind,
  STICKY_MIN_SCORE,
  SWARM_SPAWN_INTERVAL,
  SWARM_STICKY_CHANCE,
  SWARM_WAVE_CHANCE,
} from "../spawnKind";
import { computeWaveParams, lateGameSpeedMul } from "../spawn";
import {
  advancePlayerPosition,
  chooseTarget,
  finalizeRun,
  initSimState,
  resolveEncounter,
} from "./encounter";
import type { ClusterKind } from "../types";
import type { RunResult, SimState, SkillProfile, SpawnEvent } from "./types";

const BOARD_COLS = 9;
const HALF_COLS = (BOARD_COLS - 1) / 2; // 4

// Sim time-budget caps to prevent runaway loops on too-easy configs.
// Real top scores cluster around ~1700; the 5000 cap is a generous
// guardrail for outlier perfect runs without saturating typical play.
const SCORE_TIMEOUT = 5000;
const SECS_TIMEOUT = 600;

// Reaction-window scaling. Anchor: at score 0, medium difficulty,
// no active timescale, the cluster spends ~2.5 sim seconds in flight.
// All speed-related multipliers compress this window proportionally.
const BASE_REACTION_WINDOW_SEC = 2.5;

interface EndlessLoopState {
  inWave: boolean;
  isSwarm: boolean;
  safeCol: number;
  phaseEndsAt: number;
  nextSpawnAt: number;
}

export function runEndless(
  difficulty: Difficulty,
  skill: SkillProfile,
  seed: number,
): RunResult {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  const rng = mulberry32(seed >>> 0);
  const state = initSimState(cfg, difficulty, skill, rng);
  const inFlight: SpawnEvent[] = [];

  let wp = computeWaveParams(state.score, cfg.spawnIntervalMul);
  const loop: EndlessLoopState = {
    inWave: false,
    isSwarm: false,
    safeCol: 0,
    phaseEndsAt: 0,
    nextSpawnAt: 0,
  };

  const currentSpawnInterval = (): number => {
    if (loop.isSwarm) return SWARM_SPAWN_INTERVAL;
    return !loop.inWave ? wp.calmSpawnInterval : wp.waveSpawnInterval;
  };

  const startPhase = (wave: boolean): void => {
    loop.inWave = wave;
    wp = computeWaveParams(state.score, cfg.spawnIntervalMul);
    if (wave) {
      loop.isSwarm = rng() < SWARM_WAVE_CHANCE;
      loop.safeCol = Math.floor(rng() * BOARD_COLS) - HALF_COLS;
      loop.phaseEndsAt = state.tNow + wp.waveDuration;
    } else {
      loop.isSwarm = false;
      loop.phaseEndsAt = state.tNow + wp.calmDuration;
    }
    loop.nextSpawnAt = state.tNow + currentSpawnInterval();
  };

  const timescale = (): number => {
    if (state.slowUntil > state.tNow) return 0.5;
    if (state.fastUntil > state.tNow) {
      return 1 + 0.25 + (state.fastStacks - 1) * 0.1;
    }
    return 1;
  };

  startPhase(false);

  while (
    state.death === null &&
    state.score < SCORE_TIMEOUT &&
    state.tNow < SECS_TIMEOUT
  ) {
    // Decide what happens next: spawn, impact, or phase boundary.
    const nextImpactT = inFlight.length > 0 ? inFlight[0].t : Infinity;
    const nextSpawnT = loop.nextSpawnAt;

    // Phase boundary as a separate "event" — runs only when no other
    // event is closer, so it doesn't preempt impacts/spawns.
    if (state.tNow >= loop.phaseEndsAt && nextImpactT > loop.phaseEndsAt) {
      startPhase(!loop.inWave);
      continue;
    }

    if (nextSpawnT > loop.phaseEndsAt && nextSpawnT < nextImpactT) {
      // No more spawns this phase; advance to phase boundary if no
      // impacts queued before it.
      if (nextImpactT <= loop.phaseEndsAt) {
        // Process impact below.
      } else {
        // Just advance past the boundary.
        state.tNow = loop.phaseEndsAt;
        continue;
      }
    }

    if (nextSpawnT <= nextImpactT) {
      // Spawn next.
      processSpawn(state, loop, wp, inFlight, rng, cfg, timescale());
    } else {
      // Impact next.
      const event = inFlight.shift()!;
      resolveEncounter(state, event);
      if (state.death !== null) break;
      chooseTarget(state, inFlight);
    }
  }

  // Resolve any clusters still in flight at run end (their impacts
  // would have happened off-screen). Score them as bank-passes since
  // the run timed out before they could land.
  for (const event of inFlight) {
    if (state.death !== null) break;
    resolveEncounter(state, event);
  }
  finalizeRun(state);

  let death = state.death;
  if (death === null) {
    death = state.score >= SCORE_TIMEOUT ? "timeoutScore" : "timeoutSec";
  }

  return {
    score: state.score,
    durationSec: state.tNow,
    death,
    bluesPassed: state.bluesPassed,
    helpfulCaught: state.helpfulCaught,
    fastPayouts: state.fastPayouts,
    difficulty,
    skill: skill.name,
  };
}

function processSpawn(
  state: SimState,
  loop: EndlessLoopState,
  wp: ReturnType<typeof computeWaveParams>,
  inFlight: SpawnEvent[],
  rng: () => number,
  cfg: DifficultyConfig,
  timescaleNow: number,
): void {
  // Advance state.tNow to the spawn time, moving the player along.
  advancePlayerPosition(state, loop.nextSpawnAt);
  state.tNow = loop.nextSpawnAt;

  // Kind selection.
  let kind: ClusterKind = "normal";
  if (loop.isSwarm) {
    if (state.score >= STICKY_MIN_SCORE && rng() < SWARM_STICKY_CHANCE) {
      kind = "sticky";
    }
  } else {
    kind = pickKind(cfg, state.score, rng);
  }

  // Cluster size.
  let size: number;
  if (loop.isSwarm || kind === "coin" || kind === "shield" || kind === "drone") {
    size = 1;
  } else {
    size = 2 + Math.floor(rng() * 4); // 2..5
  }

  // Column. Avoid the wave's safe column.
  let col = Math.floor(rng() * BOARD_COLS) - HALF_COLS;
  if (loop.inWave && col === loop.safeCol) {
    col = col === HALF_COLS ? col - 1 : col + 1;
  }

  // Reaction window — how long the cluster is in flight before impact.
  const speedMul =
    cfg.fallSpeedMul *
    lateGameSpeedMul(state.score) *
    (loop.inWave ? wp.waveSpeedMul : 1) *
    timescaleNow;
  const reactionWindow = BASE_REACTION_WINDOW_SEC / Math.max(0.4, speedMul);

  const event: SpawnEvent = {
    kind,
    size,
    column: col,
    reactionWindow,
    t: state.tNow + reactionWindow,
    swarm: loop.isSwarm,
  };

  // Insert sorted by impact time.
  insertByImpact(inFlight, event);

  // Re-plan with the updated queue.
  chooseTarget(state, inFlight);

  loop.nextSpawnAt = state.tNow + currentSpawnIntervalFor(loop, wp);
}

function currentSpawnIntervalFor(
  loop: EndlessLoopState,
  wp: ReturnType<typeof computeWaveParams>,
): number {
  if (loop.isSwarm) return SWARM_SPAWN_INTERVAL;
  return !loop.inWave ? wp.calmSpawnInterval : wp.waveSpawnInterval;
}

function insertByImpact(queue: SpawnEvent[], event: SpawnEvent): void {
  let i = queue.length;
  while (i > 0 && queue[i - 1].t > event.t) i--;
  queue.splice(i, 0, event);
}
