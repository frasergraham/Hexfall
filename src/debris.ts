import { Bodies, Body } from "matter-js";
import { pathHex } from "./hex";
import type { ClusterKind } from "./types";

const DEBRIS_LIFETIME = 1.4; // seconds

export class DebrisHex {
  body: Body;
  age = 0;
  lifetime: number;
  kind: ClusterKind;
  scale: number;

  constructor(body: Body, kind: ClusterKind, scale = 1, lifetime = DEBRIS_LIFETIME) {
    this.body = body;
    this.kind = kind;
    this.scale = scale;
    this.lifetime = lifetime;
  }

  static spawn(opts: {
    x: number;
    y: number;
    angle: number;
    velocity: { x: number; y: number };
    angularVelocity: number;
    impulse: { x: number; y: number };
    hexSize: number;
    kind: ClusterKind;
    scale?: number;
    lifetime?: number;
  }): DebrisHex {
    const scale = opts.scale ?? 1;
    const radius = Math.max(2, opts.hexSize * scale);
    const body = Bodies.polygon(opts.x, opts.y, 6, radius, {
      friction: 0.2,
      frictionAir: 0.005,
      restitution: 0.55,
      density: 0.0012,
      label: "debris",
      angle: opts.angle,
      // Debris is purely cosmetic — falls freely, collides with nothing.
      collisionFilter: { category: 0x0008, mask: 0x0000 },
    });
    Body.setVelocity(body, {
      x: opts.velocity.x + opts.impulse.x,
      y: opts.velocity.y + opts.impulse.y,
    });
    Body.setAngularVelocity(body, opts.angularVelocity + (Math.random() - 0.5) * 0.3);
    return new DebrisHex(body, opts.kind, scale, opts.lifetime);
  }

  update(dt: number): boolean {
    this.age += dt;
    return this.age < this.lifetime;
  }

  draw(ctx: CanvasRenderingContext2D, hexSize: number): void {
    const t = this.age / this.lifetime;
    const alpha = Math.max(0, 1 - t);

    const palette = debrisPalette(this.kind);
    const baseFill = palette.fill;
    const accent = palette.accent;
    const stroke = palette.stroke;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.body.position.x, this.body.position.y);
    ctx.rotate(this.body.angle);

    const r = hexSize * this.scale;
    pathHex(ctx, 0, 0, r);
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, baseFill);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
}

function debrisPalette(kind: ClusterKind): { fill: string; accent: string; stroke: string } {
  switch (kind) {
    case "sticky":
      return { fill: "#d23a8a", accent: "#ff8ad1", stroke: "#ffd6ee" };
    case "slow":
      return { fill: "#d3a000", accent: "#ffe46b", stroke: "#fff5b6" };
    case "fast":
      return { fill: "#1ea35e", accent: "#92ffb6", stroke: "#d4ffd6" };
    case "coin":
      return { fill: "#d97a18", accent: "#ffce6b", stroke: "#fff0c9" };
    default:
      return { fill: "#5b8bff", accent: "#aac4ff", stroke: "#1c2348" };
  }
}
