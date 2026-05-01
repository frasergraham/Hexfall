// High-level cloud sync layer.
//
// Provider-agnostic surface used by game.ts. On iOS this delegates to
// src/cloudKit.ts. On web every call is a sentinel no-op (returns null,
// false, [] etc), so the UI can compile and render the Community
// section unchanged. When a CloudKit JS / proxy implementation lands
// later it slots in here without touching the UI layer.
//
// Three responsibilities:
//   1. Personal: mirror challenge progress + custom challenges to the
//      private CloudKit DB so a wipe / new device restores them.
//   2. Public: publish, install, query, leaderboard, upvote, report
//      community challenges in the public CloudKit DB.
//   3. Live updates: keep installed copies in sync via a CKQuery
//      subscription on the published-challenge record names.

import {
  fetchRecord as nativeFetchRecord,
  getAccountStatus,
  getUserRecordName,
  isAccountReady,
  isCloudKitAvailable,
  onPublishedUpdated,
  queryRecords as nativeQueryRecords,
  subscribePublished,
  upsertRecord,
  deleteRecord,
  type CloudKitField,
  type CloudKitQueryOpts,
  type CloudKitQueryResult,
  type CloudKitRecord,
} from "./cloudKit";
import {
  isWebReadConfigured,
  webFetchRecord,
  webQueryRecords,
} from "./cloudWeb";
import {
  loadChallengeProgress,
  type ChallengeProgress,
} from "./challenges";
import {
  applyInstalledUpdate,
  clearPublishedMeta,
  findCustomByPublishedRecord,
  listCustomChallenges,
  loadCustomChallenges,
  setPublishedMeta,
  upsertCustomChallenge,
  type CustomChallenge,
  type CustomChallengeEffects,
  type CustomChallengeStars,
} from "./customChallenges";
import { checkName, type ModerationResult } from "./moderation";
import { hashSeed } from "./rng";
import { clampDifficulty, clampStars } from "./validation";
import { loadString, saveJson, saveString } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";

// ---------- Identity ------------------------------------------------------

export async function isCloudReady(): Promise<boolean> {
  if (!isCloudKitAvailable()) return false;
  return isAccountReady();
}

export async function cloudUserId(): Promise<string | null> {
  return getUserRecordName();
}

// True when the public corpus can be browsed/read — iOS always (via
// CKContainer.publicCloudDatabase) and web when an API token is
// configured. Used to gate the Community section visibility and the
// queryCommunity early-return.
export function isCommunityReadable(): boolean {
  return isCloudKitAvailable() || isWebReadConfigured();
}

// Read dispatch: native plugin on iOS, REST on web. cloudKit.ts no-ops
// on web (no plugin attached) so without dispatch the community list
// would be empty for web visitors. Web only has read access to the
// public DB; private-DB calls fall through to the native implementation
// (which will no-op on web — the caller already gates writes on
// isCloudReady).
async function fetchRecord(db: "private" | "public", recordName: string): Promise<CloudKitRecord | null> {
  if (db === "public" && !isCloudKitAvailable() && isWebReadConfigured()) {
    return webFetchRecord(recordName);
  }
  return nativeFetchRecord(db, recordName);
}

async function queryRecords(opts: CloudKitQueryOpts): Promise<CloudKitQueryResult> {
  if (opts.db === "public" && !isCloudKitAvailable() && isWebReadConfigured()) {
    return webQueryRecords(opts);
  }
  return nativeQueryRecords(opts);
}

// ---------- Personal (private DB) ----------------------------------------

const PROGRESS_RECORD_NAME = "progress";
const PROGRESS_RECORD_TYPE = "Progress";
const CUSTOM_RECORD_TYPE = "CustomChallenge";

let progressSyncTimer: ReturnType<typeof setTimeout> | null = null;
let progressSyncInFlight = false;
const PROGRESS_DEBOUNCE_MS = 3000;

