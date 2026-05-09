#!/usr/bin/env node
// HexRain admin tool.
//
// Manual review + content management surface for the public CloudKit
// container. Talks to the CloudKit Web Services REST API using a
// server-to-server token created in the CloudKit Dashboard:
//   1. Apple Developer → CloudKit Console → iCloud.com.hexrain.app
//   2. Tokens & Keys → Server-to-Server Keys → "+" to create a new key
//   3. Save the private key PEM somewhere safe; copy the Key ID
//   4. Drop both into ~/.config/hexrain/moderator-token.json (see MODERATION.md)
//
// Community moderation:
//   list-reports [--since 7d]                List recent reports grouped by challenge
//   hide <recordName> [--reason <text>]      Set status="hidden" on a PublishedChallenge
//   unhide <recordName>                      Set status="approved"
//   recount-upvotes <recordName>             Recompute denormalised upvoteCount
//   recount-plays <recordName>               Recompute denormalised playCount (sum of Score.attempts)
//   backfill-score-keys [--dry-run]          Populate challengeKey + challengeVersion on
//                                            legacy Score rows (one-time migration after
//                                            schema deploy)
//   purge-stale-scores [--dry-run]           Delete Score rows whose challengeVersion no
//                                            longer matches the current published version
//                                            (community) or the current content hash
//                                            (official, read from scripts/official-versions.json).
//                                            Also enforces the per-(key,version) top-10 cap.
//
// Official-challenge overrides (post-ship balance tweaks):
//   list-overrides                           List all OfficialChallengeOverride records
//   upload-override <file> [--mark-live] [--publish-silently]
//                                            Upload an override JSON dumped by the web editor.
//                                            Default: bumps version against the existing record so cached
//                                            clients re-arm the UPDATED badge. --publish-silently keeps the
//                                            version flat and only bumps updatedAt — content propagates,
//                                            badge stays seen. Status defaults to "draft" unless --mark-live.
//   mark-live <challengeId>                  Flip status to "live" so clients pull the override
//   retire-override <challengeId>            Flip status to "retired" so clients clear it on next pull
//   delete-override <challengeId>            Hard-delete the record (preferred way to undo an override
//                                            once all clients have pulled the retired status, or for cleanup)
//
// Environment overrides (rarely needed):
//   HEXRAIN_MOD_TOKEN_PATH                   Custom token JSON path
//   HEXRAIN_MOD_ENV                          "development" (default) or "production"

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_TOKEN_PATH = path.join(os.homedir(), ".config", "hexrain", "moderator-token.json");
const TOKEN_PATH = process.env.HEXRAIN_MOD_TOKEN_PATH || DEFAULT_TOKEN_PATH;
const CK_ENV = process.env.HEXRAIN_MOD_ENV || "development";
const CK_HOST = "https://api.apple-cloudkit.com";

function loadConfig() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error(`Token file not found: ${TOKEN_PATH}`);
    console.error("See MODERATION.md for setup instructions.");
    process.exit(1);
  }
  const raw = fs.readFileSync(TOKEN_PATH, "utf8");
  const cfg = JSON.parse(raw);
  if (!cfg.keyId || !cfg.privateKeyPem || !cfg.container) {
    console.error("Token file missing keyId, privateKeyPem, or container.");
    process.exit(1);
  }
  return cfg;
}

// CloudKit Web Services signs requests with ECDSA over the SHA-256 hash
// of the path + ISO8601 date + body hash. See:
//   https://developer.apple.com/documentation/cloudkitjs/setting_up_cloudkit_js
//   https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html
function ckRequest(cfg, subPath, body) {
  const json = JSON.stringify(body);
  const bodyHash = crypto.createHash("sha256").update(json).digest("base64");
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const fullPath = `/database/1/${cfg.container}/${CK_ENV}/public${subPath}`;
  const stringToSign = `${date}:${bodyHash}:${fullPath}`;
  const signer = crypto.createSign("SHA256");
  signer.update(stringToSign);
  const signature = signer.sign(cfg.privateKeyPem, "base64");
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Apple-CloudKit-Request-KeyID": cfg.keyId,
    "X-Apple-CloudKit-Request-ISO8601Date": date,
    "X-Apple-CloudKit-Request-SignatureV1": signature,
  };
  const url = `${CK_HOST}${fullPath}`;
  return fetch(url, { method: "POST", headers, body: json }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) {
      console.error(`HTTP ${r.status} ${r.statusText}`);
      console.error(text);
      process.exit(1);
    }
    return text ? JSON.parse(text) : {};
  });
}

