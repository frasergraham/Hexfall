import {
  axialKey,
  axialToPixel,
  neighborsOf,
  pathHex,
  rotateCcw as rotateAxialCcw,
  rotateCw as rotateAxialCw,
  SQRT3,
} from "./hex";
import type { Axial } from "./types";

export class Player {
  // Cells in the blob, axial coords relative to player origin.
  cells: Axial[] = [{ q: 0, r: 0 }];
  // Logical x of column 0 (center of the play area).
  baseX: number;
  // Pixel position of the player origin (logical hex center for (0,0)).
  x: number;
  y: number;
  // Discrete column step (signed integer). targetX = baseX + columnStep * colWidth.
  columnStep: number = 0;
  // Smoothed render rotation (radians); approaches `targetRotation`.
  renderRotation: number = 0;
  targetRotation: number = 0;
  // Whether blob outline should pulse danger.
  inDanger: boolean = false;
  // Brief invulnerability after a hit, in seconds.
  invulnTimer: number = 0;
  // Time-based pulse counter (purely visual).
  pulse: number = 0;

  private hexSize: number;

  constructor(opts: { baseX: number; y: number; hexSize: number }) {
    this.baseX = opts.baseX;
    this.x = opts.baseX;
    this.y = opts.y;
    this.hexSize = opts.hexSize;
  }

  setHexSize(size: number): void {
    this.hexSize = size;
  }

  setBaseX(baseX: number): void {
    this.baseX = baseX;
  }

  setY(y: number): void {
    this.y = y;
  }

  size(): number {
    return this.cells.length;
  }

  hasCell(c: Axial): boolean {
    return this.cells.some((x) => x.q === c.q && x.r === c.r);
  }

  targetX(): number {
    return this.baseX + this.columnStep * SQRT3 * this.hexSize;
  }

  // Try to move by ±N columns within bounds (inclusive on both ends).
  tryMove(delta: number, minStep: number, maxStep: number): void {
    this.columnStep = Math.max(
      minStep,
      Math.min(maxStep, this.columnStep + delta),
    );
  }

  rotate(dir: 1 | -1): void {
    this.cells = this.cells.map((c) => (dir === 1 ? rotateAxialCw(c) : rotateAxialCcw(c)));
    this.targetRotation += dir * (Math.PI / 3);
  }

  // Update smoothing, timers.
  update(dt: number): void {
    this.pulse += dt * 5;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    // Lerp position and rotation.
    const posLerp = 1 - Math.exp(-dt * 14);
    this.x += (this.targetX() - this.x) * posLerp;
    const rotLerp = 1 - Math.exp(-dt * 16);
    this.renderRotation += (this.targetRotation - this.renderRotation) * rotLerp;
  }

  // Returns rendered (post-rotation) world center of a logical cell.
  cellWorldCenter(cell: Axial): { x: number; y: number } {
    // Cell is in post-axial-rotation space; we additionally apply a small
    // visual rotation tween.
    const local = axialToPixel(cell, this.hexSize);
    const cos = Math.cos(this.renderRotation - this.snappedRotation());
    const sin = Math.sin(this.renderRotation - this.snappedRotation());
    return {
      x: this.x + local.x * cos - local.y * sin,
      y: this.y + local.x * sin + local.y * cos,
    };
  }

  // The "snapped" rotation — multiples of 60° — that the axial cells already
  // reflect. The renderRotation tweens past this; rendering uses the delta.
  snappedRotation(): number {
    return Math.round(this.targetRotation / (Math.PI / 3)) * (Math.PI / 3);
  }

  // For collision: world centers of all cells.
  cellCenters(): Array<{ cell: Axial; x: number; y: number }> {
    return this.cells.map((cell) => ({ cell, ...this.cellWorldCenter(cell) }));
  }

  // Add a hex at the appropriate axial cell, given the world position where
  // it touched. We pick the unoccupied neighbor of any current cell whose
  // rendered world center is closest to the touch point.
  addHexAt(worldX: number, worldY: number): boolean {
    const occupied = new Set(this.cells.map(axialKey));
    let best: { cell: Axial; dist: number } | null = null;
    for (const c of this.cells) {
      for (const n of neighborsOf(c)) {
        if (occupied.has(axialKey(n))) continue;
        const wp = this.cellWorldCenter(n);
        const d = Math.hypot(wp.x - worldX, wp.y - worldY);
        if (!best || d < best.dist) best = { cell: n, dist: d };
      }
    }
    if (!best) return false;
    this.cells.push(best.cell);
    return true;
  }

  // Remove the cell whose world center is closest to (worldX, worldY).
  removeNearestCell(worldX: number, worldY: number): Axial | null {
    if (this.cells.length <= 1) return null;
    let best: { cell: Axial; dist: number } | null = null;
    for (const c of this.cells) {
      const wp = this.cellWorldCenter(c);
      const d = Math.hypot(wp.x - worldX, wp.y - worldY);
      if (!best || d < best.dist) best = { cell: c, dist: d };
    }
    if (!best) return null;
    this.cells = this.cells.filter(
      (c) => !(c.q === best!.cell.q && c.r === best!.cell.r),
    );
    return best.cell;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sz = this.hexSize;
    const dangerPulse = (Math.sin(this.pulse) + 1) * 0.5;
    const invulnFlicker =
      this.invulnTimer > 0 ? (Math.sin(this.invulnTimer * 60) + 1) * 0.5 : 0;

    for (const c of this.cells) {
      const { x, y } = this.cellWorldCenter(c);

      pathHex(ctx, x, y, sz - 1);
      const grad = ctx.createLinearGradient(x, y - sz, x, y + sz);
      grad.addColorStop(0, "#9bf0c2");
      grad.addColorStop(1, "#2ec27a");
      ctx.fillStyle = grad;
      ctx.fill();

      let strokeAlpha = 1;
      if (this.inDanger) {
        ctx.strokeStyle = `rgba(255, 92, 110, ${0.6 + dangerPulse * 0.4})`;
        ctx.lineWidth = 2 + dangerPulse * 1.5;
      } else {
        ctx.strokeStyle = "#1c4a30";
        ctx.lineWidth = 1.5;
      }
      if (invulnFlicker > 0.5) strokeAlpha = 0.4;
      ctx.globalAlpha = strokeAlpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
