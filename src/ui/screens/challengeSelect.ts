// Challenge select screen — the big roster grid players see when
// tapping "Challenges" from the menu. Renders six official blocks
// (each with a 5-card grid), an optional IAP banner, "My Challenges"
// (player-authored), "Installed Challenges" (community installs),
// and the Community section. Each section is wrapped in a shared
// collapsible chrome.
//
// Pure render — Game is responsible for gathering progress, custom
// challenges, and the pre-rendered community/installed body HTML
// (those need access to live caches owned by Game). Click handlers
// remain in Game's central listener.

import { difficultyTint } from "../components/blockIcon";
import { escapeHtml } from "../escape";
import type { ChallengeDef, ChallengeProgress } from "../../challenges";
import type { CustomChallenge } from "../../customChallenges";

export type CollapsibleKey =
  | "official"
  | "myChallenges"
  | "installedChallenges"
  | "community";

export interface ChallengeSelectProps {
  progress: ChallengeProgress;
  challenges: ChallengeDef[];
  /** Roster ids whose card should show the UPDATED pill — i.e. an
   *  override from CloudKit has been applied locally and the player
   *  hasn't started a run on it yet. */
  updatedIds: string[];
  /** Player-authored customs (installedFrom is falsy). */
  authoredCustoms: CustomChallenge[];
  /** Community installs (installedFrom is set). */
  installedCustoms: CustomChallenge[];
  /** Show the My Challenges section (purchasedUnlock || debug || tempUnlock). */
  showMyChallenges: boolean;
  /** IAP price label, or null when not available / already purchased. */
  iapPriceLabel: string | null;
  /** Whether the community corpus is reachable (iOS plugin or web token). */
  communityReadable: boolean;
  collapsed: Record<CollapsibleKey, boolean>;
  /** Pre-rendered installed-body markup — Game owns the data plumbing. */
  installedBodyHtml: string;
  /** Pre-rendered my-challenges body markup — same chrome as installed. */
  myChallengesBodyHtml: string;
  /** Pre-rendered community-body markup — Game owns the data plumbing. */
  communityBodyHtml: string;
  /** Pre-rendered leaderboard sheet markup (empty string when closed). */
  leaderboardSheetHtml: string;
  /** Pre-rendered report sheet markup (empty string when closed). */
  reportSheetHtml: string;
}

export function renderChallengeSelect(props: ChallengeSelectProps): string {
  const blocks: ChallengeDef[][] = [[], [], [], [], [], []];
  for (const c of props.challenges) blocks[c.block - 1]!.push(c);
  for (const arr of blocks) arr.sort((a, b) => a.index - b.index);

  const updatedSet = new Set(props.updatedIds);
  const blockHtmlByIndex = blocks.map((arr, idx) =>
    renderOfficialBlock(arr, idx + 1, props.progress, updatedSet),
  );

  const totalBlocks = Math.max(...props.challenges.map((c) => c.block));
  const allBlocksUnlocked = props.progress.unlockedBlocks.length >= totalBlocks;
  const showIapBanner = !props.progress.purchasedUnlock && !allBlocksUnlocked;
  const iapHtml = showIapBanner
    ? `
      <div class="iap-banner">
        <button type="button" class="iap-buy" data-action="open-unlock-shop">
          <span class="iap-title">Unlock All Challenges</span>
          ${props.iapPriceLabel ? `<span class="iap-price">${escapeHtml(props.iapPriceLabel)}</span>` : ""}
        </button>
      </div>
    `
    : "";

  const lastUnlockedIdx = Math.max(0, ...props.progress.unlockedBlocks.map((n) => n - 1));
  const officialBlocks: string[] = [];
  blockHtmlByIndex.forEach((html, idx) => {
    officialBlocks.push(html);
    if (idx === lastUnlockedIdx && iapHtml) officialBlocks.push(iapHtml);
  });

  const completedRoster = props.challenges.filter((c) => props.progress.completed.includes(c.id)).length;
  const sections: string[] = [];
  sections.push(renderCollapsibleSection({
    key: "official",
    title: "Official Challenges",
    progress: `${completedRoster}/${props.challenges.length}`,
    collapsed: props.collapsed.official,
    body: officialBlocks.join(""),
  }));

  if (props.showMyChallenges && props.authoredCustoms.length > 0) {
    sections.push(renderCollapsibleSection({
      key: "myChallenges",
      title: "My Challenges",
      progress: String(props.authoredCustoms.length),
      collapsed: props.collapsed.myChallenges,
      body: props.myChallengesBodyHtml,
    }));
  }

  if (props.installedCustoms.length > 0) {
    sections.push(renderCollapsibleSection({
      key: "installedChallenges",
      title: "Installed Challenges",
      progress: String(props.installedCustoms.length),
      collapsed: props.collapsed.installedChallenges,
      body: props.installedBodyHtml,
    }));
  }

  const communityBody = props.communityReadable
    ? props.communityBodyHtml
    : `<div class="challenge-community-placeholder">
        <span class="challenge-community-tag">UNAVAILABLE</span>
        <p>Community challenges aren't reachable from this build. iOS users browse via iCloud; web visitors need a CloudKit API token configured at build time.</p>
      </div>`;
  sections.push(renderCollapsibleSection({
    key: "community",
    title: "Community Challenges",
    collapsed: props.collapsed.community,
    body: communityBody,
  }));

  return `
    <div class="challenge-select">
      <div class="challenge-select-top">
        <button type="button" class="challenge-back" data-action="challenge-back">← Back</button>
        <span style="font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:#aab4dc;">Challenges</span>
        <span style="width:60px"></span>
      </div>
      ${sections.join("")}
    </div>
    ${props.leaderboardSheetHtml}
    ${props.reportSheetHtml}
  `;
}

