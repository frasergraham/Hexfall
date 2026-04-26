import { Bodies, Body, Composite, Engine, Events, type IEventCollision } from "matter-js";
import { COIN_SHAPE, FallingCluster, hintPalette, kindLabel, pickShape } from "./cluster";
import { DebrisHex } from "./debris";
import { SQRT3 } from "./hex";
import { bindCanvasSlide, bindInput, bindSlider, isTouchDevice } from "./input";
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
const SHIELD_SPAWN_CHANCE = 0.05;
const SHIELD_MIN_SCORE = 200;
const SHIELD_DURATION = 10; // seconds
const DRONE_SPAWN_CHANCE = 0.02; // rarer than the other power-ups
const DRONE_MIN_SCORE = 400;
const DRONE_DURATION = 10; // seconds
const DRONE_SIZE_FACTOR = 0.5; // multiplier on hexSize for the drone body
const DRONE_OSCILLATION_SPEED = 0.7; // radians/sec for the back-and-forth

// Time-effect tuning.
const SLOW_EFFECT_DURATION = 5;
const FAST_EFFECT_DURATION = 5;
const STICK_SLOW_BUFFER = 2; // brief slow-mo after gaining a hex
const SLOW_TIMESCALE = 0.5;
const FAST_TIMESCALE_BASE = 1.25; // first fast pickup
const FAST_TIMESCALE_STEP = 0.1; // each subsequent stack adds this much speed
const FAST_MULTIPLIER_BASE = 3; // first fast pickup multiplies passes 3x
const FAST_MULTIPLIER_STEP = 1; // each stack bumps the multiplier by 1

// Wave variants.
const SWARM_WAVE_CHANCE = 0.35; // chance any given wave is a single-hex swarm
const SWARM_SPAWN_INTERVAL = 0.18; // very short interval during swarms
const SWARM_STICKY_CHANCE = 0.12; // chance a swarm hex spawns as a heal instead of blue

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
const CAT_DRONE = 0x0010;

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

interface Floater {
  text: string;
  x: number;
  y: number;
  vx: number; // px/sec horizontal drift
  vy: number; // px/sec vertical drift (negative = up)
  age: number;
  lifetime: number;
  fillColor: string;
  glowColor: string;
  fontSize: number;
  shake: boolean;
  // Grand mode: pop from near-zero to peakScale fast (~0.2s ease-out
  // cubic) then hold full size while fading and drifting. Used for the
  // fast-bonus payout to make survival feel like a real reward.
  grand: boolean;
  peakScale: number;
}

interface Drone {
  body: Body;
  // World y the drone stays pinned at; only x oscillates.
  baseY: number;
  // Horizontal oscillation centre + amplitude in pixels.
  centreX: number;
  amplitude: number;
  phase: number; // radians, advances with time
  speed: number; // radians per second
  lifetime: number; // seconds remaining
  pulse: number;
}

const PARALLAX_BACK = 8; // px max horizontal shift of the back plane
const PARALLAX_FRONT = 22; // px max horizontal shift of the front plane
const STAR_SCROLL_BACK = 6; // px/sec downward drift of the back plane
const STAR_SCROLL_FRONT = 18; // px/sec downward drift of the front plane

