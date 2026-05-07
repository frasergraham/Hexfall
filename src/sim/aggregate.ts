// Aggregation helpers: percentiles, death-cause histograms, and a
// markdown table formatter for the simulator output.

import type { Difficulty } from "../types";
import type { DeathCause, RunResult } from "./types";

export interface CellStats {
  difficulty: Difficulty | "challenge";
  skill: string;
  n: number;
  median: number;
  p10: number;
  p90: number;
  mean: number;
  meanDurationSec: number;
  helpfulCaughtMean: number;
  fastPayoutsMean: number;
  deathCounts: Record<DeathCause, number>;
}

export function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

export function summarize(
  difficulty: Difficulty | "challenge",
  skill: string,
  results: ReadonlyArray<RunResult>,
): CellStats {
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const deathCounts: Record<DeathCause, number> = {
    combo: 0,
    timeoutScore: 0,
    timeoutSec: 0,
    wavesExhausted: 0,
  };
  let sum = 0;
  let durSum = 0;
  let helpfulSum = 0;
  let payoutSum = 0;
  for (const r of results) {
    sum += r.score;
    durSum += r.durationSec;
    helpfulSum += r.helpfulCaught;
    payoutSum += r.fastPayouts;
    deathCounts[r.death] += 1;
  }
  const n = results.length;
  return {
    difficulty,
    skill,
    n,
    median: quantile(scores, 0.5),
    p10: quantile(scores, 0.1),
    p90: quantile(scores, 0.9),
    mean: n === 0 ? 0 : sum / n,
    meanDurationSec: n === 0 ? 0 : durSum / n,
    helpfulCaughtMean: n === 0 ? 0 : helpfulSum / n,
    fastPayoutsMean: n === 0 ? 0 : payoutSum / n,
    deathCounts,
  };
}

function pct(num: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((num / total) * 100)}%`;
}

export function formatTable(cells: ReadonlyArray<CellStats>): string {
  const header =
    "| difficulty | skill | n | median | p10 | p90 | mean | dur(s) | helpful | combo% | runaway% |\n" +
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const rows = cells.map((c) => {
    const runaway = c.deathCounts.timeoutScore + c.deathCounts.wavesExhausted;
    return (
      `| ${c.difficulty} | ${c.skill} | ${c.n} | ` +
      `${Math.round(c.median)} | ${Math.round(c.p10)} | ${Math.round(c.p90)} | ` +
      `${Math.round(c.mean)} | ${c.meanDurationSec.toFixed(1)} | ` +
      `${c.helpfulCaughtMean.toFixed(1)} | ` +
      `${pct(c.deathCounts.combo, c.n)} | ${pct(runaway, c.n)} |`
    );
  });
  return [header, ...rows].join("\n");
}

export interface DiffRow {
  difficulty: Difficulty | "challenge";
  skill: string;
  baselineMedian: number;
  proposedMedian: number;
  delta: number;
  baselineCombo: number;
  proposedCombo: number;
}

export function buildDiff(
  baseline: ReadonlyArray<CellStats>,
  proposed: ReadonlyArray<CellStats>,
): DiffRow[] {
  const out: DiffRow[] = [];
  for (const b of baseline) {
    const p = proposed.find((x) => x.difficulty === b.difficulty && x.skill === b.skill);
    if (!p) continue;
    out.push({
      difficulty: b.difficulty,
      skill: b.skill,
      baselineMedian: b.median,
      proposedMedian: p.median,
      delta: p.median - b.median,
      baselineCombo: b.deathCounts.combo / Math.max(1, b.n),
      proposedCombo: p.deathCounts.combo / Math.max(1, p.n),
    });
  }
  return out;
}

export function formatDiff(rows: ReadonlyArray<DiffRow>): string {
  const header =
    "| difficulty | skill | baseline median | proposed median | Δ | combo% Δ |\n" +
    "|---|---|---:|---:|---:|---:|";
  const body = rows.map((r) => {
    const sign = r.delta > 0 ? "+" : "";
    const comboDelta = (r.proposedCombo - r.baselineCombo) * 100;
    const cdSign = comboDelta > 0 ? "+" : "";
    return (
      `| ${r.difficulty} | ${r.skill} | ${Math.round(r.baselineMedian)} | ` +
      `${Math.round(r.proposedMedian)} | ${sign}${Math.round(r.delta)} | ` +
      `${cdSign}${comboDelta.toFixed(1)}pp |`
    );
  });
  return [header, ...body].join("\n");
}
