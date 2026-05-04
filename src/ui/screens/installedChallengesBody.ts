// Installed Challenges section body — community challenges the
// player has installed locally. Uses the editor-home-row chrome
// (full-width with PLAY / REMIX / leaderboard / share buttons +
// swipe-left to UNINSTALL).

import { difficultyTint } from "../components/blockIcon";
import { IOS_SHARE_GLYPH_SVG } from "../components/icons";
import { escapeHtml } from "../escape";
import type { CustomChallenge } from "../../customChallenges";

export interface InstalledChallengesBodyProps {
  installed: CustomChallenge[];
  /** Whether the leaderboard button should render (community is
   *  reachable). Share button always shows when there's a record. */
  showLeaderboard: boolean;
}

export function renderInstalledChallengesBody(props: InstalledChallengesBodyProps): string {
  const rows = props.installed.map((c) => {
    const tint = difficultyTint(c.difficulty);
    const hexes: string[] = [];
    for (let i = 0; i < c.difficulty; i++) {
      hexes.push(`<span class="challenge-card-hex" style="background:${tint};"></span>`);
    }
    const stars = [0, 1, 2]
      .map((i) =>
        `<span class="challenge-card-star${i < c.starsEarned ? " earned" : ""}">★</span>`,
      )
      .join("");
    const attempted = c.best > 0 || c.bestPct > 0 || c.starsEarned > 0;
    const starsHtml = attempted
      ? `<div class="challenge-card-stars">${stars}</div>`
      : "";
    const bestScoreText = c.best > 0 ? `Best: ${c.best}` : "Best: —";
    const pctText = c.bestPct > 0
      ? `<span class="challenge-card-pct${c.bestPct >= 100 ? " full" : ""}">${c.bestPct}%</span>`
      : `<span class="challenge-card-pct">—</span>`;
    const author = c.installedAuthorName ?? "the community";
    const versionStr = c.installedVersion ? ` · v${c.installedVersion}` : "";
    const recordName = c.installedFrom ?? "";
    const leaderboardBtn = props.showLeaderboard && recordName
      ? `<button type="button" class="editor-row-btn editor-row-btn-edit" data-action="community-leaderboard" data-record-name="${escapeHtml(recordName)}" aria-label="Leaderboard">🏆</button>`
      : "";
    const shareBtn = recordName
      ? `<button type="button" class="editor-row-btn editor-row-btn-share" data-action="community-share" data-record-name="${escapeHtml(recordName)}" data-share-name="${escapeHtml(c.name)}" aria-label="Share">${IOS_SHARE_GLYPH_SVG}</button>`
      : "";
    return `
      <div class="editor-home-row-swipe" data-swipe-id="${escapeHtml(c.id)}">
        <button type="button" class="editor-home-row-delete" data-action="installed-uninstall" data-custom-id="${escapeHtml(c.id)}" tabindex="-1" aria-label="Uninstall">UNINSTALL</button>
        <div class="editor-home-row" data-custom-id="${escapeHtml(c.id)}">
          <div class="editor-home-row-meta">
            <span class="challenge-card-name">${escapeHtml(c.name)}</span>
            <span class="editor-home-row-installed">by ${escapeHtml(author)}${versionStr}</span>
            <div class="challenge-card-hexes">${hexes.join("")}</div>
            ${starsHtml}
            <span class="challenge-card-best">${bestScoreText} ${pctText}</span>
          </div>
          <div class="editor-home-row-actions">
            <button type="button" class="editor-row-btn editor-row-btn-play" data-action="installed-play" data-custom-id="${escapeHtml(c.id)}">PLAY</button>
            <button type="button" class="editor-row-btn editor-row-btn-edit" data-action="editor-remix-custom" data-custom-id="${escapeHtml(c.id)}">REMIX</button>
            <div class="editor-home-row-actions-pair">
              ${leaderboardBtn}
              ${shareBtn}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
  return `<div class="editor-home-rows">${rows}</div>`;
}
