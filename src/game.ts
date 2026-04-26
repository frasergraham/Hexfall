import { Composite, Engine, Events, type IEventCollision } from "matter-js";
import { FallingCluster, pickShape } from "./cluster";
import { DebrisHex } from "./debris";
import { SQRT3 } from "./hex";
import { bindInput, isTouchDevice } from "./input";
import { Player } from "./player";
import type { ClusterKind, GameState, InputAction } from "./types";

const HEX_SIZE_BASE = 22;
const BOARD_COLS = 9;
const BOARD_ROWS = 16;

const BASE_FALL_SPEED = 1.6; // initial downward velocity for spawned clusters (px/ms)
const SPEED_RAMP = 0.04; // px/ms per score
const MAX_FALL_SPEED = 5.5;

const SPAWN_INTERVAL_START = 1.6; // seconds
const SPAWN_INTERVAL_MIN = 0.7;
const SPAWN_INTERVAL_RAMP = 0.03;

const DANGER_SIZE = 7;
const LOSE_COMBO = 2;
const STICK_INVULN_MS = 180;

const STICKY_SPAWN_CHANCE = 0.12;
const STICKY_MIN_SCORE = 3;

const PLAYER_MOVE_SPEED = 5.5; // px/ms (Matter velocity units)
const PLAYER_ROT_SPEED = 0.05; // rad/ms

// Collision categories.
const CAT_PLAYER = 0x0002;
const CAT_CLUSTER = 0x0004;

interface HoldState {
  active: boolean;
}

interface ContactInfo {
  point: { x: number; y: number };
  partId: number;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private touchbar: HTMLElement;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;

  private state: GameState = "menu";
  private score = 0;
  private best = 0;
  private comboHits = 0;
  private spawnTimer = 0;

  private engine: Engine;
  private clusters: FallingCluster[] = [];
  private debris: DebrisHex[] = [];
  private clusterByBodyId = new Map<number, FallingCluster>();
  private pendingContacts: Array<{ cluster: FallingCluster; contact: ContactInfo }> = [];
  private player!: Player;

  private hexSize = HEX_SIZE_BASE;
  private boardWidth = 0;
  private boardHeight = 0;
  private boardOriginX = 0;
  private boardOriginY = 0;
  private playerY = 0;

  private lastTime = 0;
  private rafId = 0;
  private unbindInput: (() => void) | null = null;

  private holds: Record<"left" | "right" | "rotateCw" | "rotateCcw", HoldState> = {
    left: { active: false },
    right: { active: false },
    rotateCw: { active: false },
    rotateCcw: { active: false },
  };

  constructor(opts: {
    canvas: HTMLCanvasElement;
    overlay: HTMLElement;
    touchbar: HTMLElement;
    scoreEl: HTMLElement;
    bestEl: HTMLElement;
  }) {
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.overlay = opts.overlay;
    this.touchbar = opts.touchbar;
    this.scoreEl = opts.scoreEl;
    this.bestEl = opts.bestEl;

    this.best = Number(localStorage.getItem("hexrain.highScore") ?? 0) || 0;
    this.bestEl.textContent = String(this.best);

    this.engine = Engine.create({
      gravity: { x: 0, y: 1, scale: 0.0012 },
    });

    this.player = new Player({
      centerX: 0,
      centerY: 0,
      hexSize: this.hexSize,
      engine: this.engine,
      collisionCategory: CAT_PLAYER,
      collisionMask: CAT_CLUSTER,
    });

    Events.on(this.engine, "collisionStart", (e) => this.onCollisionStart(e));

    this.resize();
    window.addEventListener("resize", () => this.resize());

    if (isTouchDevice()) this.touchbar.classList.add("show");
    this.touchbar.setAttribute("aria-hidden", "false");

    this.unbindInput = bindInput(this.touchbar, (action, pressed) =>
      this.onInput(action, pressed),
    );

    this.overlay.addEventListener("click", () => {
      if (this.state === "paused") {
        this.state = "playing";
        this.overlay.classList.add("hidden");
      } else {
        this.startOrRestart();
      }
    });

    this.renderMenu();
  }

