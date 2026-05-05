// Player-authored challenges. Stored in a separate localStorage key so
// the editor stays scoped to the editor — roster progress in
// hexrain.challenges.v1 is never touched by custom runs. Custom challenges
// are converted to a synthetic ChallengeDef at launch time and fed through
// the existing startChallenge() pipeline.

import { parseWaveLine, type ChallengeDefLike } from "./waveDsl";
import type { ChallengeDef } from "./challenges";
import { syncProgressUp } from "./cloudSync";
import { clamp, clampDifficulty, clampStars, numOr } from "./validation";
import { loadJson, saveJson } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";

const STORAGE_KEY = STORAGE_KEYS.customChallenges;

export const MAX_WAVES_PER_CUSTOM = 100;
export const MAX_CUSTOM_NAME_LEN = 36;

export interface CustomChallengeEffects {
  slowDuration: number;
  fastDuration: number;
  shieldDuration: number;
  droneDuration: number;
  /** Player size at which the danger glow appears and a blue hit
   *  becomes lethal. Default 7; lower = harder. */
  dangerSize: number;
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
  /** Source attribution for challenges cloned via the editor's
   *  "Remix Existing" flow. Holds the original roster challenge's
   *  display name (e.g. "Calm Block 2"). Surfaced in the editor home
   *  list as small "Remixed from: …" text. Undefined for from-scratch
   *  challenges. */
  remixedFrom?: string;

  // ----- Community / publish fields ------------------------------------
  // These are only populated on iOS once a challenge has been published
  // to the public CloudKit DB, or installed from someone else's publish.
  // They are additive; the editor and engine ignore unset fields, so
  // existing local challenges load and play unchanged.

  /** Set on the author's local copy after a successful publish. Acts as
   *  the key for future update / unpublish operations against the
   *  PublishedChallenge record in the public CloudKit DB. */
  publishedRecordName?: string;
  /** Last `version` value sent to the public DB for this challenge.
   *  Bumped on every successful re-publish so subscribers can detect
   *  outdated installs. */
  publishedVersion?: number;
  /** Set on a player's local copy when they install someone else's
   *  PublishedChallenge. Stores the source record name so the
   *  background subscription can patch this record in place when the
   *  author re-publishes. Mutually exclusive with publishedRecordName
   *  in normal use. */
  installedFrom?: string;
  /** The `version` of the PublishedChallenge record this local copy
   *  was last synced from. */
  installedVersion?: number;
  /** Display name of the original author, captured at install time so
   *  the community card can credit them without an extra fetch. */
  installedAuthorName?: string;
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
  dangerSize: 7,
};

const EMPTY_STORE: CustomChallengeStore = { v: 1, challenges: [] };

const DEFAULT_WAVE_DSL = "size=2-3, rate=0.7, speed=1.2, count=10";

// Custom-challenge IDs use a `custom:` prefix so they never collide with
// the roster's `B-I` regex (`^\d-\d$`). isCustomChallenge() checks this
// prefix; the rest of the engine treats them as ordinary ChallengeDefs.
const CUSTOM_ID_PREFIX = "custom:";

// Admin-only sub-prefix used by the web `?debug=1` "EDIT official" flow.
// A challenge with this id is a workbench copy of a roster challenge,
// destined for a JSON dump → CloudKit OfficialChallengeOverride upload.
// Stable per-roster-id so re-entering EDIT keeps prior local edits.
const OFFICIAL_EDIT_PREFIX = `${CUSTOM_ID_PREFIX}officialEdit:`;

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

export function isOfficialEditId(id: string): boolean {
  return typeof id === "string" && id.startsWith(OFFICIAL_EDIT_PREFIX);
}

export function makeOfficialEditId(rosterId: string): string {
  return `${OFFICIAL_EDIT_PREFIX}${rosterId}`;
}

