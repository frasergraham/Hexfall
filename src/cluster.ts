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
  // First-appearance hint label drawn above the cluster while it falls.
  // Set by Game when this is the first cluster of its kind in the run.
  hintLabel: string | null = null;

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
    // Matter's Body.update rotates each part's position around the parent CoM
    // but does not refresh part.angle — the parent body's angle is the source
    // of truth for orientation, shared rigidly across all parts.
    const angle = this.body.angle;
    const out: Array<{ partId: number; x: number; y: number; angle: number; axial: Axial }> = [];
    for (let i = 1; i < this.body.parts.length; i++) {
      const p = this.body.parts[i]!;
      const axial = this.partAxial.get(p.id);
      if (!axial) continue;
      out.push({ partId: p.id, x: p.position.x, y: p.position.y, angle, axial });
    }
    return out;
  }

  // Helpful kinds — sticky removes a hex, slow drops time to 0.5x, fast
  // bumps to 1.5x. They render as glowy blobs (not hexes) so the player can
  // tell at a glance "this one is for me". The body shape is still hex for
  // collision, only the visual changes.
  isHelpful(): boolean {
    return this.kind === "sticky" || this.kind === "slow" || this.kind === "fast";
  }

  draw(
    ctx: CanvasRenderingContext2D,
    hexSize: number,
    dt: number,
    timeEffect: "slow" | "fast" | null,
  ): void {
    this.pulse += dt * 4;

    if (this.kind === "coin") {
      this.drawAsCoin(ctx, hexSize);
    } else if (this.isHelpful()) {
      this.drawAsBlob(ctx, hexSize);
    } else {
      this.drawAsHex(ctx, hexSize);
    }

    // Time-effect visual trail behind the cluster as it falls. Drawn last so
    // it sits on top, with screen-blend for a glowing look.
    if (timeEffect === "slow") {
      this.drawSlowBubbles(ctx, hexSize);
    } else if (timeEffect === "fast") {
      this.drawSpeedLines(ctx, hexSize);
    }

    if (this.hintLabel) this.drawHintLabel(ctx, hexSize);
  }

  private drawAsCoin(ctx: CanvasRenderingContext2D, hexSize: number): void {
    const r = hexSize * 0.7;
    const glowR = hexSize * 1.55;

    // Outer glow halo, additive blend.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.partWorldPositions()) {
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      halo.addColorStop(0, "rgba(255, 170, 70, 0.85)");
      halo.addColorStop(0.5, "rgba(220, 130, 30, 0.45)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Coin face: an ellipse whose horizontal radius oscillates with the
    // pulse so the coin appears to spin in 3D.
    for (const p of this.partWorldPositions()) {
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

  private drawHintLabel(ctx: CanvasRenderingContext2D, hexSize: number): void {
    if (!this.hintLabel) return;
    const cx = (this.body.bounds.min.x + this.body.bounds.max.x) / 2;
    const yTop = this.body.bounds.min.y - hexSize * 0.6;
    const palette = hintPalette(this.kind);

    ctx.save();
    ctx.font = `700 ${Math.round(hexSize * 0.85)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = "0.18em";
    // Glow.
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = palette.fill;
    ctx.fillText(this.hintLabel, cx, yTop);
    // Re-stroke without shadow for a crisp outline.
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.stroke;
    ctx.strokeText(this.hintLabel, cx, yTop);
    ctx.restore();
  }

  private drawAsHex(ctx: CanvasRenderingContext2D, hexSize: number): void {
    for (const p of this.partWorldPositions()) {
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

  private drawAsBlob(ctx: CanvasRenderingContext2D, hexSize: number): void {
    const palette = blobPalette(this.kind);
    const pulseT = (Math.sin(this.pulse) + 1) * 0.5;
    const r = hexSize * (0.78 + pulseT * 0.06);
    const glowR = hexSize * 1.7;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.partWorldPositions()) {
      // Outer halo.
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      halo.addColorStop(0, palette.haloInner);
      halo.addColorStop(0.5, palette.haloMid);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Solid core on top of halos.
    ctx.save();
    for (const p of this.partWorldPositions()) {
      const core = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r);
      core.addColorStop(0, palette.coreLight);
      core.addColorStop(1, palette.coreDark);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + pulseT * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSlowBubbles(ctx: CanvasRenderingContext2D, hexSize: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.partWorldPositions()) {
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

  private drawSpeedLines(ctx: CanvasRenderingContext2D, hexSize: number): void {
    ctx.save();
    ctx.strokeStyle = "rgba(180, 255, 200, 0.55)";
    ctx.lineCap = "round";
    for (const p of this.partWorldPositions()) {
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

interface BlobPalette {
  haloInner: string;
  haloMid: string;
  coreLight: string;
  coreDark: string;
}

function blobPalette(kind: ClusterKind): BlobPalette {
  switch (kind) {
    case "sticky":
      return {
        haloInner: "rgba(255, 138, 209, 0.85)",
        haloMid: "rgba(210, 58, 138, 0.45)",
        coreLight: "#ffd0ee",
        coreDark: "#a01e6a",
      };
    case "slow":
      return {
        haloInner: "rgba(255, 232, 110, 0.85)",
        haloMid: "rgba(220, 180, 40, 0.45)",
        coreLight: "#fff5b6",
        coreDark: "#a07a08",
      };
    case "fast":
      return {
        haloInner: "rgba(150, 255, 175, 0.85)",
        haloMid: "rgba(40, 200, 90, 0.45)",
        coreLight: "#c8ffd5",
        coreDark: "#0a7a3c",
      };
    default:
      return {
        haloInner: "rgba(170, 196, 255, 0.7)",
        haloMid: "rgba(91, 139, 255, 0.4)",
        coreLight: "#aac4ff",
        coreDark: "#1f3074",
      };
  }
}

interface HintPalette {
  fill: string;
  stroke: string;
  glow: string;
}

function hintPalette(kind: ClusterKind): HintPalette {
  switch (kind) {
    case "normal":
      return { fill: "#dfe8ff", stroke: "rgba(20, 30, 70, 0.85)", glow: "rgba(120, 160, 255, 0.95)" };
    case "sticky":
      return { fill: "#ffe0f2", stroke: "rgba(80, 16, 50, 0.85)", glow: "rgba(255, 110, 190, 0.95)" };
    case "slow":
      return { fill: "#fff6c2", stroke: "rgba(80, 60, 0, 0.85)", glow: "rgba(255, 220, 110, 0.95)" };
    case "fast":
      return { fill: "#d4ffd6", stroke: "rgba(0, 60, 20, 0.85)", glow: "rgba(120, 255, 170, 0.95)" };
    case "coin":
      return { fill: "#ffeac2", stroke: "rgba(70, 35, 0, 0.85)", glow: "rgba(255, 175, 70, 0.95)" };
  }
}

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
  }
}

// A single hex used for coin clusters (and for swarm spawns). Coins are
// always one cell so they look and behave like a discrete pickup.
export const COIN_SHAPE: Shape = [{ q: 0, r: 0 }];

export function pickShape(rng: () => number): Shape {
  const idx = Math.floor(rng() * SHAPES.length);
  return SHAPES[idx]!.map((c) => ({ ...c }));
}
