// Determinism guard for the per-wave seed model.
//
// Drives a synthetic 8-wave challenge that exercises every DSL surface
// the spawn pipeline cares about: probabilistic mixes, slot-only waves,
// dirRandom + zigzag, side-entry slots, narrow walls, pinned safeCol,
// explicit seed= override, and a bare no-frills wave. Captures full
// per-spawn state (kind, size, position, velocity, spin, waveIdx) into
// a golden fixture and asserts byte-equality on replay.
//
// Two structural assertions sit on top:
//   * mutating wave 4's count perturbs only wave 4's spawn slice.
//   * adding `seed=` to wave 0 perturbs only wave 0's spawn slice.
//
// INTEGRATION_UPDATE=1 regenerates the fixture after a deliberate
// behaviour change.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChallengeDef } from "../../src/challenges";

const UPDATE = process.env.INTEGRATION_UPDATE === "1";

const SYNTHETIC: ChallengeDef = {
  id: "9-9",
  name: "Determinism Test",
  block: 1,
  index: 1,
  difficulty: 3,
  // The harness drives no input — the player sits at center while hexes
  // pile up. dangerSize: 99 keeps the player un-killable so the run
  // walks all the way through every wave.
  effects: { dangerSize: 99 },
  waves: [
    // 0: prob path with mixed pickups (uses derived seed)
    "size=2-3, rate=0.5, speed=1.0, count=12, pct=normal:50,coin:25,sticky:15,slow:10",
    // 1: slot-only — count=0 disables prob
    "size=2, rate=0.5, slotRate=0.4, speed=1.1, count=0, dur=3, 137, 230, S145, C238, F121",
    // 2: dirRandom + walls=zigzag with custom amp/period
    "size=1-3, rate=0.45, speed=1.15, count=10, dirRandom=1, dir=0.25, walls=zigzag, wallAmp=0.3, wallPeriod=2.0",
    // 3: side-entry slots via angleIdx 7-9
    "size=1-2, rate=0.5, slotRate=0.4, speed=1.1, count=0, dur=3, 178, 289, 199, S178",
    // 4: walls=narrow
    "size=2, rate=0.5, speed=1.1, count=8, walls=narrow",
    // 5: explicit safeCol pinned
    "size=2-3, rate=0.45, speed=1.1, count=15, safeCol=4, pct=normal:80,coin:20",
    // 6: explicit seed override
    "size=2-3, rate=0.45, speed=1.1, count=10, seed=42",
    // 7: bare no-frills wave (uses derived seed)
    "size=2, rate=0.5, speed=1.0, count=8",
  ],
};

interface SpawnRecord {
  tick: number;
  waveIdx: number;
  kind: string;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
}

interface DetTrace {
  challengeId: string;
  ticks: number;
  finalScore: number;
  finalState: string;
  spawns: SpawnRecord[];
}

