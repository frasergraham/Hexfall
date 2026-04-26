import { Body, Composite, Engine, Events, type IEventCollision } from "matter-js";
import { COIN_SHAPE, FallingCluster, hintPalette, kindLabel, pickShape } from "./cluster";
import { DebrisHex } from "./debris";
import { SQRT3 } from "./hex";
import { bindInput, bindRotatePad, bindSlider, isTouchDevice } from "./input";
import { Player } from "./player";
import type { ClusterKind, GameState, InputAction, Shape } from "./types";

const HEX_SIZE_BASE = 22;
const BOARD_COLS = 9;

const BASE_FALL_SPEED = 1.6; // initial downward velocity for spawned clusters (px/ms)
const SPEED_RAMP = 0.04; // px/ms per score
const MAX_FALL_SPEED = 5.5;

const SPAWN_INTERVAL_START = 1.6; // seconds
const SPAWN_INTERVAL_MIN = 0.7;
const SPAWN_INTERVAL_RAMP = 0.03;

const DANGER_SIZE = 7;
const LOSE_COMBO = 2;
const STICK_INVULN_MS = 180;

const STICKY_SPAWN_CHANCE = 0.10;
const STICKY_MIN_SCORE = 3;
const SLOW_SPAWN_CHANCE = 0.05;
const FAST_SPAWN_CHANCE = 0.05;
const COIN_SPAWN_CHANCE = 0.07;
const COIN_SCORE_BONUS = 5;
const POWERUP_MIN_SCORE = 5;

// Time-effect tuning.
const SLOW_EFFECT_DURATION = 10;
const FAST_EFFECT_DURATION = 5;
const STICK_SLOW_BUFFER = 2; // brief slow-mo after gaining a hex
const SLOW_TIMESCALE = 0.5;
const FAST_TIMESCALE = 1.25;

// Wave variants.
const SWARM_WAVE_CHANCE = 0.35; // chance any given wave is a single-hex swarm
const SWARM_SPAWN_INTERVAL = 0.18; // very short interval during swarms

// Score thresholds for advanced spawn mechanics.
const ANGLED_SPAWNS_SCORE = 200;
const SIDE_SPAWNS_SCORE = 400;
const NARROWING_SCORE = 600;

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

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

const PARALLAX_BACK = 8; // px max horizontal shift of the back plane
const PARALLAX_FRONT = 22; // px max horizontal shift of the front plane
const STAR_SCROLL_BACK = 6; // px/sec downward drift of the back plane
const STAR_SCROLL_FRONT = 18; // px/sec downward drift of the front plane

