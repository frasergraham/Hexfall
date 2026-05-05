// Offline trace + diff for a challenge's spawn sequence. Replays the
// per-wave RNG-driven spawn pipeline using only the challenge's seed
// key + wave DSL — no Matter.js, no canvas, no game loop. Outputs a
// canonical text trace per wave plus a stable hash, so two runs of
// the same challenge produce byte-identical output (verifies remix
// determinism) and two challenges can be diffed wave-by-wave.
//
// Trace fidelity caveats:
//  - Walls are assumed fully settled (amount = 1) for column picks.
//    In-game, wall transitions can shift later waves' columns even
//    when their seeded streams are unchanged (forward env-coupling
//    documented in game.ts:6587). For challenges that walk through
//    multiple wall transitions this means the trace's column values
//    can drift from a real run; the hash for any given challenge
//    is still stable run-to-run.
//  - Side-entry positions are recorded as fractional rng draws, not
//    pixel coords, so the trace doesn't depend on canvas size.
//  - safeCol from the DSL is honoured; in-challenge mode this matches
//    the engine exactly (game.ts:6618).
//
// Usage:
//   tsx scripts/diff-challenge.ts trace <id-or-path>
//   tsx scripts/diff-challenge.ts diff  <a> <b>
//
// `<id-or-path>` is one of:
//   - A roster id (e.g. `1-3`) — looked up in CHALLENGES.
//   - A path to a JSON file shaped `{ id, seed?, waves: string[] }`
//     (matches the editor's CustomChallenge serialization).

import { readFileSync } from "node:fs";

import { CHALLENGES } from "../src/challenges";
import { ANGLE_TABLE, parseWaveLine, type ParsedWave } from "../src/waveDsl";
import { hashSeed, mulberry32 } from "../src/rng";
import { buildPolyhexShape, type Axial } from "../src/hex";
import type { ClusterKind } from "../src/types";

const BOARD_COLS = 9;
const HALF_FULL = Math.floor(BOARD_COLS / 2);
const COIN_SHAPE: Axial[] = [{ q: 0, r: 0 }];

interface ChallengeInput {
  label: string;
  seedKey: string;
  waves: string[];
}

interface SpawnTrace {
  source: "slot" | "prob";
  kind: ClusterKind;
  size: number;
  shape: string;        // canonicalised cell list
  pos: string;          // top:colStep=N | side:left|right:y=F
  motion: string;       // tilt=F | sideAngle=F
}

interface WaveTrace {
  waveIdx: number;
  seed: number;
  events: SpawnTrace[];
  hash: string;
}

// ---------------------------------------------------------------------------
// loaders
// ---------------------------------------------------------------------------

function loadChallenge(arg: string): ChallengeInput {
  const roster = CHALLENGES.find((c) => c.id === arg);
  if (roster) {
    return {
      label: `roster:${roster.id} (${roster.name})`,
      seedKey: roster.id,
      waves: roster.waves,
    };
  }
  const json = JSON.parse(readFileSync(arg, "utf8")) as {
    id?: string;
    seed?: number;
    waves?: string[];
    name?: string;
  };
  if (!Array.isArray(json.waves)) {
    throw new Error(`Expected JSON with a "waves" array, got: ${arg}`);
  }
  // Match game.ts:6562 — challengeSeedKey is `String(seed >>> 0)` for
  // custom challenges, otherwise the challenge id.
  const seedKey = typeof json.seed === "number"
    ? String(json.seed >>> 0)
    : String(json.id ?? arg);
  const label = json.name ? `file:${arg} (${json.name})` : `file:${arg}`;
  return { label, seedKey, waves: json.waves };
}

// ---------------------------------------------------------------------------
// pipeline replicas
// ---------------------------------------------------------------------------

