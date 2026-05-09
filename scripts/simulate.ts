// HexRain balance simulator CLI.
//
// Usage:
//   tsx scripts/simulate.ts                       endless × 4 difficulties × 4 skills × N=500
//   tsx scripts/simulate.ts --n 2000 --seed 42    bigger sample, deterministic
//   tsx scripts/simulate.ts --challenges          add the 30 roster challenges
//   tsx scripts/simulate.ts --audit               tier-share audit only (no run loops)
//   tsx scripts/simulate.ts --json out.json       emit raw stats as JSON for diffing
//   tsx scripts/simulate.ts --diff base.json proposed.json
//
// LIMITATION: encounter-level model, not physics. Trust *relative* score
// deltas between configs more than absolute scores. Calibrate skill
// profiles against real playtests before treating absolute numbers as
// ground truth.

import { writeFileSync, readFileSync } from "node:fs";
import type { Difficulty } from "../src/types";
import {
  DIFFICULTY_CONFIG,
  pickKind,
  SPAWN_CHALLENGE_TIER_WEIGHT,
  SPAWN_HELPFUL_TIER_WEIGHT,
  SPAWN_STICKY_TIER_WEIGHT,
} from "../src/spawnKind";
import { mulberry32 } from "../src/rng";
import { CHALLENGES } from "../src/challenges";
import { SKILLS } from "../src/sim/skills";
import { runEndless } from "../src/sim/endless";
import { runChallenge } from "../src/sim/challenge";
import {
  buildDiff,
  type CellStats,
  formatDiff,
  formatTable,
  summarize,
} from "../src/sim/aggregate";
import type { RunResult } from "../src/sim/types";

interface Args {
  n: number;
  seed: number;
  challenges: boolean;
  audit: boolean;
  json: string | null;
  diff: { baseline: string; proposed: string } | null;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const args: Args = {
    n: 500,
    seed: 1,
    challenges: false,
    audit: false,
    json: null,
    diff: null,
  };
  const requireInt = (flag: string, raw: string | undefined): number => {
    if (raw === undefined) throw new Error(`${flag} requires a numeric argument`);
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) throw new Error(`${flag} must be an integer (got "${raw}")`);
    return n;
  };
  const requirePath = (flag: string, raw: string | undefined): string => {
    if (raw === undefined || raw.length === 0) {
      throw new Error(`${flag} requires a path argument`);
    }
    return raw;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") {
      const n = requireInt(a, argv[++i]);
      if (n <= 0) throw new Error("--n must be > 0");
      args.n = n;
    } else if (a === "--seed") {
      args.seed = requireInt(a, argv[++i]);
    } else if (a === "--challenges") args.challenges = true;
    else if (a === "--audit") args.audit = true;
    else if (a === "--json") args.json = requirePath(a, argv[++i]);
    else if (a === "--diff") {
      args.diff = {
        baseline: requirePath(a, argv[++i]),
        proposed: requirePath(a, argv[++i]),
      };
    } else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

function auditTierShares(): void {
  const N = 100_000;
  const score = 400; // late-game, all kinds eligible
  console.log("# Tier-share audit");
  console.log(`Sampling pickKind ${N.toLocaleString()} times at score=${score}.\n`);
  console.log("| difficulty | sticky | helpful | challenge | normal |");
  console.log("|---|---:|---:|---:|---:|");
  for (const d of ["easy", "medium", "hard", "hardcore"] as const) {
    const cfg = DIFFICULTY_CONFIG[d];
    const counts = { sticky: 0, coin: 0, slow: 0, fast: 0, big: 0, shield: 0, drone: 0, tiny: 0, normal: 0 };
    const rng = mulberry32(0x12345678);
    for (let i = 0; i < N; i++) {
      const k = pickKind(cfg, score, rng);
      counts[k] += 1;
    }
    const sticky = counts.sticky;
    const helpful = counts.coin + counts.slow + counts.shield + counts.drone + counts.tiny;
    const challenge = counts.fast + counts.big;
    const normal = counts.normal;
    const f = (n: number) => `${((n / N) * 100).toFixed(1)}%`;
    console.log(`| ${d} | ${f(sticky)} | ${f(helpful)} | ${f(challenge)} | ${f(normal)} |`);
  }
  // Expected (from CLAUDE.md):
  // - 0.10 × stickyMul, 0.19 × helpfulMul, 0.05 × challengeMul, rest = normal.
  console.log("\n## Expected (from DIFFICULTY_CONFIG multipliers)");
  console.log("| difficulty | sticky | helpful | challenge | normal |");
  console.log("|---|---:|---:|---:|---:|");
  for (const d of ["easy", "medium", "hard", "hardcore"] as const) {
    const cfg = DIFFICULTY_CONFIG[d];
    const sticky = SPAWN_STICKY_TIER_WEIGHT * cfg.stickyMul;
    const helpful = SPAWN_HELPFUL_TIER_WEIGHT * cfg.helpfulMul;
    const challenge = SPAWN_CHALLENGE_TIER_WEIGHT * cfg.challengeMul;
    const normal = 1 - sticky - helpful - challenge;
    const f = (n: number) => `${(n * 100).toFixed(1)}%`;
    console.log(`| ${d} | ${f(sticky)} | ${f(helpful)} | ${f(challenge)} | ${f(normal)} |`);
  }
}

