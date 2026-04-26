import { Bodies, Body, type IChamferableBodyDefinition } from "matter-js";
import { axialToPixel, pathHex, SHAPES } from "./hex";
import type { Axial, ClusterKind, Shape } from "./types";

export class FallingCluster {
  body: Body;
  kind: ClusterKind;
  // Map from Matter part body id → axial coord (which logical hex this part is).
  partAxial = new Map<number, Axial>();
  scored = false;
  contacted = false;
  alive = true;
  pulse = Math.random() * Math.PI * 2;

  constructor(body: Body, kind: ClusterKind, partAxial: Map<number, Axial>) {
    this.body = body;
    this.kind = kind;
    this.partAxial = partAxial;
  }

  static spawn(opts: {
    shape: Shape;
    x: number;
    y: number;
    hexSize: number;
    kind: ClusterKind;
    initialSpeedY: number;
    initialSpin: number;
  }): FallingCluster {
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

    return new FallingCluster(body, kind, partAxial);
  }

  // Pixel center of a particular part body (not affected by parent transform —
  // Matter keeps part positions in world space).
  partWorldPositions(): Array<{ partId: number; x: number; y: number; angle: number; axial: Axial }> {
    const out: Array<{ partId: number; x: number; y: number; angle: number; axial: Axial }> = [];
    for (let i = 1; i < this.body.parts.length; i++) {
      const p = this.body.parts[i]!;
      const axial = this.partAxial.get(p.id);
      if (!axial) continue;
      out.push({ partId: p.id, x: p.position.x, y: p.position.y, angle: p.angle, axial });
    }
    return out;
  }

  draw(ctx: CanvasRenderingContext2D, hexSize: number, dt: number): void {
    this.pulse += dt * 4;

    const isSticky = this.kind === "sticky";
    const baseFill = isSticky ? "#d23a8a" : "#5b8bff";
    const accent = isSticky ? "#ff8ad1" : "#aac4ff";
    const stroke = isSticky ? "#ffd6ee" : "#1c2348";
    const pulseT = (Math.sin(this.pulse) + 1) * 0.5;

    for (const p of this.partWorldPositions()) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);

      pathHex(ctx, 0, 0, hexSize - 1);

      const grad = ctx.createLinearGradient(0, -hexSize, 0, hexSize);
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
      }

      ctx.restore();
    }
  }
}

export function pickShape(rng: () => number): Shape {
  const idx = Math.floor(rng() * SHAPES.length);
  return SHAPES[idx]!.map((c) => ({ ...c }));
}
