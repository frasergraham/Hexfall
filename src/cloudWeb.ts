// CloudKit Web Services REST client (read-only).
//
// Used on the web build to surface the community corpus without
// requiring an iCloud login. cloudSync.ts dispatches read operations
// here when running on web; writes (publish, upvote, report, score
// submission) stay no-ops because the API token only grants
// "Query records" — anyone scraping the bundle gets the same access
// they'd have querying the public DB themselves.
//
// Token configuration:
//   - Create an API Token in CloudKit Console → Tokens & Keys → API
//     Tokens → +. Pick the environment ("Development" or "Production")
//     and grant Query Records permission only.
//   - Copy the token string into .env (or .env.local for local dev) as
//     VITE_CLOUDKIT_API_TOKEN. Optionally set VITE_CLOUDKIT_ENV
//     ("development" | "production"; default development).
//   - The token is bundled into the public JS — Apple designed read
//     tokens for exactly this use case (see CloudKit JS docs).

import type { CloudKitField, CloudKitRecord, CloudKitQueryOpts, CloudKitQueryResult } from "./cloudKit";

const CONTAINER = "iCloud.com.hexrain.app";
const API_BASE = "https://api.apple-cloudkit.com";

const TOKEN = (import.meta.env?.VITE_CLOUDKIT_API_TOKEN as string | undefined) ?? "";
const ENVIRONMENT = (import.meta.env?.VITE_CLOUDKIT_ENV as string | undefined) ?? "development";

export function isWebReadConfigured(): boolean {
  return TOKEN.length > 0;
}

function dbPath(db: "public"): string {
  return `${API_BASE}/database/1/${CONTAINER}/${ENVIRONMENT}/${db}`;
}

function buildUrl(path: string): string {
  // ckAPIToken goes in the query string per CloudKit Web Services spec.
  return `${path}?ckAPIToken=${encodeURIComponent(TOKEN)}`;
}

// CloudKit's REST response wraps each field as `{ value, type }`.
// Translate back into the flat shape cloudKit.ts uses internally so
// callers (cloudSync.ts) see the same data regardless of platform.
function unwrapFields(raw: Record<string, { value: unknown }> | undefined): Record<string, CloudKitField> {
  const out: Record<string, CloudKitField> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    const value = v?.value;
    if (value === null || value === undefined) {
      out[k] = null;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[k] = value;
      continue;
    }
    if (Array.isArray(value)) {
      // Lists in CK arrive as either string[]/number[] directly, or as
      // [{ value: ... }] when each element is wrapped. Flatten both.
      out[k] = value.map((item) =>
        item && typeof item === "object" && "value" in item
          ? (item as { value: unknown }).value as string | number
          : item as string | number,
      ) as string[] | number[];
      continue;
    }
    if (typeof value === "object" && "recordName" in (value as Record<string, unknown>)) {
      out[k] = { recordName: (value as { recordName: string }).recordName };
      continue;
    }
    // Fallback: stringify whatever it is so downstream code doesn't crash.
    out[k] = JSON.stringify(value);
  }
  return out;
}

function recordFromRest(raw: {
  recordName: string;
  recordType: string;
  fields?: Record<string, { value: unknown }>;
  created?: { timestamp?: number };
  modified?: { timestamp?: number };
  createdUserRecordName?: string;
}): CloudKitRecord {
  return {
    recordName: raw.recordName,
    recordType: raw.recordType,
    fields: unwrapFields(raw.fields),
    createdAt: raw.created?.timestamp,
    modifiedAt: raw.modified?.timestamp,
    creatorUserRecordName: raw.createdUserRecordName,
  };
}

export async function webFetchRecord(recordName: string): Promise<CloudKitRecord | null> {
  if (!isWebReadConfigured()) return null;
  try {
    const r = await fetch(buildUrl(`${dbPath("public")}/records/lookup`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ recordName }] }),
    });
    if (!r.ok) return null;
    const json = await r.json();
    const rec = json?.records?.[0];
    if (!rec || rec.serverErrorCode) return null;
    return recordFromRest(rec);
  } catch (err) {
    console.warn(`[cloudWeb] fetch ${recordName} failed:`, err);
    return null;
  }
}

export async function webQueryRecords(opts: CloudKitQueryOpts): Promise<CloudKitQueryResult> {
  if (!isWebReadConfigured()) return { records: [], cursor: null };
  if (opts.db !== "public") return { records: [], cursor: null };
  try {
    // Translate the cloudKit.ts query shape (NSPredicate string) into
    // the REST shape (filterBy + sortBy arrays). For our two predicates
    // we only need exact-equals and reference-equals — anything else
    // is unsupported here and we fall back to "no filter" so the
    // caller still gets approved-only behaviour via client-side checks
    // upstream.
    const filterBy = restFiltersFromPredicate(opts.predicate);
    const sortBy = opts.sortBy ? [{
      fieldName: opts.sortBy.field,
      ascending: opts.sortBy.ascending,
    }] : undefined;
    const body: Record<string, unknown> = {
      query: {
        recordType: opts.recordType,
        filterBy,
      },
      resultsLimit: opts.limit ?? 30,
    };
    if (sortBy) (body.query as Record<string, unknown>).sortBy = sortBy;
    if (opts.cursor) body.continuationMarker = opts.cursor;
    const r = await fetch(buildUrl(`${dbPath("public")}/records/query`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn(`[cloudWeb] query ${opts.recordType} HTTP ${r.status}`);
      return { records: [], cursor: null };
    }
    const json = await r.json();
    const records = (json?.records ?? []).map(recordFromRest);
    return { records, cursor: json?.continuationMarker ?? null };
  } catch (err) {
    console.warn(`[cloudWeb] query ${opts.recordType} failed:`, err);
    return { records: [], cursor: null };
  }
}

// Translate the small set of NSPredicate strings cloudSync emits into
// REST filterBy entries. We only emit two shapes today:
//   1. `status == "approved"`
//   2. `challengeRef == "<recordName>"`
// Anything else falls back to no filter.
function restFiltersFromPredicate(predicate: string | undefined): Array<Record<string, unknown>> {
  if (!predicate) return [];
  const status = predicate.match(/status\s*==\s*"([^"]+)"/);
  if (status) {
    return [{
      fieldName: "status",
      comparator: "EQUALS",
      fieldValue: { value: status[1] },
    }];
  }
  const ref = predicate.match(/challengeRef\s*==\s*"([^"]+)"/);
  if (ref) {
    return [{
      fieldName: "challengeRef",
      comparator: "EQUALS",
      fieldValue: { value: { recordName: ref[1] } },
    }];
  }
  return [];
}