const HINT_TIMESCALE = 0.5; // game runs at this rate while a hint cluster is on screen
const ROTATE_TUTORIAL_TIMESCALE = 0.25; // even slower while teaching the rotate gesture
const ROTATE_SLIDE_SENS = 0.02; // radians of player rotation per pixel of horizontal drag

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
  // Tracks whether a horizontal slide-to-rotate gesture is currently
  // active, so the touch path can suppress the keyboard rotation hold.
  private rotationDragActive = false;
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

  // Floating-text feedback (e.g. "+5" on coin pickup, "3X" on fast pickup).
  // Each floater rises and fades over a short lifetime.
  private floaters: Floater[] = [];

  // Shield power-up state. While shieldTimer > 0 a translucent bubble
  // surrounds the player and any harmful contact (normal cluster or sticky)
  // is absorbed at the cost of 1 second of shield time.
  private shieldTimer = 0;

  // Active drones — small mid-screen sentinels that intercept clusters
  // and shatter them on contact. Multiple drones can be active.
  private drones: Drone[] = [];

  // ROTATE tutorial: fires once per page session the first time the
  // player grows from 1 → 2 hexes. Slows the game to 0.25x and shows a
  // big "ROTATE" label + curved double-headed arrow around the player
  // until they rotate enough or the timer expires.
  private rotateTutorialShown = false;
  private rotateTutorialActive = false;
  private rotateTutorialTimer = 0;
  private rotateTutorialStartAngle = 0;

  // Fast power-up combo state. fastLevel counts how many fast pickups
  // happened this run (1 → 3x, 2 → 4x, 3 → 5x, …); each pickup also
  // bumps the timescale by FAST_TIMESCALE_STEP. fastBonus accumulates
  // the *extra* points (not the base +1) while fast is active. The pool
  // is awarded as one big "+N" floater when the timer runs out cleanly,
  // or scattered as a "lost" explosion when the player gets hit.
  private fastLevel = 0;
  private fastBonus = 0;

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

    const movePadEl = this.touchbar.querySelector<HTMLElement>("#movepad");
    const moveKnobEl = this.touchbar.querySelector<HTMLElement>("#moveknob");
    const wheelEl = document.querySelector<HTMLElement>("#canvasWheel");

    const extraUnbinds: Array<() => void> = [];

    // Rotate gesture: any tap/drag on the canvas. While the finger is on
    // screen, an under-finger ghost wheel shows where you're rotating
    // around. Drag delta around the anchor → player rotates by the same
    // delta (iPod click-wheel feel).
    if (wheelEl) {
      // Rotate gesture: any horizontal drag on the canvas. dx in pixels
      // → delta angle in radians via ROTATE_SLIDE_SENS. Drag right
      // rotates clockwise, drag left rotates CCW. A small indicator dot
      // follows the finger to confirm the touch.
      extraUnbinds.push(
        bindCanvasSlide(this.canvas, wheelEl, (deltaPx) => {
          if (deltaPx === null) {
            this.rotationDragActive = false;
            this.holds.rotateCw.active = false;
            this.holds.rotateCcw.active = false;
            return;
          }
          this.rotationDragActive = true;
          this.player.setAngle(
            this.player.body.angle + deltaPx * ROTATE_SLIDE_SENS,
          );
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

    if (new URLSearchParams(window.location.search).get("debug") === "1") {
      this.installDebugButtons();
    }

    this.renderMenu();
  }

  private installDebugButtons(): void {
    const parent = this.overlay.parentElement;
    if (!parent) return;
    const container = document.createElement("div");
    container.className = "debug-buttons";
    container.id = "debugButtons";
    const label = document.createElement("span");
    label.className = "debug-label";
    label.textContent = "DEBUG · start at";
    container.appendChild(label);
    for (const score of [199, 399, 599]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(score);
      btn.addEventListener("click", (e) => {
        // stopPropagation prevents the overlay's own click handler from
        // ALSO firing and resetting the score back to 0.
        e.stopPropagation();
        this.startOrRestart(score);
      });
      container.appendChild(btn);
    }
    parent.appendChild(container);
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

  private startOrRestart(initialScore = 0): void {
    // Tear down all existing physics bodies.
    for (const c of this.clusters) Composite.remove(this.engine.world, c.body);
    for (const d of this.debris) Composite.remove(this.engine.world, d.body);
    Composite.remove(this.engine.world, this.player.body);

    this.clusters = [];
    this.debris = [];
    this.clusterByBodyId.clear();
    this.pendingContacts = [];

    this.score = initialScore;
    this.comboHits = 0;
    this.spawnTimer = 0;
    this.wavePhase = "calm";
    this.wavePhaseTimer = 0;
    this.swarmWave = false;
    this.timeEffect = null;
    this.timeEffectTimer = 0;
    this.timeEffectMax = 1;
    this.timeScale = 1;
    this.floaters = [];
    this.shieldTimer = 0;
    for (const d of this.drones) Composite.remove(this.engine.world, d.body);
    this.drones = [];
    // The "ever shown this session" flag (rotateTutorialShown) is *not*
    // reset on restart — only on a full page reload, like seenKinds.
    this.rotateTutorialActive = false;
    this.rotateTutorialTimer = 0;
    this.rotateTutorialStartAngle = 0;
    this.fastLevel = 0;
    this.fastBonus = 0;
    // Note: seenKinds is *not* cleared — hints only show on the very first
    // play of the game on this device, never on restarts.
    this.pinch = 0;
    this.pinchTarget = 0;
    this.rotationDragActive = false;
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
    this.scoreEl.textContent = String(this.score);
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

    // Tick floating score popups (always real time so they don't slow with
    // a slow-mo effect — UI feedback should be instantly readable).
    if (this.floaters.length > 0) {
      this.floaters = this.floaters.filter((f) => {
        f.age += dt;
        return f.age < f.lifetime;
      });
    }

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
    // of timescale) so the slow / fast power-up always lasts its full
    // duration. When fast expires *cleanly* (no hit ate it), award the
    // accumulated bonus pool as a single payout.
    if (this.timeEffect !== null) {
      this.timeEffectTimer -= dt;
      if (this.timeEffectTimer <= 0) {
        if (this.timeEffect === "fast") this.awardFastBonus();
        this.timeEffect = null;
        this.timeScale = 1;
      }
    }

    // Pinch interpolates toward target each real-frame.
    const pinchLerp = 1 - Math.exp(-dt * 4);
    this.pinch += (this.pinchTarget - this.pinch) * pinchLerp;

    // ROTATE tutorial: tick its timer and dismiss when the player has
    // turned the blob enough or 5 seconds have passed.
    if (this.rotateTutorialActive) {
      this.rotateTutorialTimer += dt;
      let turned = this.player.body.angle - this.rotateTutorialStartAngle;
      turned = Math.atan2(Math.sin(turned), Math.cos(turned));
      if (Math.abs(turned) >= Math.PI / 6 || this.rotateTutorialTimer > 5) {
        this.rotateTutorialActive = false;
      }
    }

    // While a hint cluster is on screen, force a 0.5x slow so the player
    // can read the label and absorb what to do. The rotate tutorial drops
    // it further to 0.25x. We always take the slowest of the active
    // constraints stacked on top of the power-up timeScale.
    const hintActive = this.clusters.some((c) => c.hintLabel && c.alive);
    let effectiveScale = this.timeScale;
    if (hintActive) effectiveScale = Math.min(effectiveScale, HINT_TIMESCALE);
    if (this.rotateTutorialActive)
      effectiveScale = Math.min(effectiveScale, ROTATE_TUTORIAL_TIMESCALE);

    // gameDt drives physics + spawn + wave so slow-mo really slows everything.
    const gameDt = dt * effectiveScale;

    // Player input → physics velocities (input applied in real time so the
    // controls always feel responsive even during slow-mo).
    this.applyMovementInput();

    this.player.inDanger = this.player.size() >= DANGER_SIZE;

    // Shield timer ticks in wall-clock seconds so its 10s feels real.
    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    }

    // Drone update: oscillate horizontally, age out, despawn dead bodies.
    this.updateDrones(dt);

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
        // Base score always banks at 1. While fast is active, the *extra*
        // points (multiplier - 1) accumulate into a separate bonus pool
        // that's awarded only if the player survives to the end of the
        // effect — and lost entirely on a hit.
        this.score += 1;
        if (this.timeEffect === "fast") {
          this.fastBonus += this.fastMultiplier() - 1;
        }
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

  private fastMultiplier(): number {
    if (this.fastLevel <= 0) return 1;
    return FAST_MULTIPLIER_BASE + (this.fastLevel - 1) * FAST_MULTIPLIER_STEP;
  }

  // Award the accumulated fast bonus to the score with a chunky "+N"
  // floater. Called when the fast effect timer expires cleanly. After
  // the award, the bonus pool resets to 0; the multiplier level (and
  // therefore future stacking) is preserved for the rest of the run.
  // Where the fast-bonus tally is drawn in the HUD (just under the
  // countdown bar). Award and loss floaters originate here so the
  // visual feedback stays at the score readout instead of erupting
  // around the player and breaking concentration on the dodge.
  private fastBonusHudPos(): { x: number; y: number } {
    const fontSize = Math.max(20, Math.round(this.hexSize * 1.05));
    return {
      x: this.boardOriginX + this.boardWidth / 2,
      y: this.boardOriginY + 6 + 12 + fontSize / 2,
    };
  }

  private awardFastBonus(): void {
    if (this.fastBonus <= 0) return;
    this.score += this.fastBonus;
    this.scoreEl.textContent = String(this.score);
    const p = this.fastBonusHudPos();
    // Big celebratory pop: huge font, scale 0 → 1.6 fast, then a slow
    // upward drift + fade so the player can really see the payout.
    this.spawnFloater(
      `+${this.fastBonus}`,
      p.x,
      p.y,
      "#c8ffd5",
      "rgba(120, 255, 170, 0.95)",
      {
        vy: -40,
        lifetime: 1.8,
        fontSize: Math.max(56, Math.round(this.hexSize * 3.2)),
        grand: true,
        peakScale: 1.6,
      },
    );
    this.fastBonus = 0;
  }

  // The player got hit while fast was active. Scatter the lost bonus as
  // red fragments from the bonus HUD, end the fast effect, and reset
  // both the bonus pool and the multiplier level so the next pickup
  // starts fresh at 3x.
  private loseFastBonus(): void {
    if (this.timeEffect !== "fast") return;
    const lost = this.fastBonus;
    const p = this.fastBonusHudPos();
    if (lost > 0) {
      this.spawnFloater(
        `-${lost}`,
        p.x,
        p.y,
        "#ffb0b0",
        "rgba(255, 80, 80, 0.95)",
        { vy: 60, vx: 0, lifetime: 1.0, shake: true },
      );
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.random() * 0.4;
        this.spawnFloater(
          `-${Math.max(1, Math.round(lost / 5))}`,
          p.x,
          p.y,
          "#ff8a8a",
          "rgba(255, 70, 70, 0.95)",
          {
            vx: Math.cos(a) * 180,
            vy: Math.sin(a) * 180,
            lifetime: 0.7,
          },
        );
      }
    }
    this.fastBonus = 0;
    this.fastLevel = 0;
    this.timeEffect = null;
    this.timeEffectTimer = 0;
    this.timeScale = 1;
  }

  private spawnFloater(
    text: string,
    x: number,
    y: number,
    fillColor: string,
    glowColor: string,
    opts?: {
      vx?: number;
      vy?: number;
      lifetime?: number;
      shake?: boolean;
      fontSize?: number;
      grand?: boolean;
      peakScale?: number;
    },
  ): void {
    this.floaters.push({
      text,
      x,
      y,
      vx: opts?.vx ?? 0,
      vy: opts?.vy ?? -80,
      age: 0,
      lifetime: opts?.lifetime ?? 1.0,
      fillColor,
      glowColor,
      fontSize: opts?.fontSize ?? Math.max(28, Math.round(this.hexSize * 1.6)),
      shake: opts?.shake ?? false,
      grand: opts?.grand ?? false,
      peakScale: opts?.peakScale ?? 1.4,
    });
  }

  private drawFloaters(): void {
    if (this.floaters.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floaters) {
      const t = f.age / f.lifetime;
      // Drift via per-floater velocity (defaults to a 1s upward rise) plus
      // optional horizontal shake for the "lost bonus" presentation.
      const xOffset =
        f.vx * f.age + (f.shake ? Math.sin(f.age * 28) * 5 : 0);
      const yOffset = f.vy * f.age;
      let scale: number;
      let alpha: number;
      if (f.grand) {
        // Grand: ease from 0 to peakScale over ~0.2s with ease-out cubic,
        // then hold full size while fading + drifting up + out slowly.
        const popDur = 0.2;
        const popT = Math.min(1, f.age / popDur);
        scale = f.peakScale * (1 - Math.pow(1 - popT, 3));
        if (f.age < popDur) {
          alpha = 1;
        } else {
          const fadeT = (f.age - popDur) / Math.max(0.001, f.lifetime - popDur);
          alpha = Math.max(0, 1 - fadeT);
        }
      } else {
        scale = 1 + (f.peakScale - 1) * Math.min(1, f.age / 0.18);
        alpha = Math.max(0, 1 - t);
      }
      ctx.font = `900 ${f.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = f.glowColor;
      ctx.shadowBlur = 20;
      ctx.save();
      ctx.translate(f.x + xOffset, f.y + yOffset);
      ctx.scale(scale, scale);
      ctx.fillStyle = f.fillColor;
      ctx.fillText(f.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
      ctx.strokeText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
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

    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const parentA = a.parent ?? a;
      const parentB = b.parent ?? b;
      const aIsPlayer = parentA.label === "player";
      const bIsPlayer = parentB.label === "player";
      const aIsCluster = parentA.label === "cluster";
      const bIsCluster = parentB.label === "cluster";
      const aIsDrone = parentA.label === "drone";
      const bIsDrone = parentB.label === "drone";

      // Drone vs cluster: drones only intercept blue (normal) clusters.
      // Power-ups, coins, and sticky red blocks pass through so the
      // player can still grab (or be hit by) them. Each successful
      // intercept also burns 1 second off this drone's lifetime, just
      // like the shield burns shield time on absorbed hits.
      if ((aIsDrone && bIsCluster) || (bIsDrone && aIsCluster)) {
        const droneParent = aIsDrone ? parentA : parentB;
        const clusterParent = aIsCluster ? parentA : parentB;
        const cluster = this.clusterByBodyId.get(clusterParent.id);
        if (
          cluster &&
          cluster.alive &&
          !cluster.contacted &&
          cluster.kind === "normal"
        ) {
          cluster.contacted = true;
          this.shatterClusterMidair(cluster);
          const drone = this.drones.find((d) => d.body.id === droneParent.id);
          if (drone) drone.lifetime = Math.max(0, drone.lifetime - 1);
        }
        continue;
      }

      // Player vs cluster — defer to handlePendingContacts so a single
      // frame's contacts route through the per-kind logic in one place.
      if (this.player.invulnTimer > 0) continue;

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

      const support = pair.collision.supports[0];
      const point = support
        ? { x: support.x, y: support.y }
        : { x: clusterPart.position.x, y: clusterPart.position.y };

      cluster.contacted = true;
      this.pendingContacts.push({ cluster, contact: { point, partId: clusterPart.id } });
    }
  }

  // Cluster torn apart in mid-air by a drone. No player effect — just
  // visual shatter.
  private shatterClusterMidair(cluster: FallingCluster): void {
    for (const p of cluster.partWorldPositions()) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 6,
          y: -2 - Math.random() * 4,
        },
        kind: cluster.kind,
      });
    }
    cluster.alive = false;
  }

  private handlePendingContacts(): void {
    for (const { cluster, contact } of this.pendingContacts) {
      if (!cluster.alive) continue;

      this.player.invulnTimer = STICK_INVULN_MS / 1000;

      // Shield only absorbs blue (normal) hits at a cost of 1s per absorbed
      // contact. Red sticky still rips hexes off, and every helpful pickup
      // (coin, slow, fast, drone, shield refresh) still registers normally.
      if (this.shieldTimer > 0 && cluster.kind === "normal") {
        this.absorbWithShield(cluster);
        continue;
      }

      if (cluster.kind === "normal") {
        this.handleNormalContact(cluster, contact);
      } else if (cluster.kind === "sticky") {
        this.handleStickyContact(cluster, contact);
      } else if (cluster.kind === "coin") {
        this.handleCoinContact(cluster);
      } else if (cluster.kind === "shield") {
        this.handleShieldContact(cluster);
      } else if (cluster.kind === "drone") {
        this.handleDroneContact(cluster);
      } else {
        // slow / fast power-up: activate the time effect, scatter the blob
        // into debris, and clear combo (helpful pickup).
        this.handlePowerupContact(cluster);
      }
    }
    this.pendingContacts = [];
  }

  private absorbWithShield(cluster: FallingCluster): void {
    // Shatter the cluster into debris and burn 1s off the shield. Combo is
    // preserved (a deflected hit isn't a recovery moment).
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
          y: -1 - Math.random() * 3,
        },
        kind: cluster.kind,
      });
    }
    cluster.alive = false;
    this.shieldTimer = Math.max(0, this.shieldTimer - 1);
  }

  private handleShieldContact(cluster: FallingCluster): void {
    this.shieldTimer = SHIELD_DURATION;
    const center = cluster.body.position;
    this.spawnFloater(
      "SHIELD",
      center.x,
      center.y,
      "#dff2ff",
      "rgba(120, 220, 255, 0.95)",
    );
    this.scatterPickupDebris(cluster);
    cluster.alive = false;
    this.comboHits = 0;
  }

  private handleDroneContact(cluster: FallingCluster): void {
    this.spawnDrone();
    const center = cluster.body.position;
    this.spawnFloater(
      "DRONE",
      center.x,
      center.y,
      "#eedfff",
      "rgba(210, 170, 255, 0.95)",
    );
    this.scatterPickupDebris(cluster);
    cluster.alive = false;
    this.comboHits = 0;
  }

  private scatterPickupDebris(cluster: FallingCluster): void {
    for (const p of cluster.partWorldPositions()) {
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
  }

  private updateDrones(dt: number): void {
    if (this.drones.length === 0) return;
    for (const d of this.drones) {
      d.lifetime -= dt;
      d.phase += dt * d.speed;
      d.pulse += dt * 4;
      const x = d.centreX + Math.sin(d.phase) * d.amplitude;
      Body.setPosition(d.body, { x, y: d.baseY });
      Body.setAngle(d.body, Math.sin(d.phase * 0.5) * 0.4);
    }
    this.drones = this.drones.filter((d) => {
      if (d.lifetime > 0) return true;
      Composite.remove(this.engine.world, d.body);
      return false;
    });
  }

  private drawDrones(): void {
    if (this.drones.length === 0) return;
    const ctx = this.ctx;
    const droneSize = this.hexSize * DRONE_SIZE_FACTOR;
    for (const d of this.drones) {
      const px = d.body.position.x;
      const py = d.body.position.y;
      const pulseT = (Math.sin(d.pulse) + 1) * 0.5;

      // Halo.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const haloR = droneSize * 2.2;
      const halo = ctx.createRadialGradient(px, py, 0, px, py, haloR);
      halo.addColorStop(0, `rgba(210, 170, 255, ${0.6 + pulseT * 0.25})`);
      halo.addColorStop(0.55, "rgba(140, 90, 220, 0.35)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(px, py, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Hex core.
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.body.angle);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        const x = droneSize * Math.cos(a);
        const y = droneSize * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, -droneSize, 0, droneSize);
      grad.addColorStop(0, "#e6d6ff");
      grad.addColorStop(1, "#3c1a72");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + pulseT * 0.3})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Lifetime ring around the drone.
      const t = Math.max(0, d.lifetime / DRONE_DURATION);
      ctx.save();
      ctx.strokeStyle = "rgba(210, 170, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, droneSize * 1.4, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ROTATE tutorial overlay: a curved double-headed arrow ringing the
  // player + a big "ROTATE" label, both pulsing softly. Drawn last over
  // gameplay so it can't get hidden behind clusters.
  private drawRotateTutorial(): void {
    if (!this.rotateTutorialActive) return;
    const ctx = this.ctx;
    const com = this.player.body.position;
    const bounds = this.player.body.bounds;
    const halfH = (bounds.max.y - bounds.min.y) / 2;
    const halfArrow = this.hexSize * 2.6; // half-width of the straight arrow
    const arrowY = bounds.min.y - this.hexSize * 1.1;
    const pulse = (Math.sin(performance.now() * 0.006) + 1) * 0.5;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 230, 120, ${0.7 + pulse * 0.3})`;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255, 200, 80, 0.85)";
    ctx.shadowBlur = 18;

    // Straight horizontal shaft.
    ctx.beginPath();
    ctx.moveTo(com.x - halfArrow, arrowY);
    ctx.lineTo(com.x + halfArrow, arrowY);
    ctx.stroke();

    // Arrowheads at both ends.
    const head = this.hexSize * 0.55;
    ctx.beginPath();
    // Right tip pointing right.
    ctx.moveTo(com.x + halfArrow, arrowY);
    ctx.lineTo(com.x + halfArrow - head, arrowY - head * 0.7);
    ctx.moveTo(com.x + halfArrow, arrowY);
    ctx.lineTo(com.x + halfArrow - head, arrowY + head * 0.7);
    // Left tip pointing left.
    ctx.moveTo(com.x - halfArrow, arrowY);
    ctx.lineTo(com.x - halfArrow + head, arrowY - head * 0.7);
    ctx.moveTo(com.x - halfArrow, arrowY);
    ctx.lineTo(com.x - halfArrow + head, arrowY + head * 0.7);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Big "ROTATE" label above the arrow.
    const fontSize = Math.max(36, Math.round(this.hexSize * 2.4));
    ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = Math.max(
      this.boardOriginY + fontSize * 0.7,
      arrowY - fontSize * 0.85,
    );
    ctx.shadowColor = "rgba(255, 220, 120, 0.95)";
    ctx.shadowBlur = 26;
    ctx.fillStyle = "#fff3c2";
    ctx.fillText("ROTATE", com.x, labelY);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(80, 50, 0, 0.85)";
    ctx.strokeText("ROTATE", com.x, labelY);

    ctx.restore();
    void halfH; // reserved for future styling that anchors below the blob
  }

  private drawShield(): void {
    if (this.shieldTimer <= 0) return;
    const ctx = this.ctx;
    const com = this.player.body.position;
    const bounds = this.player.body.bounds;
    const dx = (bounds.max.x - bounds.min.x) / 2;
    const dy = (bounds.max.y - bounds.min.y) / 2;
    const radius = Math.hypot(dx, dy) + this.hexSize * 0.5;
    const t = Math.min(1, this.shieldTimer / SHIELD_DURATION);
    const pulse = (Math.sin(performance.now() * 0.006) + 1) * 0.5;

    ctx.save();
    // Soft fill.
    ctx.globalCompositeOperation = "lighter";
    const fill = ctx.createRadialGradient(com.x, com.y, 0, com.x, com.y, radius);
    fill.addColorStop(0, "rgba(120, 220, 255, 0)");
    fill.addColorStop(0.7, `rgba(120, 220, 255, ${0.05 + pulse * 0.05})`);
    fill.addColorStop(1, `rgba(120, 220, 255, ${0.18 + pulse * 0.12})`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(com.x, com.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crisp ring + countdown arc.
    ctx.save();
    ctx.strokeStyle = `rgba(170, 230, 255, ${0.55 + pulse * 0.25})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(com.x, com.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(220, 240, 255, 0.95)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(com.x, com.y, radius, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private spawnDrone(): void {
    const baseY = this.boardOriginY + this.boardHeight * 0.5;
    const centreX = this.boardOriginX + this.boardWidth / 2;
    const amplitude = this.boardWidth * 0.35;
    const droneSize = this.hexSize * DRONE_SIZE_FACTOR;
    const body = Bodies.polygon(centreX, baseY, 6, droneSize, {
      isStatic: true,
      isSensor: true,
      label: "drone",
      collisionFilter: { category: CAT_DRONE, mask: CAT_CLUSTER },
    });
    Composite.add(this.engine.world, body);
    this.drones.push({
      body,
      baseY,
      centreX,
      amplitude,
      phase: Math.random() * Math.PI * 2,
      speed: DRONE_OSCILLATION_SPEED,
      lifetime: DRONE_DURATION,
      pulse: Math.random() * Math.PI * 2,
    });
  }

  private handleNormalContact(cluster: FallingCluster, contact: ContactInfo): void {
    const allParts = cluster.partWorldPositions();

    // A normal-cluster hit while fast is active vaporises the accumulated
    // bonus pool — scatter it as red fragments and end the effect.
    this.loseFastBonus();

    // Snapshot pre-hit size so the lose check only counts hits taken while
    // already in the danger zone. Otherwise a fast 5→6→7 combo would end
    // the run before the danger glow ever appears.
    const wasInDanger = this.player.size() >= DANGER_SIZE;

    const cell = this.player.findStickCell(contact.point.x, contact.point.y);
    if (cell) {
      const sizeBefore = this.player.size();
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
      // First time the blob ever grows past one hex this page session,
      // teach the rotate gesture: big label + curved arrow + 0.25x slow.
      if (
        sizeBefore === 1 &&
        this.player.size() === 2 &&
        !this.rotateTutorialShown
      ) {
        this.rotateTutorialShown = true;
        this.rotateTutorialActive = true;
        this.rotateTutorialTimer = 0;
        this.rotateTutorialStartAngle = this.player.body.angle;
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
    scale?: number;
    lifetime?: number;
  }): void {
    const d = DebrisHex.spawn({ ...opts, hexSize: this.hexSize });
    this.debris.push(d);
    Composite.add(this.engine.world, d.body);
  }

  private handleStickyContact(cluster: FallingCluster, contact: ContactInfo): void {
    const allParts = cluster.partWorldPositions();
    // Sticky red is a heal, not a hit — fast bonus survives this contact.
    // Only a real blue-cluster collision ends fast mode.
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
    // Coin pickup: base +5 always banks. While fast is active, the
    // multiplier also applies — the *extra* points (5 × (mul - 1)) join
    // the at-risk bonus pool, just like a passed cluster would.
    this.score += COIN_SCORE_BONUS;
    this.scoreEl.textContent = String(this.score);
    if (this.timeEffect === "fast") {
      this.fastBonus += COIN_SCORE_BONUS * (this.fastMultiplier() - 1);
    }
    const center = cluster.body.position;
    this.spawnFloater(`+${COIN_SCORE_BONUS}`, center.x, center.y, "#ffe28a", "rgba(255, 175, 70, 0.95)");
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.15;
      const speed = 5 + Math.random() * 2.5;
      this.spawnDebris({
        x: center.x,
        y: center.y,
        angle: a,
        velocity: { x: 0, y: 0 },
        angularVelocity: (Math.random() - 0.5) * 6,
        impulse: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
        kind: "coin",
        scale: 0.32,
        lifetime: 0.55,
      });
    }
    cluster.alive = false;
  }

  private handlePowerupContact(cluster: FallingCluster): void {
    const center = cluster.body.position;
    if (cluster.kind === "slow") {
      // Slow during fast = clean exit: pay out the accumulated bonus and
      // reset the multiplier level, then activate slow.
      if (this.timeEffect === "fast") {
        this.awardFastBonus();
        this.fastLevel = 0;
      }
      this.timeEffect = "slow";
      this.timeScale = SLOW_TIMESCALE;
      this.timeEffectTimer = SLOW_EFFECT_DURATION;
      this.timeEffectMax = SLOW_EFFECT_DURATION;
    } else if (cluster.kind === "fast") {
      // Each fast pickup stacks: level += 1, speed += 0.1, multiplier += 1.
      // Existing accumulated bonus carries into the new effect so combos
      // can stack big rewards across multiple pickups.
      this.fastLevel += 1;
      this.timeEffect = "fast";
      this.timeScale = FAST_TIMESCALE_BASE + (this.fastLevel - 1) * FAST_TIMESCALE_STEP;
      this.timeEffectTimer = FAST_EFFECT_DURATION;
      this.timeEffectMax = FAST_EFFECT_DURATION;
      const mul = this.fastMultiplier();
      this.spawnFloater(
        `${mul}X`,
        center.x,
        center.y,
        "#c8ffd5",
        "rgba(120, 255, 170, 0.95)",
      );
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
    if (isSwarmSpawn) {
      // Occasional heal block tucked into the middle of a swarm — gives
      // the player a brief opportunity to recover during otherwise pure
      // dodge phases.
      if (
        this.score >= STICKY_MIN_SCORE &&
        Math.random() < SWARM_STICKY_CHANCE
      ) {
        kind = "sticky";
      }
    } else {
      const r = Math.random();
      const coinEnd = COIN_SPAWN_CHANCE;
      const slowEnd = coinEnd + SLOW_SPAWN_CHANCE;
      const fastEnd = slowEnd + FAST_SPAWN_CHANCE;
      const stickyEnd = fastEnd + STICKY_SPAWN_CHANCE;
      const shieldEnd = stickyEnd + SHIELD_SPAWN_CHANCE;
      const droneEnd = shieldEnd + DRONE_SPAWN_CHANCE;
      if (r < coinEnd) {
        kind = "coin";
      } else if (this.score >= POWERUP_MIN_SCORE) {
        if (r < slowEnd) kind = "slow";
        else if (r < fastEnd) kind = "fast";
        else if (r < stickyEnd && this.score >= STICKY_MIN_SCORE) kind = "sticky";
        else if (r < shieldEnd && this.score >= SHIELD_MIN_SCORE) kind = "shield";
        else if (r < droneEnd && this.score >= DRONE_MIN_SCORE) kind = "drone";
      }
    }

    // Coin / shield / drone pickups and swarm hexes are always single-cell.
    const shape: Shape =
      kind === "coin" ||
      kind === "shield" ||
      kind === "drone" ||
      isSwarmSpawn
        ? COIN_SHAPE
        : pickShape(Math.random);

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
    cluster.body.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    for (let i = 1; i < cluster.body.parts.length; i++) {
      cluster.body.parts[i]!.collisionFilter.category = CAT_CLUSTER;
      cluster.body.parts[i]!.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
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
    this.drawDrones();

    ctx.restore();

    // Skip drawing the player after game-over — the body has been removed
    // from the world and replaced with debris that's already animating.
    if (this.state !== "gameover") {
      this.drawShield();
      this.player.draw(ctx);
    }

    // Big first-appearance hint label above each cluster that carries
    // one. Drawn outside the board clip so it can hover above the play
    // area when the cluster is near the top.
    this.drawClusterHints();

    // Rotate-gesture tutorial (only fires once per page session).
    this.drawRotateTutorial();

    // Floating score popups (+5 on coin pickup, 3X on fast pickup).
    this.drawFloaters();

    // Time-effect HUD: a small countdown bar at the top of the play area,
    // with an extra "{N}X · +M" line just under it while fast is active so
    // the player can see the multiplier and the running bonus pool grow.
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

      if (this.timeEffect === "fast") {
        const cx = this.boardOriginX + this.boardWidth / 2;
        const fontSize = Math.max(20, Math.round(this.hexSize * 1.05));
        ctx.save();
        ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(120, 255, 170, 0.95)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#c8ffd5";
        const label = `${this.fastMultiplier()}X · +${this.fastBonus}`;
        ctx.fillText(label, cx, y0 + 12);
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0, 60, 20, 0.85)";
        ctx.strokeText(label, cx, y0 + 12);
        ctx.restore();
      }
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

