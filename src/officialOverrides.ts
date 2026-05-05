// Cloud-delivered overrides for the hardcoded CHALLENGES roster.
//
// Why: shipping a balance tweak to an official challenge currently
// requires an app release — fine for web, painful for iOS. This module
// is a thin shim that lets the game pull a "newer" version of any
// roster challenge from CloudKit at cold launch, persist it locally,
// and apply it on top of the hardcoded def at runtime.
//
// Scope of an override (deliberately narrow):
//   - Replaces gameplay-affecting fields: name, difficulty, effects, waves.
//   - Optional explicit star thresholds — when present, used verbatim;
//     when absent, computeStarThresholds re-runs against the new waves.
//   - Does NOT change id / block / index. Those drive unlock plumbing
//     and progress storage; an override that pretends a challenge lives
//     in a different block could brick the unlock graph. Override JSON
//     may carry those fields for round-tripping with the editor, but
//     we ignore them at apply time.
//
// High scores, completion %, earned stars all key off challenge id, so
// overrides leave them intact (the user spec called this out: "minor
// tweaks only" — players keep their progress across an override).
//
// Versioning:
//   - Each override carries a monotonic `version`. Storing
//     lastSeenVersion locally lets us re-arm the "UPDATED" badge when a
//     newer version arrives.
//   - badgeSeen flips to false whenever we apply a strictly higher
//     version, and back to true on first play of that challenge.

import type { ChallengeDef } from "./challenges";
import { BAKED_OVERRIDE_VERSIONS, CHALLENGES, challengeById } from "./challenges";
import { parseWaveLine } from "./waveDsl";
import { loadJson, saveJson } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";

export interface OfficialChallengeOverridePayload {
  /** Roster id this overrides, e.g. "1-3". */
  challengeId: string;
  /** Replacement display name. */
  name: string;
  /** Replacement difficulty 1..5. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Per-effect duration overrides (subset of ChallengeDef.effects). */
  effects?: ChallengeDef["effects"];
  /** Wave DSL lines. Validated against parseWaveLine on apply. */
  waves: string[];
  /** Optional manual star thresholds. Omit to recompute. */
  stars?: { one: number; two: number; three: number };
  /** Monotonic version number. Bumped on a normal upload; held flat by
   *  the admin tool's --publish-silently flag. Newer version re-arms the
   *  UPDATED badge for cached clients; equal version doesn't. */
  version: number;
  /** Server-side updated-at timestamp. Drives content refresh on the
   *  client even when version is unchanged — that's the silent-publish
   *  path: change the JSON, hold the version, players quietly get the
   *  new copy without the UPDATED pill flashing again. */
  updatedAt: number;
  /** Author-facing changelog blurb. Not surfaced in-game today. */
  note?: string;
}

export interface OverrideStoreEntry {
  payload: OfficialChallengeOverridePayload;
  /** Highest version we've applied locally. Drives the UPDATED badge
   *  re-arm decision — incoming `version > lastSeenVersion` flips
   *  badgeSeen back to false. */
  lastSeenVersion: number;
  /** Last server-side updatedAt we applied. Used to decide whether to
   *  refresh the local payload regardless of version — silent publishes
   *  bump updatedAt without bumping version. */
  lastSeenUpdatedAt: number;
  /** False until the player starts a run on this challenge after the
   *  most recent version was applied. Drives the UPDATED pill. */
  badgeSeen: boolean;
  /** Wall-clock when we wrote this entry — for debugging only. */
  fetchedAt: number;
}

interface OverrideStore {
  v: 1;
  byId: Record<string, OverrideStoreEntry>;
}

const STORAGE_KEY = STORAGE_KEYS.officialOverrides;

// Lazy roster-id index. We can't build this at module top because
// challenges.ts is part of an import cycle (challenges → cloudSync →
// officialOverrides → challenges); CHALLENGES is still undefined when
// this module initialises. First call materialises the Set, subsequent
// calls reuse it.
let ROSTER_IDS: Set<string> | null = null;
function rosterIds(): Set<string> {
  if (!ROSTER_IDS) ROSTER_IDS = new Set(CHALLENGES.map((c) => c.id));
  return ROSTER_IDS;
}

// Re-export the roster's name list so the diff/dump tool can reason
// about what's a valid override target without re-reading challenges.ts.
export function isRosterId(id: string): boolean {
  return rosterIds().has(id);
}

