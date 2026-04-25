import type { Axial, Shape } from "./types";

export const SQRT3 = Math.sqrt(3);

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

export function axialEq(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function axialAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function axialSub(a: Axial, b: Axial): Axial {
  return { q: a.q - b.q, r: a.r - b.r };
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

// Rotate a single axial coord 60° clockwise around the origin.
export function rotateCw(a: Axial): Axial {
  return { q: -a.r, r: a.q + a.r };
}

// Rotate a single axial coord 60° counter-clockwise around the origin.
export function rotateCcw(a: Axial): Axial {
  return { q: a.q + a.r, r: -a.q };
}

export function rotateShape(shape: Shape, steps: number): Shape {
  // steps: integer; positive = clockwise, negative = ccw. Normalize to 0..5.
  let s = ((steps % 6) + 6) % 6;
  let out = shape.map((c) => ({ ...c }));
  while (s-- > 0) out = out.map(rotateCw);
  return out;
}

// Pointy-top axial → pixel.
export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  return {
    x: size * SQRT3 * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  };
}

// Axial cube rounding for pixel→axial conversion.
export function pixelToAxial(
  x: number,
  y: number,
  size: number,
): Axial {
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

// Hand-authored polyhex shapes, sized 2..5. Each shape is a list of axial
// coords. The first cell is treated as the "anchor" (origin) for spawn
// alignment so that shapes with a given anchor at (0,0) place predictably.
export const SHAPES: readonly Shape[] = [
  // size 2
  [{ q: 0, r: 0 }, { q: 1, r: 0 }],
  [{ q: 0, r: 0 }, { q: 0, r: 1 }],
  [{ q: 0, r: 0 }, { q: 1, r: -1 }],

  // size 3
  [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
  [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
  [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 }],

  // size 4
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

  // size 5
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

// Shift a shape so its leftmost (smallest pixel x) cell is at q=0 column.
// Useful when picking spawn columns.
export function normalizeShape(shape: Shape): Shape {
  let minQ = Infinity;
  let minR = Infinity;
  for (const c of shape) {
    if (c.q < minQ) minQ = c.q;
    if (c.r < minR) minR = c.r;
  }
  return shape.map((c) => ({ q: c.q - minQ, r: c.r - minR }));
}

// Returns axial bounds in pixel space for a shape rendered at origin.
export function shapePixelBounds(
  shape: Shape,
  size: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of shape) {
    const p = axialToPixel(c, size);
    if (p.x - size * SQRT3 * 0.5 < minX) minX = p.x - size * SQRT3 * 0.5;
    if (p.x + size * SQRT3 * 0.5 > maxX) maxX = p.x + size * SQRT3 * 0.5;
    if (p.y - size < minY) minY = p.y - size;
    if (p.y + size > maxY) maxY = p.y + size;
  }
  return { minX, maxX, minY, maxY };
}

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
