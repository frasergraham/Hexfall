// Challenge-mode run loop. Iterates def.waves, parsing each line via
// the live waveDsl, then feeding both the scripted slot stream and the
// probabilistic stream through the lookahead queue model — same shape
// as endless.ts so chooseTarget gets to plan ahead.

import type { Difficulty, ClusterKind } from "../types";
import { hashSeed, mulberry32 } from "../rng";
import {
  BIG_DURATION,
  DIFFICULTY_CONFIG,
  type DifficultyConfig,
  DRONE_DURATION,
  FAST_EFFECT_DURATION,
  HALF_COLS,
  SHIELD_DURATION,
  SLOW_EFFECT_DURATION,
  TINY_DURATION,
} from "../spawnKind";
import { BASE_REACTION_WINDOW_SEC } from "./constants";
import { parseWaveLine, type ParsedWave } from "../waveDsl";
import type { ChallengeDef } from "../challenges";
import {
  advancePlayerPosition,
  advanceTo,
  chooseTarget,
  finalizeRun,
  initSimState,
  resolveEncounter,
} from "./encounter";
import type { RunResult, SimState, SkillProfile, SpawnEvent } from "./types";

// Map a roster ChallengeDef to a synthetic difficulty for cfg lookup.
function challengeCfg(def: ChallengeDef): DifficultyConfig {
  const base = DIFFICULTY_CONFIG.medium;
  const effects = def.effects;
  if (!effects) return base;
  // Per-effect override is given as an absolute duration in seconds;
  // convert to a multiplier vs the live default.
  const ratio = (override: number | undefined, def: number, fallback?: number): number | undefined =>
    override !== undefined ? override / def : fallback;
  return {
    ...base,
    dangerSize: effects.dangerSize ?? base.dangerSize,
    slowDurationMul: ratio(effects.slowDuration, SLOW_EFFECT_DURATION, base.slowDurationMul),
    fastDurationMul: ratio(effects.fastDuration, FAST_EFFECT_DURATION, base.fastDurationMul),
    shieldDurationMul: ratio(effects.shieldDuration, SHIELD_DURATION, base.shieldDurationMul),
    droneDurationMul: ratio(effects.droneDuration, DRONE_DURATION, base.droneDurationMul),
    tinyDurationMul: ratio(effects.tinyDuration, TINY_DURATION, base.tinyDurationMul),
    bigDurationMul: ratio(effects.bigDuration, BIG_DURATION, base.bigDurationMul),
  };
}