  start(): void {
    this.lastTime = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastTime) / 1000);
      this.lastTime = t;
      this.update(dt);
      this.render(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.unbindInput?.();
  }

  private startOrRestart(): void {
    // Tear down all existing physics bodies.
    for (const c of this.clusters) Composite.remove(this.engine.world, c.body);
    for (const d of this.debris) Composite.remove(this.engine.world, d.body);
    Composite.remove(this.engine.world, this.player.body);

    this.clusters = [];
    this.debris = [];
    this.clusterByBodyId.clear();
    this.pendingContacts = [];

    this.score = 0;
    this.comboHits = 0;
    this.spawnTimer = 0;

    this.player = new Player({
      centerX: this.boardOriginX + this.boardWidth / 2,
      centerY: this.playerY,
      hexSize: this.hexSize,
      engine: this.engine,
      collisionCategory: CAT_PLAYER,
      collisionMask: CAT_CLUSTER,
    });

    this.state = "playing";
    this.overlay.classList.add("hidden");
    this.scoreEl.textContent = "0";
  }

  private renderMenu(): void {
    this.overlay.classList.remove("hidden");
  }

  private renderGameOver(): void {
    this.overlay.innerHTML = `
      <h1>GAME OVER</h1>
      <p class="tagline">Score ${this.score} &middot; Best ${this.best}</p>
      <p class="hint">Press <kbd>Space</kbd> or tap to play again</p>
    `;
    this.overlay.classList.remove("hidden");
  }

  private onInput(action: InputAction, pressed: boolean): void {
    if (action === "confirm" && pressed) {
      if (this.state === "menu" || this.state === "gameover") {
        this.startOrRestart();
        return;
      }
    }
    if (action === "pause" && pressed && this.state === "playing") {
      this.state = "paused";
      this.overlay.innerHTML = `
        <h1>PAUSED</h1>
        <p class="hint">Press <kbd>P</kbd> or tap to resume</p>
      `;
      this.overlay.classList.remove("hidden");
      return;
    }
    if (action === "pause" && pressed && this.state === "paused") {
      this.state = "playing";
      this.overlay.classList.add("hidden");
      return;
    }
    if (this.state !== "playing") return;

    switch (action) {
      case "left":
        this.holds.left.active = pressed;
        break;
      case "right":
        this.holds.right.active = pressed;
        break;
      case "rotateCw":
        this.holds.rotateCw.active = pressed;
        break;
      case "rotateCcw":
        this.holds.rotateCcw.active = pressed;
        break;
    }
  }

  private update(dt: number): void {
    if (this.state !== "playing") {
      return;
    }

    // Player input → physics velocities.
    const wantLeft = this.holds.left.active;
    const wantRight = this.holds.right.active;
    let vx = 0;
    if (wantLeft && !wantRight) vx = -PLAYER_MOVE_SPEED;
    else if (wantRight && !wantLeft) vx = PLAYER_MOVE_SPEED;
    this.player.setHorizontalVelocity(vx);

    if (this.holds.rotateCw.active && !this.holds.rotateCcw.active) {
      this.player.setAngularVelocity(PLAYER_ROT_SPEED);
    } else if (this.holds.rotateCcw.active && !this.holds.rotateCw.active) {
      this.player.setAngularVelocity(-PLAYER_ROT_SPEED);
    }

    this.player.inDanger = this.player.size() >= DANGER_SIZE;

    // Spawn.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnCluster();
      const interval = Math.max(
        SPAWN_INTERVAL_MIN,
        SPAWN_INTERVAL_START - this.score * SPAWN_INTERVAL_RAMP,
      );
      this.spawnTimer = interval;
    }

    // Step physics.
    Engine.update(this.engine, Math.min(dt * 1000, 1000 / 30));

    // Constrain player y to the rail.
    this.player.clampY();
    const margin = this.hexSize * (this.player.size() === 1 ? 1 : 2);
    this.player.clampX(
      this.boardOriginX + margin,
      this.boardOriginX + this.boardWidth - margin,
    );

    this.player.update(dt);

    // Process queued contacts (collected during collisionStart).
    if (this.pendingContacts.length > 0) {
      this.handlePendingContacts();
    }

    // Score on pass + cleanup.
    const screenBottom = this.boardOriginY + this.boardHeight + this.hexSize * 4;
    for (const c of this.clusters) {
      if (!c.alive) continue;
      const bounds = c.body.bounds;
      if (!c.scored && !c.contacted && bounds.min.y > this.playerY + this.hexSize * 1.2) {
        c.scored = true;
        this.score += 1;
        this.comboHits = 0;
        this.scoreEl.textContent = String(this.score);
      }
      if (bounds.min.y > screenBottom) {
        c.alive = false;
      }
    }

    // Update debris.
    this.debris = this.debris.filter((d) => {
      const alive = d.update(dt);
      if (!alive || d.body.position.y > screenBottom) {
        Composite.remove(this.engine.world, d.body);
        return false;
      }
      return true;
    });

    // Cleanup dead clusters.
    this.clusters = this.clusters.filter((c) => {
      if (c.alive) return true;
      Composite.remove(this.engine.world, c.body);
      this.clusterByBodyId.delete(c.body.id);
      return false;
    });
  }

  private onCollisionStart(event: IEventCollision<Engine>): void {
    if (this.state !== "playing") return;
    if (this.player.invulnTimer > 0) return;

    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const parentA = a.parent ?? a;
      const parentB = b.parent ?? b;
      const aIsPlayer = parentA.label === "player";
      const bIsPlayer = parentB.label === "player";
      const aIsCluster = parentA.label === "cluster";
      const bIsCluster = parentB.label === "cluster";

      let clusterPart;
      let clusterParentId;
      if (aIsPlayer && bIsCluster) {
        clusterPart = b;
        clusterParentId = parentB.id;
      } else if (bIsPlayer && aIsCluster) {
        clusterPart = a;
        clusterParentId = parentA.id;
      } else continue;

      const cluster = this.clusterByBodyId.get(clusterParentId);
      if (!cluster || cluster.contacted || !cluster.alive) continue;

      // Use the contact support point if available; else midpoint.
      const support = pair.collision.supports[0];
      const point = support
        ? { x: support.x, y: support.y }
        : { x: clusterPart.position.x, y: clusterPart.position.y };

      cluster.contacted = true; // mark immediately to dedupe within frame
      this.pendingContacts.push({ cluster, contact: { point, partId: clusterPart.id } });
    }
  }

  private handlePendingContacts(): void {
    for (const { cluster, contact } of this.pendingContacts) {
      if (!cluster.alive) continue;

      this.player.invulnTimer = STICK_INVULN_MS / 1000;

      if (cluster.kind === "normal") {
        this.handleNormalContact(cluster, contact);
      } else {
        this.handleStickyContact(cluster, contact);
      }
    }
    this.pendingContacts = [];
  }

  private handleNormalContact(cluster: FallingCluster, contact: ContactInfo): void {
    const allParts = cluster.partWorldPositions();

    const cell = this.player.findStickCell(contact.point.x, contact.point.y);
    if (cell) this.player.addCell(cell);

    // Spawn debris for the OTHER cluster parts (not the one that stuck).
    for (const p of allParts) {
      if (p.partId === contact.partId) continue;
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 2 - 1,
        },
        kind: cluster.kind,
      });
    }

    cluster.alive = false;

    this.comboHits += 1;
    if (this.player.size() >= DANGER_SIZE && this.comboHits >= LOSE_COMBO) {
      this.endGame();
    }
  }

  private spawnDebris(opts: {
    x: number;
    y: number;
    angle: number;
    velocity: { x: number; y: number };
    angularVelocity: number;
    impulse: { x: number; y: number };
    kind: ClusterKind;
  }): void {
    const d = DebrisHex.spawn({ ...opts, hexSize: this.hexSize });
    this.debris.push(d);
    Composite.add(this.engine.world, d.body);
  }

  private handleStickyContact(cluster: FallingCluster, contact: ContactInfo): void {
    const allParts = cluster.partWorldPositions();

    if (this.player.size() > 1) {
      const targetCell = this.player.findNearestCell(contact.point.x, contact.point.y);
      if (targetCell) {
        const wp = this.player.cellWorldCenter(targetCell);
        this.spawnDebris({
          x: wp.x,
          y: wp.y,
          angle: this.player.body.angle,
          velocity: this.player.body.velocity,
          angularVelocity: this.player.body.angularVelocity,
          impulse: { x: (Math.random() - 0.5) * 4, y: -2 - Math.random() * 2 },
          kind: "normal",
        });
        this.player.removeCell(targetCell);
      }
    }

    // The sticky cluster itself shatters into debris.
    for (const p of allParts) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 5,
          y: (Math.random() - 0.5) * 3,
        },
        kind: cluster.kind,
      });
    }

    cluster.alive = false;
    this.comboHits = 0;
  }

  private spawnCluster(): void {
    const shape = pickShape(Math.random);

    let kind: ClusterKind = "normal";
    if (this.score >= STICKY_MIN_SCORE && Math.random() < STICKY_SPAWN_CHANCE) {
      kind = "sticky";
    }

    const half = Math.floor(BOARD_COLS / 2);
    const colStep = Math.floor(Math.random() * (half * 2 + 1)) - half;
    const colWidth = SQRT3 * this.hexSize;
    const x = this.boardOriginX + this.boardWidth / 2 + colStep * colWidth;
    const y = this.boardOriginY - this.hexSize * 4;

    const speed = Math.min(
      MAX_FALL_SPEED,
      BASE_FALL_SPEED + this.score * SPEED_RAMP,
    );
    const spin = (Math.random() - 0.5) * 0.08;

    const cluster = FallingCluster.spawn({
      shape,
      x,
      y,
      hexSize: this.hexSize,
      kind,
      initialSpeedY: speed,
      initialSpin: spin,
    });

    // Apply collision filter.
    cluster.body.collisionFilter.category = CAT_CLUSTER;
    cluster.body.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER;
    for (let i = 1; i < cluster.body.parts.length; i++) {
      cluster.body.parts[i]!.collisionFilter.category = CAT_CLUSTER;
      cluster.body.parts[i]!.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER;
    }

    this.clusters.push(cluster);
    this.clusterByBodyId.set(cluster.body.id, cluster);
    Composite.add(this.engine.world, cluster.body);
  }

  private endGame(): void {
    this.state = "gameover";
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem("hexrain.highScore", String(this.best));
      this.bestEl.textContent = String(this.best);
    }
    this.renderGameOver();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colWidthFor = (size: number) => SQRT3 * size;
    const targetSizeByWidth = (cssW - 16) / (colWidthFor(1) * BOARD_COLS);
    const targetSizeByHeight = (cssH - 16) / (1.5 * BOARD_ROWS + 1);
    this.hexSize = Math.max(
      10,
      Math.min(targetSizeByWidth, targetSizeByHeight, 32),
    );

    const boardW = colWidthFor(this.hexSize) * BOARD_COLS;
    const boardH = 1.5 * this.hexSize * BOARD_ROWS + this.hexSize * 0.5;
    this.boardWidth = boardW;
    this.boardHeight = boardH;
    this.boardOriginX = (cssW - boardW) / 2;
    this.boardOriginY = (cssH - boardH) / 2;
    this.playerY = this.boardOriginY + boardH - this.hexSize * 1.5;

    // Re-center / re-size the player after layout.
    this.player.setHexSize(this.hexSize);
    this.player.setCenter(this.boardOriginX + this.boardWidth / 2, this.playerY);
    this.player.setPlayerY(this.playerY);
  }

  private render(dt: number): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Board background.
    ctx.fillStyle = "#0e1124";
    ctx.fillRect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);

    // Bottom rail line where the player sits.
    ctx.strokeStyle = "rgba(180, 200, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.boardOriginX, this.playerY + this.hexSize * 1.1);
    ctx.lineTo(this.boardOriginX + this.boardWidth, this.playerY + this.hexSize * 1.1);
    ctx.stroke();

    // Debris underneath clusters/player so they fade into the background.
    for (const d of this.debris) d.draw(ctx, this.hexSize);
    for (const c of this.clusters) c.draw(ctx, this.hexSize, dt);
    this.player.draw(ctx);
  }
}
