// Challenge definitions + persistence for HexRain's challenge mode.
//
// Each challenge is a finite, scripted run defined as a list of wave
// strings (parsed by waveDsl). The roster lives in CHALLENGES; progress
// (best score per challenge, completion list, unlocked blocks) is
// stored under a single localStorage key.

import type { ClusterKind } from "./types";
import { parseWaveLine, validateChallenge, type ChallengeDefLike } from "./waveDsl";
import { syncProgressUp } from "./cloudSync";

export interface ChallengeDef extends ChallengeDefLike {
  // ChallengeDefLike already includes id, name, difficulty, block, index, effects, waves.
}

export interface ChallengeProgress {
  v: 1;
  best: Record<string, number>;
  /** Best percentage (0-100) the player has reached in each challenge. */
  bestPct: Record<string, number>;
  /** Best star count (0..3) awarded on a 100% completion. */
  stars: Record<string, number>;
  completed: string[];
  unlockedBlocks: number[];
  /** Set true when the player owns the iOS "Unlock All Challenges" IAP. */
  purchasedUnlock: boolean;
}

export interface ChallengeStarThresholds {
  /** Score needed for 1 star — barely-winning baseline. */
  one: number;
  /** Score needed for 2 stars — pickups + partial bonus. */
  two: number;
  /** Score needed for 3 stars — near upper bound. */
  three: number;
}

const STORAGE_KEY = "hexrain.challenges.v1";

// `?debug=1` unlocks every block immediately and disables challenge-progress
// persistence so test runs (including the 199 / 399 / 599 score buttons) don't
// pollute real save data.
const DEBUG_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

const ALL_BLOCKS = [1, 2, 3, 4, 5, 6];

const EMPTY_PROGRESS: ChallengeProgress = {
  v: 1,
  best: {},
  bestPct: {},
  stars: {},
  completed: [],
  unlockedBlocks: [1],
  purchasedUnlock: false,
};