function pickWeightedKind(weights: Partial<Record<ClusterKind, number>>, rng: () => number): ClusterKind {
  const entries = Object.entries(weights) as Array<[ClusterKind, number]>;
  let total = 0;
  for (const [, w] of entries) total += w;
  if (total <= 0) return "normal";
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function insertByImpact(queue: SpawnEvent[], event: SpawnEvent): void {
  let i = queue.length;
  while (i > 0 && queue[i - 1].t > event.t) i--;
  queue.splice(i, 0, event);
}

interface PendingSpawn {
  spawnT: number;
  build: () => SpawnEvent;
}

// Pre-compute every spawn for the wave (slots + prob stream) as a list
// of PendingSpawn entries with deterministic times. The run loop then
// merges them with the in-flight impact queue.
function expandWaveSpawns(
  wave: ParsedWave,
  startT: number,
  spawnRng: () => number,
  reactionWindow: number,
): PendingSpawn[] {
  const out: PendingSpawn[] = [];
  const safeColSim: number | null =
    wave.safeCol === null || wave.safeCol === "none"
      ? null
      : Math.max(-HALF_COLS, Math.min(HALF_COLS, wave.safeCol - HALF_COLS));

  // Slot stream
  for (let i = 0; i < wave.slots.length; i++) {
    const slot = wave.slots[i];
    if (slot === null) continue;
    const t = startT + i * wave.slotInterval;
    const captured = slot;
    out.push({
      spawnT: t,
      build: (): SpawnEvent => ({
        kind: captured.kind,
        size: Math.max(1, Math.min(5, captured.size)),
        column: Math.max(-HALF_COLS, Math.min(HALF_COLS, captured.col - HALF_COLS)),
        reactionWindow,
        t: t + reactionWindow,
        swarm: wave.swarm,
      }),
    });
  }

  // Probabilistic stream
  const slotsDuration = wave.slots.length * wave.slotInterval;
  const probDuration =
    wave.countCap !== null && wave.countCap > 0
      ? wave.countCap * wave.spawnInterval
      : 0;
  const inferredDur = Math.max(slotsDuration, probDuration);
  const waveDur = wave.durOverride ?? Math.max(2, inferredDur);
  const hasProb = wave.countCap !== 0 && Object.keys(wave.weights).length > 0;
  if (hasProb) {
    let n = 0;
    let probT = startT;
    while (probT <= startT + waveDur) {
      if (wave.countCap !== null && n >= wave.countCap) break;
      const kind = pickWeightedKind(wave.weights, spawnRng);
      const size =
        kind === "coin" || kind === "shield" || kind === "drone"
          ? 1
          : wave.sizeMin + Math.floor(spawnRng() * (wave.sizeMax - wave.sizeMin + 1));
      let col = Math.floor(spawnRng() * (HALF_COLS * 2 + 1)) - HALF_COLS;
      if (safeColSim !== null && col === safeColSim) {
        col = col === HALF_COLS ? col - 1 : col + 1;
      }
      const tCapture = probT;
      out.push({
        spawnT: tCapture,
        build: (): SpawnEvent => ({
          kind,
          size,
          column: col,
          reactionWindow,
          t: tCapture + reactionWindow,
          swarm: wave.swarm,
        }),
      });
      n += 1;
      probT += wave.spawnInterval;
    }
  }

  out.sort((a, b) => a.spawnT - b.spawnT);
  return out;
}

function runWave(
  state: SimState,
  wave: ParsedWave,
  startT: number,
  spawnRng: () => number,
): { endT: number; died: boolean } {
  const reactionWindow = BASE_REACTION_WINDOW_SEC / Math.max(0.4, wave.baseSpeedMul);
  const slotsDuration = wave.slots.length * wave.slotInterval;
  const probDuration =
    wave.countCap !== null && wave.countCap > 0
      ? wave.countCap * wave.spawnInterval
      : 0;
  const waveDur = wave.durOverride ?? Math.max(2, Math.max(slotsDuration, probDuration));
  const endT = startT + waveDur;

  const pending = expandWaveSpawns(wave, startT, spawnRng, reactionWindow);
  const inFlight: SpawnEvent[] = [];
  let pIdx = 0;

  while (state.death === null) {
    const nextSpawnT = pIdx < pending.length ? pending[pIdx].spawnT : Infinity;
    const nextImpactT = inFlight.length > 0 ? inFlight[0].t : Infinity;

    if (nextSpawnT === Infinity && nextImpactT === Infinity) break;

    if (nextSpawnT <= nextImpactT) {
      // Spawn next.
      advancePlayerPosition(state, nextSpawnT);
      advanceTo(state, nextSpawnT);
      const event = pending[pIdx].build();
      pIdx += 1;
      insertByImpact(inFlight, event);
      chooseTarget(state, inFlight);
    } else {
      // Impact next.
      const event = inFlight.shift()!;
      resolveEncounter(state, event);
      if (state.death !== null) break;
      chooseTarget(state, inFlight);
    }
  }

  // Resolve remaining in-flight clusters at wave end (their impacts
  // would land within the wave's window).
  for (const event of inFlight) {
    if (state.death !== null) break;
    resolveEncounter(state, event);
  }
  if (endT > state.tNow) advanceTo(state, endT);
  return { endT, died: state.death !== null };
}

export function runChallenge(
  def: ChallengeDef,
  skill: SkillProfile,
  seed: number,
): RunResult {
  const cfg = challengeCfg(def);
  const difficulty: Difficulty = "medium";
  const rng = mulberry32(seed >>> 0);
  const state = initSimState(cfg, difficulty, skill, rng);

  let t = 0;
  for (let i = 0; i < def.waves.length; i++) {
    if (state.death !== null) break;
    let wave: ParsedWave;
    try {
      wave = parseWaveLine(def.waves[i]);
    } catch {
      continue;
    }
    const waveSeed = wave.seed !== null ? wave.seed : hashSeed(`${def.id}:${i}`);
    const spawnRng = mulberry32(waveSeed >>> 0);
    const { endT } = runWave(state, wave, t, spawnRng);
    t = endT;
    if (endT > state.tNow) advanceTo(state, endT);
  }

  finalizeRun(state);

  return {
    score: state.score,
    durationSec: state.tNow,
    death: state.death ?? "wavesExhausted",
    bluesPassed: state.bluesPassed,
    helpfulCaught: state.helpfulCaught,
    fastPayouts: state.fastPayouts,
    difficulty,
    skill: skill.name,
  };
}
