// Game-over screen — two flavours: the endless-mode wreckage screen
// (PLAY AGAIN + difficulty picker + achievements) and the challenge
// gameover (RETRY + back-to-challenges + main-menu). Phase 2.x.

import { escapeHtml } from "../escape";
import type { Screen } from "../Screen";

export interface GameOverProps {
  /** "challenge" → render the per-challenge gameover with %, name, id.
   *  "endless"   → render the regular wreckage gameover with difficulty
   *                buttons + achievements section. */
  mode: "challenge" | "endless";
  score: number;
  best: number;
  /** Set when mode === "challenge". */
  challengeName?: string;
  challengeId?: string;
  /** 0–1; rendered as a percentage. */
  challengeProgress?: number;
}

const DIFFICULTY_BUTTONS_HTML = `
  <div id="difficultyButtons" class="difficulty-buttons" role="group" aria-label="Difficulty">
    <button type="button" data-difficulty="easy">EASY</button>
    <button type="button" data-difficulty="medium">MEDIUM</button>
    <button type="button" data-difficulty="hard">HARD</button>
    <button type="button" data-difficulty="hardcore">PAINFUL</button>
  </div>
`;

export const GameOver: Screen<GameOverProps> = {
  render(props) {
    if (props.mode === "challenge") {
      // Floor (not round) so a death at 99.7% reads as "99%" instead
      // of being rounded up to a misleading "100% completion" on the
      // fail screen. Genuine 100% only when the player actually
      // finished every wave.
      const pct = Math.max(0, Math.min(100, Math.floor((props.challengeProgress ?? 0) * 100)));
      const pctCls = pct >= 100 ? "challenge-pct full" : "challenge-pct partial";
      return `
        <div class="challenge-gameover">
          <h1>GAME OVER</h1>
          <p class="tagline">${escapeHtml(props.challengeName ?? "")} · ${escapeHtml(props.challengeId ?? "")}</p>
          <div class="${pctCls}">${pct}%</div>
          <p class="tagline">Score ${props.score} · Best ${props.best}</p>
          <button type="button" class="play-btn" data-action="play">RETRY</button>
          <button type="button" class="challenge-back" data-action="challenge-back">Back to challenges</button>
          <button type="button" class="challenge-back" data-action="challenge-menu">Main menu</button>
        </div>
      `;
    }
    return `
      <h1>GAME OVER</h1>
      <p class="tagline">Score ${props.score} &middot; Best ${props.best}</p>
      <div class="play-group">
        ${DIFFICULTY_BUTTONS_HTML}
        <button type="button" class="play-btn" data-action="play">PLAY AGAIN</button>
      </div>
      <button type="button" class="challenge-back" data-action="challenge-menu">Main menu</button>
      <section class="achievements">
        <h2>Achievements <span id="achievementCount" class="achievement-count" aria-live="polite"></span></h2>
        <div id="achievementBadges" class="achievement-badges" aria-label="Earned achievements"></div>
      </section>
    `;
  },
};
