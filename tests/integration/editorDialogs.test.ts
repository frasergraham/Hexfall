// Round-trip tests for the editor wave dialog and custom-wave dialog.
// Pinned BEFORE extracting these screens so the extraction can't quietly
// regress: open dialog → mutate state via clicks → save → assert the
// composed DSL line on editingCustom.waves matches expectations.

import { describe, expect, it, beforeEach } from "vitest";

function buildDom() {
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
            <button data-difficulty="medium" aria-pressed="true"></button>
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
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => "" }),
  });
  return {
    canvas,
    overlay: document.getElementById("overlay") as HTMLElement,
    touchbar: document.getElementById("touchbar") as HTMLElement,
    scoreEl: document.getElementById("score") as HTMLElement,
    bestEl: document.getElementById("best") as HTMLElement,
  };
}

async function bootUnlocked() {
  localStorage.setItem("hexrain.challenges.v1", JSON.stringify({
    v: 1, best: {}, bestPct: {}, stars: {}, completed: [],
    unlockedBlocks: [1, 2, 3, 4, 5, 6], purchasedUnlock: true,
  }));
  const dom = buildDom();
  const { Game } = await import("../../src/game");
  const game = new Game(dom);
  game.start();
  return { overlay: dom.overlay, internals: game as unknown as Record<string, any> };
}

function click(overlay: HTMLElement, sel: string): boolean {
  const el = overlay.querySelector<HTMLElement>(sel);
  if (!el) return false;
  el.dispatchEvent(new Event("click", { bubbles: true }));
  return true;
}

describe("wave dialog — cluster mix round-trip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    for (const k of Object.keys(localStorage)) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  });

  it("bumping coin up from the calm-preset baseline saves the new mix", async () => {
    const { overlay, internals } = await bootUnlocked();
    click(overlay, '[data-action="challenge-editor"]');
    click(overlay, '[data-action="editor-new"]');
    click(overlay, '[data-action="editor-add-wave"]');
    expect(internals.editorDialog).toBe("wave");

    // openNewWaveDialog seeds from WAVE_PRESETS[0] (calm: normal=75, coin=25).
    expect(internals.editorDialogPctValues.coin).toBe(25);
    expect(internals.editorDialogPctValues.normal).toBe(75);

    // Two +5 bumps on coin → coin=35, normal=65.
    const plus = overlay.querySelector<HTMLElement>(
      '[data-action="editor-mix-bump"][data-kind="coin"][data-delta="5"]',
    );
    plus!.dispatchEvent(new Event("click", { bubbles: true }));
    // The dialog re-renders after each bump, so re-query the button.
    const plus2 = overlay.querySelector<HTMLElement>(
      '[data-action="editor-mix-bump"][data-kind="coin"][data-delta="5"]',
    );
    plus2!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(internals.editorDialogPctValues.coin).toBe(35);
    expect(internals.editorDialogPctValues.normal).toBe(65);

    click(overlay, '[data-action="editor-dialog-ok"]');
    expect(internals.editorDialog).toBe(null);
    const lastLine: string = internals.editingCustom.waves.at(-1);
    expect(lastLine).toMatch(/coin:35/);
    expect(lastLine).toMatch(/normal:65/);
  });

  it("bumping a kind below zero is clamped (no underflow into normal)", async () => {
    const { overlay, internals } = await bootUnlocked();
    click(overlay, '[data-action="challenge-editor"]');
    click(overlay, '[data-action="editor-new"]');
    click(overlay, '[data-action="editor-add-wave"]');
    // coin starts at 25 (calm preset). Six -5 clicks should clamp at 0
    // (refunding the right amount to normal each step).
    for (let i = 0; i < 6; i++) {
      const minus = overlay.querySelector<HTMLElement>(
        '[data-action="editor-mix-bump"][data-kind="coin"][data-delta="-5"]',
      );
      if (!minus) break;
      minus.dispatchEvent(new Event("click", { bubbles: true }));
    }
    expect(internals.editorDialogPctValues.coin).toBe(0);
    expect(internals.editorDialogPctValues.normal).toBe(100);
  });

  it("OK without any mix bumps writes a wave line that parses cleanly", async () => {
    const { overlay, internals } = await bootUnlocked();
    click(overlay, '[data-action="challenge-editor"]');
    click(overlay, '[data-action="editor-new"]');
    const beforeLen = internals.editingCustom.waves.length;
    click(overlay, '[data-action="editor-add-wave"]');
    click(overlay, '[data-action="editor-dialog-ok"]');
    expect(internals.editingCustom.waves.length).toBe(beforeLen + 1);
    const lastLine: string = internals.editingCustom.waves.at(-1);
    const { parseWaveLine } = await import("../../src/waveDsl");
    expect(() => parseWaveLine(lastLine)).not.toThrow();
  });
});

