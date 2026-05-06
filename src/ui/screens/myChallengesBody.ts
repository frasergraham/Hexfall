// My Challenges section body — challenges the player has authored.
// Mirrors the Installed body's row chrome so both sections look the
// same. Leaderboard + share only show when the challenge has been
// published (we have a publishedRecordName); the line below the name
// reads "PUBLISHED" in that case.

import { difficultyTint } from "../components/blockIcon";
import { IOS_SHARE_GLYPH_SVG } from "../components/icons";
import { escapeHtml } from "../escape";
import { challengeContentHash } from "../../challengeVersion";
import type { CustomChallenge } from "../../customChallenges";

export interface MyChallengesBodyProps {
  authored: CustomChallenge[];
  /** Whether the leaderboard button should render (community readable). */
  showLeaderboard: boolean;
}

export function renderMyChallengesBody(props: MyChallengesBodyProps): string {
  const rows = props.authored.map((c) => {
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
    const recordName = c.publishedRecordName ?? "";
    const isPublished = recordName.length > 0;
    const versionStr = isPublished && c.publishedVersion ? ` v${c.publishedVersion}` : "";
    // Author-side draft detection: local edits made after the last
    // publish drift the content hash. Surface it on the row so the
    // PUBLISHED label doesn't quietly lie.
    const hasDraft = isPublished
      && c.publishedContentHash != null
      && challengeContentHash({ waves: c.waves, effects: c.effects }) !== c.publishedContentHash;
    const statusLine = isPublished
      ? `<span class="editor-home-row-installed">${hasDraft ? "DRAFT — " : ""}PUBLISHED${versionStr}</span>`
      : "";
    const shareBtn = isPublished
      ? `<button type="button" class="editor-home-row-share-inline" data-action="community-share" data-record-name="${escapeHtml(recordName)}" data-share-name="${escapeHtml(c.name)}" aria-label="Share">${IOS_SHARE_GLYPH_SVG}</button>`
      : "";
    // showLeaderboard prop is preserved for back-compat — the inline
    // panel on the challenge intro screen is the new home for the board.
    void props.showLeaderboard;
    // Published challenges swipe to UNPUBLISH (cloud removal only,
    // local copy stays). Unpublished swipe to DELETE.
    const swipeAction = isPublished
      ? `<button type="button" class="editor-home-row-delete" data-action="editor-unpublish" data-custom-id="${escapeHtml(c.id)}" tabindex="-1" aria-label="Unpublish">UNPUBLISH</button>`
      : `<button type="button" class="editor-home-row-delete" data-action="editor-delete" data-custom-id="${escapeHtml(c.id)}" tabindex="-1" aria-label="Delete">DELETE</button>`;
    return `
      <div class="editor-home-row-swipe" data-swipe-id="${escapeHtml(c.id)}">
        ${swipeAction}
        <div class="editor-home-row" data-custom-id="${escapeHtml(c.id)}">
          <div class="editor-home-row-meta">
            <div class="editor-home-row-name-row">
              <span class="challenge-card-name">${escapeHtml(c.name)}</span>
              ${shareBtn}
            </div>
            ${statusLine}
            <div class="challenge-card-hexes">${hexes.join("")}</div>
            ${starsHtml}
            <span class="challenge-card-best">${bestScoreText} ${pctText}</span>
          </div>
          <div class="editor-home-row-actions">
            <button type="button" class="editor-row-btn editor-row-btn-play" data-action="editor-play" data-custom-id="${escapeHtml(c.id)}">PLAY</button>
            <button type="button" class="editor-row-btn editor-row-btn-edit" data-action="editor-edit" data-custom-id="${escapeHtml(c.id)}">EDIT</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
  return `<div class="editor-home-rows">${rows}</div>`;
}
