/*
 * waveDsl.ts — parser for HexRain's challenge-mode wave DSL.
 *
 * A wave is a comma-separated list of tokens. Each token is either a
 * key=value pair (e.g. `rate=0.45`, `walls=zigzag`) or a three-digit
 * explicit slot (e.g. `145` = size 1, col 4, angle idx 5). The special
 * `pct=` key takes a value of the form `kind:weight,kind:weight,...`
 * which, because it contains commas, is reassembled by the tokenizer.
 *
 * Example:
 *   dur=10, speed=1.4, rate=0.45, walls=zigzag, wallAmp=0.22,
 *   size=1-3, pct=normal:80,fast:10,coin:10
 *
 * See challenge.md §1 for the full grammar.
 */

import type { ClusterKind, WallKind } from "./types";

export type WaveOrigin = "top" | "topAngled" | "side";

export interface ParsedSlot {
  size: number;
  col: number;
  angleIdx: number;
  /** Cluster kind for this slot. Defaults to "normal" for legacy 3-digit
   * slot tokens; custom-wave slots prefix the token with a letter to
   * encode kind (e.g. `S137` = sticky, `C237` = coin). */
  kind: ClusterKind;
}

export interface ParsedWave {
  durOverride: number | null;
  baseSpeedMul: number;
  spawnInterval: number;
  slotInterval: number;
  origin: WaveOrigin;
  defaultDir: number;
  /** When true, every spawn picks a random tilt in [-defaultDir,
   *  +defaultDir] instead of using defaultDir as a fixed bias. The
   *  DSL token is `dirRandom=1` (or 0). The magnitude lives in
   *  `defaultDir`; this is just the on/off switch. */
  defaultDirRandom: boolean;
  sizeMin: number;
  sizeMax: number;
  walls: WallKind;
  wallAmp: number;
  wallPeriod: number;
  safeCol: number | "none" | null;
  swarm: boolean;
  weights: Partial<Record<ClusterKind, number>>;
  countCap: number | null;
  slots: Array<ParsedSlot | null>;
}

export interface ChallengeDefLike {
  id: string;
  name: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  block: 1 | 2 | 3 | 4 | 5 | 6;
  index: 1 | 2 | 3 | 4 | 5;
  effects?: Partial<{
    slowDuration: number;
    fastDuration: number;
    shieldDuration: number;
    droneDuration: number;
    tinyDuration: number;
    bigDuration: number;
    /** Player size at which the danger glow appears and a blue hit
     *  becomes lethal. Overrides the per-difficulty default. */
    dangerSize: number;
  }>;
  waves: string[];
}

export const ANGLE_TABLE = [
  { tilt: 0 },
  { tilt: -0.15 },
  { tilt: 0.15 },
  { tilt: -0.35 },
  { tilt: 0.35 },
  { tilt: -0.6 },
  { tilt: 0.6 },
  { tilt: -0.4, sideEntry: "left" as const },
  { tilt: 0.4, sideEntry: "right" as const },
  { tilt: 0, sideEntry: "random" as const, randomTilt: 0.7 },
] as const;

const VALID_CLUSTER_KINDS: ReadonlyArray<ClusterKind> = [
  "normal",
  "sticky",
  "slow",
  "fast",
  "coin",
  "shield",
  "drone",
  "tiny",
  "big",
];

const VALID_WALLS: ReadonlyArray<WallKind> = ["none", "pinch", "zigzag", "narrow"];

const VALID_ORIGINS: ReadonlyArray<WaveOrigin> = ["top", "topAngled", "side"];

// Slot tokens are 3 digits (CXX), optionally prefixed with a single
// uppercase letter that encodes the cluster kind for custom waves.
// No prefix → "normal" (legacy roster + DSL output stays back-compat).
const SLOT_RE = /^[A-Z]?\d{3}$/;
const KIND_WEIGHT_RE = /^([A-Za-z]+):(-?\d+(?:\.\d+)?)$/;

