// Idempotent App Store Connect seeder for Hex Rain's Game Center setup.
//
// Reads ACHIEVEMENT_LIST + LEADERBOARDS from src/gameCenter.ts so
// the JS layer is the single source of truth.
//
// What it does:
// 1. Enables Game Center on the app (creates gameCenterDetail if absent).
// 2. Creates the high-score leaderboard + en-US localization + icon.
// 3. Creates each achievement + en-US localization + icon.
//
// All steps are GET-then-POST: re-running won't duplicate or wipe data.
//
// Requires env (already set on this machine):
//   APPLE_API_KEY        path to AuthKey_*.p8
//   APP_STORE_API_KEY    Key ID
//   APP_STORE_API_ISSUER Issuer ID
//
// Run: npx tsx scripts/seed-gamecenter.ts

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8 } from "jose";

import {
  ACHIEVEMENT_LIST,
  LEADERBOARD_TITLES,
  LEADERBOARDS,
  type LeaderboardDifficulty,
} from "../src/gameCenter";

const __dirname = dirname(fileURLToPath(import.meta.url));

const APP_ID = "6764113922";
const DRY_RUN = process.argv.includes("--dry-run");
let dryRunCounter = 0;

const KEY_ID = required("APP_STORE_API_KEY");
const ISSUER_ID = required("APP_STORE_API_ISSUER");
const KEY_PATH = required("APPLE_API_KEY");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const BASE = "https://api.appstoreconnect.apple.com";

let cachedToken: { jwt: string; exp: number } | null = null;

async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 60) return cachedToken.jwt;
  const pem = readFileSync(KEY_PATH, "utf8");
  const key = await importPKCS8(pem, "ES256");
  const exp = now + 1100; // <20 min, Apple's hard cap
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(ISSUER_ID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience("appstoreconnect-v1")
    .sign(key);
  cachedToken = { jwt, exp };
  return jwt;
}

interface AscError {
  status: string;
  code: string;
  title: string;
  detail?: string;
  source?: unknown;
}