async function queryAll(cfg, recordType, filterBy = []) {
  const out = [];
  let cursor = null;
  do {
    const body = {
      query: { recordType, filterBy },
      resultsLimit: 200,
    };
    if (cursor) body.continuationMarker = cursor;
    const res = await ckRequest(cfg, "/records/query", body);
    for (const r of (res.records || [])) out.push(r);
    cursor = res.continuationMarker || null;
  } while (cursor);
  return out;
}

async function fetchOne(cfg, recordName) {
  const res = await ckRequest(cfg, "/records/lookup", {
    records: [{ recordName }],
  });
  const rec = (res.records || [])[0];
  if (!rec || rec.serverErrorCode) return null;
  return rec;
}

async function modify(cfg, recordName, fields, recordType, recordChangeTag) {
  const op = {
    operationType: recordChangeTag ? "update" : "forceUpdate",
    record: {
      recordName,
      recordType,
      recordChangeTag,
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { value: v }]),
      ),
    },
  };
  return ckRequest(cfg, "/records/modify", { operations: [op] });
}

function parseSince(arg) {
  if (!arg) return 0;
  const m = arg.match(/^(\d+)([dhm])$/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const ms = m[2] === "d" ? 86400_000 : m[2] === "h" ? 3600_000 : 60_000;
  return Date.now() - n * ms;
}

async function listReports(cfg, args) {
  const sinceArg = args.find((a) => a.startsWith("--since="))?.slice(8)
    ?? (args.includes("--since") ? args[args.indexOf("--since") + 1] : null);
  const since = parseSince(sinceArg ?? "30d");
  const reports = await queryAll(cfg, "Report");
  const grouped = new Map(); // challengeRecordName → reports[]
  for (const r of reports) {
    const reportedAt = (r.fields?.reportedAt?.value ?? 0);
    if (reportedAt < since) continue;
    const ref = r.fields?.challengeRef?.value;
    const refName = (ref && ref.recordName) || "(unknown)";
    if (!grouped.has(refName)) grouped.set(refName, []);
    grouped.get(refName).push(r);
  }
  if (grouped.size === 0) {
    console.log(`No reports newer than ${new Date(since).toISOString()}.`);
    return;
  }
  for (const [refName, rs] of grouped) {
    const challenge = await fetchOne(cfg, refName);
    const name = challenge?.fields?.name?.value ?? "(missing)";
    const author = challenge?.fields?.authorName?.value ?? "(unknown)";
    const status = challenge?.fields?.status?.value ?? "(unknown)";
    console.log(`\n=== ${refName}`);
    console.log(`    "${name}" by ${author} — status=${status} — ${rs.length} report(s)`);
    for (const r of rs) {
      const reason = r.fields?.reason?.value ?? "?";
      const note = r.fields?.note?.value ?? "";
      const when = new Date(r.fields?.reportedAt?.value ?? 0).toISOString();
      console.log(`    [${when}] ${reason} — ${note}`);
    }
  }
}

async function setStatus(cfg, recordName, status) {
  const rec = await fetchOne(cfg, recordName);
  if (!rec) {
    console.error(`Not found: ${recordName}`);
    process.exit(1);
  }
  await modify(cfg, recordName, { status }, rec.recordType, rec.recordChangeTag);
  console.log(`${recordName} → status=${status}`);
}

async function recountUpvotes(cfg, recordName) {
  const rec = await fetchOne(cfg, recordName);
  if (!rec) {
    console.error(`Not found: ${recordName}`);
    process.exit(1);
  }
  const upvotes = await queryAll(cfg, "Upvote", [{
    fieldName: "challengeRef",
    comparator: "EQUALS",
    fieldValue: { value: { recordName } },
  }]);
  const newCount = upvotes.length;
  await modify(cfg, recordName, { upvoteCount: newCount }, rec.recordType, rec.recordChangeTag);
  console.log(`${recordName} → upvoteCount=${newCount}`);
}

async function recountPlays(cfg, recordName) {
  const rec = await fetchOne(cfg, recordName);
  if (!rec) {
    console.error(`Not found: ${recordName}`);
    process.exit(1);
  }
  const scores = await queryAll(cfg, "Score", [{
    fieldName: "challengeRef",
    comparator: "EQUALS",
    fieldValue: { value: { recordName } },
  }]);
  const total = scores.reduce((acc, s) => acc + (s.fields?.attempts?.value ?? 1), 0);
  await modify(cfg, recordName, { playCount: total }, rec.recordType, rec.recordChangeTag);
  console.log(`${recordName} → playCount=${total}`);
}

// ---------- Official-challenge overrides ---------------------------------

const OVERRIDE_RECORD_TYPE = "OfficialChallengeOverride";

// Deterministic record name per challengeId so re-uploads update the
// same row instead of creating duplicates. Matches the convention used
// by PublishedChallenge (pub-...) and Score (score-...).
function overrideRecordName(challengeId) {
  return `override-${challengeId}`;
}

async function deleteOne(cfg, recordName) {
  return ckRequest(cfg, "/records/modify", {
    operations: [{ operationType: "forceDelete", record: { recordName } }],
  });
}

async function listOverrides(cfg) {
  const recs = await queryAll(cfg, OVERRIDE_RECORD_TYPE);
  if (recs.length === 0) {
    console.log("No OfficialChallengeOverride records.");
    return;
  }
  // Sort by challengeId for stable output.
  recs.sort((a, b) => {
    const ai = a.fields?.challengeId?.value ?? "";
    const bi = b.fields?.challengeId?.value ?? "";
    return ai.localeCompare(bi);
  });
  console.log("challengeId  status   v   updatedAt                name");
  console.log("-----------  -------  --  -----------------------  --------------------");
  for (const r of recs) {
    const id = r.fields?.challengeId?.value ?? "?";
    const status = r.fields?.status?.value ?? "?";
    const version = r.fields?.version?.value ?? "?";
    const updated = r.fields?.updatedAt?.value
      ? new Date(r.fields.updatedAt.value).toISOString()
      : "?";
    const name = r.fields?.name?.value ?? "?";
    console.log(
      `${id.padEnd(11)}  ${String(status).padEnd(7)}  ${String(version).padStart(2)}  ${updated.padEnd(23)}  ${name}`,
    );
  }
}

function readOverrideFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`Invalid JSON in ${filePath}: ${err.message}`);
    process.exit(1);
  }
  // Minimal shape check — the game-side validatePayload does the heavy
  // lifting on read. We just guard against empty inputs here.
  const errs = [];
  if (typeof parsed.challengeId !== "string") errs.push("challengeId missing");
  if (typeof parsed.name !== "string") errs.push("name missing");
  if (!Array.isArray(parsed.waves) || parsed.waves.length === 0) errs.push("waves empty");
  if (typeof parsed.difficulty !== "number") errs.push("difficulty missing");
  if (errs.length > 0) {
    console.error(`Invalid override file ${filePath}: ${errs.join(", ")}`);
    process.exit(1);
  }
  return parsed;
}

