import { Bodies, Body, Common, type IChamferableBodyDefinition } from "matter-js";
import {
  blobCoreRadius,
  drawSprite,
  getBlobCoreSprite,
  getBlobHaloSprite,
  getCoinHaloSprite,
  type Sprite,
} from "./clusterSprites";
import { axialToPixel, pathHex, SHAPES } from "./hex";
import type { Axial, ClusterKind, Shape } from "./types";

type PartPos = { partId: number; x: number; y: number; angle: number; axial: Axial };

export type SpawnOpts = {
  shape: Shape;
  x: number;
  y: number;
  hexSize: number;
  kind: ClusterKind;
  initialSpeedY: number;
  initialSpin: number;
};

export class FallingCluster {
  body: Body;
  kind: ClusterKind;
  // The shape this body was originally built from. Cached so the pool
  // can key buckets by polyhex signature without inspecting the body's
  // parts array each release.
  readonly shape: Shape;
  readonly hexSize: number;
  // Map from Matter part body id → axial coord (which logical hex this part is).
  partAxial = new Map<number, Axial>();
  scored = false;
  contacted = false;
  alive = true;
  pulse = Math.random() * Math.PI * 2;
  // First-appearance hint label drawn big and glowing above the cluster
  // while it falls. Set by Game when this is the first cluster of its kind
  // ever played on this device.
  hintLabel: string | null = null;
  // Constant fall velocity (px/step). Set on challenge spawns so the
  // engine re-applies it each frame, overriding gravity. This is the
  // mechanism that makes `speed=` in the wave DSL actually mean what
  // it says — without it, gravity drives every cluster to ~20 px/step
  // terminal velocity within half a second and the speed parameter
  // becomes a barely-perceptible nudge to the first few frames.
  // Endless mode leaves this null so gravity behaves normally.
  targetVy: number | null = null;

  constructor(
    body: Body,
    kind: ClusterKind,
    partAxial: Map<number, Axial>,
    shape: Shape,
    hexSize: number,
  ) {
    this.body = body;
    this.kind = kind;
    this.partAxial = partAxial;
    this.shape = shape;
    this.hexSize = hexSize;
  }

  static spawn(opts: SpawnOpts): FallingCluster {
    const { shape, x, y, hexSize, kind, initialSpeedY, initialSpin } = opts;

    const partAxial = new Map<number, Axial>();
    const parts: Body[] = [];

    const partOpts: IChamferableBodyDefinition = {
      friction: 0.2,
      frictionAir: 0.001,
      restitution: 0.35,
      density: 0.0015,
    };

    for (const cell of shape) {
      const local = axialToPixel(cell, hexSize);
      // Pointy-top hex polygon: Matter's Bodies.polygon with 6 sides has the
      // first vertex at angle 0 (right), giving a pointy-top hex naturally.
      const part = Bodies.polygon(
        x + local.x,
        y + local.y,
        6,
        hexSize,
        partOpts,
      );
      parts.push(part);
    }

    const body = Body.create({
      parts,
      label: "cluster",
    });

    // After Body.create with parts, the parent body's parts[0] is the parent
    // itself; parts[1..] are the original parts. Map part id → axial cell.
    for (let i = 1; i < body.parts.length; i++) {
      partAxial.set(body.parts[i]!.id, shape[i - 1]!);
    }

    Body.setVelocity(body, { x: 0, y: initialSpeedY });
    Body.setAngularVelocity(body, initialSpin);

    return new FallingCluster(body, kind, partAxial, shape, hexSize);
  }