// Schedule a background push of the local ChallengeProgress + custom
// challenges to the user's private DB. Debounced so a flurry of
// saveChallengeBest calls during a run only triggers one round-trip.
export function syncProgressUp(): void {
  if (!isCloudKitAvailable()) return;
  if (progressSyncTimer) clearTimeout(progressSyncTimer);
  progressSyncTimer = setTimeout(() => {
    progressSyncTimer = null;
    void doSyncProgressUp();
  }, PROGRESS_DEBOUNCE_MS);
}

async function doSyncProgressUp(): Promise<void> {
  if (progressSyncInFlight) return;
  if (!(await isCloudReady())) return;
  progressSyncInFlight = true;
  try {
    const progress = loadChallengeProgress();
    await upsertRecord("private", PROGRESS_RECORD_TYPE, PROGRESS_RECORD_NAME, {
      payload: JSON.stringify(progress),
      modifiedAt: Date.now(),
    });
    // Custom challenges: one record per id. We only push, never reconcile
    // deletions here — a deleted challenge is removed by the explicit
    // delete-on-cloud call from game.ts.
    for (const c of listCustomChallenges()) {
      await upsertRecord("private", CUSTOM_RECORD_TYPE, c.id, customChallengeToFields(c));
    }
  } finally {
    progressSyncInFlight = false;
  }
}

// Pull progress + custom challenges down on cold launch. Last-write-
// wins by `modifiedAt`. Runs once per cold launch from main.ts.
export async function pullProgressDown(): Promise<void> {
  if (!(await isCloudReady())) return;
  // Progress: only overwrite local when the cloud copy is strictly newer.
  const cloud = await fetchRecord("private", PROGRESS_RECORD_NAME);
  if (cloud) {
    const cloudModified = numberField(cloud.fields["modifiedAt"]) ?? cloud.modifiedAt ?? 0;
    const localModified = readLocalProgressModified();
    if (cloudModified > localModified) {
      const payload = stringField(cloud.fields["payload"]);
      if (payload) writeLocalProgressFromCloud(payload, cloudModified);
    }
  }
  // Custom challenges: pull every record in the private store; for
  // each, if it doesn't exist locally, install it; if it does, take
  // whichever updatedAt is newer. The local upsertCustomChallenge
  // already preserves run stats, so cloud-pulled author content
  // doesn't blow away a higher local best.
  const result = await queryRecords({
    db: "private",
    recordType: CUSTOM_RECORD_TYPE,
    limit: 200,
  });
  for (const rec of result.records) {
    const remote = fieldsToCustomChallenge(rec);
    if (!remote) continue;
    const localStore = loadCustomChallenges();
    const local = localStore.challenges.find((c) => c.id === remote.id);
    if (!local || (local.updatedAt ?? 0) < remote.updatedAt) {
      upsertCustomChallenge(remote);
    }
  }
}

// We track the last "synced" modifiedAt in a tiny localStorage entry so
// repeated cold launches don't keep overwriting fresh local edits with
// stale cloud copies just because the cloud record's modifiedAt happens
// to be newer than the local file mtime (which we can't read).
const PROGRESS_LOCAL_MODIFIED_KEY = STORAGE_KEYS.cloudProgressModifiedAt;

function readLocalProgressModified(): number {
  return parseInt(loadString(PROGRESS_LOCAL_MODIFIED_KEY, "0"), 10) || 0;
}

function writeLocalProgressFromCloud(payload: string, modifiedAt: number): void {
  let parsed: ChallengeProgress | null;
  try {
    parsed = JSON.parse(payload) as ChallengeProgress;
  } catch {
    return; // malformed cloud payload
  }
  if (!parsed || parsed.v !== 1) return;
  saveJson(STORAGE_KEYS.challengeProgress, parsed);
  saveString(PROGRESS_LOCAL_MODIFIED_KEY, String(modifiedAt));
}

// ---------- Public (community) -------------------------------------------

const PUBLISHED_RECORD_TYPE = "PublishedChallenge";
const SCORE_RECORD_TYPE = "Score";
const UPVOTE_RECORD_TYPE = "Upvote";
const REPORT_RECORD_TYPE = "Report";