function runEndlessGrid(N: number, seed0: number): CellStats[] {
  const cells: CellStats[] = [];
  for (const d of ["easy", "medium", "hard", "hardcore"] as const) {
    for (const skill of SKILLS) {
      const results: RunResult[] = [];
      for (let i = 0; i < N; i++) {
        const seed = (seed0 ^ hashCell(d, skill.name, i)) >>> 0;
        results.push(runEndless(d, skill, seed));
      }
      cells.push(summarize(d, skill.name, results));
    }
  }
  return cells;
}

function runChallengeGrid(N: number, seed0: number): CellStats[] {
  // Sample 6 representative challenges (one per block) across all four
  // skills. Running all 30×4×N would be much slower and the marginal
  // signal is small.
  const sample = CHALLENGES.filter((c) => c.index === 3); // mid-block challenge
  const cells: CellStats[] = [];
  for (const def of sample) {
    for (const skill of SKILLS) {
      const results: RunResult[] = [];
      for (let i = 0; i < N; i++) {
        const seed = (seed0 ^ hashCell(def.id, skill.name, i)) >>> 0;
        results.push(runChallenge(def, skill, seed));
      }
      const cell = summarize("challenge", `${def.id}:${skill.name}`, results);
      cells.push(cell);
    }
  }
  return cells;
}

function hashCell(a: string, b: string, i: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${a}|${b}|${i}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function main(argv: ReadonlyArray<string>): void {
  const args = parseArgs(argv);

  if (args.diff !== null) {
    const loadCells = (path: string, label: string): CellStats[] => {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch (err) {
        throw new Error(`Could not read ${label} file ${path}: ${(err as Error).message}`);
      }
      try {
        return JSON.parse(raw) as CellStats[];
      } catch (err) {
        throw new Error(`Could not parse JSON from ${label} file ${path}: ${(err as Error).message}`);
      }
    };
    const baseline = loadCells(args.diff.baseline, "baseline");
    const proposed = loadCells(args.diff.proposed, "proposed");
    console.log(formatDiff(buildDiff(baseline, proposed)));
    return;
  }

  if (args.audit) {
    auditTierShares();
    return;
  }

  const t0 = Date.now();
  const endless = runEndlessGrid(args.n, args.seed);
  const dt = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`# Endless mode (N=${args.n}, seed=${args.seed}, ${dt}s)\n`);
  console.log(formatTable(endless));

  let challenge: CellStats[] = [];
  if (args.challenges) {
    const t1 = Date.now();
    challenge = runChallengeGrid(Math.min(args.n, 200), args.seed);
    const dt1 = ((Date.now() - t1) / 1000).toFixed(2);
    console.log(`\n\n# Challenges (N=${Math.min(args.n, 200)}, ${dt1}s, mid-block sample)\n`);
    console.log(formatTable(challenge));
  }

  if (args.json !== null) {
    writeFileSync(args.json, JSON.stringify(endless.concat(challenge), null, 2));
    console.log(`\n# Wrote ${args.json}`);
  }
}

main(process.argv.slice(2));