// Worst-case wall inset in column units, with wall.amount fully settled
// at 1. Mirrors game.ts:projectedWallInsetPx + the boardWidth/colWidth
// algebra: hexSize = boardWidth / (SQRT3 * BOARD_COLS), so colWidth =
// boardWidth / BOARD_COLS, and halfBoard / colWidth = BOARD_COLS / 2.
function projectedWallInsetCols(parsed: ParsedWave): number {
  const halfBoardCols = BOARD_COLS / 2;
  if (parsed.walls === "pinch") return halfBoardCols * 0.36;
  if (parsed.walls === "narrow") return halfBoardCols * 0.42;
  if (parsed.walls === "zigzag") {
    return halfBoardCols * 0.18 + halfBoardCols * parsed.wallAmp;
  }
  return 0;
}

function shapeColumnFootprint(shape: ReadonlyArray<Axial>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of shape) {
    const col = Math.round(c.q + c.r / 2);
    if (col < min) min = col;
    if (col > max) max = col;
  }
  return { min, max };
}

function canonShape(shape: ReadonlyArray<Axial>): string {
  return shape
    .map((c) => `${c.q},${c.r}`)
    .sort()
    .join("|");
}

function safeColumnFor(parsed: ParsedWave): number {
  if (typeof parsed.safeCol === "number") return parsed.safeCol - 4;
  return 99;
}

function pickSpawnColumn(
  shape: ReadonlyArray<Axial>,
  parsed: ParsedWave,
  rng: () => number,
): number | null {
  const insetCols = projectedWallInsetCols(parsed);
  const halfActive = Math.max(1, Math.floor(HALF_FULL - insetCols));
  const fp = shapeColumnFootprint(shape);
  const safeColumn = safeColumnFor(parsed);
  const valid: number[] = [];
  for (let c = -halfActive; c <= halfActive; c++) {
    const lo = c + fp.min;
    const hi = c + fp.max;
    if (safeColumn < lo || safeColumn > hi) valid.push(c);
  }
  if (valid.length === 0) return null;
  return valid[Math.floor(rng() * valid.length)]!;
}

const ANGLE_DEFS = ANGLE_TABLE as ReadonlyArray<{
  tilt: number;
  sideEntry?: "left" | "right" | "random";
  randomTilt?: number;
}>;

function emitSlotEvent(
  slot: { kind: ClusterKind; size: number; col: number; angleIdx: number },
  parsed: ParsedWave,
  rng: () => number,
): SpawnTrace {
  let size = Math.max(1, Math.min(5, slot.size));
  if (parsed.walls === "narrow" && size >= 3) size = 2;
  const isPickup = slot.kind === "coin" || slot.kind === "shield" || slot.kind === "drone";
  const shape = isPickup ? COIN_SHAPE : buildPolyhexShape(size, rng);
  const angle = ANGLE_DEFS[Math.max(0, Math.min(9, slot.angleIdx))]!;
  let pos: string;
  let motion: string;
  if (angle.sideEntry) {
    let fromLeft: boolean;
    if (angle.sideEntry === "random") {
      fromLeft = rng() < 0.5;
    } else {
      fromLeft = angle.sideEntry === "left";
    }
    const yFrac = rng();
    const sideAngle = 0.05 + rng() * 0.1;
    pos = `side:${fromLeft ? "left" : "right"}:y=${yFrac.toFixed(6)}`;
    motion = `sideAngle=${sideAngle.toFixed(6)}`;
  } else {
    const insetCols = projectedWallInsetCols(parsed);
    const halfActive = Math.max(1, Math.floor(HALF_FULL - insetCols));
    const colStep = -halfActive + Math.round((slot.col / 9) * (halfActive * 2));
    pos = `top:colStep=${colStep}`;
    const dirBias = parsed.defaultDirRandom
      ? (rng() * 2 - 1) * parsed.defaultDir
      : parsed.defaultDir;
    const tiltJitter = angle.randomTilt ? (rng() - 0.5) * angle.randomTilt : 0;
    const tilt = angle.tilt + tiltJitter + dirBias;
    motion = `tilt=${tilt.toFixed(6)}`;
  }
  return {
    source: "slot",
    kind: slot.kind,
    size,
    shape: canonShape(shape),
    pos,
    motion,
  };
}

