// Community Challenges section body — the cards listed under the
// "Community" collapsible in challenge select. Renders sort chips +
// per-challenge cards. Pulled out of the renderChallengeSelect
// monolith in Phase 2.
//
// Pure render — caller (Game) owns the load lifecycle (`refreshCommunity`,
// `upvoteCache` hydration) and feeds props in.

import { difficultyTint } from "../components/blockIcon";
import { escapeHtml } from "../escape";
import type { CommunitySort, PublishedChallenge } from "../../cloudSync";

export interface CommunityBodyProps {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  challenges: PublishedChallenge[];
  /** Currently active sort chip. */
  sort: CommunitySort;
  /** Local install record names — drives the INSTALLED badge + PLAY button. */
  installedSet: ReadonlySet<string>;
  /** Set of upvoted record names. */
  upvotedSet: ReadonlySet<string>;
  /** Whether the player can like / report (CKContainer + iCloud login). */
  showAuthedActions: boolean;
}

const SORT_CHIPS: ReadonlyArray<{ id: CommunitySort; label: string }> = [
  { id: "newest", label: "NEW" },
  { id: "topVoted", label: "TOP" },
  { id: "mostPlayed", label: "ACTIVE" },
];

export function renderCommunityBody(props: CommunityBodyProps): string {
  if (props.loading && props.challenges.length === 0) {
    return `<div class="challenge-community-status">Loading community challenges…</div>`;
  }
  if (props.error) {
    return `<div class="challenge-community-status">Couldn't load community challenges. Pull to retry.</div>`;
  }
  const sortChips = SORT_CHIPS.map((o) => `
    <button type="button" class="community-sort-chip${o.id === props.sort ? " selected" : ""}"
      data-action="community-sort" data-sort="${o.id}">${o.label}</button>
  `).join("");
  if (props.challenges.length === 0 && props.loaded) {
    return `
      <div class="community-sort-row">${sortChips}</div>
      <div class="challenge-community-placeholder">
        <span class="challenge-community-tag">EMPTY</span>
        <p>No community challenges yet. Publish one from the editor to seed the list!</p>
      </div>
    `;
  }
  const cards = props.challenges.map((p) => renderCard(p, props.installedSet, props.upvotedSet, props.showAuthedActions)).join("");
  return `
    <div class="community-sort-row">${sortChips}</div>
    <div class="challenge-cards challenge-cards-community">${cards}</div>
  `;
}

function renderCard(
  p: PublishedChallenge,
  installedSet: ReadonlySet<string>,
  upvotedSet: ReadonlySet<string>,
  showAuthedActions: boolean,
): string {
  const tint = difficultyTint(p.difficulty);
  const hexes: string[] = [];
  for (let i = 0; i < p.difficulty; i++) {
    hexes.push(`<span class="challenge-card-hex" style="background:${tint};"></span>`);
  }
  const installed = installedSet.has(p.recordName);
  const upvoted = upvotedSet.has(p.recordName);
  const installedBadge = installed
    ? `<span class="challenge-card-installed">INSTALLED</span>`
    : "";
  const playOrInstall = installed
    ? `<button type="button" class="community-card-btn community-card-btn-play" data-action="community-play" data-record-name="${escapeHtml(p.recordName)}">PLAY</button>`
    : `<button type="button" class="community-card-btn community-card-btn-install" data-action="community-install" data-record-name="${escapeHtml(p.recordName)}">INSTALL</button>`;
  const likeBtn = showAuthedActions
    ? `<button type="button" class="community-card-icon-btn${upvoted ? " filled-like" : ""}" data-action="community-upvote" data-record-name="${escapeHtml(p.recordName)}" aria-label="Like">${upvoted ? "♥" : "♡"}</button>`
    : "";
  const reportBtn = showAuthedActions
    ? `<button type="button" class="community-card-icon-btn" data-action="community-report" data-record-name="${escapeHtml(p.recordName)}" aria-label="Report">⚑</button>`
    : "";
  const waveCount = p.waves.length;
  const waveLabel = `${waveCount} ${waveCount === 1 ? "wave" : "waves"}`;
  return `
    <div class="challenge-card challenge-card-community">
      <span class="challenge-card-id">COMMUNITY</span>
      <span class="challenge-card-name">${escapeHtml(p.name)}</span>
      <span class="challenge-card-author">by ${escapeHtml(p.authorName)}</span>
      <div class="challenge-card-hex-row">
        <div class="challenge-card-hexes">${hexes.join("")}</div>
        <span class="challenge-card-waves">${waveLabel}</span>
      </div>
      <div class="challenge-card-stats">
        <span title="Installs">⬇ ${p.installCount}</span>
        <span title="Plays">▶ ${p.playCount}</span>
        <span title="Likes">♥ ${p.upvoteCount}</span>
      </div>
      ${installedBadge}
      <div class="community-card-actions">
        <div class="community-card-top-row">
          ${playOrInstall}
        </div>
        <div class="community-card-icon-row">
          ${likeBtn}
          <button type="button" class="community-card-icon-btn" data-action="community-leaderboard" data-record-name="${escapeHtml(p.recordName)}" aria-label="Leaderboard">🏆</button>
          ${reportBtn}
        </div>
      </div>
    </div>
  `;
}
