// Wave presets for the Challenge Editor. Each preset is a compact
// recipe with 1-2 user-tweakable parameters that compose into a base
// DSL line via build(). The cluster mix (`pct`) is exposed separately
// so the dialog can render it as a primary control above ADVANCED —
// the user keeps their mix tweaks even if they nudge a preset slider.
//
// Adding a preset: pick a short name and 1-2 params that meaningfully
// shape the wave. Default values should produce a "decent" wave on
// their own; the params are levers, not full controls. `pct` weights
// are 0-100 and should sum to 100.

import type { ClusterKind } from "./types";

export interface WavePresetParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export type PctMap = Partial<Record<ClusterKind, number>>;

export interface WavePreset {
  id: string;
  name: string;
  blurb: string;
  params: WavePresetParam[];
  pct: PctMap;            // % weights, summing to 100
  build(values: Record<string, number>): string;  // base DSL without pct=
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const WAVE_PRESETS: WavePreset[] = [
  {
    id: "calm",
    name: "Calm",
    blurb: "Easy starter — slow falls, mostly normal blocks.",
    params: [
      { id: "count", label: "Count", min: 4, max: 20, step: 1, default: 8 },
      { id: "speed", label: "Speed", min: 0.8, max: 1.5, step: 0.05, default: 1.0 },
    ],
    pct: { normal: 75, coin: 25 },
    build(v) {
      const count = num(v.count, 8);
      const speed = num(v.speed, 1.0);
      return `size=2-3, rate=0.85, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
  {
    id: "lightRain",
    name: "Light Rain",
    blurb: "Single hexes drizzling down.",
    params: [
      { id: "count", label: "Count", min: 8, max: 30, step: 1, default: 16 },
      { id: "speed", label: "Speed", min: 1.0, max: 2.0, step: 0.05, default: 1.2 },
    ],
    pct: { normal: 100 },
    build(v) {
      const count = num(v.count, 16);
      const speed = num(v.speed, 1.2);
      return `size=1, rate=0.22, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
  {
    id: "heavyRain",
    name: "Heavy Rain",
    blurb: "Dense single-hex downpour.",
    params: [
      { id: "count", label: "Count", min: 14, max: 40, step: 1, default: 24 },
      { id: "speed", label: "Speed", min: 1.2, max: 2.2, step: 0.05, default: 1.5 },
    ],
    pct: { normal: 100 },
    build(v) {
      const count = num(v.count, 24);
      const speed = num(v.speed, 1.5);
      return `size=1, rate=0.16, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
  {
    id: "powerUps",
    name: "Power-up Mix",
    blurb: "Heavy power-up rotation: coin, sticky, fast, slow.",
    params: [
      { id: "count", label: "Count", min: 6, max: 16, step: 1, default: 10 },
      { id: "speed", label: "Speed", min: 1.0, max: 1.8, step: 0.05, default: 1.3 },
    ],
    pct: { normal: 55, coin: 15, sticky: 15, fast: 10, slow: 5 },
    build(v) {
      const count = num(v.count, 10);
      const speed = num(v.speed, 1.3);
      return `size=2-3, rate=0.7, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
  {
    id: "pinch",
    name: "Pinch Walls",
    blurb: "Pinched corridor with a power-up sprinkle.",
    params: [
      { id: "count", label: "Count", min: 6, max: 18, step: 1, default: 10 },
      { id: "speed", label: "Speed", min: 1.0, max: 1.8, step: 0.05, default: 1.3 },
    ],
    pct: { normal: 75, coin: 15, sticky: 10 },
    build(v) {
      const count = num(v.count, 10);
      const speed = num(v.speed, 1.3);
      return `size=2-3, rate=0.7, speed=${speed.toFixed(2)}, count=${count}, walls=pinch`;
    },
  },
  {
    id: "narrow",
    name: "Narrow Run",
    blurb: "Tight corridor; small clusters only.",
    params: [
      { id: "count", label: "Count", min: 6, max: 16, step: 1, default: 10 },
      { id: "speed", label: "Speed", min: 1.2, max: 2.2, step: 0.05, default: 1.5 },
    ],
    pct: { normal: 65, sticky: 20, fast: 10, coin: 5 },
    build(v) {
      const count = num(v.count, 10);
      const speed = num(v.speed, 1.5);
      return `size=2, rate=0.55, speed=${speed.toFixed(2)}, count=${count}, walls=narrow`;
    },
  },
  {
    id: "zigzag",
    name: "Zigzag",
    blurb: "Sinusoidal walls — read the rhythm.",
    params: [
      { id: "count", label: "Count", min: 8, max: 18, step: 1, default: 11 },
      { id: "amp", label: "Amplitude", min: 0.1, max: 0.4, step: 0.02, default: 0.22 },
    ],
    pct: { normal: 70, fast: 15, coin: 15 },
    build(v) {
      const count = num(v.count, 11);
      const amp = num(v.amp, 0.22);
      return `size=2-3, rate=0.55, speed=1.4, count=${count}, walls=zigzag, wallAmp=${amp.toFixed(2)}`;
    },
  },
  {
    id: "speedRun",
    name: "Speed Run",
    blurb: "Fast-falling cluster ladder.",
    params: [
      { id: "count", label: "Count", min: 8, max: 20, step: 1, default: 12 },
      { id: "speed", label: "Speed", min: 1.6, max: 2.5, step: 0.05, default: 1.9 },
    ],
    pct: { normal: 75, fast: 15, coin: 10 },
    build(v) {
      const speed = num(v.speed, 1.9);
      const count = num(v.count, 12);
      return `size=2-3, rate=0.5, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
  {
    id: "coinRush",
    name: "Coin Rush",
    blurb: "Coin-heavy mix — easy points if you can grab them.",
    params: [
      { id: "count", label: "Count", min: 6, max: 18, step: 1, default: 12 },
      { id: "speed", label: "Speed", min: 1.0, max: 1.8, step: 0.05, default: 1.3 },
    ],
    pct: { normal: 50, coin: 50 },
    build(v) {
      const count = num(v.count, 12);
      const speed = num(v.speed, 1.3);
      return `size=2-3, rate=0.6, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
  {
    id: "healTime",
    name: "Heal Time",
    blurb: "Sticky-heavy — shrink the blob.",
    params: [
      { id: "count", label: "Count", min: 6, max: 16, step: 1, default: 9 },
      { id: "speed", label: "Speed", min: 1.0, max: 1.6, step: 0.05, default: 1.2 },
    ],
    pct: { normal: 50, sticky: 40, coin: 10 },
    build(v) {
      const count = num(v.count, 9);
      const speed = num(v.speed, 1.2);
      return `size=2-3, rate=0.75, speed=${speed.toFixed(2)}, count=${count}`;
    },
  },
];

export function getPreset(id: string): WavePreset | undefined {
  return WAVE_PRESETS.find((p) => p.id === id);
}

// Default values for a preset's params, indexed by param id.
export function presetDefaults(p: WavePreset): Record<string, number> {
  const out: Record<string, number> = {};
  for (const param of p.params) out[param.id] = param.default;
  return out;
}

// Expand a preset's `pct` into a complete 7-key map summing to 100.
// Missing kinds → 0; total renormalised so the auto-balance against
// `normal` always starts from a clean slate.
const ALL_KINDS: ClusterKind[] = ["normal", "sticky", "slow", "fast", "coin", "shield", "drone"];

export function presetMix(p: WavePreset): Record<ClusterKind, number> {
  const out = {} as Record<ClusterKind, number>;
  let sum = 0;
  for (const k of ALL_KINDS) {
    const v = Math.max(0, Math.round(p.pct[k] ?? 0));
    out[k] = v;
    sum += v;
  }
  if (sum === 0) {
    out.normal = 100;
    return out;
  }
  if (sum !== 100) {
    // Renormalise to 100, then dump the rounding remainder onto normal.
    let rebalanced = 0;
    for (const k of ALL_KINDS) {
      out[k] = Math.round((out[k] / sum) * 100);
      rebalanced += out[k];
    }
    out.normal += 100 - rebalanced;
    if (out.normal < 0) out.normal = 0;
  }
  return out;
}