export type CommunitySort = "newest" | "topVoted" | "mostPlayed";

export interface PublishedChallenge {
  recordName: string;
  name: string;
  authorId: string;
  authorName: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  seed: number;
  effects: CustomChallengeEffects;
  waves: string[];
  stars: CustomChallengeStars;
  version: number;
  publishedAt: number;
  updatedAt: number;
  status: "approved" | "pending" | "hidden";
  reportCount: number;
  upvoteCount: number;
  installCount: number;
  /** Total attempts (run completes + deaths) across all players.
   *  Denormalised — authoritative count is `sum(attempts)` over the
   *  Score rows. Bumped from submitCommunityScore. */
  playCount: number;
  sourceCustomId: string;
}

export interface PublishResult {
  ok: boolean;
  published?: PublishedChallenge;
  moderation?: ModerationResult;
  error?: string;
}

// Publish (or re-publish) a custom challenge to the public DB. The
// public record name is deterministic per (authorId, sourceCustomId)
// so a re-publish updates the same row instead of creating duplicates.
export async function publishChallenge(
  custom: CustomChallenge,
  authorName: string,
): Promise<PublishResult> {
  const moderation = checkName(custom.name);
  if (!moderation.ok) return { ok: false, moderation };
  if (!(await isCloudReady())) return { ok: false, error: "iCloud not available" };
  const authorId = await getUserRecordName();
  if (!authorId) return { ok: false, error: "Could not resolve iCloud user" };

  const recordName = custom.publishedRecordName ?? makePublishedRecordName(authorId, custom.id);
  const previousVersion = custom.publishedVersion ?? 0;
  const now = Date.now();
  const version = previousVersion + 1;

  const fields: Record<string, CloudKitField> = {
    name: custom.name,
    authorId,
    authorName: authorName || "Anonymous",
    difficulty: custom.difficulty,
    seed: custom.seed,
    effects: JSON.stringify(custom.effects),
    waves: custom.waves,
    stars: JSON.stringify(custom.stars),
    version,
    publishedAt: previousVersion === 0 ? now : (custom.publishedVersion ? Date.now() - 1 : now),
    updatedAt: now,
    status: "approved",
    sourceCustomId: custom.id,
  };

  const upserted = await upsertRecord("public", PUBLISHED_RECORD_TYPE, recordName, fields);
  if (!upserted) return { ok: false, error: "Publish failed" };
  setPublishedMeta(custom.id, recordName, version);
  const published = recordToPublished(upserted);
  return published
    ? { ok: true, published }
    : { ok: true };
}

export async function unpublishChallenge(custom: CustomChallenge): Promise<boolean> {
  if (!custom.publishedRecordName) return true;
  if (!(await isCloudReady())) return false;
  const ok = await deleteRecord("public", custom.publishedRecordName);
  if (ok) clearPublishedMeta(custom.id);
  return ok;
}

export interface CommunityQueryOpts {
  sort: CommunitySort;
  limit?: number;
  cursor?: string | null;
}

export interface CommunityQueryResult {
  challenges: PublishedChallenge[];
  cursor: string | null;
}

export async function queryCommunity(opts: CommunityQueryOpts): Promise<CommunityQueryResult> {
  if (!isCommunityReadable()) return { challenges: [], cursor: null };
  const sortField =
    opts.sort === "newest" ? "publishedAt"
    : opts.sort === "topVoted" ? "upvoteCount"
    : "installCount";
  const result = await queryRecords({
    db: "public",
    recordType: PUBLISHED_RECORD_TYPE,
    predicate: 'status == "approved"',
    sortBy: { field: sortField, ascending: false },
    limit: opts.limit ?? 30,
    cursor: opts.cursor ?? null,
  });
  return {
    challenges: result.records.map(recordToPublished).filter((p): p is PublishedChallenge => p !== null),
    cursor: result.cursor,
  };
}