async function asc<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  // In dry-run, GETs that drill into a synthetic resource id we just
  // pretended to create won't validate against ASC — return an empty
  // list so the script continues and shows the next intended write.
  if (DRY_RUN && method === "GET" && path.includes("/dry-")) {
    return { data: [] } as T;
  }
  if (DRY_RUN && method !== "GET") {
    dryRunCounter += 1;
    const preview = body && !(body instanceof Uint8Array)
      ? JSON.stringify(body, null, 2)
      : body instanceof Uint8Array
        ? `<${body.byteLength} bytes>`
        : "";
    console.log(`\n[DRY] ${method} ${path}${preview ? `\n${preview}` : ""}`);
    // Return a fake resource so downstream code can keep flowing.
    return { data: { type: "dryRun", id: `dry-${dryRunCounter}` } } as T;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
    ...(body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
    ...(extraHeaders ?? {}),
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
  if (!res.ok) {
    const errs = (json as { errors?: AscError[] } | undefined)?.errors;
    const detail = errs ? errs.map((e) => `${e.status} ${e.code}: ${e.title}${e.detail ? ` — ${e.detail}` : ""}`).join("; ") : text;
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  return (json ?? (text as unknown)) as T;
}

interface AscResource<A = Record<string, unknown>, R = Record<string, unknown>> {
  type: string;
  id: string;
  attributes?: A;
  relationships?: R;
}

interface AscList<T> { data: T[]; }
interface AscSingle<T> { data: T; }

// --- Game Center detail (enables Game Center on the app) -----------------

async function ensureGameCenterDetail(): Promise<string> {
  // The app exposes a single optional gameCenterDetail relationship.
  const existing = await asc<AscSingle<AscResource> | { data: null }>(
    "GET",
    `/v1/apps/${APP_ID}/gameCenterDetail`,
  );
  if (existing && "data" in existing && existing.data) {
    console.log(`✓ gameCenterDetail exists (${existing.data.id})`);
    return existing.data.id;
  }
  const created = await asc<AscSingle<AscResource>>("POST", `/v1/gameCenterDetails`, {
    data: {
      type: "gameCenterDetails",
      relationships: { app: { data: { type: "apps", id: APP_ID } } },
    },
  });
  console.log(`+ gameCenterDetail created (${created.data.id})`);
  return created.data.id;
}

// --- Leaderboard ---------------------------------------------------------

async function ensureLeaderboard(
  gcDetailId: string,
  vendorId: string,
  referenceName: string,
): Promise<string> {
  // ASC's GET doesn't support filter[vendorIdentifier]; list and match in JS.
  const list = await asc<AscList<AscResource<{ vendorIdentifier?: string }>>>(
    "GET",
    `/v1/gameCenterDetails/${gcDetailId}/gameCenterLeaderboards?limit=200`,
  );
  const hit = list.data.find((d) => d.attributes?.vendorIdentifier === vendorId);
  if (hit) {
    console.log(`✓ leaderboard ${vendorId} exists (${hit.id})`);
    return hit.id;
  }
  const created = await asc<AscSingle<AscResource>>("POST", `/v1/gameCenterLeaderboards`, {
    data: {
      type: "gameCenterLeaderboards",
      attributes: {
        referenceName,
        vendorIdentifier: vendorId,
        defaultFormatter: "INTEGER",
        submissionType: "BEST_SCORE",
        scoreSortType: "DESC",
        scoreRangeStart: "0",
        scoreRangeEnd: "10000000",
      },
      relationships: {
        gameCenterDetail: { data: { type: "gameCenterDetails", id: gcDetailId } },
      },
    },
  });
  console.log(`+ leaderboard ${vendorId} created (${created.data.id})`);
  return created.data.id;
}

async function ensureLeaderboardLocalization(
  lbId: string,
  name: string,
): Promise<string> {
  const list = await asc<AscList<AscResource<{ locale?: string }>>>(
    "GET",
    `/v1/gameCenterLeaderboards/${lbId}/localizations?limit=200`,
  );
  const hit = list.data.find((d) => d.attributes?.locale === "en-US");
  if (hit) {
    console.log(`  ✓ leaderboard en-US localization exists (${hit.id})`);
    return hit.id;
  }
  const created = await asc<AscSingle<AscResource>>("POST", `/v1/gameCenterLeaderboardLocalizations`, {
    data: {
      type: "gameCenterLeaderboardLocalizations",
      attributes: {
        locale: "en-US",
        name,
        formatterOverride: "INTEGER",
        formatterSuffix: "points",
        formatterSuffixSingular: "point",
      },
      relationships: {
        gameCenterLeaderboard: { data: { type: "gameCenterLeaderboards", id: lbId } },
      },
    },
  });
  console.log(`  + leaderboard en-US localization created (${created.data.id})`);
  return created.data.id;
}

// --- Achievement ---------------------------------------------------------

// Apple caps total achievement points per app at 1000. The original 22
// achievements went live at 45 each (= 990) and Apple's API refuses to
// patch points on a Live achievement (STATE_ERROR.ACHIEVEMENT_VERSION_
// UNMODIFIABLE_STATE). That leaves 10 points of headroom for any later
// additions, so new achievements are created at 1 point each — they
// still unlock and submit fine. Existing live ones are left at 45.
const ACHIEVEMENT_POINTS = 1;

async function ensureAchievement(
  gcDetailId: string,
  vendorId: string,
  referenceName: string,
): Promise<string> {
  const list = await asc<AscList<AscResource<{
    vendorIdentifier?: string;
    points?: number;
  }>>>(
    "GET",
    `/v1/gameCenterDetails/${gcDetailId}/gameCenterAchievements?limit=200`,
  );
  const hit = list.data.find((d) => d.attributes?.vendorIdentifier === vendorId);
  if (hit) {
    // Don't try to renormalise points on existing entries — Live
    // achievements are immutable, and the total-points cap means we
    // have to live with whatever value they were created at.
    console.log(`✓ achievement ${vendorId} exists (${hit.id}, ${hit.attributes?.points ?? "?"}pts)`);
    return hit.id;
  }
  const created = await asc<AscSingle<AscResource>>("POST", `/v1/gameCenterAchievements`, {
    data: {
      type: "gameCenterAchievements",
      attributes: {
        referenceName,
        vendorIdentifier: vendorId,
        points: ACHIEVEMENT_POINTS,
        showBeforeEarned: true,
        repeatable: false,
      },
      relationships: {
        gameCenterDetail: { data: { type: "gameCenterDetails", id: gcDetailId } },
      },
    },
  });
  console.log(`+ achievement ${vendorId} created (${created.data.id})`);
  return created.data.id;
}

async function ensureAchievementLocalization(
  achId: string,
  name: string,
  description: string,
): Promise<string> {
  const list = await asc<AscList<AscResource<{ locale?: string }>>>(
    "GET",
    `/v1/gameCenterAchievements/${achId}/localizations?limit=200`,
  );
  const hit = list.data.find((d) => d.attributes?.locale === "en-US");
  if (hit) {
    console.log(`  ✓ achievement en-US localization exists (${hit.id})`);
    return hit.id;
  }
  const created = await asc<AscSingle<AscResource>>("POST", `/v1/gameCenterAchievementLocalizations`, {
    data: {
      type: "gameCenterAchievementLocalizations",
      attributes: {
        locale: "en-US",
        name,
        beforeEarnedDescription: description,
        afterEarnedDescription: description,
      },
      relationships: {
        gameCenterAchievement: { data: { type: "gameCenterAchievements", id: achId } },
      },
    },
  });
  console.log(`  + achievement en-US localization created (${created.data.id})`);
  return created.data.id;
}

// --- Image upload (3-step asset reservation) ----------------------------

async function uploadImage(
  type: "gameCenterAchievementImages" | "gameCenterLeaderboardImages",
  parentRel: "gameCenterAchievementLocalization" | "gameCenterLeaderboardLocalization",
  parentResourceType: string,
  parentId: string,
  filePath: string,
): Promise<void> {
  const fileName = filePath.split("/").pop()!;
  const bytes = readFileSync(filePath);
  const fileSize = statSync(filePath).size;

  // Skip if an image already exists on the localization.
  const existing = await asc<AscList<AscResource<{ assetDeliveryState?: { state?: string } }>>>(
    "GET",
    `/v1/${parentResourceType}/${parentId}/${type === "gameCenterAchievementImages" ? "gameCenterAchievementImage" : "gameCenterLeaderboardImage"}`,
  ).catch(() => ({ data: [] as AscResource[] }));
  const present = Array.isArray((existing as AscList<AscResource>).data)
    ? ((existing as AscList<AscResource>).data ?? [])
    : (existing as { data?: AscResource | null }).data
      ? [(existing as AscSingle<AscResource>).data]
      : [];
  if (present.length > 0) {
    console.log(`    ✓ image already present on ${parentResourceType}/${parentId}`);
    return;
  }

  const reserve = await asc<AscSingle<AscResource<{
    uploadOperations?: Array<{
      method: string;
      url: string;
      length: number;
      offset: number;
      requestHeaders?: Array<{ name: string; value: string }>;
    }>;
  }>>>("POST", `/v1/${type}`, {
    data: {
      type,
      attributes: { fileName, fileSize },
      relationships: {
        [parentRel]: { data: { type: parentResourceType, id: parentId } },
      },
    },
  });
  const imageId = reserve.data.id;
  const ops = reserve.data.attributes?.uploadOperations ?? [];
  for (const op of ops) {
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
    const slice = bytes.subarray(op.offset, op.offset + op.length);
    const res = await fetch(op.url, { method: op.method, headers, body: slice });
    if (!res.ok) throw new Error(`Asset upload ${op.method} ${op.url} → ${res.status}: ${await res.text()}`);
  }
  void createHash;
  await asc("PATCH", `/v1/${type}/${imageId}`, {
    data: { type, id: imageId, attributes: { uploaded: true } },
  });
  console.log(`    + image uploaded (${imageId})`);
}

// --- Driver --------------------------------------------------------------

async function main() {
  const gcDetailId = await ensureGameCenterDetail();

  for (const difficulty of Object.keys(LEADERBOARDS) as LeaderboardDifficulty[]) {
    const vendorId = LEADERBOARDS[difficulty];
    const title = LEADERBOARD_TITLES[difficulty];
    const lbId = await ensureLeaderboard(gcDetailId, vendorId, title);
    const lbLocId = await ensureLeaderboardLocalization(lbId, title);
    await uploadImage(
      "gameCenterLeaderboardImages",
      "gameCenterLeaderboardLocalization",
      "gameCenterLeaderboardLocalizations",
      lbLocId,
      resolve(__dirname, "..", "assets", "achievement-icons", `leaderboard-${difficulty}.png`),
    );
  }

  for (const meta of ACHIEVEMENT_LIST) {
    const achId = await ensureAchievement(gcDetailId, meta.id, meta.name);
    const locId = await ensureAchievementLocalization(achId, meta.name, meta.description);
    await uploadImage(
      "gameCenterAchievementImages",
      "gameCenterAchievementLocalization",
      "gameCenterAchievementLocalizations",
      locId,
      resolve(__dirname, "..", "assets", "achievement-icons", `${meta.id}.png`),
    );
  }

  console.log("\n✅ Game Center seeded.");
  console.log("Next: enable Game Center for the App ID in developer.apple.com → Identifiers,");
  console.log("then archive + upload a build to take Game Center live in production.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
