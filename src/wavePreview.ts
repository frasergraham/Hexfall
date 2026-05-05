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

  drawWalls(ctx, w, h, wave.walls, wave.wallAmp, wave.wallPeriod);
  const wallInset = wallInsetPx(w, wave.walls, wave.wallAmp);

  // Slot-only waves (custom waves authored in the slot-grid editor)
  // get a different render: every actual placed slot drawn at its
  // (row, col) position so the thumbnail mirrors the timeline. Other
  // waves use the distribution-based 20-sample render.
  const isSlotOnly =
    wave.slots.length > 0 && (wave.countCap === 0 || wave.countCap === null);
  if (isSlotOnly) drawCustomWaveSlots(ctx, w, h, wave, wallInset);
  else drawClusterSamples(ctx, w, h, wave, wallInset);
}

// Worst-case wall inset in pixels — must match the geometry drawn by
// drawWalls below so cluster samples / slot cells stay clear of the
// shaded wall band. Zigzag oscillates, so we report the max-inset side
// at the sine peak (the always-clear zone).
function wallInsetPx(w: number, kind: WallKind, amp: number): { left: number; right: number } {
  if (kind === "pinch") return { left: w * 0.18, right: w * 0.18 };
  if (kind === "narrow") return { left: w * 0.26, right: w * 0.26 };
  if (kind === "zigzag") {
    const a = Math.max(0.05, Math.min(0.25, amp));
    const inset = w * (0.12 + a);
    return { left: inset, right: inset };
  }
  return { left: 0, right: 0 };
}

// Render the first PREVIEW_ROWS slots of a custom wave at their
// (col, row) positions — like a piano roll. Bottom of the canvas =
// first slot to spawn. Long waves get truncated; the thumbnail is a
// teaser, not the full timeline.
const CUSTOM_WAVE_PREVIEW_ROWS = 10;
function drawCustomWaveSlots(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wave: ParsedWave,
  wallInset: { left: number; right: number },
): void {
  if (wave.slots.length === 0) return;
  const visible = Math.min(wave.slots.length, CUSTOM_WAVE_PREVIEW_ROWS);
  const padX = 4;
  const padY = 4;
  // Side spawns enter from outside the walls, so the side columns sit
  // at the canvas edges. The 10 main columns share the inner corridor
  // bounded by the wall insets so blocks land where they will in-game.
  const corridorLeft = padX + wallInset.left;
  const corridorRight = w - padX - wallInset.right;
  const corridorW = Math.max(20, corridorRight - corridorLeft);
  const mainCellW = corridorW / 10;
  const sideCellW = Math.min(mainCellW, (w - padX * 2) / 12);
  const cellH = (h - padY * 2) / visible;
  const hexSize = Math.max(2, Math.min(mainCellW * 0.42, cellH * 0.55) * 0.6);
  // Stable shape RNG — same wave produces the same polyhex layouts.
  const seed = hashSeed(`${wave.slots.length}|${visible}|${wave.spawnInterval}`);
  const rng = mulberry32(seed);
  for (let i = 0; i < visible; i++) {
    const slot = wave.slots[i];
    if (!slot) continue;
    let cx: number;
    if (slot.angleIdx === 7) cx = padX + sideCellW * 0.5;            // left side
    else if (slot.angleIdx === 8) cx = w - padX - sideCellW * 0.5;   // right side
    else {
      const col = Math.max(0, Math.min(9, slot.col));
      cx = corridorLeft + mainCellW * (col + 0.5);
    }
    // Slot 0 at the bottom (first to spawn), slots[visible-1] at the top.
    const cy = h - padY - cellH * (i + 0.5);
    drawClusterSample(ctx, cx, cy, hexSize, slot.kind, slot.size, rng);
  }
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
  period: number = 1.4,
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
    // One full cycle (sin 0..2π) of parallel-shift zigzag — both walls
    // offset by the same amount so the corridor's centre wiggles
    // sideways while keeping its width. Closes at top and bottom.
    // `period` only controls time-scroll in-game and doesn't apply to
    // a static frame.
    void period;
    ctx.strokeStyle = "rgba(220, 170, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(170, 120, 200, 0.18)";
    const STEPS = 32;
    const wave = (t: number) => Math.sin(t * Math.PI * 2);
    // Left wall fill + outline.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const x = baseInset + wave(t) * ampPx;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    // Right wall fill — same offset (parallel shift, not mirror).
    ctx.beginPath();
    ctx.moveTo(w, 0);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const x = w - baseInset + wave(t) * ampPx;
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
      const xl = baseInset + wave(t) * ampPx;
      if (i === 0) ctx.moveTo(xl, y); else ctx.lineTo(xl, y);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * h;
      const xr = w - baseInset + wave(t) * ampPx;
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
  wallInset: { left: number; right: number },
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
  const padX = Math.max(6, wallInset.left);
  const padXRight = Math.max(6, wallInset.right);
  const padY = 6;
  const cellW = (w - padX - padXRight) / COLS;
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

// Draw an individual cluster sample at (cx, cy). All non-pickup kinds
// build a polyhex of N cells and render one cell-sized hex / blob at
// each — same as the in-game drawAsHex / drawAsBlob logic. Pickup
// kinds (coin / shield / drone) are always single-cell since they
// spawn that way in-game.
function drawClusterSample(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hexSize: number,
  kind: ClusterKind,
  size: number,
  rng: () => number,
): void {
  const isPickup = kind === "coin" || kind === "shield" || kind === "drone";
  if (isPickup || size <= 1) {
    drawSample(ctx, cx, cy, hexSize, kind);
    return;
  }
  const shape = buildPolyhexShape(size, rng);
  for (const part of shape) {
    const off = axialToPixel(part, hexSize);
    drawSample(ctx, cx + off.x, cy + off.y, hexSize, kind);
  }
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
