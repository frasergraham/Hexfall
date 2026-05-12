// Blocks guide screen: a static reference list of every cluster kind
// with its name, an icon, and a one-line behaviour blurb. Uses the
// shared challenge-select-top dialog header so the BACK button styles
// match the rest of the app.
//
// Phase 2.3 of the refactor.

import { drawBlockIcon } from "../components/blockIcon";
import { escapeHtml } from "../escape";
import type { Screen } from "../Screen";
import type { ClusterKind } from "../../types";

interface Entry {
  kind: ClusterKind;
  name: string;
  desc: string;
}

const ENTRIES: ReadonlyArray<Entry> = [
  { kind: "normal",  name: "AVOID",   desc: "Sticks one cell onto your blob on contact and starts your danger combo." },
  { kind: "coin",    name: "COLLECT", desc: "Pick up for +5 score." },
  { kind: "sticky",  name: "HEAL",    desc: "An N-cell heal rips N-1 hexes off your blob, shrinking you back down." },
  { kind: "slow",    name: "SLOW",    desc: "Slows the game to 0.5× — easier dodging." },
  { kind: "fast",    name: "FAST",    desc: "Speeds the game up. Passes bank a 3X bonus pool — survive the timer to cash it in, blue hits forfeit it. Each restack: more speed and +1X." },
  { kind: "shield",  name: "SHIELD",  desc: "Wraps you in a bubble that absorbs blue hits at 1 second per hit. Sticky still rips." },
  { kind: "drone",   name: "DRONE",   desc: "Spawns a mid-screen sentinel that shatters blue clusters on contact." },
  { kind: "tiny",    name: "TINY",    desc: "Shrinks you to half size — much smaller hitbox. Re-hit while tiny banks +2 and refreshes the timer." },
  { kind: "big",     name: "BIG",     desc: "Grows you and banks a 3X bonus pool like FAST. Survive the timer to cash in, blue hits forfeit. Each restack: more size and +1X." },
];

export const BlocksGuide: Screen<void> = {
  render() {
    const cards = ENTRIES.map((e) => `
      <div class="blocks-card">
        <canvas class="blocks-icon" data-block-icon="${e.kind}" width="72" height="72"></canvas>
        <div class="blocks-text">
          <div class="blocks-name">${e.name}</div>
          <div class="blocks-desc">${escapeHtml(e.desc)}</div>
        </div>
      </div>
    `).join("");
    return `
      <div class="blocks-guide">
        <div class="challenge-select-top">
          <button type="button" class="challenge-back" data-action="close-blocks">← Back</button>
          <span class="challenge-select-title">Blocks</span>
          <span class="challenge-select-spacer" aria-hidden="true"></span>
        </div>
        <div class="blocks-list">
          ${cards}
        </div>
      </div>
    `;
  },
  bind(root) {
    // Each cluster-kind card has a tiny canvas; paint it from the
    // shared blockIcon helper so the guide stays in sync with the
    // in-game cluster look.
    const canvases = root.querySelectorAll<HTMLCanvasElement>("canvas[data-block-icon]");
    canvases.forEach((c) => {
      const kind = c.dataset.blockIcon as ClusterKind | undefined;
      if (kind) drawBlockIcon(c, kind);
    });
  },
};