// Fetch a single PublishedChallenge by record name. Returns null if
// the challenge doesn't exist, has been hidden, or the network fails.
// Used by the deep-link single-challenge view.
export async function fetchCommunityChallenge(recordName: string): Promise<PublishedChallenge | null> {
  if (!isCommunityReadable()) return null;
  const rec = await fetchRecord("public", recordName);
  if (!rec) return null;
  return recordToPublished(rec);
}

// Install a published challenge into the local custom-challenge store.
// Re-installing the same record (by recordName) updates the existing
// install in place rather than creating a duplicate.
export async function installCommunity(p: PublishedChallenge): Promise<CustomChallenge | null> {
  const existing = findCustomByPublishedRecord(p.recordName);
  const local: CustomChallenge = upsertCustomChallenge({
    id: existing?.id ?? `custom:installed:${p.recordName}`,
    name: p.name,
    seed: p.seed,
    difficulty: p.difficulty,
    effects: { ...p.effects },
    stars: { ...p.stars },
    waves: [...p.waves],
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    best: existing?.best ?? 0,
    bestPct: existing?.bestPct ?? 0,
    starsEarned: existing?.starsEarned ?? 0,
    remixedFrom: existing?.remixedFrom,
    installedFrom: p.recordName,
    installedVersion: p.version,
    installedAuthorName: p.authorName,
  });
  // Increment installCount best-effort; we don't await because the user
  // shouldn't have to wait for a write to play.
  void bumpField("public", p.recordName, "installCount", p.installCount + 1);
  await refreshSubscriptions();
  return local;
}

// ---------- Leaderboard --------------------------------------------------

export interface CommunityScore {
  recordName: string;
  challengeRecordName: string;
  playerId: string;
  playerName: string;
  score: number;
  pct: number;
  recordedAt: number;
  /** How many runs this player has logged on this challenge. Bumped
   *  on every submitCommunityScore call; the leaderboard surfaces it
   *  as "· N plays" next to the player's best score. */
  attempts: number;
}

export async function submitCommunityScore(
  challengeRecordName: string,
  playerName: string,
  score: number,
  pct: number,
): Promise<void> {
  if (!(await isCloudReady())) return;
  const playerId = await getUserRecordName();
  if (!playerId) return;
  // Deterministic per-(player, challenge) record name so the leaderboard
  // always shows the player's best, not a forest of individual runs.
  const recordName = `score-${shortHash(playerId)}-${shortHash(challengeRecordName)}`;
  const existing = await fetchRecord("public", recordName);
  const prevScore = existing ? (numberField(existing.fields["score"]) ?? 0) : 0;
  const prevPct = existing ? (numberField(existing.fields["pct"]) ?? 0) : 0;
  const prevAttempts = existing ? (numberField(existing.fields["attempts"]) ?? 0) : 0;
  const newScore = Math.max(0, Math.round(score));
  const newPct = Math.max(0, Math.min(1, pct));
  const isBest = newScore > prevScore;
  await upsertRecord("public", SCORE_RECORD_TYPE, recordName, {
    challengeRef: { recordName: challengeRecordName, action: "deleteSelf" },
    playerId,
    playerName: playerName || "Anonymous",
    score: isBest ? newScore : prevScore,
    pct: isBest ? newPct : prevPct,
    recordedAt: Date.now(),
    attempts: prevAttempts + 1,
  });
  // Bump the denormalised playCount on the parent challenge record.
  // Best-effort — authoritative count is sum(attempts) across Score
  // rows; recount-plays moderator command re-syncs if drift is suspected.
  const challenge = await fetchRecord("public", challengeRecordName);
  if (challenge) {
    const cur = numberField(challenge.fields["playCount"]) ?? 0;
    void bumpField("public", challengeRecordName, "playCount", cur + 1);
  }
}

export async function topScores(
  challengeRecordName: string,
  limit = 20,
): Promise<CommunityScore[]> {
  if (!isCommunityReadable()) return [];
  const result = await queryRecords({
    db: "public",
    recordType: SCORE_RECORD_TYPE,
    predicate: `challengeRef == "${challengeRecordName}"`,
    sortBy: { field: "score", ascending: false },
    limit,
  });
  return result.records
    .map(recordToScore)
    .filter((s): s is CommunityScore => s !== null);
}

