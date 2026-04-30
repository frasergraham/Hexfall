// Player-authored challenges. Stored in a separate localStorage key so
// the editor stays scoped to the editor — roster progress in
// hexrain.challenges.v1 is never touched by custom runs. Custom challenges
// are converted to a synthetic ChallengeDef at launch time and fed through
// the existing startChallenge() pipeline.

import { parseWaveLine, type ChallengeDefLike } from "./waveDsl";
import type { ChallengeDef } from "./challenges";

const STORAGE_KEY = "hexrain.customChallenges.v1";

export const MAX_WAVES_PER_CUSTOM = 100;
export const MAX_CUSTOM_NAME_LEN = 36;

export interface CustomChallengeEffects {
  slowDuration: number;
  fastDuration: number;
  shieldDuration: number;
  droneDuration: number;
}

export interface CustomChallengeStars {
  one: number;
  two: number;
  three: number;
}

export interface CustomChallenge {
  id: string;
  name: string;
  seed: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  effects: CustomChallengeEffects;
  stars: CustomChallengeStars;
  waves: string[];
  createdAt: number;
  updatedAt: number;
  best: number;
  bestPct: number;
  starsEarned: 0 | 1 | 2 | 3;
}

export interface CustomChallengeStore {
  v: 1;
  challenges: CustomChallenge[];
}

const DEFAULT_EFFECTS: CustomChallengeEffects = {
  slowDuration: 5,
  fastDuration: 5,
  shieldDuration: 10,
  droneDuration: 10,
};

const EMPTY_STORE: CustomChallengeStore = { v: 1, challenges: [] };

const DEFAULT_WAVE_DSL = "size=2-3, rate=0.7, speed=1.2, count=10";

// Custom-challenge IDs use a `custom:` prefix so they never collide with
// the roster's `B-I` regex (`^\d-\d$`). isCustomChallenge() checks this
// prefix; the rest of the engine treats them as ordinary ChallengeDefs.
const CUSTOM_ID_PREFIX = "custom:";

function makeCustomId(): string {
  const rnd =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return CUSTOM_ID_PREFIX + rnd;
}

export function isCustomChallengeId(id: string): boolean {
  return typeof id === "string" && id.startsWith(CUSTOM_ID_PREFIX);
}

export function isCustomChallenge(def: ChallengeDef | ChallengeDefLike | null | undefined): boolean {
  return !!def && isCustomChallengeId(def.id);
}

export function makeRandomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// Round-trip-safe defaults: every field present and well-typed so the
// editor doesn't have to thread `?? defaults` through every render.
function fillDefaults(c: Partial<CustomChallenge>): CustomChallenge {
  const now = Date.now();
  return {
    id: c.id ?? makeCustomId(),
    name: typeof c.name === "string" ? c.name.slice(0, MAX_CUSTOM_NAME_LEN) : "Untitled",
    seed: typeof c.seed === "number" && Number.isFinite(c.seed) ? (c.seed >>> 0) : makeRandomSeed(),
    difficulty: clampDifficulty(c.difficulty ?? 3),
    effects: {
      slowDuration: numOr(c.effects?.slowDuration, DEFAULT_EFFECTS.slowDuration),
      fastDuration: numOr(c.effects?.fastDuration, DEFAULT_EFFECTS.fastDuration),
      shieldDuration: numOr(c.effects?.shieldDuration, DEFAULT_EFFECTS.shieldDuration),
      droneDuration: numOr(c.effects?.droneDuration, DEFAULT_EFFECTS.droneDuration),
    },
    stars: {
      one: numOr(c.stars?.one, 1),
      two: numOr(c.stars?.two, 2),
      three: numOr(c.stars?.three, 3),
    },
    waves: Array.isArray(c.waves) && c.waves.length > 0
      ? c.waves.slice(0, MAX_WAVES_PER_CUSTOM).filter((w) => typeof w === "string")
      : [DEFAULT_WAVE_DSL],
    createdAt: typeof c.createdAt === "number" ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : now,
    best: numOr(c.best, 0),
    bestPct: clamp(numOr(c.bestPct, 0), 0, 100),
    starsEarned: clampStars(c.starsEarned ?? 0),
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampDifficulty(v: number): 1 | 2 | 3 | 4 | 5 {
  return clamp(Math.round(v), 1, 5) as 1 | 2 | 3 | 4 | 5;
}

function clampStars(v: number): 0 | 1 | 2 | 3 {
  return clamp(Math.round(v), 0, 3) as 0 | 1 | 2 | 3;
}

export function loadCustomChallenges(): CustomChallengeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STORE };
    const parsed = JSON.parse(raw) as Partial<CustomChallengeStore> | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.challenges)) {
      return { ...EMPTY_STORE };
    }
    const challenges = parsed.challenges
      .filter((c) => !!c && typeof c === "object")
      .map((c) => fillDefaults(c as Partial<CustomChallenge>));
    return { v: 1, challenges };
  } catch {
    return { ...EMPTY_STORE };
  }
}