const SLOT_KIND_PREFIX: Readonly<Record<string, ClusterKind>> = {
  N: "normal",
  S: "sticky",
  L: "slow",
  F: "fast",
  C: "coin",
  H: "shield",
  D: "drone",
  T: "tiny",
  B: "big",
};

const KIND_TO_SLOT_PREFIX: Readonly<Partial<Record<ClusterKind, string>>> = {
  normal: "",
  sticky: "S",
  slow: "L",
  fast: "F",
  coin: "C",
  shield: "H",
  drone: "D",
  tiny: "T",
  big: "B",
};

export function slotKindToPrefix(kind: ClusterKind): string {
  return KIND_TO_SLOT_PREFIX[kind] ?? "";
}

function fail(message: string, token: string): never {
  throw new Error(`Wave parse error: ${message} (token: "${token}")`);
}

/**
 * Tokenizer.
 *
 * The wave DSL is comma-separated, but `pct=normal:80,fast:10,coin:10`
 * legitimately contains commas inside its value. The simplest robust
 * approach (and the one the spec calls for) is:
 *
 *   1. Split the line on commas, trim each piece.
 *   2. Walk the resulting array.
 *   3. When we encounter a `pct=...` token, peek at the following
 *      tokens — as long as they look like `kind:weight` (matching
 *      KIND_WEIGHT_RE) they belong to the pct value and get folded
 *      back in with commas restored.
 *   4. Standalone `kind:weight` tokens that didn't follow a pct=
 *      are an error (the designer almost certainly forgot a `pct=`).
 *
 * Bare three-digit tokens (`\d{3}`) and other key=value tokens pass
 * through untouched.
 */
function tokenize(line: string): string[] {
  const raw = line.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    const eq = tok.indexOf("=");
    const key = eq >= 0 ? tok.slice(0, eq).trim().toLowerCase() : "";
    if (key === "pct") {
      // Fold subsequent kind:weight tokens into this one.
      let folded = tok;
      while (i + 1 < raw.length && KIND_WEIGHT_RE.test(raw[i + 1])) {
        folded += "," + raw[i + 1];
        i++;
      }
      out.push(folded);
      continue;
    }
    // A lone kind:weight outside a pct= group is a designer mistake.
    if (KIND_WEIGHT_RE.test(tok)) {
      fail("stray kind:weight outside pct=", tok);
    }
    out.push(tok);
  }
  return out;
}

function parseFloatStrict(value: string, token: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) fail(`expected number, got "${value}"`, token);
  return n;
}

function parseIntStrict(value: string, token: string): number {
  if (!/^-?\d+$/.test(value)) fail(`expected integer, got "${value}"`, token);
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) fail(`expected integer, got "${value}"`, token);
  return n;
}

function parseSizeRange(value: string, token: string): { min: number; max: number } {
  const m = value.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    if (lo < 1 || lo > 5 || hi < 1 || hi > 5) {
      fail("size bounds must be 1..5", token);
    }
    if (lo > hi) fail("size min greater than max", token);
    return { min: lo, max: hi };
  }
  if (/^\d+$/.test(value)) {
    const v = parseInt(value, 10);
    if (v < 1 || v > 5) fail("size must be 1..5", token);
    return { min: v, max: v };
  }
  fail(`expected size or size-range, got "${value}"`, token);
}

function parsePct(value: string, token: string): Partial<Record<ClusterKind, number>> {
  const out: Partial<Record<ClusterKind, number>> = {};
  const parts = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) fail("pct value is empty", token);
  for (const part of parts) {
    const m = part.match(KIND_WEIGHT_RE);
    if (!m) fail(`pct entry must be kind:weight, got "${part}"`, token);
    const kind = m[1].toLowerCase() as ClusterKind;
    if (!VALID_CLUSTER_KINDS.includes(kind)) {
      fail(`unknown cluster kind "${m[1]}"`, token);
    }
    const w = parseFloat(m[2]);
    if (!Number.isFinite(w) || w < 0) {
      fail(`pct weight must be >= 0, got "${m[2]}"`, token);
    }
    out[kind] = w;
  }
  return out;
}

