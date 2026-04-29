// Challenge definitions + persistence for HexRain's challenge mode.
//
// Each challenge is a finite, scripted run defined as a list of wave
// strings (parsed by waveDsl). The roster lives in CHALLENGES; progress
// (best score per challenge, completion list, unlocked blocks) is
// stored under a single localStorage key.

import { parseWaveLine, validateChallenge, type ChallengeDefLike } from "./waveDsl";

export interface ChallengeDef extends ChallengeDefLike {
  // ChallengeDefLike already includes id, name, difficulty, block, index, effects, waves.
}

export interface ChallengeProgress {
  v: 1;
  best: Record<string, number>;
  /** Best percentage (0-100) the player has reached in each challenge. */
  bestPct: Record<string, number>;
  completed: string[];
  unlockedBlocks: number[];
}

const STORAGE_KEY = "hexrain.challenges.v1";

const EMPTY_PROGRESS: ChallengeProgress = {
  v: 1,
  best: {},
  bestPct: {},
  completed: [],
  unlockedBlocks: [1],
};

// CHALLENGES roster. Filled in by hand/generated content; validated at
// dev module load. See challenge.md §11 for the generation strategy.
export const CHALLENGES: ChallengeDef[] = [
  // === Block 1 — First Steps. Intro to the basics, but with rain bursts and a few power-ups so it's never just boring blocks. ===
  {
    id: "1-1", name: "First Drops", block: 1, index: 1, difficulty: 1,
    waves: [
      "size=1-2, rate=1.0, speed=1.0, count=6",
      "size=2, rate=0.85, speed=1.05, count=7, pct=normal:80,coin:20",
      "size=1, rate=0.25, speed=1.05, count=14",                         // first rain
      "size=2-3, rate=0.8, speed=1.1, count=8, pct=normal:80,coin:20",
      "size=2, rate=0.75, speed=1.15, count=9",
      "size=1, rate=0.22, speed=1.15, count=16",                         // rain
      "size=2-3, rate=0.7, speed=1.2, count=10, pct=normal:80,coin:20",
      "size=3, rate=0.7, speed=1.25, count=10",
      "size=1, rate=0.2, speed=1.25, count=18",                          // bigger rain
      "size=2-3, rate=0.65, speed=1.3, count=11, pct=normal:85,coin:15",
    ],
  },
  {
    id: "1-2", name: "Easy Rain", block: 1, index: 2, difficulty: 2,
    waves: [
      "size=2, rate=0.9, speed=1.05, count=6",
      "size=1, rate=0.22, speed=1.1, count=14",
      "size=2-3, rate=0.8, speed=1.15, count=8, pct=normal:75,coin:25",
      "size=1, rate=0.2, speed=1.2, count=16",
      "count=0, slotRate=0.55, speed=1.15, 130,230,330,430,530,000,330,230",
      "size=2-3, rate=0.7, speed=1.25, count=10",
      "size=1, rate=0.18, speed=1.3, count=20",                          // dense
      "size=3, rate=0.65, speed=1.3, count=11, pct=normal:75,coin:25",
      "size=1, rate=0.18, speed=1.35, count=22",
      "size=3-4, rate=0.6, speed=1.4, count=12, pct=normal:75,coin:25",
      "size=1, rate=0.16, speed=1.45, count=24",                         // finale rain
      "size=3, rate=0.55, speed=1.5, count=13",
    ],
  },
  {
    id: "1-3", name: "Slow Roll", block: 1, index: 3, difficulty: 2,
    effects: { slowDuration: 6 },
    waves: [
      "size=2-3, rate=0.9, speed=1.0, count=7",
      "size=1, rate=0.22, speed=1.1, count=15",
      "size=3, rate=0.8, speed=1.15, count=9, pct=normal:70,coin:15,slow:15",   // slow intro
      "count=0, slotRate=0.55, speed=1.15, 230,330,430,000,330,230,430,330",
      "size=1, rate=0.2, speed=1.2, count=17",
      "size=3, rate=0.75, speed=1.25, count=10, pct=normal:65,slow:20,coin:15",
      "size=1, rate=0.18, speed=1.25, count=18",
      "size=3-4, rate=0.7, speed=1.3, count=11",
      "size=1, rate=0.18, speed=1.3, count=20",                          // breath of rain
      "size=3, rate=0.65, speed=1.35, count=12, pct=normal:65,slow:20,coin:15",
      "count=0, slotRate=0.5, speed=1.35, 230,330,430,000,330,230,430,000,330,430",
      "size=1, rate=0.16, speed=1.45, count=24",
    ],
  },
  {
    id: "1-4", name: "Open Sky", block: 1, index: 4, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.05, count=7",
      "count=0, slotRate=0.55, speed=1.1, 137,000,237,000,337,000,237,137",
      "size=1, rate=0.22, speed=1.15, count=15",
      "size=3, rate=0.8, speed=1.2, count=9, pct=normal:65,sticky:25,coin:10",  // first heal blocks
      "count=0, slotRate=0.5, speed=1.2, 048,000,148,000,248,000,348,000",
      "size=1, rate=0.2, speed=1.25, count=17",
      "size=3-4, rate=0.7, speed=1.3, count=10, pct=normal:60,sticky:30,coin:10",
      "count=0, slotRate=0.5, speed=1.3, 037,148,037,148,237,348,037,148",
      "size=1, rate=0.18, speed=1.35, count=20",
      "size=3-4, rate=0.65, speed=1.4, count=12",
      "size=4, rate=0.6, speed=1.45, count=13, pct=normal:65,sticky:25,coin:10",
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
      "size=4, rate=0.55, speed=1.55, count=14, pct=normal:60,coin:30,fast:10",
      "size=1, rate=0.15, speed=1.6, count=26",
    ],
  },
  {
    id: "2-4", name: "Tight Lane", block: 2, index: 4, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.9, speed=1.1, count=8",
      "size=1, rate=0.2, speed=1.2, count=15, walls=pinch",
      "size=3, rate=0.75, speed=1.2, count=9, walls=narrow",
      "size=1, rate=0.18, speed=1.25, count=18, walls=narrow",
      "count=0, slotRate=0.5, speed=1.25, walls=narrow, 230,330,430,000,330,430,230,330",
      "size=3, rate=0.7, speed=1.3, count=10, walls=narrow, pct=normal:60,sticky:25,slow:10,coin:5",
      "size=1, rate=0.18, speed=1.35, count=20",
      "size=3, rate=0.65, speed=1.4, count=11, walls=narrow, pct=normal:60,fast:20,slow:10,coin:10",
      "size=1, rate=0.16, speed=1.45, count=22, walls=narrow",
      "count=0, slotRate=0.45, speed=1.4, walls=narrow, 130,230,330,000,230,330,130,000,230",
      "size=3, rate=0.55, speed=1.55, count=13, walls=narrow",
      "size=1, rate=0.15, speed=1.6, count=26",
      "size=3, rate=0.5, speed=1.6, count=14, walls=narrow, pct=normal:65,fast:15,sticky:10,coin:10",
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
      "size=3, rate=0.55, speed=1.6, count=14, walls=narrow, pct=normal:60,fast:20,sticky:10,coin:10",
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
      "size=3-4, rate=0.55, speed=1.5, count=13, walls=zigzag, pct=normal:65,fast:15,sticky:10,coin:10",
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
      "size=3, rate=0.5, speed=1.65, count=14, walls=narrow",
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
      "size=3-4, rate=0.65, speed=1.45, count=12, walls=zigzag, pct=normal:50,sticky:35,fast:5,coin:10",
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
      "size=3-4, rate=0.7, speed=1.4, count=11, walls=zigzag, pct=normal:55,fast:25,slow:10,sticky:10",
      "size=1, rate=0.18, speed=1.45, count=22, walls=zigzag",
      "count=0, slotRate=0.45, speed=1.45, walls=zigzag, 140,240,340,440,540,000,340,440,540,440,340",
      "size=3-4, rate=0.6, speed=1.55, count=12, walls=narrow",
      "size=1, rate=0.16, speed=1.6, count=24, walls=zigzag",
      "size=3, rate=0.5, speed=1.65, count=14, walls=zigzag, pct=normal:60,fast:20,sticky:10,coin:10",
      "count=0, slotRate=0.4, speed=1.65, walls=zigzag, 130,230,330,430,530,000,230,330,430,000,130,530",
      "size=1, rate=0.15, speed=1.7, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=1.75, count=15, walls=zigzag",
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
      "size=3-4, rate=0.65, speed=1.5, count=11, walls=zigzag, pct=normal:50,fast:25,slow:10,sticky:10,coin:5",
      "size=1, rate=0.16, speed=1.55, count=22, walls=zigzag",
      "count=0, slotRate=0.4, speed=1.55, walls=zigzag, 140,340,540,000,240,440,140,340,540,440,340,240",
      "size=3-4, rate=0.55, speed=1.6, count=13, walls=narrow",
      "size=1, rate=0.15, speed=1.65, count=24, walls=zigzag",
      "size=3, rate=0.5, speed=1.7, count=14, walls=zigzag, pct=normal:55,fast:25,sticky:10,coin:10",
      "count=0, slotRate=0.4, speed=1.7, walls=zigzag, 140,340,540,000,240,440,000,340,540,440,340,240,140",
      "size=1, rate=0.14, speed=1.75, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=1.8, count=15, walls=zigzag",
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
      "size=3, rate=0.55, speed=1.65, count=13, walls=narrow, pct=normal:60,fast:20,sticky:10,coin:10",
      "size=1, rate=0.14, speed=1.7, count=28, walls=narrow",
      "size=3, rate=0.5, speed=1.75, count=14, walls=narrow",
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
      "size=3-4, rate=0.6, speed=1.6, count=12, walls=narrow, pct=normal:50,fast:30,slow:10,sticky:10",
      "size=1, rate=0.16, speed=1.65, count=22, walls=zigzag",
      "size=3, rate=0.55, speed=1.7, count=13, walls=zigzag",
      "count=0, slotRate=0.4, speed=1.65, walls=zigzag, 230,330,430,000,330,430,230,000,330",
      "size=1, rate=0.14, speed=1.75, count=24, walls=narrow",
      "size=3, rate=0.5, speed=1.8, count=14, walls=zigzag, pct=normal:55,fast:25,slow:10,sticky:10",
      "size=1, rate=0.14, speed=1.85, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=1.95, count=15, walls=narrow",
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
      "size=3, rate=0.55, speed=1.75, count=13, walls=narrow, pct=normal:55,fast:25,sticky:10,slow:10",
      "size=1, rate=0.14, speed=1.8, count=26, walls=narrow",
      "size=3, rate=0.5, speed=1.85, count=14, walls=narrow",
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
      "size=3, rate=0.6, speed=1.7, count=12, walls=narrow, pct=normal:50,fast:30,slow:10,sticky:10",
      "size=1, rate=0.15, speed=1.75, count=22, walls=zigzag",
      "size=3, rate=0.55, speed=1.8, count=13, walls=zigzag",
      "size=1, rate=0.14, speed=1.85, count=24, walls=narrow",
      "count=0, slotRate=0.4, speed=1.85, walls=zigzag, 140,340,540,000,240,440,140,340,540,440,340,240",
      "size=3, rate=0.5, speed=1.95, count=15, walls=zigzag, pct=normal:50,fast:30,slow:10,sticky:10",
      "size=1, rate=0.13, speed=2.0, count=28, walls=zigzag",
      "size=3, rate=0.45, speed=2.1, count=16, walls=narrow",
      "size=1, rate=0.13, speed=2.15, count=32, walls=zigzag",
      "size=3, rate=0.4, speed=2.2, count=17, walls=zigzag",
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
      "size=3, rate=0.6, speed=1.7, count=12, walls=narrow, pct=normal:50,fast:25,slow:15,sticky:10",
      "count=0, slotRate=0.4, speed=1.7, walls=narrow, 230,330,430,000,330,230,430,000,330,430,230",
      "size=1, rate=0.14, speed=1.8, count=24, walls=narrow",
      "size=3, rate=0.55, speed=1.85, count=13, walls=narrow",
      "size=1, rate=0.13, speed=1.9, count=28, walls=narrow",
      "size=3, rate=0.5, speed=2.0, count=14, walls=narrow, pct=normal:55,fast:20,sticky:15,slow:10",
      "size=1, rate=0.13, speed=2.05, count=30, walls=narrow",
      "size=3, rate=0.45, speed=2.15, count=15, walls=narrow",
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
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:55,coin:10,sticky:15,fast:10,slow:5,shield:5`);
    } else {
      const count = 10 + Math.floor(i * 0.4);
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:75,coin:15,fast:5,slow:5`);
    }
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
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:50,coin:10,sticky:10,fast:15,slow:5,shield:5,drone:5`);
    } else if (phase === 4) {
      const rainRate = Math.max(0.11, 0.18 - 0.07 * t).toFixed(2);
      const count = 18 + Math.floor(i * 0.3);
      out.push(`size=1, rate=${rainRate}, speed=${speed}${wallTok}, count=${count}`);
    } else {
      const count = 12 + Math.floor(i * 0.45);
      out.push(`size=${sizeMin}-${sizeMax}, rate=${rate}, speed=${speed}, count=${count}${wallTok}, pct=normal:65,coin:15,fast:10,sticky:5,slow:5`);
    }
  }
  return out;
}

export function challengeById(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
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
    const completed = (parsed.completed ?? []).filter((id) => validIds.has(id));
    const unique = Array.from(new Set(completed)).sort();
    return {
      v: 1,
      best: Object.fromEntries(bestEntries),
      bestPct: Object.fromEntries(bestPctEntries),
      completed: unique,
      unlockedBlocks: recomputeUnlocked(new Set(unique)),
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

function save(p: ChallengeProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore quota / private mode */ }
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

export function saveChallengeCompletion(id: string, score: number): ChallengeProgress {
  const p = loadChallengeProgress();
  const prevScore = p.best[id] ?? 0;
  const completed = new Set(p.completed);
  completed.add(id);
  const next: ChallengeProgress = {
    v: 1,
    best: { ...p.best, [id]: Math.max(prevScore, score) },
    bestPct: { ...p.bestPct, [id]: 100 },
    completed: Array.from(completed).sort(),
    unlockedBlocks: recomputeUnlocked(completed),
  };
  save(next);
  return next;
}

function recomputeUnlocked(completed: Set<string>): number[] {
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
