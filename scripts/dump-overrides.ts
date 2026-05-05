// Batch validator + diff for override JSON files dumped by the web
// editor's DUMP JSON button.
//
// Workflow:
//   1. Author opens the game on web with ?debug=1.
//   2. EDITs official challenges → DUMP JSON → saves to ./overrides/<id>.json.
//   3. Run this tool against the directory:
//        tsx scripts/dump-overrides.ts overrides/
//      It validates each file (parse, schema, wave DSL) and prints a
//      per-file diff against the current roster: which waves changed,
//      which effects changed, and whether the dump is a no-op.
//   4. Run scripts/moderator.mjs upload-override on each file to push.
//      Mark live with `mark-live <id>` once verified in development env.
//
// This is an offline pre-flight check — no CloudKit access needed. The
// real diff (e.g. wave-level RNG drift) lives in scripts/diff-challenge.ts;
// this tool only summarises high-level shape changes so authors can
// catch unintended diffs before they hit the upload step.
//
// Exit code is non-zero if any file failed validation. Useful for CI
// pre-commit hooks if the override directory ever ships in-tree.

import fs from "node:fs";
import path from "node:path";

import { CHALLENGES } from "../src/challenges";
import { parseWaveLine } from "../src/waveDsl";

interface OverridePayload {
  challengeId: string;
  name: string;
  difficulty: number;
  effects?: Record<string, number>;
  waves: string[];
  stars?: { one: number; two: number; three: number };
}

interface ValidationFinding {
  file: string;
  ok: boolean;
  errors: string[];
  rosterId: string | null;
  noop: boolean;
  changes: string[];
}

function validate(payload: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") return { ok: false, errors: ["not an object"] };
  const p = payload as Partial<OverridePayload>;
  if (typeof p.challengeId !== "string") errors.push("challengeId missing");
  else if (!CHALLENGES.find((c) => c.id === p.challengeId)) {
    errors.push(`unknown challengeId: ${p.challengeId}`);
  }
  if (typeof p.name !== "string" || !p.name.trim()) errors.push("name missing");
  if (typeof p.difficulty !== "number" || p.difficulty < 1 || p.difficulty > 5) {
    errors.push(`difficulty out of range: ${p.difficulty}`);
  }
  if (!Array.isArray(p.waves) || p.waves.length === 0) errors.push("waves empty");
  else for (let i = 0; i < p.waves.length; i++) {
    const w = p.waves[i];
    if (typeof w !== "string") { errors.push(`wave ${i + 1}: not a string`); continue; }
    try { parseWaveLine(w); } catch (e) {
      errors.push(`wave ${i + 1}: ${(e as Error).message}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function diffAgainstRoster(payload: OverridePayload): { noop: boolean; changes: string[] } {
  const roster = CHALLENGES.find((c) => c.id === payload.challengeId);
  if (!roster) return { noop: false, changes: ["roster def not found"] };
  const changes: string[] = [];

  if (payload.name !== roster.name) changes.push(`name: "${roster.name}" → "${payload.name}"`);
  if (payload.difficulty !== roster.difficulty) {
    changes.push(`difficulty: ${roster.difficulty} → ${payload.difficulty}`);
  }

  // Effects diff — both sides may omit fields; compare per-key.
  const effectKeys: (keyof NonNullable<OverridePayload["effects"]>)[] = [
    "slowDuration", "fastDuration", "shieldDuration", "droneDuration", "dangerSize",
  ];
  for (const k of effectKeys) {
    const a = (roster.effects ?? {})[k as keyof typeof roster.effects];
    const b = (payload.effects ?? {})[k];
    if (a !== b && (a !== undefined || b !== undefined)) {
      changes.push(`effects.${k}: ${a ?? "—"} → ${b ?? "—"}`);
    }
  }

  // Waves diff — count, then per-line equality. Skip per-line diff
  // text to keep output skimmable; let scripts/diff-challenge.ts
  // handle deep RNG-trace comparisons.
  if (roster.waves.length !== payload.waves.length) {
    changes.push(`waves: ${roster.waves.length} → ${payload.waves.length}`);
  } else {
    let changed = 0;
    for (let i = 0; i < roster.waves.length; i++) {
      if (roster.waves[i] !== payload.waves[i]) changed += 1;
    }
    if (changed > 0) changes.push(`waves: ${changed} of ${roster.waves.length} lines changed`);
  }

  return { noop: changes.length === 0, changes };
}

function inspectFile(filePath: string): ValidationFinding {
  const file = path.basename(filePath);
  let raw: string;
  try { raw = fs.readFileSync(filePath, "utf8"); } catch (e) {
    return { file, ok: false, errors: [`read error: ${(e as Error).message}`], rosterId: null, noop: false, changes: [] };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (e) {
    return { file, ok: false, errors: [`JSON parse error: ${(e as Error).message}`], rosterId: null, noop: false, changes: [] };
  }
  const validation = validate(parsed);
  if (!validation.ok) {
    return {
      file,
      ok: false,
      errors: validation.errors,
      rosterId: typeof (parsed as Partial<OverridePayload>).challengeId === "string"
        ? (parsed as OverridePayload).challengeId
        : null,
      noop: false,
      changes: [],
    };
  }
  const payload = parsed as OverridePayload;
  const diff = diffAgainstRoster(payload);
  return {
    file,
    ok: true,
    errors: [],
    rosterId: payload.challengeId,
    noop: diff.noop,
    changes: diff.changes,
  };
}

function main(): void {
  const dir = process.argv[2] ?? "overrides";
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort();
  if (files.length === 0) {
    console.log(`No .json files in ${dir}`);
    return;
  }

  let failed = 0;
  let noops = 0;
  for (const f of files) {
    const finding = inspectFile(f);
    if (!finding.ok) {
      failed += 1;
      console.log(`✗ ${finding.file} — INVALID`);
      for (const e of finding.errors) console.log(`    ${e}`);
      continue;
    }
    if (finding.noop) {
      noops += 1;
      console.log(`○ ${finding.file} — no-op (matches roster, upload would just bump version)`);
      continue;
    }
    console.log(`✓ ${finding.file} (${finding.rosterId})`);
    for (const c of finding.changes) console.log(`    ${c}`);
  }

  console.log("");
  console.log(`Summary: ${files.length} files · ${failed} invalid · ${noops} no-op · ${files.length - failed - noops} with changes`);
  if (failed > 0) process.exit(1);
}

main();