const HINT_TIMESCALE = 0.5; // game runs at this rate while a hint cluster is on screen

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

  // Cluster kinds the player has seen this *page session*. The first
  // cluster of a never-seen kind gets a big glowing label that follows
  // it down. In-memory only — restarts (after game-over) don't show the
  // labels again, but a full page reload starts fresh.
  private seenKinds: Set<ClusterKind> = new Set();

  // Wave/calm cycle. During waves spawns are faster + more varied; during
  // calm there's a breather. One column is kept clear of new spawns while
  // a wave is active so the player always has a safe lane to dodge into.
  private wavePhase: "calm" | "wave" = "calm";
  private wavePhaseTimer = 0;
  private safeColumn = 0;
  // Whether the current wave is a single-hex swarm (lots of small fast hexes
  // at varied speeds) rather than a regular cluster wave.
  private swarmWave = false;

  // Time-effect (slow/fast power-ups). timeScale modifies engine + game-logic
  // dt; the visual trail uses timeEffect to decide bubble vs speed-line.
  private timeEffect: "slow" | "fast" | null = null;
  private timeEffectTimer = 0;
  private timeEffectMax = 1;
  private timeScale = 1;

  // Optional inward-narrowing pinch active in late game (score >= NARROWING_SCORE).
  // 0 = full board, 1 = fully pinched. Animates on/off.
  private pinch = 0;
  private pinchTarget = 0;

  // Two-plane starfield. Generated on resize, drawn behind everything with
  // a small horizontal parallax based on the player's x position and a
  // slow downward scroll that gives a sense of moving forward.
  private starsBack: Star[] = [];
  private starsFront: Star[] = [];
  private starScrollY = 0;

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
    this.swarmWave = false;
    this.timeEffect = null;
    this.timeEffectTimer = 0;
    this.timeEffectMax = 1;
    this.timeScale = 1;
    // Note: seenKinds is *not* cleared — hints only show on the very first
    // play of the game on this device, never on restarts.
    this.pinch = 0;
    this.pinchTarget = 0;
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
    // Movement holds are accepted in menu too so the player can try the
    // controls before starting a run. Paused / gameover ignore them.
    if (this.state !== "playing" && this.state !== "menu") return;

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
    if (this.state === "paused") return;

    // Starfield drifts downward in real time during menu, play and gameover.
    this.starScrollY += dt;

    if (this.state === "menu") {
      // Pre-game test drive: accept input + step physics so the player can
      // try out the controls. No spawning, no scoring, no wave system.
      this.applyMovementInput();
      Engine.update(this.engine, Math.min(dt * 1000, 1000 / 30));
      this.player.clampToRail(this.playerY);
      this.player.clampBoundsX(this.currentRailLeft(), this.currentRailRight());
      this.player.update(dt);
      return;
    }

    if (this.state === "gameover") {
      // After death, keep stepping physics + clusters + debris so the
      // wreckage scatters and the falling pieces continue behind the
      // overlay. No input, no spawning, no lose-check.
      Engine.update(this.engine, Math.min(dt * 1000, 1000 / 30));
      this.cleanupOffscreenBodies();
      return;
    }

    // Real-time effect timer (counts down in wall-clock seconds, regardless
    // of timescale) so the slow / fast power-up always lasts 10 real seconds.
    if (this.timeEffect !== null) {
      this.timeEffectTimer -= dt;
      if (this.timeEffectTimer <= 0) {
        this.timeEffect = null;
        this.timeScale = 1;
      }
    }

    // Pinch interpolates toward target each real-frame.
    const pinchLerp = 1 - Math.exp(-dt * 4);
    this.pinch += (this.pinchTarget - this.pinch) * pinchLerp;

    // While a hint cluster is on screen, force a 0.5x slow so the player
    // can read the label and absorb what to do. This stacks on top of the
    // power-up timeScale by taking the lower (slower) of the two.
    const hintActive = this.clusters.some((c) => c.hintLabel && c.alive);
    const effectiveScale = hintActive
      ? Math.min(this.timeScale, HINT_TIMESCALE)
      : this.timeScale;

    // gameDt drives physics + spawn + wave so slow-mo really slows everything.
    const gameDt = dt * effectiveScale;

    // Player input → physics velocities (input applied in real time so the
    // controls always feel responsive even during slow-mo).
    this.applyMovementInput();

    this.player.inDanger = this.player.size() >= DANGER_SIZE;

    // Wave/calm phase progression — uses gameDt so wave length feels right
    // during slow-mo, but spawn cadence is the same dilation.
    this.advanceWavePhase(gameDt);

    // Spawn.
    this.spawnTimer -= gameDt;
    if (this.spawnTimer <= 0) {
      this.spawnCluster();
      this.spawnTimer = this.currentSpawnInterval();
    }

    // Step physics with scaled time.
    Engine.update(this.engine, Math.min(gameDt * 1000, 1000 / 30));

    // Constrain player to the rail using bounds, so the rotated/grown blob
    // never extends past the board bottom — and to the (possibly pinched)
    // side rails.
    this.player.clampToRail(this.playerY);
    this.player.clampBoundsX(this.currentRailLeft(), this.currentRailRight());

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

  // Big block-cap hint label drawn above each cluster that carries one.
  // Rendered outside the board clip so it can hover above the play area
  // when a cluster is near the top of the board.
  private drawClusterHints(): void {
    const ctx = this.ctx;
    const fontSize = Math.max(36, Math.round(this.hexSize * 2.2));
    let drewAny = false;

    for (const c of this.clusters) {
      if (!c.hintLabel || !c.alive) continue;
      if (!drewAny) {
        ctx.save();
        ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        drewAny = true;
      }
      const palette = hintPalette(c.kind);
      // Hover above the cluster, clamped both horizontally and vertically
      // so the word never spills off the canvas. The textAlign is
      // "center", so the constraint on cx is "half the text width away
      // from each edge, plus a small margin".
      const margin = 6;
      const halfTextW = ctx.measureText(c.hintLabel).width / 2;
      const cxIdeal = (c.body.bounds.min.x + c.body.bounds.max.x) / 2;
      const cxMin = this.boardOriginX + halfTextW + margin;
      const cxMax = this.boardOriginX + this.boardWidth - halfTextW - margin;
      const cx = cxMin <= cxMax ? Math.max(cxMin, Math.min(cxMax, cxIdeal)) : cxIdeal;

      const yIdeal = c.body.bounds.min.y - this.hexSize * 1.0;
      const yMin = this.boardOriginY + fontSize * 0.9;
      const yMax = this.boardOriginY + this.boardHeight - margin;
      const y = Math.max(yMin, Math.min(yMax, yIdeal));

      ctx.shadowColor = palette.glow;
      ctx.shadowBlur = 26;
      ctx.fillStyle = palette.fill;
      ctx.fillText(c.hintLabel, cx, y);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = palette.stroke;
      ctx.strokeText(c.hintLabel, cx, y);
    }

    if (drewAny) ctx.restore();
  }

  // Apply touch / keyboard movement + rotation hold to the player. Touch
  // rotation drag itself is applied inside the rotate-pad input callback,
  // not here.
  private applyMovementInput(): void {
    if (this.slideTarget !== null) {
      const halfBoundsW =
        (this.player.body.bounds.max.x - this.player.body.bounds.min.x) / 2;
      const railLeft = this.currentRailLeft();
      const railRight = this.currentRailRight();
      const railCenter = (railLeft + railRight) / 2;
      const usableHalfWidth = Math.max(0, (railRight - railLeft) / 2 - halfBoundsW);
      const targetX = railCenter + this.slideTarget * usableHalfWidth;
      this.player.setX(targetX);
    } else {
      const wantLeft = this.holds.left.active;
      const wantRight = this.holds.right.active;
      let vx = 0;
      if (wantLeft && !wantRight) vx = -PLAYER_MOVE_SPEED;
      else if (wantRight && !wantLeft) vx = PLAYER_MOVE_SPEED;
      this.player.setHorizontalVelocity(vx);
    }
    if (!this.rotationDragActive) {
      if (this.holds.rotateCw.active && !this.holds.rotateCcw.active) {
        this.player.setAngularVelocity(PLAYER_ROT_SPEED);
      } else if (this.holds.rotateCcw.active && !this.holds.rotateCw.active) {
        this.player.setAngularVelocity(-PLAYER_ROT_SPEED);
      }
    }
  }

  // Trim off-screen clusters and debris during the gameover dwell so the
  // physics world doesn't accumulate dead bodies while the overlay is up.
  private cleanupOffscreenBodies(): void {
    const screenBottom = this.boardOriginY + this.boardHeight + this.hexSize;
    for (const c of this.clusters) {
      if (c.body.bounds.min.y > screenBottom) c.alive = false;
    }
    this.clusters = this.clusters.filter((c) => {
      if (c.alive) return true;
      Composite.remove(this.engine.world, c.body);
      this.clusterByBodyId.delete(c.body.id);
      return false;
    });
    this.debris = this.debris.filter((d) => {
      const alive = d.update(0);
      if (!alive || d.body.position.y > screenBottom) {
        Composite.remove(this.engine.world, d.body);
        return false;
      }
      return true;
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
      } else if (cluster.kind === "sticky") {
        this.handleStickyContact(cluster, contact);
      } else if (cluster.kind === "coin") {
        this.handleCoinContact(cluster);
      } else {
        // slow / fast power-up: activate the time effect, scatter the blob
        // into debris, and clear combo (helpful pickup).
        this.handlePowerupContact(cluster);
      }
    }
    this.pendingContacts = [];
  }

  private handleNormalContact(cluster: FallingCluster, contact: ContactInfo): void {
    const allParts = cluster.partWorldPositions();

    // Snapshot pre-hit size so the lose check only counts hits taken while
    // already in the danger zone. Otherwise a fast 5→6→7 combo would end
    // the run before the danger glow ever appears.
    const wasInDanger = this.player.size() >= DANGER_SIZE;

    const cell = this.player.findStickCell(contact.point.x, contact.point.y);
    if (cell) {
      this.player.addCell(cell);
      // Brief slow-mo buffer so the player can recover their bearings after
      // a hit. Stacks with an existing slow effect by extending the timer
      // rather than truncating; overrides a fast effect (slow > fast for
      // recovery).
      if (this.timeEffect === "slow") {
        this.timeEffectTimer = Math.max(this.timeEffectTimer, STICK_SLOW_BUFFER);
      } else {
        this.timeEffect = "slow";
        this.timeScale = SLOW_TIMESCALE;
        this.timeEffectTimer = STICK_SLOW_BUFFER;
        this.timeEffectMax = STICK_SLOW_BUFFER;
      }
    }

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

    // Only hits taken *while already in danger* count toward the lose
    // combo, so the player is guaranteed at least one frame of warning
    // glow before a fatal sequence.
    if (wasInDanger) {
      this.comboHits += 1;
      if (this.comboHits >= LOSE_COMBO) {
        this.endGame();
      }
    } else {
      this.comboHits = 0;
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
    // A sticky cluster of N hexes rips off N-1 hexes from the player
    // (floor of 1, capped at player size - 1 so we always leave at least
    // one cell). The cells removed are the N-1 closest to the contact
    // point, ordered by distance.
    if (this.player.size() > 1) {
      const stickyCellCount = allParts.length;
      const removalsRequested = Math.max(1, stickyCellCount - 1);
      const removalsAllowed = Math.min(removalsRequested, this.player.size() - 1);

      // Capture world positions FIRST — once removeCell rebuilds the body,
      // any cell we haven't pulled a position for yet will report a stale
      // location.
      const cellsByDist = this.player.cells
        .map((cell) => {
          const wp = this.player.cellWorldCenter(cell);
          const d = Math.hypot(wp.x - contact.point.x, wp.y - contact.point.y);
          return { cell, dist: d, wp };
        })
        .sort((a, b) => a.dist - b.dist);

      const toRemove = cellsByDist.slice(0, removalsAllowed);

      for (const item of toRemove) {
        this.spawnDebris({
          x: item.wp.x,
          y: item.wp.y,
          angle: this.player.body.angle,
          velocity: this.player.body.velocity,
          angularVelocity: this.player.body.angularVelocity,
          impulse: {
            x: (Math.random() - 0.5) * 4,
            y: -2 - Math.random() * 2,
          },
          kind: "normal",
        });
      }
      for (const item of toRemove) this.player.removeCell(item.cell);

      // After all targeted removals, the remaining blob may have split.
      // Keep the largest component and scatter the rest as outward debris.
      const orphans = this.player.pruneDisconnected();
      for (const o of orphans) {
        this.spawnDebris({
          x: o.worldX,
          y: o.worldY,
          angle: this.player.body.angle,
          velocity: this.player.body.velocity,
          angularVelocity: this.player.body.angularVelocity,
          impulse: {
            x:
              Math.sign(o.worldX - this.player.body.position.x) *
                (1.5 + Math.random() * 1.5) +
              (Math.random() - 0.5),
            y: -1 - Math.random() * 2,
          },
          kind: "normal",
        });
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

  private handleCoinContact(cluster: FallingCluster): void {
    // Coin pickup: +5 score, coin sparkles into debris, no other side
    // effects. Doesn't trigger the slow-mo buffer or affect the combo.
    this.score += COIN_SCORE_BONUS;
    this.scoreEl.textContent = String(this.score);
    const allParts = cluster.partWorldPositions();
    for (const p of allParts) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 5,
          y: -2 - Math.random() * 3,
        },
        kind: cluster.kind,
      });
    }
    cluster.alive = false;
  }

  private handlePowerupContact(cluster: FallingCluster): void {
    if (cluster.kind === "slow") {
      this.timeEffect = "slow";
      this.timeScale = SLOW_TIMESCALE;
      this.timeEffectTimer = SLOW_EFFECT_DURATION;
      this.timeEffectMax = SLOW_EFFECT_DURATION;
    } else if (cluster.kind === "fast") {
      this.timeEffect = "fast";
      this.timeScale = FAST_TIMESCALE;
      this.timeEffectTimer = FAST_EFFECT_DURATION;
      this.timeEffectMax = FAST_EFFECT_DURATION;
    }

    // Burst the powerup into debris so the pickup feels punchy.
    const allParts = cluster.partWorldPositions();
    for (const p of allParts) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 6,
          y: -3 - Math.random() * 3,
        },
        kind: cluster.kind,
      });
    }

    cluster.alive = false;
    // Picking up a power-up doesn't count as a "hit" against the combo.
    this.comboHits = 0;
  }

  private spawnCluster(): void {
    // Swarm waves drop a stream of single hexes at varied speeds. Outside
    // a swarm, pick a 2-5 cell polyhex shape from the library.
    const isSwarmSpawn = this.wavePhase === "wave" && this.swarmWave;

    // Pick the cluster kind first so we know the shape (coins are always
    // single-hex). Power-ups and coins are rare; never during a swarm.
    let kind: ClusterKind = "normal";
    if (!isSwarmSpawn) {
      const r = Math.random();
      const coinEnd = COIN_SPAWN_CHANCE;
      const slowEnd = coinEnd + SLOW_SPAWN_CHANCE;
      const fastEnd = slowEnd + FAST_SPAWN_CHANCE;
      const stickyEnd = fastEnd + STICKY_SPAWN_CHANCE;
      if (r < coinEnd) {
        kind = "coin";
      } else if (this.score >= POWERUP_MIN_SCORE) {
        if (r < slowEnd) kind = "slow";
        else if (r < fastEnd) kind = "fast";
        else if (r < stickyEnd && this.score >= STICKY_MIN_SCORE) kind = "sticky";
      }
    }

    const shape: Shape =
      kind === "coin" || isSwarmSpawn ? COIN_SHAPE : pickShape(Math.random);

    // Side spawn: at high score the play also gets clusters flying in from
    // left/right at a downward angle. Sticky/slow/fast still drop from the
    // top so they're catchable.
    const sideSpawn =
      kind === "normal" &&
      this.score >= SIDE_SPAWNS_SCORE &&
      Math.random() < 0.18;

    const speed = this.computeFallSpeed();
    const spin = (Math.random() - 0.5) * (isSwarmSpawn ? 0.16 : 0.08);
    let x: number;
    let y: number;
    let vx: number;
    let vy: number;

    if (sideSpawn) {
      const fromLeft = Math.random() < 0.5;
      // Always enter from the upper half of the play area so the player has
      // enough vertical runway to react. Range: just-below-top → ~halfway.
      const halfBoard = this.boardHeight * 0.5;
      const yMin = this.hexSize * 2;
      const yMax = Math.max(yMin + this.hexSize, halfBoard - this.hexSize);
      y = this.boardOriginY + yMin + Math.random() * (yMax - yMin);
      const sideAngle = 0.25 + Math.random() * 0.25; // 14°-29° below horizontal
      const total = speed * 1.05;
      if (fromLeft) {
        x = this.boardOriginX - this.hexSize * 3;
        vx = Math.cos(sideAngle) * total;
        vy = Math.sin(sideAngle) * total;
      } else {
        x = this.boardOriginX + this.boardWidth + this.hexSize * 3;
        vx = -Math.cos(sideAngle) * total;
        vy = Math.sin(sideAngle) * total;
      }
    } else {
      const colStep = this.pickSpawnColumn(shape);
      if (colStep === null) return; // would block the safe lane
      const railLeft = this.currentRailLeft();
      const railRight = this.currentRailRight();
      const railCenter = (railLeft + railRight) / 2;
      const colWidth = SQRT3 * this.hexSize;
      x = railCenter + colStep * colWidth;
      y = this.boardOriginY - this.hexSize * 4;

      // Angled-drop spawn: late game, some clusters drop at a non-vertical
      // angle. The angle stays small (≤ ~20°) so the cluster still ends up
      // somewhere reachable.
      if (this.score >= ANGLED_SPAWNS_SCORE && kind === "normal" && Math.random() < 0.3) {
        const angle = (Math.random() - 0.5) * 0.7;
        vx = Math.sin(angle) * speed;
        vy = Math.cos(angle) * speed;
      } else {
        vx = 0;
        vy = speed;
      }
    }

    const cluster = FallingCluster.spawn({
      shape,
      x,
      y,
      hexSize: this.hexSize,
      kind,
      initialSpeedY: vy,
      initialSpin: spin,
    });
    // Override velocity so we can include the horizontal component for
    // angled / side spawns.
    Body.setVelocity(cluster.body, { x: vx, y: vy });

    cluster.body.collisionFilter.category = CAT_CLUSTER;
    cluster.body.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER;
    for (let i = 1; i < cluster.body.parts.length; i++) {
      cluster.body.parts[i]!.collisionFilter.category = CAT_CLUSTER;
      cluster.body.parts[i]!.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER;
    }

    // First time this kind is seen this page session, attach a big
    // glowing label to this specific cluster (AVOID / HEAL / SLOW /
    // FAST / COLLECT). Once shown, it doesn't repeat on restart — a
    // full page reload is what brings the labels back.
    if (!this.seenKinds.has(kind)) {
      cluster.hintLabel = kindLabel(kind);
      this.seenKinds.add(kind);
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
    if (this.wavePhase === "wave" && this.swarmWave) return SWARM_SPAWN_INTERVAL;
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
      const variance = this.swarmWave
        ? 0.6 + Math.random() * 0.9 // wider spread during a swarm
        : 0.7 + Math.random() * 0.6;
      return Math.min(MAX_FALL_SPEED * 1.7, base * this.waveParams().waveSpeedMul * variance);
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
    // Decide whether this is a single-hex swarm wave for variety.
    this.swarmWave = Math.random() < SWARM_WAVE_CHANCE;
    // Pick a fresh safe column. Swarm waves still respect this.
    const half = Math.floor(BOARD_COLS / 2);
    this.safeColumn = Math.floor(Math.random() * (half * 2 + 1)) - half;
    // Late game: half of waves narrow the play area.
    if (this.score >= NARROWING_SCORE && Math.random() < 0.5) {
      this.pinchTarget = 0.35; // 35% inset from each side
    } else {
      this.pinchTarget = 0;
    }
  }

  private startCalm(): void {
    this.wavePhase = "calm";
    this.wavePhaseTimer = 0;
    this.swarmWave = false;
    this.pinchTarget = 0;
  }

  // Inner left/right edges of the play area, accounting for the animated
  // pinch when active.
  currentRailLeft(): number {
    const inset = this.pinch * this.boardWidth * 0.5 * 0.6;
    return this.boardOriginX + inset;
  }
  currentRailRight(): number {
    const inset = this.pinch * this.boardWidth * 0.5 * 0.6;
    return this.boardOriginX + this.boardWidth - inset;
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
    // The available columns shrink with the pinch, so spawns stay inside the
    // narrowed area when active.
    const halfFull = Math.floor(BOARD_COLS / 2);
    const halfActive = Math.max(1, Math.floor(halfFull * (1 - this.pinch * 0.6)));
    const fp = this.shapeColumnFootprint(shape);
    const all: number[] = [];
    for (let c = -halfActive; c <= halfActive; c++) all.push(c);

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
    // Scatter the player blob into debris so the wreckage tumbles behind the
    // game-over screen. The player body itself is removed from the world so
    // it doesn't keep being clamped to the rail.
    const com = this.player.body.position;
    for (const cell of this.player.cells.slice()) {
      const wp = this.player.cellWorldCenter(cell);
      const dx = wp.x - com.x;
      const dy = wp.y - com.y;
      const radial = Math.hypot(dx, dy);
      const ux = radial > 0.001 ? dx / radial : (Math.random() - 0.5);
      const uy = radial > 0.001 ? dy / radial : (Math.random() - 0.5);
      this.spawnDebris({
        x: wp.x,
        y: wp.y,
        angle: this.player.body.angle,
        velocity: this.player.body.velocity,
        angularVelocity: this.player.body.angularVelocity,
        impulse: {
          x: ux * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
          y: uy * (3 + Math.random() * 4) - 2 - Math.random() * 4,
        },
        kind: "normal",
      });
    }
    Composite.remove(this.engine.world, this.player.body);

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

    // The play area is the full canvas — the HUD bar and the touchbar live
    // in sibling elements above and below, so this canvas is exclusively
    // game space. Pick hexSize so BOARD_COLS columns fit the full width
    // exactly; height is whatever the canvas gives us.
    const colWidthFor = (size: number) => SQRT3 * size;
    this.hexSize = Math.max(10, cssW / (colWidthFor(1) * BOARD_COLS));

    this.boardWidth = cssW;
    this.boardHeight = cssH;
    this.boardOriginX = 0;
    this.boardOriginY = 0;
    // playerY is the rail Y — the line on which the player's lowest pixel
    // sits, just above the very bottom of the canvas.
    this.playerY = this.boardOriginY + this.boardHeight - RAIL_BOTTOM_INSET;

    // Re-center / re-size the player after layout. setCenter places the CoM
    // at this y; the next clampToRail in the update loop will pull it up so
    // the bounds touch the rail.
    this.player.setHexSize(this.hexSize);
    this.player.setCenter(this.boardOriginX + this.boardWidth / 2, this.playerY - this.hexSize);

    // Regenerate starfield to fit the new canvas dimensions. Two planes:
    // a denser back plane of small dim stars, and a sparser front plane of
    // brighter ones that parallax further when the player moves.
    this.starsBack = generateStars(cssW, cssH, Math.round(cssW * cssH / 4500), 0.4, 0.9, 0.25);
    this.starsFront = generateStars(cssW, cssH, Math.round(cssW * cssH / 11000), 0.9, 1.7, 0.6);
  }

  private drawStarfield(canvasW: number, canvasH: number): void {
    const ctx = this.ctx;
    // Parallax driver: how far the player is from the centre of the rail,
    // normalised to [-1, 1]. Negative = left, positive = right.
    const cx = this.boardOriginX + this.boardWidth / 2;
    const halfW = this.boardWidth / 2;
    const offset = Math.max(-1, Math.min(1, halfW > 0 ? (this.player.body.position.x - cx) / halfW : 0));

    drawStarLayer(
      ctx,
      this.starsBack,
      canvasW,
      canvasH,
      -offset * PARALLAX_BACK,
      this.starScrollY * STAR_SCROLL_BACK,
      "#7d97cc",
    );
    drawStarLayer(
      ctx,
      this.starsFront,
      canvasW,
      canvasH,
      -offset * PARALLAX_FRONT,
      this.starScrollY * STAR_SCROLL_FRONT,
      "#ffffff",
    );
  }

  private render(dt: number): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Two-plane parallax starfield, drawn first so everything else covers it.
    this.drawStarfield(rect.width, rect.height);

    // Board background — slightly translucent so stars subtly show through
    // the play area instead of being limited to the side margins.
    ctx.fillStyle = "rgba(14, 17, 36, 0.82)";
    ctx.fillRect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);

    // Pinch panels: dim slabs slide in from the sides when the play area is
    // narrowed during a late-game wave.
    if (this.pinch > 0.01) {
      const inset = this.pinch * this.boardWidth * 0.5 * 0.6;
      ctx.fillStyle = "rgba(180, 100, 110, 0.12)";
      ctx.fillRect(this.boardOriginX, this.boardOriginY, inset, this.boardHeight);
      ctx.fillRect(
        this.boardOriginX + this.boardWidth - inset,
        this.boardOriginY,
        inset,
        this.boardHeight,
      );
      ctx.strokeStyle = "rgba(255, 120, 130, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.boardOriginX + inset, this.boardOriginY);
      ctx.lineTo(this.boardOriginX + inset, this.boardOriginY + this.boardHeight);
      ctx.moveTo(this.boardOriginX + this.boardWidth - inset, this.boardOriginY);
      ctx.lineTo(this.boardOriginX + this.boardWidth - inset, this.boardOriginY + this.boardHeight);
      ctx.stroke();
    }

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
    for (const c of this.clusters) c.draw(ctx, this.hexSize, dt, this.timeEffect);

    ctx.restore();

    // Skip drawing the player after game-over — the body has been removed
    // from the world and replaced with debris that's already animating.
    if (this.state !== "gameover") this.player.draw(ctx);

    // Big first-appearance hint label above each cluster that carries
    // one. Drawn outside the board clip so it can hover above the play
    // area when the cluster is near the top.
    this.drawClusterHints();

    // Time-effect HUD: a small countdown bar at the top of the play area.
    if (this.timeEffect !== null) {
      const frac = Math.max(0, this.timeEffectTimer / this.timeEffectMax);
      const w = this.boardWidth * 0.6;
      const x0 = this.boardOriginX + (this.boardWidth - w) / 2;
      const y0 = this.boardOriginY + 6;
      const color = this.timeEffect === "slow" ? "#ffd76b" : "#7fe89c";
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(x0, y0, w, 6);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, w * frac, 6);
    }
  }
}

function generateStars(
  w: number,
  h: number,
  count: number,
  minR: number,
  maxR: number,
  minA: number,
): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: minR + Math.random() * (maxR - minR),
      a: minA + Math.random() * (1 - minA),
    });
  }
  return out;
}

function drawStarLayer(
  ctx: CanvasRenderingContext2D,
  stars: Star[],
  canvasW: number,
  canvasH: number,
  shiftX: number,
  shiftY: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (const s of stars) {
    // Wrap horizontally + vertically so stars never disappear off one edge
    // as the parallax / scroll moves them past it; positive modulo trick
    // handles negative shifts.
    const sx = ((s.x + shiftX) % canvasW + canvasW) % canvasW;
    const sy = ((s.y + shiftY) % canvasH + canvasH) % canvasH;
    ctx.globalAlpha = s.a;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

