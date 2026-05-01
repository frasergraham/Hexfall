// Challenge Editor home — the landing screen players see when they
// open the editor from the menu. Two sections:
//   • My Challenges — every custom they've authored, plus a [+] tile
//     to create a new one. Each row supports swipe-left to DELETE.
//   • Remix Existing — every roster challenge in an unlocked block,
//     plus every installed community challenge. REMIX clones the
//     source into My Challenges as a fresh editable copy.
//
// Pure render — Game owns swipe wiring + button handlers.

import { difficultyTint } from "../components/blockIcon";
import { escapeHtml } from "../escape";
import type { ChallengeDef } from "../../challenges";
import type { CustomChallenge } from "../../customChallenges";

export interface EditorHomeProps {
  /** Player-authored customs (installedFrom is falsy). */
  authoredCustoms: CustomChallenge[];
  /** Roster challenges available as remix sources (filtered to unlocked blocks). */
  remixRoster: ChallengeDef[];
  /** Community installs offered as remix sources. */
  remixCommunity: CustomChallenge[];
}

export function renderEditorHome(props: EditorHomeProps): string {
  const list = props.authoredCustoms;
  const rows = list.length === 0
    ? `<p class="editor-home-empty">No custom challenges yet. Tap + to create your first.</p>`
    : list.map(renderAuthoredRow).join("");

  const remixCount = props.remixRoster.length + props.remixCommunity.length;
  const rosterRows = props.remixRoster.map(renderRemixRosterRow).join("");
  const communityRows = props.remixCommunity.map(renderRemixCommunityRow).join("");
  const remixSection = remixCount > 0
    ? `
      <section class="challenge-block">
        <header class="challenge-block-header">
          <span>Remix Existing</span>
          <span class="progress">${remixCount}</span>
        </header>
        <div class="editor-home-rows">${rosterRows}${communityRows}</div>
      </section>
    `
    : "";

  return `
    <div class="editor-home">
      <div class="challenge-select-top">
        <button type="button" class="challenge-back" data-action="editor-home-back">← Back</button>
        <span style="font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:#aab4dc;">Challenge Editor</span>
        <span style="width:60px"></span>
      </div>
      <section class="challenge-block">
        <header class="challenge-block-header">
          <span>My Challenges</span>
          <span class="progress">${list.length}</span>
        </header>
        <div class="editor-home-rows">
          ${rows}
          <button type="button" class="editor-home-add" data-action="editor-new" aria-label="Create new custom challenge">+</button>
        </div>
      </section>
      ${remixSection}
    </div>
  `;
}

function renderAuthoredRow(c: CustomChallenge): string {
  const created = new Date(c.createdAt);
  const dateStr = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
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
  const isPublished = !!c.publishedRecordName;
  const publishLabel = isPublished ? "UPDATE" : "PUBLISH";
  const unpublishHtml = isPublished
    ? `<button type="button" class="editor-row-btn editor-row-btn-unpublish" data-action="editor-unpublish" data-custom-id="${escapeHtml(c.id)}">UNPUBLISH</button>`
    : "";
  const publishedBadge = isPublished
    ? `<span class="editor-home-row-published">PUBLISHED v${c.publishedVersion ?? 1}</span>`
    : "";
  const remixLine = c.remixedFrom
    ? `<span class="editor-home-row-remix">Remixed from: ${escapeHtml(c.remixedFrom)}</span>`
    : "";
  const installedLine = c.installedFrom
    ? `<span class="editor-home-row-installed">Installed from ${escapeHtml(c.installedAuthorName ?? "the community")}${c.installedVersion ? ` · v${c.installedVersion}` : ""}</span>`
    : "";
  return `
    <div class="editor-home-row-swipe" data-swipe-id="${escapeHtml(c.id)}">
      <button type="button" class="editor-home-row-delete" data-action="editor-delete" data-custom-id="${escapeHtml(c.id)}" tabindex="-1" aria-label="Delete challenge">DELETE</button>
      <div class="editor-home-row" data-custom-id="${escapeHtml(c.id)}">
        <div class="editor-home-row-meta">
          <span class="challenge-card-id">CUSTOM</span>
          <span class="challenge-card-name">${escapeHtml(c.name)}</span>
          ${publishedBadge}
          ${remixLine}
          ${installedLine}
          <div class="challenge-card-hexes">${hexes.join("")}</div>
          ${starsHtml}
          <span class="challenge-card-best">${bestScoreText} ${pctText}</span>
          <span class="editor-home-row-date">Created ${dateStr}</span>
        </div>
        <div class="editor-home-row-actions">
          <button type="button" class="editor-row-btn editor-row-btn-play" data-action="editor-play" data-custom-id="${escapeHtml(c.id)}">PLAY</button>
          <button type="button" class="editor-row-btn editor-row-btn-edit" data-action="editor-edit" data-custom-id="${escapeHtml(c.id)}">EDIT</button>
          <button type="button" class="editor-row-btn editor-row-btn-publish" data-action="editor-publish" data-custom-id="${escapeHtml(c.id)}">${publishLabel}</button>
          ${unpublishHtml}
        </div>
      </div>
    </div>
  `;
}

function renderRemixRosterRow(def: ChallengeDef): string {
  const tint = difficultyTint(def.difficulty);
  const hexes: string[] = [];
  for (let i = 0; i < def.difficulty; i++) {
    hexes.push(`<span class="challenge-card-hex" style="background:${tint};"></span>`);
  }
  return `
    <div class="editor-home-row editor-home-row-remix-source">
      <div class="editor-home-row-meta">
        <span class="challenge-card-id">${escapeHtml(def.id)}</span>
        <span class="challenge-card-name">${escapeHtml(def.name)}</span>
        <div class="challenge-card-hexes">${hexes.join("")}</div>
      </div>
      <div class="editor-home-row-actions">
        <button type="button" class="editor-row-btn editor-row-btn-edit" data-action="editor-remix" data-roster-id="${escapeHtml(def.id)}">REMIX</button>
      </div>
    </div>
  `;
}

function renderRemixCommunityRow(c: CustomChallenge): string {
  const tint = difficultyTint(c.difficulty);
  const hexes: string[] = [];
  for (let i = 0; i < c.difficulty; i++) {
    hexes.push(`<span class="challenge-card-hex" style="background:${tint};"></span>`);
  }
  const author = c.installedAuthorName ?? "the community";
  return `
    <div class="editor-home-row editor-home-row-remix-source editor-home-row-remix-community">
      <div class="editor-home-row-meta">
        <span class="challenge-card-id">COMMUNITY</span>
        <span class="challenge-card-name">${escapeHtml(c.name)}</span>
        <span class="editor-home-row-installed">by ${escapeHtml(author)}</span>
        <div class="challenge-card-hexes">${hexes.join("")}</div>
      </div>
      <div class="editor-home-row-actions">
        <button type="button" class="editor-row-btn editor-row-btn-edit" data-action="editor-remix-custom" data-custom-id="${escapeHtml(c.id)}">REMIX</button>
      </div>
    </div>
  `;
}
