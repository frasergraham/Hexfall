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
  // True while the next blue hit would end the run (i.e. the player has
  // already taken a danger hit and the combo hasn't reset yet). Drives the
  // "fatal window" red glow.
  criticalDanger = false;
  // Smoothed 0..1 mirror of criticalDanger so the glow eases in/out instead
  // of snapping when the combo state flips.
  criticalCharge = 0;
  invulnTimer = 0;
  pulse = 0;

  // Orphan listener: fires whenever an automatic connectivity sweep
  // drops cells (e.g. an addCell that landed a sticky in flight onto
  // a slot whose neighbours had since been ripped away by a heal).
  // Game wires this to spawnDebris so the dropped cells fly off.
  private orphanListener: ((orphans: Array<{ cell: Axial; worldX: number; worldY: number }>) => void) | null = null;

  private hexSize: number;
  private engine: Engine;
  private collisionCategory: number;
  private collisionMask: number;

  constructor(opts: PlayerOpts) {
    this.hexSize = opts.hexSize;
    this.engine = opts.engine;
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
    Body.setPosition(this.body, { x, y });
    Body.setVelocity(this.body, { x: 0, y: 0 });
    Body.setAngularVelocity(this.body, 0);
    Body.setAngle(this.body, 0);
  }

  // Keep the player's lowest pixel pinned to the rail (railY). The bounds-
  // based offset means the rotated/grown blob never extends past the rail,
  // and the CoM bobs as the blob rotates so the bottommost hex always
  // touches it.
  clampToRail(railY: number): void {
    const offset = railY - this.body.bounds.max.y;
    if (offset !== 0) {
      Body.setPosition(this.body, {
        x: this.body.position.x,
        y: this.body.position.y + offset,
      });
      Body.setVelocity(this.body, { x: this.body.velocity.x, y: 0 });
    }
  }

  // Keep the full bounds of the body within [minX, maxX].
  clampBoundsX(minX: number, maxX: number): void {
    const overshootLeft = minX - this.body.bounds.min.x;
    const overshootRight = this.body.bounds.max.x - maxX;
    if (overshootLeft > 0) {
      Body.setPosition(this.body, {
        x: this.body.position.x + overshootLeft,
        y: this.body.position.y,
      });
      Body.setVelocity(this.body, {
        x: Math.max(0, this.body.velocity.x),
        y: this.body.velocity.y,
      });
    } else if (overshootRight > 0) {
      Body.setPosition(this.body, {
        x: this.body.position.x - overshootRight,
        y: this.body.position.y,
      });
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

  // Teleport the body's x to the given world x. Used by the touch slider for
  // direct, lag-free position mapping. Velocity is held at zero so the body
  // doesn't drift after the touch lifts.
  setX(x: number): void {
    Body.setPosition(this.body, { x, y: this.body.position.y });
    Body.setVelocity(this.body, { x: 0, y: this.body.velocity.y });
  }

  // Teleport the body angle. Used by the touch rotate pad for direct, lag-
  // free orientation mapping.
  setAngle(angle: number): void {
    Body.setAngle(this.body, angle);
    Body.setAngularVelocity(this.body, 0);
  }

  // Drive the player's rotation toward the given world-frame angle using a
  // capped P controller. Returns the angular velocity that was applied.
  driveToAngle(targetAngle: number, gain: number, maxSpeed: number): number {
    const diff = Math.atan2(
      Math.sin(targetAngle - this.body.angle),
      Math.cos(targetAngle - this.body.angle),
    );
    let vel = diff * gain;
    if (vel > maxSpeed) vel = maxSpeed;
    else if (vel < -maxSpeed) vel = -maxSpeed;
    Body.setAngularVelocity(this.body, vel);
    return vel;
  }

  cellWorldCenter(cell: Axial): { x: number; y: number } {
    const part = this.partsByAxial.get(axialKey(cell));
    if (part) return { x: part.position.x, y: part.position.y };
    return this.projectedCellWorldCenter(cell);
  }

  // World position of a cell that may or may not be in the player's blob
  // yet. Used by the stick-in-flight system to point a spring constraint
  // at the slot a hex is being pulled into before addCell is called.
  projectedCellWorldCenter(cell: Axial): { x: number; y: number } {
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

  findStickCell(
    worldX: number,
    worldY: number,
    reserved?: ReadonlySet<string>,
  ): Axial | null {
    const local = this.worldToLocalAxial(worldX, worldY);
    const occupied = new Set(this.cells.map(axialKey));
    if (reserved) for (const k of reserved) occupied.add(k);
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

  setOrphanListener(cb: ((orphans: Array<{ cell: Axial; worldX: number; worldY: number }>) => void) | null): void {
    this.orphanListener = cb;
  }

  addCell(cell: Axial): void {
    if (this.cells.some((c) => c.q === cell.q && c.r === cell.r)) return;
    this.cells.push(cell);
    this.rebuildBody();
    // Adding a cell can land disconnected if the slot was bridged by
    // cells that got removed while a stick-in-flight was homing — see
    // the heal-during-flight scenario. Auto-sweep so the new cell
    // either stays attached or falls off as debris.
    this.dropOrphans();
  }

  removeCell(cell: Axial): boolean {
    if (this.cells.length <= 1) return false;
    const before = this.cells.length;
    this.cells = this.cells.filter((c) => !(c.q === cell.q && c.r === cell.r));
    if (this.cells.length === before) return false;
    this.rebuildBody();
    // Removing a cell may have left two halves connected only through
    // the removed cell — auto-sweep so callers don't have to remember.
    this.dropOrphans();
    return true;
  }

  // Public alias kept for callers (sticky handler) that want to
  // explicitly trigger a connectivity sweep — e.g. after a batch of
  // removes where each individual removal already auto-swept, this
  // is a no-op but harmless. Returns nothing; orphans flow through
  // the listener.
  pruneDisconnected(): void {
    this.dropOrphans();
  }

  // Find connected components, keep the largest, drop the rest as
  // orphans (capturing their world positions before the rebuild),
  // and fire the orphan listener so the caller can spawn debris.
  // Idempotent: a single-component blob makes this a cheap no-op.
  private dropOrphans(): void {
    if (this.cells.length <= 1) return;

    const cellSet = new Set(this.cells.map((c) => `${c.q},${c.r}`));
    const visited = new Set<string>();
    const components: Axial[][] = [];

    for (const start of this.cells) {
      const sk = `${start.q},${start.r}`;
      if (visited.has(sk)) continue;
      const component: Axial[] = [];
      const stack: Axial[] = [start];
      while (stack.length > 0) {
        const c = stack.pop()!;
        const ck = `${c.q},${c.r}`;
        if (visited.has(ck)) continue;
        visited.add(ck);
        component.push(c);
        for (const n of neighborsOf(c)) {
          const nk = `${n.q},${n.r}`;
          if (cellSet.has(nk) && !visited.has(nk)) stack.push(n);
        }
      }
      components.push(component);
    }

    if (components.length <= 1) return;

    components.sort((a, b) => b.length - a.length);
    const keep = components[0]!;
    const toPrune: Axial[] = [];
    for (let i = 1; i < components.length; i++) toPrune.push(...components[i]!);

    // Capture world positions BEFORE rebuilding (rebuild reseats parts).
    const removed = toPrune.map((c) => {
      const wp = this.cellWorldCenter(c);
      return { cell: c, worldX: wp.x, worldY: wp.y };
    });

    const keepSet = new Set(keep.map((c) => `${c.q},${c.r}`));
    this.cells = this.cells.filter((c) => keepSet.has(`${c.q},${c.r}`));
    this.rebuildBody();
    if (this.orphanListener && removed.length > 0) this.orphanListener(removed);
  }

  // After pruneDisconnected, the blob may still have a "barbell" shape:
  // two clusters joined by a single bridge cell, technically one
  // connected component but with a visible gap. Find any cell whose
  // removal would split the blob into pieces where the smaller side
  // is at most `MAX_DROP_FRAC` of the total. Drop the smaller side
  // (and the bridge cell itself) as orphans; the result flows through
  // the orphan listener (set via setOrphanListener) so callers can
  // spawn outward-flying debris.
  //
  // Iterates until no further drops are possible — a long worm of a
  // shape collapses into its central core through repeated drops.
  pruneNarrowSections(): void {
    const MAX_DROP_FRAC = 0.34; // smaller side ≤ ~1/3 of cells
    const orphans: Array<{ cell: Axial; worldX: number; worldY: number }> = [];
    if (this.cells.length <= 2) return;

    while (this.cells.length > 2) {
      const cellKeys = this.cells.map((c) => `${c.q},${c.r}`);
      const cellSet = new Set(cellKeys);
      let bestBridge: { cellIdx: number; smaller: Axial[] } | null = null;
      let bestSkew = 0;

      for (let i = 0; i < this.cells.length; i++) {
        const candKey = cellKeys[i]!;
        const reduced = new Set(cellSet);
        reduced.delete(candKey);

        // BFS over the cell-set minus the candidate; collect components.
        const visited = new Set<string>();
        const comps: Axial[][] = [];
        for (const startKey of reduced) {
          if (visited.has(startKey)) continue;
          const [q, r] = startKey.split(",").map(Number);
          const stack: Axial[] = [{ q: q!, r: r! }];
          const comp: Axial[] = [];
          while (stack.length > 0) {
            const c = stack.pop()!;
            const ck = `${c.q},${c.r}`;
            if (visited.has(ck)) continue;
            visited.add(ck);
            comp.push(c);
            for (const n of neighborsOf(c)) {
              const nk = `${n.q},${n.r}`;
              if (reduced.has(nk) && !visited.has(nk)) stack.push(n);
            }
          }
          comps.push(comp);
        }

        if (comps.length < 2) continue;
        comps.sort((a, b) => b.length - a.length);
        const largest = comps[0]!.length;
        const smaller = this.cells.length - 1 - largest;
        if (smaller === 0) continue;
        if (smaller / this.cells.length > MAX_DROP_FRAC) continue;
        const skew = largest / smaller;
        if (skew > bestSkew) {
          bestSkew = skew;
          bestBridge = {
            cellIdx: i,
            smaller: comps.slice(1).flatMap((c) => c),
          };
        }
      }

      if (!bestBridge) break;

      // Capture world positions BEFORE rebuild — same trick
      // pruneDisconnected uses.
      const bridge = this.cells[bestBridge.cellIdx]!;
      const toDrop: Axial[] = [bridge, ...bestBridge.smaller];
      for (const c of toDrop) {
        const wp = this.cellWorldCenter(c);
        orphans.push({ cell: c, worldX: wp.x, worldY: wp.y });
      }
      const dropKeys = new Set(toDrop.map((c) => `${c.q},${c.r}`));
      this.cells = this.cells.filter((c) => !dropKeys.has(`${c.q},${c.r}`));
      this.rebuildBody();
    }

    if (this.orphanListener && orphans.length > 0) this.orphanListener(orphans);
  }

  private rebuildBody(): void {
    const oldBody = this.body;
    const angle = oldBody.angle;
    const vel = { ...oldBody.velocity };
    const angVel = oldBody.angularVelocity;

    // Anchor: world position of an existing cell before the rebuild. The
    // new compound body's centroid sits at a different point than the
    // old one (the new cell shifts the COM), so if we just kept
    // body.position the existing cells would all jump by the COM delta —
    // visible as a pop on every addCell. Translate the new body so the
    // anchor cell lands exactly where it was, and Matter's centroid
    // shift becomes invisible.
    const anchorCell = this.cells[0]!;
    const anchorWorld = this.cellWorldCenter(anchorCell);

    const built = buildPlayerBody(
      this.cells,
      this.hexSize,
      0,
      0,
      this.collisionCategory,
      this.collisionMask,
    );
    Body.setAngle(built.body, angle);

    const anchorPart = built.partsByAxial.get(axialKey(anchorCell));
    if (anchorPart) {
      const dx = anchorWorld.x - anchorPart.position.x;
      const dy = anchorWorld.y - anchorPart.position.y;
      Body.setPosition(built.body, {
        x: built.body.position.x + dx,
        y: built.body.position.y + dy,
      });
    }

    Body.setVelocity(built.body, vel);
    Body.setAngularVelocity(built.body, angVel);

    Composite.remove(this.engine.world, oldBody);
    Composite.add(this.engine.world, built.body);
    this.body = built.body;
    this.partsByAxial = built.partsByAxial;
    this.comOffsetLocal = built.comOffsetLocal;
  }

  update(dt: number): void {
    // Slower danger pulse (was 5 rad/s) — the previous beat read as
    // frantic in the critical window; this keeps it noticeable but
    // doesn't drown out the rest of the screen during the fatal frame.
    this.pulse += dt * 3.2;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    // criticalCharge: ramp up fast (snap into the warning) and decay slower
    // (so the player can see the threat clearing rather than blinking off).
    const target = this.criticalDanger ? 1 : 0;
    const rate = this.criticalDanger ? 8 : 3;
    if (this.criticalCharge < target) {
      this.criticalCharge = Math.min(target, this.criticalCharge + dt * rate);
    } else if (this.criticalCharge > target) {
      this.criticalCharge = Math.max(target, this.criticalCharge - dt * rate);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sz = this.hexSize;
    const dangerPulse = (Math.sin(this.pulse) + 1) * 0.5;
    const invulnFlicker =
      this.invulnTimer > 0 ? (Math.sin(this.invulnTimer * 60) + 1) * 0.5 : 0;
    const charge = this.criticalCharge;

    // Iterate the part bodies directly so positions reflect the actual
    // physics-driven world transforms (CoM-based, post-rotation).
    // NOTE: Matter's Body.update rotates each part's position around CoM but
    // does not update part.angle — the parent body.angle is the source of
    // truth for the compound's orientation.
    const bodyAngle = this.body.angle;
    for (let i = 1; i < this.body.parts.length; i++) {
      const part = this.body.parts[i]!;
      ctx.save();
      ctx.translate(part.position.x, part.position.y);
      ctx.rotate(bodyAngle);

      pathHex(ctx, 0, 0, sz);
      // Each subsequent cell (in add order) is tinted slightly darker so
      // the blob reads as a gradient as it grows. cellIdx is the index in
      // this.cells, which is the order cells were added — body.parts is
      // built in the same order, with part 0 being the parent.
      const cellIdx = i - 1;
      const darken = Math.min(0.45, cellIdx * 0.06);
      const grad = ctx.createLinearGradient(0, -sz, 0, sz);
      // While in the fatal window, lerp the green→red along with the
      // pulse so the body reads as "hot". The pulse contribution is
      // intentionally small (~10% of the tint range) so the body
      // colour reads as "danger" without the saturation flickering.
      const tint = charge * (0.8 + dangerPulse * 0.1);
      const top = lerpHex("#9bf0c2", "#ff6b7a", tint);
      const bot = lerpHex("#2ec27a", "#a31c2c", tint);
      grad.addColorStop(0, scaleColor(top, 1 - darken));
      grad.addColorStop(1, scaleColor(bot, 1 - darken));
      ctx.fillStyle = grad;

      if (charge > 0.01) {
        // Tighter shadow band: alpha 0.5..0.65, blur 10..16 px (was
        // 0.45..0.9 / 8..24). The glow stays present but the throb
        // is subtle rather than frantic.
        ctx.shadowColor = `rgba(255, 70, 90, ${(0.5 + 0.15 * dangerPulse) * charge})`;
        ctx.shadowBlur = (10 + 6 * dangerPulse) * charge;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      let strokeAlpha = 1;
      if (this.inDanger || charge > 0.01) {
        // Outline gets a small pulse — bright enough to read as "this
        // body is alarmed" but with a much smaller line-width swing
        // (was 2..5.5px, now 2.5..3.6px at full charge).
        const pulseGain = 0.2 + 0.2 * charge;
        ctx.strokeStyle = `rgba(255, 92, 110, ${0.7 + dangerPulse * pulseGain})`;
        ctx.lineWidth = 2.5 + dangerPulse * (0.4 + 0.7 * charge);
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

// Multiply each RGB channel of a "#rrggbb" colour by `factor`. factor=1
// returns the original; factor<1 darkens toward black while preserving hue.
function scaleColor(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * factor)));
  return `rgb(${r}, ${g}, ${b})`;
}

// Linear interpolate between two "#rrggbb" colours. Returns "#rrggbb" so the
// result can be passed back through scaleColor.
function lerpHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const ar = (na >> 16) & 0xff;
  const ag = (na >> 8) & 0xff;
  const ab = na & 0xff;
  const br = (nb >> 16) & 0xff;
  const bg = (nb >> 8) & 0xff;
  const bb = nb & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  const hex = ((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0");
  return `#${hex}`;
}
