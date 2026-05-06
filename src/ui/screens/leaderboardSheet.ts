// Reusable top-N leaderboard renderer — used by:
//   - the endless main-menu leaderboard (modal sheet, with difficulty
//     and Global/Friends tabs, sourcing rows from Game Center)
//   - the per-challenge leaderboard panel embedded in the challenge
//     intro screen (inline, no modal chrome, sourcing rows from
//     CloudKit)
//
// Two render entry points:
//   - `renderRows` returns the inline panel body (rows + you-row +
//     loading/empty states) with no surrounding modal chrome.
//   - `renderSheet` wraps `renderRows` in a `.modal-backdrop` /
//     `.modal-sheet` overlay for the standalone leaderboard sheet.
//
// Backwards compat: `LeaderboardSheet.render` is preserved and
// continues to render the full modal sheet from the legacy prop
// shape.

import { escapeHtml } from "../escape";
import type { Screen } from "../Screen";

export interface LeaderboardRow {
  playerName: string;
  score: number;
  /** Optional — only meaningful for CloudKit-backed leaderboards
   *  (community + official challenges). Omit for Game Center entries. */
  attempts?: number;
  /** Mark the local player's row so the renderer can highlight it
   *  in place rather than tacking on a redundant you-row at the bottom. */
  isYou?: boolean;
}

export interface LeaderboardYouRow {
  /** Apple-reported global rank (or null when the player isn't ranked yet). */
  rank: number | null;
  score: number;
  playerName?: string;
  attempts?: number;
}

export interface LeaderboardTab {
  id: string;
  label: string;
}

export interface LeaderboardRenderProps {
  loading: boolean;
  rows: LeaderboardRow[];
  /** Optional row appended below the top-N when the local player isn't
   *  already inside the visible rows. Renders with a highlight. */
  youRow?: LeaderboardYouRow | null;
  /** Optional empty-state copy. Defaults to "No scores yet — be the first." */
  emptyText?: string;
  /** Optional friends-declined banner. When set, replaces the rows with
   *  this message (used for the Friends tab when the user has declined
   *  the iOS friend-list permission). */
  noticeText?: string;
}

export interface LeaderboardSheetProps extends LeaderboardRenderProps {
  title: string;
  /** Subtitle line under the title (e.g. "Painful · Friends"). */
  subtitle?: string;
  /** Optional tab strip rendered above the rows. */
  tabs?: LeaderboardTab[];
  selectedTabId?: string;
  /** data-action attribute set on each tab button. Caller hooks into it. */
  tabAction?: string;
  /** Optional foot-action button (e.g. "View in Game Center"). */
  footAction?: { label: string; action: string } | null;
}

// Inline rows (no modal chrome). Used by the challenge-intro panel.
export function renderRows(props: LeaderboardRenderProps): string {
  if (props.noticeText) {
    return `<div class="leaderboard-status">${escapeHtml(props.noticeText)}</div>`;
  }
  if (props.loading) {
    return `<div class="leaderboard-status">Loading…</div>`;
  }
  const empty = props.rows.length === 0 && !props.youRow;
  if (empty) {
    return `<div class="leaderboard-status">${escapeHtml(props.emptyText ?? "No scores yet — be the first.")}</div>`;
  }
  const rowMarkup = props.rows.map((r, i) => renderRow(i + 1, r, !!r.isYou)).join("");
  let youMarkup = "";
  const showYou = props.youRow && !props.rows.some((r) => r.isYou);
  if (showYou && props.youRow) {
    youMarkup = renderYouRow(props.youRow, props.rows.length);
  }
  return `<ol class="leaderboard-rows">${rowMarkup}${youMarkup}</ol>`;
}

// Modal sheet (backdrop + chrome). Used by the endless main-menu
// leaderboard.
export function renderSheet(props: LeaderboardSheetProps): string {
  const tabsMarkup = renderTabs(props);
  const subtitleMarkup = props.subtitle
    ? `<div class="leaderboard-subtitle">${escapeHtml(props.subtitle)}</div>`
    : "";
  const footMarkup = props.footAction
    ? `<button type="button" class="leaderboard-foot-action" data-action="${escapeHtml(props.footAction.action)}">${escapeHtml(props.footAction.label)}</button>`
    : "";
  return `
    <div class="modal-backdrop" data-action="close-leaderboard">
      <div class="modal-sheet leaderboard-sheet" role="dialog" aria-label="Leaderboard">
        <header class="modal-sheet-header">
          <span>${escapeHtml(props.title)}</span>
          <button type="button" class="modal-close" data-action="close-leaderboard" aria-label="Close">✕</button>
        </header>
        ${subtitleMarkup}
        ${tabsMarkup}
        ${renderRows(props)}
        ${footMarkup}
      </div>
    </div>
  `;
}

function renderTabs(props: LeaderboardSheetProps): string {
  if (!props.tabs || props.tabs.length === 0) return "";
  const action = props.tabAction ?? "leaderboard-tab";
  return `<div class="leaderboard-tabs" role="tablist">${
    props.tabs.map((t) => {
      const active = t.id === props.selectedTabId;
      return `<button
        type="button"
        class="leaderboard-tab${active ? " active" : ""}"
        role="tab"
        aria-selected="${active}"
        data-action="${escapeHtml(action)}"
        data-tab="${escapeHtml(t.id)}"
      >${escapeHtml(t.label)}</button>`;
    }).join("")
  }</div>`;
}

function renderRow(rank: number, r: LeaderboardRow, isYou: boolean): string {
  const playLabel = typeof r.attempts === "number"
    ? `<span class="leaderboard-attempts">${r.attempts} ${r.attempts === 1 ? "play" : "plays"}</span>`
    : "";
  return `
    <li class="leaderboard-row${isYou ? " you" : ""}">
      <span class="leaderboard-rank">${rank}</span>
      <span class="leaderboard-name">
        <span class="leaderboard-player">${escapeHtml(r.playerName)}</span>
        ${playLabel}
      </span>
      <span class="leaderboard-score">${r.score}</span>
    </li>
  `;
}

function renderYouRow(you: LeaderboardYouRow, topCount: number): string {
  const rankDisplay = you.rank !== null ? String(you.rank) : (topCount > 0 ? String(topCount + 1) : "—");
  const name = escapeHtml(you.playerName ?? "YOU");
  const playLabel = typeof you.attempts === "number"
    ? `<span class="leaderboard-attempts">${you.attempts} ${you.attempts === 1 ? "play" : "plays"}</span>`
    : "";
  return `
    <li class="leaderboard-row you">
      <span class="leaderboard-rank">${rankDisplay}</span>
      <span class="leaderboard-name">
        <span class="leaderboard-player">${name}</span>
        ${playLabel}
      </span>
      <span class="leaderboard-score">${you.score}</span>
    </li>
  `;
}

// Backwards-compatible default export. Existing callers pass the
// legacy { title, loading, rows } shape and get the modal sheet.
export const LeaderboardSheet: Screen<LeaderboardSheetProps | null> = {
  render(props) {
    if (!props) return "";
    return renderSheet(props);
  },
};
