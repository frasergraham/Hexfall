// Static thumbnail renderer for a parsed wave. Used in the editor's
// wave list to give each row a quick visual identity (walls, dominant
// cluster kinds, speed/rate). Pure: takes a canvas + parsed wave,
// draws into the canvas, returns nothing.

import { blobPalette } from "./cluster";
import { axialToPixel, buildPolyhexShape, pathHex } from "./hex";
import { hashSeed, mulberry32 } from "./rng";
import type { ParsedWave } from "./waveDsl";
import type { ClusterKind, WallKind } from "./types";

export interface WavePreviewOptions {
  width?: number;
  height?: number;
  // When true, draws a `+ slot pattern` glyph in the corner if the wave
  // has slot tokens (since the editor currently can't author them but
  // can still surface their presence).
  showSlotBadge?: boolean;
}

export function drawWavePreview(
  canvas: HTMLCanvasElement,
  wave: ParsedWave,
  opts: WavePreviewOptions = {},
): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // Trust the rendered (CSS) size for crispness. Falls back to defaults
  // when the canvas hasn't been laid out yet (first paint after innerHTML).
  const w = opts.width ?? canvas.clientWidth ?? 200;
  const h = opts.height ?? canvas.clientHeight ?? 60;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Background.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(20, 26, 50, 0.8)");
  bg.addColorStop(1, "rgba(8, 10, 22, 0.95)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  drawWalls(ctx, w, h, wave.walls, wave.wallAmp);

  drawClusterSamples(ctx, w, h, wave);
}

// Standalone wall thumbnail for the wave dialog's walls cycler. Sizes
// to whatever CSS gave the canvas, so the caller can flow it
// full-width between the < and > arrow buttons.
export function drawWallPreview(canvas: HTMLCanvasElement, kind: WallKind): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // Trust the rendered (CSS) size for crispness. Fall back to a sane
  // default if the canvas hasn't been laid out yet.
  const w = canvas.clientWidth || 200;
  const h = canvas.clientHeight || 32;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(20, 26, 50, 0.8)");
  bg.addColorStop(1, "rgba(8, 10, 22, 0.95)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  drawWalls(ctx, w, h, kind, 0.22);
}