function parseSlot(token: string): ParsedSlot | null {
  // token has been validated against SLOT_RE before reaching here.
  const hasPrefix = token.length === 4;
  const prefix = hasPrefix ? token[0]! : "";
  const digits = hasPrefix ? token.slice(1) : token;
  const sizeDigit = parseInt(digits[0]!, 10);
  const col = parseInt(digits[1]!, 10);
  const angleIdx = parseInt(digits[2]!, 10);
  if (sizeDigit === 0) return null;
  const size = sizeDigit > 5 ? 5 : sizeDigit;
  const kind = SLOT_KIND_PREFIX[prefix] ?? "normal";
  return { size, col, angleIdx, kind };
}

export function parseWaveLine(line: string): ParsedWave {
  if (typeof line !== "string" || line.trim().length === 0) {
    throw new Error('Wave parse error: empty wave string (token: "")');
  }

  const wave: ParsedWave = {
    durOverride: null,
    baseSpeedMul: 1.0,
    spawnInterval: 0.55,
    slotInterval: 0.55,
    origin: "top",
    defaultDir: 0,
    defaultDirRandom: false,
    sizeMin: 2,
    sizeMax: 5,
    walls: "none",
    wallAmp: 0.18,
    wallPeriod: 1.4,
    safeCol: null,
    swarm: false,
    weights: { normal: 1 },
    countCap: null,
    slots: [],
  };

  // Track whether slotRate was set explicitly so we can default it to
  // whatever spawnInterval ends up being after parsing (in either order).
  let slotRateSetExplicitly = false;
  let weightsSetExplicitly = false;

  const tokens = tokenize(line);

  for (const token of tokens) {
    if (SLOT_RE.test(token)) {
      wave.slots.push(parseSlot(token));
      continue;
    }

    const eq = token.indexOf("=");
    if (eq < 0) {
      fail(`unrecognised token`, token);
    }
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = token.slice(eq + 1).trim();
    if (value.length === 0) fail(`empty value`, token);

    switch (key) {
      case "dur": {
        const n = parseFloatStrict(value, token);
        if (n < 0.5) fail("dur must be >= 0.5", token);
        wave.durOverride = n;
        break;
      }
      case "speed": {
        const n = parseFloatStrict(value, token);
        if (n <= 0.0001) fail("speed must be > 0.0001", token);
        wave.baseSpeedMul = n;
        break;
      }
      case "rate": {
        const n = parseFloatStrict(value, token);
        if (n < 0.05) fail("rate must be >= 0.05", token);
        wave.spawnInterval = n;
        break;
      }
      case "slotrate": {
        const n = parseFloatStrict(value, token);
        if (n < 0.05) fail("slotRate must be >= 0.05", token);
        wave.slotInterval = n;
        slotRateSetExplicitly = true;
        break;
      }
      case "origin": {
        const v = value.toLowerCase();
        const found = VALID_ORIGINS.find((o) => o.toLowerCase() === v);
        if (!found) fail(`origin must be one of ${VALID_ORIGINS.join("|")}`, token);
        wave.origin = found;
        break;
      }
      case "dir": {
        wave.defaultDir = parseFloatStrict(value, token);
        break;
      }
      case "dirrandom": {
        // Truthy if any of "1", "true", "yes". Anything else = off.
        const v = value.toLowerCase();
        wave.defaultDirRandom = v === "1" || v === "true" || v === "yes";
        break;
      }
      case "size": {
        const { min, max } = parseSizeRange(value, token);
        wave.sizeMin = min;
        wave.sizeMax = max;
        break;
      }
      case "walls": {
        const v = value.toLowerCase() as WallKind;
        if (!VALID_WALLS.includes(v)) {
          fail(`walls must be one of ${VALID_WALLS.join("|")}`, token);
        }
        wave.walls = v;
        break;
      }
      case "wallamp": {
        const n = parseFloatStrict(value, token);
        if (n < 0 || n > 0.5) fail("wallAmp must be 0..0.5", token);
        wave.wallAmp = n;
        break;
      }
      case "wallperiod": {
        const n = parseFloatStrict(value, token);
        if (n <= 0.05) fail("wallPeriod must be > 0.05", token);
        wave.wallPeriod = n;
        break;
      }
      case "safecol": {
        if (value.toLowerCase() === "none") {
          wave.safeCol = "none";
        } else {
          const n = parseIntStrict(value, token);
          if (n < 0 || n > 8) fail("safeCol must be 0..8 or 'none'", token);
          wave.safeCol = n;
        }
        break;
      }
      case "swarm": {
        const v = value.toLowerCase();
        if (v !== "true" && v !== "false") fail("swarm must be true or false", token);
        wave.swarm = v === "true";
        break;
      }
      case "pct": {
        wave.weights = parsePct(value, token);
        weightsSetExplicitly = true;
        break;
      }
      case "count": {
        const n = parseIntStrict(value, token);
        if (n < 0) fail("count must be >= 0", token);
        wave.countCap = n;
        break;
      }
      default:
        fail(`unknown key "${key}"`, token);
    }
  }

  if (!slotRateSetExplicitly) {
    wave.slotInterval = wave.spawnInterval;
  }
  if (!weightsSetExplicitly) {
    wave.weights = { normal: 1 };
  }

  return wave;
}