function renderOfficialBlock(
  arr: ChallengeDef[],
  blockNum: number,
  progress: ChallengeProgress,
  updatedSet: Set<string>,
): string {
  const unlocked = progress.unlockedBlocks.includes(blockNum);
  const completedInBlock = arr.filter((c) => progress.completed.includes(c.id)).length;
  const blockHasAttempt = arr.some(
    (cc) =>
      (progress.bestPct[cc.id] ?? 0) > 0 ||
      (progress.best[cc.id] ?? 0) > 0 ||
      progress.completed.includes(cc.id),
  );
  const blockIsFresh = unlocked && !blockHasAttempt;
  const cards = arr.map((c) => {
    const best = progress.best[c.id] ?? 0;
    const bestPct = progress.bestPct[c.id] ?? 0;
    const earnedStars = progress.stars[c.id] ?? 0;
    const attempted = best > 0 || bestPct > 0 || earnedStars > 0;
    const done = progress.completed.includes(c.id);
    const cardCls = !unlocked
      ? "challenge-card locked"
      : done ? "challenge-card completed" : "challenge-card";
    const bestScoreText = !unlocked ? "" : best > 0 ? `Best: ${best}` : "Best: —";
    const pctText = !unlocked
      ? ""
      : bestPct > 0
        ? `<span class="challenge-card-pct${bestPct >= 100 ? " full" : ""}">${bestPct}%</span>`
        : `<span class="challenge-card-pct">—</span>`;
    const name = unlocked ? escapeHtml(c.name) : "???";
    const tint = difficultyTint(c.difficulty);
    const hexes: string[] = [];
    for (let i = 0; i < c.difficulty; i++) {
      hexes.push(`<span class="challenge-card-hex" style="background:${tint};"></span>`);
    }
    const check = done ? '<span class="check">✓</span>' : "";
    // UPDATED beats NEW — a freshly-overridden card is more interesting
    // than a freshly-unlocked one, and they share the same corner slot.
    const isUpdated = unlocked && updatedSet.has(c.id);
    const newBadge = isUpdated
      ? '<span class="challenge-card-new updated">UPDATED</span>'
      : blockIsFresh ? '<span class="challenge-card-new">NEW</span>' : "";
    const starsHtml = unlocked && attempted
      ? `<div class="challenge-card-stars">${
          [0, 1, 2].map((i) =>
            `<span class="challenge-card-star${i < earnedStars ? " earned" : ""}">★</span>`,
          ).join("")
        }</div>`
      : "";
    return `
      <button type="button" class="${cardCls}" data-challenge-id="${c.id}" ${unlocked ? "" : "disabled"}>
        <span class="challenge-card-id">${c.id}</span>
        <span class="challenge-card-name">${name}</span>
        <div class="challenge-card-hexes">${hexes.join("")}</div>
        ${starsHtml}
        <span class="challenge-card-best">${bestScoreText} ${pctText}</span>
        ${check}
        ${newBadge}
      </button>
    `;
  }).join("");
  const blockCls = unlocked ? "challenge-block" : "challenge-block locked";
  const headerProgress = unlocked
    ? `<span class="progress">${completedInBlock}/5</span>`
    : "";
  const body = unlocked
    ? `<div class="challenge-cards">${cards}</div>`
    : `
      <div class="challenge-block-lock">
        <div class="challenge-block-lock-icon" aria-hidden="true">🔒</div>
        <p>Complete 3 Block ${blockNum - 1} challenges to unlock</p>
      </div>
    `;
  return `
    <section class="${blockCls}">
      <header class="challenge-block-header">
        <span>Block ${blockNum}</span>
        ${headerProgress}
      </header>
      ${body}
    </section>
  `;
}

function renderCollapsibleSection(opts: {
  key: CollapsibleKey;
  title: string;
  progress?: string;
  collapsed: boolean;
  body: string;
}): string {
  const progressHtml = opts.progress
    ? `<span class="progress">${escapeHtml(opts.progress)}</span>`
    : "";
  return `
    <section class="challenge-official${opts.collapsed ? " collapsed" : ""}">
      <button type="button" class="challenge-official-header"
        data-action="toggle-collapse" data-section="${opts.key}"
        aria-expanded="${opts.collapsed ? "false" : "true"}">
        <span class="challenge-official-chevron" aria-hidden="true">${opts.collapsed ? "▶" : "▼"}</span>
        <span class="challenge-official-title">${escapeHtml(opts.title)}</span>
        ${progressHtml}
      </button>
      <div class="challenge-official-body">${opts.body}</div>
    </section>
  `;
}