// ---------- Upvote -------------------------------------------------------

export async function upvote(challengeRecordName: string): Promise<boolean> {
  if (!(await isCloudReady())) return false;
  const playerId = await getUserRecordName();
  if (!playerId) return false;
  const recordName = `upvote-${shortHash(playerId)}-${shortHash(challengeRecordName)}`;
  const existing = await fetchRecord("public", recordName);
  if (existing) return true; // already voted
  await upsertRecord("public", UPVOTE_RECORD_TYPE, recordName, {
    challengeRef: { recordName: challengeRecordName, action: "deleteSelf" },
    playerId,
  });
  // Best-effort denorm bump on the parent record. Authoritative count
  // lives in the Upvote rows; the moderator script has a recount-upvotes
  // command for when this drifts.
  const challenge = await fetchRecord("public", challengeRecordName);
  if (challenge) {
    const cur = numberField(challenge.fields["upvoteCount"]) ?? 0;
    void bumpField("public", challengeRecordName, "upvoteCount", cur + 1);
  }
  return true;
}

export async function removeUpvote(challengeRecordName: string): Promise<boolean> {
  if (!(await isCloudReady())) return false;
  const playerId = await getUserRecordName();
  if (!playerId) return false;
  const recordName = `upvote-${shortHash(playerId)}-${shortHash(challengeRecordName)}`;
  const ok = await deleteRecord("public", recordName);
  if (!ok) return false;
  const challenge = await fetchRecord("public", challengeRecordName);
  if (challenge) {
    const cur = numberField(challenge.fields["upvoteCount"]) ?? 0;
    void bumpField("public", challengeRecordName, "upvoteCount", Math.max(0, cur - 1));
  }
  return true;
}

export async function hasUpvoted(challengeRecordName: string): Promise<boolean> {
  if (!(await isCloudReady())) return false;
  const playerId = await getUserRecordName();
  if (!playerId) return false;
  const recordName = `upvote-${shortHash(playerId)}-${shortHash(challengeRecordName)}`;
  const r = await fetchRecord("public", recordName);
  return r !== null;
}

// ---------- Report -------------------------------------------------------

export type ReportReason =
  | "inappropriate_name"
  | "unplayable"
  | "offensive_content"
  | "other";

export async function reportChallenge(
  challengeRecordName: string,
  reason: ReportReason,
  note?: string,
): Promise<boolean> {
  if (!(await isCloudReady())) return false;
  const reporterId = await getUserRecordName();
  if (!reporterId) return false;
  // One report per (reporter, challenge). Re-reporting overwrites the
  // existing record (newer reason wins) so the report queue isn't spammed.
  const recordName = `report-${shortHash(reporterId)}-${shortHash(challengeRecordName)}`;
  await upsertRecord("public", REPORT_RECORD_TYPE, recordName, {
    challengeRef: { recordName: challengeRecordName, action: "none" },
    reporterId,
    reason,
    note: note ? note.slice(0, 240) : "",
    reportedAt: Date.now(),
  });
  // Bump the denormalised count so the moderator script can sort.
  const challenge = await fetchRecord("public", challengeRecordName);
  if (challenge) {
    const cur = numberField(challenge.fields["reportCount"]) ?? 0;
    void bumpField("public", challengeRecordName, "reportCount", cur + 1);
  }
  return true;
}

// ---------- Subscription / live updates ----------------------------------

let subscriptionInitialised = false;

export async function subscribeToInstalledUpdates(): Promise<void> {
  if (!isCloudKitAvailable()) return;
  if (!subscriptionInitialised) {
    subscriptionInitialised = true;
    onPublishedUpdated((record) => {
      const local = findCustomByPublishedRecord(record.recordName);
      if (!local || !local.installedFrom) return;
      const patch = recordToPublished(record);
      if (!patch) return;
      applyInstalledUpdate(record.recordName, {
        name: patch.name,
        difficulty: patch.difficulty,
        seed: patch.seed,
        effects: patch.effects,
        waves: patch.waves,
        stars: patch.stars,
        installedVersion: patch.version,
        installedAuthorName: patch.authorName,
      });
    });
  }
  await refreshSubscriptions();
}

