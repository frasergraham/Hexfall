// Challenge-mode run loop. Iterates def.waves, parsing each line via
// the live waveDsl, then feeding both the scripted slot stream and the
// probabilistic stream through resolveEncounter.

import type { Difficulty, ClusterKind } from "../types";
import { hashSeed, mulberry32 } from "../rng";
import { DIFFICULTY_CONFIG, type DifficultyConfig } from "../spawnKind";
import { parseWaveLine, type ParsedWave } from "../waveDsl";
import type { ChallengeDef } from "../challenges";
import { finalizeRun, initSimState, resolveEncounter } from "./encounter";
import type { RunResult, SimState, SkillProfile, SpawnEvent } from "./types";

const HALF_COLS = 4;

// Anchor for tImpact; same semantics as endless. Challenge waves carry
// `baseSpeedMul` per the DSL, so the sim shrinks the window proportionally.
const BASE_REACTION_WINDOW_SEC = 2.5;

// Map a roster ChallengeDef to a synthetic difficulty for cfg lookup.
// Roster challenges run against a "challenge" config that's roughly
// medium with the per-challenge effect overrides applied. For the
// simulator we use medium as the base and overlay def.effects.
function challengeCfg(def: ChallengeDef): DifficultyConfig {
  const base = DIFFICULTY_CONFIG.medium;
  const effects = def.effects;
  if (!effects) return base;
  // Only effect-duration & dangerSize overrides are honoured at the
  // sim level. Everything else stays at medium values.
  return {
    ...base,
    dangerSize: effects.dangerSize ?? base.dangerSize,
    slowDurationMul:
      effects.slowDuration !== undefined ? effects.slowDuration / 5 : base.slowDurationMul,
    fastDurationMul:
      effects.fastDuration !== undefined ? effects.fastDuration / 5 : base.fastDurationMul,
    shieldDurationMul:
      effects.shieldDuration !== undefined ? effects.shieldDuration / 10 : base.shieldDurationMul,
    droneDurationMul:
      effects.droneDuration !== undefined ? effects.droneDuration / 10 : base.droneDurationMul,
    tinyDurationMul:
      effects.tinyDuration !== undefined ? effects.tinyDuration / 5 : base.tinyDurationMul,
    bigDurationMul:
      effects.bigDuration !== undefined ? effects.bigDuration / 5 : base.bigDurationMul,
  };
}

// Pick a kind from the wave's `weights` table with the given rng draw.
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

// Project a single wave into the run, mutating sim state. Returns true
// if the run ended. The `spawnRng` arg is the deterministic per-wave
// stream used for slot/prob picks; player-decision randomness still
// comes from state.rng so distributions vary across runs even when
// the spawn layout is fixed.
function runWave(
  state: SimState,
  wave: ParsedWave,
  startT: number,
  spawnRng: () => number,
): { endT: number; died: boolean } {
  const rng = spawnRng;

  // Wave duration: explicit `dur=` if set, else derived from slot count
  // and spawn cadence (rough, the live game has its own logic).
  const slotCount = wave.slots.length;
  const slotsDuration = slotCount * wave.slotInterval;
  const probDuration = wave.countCap !== null && wave.countCap > 0 ? wave.countCap * wave.spawnInterval : 0;
  const inferredDur = Math.max(slotsDuration, probDuration);
  const waveDur = wave.durOverride ?? Math.max(2, inferredDur);

  let nextSlotT = startT;
  let nextProbT = startT;
  let slotIdx = 0;
  let probEmitted = 0;
  const hasProbStream =
    wave.countCap !== 0 && // count=0 disables probabilistic
    Object.keys(wave.weights).length > 0;

  const reactionWindow = BASE_REACTION_WINDOW_SEC / Math.max(0.4, wave.baseSpeedMul);

  // Resolve safeCol: DSL uses 0..8 (column index from left), sim uses
  // -4..+4. "none" or null → no enforced safe column.
  const safeColSim: number | null =
    wave.safeCol === null || wave.safeCol === "none"
      ? null
      : Math.max(-HALF_COLS, Math.min(HALF_COLS, wave.safeCol - HALF_COLS));

  const endT = startT + waveDur;

  while (state.tNow < endT && state.death === null) {
    // Pick the next event from whichever timer fires first.
    const slotReady = slotIdx < slotCount && nextSlotT <= endT;
    const probReady =
      hasProbStream &&
      nextProbT <= endT &&
      (wave.countCap === null || probEmitted < wave.countCap);

    if (!slotReady && !probReady) break;

    let useSlot: boolean;
    if (slotReady && probReady) useSlot = nextSlotT <= nextProbT;
    else useSlot = slotReady;

    if (useSlot) {
      const slot = wave.slots[slotIdx];
      slotIdx += 1;
      nextSlotT += wave.slotInterval;
      if (slot === null) continue; // 000 = skip
      const event: SpawnEvent = {
        kind: slot.kind,
        size: Math.max(1, Math.min(5, slot.size)),
        column: Math.max(-HALF_COLS, Math.min(HALF_COLS, slot.col - HALF_COLS)),
        reactionWindow,
        t: state.tNow + 0.001, // monotonic
        swarm: wave.swarm,
      };
      resolveEncounter(state, event);
    } else {
      const t = nextProbT;
      nextProbT += wave.spawnInterval;
      probEmitted += 1;
      const kind = pickWeightedKind(wave.weights, rng);
      let size: number;
      if (kind === "coin" || kind === "shield" || kind === "drone") size = 1;
      else size = wave.sizeMin + Math.floor(rng() * (wave.sizeMax - wave.sizeMin + 1));
      // Column: random in -4..+4, avoid safeCol if set.
      let col = Math.floor(rng() * (HALF_COLS * 2 + 1)) - HALF_COLS;
      if (safeColSim !== null && col === safeColSim) {
        col = col === HALF_COLS ? col - 1 : col + 1;
      }
      const event: SpawnEvent = {
        kind,
        size,
        column: col,
        reactionWindow,
        t: Math.max(state.tNow + 0.001, t),
        swarm: wave.swarm,
      };
      resolveEncounter(state, event);
    }
  }

  return { endT, died: state.death !== null };
}

export function runChallenge(
  def: ChallengeDef,
  skill: SkillProfile,
  seed: number,
): RunResult {
  const cfg = challengeCfg(def);
  const difficulty: Difficulty = "medium"; // placeholder; challenges aren't strictly mapped
  const rng = mulberry32(seed >>> 0);
  const state = initSimState(cfg, difficulty, skill, rng);

  let t = 0;
  for (let i = 0; i < def.waves.length; i++) {
    if (state.death !== null) break;
    let wave: ParsedWave;
    try {
      wave = parseWaveLine(def.waves[i]);
    } catch {
      continue; // skip malformed waves silently
    }
    // Per-wave seed: explicit override wins, else derive from challenge
    // id + wave index (mirrors game.ts:7124).
    const waveSeed = wave.seed !== null ? wave.seed : hashSeed(`${def.id}:${i}`);
    const spawnRng = mulberry32(waveSeed >>> 0);
    const { endT } = runWave(state, wave, t, spawnRng);
    t = endT;
    state.tNow = endT;
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
