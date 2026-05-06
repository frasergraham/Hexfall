import { Capacitor, registerPlugin } from "@capacitor/core";
import { loadJson, saveJson } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";

export type LeaderboardDifficulty = "easy" | "medium" | "hard" | "hardcore";

export const LEADERBOARDS: Record<LeaderboardDifficulty, string> = {
  easy: "hex_rain.high_score.easy",
  medium: "hex_rain.high_score.medium",
  hard: "hex_rain.high_score.hard",
  hardcore: "hex_rain.high_score.hardcore",
};

export const LEADERBOARD_TITLES: Record<LeaderboardDifficulty, string> = {
  easy: "High Score · Easy",
  medium: "High Score · Medium",
  hard: "High Score · Hard",
  hardcore: "High Score · Painful",
};

export const ACHIEVEMENTS = {
  score200: "hex_rain.score_200",
  score400: "hex_rain.score_400",
  score600: "hex_rain.score_600",
  score800: "hex_rain.score_800",
  score1000: "hex_rain.score_1000",
  score1500: "hex_rain.score_1500",
  eliteScore200: "hex_rain.elite_200",
  eliteScore400: "hex_rain.elite_400",
  eliteScore600: "hex_rain.elite_600",
  eliteScore800: "hex_rain.elite_800",
  eliteScore1000: "hex_rain.elite_1000",
  eliteScore1500: "hex_rain.elite_1500",
  bonus3x: "hex_rain.bonus_3x",
  bonus4x: "hex_rain.bonus_4x",
  bonus5x: "hex_rain.bonus_5x",
  bonus6x: "hex_rain.bonus_6x",
  bonusPool25: "hex_rain.bonus_pool_25",
  bonusPool50: "hex_rain.bonus_pool_50",
  bonusPool75: "hex_rain.bonus_pool_75",
  bonusPool100: "hex_rain.bonus_pool_100",
  trifecta: "hex_rain.trifecta",
  survivor: "hex_rain.survivor",
  challengeBlock1: "hex_rain.challenge_block_1",
  challengeBlock2: "hex_rain.challenge_block_2",
  challengeBlock3: "hex_rain.challenge_block_3",
  challengeBlock4: "hex_rain.challenge_block_4",
  challengeBlock5: "hex_rain.challenge_block_5",
  challengeBlock6: "hex_rain.challenge_block_6",
} as const;

export type AchievementId = (typeof ACHIEVEMENTS)[keyof typeof ACHIEVEMENTS];

export interface AchievementMeta {
  id: AchievementId;
  name: string;
  description: string;
  badge: string; // short label / emoji shown in the badge pill
  tint: string;  // accent colour for the banner + badge border
}

