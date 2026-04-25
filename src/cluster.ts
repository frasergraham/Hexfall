import { axialToPixel, pathHex, rotateShape, SHAPES } from "./hex";
import type { Axial, ClusterKind, Shape } from "./types";

export class FallingCluster {
  // Logical cells, in axial coordinates relative to (0,0). Cells may be
  // removed individually after a partial collision.
  cells: Axial[];
  // Pixel position of the cluster's local origin.
  x: number;
  y: number;
  speed: number; // px/sec, positive = downward
  kind: ClusterKind;
  scored: boolean = false;
  alive: boolean = true;
  // Once a cluster has had any contact with the player, its remaining cells
  // continue falling but cannot stick again.
  contacted: boolean = false;
  // For visual flair on sticky clusters.
  pulse: number = Math.random() * Math.PI * 2;

  constructor(opts: {
    shape: Shape;
    x: number;
    y: number;
    speed: number;
    kind: ClusterKind;
  }) {
    this.cells = opts.shape.map((c) => ({ ...c }));
    this.x = opts.x;
    this.y = opts.y;
    this.speed = opts.speed;
    this.kind = opts.kind;
  }

  update(dt: number): void {
    this.y += this.speed * dt;
    this.pulse += dt * 4;
  }

  // Pixel center of a particular cell.
  cellCenter(cell: Axial, hexSize: number): { x: number; y: number } {
    const local = axialToPixel(cell, hexSize);
    return { x: this.x + local.x, y: this.y + local.y };
  }

  removeCell(cell: Axial): void {
    this.cells = this.cells.filter((c) => !(c.q === cell.q && c.r === cell.r));
    if (this.cells.length === 0) this.alive = false;
  }

  // Returns the pixel y of the lowest point of any cell — used to detect
  // when the cluster has passed the player.
  bottomY(hexSize: number): number {
    let max = -Infinity;
    for (const c of this.cells) {
      const p = this.cellCenter(c, hexSize);
      if (p.y + hexSize > max) max = p.y + hexSize;
    }
    return max;
  }

  draw(ctx: CanvasRenderingContext2D, hexSize: number): void {
    const isSticky = this.kind === "sticky";
    const pulseT = (Math.sin(this.pulse) + 1) * 0.5; // 0..1
    const baseFill = isSticky ? "#d23a8a" : "#5b8bff";
    const accent = isSticky ? "#ff8ad1" : "#aac4ff";
    const stroke = isSticky ? "#ffd6ee" : "#1c2348";

    for (const cell of this.cells) {
      const p = this.cellCenter(cell, hexSize);
      pathHex(ctx, p.x, p.y, hexSize - 1);

      const grad = ctx.createLinearGradient(
        p.x,
        p.y - hexSize,
        p.x,
        p.y + hexSize,
      );
      grad.addColorStop(0, accent);
      grad.addColorStop(1, baseFill);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = isSticky ? 2 + pulseT * 1.5 : 1.5;
      ctx.strokeStyle = isSticky
        ? `rgba(255, 220, 240, ${0.5 + pulseT * 0.5})`
        : stroke;
      ctx.stroke();

      if (isSticky) {
        // Spike/star glyph for color-blind accessibility.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const r = hexSize * 0.42;
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

export function pickShape(rng: () => number): Shape {
  const idx = Math.floor(rng() * SHAPES.length);
  // Random rotation for variety.
  const rot = Math.floor(rng() * 6);
  return rotateShape(SHAPES[idx]!, rot);
}
