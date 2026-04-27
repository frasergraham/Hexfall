import { Capacitor, registerPlugin } from "@capacitor/core";

export const LEADERBOARD_HIGH_SCORE = "hex_rain.high_score";

export const ACHIEVEMENTS = {
  score200: "hex_rain.score_200",
  score400: "hex_rain.score_400",
  score600: "hex_rain.score_600",
  score800: "hex_rain.score_800",
  score1000: "hex_rain.score_1000",
  score1500: "hex_rain.score_1500",
  bonus3x: "hex_rain.bonus_3x",
  bonus4x: "hex_rain.bonus_4x",
  bonus5x: "hex_rain.bonus_5x",
  bonus6x: "hex_rain.bonus_6x",
  bonusPool25: "hex_rain.bonus_pool_25",
  bonusPool50: "hex_rain.bonus_pool_50",
  bonusPool75: "hex_rain.bonus_pool_75",
  bonusPool100: "hex_rain.bonus_pool_100",
  survivor: "hex_rain.survivor",
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
  { id: ACHIEVEMENTS.bonus3x, name: "Triple Time", description: "Score a 3X fast bonus", badge: "3X", tint: "#2ec27a" },
  { id: ACHIEVEMENTS.bonus4x, name: "Quad Time", description: "Score a 4X fast bonus", badge: "4X", tint: "#3fe28e" },
  { id: ACHIEVEMENTS.bonus5x, name: "Penta Time", description: "Score a 5X fast bonus", badge: "5X", tint: "#9bf0c2" },
  { id: ACHIEVEMENTS.bonus6x, name: "Hex Time", description: "Score a 6X fast bonus", badge: "6X", tint: "#c8ffd5" },
  { id: ACHIEVEMENTS.bonusPool25, name: "Pocket Change", description: "Bank a +25 fast-bonus payout", badge: "+25", tint: "#ffd76b" },
  { id: ACHIEVEMENTS.bonusPool50, name: "Half a Hundred", description: "Bank a +50 fast-bonus payout", badge: "+50", tint: "#ffc94a" },
  { id: ACHIEVEMENTS.bonusPool75, name: "Three Quarters", description: "Bank a +75 fast-bonus payout", badge: "+75", tint: "#ffba2e" },
  { id: ACHIEVEMENTS.bonusPool100, name: "Full Stack", description: "Bank a +100 fast-bonus payout", badge: "+100", tint: "#ffa311" },
  { id: ACHIEVEMENTS.survivor, name: "Survivor", description: "Reach the danger zone and recover to 1 hex", badge: "♥", tint: "#ff5c6e" },
];

const META_BY_ID = new Map<AchievementId, AchievementMeta>(
  ACHIEVEMENT_LIST.map((m) => [m.id, m]),
);

export function getAchievementMeta(id: AchievementId): AchievementMeta | undefined {
  return META_BY_ID.get(id);
}

interface GameCenterPlugin {
  authenticate(): Promise<{ authenticated: boolean }>;
  submitScore(opts: { score: number; leaderboardId: string }): Promise<void>;
  reportAchievement(opts: {
    id: string;
    percentComplete: number;
  }): Promise<void>;
  showLeaderboard(opts: { leaderboardId?: string }): Promise<void>;
}

const Plugin = registerPlugin<GameCenterPlugin>("GameCenter");

let authenticated = false;
let initStarted = false;

function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

// ---------- Persistent earned-set (localStorage) ----------

const STORAGE_KEY = "hexrain.earnedAchievements";

function loadEarned(): Set<AchievementId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is AchievementId => META_BY_ID.has(id as AchievementId)));
  } catch {
    return new Set();
  }
}

function saveEarned(set: Set<AchievementId>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore storage failures (e.g. private mode quota)
  }
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
  } catch (err) {
    console.warn("[GameCenter] authenticate failed:", err);
    authenticated = false;
  }
}

export async function submitScore(score: number): Promise<void> {
  if (!authenticated) return;
  try {
    await Plugin.submitScore({ score, leaderboardId: LEADERBOARD_HIGH_SCORE });
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

export async function showLeaderboard(): Promise<void> {
  if (!authenticated) return;
  try {
    await Plugin.showLeaderboard({ leaderboardId: LEADERBOARD_HIGH_SCORE });
  } catch (err) {
    console.warn("[GameCenter] showLeaderboard failed:", err);
  }
}