export const ACHIEVEMENT_LIST: ReadonlyArray<AchievementMeta> = [
  { id: ACHIEVEMENTS.score200, name: "200 Club", description: "Reach 200 points", badge: "200", tint: "#5b8bff" },
  { id: ACHIEVEMENTS.score400, name: "400 Club", description: "Reach 400 points", badge: "400", tint: "#5b8bff" },
  { id: ACHIEVEMENTS.score600, name: "600 Club", description: "Reach 600 points", badge: "600", tint: "#7aa3ff" },
  { id: ACHIEVEMENTS.score800, name: "800 Club", description: "Reach 800 points", badge: "800", tint: "#9bbcff" },
  { id: ACHIEVEMENTS.score1000, name: "1000 Club", description: "Reach 1000 points", badge: "1K", tint: "#bbd4ff" },
  { id: ACHIEVEMENTS.score1500, name: "1500 Club", description: "Reach 1500 points", badge: "1.5K", tint: "#dde7ff" },
  { id: ACHIEVEMENTS.eliteScore200, name: "Elite 200 Club", description: "Reach 200 points on Hard", badge: "200", tint: "#ff7a4a" },
  { id: ACHIEVEMENTS.eliteScore400, name: "Elite 400 Club", description: "Reach 400 points on Hard", badge: "400", tint: "#ff8e3c" },
  { id: ACHIEVEMENTS.eliteScore600, name: "Elite 600 Club", description: "Reach 600 points on Hard", badge: "600", tint: "#ffa12e" },
  { id: ACHIEVEMENTS.eliteScore800, name: "Elite 800 Club", description: "Reach 800 points on Hard", badge: "800", tint: "#ffb820" },
  { id: ACHIEVEMENTS.eliteScore1000, name: "Elite 1000 Club", description: "Reach 1000 points on Hard", badge: "1K", tint: "#ffd000" },
  { id: ACHIEVEMENTS.eliteScore1500, name: "Elite 1500 Club", description: "Reach 1500 points on Hard", badge: "1.5K", tint: "#ffe600" },
  { id: ACHIEVEMENTS.bonus3x, name: "Triple Time", description: "Score a 3X fast bonus", badge: "3X", tint: "#2ec27a" },
  { id: ACHIEVEMENTS.bonus4x, name: "Quad Time", description: "Score a 4X fast bonus", badge: "4X", tint: "#3fe28e" },
  { id: ACHIEVEMENTS.bonus5x, name: "Penta Time", description: "Score a 5X fast bonus", badge: "5X", tint: "#9bf0c2" },
  { id: ACHIEVEMENTS.bonus6x, name: "Hex Time", description: "Score a 6X fast bonus", badge: "6X", tint: "#c8ffd5" },
  { id: ACHIEVEMENTS.bonusPool25, name: "Pocket Change", description: "Bank a +25 fast-bonus payout", badge: "+25", tint: "#ffd76b" },
  { id: ACHIEVEMENTS.bonusPool50, name: "Half a Hundred", description: "Bank a +50 fast-bonus payout", badge: "+50", tint: "#ffc94a" },
  { id: ACHIEVEMENTS.bonusPool75, name: "Three Quarters", description: "Bank a +75 fast-bonus payout", badge: "+75", tint: "#ffba2e" },
  { id: ACHIEVEMENTS.bonusPool100, name: "Full Stack", description: "Bank a +100 fast-bonus payout", badge: "+100", tint: "#ffa311" },
  { id: ACHIEVEMENTS.trifecta, name: "Trifecta", description: "Bank a fast-bonus payout with a shield and a drone active", badge: "★", tint: "#dff2ff" },
  { id: ACHIEVEMENTS.survivor, name: "Survivor", description: "Reach the danger zone and recover to 1 hex", badge: "♥", tint: "#ff5c6e" },
  { id: ACHIEVEMENTS.challengeBlock1, name: "First Steps", description: "Complete every challenge in Block 1", badge: "C1", tint: "#5b8bff" },
  { id: ACHIEVEMENTS.challengeBlock2, name: "Climbing", description: "Complete every challenge in Block 2", badge: "C2", tint: "#7aa3ff" },
  { id: ACHIEVEMENTS.challengeBlock3, name: "Halfway There", description: "Complete every challenge in Block 3", badge: "C3", tint: "#ffd76b" },
  { id: ACHIEVEMENTS.challengeBlock4, name: "Hex Veteran", description: "Complete every challenge in Block 4", badge: "C4", tint: "#ff8e3c" },
  { id: ACHIEVEMENTS.challengeBlock5, name: "Brink of Mastery", description: "Complete every challenge in Block 5", badge: "C5", tint: "#ff5c6e" },
  { id: ACHIEVEMENTS.challengeBlock6, name: "Hex Master", description: "Complete every challenge in Block 6", badge: "C6", tint: "#e6d6ff" },
];

const META_BY_ID = new Map<AchievementId, AchievementMeta>(
  ACHIEVEMENT_LIST.map((m) => [m.id, m]),
);

export function getAchievementMeta(id: AchievementId): AchievementMeta | undefined {
  return META_BY_ID.get(id);
}

export type LeaderboardScope = "global" | "friends";

export interface LeaderboardEntry {
  rank: number;
  score: number;
  playerId: string;
  playerName: string;
}

export interface LeaderboardEntriesResult {
  entries: LeaderboardEntry[];
  localPlayer: LeaderboardEntry | null;
}

interface GameCenterPlugin {
  authenticate(): Promise<{ authenticated: boolean; displayName?: string; alias?: string }>;
  submitScore(opts: { score: number; leaderboardId: string }): Promise<void>;
  reportAchievement(opts: {
    id: string;
    percentComplete: number;
  }): Promise<void>;
  loadAchievements(): Promise<{ ids: string[] }>;
  showLeaderboard(opts: { leaderboardId?: string }): Promise<void>;
  showAchievements(): Promise<void>;
  loadLeaderboardEntries(opts: {
    leaderboardId: string;
    scope: LeaderboardScope;
    limit: number;
  }): Promise<{
    entries: LeaderboardEntry[];
    localPlayer: LeaderboardEntry | null;
  }>;
  loadFriends(): Promise<{ authorized: boolean }>;
}

const Plugin = registerPlugin<GameCenterPlugin>("GameCenter");

let authenticated = false;
let initStarted = false;
let displayName: string | null = null;

function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

// ---------- Persistent earned-set (localStorage) ----------

const STORAGE_KEY = STORAGE_KEYS.earnedAchievements;

function loadEarned(): Set<AchievementId> {
  const parsed = loadJson<unknown>(STORAGE_KEY, null);
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((id): id is AchievementId => META_BY_ID.has(id as AchievementId)));
}

function saveEarned(set: Set<AchievementId>): void {
  saveJson(STORAGE_KEY, [...set]);
}

const earned = loadEarned();

export function isEarned(id: AchievementId): boolean {
  return earned.has(id);
}

export function getEarnedAchievements(): AchievementMeta[] {
  return ACHIEVEMENT_LIST.filter((m) => earned.has(m.id));
}

// ---------- Banner listener ----------

type Listener = (meta: AchievementMeta) => void;
let bannerListener: Listener | null = null;

export function setAchievementListener(cb: Listener | null): void {
  bannerListener = cb;
}

// ---------- Game Center ----------