describe("custom wave dialog — slot grid round-trip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    for (const k of Object.keys(localStorage)) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  });

  it("placing a normal hex in column 3 saves a slot wave with that token", async () => {
    const { overlay, internals } = await bootUnlocked();
    click(overlay, '[data-action="challenge-editor"]');
    click(overlay, '[data-action="editor-new"]');
    click(overlay, '[data-action="editor-add-custom-wave"]');
    expect(internals.editorDialog).toBe("customWave");

    // Place a hex at row 0, main col 3.
    const cell = overlay.querySelector<HTMLElement>(
      '[data-action="editor-custom-cell"][data-row="0"][data-col="3"]:not([data-side])',
    );
    expect(cell).toBeTruthy();
    cell!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(internals.editorCustomWaveSlots[0]).toBeTruthy();
    expect(internals.editorCustomWaveSlots[0].col).toBe(3);

    click(overlay, '[data-action="editor-dialog-ok"]');
    expect(internals.editorDialog).toBe(null);
    const lastLine: string = internals.editingCustom.waves.at(-1);
    // Slot waves disable probabilistic spawn (count=0) and emit a token
    // sequence. The token for size 1, col 3, angle 0 is "130".
    expect(lastLine).toMatch(/count=0/);
    expect(lastLine).toMatch(/130/);
  });

  it("changing the kind palette then placing emits a kind-prefixed slot", async () => {
    const { overlay, internals } = await bootUnlocked();
    click(overlay, '[data-action="challenge-editor"]');
    click(overlay, '[data-action="editor-new"]');
    click(overlay, '[data-action="editor-add-custom-wave"]');

    // Pick coin from the palette, then place at row 0 col 0.
    click(overlay, '[data-action="editor-custom-kind"][data-kind="coin"]');
    expect(internals.editorCustomWaveKind).toBe("coin");
    const cell = overlay.querySelector<HTMLElement>(
      '[data-action="editor-custom-cell"][data-row="0"][data-col="0"]:not([data-side])',
    );
    cell!.dispatchEvent(new Event("click", { bubbles: true }));

    click(overlay, '[data-action="editor-dialog-ok"]');
    const lastLine: string = internals.editingCustom.waves.at(-1);
    // Coin token uses "C" prefix per the wave DSL.
    expect(lastLine).toMatch(/C100/);
  });

  it("OK on an empty grid still writes a parseable wave", async () => {
    const { overlay, internals } = await bootUnlocked();
    click(overlay, '[data-action="challenge-editor"]');
    click(overlay, '[data-action="editor-new"]');
    const beforeLen = internals.editingCustom.waves.length;
    click(overlay, '[data-action="editor-add-custom-wave"]');
    click(overlay, '[data-action="editor-dialog-ok"]');
    // Empty grid → no slots. applyCustomWaveDialog may reject this OR
    // produce a do-nothing wave. Either is acceptable behavior, but
    // editingCustom shouldn't end up corrupted.
    const after = internals.editingCustom.waves.length;
    expect(after === beforeLen || after === beforeLen + 1).toBe(true);
    if (after > beforeLen) {
      const { parseWaveLine } = await import("../../src/waveDsl");
      expect(() => parseWaveLine(internals.editingCustom.waves.at(-1))).not.toThrow();
    }
  });
});
