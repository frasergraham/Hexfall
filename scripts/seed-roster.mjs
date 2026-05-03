// One-shot: append `, seed=<hashSeed(id:idx)>` to every wave in the
// official challenge roster so future edits can reroll a single wave's
// layout without touching the rest. Idempotent — replaces an existing
// seed= token if one is present.
//
// Run: node scripts/seed-roster.mjs

import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/challenges.ts";

function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const src = readFileSync(FILE, "utf8");

let touched = 0;
const out = src.replace(
  /(id:\s*"(\d-\d)"[\s\S]*?waves:\s*\[)([\s\S]*?)(\])/g,
  (_, prefix, id, body, suffix) => {
    let idx = 0;
    const newBody = body.replace(/"([^"]*)"/g, (_full, inner) => {
      const seed = hashSeed(`${id}:${idx}`);
      idx += 1;
      let next;
      if (/(?:^|,\s*)seed=/i.test(inner)) {
        next = inner.replace(/(^|,\s*)seed=\d+/i, `$1seed=${seed}`);
      } else {
        next = `${inner}, seed=${seed}`;
      }
      if (next !== inner) touched += 1;
      return `"${next}"`;
    });
    return prefix + newBody + suffix;
  },
);

writeFileSync(FILE, out);
console.log(`updated ${touched} wave strings in ${FILE}`);
