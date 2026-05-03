// Challenge definitions + persistence for HexRain's challenge mode.
//
// Each challenge is a finite, scripted run defined as a list of wave
// strings (parsed by waveDsl). The roster lives in CHALLENGES; progress
// (best score per challenge, completion list, unlocked blocks) is
// stored under a single localStorage key.

import type { ClusterKind } from "./types";
import { parseWaveLine, type ChallengeDefLike } from "./waveDsl";
import { syncProgressUp } from "./cloudSync";
import { hashSeed } from "./rng";
import { loadJson, saveJson } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";

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

const STORAGE_KEY = STORAGE_KEYS.challengeProgress;

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
      "size=1-2, rate=1.0, speed=1.0, count=6, pct=normal:75,coin:25, seed=3847033308",
      "size=2, rate=0.85, speed=1.05, count=7, pct=normal:65,coin:35, seed=3863810927",
      "size=1, rate=0.25, speed=1.05, count=14, seed=3880588546",                         // first rain
      "size=2-3, rate=0.8, speed=1.1, count=8, pct=normal:60,sticky:10,coin:30, seed=3897366165",   // single heal sprinkle
      "size=2, rate=0.75, speed=1.15, count=9, pct=normal:70,coin:30, seed=3779922832",
      "size=1, rate=0.22, speed=1.15, count=16, seed=3796700451",                         // rain
      "size=2-3, rate=0.7, speed=1.2, count=10, pct=normal:65,coin:35, seed=3813478070",
      "size=3, rate=0.7, speed=1.25, count=10, pct=normal:70,coin:30, seed=3830255689",
      "size=1, rate=0.2, speed=1.25, count=18, seed=3981254260",                          // bigger rain
      "size=2-3, rate=0.65, speed=1.3, count=11, pct=normal:60,sticky:10,coin:30, seed=3998031879",
    ],
  },
  {
    id: "1-2", name: "Easy Rain", block: 1, index: 2, difficulty: 2,
    waves: [
      "size=2, rate=0.9, speed=1.05, count=6, pct=normal:70,coin:30, seed=112530577",
      "size=1, rate=0.22, speed=1.1, count=14, seed=95752958",
      "size=2-3, rate=0.8, speed=1.15, count=8, pct=normal:65,coin:35, seed=78975339",
      "size=1, rate=0.2, speed=1.2, count=16, seed=62197720",
      "count=0, slotRate=0.55, speed=1.15, 130,230,330,430,530,000,330,230, seed=179641053",
      "size=2-3, rate=0.7, speed=1.25, count=10, pct=normal:60,sticky:10,coin:30, seed=162863434",  // mid heal
      "size=1, rate=0.18, speed=1.3, count=20, seed=146085815",                          // dense
      "size=3, rate=0.65, speed=1.3, count=11, pct=normal:65,coin:35, seed=129308196",
      "size=1, rate=0.18, speed=1.35, count=22, seed=4273276921",
      "size=3-4, rate=0.6, speed=1.4, count=12, pct=normal:65,coin:35, seed=4256499302",
      "size=1, rate=0.16, speed=1.45, count=24, seed=3389823562",                         // finale rain
      "size=3, rate=0.55, speed=1.5, count=13, pct=normal:60,sticky:10,coin:30, seed=3406601181",  // late heal
    ],
  },
  {
    id: "1-3", name: "Slow Roll", block: 1, index: 3, difficulty: 2,
    effects: { slowDuration: 6 },
    waves: [
      "size=2-3, rate=0.9, speed=1.0, count=7, pct=normal:70,coin:30, seed=518677386",
      "size=1, rate=0.22, speed=1.1, count=15, seed=535455005",
      "size=3, rate=0.8, speed=1.15, count=9, pct=normal:55,coin:30,slow:15, seed=485122148",   // slow intro
      "count=0, slotRate=0.55, speed=1.15, 230,330,430,000,330,230,430,330, seed=501899767",
      "size=1, rate=0.2, speed=1.2, count=17, seed=451566910",
      "size=3, rate=0.75, speed=1.25, count=10, pct=normal:45,slow:20,sticky:10,coin:25, seed=468344529",   // mid heal
      "size=1, rate=0.18, speed=1.25, count=18, seed=418011672",
      "size=3-4, rate=0.7, speed=1.3, count=11, pct=normal:65,coin:35, seed=434789291",
      "size=1, rate=0.18, speed=1.3, count=20, seed=384456434",                          // breath of rain
      "size=3, rate=0.65, speed=1.35, count=12, pct=normal:45,slow:20,sticky:10,coin:25, seed=401234053",   // late heal
      "count=0, slotRate=0.5, speed=1.35, 230,330,430,000,330,230,430,000,330,430, seed=1794983383",
      "size=1, rate=0.16, speed=1.45, count=24, seed=1778205764",
    ],
  },
  {
    id: "1-4", name: "Open Sky", block: 1, index: 4, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.05, count=7, pct=normal:70,coin:30, seed=389656407",
      "count=0, slotRate=0.55, speed=1.1, 137,000,237,000,337,000,237,137, seed=372878788",
      "size=1, rate=0.22, speed=1.15, count=15, seed=423211645",
      "size=3, rate=0.8, speed=1.2, count=9, pct=normal:50,sticky:25,coin:25, seed=406434026",  // first heal blocks
      "count=0, slotRate=0.5, speed=1.2, 048,000,148,000,248,000,348,000, seed=322545931",
      "size=1, rate=0.2, speed=1.25, count=17, seed=305768312",
      "size=3-4, rate=0.7, speed=1.3, count=10, pct=normal:45,sticky:30,coin:25, seed=356101169",
      "count=0, slotRate=0.5, speed=1.3, 037,148,037,148,237,348,037,148, seed=339323550",
      "size=1, rate=0.18, speed=1.35, count=20, seed=255435455",
      "size=3-4, rate=0.65, speed=1.4, count=12, pct=normal:65,coin:35, seed=238657836",
      "size=4, rate=0.6, speed=1.45, count=13, pct=normal:50,sticky:25,coin:25, seed=4039956252",
      "size=1, rate=0.16, speed=1.5, count=24, seed=4056733871",
      "count=0, slotRate=0.45, speed=1.5, 037,148,237,348,037,148,237,348,137, seed=4073511490",
    ],
  },
  {
    id: "1-5", name: "Soft Landing", block: 1, index: 5, difficulty: 3,
    effects: { slowDuration: 6, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.1, count=8, seed=546869736",
      "size=1, rate=0.2, speed=1.2, count=16, seed=563647355",
      "size=3, rate=0.75, speed=1.25, count=9, pct=normal:65,fast:20,coin:15, seed=580424974",   // first fast
      "count=0, slotRate=0.55, speed=1.2, 130,230,330,430,530,000,330,230,430, seed=597202593",
      "size=1, rate=0.18, speed=1.3, count=18, seed=613980212",
      "size=3, rate=0.7, speed=1.3, count=10, pct=normal:55,sticky:25,fast:10,coin:10, seed=630757831",
      "size=1, rate=0.18, speed=1.35, count=20, seed=647535450",
      "size=3-4, rate=0.65, speed=1.4, count=11, pct=normal:55,slow:15,fast:15,coin:15, seed=664313069",
      "count=0, slotRate=0.5, speed=1.4, 140,340,540,000,240,440,140,340,540, seed=412648784",
      "size=1, rate=0.16, speed=1.45, count=22, seed=429426403",
      "size=3-4, rate=0.6, speed=1.5, count=12, seed=774889233",
      "size=4, rate=0.55, speed=1.55, count=13, pct=normal:60,fast:20,sticky:10,coin:10, seed=758111614",
      "size=1, rate=0.15, speed=1.6, count=26, seed=741333995",
    ],
  },

  // === Block 2 — Climbing. Walls + sticky/fast layered into rain bursts. ===
  {
    id: "2-1", name: "Squeeze Play", block: 2, index: 1, difficulty: 2,
    waves: [
      "size=2-3, rate=0.9, speed=1.05, count=7, seed=3646129401",
      "size=1, rate=0.2, speed=1.1, count=15, seed=3629351782",
      "size=3, rate=0.8, speed=1.15, count=8, walls=pinch, pct=normal:80,coin:20, seed=3612574163",
      "size=1, rate=0.18, speed=1.2, count=17, walls=pinch, seed=3595796544",
      "size=3, rate=0.75, speed=1.25, count=10, walls=pinch, pct=normal:65,sticky:25,coin:10, seed=3713239877",
      "count=0, slotRate=0.5, speed=1.2, walls=pinch, 230,330,430,000,330,430,230,000,330, seed=3696462258",
      "size=1, rate=0.18, speed=1.3, count=20, walls=pinch, seed=3679684639",
      "size=3-4, rate=0.7, speed=1.3, count=11, walls=pinch, pct=normal:70,fast:15,coin:15, seed=3662907020",
      "size=1, rate=0.16, speed=1.35, count=22, walls=pinch, seed=3780350353",
      "size=3-4, rate=0.65, speed=1.4, count=12, walls=pinch, pct=normal:60,sticky:20,fast:10,coin:10, seed=3763572734",
      "size=1, rate=0.16, speed=1.4, count=24, seed=3782721634",
      "count=0, slotRate=0.45, speed=1.45, walls=pinch, 230,330,430,000,330,230,430,000,330, seed=3799499253",
    ],
  },
  {
    id: "2-2", name: "Side Step", block: 2, index: 2, difficulty: 2,
    waves: [
      "size=2-3, rate=0.9, speed=1.1, count=7, seed=1475013412",
      "count=0, slotRate=0.55, speed=1.15, 137,000,237,000,337,000,137,237, seed=1491791031",
      "size=1, rate=0.2, speed=1.2, count=16, seed=1508568650",
      "count=0, slotRate=0.5, speed=1.2, 048,000,148,000,248,000,348,000,148, seed=1525346269",
      "size=3, rate=0.8, speed=1.25, count=9, pct=normal:65,sticky:25,coin:10, seed=1407902936",
      "size=1, rate=0.18, speed=1.3, count=18, seed=1424680555",
      "count=0, slotRate=0.5, speed=1.3, 037,148,037,148,237,348,037,148,237, seed=1441458174",
      "size=3-4, rate=0.7, speed=1.35, count=11, pct=normal:65,fast:20,coin:15, seed=1458235793",
      "size=1, rate=0.18, speed=1.4, count=20, seed=1340792460",
      "size=3-4, rate=0.65, speed=1.4, count=12, walls=pinch, pct=normal:65,sticky:20,fast:10,coin:5, seed=1357570079",
      "count=0, slotRate=0.45, speed=1.45, 037,148,037,148,237,348,137,148,037,348, seed=2161268869",
      "size=1, rate=0.15, speed=1.5, count=24, seed=2144491250",
    ],
  },
  {
    id: "2-3", name: "Coin Run", block: 2, index: 3, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.1, count=7, pct=normal:55,coin:45, seed=799144771",
      "size=1, rate=0.2, speed=1.2, count=16, seed=782367152",
      "size=3, rate=0.75, speed=1.25, count=10, pct=normal:50,coin:50, seed=832700009",
      "count=0, slotRate=0.55, speed=1.15, 130,230,330,430,530,330,230,000,330, seed=815922390",
      "size=1, rate=0.18, speed=1.3, count=18, seed=866255247",
      "size=3, rate=0.7, speed=1.35, count=11, walls=pinch, pct=normal:50,coin:40,fast:10, seed=849477628",
      "size=1, rate=0.18, speed=1.35, count=20, seed=899810485",
      "count=0, slotRate=0.5, speed=1.3, 140,240,340,440,540,440,340,240,140, seed=883032866",
      "size=3-4, rate=0.6, speed=1.45, count=12, walls=pinch, pct=normal:55,coin:35,sticky:10, seed=933365723",
      "size=1, rate=0.16, speed=1.5, count=22, seed=916588104",
      "size=4, rate=0.55, speed=1.55, count=14, pct=normal:55,coin:25,sticky:10,fast:10, seed=3908813952",
      "size=1, rate=0.15, speed=1.6, count=26, seed=3925591571",
    ],
  },
  {
    id: "2-4", name: "Tight Lane", block: 2, index: 4, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.9, speed=1.1, count=8, seed=2922996078",
      "size=1, rate=0.2, speed=1.2, count=15, walls=pinch, seed=2939773697",
      // Pre-narrow relief — sticky-heavy so the player can shrink down
      // before the first narrow gauntlet.
      "size=2-3, rate=0.85, speed=1.15, count=8, pct=normal:50,sticky:40,coin:10, seed=2889440840",
      "size=3, rate=0.75, speed=1.2, count=9, walls=narrow, seed=2906218459",
      "size=1, rate=0.18, speed=1.25, count=18, walls=narrow, seed=2990106554",
      "count=0, slotRate=0.5, speed=1.25, walls=narrow, 230,330,430,000,330,430,230,330, seed=3006884173",
      // Mid-challenge breather: pinch instead of narrow + heavy heal mix.
      "size=2-3, rate=0.8, speed=1.25, count=10, walls=pinch, pct=normal:55,sticky:30,coin:15, seed=2956551316",
      "size=1, rate=0.18, speed=1.35, count=20, seed=2973328935",
      // Second narrow run, with helpers.
      "size=3, rate=0.65, speed=1.4, count=11, walls=narrow, pct=normal:55,sticky:20,fast:15,slow:10, seed=2788775126",
      "count=0, slotRate=0.45, speed=1.4, walls=narrow, 130,230,330,000,230,330,130,000,230, seed=2805552745",
      // Pre-finale relief — heals + slow before the closer.
      "size=2-3, rate=0.7, speed=1.4, count=11, pct=normal:50,sticky:35,slow:10,coin:5, seed=139929123",
      "size=1, rate=0.15, speed=1.6, count=26, seed=123151504",
      "size=3, rate=0.55, speed=1.6, count=13, walls=narrow, pct=normal:60,sticky:15,fast:15,coin:10, seed=173484361",
    ],
  },
  {
    id: "2-5", name: "Pressure Cooker", block: 2, index: 5, difficulty: 4,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.15, count=8, seed=2496060917",
      "size=1, rate=0.2, speed=1.25, count=16, seed=2479283298",
      "size=3, rate=0.75, speed=1.3, count=9, walls=pinch, pct=normal:65,sticky:20,fast:10,coin:5, seed=2462505679",
      "size=1, rate=0.18, speed=1.35, count=18, walls=pinch, seed=2445728060",
      "count=0, slotRate=0.5, speed=1.35, walls=pinch, 130,230,330,430,530,330,230,130,330, seed=2428950441",
      "size=1, rate=0.18, speed=1.4, count=20, seed=2412172822",
      "size=3-4, rate=0.7, speed=1.45, count=11, walls=pinch, pct=normal:55,fast:20,slow:15,sticky:10, seed=2395395203",
      "size=1, rate=0.16, speed=1.45, count=22, walls=pinch, seed=2378617584",
      "size=3-4, rate=0.65, speed=1.5, count=12, walls=narrow, seed=2630281869",
      "count=0, slotRate=0.45, speed=1.45, walls=narrow, 230,330,430,000,330,230,430,000,330, seed=2613504250",
      "size=1, rate=0.16, speed=1.55, count=24, seed=4094481686",
      "size=3, rate=0.55, speed=1.6, count=14, walls=narrow, pct=normal:55,fast:15,sticky:20,coin:10, seed=4111259305",
      "size=1, rate=0.15, speed=1.65, count=26, walls=narrow, seed=4060926448",
      "count=0, slotRate=0.4, speed=1.65, walls=narrow, 130,230,330,000,230,330,130,000,230, seed=4077704067",
    ],
  },

  // === Block 3 — Halfway There. Zigzag-heavy with sticky/fast layered into rain. ===
  {
    id: "3-1", name: "Zig and Zag", block: 3, index: 1, difficulty: 3,
    waves: [
      "size=2-3, rate=0.85, speed=1.15, count=8, seed=2443519742",
      "size=1, rate=0.2, speed=1.2, count=16, seed=2460297361",
      "size=3, rate=0.8, speed=1.2, count=9, walls=zigzag, pct=normal:75,coin:15,sticky:10, seed=2409964504",
      "size=1, rate=0.18, speed=1.25, count=18, walls=zigzag, seed=2426742123",
      "count=0, slotRate=0.5, speed=1.25, walls=zigzag, 130,230,330,430,530,330,230,130,330, seed=2510630218",
      "size=3-4, rate=0.7, speed=1.3, count=11, walls=zigzag, pct=normal:65,fast:20,coin:10,sticky:5, seed=2527407837",
      "size=1, rate=0.18, speed=1.35, count=20, walls=zigzag, seed=2477074980",
      "size=3-4, rate=0.65, speed=1.4, count=12, walls=zigzag, seed=2493852599",
      "count=0, slotRate=0.45, speed=1.4, walls=zigzag, 140,340,540,000,240,440,140,340,540, seed=2309298790",
      "size=1, rate=0.16, speed=1.45, count=22, walls=zigzag, seed=2326076409",
      "size=3-4, rate=0.55, speed=1.5, count=13, walls=zigzag, pct=normal:55,fast:15,sticky:20,coin:5,tiny:5, seed=2063529331",
      "size=1, rate=0.15, speed=1.55, count=26, walls=zigzag, seed=2046751712",
    ],
  },
  {
    id: "3-2", name: "Wall Crawler", block: 3, index: 2, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.85, speed=1.2, count=8, seed=3464567247",
      "size=1, rate=0.2, speed=1.25, count=16, walls=pinch, seed=3447789628",
      "size=3, rate=0.75, speed=1.3, count=9, walls=zigzag, pct=normal:65,sticky:25,coin:10, seed=3498122485",
      "size=1, rate=0.18, speed=1.3, count=18, walls=narrow, seed=3481344866",
      "count=0, slotRate=0.5, speed=1.3, walls=narrow, 230,330,430,000,330,430,230,000,330, seed=3397456771",
      "size=3, rate=0.7, speed=1.35, count=10, walls=zigzag, pct=normal:60,fast:20,slow:10,coin:10, seed=3380679152",
      "size=1, rate=0.18, speed=1.4, count=20, walls=zigzag, seed=3431012009",
      "size=3-4, rate=0.65, speed=1.45, count=11, walls=pinch, seed=3414234390",
      "size=1, rate=0.16, speed=1.5, count=22, walls=narrow, seed=3598788199",
      "count=0, slotRate=0.45, speed=1.45, walls=zigzag, 130,230,330,430,530,000,230,330,430, seed=3582010580",
      "size=3-4, rate=0.6, speed=1.55, count=12, walls=narrow, pct=normal:55,fast:15,sticky:15,slow:10,coin:5, seed=2386090724",
      "size=1, rate=0.15, speed=1.6, count=26, walls=zigzag, seed=2402868343",
      "size=3, rate=0.5, speed=1.65, count=14, walls=narrow, pct=normal:55,sticky:25,fast:15,coin:5, seed=2419645962",
    ],
  },
  {
    id: "3-3", name: "Heal & Hope", block: 3, index: 3, difficulty: 3,
    effects: { slowDuration: 5 },
    waves: [
      "size=2-3, rate=0.85, speed=1.15, count=8, pct=normal:65,sticky:25,coin:10, seed=3621780576",
      "size=1, rate=0.2, speed=1.25, count=16, seed=3638558195",
      "size=3, rate=0.75, speed=1.25, count=9, pct=normal:55,sticky:35,coin:10, seed=3655335814",
      "size=1, rate=0.18, speed=1.3, count=18, seed=3672113433",
      "size=3-4, rate=0.7, speed=1.35, count=10, walls=pinch, pct=normal:55,sticky:30,coin:15, seed=3688891052",
      "count=0, slotRate=0.5, speed=1.3, walls=pinch, 130,230,330,430,530,000,230,330,430, seed=3705668671",
      "size=1, rate=0.16, speed=1.4, count=22, seed=3722446290",
      "size=3-4, rate=0.65, speed=1.45, count=12, walls=zigzag, pct=normal:50,sticky:30,fast:5,coin:10,tiny:5, seed=3739223909",
      "size=1, rate=0.16, speed=1.5, count=24, walls=zigzag, seed=3756001528",
      "size=3-4, rate=0.55, speed=1.55, count=13, pct=normal:55,sticky:30,fast:5,coin:10, seed=3772779147",
      "count=0, slotRate=0.45, speed=1.5, walls=zigzag, 130,330,530,000,230,430,000,130,330,530, seed=731675129",
      "size=1, rate=0.15, speed=1.6, count=26, seed=714897510",
      "size=3, rate=0.5, speed=1.65, count=14, walls=zigzag, pct=normal:50,sticky:35,coin:15, seed=698119891",
    ],
  },
  {
    id: "3-4", name: "Hex Switchback", block: 3, index: 4, difficulty: 4,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.2, count=8, seed=1019221001",
      "size=1, rate=0.2, speed=1.3, count=16, walls=zigzag, seed=1002443382",
      "size=3, rate=0.75, speed=1.3, count=9, walls=zigzag, pct=normal:60,fast:20,sticky:10,coin:10, seed=985665763",
      "count=0, slotRate=0.5, speed=1.3, walls=zigzag, 130,230,330,430,530,330,230,130,330, seed=968888144",
      "size=1, rate=0.18, speed=1.4, count=20, walls=zigzag, seed=1086331477",
      "size=3-4, rate=0.7, speed=1.4, count=11, walls=zigzag, pct=normal:50,fast:25,slow:10,sticky:10,tiny:5, seed=1069553858",
      "size=1, rate=0.18, speed=1.45, count=22, walls=zigzag, seed=1052776239",
      "count=0, slotRate=0.45, speed=1.45, walls=zigzag, 140,240,340,440,540,000,340,440,540,440,340, seed=1035998620",
      "size=3-4, rate=0.6, speed=1.55, count=12, walls=narrow, seed=1153441953",
      "size=1, rate=0.16, speed=1.6, count=24, walls=zigzag, seed=1136664334",
      "size=3, rate=0.5, speed=1.65, count=14, walls=zigzag, pct=normal:60,fast:20,sticky:10,coin:10, seed=1432142898",
      "count=0, slotRate=0.4, speed=1.65, walls=zigzag, 130,230,330,430,530,000,230,330,430,000,130,530, seed=1448920517",
      "size=1, rate=0.15, speed=1.7, count=28, walls=zigzag, seed=1398587660",
      "size=3, rate=0.45, speed=1.75, count=15, walls=zigzag, pct=normal:55,sticky:25,fast:10,big:5,coin:5, seed=1415365279",
    ],
  },
  {
    id: "3-5", name: "Demon Run", block: 3, index: 5, difficulty: 5,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.8, speed=1.25, count=8, seed=1446156162",
      "size=1, rate=0.18, speed=1.3, count=18, walls=zigzag, seed=1462933781",
      "size=3, rate=0.7, speed=1.4, count=10, walls=zigzag, pct=normal:55,fast:20,sticky:15,coin:10, seed=1412600924",
      "count=0, slotRate=0.45, speed=1.35, walls=zigzag, 130,230,330,430,530,000,330,230,430,530,130, seed=1429378543",
      "size=1, rate=0.16, speed=1.45, count=20, walls=zigzag, seed=1379045686",
      "size=3-4, rate=0.65, speed=1.5, count=11, walls=zigzag, pct=normal:45,fast:25,slow:10,sticky:10,coin:5,tiny:5, seed=1395823305",
      "size=1, rate=0.16, speed=1.55, count=22, walls=zigzag, seed=1345490448",
      "count=0, slotRate=0.4, speed=1.55, walls=zigzag, 140,340,540,000,240,440,140,340,540,440,340,240, seed=1362268067",
      "size=3-4, rate=0.55, speed=1.6, count=13, walls=narrow, seed=1580377114",
      "size=1, rate=0.15, speed=1.65, count=24, walls=zigzag, seed=1597154733",
      "size=3, rate=0.5, speed=1.7, count=14, walls=zigzag, pct=normal:55,fast:25,sticky:10,coin:10, seed=1772557631",
      "count=0, slotRate=0.4, speed=1.7, walls=zigzag, 140,340,540,000,240,440,000,340,540,440,340,240,140, seed=1755780012",
      "size=1, rate=0.14, speed=1.75, count=28, walls=zigzag, seed=1806112869",
      "size=3, rate=0.45, speed=1.8, count=15, walls=zigzag, pct=normal:50,sticky:30,fast:10,big:5,coin:5, seed=1789335250",
      "size=1, rate=0.14, speed=1.85, count=30, walls=zigzag, seed=1705447155",
    ],
  },

  // === Block 4 — Hex Veteran. Narrow corridors + fast/sticky in dense rain. ===
  {
    id: "4-1", name: "Narrow Margins", block: 4, index: 1, difficulty: 3,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.25, count=8, seed=4182357923",
      "size=1, rate=0.2, speed=1.3, count=16, walls=narrow, seed=4165580304",
      "size=3, rate=0.75, speed=1.35, count=10, walls=narrow, pct=normal:65,sticky:20,fast:10,coin:5, seed=4215913161",
      "size=1, rate=0.18, speed=1.4, count=18, walls=narrow, seed=4199135542",
      "count=0, slotRate=0.45, speed=1.4, walls=narrow, 230,330,430,000,330,430,230,000,330, seed=4249468399",
      "size=3, rate=0.7, speed=1.45, count=11, walls=narrow, pct=normal:55,fast:25,slow:10,sticky:10, seed=4232690780",
      "size=1, rate=0.16, speed=1.5, count=22, walls=narrow, seed=4283023637",
      "size=3, rate=0.6, speed=1.55, count=12, walls=zigzag, seed=4266246018",
      "count=0, slotRate=0.4, speed=1.55, walls=narrow, 130,230,330,000,230,330,130,000,230,330, seed=21611579",
      "size=1, rate=0.15, speed=1.6, count=24, walls=narrow, seed=4833960",
      "size=3, rate=0.55, speed=1.65, count=13, walls=narrow, pct=normal:50,fast:20,sticky:20,coin:5,tiny:5, seed=4228494432",
      "size=1, rate=0.14, speed=1.7, count=28, walls=narrow, seed=4245272051",
      "size=3, rate=0.5, speed=1.75, count=14, walls=narrow, pct=normal:55,sticky:25,fast:15,coin:5, seed=4262049670",
      "size=1, rate=0.14, speed=1.8, count=30, walls=zigzag, seed=4278827289",
    ],
  },
  {
    id: "4-2", name: "Speed Trap", block: 4, index: 2, difficulty: 4,
    effects: { fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.3, count=9, pct=normal:65,fast:25,coin:10, seed=3161310418",
      "size=1, rate=0.18, speed=1.4, count=18, seed=3178088037",
      "size=3, rate=0.7, speed=1.45, count=10, walls=zigzag, pct=normal:55,fast:30,coin:15, seed=3127755180",
      "size=1, rate=0.16, speed=1.5, count=20, walls=zigzag, seed=3144532799",
      "count=0, slotRate=0.45, speed=1.5, walls=zigzag, 130,230,330,430,530,000,230,330,430, seed=3094199942",
      "size=3-4, rate=0.6, speed=1.6, count=12, walls=narrow, pct=normal:45,fast:25,slow:10,sticky:10,big:10, seed=3110977561",
      "size=1, rate=0.16, speed=1.65, count=22, walls=zigzag, seed=3060644704",
      "size=3, rate=0.55, speed=1.7, count=13, walls=zigzag, seed=3077422323",
      "count=0, slotRate=0.4, speed=1.65, walls=zigzag, 230,330,430,000,330,430,230,000,330, seed=3295531370",
      "size=1, rate=0.14, speed=1.75, count=24, walls=narrow, seed=3312308989",
      "size=3, rate=0.5, speed=1.8, count=14, walls=zigzag, pct=normal:45,fast:25,slow:5,sticky:20,big:5, seed=2295281615",
      "size=1, rate=0.14, speed=1.85, count=28, walls=zigzag, seed=2278503996",
      "size=3, rate=0.45, speed=1.95, count=15, walls=narrow, pct=normal:50,sticky:25,fast:15,big:10, seed=2328836853",
      "size=1, rate=0.13, speed=2.0, count=32, walls=zigzag, seed=2312059234",
    ],
  },
  {
    id: "4-3", name: "The Funnel", block: 4, index: 3, difficulty: 4,
    effects: { slowDuration: 5, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.3, count=9, walls=pinch, seed=2734375257",
      "size=1, rate=0.18, speed=1.4, count=18, walls=pinch, seed=2717597638",
      "size=3, rate=0.7, speed=1.45, count=10, walls=narrow, pct=normal:65,sticky:20,coin:15, seed=2700820019",
      "size=1, rate=0.16, speed=1.5, count=20, walls=narrow, seed=2684042400",
      "count=0, slotRate=0.45, speed=1.5, walls=narrow, 230,330,430,000,330,230,430,000,330, seed=2801485733",
      "size=3, rate=0.65, speed=1.55, count=11, walls=narrow, pct=normal:50,fast:25,slow:10,sticky:10,coin:5, seed=2784708114",
      "size=1, rate=0.16, speed=1.6, count=22, walls=narrow, seed=2767930495",
      "size=3, rate=0.6, speed=1.65, count=12, walls=zigzag, seed=2751152876",
      "size=1, rate=0.15, speed=1.7, count=24, walls=narrow, seed=2868596209",
      "count=0, slotRate=0.4, speed=1.65, walls=narrow, 230,330,430,000,330,430,230,000,330,430, seed=2851818590",
      "size=3, rate=0.55, speed=1.75, count=13, walls=narrow, pct=normal:45,fast:20,sticky:25,slow:5,tiny:5, seed=4102402114",
      "size=1, rate=0.14, speed=1.8, count=26, walls=narrow, seed=4119179733",
      "size=3, rate=0.5, speed=1.85, count=14, walls=narrow, pct=normal:55,sticky:25,fast:15,coin:5, seed=4068846876",
      "size=1, rate=0.13, speed=1.95, count=30, walls=narrow, seed=4085624495",
      "size=3, rate=0.45, speed=2.0, count=15, walls=narrow, seed=4035291638",
    ],
  },
  {
    id: "4-4", name: "Fast Forward", block: 4, index: 4, difficulty: 5,
    effects: { fastDuration: 4, slowDuration: 4 },
    waves: [
      "size=2-3, rate=0.8, speed=1.4, count=9, seed=1041967536",
      "size=1, rate=0.18, speed=1.5, count=18, seed=1058745155",
      "size=3, rate=0.7, speed=1.55, count=10, walls=zigzag, pct=normal:50,fast:35,coin:15, seed=1075522774",
      "size=1, rate=0.16, speed=1.6, count=20, walls=zigzag, seed=1092300393",
      "count=0, slotRate=0.45, speed=1.55, walls=zigzag, 130,230,330,430,530,000,230,330,430,530, seed=1109078012",
      "size=3, rate=0.6, speed=1.7, count=12, walls=narrow, pct=normal:40,fast:30,slow:10,sticky:10,big:10, seed=1125855631",
      "size=1, rate=0.15, speed=1.75, count=22, walls=zigzag, seed=1142633250",
      "size=3, rate=0.55, speed=1.8, count=13, walls=zigzag, seed=1159410869",
      "size=1, rate=0.14, speed=1.85, count=24, walls=narrow, seed=1176188488",
      "count=0, slotRate=0.4, speed=1.85, walls=zigzag, 140,340,540,000,240,440,140,340,540,440,340,240, seed=1192966107",
      "size=3, rate=0.5, speed=1.95, count=15, walls=zigzag, pct=normal:40,fast:25,slow:10,sticky:15,big:10, seed=3401934345",
      "size=1, rate=0.13, speed=2.0, count=28, walls=zigzag, seed=3385156726",
      "size=3, rate=0.45, speed=2.1, count=16, walls=narrow, seed=3368379107",
      "size=1, rate=0.13, speed=2.15, count=32, walls=zigzag, seed=3351601488",
      "size=3, rate=0.4, speed=2.2, count=17, walls=zigzag, pct=normal:50,sticky:25,fast:15,big:10, seed=3469044821",
    ],
  },
  {
    id: "4-5", name: "The Vise", block: 4, index: 5, difficulty: 5,
    effects: { slowDuration: 4, fastDuration: 4 },
    waves: [
      "size=2-3, rate=0.85, speed=1.35, count=9, walls=pinch, seed=884754207",
      "size=1, rate=0.18, speed=1.45, count=18, walls=narrow, seed=867976588",
      "size=3, rate=0.7, speed=1.5, count=10, walls=narrow, pct=normal:55,fast:20,sticky:15,slow:10, seed=918309445",
      "size=1, rate=0.16, speed=1.55, count=20, walls=narrow, seed=901531826",
      "count=0, slotRate=0.45, speed=1.5, walls=narrow, 230,330,430,000,330,430,230,000,330,430, seed=817643731",
      "size=3, rate=0.65, speed=1.6, count=11, walls=narrow, seed=800866112",
      "size=1, rate=0.15, speed=1.65, count=22, walls=narrow, seed=851198969",
      "size=3, rate=0.6, speed=1.7, count=12, walls=narrow, pct=normal:45,fast:25,slow:15,sticky:10,tiny:5, seed=834421350",
      "count=0, slotRate=0.4, speed=1.7, walls=narrow, 230,330,430,000,330,230,430,000,330,430,230, seed=1018975159",
      "size=1, rate=0.14, speed=1.8, count=24, walls=narrow, seed=1002197540",
      "size=3, rate=0.55, speed=1.85, count=13, walls=narrow, seed=761382644",
      "size=1, rate=0.13, speed=1.9, count=28, walls=narrow, seed=778160263",
      "size=3, rate=0.5, speed=2.0, count=14, walls=narrow, pct=normal:45,fast:20,sticky:25,slow:5,tiny:5, seed=794937882",
      "size=1, rate=0.13, speed=2.05, count=30, walls=narrow, seed=811715501",
      "size=3, rate=0.45, speed=2.15, count=15, walls=narrow, pct=normal:50,sticky:30,fast:15,big:5, seed=694272168",
    ],
  },

  // === Block 5 — Brink of Mastery. Endurance + shield pickups. ===
  {
    id: "5-1", name: "Long Haul", block: 5, index: 1, difficulty: 4,
    effects: { slowDuration: 5, shieldDuration: 12 },
    waves: makeLongHaul("5-1", 30, 1.2, 1.8, 0.9, 0.45),
  },
  {
    id: "5-2", name: "Endurance", block: 5, index: 2, difficulty: 4,
    effects: { slowDuration: 5, shieldDuration: 12 },
    waves: makeLongHaul("5-2", 35, 1.25, 1.85, 0.85, 0.45),
  },
  {
    id: "5-3", name: "Iron Will", block: 5, index: 3, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 12 },
    waves: makeLongHaul("5-3", 40, 1.3, 1.9, 0.85, 0.4),
  },
  {
    id: "5-4", name: "Hex Marathon", block: 5, index: 4, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 12, fastDuration: 4 },
    waves: makeLongHaul("5-4", 50, 1.3, 1.95, 0.8, 0.4),
  },
  {
    id: "5-5", name: "The Crucible", block: 5, index: 5, difficulty: 5,
    effects: { slowDuration: 4, shieldDuration: 10, fastDuration: 4 },
    waves: makeLongHaul("5-5", 60, 1.35, 2.0, 0.75, 0.38),
  },

  // === Block 6 — Hex Master. Final ladder. ===
  {
    id: "6-1", name: "Ascendant", block: 6, index: 1, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder("6-1", 60, 1.4, 2.0),
  },
  {
    id: "6-2", name: "Apex", block: 6, index: 2, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder("6-2", 70, 1.4, 2.05),
  },
  {
    id: "6-3", name: "Pinnacle", block: 6, index: 3, difficulty: 5,
    effects: { slowDuration: 5, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder("6-3", 80, 1.45, 2.1),
  },
  {
    id: "6-4", name: "The Climb", block: 6, index: 4, difficulty: 5,
    effects: { slowDuration: 4, shieldDuration: 10, fastDuration: 4, droneDuration: 12 },
    waves: makeFinalLadder("6-4", 90, 1.5, 2.15),
  },
  {
    id: "6-5", name: "Gauntlet of Fear", block: 6, index: 5, difficulty: 5,
    effects: { slowDuration: 4, shieldDuration: 10, fastDuration: 3, droneDuration: 10 },
    waves: makeFinalLadder("6-5", 100, 1.55, 2.2),
  },
];

