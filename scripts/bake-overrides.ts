// Emit copy-paste-ready ChallengeDef literals for every override in
// ./overrides/*.json (or another directory passed as the first arg),
// formatted to match the hand-authored entries in src/challenges.ts.
//
// Workflow for shipping baked overrides:
//   1. tsx scripts/bake-overrides.ts overrides/
//   2. For each id printed, locate the existing { id: "X-Y", ... } block
//      in src/challenges.ts and replace it with the printed literal.
//      (No regex codegen here — challenges.ts has hand-written comments
//      and helper-call entries that automated patching would mangle.)
//   3. tsx scripts/diff-challenge.ts trace <id> (optional) to confirm
//      the baked literal produces the same wave trace as the override.
//   4. Build + ship the new release.
//   5. Once adoption is complete, retire or delete the cloud record:
//        node scripts/moderator.mjs delete-override X-Y
//      Players on the new build won't notice (the baked def already
//      supersedes the override). Players still on the old build will
//      revert from the cached override to the old hardcoded def — same
//      situation as deleting the override at any other point.
//
// This script intentionally doesn't touch challenges.ts. The risk of an
// auto-rewrite clobbering author comments or seed-roster invariants is
// too high; a copy-paste keeps the human in the loop.

import fs from "node:fs";
import path from "node:path";

import { CHALLENGES } from "../src/challenges";

interface OverridePayload {
  challengeId: string;
  name: string;
  difficulty: number;
  effects?: Record<string, number>;
  waves: string[];
  stars?: { one: number; two: number; three: number };
}

function formatLiteral(payload: OverridePayload): string {
  const roster = CHALLENGES.find((c) => c.id === payload.challengeId);
  if (!roster) return `// roster def not found for ${payload.challengeId}`;
  // block + index come from the roster — overrides never modify them.
  const head = `id: ${JSON.stringify(payload.challengeId)}, name: ${JSON.stringify(payload.name)}, block: ${roster.block}, index: ${roster.index}, difficulty: ${payload.difficulty},`;
  const effectsLine = payload.effects && Object.keys(payload.effects).length > 0
    ? `effects: ${JSON.stringify(payload.effects)},`
    : "";
  const wavesLines = payload.waves.map((w) => `      ${JSON.stringify(w)},`).join("\n");
  return [
    "  {",
    `    ${head}`,
    effectsLine ? `    ${effectsLine}` : null,
    "    waves: [",
    wavesLines,
    "    ],",
    "  },",
  ].filter((s) => s !== null).join("\n");
}

function main(): void {
  const dir = process.argv[2] ?? "overrides";
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.log(`No .json files in ${dir}`);
    return;
  }
  for (const f of files) {
    const fullPath = path.join(dir, f);
    let payload: OverridePayload;
    try {
      payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as OverridePayload;
    } catch (err) {
      console.error(`// SKIP ${f}: ${(err as Error).message}\n`);
      continue;
    }
    console.log(`// ===== ${payload.challengeId} (from ${f}) — paste over the existing entry in src/challenges.ts =====`);
    console.log(formatLiteral(payload));
    if (payload.stars) {
      console.log(`// optional stars override (currently the override carried explicit thresholds):`);
      console.log(`//   one: ${payload.stars.one}, two: ${payload.stars.two}, three: ${payload.stars.three}`);
    }
    console.log("");
  }
  console.log("// ===== BAKED_OVERRIDE_VERSIONS update =====");
  console.log("// Look up the current cloud version for each id with:");
  console.log("//   node scripts/moderator.mjs list-overrides");
  console.log("// Then add the lines below to BAKED_OVERRIDE_VERSIONS in src/challenges.ts.");
  console.log("// The pull-side code skips any cloud override at or below this version,");
  console.log("// and clears stale local cache for it on the next cold launch.");
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    console.log(`//   "${id}": <fill-in-current-version>,`);
  }
  console.log("");
  console.log("// After replacing each entry above, run:");
  console.log("//   npx tsc --noEmit                              # syntax + types");
  console.log("//   npx tsx scripts/diff-challenge.ts trace <id>  # optional sanity diff");
  console.log("// The cloud record can be left in place — the registry above absorbs it.");
  console.log("// Or, to clean up the cloud DB once adoption is complete:");
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    console.log(`//   node scripts/moderator.mjs delete-override ${id}`);
  }
}

main();
