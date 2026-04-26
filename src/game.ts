import { Composite, Engine, Events, type IEventCollision } from "matter-js";
import { FallingCluster, pickShape } from "./cluster";
import { DebrisHex } from "./debris";
import { SQRT3 } from "./hex";
import { bindInput, bindRotatePad, bindSlider, isTouchDevice } from "./input";
import { Player } from "./player";
import type { ClusterKind, GameState, InputAction, Shape } from "./types";

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

const PLAYER_MOVE_SPEED = 5.5; // px/ms (Matter velocity units, keyboard hold)
const PLAYER_ROT_SPEED = 0.05; // rad/ms (keyboard hold)
const RAIL_BOTTOM_INSET = 4; // px above the board bottom where the rail sits

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
  // Touch rotation pad — works like an iPod click wheel: dragging around the
  // ring rotates the player by the angular delta of the drag (relative).
  // We just track the previous touch angle to compute the delta each move.
  private rotationDragActive = false;
  private prevRotateTouchAngle: number | null = null;
  // Touch slider value [-1..1]. Null = inactive (fall back to keyboard).
  private slideTarget: number | null = null;

  // Wave/calm cycle. During waves spawns are faster + more varied; during
  // calm there's a breather. One column is kept clear of new spawns while
  // a wave is active so the player always has a safe lane to dodge into.
  private wavePhase: "calm" | "wave" = "calm";
  private wavePhaseTimer = 0;
  private safeColumn = 0;

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

    this.best = Number(localStorage.getItem("hexfall.highScore") ?? 0) || 0;
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
    // Layout changes that don't fire window-resize (e.g. the touchbar going
    // from display:none to display:flex) still need a buffer recalc, or the
    // canvas pixel buffer will be stretched into the new CSS box and the
    // game will render squashed.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.canvas);
    }

    if (isTouchDevice()) this.touchbar.classList.add("show");
    this.touchbar.setAttribute("aria-hidden", "false");
    // Touchbar visibility just changed the layout; resize once the browser
    // has reflowed.
    requestAnimationFrame(() => this.resize());

    this.unbindInput = bindInput(this.touchbar, (action, pressed) =>
      this.onInput(action, pressed),
    );

    const rotatePadEl = this.touchbar.querySelector<HTMLElement>("#rotatepad");
    const rotateKnobEl = this.touchbar.querySelector<HTMLElement>("#rotateknob");
    const movePadEl = this.touchbar.querySelector<HTMLElement>("#movepad");
    const moveKnobEl = this.touchbar.querySelector<HTMLElement>("#moveknob");

    const extraUnbinds: Array<() => void> = [];

    if (rotatePadEl && rotateKnobEl) {
      extraUnbinds.push(
        bindRotatePad(rotatePadEl, rotateKnobEl, (angle) => {
          if (angle === null) {
            this.rotationDragActive = false;
            this.prevRotateTouchAngle = null;
            return;
          }
          if (!this.rotationDragActive) {
            // First sample of a new drag — anchor at the player's current
            // angle so it doesn't jump.
            this.rotationDragActive = true;
            this.prevRotateTouchAngle = angle;
            this.holds.rotateCw.active = false;
            this.holds.rotateCcw.active = false;
            return;
          }
          // Compute the angular delta between this and the previous touch
          // sample, normalised to (-π, π] so wrapping at the top of the
          // ring doesn't produce a 2π jump.
          const prev = this.prevRotateTouchAngle ?? angle;
          let delta = angle - prev;
          if (delta > Math.PI) delta -= 2 * Math.PI;
          else if (delta < -Math.PI) delta += 2 * Math.PI;
          this.prevRotateTouchAngle = angle;
          this.player.setAngle(this.player.body.angle + delta);
        }),
      );
    }
    if (movePadEl && moveKnobEl) {
      extraUnbinds.push(
        bindSlider(movePadEl, moveKnobEl, (value) => {
          this.slideTarget = value;
          if (value !== null) {
            this.holds.left.active = false;
            this.holds.right.active = false;
          }
        }),
      );
    }
    if (extraUnbinds.length > 0) {
      const baseUnbind = this.unbindInput;
      this.unbindInput = () => {
        baseUnbind?.();
        for (const u of extraUnbinds) u();
      };
    }

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
    this.wavePhase = "calm";
    this.wavePhaseTimer = 0;
    this.rotationDragActive = false;
    this.prevRotateTouchAngle = null;
    this.slideTarget = null;

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
    if (this.slideTarget !== null) {
      // Direct, lag-free position mapping from the slider. Map [-1, 1] to a
      // target x inside the playable horizontal range and teleport.
      const halfBoundsW =
        (this.player.body.bounds.max.x - this.player.body.bounds.min.x) / 2;
      const usableHalfWidth = Math.max(0, this.boardWidth / 2 - halfBoundsW);
      const targetX =
        this.boardOriginX + this.boardWidth / 2 + this.slideTarget * usableHalfWidth;
      this.player.setX(targetX);
    } else {
      const wantLeft = this.holds.left.active;
      const wantRight = this.holds.right.active;
      let vx = 0;
      if (wantLeft && !wantRight) vx = -PLAYER_MOVE_SPEED;
      else if (wantRight && !wantLeft) vx = PLAYER_MOVE_SPEED;
      this.player.setHorizontalVelocity(vx);
    }

    // Click-wheel rotation is applied incrementally inside the touch
    // callback; here we only handle the keyboard hold path.
    if (!this.rotationDragActive) {
      if (this.holds.rotateCw.active && !this.holds.rotateCcw.active) {
        this.player.setAngularVelocity(PLAYER_ROT_SPEED);
      } else if (this.holds.rotateCcw.active && !this.holds.rotateCw.active) {
        this.player.setAngularVelocity(-PLAYER_ROT_SPEED);
      }
    }

    this.player.inDanger = this.player.size() >= DANGER_SIZE;

    // Wave/calm phase progression.
    this.advanceWavePhase(dt);

    // Spawn.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnCluster();
      this.spawnTimer = this.currentSpawnInterval();
    }

    // Step physics.
    Engine.update(this.engine, Math.min(dt * 1000, 1000 / 30));

    // Constrain player to the rail using bounds, so the rotated/grown blob
    // never extends past the board bottom.
    this.player.clampToRail(this.playerY);
    this.player.clampBoundsX(
      this.boardOriginX,
      this.boardOriginX + this.boardWidth,
    );

    this.player.update(dt);

    // Process queued contacts (collected during collisionStart).
    if (this.pendingContacts.length > 0) {
      this.handlePendingContacts();
    }

    // Score on pass + cleanup. Bodies are despawned shortly after they exit
    // the board area; clip masking in render() hides them in the meantime.
    const screenBottom = this.boardOriginY + this.boardHeight + this.hexSize;
    for (const c of this.clusters) {
      if (!c.alive) continue;
      const bounds = c.body.bounds;
      if (!c.scored && !c.contacted && bounds.min.y > this.playerY + this.hexSize * 0.3) {
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

    const colStep = this.pickSpawnColumn(shape);
    if (colStep === null) {
      // No valid spawn this tick (would block the safe lane). Skip.
      return;
    }
    const colWidth = SQRT3 * this.hexSize;
    const x = this.boardOriginX + this.boardWidth / 2 + colStep * colWidth;
    const y = this.boardOriginY - this.hexSize * 4;

    const speed = this.computeFallSpeed();
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

  // ----- Wave / difficulty system -----

  private waveParams() {
    const s = this.score;
    return {
      // Wave grows from short to long with score.
      waveDuration: Math.min(8, 2.2 + s * 0.06),
      // Calm shrinks but never below 2.5s, so player always gets a breather.
      calmDuration: Math.max(2.5, 7 - s * 0.07),
      // Wave spawn cadence: faster than calm, scales with score.
      waveSpawnInterval: Math.max(0.32, 0.55 - s * 0.005),
      // Calm spawn cadence: existing curve.
      calmSpawnInterval: Math.max(
        SPAWN_INTERVAL_MIN,
        SPAWN_INTERVAL_START - s * SPAWN_INTERVAL_RAMP,
      ),
      // Wave fall speed multiplier on top of base.
      waveSpeedMul: Math.min(2.5, 1.5 + s * 0.015),
    };
  }

  private currentSpawnInterval(): number {
    const p = this.waveParams();
    return this.wavePhase === "wave" ? p.waveSpawnInterval : p.calmSpawnInterval;
  }

  private computeFallSpeed(): number {
    const base = Math.min(
      MAX_FALL_SPEED,
      BASE_FALL_SPEED + this.score * SPEED_RAMP,
    );
    if (this.wavePhase === "wave") {
      // Each cluster picks its own speed within ±30% of the wave-multiplier
      // baseline so the wave feels chaotic rather than uniform.
      const variance = 0.7 + Math.random() * 0.6;
      return Math.min(MAX_FALL_SPEED * 1.6, base * this.waveParams().waveSpeedMul * variance);
    }
    return base;
  }

  private advanceWavePhase(dt: number): void {
    this.wavePhaseTimer += dt;
    const p = this.waveParams();
    if (this.wavePhase === "calm" && this.wavePhaseTimer >= p.calmDuration) {
      this.startWave();
    } else if (this.wavePhase === "wave" && this.wavePhaseTimer >= p.waveDuration) {
      this.startCalm();
    }
  }

  private startWave(): void {
    this.wavePhase = "wave";
    this.wavePhaseTimer = 0;
    // Pick a fresh safe column for this wave so the player can always find a
    // lane that won't be blocked.
    const half = Math.floor(BOARD_COLS / 2);
    this.safeColumn = Math.floor(Math.random() * (half * 2 + 1)) - half;
  }

  private startCalm(): void {
    this.wavePhase = "calm";
    this.wavePhaseTimer = 0;
  }

  private shapeColumnFootprint(shape: Shape): { min: number; max: number } {
    let minC = Infinity;
    let maxC = -Infinity;
    for (const c of shape) {
      // Pointy-top: a cell's column index is q + r/2 (rounded).
      const col = Math.round(c.q + c.r / 2);
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
    }
    return { min: minC, max: maxC };
  }

  private pickSpawnColumn(shape: Shape): number | null {
    const half = Math.floor(BOARD_COLS / 2);
    const fp = this.shapeColumnFootprint(shape);
    const all: number[] = [];
    for (let c = -half; c <= half; c++) all.push(c);

    const valid =
      this.wavePhase === "wave"
        ? all.filter((colStep) => {
            const lo = colStep + fp.min;
            const hi = colStep + fp.max;
            return this.safeColumn < lo || this.safeColumn > hi;
          })
        : all;

    if (valid.length === 0) return null;
    return valid[Math.floor(Math.random() * valid.length)]!;
  }

  // ----- end wave system -----

  private endGame(): void {
    this.state = "gameover";
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem("hexfall.highScore", String(this.best));
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
    // playerY is now the rail Y — the line on which the player's lowest
    // pixel sits. Sub a small inset so it doesn't touch the very bottom.
    this.playerY = this.boardOriginY + boardH - RAIL_BOTTOM_INSET;

    // Re-center / re-size the player after layout. setCenter places the CoM
    // at this y; the next clampToRail in the update loop will pull it up so
    // the bounds touch the rail.
    this.player.setHexSize(this.hexSize);
    this.player.setCenter(this.boardOriginX + this.boardWidth / 2, this.playerY - this.hexSize);
  }

  private render(dt: number): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Board background.
    ctx.fillStyle = "#0e1124";
    ctx.fillRect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);

    // Bottom rail line where the player sits.
    ctx.strokeStyle = "rgba(180, 200, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.boardOriginX, this.playerY + 1);
    ctx.lineTo(this.boardOriginX + this.boardWidth, this.playerY + 1);
    ctx.stroke();

    // Clip falling clusters and debris to the board area so nothing renders
    // in the margins after a piece falls past the bottom.
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);
    ctx.clip();

    for (const d of this.debris) d.draw(ctx, this.hexSize);
    for (const c of this.clusters) c.draw(ctx, this.hexSize, dt);

    ctx.restore();

    // Player draws unclipped — it is clamped to the board area, so this is a
    // safety net rather than a true visibility risk.
    this.player.draw(ctx);
  }
}