// Helper that builds a long endurance wave list of `n` waves, ramping
// speed from `startSpeed` → `endSpeed` and rate from `startRate` →
// `endRate`. Mixes probabilistic, single-hex rain, scripted, and
// power-up-heavy waves for a varied feel.
// `id` is the challenge id this builder is being called for, e.g. "5-1".
// Each emitted wave gets an explicit `seed=hashSeed(id:idx)` so that
// generated waves match the literal-block roster: the seed is the same
// derived default the engine would produce, but it lives in the wave
// string so a designer can override it later (and so the seed-roster
// audit script doesn't need to re-derive it).
function makeLongHaul(id: string, n: number, startSpeed: number, endSpeed: number, startRate: number, endRate: number): string[] {
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
  return out.map((line, idx) => `${line}, seed=${hashSeed(`${id}:${idx}`)}`);
}

// Final-ladder builder: even denser than makeLongHaul, drones and shields available.
// `id` enables explicit per-wave seeds (see makeLongHaul comment).
function makeFinalLadder(id: string, n: number, startSpeed: number, endSpeed: number): string[] {
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
  return out.map((line, idx) => `${line}, seed=${hashSeed(`${id}:${idx}`)}`);
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
  const parsed = loadJson<Partial<ChallengeProgress> | null>(STORAGE_KEY, null);
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
}

function save(p: ChallengeProgress): void {
  if (DEBUG_MODE) return;
  saveJson(STORAGE_KEY, p);
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

// Roster validation lives in tests/challenges-defs.test.ts (Phase 4.1).
// CI fails the build if any check trips, instead of just printing to
// console.error in the dev environment.
