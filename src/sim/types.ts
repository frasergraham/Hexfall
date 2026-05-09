// Shared types for the offline balance simulator. The simulator runs
// outside the game engine — encounter-level, not per-frame physics.
// See scripts/simulate.ts for the CLI surface.

import type { ClusterKind, Difficulty } from "../types";
import type { DifficultyConfig } from "../spawnKind";
import type { Random } from "../rng";

export type DeathCause =
  | "combo"            // ran the LOSE_COMBO blue-hit-while-in-danger gauntlet
  | "timeoutScore"     // hit the simulator's score cap (deliberate runaway brake)
  | "timeoutSec"       // hit the simulator's wall-time cap
  | "wavesExhausted";  // challenge ran out of waves (a clear)

// Skill profile inputs to the encounter resolver. Tuned by hand; first
// pass is uncalibrated against real telemetry, so trust *relative*
// numbers between cells more than absolutes.
export interface SkillProfile {
  name: string;
  reactionMs: number;        // dead time before the player can act on a spawn
  accuracy: number;          // 0..1, P(success) on a reachable encounter
  greed: number;             // 0..1, willingness to chase helpful clusters
  lateralColsPerSec: number; // movement budget (board columns / sec)
}

// One spawned cluster, from the perspective of the encounter resolver.
// `reactionWindow` is how much sim-time the player had between spawn
// and impact (equivalent to "how long the cluster was in flight"). The
// runners compute it from cfg.fallSpeedMul × score-ramps × timescale.
export interface SpawnEvent {
  kind: ClusterKind;
  size: number;          // hex count, 1..5
  column: number;        // -half..+half (board column)
  reactionWindow: number;// sim seconds available to react before impact
  t: number;             // sim seconds at which the encounter resolves
  swarm: boolean;
}

// Mutable simulator state — one per run. Effect timers store *until*
// times in sim seconds; 0 means inactive. Multipliers are 1 when
// inactive so they're safe to multiply unconditionally.
export interface SimState {
  cfg: DifficultyConfig;
  difficulty: Difficulty;
  skill: SkillProfile;
  rng: Random;

  score: number;
  size: number;
  column: number;     // -half..+half (current position)
  targetCol: number;  // where the player is heading (lookahead planner output)

  loseCombo: number;  // consecutive blue hits while size >= dangerSize
  invulnUntil: number;

  slowUntil: number;
  fastUntil: number;
  fastMul: number;
  fastStacks: number;
  fastPool: number;
  shieldUntil: number;
  shieldHp: number;
  droneUntil: number;
  droneHp: number;
  tinyUntil: number;
  bigUntil: number;
  bigSize: number;
  bigMul: number;
  bigStacks: number;

  tNow: number;
  bluesPassed: number;
  helpfulCaught: number;
  fastPayouts: number;
  death: DeathCause | null;
}

export interface RunResult {
  score: number;
  durationSec: number;
  death: DeathCause;
  bluesPassed: number;
  helpfulCaught: number;
  fastPayouts: number;
  difficulty: Difficulty;
  skill: string;
}
