// Content-derived version numbers for official + community challenges.
//
// A "version" here is a stable 32-bit fingerprint of the playable
// content (waves + effects + dangerSize). It feeds the per-challenge
// leaderboard so a wave-list edit invalidates old scores: scores carry
// the version they were posted against, and queries filter on the
// current version, hiding stale rows the moment the content changes.
//
// Community challenges have an authoritative monotonic `version` on
// their `PublishedChallenge` record (bumped by `publishChallenge`).
// Official challenges have no such field — they're hand-authored
// constants in `challenges.ts`. So we derive a content hash and treat
// it as the version. Identical content → identical hash → leaderboard
// rows persist across deploys; any change → new hash → fresh board.
//
// Difficulty / display name / block grouping are *not* part of the
// fingerprint: a re-theme that doesn't change gameplay shouldn't wipe
// the board. Walls / spawn cadence / kind weights all live inside the
// wave DSL strings, which are part of the fingerprint.

import type { ChallengeDef } from "./challenges";
import { hashSeed } from "./rng";

const cache = new Map<string, number>();

// Compute (and cache) the content fingerprint for a single challenge.
// Cache key is the challenge id — re-rendering doesn't recompute the
// hash on every frame.
export function officialChallengeVersion(def: ChallengeDef): number {
  const cached = cache.get(def.id);
  if (cached !== undefined) return cached;
  const v = computeVersion(def);
  cache.set(def.id, v);
  return v;
}

// Same shape applied to a published custom challenge. Useful when a
// caller wants the deterministic content hash (e.g. for diagnostics)
// rather than the authoritative `PublishedChallenge.version`.
export function challengeContentHash(def: { waves: string[]; effects?: ChallengeDef["effects"] }): number {
  return computeVersion(def);
}

function computeVersion(def: { waves: string[]; effects?: ChallengeDef["effects"] }): number {
  // JSON.stringify of a known-shape object is stable across V8 / JSC
  // because we control the key order. Including `null` placeholders
  // means a missing-effects challenge and an explicit `effects: {}`
  // produce the same hash, which is what we want — both render the
  // same gameplay.
  const eff = def.effects ?? {};
  const payload = JSON.stringify({
    waves: def.waves,
    slow: eff.slowDuration ?? null,
    fast: eff.fastDuration ?? null,
    shield: eff.shieldDuration ?? null,
    drone: eff.droneDuration ?? null,
    danger: eff.dangerSize ?? null,
  });
  // hashSeed returns 0..0xffffffff. Map to [1, 0xffffffff] so the
  // version is always truthy (CloudKit `0` is a valid INT64, but our
  // skip-when-no-version code paths read `??` defaults more cleanly
  // when 0 isn't a legitimate value).
  const h = hashSeed(payload);
  return h === 0 ? 1 : h;
}

// Test-only: clear the cache so a unit test that mutates a
// `ChallengeDef` literal sees a fresh hash. Production code should
// never need this.
export function _clearVersionCache(): void {
  cache.clear();
}
