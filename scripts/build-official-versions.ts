// Generate scripts/official-versions.json — a `{ [challengeId]: number }`
// map keyed by `Score.challengeKey` ("off:<id>") and valued by the
// current FNV-1a content hash. Consumed by `scripts/moderator.mjs
// purge-stale-scores` to identify Score rows whose challenge content
// has changed since they were posted.
//
// Run via the build's prebuild step (package.json) using `tsx` so the
// TypeScript imports from src/ work without a compile pass.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHALLENGES } from "../src/challenges";
import { officialChallengeVersion } from "../src/challengeVersion";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "official-versions.json");

const versions: Record<string, number> = {};
for (const def of CHALLENGES) {
  versions[def.id] = officialChallengeVersion(def);
}

fs.writeFileSync(out, JSON.stringify(versions, null, 2) + "\n", "utf8");
console.log(`Wrote ${out} (${Object.keys(versions).length} challenges)`);
