import { Bodies, Body, Composite, type Engine } from "matter-js";
import {
  axialKey,
  axialToPixel,
  neighborsOf,
  pathHex,
  pixelToAxial,
} from "./hex";
import type { Axial } from "./types";

const PLAYER_LABEL = "player";

interface PlayerOpts {
  centerX: number;
  centerY: number;
  hexSize: number;
  engine: Engine;
  collisionCategory: number;
  collisionMask: number;
}

interface BuildResult {
  body: Body;
  partsByAxial: Map<string, Body>;
  comOffsetLocal: { x: number; y: number };
}

// Build a compound body for the player. `centerX/centerY` is the world
// position of the local-axial origin (cell (0,0)). After Body.create the
// resulting parent body's `position` is the centre-of-mass — we capture the
// offset from (0,0) so we can convert between world ↔ local-axial frames.
function buildPlayerBody(
  cells: Axial[],
  hexSize: number,
  centerX: number,
  centerY: number,
  collisionCategory: number,
  collisionMask: number,
): BuildResult {
  const partFilter = { category: collisionCategory, mask: collisionMask };
  const localPositions = cells.map((cell) => axialToPixel(cell, hexSize));

  const parts: Body[] = cells.map((_, i) =>
    Bodies.polygon(centerX + localPositions[i]!.x, centerY + localPositions[i]!.y, 6, hexSize, {
      friction: 0.2,
      frictionAir: 0.0,
      restitution: 0.25,
      density: 0.004,
      collisionFilter: partFilter,
    }),
  );

  const body = Body.create({
    parts,
    label: PLAYER_LABEL,
    frictionAir: 0.06,
  });
  body.collisionFilter.category = collisionCategory;
  body.collisionFilter.mask = collisionMask;

  // Map each axial cell to its corresponding part body. Parent is at parts[0];
  // child parts start at index 1 in the same order we passed them.
  const partsByAxial = new Map<string, Body>();
  for (let i = 0; i < cells.length; i++) {
    partsByAxial.set(axialKey(cells[i]!), body.parts[i + 1]!);
  }

  // CoM in local-axial frame = average of axial pixel positions.
  let cx = 0;
  let cy = 0;
  for (const p of localPositions) {
    cx += p.x;
    cy += p.y;
  }
  const comOffsetLocal = {
    x: cx / Math.max(1, localPositions.length),
    y: cy / Math.max(1, localPositions.length),
  };

  return { body, partsByAxial, comOffsetLocal };
}

export class Player {
  cells: Axial[] = [{ q: 0, r: 0 }];
  body: Body;
  partsByAxial: Map<string, Body>;
  comOffsetLocal: { x: number; y: number };
  inDanger = false;
  invulnTimer = 0;
  pulse = 0;

  private hexSize: number;
  private engine: Engine;
  private playerY: number;
  private collisionCategory: number;
  private collisionMask: number;

  constructor(opts: PlayerOpts) {
    this.hexSize = opts.hexSize;
    this.engine = opts.engine;
    this.playerY = opts.centerY;
    this.collisionCategory = opts.collisionCategory;
    this.collisionMask = opts.collisionMask;
    const built = buildPlayerBody(
      this.cells,
      this.hexSize,
      opts.centerX,
      opts.centerY,
      this.collisionCategory,
      this.collisionMask,
    );
    this.body = built.body;
    this.partsByAxial = built.partsByAxial;
    this.comOffsetLocal = built.comOffsetLocal;
    Composite.add(this.engine.world, this.body);
  }

  size(): number {
    return this.cells.length;
  }

  setHexSize(size: number): void {
    if (size === this.hexSize) return;
    this.hexSize = size;
    this.rebuildBody();
  }

  setCenter(x: number, y: number): void {
    this.playerY = y;
    Body.setPosition(this.body, { x, y });
    Body.setVelocity(this.body, { x: 0, y: 0 });
    Body.setAngularVelocity(this.body, 0);
    Body.setAngle(this.body, 0);
  }

  setPlayerY(y: number): void {
    this.playerY = y;
  }

  clampY(): void {
    if (this.body.position.y !== this.playerY || this.body.velocity.y !== 0) {
      Body.setPosition(this.body, { x: this.body.position.x, y: this.playerY });
      Body.setVelocity(this.body, { x: this.body.velocity.x, y: 0 });
    }
  }

  clampX(minX: number, maxX: number): void {
    if (this.body.position.x < minX) {
      Body.setPosition(this.body, { x: minX, y: this.body.position.y });
      Body.setVelocity(this.body, {
        x: Math.max(0, this.body.velocity.x),
        y: this.body.velocity.y,
      });
    } else if (this.body.position.x > maxX) {
      Body.setPosition(this.body, { x: maxX, y: this.body.position.y });
      Body.setVelocity(this.body, {
        x: Math.min(0, this.body.velocity.x),
        y: this.body.velocity.y,
      });
    }
  }

  setHorizontalVelocity(vx: number): void {
    Body.setVelocity(this.body, { x: vx, y: this.body.velocity.y });
  }