export async function initGameCenter(): Promise<void> {
  if (!isIOS() || initStarted) return;
  initStarted = true;
  try {
    const result = await Plugin.authenticate();
    authenticated = result.authenticated;
    displayName = result.displayName ?? result.alias ?? null;
  } catch (err) {
    console.warn("[GameCenter] authenticate failed:", err);
    authenticated = false;
  }
  // Once authenticated, pull anything Game Center has on file (earned on
  // another device, or carried over from a reinstall) and merge into the
  // local set so the menu polyhex reflects the player's full history.
  if (authenticated) await syncAchievementsFromGameCenter();
}

/// On iOS, Game Center is canonical: replace the local earned-set with
/// whatever Game Center reports (filtered to IDs we know about). This
/// way a stale local entry (e.g. from a removed/renamed achievement, or
/// pre-Game-Center installs) doesn't haunt the menu polyhex. Returns the
/// number of changes so the caller can decide to re-render.
export async function syncAchievementsFromGameCenter(): Promise<number> {
  if (!isIOS() || !authenticated) return 0;
  let result: { ids: string[] };
  try {
    result = await Plugin.loadAchievements();
  } catch (err) {
    console.warn("[GameCenter] loadAchievements failed:", err);
    return 0;
  }
  if (!result || !Array.isArray(result.ids)) return 0;
  const next = new Set<AchievementId>();
  for (const raw of result.ids) {
    const id = raw as AchievementId;
    if (META_BY_ID.has(id)) next.add(id);
  }
  let changed = next.size !== earned.size;
  if (!changed) {
    for (const id of next) if (!earned.has(id)) { changed = true; break; }
  }
  if (changed) {
    earned.clear();
    for (const id of next) earned.add(id);
    saveEarned(earned);
  }
  return changed ? next.size : 0;
}

export async function submitScore(
  score: number,
  difficulty: LeaderboardDifficulty,
): Promise<void> {
  if (!authenticated) return;
  try {
    await Plugin.submitScore({ score, leaderboardId: LEADERBOARDS[difficulty] });
  } catch (err) {
    console.warn("[GameCenter] submitScore failed:", err);
  }
}

export async function reportAchievement(
  id: AchievementId,
  percentComplete = 100,
): Promise<void> {
  const meta = META_BY_ID.get(id);
  const isFirstTime = percentComplete >= 100 && !earned.has(id);

  if (percentComplete >= 100 && !earned.has(id)) {
    earned.add(id);
    saveEarned(earned);
  }

  // Surface the banner only the first time we earn it on this device. On
  // iOS we leave the banner to GameKit (which shows its own native one).
  if (isFirstTime && meta && bannerListener && !isIOS()) {
    try {
      bannerListener(meta);
    } catch (err) {
      console.warn("[GameCenter] banner listener threw:", err);
    }
  }

  if (!authenticated) return;
  try {
    await Plugin.reportAchievement({ id, percentComplete });
  } catch (err) {
    console.warn("[GameCenter] reportAchievement failed:", err);
  }
}

export async function showLeaderboard(
  difficulty: LeaderboardDifficulty,
): Promise<void> {
  if (!authenticated) return;
  try {
    await Plugin.showLeaderboard({ leaderboardId: LEADERBOARDS[difficulty] });
  } catch (err) {
    console.warn("[GameCenter] showLeaderboard failed:", err);
  }
}

export async function showAchievements(): Promise<void> {
  if (!authenticated) return;
  try {
    await Plugin.showAchievements();
  } catch (err) {
    console.warn("[GameCenter] showAchievements failed:", err);
  }
}

export function isGameCenterAuthenticated(): boolean {
  return authenticated;
}

export function isGameCenterAvailable(): boolean {
  return isIOS();
}

// Player's Game Center display name, captured at auth time. Returns
// null on web or before auth completes; callers fall back to "Anonymous".
export function getGameCenterDisplayName(): string | null {
  return displayName;
}

// Programmatic leaderboard fetch — top-N entries + local player row.
// Powers the in-game leaderboard modal. No-ops to an empty payload on
// non-iOS / unauthenticated.
export async function loadLeaderboardEntries(
  difficulty: LeaderboardDifficulty,
  scope: LeaderboardScope,
  limit = 10,
): Promise<LeaderboardEntriesResult> {
  if (!isIOS() || !authenticated) return { entries: [], localPlayer: null };
  try {
    return await Plugin.loadLeaderboardEntries({
      leaderboardId: LEADERBOARDS[difficulty],
      scope,
      limit,
    });
  } catch (err) {
    console.warn("[GameCenter] loadLeaderboardEntries failed:", err);
    return { entries: [], localPlayer: null };
  }
}

// Trigger the friend-list authorization prompt the first time the
// Friends tab is selected. Resolves { authorized } so the UI can show
// an empty state when the user declined. iOS-only no-op elsewhere.
export async function requestFriendsAuthorization(): Promise<boolean> {
  if (!isIOS() || !authenticated) return false;
  try {
    const r = await Plugin.loadFriends();
    return r.authorized;
  } catch (err) {
    console.warn("[GameCenter] loadFriends failed:", err);
    return false;
  }
}