// CHALLENGES roster. Filled in by hand/generated content; validated at
// dev module load. See challenge.md §11 for the generation strategy.
export const CHALLENGES: ChallengeDef[] = [
  // === Block 1 — First Steps. Intro to the basics, but with rain bursts and a few power-ups so it's never just boring blocks. ===
  {
    id: "1-1", name: "First Drops", block: 1, index: 1, difficulty: 1,
    waves: [
      "size=1-2, rate=1.0, speed=1.0, count=6, pct=normal:75,coin:25",
      "size=2, rate=0.85, speed=1.05, count=7, pct=normal:65,coin:35",
      "size=1, rate=0.25, speed=1.05, count=14",                         // first rain
      "size=2-3, rate=0.8, speed=1.1, count=8, pct=normal:60,sticky:10,coin:30",   // single heal sprinkle
      "size=2, rate=0.75, speed=1.15, count=9, pct=normal:70,coin:30",
      "size=1, rate=0.22, speed=1.15, count=16",                         // rain
      "size=2-3, rate=0.7, speed=1.2, count=10, pct=normal:65,coin:35",
      "size=3, rate=0.7, speed=1.25, count=10, pct=normal:70,coin:30",
      "size=1, rate=0.2, speed=1.25, count=18",                          // bigger rain
      "size=2-3, rate=0.65, speed=1.3, count=11, pct=normal:60,sticky:10,coin:30",
    ],
  },
  {
    id: "1-2", name: "Easy Rain", block: 1, index: 2, difficulty: 2,
    waves: [
      "size=2, rate=0.9, speed=1.05, count=6, pct=normal:70,coin:30",
      "size=1, rate=0.22, speed=1.1, count=14",
      "size=2-3, rate=0.8, speed=1.15, count=8, pct=normal:65,coin:35",
      "size=1, rate=0.2, speed=1.2, count=16",
      "count=0, slotRate=0.55, speed=1.15, 130,230,330,430,530,000,330,230",
      "size=2-3, rate=0.7, speed=1.25, count=10, pct=normal:60,sticky:10,coin:30",  // mid heal
      "size=1, rate=0.18, speed=1.3, count=20",                          // dense
      "size=3, rate=0.65, speed=1.3, count=11, pct=normal:65,coin:35",
      "size=1, rate=0.18, speed=1.35, count=22",
      "size=3-4, rate=0.6, speed=1.4, count=12, pct=normal:65,coin:35",
      "size=1, rate=0.16, speed=1.45, count=24",                         // finale rain
      "size=3, rate=0.55, speed=1.5, count=13, pct=normal:60,sticky:10,coin:30",  // late heal
    ],
  },
  {
    id: "1-3", name: "Slow Roll", block: 1, index: 3, difficulty: 2,
    effects: { slowDuration: 6 },
    waves: [
      "size=2-3, rate=0.9, speed=1.0, count=7, pct=normal:70,coin:30",
      "size=1, rate=0.22, speed=1.1, count=15",
      "size=3, rate=0.8, speed=1.15, count=9, pct=normal:55,coin:30,slow:15",   // slow intro
      "count=0, slotRate=0.55, speed=1.15, 230,330,430,000,330,230,430,330",
      "size=1, rate=0.2, speed=1.2, count=17",
      "size=3, rate=0.75, speed=1.25, count=10, pct=normal:45,slow:20,sticky:10,coin:25",   // mid heal
      "size=1, rate=0.18, speed=1.25, count=18",
      "size=3-4, rate=0.7, speed=1.3, count=11, pct=normal:65,coin:35",
      "size=1, rate=0.18, speed=1.3, count=20",                          // breath of rain
      "size=3, rate=0.65, speed=1.35, count=12, pct=normal:45,slow:20,sticky:10,coin:25",   // late heal
      "count=0, slotRate=0.5, speed=1.35, 230,330,430,000,330,230,430,000,330,430",
      "size=1, rate=0.16, speed=1.45, count=24",
    ],
  },
  {
    id: "1-4", name: "Open Sky", block: 1, index: 4, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.05, count=7, pct=normal:70,coin:30",
      "count=0, slotRate=0.55, speed=1.1, 137,000,237,000,337,000,237,137",
      "size=1, rate=0.22, speed=1.15, count=15",
      "size=3, rate=0.8, speed=1.2, count=9, pct=normal:50,sticky:25,coin:25",  // first heal blocks
      "count=0, slotRate=0.5, speed=1.2, 048,000,148,000,248,000,348,000",
      "size=1, rate=0.2, speed=1.25, count=17",
      "size=3-4, rate=0.7, speed=1.3, count=10, pct=normal:45,sticky:30,coin:25",
      "count=0, slotRate=0.5, speed=1.3, 037,148,037,148,237,348,037,148",
      "size=1, rate=0.18, speed=1.35, count=20",
      "size=3-4, rate=0.65, speed=1.4, count=12, pct=normal:65,coin:35",
      "size=4, rate=0.6, speed=1.45, count=13, pct=normal:50,sticky:25,coin:25",
      "size=1, rate=0.16, speed=1.5, count=24",
      "count=0, slotRate=0.45, speed=1.5, 037,148,237,348,037,148,237,348,137",
    ],
  },
  {
    id: "1-5", name: "Soft Landing", block: 1, index: 5, difficulty: 3,
    effects: { slowDuration: 6, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.1, count=8",
      "size=1, rate=0.2, speed=1.2, count=16",
      "size=3, rate=0.75, speed=1.25, count=9, pct=normal:65,fast:20,coin:15",   // first fast
      "count=0, slotRate=0.55, speed=1.2, 130,230,330,430,530,000,330,230,430",
      "size=1, rate=0.18, speed=1.3, count=18",
      "size=3, rate=0.7, speed=1.3, count=10, pct=normal:55,sticky:25,fast:10,coin:10",
      "size=1, rate=0.18, speed=1.35, count=20",
      "size=3-4, rate=0.65, speed=1.4, count=11, pct=normal:55,slow:15,fast:15,coin:15",
      "count=0, slotRate=0.5, speed=1.4, 140,340,540,000,240,440,140,340,540",
      "size=1, rate=0.16, speed=1.45, count=22",
      "size=3-4, rate=0.6, speed=1.5, count=12",
      "size=4, rate=0.55, speed=1.55, count=13, pct=normal:60,fast:20,sticky:10,coin:10",
      "size=1, rate=0.15, speed=1.6, count=26",
    ],
  },

  // === Block 2 — Climbing. Walls + sticky/fast layered into rain bursts. ===
  {
    id: "2-1", name: "Squeeze Play", block: 2, index: 1, difficulty: 2,
    waves: [
      "size=2-3, rate=0.9, speed=1.05, count=7",
      "size=1, rate=0.2, speed=1.1, count=15",
      "size=3, rate=0.8, speed=1.15, count=8, walls=pinch, pct=normal:80,coin:20",
      "size=1, rate=0.18, speed=1.2, count=17, walls=pinch",
      "size=3, rate=0.75, speed=1.25, count=10, walls=pinch, pct=normal:65,sticky:25,coin:10",
      "count=0, slotRate=0.5, speed=1.2, walls=pinch, 230,330,430,000,330,430,230,000,330",
      "size=1, rate=0.18, speed=1.3, count=20, walls=pinch",
      "size=3-4, rate=0.7, speed=1.3, count=11, walls=pinch, pct=normal:70,fast:15,coin:15",
      "size=1, rate=0.16, speed=1.35, count=22, walls=pinch",
      "size=3-4, rate=0.65, speed=1.4, count=12, walls=pinch, pct=normal:60,sticky:20,fast:10,coin:10",
      "size=1, rate=0.16, speed=1.4, count=24",
      "count=0, slotRate=0.45, speed=1.45, walls=pinch, 230,330,430,000,330,230,430,000,330",
    ],
  },
  {
    id: "2-2", name: "Side Step", block: 2, index: 2, difficulty: 2,
    waves: [
      "size=2-3, rate=0.9, speed=1.1, count=7",
      "count=0, slotRate=0.55, speed=1.15, 137,000,237,000,337,000,137,237",
      "size=1, rate=0.2, speed=1.2, count=16",
      "count=0, slotRate=0.5, speed=1.2, 048,000,148,000,248,000,348,000,148",
      "size=3, rate=0.8, speed=1.25, count=9, pct=normal:65,sticky:25,coin:10",
      "size=1, rate=0.18, speed=1.3, count=18",
      "count=0, slotRate=0.5, speed=1.3, 037,148,037,148,237,348,037,148,237",
      "size=3-4, rate=0.7, speed=1.35, count=11, pct=normal:65,fast:20,coin:15",
      "size=1, rate=0.18, speed=1.4, count=20",
      "size=3-4, rate=0.65, speed=1.4, count=12, walls=pinch, pct=normal:65,sticky:20,fast:10,coin:5",
      "count=0, slotRate=0.45, speed=1.45, 037,148,037,148,237,348,137,148,037,348",
      "size=1, rate=0.15, speed=1.5, count=24",
    ],
  },
  {
    id: "2-3", name: "Coin Run", block: 2, index: 3, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.1, count=7, pct=normal:55,coin:45",
      "size=1, rate=0.2, speed=1.2, count=16",
      "size=3, rate=0.75, speed=1.25, count=10, pct=normal:50,coin:50",
      "count=0, slotRate=0.55, speed=1.15, 130,230,330,430,530,330,230,000,330",
      "size=1, rate=0.18, speed=1.3, count=18",
      "size=3, rate=0.7, speed=1.35, count=11, walls=pinch, pct=normal:50,coin:40,fast:10",
      "size=1, rate=0.18, speed=1.35, count=20",
      "count=0, slotRate=0.5, speed=1.3, 140,240,340,440,540,440,340,240,140",
      "size=3-4, rate=0.6, speed=1.45, count=12, walls=pinch, pct=normal:55,coin:35,sticky:10",
      "size=1, rate=0.16, speed=1.5, count=22",
      "size=4, rate=0.55, speed=1.55, count=14, pct=normal:55,coin:25,sticky:10,fast:10",
      "size=1, rate=0.15, speed=1.6, count=26",
    ],
  },
  {
    id: "2-4", name: "Tight Lane", block: 2, index: 4, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.9, speed=1.1, count=8",
      "size=1, rate=0.2, speed=1.2, count=15, walls=pinch",
      // Pre-narrow relief — sticky-heavy so the player can shrink down
      // before the first narrow gauntlet.
      "size=2-3, rate=0.85, speed=1.15, count=8, pct=normal:50,sticky:40,coin:10",
      "size=3, rate=0.75, speed=1.2, count=9, walls=narrow",
      "size=1, rate=0.18, speed=1.25, count=18, walls=narrow",
      "count=0, slotRate=0.5, speed=1.25, walls=narrow, 230,330,430,000,330,430,230,330",
      // Mid-challenge breather: pinch instead of narrow + heavy heal mix.
      "size=2-3, rate=0.8, speed=1.25, count=10, walls=pinch, pct=normal:55,sticky:30,coin:15",
      "size=1, rate=0.18, speed=1.35, count=20",
      // Second narrow run, with helpers.
      "size=3, rate=0.65, speed=1.4, count=11, walls=narrow, pct=normal:55,sticky:20,fast:15,slow:10",
      "count=0, slotRate=0.45, speed=1.4, walls=narrow, 130,230,330,000,230,330,130,000,230",
      // Pre-finale relief — heals + slow before the closer.
      "size=2-3, rate=0.7, speed=1.4, count=11, pct=normal:50,sticky:35,slow:10,coin:5",
      "size=1, rate=0.15, speed=1.6, count=26",
      "size=3, rate=0.55, speed=1.6, count=13, walls=narrow, pct=normal:60,sticky:15,fast:15,coin:10",
    ],
  },
  {
    id: "2-5", name: "Pressure Cooker", block: 2, index: 5, difficulty: 4,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.15, count=8",
      "size=1, rate=0.2, speed=1.25, count=16",
      "size=3, rate=0.75, speed=1.3, count=9, walls=pinch, pct=normal:65,sticky:20,fast:10,coin:5",
      "size=1, rate=0.18, speed=1.35, count=18, walls=pinch",
      "count=0, slotRate=0.5, speed=1.35, walls=pinch, 130,230,330,430,530,330,230,130,330",
      "size=1, rate=0.18, speed=1.4, count=20",
      "size=3-4, rate=0.7, speed=1.45, count=11, walls=pinch, pct=normal:55,fast:20,slow:15,sticky:10",
      "size=1, rate=0.16, speed=1.45, count=22, walls=pinch",
      "size=3-4, rate=0.65, speed=1.5, count=12, walls=narrow",
      "count=0, slotRate=0.45, speed=1.45, walls=narrow, 230,330,430,000,330,230,430,000,330",
      "size=1, rate=0.16, speed=1.55, count=24",
      "size=3, rate=0.55, speed=1.6, count=14, walls=narrow, pct=normal:55,fast:15,sticky:20,coin:10",
      "size=1, rate=0.15, speed=1.65, count=26, walls=narrow",
      "count=0, slotRate=0.4, speed=1.65, walls=narrow, 130,230,330,000,230,330,130,000,230",
    ],
  },

  // === Block 3 — Halfway There. Zigzag-heavy with sticky/fast layered into rain. ===
  {
    id: "3-1", name: "Zig and Zag", block: 3, index: 1, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.15, count=8",
      "size=1, rate=0.2, speed=1.2, count=16",
      "size=3, rate=0.8, speed=1.2, count=9, walls=zigzag, pct=normal:75,coin:15,sticky:10",
      "size=1, rate=0.18, speed=1.25, count=18, walls=zigzag",
      "count=0, slotRate=0.5, speed=1.25, walls=zigzag, 130,230,330,430,530,330,230,130,330",
      "size=3-4, rate=0.7, speed=1.3, count=11, walls=zigzag, pct=normal:65,fast:20,coin:10,sticky:5",
      "size=1, rate=0.18, speed=1.35, count=20, walls=zigzag",
      "size=3-4, rate=0.65, speed=1.4, count=12, walls=zigzag",
      "count=0, slotRate=0.45, speed=1.4, walls=zigzag, 140,340,540,000,240,440,140,340,540",
      "size=1, rate=0.16, speed=1.45, count=22, walls=zigzag",
      "size=3-4, rate=0.55, speed=1.5, count=13, walls=zigzag, pct=normal:55,fast:15,sticky:20,coin:5,tiny:5",
      "size=1, rate=0.15, speed=1.55, count=26, walls=zigzag",
    ],
  },
  {
    id: "3-2", name: "Wall Crawler", block: 3, index: 2, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.85, speed=1.2, count=8",
      "size=1, rate=0.2, speed=1.25, count=16, walls=pinch",
      "size=3, rate=0.75, speed=1.3, count=9, walls=zigzag, pct=normal:65,sticky:25,coin:10",
      "size=1, rate=0.18, speed=1.3, count=18, walls=narrow",
      "count=0, slotRate=0.5, speed=1.3, walls=narrow, 230,330,430,000,330,430,230,000,330",
      "size=3, rate=0.7, speed=1.35, count=10, walls=zigzag, pct=normal:60,fast:20,slow:10,coin:10",
      "size=1, rate=0.18, speed=1.4, count=20, walls=zigzag",
      "size=3-4, rate=0.65, speed=1.45, count=11, walls=pinch",
      "size=1, rate=0.16, speed=1.5, count=22, walls=narrow",
      "count=0, slotRate=0.45, speed=1.45, walls=zigzag, 130,230,330,430,530,000,230,330,430",
      "size=3-4, rate=0.6, speed=1.55, count=12, walls=narrow, pct=normal:55,fast:15,sticky:15,slow:10,coin:5",
      "size=1, rate=0.15, speed=1.6, count=26, walls=zigzag",
      "size=3, rate=0.5, speed=1.65, count=14, walls=narrow, pct=normal:55,sticky:25,fast:15,coin:5",
    ],
  },
  {
    id: "3-3", name: "Heal & Hope", block: 3, index: 3, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.85, speed=1.15, count=8, pct=normal:65,sticky:25,coin:10",
      "size=1, rate=0.2, speed=1.25, count=16",
      "size=3, rate=0.75, speed=1.25, count=9, pct=normal:55,sticky:35,coin:10",
      "size=1, rate=0.18, speed=1.3, count=18",
      "size=3-4, rate=0.7, speed=1.35, count=10, walls=pinch, pct=normal:55,sticky:30,coin:15",
      "count=0, slotRate=0.5, speed=1.3, walls=pinch, 130,230,330,430,530,000,230,330,430",
      "size=1, rate=0.16, speed=1.4, count=22",
      "size=3-4, rate=0.65, speed=1.45, count=12, walls=zigzag, pct=normal:50,sticky:30,fast:5,coin:10,tiny:5",
      "size=1, rate=0.16, speed=1.5, count=24, walls=zigzag",
      "size=3-4, rate=0.55, speed=1.55, count=13, pct=normal:55,sticky:30,fast:5,coin:10",
      "count=0, slotRate=0.45, speed=1.5, walls=zigzag, 130,330,530,000,230,430,000,130,330,530",
      "size=1, rate=0.15, speed=1.6, count=26",
      "size=3, rate=0.5, speed=1.65, count=14, walls=zigzag, pct=normal:50,sticky:35,coin:15",
    ],
  },
  {
    id: "3-4", name: "Hex Switchback", block: 3, index: 4, difficulty: 4,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.2, count=8",
      "size=1, rate=0.2, speed=1.3, count=16, walls=zigzag",
      "size=3, rate=0.75, speed=1.3, count=9, walls=zigzag, pct=normal:60,fast:20,sticky:10,coin:10",
      "count=0, slotRate=0.5, speed=1.3, walls=zigzag, 130,230,330,430,530,330,230,130,330",
      "size=1, rate=0.18, speed=1.4, count=20, walls=zigzag",
      "size=3-4, rate=0.7, speed=1.4, count=11, walls=zigzag, pct=normal:50,fast:25,slow:10,sticky:10,tiny:5",
      "size=1, rate=0.18, speed=1.45, count=22, walls=zigzag",
      "count=0, slotRate=0.45, speed=1.45, walls=zigzag, 140,240,340,440,540,000,340,440,540,440,340",
      "size=3-4, rate=0.6, speed=1.55, count=12, walls=narrow",
      "size=1, rate=0.16, speed=1.6, count=24, walls=zigzag",
      "size=3, rate=0.5, speed=1.65, count=14, walls=zigzag, pct=normal:60,fast:20,sticky:10,coin:10",
      "count=0, slotRate=0.4, speed=1.65, walls=zigzag, 130,230,330,430,530,000,230,330,430,000,130,530",
      "size=1, rate=0.15, speed=1.7, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=1.75, count=15, walls=zigzag, pct=normal:55,sticky:25,fast:10,big:5,coin:5",
    ],
  },
  {
    id: "3-5", name: "Demon Run", block: 3, index: 5, difficulty: 5,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.8, speed=1.25, count=8",
      "size=1, rate=0.18, speed=1.3, count=18, walls=zigzag",
      "size=3, rate=0.7, speed=1.4, count=10, walls=zigzag, pct=normal:55,fast:20,sticky:15,coin:10",
      "count=0, slotRate=0.45, speed=1.35, walls=zigzag, 130,230,330,430,530,000,330,230,430,530,130",
      "size=1, rate=0.16, speed=1.45, count=20, walls=zigzag",
      "size=3-4, rate=0.65, speed=1.5, count=11, walls=zigzag, pct=normal:45,fast:25,slow:10,sticky:10,coin:5,tiny:5",
      "size=1, rate=0.16, speed=1.55, count=22, walls=zigzag",
      "count=0, slotRate=0.4, speed=1.55, walls=zigzag, 140,340,540,000,240,440,140,340,540,440,340,240",
      "size=3-4, rate=0.55, speed=1.6, count=13, walls=narrow",
      "size=1, rate=0.15, speed=1.65, count=24, walls=zigzag",
      "size=3, rate=0.5, speed=1.7, count=14, walls=zigzag, pct=normal:55,fast:25,sticky:10,coin:10",
      "count=0, slotRate=0.4, speed=1.7, walls=zigzag, 140,340,540,000,240,440,000,340,540,440,340,240,140",
      "size=1, rate=0.14, speed=1.75, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=1.8, count=15, walls=zigzag, pct=normal:50,sticky:30,fast:10,big:5,coin:5",
      "size=1, rate=0.14, speed=1.85, count=30, walls=zigzag",
    ],
  },

  // === Block 4 — Hex Veteran. Narrow corridors + fast/sticky in dense rain. ===
  {
    id: "4-1", name: "Narrow Margins", block: 4, index: 1, difficulty: 3,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.25, count=8",
      "size=1, rate=0.2, speed=1.3, count=16, walls=narrow",
      "size=3, rate=0.75, speed=1.35, count=10, walls=narrow, pct=normal:65,sticky:20,fast:10,coin:5",
      "size=1, rate=0.18, speed=1.4, count=18, walls=narrow",
      "count=0, slotRate=0.45, speed=1.4, walls=narrow, 230,330,430,000,330,430,230,000,330",
      "size=3, rate=0.7, speed=1.45, count=11, walls=narrow, pct=normal:55,fast:25,slow:10,sticky:10",
      "size=1, rate=0.16, speed=1.5, count=22, walls=narrow",
      "size=3, rate=0.6, speed=1.55, count=12, walls=zigzag",
      "count=0, slotRate=0.4, speed=1.55, walls=narrow, 130,230,330,000,230,330,130,000,230,330",
      "size=1, rate=0.15, speed=1.6, count=24, walls=narrow",
      "size=3, rate=0.55, speed=1.65, count=13, walls=narrow, pct=normal:50,fast:20,sticky:20,coin:5,tiny:5",
      "size=1, rate=0.14, speed=1.7, count=28, walls=narrow",
      "size=3, rate=0.5, speed=1.75, count=14, walls=narrow, pct=normal:55,sticky:25,fast:15,coin:5",
      "size=1, rate=0.14, speed=1.8, count=30, walls=zigzag",
    ],
  },
  {
    id: "4-2", name: "Speed Trap", block: 4, index: 2, difficulty: 4,
    effects: { fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.3, count=9, pct=normal:65,fast:25,coin:10",
      "size=1, rate=0.18, speed=1.4, count=18",
      "size=3, rate=0.7, speed=1.45, count=10, walls=zigzag, pct=normal:55,fast:30,coin:15",
      "size=1, rate=0.16, speed=1.5, count=20, walls=zigzag",
      "count=0, slotRate=0.45, speed=1.5, walls=zigzag, 130,230,330,430,530,000,230,330,430",
      "size=3-4, rate=0.6, speed=1.6, count=12, walls=narrow, pct=normal:45,fast:25,slow:10,sticky:10,big:10",
      "size=1, rate=0.16, speed=1.65, count=22, walls=zigzag",
      "size=3, rate=0.55, speed=1.7, count=13, walls=zigzag",
      "count=0, slotRate=0.4, speed=1.65, walls=zigzag, 230,330,430,000,330,430,230,000,330",
      "size=1, rate=0.14, speed=1.75, count=24, walls=narrow",
      "size=3, rate=0.5, speed=1.8, count=14, walls=zigzag, pct=normal:45,fast:25,slow:5,sticky:20,big:5",
      "size=1, rate=0.14, speed=1.85, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=1.95, count=15, walls=narrow, pct=normal:50,sticky:25,fast:15,big:10",
      "size=1, rate=0.13, speed=2.0, count=32, walls=zigzag",
    ],
  },
  {
    id: "4-3", name: "The Funnel", block: 4, index: 3, difficulty: 4,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.3, count=9, walls=pinch",
      "size=1, rate=0.18, speed=1.4, count=18, walls=pinch",
      "size=3, rate=0.7, speed=1.45, count=10, walls=narrow, pct=normal:65,sticky:20,coin:15",
      "size=1, rate=0.16, speed=1.5, count=20, walls=narrow",
      "count=0, slotRate=0.45, speed=1.5, walls=narrow, 230,330,430,000,330,230,430,000,330",
      "size=3, rate=0.65, speed=1.55, count=11, walls=narrow, pct=normal:50,fast:25,slow:10,sticky:10,coin:5",
      "size=1, rate=0.16, speed=1.6, count=22, walls=narrow",
      "size=3, rate=0.6, speed=1.65, count=12, walls=zigzag",
      "size=1, rate=0.15, speed=1.7, count=24, walls=narrow",
      "count=0, slotRate=0.4, speed=1.65, walls=narrow, 230,330,430,000,330,430,230,000,330,430",
      "size=3, rate=0.55, speed=1.75, count=13, walls=narrow, pct=normal:45,fast:20,sticky:25,slow:5,tiny:5",
      "size=1, rate=0.14, speed=1.8, count=26, walls=narrow",
      "size=3, rate=0.5, speed=1.85, count=14, walls=narrow, pct=normal:55,sticky:25,fast:15,coin:5",
      "size=1, rate=0.13, speed=1.95, count=30, walls=narrow",
      "size=3, rate=0.45, speed=2.0, count=15, walls=narrow",
    ],
  },
  {
    id: "4-4", name: "Fast Forward", block: 4, index: 4, difficulty: 5,
    effects: { fastDuration: 4, slowDuration: 4 },
    waves: [
      "size=2-3, rate=0.8, speed=1.4, count=9",
      "size=1, rate=0.18, speed=1.5, count=18",
      "size=3, rate=0.7, speed=1.55, count=10, walls=zigzag, pct=normal:50,fast:35,coin:15",
      "size=1, rate=0.16, speed=1.6, count=20, walls=zigzag",
      "count=0, slotRate=0.45, speed=1.55, walls=zigzag, 130,230,330,430,530,000,230,330,430,530",
      "size=3, rate=0.6, speed=1.7, count=12, walls=narrow, pct=normal:40,fast:30,slow:10,sticky:10,big:10",
      "size=1, rate=0.15, speed=1.75, count=22, walls=zigzag",
      "size=3, rate=0.55, speed=1.8, count=13, walls=zigzag",
      "size=1, rate=0.14, speed=1.85, count=24, walls=narrow",
      "count=0, slotRate=0.4, speed=1.85, walls=zigzag, 140,340,540,000,240,440,140,340,540,440,340,240",
      "size=3, rate=0.5, speed=1.95, count=15, walls=zigzag, pct=normal:40,fast:25,slow:10,sticky:15,big:10",
      "size=1, rate=0.13, speed=2.0, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=2.1, count=16, walls=narrow",
      "size=1, rate=0.13, speed=2.15, count=32, walls=zigzag",
      "size=3, rate=0.4, speed=2.2, count=17, walls=zigzag, pct=normal:50,sticky:25,fast:15,big:10",
    ],
  },
  {
    id: "4-5", name: "The Vise", block: 4, index: 5, difficulty: 5,
    effects: { slowDuration: 4, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.35, count=9, walls=pinch",
      "size=1, rate=0.18, speed=1.45, count=18, walls=narrow",
      "size=3, rate=0.7, speed=1.5, count=10, walls=narrow, pct=normal:55,fast:20,sticky:15,slow:10",
      "size=1, rate=0.16, speed=1.55, count=20, walls=narrow",
      "count=0, slotRate=0.45, speed=1.5, walls=narrow, 230,330,430,000,330,430,230,000,330,430",
      "size=3, rate=0.65, speed=1.6, count=11, walls=narrow",
      "size=1, rate=0.15, speed=1.65, count=22, walls=narrow",
      "size=3, rate=0.6, speed=1.7, count=12, walls=narrow, pct=normal:45,fast:25,slow:15,sticky:10,tiny:5",
      "count=0, slotRate=0.4, speed=1.7, walls=narrow, 230,330,430,000,330,230,430,000,330,430,230",
      "size=1, rate=0.14, speed=1.8, count=24, walls=narrow",
      "size=3, rate=0.55, speed=1.85, count=13, walls=narrow",
      "size=1, rate=0.13, speed=1.9, count=28, walls=narrow",
      "size=3, rate=0.5, speed=2.0, count=14, walls=narrow, pct=normal:45,fast:20,sticky:25,slow:5,tiny:5",
      "size=1, rate=0.13, speed=2.05, count=30, walls=narrow",
      "size=3, rate=0.45, speed=2.15, count=15, walls=narrow, pct=normal:50,sticky:30,fast:15,big:5",
    ],
  },

  // === Block 5 — Brink of Mastery. Endurance + shield pickups. ===
  {
    id: "5-1", name: "Long Haul", block: 5, index: 1, difficulty: 4,
    effects: { slowDuration: 5, shieldDuration: 12 },
    waves: makeLongHaul(30, 1.2, 1.8, 0.9, 0.45),
  },
  {
    id: "5-2", name: "Endurance", block: 5, index: 2, difficulty: 4,
    effects: { slowDuration: 5, shieldDuration: 12 },
    waves: makeLongHaul(35, 1.25, 1.85, 0.85, 0.45),
  },
  {
    id: "5-3", name: "Iron Will", block: 5, index: 3, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 12 },
    waves: makeLongHaul(40, 1.3, 1.9, 0.85, 0.4),
  },
  {
    id: "5-4", name: "Hex Marathon", block: 5, index: 4, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 12, fastDuration: 4 },
    waves: makeLongHaul(50, 1.3, 1.95, 0.8, 0.4),
  },
  {
    id: "5-5", name: "The Crucible", block: 5, index: 5, difficulty: 5,
    effects: { slowDuration: 4, shieldDuration: 10, fastDuration: 4 },
    waves: makeLongHaul(60, 1.35, 2.0, 0.75, 0.38),
  },

  // === Block 6 — Hex Master. Final ladder. ===
  {
    id: "6-1", name: "Ascendant", block: 6, index: 1, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder(60, 1.4, 2.0),
  },
  {
    id: "6-2", name: "Apex", block: 6, index: 2, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder(70, 1.4, 2.05),
  },
  {
    id: "6-3", name: "Pinnacle", block: 6, index: 3, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder(80, 1.45, 2.1),
  },
  {
    id: "6-4", name: "The Climb", block: 6, index: 4, difficulty: 5,
    effects: { slowDuration: 4, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder(90, 1.5, 2.15),
  },
  {
    id: "6-5", name: "Gauntlet of Fear", block: 6, index: 5, difficulty: 5,
    effects: { slowDuration: 4, shieldDuration: 10, fastDuration: 3, droneDuration: 10 },
    waves: makeFinalLadder(100, 1.55, 2.2),
  },
];

