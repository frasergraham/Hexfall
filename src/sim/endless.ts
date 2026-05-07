// Endless-mode run loop. Tick-by-spawn-event state machine, mirroring
// the live game's calm/wave alternation, swarm rolls, and pinch-after-
// score-600 logic. We don't simulate physics — just emit one
// SpawnEvent per spawn-cadence tick and feed it into resolveEncounter.

import type { Difficulty } from "../types";
import { mulberry32 } from "../rng";
import {
  DIFFICULTY_CONFIG,
  pickKind,
  STICKY_MIN_SCORE,
  SWARM_SPAWN_INTERVAL,
  SWARM_STICKY_CHANCE,
  SWARM_WAVE_CHANCE,
} from "../spawnKind";
import { computeWaveParams, lateGameSpeedMul } from "../spawn";
import { finalizeRun, initSimState, resolveEncounter } from "./encounter";
import type { ClusterKind } from "../types";
import type { RunResult, SkillProfile, SpawnEvent } from "./types";

const BOARD_COLS = 9;
const HALF_COLS = (BOARD_COLS - 1) / 2; // 4

// Sim time-budget caps to prevent runaway loops on too-easy configs.
const SCORE_TIMEOUT = 1500;
const SECS_TIMEOUT = 600;

// Reaction-window scaling. Anchor: at score 0, medium difficulty,
// no active timescale, the cluster spends ~2.5 sim seconds in flight.
// All speed-related multipliers compress this window proportionally.
const BASE_REACTION_WINDOW_SEC = 2.5;

export function runEndless(
  difficulty: Difficulty,
  skill: SkillProfile,
  seed: number,
): RunResult {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  const rng = mulberry32(seed >>> 0);
  const state = initSimState(cfg, difficulty, skill, rng);

  let inWave = false;
  let phaseEndsAt = 0;
  let wp = computeWaveParams(state.score, cfg.spawnIntervalMul);
  let isSwarm = false;
  let safeCol = 0;
  let nextSpawnAt = 0;

  const startPhase = (wave: boolean): void => {
    inWave = wave;
    wp = computeWaveParams(state.score, cfg.spawnIntervalMul);
    if (wave) {
      isSwarm = rng() < SWARM_WAVE_CHANCE;
      safeCol = Math.floor(rng() * BOARD_COLS) - HALF_COLS;
      phaseEndsAt = state.tNow + wp.waveDuration;
    } else {
      isSwarm = false;
      phaseEndsAt = state.tNow + wp.calmDuration;
    }
    nextSpawnAt = state.tNow + currentSpawnInterval();
  };

  const currentSpawnInterval = (): number => {
    if (isSwarm) return SWARM_SPAWN_INTERVAL;
    return !inWave ? wp.calmSpawnInterval : wp.waveSpawnInterval;
  };

  // Effective sim-time-scale at the moment of spawn. Slow / fast tweak
  // the window the player gets; fast also makes the cluster feel faster
  // on screen so the dodge window is shorter.
  const timescale = (): number => {
    if (state.slowUntil > state.tNow) return 0.5;
    if (state.fastUntil > state.tNow) {
      // approximate: each fast stack adds ~10% speed
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
    if (state.tNow >= phaseEndsAt) {
      startPhase(!inWave);
      continue;
    }
    if (nextSpawnAt > phaseEndsAt) {
      // No more spawns this phase; jump to the boundary.
      state.tNow = phaseEndsAt;
      continue;
    }

    const t = nextSpawnAt;

    // Kind selection.
    let kind: ClusterKind = "normal";
    if (isSwarm) {
      if (state.score >= STICKY_MIN_SCORE && rng() < SWARM_STICKY_CHANCE) {
        kind = "sticky";
      }
    } else {
      kind = pickKind(cfg, state.score, rng);
    }

    // Cluster size.
    let size: number;
    if (isSwarm || kind === "coin" || kind === "shield" || kind === "drone") {
      size = 1;
    } else {
      size = 2 + Math.floor(rng() * 4); // 2..5
    }

    // Column. Avoid the wave's safe column.
    let col = Math.floor(rng() * BOARD_COLS) - HALF_COLS;
    if (inWave && col === safeCol) {
      col = col === HALF_COLS ? col - 1 : col + 1;
    }

    // Reaction window.
    const speedMul =
      cfg.fallSpeedMul *
      lateGameSpeedMul(state.score) *
      (inWave ? wp.waveSpeedMul : 1) *
      timescale();
    const reactionWindow = BASE_REACTION_WINDOW_SEC / Math.max(0.4, speedMul);

    const event: SpawnEvent = {
      kind,
      size,
      column: col,
      reactionWindow,
      t,
      swarm: isSwarm,
    };

    resolveEncounter(state, event);
    nextSpawnAt = t + currentSpawnInterval();
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