function drawWalls(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: WallKind,
  amp: number,
): void {
  if (kind === "none") return;
  ctx.save();
  if (kind === "pinch") {
    const inset = w * 0.18;
    ctx.fillStyle = "rgba(180, 100, 110, 0.18)";
    ctx.fillRect(0, 0, inset, h);
    ctx.fillRect(w - inset, 0, inset, h);
    ctx.strokeStyle = "rgba(255, 120, 130, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(inset, 0); ctx.lineTo(inset, h);
    ctx.moveTo(w - inset, 0); ctx.lineTo(w - inset, h);
    ctx.stroke();
  } else if (kind === "narrow") {
    const inset = w * 0.26;
    ctx.fillStyle = "rgba(220, 80, 90, 0.22)";
    ctx.fillRect(0, 0, inset, h);
    ctx.fillRect(w - inset, 0, inset, h);
    ctx.strokeStyle = "rgba(255, 130, 140, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(inset, 0); ctx.lineTo(inset, h);
    ctx.moveTo(w - inset, 0); ctx.lineTo(w - inset, h);
    ctx.stroke();
  } else if (kind === "zigzag") {
    const baseInset = w * 0.12;
    const ampPx = w * Math.max(0.05, Math.min(0.25, amp));
    ctx.strokeStyle = "rgba(220, 170, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(170, 120, 200, 0.18)";
    const STEPS = 12;
    // Left wall fill + outline.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const x = baseInset + Math.sin(t * Math.PI * 2.0) * ampPx;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    // Right wall fill.
    ctx.beginPath();
    ctx.moveTo(w, 0);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const x = w - baseInset - Math.sin(t * Math.PI * 2.0 + Math.PI) * ampPx;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    // Outlines.
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const xl = baseInset + Math.sin(t * Math.PI * 2.0) * ampPx;
      if (i === 0) ctx.moveTo(xl, y); else ctx.lineTo(xl, y);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const xr = w - baseInset - Math.sin(t * Math.PI * 2.0 + Math.PI) * ampPx;
      if (i === 0) ctx.moveTo(xr, y); else ctx.lineTo(xr, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawClusterSamples(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wave: ParsedWave,
): void {
  const TOTAL = 20;
  const KINDS: ClusterKind[] = ["normal", "sticky", "slow", "fast", "coin", "shield", "drone"];
  const { weights, sizeMin, sizeMax } = wave;

  // Snap weights to whole-sample counts (5% per sample in 20). Round
  // each kind, then push any remainder onto the dominant bucket so the
  // total comes out to exactly TOTAL.
  let sum = 0;
  for (const k of KINDS) sum += weights[k] ?? 0;
  if (sum <= 0) sum = 1;
  const counts: Partial<Record<ClusterKind, number>> = {};
  let totalSamples = 0;
  for (const k of KINDS) {
    const c = Math.round(((weights[k] ?? 0) / sum) * TOTAL);
    if (c > 0) {
      counts[k] = c;
      totalSamples += c;
    }
  }
  if (totalSamples !== TOTAL) {
    let dominant: ClusterKind = "normal";
    let dCount = -1;
    for (const k of KINDS) {
      const c = counts[k] ?? 0;
      if (c > dCount) { dCount = c; dominant = k; }
    }
    counts[dominant] = Math.max(0, (counts[dominant] ?? 0) + (TOTAL - totalSamples));
  }

  const samples: ClusterKind[] = [];
  for (const k of KINDS) {
    const c = counts[k] ?? 0;
    for (let i = 0; i < c; i++) samples.push(k);
  }
  while (samples.length < TOTAL) samples.push("normal");
  samples.length = TOTAL;

  // Seed an RNG from the wave so the layout is stable for a given
  // wave but different waves scatter differently. Shuffle samples
  // (Fisher-Yates) so the kinds aren't grouped at the start of the row.
  const seedStr =
    `${wave.sizeMin}|${wave.sizeMax}|${wave.baseSpeedMul}|${wave.spawnInterval}|${wave.walls}|` +
    KINDS.map((k) => `${k}:${weights[k] ?? 0}`).join(",");
  const rng = mulberry32(hashSeed(seedStr));
  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [samples[i], samples[j]] = [samples[j]!, samples[i]!];
  }

  // Layout: 2 rows × 10 columns + per-cell jitter. Hex size scales
  // with available cell size so the preview reads regardless of how
  // wide the canvas ends up rendering.
  const COLS = 10;
  const ROWS = 2;
  const padX = 6;
  const padY = 6;
  const cellW = (w - padX * 2) / COLS;
  const cellH = (h - padY * 2) / ROWS;
  const baseHex = Math.max(2.2, Math.min(5.5, Math.min(cellW, cellH) * 0.22));
  const sizeRange = Math.max(1, sizeMax - sizeMin + 1);
  for (let i = 0; i < TOTAL; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    // Random per-cell jitter (deterministic via seeded rng).
    const jx = (rng() - 0.5) * cellW * 0.6;
    const jy = (rng() - 0.5) * cellH * 0.7;
    const cx = padX + cellW * (col + 0.5) + jx;
    const cy = padY + cellH * (row + 0.5) + jy;
    const kind = samples[i]!;
    const isPickup = kind === "coin" || kind === "shield" || kind === "drone";
    // Pickups in-game are always single-hex. Other kinds pick a
    // random size from the wave's range so the variance reads.
    const size = isPickup ? 1 : sizeMin + Math.floor(rng() * sizeRange);
    drawClusterSample(ctx, cx, cy, baseHex, kind, size, rng);
  }
}

// Draw an individual cluster sample at (cx, cy). Normal clusters get
// rendered as a tiny polyhex of N hexes (matching their in-game shape);
// pickup kinds (coin / shield / drone) are always single. Power-up
// blobs (sticky / slow / fast) render as one larger blob whose radius
// scales with √N so a "size 5 sticky" reads bigger than "size 1 sticky"
// without trying to draw 5 individual blobs.
function drawClusterSample(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hexSize: number,
  kind: ClusterKind,
  size: number,
  rng: () => number,
): void {
  if (kind === "normal" && size > 1) {
    const shape = buildPolyhexShape(size, rng);
    for (const part of shape) {
      const off = axialToPixel(part, hexSize);
      drawSample(ctx, cx + off.x, cy + off.y, hexSize, kind);
    }
    return;
  }
  if (kind === "sticky" || kind === "slow" || kind === "fast") {
    // Approximate a multi-hex blob with a single bigger blob.
    const r = hexSize * Math.sqrt(Math.max(1, size));
    drawSample(ctx, cx, cy, r, kind);
    return;
  }
  drawSample(ctx, cx, cy, hexSize, kind);
}

function drawSample(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hexSize: number,
  kind: ClusterKind,
): void {
  if (kind === "normal") {
    pathHex(ctx, cx, cy, hexSize);
    const grad = ctx.createLinearGradient(0, cy - hexSize, 0, cy + hexSize);
    grad.addColorStop(0, "#aac4ff");
    grad.addColorStop(1, "#5b8bff");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#1c2348";
    ctx.stroke();
    return;
  }
  if (kind === "coin") {
    ctx.save();
    const r = hexSize * 0.95;
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    grad.addColorStop(0, "#fff1c2");
    grad.addColorStop(0.45, "#ffb255");
    grad.addColorStop(1, "#a14e08");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 240, 200, 0.95)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Helpful blob kinds.
  const palette = blobPalette(kind);
  const r = hexSize * 0.85;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.8);
  halo.addColorStop(0, palette.haloInner);
  halo.addColorStop(0.55, palette.haloMid);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const core = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  core.addColorStop(0, palette.coreLight);
  core.addColorStop(1, palette.coreDark);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