export function rosterIdFromOfficialEditId(id: string): string | null {
  return isOfficialEditId(id) ? id.slice(OFFICIAL_EDIT_PREFIX.length) : null;
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
      dangerSize: numOr(c.effects?.dangerSize, DEFAULT_EFFECTS.dangerSize),
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
    remixedFrom: typeof c.remixedFrom === "string" && c.remixedFrom.length > 0
      ? c.remixedFrom
      : undefined,
    publishedRecordName: typeof c.publishedRecordName === "string" && c.publishedRecordName.length > 0
      ? c.publishedRecordName
      : undefined,
    publishedVersion: typeof c.publishedVersion === "number" && Number.isFinite(c.publishedVersion)
      ? Math.max(1, Math.round(c.publishedVersion))
      : undefined,
    installedFrom: typeof c.installedFrom === "string" && c.installedFrom.length > 0
      ? c.installedFrom
      : undefined,
    installedVersion: typeof c.installedVersion === "number" && Number.isFinite(c.installedVersion)
      ? Math.max(1, Math.round(c.installedVersion))
      : undefined,
    installedAuthorName: typeof c.installedAuthorName === "string" && c.installedAuthorName.length > 0
      ? c.installedAuthorName
      : undefined,
  };
}

// Numeric helpers (clamp, numOr, clampDifficulty, clampStars) live in
// src/validation.ts and are shared with cloudSync's record marshalling.

export function loadCustomChallenges(): CustomChallengeStore {
  const parsed = loadJson<Partial<CustomChallengeStore> | null>(STORAGE_KEY, null);
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.challenges)) {
    return { ...EMPTY_STORE };
  }
  const challenges = parsed.challenges
    .filter((c) => !!c && typeof c === "object")
    .map((c) => fillDefaults(c as Partial<CustomChallenge>));
  return { v: 1, challenges };
}

