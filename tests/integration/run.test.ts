// Integration smoke test — boots Game in jsdom and drives a
// deterministic run, capturing score, state, and spawn order into a
// golden fixture. The plan calls this out as the load-bearing safety
// net for Phase 2 + Phase 3 refactors: any change that perturbs the
// captured trace fails this test.
//
// Approach: drive a CHALLENGE run (which uses seeded mulberry32 keyed
// on the challenge id, giving deterministic spawns) rather than
// endless (which uses Math.random). 200 simulated frames at 16ms
// each = ~3.2 seconds of game time.

import { describe, expect, it, beforeEach } from "vitest";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Set INTEGRATION_UPDATE=1 to regenerate the golden fixtures after a
// deliberate behaviour change (with a written justification in the
// PR description, per REFACTOR.md's prime directive).
const UPDATE = process.env.INTEGRATION_UPDATE === "1";

interface RunTrace {
  challengeId: string;
  ticks: number;
  dtMs: number;
  finalScore: number;
  finalState: string;
  /** Length of cluster array at each tick that has at least one cluster. */
  clusterCountTimeline: number[];
  /** "{tick}:{kind}" entries when a new cluster appeared (kind diffed by id presence). */
  spawnOrder: string[];
  /** Distinct states traversed during the run, in order of first appearance. */
  stateTransitions: string[];
  /** Player size at every tick. */
  playerSizeTimeline: number[];
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

// Seed Math.random with a deterministic stream so cosmetic uses
// (debris impulses, floater jitter, starfield positions) don't leak
// nondeterminism into the trace. Restored in afterEach.
let realMathRandom: () => number = Math.random;
function seedMathRandom(seed: number): () => number {
  realMathRandom = Math.random;
  let state = seed >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = rng;
  return rng;
}
function restoreMathRandom(): void {
  Math.random = realMathRandom;
}

async function runChallenge(challengeId: string, ticks: number, seed: number): Promise<RunTrace> {
  seedMathRandom(seed);
  const dom = buildDom();
  Object.defineProperty(dom.canvas, "getBoundingClientRect", {
    value: () => ({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => "" }),
  });
  const { Game } = await import("../../src/game");
  const { challengeById } = await import("../../src/challenges");
  const def = challengeById(challengeId);
  if (!def) throw new Error(`Challenge ${challengeId} missing`);
  const game = new Game(dom);
  game.start();
  const internals = game as unknown as {
    beginChallengeStart(def: typeof def): void;
    update(dt: number): void;
    score: number;
    state: string;
    clusters: Array<{ body: { id: number }; kind: string }>;
    player: { size(): number };
  };
  internals.beginChallengeStart(def);

  const DT = 16 / 1000;
  const trace: RunTrace = {
    challengeId,
    ticks,
    dtMs: 16,
    finalScore: 0,
    finalState: "",
    clusterCountTimeline: [],
    spawnOrder: [],
    stateTransitions: [],
    playerSizeTimeline: [],
  };
  let lastState = "";
  const seenBodyIds = new Set<number>();
  for (let i = 0; i < ticks; i++) {
    internals.update(DT);
    trace.clusterCountTimeline.push(internals.clusters.length);
    trace.playerSizeTimeline.push(internals.player.size());
    if (internals.state !== lastState) {
      trace.stateTransitions.push(`${i}:${internals.state}`);
      lastState = internals.state;
    }
    for (const c of internals.clusters) {
      if (!seenBodyIds.has(c.body.id)) {
        seenBodyIds.add(c.body.id);
        trace.spawnOrder.push(`${i}:${c.kind}`);
      }
    }
  }
  trace.finalScore = internals.score;
  trace.finalState = internals.state;
  return trace;
}

function fixturePath(name: string): string {
  return join(process.cwd(), `tests/golden/${name}.json`);
}

function compareOrCapture(trace: RunTrace, name: string): void {
  const path = fixturePath(name);
  if (UPDATE || !existsSync(path)) {
    mkdirSync(join(process.cwd(), "tests/golden"), { recursive: true });
    writeFileSync(path, JSON.stringify(trace, null, 2) + "\n");
    console.log(`[integration] wrote fixture: ${path}`);
    return;
  }
  const expected = JSON.parse(readFileSync(path, "utf8")) as RunTrace;
  expect(trace).toEqual(expected);
}

describe("integration smoke — deterministic challenge runs", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("Challenge 1-1 (First Drops) — 600 ticks, gentle intro", async () => {
    try {
      const trace = await runChallenge("1-1", 600, 0xc0ffee);
      compareOrCapture(trace, "integration-run-1-1");
    } finally {
      restoreMathRandom();
    }
  });

  it("Challenge 2-1 (Squeeze Play) — 600 ticks, walls=pinch", async () => {
    try {
      const trace = await runChallenge("2-1", 600, 0xfee1ed);
      compareOrCapture(trace, "integration-run-2-1");
    } finally {
      restoreMathRandom();
    }
  });

  it("Challenge 3-3 (Heal & Hope) — 600 ticks, sticky-heavy", async () => {
    try {
      const trace = await runChallenge("3-3", 600, 0xbadcab);
      compareOrCapture(trace, "integration-run-3-3");
    } finally {
      restoreMathRandom();
    }
  });

});
