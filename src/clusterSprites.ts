// Prebaked offscreen canvases for the expensive "lighter"-blended halos
// and the radial-gradient cores that the blob/coin clusters draw every
// frame. Cluster.draw() previously allocated a fresh CanvasGradient per
// part per frame inside a globalCompositeOperation="lighter" block — on
// WKWebView each gradient flushes GPU batch state, and at late-game
// cluster counts (~5-8 live × up to 5 parts) that was 20-60 gradient
// allocations + composite-mode flips per frame. Caching them as flat
// bitmaps trades a one-off rasterise for a hot-path drawImage.
//
// Cache key includes devicePixelRatio so we don't sample-blur the
// sprites on retina; iPad/iPhone are fixed dpr so in practice this
// resolves to one entry per (kind, hexSize) for the run.
//
// The cache is intentionally never invalidated — sprites are small
// (~80px each), kinds + hexSize are bounded, and the working set
// across a session stays under a few KB.

import { blobPalette } from "./palettes";
import type { ClusterKind } from "./types";

export type Sprite = {
  canvas: HTMLCanvasElement;
  // Half-width / half-height in CSS pixels. drawSprite renders the
  // bitmap centred on the supplied (x, y), so callers don't have to
  // subtract margins themselves.
  hw: number;
  hh: number;
};

const SPRITE_CACHE = new Map<string, Sprite>();

function currentDpr(): number {
  return typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
}

// Build a Sprite at native pixel density. The internal draw() callback
// works in CSS-pixel coordinates with the supplied (cssW × cssH)
// extent; setTransform(dpr,...) inside the offscreen ctx ensures
// crisp output when the main canvas (also dpr-scaled) drawImages it
// back with the 5-arg form.
function makeSprite(
  cssW: number,
  cssH: number,
  draw: (cx: CanvasRenderingContext2D, w: number, h: number) => void,
): Sprite {
  const dpr = currentDpr();
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(cssW * dpr));
  c.height = Math.max(1, Math.ceil(cssH * dpr));
  const cx = c.getContext("2d");
  const hw = cssW / 2;
  const hh = cssH / 2;
  if (!cx) return { canvas: c, hw, hh };
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(cx, cssW, cssH);
  return { canvas: c, hw, hh };
}

// 5-arg drawImage scales physical → CSS so the dpr-scaled main ctx
// renders pixel-1:1. ~3-4× cheaper on WKWebView than the radial
// gradient + arc + fill it replaces.
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
): void {
  ctx.drawImage(
    sprite.canvas,
    x - sprite.hw,
    y - sprite.hh,
    sprite.hw * 2,
    sprite.hh * 2,
  );
}

export function getBlobHaloSprite(kind: ClusterKind, hexSize: number): Sprite {
  const dpr = currentDpr();
  const key = `bh:${kind}:${hexSize}:${dpr}`;
  const cached = SPRITE_CACHE.get(key);
  if (cached) return cached;
  const palette = blobPalette(kind);
  const glowR = hexSize * 1.7;
  // Pad by 2 px so anti-aliased edges of the soft halo don't clip.
  const pad = 2;
  const size = glowR * 2 + pad * 2;
  const sprite = makeSprite(size, size, (cx, w) => {
    const cxs = w / 2;
    const grad = cx.createRadialGradient(cxs, cxs, 0, cxs, cxs, glowR);
    grad.addColorStop(0, palette.haloInner);
    grad.addColorStop(0.5, palette.haloMid);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(cxs, cxs, glowR, 0, Math.PI * 2);
    cx.fill();
  });
  SPRITE_CACHE.set(key, sprite);
  return sprite;
}

export function getBlobCoreSprite(kind: ClusterKind, hexSize: number): Sprite {
  const dpr = currentDpr();
  const key = `bc:${kind}:${hexSize}:${dpr}`;
  const cached = SPRITE_CACHE.get(key);
  if (cached) return cached;
  const palette = blobPalette(kind);
  // The original drawAsBlob oscillates r over [0.78, 0.84] × hexSize with
  // the pulse; we bake the midpoint. 6% range on a ~22px hex is ~1.3 px —
  // visually imperceptible against the 1.5 px rim stroke kept per-frame.
  const r = hexSize * 0.81;
  const pad = 2;
  const size = r * 2 + pad * 2;
  const sprite = makeSprite(size, size, (cx, w) => {
    const cxs = w / 2;
    // Highlight offset: 30% of r toward upper-left, matches the original.
    const grad = cx.createRadialGradient(
      cxs - r * 0.3,
      cxs - r * 0.3,
      0,
      cxs,
      cxs,
      r,
    );
    grad.addColorStop(0, palette.coreLight);
    grad.addColorStop(1, palette.coreDark);
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(cxs, cxs, r, 0, Math.PI * 2);
    cx.fill();
  });
  SPRITE_CACHE.set(key, sprite);
  return sprite;
}

// Effective render radius used for the per-frame rim stroke that still
// runs at runtime (it depends on pulseT and we want to keep that
// micro-animation alive).
export function blobCoreRadius(hexSize: number): number {
  return hexSize * 0.81;
}

export function getCoinHaloSprite(hexSize: number): Sprite {
  const dpr = currentDpr();
  const key = `ch:${hexSize}:${dpr}`;
  const cached = SPRITE_CACHE.get(key);
  if (cached) return cached;
  const glowR = hexSize * 1.55;
  const pad = 2;
  const size = glowR * 2 + pad * 2;
  const sprite = makeSprite(size, size, (cx, w) => {
    const cxs = w / 2;
    const grad = cx.createRadialGradient(cxs, cxs, 0, cxs, cxs, glowR);
    grad.addColorStop(0, "rgba(255, 170, 70, 0.85)");
    grad.addColorStop(0.5, "rgba(220, 130, 30, 0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(cxs, cxs, glowR, 0, Math.PI * 2);
    cx.fill();
  });
  SPRITE_CACHE.set(key, sprite);
  return sprite;
}