// ---------- Validation ---------------------------------------------------

export interface ValidatePayloadResult {
  ok: boolean;
  errors: string[];
}

export function validatePayload(p: unknown): ValidatePayloadResult {
  const errors: string[] = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["not an object"] };
  const obj = p as Partial<OfficialChallengeOverridePayload>;
  if (typeof obj.challengeId !== "string" || !rosterIds().has(obj.challengeId)) {
    errors.push(`unknown challengeId: ${obj.challengeId}`);
  }
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    errors.push("name missing");
  }
  const d = obj.difficulty;
  if (typeof d !== "number" || d < 1 || d > 5 || !Number.isFinite(d)) {
    errors.push(`difficulty out of range: ${d}`);
  }
  if (!Array.isArray(obj.waves) || obj.waves.length === 0) {
    errors.push("waves empty");
  } else {
    for (let i = 0; i < obj.waves.length; i++) {
      const w = obj.waves[i];
      if (typeof w !== "string") {
        errors.push(`wave ${i + 1}: not a string`);
        continue;
      }
      try { parseWaveLine(w); } catch (e) {
        errors.push(`wave ${i + 1}: ${(e as Error).message}`);
      }
    }
  }
  if (typeof obj.version !== "number" || obj.version < 1 || !Number.isFinite(obj.version)) {
    errors.push(`version invalid: ${obj.version}`);
  }
  if (typeof obj.updatedAt !== "number" || obj.updatedAt <= 0 || !Number.isFinite(obj.updatedAt)) {
    errors.push(`updatedAt invalid: ${obj.updatedAt}`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------- Storage ------------------------------------------------------

export function loadOverrideStore(): OverrideStore {
  const parsed = loadJson<Partial<OverrideStore> | null>(STORAGE_KEY, null);
  if (!parsed || parsed.v !== 1 || !parsed.byId || typeof parsed.byId !== "object") {
    return { v: 1, byId: {} };
  }
  // Filter out entries for ids that no longer exist in the roster (e.g.
  // a challenge was removed in a future build) so a stale store doesn't
  // hang on to dead overrides forever.
  const filtered: Record<string, OverrideStoreEntry> = {};
  const valid = rosterIds();
  for (const [id, entry] of Object.entries(parsed.byId)) {
    if (!valid.has(id) || !entry) continue;
    filtered[id] = entry as OverrideStoreEntry;
  }
  return { v: 1, byId: filtered };
}

function saveStore(store: OverrideStore): void {
  saveJson(STORAGE_KEY, store);
}

// Apply an inbound override. Returns true if it changed local state.
//
// Two independent watermarks decide what happens:
//   - updatedAt drives content refresh — anything strictly newer
//     replaces the cached payload.
//   - version drives the UPDATED badge — only a strictly higher
//     version flips badgeSeen back to false.
//
// This split is what makes --publish-silently work: the admin can land
// new content (newer updatedAt) without re-arming the badge for cached
// clients (same version).
export function upsertOverride(payload: OfficialChallengeOverridePayload): boolean {
  const validation = validatePayload(payload);
  if (!validation.ok) {
    console.warn("officialOverrides: rejected invalid payload", validation.errors);
    return false;
  }
  // Baked-version absorb: if this override's content has already been
  // baked into CHALLENGES at or above the incoming version, drop the
  // payload entirely and clear any local cache. Saves one round-trip
  // worth of localStorage churn, and keeps the UPDATED pill from
  // surprising players whose new build already has the content.
  const bakedAt = BAKED_OVERRIDE_VERSIONS[payload.challengeId];
  if (typeof bakedAt === "number" && payload.version <= bakedAt) {
    return clearOverride(payload.challengeId);
  }
  const store = loadOverrideStore();
  const prev = store.byId[payload.challengeId];
  // No prior entry — a brand-new override. Always show the badge so
  // players notice content they haven't seen before.
  if (!prev) {
    store.byId[payload.challengeId] = {
      payload,
      lastSeenVersion: payload.version,
      lastSeenUpdatedAt: payload.updatedAt,
      badgeSeen: false,
      fetchedAt: Date.now(),
    };
    saveStore(store);
    return true;
  }
  // Stale or unchanged record — nothing to do.
  if (payload.updatedAt <= prev.lastSeenUpdatedAt) return false;
  const versionAdvanced = payload.version > prev.lastSeenVersion;
  store.byId[payload.challengeId] = {
    payload,
    lastSeenVersion: Math.max(prev.lastSeenVersion, payload.version),
    lastSeenUpdatedAt: payload.updatedAt,
    // Silent publish (updatedAt bumped, version held) preserves whatever
    // badgeSeen state the player was in. Loud publish (version bumped)
    // re-arms the badge unconditionally.
    badgeSeen: versionAdvanced ? false : prev.badgeSeen,
    fetchedAt: Date.now(),
  };
  saveStore(store);
  return true;
}

// Remove an override entirely. Used when the admin marks a record as
// retired and we want the local copy to fall back to the hardcoded def.
export function clearOverride(challengeId: string): boolean {
  const store = loadOverrideStore();
  if (!store.byId[challengeId]) return false;
  delete store.byId[challengeId];
  saveStore(store);
  return true;
}

// Mark the UPDATED pill as seen — typically called when the player
// starts a run on the overridden challenge.
export function markBadgeSeen(challengeId: string): void {
  const store = loadOverrideStore();
  const entry = store.byId[challengeId];
  if (!entry || entry.badgeSeen) return;
  entry.badgeSeen = true;
  saveStore(store);
}

export function getOverrideEntry(challengeId: string): OverrideStoreEntry | undefined {
  return loadOverrideStore().byId[challengeId];
}

export function hasUnseenOverride(challengeId: string): boolean {
  const e = getOverrideEntry(challengeId);
  return !!e && !e.badgeSeen;
}

// All challenge ids whose UPDATED pill should currently render. Sorted
// by id for stable test output. Cheap — single store load.
export function getOverriddenUnseenIds(): string[] {
  const store = loadOverrideStore();
  return Object.entries(store.byId)
    .filter(([, entry]) => !entry.badgeSeen)
    .map(([id]) => id)
    .sort();
}

// ---------- Resolver -----------------------------------------------------

// Compose the effective ChallengeDef the engine + UI should consume.
// Roster supplies id/block/index (always); the override (when present)
// replaces name/difficulty/effects/waves. Returns undefined if the id
// isn't in the roster — overrides cannot introduce new challenges.
export function getEffectiveChallenge(id: string): ChallengeDef | undefined {
  const roster = challengeById(id);
  if (!roster) return undefined;
  const entry = loadOverrideStore().byId[id];
  if (!entry) return roster;
  const p = entry.payload;
  return {
    ...roster,
    name: p.name,
    difficulty: p.difficulty,
    effects: p.effects ? { ...p.effects } : roster.effects,
    waves: [...p.waves],
  };
}

// Full roster with overrides applied. Preserves roster order so the
// UI can iterate without re-sorting. Hot path during challenge select
// render — keep it cheap (one store load, then an in-memory map).
export function getEffectiveChallenges(): ChallengeDef[] {
  const store = loadOverrideStore();
  return CHALLENGES.map((roster) => {
    const entry = store.byId[roster.id];
    if (!entry) return roster;
    const p = entry.payload;
    return {
      ...roster,
      name: p.name,
      difficulty: p.difficulty,
      effects: p.effects ? { ...p.effects } : roster.effects,
      waves: [...p.waves],
    };
  });
}

// Convenience: optional explicit star thresholds, when the author chose
// to pin them rather than let computeStarThresholds derive them.
export function getOverrideStars(id: string): { one: number; two: number; three: number } | null {
  const entry = loadOverrideStore().byId[id];
  return entry?.payload.stars ?? null;
}

// Clear local cache entries whose content has already been baked into
// the CHALLENGES roster. Runs at cold launch so a new build with baked
// overrides immediately drops the redundant local copies. Idempotent.
export function reconcileBakedOverrides(): number {
  const store = loadOverrideStore();
  let cleared = 0;
  for (const [id, entry] of Object.entries(store.byId)) {
    const bakedAt = BAKED_OVERRIDE_VERSIONS[id];
    if (typeof bakedAt === "number" && entry.lastSeenVersion <= bakedAt) {
      delete store.byId[id];
      cleared += 1;
    }
  }
  if (cleared > 0) saveStore(store);
  return cleared;
}
