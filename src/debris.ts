import { Bodies, Body } from "matter-js";
import { pathHex } from "./hex";
import type { ClusterKind } from "./types";

const DEBRIS_LIFETIME = 1.4; // seconds

export class DebrisHex {
  body: Body;
  age = 0;
  lifetime: number;
  kind: ClusterKind;

  constructor(body: Body, kind: ClusterKind, lifetime = DEBRIS_LIFETIME) {
    this.body = body;
    this.kind = kind;
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
  }): DebrisHex {
    const body = Bodies.polygon(opts.x, opts.y, 6, opts.hexSize, {
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
    return new DebrisHex(body, opts.kind);
  }

  update(dt: number): boolean {
    this.age += dt;
    return this.age < this.lifetime;
  }

  draw(ctx: CanvasRenderingContext2D, hexSize: number): void {
    const t = this.age / this.lifetime;
    const alpha = Math.max(0, 1 - t);

    const isSticky = this.kind === "sticky";
    const baseFill = isSticky ? "#d23a8a" : "#5b8bff";
    const accent = isSticky ? "#ff8ad1" : "#aac4ff";
    const stroke = isSticky ? "#ffd6ee" : "#1c2348";

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.body.position.x, this.body.position.y);
    ctx.rotate(this.body.angle);

    pathHex(ctx, 0, 0, hexSize - 1);
    const grad = ctx.createLinearGradient(0, -hexSize, 0, hexSize);
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