// Helper that builds a long endurance wave list of `n` waves, ramping
// speed from `startSpeed` → `endSpeed` and rate from `startRate` →
// `endRate`. Mixes probabilistic, single-hex rain, scripted, and
// power-up-heavy waves for a varied feel.
function makeLongHaul(n: number, startSpeed: number, endSpeed: number, startRate: number, endRate: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const speed = (startSpeed + (endSpeed - startSpeed) * t).toFixed(2);
    const rate = (startRate + (endRate - startRate) * t).toFixed(2);
    const sizeMin = i < n * 0.2 ? 2 : i < n * 0.5 ? 3 : 4;
    const sizeMax = i < n * 0.3 ? 4 : 5;
    const wall =
      i % 9 === 4 ? "narrow"
      : i % 5 === 2 ? "zigzag"
      : i % 3 === 1 ? "pinch"
      : "none";
    const wallTok = wall === "none" ? "" : `, walls=${wall}`;
    // Cycle: rain → mix → script → pickup → mix
    const phase = i % 5;
    if (phase === 0) {
      // Single-hex rain burst
      const rainRate = Math.max(0.13, 0.22 - 0.08 * t).toFixed(2);
      const count = 14 + Math.floor(i * 0.3);
      out.push(`size=1, rate=${rainRate}, speed=${speed}${wallTok}, count=${count}`);
    } else if (phase === 1) {
      const count = 10 + Math.floor(i * 0.35);
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:65,coin:15,sticky:10,fast:5,slow:5`);
    } else if (phase === 2) {
      const slotRate = (parseFloat(rate) * 0.85).toFixed(2);
      out.push(
        `count=0, slotRate=${slotRate}, speed=${speed}${wallTok}, 130,230,330,430,530,000,230,330,430,000,130,330,530`,
      );
    } else if (phase === 3) {
      const count = 11 + Math.floor(i * 0.35);
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:48,coin:10,sticky:15,fast:10,slow:4,shield:5,tiny:4,big:4`);
    } else {
      const count = 10 + Math.floor(i * 0.4);
      // Phase 4 is the recovery wave between dense rain and the next
      // pickup-mix — ensure it carries some heals so a player low on
      // HP after a long-haul rain burst has a chance to drop a hex.
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:60,sticky:15,coin:15,fast:5,slow:5`);
    }
  }
  // Final-wave heal-relief: replace whatever pattern landed on the
  // last slot with a deterministic sticky-heavy mix so endurance runs
  // always end with at least one fair recovery shot.
  if (out.length > 0) {
    const finaleSpeed = endSpeed.toFixed(2);
    const finaleRate = endRate.toFixed(2);
    out[out.length - 1] = `size=2-3, rate=${finaleRate}, speed=${finaleSpeed}, count=12, pct=normal:45,sticky:30,fast:10,coin:10,big:5`;
  }
  return out;
}

// Final-ladder builder: even denser than makeLongHaul, drones and shields available.
function makeFinalLadder(n: number, startSpeed: number, endSpeed: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const speed = (startSpeed + (endSpeed - startSpeed) * t).toFixed(2);
    const rate = Math.max(0.32, 0.85 - 0.5 * t).toFixed(2);
    const sizeMin = i < n * 0.15 ? 2 : i < n * 0.4 ? 3 : 4;
    const sizeMax = i < n * 0.25 ? 4 : 5;
    const wall =
      i % 6 === 3 ? "narrow"
      : i % 4 === 1 ? "zigzag"
      : i % 5 === 2 ? "pinch"
      : "none";
    const wallTok = wall === "none" ? "" : `, walls=${wall}`;
    const phase = i % 6;
    if (phase === 0) {
      // Heavy rain
      const rainRate = Math.max(0.12, 0.2 - 0.08 * t).toFixed(2);
      const count = 16 + Math.floor(i * 0.3);
      out.push(`size=1, rate=${rainRate}, speed=${speed}${wallTok}, count=${count}`);
    } else if (phase === 1) {
      const count = 12 + Math.floor(i * 0.4);
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:55,coin:10,sticky:15,fast:10,slow:5,shield:5`);
    } else if (phase === 2) {
      const slotRate = (parseFloat(rate) * 0.85).toFixed(2);
      out.push(
        `count=0, slotRate=${slotRate}, speed=${speed}${wallTok}, 140,240,340,440,540,000,240,340,440,540,000,140,340,540`,
      );
    } else if (phase === 3) {
      const count = 13 + Math.floor(i * 0.4);
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:42,coin:10,sticky:10,fast:13,slow:4,shield:5,drone:5,tiny:5,big:6`);
    } else if (phase === 4) {
      const rainRate = Math.max(0.11, 0.18 - 0.07 * t).toFixed(2);
      const count = 18 + Math.floor(i * 0.3);
      out.push(`size=1, rate=${rainRate}, speed=${speed}${wallTok}, count=${count}`);
    } else {
      const count = 12 + Math.floor(i * 0.45);
      // Phase 5 closes each loop iteration — bump sticky so the
      // player has a steady recovery beat across the long run.
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:55,coin:15,fast:10,sticky:15,slow:5`);
    }
  }
  // Final-wave heal-relief: same idea as makeLongHaul but with a
  // little drone sprinkled in to keep block 6's flavour.
  if (out.length > 0) {
    const finaleSpeed = endSpeed.toFixed(2);
    out[out.length - 1] = `size=2-3, rate=0.55, speed=${finaleSpeed}, count=12, pct=normal:40,sticky:30,fast:10,big:8,drone:7,coin:5`;
  }
  return out;
}