async function uploadOverride(cfg, args) {
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: upload-override <file> [--mark-live] [--publish-silently] [--note <text>]");
    process.exit(1);
  }
  const markLive = args.includes("--mark-live");
  const silent = args.includes("--publish-silently");
  const noteIdx = args.indexOf("--note");
  const note = noteIdx >= 0 ? (args[noteIdx + 1] ?? "") : "";

  const payload = readOverrideFile(filePath);
  const recordName = overrideRecordName(payload.challengeId);
  const existing = await fetchOne(cfg, recordName);
  const prevVersion = existing?.fields?.version?.value ?? 0;
  // --publish-silently holds version flat (or seeds at v1 on first
  // upload). Default: bump by one. Either way updatedAt is now, which
  // is what the client uses to decide whether to refresh content.
  const version = silent
    ? Math.max(1, prevVersion)
    : prevVersion + 1;
  const now = Date.now();
  const fields = {
    challengeId: payload.challengeId,
    name: payload.name,
    difficulty: payload.difficulty,
    effects: JSON.stringify(payload.effects ?? {}),
    waves: payload.waves,
    stars: payload.stars ? JSON.stringify(payload.stars) : "",
    version,
    status: markLive ? "live" : (existing?.fields?.status?.value ?? "draft"),
    publishedAt: existing?.fields?.publishedAt?.value ?? now,
    updatedAt: now,
    note,
  };
  await modify(cfg, recordName, fields, OVERRIDE_RECORD_TYPE, existing?.recordChangeTag);
  const silentTag = silent ? " (silent — badge unchanged for cached clients)" : "";
  const liveHint = markLive || fields.status === "live"
    ? ""
    : ` (run "mark-live ${payload.challengeId}" to publish)`;
  console.log(`${recordName} → v${version} status=${fields.status}${silentTag}${liveHint}`);
}

