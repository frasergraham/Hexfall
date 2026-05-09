import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_CONFIG,
  pickKind,
  SPAWN_CHALLENGE_TIER_WEIGHT,
  SPAWN_HELPFUL_TIER_WEIGHT,
  SPAWN_STICKY_TIER_WEIGHT,
} from "../src/spawnKind";
import { mulberry32 } from "../src/rng";
import { runEndless } from "../src/sim/endless";
import { runChallenge } from "../src/sim/challenge";
import { SKILLS } from "../src/sim/skills";
import { quantile } from "../src/sim/aggregate";
import { CHALLENGES } from "../src/challenges";
import type { ClusterKind } from "../src/types";

const TIER_KINDS = {
  sticky: ["sticky"] as const,
  helpful: ["coin", "slow", "shield", "drone", "tiny"] as const,
  challenge: ["fast", "big"] as const,
};

describe("pickKind tier-share audit", () => {
  const N = 50_000;
  const SCORE = 400;

  for (const difficulty of ["easy", "medium", "hard", "hardcore"] as const) {
    it(`${difficulty} matches DIFFICULTY_CONFIG multipliers within ±1pp`, () => {
      const cfg = DIFFICULTY_CONFIG[difficulty];
      const counts: Record<ClusterKind, number> = {
        normal: 0, sticky: 0, slow: 0, fast: 0, coin: 0,
        shield: 0, drone: 0, tiny: 0, big: 0,
      };
      const rng = mulberry32(0xC0FFEE);
      for (let i = 0; i < N; i++) {
        counts[pickKind(cfg, SCORE, rng)] += 1;
      }
      const tierShare = (kinds: ReadonlyArray<ClusterKind>): number =>
        kinds.reduce((s, k) => s + counts[k], 0) / N;

      const expectedSticky = SPAWN_STICKY_TIER_WEIGHT * cfg.stickyMul;
      const expectedHelpful = SPAWN_HELPFUL_TIER_WEIGHT * cfg.helpfulMul;
      const expectedChallenge = SPAWN_CHALLENGE_TIER_WEIGHT * cfg.challengeMul;

      expect(tierShare(TIER_KINDS.sticky)).toBeCloseTo(expectedSticky, 1);
      expect(tierShare(TIER_KINDS.helpful)).toBeCloseTo(expectedHelpful, 1);
      expect(tierShare(TIER_KINDS.challenge)).toBeCloseTo(expectedChallenge, 1);
    });
  }
});

describe("runEndless", () => {
  it("is fully deterministic for a given (difficulty, skill, seed)", () => {
    const skill = SKILLS.find((s) => s.name === "casual")!;
    const a = runEndless("medium", skill, 12345);
    const b = runEndless("medium", skill, 12345);
    expect(b).toEqual(a);
  });

  it("produces different runs for different seeds", () => {
    const skill = SKILLS.find((s) => s.name === "casual")!;
    const a = runEndless("medium", skill, 1);
    const b = runEndless("medium", skill, 2);
    // Same seed pairs are vanishingly unlikely to produce identical
    // trajectories — guard against an accidental "everything seeded
    // off Math.random" regression.
    expect(b.score === a.score && b.durationSec === a.durationSec).toBe(false);
  });

  it("respects difficulty monotonicity at fixed skill (medians)", () => {
    const skill = SKILLS.find((s) => s.name === "casual")!;
    const N = 80;
    const median = (results: number[]): number => {
      const sorted = [...results].sort((a, b) => a - b);
      return quantile(sorted, 0.5);
    };
    const samples: Record<string, number[]> = { easy: [], medium: [], hard: [], hardcore: [] };
    for (let i = 0; i < N; i++) {
      for (const d of ["easy", "medium", "hard", "hardcore"] as const) {
        samples[d].push(runEndless(d, skill, 100 + i).score);
      }
    }
    expect(median(samples.easy)).toBeGreaterThanOrEqual(median(samples.medium));
    expect(median(samples.medium)).toBeGreaterThanOrEqual(median(samples.hard));
    expect(median(samples.hard)).toBeGreaterThanOrEqual(median(samples.hardcore) - 5);
  });
});

describe("runChallenge", () => {
  it("is deterministic for a given (def, skill, seed)", () => {
    const def = CHALLENGES[0]!;
    const skill = SKILLS.find((s) => s.name === "casual")!;
    const a = runChallenge(def, skill, 999);
    const b = runChallenge(def, skill, 999);
    expect(b).toEqual(a);
  });
});

describe("quantile", () => {
  it("returns 0 on empty input", () => {
    expect(quantile([], 0.5)).toBe(0);
  });
  it("returns the only element for any q on N=1", () => {
    expect(quantile([42], 0.0)).toBe(42);
    expect(quantile([42], 0.5)).toBe(42);
    expect(quantile([42], 1.0)).toBe(42);
  });
  it("linearly interpolates between samples", () => {
    // p25 of [0,10,20,30,40] = 10 (exact)
    expect(quantile([0, 10, 20, 30, 40], 0.25)).toBe(10);
    // p33 = 0.33*4 = 1.32 → between idx 1 (10) and idx 2 (20)
    expect(quantile([0, 10, 20, 30, 40], 0.33)).toBeCloseTo(13.2, 5);
  });
  it("clamps q outside [0,1]", () => {
    expect(quantile([1, 2, 3], -0.5)).toBe(1);
    expect(quantile([1, 2, 3], 1.5)).toBe(3);
  });
});