function emitProbEvent(parsed: ParsedWave, rng: () => number): SpawnTrace {
  const weights = parsed.weights;
  let total = 0;
  for (const k of Object.keys(weights) as ClusterKind[]) total += weights[k] ?? 0;
  if (total <= 0) total = 1;
  let r = rng() * total;
  let kind: ClusterKind = "normal";
  for (const k of Object.keys(weights) as ClusterKind[]) {
    const w = weights[k] ?? 0;
    if (w <= 0) continue;
    if (r < w) { kind = k; break; }
    r -= w;
  }
  const isPickup = kind === "coin" || kind === "shield" || kind === "drone";
  let shape: ReadonlyArray<Axial>;
  let size: number;
  if (isPickup) {
    shape = COIN_SHAPE;
    size = 1;
  } else {
    const range = parsed.sizeMax - parsed.sizeMin + 1;
    size = parsed.sizeMin + Math.floor(rng() * range);
    if (parsed.walls === "narrow" && size >= 3) size = 2;
    size = Math.max(1, Math.min(5, size));
    shape = buildPolyhexShape(size, rng);
  }
  const colStep = pickSpawnColumn(shape, parsed, rng);
  let pos: string;
  let motion: string;
  if (parsed.origin === "side") {
    const fromLeft = rng() < 0.5;
    const yFrac = rng();
    const sideAngle = 0.05 + rng() * 0.1;
    pos = `side:${fromLeft ? "left" : "right"}:y=${yFrac.toFixed(6)}`;
    motion = `sideAngle=${sideAngle.toFixed(6)}`;
  } else {
    pos = `top:colStep=${colStep ?? "x"}`;
    const tilt = parsed.defaultDirRandom
      ? (rng() * 2 - 1) * parsed.defaultDir
      : parsed.defaultDir;
    motion = `tilt=${tilt.toFixed(6)}`;
  }
  return {
    source: "prob",
    kind,
    size,
    shape: canonShape(shape),
    pos,
    motion,
  };
}

// Interleave slot events and prob events by firing time. Slot k fires
// at t = (k+1) * slotInterval; prob j fires at t = (j+1) * spawnInterval.
// Tie-break: slot before prob (matches game.ts update order). Stops on
// durOverride or both streams done. Mirrors the wave-end check at
// game.ts:6675.
function traceWave(line: string, seedKey: string, waveIdx: number): WaveTrace {
  const parsed = parseWaveLine(line);
  const seed = (parsed.seed ?? hashSeed(`${seedKey}:${waveIdx}`)) >>> 0;
  const rng = mulberry32(seed);

  const slots = parsed.slots;
  const slotsTotal = slots.length;
  const probLimit = parsed.countCap;
  const dur = parsed.durOverride;
  const events: SpawnTrace[] = [];

  let slotIdx = 0;
  let probIdx = 0;

  // Hard upper bound to keep a malformed wave from looping forever.
  const HARD_CAP = 50_000;

  while (events.length < HARD_CAP) {
    const slotsDone = slotIdx >= slotsTotal;
    const probDone = probLimit === null
      ? slotsTotal > 0 && slotsDone   // null prob limit ends with slots when slots present
      : probIdx >= probLimit;
    if (slotsDone && probDone) break;
    if (slotsDone && slotsTotal === 0 && probLimit === null) break;

    const tSlot = slotsDone ? Infinity : (slotIdx + 1) * parsed.slotInterval;
    const tProb = probDone || (probLimit === null && slotsTotal > 0)
      ? Infinity
      : (probIdx + 1) * parsed.spawnInterval;
    const tNext = Math.min(tSlot, tProb);
    if (!Number.isFinite(tNext)) break;
    if (dur !== null && tNext > dur) break;

    if (tSlot <= tProb) {
      const slot = slots[slotIdx];
      slotIdx++;
      if (slot != null) events.push(emitSlotEvent(slot, parsed, rng));
    } else {
      probIdx++;
      events.push(emitProbEvent(parsed, rng));
    }
  }

  return { waveIdx, seed, events, hash: hashTrace(events) };
}

