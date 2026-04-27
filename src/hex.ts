import type { Axial, Shape } from "./types";

export const SQRT3 = Math.sqrt(3);

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

export function axialAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export const NEIGHBOR_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighborsOf(a: Axial): Axial[] {
  return NEIGHBOR_DIRS.map((d) => axialAdd(a, d));
}

// Pointy-top axial → pixel.
export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  return {
    x: size * SQRT3 * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  };
}

// Pixel → axial with cube rounding (pointy-top).
export function pixelToAxial(x: number, y: number, size: number): Axial {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return cubeRoundAxial(q, r);
}

function cubeRoundAxial(qf: number, rf: number): Axial {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const xd = Math.abs(rx - xf);
  const yd = Math.abs(ry - yf);
  const zd = Math.abs(rz - zf);
  if (xd > yd && xd > zd) rx = -ry - rz;
  else if (yd > zd) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// Polyhex shape library, sized 2..5. Each shape is a list of axial coords;
// the first cell is the spawn anchor.
export const SHAPES: readonly Shape[] = [
  [{ q: 0, r: 0 }, { q: 1, r: 0 }],
  [{ q: 0, r: 0 }, { q: 0, r: 1 }],
  [{ q: 0, r: 0 }, { q: 1, r: -1 }],

  [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
  [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
  [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 }],

  [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 1, r: 1 },
  ],
  [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: 1, r: 1 },
  ],
  [
    { q: 0, r: 0 },
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 2, r: -1 },
  ],

  [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 1, r: -1 },
    { q: 1, r: 1 },
  ],
  [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 0, r: 1 },
    { q: 2, r: -1 },
  ],
];

// Draw a single pointy-top hex centered at (cx, cy) with circumradius `size`.
export function pathHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Grow a connected polyhex of `n` cells from the origin. Each step adds a
// uniformly-random unoccupied neighbour of the current set, so the result
// is a single contact-coherent blob with shape variety. `rng` defaults to
// Math.random; pass a seeded source for stable layouts.
export function buildPolyhexShape(n: number, rng: () => number = Math.random): Axial[] {
  if (n <= 0) return [];
  const cells: Axial[] = [{ q: 0, r: 0 }];
  const seen = new Set<string>([axialKey(cells[0])]);
  while (cells.length < n) {
    const candidates: Axial[] = [];
    const candKeys = new Set<string>();
    for (const c of cells) {
      for (const d of NEIGHBOR_DIRS) {
        const next = axialAdd(c, d);
        const k = axialKey(next);
        if (!seen.has(k) && !candKeys.has(k)) {
          candidates.push(next);
          candKeys.add(k);
        }
      }
    }
    if (candidates.length === 0) break;
    const pick = candidates[Math.floor(rng() * candidates.length)];
    cells.push(pick);
    seen.add(axialKey(pick));
  }
  return cells;
}

// Tiny seeded PRNG (mulberry32) — deterministic from a 32-bit seed so the
// same achievement set always produces the same polyhex layout.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
