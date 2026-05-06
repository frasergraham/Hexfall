// Challenge intro screen — shown after the player picks a challenge
// from the select grid (or taps PLAY on a community card / installed
// row), before they hit START.
//
// Now hosts an inline top-N leaderboard panel for any challenge that
// has a shared leaderboard (official + installed community). Pure
// local-custom challenges have no shared board and suppress the
// panel entirely.

import { difficultyTint } from "../components/blockIcon";
import { escapeHtml } from "../escape";
import { renderRows, type LeaderboardRow, type LeaderboardYouRow } from "./leaderboardSheet";
import type { Screen } from "../Screen";

export interface ChallengeIntroProps {
  id: string;
  /** Short label shown on the id pill. "1-3" for official, "CUSTOM"
   *  for local custom, "COMMUNITY" for installed community. */
  idLabel?: string;
  name: string;
  /** Optional byline rendered under the name ("by AUTHOR" for
   *  community; omitted for official + local custom). */
  byline?: string;
  difficulty: number;
  waveCount: number;
  /** Best score the player has reached on this challenge, or 0. */
  best: number;
  /** Star count earned (0..3). Hidden when zero. */
  stars?: 0 | 1 | 2 | 3;
  /** Embedded leaderboard panel state. Pass `null` to hide the panel
   *  entirely (used for unpublished local custom challenges). */
  leaderboard?: {
    loading: boolean;
    rows: LeaderboardRow[];
    youRow: LeaderboardYouRow | null;
    notice?: string;
  } | null;
}

export const ChallengeIntro: Screen<ChallengeIntroProps> = {
  render({ id, idLabel, name, byline, difficulty, waveCount, best, stars, leaderboard }) {
    const tint = difficultyTint(difficulty);
    const hexes: string[] = [];
    for (let i = 0; i < difficulty; i++) {
      hexes.push(
        `<span class="challenge-card-hex" style="background:${tint}; width:14px; height:16px;"></span>`,
      );
    }
    const label = idLabel ?? id;
    const starsMarkup = stars
      ? `<span class="challenge-intro-stars" aria-label="${stars} stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</span>`
      : "";
    const meta = `${waveCount} waves${best > 0 ? ` · Best: ${best}` : ""}`;
    const bylineMarkup = byline
      ? `<p class="challenge-intro-byline">${escapeHtml(byline)}</p>`
      : "";
    const lbMarkup = leaderboard !== null && leaderboard !== undefined
      ? `
        <section class="leaderboard-panel" aria-label="Top scores">
          <h2 class="leaderboard-panel-title">TOP SCORES</h2>
          ${renderRows({
            loading: leaderboard.loading,
            rows: leaderboard.rows,
            youRow: leaderboard.youRow,
            noticeText: leaderboard.notice,
          })}
        </section>
      `
      : "";
    return `
      <div class="challenge-intro">
        <span class="id">${escapeHtml(label)}</span>
        <h1>${escapeHtml(name)}</h1>
        ${bylineMarkup}
        <div class="challenge-card-hexes" style="gap:4px;">${hexes.join("")}</div>
        <p class="meta">${meta}${starsMarkup ? ` · ${starsMarkup}` : ""}</p>
        ${lbMarkup}
        <button type="button" class="play-btn" data-action="challenge-go">START</button>
        <button type="button" class="challenge-back" data-action="challenge-back">← Back</button>
      </div>
    `;
  },
};