async function setOverrideStatus(cfg, challengeId, status) {
  const recordName = overrideRecordName(challengeId);
  const rec = await fetchOne(cfg, recordName);
  if (!rec) {
    console.error(`Not found: ${recordName}`);
    process.exit(1);
  }
  await modify(cfg, recordName, { status, updatedAt: Date.now() }, rec.recordType, rec.recordChangeTag);
  console.log(`${recordName} → status=${status}`);
}

async function deleteOverride(cfg, challengeId) {
  const recordName = overrideRecordName(challengeId);
  const rec = await fetchOne(cfg, recordName);
  if (!rec) {
    console.error(`Not found: ${recordName}`);
    process.exit(1);
  }
  await deleteOne(cfg, recordName);
  console.log(`${recordName} → deleted`);
}

// ---------- Score migration / purge --------------------------------------

const SCORE_RECORD_TYPE = "Score";
const SCORE_CAP = 10;
const OFFICIAL_VERSIONS_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "official-versions.json",
);

function loadOfficialVersions() {
  if (!fs.existsSync(OFFICIAL_VERSIONS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(OFFICIAL_VERSIONS_PATH, "utf8"));
  } catch (err) {
    console.error(`Invalid JSON in ${OFFICIAL_VERSIONS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

// List Score rows grouped by challenge. For each community challenge
// we resolve the parent record so output has a readable name + author.
async function listScores(_cfg, args) {
  const cfg = _cfg;
  const onlyKey = args.find((a) => !a.startsWith("--"));
  const scores = await queryAll(cfg, SCORE_RECORD_TYPE);
  if (scores.length === 0) {
    console.log("No Score records.");
    return;
  }
  // Bucket by (challengeKey, challengeVersion).
  const buckets = new Map();
  for (const s of scores) {
    const f = s.fields ?? {};
    let key = f.challengeKey?.value;
    if (!key && f.challengeRef?.value?.recordName) {
      key = `pub:${f.challengeRef.value.recordName}`;
    }
    if (!key) continue;
    if (onlyKey && key !== onlyKey) continue;
    const version = f.challengeVersion?.value ?? 1;
    const bucketKey = `${key}|${version}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { key, version, rows: [] });
    buckets.get(bucketKey).rows.push({
      playerName: f.playerName?.value ?? "Anonymous",
      score: f.score?.value ?? 0,
      pct: f.pct?.value ?? 0,
      attempts: f.attempts?.value ?? 1,
      recordedAt: f.recordedAt?.value ?? 0,
    });
  }
  if (buckets.size === 0) {
    console.log("No matching Score rows.");
    return;
  }
  // Resolve parent challenge names for community keys (best effort).
  const nameCache = new Map();
  for (const b of buckets.values()) {
    if (b.key.startsWith("pub:") && !nameCache.has(b.key)) {
      const rn = b.key.slice(4);
      const parent = await fetchOne(cfg, rn);
      const name = parent?.fields?.name?.value ?? "(missing)";
      const author = parent?.fields?.authorName?.value ?? "(unknown)";
      nameCache.set(b.key, `${name} — ${author}`);
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const b of sorted) {
    b.rows.sort((a, b) => b.score - a.score);
    const label = b.key.startsWith("pub:")
      ? nameCache.get(b.key) ?? b.key
      : b.key;
    console.log(`\n=== ${b.key} v${b.version}`);
    console.log(`    ${label}`);
    console.log("    rank  score   pct   attempts  player");
    console.log("    ----  ------  ----  --------  --------------------");
    b.rows.forEach((r, i) => {
      const rank = String(i + 1).padStart(2);
      const score = String(r.score).padStart(6);
      const pct = String(Math.round((r.pct ?? 0) * 100)).padStart(3);
      const attempts = String(r.attempts).padStart(7);
      console.log(`    ${rank}    ${score}  ${pct}%  ${attempts}   ${r.playerName}`);
    });
  }
}

// Walks every Score row, ensures it has the new-shape (challengeKey,
// challengeVersion) fields. Legacy rows have only `challengeRef` —
// derive the missing fields from the parent PublishedChallenge.
async function backfillScoreKeys(cfg, args) {
  const dryRun = args.includes("--dry-run");
  const scores = await queryAll(cfg, SCORE_RECORD_TYPE);
  const parentVersionCache = new Map();

  let touched = 0;
  let skipped = 0;
  let errors = 0;
  for (const s of scores) {
    const fields = s.fields ?? {};
    const hasKey = !!fields.challengeKey?.value;
    const hasVer = fields.challengeVersion?.value != null;
    if (hasKey && hasVer) { skipped += 1; continue; }
    const ref = fields.challengeRef?.value;
    const refName = ref && ref.recordName;
    if (!refName) { errors += 1; continue; }
    if (!parentVersionCache.has(refName)) {
      const parent = await fetchOne(cfg, refName);
      const v = parent?.fields?.version?.value ?? 1;
      parentVersionCache.set(refName, v);
    }
    const version = parentVersionCache.get(refName);
    const patch = {
      challengeKey: `pub:${refName}`,
      challengeVersion: version,
    };
    if (dryRun) {
      console.log(`[dry] ${s.recordName} → key=pub:${refName} v=${version}`);
    } else {
      await modify(cfg, s.recordName, patch, s.recordType, s.recordChangeTag);
    }
    touched += 1;
  }
  console.log(`backfill-score-keys: ${touched} updated, ${skipped} already current, ${errors} skipped (missing parent)${dryRun ? " [dry-run]" : ""}`);
}

// Purge any Score row whose challengeVersion no longer matches its
// parent's current version (community → PublishedChallenge.version,
// official → official-versions.json). Also trims any (key,version)
// group exceeding the SCORE_CAP top-10 quota.
async function purgeStaleScores(cfg, args) {
  const dryRun = args.includes("--dry-run");
  const officialVersions = loadOfficialVersions();
  if (!officialVersions) {
    console.warn(`(no scripts/official-versions.json — official scores won't be checked. Run \`npm run build\` to generate it.)`);
  }
  const scores = await queryAll(cfg, SCORE_RECORD_TYPE);

  // Bucket by (challengeKey, challengeVersion) for the cap pass.
  const buckets = new Map(); // key|version → [score rows sorted desc]
  // Bucket "current versions" per challengeKey for the stale pass.
  const parentVersionCache = new Map();

  let staleCount = 0;
  let trimCount = 0;

  for (const s of scores) {
    const fields = s.fields ?? {};
    let key = fields.challengeKey?.value;
    let version = fields.challengeVersion?.value;
    // Backfill: synthesise on the fly if a row hasn't been migrated.
    if (!key && fields.challengeRef?.value?.recordName) {
      key = `pub:${fields.challengeRef.value.recordName}`;
    }
    if (!key) continue;
    if (version == null) version = 1;

    let currentVersion;
    if (key.startsWith("pub:")) {
      const refName = key.slice(4);
      if (!parentVersionCache.has(refName)) {
        const parent = await fetchOne(cfg, refName);
        parentVersionCache.set(refName, parent?.fields?.version?.value ?? 1);
      }
      currentVersion = parentVersionCache.get(refName);
    } else if (key.startsWith("off:") && officialVersions) {
      currentVersion = officialVersions[key.slice(4)] ?? null;
    } else {
      currentVersion = null;
    }

    if (currentVersion != null && version !== currentVersion) {
      staleCount += 1;
      if (dryRun) {
        console.log(`[dry] stale ${s.recordName} (${key} v=${version}, current=${currentVersion})`);
      } else {
        await deleteOne(cfg, s.recordName);
      }
      continue;
    }

    // Live row → bucket for cap enforcement.
    const bucketKey = `${key}|${version}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push({
      recordName: s.recordName,
      score: fields.score?.value ?? 0,
    });
  }

  for (const [bucketKey, rows] of buckets) {
    if (rows.length <= SCORE_CAP) continue;
    rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const evict = rows.slice(SCORE_CAP);
    for (const r of evict) {
      trimCount += 1;
      if (dryRun) {
        console.log(`[dry] trim ${r.recordName} (over cap in ${bucketKey})`);
      } else {
        await deleteOne(cfg, r.recordName);
      }
    }
  }

  console.log(`purge-stale-scores: ${staleCount} stale, ${trimCount} trimmed past cap${dryRun ? " [dry-run]" : ""}`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.error("Usage: moderator.mjs <command> [args]");
    console.error("  Community: list-reports, hide, unhide, recount-upvotes, recount-plays");
    console.error("  Overrides: list-overrides, upload-override, mark-live, retire-override, delete-override");
    console.error("  Scores:    backfill-score-keys, purge-stale-scores");
    process.exit(1);
  }
  const cfg = loadConfig();
  if (cmd === "list-reports") {
    await listReports(cfg, rest);
  } else if (cmd === "hide") {
    const rn = rest[0];
    if (!rn) { console.error("Usage: hide <recordName>"); process.exit(1); }
    await setStatus(cfg, rn, "hidden");
  } else if (cmd === "unhide") {
    const rn = rest[0];
    if (!rn) { console.error("Usage: unhide <recordName>"); process.exit(1); }
    await setStatus(cfg, rn, "approved");
  } else if (cmd === "recount-upvotes") {
    const rn = rest[0];
    if (!rn) { console.error("Usage: recount-upvotes <recordName>"); process.exit(1); }
    await recountUpvotes(cfg, rn);
  } else if (cmd === "recount-plays") {
    const rn = rest[0];
    if (!rn) { console.error("Usage: recount-plays <recordName>"); process.exit(1); }
    await recountPlays(cfg, rn);
  } else if (cmd === "list-overrides") {
    await listOverrides(cfg);
  } else if (cmd === "upload-override") {
    await uploadOverride(cfg, rest);
  } else if (cmd === "mark-live") {
    const id = rest[0];
    if (!id) { console.error("Usage: mark-live <challengeId>"); process.exit(1); }
    await setOverrideStatus(cfg, id, "live");
  } else if (cmd === "retire-override") {
    const id = rest[0];
    if (!id) { console.error("Usage: retire-override <challengeId>"); process.exit(1); }
    await setOverrideStatus(cfg, id, "retired");
  } else if (cmd === "delete-override") {
    const id = rest[0];
    if (!id) { console.error("Usage: delete-override <challengeId>"); process.exit(1); }
    await deleteOverride(cfg, id);
  } else if (cmd === "backfill-score-keys") {
    await backfillScoreKeys(cfg, rest);
  } else if (cmd === "purge-stale-scores") {
    await purgeStaleScores(cfg, rest);
  } else if (cmd === "list-scores") {
    await listScores(cfg, rest);
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