function saveStore(store: CustomChallengeStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota / private mode
  }
}

export function listCustomChallenges(): CustomChallenge[] {
  return loadCustomChallenges().challenges;
}

export function getCustomChallenge(id: string): CustomChallenge | undefined {
  return loadCustomChallenges().challenges.find((c) => c.id === id);
}

export function createCustomChallenge(): CustomChallenge {
  const store = loadCustomChallenges();
  const fresh = fillDefaults({});
  store.challenges.push(fresh);
  saveStore(store);
  return fresh;
}

// Persist a complete CustomChallenge. Bumps updatedAt. Run-stat fields
// (best/bestPct/starsEarned) are preserved from the existing record so
// editing a challenge doesn't wipe its stats.
export function upsertCustomChallenge(c: CustomChallenge): CustomChallenge {
  const store = loadCustomChallenges();
  const idx = store.challenges.findIndex((x) => x.id === c.id);
  const prev = idx >= 0 ? store.challenges[idx]! : null;
  const merged: CustomChallenge = fillDefaults({
    ...c,
    best: prev?.best ?? c.best ?? 0,
    bestPct: prev?.bestPct ?? c.bestPct ?? 0,
    starsEarned: prev?.starsEarned ?? c.starsEarned ?? 0,
    createdAt: prev?.createdAt ?? c.createdAt,
    updatedAt: Date.now(),
  });
  if (idx >= 0) store.challenges[idx] = merged;
  else store.challenges.push(merged);
  saveStore(store);
  return merged;
}

export function deleteCustomChallenge(id: string): void {
  const store = loadCustomChallenges();
  const next = store.challenges.filter((c) => c.id !== id);
  if (next.length === store.challenges.length) return;
  saveStore({ v: 1, challenges: next });
}

// Update only run-result fields. Called after a custom run completes so
// best/stars persist without touching authored content.
export function saveCustomChallengeRun(
  id: string,
  score: number,
  pct: number,
  stars: 0 | 1 | 2 | 3,
): void {
  const store = loadCustomChallenges();
  const idx = store.challenges.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const prev = store.challenges[idx]!;
  const newBest = Math.max(prev.best, Math.max(0, Math.round(score)));
  const newPct = clamp(Math.round(Math.max(prev.bestPct, pct * 100)), 0, 100);
  const newStars = Math.max(prev.starsEarned, stars) as 0 | 1 | 2 | 3;
  if (newBest === prev.best && newPct === prev.bestPct && newStars === prev.starsEarned) return;
  store.challenges[idx] = {
    ...prev,
    best: newBest,
    bestPct: newPct,
    starsEarned: newStars,
  };
  saveStore(store);
}

// Validate a CustomChallenge for play. Rejects when waves don't parse
// or no wave actually does anything (count > 0, slots, or dur+rate).
// Returns a list of human-readable errors — empty array means OK.
export function validateCustomChallenge(c: CustomChallenge): string[] {
  const errors: string[] = [];
  if (!c.name.trim()) errors.push("Name cannot be empty.");
  if (!Array.isArray(c.waves) || c.waves.length === 0) {
    errors.push("Challenge needs at least one wave.");
    return errors;
  }
  if (c.waves.length > MAX_WAVES_PER_CUSTOM) {
    errors.push(`Too many waves (max ${MAX_WAVES_PER_CUSTOM}).`);
  }
  for (let i = 0; i < c.waves.length; i++) {
    const line = c.waves[i]!;
    try {
      const parsed = parseWaveLine(line);
      const hasCount = parsed.countCap !== null && parsed.countCap > 0;
      const hasSlots = parsed.slots.length > 0;
      const probDisabledByZeroCount = parsed.countCap === 0;
      const hasDur =
        parsed.durOverride !== null &&
        parsed.durOverride > 0 &&
        parsed.spawnInterval > 0 &&
        !probDisabledByZeroCount;
      if (!hasCount && !hasSlots && !hasDur) {
        errors.push(`Wave ${i + 1}: wave does nothing.`);
      }
    } catch (e) {
      errors.push(`Wave ${i + 1}: ${(e as Error).message}`);
    }
  }
  return errors;
}

// Convert a custom challenge into the synthetic ChallengeDef the engine
// expects. Block/index are dummies — the runtime uses them only for the
// roster grid layout, which custom challenges don't appear in.
export function toChallengeDef(c: CustomChallenge): ChallengeDef {
  return {
    id: c.id,
    name: c.name,
    block: 1,
    index: 1,
    difficulty: c.difficulty,
    effects: { ...c.effects },
    waves: [...c.waves],
  };
}
