import { FallingCluster, pickShape } from "./cluster";
import { SQRT3, axialToPixel } from "./hex";
import { bindInput, isTouchDevice } from "./input";
import { Player } from "./player";
import type { ClusterKind, GameState, InputAction } from "./types";

const HEX_SIZE_BASE = 22;
const BOARD_COLS = 9; // odd → integer center column
const BOARD_ROWS = 16;

const BASE_FALL_SPEED = 90; // px/sec
const SPEED_RAMP = 4; // px/sec per score
const MAX_FALL_SPEED = 360;

const SPAWN_INTERVAL_START = 1.6; // seconds
const SPAWN_INTERVAL_MIN = 0.7;
const SPAWN_INTERVAL_RAMP = 0.03; // seconds reduction per score

const DANGER_SIZE = 7;
const LOSE_COMBO = 2;
const STICK_INVULN_MS = 150;

const STICKY_SPAWN_CHANCE = 0.12;
const STICKY_MIN_SCORE = 3;

const HOLD_REPEAT_FIRST = 0.18; // seconds before auto-repeat starts
const HOLD_REPEAT_INTERVAL = 0.09; // seconds between auto-repeats

interface HoldState {
  active: boolean;
  initialFired: boolean;
  timer: number;
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

  private clusters: FallingCluster[] = [];
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
    left: { active: false, initialFired: false, timer: 0 },
    right: { active: false, initialFired: false, timer: 0 },
    rotateCw: { active: false, initialFired: false, timer: 0 },
    rotateCcw: { active: false, initialFired: false, timer: 0 },
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

    this.player = new Player({ baseX: 0, y: 0, hexSize: this.hexSize });

    this.resize();
    window.addEventListener("resize", () => this.resize());

    if (isTouchDevice()) this.touchbar.classList.add("show");
    this.touchbar.setAttribute("aria-hidden", "false");

    this.unbindInput = bindInput(this.touchbar, (action, pressed) =>
      this.onInput(action, pressed),
    );

