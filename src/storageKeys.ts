// Centralised registry of every `hexrain.*` localStorage key the
// app reads or writes. Phase 1.2 of the refactor: previously these
// were sprinkled across audio.ts, game.ts, challenges.ts,
// customChallenges.ts, gameCenter.ts, cloudSync.ts as ad-hoc string
// constants — making it hard to grep all the keys, easy to typo a
// new one, and impossible to audit storage shape without reading
// the whole codebase.
//
// Adding a new key: add a line below, optionally bump the type
// param on the consumer's `loadJson<T>` / `saveJson<T>` call.

export const STORAGE_KEYS = {
  // Audio toggles (audio.ts).
  sfx: "hexrain.sfx",
  music: "hexrain.music",

  // Per-difficulty endless-mode high scores (game.ts).
  // Stored under HIGH_SCORE_KEY_PREFIX + difficulty so the actual
  // keys are e.g. "hexrain.highScore.medium". Pre-difficulty builds
  // wrote to "hexrain.highScore" (no suffix) — migrated on first
  // read in Game.bootstrapHighScores.
  highScorePrefix: "hexrain.highScore.",
  legacyHighScore: "hexrain.highScore",

  // Hardcore difficulty unlock (game.ts).
  hardcoreUnlocked: "hexrain.hardcoreUnlocked",

  // Selected difficulty (game.ts).
  difficulty: "hexrain.difficulty",

  // Per-challenge progress: best score, %, stars, completed list,
  // unlockedBlocks, purchasedUnlock (challenges.ts).
  challengeProgress: "hexrain.challenges.v1",

  // Player-authored custom challenges (customChallenges.ts).
  customChallenges: "hexrain.customChallenges.v1",

  // First-appearance hints (game.ts).
  seenHints: "hexrain.seenHints",
  rotateTutorialShown: "hexrain.rotateTutorialShown",
  controlsHintShown: "hexrain.controlsHintShown",

  // Achievements earned set, mirrored from Game Center (gameCenter.ts).
  earnedAchievements: "hexrain.earnedAchievements",

  // CloudKit private-DB sync bookkeeping (cloudSync.ts).
  cloudProgressModifiedAt: "hexrain.cloudSync.progressModifiedAt",

  // Challenge select section collapsed state. Suffixed with section
  // key so the actual stored keys look like
  // "hexrain.challengeSelect.officialCollapsed.v1".
  challengeSelectOfficialCollapsed: "hexrain.challengeSelect.officialCollapsed.v1",
  challengeSelectMyChallengesCollapsed: "hexrain.challengeSelect.myChallengesCollapsed.v1",
  challengeSelectInstalledChallengesCollapsed: "hexrain.challengeSelect.installedChallengesCollapsed.v1",
  challengeSelectCommunityCollapsed: "hexrain.challengeSelect.communityCollapsed.v1",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
