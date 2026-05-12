// Deep-link single-challenge view — what a recipient lands on after
// tapping a shared `https://hexrain.xyz/?challenge=...` URL. One
// big card with full action stack (PLAY/INSTALL, REMIX, like, board,
// report, share). Phase 2.
//
// Wraps a leaderboardSheet / reportSheet pair via the shared sheet
// renderers so the modals render on top of this view too.

import { difficultyTint } from "../components/blockIcon";
import { IOS_SHARE_GLYPH_SVG } from "../components/icons";
import { escapeHtml } from "../escape";
import { LeaderboardSheet, type LeaderboardSheetProps } from "./leaderboardSheet";
import { ReportSheet, type ReportSheetProps } from "./reportSheet";
import type { Screen } from "../Screen";
import type { PublishedChallenge } from "../../cloudSync";

export interface SingleChallengeProps {
  /** Challenge to render, or null while loading. */
  challenge: PublishedChallenge | null;
  /** When set, render an error state instead of the card. */
  error: string | null;
  /** True when the player already has a local install of this record. */
  installed: boolean;
  /** True when the player has upvoted this record. */
  upvoted: boolean;
  /** True when CloudKit user-auth is available (gates like + report). */
  showAuthedActions: boolean;
  /** Pass through so the modals render on top of the single view. */
  leaderboardSheet: LeaderboardSheetProps | null;
  reportSheet: ReportSheetProps | null;
}

export const SingleChallenge: Screen<SingleChallengeProps> = {
  render(props) {
    let body: string;
    if (props.error) {
      body = `<div class="challenge-community-status">${escapeHtml(props.error)}</div>`;
    } else if (!props.challenge) {
      body = `<div class="challenge-community-status">Loading shared challenge…</div>`;
    } else {
      const p = props.challenge;
      const tint = difficultyTint(p.difficulty);
      const hexes: string[] = [];
      for (let i = 0; i < p.difficulty; i++) {
        hexes.push(`<span class="challenge-card-hex" style="background:${tint};"></span>`);
      }
      const playOrInstall = props.installed
        ? `<button type="button" class="community-card-btn community-card-btn-play" data-action="community-play" data-record-name="${escapeHtml(p.recordName)}">PLAY</button>`
        : `<button type="button" class="community-card-btn community-card-btn-install" data-action="community-install" data-record-name="${escapeHtml(p.recordName)}">INSTALL</button>`;
      const likeBtn = props.showAuthedActions
        ? `<button type="button" class="community-card-icon-btn${props.upvoted ? " filled-like" : ""}" data-action="community-upvote" data-record-name="${escapeHtml(p.recordName)}" aria-label="Like">${props.upvoted ? "♥" : "♡"}</button>`
        : "";
      const reportBtn = props.showAuthedActions
        ? `<button type="button" class="community-card-icon-btn" data-action="community-report" data-record-name="${escapeHtml(p.recordName)}" aria-label="Report">⚑</button>`
        : "";
      const shareBtn = `<button type="button" class="community-card-icon-btn" data-action="community-share" data-record-name="${escapeHtml(p.recordName)}" data-share-name="${escapeHtml(p.name)}" aria-label="Share">${IOS_SHARE_GLYPH_SVG}</button>`;
      const installedBadge = props.installed
        ? `<span class="challenge-card-installed">INSTALLED</span>`
        : "";
      const waveCount = p.waves.length;
      const waveLabel = `${waveCount} ${waveCount === 1 ? "wave" : "waves"}`;
      body = `
        <div class="single-challenge-card">
          <span class="challenge-card-id">SHARED CHALLENGE</span>
          <h1 class="single-challenge-name">${escapeHtml(p.name)}</h1>
          <span class="single-challenge-author">by ${escapeHtml(p.authorName)}</span>
          <div class="single-challenge-hex-row">
            <div class="challenge-card-hexes">${hexes.join("")}</div>
            <span class="challenge-card-waves">${waveLabel}</span>
          </div>
          <div class="challenge-card-stats single-challenge-stats">
            <span title="Installs">⬇ ${p.installCount}</span>
            <span title="Plays">▶ ${p.playCount}</span>
            <span title="Likes">♥ ${p.upvoteCount}</span>
          </div>
          ${installedBadge}
          <div class="single-challenge-actions">
            <div class="community-card-top-row">
              ${playOrInstall}
            </div>
            <div class="community-card-icon-row">
              ${likeBtn}
              ${reportBtn}
              ${shareBtn}
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="single-challenge">
        <div class="challenge-select-top">
          <button type="button" class="challenge-back" data-action="single-back">← Back</button>
          <span class="challenge-select-title">Shared</span>
          <span class="challenge-select-spacer" aria-hidden="true"></span>
        </div>
        ${body}
      </div>
      ${LeaderboardSheet.render(props.leaderboardSheet)}
      ${ReportSheet.render(props.reportSheet)}
    `;
  },
};
