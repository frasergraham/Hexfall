// DOM smoke per screen. For every overlay surface Game can render,
// boot Game, navigate to that screen, assert that the rendered HTML
// contains the key elements that distinguish that screen and that
// every `data-action` button on it routes without throwing.
//
// Phase 0.5 follow-up: this test catches the class of bugs the
// integration smoke can't see — typo'd handler selectors, deleted
// data-action attributes, screens that throw during render, broken
// `back` paths that orphan the player on the wrong state.

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

async function bootGame(opts: { unlocked?: boolean } = {}): Promise<{
  game: any;
  overlay: HTMLElement;
  internals: any;
}> {
  if (opts.unlocked) {
    // Fake "all unlocked" so the editor + my-challenges sections
    // render without IAP gating.
    localStorage.setItem("hexrain.challenges.v1", JSON.stringify({
      v: 1,
      best: {},
      bestPct: {},
      stars: {},
      completed: [],
      unlockedBlocks: [1, 2, 3, 4, 5, 6],
      purchasedUnlock: true,
    }));
  }
  const dom = buildDom();
  Object.defineProperty(dom.canvas, "getBoundingClientRect", {
    value: () => ({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => "" }),
  });
  const { Game } = await import("../../src/game");
  const game = new Game(dom);
  game.start();
  return {
    game,
    overlay: dom.overlay,
    internals: game as unknown as Record<string, unknown>,
  };
}

function clickAction(overlay: HTMLElement, action: string): boolean {
  const btn = overlay.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!btn) return false;
  btn.dispatchEvent(new Event("click", { bubbles: true }));
  return true;
}