    // Tap on overlay starts/restarts or resumes from pause.
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
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.unbindInput?.();
  }

  private startOrRestart(): void {
    this.score = 0;
    this.comboHits = 0;
    this.spawnTimer = 0;
    this.clusters = [];
    this.player = new Player({
      baseX: this.boardOriginX + this.boardWidth / 2,
      y: this.playerY,
      hexSize: this.hexSize,
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
        if (pressed) {
          this.applyMove(-1);
          this.holds.left.initialFired = true;
          this.holds.left.timer = 0;
        } else {
          this.holds.left.initialFired = false;
        }
        break;
      case "right":
        this.holds.right.active = pressed;
        if (pressed) {
          this.applyMove(1);
          this.holds.right.initialFired = true;
          this.holds.right.timer = 0;
        } else {
          this.holds.right.initialFired = false;
        }
        break;
      case "rotateCw":
        this.holds.rotateCw.active = pressed;
        if (pressed) {
          this.player.rotate(1);
          this.holds.rotateCw.initialFired = true;
          this.holds.rotateCw.timer = 0;
        } else {
          this.holds.rotateCw.initialFired = false;
        }
        break;
      case "rotateCcw":
        this.holds.rotateCcw.active = pressed;
        if (pressed) {
          this.player.rotate(-1);
          this.holds.rotateCcw.initialFired = true;
          this.holds.rotateCcw.timer = 0;
        } else {
          this.holds.rotateCcw.initialFired = false;
        }
        break;
    }
  }

  private applyMove(delta: number): void {
    const half = Math.floor(BOARD_COLS / 2);
    this.player.tryMove(delta, -half, half);
  }

  private update(dt: number): void {
    if (this.state !== "playing") return;

    // Hold-to-repeat for movement & rotation.
    for (const key of ["left", "right", "rotateCw", "rotateCcw"] as const) {
      const h = this.holds[key];
      if (!h.active) continue;
      h.timer += dt;
      const interval = h.initialFired ? HOLD_REPEAT_FIRST : HOLD_REPEAT_INTERVAL;
      if (h.timer >= interval) {
        h.timer = 0;
        h.initialFired = false;
        if (key === "left") this.applyMove(-1);
        else if (key === "right") this.applyMove(1);
        else if (key === "rotateCw") this.player.rotate(1);
        else this.player.rotate(-1);
      }
    }

    this.player.inDanger = this.player.size() >= DANGER_SIZE;
    this.player.update(dt);

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

    // Update clusters.
    const playerBottom = this.playerY + this.hexSize;
    for (const c of this.clusters) {
      c.update(dt);
      if (!c.scored && c.alive && !c.contacted) {
        // Check pass: if cluster's topmost cell is below the player's center,
        // it has passed without contact.
        let topY = Infinity;
        for (const cell of c.cells) {
          const p = c.cellCenter(cell, this.hexSize);
          if (p.y < topY) topY = p.y;
        }
        if (topY > playerBottom + this.hexSize * 0.5) {
          c.scored = true;
          this.score += 1;
          this.comboHits = 0;
          this.scoreEl.textContent = String(this.score);
        }
      }
      // Despawn off-bottom.
      if (c.bottomY(this.hexSize) > this.boardOriginY + this.boardHeight + this.hexSize * 2) {
        c.alive = false;
      }
    }

    // Collisions (only if not invuln).
    if (this.player.invulnTimer <= 0) {
      this.handleCollisions();
    }

    // Cleanup dead clusters.
    this.clusters = this.clusters.filter((c) => c.alive);
  }

  private handleCollisions(): void {
    const sz = this.hexSize;
    const contactDist = sz * 0.95 * 2; // sum of radii
    const playerCells = this.player.cellCenters();

    for (const cluster of this.clusters) {
      if (!cluster.alive || cluster.contacted) continue;

      // Find closest cluster-cell to any player-cell.
      let bestCluster: { cell: { q: number; r: number }; cx: number; cy: number; px: number; py: number; dist: number } | null = null;
      for (const cc of cluster.cells) {
        const cp = cluster.cellCenter(cc, sz);
        for (const pc of playerCells) {
          const d = Math.hypot(cp.x - pc.x, cp.y - pc.y);
          if (d < contactDist && (!bestCluster || d < bestCluster.dist)) {
            bestCluster = { cell: cc, cx: cp.x, cy: cp.y, px: pc.x, py: pc.y, dist: d };
          }
        }
      }
      if (!bestCluster) continue;

      cluster.contacted = true;
      this.player.invulnTimer = STICK_INVULN_MS / 1000;

      if (cluster.kind === "normal") {
        // Touching hex sticks; remove it from cluster, rest keeps falling.
        const added = this.player.addHexAt(bestCluster.cx, bestCluster.cy);
        cluster.removeCell(bestCluster.cell);
        if (added) {
          this.comboHits += 1;
          if (
            this.player.size() >= DANGER_SIZE &&
            this.comboHits >= LOSE_COMBO
          ) {
            this.endGame();
            return;
          }
        }
      } else {
        // Sticky cluster: rip one of player's hexes off.
        if (this.player.size() > 1) {
          this.player.removeNearestCell(bestCluster.cx, bestCluster.cy);
          this.comboHits = 0;
        }
        cluster.alive = false;
      }
    }
  }

  private spawnCluster(): void {
    const shape = pickShape(Math.random);

    let kind: ClusterKind = "normal";
    if (this.score >= STICKY_MIN_SCORE && Math.random() < STICKY_SPAWN_CHANCE) {
      kind = "sticky";
    }

    // Pick a spawn column within board bounds. Compute pixel x for that column.
    const half = Math.floor(BOARD_COLS / 2);
    const colStep = Math.floor(Math.random() * (half * 2 + 1)) - half;
    const colWidth = SQRT3 * this.hexSize;
    const x = this.boardOriginX + this.boardWidth / 2 + colStep * colWidth;

    // Spawn above the top so cluster eases into view.
    const y = this.boardOriginY - this.hexSize * 4;

    const speed = Math.min(
      MAX_FALL_SPEED,
      BASE_FALL_SPEED + this.score * SPEED_RAMP,
    );

    this.clusters.push(
      new FallingCluster({ shape, x, y, speed, kind }),
    );
  }

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

    // Compute hex size to fit BOARD_COLS columns + a little margin.
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

    this.player.setHexSize(this.hexSize);
    this.player.setBaseX(this.boardOriginX + this.boardWidth / 2);
    this.player.setY(this.playerY);
    // Snap rendered position so the player doesn't lerp from a stale x after
    // the canvas has been resized (e.g. on first layout / orientation change).
    this.player.x = this.player.targetX();
  }

  private render(): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Board background.
    ctx.fillStyle = "#0e1124";
    ctx.fillRect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);

    // Subtle hex grid backdrop.
    this.drawGridBackdrop();

    // Bottom danger line.
    ctx.strokeStyle = "rgba(180, 200, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.boardOriginX, this.playerY + this.hexSize * 1.1);
    ctx.lineTo(this.boardOriginX + this.boardWidth, this.playerY + this.hexSize * 1.1);
    ctx.stroke();

    for (const c of this.clusters) c.draw(ctx, this.hexSize);
    this.player.draw(ctx);
  }

  private drawGridBackdrop(): void {
    const ctx = this.ctx;
    const sz = this.hexSize;
    ctx.save();
    ctx.translate(this.boardOriginX + this.boardWidth / 2, this.boardOriginY);
    ctx.strokeStyle = "rgba(120, 140, 200, 0.05)";
    ctx.lineWidth = 1;
    const half = Math.floor(BOARD_COLS / 2);
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let q = -half; q <= half; q++) {
        const local = axialToPixel({ q: q - Math.floor(r / 2), r }, sz);
        // Draw a faint hex outline.
        const cx = local.x;
        const cy = local.y + sz;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 180) * (60 * i - 30);
          const x = cx + sz * Math.cos(angle);
          const y = cy + sz * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