export function challengeById(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

// === Star thresholds ======================================================

const COMPLETION_BONUS = 20;
// Single-stack fast multiplier: each cluster pass yields (mul-1)=2 to the
// bonus pool, each coin yields 5*(mul-1)=10. Conservative — repeated fast
// stacks raise the multiplier but the player rarely chains them perfectly.
const FAST_MUL_MINUS_ONE = 2;
const FAST_DEFAULT_DURATION = 5;

/**
 * Walk a challenge's waves, parse them, and produce 1/2/3-star thresholds.
 *
 * Logic: count every cluster the wave will spawn (slot tokens + countCap),
 * distribute probabilistic spawns across the wave's pct weights, and tally
 * coins / stickies / fast pickups. The "baseline" is what a player who
 * completes the run scores by simply letting every cluster pass; the upper
 * bound layers in the available pickup score plus an estimated fast bonus
 * pool. Stars are spaced inside that range.
 */
export function computeStarThresholds(def: ChallengeDef): ChallengeStarThresholds {
  let totalClusters = 0;
  let coins = 0;
  let stickies = 0;
  let fasts = 0;
  let totalDuration = 0;

  for (const line of def.waves) {
    let wave;
    try { wave = parseWaveLine(line); } catch { continue; }

    const slotClusters = wave.slots.filter((s) => s !== null).length;
    const probClusters = wave.countCap ?? 0;
    totalClusters += slotClusters + probClusters;

    // Slot tokens always spawn as `normal` (no pct dispatch in the slot
    // path), so they contribute only to the baseline pass score.
    if (probClusters > 0) {
      const w = wave.weights as Partial<Record<ClusterKind, number>>;
      const wTotal = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
      if (wTotal > 0) {
        coins += probClusters * ((w.coin ?? 0) / wTotal);
        stickies += probClusters * ((w.sticky ?? 0) / wTotal);
        fasts += probClusters * ((w.fast ?? 0) / wTotal);
      }
    }

    const slotTime = wave.slots.length * wave.slotInterval;
    const probTime = probClusters * wave.spawnInterval;
    totalDuration += wave.durOverride ?? Math.max(slotTime, probTime);
  }

  // Pickup score components.
  // - Coin: pass +1 → collect +5, so collecting nets +4 over passing.
  // - Sticky heal: +2 only when player is at size 1; counts ~half on average.
  const coinPotential = coins * 4;
  const healPotential = stickies * 1;

  // Fast bonus: each pickup activates fastDuration seconds during which
  // every passing cluster adds (mul-1) to the pool, every coin adds
  // 5*(mul-1). Approximate using avg cluster/coin rate over the run.
  const fastDur = def.effects?.fastDuration ?? FAST_DEFAULT_DURATION;
  const clustersPerSec = totalDuration > 0 ? totalClusters / totalDuration : 0;
  const coinsPerSec = totalDuration > 0 ? coins / totalDuration : 0;
  const fastPoolPerPickup =
    fastDur * (clustersPerSec * FAST_MUL_MINUS_ONE + coinsPerSec * 5 * FAST_MUL_MINUS_ONE);
  const fastPotential = fasts * fastPoolPerPickup;

  const baseline = totalClusters + COMPLETION_BONUS;
  const bonusPotential = coinPotential + healPotential + fastPotential;

  // 1 star: barely-winning baseline (allow some hit absorption).
  // 3 star: near upper bound.
  // 2 star: roughly midway between.
  const one = Math.max(1, Math.round(baseline * 0.9));
  const three = Math.max(baseline, Math.round(baseline + bonusPotential * 0.85));
  const twoRaw = Math.round(baseline + bonusPotential * 0.45);
  // Keep two strictly between one and three.
  const two = Math.min(Math.max(twoRaw, one + 1), Math.max(one + 1, three - 1));

  return { one, two, three };
}

export function awardStars(score: number, t: ChallengeStarThresholds): 0 | 1 | 2 | 3 {
  if (score >= t.three) return 3;
  if (score >= t.two) return 2;
  if (score >= t.one) return 1;
  return 0;
}

// === Persistence ==========================================================

export function loadChallengeProgress(): ChallengeProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<ChallengeProgress> | null;
    if (!parsed || parsed.v !== 1) return { ...EMPTY_PROGRESS };
    const validIds = new Set(CHALLENGES.map((c) => c.id));
    const bestEntries = Object.entries(parsed.best ?? {}).filter(([id]) => validIds.has(id));
    const bestPctEntries = Object.entries(parsed.bestPct ?? {}).filter(([id]) => validIds.has(id));
    const starsEntries = Object.entries(parsed.stars ?? {})
      .filter(([id]) => validIds.has(id))
      .map(([id, n]) => [id, Math.max(0, Math.min(3, Math.round(Number(n) || 0)))] as const);
    const completed = (parsed.completed ?? []).filter((id) => validIds.has(id));
    const unique = Array.from(new Set(completed)).sort();
    const purchasedUnlock = parsed.purchasedUnlock === true;
    return {
      v: 1,
      best: Object.fromEntries(bestEntries),
      bestPct: Object.fromEntries(bestPctEntries),
      stars: Object.fromEntries(starsEntries),
      completed: unique,
      unlockedBlocks: recomputeUnlocked(new Set(unique), purchasedUnlock),
      purchasedUnlock,
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

function save(p: ChallengeProgress): void {
  if (DEBUG_MODE) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore quota / private mode */ }
  // Mirror to CloudKit private DB if available. Debounced inside
  // syncProgressUp so a flurry of saves only triggers one round-trip.
  syncProgressUp();
}

export function saveChallengeBest(id: string, score: number, pct = 0): ChallengeProgress {
  const p = loadChallengeProgress();
  const prevScore = p.best[id] ?? 0;
  const prevPct = p.bestPct[id] ?? 0;
  const newScore = Math.max(prevScore, score);
  const newPct = Math.max(prevPct, Math.round(pct * 100));
  if (newScore === prevScore && newPct === prevPct) return p;
  const next: ChallengeProgress = {
    ...p,
    best: { ...p.best, [id]: newScore },
    bestPct: { ...p.bestPct, [id]: newPct },
  };
  save(next);
  return next;
}

export function saveChallengeCompletion(id: string, score: number, stars: number): ChallengeProgress {
  const p = loadChallengeProgress();
  const prevScore = p.best[id] ?? 0;
  const prevStars = p.stars[id] ?? 0;
  const newStars = Math.max(prevStars, Math.max(0, Math.min(3, Math.round(stars))));
  const completed = new Set(p.completed);
  completed.add(id);
  const next: ChallengeProgress = {
    v: 1,
    best: { ...p.best, [id]: Math.max(prevScore, score) },
    bestPct: { ...p.bestPct, [id]: 100 },
    stars: { ...p.stars, [id]: newStars },
    completed: Array.from(completed).sort(),
    unlockedBlocks: recomputeUnlocked(completed, p.purchasedUnlock),
    purchasedUnlock: p.purchasedUnlock,
  };
  save(next);
  return next;
}

// Flip the IAP-unlock flag. Idempotent — no-op when already in the desired
// state. Recomputes unlockedBlocks so the toggled flag takes effect on the
// next read.
export function setPurchasedUnlock(v: boolean): ChallengeProgress {
  const p = loadChallengeProgress();
  if (p.purchasedUnlock === v) return p;
  const next: ChallengeProgress = {
    ...p,
    purchasedUnlock: v,
    unlockedBlocks: recomputeUnlocked(new Set(p.completed), v),
  };
  save(next);
  return next;
}

function recomputeUnlocked(completed: Set<string>, purchasedUnlock = false): number[] {
  if (DEBUG_MODE || purchasedUnlock) return [...ALL_BLOCKS];
  const out = [1];
  for (let b = 1; b < 6; b++) {
    let inBlock = 0;
    for (const id of completed) if (id.startsWith(`${b}-`)) inBlock += 1;
    if (inBlock >= 3) out.push(b + 1);
  }
  return out;
}

// === Validation guard (dev only) ==========================================

if (import.meta.env?.DEV) {
  const ids = new Set<string>();
  const blockCounts = new Map<number, number>();
  const errors: string[] = [];
  for (const c of CHALLENGES) {
    if (ids.has(c.id)) errors.push(`Duplicate challenge id ${c.id}`);
    ids.add(c.id);
    blockCounts.set(c.block, (blockCounts.get(c.block) ?? 0) + 1);
    for (const e of validateChallenge(c)) errors.push(`[${c.id}] ${e}`);
    // Sanity-parse every wave (validateChallenge already did this, but
    // double-check so a bad wave throws here with a clear stack trace).
    for (let i = 0; i < c.waves.length; i++) {
      try { parseWaveLine(c.waves[i]); }
      catch (e) {
        errors.push(`[${c.id}] wave ${i + 1}: ${(e as Error).message}`);
      }
    }
  }
  for (const [b, n] of blockCounts) {
    if (n !== 5) errors.push(`Block ${b} has ${n} challenges (expected 5)`);
  }
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error("[challenges] validation errors:\n" + errors.join("\n"));
  }
}