export function validateChallenge(def: ChallengeDefLike): string[] {
  const errors: string[] = [];

  if (typeof def.id !== "string" || !/^\d-\d$/.test(def.id)) {
    errors.push(`id must match /^\\d-\\d$/, got "${def.id}"`);
  } else {
    const blockDigit = parseInt(def.id[0], 10);
    const indexDigit = parseInt(def.id[2], 10);
    if (blockDigit < 1 || blockDigit > 6) {
      errors.push(`id block digit must be 1..6, got "${def.id}"`);
    }
    if (indexDigit < 1 || indexDigit > 5) {
      errors.push(`id index digit must be 1..5, got "${def.id}"`);
    }
    if (blockDigit !== def.block) {
      errors.push(`id block (${blockDigit}) does not match block field (${def.block})`);
    }
    if (indexDigit !== def.index) {
      errors.push(`id index (${indexDigit}) does not match index field (${def.index})`);
    }
  }

  if (typeof def.block !== "number" || def.block < 1 || def.block > 6) {
    errors.push(`block must be 1..6, got ${def.block}`);
  }
  if (typeof def.index !== "number" || def.index < 1 || def.index > 5) {
    errors.push(`index must be 1..5, got ${def.index}`);
  }

  if (typeof def.name !== "string" || def.name.trim().length === 0) {
    errors.push("name must be a non-empty string");
  }

  if (typeof def.difficulty !== "number" || def.difficulty < 1 || def.difficulty > 5) {
    errors.push(`difficulty must be 1..5, got ${def.difficulty}`);
  }

  if (!Array.isArray(def.waves)) {
    errors.push("waves must be an array");
    return errors;
  }
  if (def.waves.length < 10 || def.waves.length > 100) {
    errors.push(`waves length must be 10..100, got ${def.waves.length}`);
  }

  for (let i = 0; i < def.waves.length; i++) {
    const line = def.waves[i];
    let parsed: ParsedWave | null = null;
    try {
      parsed = parseWaveLine(line);
    } catch (e) {
      errors.push(`wave[${i}]: ${(e as Error).message}`);
      continue;
    }
    const hasCount = parsed.countCap !== null && parsed.countCap > 0;
    const hasSlots = parsed.slots.length > 0;
    const probDisabledByZeroCount = parsed.countCap === 0;
    const hasDur =
      parsed.durOverride !== null &&
      parsed.durOverride > 0 &&
      parsed.spawnInterval > 0 &&
      !probDisabledByZeroCount; // dur with count=0 and no slots = silent wave
    if (!hasCount && !hasSlots && !hasDur) {
      errors.push(
        `wave[${i}]: wave does nothing (need count>0, slots, or dur+rate without count=0)`,
      );
    }
  }

  return errors;
}