  setAngularVelocity(av: number): void {
    Body.setAngularVelocity(this.body, av);
  }

  cellWorldCenter(cell: Axial): { x: number; y: number } {
    const part = this.partsByAxial.get(axialKey(cell));
    if (part) return { x: part.position.x, y: part.position.y };
    // Fallback (shouldn't be hit): compute from local frame.
    const local = axialToPixel(cell, this.hexSize);
    const dx = local.x - this.comOffsetLocal.x;
    const dy = local.y - this.comOffsetLocal.y;
    const cos = Math.cos(this.body.angle);
    const sin = Math.sin(this.body.angle);
    return {
      x: this.body.position.x + dx * cos - dy * sin,
      y: this.body.position.y + dx * sin + dy * cos,
    };
  }

  // Convert a world point into local-axial coordinates (cell (0,0) at origin).
  worldToLocalAxial(wx: number, wy: number): { x: number; y: number } {
    const dx = wx - this.body.position.x;
    const dy = wy - this.body.position.y;
    const cos = Math.cos(-this.body.angle);
    const sin = Math.sin(-this.body.angle);
    return {
      x: dx * cos - dy * sin + this.comOffsetLocal.x,
      y: dx * sin + dy * cos + this.comOffsetLocal.y,
    };
  }

  findStickCell(worldX: number, worldY: number): Axial | null {
    const local = this.worldToLocalAxial(worldX, worldY);
    const occupied = new Set(this.cells.map(axialKey));
    const candidate = pixelToAxial(local.x, local.y, this.hexSize);

    const candidates: Axial[] = [];
    const isAdjacentToBlob = (cell: Axial) =>
      neighborsOf(cell).some((n) => occupied.has(axialKey(n)));

    if (!occupied.has(axialKey(candidate)) && isAdjacentToBlob(candidate)) {
      candidates.push(candidate);
    }
    for (const c of this.cells) {
      for (const n of neighborsOf(c)) {
        if (!occupied.has(axialKey(n))) candidates.push(n);
      }
    }

    let bestCell: Axial | null = null;
    let bestDist = Infinity;
    for (const cell of candidates) {
      const cp = axialToPixel(cell, this.hexSize);
      const d = Math.hypot(cp.x - local.x, cp.y - local.y);
      if (d < bestDist) {
        bestDist = d;
        bestCell = cell;
      }
    }
    return bestCell;
  }

  findNearestCell(worldX: number, worldY: number): Axial | null {
    if (this.cells.length === 0) return null;
    let bestCell: Axial | null = null;
    let bestDist = Infinity;
    for (const c of this.cells) {
      const wp = this.cellWorldCenter(c);
      const d = Math.hypot(wp.x - worldX, wp.y - worldY);
      if (d < bestDist) {
        bestDist = d;
        bestCell = c;
      }
    }
    return bestCell;
  }

  addCell(cell: Axial): void {
    if (this.cells.some((c) => c.q === cell.q && c.r === cell.r)) return;
    this.cells.push(cell);
    this.rebuildBody();
  }

  removeCell(cell: Axial): boolean {
    if (this.cells.length <= 1) return false;
    const before = this.cells.length;
    this.cells = this.cells.filter((c) => !(c.q === cell.q && c.r === cell.r));
    if (this.cells.length === before) return false;
    this.rebuildBody();
    return true;
  }

  private rebuildBody(): void {
    const oldBody = this.body;
    const pos = { ...oldBody.position };
    const angle = oldBody.angle;
    const vel = { ...oldBody.velocity };
    const angVel = oldBody.angularVelocity;

    const built = buildPlayerBody(
      this.cells,
      this.hexSize,
      pos.x,
      pos.y,
      this.collisionCategory,
      this.collisionMask,
    );
    Body.setAngle(built.body, angle);
    Body.setVelocity(built.body, vel);
    Body.setAngularVelocity(built.body, angVel);

    Composite.remove(this.engine.world, oldBody);
    Composite.add(this.engine.world, built.body);
    this.body = built.body;
    this.partsByAxial = built.partsByAxial;
    this.comOffsetLocal = built.comOffsetLocal;
  }

  update(dt: number): void {
    this.pulse += dt * 5;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sz = this.hexSize;
    const dangerPulse = (Math.sin(this.pulse) + 1) * 0.5;
    const invulnFlicker =
      this.invulnTimer > 0 ? (Math.sin(this.invulnTimer * 60) + 1) * 0.5 : 0;

    // Iterate the part bodies directly so positions reflect the actual
    // physics-driven world transforms (CoM-based, post-rotation).
    for (let i = 1; i < this.body.parts.length; i++) {
      const part = this.body.parts[i]!;
      ctx.save();
      ctx.translate(part.position.x, part.position.y);
      ctx.rotate(part.angle);

      pathHex(ctx, 0, 0, sz);
      const grad = ctx.createLinearGradient(0, -sz, 0, sz);
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

      ctx.restore();
    }
  }
}