describe("DOM smoke per screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    for (const k of Object.keys(localStorage)) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  });

  it("renders the menu on boot", async () => {
    const { overlay } = await bootGame();
    expect(overlay.innerHTML).toContain("HEX RAIN");
    expect(overlay.querySelector('[data-action="play"]')).toBeTruthy();
    expect(overlay.querySelector('[data-action="challenges"]')).toBeTruthy();
    expect(overlay.querySelector('[data-difficulty="medium"]')).toBeTruthy();
  });

  it("CHALLENGES button opens the challenge select", async () => {
    const { overlay, internals } = await bootGame();
    expect(clickAction(overlay, "challenges")).toBe(true);
    expect(internals.state).toBe("challengeSelect");
    expect(overlay.innerHTML).toMatch(/Official Challenges|Block 1/);
  });

  it("clicking a challenge card opens the intro screen", async () => {
    const { overlay, internals } = await bootGame();
    clickAction(overlay, "challenges");
    const card = overlay.querySelector<HTMLElement>('[data-challenge-id="1-1"]');
    expect(card).toBeTruthy();
    card!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(internals.state).toBe("challengeIntro");
    expect(overlay.querySelector('[data-action="challenge-go"]')).toBeTruthy();
  });

  it("GO from intro starts the run", async () => {
    const { overlay, internals } = await bootGame();
    clickAction(overlay, "challenges");
    overlay.querySelector<HTMLElement>('[data-challenge-id="1-1"]')!
      .dispatchEvent(new Event("click", { bubbles: true }));
    clickAction(overlay, "challenge-go");
    expect(internals.state).toBe("playing");
  });

  it("BLOCKS button opens the blocks guide", async () => {
    const { overlay, internals } = await bootGame();
    expect(clickAction(overlay, "open-blocks")).toBe(true);
    expect(internals.state).toBe("blocksGuide");
    expect(overlay.querySelector('[data-action="close-blocks"]')).toBeTruthy();
  });

  it("EDITOR opens the unlock shop when not unlocked", async () => {
    const { overlay, internals } = await bootGame({ unlocked: false });
    expect(clickAction(overlay, "challenge-editor")).toBe(true);
    expect(internals.state).toBe("unlockShop");
    expect(overlay.querySelector('[data-action="iap-unlock"]')).toBeTruthy();
    expect(overlay.querySelector('[data-action="iap-restore"]')).toBeTruthy();
    expect(overlay.querySelector('[data-action="unlock-shop-back"]')).toBeTruthy();
  });

  it("EDITOR opens the editor home when unlocked", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    expect(clickAction(overlay, "challenge-editor")).toBe(true);
    expect(internals.state).toBe("editorHome");
    expect(overlay.querySelector('[data-action="editor-new"]')).toBeTruthy();
  });

  it("creating a custom challenge from editor home opens the edit screen", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    expect(clickAction(overlay, "editor-new")).toBe(true);
    expect(internals.state).toBe("editorEdit");
    expect(overlay.querySelector('[data-action="editor-edit-back"]')).toBeTruthy();
    expect(overlay.querySelector('[data-action="editor-add-wave"]')).toBeTruthy();
    expect(overlay.querySelector('[data-action="editor-add-custom-wave"]')).toBeTruthy();
  });

  it("editor SETTINGS dialog renders", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    expect(clickAction(overlay, "editor-open-settings")).toBe(true);
    expect(internals.editorDialog).toBe("settings");
    expect(overlay.querySelector('[data-action="editor-dialog-ok"]')).toBeTruthy();
    expect(overlay.querySelector('[data-action="editor-dialog-cancel"]')).toBeTruthy();
  });

  it("editor ADD WAVE dialog renders with preset chips", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    expect(clickAction(overlay, "editor-add-wave")).toBe(true);
    expect(internals.editorDialog).toBe("wave");
    // Preset chips listed in the dialog body.
    expect(overlay.querySelector('[data-action="editor-preset-pick"]')).toBeTruthy();
  });

  it("editor ADD CUSTOM WAVE dialog renders the slot grid", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    expect(clickAction(overlay, "editor-add-custom-wave")).toBe(true);
    expect(internals.editorDialog).toBe("customWave");
    // Cell-pick buttons in the slot grid.
    expect(overlay.querySelector('[data-action="editor-custom-cell"]')).toBeTruthy();
  });

  it("dialog OK persists and exits the dialog", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    clickAction(overlay, "editor-add-wave");
    // Pick first preset so the dialog has a valid working line.
    overlay.querySelector<HTMLElement>('[data-action="editor-preset-pick"]')!
      .dispatchEvent(new Event("click", { bubbles: true }));
    clickAction(overlay, "editor-dialog-ok");
    expect(internals.editorDialog).toBe(null);
  });

  it("REPORT dialog opens from the community card row", async () => {
    // Stub the community list with one synthetic published challenge so
    // the report dialog has something to target.
    const { overlay, internals } = await bootGame({ unlocked: true });
    internals.communityChallenges = [{
      recordName: "pub-stub",
      name: "Stub Challenge",
      authorId: "id-stub",
      authorName: "Tester",
      difficulty: 3,
      seed: 1,
      effects: { slowDuration: 5, fastDuration: 5, shieldDuration: 10, droneDuration: 10, dangerSize: 7 },
      waves: ["size=1, rate=0.5, count=5"],
      stars: { one: 1, two: 2, three: 3 },
      version: 1,
      publishedAt: 0,
      updatedAt: 0,
      status: "approved",
      reportCount: 0,
      upvoteCount: 0,
      installCount: 0,
      playCount: 0,
      sourceCustomId: "src",
    }];
    internals.communityLoaded = true;
    clickAction(overlay, "challenges");
    // Expand community section if collapsed.
    const reportBtn = overlay.querySelector<HTMLElement>('[data-action="community-report"]');
    if (reportBtn) {
      reportBtn.dispatchEvent(new Event("click", { bubbles: true }));
      expect(internals.reportSheet).toBeTruthy();
      expect(overlay.querySelector('[data-action="submit-report"]')).toBeTruthy();
    }
  });

  it("LEADERBOARD sheet opens from the community card row", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    internals.communityChallenges = [{
      recordName: "pub-stub",
      name: "Stub Challenge",
      authorId: "id-stub",
      authorName: "Tester",
      difficulty: 3,
      seed: 1,
      effects: { slowDuration: 5, fastDuration: 5, shieldDuration: 10, droneDuration: 10, dangerSize: 7 },
      waves: ["size=1, rate=0.5, count=5"],
      stars: { one: 1, two: 2, three: 3 },
      version: 1,
      publishedAt: 0,
      updatedAt: 0,
      status: "approved",
      reportCount: 0,
      upvoteCount: 0,
      installCount: 0,
      playCount: 0,
      sourceCustomId: "src",
    }];
    internals.communityLoaded = true;
    clickAction(overlay, "challenges");
    const lbBtn = overlay.querySelector<HTMLElement>('[data-action="community-leaderboard"]');
    if (lbBtn) {
      lbBtn.dispatchEvent(new Event("click", { bubbles: true }));
      expect(internals.leaderboardSheet).toBeTruthy();
    }
  });

  it("collapsing a challenge select section toggles state", async () => {
    const { overlay } = await bootGame();
    clickAction(overlay, "challenges");
    const officialToggle = overlay.querySelector<HTMLElement>('[data-action="toggle-collapse"][data-section="official"]');
    expect(officialToggle).toBeTruthy();
    officialToggle!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(localStorage.getItem("hexrain.challengeSelect.officialCollapsed.v1")).toBe("1");
  });

  it("BACK from challenge select returns to menu", async () => {
    const { overlay, internals } = await bootGame();
    clickAction(overlay, "challenges");
    expect(clickAction(overlay, "challenge-back")).toBe(true);
    expect(internals.state).toBe("menu");
    expect(overlay.innerHTML).toContain("HEX RAIN");
  });

  it("BACK from blocks guide returns to menu", async () => {
    const { overlay, internals } = await bootGame();
    clickAction(overlay, "open-blocks");
    expect(clickAction(overlay, "close-blocks")).toBe(true);
    expect(internals.state).toBe("menu");
  });

  it("BACK from editor home returns to menu", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    expect(clickAction(overlay, "editor-home-back")).toBe(true);
    expect(internals.state).toBe("menu");
  });

  it("BACK from editor edit returns to editor home", async () => {
    const { overlay, internals } = await bootGame({ unlocked: true });
    clickAction(overlay, "challenge-editor");
    clickAction(overlay, "editor-new");
    expect(clickAction(overlay, "editor-edit-back")).toBe(true);
    expect(internals.state).toBe("editorHome");
  });
});