// FNV-1a over the canonical text representation. Same family as
// rng.ts:hashSeed.
function hashTrace(events: ReadonlyArray<SpawnTrace>): string {
  let h = 2166136261 >>> 0;
  for (const e of events) {
    const s = `${e.source}|${e.kind}|${e.size}|${e.shape}|${e.pos}|${e.motion}\n`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function traceChallenge(input: ChallengeInput): WaveTrace[] {
  return input.waves.map((line, i) => traceWave(line, input.seedKey, i));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printTrace(input: ChallengeInput, traces: ReadonlyArray<WaveTrace>): void {
  console.log(`# ${input.label}`);
  console.log(`# seedKey: ${input.seedKey}`);
  console.log(`# waves: ${traces.length}`);
  let total = 0;
  for (const t of traces) {
    total += t.events.length;
    console.log(``);
    console.log(`## wave ${t.waveIdx + 1} — seed=${t.seed} hash=${t.hash} events=${t.events.length}`);
    for (const e of t.events) {
      console.log(`  ${e.source} ${e.kind.padEnd(7)} sz=${e.size} ${e.pos.padEnd(28)} ${e.motion.padEnd(20)} shape=${e.shape}`);
    }
  }
  console.log(``);
  console.log(`# total events: ${total}`);
}

function perEventDiff(a: WaveTrace, b: WaveTrace): string {
  const n = Math.min(a.events.length, b.events.length);
  let diffs = 0;
  for (let i = 0; i < n; i++) {
    const ea = a.events[i]!;
    const eb = b.events[i]!;
    const sa = `${ea.source}|${ea.kind}|${ea.size}|${ea.shape}|${ea.pos}|${ea.motion}`;
    const sb = `${eb.source}|${eb.kind}|${eb.size}|${eb.shape}|${eb.pos}|${eb.motion}`;
    if (sa !== sb) diffs++;
  }
  const lenDiff = Math.abs(a.events.length - b.events.length);
  const lenNote = lenDiff > 0 ? `, ${lenDiff} length delta` : "";
  return `${diffs}/${n} events differ${lenNote}`;
}

function diffChallenges(a: ChallengeInput, b: ChallengeInput): void {
  const ta = traceChallenge(a);
  const tb = traceChallenge(b);
  const maxN = Math.max(ta.length, tb.length);
  let diffWaves = 0;

  console.log(`A: ${a.label}    seedKey=${a.seedKey}`);
  console.log(`B: ${b.label}    seedKey=${b.seedKey}`);
  console.log(`waves: A=${ta.length} B=${tb.length}`);
  console.log(``);
  console.log(`wave  A.hash    B.hash    A.evt   B.evt   diff`);
  for (let i = 0; i < maxN; i++) {
    const ea = ta[i];
    const eb = tb[i];
    const ah = ea?.hash ?? "--------";
    const bh = eb?.hash ?? "--------";
    const ac = ea ? String(ea.events.length) : "--";
    const bc = eb ? String(eb.events.length) : "--";
    const isDiff = !ea || !eb || ah !== bh;
    if (isDiff) diffWaves++;
    const summary = !ea
      ? "B-only"
      : !eb
        ? "A-only"
        : ah === bh
          ? "match"
          : perEventDiff(ea, eb);
    console.log(
      `${String(i + 1).padStart(4)}  ${ah}  ${bh}  ${ac.padStart(6)}  ${bc.padStart(6)}  ${summary}`,
    );
  }
  console.log(``);
  console.log(`${diffWaves} of ${maxN} waves differ`);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "trace" && args[1]) {
  const inp = loadChallenge(args[1]);
  printTrace(inp, traceChallenge(inp));
} else if (cmd === "diff" && args[1] && args[2]) {
  diffChallenges(loadChallenge(args[1]), loadChallenge(args[2]));
} else {
  console.error("Usage:");
  console.error("  tsx scripts/diff-challenge.ts trace <roster-id-or-path>");
  console.error("  tsx scripts/diff-challenge.ts diff  <a> <b>");
  process.exit(1);
}