async function refreshSubscriptions(): Promise<void> {
  const installed = listCustomChallenges()
    .map((c) => c.installedFrom)
    .filter((rn): rn is string => typeof rn === "string" && rn.length > 0);
  await subscribePublished(installed);
}

// ---------- Helpers ------------------------------------------------------

function makePublishedRecordName(authorId: string, sourceCustomId: string): string {
  return `pub-${shortHash(authorId)}-${shortHash(sourceCustomId)}`;
}

// Quick non-cryptographic hash → short base-36 string. CloudKit record
// names allow [A-Za-z0-9_-] up to 255 chars; we just need stable
// readable per-(author, custom) identifiers. Uses the canonical FNV-1a
// hash in rng.ts so we don't carry three copies of it across the repo.
function shortHash(input: string): string {
  return hashSeed(input).toString(36);
}

function customChallengeToFields(c: CustomChallenge): Record<string, CloudKitField> {
  return {
    name: c.name,
    seed: c.seed,
    difficulty: c.difficulty,
    effects: JSON.stringify(c.effects),
    stars: JSON.stringify(c.stars),
    waves: c.waves,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    best: c.best,
    bestPct: c.bestPct,
    starsEarned: c.starsEarned,
    remixedFrom: c.remixedFrom ?? "",
    publishedRecordName: c.publishedRecordName ?? "",
    publishedVersion: c.publishedVersion ?? 0,
    installedFrom: c.installedFrom ?? "",
    installedVersion: c.installedVersion ?? 0,
    installedAuthorName: c.installedAuthorName ?? "",
  };
}

function fieldsToCustomChallenge(rec: CloudKitRecord): CustomChallenge | null {
  try {
    const id = rec.recordName;
    const effects = JSON.parse(stringField(rec.fields["effects"]) ?? "{}") as CustomChallengeEffects;
    const stars = JSON.parse(stringField(rec.fields["stars"]) ?? "{}") as CustomChallengeStars;
    const wavesRaw = rec.fields["waves"];
    const waves: string[] = Array.isArray(wavesRaw)
      ? (wavesRaw as unknown[]).filter((w): w is string => typeof w === "string")
      : [];
    return {
      id,
      name: stringField(rec.fields["name"]) ?? "Untitled",
      seed: numberField(rec.fields["seed"]) ?? 0,
      difficulty: clampDifficulty(numberField(rec.fields["difficulty"]) ?? 3),
      effects: {
        slowDuration: effects.slowDuration ?? 5,
        fastDuration: effects.fastDuration ?? 5,
        shieldDuration: effects.shieldDuration ?? 10,
        droneDuration: effects.droneDuration ?? 10,
        dangerSize: effects.dangerSize ?? 7,
      },
      stars: {
        one: stars.one ?? 1,
        two: stars.two ?? 2,
        three: stars.three ?? 3,
      },
      waves,
      createdAt: numberField(rec.fields["createdAt"]) ?? Date.now(),
      updatedAt: numberField(rec.fields["updatedAt"]) ?? Date.now(),
      best: numberField(rec.fields["best"]) ?? 0,
      bestPct: numberField(rec.fields["bestPct"]) ?? 0,
      starsEarned: clampStars(numberField(rec.fields["starsEarned"]) ?? 0),
      remixedFrom: stringField(rec.fields["remixedFrom"]) || undefined,
      publishedRecordName: stringField(rec.fields["publishedRecordName"]) || undefined,
      publishedVersion: numberField(rec.fields["publishedVersion"]) || undefined,
      installedFrom: stringField(rec.fields["installedFrom"]) || undefined,
      installedVersion: numberField(rec.fields["installedVersion"]) || undefined,
      installedAuthorName: stringField(rec.fields["installedAuthorName"]) || undefined,
    };
  } catch {
    return null;
  }
}

