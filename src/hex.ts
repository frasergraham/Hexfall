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