function saveStore(store: CustomChallengeStore): void {
  saveJson(STORAGE_KEY, store);
  // Push the updated custom-challenge set to the user's private CloudKit
  // DB (no-op on web / no iCloud). syncProgressUp is debounced internally.
  syncProgressUp();
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

// Clone a roster (or other ChallengeDef-shaped) challenge into the
// custom store so the player can tweak it. Copies waves, effects,
// difficulty, picks a fresh seed + id, zeroes run stats, and stamps
// `remixedFrom` with the source's display name for attribution. The
// new copy is named "<Original> Remix" so it doesn't collide with
// the original in the editor list.
export function remixCustomChallenge(source: {
  name: string;
  difficulty: number;
  effects: Partial<CustomChallengeEffects>;
  waves: string[];
  /** Optional source seed — pass it through so the remix plays out
   *  identically to the original for waves that lack an explicit
   *  `seed=` token. Omit (e.g. roster remix where ChallengeDef has no
   *  seed) and the new copy gets a fresh random seed. */
  seed?: number;
}): CustomChallenge {
  const store = loadCustomChallenges();
  const trimmedName = source.name.length > MAX_CUSTOM_NAME_LEN - 6
    ? source.name.slice(0, MAX_CUSTOM_NAME_LEN - 6).trimEnd()
    : source.name;
  const fresh = fillDefaults({
    name: `${trimmedName} Remix`,
    difficulty: clampDifficulty(source.difficulty) as 1 | 2 | 3 | 4 | 5,
    effects: {
      slowDuration: numOr(source.effects.slowDuration, DEFAULT_EFFECTS.slowDuration),
      fastDuration: numOr(source.effects.fastDuration, DEFAULT_EFFECTS.fastDuration),
      shieldDuration: numOr(source.effects.shieldDuration, DEFAULT_EFFECTS.shieldDuration),
      droneDuration: numOr(source.effects.droneDuration, DEFAULT_EFFECTS.droneDuration),
      dangerSize: numOr(source.effects.dangerSize, DEFAULT_EFFECTS.dangerSize),
    },
    waves: [...source.waves],
    remixedFrom: source.name,
    seed: source.seed,
  });
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
    // Attribution is set at creation (remix flow) and never overwritten
    // by subsequent edits — it's a permanent label, like "based on" credit.
    remixedFrom: prev?.remixedFrom ?? c.remixedFrom,
    // Publish/install state belongs to the existing record when one is
    // present. Caller code (cloudSync.ts) writes these explicitly via
    // bumpPublishedVersion / setInstalledMeta — never via this generic
    // upsert path — so we always keep what was already on disk.
    publishedRecordName: prev?.publishedRecordName ?? c.publishedRecordName,
    publishedVersion: prev?.publishedVersion ?? c.publishedVersion,
    installedFrom: prev?.installedFrom ?? c.installedFrom,
    installedVersion: prev?.installedVersion ?? c.installedVersion,
    installedAuthorName: prev?.installedAuthorName ?? c.installedAuthorName,
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
  return [
    ...validateName(c),
    ...validateWaveCount(c),
    ...validateWaveLines(c),
  ];
}

function validateName(c: CustomChallenge): string[] {
  return c.name.trim() ? [] : ["Name cannot be empty."];
}

function validateWaveCount(c: CustomChallenge): string[] {
  if (!Array.isArray(c.waves) || c.waves.length === 0) {
    return ["Challenge needs at least one wave."];
  }
  if (c.waves.length > MAX_WAVES_PER_CUSTOM) {
    return [`Too many waves (max ${MAX_WAVES_PER_CUSTOM}).`];
  }
  return [];
}

function validateWaveLines(c: CustomChallenge): string[] {
  if (!Array.isArray(c.waves) || c.waves.length === 0) return [];
  const errors: string[] = [];
  for (let i = 0; i < c.waves.length; i++) {
    const err = validateOneWaveLine(c.waves[i]!);
    if (err) errors.push(`Wave ${i + 1}: ${err}`);
  }
  return errors;
}

function validateOneWaveLine(line: string): string | null {
  let parsed;
  try {
    parsed = parseWaveLine(line);
  } catch (e) {
    return (e as Error).message;
  }
  const hasCount = parsed.countCap !== null && parsed.countCap > 0;
  const hasSlots = parsed.slots.length > 0;
  const probDisabledByZeroCount = parsed.countCap === 0;
  const hasDur =
    parsed.durOverride !== null &&
    parsed.durOverride > 0 &&
    parsed.spawnInterval > 0 &&
    !probDisabledByZeroCount;
  return hasCount || hasSlots || hasDur ? null : "wave does nothing.";
}

// Stamp the publish state on the author's local record after a publish
// or update succeeds. Bumps updatedAt so the editor list reflects the
// publish timestamp. Idempotent — no-op when the challenge no longer
// exists locally (e.g. user deleted while a slow publish was in flight).
export function setPublishedMeta(
  id: string,
  publishedRecordName: string,
  publishedVersion: number,
): void {
  const store = loadCustomChallenges();
  const idx = store.challenges.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const prev = store.challenges[idx]!;
  store.challenges[idx] = {
    ...prev,
    publishedRecordName,
    publishedVersion: Math.max(1, Math.round(publishedVersion)),
    updatedAt: Date.now(),
  };
  saveStore(store);
}

// Strip publish state on a successful unpublish.
export function clearPublishedMeta(id: string): void {
  const store = loadCustomChallenges();
  const idx = store.challenges.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const prev = store.challenges[idx]!;
  if (!prev.publishedRecordName && !prev.publishedVersion) return;
  store.challenges[idx] = {
    ...prev,
    publishedRecordName: undefined,
    publishedVersion: undefined,
    updatedAt: Date.now(),
  };
  saveStore(store);
}

// Refresh an installed challenge's authored content (waves, effects,
// difficulty, name, stars) from the latest published version. Run-stat
// fields (best, bestPct, starsEarned) and the local id are preserved
// so the player's progress carries over the silent auto-update.
export function applyInstalledUpdate(
  installedFrom: string,
  patch: {
    name: string;
    difficulty: 1 | 2 | 3 | 4 | 5;
    seed: number;
    effects: CustomChallengeEffects;
    waves: string[];
    stars: CustomChallengeStars;
    installedVersion: number;
    installedAuthorName?: string;
  },
): void {
  const store = loadCustomChallenges();
  const idx = store.challenges.findIndex((c) => c.installedFrom === installedFrom);
  if (idx < 0) return;
  const prev = store.challenges[idx]!;
  store.challenges[idx] = {
    ...prev,
    name: patch.name.slice(0, MAX_CUSTOM_NAME_LEN),
    difficulty: patch.difficulty,
    seed: patch.seed >>> 0,
    effects: { ...patch.effects },
    waves: patch.waves.slice(0, MAX_WAVES_PER_CUSTOM),
    stars: { ...patch.stars },
    installedVersion: Math.max(1, Math.round(patch.installedVersion)),
    installedAuthorName: patch.installedAuthorName ?? prev.installedAuthorName,
    updatedAt: Date.now(),
  };
  saveStore(store);
}

// Find a local custom challenge by either publish-side (author copy)
// or install-side (subscriber copy) record name. Returns undefined when
// neither matches — useful when reconciling remote state on launch.
export function findCustomByPublishedRecord(recordName: string): CustomChallenge | undefined {
  return loadCustomChallenges().challenges.find(
    (c) => c.publishedRecordName === recordName || c.installedFrom === recordName,
  );
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
