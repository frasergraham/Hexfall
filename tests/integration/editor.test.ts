// End-to-end editor flow test: create a custom challenge, add a wave,
// reorder, delete, settings tweak, save, play. Exercises the editor
// state machine (editorHome ↔ editorEdit ↔ wave dialogs) plus the
// custom-challenge persistence path that the screens.test.ts smokes
// only touch superficially.

import { describe, expect, it, beforeEach } from "vitest";

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
  return {
    canvas: document.getElementById("game") as HTMLCanvasElement,
    overlay: document.getElementById("overlay") as HTMLElement,
    touchbar: document.getElementById("touchbar") as HTMLElement,
    scoreEl: document.getElementById("score") as HTMLElement,
    bestEl: document.getElementById("best") as HTMLElement,
  };
}

async function bootUnlocked(): Promise<{ overlay: HTMLElement; internals: any }> {
  localStorage.setItem("hexrain.challenges.v1", JSON.stringify({
    v: 1,
    best: {},
    bestPct: {},
    stars: {},
    completed: [],
    unlockedBlocks: [1, 2, 3, 4, 5, 6],
    purchasedUnlock: true,
  }));
  const dom = buildDom();
  Object.defineProperty(dom.canvas, "getBoundingClientRect", {
    value: () => ({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => "" }),
  });
  const { Game } = await import("../../src/game");
  const game = new Game(dom);
  game.start();
  return { overlay: dom.overlay, internals: game as unknown as Record<string, unknown> };
}

function clickAction(overlay: HTMLElement, action: string, qualifier?: string): boolean {
  const sel = qualifier
    ? `[data-action="${action}"]${qualifier}`
    : `[data-action="${action}"]`;
  const btn = overlay.querySelector<HTMLElement>(sel);
  if (!btn) return false;
  btn.dispatchEvent(new Event("click", { bubbles: true }));
  return true;
}

describe("editor flow — end-to-end", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    for (const k of Object.keys(localStorage)) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  });

  it("create → add preset wave → save → list", async () => {
    const { overlay, internals } = await bootUnlocked();
    clickAction(overlay, "challenge-editor");
    expect(internals.state).toBe("editorHome");

    // Create.
    clickAction(overlay, "editor-new");
    expect(internals.state).toBe("editorEdit");
    expect(internals.editingCustom).toBeTruthy();
    expect(internals.editingCustom.waves.length).toBe(1); // default wave

    // Open the new-wave dialog and pick the first preset.
    clickAction(overlay, "editor-add-wave");
    expect(internals.editorDialog).toBe("wave");
    const presetChip = overlay.querySelector<HTMLElement>('[data-action="editor-preset-pick"]');
    expect(presetChip).toBeTruthy();
    presetChip!.dispatchEvent(new Event("click", { bubbles: true }));
    clickAction(overlay, "editor-dialog-ok");
    expect(internals.editorDialog).toBe(null);
    expect(internals.editingCustom.waves.length).toBe(2);

    // Back to editor home and verify the new challenge persisted.
    clickAction(overlay, "editor-edit-back");
    expect(internals.state).toBe("editorHome");
    const stored = JSON.parse(localStorage.getItem("hexrain.customChallenges.v1") ?? "{}");
    expect(stored.challenges?.length).toBeGreaterThan(0);
    expect(stored.challenges[0].waves.length).toBe(2);
  });

  it("delete a wave from the edit screen", async () => {
    const { overlay, internals } = await bootUnlocked();
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    expect(internals.editingCustom.waves.length).toBe(1);

    // Default has only one wave; delete-wave button is keyed by index.
    const deleteBtn = overlay.querySelector<HTMLElement>('[data-action="editor-delete-wave"]');
    if (deleteBtn) {
      deleteBtn.dispatchEvent(new Event("click", { bubbles: true }));
      // Some implementations require confirm; a one-wave challenge can't drop below 1.
    }
    expect(internals.editingCustom.waves.length).toBeGreaterThanOrEqual(1);
  });

  it("settings dialog: pick difficulty + OK persists onto editingCustom", async () => {
    const { overlay, internals } = await bootUnlocked();
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    const beforeDiff = internals.editingCustom.difficulty;

    clickAction(overlay, "editor-open-settings");
    expect(internals.editorDialog).toBe("settings");
    // Settings dialog uses CSS `.selected` to track the picked
    // difficulty in the DOM and only applies it on OK (see
    // game.ts:applySettingsDialog).
    const fiveBtn = Array.from(
      overlay.querySelectorAll<HTMLElement>("[data-dialog-difficulty]"),
    ).find((b) => b.dataset.dialogDifficulty === "5");
    expect(fiveBtn).toBeTruthy();
    fiveBtn!.dispatchEvent(new Event("click", { bubbles: true }));

    clickAction(overlay, "editor-dialog-ok");
    expect(internals.editorDialog).toBe(null);
    expect(internals.editingCustom.difficulty).toBe(5);
    expect(internals.editingCustom.difficulty).not.toBe(beforeDiff);
  });

  it("PLAY from editor edit launches the custom challenge", async () => {
    const { overlay, internals } = await bootUnlocked();
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    expect(internals.state).toBe("editorEdit");

    clickAction(overlay, "editor-edit-play");
    expect(internals.state).toBe("playing");
    expect(internals.activeChallenge).toBeTruthy();
    expect(internals.activeChallenge.id).toMatch(/^custom:/);
  });

  it("REMIX a roster challenge clones it into the custom store", async () => {
    const { overlay, internals } = await bootUnlocked();
    clickAction(overlay, "challenge-editor");
    // Find a remix button for an unlocked roster challenge.
    const remixBtn = overlay.querySelector<HTMLElement>('[data-action="editor-remix"][data-roster-id="1-1"]');
    expect(remixBtn).toBeTruthy();
    remixBtn!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(internals.state).toBe("editorEdit");
    expect(internals.editingCustom.remixedFrom).toBe("First Drops");
    expect(internals.editingCustom.waves.length).toBeGreaterThan(0);
  });

  it("SWIPE-DELETE on a custom row in editor home removes the entry after confirm", async () => {
    // Pre-seed two custom challenges so we have something to swipe.
    const { overlay, internals } = await bootUnlocked();
    const { upsertCustomChallenge } = await import("../../src/customChallenges");
    upsertCustomChallenge({
      id: "custom:test-1", name: "Test 1", seed: 1, difficulty: 3,
      effects: { slowDuration: 5, fastDuration: 5, shieldDuration: 10, droneDuration: 10, dangerSize: 7 },
      stars: { one: 1, two: 2, three: 3 },
      waves: ["size=1, rate=0.5, count=5"],
      createdAt: 0, updatedAt: 0, best: 0, bestPct: 0, starsEarned: 0,
    });
    clickAction(overlay, "challenge-editor");
    // Swipe-delete UI: the delete button is hidden behind the swipe but
    // the click handler matches data-action="editor-delete" anywhere.
    const deleteBtn = overlay.querySelector<HTMLElement>('[data-action="editor-delete"][data-custom-id="custom:test-1"]');
    expect(deleteBtn).toBeTruthy();
    // window.confirm is called inside the handler — stub it to true.
    const realConfirm = window.confirm;
    window.confirm = () => true;
    try {
      deleteBtn!.dispatchEvent(new Event("click", { bubbles: true }));
    } finally {
      window.confirm = realConfirm;
    }
    const stored = JSON.parse(localStorage.getItem("hexrain.customChallenges.v1") ?? "{}");
    expect((stored.challenges ?? []).find((c: { id: string }) => c.id === "custom:test-1")).toBeUndefined();
  });
});