  // Reuse this cluster for a new spawn. Called by ClusterPool.acquire
  // after popping from a bucket. The body's vertices / axes / mass
  // properties are already correct (the shape is identical); we only
  // need to reset transient state — position, velocity, angle, kind,
  // and the lifecycle flags the contact handlers / cleanup pass read.
  //
  // We also re-id the parent and each part. Matter's pair table is
  // keyed by `body.id`; if we reused the same ids across spawns,
  // Matter would resurrect the previous incarnation's stale pair on
  // first re-collision and skip the `collisionStart` event — the
  // contact handlers would silently miss the hit. Fresh ids force a
  // brand-new pair, which restores the start-event semantics the rest
  // of the game depends on. partAxial is re-mapped onto the new part
  // ids in the same pass.
  //
  // Body.setPosition on a compound parent translates all parts by the
  // delta so the relative axial offsets survive. Body.setAngle rotates
  // them around the parent CoM back to identity.
  reset(opts: SpawnOpts): void {
    this.body.id = Common.nextId();
    this.partAxial.clear();
    const parts = this.body.parts;
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i]!;
      p.id = Common.nextId();
      this.partAxial.set(p.id, this.shape[i - 1]!);
    }
    // Scrub the transient physics scratch state that Matter carries on
    // the body so a pooled reuse starts from the same baseline a fresh
    // Bodies.polygon would. positionImpulse / constraintImpulse get
    // populated during constraint resolution and stay non-zero between
    // steps; deltaTime ratchets down under CCD substeps; force/torque
    // are zeroed by Engine.update but only for bodies currently in the
    // world, so a body removed mid-step can leak a residual. The
    // motion/speed/angularSpeed/totalContacts/sleepCounter fields are
    // private to Matter's runtime but read by collision + sleep paths;
    // the cast lets us reach them without modifying matter-js types.
    const b = this.body;
    const bAny = b as unknown as {
      deltaTime: number;
      positionImpulse: { x: number; y: number };
      constraintImpulse: { x: number; y: number; angle: number };
      force: { x: number; y: number };
      torque: number;
      totalContacts: number;
      sleepCounter: number;
      isSleeping: boolean;
      motion: number;
      speed: number;
      angularSpeed: number;
    };
    bAny.deltaTime = 1000 / 60;
    bAny.positionImpulse.x = 0;
    bAny.positionImpulse.y = 0;
    bAny.constraintImpulse.x = 0;
    bAny.constraintImpulse.y = 0;
    bAny.constraintImpulse.angle = 0;
    bAny.force.x = 0;
    bAny.force.y = 0;
    bAny.torque = 0;
    bAny.totalContacts = 0;
    bAny.sleepCounter = 0;
    bAny.isSleeping = false;
    bAny.motion = 0;
    bAny.speed = 0;
    bAny.angularSpeed = 0;
    Body.setPosition(b, { x: opts.x, y: opts.y });
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: opts.initialSpeedY });
    Body.setAngularVelocity(b, opts.initialSpin);
    this.kind = opts.kind;
    this.scored = false;
    this.contacted = false;
    this.alive = true;
    this.pulse = Math.random() * Math.PI * 2;
    this.hintLabel = null;
    this.targetVy = null;
    this.posBuf.length = 0;
  }

  // Per-instance reusable buffer for partWorldPositions(). At late-game
  // cluster counts the previous per-call allocation (slice+map → fresh
  // array of fresh objects every call, 2-6× per cluster per frame) was
  // a primary GC pressure source. We refill in place and return the
  // same buffer; callers must not retain the reference across another
  // partWorldPositions() call on the same cluster.
  private posBuf: PartPos[] = [];

  // Pixel center of a particular part body (not affected by parent transform —
  // Matter keeps part positions in world space).
  partWorldPositions(): PartPos[] {
    // Matter's Body.update rotates each part's position around the parent CoM
    // but does not refresh part.angle — the parent body's angle is the source
    // of truth for orientation, shared rigidly across all parts.
    const angle = this.body.angle;
    const parts = this.body.parts;
    const buf = this.posBuf;
    let n = 0;
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i]!;
      const axial = this.partAxial.get(p.id);
      if (!axial) continue;
      let slot = buf[n];
      if (slot === undefined) {
        slot = { partId: p.id, x: 0, y: 0, angle: 0, axial };
        buf.push(slot);
      } else {
        slot.partId = p.id;
        slot.axial = axial;
      }
      slot.x = p.position.x;
      slot.y = p.position.y;
      slot.angle = angle;
      n++;
    }
    buf.length = n;
    return buf;
  }

  // Helpful kinds — sticky removes a hex, slow drops time to 0.5x, fast
  // bumps to 1.5x. They render as glowy blobs (not hexes) so the player can
  // tell at a glance "this one is for me". The body shape is still hex for
  // collision, only the visual changes.
  isHelpful(): boolean {
    return (
      this.kind === "sticky" ||
      this.kind === "slow" ||
      this.kind === "fast" ||
      this.kind === "shield" ||
      this.kind === "drone" ||
      this.kind === "tiny" ||
      this.kind === "big"
    );
  }

  draw(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    dt: number,
    timeEffect: "slow" | "fast" | null,
  ): void {
    this.pulse += dt * 4;

    // Compute positions ONCE for the frame; sub-methods iterate the same
    // buffer instead of calling partWorldPositions() 2-6× per cluster.
    const positions = this.partWorldPositions();

    if (this.kind === "coin") {
      this.drawAsCoin(ctx, hexSize, positions);
    } else if (this.isHelpful()) {
      this.drawAsBlob(ctx, hexSize, positions);
    } else {
      this.drawAsHex(ctx, hexSize, positions);
    }

    // Time-effect visual trail behind the cluster as it falls. Drawn last so
    // it sits on top, with screen-blend for a glowing look.
    if (timeEffect === "slow") {
      this.drawSlowBubbles(ctx, hexSize, positions);
    } else if (timeEffect === "fast") {
      this.drawSpeedLines(ctx, hexSize, positions);
    }
  }

  private drawAsCoin(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    positions: readonly PartPos[],
  ): void {
    const r = hexSize * 0.7;
    const halo: Sprite = getCoinHaloSprite(hexSize);

    // Outer glow halo, additive blend — prebaked sprite so we skip the
    // per-frame createRadialGradient + arc/fill that dominated the
    // "lighter" composite block on WKWebView.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of positions) drawSprite(ctx, halo, p.x, p.y);
    ctx.restore();

    // Coin face: an ellipse whose horizontal radius oscillates with the
    // pulse so the coin appears to spin in 3D. Kept per-frame — the
    // spin scaling (visibleSx ∈ [0.18, 1.0]) is too aggressive to bake.
    for (const p of positions) {
      const sx = Math.abs(Math.cos(this.pulse * 1.4));
      const visibleSx = Math.max(0.18, sx);
      const grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r);
      grad.addColorStop(0, "#fff1c2");
      grad.addColorStop(0.45, "#ffb255");
      grad.addColorStop(1, "#a14e08");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * visibleSx, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 240, 200, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Star detail on the face, scaled with the spin so it tilts in/out.
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(visibleSx, 1);
      ctx.strokeStyle = "rgba(120, 50, 0, 0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const dr = r * 0.42;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI;
        ctx.moveTo(-Math.cos(a) * dr, -Math.sin(a) * dr);
        ctx.lineTo(Math.cos(a) * dr, Math.sin(a) * dr);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawAsHex(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    positions: readonly PartPos[],
  ): void {
    for (const p of positions) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);

      pathHex(ctx, 0, 0, hexSize);

      const grad = ctx.createLinearGradient(0, -hexSize, 0, hexSize);
      grad.addColorStop(0, "#aac4ff");
      grad.addColorStop(1, "#5b8bff");
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#1c2348";
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawAsBlob(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    positions: readonly PartPos[],
  ): void {
    const pulseT = (Math.sin(this.pulse) + 1) * 0.5;
    const halo = getBlobHaloSprite(this.kind, hexSize);
    const core = getBlobCoreSprite(this.kind, hexSize);
    const r = blobCoreRadius(hexSize);

    // Outer halo, additive blend — sprite drawImage replaces the
    // per-part radial gradient + arc/fill that flushed GPU state on
    // every "lighter" composite block.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of positions) drawSprite(ctx, halo, p.x, p.y);
    ctx.restore();

    // Solid core on top of halos. Sprite carries the fill + highlight;
    // the rim stroke keeps a per-frame pulse-driven alpha for the
    // shimmer micro-animation (the only thing we couldn't bake).
    const rimAlpha = 0.45 + pulseT * 0.4;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(255, 255, 255, ${rimAlpha})`;
    for (const p of positions) {
      drawSprite(ctx, core, p.x, p.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawSlowBubbles(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    positions: readonly PartPos[],
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of positions) {
      for (let i = 0; i < 4; i++) {
        // Phase per (cluster pulse + bubble index) so each bubble runs its
        // own little life cycle.
        const t = ((this.pulse * 0.18 + i * 0.27) % 1 + 1) % 1;
        const drift = Math.sin(this.pulse + i * 1.7) * hexSize * 0.4;
        const bx = p.x + drift;
        const by = p.y - hexSize * 0.4 - t * hexSize * 2.2;
        const radius = hexSize * (0.08 + 0.18 * (1 - t));
        const alpha = (1 - t) * 0.45;
        ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSpeedLines(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    positions: readonly PartPos[],
  ): void {
    ctx.save();
    ctx.strokeStyle = "rgba(180, 255, 200, 0.55)";
    ctx.lineCap = "round";
    for (const p of positions) {
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * hexSize * 0.4 + Math.sin(this.pulse * 2 + i) * hexSize * 0.12;
        const baseLen = hexSize * 1.2;
        const wobble = Math.sin(this.pulse * 4 + i * 1.3) * 0.4;
        const len = baseLen * (1 + wobble);
        ctx.lineWidth = 1.5 + Math.abs(wobble);
        ctx.beginPath();
        ctx.moveTo(p.x + ox, p.y - hexSize * 0.5);
        ctx.lineTo(p.x + ox, p.y - hexSize * 0.5 - len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// Palettes moved to src/palettes.ts in Phase 1.3 — re-exported here
// so existing call sites keep working without churn. (FallingCluster's
// own draw path now consumes palettes indirectly via clusterSprites.ts.)
export { blobPalette, hintPalette, type BlobPalette, type HintPalette } from "./palettes";

export function kindLabel(kind: ClusterKind): string {
  switch (kind) {
    case "normal":
      return "AVOID";
    case "sticky":
      return "HEAL";
    case "slow":
      return "SLOW";
    case "fast":
      return "FAST";
    case "coin":
      return "COLLECT";
    case "shield":
      return "SHIELD";
    case "drone":
      return "DRONE";
    case "tiny":
      return "TINY";
    case "big":
      return "BIG";
  }
}

// A single hex used for coin clusters (and for swarm spawns). Coins are
// always one cell so they look and behave like a discrete pickup.
export const COIN_SHAPE: Shape = [{ q: 0, r: 0 }];

export function pickShape(rng: () => number): Shape {
  const idx = Math.floor(rng() * SHAPES.length);
  return SHAPES[idx]!.map((c) => ({ ...c }));
}