function recordToPublished(rec: CloudKitRecord): PublishedChallenge | null {
  try {
    const wavesRaw = rec.fields["waves"];
    const waves: string[] = Array.isArray(wavesRaw)
      ? (wavesRaw as unknown[]).filter((w): w is string => typeof w === "string")
      : [];
    const effectsJson = stringField(rec.fields["effects"]) ?? "{}";
    const starsJson = stringField(rec.fields["stars"]) ?? '{"one":1,"two":2,"three":3}';
    const effects = JSON.parse(effectsJson) as CustomChallengeEffects;
    const stars = JSON.parse(starsJson) as CustomChallengeStars;
    return {
      recordName: rec.recordName,
      name: stringField(rec.fields["name"]) ?? "Untitled",
      authorId: stringField(rec.fields["authorId"]) ?? "",
      authorName: stringField(rec.fields["authorName"]) ?? "Anonymous",
      difficulty: clampDifficulty(numberField(rec.fields["difficulty"]) ?? 3),
      seed: numberField(rec.fields["seed"]) ?? 0,
      effects: {
        slowDuration: effects.slowDuration ?? 5,
        fastDuration: effects.fastDuration ?? 5,
        shieldDuration: effects.shieldDuration ?? 10,
        droneDuration: effects.droneDuration ?? 10,
        dangerSize: effects.dangerSize ?? 7,
      },
      waves,
      stars: {
        one: stars.one ?? 1,
        two: stars.two ?? 2,
        three: stars.three ?? 3,
      },
      version: numberField(rec.fields["version"]) ?? 1,
      publishedAt: numberField(rec.fields["publishedAt"]) ?? rec.createdAt ?? Date.now(),
      updatedAt: numberField(rec.fields["updatedAt"]) ?? rec.modifiedAt ?? Date.now(),
      status: (stringField(rec.fields["status"]) as PublishedChallenge["status"]) ?? "approved",
      reportCount: numberField(rec.fields["reportCount"]) ?? 0,
      upvoteCount: numberField(rec.fields["upvoteCount"]) ?? 0,
      installCount: numberField(rec.fields["installCount"]) ?? 0,
      playCount: numberField(rec.fields["playCount"]) ?? 0,
      sourceCustomId: stringField(rec.fields["sourceCustomId"]) ?? "",
    };
  } catch {
    return null;
  }
}

function recordToScore(rec: CloudKitRecord): CommunityScore | null {
  try {
    const ref = rec.fields["challengeRef"];
    const challengeRecordName = typeof ref === "object" && ref && "recordName" in ref
      ? (ref as { recordName: string }).recordName
      : stringField(ref as CloudKitField) ?? "";
    return {
      recordName: rec.recordName,
      challengeRecordName,
      playerId: stringField(rec.fields["playerId"]) ?? "",
      playerName: stringField(rec.fields["playerName"]) ?? "Anonymous",
      score: numberField(rec.fields["score"]) ?? 0,
      pct: numberField(rec.fields["pct"]) ?? 0,
      recordedAt: numberField(rec.fields["recordedAt"]) ?? rec.modifiedAt ?? 0,
      attempts: numberField(rec.fields["attempts"]) ?? 1,
    };
  } catch {
    return null;
  }
}

async function bumpField(
  db: "private" | "public",
  recordName: string,
  field: string,
  value: number,
): Promise<void> {
  const existing = await fetchRecord(db, recordName);
  if (!existing) return;
  await upsertRecord(db, existing.recordType, recordName, {
    ...existing.fields,
    [field]: value,
  });
}

function stringField(v: CloudKitField | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function numberField(v: CloudKitField | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// clampDifficulty / clampStars live in src/validation.ts (shared with
// customChallenges.ts).

// Re-export so callers can do an account-status check without also
// pulling cloudKit.ts (keeps the import surface narrow).
export { getAccountStatus };