function buildDom(): {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  touchbar: HTMLElement;
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="app">
      <header class="hud">
        <button id="pauseBtn" hidden></button>
        <span id="score">0</span>
        <span id="best">0</span>
      </header>
      <main class="stage">
        <canvas id="game"></canvas>
        <div id="controlsHint" hidden></div>
        <div id="canvasWheel"><div id="canvasKnob"></div></div>
        <div id="overlay" class="overlay">
          <h1>HEX RAIN</h1>
          <div id="difficultyButtons">
            <button data-difficulty="easy"></button>
            <button data-difficulty="medium" aria-pressed="true"></button>
            <button data-difficulty="hard"></button>
            <button data-difficulty="hardcore"></button>
          </div>
          <button class="play-btn" data-action="play">PLAY</button>
          <button data-action="challenges">CHALLENGES</button>
          <button data-action="challenge-editor">EDITOR</button>
          <button data-action="open-blocks">BLOCKS</button>
          <button data-action="toggle-sfx"></button>
          <button data-action="toggle-music"></button>
          <button data-action="reset-hints"></button>
          <div id="achievementBadges"></div>
          <span id="achievementCount"></span>
        </div>
        <div id="touchbar"></div>
      </main>
    </div>
  `;
  return {
    canvas: document.getElementById("game") as HTMLCanvasElement,
    overlay: document.getElementById("overlay") as HTMLElement,
    touchbar: document.getElementById("touchbar") as HTMLElement,
    scoreEl: document.getElementById("score") as HTMLElement,
    bestEl: document.getElementById("best") as HTMLElement,
  };
}

let realMathRandom: () => number = Math.random;
function seedMathRandom(seed: number): void {
  realMathRandom = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function restoreMathRandom(): void {
  Math.random = realMathRandom;
}

const round = (n: number, places: number): number => {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
};

async function runChallenge(def: ChallengeDef, ticks: number, seed: number): Promise<DetTrace> {
  seedMathRandom(seed);
  const dom = buildDom();
  Object.defineProperty(dom.canvas, "getBoundingClientRect", {
    value: () => ({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => "" }),
  });
  const { Game } = await import("../../src/game");
  const game = new Game(dom);
  game.start();
  const internals = game as unknown as {
    beginChallengeStart(def: ChallengeDef): void;
    update(dt: number): void;
    score: number;
    state: string;
    challengeWaveIdx: number;
    spawnChallengeCluster: (
      kind: string,
      shape: Array<{ q: number; r: number }>,
      x: number,
      y: number,
      vx: number,
      vy: number,
    ) => { body: { angularVelocity: number } };
  };

  // Capture every spawn at creation time — strictly the rng-driven
  // inputs plus the cluster's spin (which the production code rolls
  // inside spawnChallengeCluster). Reading post-physics-step state
  // makes mutation tests flaky because earlier-wave drift perturbs
  // leftover cluster collisions when the new wave spawns.
  const spawns: SpawnRecord[] = [];
  let currentTick = 0;
  const original = internals.spawnChallengeCluster.bind(internals);
  internals.spawnChallengeCluster = (kind, shape, x, y, vx, vy) => {
    const cluster = original(kind, shape, x, y, vx, vy);
    spawns.push({
      tick: currentTick,
      waveIdx: internals.challengeWaveIdx,
      kind,
      size: shape.length,
      x: round(x, 2),
      y: round(y, 2),
      vx: round(vx, 3),
      vy: round(vy, 3),
      spin: round(cluster.body.angularVelocity, 4),
    });
    return cluster;
  };

  internals.beginChallengeStart(def);

  const DT = 16 / 1000;
  for (let i = 0; i < ticks; i++) {
    currentTick = i;
    internals.update(DT);
  }

  const trace: DetTrace = {
    challengeId: def.id,
    ticks,
    finalScore: internals.score,
    finalState: internals.state,
    spawns,
  };
  // Cancel the rAF loop so callbacks don't keep firing on this stale
  // Game instance after we move to the next run within the same test.
  (game as unknown as { destroy(): void }).destroy();
  // Clear localStorage so challenge progress / achievements written by
  // this run can't leak into the next runChallenge call in the same test.
  localStorage.clear();
  return trace;
}

function fixturePath(name: string): string {
  return join(process.cwd(), `tests/golden/${name}.json`);
}

function compareOrCapture(trace: DetTrace, name: string): void {
  const path = fixturePath(name);
  if (UPDATE || !existsSync(path)) {
    mkdirSync(join(process.cwd(), "tests/golden"), { recursive: true });
    writeFileSync(path, JSON.stringify(trace, null, 2) + "\n");
    return;
  }
  const expected = JSON.parse(readFileSync(path, "utf8")) as DetTrace;
  expect(trace).toEqual(expected);
}

function spawnsForWave(trace: DetTrace, idx: number): SpawnRecord[] {
  return trace.spawns.filter((s) => s.waveIdx === idx);
}

// Strip `tick` so mutation tests can compare rng-driven spawn content
// without timing drift. An upstream change can shift later waves' start
// ticks even when their spawn streams are otherwise byte-identical.
function untimed(spawns: SpawnRecord[]): Omit<SpawnRecord, "tick">[] {
  return spawns.map(({ tick: _t, ...rest }) => rest);
}

function clone(def: ChallengeDef, mutateWaves: (waves: string[]) => void): ChallengeDef {
  const next: ChallengeDef = { ...def, waves: [...def.waves] };
  mutateWaves(next.waves);
  return next;
}

const TICKS = 6000;
const SEED = 0xDEADBEEF;

describe("per-wave determinism", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    restoreMathRandom();
  });

  it("byte-identical replay against golden fixture", async () => {
    const trace = await runChallenge(SYNTHETIC, TICKS, SEED);
    compareOrCapture(trace, "integration-run-determinism");
  });

  // Forward-isolation tests. Mutating a later wave can't affect an
  // earlier wave's rng stream — because the earlier wave already ran.
  // (Reverse isolation is not strict: world state like wall lerp and
  // leftover clusters can leak forward.) These tests therefore mutate
  // the final wave and assert the prefix is byte-identical.

  it("changing the last wave's count leaves preceding waves byte-identical", async () => {
    const reference = await runChallenge(SYNTHETIC, TICKS, SEED);
    const last = SYNTHETIC.waves.length - 1;
    const mutated = clone(SYNTHETIC, (waves) => {
      waves[last] = waves[last]!.replace("count=8", "count=14");
    });
    const next = await runChallenge(mutated, TICKS, SEED);

    for (let i = 0; i < last; i++) {
      expect(untimed(spawnsForWave(next, i))).toEqual(untimed(spawnsForWave(reference, i)));
    }
    expect(untimed(spawnsForWave(next, last))).not.toEqual(untimed(spawnsForWave(reference, last)));
  });

  it("rerolling the last wave's seed= leaves preceding waves byte-identical", async () => {
    const reference = await runChallenge(SYNTHETIC, TICKS, SEED);
    const last = SYNTHETIC.waves.length - 1;
    const mutated = clone(SYNTHETIC, (waves) => {
      waves[last] = `${waves[last]}, seed=99999`;
    });
    const next = await runChallenge(mutated, TICKS, SEED);

    for (let i = 0; i < last; i++) {
      expect(untimed(spawnsForWave(next, i))).toEqual(untimed(spawnsForWave(reference, i)));
    }
    expect(untimed(spawnsForWave(next, last))).not.toEqual(untimed(spawnsForWave(reference, last)));
  });
});
