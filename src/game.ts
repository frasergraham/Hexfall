import { Bodies, Body, Composite, Engine, Events, type IEventCollision } from "matter-js";
import { trackChallengeStart, trackPlayEnd, trackPlayStart } from "./analytics";
import { blobPalette, COIN_SHAPE, FallingCluster, hintPalette, kindLabel, pickShape } from "./cluster";
import { DebrisHex } from "./debris";
import {
  ACHIEVEMENT_LIST,
  ACHIEVEMENTS,
  type AchievementId,
  type AchievementMeta,
  getEarnedAchievements,
  getGameCenterDisplayName,
  initGameCenter,
  isGameCenterAvailable,
  reportAchievement,
  setAchievementListener,
  showAchievements as gcShowAchievements,
  showLeaderboard as gcShowLeaderboard,
  submitScore as gcSubmitScore,
} from "./gameCenter";
import {
  axialKey,
  buildPolyhexShape,
  pathHex,
  SQRT3,
} from "./hex";
import { bindCanvasSlide, bindInput, bindSlider, isTouchDevice, type SliderHandle } from "./input";
import {
  isMusicOn,
  isSfxOn,
  playSfx,
  setMusicOn,
  setMusicSpeed,
  setSfxOn,
  startMusic,
  stopMusic,
} from "./audio";
import { Player } from "./player";
import type { Axial, ClusterKind, Difficulty, GameMode, GameState, InputAction, Shape, WallKind } from "./types";
import { ANGLE_TABLE, composeWaveLine, isCustomShapedWave, parseWaveLine, type ParsedWave } from "./waveDsl";
import {
  CHALLENGES,
  awardStars,
  challengeById,
  computeStarThresholds,
  loadChallengeProgress,
  saveChallengeBest,
  saveChallengeCompletion,
  setPurchasedUnlock,
  type ChallengeDef,
} from "./challenges";
import {
  createCustomChallenge,
  deleteCustomChallenge,
  getCustomChallenge,
  isCustomChallenge,
  listCustomChallenges,
  makeRandomSeed,
  MAX_CUSTOM_NAME_LEN,
  MAX_WAVES_PER_CUSTOM,
  remixCustomChallenge,
  saveCustomChallengeRun,
  toChallengeDef,
  upsertCustomChallenge,
  validateCustomChallenge,
  type CustomChallenge,
} from "./customChallenges";
import { drawWavePreview } from "./wavePreview";
import { WAVE_PRESETS, getPreset, presetDefaults, presetMix } from "./wavePresets";
import { slotKindToPrefix } from "./waveDsl";
import {
  getUnlockAllProduct,
  isStoreKitAvailable,
  onUnlockAllEntitlementChanged,
  purchaseUnlockAll,
  restoreUnlockAll,
  type ProductInfo,
} from "./storeKit";
import {
  fetchCommunityChallenge,
  hasUpvoted as cloudHasUpvoted,
  installCommunity,
  isCloudReady,
  isCommunityReadable,
  publishChallenge as cloudPublish,
  queryCommunity,
  removeUpvote as cloudRemoveUpvote,
  reportChallenge,
  submitCommunityScore,
  topScores as cloudTopScores,
  unpublishChallenge,
  upvote as cloudUpvote,
  type CommunitySort,
  type CommunityScore,
  type PublishedChallenge,
  type ReportReason,
} from "./cloudSync";
import { isCloudKitAvailable } from "./cloudKit";
import { shareChallenge } from "./share";
import { hashSeed, mulberry32, type Random } from "./rng";
import { loadBool, loadJson, loadString, removeKey, saveBool, saveJson, saveString } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";
import { computeWaveParams, lateGameSpeedMul } from "./spawn";
import { highestTierCrossed, stepMilestones } from "./scoring";
import { escapeHtml } from "./ui/escape";
import { drawBlockIcon } from "./ui/components/blockIcon";
import { BlocksGuide } from "./ui/screens/blocksGuide";
import { UnlockShop } from "./ui/screens/unlockShop";
import { ChallengeIntro } from "./ui/screens/challengeIntro";
import { ChallengeComplete } from "./ui/screens/challengeComplete";
import { GameOver } from "./ui/screens/gameOver";
import { LeaderboardSheet } from "./ui/screens/leaderboardSheet";
import { ReportSheet } from "./ui/screens/reportSheet";
import { SingleChallenge } from "./ui/screens/singleChallenge";
import { renderCommunityBody as renderCommunityBodyView } from "./ui/screens/communityBody";
import { renderInstalledChallengesBody as renderInstalledChallengesBodyView } from "./ui/screens/installedChallengesBody";
import { renderChallengeSelect as renderChallengeSelectView } from "./ui/screens/challengeSelect";
import { renderEditorHome as renderEditorHomeView } from "./ui/screens/editorHome";
import { renderSettingsDialog as renderSettingsDialogView } from "./ui/screens/settingsDialog";
import { renderWaveDialog as renderWaveDialogView } from "./ui/screens/waveDialog";
import { renderCustomWaveDialog as renderCustomWaveDialogView } from "./ui/screens/customWaveDialog";
import { renderEditorEdit as renderEditorEditView } from "./ui/screens/editorEdit";

// Build-time feature flag: while the IAP unlock flow is being verified
// on TestFlight, set VITE_EDITOR_UNLOCKED=1 in .env.local (or any vite
// env file) to auto-open the Challenge Editor on iOS without going
// through a sandbox-purchase round-trip. Default is true today (matches
// pre-flag behaviour); flip to "0" for the final ship build. Set to
// "0" or omit to gate the editor behind purchasedUnlock as designed.
const EDITOR_TEMP_UNLOCKED_ON_IOS =
  (import.meta.env?.VITE_EDITOR_UNLOCKED ?? "1") !== "0";

// Score-club achievements are difficulty-gated: easy earns none, medium
// earns the standard ladder, and hard earns the Elite ladder. The
// non-score achievements (bonus tiers, multiplier tiers, survivor,
// trifecta) remain earnable on any difficulty.
type Milestone = { threshold: number; id: AchievementId };
const SCORE_MILESTONES_BY_DIFFICULTY: Record<Difficulty, ReadonlyArray<Milestone>> = {
  easy: [],
  medium: [
    { threshold: 200, id: ACHIEVEMENTS.score200 },
    { threshold: 400, id: ACHIEVEMENTS.score400 },
    { threshold: 600, id: ACHIEVEMENTS.score600 },
    { threshold: 800, id: ACHIEVEMENTS.score800 },
    { threshold: 1000, id: ACHIEVEMENTS.score1000 },
    { threshold: 1500, id: ACHIEVEMENTS.score1500 },
  ],
  hard: [
    { threshold: 200, id: ACHIEVEMENTS.eliteScore200 },
    { threshold: 400, id: ACHIEVEMENTS.eliteScore400 },
    { threshold: 600, id: ACHIEVEMENTS.eliteScore600 },
    { threshold: 800, id: ACHIEVEMENTS.eliteScore800 },
    { threshold: 1000, id: ACHIEVEMENTS.eliteScore1000 },
    { threshold: 1500, id: ACHIEVEMENTS.eliteScore1500 },
  ],
  // No score-club achievements on hardcore yet — the difficulty itself
  // is the prize, and the leaderboard ranks players within it.
  hardcore: [],
};

// Fast-bonus payout tiers, awarded when awardFastBonus banks the pool.
const BONUS_POOL_TIERS: ReadonlyArray<{ threshold: number; id: AchievementId }> = [
  { threshold: 25, id: ACHIEVEMENTS.bonusPool25 },
  { threshold: 50, id: ACHIEVEMENTS.bonusPool50 },
  { threshold: 75, id: ACHIEVEMENTS.bonusPool75 },
  { threshold: 100, id: ACHIEVEMENTS.bonusPool100 },
];

const HEX_SIZE_BASE = 22;
const BOARD_COLS = 9;

// Difficulty knobs. Multipliers stack on top of the medium baseline:
// fall speed (initial cluster velocity), spawn interval (how often
// clusters arrive — bigger = slower), per-tier spawn weights, and
// timed-effect duration. `effectDurationMul` is the default for every
// timed effect; per-effect overrides (slow/fast/shield/drone) take
// precedence so hardcore can stretch fast while shrinking shields and
// drones independently.
//
// Spawn picker uses a two-tier model: a single uniform roll picks a
// tier (Sticky / Helpful / Challenge / Normal), then the kind is
// chosen uniformly among eligible kinds inside that tier.
//   Helpful   = coin, slow, tiny, shield, drone (defensive / reward)
//   Challenge = fast, big                       (risk → bank multiplier)
// `helpfulExclude` lets a difficulty drop a kind entirely (PAINFUL has
// no slow). Score gates inside a tier redistribute the tier weight
// among whichever kinds are currently eligible.
interface DifficultyConfig {
  fallSpeedMul: number;
  spawnIntervalMul: number;
  stickyMul: number;
  helpfulMul: number;
  challengeMul: number;
  helpfulExclude?: readonly ClusterKind[];
  // Per-difficulty score gates for tiny/big. Override the global
  // *_MIN_SCORE defaults so easy can hold them back longer (gives the
  // player time to learn the basics) while medium/hard let them show
  // up alongside slow/fast.
  tinyMinScore?: number;
  bigMinScore?: number;
  effectDurationMul: number;
  slowDurationMul?: number;
  fastDurationMul?: number;
  shieldDurationMul?: number;
  droneDurationMul?: number;
  tinyDurationMul?: number;
  bigDurationMul?: number;
  // Score thresholds for wall variants. `narrowingScore` gates pinch
  // (the original "narrowing wave" hence the legacy name); zigzag and
  // narrow have their own thresholds that hardcore lowers aggressively.
  narrowingScore: number;
  zigzagScore: number;
  narrowScore: number;
  // Player size at which the danger glow appears and a blue hit becomes
  // lethal. Default 7; hardcore drops it to 3.
  dangerSize: number;
}

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    fallSpeedMul: 0.8,
    spawnIntervalMul: 1.25,
    stickyMul: 1.5,
    helpfulMul: 1.32,
    challengeMul: 1.0,
    tinyMinScore: 300,
    bigMinScore: 300,
    effectDurationMul: 1.2,
    narrowingScore: 600,
    zigzagScore: 800,
    narrowScore: 1000,
    dangerSize: 7,
  },
  medium: {
    fallSpeedMul: 1.0,
    spawnIntervalMul: 1.0,
    stickyMul: 1.0,
    helpfulMul: 1.0,
    challengeMul: 1.0,
    tinyMinScore: 300,
    bigMinScore: 300,
    effectDurationMul: 1.0,
    narrowingScore: 600,
    zigzagScore: 800,
    narrowScore: 1000,
    dangerSize: 7,
  },
  hard: {
    fallSpeedMul: 1.35,
    spawnIntervalMul: 0.85,
    stickyMul: 0.6,
    helpfulMul: 0.84,
    challengeMul: 1.0,
    tinyMinScore: 0,
    bigMinScore: 0,
    effectDurationMul: 0.8,
    narrowingScore: 200,
    zigzagScore: 800,
    narrowScore: 1000,
    dangerSize: 7,
  },
  hardcore: {
    fallSpeedMul: 1.5,
    spawnIntervalMul: 0.75,
    stickyMul: 0.5,
    helpfulMul: 0.53,
    challengeMul: 1.0,
    helpfulExclude: ["slow"],
    effectDurationMul: 1.0,
    fastDurationMul: 2.0,
    shieldDurationMul: 0.5,
    droneDurationMul: 0.5,
    tinyDurationMul: 0.5,
    bigDurationMul: 0.5,
    narrowingScore: 100,
    zigzagScore: 200,
    narrowScore: 400,
    dangerSize: 3,
  },
};

const DIFFICULTY_STORAGE_KEY = STORAGE_KEYS.difficulty;
const DIFFICULTY_DEFAULT: Difficulty = "medium";
const HIGH_SCORE_KEY_PREFIX = STORAGE_KEYS.highScorePrefix;

// Hardcore difficulty: locked by default. Unlocks organically when the
// player scores HARDCORE_UNLOCK_SCORE on hard, or via the unlock-all IAP.
const HARDCORE_UNLOCK_KEY = STORAGE_KEYS.hardcoreUnlocked;
const HARDCORE_UNLOCK_SCORE = 1000;
const LEGACY_HIGH_SCORE_KEY = STORAGE_KEYS.legacyHighScore;
// Per-kind first-appearance hint labels (AVOID/HEAL/etc.) and the
// rotate tutorial fire once per player, not once per session.
const SEEN_HINTS_STORAGE_KEY = STORAGE_KEYS.seenHints;
const ROTATE_TUTORIAL_STORAGE_KEY = STORAGE_KEYS.rotateTutorialShown;
const CONTROLS_HINT_STORAGE_KEY = STORAGE_KEYS.controlsHintShown;

function loadSeenHints(): Set<ClusterKind> {
  const parsed = loadJson<unknown>(SEEN_HINTS_STORAGE_KEY, null);
  return Array.isArray(parsed) ? new Set(parsed as ClusterKind[]) : new Set();
}

function saveSeenHints(set: Set<ClusterKind>): void {
  saveJson(SEEN_HINTS_STORAGE_KEY, [...set]);
}

// Persisted UI state: whether each collapsible section on the
// challenge select screen is collapsed. Generic helper so adding a
// new section (e.g. Community) only needs a key string. Default
// collapsed = false so new players see content on first visit.
type CollapsibleKey = "official" | "myChallenges" | "installedChallenges" | "community";
const COLLAPSED_KEYS: Record<CollapsibleKey, string> = {
  official: STORAGE_KEYS.challengeSelectOfficialCollapsed,
  myChallenges: STORAGE_KEYS.challengeSelectMyChallengesCollapsed,
  installedChallenges: STORAGE_KEYS.challengeSelectInstalledChallengesCollapsed,
  community: STORAGE_KEYS.challengeSelectCommunityCollapsed,
};

function loadCollapsed(key: CollapsibleKey): boolean {
  return loadBool(COLLAPSED_KEYS[key], false);
}

function saveCollapsed(key: CollapsibleKey, collapsed: boolean): void {
  saveBool(COLLAPSED_KEYS[key], collapsed);
}

const BASE_FALL_SPEED = 1.6; // initial downward velocity for spawned clusters (px/ms)
const SPEED_RAMP = 0.04; // px/ms per score
const MAX_FALL_SPEED = 5.5;

// Challenge clusters maintain a constant fall velocity (gravity is
// re-cancelled each frame in update()) so `speed=` in the wave DSL is
// the literal fall rate. CHALLENGE_BASE_FALL_SPEED is tuned so that
// `speed=1.0` feels close to gravity-driven endless mode (which lands
// near ~12 px/step after the first half-second). speed=0.5 reads as
// clearly slow, speed=3 as clearly fast.
const CHALLENGE_BASE_FALL_SPEED = 12;
const CHALLENGE_MAX_FALL_SPEED = 60;

// SPAWN_INTERVAL_START / _MIN / _RAMP moved to src/spawn.ts in
// Phase 1.5 — wave-cadence math is pure and lives there now.

const LOSE_COMBO = 2;
const STICK_INVULN_MS = 180;

// Stick-in-flight tuning. When a blue cluster part lands a hit it spawns a
// small unrooted hex body that we drive toward the player's target cell
// each frame via direct velocity blending. We deliberately don't use a
// Matter Constraint here — its reaction force at the off-centre target
// slot was torqueing the player and destabilising the physics. Driving
// velocity ourselves keeps all the spring force off the player.
const STICK_FLIGHT_LIFETIME = 0.45; // seconds before we force-snap
const STICK_FLIGHT_SNAP_DIST_FRAC = 0.35; // fraction of hexSize → addCell
const STICK_FLIGHT_CLOSE_STEPS = 7; // steps the homing piece would take to close the full gap
const STICK_FLIGHT_VELOCITY_BLEND = 0.35; // per-frame lerp toward the desired velocity

// Spawn picker tier weights at the medium baseline. A uniform roll
// picks a tier; per-kind weight inside the tier is uniform across
// whichever kinds are currently eligible (score-gated). Failed tier
// gates fall through to Normal. Tunable — exact-restore of pre-BIG/TINY
// normal share at score ≥400, but expected to drift as we iterate.
const SPAWN_STICKY_TIER_WEIGHT = 0.10;
const SPAWN_HELPFUL_TIER_WEIGHT = 0.19;
const SPAWN_CHALLENGE_TIER_WEIGHT = 0.05;

const STICKY_MIN_SCORE = 3;
const COIN_SCORE_BONUS = 5;
const POWERUP_MIN_SCORE = 5;
const SHIELD_MIN_SCORE = 200;
const SHIELD_DURATION = 10; // seconds
const DRONE_MIN_SCORE = 400;
const DRONE_DURATION = 10; // seconds
const DRONE_SIZE_FACTOR = 0.5; // multiplier on hexSize for the drone body
const DRONE_OSCILLATION_SPEED = 0.7; // radians/sec for the back-and-forth
const TINY_MIN_SCORE = 5;
const TINY_DURATION = 5; // seconds
const TINY_PLAYER_SCALE = 0.5; // player hex-size multiplier while tiny is active
const TINY_REHIT_BONUS = 2; // points awarded if a second tiny is hit while still tiny
const BIG_MIN_SCORE = 5;
const BIG_DURATION = 5; // seconds
const BIG_SIZE_BASE = 1.5; // first big pickup grows the player by 50%
const BIG_SIZE_STEP = 0.15; // each subsequent big pickup adds 15% more
const BIG_MULTIPLIER_BASE = 3; // first big pickup multiplies passes 3x
const BIG_MULTIPLIER_STEP = 1; // each stack bumps the multiplier by 1
// Per-second exponential approach rate for the smooth shrink/grow animation
// of the player's hex size when tiny / big toggle on or off.
const PLAYER_SCALE_RATE = 8;

// Time-effect tuning.
const SLOW_EFFECT_DURATION = 5;
// Duration of the slow_up.mp3 wind-up sound. We start playing it this
// many seconds before the slow timer expires so the audio finishes
// exactly when the countdown bar empties.
const SLOW_UP_LEAD = 3.3;
const FAST_EFFECT_DURATION = 5;
const STICK_SLOW_BUFFER = 1; // brief slow-mo after gaining a hex
const SLOW_TIMESCALE = 0.5;
const FAST_TIMESCALE_BASE = 1.25; // first fast pickup
const FAST_TIMESCALE_STEP = 0.1; // each subsequent stack adds this much speed
const FAST_MULTIPLIER_BASE = 3; // first fast pickup multiplies passes 3x
const FAST_MULTIPLIER_STEP = 1; // each stack bumps the multiplier by 1

// Wave variants.
const SWARM_WAVE_CHANCE = 0.35; // chance any given wave is a single-hex swarm
const SWARM_SPAWN_INTERVAL = 0.18; // very short interval during swarms
const SWARM_STICKY_CHANCE = 0.12; // chance a swarm hex spawns as a heal instead of blue

// Score thresholds for advanced spawn mechanics.
const ANGLED_SPAWNS_SCORE = 200;
const SIDE_SPAWNS_SCORE = 400;

const PLAYER_MOVE_SPEED = 18; // px/ms (Matter velocity units, keyboard hold)
const PLAYER_ROT_SPEED = 0.12; // rad/ms (keyboard hold)
const RAIL_BOTTOM_INSET = 4; // px above the board bottom where the rail sits
// Px reserved on each side of the play area for the challenge-mode
// progress bars so they don't overlap falling clusters.
const PROGRESS_BAR_RESERVE = 18;

// Collision categories.
const CAT_PLAYER = 0x0002;
const CAT_CLUSTER = 0x0004;
const CAT_DRONE = 0x0010;

interface HoldState {
  active: boolean;
}

interface ContactInfo {
  point: { x: number; y: number };
  partId: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  vx: number; // px/sec horizontal drift
  vy: number; // px/sec vertical drift (negative = up)
  age: number;
  lifetime: number;
  fillColor: string;
  glowColor: string;
  fontSize: number;
  shake: boolean;
  // Grand mode: pop from near-zero to peakScale fast (~0.2s ease-out
  // cubic) then hold full size while fading and drifting. Used for the
  // fast-bonus payout to make survival feel like a real reward.
  grand: boolean;
  peakScale: number;
}

interface StickInFlight {
  body: Body;
  targetCell: Axial;
  age: number;
  lifetime: number;
}

interface Drone {
  body: Body;
  // World y the drone stays pinned at; only x oscillates.
  baseY: number;
  // Horizontal oscillation centre + amplitude in pixels.
  centreX: number;
  amplitude: number;
  phase: number; // radians, advances with time
  speed: number; // radians per second
  lifetime: number; // seconds remaining
  maxLifetime: number; // duration at spawn time, for HUD ratio
  pulse: number;
}

const PARALLAX_DEEP = 3; // px max horizontal shift of the deep plane
const PARALLAX_BACK = 8; // px max horizontal shift of the back plane
const PARALLAX_FRONT = 22; // px max horizontal shift of the front plane
const STAR_SCROLL_DEEP = 2; // px/sec downward drift of the deep plane
const STAR_SCROLL_BACK = 6; // px/sec downward drift of the back plane
const STAR_SCROLL_FRONT = 18; // px/sec downward drift of the front plane

// Score thresholds where the starfield density bumps up a tier and the
// background nebula fades further into view. Tier 0 is the launch state.
const STAR_TIER_THRESHOLDS = [200, 400, 600] as const;
const NEBULA_INTENSITY_BY_TIER = [0, 0.35, 0.7, 1.0] as const;
const NEBULA_SCROLL_SPEED = 4; // px/sec downward drift of the nebula

// LATE_RAMP_FLOOR_SCORE / LATE_RAMP_PER_100 moved to src/spawn.ts.
const ROTATE_SLIDE_SENS = 0.02; // radians of player rotation per pixel of horizontal drag

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private menuOverlayHtml: string = "";
  private touchbar: HTMLElement;
  private sliderHandle: SliderHandle | null = null;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private pauseBtn: HTMLElement | null;

  private state: GameState = "menu";
  private difficulty: Difficulty = DIFFICULTY_DEFAULT;
  private score = 0;
  private best = 0;
  private comboHits = 0;
  private spawnTimer = 0;
  // True for the very first spawn of each run. Forces a centered
  // single-cell blue cluster so the first-ever AVOID hint label lands
  // dead-centre on the screen.
  private firstSpawn = true;
  // Seconds remaining on the 3-2-1 resume-from-pause countdown. While
  // > 0 the state stays "paused" so update() short-circuits, but the
  // overlay is hidden and a big number renders in the centre.
  private resumeCountdown = 0;

  // Per-run achievement tracking.
  private nextMilestoneIdx = 0;
  private wasInDangerThisRun = false;

  private engine: Engine;
  private clusters: FallingCluster[] = [];
  private debris: DebrisHex[] = [];
  private clusterByBodyId = new Map<number, FallingCluster>();
  private pendingContacts: Array<{ cluster: FallingCluster; contact: ContactInfo }> = [];
  private player!: Player;
  // Tracks whether a horizontal slide-to-rotate gesture is currently
  // active, so the touch path can suppress the keyboard rotation hold.
  private rotationDragActive = false;
  // Touch slider value [-1..1]. Null = inactive (fall back to keyboard).
  private slideTarget: number | null = null;

  // Cluster kinds the player has seen this *page session*. The first
  // cluster of a never-seen kind gets a big glowing label that follows
  // it down. In-memory only — restarts (after game-over) don't show the
  // labels again, but a full page reload starts fresh.
  private seenKinds: Set<ClusterKind> = loadSeenHints();

  // Wave/calm cycle. During waves spawns are faster + more varied; during
  // calm there's a breather. One column is kept clear of new spawns while
  // a wave is active so the player always has a safe lane to dodge into.
  private wavePhase: "calm" | "wave" = "calm";
  private wavePhaseTimer = 0;
  private safeColumn = 0;
  // Whether the current wave is a single-hex swarm (lots of small fast hexes
  // at varied speeds) rather than a regular cluster wave.
  private swarmWave = false;

  // Game mode + challenge runtime state. In "endless" mode the existing
  // wave/calm system runs as before. In "challenge" mode advanceChallenge
  // takes over the spawning, walls, and progression.
  private gameMode: GameMode = "endless";
  private activeChallenge: ChallengeDef | null = null;
  private challengeWaveIdx = 0;
  private challengeWaveTimer = 0;
  private challengeSlotTimer = 0;
  private challengeSpawnTimer = 0;
  private challengeSlotIdx = 0;
  private challengeProbCount = 0;
  private currentParsedWave: ParsedWave | null = null;
  private effectOverrides: ChallengeDef["effects"] | null = null;
  // Editor state. `editingCustom` is the in-flight working copy on the
  // edit screen — autosaved on every mutation. `editorSelectedWaveIdx`
  // is the currently-highlighted row used as the start point when the
  // user taps PLAY without entering edit. Dialog fields drive the
  // overlay-on-overlay modal rendering.
  private editingCustom: CustomChallenge | null = null;
  private editorSelectedWaveIdx = 0;
  private editorDialog: "wave" | "customWave" | "settings" | null = null;
  private editorDialogWaveIdx: number | null = null;
  // Wave-dialog transient state. `isNewWave=true` means the OK action
  // appends to the wave list; otherwise it replaces at waveIdx. The
  // preset id + values drive the chip + slider UI; advancedOpen flips
  // the collapsible. The composed line is what OK validates and writes.
  private editorDialogIsNewWave = false;
  private editorDialogPresetId: string | null = null;
  private editorDialogPresetValues: Record<string, number> = {};
  private editorDialogAdvancedOpen = false;
  private editorDialogPresetsOpen = false;
  private editorDialogWaveLine = "";
  // Cluster mix lives outside the preset: tweaks survive a slider
  // wiggle. Values are integer % per kind, summing to 100. Source of
  // truth for the final pct= token in applyWaveDialog.
  private editorDialogPctValues: Partial<Record<ClusterKind, number>> = {
    normal: 100, sticky: 0, slow: 0, fast: 0, coin: 0, shield: 0, drone: 0, tiny: 0, big: 0,
  };
  // Custom-wave editor state. Distinct from the regular dialog: a
  // 30-slot timeline (bottom = first), a selected kind for placement,
  // plus a rate + walls control. The DSL compose runs on OK and
  // produces a slot-only wave (count=0, slot tokens with kind prefix).
  private editorCustomWaveSlots: Array<{
    kind: ClusterKind;
    size: number;            // 1-5
    side: "main" | "left" | "right";
    col: number;             // 0-9 when side === "main"
    angleIdx: number;        // 0-6 for main; 7 left; 8 right
  } | null> = new Array(CUSTOM_WAVE_LEN).fill(null);
  private editorCustomWaveKind: ClusterKind = "normal";
  private editorCustomWaveRate = 0.5;       // slotInterval in seconds
  private editorCustomWaveSpeed = 1.2;      // baseSpeedMul
  private editorCustomWaveWalls: WallKind = "none";
  private editorCustomWaveOptionsOpen = false;
  // How many rows the custom-wave grid currently shows (capped at
  // CUSTOM_WAVE_LEN). Grows on placement / "Add row" tap; the underlying
  // slots[] stays length 30 — only the first `visibleRows` are emitted.
  private editorCustomWaveVisibleRows = 1;
  // Tap-on-placed-cell opens this picker popup. `cellRect` is the
  // clicked cell's viewport rect snapped at click time — used by the
  // post-render pass to anchor the picker beside (or above) the cell.
  private editorCustomCellPicker: { rowIdx: number; cellRect: DOMRect | null } | null = null;

  // Live preview that loops the working wave behind the dialog. Tick
  // re-parses the working line each frame so rate/count/dur/walls/mix
  // changes apply on the fly; only preset picks reset the loop.
  private editorDialogPreview: {
    slotIdx: number;
    slotTimer: number;
    probCount: number;
    spawnTimer: number;
    waveTimer: number;
    restartDelay: number;
    /** Last applied baseSpeedMul. Used so changing speed mid-wave
     *  rescales the velocity of in-flight clusters too — otherwise
     *  existing spawns keep falling at the old speed and the change
     *  appears not to take effect until the next spawn cycle. */
    lastSpeedMul: number;
  } | null = null;
  private editorDragData: {
    waveIdx: number;
    pointerId: number;
    startY: number;
    rowEl: HTMLElement;
    rowHeight: number;
  } | null = null;
  // Where to land after a custom-challenge run ends. Set when
  // playCustomChallenge fires so back/quit paths route the user back
  // to the screen they came from.
  private customReturnTo: "editorEdit" | "editorHome" | "challengeSelect" = "editorHome";
  private progress = 0;
  private progressDisplayed = 0;
  private waveBumpT = 0; // pulse the progress bar when wave index increments
  private challengeFinishingHold = 0; // wait for last block to pass before completion

  // Time-effect (slow/fast power-ups). timeScale modifies engine + game-logic
  // dt; the visual trail uses timeEffect to decide bubble vs speed-line.
  private timeEffect: "slow" | "fast" | null = null;
  private timeEffectTimer = 0;
  private timeEffectMax = 1;
  // Tracks whether the current slow phase came from a power-up pickup.
  // Collision-induced slow (stick-buffer) stays silent — neither
  // slow_down on entry nor slow_up on exit.
  private slowFromPickup = false;
  private slowUpFired = false;
  private timeScale = 1;

  // Wall system. The board can narrow inward via three kinds:
  //  - "pinch":  classic inset both sides (0.6 * half-board at amount=1).
  //  - "narrow": tighter inset (0.85 * half-board) for dense gauntlets.
  //  - "zigzag": the inset varies sinusoidally with y, creating slanted
  //              corridors. Can push the player horizontally on contact.
  // Only one kind is active at a time. amount lerps toward amountTarget.
  private wall: {
    kind: WallKind;
    amount: number;
    amountTarget: number;
    amp: number;
    period: number;
    phase: number;
    pushHoldT: number;
    pushDir: 0 | -1 | 1;
    // Queued kind change applied once the current wall fully retracts.
    pendingKind: WallKind | null;
    pendingAmp: number;
    pendingPeriod: number;
    // Where amountTarget will be set once the warning timer expires.
    postWarningAmount: number;
    // Pre-arrival warning: while > 0 the warning indicator flashes and
    // amountTarget is held at 0. Once the timer hits 0, postWarningAmount
    // is applied and the wall starts lerping in.
    warningT: number;
    warningKind: WallKind;
  } = {
    kind: "none",
    amount: 0,
    amountTarget: 0,
    amp: 0.18,
    period: 1.4,
    phase: 0,
    pushHoldT: 0,
    pushDir: 0,
    pendingKind: null,
    pendingAmp: 0.18,
    pendingPeriod: 1.4,
    postWarningAmount: 0,
    warningT: 0,
    warningKind: "none",
  };

  // Three-plane starfield. Generated on resize and whenever the score
  // crosses a tier threshold, drawn behind everything with a small
  // horizontal parallax based on the player's x position and a slow
  // downward scroll that gives a sense of moving forward. Density scales
  // up at score 200/400/600.
  private starsDeep: Star[] = [];
  private starsBack: Star[] = [];
  private starsFront: Star[] = [];
  private starScrollY = 0;
  private starTier = 0;

  // Nebula plane: a pre-rendered offscreen image of soft coloured blobs
  // that tiles vertically and slowly drifts downward behind the stars.
  // Eased in by `nebulaIntensity`, which targets a per-tier value so the
  // background grows richer as the player progresses.
  private nebulaCanvas: HTMLCanvasElement | null = null;
  private nebulaIntensity = 0;
  private nebulaScrollY = 0;

  // Floating-text feedback (e.g. "+5" on coin pickup, "3X" on fast pickup).
  // Each floater rises and fades over a short lifetime.
  private floaters: Floater[] = [];

  // Side-entry warnings: when a cluster spawns from off-screen on the
  // left or right, briefly flash a band on that edge at the cluster's
  // current y so the player can see exactly where it's coming in. The
  // cluster ref makes the flash track the body as gravity pulls it
  // down between spawn and on-screen entry.
  private sideWarnings: Array<{ cluster: FallingCluster; side: "left" | "right"; age: number; lifetime: number }> = [];

  // Shield power-up state. While shieldTimer > 0 a translucent bubble
  // surrounds the player and any harmful contact (normal cluster or sticky)
  // is absorbed at the cost of 1 second of shield time.
  private shieldTimer = 0;

  // Active drones — small mid-screen sentinels that intercept clusters
  // and shatter them on contact. Multiple drones can be active.
  private drones: Drone[] = [];

  // Tiny power-up state. While tinyTimer > 0 the player's hex size is
  // scaled down by TINY_PLAYER_SCALE — the only effect is a smaller
  // collision box. A second tiny pickup while still tiny just banks
  // TINY_REHIT_BONUS points and refreshes the timer.
  private tinyTimer = 0;
  private tinyMax = 1;
  // Big power-up state. Mirrors fast: each pickup stacks (level += 1, size +=
  // BIG_SIZE_STEP, multiplier += BIG_MULTIPLIER_STEP). Bonus pool pays out if
  // the timer expires cleanly, forfeits on a blue-cluster hit. Independent of
  // fast — the two effects can run side-by-side and bank separate pools.
  private bigTimer = 0;
  private bigMax = 1;
  private bigLevel = 0;
  private bigBonus = 0;
  // Animated player hex-size multiplier. Lerps toward `playerHexScaleTarget`
  // each frame so the tiny shrink and big grow read as smooth transitions.
  private playerHexScale = 1;
  private playerHexScaleTarget = 1;

  // Hex bodies sprung toward the player while waiting to be snapped onto
  // it as a real cell. Spawned by handleNormalContact and ticked every
  // frame; collide with nothing so they don't disturb other clusters.
  private sticksInFlight: StickInFlight[] = [];

  // ROTATE tutorial: fires once per page session the first time the
  // player grows from 1 → 2 hexes. Slows the game to 0.25x and shows a
  // big "ROTATE" label + curved double-headed arrow around the player
  // until they rotate enough or the timer expires.
  private rotateTutorialShown = loadBool(ROTATE_TUTORIAL_STORAGE_KEY, false);
  private rotateTutorialActive = false;
  private rotateTutorialTimer = 0;
  private rotateTutorialStartAngle = 0;
  // Desktop one-shot controls hint shown on the menu the first time
  // the player ever launches. Cleared by Reset hints.
  private controlsHintShown = loadBool(CONTROLS_HINT_STORAGE_KEY, false);

  // Fast power-up combo state. fastLevel counts how many fast pickups
  // happened this run (1 → 3x, 2 → 4x, 3 → 5x, …); each pickup also
  // bumps the timescale by FAST_TIMESCALE_STEP. fastBonus accumulates
  // the *extra* points (not the base +1) while fast is active. The pool
  // is awarded as one big "+N" floater when the timer runs out cleanly,
  // or scattered as a "lost" explosion when the player gets hit.
  private fastLevel = 0;
  private fastBonus = 0;

  private hexSize = HEX_SIZE_BASE;
  private boardWidth = 0;
  private boardHeight = 0;
  private boardOriginX = 0;
  private boardOriginY = 0;
  private playerY = 0;
  // Pixels at the top of the canvas obscured by the absolute-positioned
  // HUD (score/best) and the iOS Dynamic Island / safe-area inset.
  // Measured at resize time from the .hud element's bottom edge.
  private topInset = 0;

  private lastTime = 0;
  private rafId = 0;
  private unbindInput: (() => void) | null = null;

  private holds: Record<"left" | "right" | "rotateCw" | "rotateCcw", HoldState> = {
    left: { active: false },
    right: { active: false },
    rotateCw: { active: false },
    rotateCcw: { active: false },
  };

  constructor(opts: {
    canvas: HTMLCanvasElement;
    overlay: HTMLElement;
    touchbar: HTMLElement;
    scoreEl: HTMLElement;
    bestEl: HTMLElement;
  }) {
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.overlay = opts.overlay;
    // Snapshot the menu's initial markup (set up in index.html) so
    // renderMenu() can restore it after the overlay has been rewritten
    // for paused / game-over screens.
    this.menuOverlayHtml = this.overlay.innerHTML;
    this.touchbar = opts.touchbar;
    this.scoreEl = opts.scoreEl;
    this.bestEl = opts.bestEl;
    this.pauseBtn = document.getElementById("pauseBtn");
    // Touchstart fires the pause immediately, even when another finger is
    // already mid-drag on the position slider — click events can be
    // swallowed when a sibling touch sequence is calling preventDefault.
    // Click stays for mouse / keyboard / accessibility fallback.
    this.pauseBtn?.addEventListener(
      "touchstart",
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        playSfx("click");
        this.pauseGame();
      },
      { passive: false },
    );
    this.pauseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      playSfx("click");
      this.pauseGame();
    });

    // Auto-pause when the app/tab is backgrounded. On iOS this fires when
    // the user switches apps or hits the home button so a long run isn't
    // ruined by a notification interruption.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pauseGame();
    });

    // Migrate the original single-best key into the medium per-difficulty
    // slot the first time we see it, then forget the legacy key.
    const legacy = loadString(LEGACY_HIGH_SCORE_KEY, "");
    if (legacy !== "") {
      const mediumKey = HIGH_SCORE_KEY_PREFIX + "medium";
      const existing = Number(loadString(mediumKey, "0")) || 0;
      const legacyN = Number(legacy) || 0;
      if (legacyN > existing) saveString(mediumKey, String(legacyN));
      removeKey(LEGACY_HIGH_SCORE_KEY);
    }

    this.difficulty = this.loadDifficulty();
    this.best = this.loadBestFor(this.difficulty);
    this.bestEl.textContent = String(this.best);

    this.engine = Engine.create({
      gravity: { x: 0, y: 1, scale: 0.0012 },
    });

    this.player = new Player({
      centerX: 0,
      centerY: 0,
      hexSize: this.hexSize,
      engine: this.engine,
      collisionCategory: CAT_PLAYER,
      collisionMask: CAT_CLUSTER,
    });
    // Player auto-runs a connectivity sweep after every cell mutation
    // (addCell/removeCell/compact). Anything that falls off arrives
    // here so the game can spawn debris with appropriate outward
    // momentum from the player's centre.
    this.player.setOrphanListener((orphans) => this.spawnPlayerOrphans(orphans));

    Events.on(this.engine, "collisionStart", (e) => this.onCollisionStart(e));

    this.resize();
    window.addEventListener("resize", () => this.resize());
    // Layout changes that don't fire window-resize (e.g. the touchbar going
    // from display:none to display:flex) still need a buffer recalc, or the
    // canvas pixel buffer will be stretched into the new CSS box and the
    // game will render squashed.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.canvas);
    }
    // iOS WKWebView restores from the app switcher with a brief window
    // where the layout is half-rendered; the ResizeObserver can latch
    // onto that intermediate snapshot and leave the canvas locked tiny.
    // Re-fire resize across a few rAFs after every foreground transition.
    const recoverResize = () => {
      requestAnimationFrame(() => {
        this.resize();
        requestAnimationFrame(() => {
          this.resize();
          requestAnimationFrame(() => this.resize());
        });
      });
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) recoverResize();
    });
    window.addEventListener("pageshow", recoverResize);
    window.addEventListener("focus", recoverResize);

    if (isTouchDevice()) this.touchbar.classList.add("show");
    this.touchbar.setAttribute("aria-hidden", "false");
    // Touchbar visibility just changed the layout; resize once the browser
    // has reflowed.
    requestAnimationFrame(() => this.resize());

    this.unbindInput = bindInput(this.touchbar, (action, pressed) =>
      this.onInput(action, pressed),
    );

    const movePadEl = this.touchbar.querySelector<HTMLElement>("#movepad");
    const moveKnobEl = this.touchbar.querySelector<HTMLElement>("#moveknob");
    const wheelEl = document.querySelector<HTMLElement>("#canvasWheel");

    const extraUnbinds: Array<() => void> = [];

    // Rotate gesture: any tap/drag on the canvas. While the finger is on
    // screen, an under-finger ghost wheel shows where you're rotating
    // around. Drag delta around the anchor → player rotates by the same
    // delta (iPod click-wheel feel).
    if (wheelEl) {
      // Rotate gesture: any horizontal drag on the canvas. dx in pixels
      // → delta angle in radians via ROTATE_SLIDE_SENS. Drag right
      // rotates clockwise, drag left rotates CCW. A small indicator dot
      // follows the finger to confirm the touch.
      extraUnbinds.push(
        bindCanvasSlide(this.canvas, wheelEl, (deltaPx) => {
          if (deltaPx === null) {
            this.rotationDragActive = false;
            this.holds.rotateCw.active = false;
            this.holds.rotateCcw.active = false;
            return;
          }
          this.rotationDragActive = true;
          this.player.setAngle(
            this.player.body.angle + deltaPx * ROTATE_SLIDE_SENS,
          );
        }),
      );
    }
    if (movePadEl && moveKnobEl) {
      const sliderHandle = bindSlider(movePadEl, moveKnobEl, (value) => {
        // While paused, ignore slider input entirely. The pad has
        // pointer-events:none in its disabled state so new touches
        // don't even fire — but if a touch was already in progress
        // when pause started, we drop the values here.
        if (this.state === "paused") return;
        this.slideTarget = value;
        if (value !== null) {
          this.holds.left.active = false;
          this.holds.right.active = false;
        }
      });
      this.sliderHandle = sliderHandle;
      extraUnbinds.push(sliderHandle.unbind);
    }
    if (extraUnbinds.length > 0) {
      const baseUnbind = this.unbindInput;
      this.unbindInput = () => {
        baseUnbind?.();
        for (const u of extraUnbinds) u();
      };
    }

    this.overlay.addEventListener("click", (e) => {
      // Difficulty buttons live inside the overlay; treat their clicks as
      // a selection change, not a tap-to-start. Event delegation works
      // even after renderGameOver() rebuilds the overlay markup.
      const target = e.target as HTMLElement | null;
      // Anchor tags (e.g. credits link) navigate on their own — let the
      // browser handle them and skip the tap-to-start fallthrough.
      if (target?.closest("a[href]")) {
        playSfx("click");
        return;
      }
      const btn = target?.closest("button[data-difficulty]") as HTMLButtonElement | null;
      if (btn) {
        playSfx("click");
        const value = btn.dataset.difficulty as Difficulty | undefined;
        if (value === "hardcore" && !this.isHardcoreUnlocked()) {
          this.openUnlockShop();
          return;
        }
        if (value) this.setDifficulty(value);
        return;
      }
      // Audio toggles. These never start the game.
      const sfxToggle = target?.closest('button[data-action="toggle-sfx"]') as HTMLButtonElement | null;
      if (sfxToggle) {
        setSfxOn(!isSfxOn());
        this.refreshAudioToggles();
        playSfx("click");
        return;
      }
      const musicToggle = target?.closest('button[data-action="toggle-music"]') as HTMLButtonElement | null;
      if (musicToggle) {
        setMusicOn(!isMusicOn());
        this.refreshAudioToggles();
        playSfx("click");
        return;
      }
      // Reset-hints button on the menu overlay.
      const resetBtn = target?.closest('button[data-action="reset-hints"]') as HTMLButtonElement | null;
      if (resetBtn) {
        playSfx("click");
        this.resetHints(resetBtn);
        return;
      }
      // BLOCKS guide button on the menu overlay.
      const blocksBtn = target?.closest('button[data-action="open-blocks"]') as HTMLButtonElement | null;
      if (blocksBtn) {
        playSfx("click");
        this.openBlocksGuide();
        return;
      }
      const blocksBackBtn = target?.closest('button[data-action="close-blocks"]') as HTMLButtonElement | null;
      if (blocksBackBtn) {
        playSfx("click");
        this.closeBlocksGuide();
        return;
      }
      // Quit-to-menu button on the paused overlay.
      const quitBtn = target?.closest('button[data-action="quit"]') as HTMLButtonElement | null;
      if (quitBtn) {
        playSfx("click");
        this.quitToMenu();
        return;
      }
      // PLAY / PLAY AGAIN button on menu and game-over overlays.
      const playBtn = target?.closest('button[data-action="play"]') as HTMLButtonElement | null;
      if (playBtn) {
        playSfx("click");
        if (this.state === "challengeComplete" || this.state === "challengeIntro") {
          // Replay the active challenge — re-route custom runs through
          // playCustomChallenge so the user-chosen seed is preserved.
          if (this.activeChallenge) {
            if (isCustomChallenge(this.activeChallenge)) {
              const c = getCustomChallenge(this.activeChallenge.id);
              if (c) this.playCustomChallenge(c, 0);
            } else {
              this.beginChallengeStart(this.activeChallenge);
            }
          }
          return;
        }
        // From challenge gameover, "play again" repeats the same challenge.
        if (this.state === "gameover" && this.gameMode === "challenge" && this.activeChallenge) {
          if (isCustomChallenge(this.activeChallenge)) {
            const c = getCustomChallenge(this.activeChallenge.id);
            if (c) this.playCustomChallenge(c, 0);
          } else {
            this.beginChallengeStart(this.activeChallenge);
          }
          return;
        }
        this.setGameMode("endless");
        this.activeChallenge = null;
        this.effectOverrides = null;
        // In debug, the PLAY button starts a run at whatever score is
        // selected in the start-at dropdown (read freshly each click
        // so toggling the menu's dropdown actually takes effect).
        // Outside debug, runs always start at 0.
        let startScore = 0;
        if (this.debugEnabled) {
          const sel = this.overlay.querySelector<HTMLSelectElement>("#debugStartScore");
          const v = parseInt(sel?.value ?? "0", 10);
          if (Number.isFinite(v)) {
            startScore = v;
            this.debugStartScore = v;
          } else if (this.state === "gameover") {
            // PLAY AGAIN on gameover when the dropdown isn't on screen:
            // fall back to the last picked score.
            startScore = this.debugStartScore;
          }
        }
        this.startOrRestart(startScore);
        return;
      }
      // CHALLENGES menu button.
      const challengesBtn = target?.closest('button[data-action="challenges"]') as HTMLButtonElement | null;
      if (challengesBtn) {
        playSfx("click");
        this.openChallengeSelect();
        return;
      }
      // CHALLENGE EDITOR menu button. Locked behind the unlock-all IAP;
      // debug mode (?debug=1) unlocks it too so dev/testing doesn't need
      // the IAP flag flipped in localStorage.
      const editorBtn = target?.closest('button[data-action="challenge-editor"]') as HTMLButtonElement | null;
      if (editorBtn) {
        playSfx("click");
        const progress = loadChallengeProgress();
        if (progress.purchasedUnlock || this.debugEnabled || this.isEditorTempUnlocked()) {
          this.openEditorHome();
        } else {
          this.openUnlockShop();
        }
        return;
      }
      // Gateway button — opens the unlock-everything screen (used both
      // by the challenge-select banner and by the locked HARDCORE button).
      const openShopBtn = target?.closest('button[data-action="open-unlock-shop"]') as HTMLButtonElement | null;
      if (openShopBtn) {
        playSfx("click");
        this.openUnlockShop();
        return;
      }
      // Back from the unlock-everything screen.
      const unlockBackBtn = target?.closest('button[data-action="unlock-shop-back"]') as HTMLButtonElement | null;
      if (unlockBackBtn) {
        playSfx("click");
        this.closeUnlockShop();
        return;
      }
      // Buy / restore on the unlock-everything screen.
      const iapBuyBtn = target?.closest('button[data-action="iap-unlock"]') as HTMLButtonElement | null;
      if (iapBuyBtn) {
        playSfx("click");
        void this.handleIapPurchase(iapBuyBtn);
        return;
      }
      const iapRestoreBtn = target?.closest('button[data-action="iap-restore"]') as HTMLButtonElement | null;
      if (iapRestoreBtn) {
        playSfx("click");
        void this.handleIapRestore(iapRestoreBtn);
        return;
      }
      // Challenge card pick.
      const challengeCard = target?.closest('button[data-challenge-id]') as HTMLButtonElement | null;
      if (challengeCard) {
        const id = challengeCard.dataset.challengeId;
        if (challengeCard.classList.contains("locked") || !id) return;
        playSfx("click");
        const def = challengeById(id);
        if (def) this.openChallengeIntro(def);
        return;
      }
      // Back from challenge select / intro / complete.
      // Challenge select: collapse / expand a section header (Official,
      // My Challenges, Community). The section key comes from
      // data-section so all three share one route.
      const collapseToggleBtn = target?.closest('button[data-action="toggle-collapse"]') as HTMLButtonElement | null;
      if (collapseToggleBtn) {
        playSfx("click");
        const key = collapseToggleBtn.dataset.section as CollapsibleKey | undefined;
        if (key && key in COLLAPSED_KEYS) {
          saveCollapsed(key, !loadCollapsed(key));
          if (this.state === "challengeSelect") this.renderChallengeSelect();
        }
        return;
      }
      // Community: sort chip pick.
      const communitySortBtn = target?.closest('button[data-action="community-sort"]') as HTMLButtonElement | null;
      if (communitySortBtn) {
        playSfx("click");
        const sort = communitySortBtn.dataset.sort as CommunitySort | undefined;
        if (sort && sort !== this.communitySort) {
          this.communitySort = sort;
          this.communityLoaded = false;
          if (this.state === "challengeSelect") this.renderChallengeSelect();
          void this.refreshCommunity();
        }
        return;
      }
      // Community: install / play / upvote / leaderboard / report.
      const communityInstallBtn = target?.closest('button[data-action="community-install"]') as HTMLButtonElement | null;
      if (communityInstallBtn) {
        playSfx("click");
        const rn = communityInstallBtn.dataset.recordName;
        if (rn) void this.handleCommunityInstall(rn);
        return;
      }
      const communityPlayBtn = target?.closest('button[data-action="community-play"]') as HTMLButtonElement | null;
      if (communityPlayBtn) {
        playSfx("click");
        const rn = communityPlayBtn.dataset.recordName;
        if (rn) this.handleCommunityPlay(rn);
        return;
      }
      const communityRemixBtn = target?.closest('button[data-action="community-remix"]') as HTMLButtonElement | null;
      if (communityRemixBtn) {
        playSfx("click");
        const rn = communityRemixBtn.dataset.recordName;
        if (rn) this.handleCommunityRemix(rn);
        return;
      }
      const communityUpvoteBtn = target?.closest('button[data-action="community-upvote"]') as HTMLButtonElement | null;
      if (communityUpvoteBtn) {
        playSfx("click");
        const rn = communityUpvoteBtn.dataset.recordName;
        if (rn) void this.handleCommunityUpvote(rn);
        return;
      }
      const communityLbBtn = target?.closest('button[data-action="community-leaderboard"]') as HTMLButtonElement | null;
      if (communityLbBtn) {
        playSfx("click");
        const rn = communityLbBtn.dataset.recordName;
        if (rn) void this.openLeaderboardSheet(rn);
        return;
      }
      const communityReportBtn = target?.closest('button[data-action="community-report"]') as HTMLButtonElement | null;
      if (communityReportBtn) {
        playSfx("click");
        const rn = communityReportBtn.dataset.recordName;
        if (rn) this.openReportDialog(rn);
        return;
      }
      const communityShareBtn = target?.closest('button[data-action="community-share"]') as HTMLButtonElement | null;
      if (communityShareBtn) {
        playSfx("click");
        const rn = communityShareBtn.dataset.recordName;
        const name = communityShareBtn.dataset.shareName ?? "this challenge";
        if (rn) void shareChallenge(name, rn);
        return;
      }
      // Back from the single-challenge (deep-link) view: route to the
      // origin we recorded when the view was opened.
      const singleBackBtn = target?.closest('button[data-action="single-back"]') as HTMLButtonElement | null;
      if (singleBackBtn) {
        playSfx("click");
        this.closeSingleChallenge();
        return;
      }
      // Leaderboard / report sheet close (backdrop tap or × button).
      const closeLbBtn = target?.closest('[data-action="close-leaderboard"]') as HTMLElement | null;
      if (closeLbBtn) {
        // Backdrop has the same data-action as the × button; ignore
        // bubbles from inside the sheet body so a tap on a row doesn't
        // dismiss the modal.
        const insideSheet = closeLbBtn.classList.contains("modal-backdrop")
          ? target === closeLbBtn || (target as HTMLElement)?.classList?.contains("modal-close")
          : true;
        if (insideSheet) {
          playSfx("click");
          this.closeLeaderboardSheet();
        }
        return;
      }
      const closeReportBtn = target?.closest('[data-action="close-report"]') as HTMLElement | null;
      if (closeReportBtn) {
        const insideSheet = closeReportBtn.classList.contains("modal-backdrop")
          ? target === closeReportBtn || (target as HTMLElement)?.classList?.contains("modal-close")
          : true;
        if (insideSheet) {
          playSfx("click");
          this.closeReportDialog();
        }
        return;
      }
      const submitReportBtn = target?.closest('button[data-action="submit-report"]') as HTMLButtonElement | null;
      if (submitReportBtn) {
        playSfx("click");
        void this.submitReport();
        return;
      }
      const backBtn = target?.closest('button[data-action="challenge-back"]') as HTMLButtonElement | null;
      if (backBtn) {
        playSfx("click");
        // From any in-challenge overlay (intro / complete / challenge
        // gameover), Back goes back to the screen the player came from —
        // editor home for custom challenges, challenge select otherwise.
        if (
          this.state === "challengeIntro" ||
          this.state === "challengeComplete" ||
          (this.state === "gameover" && this.gameMode === "challenge")
        ) {
          if (this.activeChallenge && isCustomChallenge(this.activeChallenge)) {
            this.returnFromCustomRun();
          } else {
            this.openChallengeSelect();
          }
        } else {
          this.setGameMode("endless");
          this.activeChallenge = null;
          this.effectOverrides = null;
          this.state = "menu";
          this.renderMenu();
        }
        return;
      }
      // Challenge GO! button (intro overlay).
      const goBtn = target?.closest('button[data-action="challenge-go"]') as HTMLButtonElement | null;
      if (goBtn) {
        playSfx("click");
        if (this.activeChallenge) this.beginChallengeStart(this.activeChallenge);
        return;
      }
      // Quit from challenge gameover/complete to challenge select.
      const challengeQuitBtn = target?.closest('button[data-action="challenge-menu"]') as HTMLButtonElement | null;
      if (challengeQuitBtn) {
        playSfx("click");
        this.setGameMode("endless");
        this.activeChallenge = null;
        this.effectOverrides = null;
        this.state = "menu";
        this.renderMenu();
        return;
      }
      // Editor: back from home screen.
      const editorHomeBackBtn = target?.closest('button[data-action="editor-home-back"]') as HTMLButtonElement | null;
      if (editorHomeBackBtn) {
        playSfx("click");
        this.closeEditorHome();
        return;
      }
      // Editor: create new custom challenge.
      const editorNewBtn = target?.closest('button[data-action="editor-new"]') as HTMLButtonElement | null;
      if (editorNewBtn) {
        playSfx("click");
        const fresh = createCustomChallenge();
        this.openEditorEdit(fresh);
        return;
      }
      // Editor home: PLAY / EDIT / PUBLISH on a custom row.
      const editorPlayBtn = target?.closest('button[data-action="editor-play"]') as HTMLButtonElement | null;
      if (editorPlayBtn) {
        playSfx("click");
        const id = editorPlayBtn.dataset.customId;
        const c = id ? getCustomChallenge(id) : undefined;
        if (c) this.playCustomChallenge(c, 0);
        return;
      }
      const editorEditBtn = target?.closest('button[data-action="editor-edit"]') as HTMLButtonElement | null;
      if (editorEditBtn) {
        playSfx("click");
        const id = editorEditBtn.dataset.customId;
        const c = id ? getCustomChallenge(id) : undefined;
        if (c) this.openEditorEdit(c);
        return;
      }
      const editorPublishBtn = target?.closest('button[data-action="editor-publish"]') as HTMLButtonElement | null;
      if (editorPublishBtn && !editorPublishBtn.disabled) {
        playSfx("click");
        const id = editorPublishBtn.dataset.customId;
        const c = id ? getCustomChallenge(id) : undefined;
        if (c) void this.publishCustomChallenge(c);
        return;
      }
      const editorUnpublishBtn = target?.closest('button[data-action="editor-unpublish"]') as HTMLButtonElement | null;
      if (editorUnpublishBtn && !editorUnpublishBtn.disabled) {
        playSfx("click");
        const id = editorUnpublishBtn.dataset.customId;
        const c = id ? getCustomChallenge(id) : undefined;
        if (c) void this.unpublishCustomChallenge(c);
        return;
      }
      // PLAY button on an Installed Challenges row in challenge select.
      // Routes through playCustomChallenge so the seed survives
      // restarts and the existing custom-challenge endgame plumbing
      // (including community leaderboard write) fires.
      const installedPlayBtn = target?.closest('button[data-action="installed-play"]') as HTMLButtonElement | null;
      if (installedPlayBtn) {
        playSfx("click");
        const id = installedPlayBtn.dataset.customId;
        const c = id ? getCustomChallenge(id) : undefined;
        if (c) this.playCustomChallenge(c, 0);
        return;
      }
      // UNINSTALL on an Installed Challenges row (revealed by swipe).
      // Different copy from DELETE because the user can re-install
      // any time from the Community list — best/stars are lost on
      // uninstall though, so the dialog warns about that.
      const installedUninstallBtn = target?.closest('button[data-action="installed-uninstall"]') as HTMLButtonElement | null;
      if (installedUninstallBtn) {
        playSfx("click");
        const id = installedUninstallBtn.dataset.customId;
        if (!id) return;
        const c = getCustomChallenge(id);
        if (!c) return;
        const confirmed = window.confirm(
          `Uninstall "${c.name}"?\n\nIt'll be removed from your Installed list. Your local best score and stars on this challenge will be lost. The challenge stays in the Community list and you can reinstall any time.`,
        );
        if (confirmed) {
          deleteCustomChallenge(id);
          this.swipeOpenId = null;
          if (this.state === "challengeSelect") this.renderChallengeSelect();
        } else {
          this.closeSwipeRow();
        }
        return;
      }
      // Delete a custom challenge (revealed by swipe-left). Confirmation
      // dialog before destruction; cancel re-closes the swipe row.
      const editorDeleteBtn = target?.closest('button[data-action="editor-delete"]') as HTMLButtonElement | null;
      if (editorDeleteBtn) {
        playSfx("click");
        const id = editorDeleteBtn.dataset.customId;
        if (!id) return;
        const c = getCustomChallenge(id);
        if (!c) return;
        const confirmed = window.confirm(
          `Delete "${c.name}"?\n\nThis can't be undone. Your local copy is removed; if it's published, the public version stays up until you UNPUBLISH from the editor.`,
        );
        if (confirmed) {
          deleteCustomChallenge(id);
          this.swipeOpenId = null;
          if (this.state === "editorHome") this.renderEditorHome();
        } else {
          // Snap the row back closed.
          this.closeSwipeRow();
        }
        return;
      }
      // Editor home: REMIX on a roster row clones it into My Challenges
      // and drops the player straight into the new copy's edit screen.
      const editorRemixBtn = target?.closest('button[data-action="editor-remix"]') as HTMLButtonElement | null;
      if (editorRemixBtn) {
        playSfx("click");
        const rosterId = editorRemixBtn.dataset.rosterId;
        const def = rosterId ? CHALLENGES.find((d) => d.id === rosterId) : undefined;
        if (def) {
          const cloned = remixCustomChallenge({
            name: def.name,
            difficulty: def.difficulty,
            effects: def.effects ?? {},
            waves: def.waves,
          });
          this.openEditorEdit(cloned);
        }
        return;
      }
      // Remix an installed community challenge into a fresh editable
      // copy. Same flow as roster remix — clones name/difficulty/effects/
      // waves and stamps a "by Author" attribution into the name. The
      // new copy is independent of the source (no installedFrom link,
      // no auto-update).
      const editorRemixCustomBtn = target?.closest('button[data-action="editor-remix-custom"]') as HTMLButtonElement | null;
      if (editorRemixCustomBtn) {
        playSfx("click");
        const customId = editorRemixCustomBtn.dataset.customId;
        const src = customId ? getCustomChallenge(customId) : undefined;
        if (src) {
          const author = src.installedAuthorName ?? "the community";
          const cloned = remixCustomChallenge({
            name: `${src.name} (by ${author})`,
            difficulty: src.difficulty,
            effects: src.effects,
            waves: src.waves,
          });
          this.openEditorEdit(cloned);
        }
        return;
      }
      // Editor edit: back to home (autosave is already on every mutation).
      const editorEditBackBtn = target?.closest('button[data-action="editor-edit-back"]') as HTMLButtonElement | null;
      if (editorEditBackBtn) {
        playSfx("click");
        if (this.editingCustom) this.editingCustom = upsertCustomChallenge(this.editingCustom);
        this.openEditorHome();
        return;
      }
      // Editor edit: PLAY at currently selected wave (or 0 if none).
      const editorEditPlayBtn = target?.closest('button[data-action="editor-edit-play"]') as HTMLButtonElement | null;
      if (editorEditPlayBtn && this.editingCustom) {
        playSfx("click");
        const saved = upsertCustomChallenge(this.editingCustom);
        this.editingCustom = saved;
        this.playCustomChallenge(saved, this.editorSelectedWaveIdx);
        return;
      }
      // Editor edit: randomise the seed.
      const editorRandomSeedBtn = target?.closest('button[data-action="editor-randomize-seed"]') as HTMLButtonElement | null;
      if (editorRandomSeedBtn && this.editingCustom) {
        playSfx("click");
        this.editingCustom.seed = makeRandomSeed();
        this.editingCustom = upsertCustomChallenge(this.editingCustom);
        this.renderEditorEdit();
        return;
      }
      // Editor edit: open settings dialog.
      const editorSettingsBtn = target?.closest('button[data-action="editor-open-settings"]') as HTMLButtonElement | null;
      if (editorSettingsBtn) {
        playSfx("click");
        this.editorDialog = "settings";
        this.editorDialogWaveIdx = null;
        this.renderEditorEdit();
        return;
      }
      // Editor edit: open the "new wave" dialog (presets + advanced).
      const editorAddWaveBtn = target?.closest('button[data-action="editor-add-wave"]') as HTMLButtonElement | null;
      if (editorAddWaveBtn && this.editingCustom && this.editingCustom.waves.length < MAX_WAVES_PER_CUSTOM) {
        playSfx("click");
        this.openNewWaveDialog();
        return;
      }
      // Editor edit: open the custom-wave (slot-grid) editor.
      const editorAddCustomBtn = target?.closest('button[data-action="editor-add-custom-wave"]') as HTMLButtonElement | null;
      if (editorAddCustomBtn && this.editingCustom && this.editingCustom.waves.length < MAX_WAVES_PER_CUSTOM) {
        playSfx("click");
        this.openNewCustomWaveDialog();
        return;
      }
      // Editor edit: open a wave's edit dialog. Routes to the custom
      // editor when the wave is a slot-only pattern (count=0 + slots),
      // otherwise the regular preset+advanced dialog.
      const editorOpenWaveBtn = target?.closest('button[data-action="editor-open-wave"]') as HTMLButtonElement | null;
      if (editorOpenWaveBtn) {
        playSfx("click");
        const idx = parseInt(editorOpenWaveBtn.dataset.waveIdx ?? "-1", 10);
        if (Number.isFinite(idx) && idx >= 0 && this.editingCustom) {
          const line = this.editingCustom.waves[idx] ?? "";
          if (isCustomShapedWave(line)) this.openExistingCustomWaveDialog(idx);
          else this.openExistingWaveDialog(idx);
        }
        return;
      }
      // Custom-wave dialog: select a kind from the palette.
      const customKindBtn = target?.closest('button[data-action="editor-custom-kind"]') as HTMLButtonElement | null;
      if (customKindBtn) {
        playSfx("click");
        const kind = customKindBtn.dataset.kind as ClusterKind | undefined;
        if (kind && CUSTOM_WAVE_KINDS.includes(kind)) {
          this.editorCustomWaveKind = kind;
          this.renderEditorEdit();
        }
        return;
      }
      // Custom-wave dialog: add another empty row at the top.
      const customAddRowBtn = target?.closest('button[data-action="editor-custom-addrow"]') as HTMLButtonElement | null;
      if (customAddRowBtn && !customAddRowBtn.disabled) {
        playSfx("click");
        this.addCustomWaveRow();
        return;
      }
      // Custom-wave dialog: clear a row.
      const customClearBtn = target?.closest('button[data-action="editor-custom-clear"]') as HTMLButtonElement | null;
      if (customClearBtn) {
        playSfx("click");
        const row = parseInt(customClearBtn.dataset.row ?? "-1", 10);
        if (Number.isFinite(row) && row >= 0 && row < CUSTOM_WAVE_LEN) {
          this.editorCustomWaveSlots[row] = null;
          this.renderEditorEdit();
        }
        return;
      }
      // Custom-wave dialog: rate stepper.
      const customRateBtn = target?.closest('button[data-action="editor-custom-rate"]') as HTMLButtonElement | null;
      if (customRateBtn && !customRateBtn.disabled) {
        playSfx("click");
        const delta = parseFloat(customRateBtn.dataset.delta ?? "0");
        if (Number.isFinite(delta)) this.bumpCustomWaveRate(delta);
        return;
      }
      // Custom-wave dialog: speed stepper.
      const customSpeedBtn = target?.closest('button[data-action="editor-custom-speed"]') as HTMLButtonElement | null;
      if (customSpeedBtn && !customSpeedBtn.disabled) {
        playSfx("click");
        const delta = parseFloat(customSpeedBtn.dataset.delta ?? "0");
        if (Number.isFinite(delta)) this.bumpCustomWaveSpeed(delta);
        return;
      }
      // Custom-wave dialog: toggle the OPTIONS collapsible.
      const customOptionsToggle = target?.closest('button[data-action="editor-custom-options-toggle"]') as HTMLButtonElement | null;
      if (customOptionsToggle) {
        playSfx("click");
        this.editorCustomWaveOptionsOpen = !this.editorCustomWaveOptionsOpen;
        this.renderEditorEdit();
        return;
      }
      // Custom-wave dialog: walls cycler.
      const customWallsBtn = target?.closest('button[data-action="editor-custom-walls"]') as HTMLButtonElement | null;
      if (customWallsBtn) {
        playSfx("click");
        const dir = parseInt(customWallsBtn.dataset.dir ?? "0", 10);
        if (dir !== 0) this.cycleCustomWaveWalls(dir);
        return;
      }
      // Custom-wave dialog: tap a grid cell.
      const customCellBtn = target?.closest('button[data-action="editor-custom-cell"]') as HTMLButtonElement | null;
      if (customCellBtn) {
        playSfx("click");
        const row = parseInt(customCellBtn.dataset.row ?? "-1", 10);
        const sideAttr = customCellBtn.dataset.side as "left" | "right" | undefined;
        const col = sideAttr ? 0 : parseInt(customCellBtn.dataset.col ?? "-1", 10);
        if (Number.isFinite(row) && row >= 0 && row < CUSTOM_WAVE_LEN) {
          this.placeCustomWaveCell(row, sideAttr ?? "main", col);
        }
        return;
      }
      // Cell picker: pick a size.
      const pickSizeBtn = target?.closest('button[data-action="editor-custom-pick-size"]') as HTMLButtonElement | null;
      if (pickSizeBtn && this.editorCustomCellPicker) {
        playSfx("click");
        const size = parseInt(pickSizeBtn.dataset.size ?? "1", 10);
        if (Number.isFinite(size)) this.setCustomCellSize(this.editorCustomCellPicker.rowIdx, size);
        return;
      }
      // Cell picker: pick an angle.
      const pickAngleBtn = target?.closest('button[data-action="editor-custom-pick-angle"]') as HTMLButtonElement | null;
      if (pickAngleBtn && this.editorCustomCellPicker) {
        playSfx("click");
        const angle = parseInt(pickAngleBtn.dataset.angle ?? "0", 10);
        if (Number.isFinite(angle)) this.setCustomCellAngle(this.editorCustomCellPicker.rowIdx, angle);
        return;
      }
      // Cell picker: close (Done button or backdrop tap).
      const pickerCloseBtn = target?.closest('[data-action="editor-custom-picker-close"]') as HTMLElement | null;
      if (pickerCloseBtn) {
        playSfx("click");
        this.closeCustomCellPicker();
        return;
      }
      // Wave dialog: pick a preset chip.
      const presetChip = target?.closest('button[data-action="editor-preset-pick"]') as HTMLButtonElement | null;
      if (presetChip) {
        playSfx("click");
        const id = presetChip.dataset.presetId ?? "";
        const preset = getPreset(id);
        if (preset) {
          this.editorDialogPresetId = id;
          this.editorDialogPresetValues = presetDefaults(preset);
          this.editorDialogWaveLine = preset.build(this.editorDialogPresetValues);
          this.editorDialogPctValues = { ...presetMix(preset) };
          this.renderEditorEdit();
          // Hard restart the preview — picking a preset is a clean reset.
          this.startWavePreview();
        }
        return;
      }
      // Wave dialog: always-visible Count stepper.
      const countBump = target?.closest('button[data-action="editor-bump-count"]') as HTMLButtonElement | null;
      if (countBump && !countBump.disabled) {
        playSfx("click");
        const delta = parseInt(countBump.dataset.delta ?? "0", 10);
        if (Number.isFinite(delta)) this.bumpQuickCount(delta);
        return;
      }
      // Wave dialog: always-visible Duration stepper.
      const durBump = target?.closest('button[data-action="editor-bump-dur"]') as HTMLButtonElement | null;
      if (durBump && !durBump.disabled) {
        playSfx("click");
        const delta = parseFloat(durBump.dataset.delta ?? "0");
        if (Number.isFinite(delta)) this.bumpQuickDur(delta);
        return;
      }
      // Wave dialog: always-visible Rate stepper.
      const rateBump = target?.closest('button[data-action="editor-bump-rate"]') as HTMLButtonElement | null;
      if (rateBump && !rateBump.disabled) {
        playSfx("click");
        const delta = parseFloat(rateBump.dataset.delta ?? "0");
        if (Number.isFinite(delta)) this.bumpQuickRate(delta);
        return;
      }
      // Wave dialog: toggle the PRESET WAVES collapsible.
      const presetsToggle = target?.closest('button[data-action="editor-toggle-presets"]') as HTMLButtonElement | null;
      if (presetsToggle) {
        playSfx("click");
        this.editorDialogPresetsOpen = !this.editorDialogPresetsOpen;
        this.renderEditorEdit();
        return;
      }
      // Wave dialog: always-visible Walls cycler.
      const wallsCycle = target?.closest('button[data-action="editor-cycle-walls"]') as HTMLButtonElement | null;
      if (wallsCycle) {
        playSfx("click");
        const dir = parseInt(wallsCycle.dataset.dir ?? "0", 10);
        if (dir !== 0) this.cycleWalls(dir);
        return;
      }
      // Advanced wave dialog: numeric stepper for any field.
      const advBumpBtn = target?.closest('button[data-action="editor-adv-bump"]') as HTMLButtonElement | null;
      if (advBumpBtn && !advBumpBtn.disabled) {
        playSfx("click");
        const field = advBumpBtn.dataset.field ?? "";
        const delta = parseFloat(advBumpBtn.dataset.delta ?? "0");
        if (field && Number.isFinite(delta)) this.bumpAdvancedField(field, delta);
        return;
      }
      // Advanced wave dialog: cycler (`‹ ›`) for fields with a fixed
      // value set — Origin, Safe column.
      const advCycleBtn = target?.closest('button[data-action="editor-adv-cycle"]') as HTMLButtonElement | null;
      if (advCycleBtn && !advCycleBtn.disabled) {
        playSfx("click");
        const field = advCycleBtn.dataset.field ?? "";
        const dir = parseInt(advCycleBtn.dataset.dir ?? "0", 10);
        if (field && dir !== 0) this.cycleAdvancedField(field, dir);
        return;
      }
      // Wave dialog Advanced: on/off toggle (currently just dirRandom).
      const advToggleBtn = target?.closest('button[data-action="editor-adv-toggle"]') as HTMLButtonElement | null;
      if (advToggleBtn && !advToggleBtn.disabled) {
        playSfx("click");
        const field = advToggleBtn.dataset.field ?? "";
        if (field) this.toggleAdvancedField(field);
        return;
      }
      // Wave dialog Advanced: per-wave seed reroll / clear-to-AUTO.
      const advSeedRerollBtn = target?.closest('button[data-action="editor-adv-seed-reroll"]') as HTMLButtonElement | null;
      if (advSeedRerollBtn && !advSeedRerollBtn.disabled) {
        playSfx("click");
        this.mutateDialogWave((w) => { w.seed = makeRandomSeed(); });
        return;
      }
      const advSeedClearBtn = target?.closest('button[data-action="editor-adv-seed-clear"]') as HTMLButtonElement | null;
      if (advSeedClearBtn && !advSeedClearBtn.disabled) {
        playSfx("click");
        this.mutateDialogWave((w) => { w.seed = null; });
        return;
      }
      // Wave dialog: cluster mix +/- bump.
      const mixBump = target?.closest('button[data-action="editor-mix-bump"]') as HTMLButtonElement | null;
      if (mixBump && !mixBump.disabled) {
        playSfx("click");
        const kind = mixBump.dataset.kind as ClusterKind | undefined;
        const delta = parseInt(mixBump.dataset.delta ?? "0", 10);
        if (kind && Number.isFinite(delta)) this.bumpClusterMix(kind, delta);
        return;
      }
      // Wave dialog: toggle the ADVANCED collapsible.
      const advToggle = target?.closest('button[data-action="editor-toggle-advanced"]') as HTMLButtonElement | null;
      if (advToggle) {
        playSfx("click");
        this.editorDialogAdvancedOpen = !this.editorDialogAdvancedOpen;
        this.renderEditorEdit();
        return;
      }
      // Any field's (i) info button — toggle the adjacent help popup.
      const helpBtn = target?.closest('button[data-action="editor-toggle-help"]') as HTMLButtonElement | null;
      if (helpBtn) {
        e.stopPropagation();
        const wrap = helpBtn.closest(".editor-help-wrap");
        const popup = wrap?.querySelector<HTMLElement>(".editor-help-text");
        if (popup) {
          const wasHidden = popup.hasAttribute("hidden");
          // Close any other open popups so we don't end up with a wall.
          this.overlay.querySelectorAll<HTMLElement>(".editor-help-text").forEach((el) => {
            if (el !== popup) {
              el.setAttribute("hidden", "");
              el.style.left = "";
              el.style.top = "";
              el.style.position = "";
            }
          });
          if (wasHidden) {
            popup.removeAttribute("hidden");
            this.positionHelpPopup(helpBtn, popup);
          } else {
            popup.setAttribute("hidden", "");
            popup.style.left = "";
            popup.style.top = "";
            popup.style.position = "";
          }
        }
        return;
      }
      // Editor edit: delete a wave.
      const editorDeleteWaveBtn = target?.closest('button[data-action="editor-delete-wave"]') as HTMLButtonElement | null;
      if (editorDeleteWaveBtn && this.editingCustom) {
        playSfx("click");
        const idx = parseInt(editorDeleteWaveBtn.dataset.waveIdx ?? "-1", 10);
        if (Number.isFinite(idx) && idx >= 0 && this.editingCustom.waves.length > 1) {
          this.editingCustom.waves = this.editingCustom.waves.filter((_, i) => i !== idx);
          this.editingCustom = upsertCustomChallenge(this.editingCustom);
          if (this.editorSelectedWaveIdx >= this.editingCustom.waves.length) {
            this.editorSelectedWaveIdx = Math.max(0, this.editingCustom.waves.length - 1);
          }
          this.renderEditorEdit();
        }
        return;
      }
      // Editor edit: select-row click on the body of a wave row.
      const editorWaveRow = target?.closest(".editor-wave-row") as HTMLElement | null;
      if (
        editorWaveRow &&
        !target?.closest(".editor-row-btn") &&
        !target?.closest(".editor-drag-handle") &&
        this.state === "editorEdit"
      ) {
        const idx = parseInt(editorWaveRow.dataset.waveIdx ?? "-1", 10);
        if (Number.isFinite(idx) && idx >= 0) {
          this.editorSelectedWaveIdx = idx;
          this.renderEditorEdit();
        }
        return;
      }
      // Dialog OK / Cancel.
      const dialogOk = target?.closest('button[data-action="editor-dialog-ok"]') as HTMLButtonElement | null;
      if (dialogOk) {
        playSfx("click");
        if (this.editorDialog === "wave") this.applyWaveDialog();
        else if (this.editorDialog === "customWave") this.applyCustomWaveDialog();
        else if (this.editorDialog === "settings") this.applySettingsDialog();
        return;
      }
      const dialogCancel = target?.closest('[data-action="editor-dialog-cancel"]') as HTMLElement | null;
      if (dialogCancel) {
        playSfx("click");
        this.stopWavePreview();
        this.editorDialog = null;
        this.editorDialogWaveIdx = null;
        this.editorDialogIsNewWave = false;
        this.editorDialogPresetId = null;
        this.editorDialogPresetValues = {};
        this.editorDialogWaveLine = "";
        this.renderEditorEdit();
        return;
      }
      // Settings: difficulty pick.
      const diffPick = target?.closest('button[data-dialog-difficulty]') as HTMLButtonElement | null;
      if (diffPick) {
        playSfx("click");
        const dlg = this.overlay.querySelector<HTMLElement>(".editor-dialog");
        if (dlg) {
          dlg.querySelectorAll<HTMLButtonElement>(".editor-diff-btn").forEach((b) => b.classList.remove("selected"));
          diffPick.classList.add("selected");
        }
        return;
      }
      // Settings dialog: numeric stepper (durations, star thresholds).
      const settingsBumpBtn = target?.closest('button[data-action="editor-settings-bump"]') as HTMLButtonElement | null;
      if (settingsBumpBtn && !settingsBumpBtn.disabled) {
        playSfx("click");
        const field = settingsBumpBtn.dataset.field ?? "";
        const delta = parseFloat(settingsBumpBtn.dataset.delta ?? "0");
        if (field && Number.isFinite(delta)) this.bumpSettingsField(field, delta);
        return;
      }
      // Settings: auto-suggest stars.
      const autoStars = target?.closest('button[data-action="editor-settings-auto"]') as HTMLButtonElement | null;
      if (autoStars) {
        playSfx("click");
        this.autoSuggestStars();
        return;
      }
      // Settings: auto-suggest difficulty.
      const autoDiff = target?.closest('button[data-action="editor-settings-auto-diff"]') as HTMLButtonElement | null;
      if (autoDiff) {
        playSfx("click");
        this.autoSuggestDifficulty();
        return;
      }
      // Custom-challenge card on the CHALLENGES screen.
      const customCard = target?.closest('button[data-custom-challenge-id]') as HTMLButtonElement | null;
      if (customCard) {
        playSfx("click");
        const id = customCard.dataset.customChallengeId;
        const c = id ? getCustomChallenge(id) : undefined;
        if (c) this.playCustomChallenge(c, 0);
        return;
      }

      // Achievement badges (iOS) open the GameKit achievements view.
      if (target?.closest(".achievement-badge")) {
        playSfx("click");
        if (isGameCenterAvailable()) void gcShowAchievements();
        return;
      }

      // Tap-anywhere-to-resume is preserved for the paused overlay
      // (intentionally minimal UI). Menu and game-over require an
      // explicit PLAY button tap so stray clicks on background space
      // don't start runs.
      if (this.state === "paused") {
        playSfx("click");
        this.beginResumeCountdown();
      }
    });

    // Editor: live-update the in-flight CustomChallenge model from the
    // name/seed inputs as the user types. Persistence happens on blur
    // (handleEditorFieldCommit) so we don't write to localStorage on
    // every keystroke. Dialog inputs persist on OK only — no listener
    // needed here.
    this.overlay.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement | null;
      if (!target) return;
      if (target.dataset.editorField) {
        this.handleEditorFieldInput(target);
        return;
      }
      // Preset-param slider: update the live composed line and re-render.
      const presetParam = target.dataset.presetParam;
      if (presetParam && this.editorDialogPresetId) {
        const v = parseFloat(target.value);
        if (Number.isFinite(v)) {
          this.editorDialogPresetValues[presetParam] = v;
          this.rebuildFromPreset();
        }
        return;
      }
      // Advanced wave-dialog field: live-feed the preview.
      if (target.dataset.dialogField) {
        this.applyAdvancedFieldToLine(target);
        return;
      }
    });
    // Selects + radios fire `change`, not `input`. Same target shape.
    this.overlay.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement | null;
      if (!target) return;
      if (target.dataset.dialogField) {
        this.applyAdvancedFieldToLine(target);
      }
      // Report dialog: radio pick updates the in-flight reason.
      if (target instanceof HTMLInputElement && target.name === "report-reason" && this.reportSheet) {
        this.reportSheet.reason = target.value as ReportReason;
      }
    });
    this.overlay.addEventListener("blur", (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || !(target as HTMLInputElement).dataset?.editorField) return;
      this.handleEditorFieldCommit();
    }, true);

    // Swipe-to-delete on editor home rows. Pointer events cover both
    // touch and mouse so trackpad/desktop testing works the same way.
    // We attach to the overlay (delegated) so re-renders don't have to
    // re-wire individual rows.
    this.overlay.addEventListener("pointerdown", (e) => {
      const swipe = (e.target as HTMLElement | null)?.closest(".editor-home-row-swipe") as HTMLElement | null;
      if (!swipe) return;
      // Don't start a new drag from a tap on the revealed DELETE button
      // — the click handler above takes that path.
      if ((e.target as HTMLElement)?.closest('[data-action="editor-delete"]')) return;
      // Tapping inside an unrelated open row should close that row first
      // (one row open at a time). Don't begin a new drag in that case.
      if (this.swipeOpenId && this.swipeOpenId !== swipe.dataset.swipeId) {
        this.closeSwipeRow();
        return;
      }
      this.swipeId = swipe.dataset.swipeId ?? null;
      this.swipeStartX = e.clientX;
      this.swipeStartY = e.clientY;
      this.swipeAxisLocked = "none";
    });
    this.overlay.addEventListener("pointermove", (e) => {
      if (!this.swipeId) return;
      const dx = e.clientX - this.swipeStartX;
      const dy = e.clientY - this.swipeStartY;
      if (this.swipeAxisLocked === "none") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < Game.SWIPE_AXIS_THRESHOLD_PX) return;
        this.swipeAxisLocked = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
      if (this.swipeAxisLocked !== "horizontal") return;
      // Compute the visible offset, clamped so the row never travels
      // right of resting position and never further left than the
      // reveal width (no overscroll).
      const base = this.swipeOpenId === this.swipeId ? -Game.SWIPE_REVEAL_PX : 0;
      const offset = Math.min(0, Math.max(-Game.SWIPE_REVEAL_PX, base + dx));
      const swipe = this.overlay.querySelector<HTMLElement>(`.editor-home-row-swipe[data-swipe-id="${cssAttrEscape(this.swipeId)}"]`);
      const row = swipe?.querySelector<HTMLElement>(".editor-home-row");
      if (row) row.style.transform = `translateX(${offset}px)`;
      e.preventDefault();
    }, { passive: false });
    const finishSwipe = (e: PointerEvent) => {
      if (!this.swipeId) return;
      const id = this.swipeId;
      this.swipeId = null;
      if (this.swipeAxisLocked !== "horizontal") return;
      const dx = e.clientX - this.swipeStartX;
      const wasOpen = this.swipeOpenId === id;
      const totalOffset = (wasOpen ? -Game.SWIPE_REVEAL_PX : 0) + dx;
      // Snap open if the row crossed the half-reveal threshold; otherwise close.
      const shouldOpen = totalOffset < -Game.SWIPE_REVEAL_PX / 2;
      const swipe = this.overlay.querySelector<HTMLElement>(`.editor-home-row-swipe[data-swipe-id="${cssAttrEscape(id)}"]`);
      const row = swipe?.querySelector<HTMLElement>(".editor-home-row");
      if (row) {
        row.style.transition = "transform 160ms ease-out";
        row.style.transform = `translateX(${shouldOpen ? -Game.SWIPE_REVEAL_PX : 0}px)`;
        // Drop the transition once the snap finishes so the next drag
        // is responsive (no easing during pointermove).
        setTimeout(() => { if (row) row.style.transition = ""; }, 200);
      }
      // If we just opened a different row, close the previously open one.
      if (shouldOpen && this.swipeOpenId && this.swipeOpenId !== id) {
        this.closeSwipeRow();
      }
      this.swipeOpenId = shouldOpen ? id : null;
    };
    this.overlay.addEventListener("pointerup", finishSwipe);
    this.overlay.addEventListener("pointercancel", finishSwipe);

    this.debugEnabled =
      new URLSearchParams(window.location.search).get("debug") === "1";

    // StoreKit listener: a transaction completing outside an active call
    // (e.g. Apple Pay sheet finishing after a backgrounding, a refund, a
    // purchase made on another device) should toggle the unlock flag and
    // refresh the challenge select if it's currently visible.
    onUnlockAllEntitlementChanged((owned) => {
      if (!owned) return;
      setPurchasedUnlock(true);
      if (this.state === "challengeSelect") this.renderChallengeSelect();
    });

    this.renderMenu();

    // Banner listener fires only on platforms where Game Center isn't doing
    // its own banner (i.e. web). Banners are queued so back-to-back unlocks
    // don't stack visually on top of each other.
    setAchievementListener((meta) => this.queueAchievementBanner(meta));

    // Fire-and-forget Game Center auth on iOS; no-op elsewhere.
    // Game Center auth (no-op off iOS) also seeds the local earned-set
    // from any completed achievements the player has on Game Center, so
    // a reinstall / second device picks up the existing polyhex on the
    // menu without the player having to re-earn.
    void initGameCenter().then(() => {
      this.renderAchievementBadges();
    });

    // On iOS, tapping the BEST score opens the GameKit leaderboard, and
    // tapping an achievement badge opens the GameKit achievements view.
    // Clicks are no-ops on web/desktop where GameKit isn't available.
    if (isGameCenterAvailable()) {
      // .hud has `pointer-events: none` to let canvas drags through, so
      // re-enable it on the BEST score itself; otherwise the tap falls
      // through to the menu overlay and starts a game.
      this.bestEl.style.pointerEvents = "auto";
      this.bestEl.style.cursor = "pointer";
      this.bestEl.addEventListener("click", (e) => {
        e.stopPropagation();
        // During a run the GameKit sheet would obscure the play area —
        // pause first so progress isn't lost while the leaderboard is up.
        if (this.state === "playing") this.pauseGame();
        void gcShowLeaderboard(this.difficulty);
      });
    }
  }

  // Queue of metas waiting to be shown; we display one at a time.
  private bannerQueue: AchievementMeta[] = [];
  private bannerActive = false;

  private queueAchievementBanner(meta: AchievementMeta): void {
    this.bannerQueue.push(meta);
    if (!this.bannerActive) this.dequeueAchievementBanner();
  }

  private dequeueAchievementBanner(): void {
    const meta = this.bannerQueue.shift();
    if (!meta) {
      this.bannerActive = false;
      return;
    }
    this.bannerActive = true;
    const banner = document.createElement("div");
    banner.className = "achievement-banner";
    banner.style.setProperty("--banner-tint", meta.tint);
    banner.innerHTML = `
      <div class="achievement-banner-icon">${escapeHtml(meta.badge)}</div>
      <div class="achievement-banner-text">
        <span class="achievement-banner-label">Achievement</span>
        <span class="achievement-banner-name">${escapeHtml(meta.name)}</span>
        <span class="achievement-banner-desc">${escapeHtml(meta.description)}</span>
      </div>
    `;
    document.body.appendChild(banner);
    // Force a reflow so the transition runs from the off-screen state.
    void banner.offsetHeight;
    banner.classList.add("show");
    setTimeout(() => {
      banner.classList.remove("show");
      setTimeout(() => {
        banner.remove();
        // The on-menu badge strip is recomputed live so the player sees
        // the new earn appear without restarting.
        this.renderAchievementBadges();
        this.dequeueAchievementBanner();
      }, 380);
    }, 2800);
  }

  private renderAchievementBadges(): void {
    const host = document.getElementById("achievementBadges");
    if (!host) return;
    const earned = getEarnedAchievements();
    const countEl = document.getElementById("achievementCount");
    if (countEl) countEl.textContent = `${earned.length}/${ACHIEVEMENT_LIST.length}`;
    if (earned.length === 0) {
      host.innerHTML = "";
      host.style.width = "";
      host.style.height = "";
      return;
    }

    // Three-row pointy-top hex grid. Cells are placed at their natural
    // tiled positions (no per-row centering, which fights the half-column
    // stagger). Counts are distributed for visual balance:
    //   N % 3 == 0 → equal across rows (e.g. 9/9/9)
    //   N % 3 == 1 → middle row gets the extra (28 → 9/10/9, interlocks)
    //   N % 3 == 2 → outer rows get the extras (29 → 10/9/10)
    const ROWS = 3;
    const MAX_COLS = 10;
    const MAX_W = 320;
    const MAX_H = 96;

    const N = Math.min(earned.length, ROWS * MAX_COLS);
    const base = Math.floor(N / ROWS);
    const bias = N % ROWS;
    const counts: number[] =
      bias === 1 ? [base, base + 1, base]
      : bias === 2 ? [base + 1, base, base + 1]
      : [base, base, base];
    const widestCount = Math.max(...counts);

    // Pick hex size so widest row + the half-column stagger fits MAX_W,
    // and three rows fit MAX_H.
    const sizeForW = MAX_W / ((widestCount + 0.5) * SQRT3);
    const sizeForH = MAX_H / (2 + 1.5 * (ROWS - 1));
    const size = Math.min(sizeForW, sizeForH);
    const w = SQRT3 * size;
    const h = 2 * size;
    const rowPitch = 1.5 * size;
    const fontPx = Math.max(8, size * 0.55);

    // Brick layout: every other row offset by half a column so rows
    // interlock vertically. Don't center shorter rows — that
    // inward shift cancels the stagger and produces a square grid.
    let maxRight = 0;
    for (let r = 0; r < ROWS; r++) {
      const stagger = r % 2 === 1 ? w * 0.5 : 0;
      const right = counts[r]! * w + stagger;
      if (right > maxRight) maxRight = right;
    }
    const totalW = maxRight;
    const totalH = h + rowPitch * (ROWS - 1);
    host.style.width = `${Math.ceil(totalW)}px`;
    host.style.height = `${Math.ceil(totalH)}px`;

    let idx = 0;
    const cells: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      const rowCount = counts[r]!;
      const stagger = r % 2 === 1 ? w * 0.5 : 0;
      for (let c = 0; c < rowCount; c++) {
        const meta = earned[idx++]!;
        const cellLeft = c * w + stagger;
        const top = r * rowPitch;
        cells.push(
          `<span class="achievement-badge" style="--badge-tint:${meta.tint}; left:${cellLeft.toFixed(2)}px; top:${top.toFixed(2)}px; width:${w.toFixed(2)}px; height:${h.toFixed(2)}px; font-size:${fontPx.toFixed(2)}px;" title="${escapeHtml(meta.name)} — ${escapeHtml(meta.description)}">${escapeHtml(meta.badge)}</span>`,
        );
      }
    }
    host.innerHTML = cells.join("");
  }

  // ?debug=1 keeps the regular PLAY button and adds a "start at N"
  // dropdown next to it so testers can begin a run at any score
  // without grinding. The PLAY click handler reads the dropdown's
  // value when debug is enabled. Challenge screens never get this —
  // they have their own debug affordance via the unlocked-by-default
  // block list (DEBUG_MODE in challenges.ts).
  private debugApplyMenu(): void {
    if (!this.debugEnabled) return;
    const playBtn = this.overlay.querySelector<HTMLButtonElement>(
      'button.play-btn[data-action="play"]',
    );
    if (!playBtn) return;
    const wrap = document.createElement("label");
    wrap.className = "debug-start-wrap";
    const labelEl = document.createElement("span");
    labelEl.className = "debug-start-label";
    labelEl.textContent = "START AT";
    wrap.appendChild(labelEl);
    const select = document.createElement("select");
    select.id = "debugStartScore";
    select.className = "debug-start-select";
    for (let s = 0; s <= 1500; s += 100) {
      const opt = document.createElement("option");
      opt.value = String(s);
      opt.textContent = String(s);
      if (s === this.debugStartScore) opt.selected = true;
      select.appendChild(opt);
    }
    wrap.appendChild(select);
    // Insert the picker immediately after the PLAY button so the
    // regular play affordance is preserved and the start-at picker
    // sits unobtrusively beside it.
    playBtn.insertAdjacentElement("afterend", wrap);
  }

  start(): void {
    this.lastTime = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastTime) / 1000);
      this.lastTime = t;
      this.update(dt);
      this.render(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.unbindInput?.();
  }

  // True if the current run started above zero (i.e. via a debug button),
  // in which case the high score should NOT be banked at game over.
  private debugRun = false;
  private debugEnabled = false;

  // Swipe-to-delete state for the editor home list. At most one row can
  // be open at a time. `swipeOpenId` is the data-swipe-id of the row
  // currently translated; `swipeStartX/Y` and `swipeId` track an
  // in-progress drag. swipeAxisLocked flips to "horizontal" once the
  // user has moved enough horizontally to commit (suppresses page scroll).
  private swipeOpenId: string | null = null;
  private swipeId: string | null = null;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeAxisLocked: "none" | "horizontal" | "vertical" = "none";
  private static readonly SWIPE_REVEAL_PX = 96;
  private static readonly SWIPE_AXIS_THRESHOLD_PX = 8;
  // Last "start at N" the player picked from the debug dropdown, so the
  // PLAY AGAIN button on game-over can resume from the same score.
  private debugStartScore = 0;

  // Cached IAP product info — fetched once on the first challenge-select
  // open and reused so the localized price is available immediately on
  // subsequent renders. Null until resolved or on web.
  private unlockProduct: ProductInfo | null = null;
  // Where to navigate back to from the unlock-everything screen — set
  // when openUnlockShop() runs so the Back button returns to the right
  // surface (menu vs challenge select).
  private unlockShopReturnState: GameState = "menu";

  // Community challenge browse state. Cached so re-rendering the
  // challenge select (e.g. after a back-from-intro) doesn't refetch.
  // Cleared when leaving the challenge select.
  private communityChallenges: PublishedChallenge[] = [];
  private communitySort: CommunitySort = "newest";
  private communityLoaded = false;
  private communityLoading = false;
  private communityError: string | null = null;
  // Local upvote cache: which PublishedChallenge record names this
  // player has upvoted in their CK Upvote rows. Loaded lazily on first
  // browse so the heart icon shows the correct filled / hollow state.
  private upvoteCache = new Set<string>();
  // Per-modal state for the leaderboard + report sheets.
  private leaderboardSheet: { recordName: string; rows: CommunityScore[]; loading: boolean } | null = null;
  private reportSheet: { recordName: string; reason: ReportReason; note: string } | null = null;

  // Deep-link single-challenge view: when set, renderSingleChallenge
  // shows just this one card with full actions. `origin` records
  // where to send the player when they tap BACK.
  private singleChallenge: {
    recordName: string;
    challenge: PublishedChallenge | null;
    error: string | null;
    origin: "menu" | "challengeSelect";
  } | null = null;

  // Spawn-side RNG. Defaults to Math.random for endless mode; swapped
  // to a seeded mulberry32 keyed per-wave on (challengeSeedKey, waveIdx)
  // at beginChallengeWave, so editing one wave's DSL doesn't ripple
  // through the rng stream of later waves.
  private rng: Random = Math.random;

  // Stable seed key for the active challenge run. Roster uses the
  // challenge id; custom challenges stringify their numeric seed.
  // Combined with waveIdx in hashSeed() to derive each wave's seed.
  private challengeSeedKey = "";

  // Achievement gate: in ?debug=1 mode no achievements get reported, so
  // experimenting with high-score test runs doesn't dirty Game Center
  // / localStorage achievement state.
  private awardAchievement(id: AchievementId): void {
    if (this.debugEnabled) return;
    void reportAchievement(id);
  }

  private startOrRestart(initialScore = 0): void {
    this.resetRunState(initialScore);
    this.state = "playing";
    this.overlay.classList.add("hidden");
    this.setScoreVisible(true);
    this.setPauseButtonVisible(true);
    this.setSliderEnabled(true);
    this.setInPlay(true);
    setMusicSpeed(1);
    startMusic();
    this.maybeShowControlsHint();
    if (!this.debugRun) trackPlayStart(this.difficulty);
  }

  // First-run reminder: fade a small DOM banner over the canvas with
  // the keyboard control summary. Only fires on desktop and only the
  // first time the player ever starts a run. Reset hints brings it
  // back. Mirrors the AVOID/HEAL/SLOW one-shot teach pattern.
  private maybeShowControlsHint(): void {
    if (isTouchDevice() || this.controlsHintShown) return;
    const hint = document.getElementById("controlsHint");
    if (!hint) return;
    hint.hidden = false;
    hint.classList.remove("fading");
    // Mark as shown immediately so future runs don't replay it; also
    // schedules the fade-out so the player has time to read.
    this.controlsHintShown = true;
    saveBool(CONTROLS_HINT_STORAGE_KEY, true);
    setTimeout(() => hint.classList.add("fading"), 4500);
    setTimeout(() => { hint.hidden = true; hint.classList.remove("fading"); }, 5500);
  }

  private renderMenu(): void {
    // Restore the menu markup — paused / game-over screens overwrite
    // this.overlay.innerHTML, so without this the QUIT-to-menu path
    // would leave the PAUSED text on screen.
    this.overlay.innerHTML = this.menuOverlayHtml;
    this.overlay.classList.remove("hidden");
    this.debugApplyMenu();
    this.renderAchievementBadges();
    this.refreshDifficultyButtons();
    this.refreshAudioToggles();
    this.refreshChallengeEditorLock();
    // Score is always 0 on the menu — the BEST readout is the only
    // useful number. Hide the score block until a run starts.
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(true);
    // Main menu — touchbar serves no purpose, hide it.
    this.setInPlay(false);
  }

  private setScoreVisible(visible: boolean): void {
    const scoreParent = this.scoreEl.parentElement;
    if (scoreParent) scoreParent.hidden = !visible;
  }

  // Hide the whole HUD (score + BEST + pause). Used on screens that have
  // their own sticky header — the HUD sits above the overlay (z-index 5)
  // so leaving the BEST value on screen makes it overlap challenge-select
  // controls like the back button.
  private setHudVisible(visible: boolean): void {
    const hud = document.querySelector<HTMLElement>(".hud");
    if (hud) hud.hidden = !visible;
  }

  private setPauseButtonVisible(visible: boolean): void {
    if (this.pauseBtn) this.pauseBtn.hidden = !visible;
  }

  // ----- Challenge UI ---------------------------------------------------

  private async handleIapPurchase(btn: HTMLButtonElement): Promise<void> {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("loading");
    try {
      const state = await purchaseUnlockAll();
      if (state === "purchased") {
        setPurchasedUnlock(true);
        this.refreshAfterUnlockChange();
        return;
      }
      if (state === "pending") {
        // Apple is waiting on something (Ask-to-Buy, etc). The
        // entitlement listener will fire once it clears.
        this.flashIapMessage(btn, "Pending…");
      } else if (state === "failed") {
        this.flashIapMessage(btn, "Try again");
      }
      // "cancelled" → silent return; user knows what they did.
    } finally {
      if (btn.isConnected) {
        btn.innerHTML = original;
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  private async handleIapRestore(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      const owned = await restoreUnlockAll();
      if (owned) {
        setPurchasedUnlock(true);
        this.refreshAfterUnlockChange();
      } else {
        this.flashIapMessage(btn, "Nothing to restore");
      }
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }

  // The IAP also unlocks hardcore. After a successful purchase or
  // restore we re-render whichever screen the player is on so the
  // freshly-unlocked content shows up without a navigation round-trip.
  private refreshAfterUnlockChange(): void {
    if (this.state === "unlockShop") {
      this.closeUnlockShop();
      return;
    }
    if (this.state === "challengeSelect") {
      this.renderChallengeSelect();
      return;
    }
    if (this.state === "menu") {
      this.refreshDifficultyButtons();
      this.refreshChallengeEditorLock();
    }
  }

  // Mirror the locked/unlocked state of the IAP onto the menu's
  // CHALLENGE EDITOR button. Locked → adds a lock-icon prefix and a
  // `.locked` class; unlocked → plain label. Click handler routes to
  // the unlock shop when locked, the editor otherwise.
  private refreshChallengeEditorLock(): void {
    const btn = this.overlay.querySelector<HTMLButtonElement>('button[data-action="challenge-editor"]');
    if (!btn) return;
    const unlocked = loadChallengeProgress().purchasedUnlock || this.debugEnabled || this.isEditorTempUnlocked();
    btn.classList.toggle("locked", !unlocked);
    btn.innerHTML = unlocked
      ? "CHALLENGE EDITOR"
      : '<span class="play-btn-lock" aria-hidden="true">🔒</span> CHALLENGE EDITOR';
  }

  // Briefly replace the button label with a status string, then revert.
  // Pure UI sugar — no state changes.
  private flashIapMessage(btn: HTMLButtonElement, msg: string): void {
    const original = btn.textContent ?? "";
    btn.textContent = msg;
    window.setTimeout(() => {
      if (btn.isConnected) btn.textContent = original;
    }, 1500);
  }

  // Unlock-everything screen. Bundles the IAP description (all
  // challenges + hardcore difficulty) with buy + restore buttons, and
  // routes Back to the surface the user came from.
  private openUnlockShop(): void {
    this.unlockShopReturnState = this.state === "challengeSelect" ? "challengeSelect" : "menu";
    this.state = "unlockShop";
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    this.renderUnlockShop();
    this.overlay.classList.remove("hidden");
    if (isStoreKitAvailable() && !this.unlockProduct) {
      void getUnlockAllProduct().then((p) => {
        if (!p) return;
        this.unlockProduct = p;
        if (this.state === "unlockShop") this.renderUnlockShop();
      });
    }
  }

  private closeUnlockShop(): void {
    if (this.unlockShopReturnState === "challengeSelect") {
      this.openChallengeSelect();
    } else {
      this.state = "menu";
      this.renderMenu();
    }
  }

  private openBlocksGuide(): void {
    this.state = "blocksGuide";
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    this.renderBlocksGuide();
    this.overlay.classList.remove("hidden");
  }

  private closeBlocksGuide(): void {
    this.state = "menu";
    this.renderMenu();
  }

  private renderBlocksGuide(): void {
    this.overlay.innerHTML = BlocksGuide.render();
    BlocksGuide.bind?.(this.overlay);
  }

  // ----- Challenge Editor ----------------------------------------------

  private openEditorHome(): void {
    this.state = "editorHome";
    this.editingCustom = null;
    this.editorSelectedWaveIdx = 0;
    this.editorDialog = null;
    this.editorDialogWaveIdx = null;
    this.swipeOpenId = null;
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    this.setEditorActive(true);
    this.renderEditorHome();
    this.overlay.classList.remove("hidden");
  }

  private closeEditorHome(): void {
    this.editingCustom = null;
    this.editorDialog = null;
    this.editorDialogWaveIdx = null;
    this.setEditorActive(false);
    this.state = "menu";
    this.renderMenu();
  }

  // Hide the play canvas + clear leftover physics bodies while the
  // editor is in front. The editor is unambiguously a menu, not a game
  // mode, so the starfield and player blob shouldn't peek through.
  private setEditorActive(active: boolean): void {
    document.body.classList.toggle("editor-active", active);
    if (active) {
      // Clear menu-mode practice clusters so re-entering play later
      // doesn't inherit a half-tumbled scene.
      for (const c of this.clusters) Composite.remove(this.engine.world, c.body);
      this.clusters = [];
      this.clusterByBodyId.clear();
      for (const d of this.debris) Composite.remove(this.engine.world, d.body);
      this.debris = [];
      this.sideWarnings = [];
    }
  }

  private renderEditorHome(): void {
    const allCustoms = listCustomChallenges();
    const authoredCustoms = allCustoms.filter((c) => !c.installedFrom);
    const progress = loadChallengeProgress();
    const unlockedSet = new Set(progress.unlockedBlocks);
    const remixRoster = CHALLENGES.filter((def) => unlockedSet.has(def.block));
    const remixCommunity = allCustoms.filter((c) => !!c.installedFrom);
    this.overlay.innerHTML = renderEditorHomeView({
      authoredCustoms,
      remixRoster,
      remixCommunity,
    });
  }

  private openEditorEdit(custom: CustomChallenge): void {
    this.editingCustom = { ...custom, effects: { ...custom.effects }, stars: { ...custom.stars }, waves: [...custom.waves] };
    this.editorSelectedWaveIdx = 0;
    this.editorDialog = null;
    this.editorDialogWaveIdx = null;
    this.state = "editorEdit";
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    this.setEditorActive(true);
    this.renderEditorEdit();
    this.overlay.classList.remove("hidden");
  }

  private renderEditorEdit(): void {
    const c = this.editingCustom;
    if (!c) return;

    const dialogHtml = this.editorDialog === "wave"
      ? renderWaveDialogView({
          workingLine: this.editorDialogWaveLine,
          isNewWave: this.editorDialogIsNewWave,
          waveIdx: this.editorDialogWaveIdx,
          presetId: this.editorDialogPresetId,
          presetsOpen: this.editorDialogPresetsOpen,
          advancedOpen: this.editorDialogAdvancedOpen,
          pctValues: this.editorDialogPctValues,
        })
      : this.editorDialog === "customWave"
        ? renderCustomWaveDialogView({
            isNewWave: this.editorDialogIsNewWave,
            waveIdx: this.editorDialogWaveIdx,
            paletteKinds: CUSTOM_WAVE_KINDS,
            selectedKind: this.editorCustomWaveKind,
            rate: this.editorCustomWaveRate,
            speed: this.editorCustomWaveSpeed,
            walls: this.editorCustomWaveWalls,
            optionsOpen: this.editorCustomWaveOptionsOpen,
            slots: this.editorCustomWaveSlots,
            visibleRows: this.editorCustomWaveVisibleRows,
            maxRows: CUSTOM_WAVE_LEN,
            picker: this.editorCustomCellPicker,
          })
        : this.editorDialog === "settings"
          ? renderSettingsDialogView({ challenge: c })
          : "";

    // Snapshot scroll positions of in-place re-rendered dialogs so the
    // user doesn't get yanked back to the top after every tweak.
    const customDialogScroll = this.overlay.querySelector<HTMLElement>(".editor-dialog-custom-wave")?.scrollTop ?? 0;
    const waveDialogScroll = this.overlay.querySelector<HTMLElement>(".editor-dialog-wave")?.scrollTop ?? 0;
    const customPaletteScroll = this.overlay.querySelector<HTMLElement>(".editor-custom-palette-row")?.scrollLeft ?? 0;

    this.overlay.innerHTML = renderEditorEditView({
      challenge: c,
      maxWaves: MAX_WAVES_PER_CUSTOM,
      maxNameLen: MAX_CUSTOM_NAME_LEN,
      selectedWaveIdx: this.editorSelectedWaveIdx,
      dialogHtml,
    });

    // Paint thumbnails after the DOM is in place.
    this.overlay.querySelectorAll<HTMLCanvasElement>("canvas[data-wave-thumb]").forEach((cv) => {
      const idx = parseInt(cv.dataset.waveThumb ?? "-1", 10);
      const line = c.waves[idx];
      if (typeof line !== "string") return;
      try {
        const parsed = parseWaveLine(line);
        drawWavePreview(cv, parsed);
      } catch {
        // Leave the canvas blank — the row already renders an inline error.
      }
    });
    // Paint cluster-mix icons in the wave dialog (small block thumbnails).
    this.overlay.querySelectorAll<HTMLCanvasElement>("canvas[data-mix-icon]").forEach((cv) => {
      const kind = cv.dataset.mixIcon as ClusterKind | undefined;
      if (!kind) return;
      drawBlockIcon(cv, kind);
    });
    // Paint custom-wave palette + grid cell icons.
    this.overlay.querySelectorAll<HTMLCanvasElement>("canvas[data-block-icon]").forEach((cv) => {
      const kind = cv.dataset.blockIcon as ClusterKind | undefined;
      if (!kind) return;
      drawBlockIcon(cv, kind);
    });
    // Paint the cell-picker's polyhex previews ("kind:size" attribute).
    this.overlay.querySelectorAll<HTMLCanvasElement>("canvas[data-shape-icon]").forEach((cv) => {
      const attr = cv.dataset.shapeIcon ?? "";
      const [kind, sizeStr] = attr.split(":");
      const size = parseInt(sizeStr ?? "1", 10);
      if (!kind || !Number.isFinite(size)) return;
      drawClusterShapeIcon(cv, kind as ClusterKind, size);
    });

    this.bindEditorDragHandles();

    // Restore preserved scroll positions of in-place dialogs.
    const customDlg = this.overlay.querySelector<HTMLElement>(".editor-dialog-custom-wave");
    if (customDlg && customDialogScroll > 0) customDlg.scrollTop = customDialogScroll;
    const waveDlg = this.overlay.querySelector<HTMLElement>(".editor-dialog-wave");
    if (waveDlg && waveDialogScroll > 0) waveDlg.scrollTop = waveDialogScroll;
    const customPalette = this.overlay.querySelector<HTMLElement>(".editor-custom-palette-row");
    if (customPalette && customPaletteScroll > 0) customPalette.scrollLeft = customPaletteScroll;

    // Position the cell-picker popup beside the clicked cell, clamping
    // to the viewport. The picker lives outside the transformed dialog
    // so position: fixed coords are viewport-relative here.
    if (this.editorCustomCellPicker?.cellRect) {
      const picker = this.overlay.querySelector<HTMLElement>(".editor-custom-picker");
      if (picker) this.positionCustomCellPicker(picker, this.editorCustomCellPicker.cellRect);
    }
  }

  private positionCustomCellPicker(picker: HTMLElement, cellRect: DOMRect): void {
    const PAD = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Force a layout flush before measuring so width/height reflect CSS.
    const w = picker.offsetWidth || 360;
    const h = picker.offsetHeight || 240;
    let left = cellRect.left + cellRect.width / 2 - w / 2;
    if (left + w > vw - PAD) left = vw - PAD - w;
    if (left < PAD) left = PAD;
    let top = cellRect.bottom + 6;
    if (top + h > vh - PAD) {
      // Not enough room below — try above.
      top = cellRect.top - h - 6;
    }
    if (top < PAD) top = PAD;
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
  }

  // Pointer-event-based drag-reorder. Mirrors the touch/mouse routing
  // pattern in bindSlider() — pointerdown captures, pointermove updates
  // a transform on the row, pointerup picks the insertion index by
  // walking sibling midpoints.
  private bindEditorDragHandles(): void {
    const handles = this.overlay.querySelectorAll<HTMLElement>('.editor-drag-handle');
    handles.forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => this.onEditorDragStart(e));
    });
  }

  private onEditorDragStart(e: PointerEvent): void {
    if (this.editorDialog !== null) return;
    const target = e.currentTarget as HTMLElement;
    const idxStr = target.dataset.waveIdx;
    if (idxStr === undefined) return;
    const idx = parseInt(idxStr, 10);
    if (!Number.isFinite(idx)) return;
    const rowEl = target.closest<HTMLElement>(".editor-wave-row");
    if (!rowEl) return;
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    this.editorDragData = {
      waveIdx: idx,
      pointerId: e.pointerId,
      startY: e.clientY,
      rowEl,
      rowHeight: rowEl.getBoundingClientRect().height,
    };
    rowEl.classList.add("dragging");
    target.addEventListener("pointermove", this.onEditorDragMoveBound);
    target.addEventListener("pointerup", this.onEditorDragEndBound);
    target.addEventListener("pointercancel", this.onEditorDragEndBound);
  }

  private onEditorDragMoveBound = (e: PointerEvent) => this.onEditorDragMove(e);
  private onEditorDragEndBound = (e: PointerEvent) => this.onEditorDragEnd(e);

  private onEditorDragMove(e: PointerEvent): void {
    const drag = this.editorDragData;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    drag.rowEl.style.transform = `translateY(${dy}px)`;
    drag.rowEl.style.zIndex = "10";
  }

  private onEditorDragEnd(e: PointerEvent): void {
    const drag = this.editorDragData;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const target = e.currentTarget as HTMLElement;
    target.removeEventListener("pointermove", this.onEditorDragMoveBound);
    target.removeEventListener("pointerup", this.onEditorDragEndBound);
    target.removeEventListener("pointercancel", this.onEditorDragEndBound);
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);

    const droppedY = e.clientY;
    const list = this.overlay.querySelector<HTMLElement>(".editor-wave-list");
    let insertIdx = drag.waveIdx;
    if (list) {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(".editor-wave-row"));
      // After removing the dragged row from the array, insert at the
      // count of *other* rows whose vertical midpoint is above the drop
      // point. That count is the natural insertion index in the new array.
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i === drag.waveIdx) continue;
        const r = rows[i]!.getBoundingClientRect();
        if (droppedY > r.top + r.height / 2) count++;
      }
      insertIdx = Math.max(0, Math.min(rows.length - 1, count));
    }
    drag.rowEl.style.transform = "";
    drag.rowEl.style.zIndex = "";
    drag.rowEl.classList.remove("dragging");
    this.editorDragData = null;

    if (this.editingCustom && insertIdx !== drag.waveIdx) {
      const waves = this.editingCustom.waves.slice();
      const [moved] = waves.splice(drag.waveIdx, 1);
      if (moved !== undefined) waves.splice(insertIdx, 0, moved);
      this.editingCustom.waves = waves;
      this.editingCustom = upsertCustomChallenge(this.editingCustom);
      // If the user had selected the moved row, follow it.
      if (this.editorSelectedWaveIdx === drag.waveIdx) {
        this.editorSelectedWaveIdx = insertIdx;
      }
      this.renderEditorEdit();
    } else {
      this.renderEditorEdit();
    }
  }

  // Handle text/seed input changes from the edit screen. Called from the
  // overlay-level input event listener installed in the constructor.
  private handleEditorFieldInput(target: HTMLInputElement): void {
    const c = this.editingCustom;
    if (!c) return;
    const field = target.dataset.editorField;
    if (field === "name") {
      c.name = target.value.slice(0, MAX_CUSTOM_NAME_LEN);
    } else if (field === "seed") {
      const n = parseInt(target.value, 10);
      if (Number.isFinite(n)) c.seed = n >>> 0;
    }
  }

  private handleEditorFieldCommit(): void {
    if (!this.editingCustom) return;
    this.editingCustom = upsertCustomChallenge(this.editingCustom);
  }

  // Convert a custom challenge into a synthetic ChallengeDef and start
  // a run from the given wave index with the user-chosen seed.
  private playCustomChallenge(custom: CustomChallenge, startWaveIdx = 0): void {
    const errs = validateCustomChallenge(custom);
    if (errs.length > 0) {
      // Surface the first parse error in a quick alert; in a future pass
      // this could become an inline banner on the edit screen.
      window.alert(`Cannot play this challenge:\n${errs.join("\n")}`);
      return;
    }
    // Capture entry state BEFORE flipping to "playing" so the back path
    // knows whether to land on editorEdit, editorHome, or challengeSelect.
    // Re-launching from challengeComplete / gameover (PLAY AGAIN) keeps
    // whatever return target was captured on the original launch — the
    // user came from the editor, not from the complete screen.
    if (this.state === "editorEdit") this.customReturnTo = "editorEdit";
    else if (this.state === "editorHome") this.customReturnTo = "editorHome";
    else if (this.state === "challengeSelect") this.customReturnTo = "challengeSelect";
    // else: leave customReturnTo alone (preserve previous launch's target).

    const def = toChallengeDef(custom);
    this.activeChallenge = def;
    this.state = "playing";
    this.overlay.classList.add("hidden");
    this.setEditorActive(false);
    this.setHudVisible(true);
    this.setInPlay(true);
    this.setScoreVisible(true);
    this.setPauseButtonVisible(true);
    this.setSliderEnabled(true);
    this.resetRunState(0);
    this.startChallenge(def, { seed: custom.seed, startWaveIdx });
    setMusicSpeed(1);
    startMusic();
    this.maybeShowControlsHint();
  }

  // Route a custom-challenge end-of-run (back / quit / replay return)
  // to whichever editor screen launched the run. Pulls a fresh record
  // by id (from activeChallenge or editingCustom) so any stat updates
  // from the run land in the UI.
  private returnFromCustomRun(): void {
    const id = this.activeChallenge?.id ?? this.editingCustom?.id ?? null;
    const fresh = id ? getCustomChallenge(id) : null;
    if (this.customReturnTo === "editorEdit" && fresh) {
      this.openEditorEdit(fresh);
    } else if (this.customReturnTo === "challengeSelect") {
      this.openChallengeSelect();
    } else {
      this.openEditorHome();
    }
  }

  // ----- Wave dialog ---------------------------------------------------

  // Open the wave dialog for an existing wave at `idx`. Resets transient
  // dialog state so the dialog opens in advanced view (no preset
  // selected) — the user is editing a known wave, not picking a fresh
  // recipe. Cluster mix is parsed from the existing line so the user
  // sees the wave's current weights.
  private openExistingWaveDialog(idx: number): void {
    if (!this.editingCustom) return;
    this.editorDialog = "wave";
    this.editorDialogWaveIdx = idx;
    this.editorDialogIsNewWave = false;
    this.editorDialogPresetId = null;
    this.editorDialogPresetValues = {};
    this.editorDialogAdvancedOpen = false;
    this.editorDialogWaveLine = this.editingCustom.waves[idx] ?? "";
    this.editorDialogPctValues = parseLineToMix(this.editorDialogWaveLine);
    this.renderEditorEdit();
    this.startWavePreview();
  }

  // Open the wave dialog for a NEW wave. The dialog opens in preset
  // view (advanced collapsed) with the first preset preselected so the
  // user has something usable on first OK.
  private openNewWaveDialog(): void {
    if (!this.editingCustom) return;
    if (this.editingCustom.waves.length >= MAX_WAVES_PER_CUSTOM) return;
    this.editorDialog = "wave";
    this.editorDialogWaveIdx = null;
    this.editorDialogIsNewWave = true;
    this.editorDialogAdvancedOpen = false;
    const initial = WAVE_PRESETS[0]!;
    this.editorDialogPresetId = initial.id;
    this.editorDialogPresetValues = presetDefaults(initial);
    this.editorDialogWaveLine = initial.build(this.editorDialogPresetValues);
    this.editorDialogPctValues = { ...presetMix(initial) };
    this.renderEditorEdit();
    this.startWavePreview();
  }



  private bumpAdvancedField(field: string, delta: number): void {
    this.mutateDialogWave((w) => {
      switch (field) {
        case "sizeMin": {
          w.sizeMin = Math.max(1, Math.min(5, Math.round(w.sizeMin + delta)));
          if (w.sizeMin > w.sizeMax) w.sizeMax = w.sizeMin;
          break;
        }
        case "sizeMax": {
          w.sizeMax = Math.max(1, Math.min(5, Math.round(w.sizeMax + delta)));
          if (w.sizeMax < w.sizeMin) w.sizeMin = w.sizeMax;
          break;
        }
        case "speed": {
          w.baseSpeedMul = clampRound(w.baseSpeedMul + delta, 0.5, 3.0, 0.05);
          break;
        }
        case "wallAmp": {
          w.wallAmp = clampRound(w.wallAmp + delta, 0, 0.5, 0.02);
          break;
        }
        case "wallPeriod": {
          w.wallPeriod = clampRound(w.wallPeriod + delta, 0.05, 5, 0.1);
          break;
        }
        case "dir": {
          w.defaultDir = clampRound(w.defaultDir + delta, -0.35, 0.35, 0.05);
          break;
        }
      }
    });
  }

  private toggleAdvancedField(field: string): void {
    this.mutateDialogWave((w) => {
      if (field === "dirRandom") w.defaultDirRandom = !w.defaultDirRandom;
    });
  }

  private cycleAdvancedField(field: string, dir: number): void {
    this.mutateDialogWave((w) => {
      if (field === "origin") {
        const opts: Array<"top" | "topAngled" | "side"> = ["top", "topAngled", "side"];
        const idx = Math.max(0, opts.indexOf(w.origin));
        w.origin = opts[(idx + dir + opts.length) % opts.length]!;
      } else if (field === "safeCol") {
        const opts: Array<number | "none" | null> = [null, "none", 0, 1, 2, 3, 4, 5, 6, 7, 8];
        const cur = w.safeCol;
        let curIdx = opts.findIndex((o) => o === cur);
        if (curIdx < 0) curIdx = 0;
        w.safeCol = opts[(curIdx + dir + opts.length) % opts.length]!;
      }
    });
  }

  // Re-build the line from the active preset and re-render. Used when
  // the user clicks a preset chip or moves a preset slider. The cluster
  // mix is intentionally NOT touched here — sliders shape the wave,
  // they don't reset block weights.
  private rebuildFromPreset(): void {
    const preset = this.editorDialogPresetId ? getPreset(this.editorDialogPresetId) : null;
    if (!preset) return;
    this.editorDialogWaveLine = preset.build(this.editorDialogPresetValues);
    this.renderEditorEdit();
  }

  // Helper: parse the working dialog line, mutate the parsed wave via
  // `mutate`, then recompose and re-render. Used by the always-visible
  // Count / Duration / Walls controls so each tweak round-trips through
  // the parser (catches anything that would have failed validation).
  private mutateDialogWave(mutate: (w: ParsedWave) => void): void {
    let parsed: ParsedWave;
    try {
      parsed = parseWaveLine(this.editorDialogWaveLine || "size=2-3, rate=0.7, speed=1.2, count=10");
    } catch {
      return;
    }
    mutate(parsed);
    this.editorDialogWaveLine = composeWaveLine(parsed);
    this.renderEditorEdit();
  }

  // Same as mutateDialogWave but skips the DOM re-render. Used by the
  // advanced-form input listeners so live edits feed the preview
  // without yanking focus out of the input on every keystroke.
  private mutateDialogWaveQuiet(mutate: (w: ParsedWave) => void): void {
    let parsed: ParsedWave;
    try {
      parsed = parseWaveLine(this.editorDialogWaveLine || "size=2-3, rate=0.7, speed=1.2, count=10");
    } catch {
      return;
    }
    mutate(parsed);
    this.editorDialogWaveLine = composeWaveLine(parsed);
  }

  // Read a single Advanced form field's current value and apply it to
  // the working line. Live-fed by `input` / `change` listeners so the
  // preview reflects the edit immediately.
  private applyAdvancedFieldToLine(target: HTMLInputElement | HTMLSelectElement): void {
    const field = target.dataset.dialogField;
    if (!field) return;
    const value = target.value;
    this.mutateDialogWaveQuiet((w) => {
      switch (field) {
        case "sizeMin": {
          const n = parseInt(value, 10);
          if (Number.isFinite(n)) {
            w.sizeMin = Math.max(1, Math.min(5, n));
            if (w.sizeMin > w.sizeMax) w.sizeMax = w.sizeMin;
          }
          break;
        }
        case "sizeMax": {
          const n = parseInt(value, 10);
          if (Number.isFinite(n)) {
            w.sizeMax = Math.max(1, Math.min(5, n));
            if (w.sizeMax < w.sizeMin) w.sizeMin = w.sizeMax;
          }
          break;
        }
        case "speed": {
          const n = parseFloat(value);
          if (Number.isFinite(n) && n > 0) w.baseSpeedMul = n;
          break;
        }
        case "slotRate": {
          const n = parseFloat(value);
          if (Number.isFinite(n) && n >= 0.05) w.slotInterval = n;
          break;
        }
        case "wallAmp": {
          const n = parseFloat(value);
          if (Number.isFinite(n) && n >= 0 && n <= 0.5) w.wallAmp = n;
          break;
        }
        case "wallPeriod": {
          const n = parseFloat(value);
          if (Number.isFinite(n) && n > 0.05) w.wallPeriod = n;
          break;
        }
        case "safeCol": {
          if (value === "none") w.safeCol = "none";
          else if (value === "random") w.safeCol = null;
          else {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n >= 0 && n <= 8) w.safeCol = n;
          }
          break;
        }
        case "origin": {
          if (value === "top" || value === "topAngled" || value === "side") {
            w.origin = value;
          }
          break;
        }
        case "dir": {
          const n = parseFloat(value);
          if (Number.isFinite(n)) {
            w.defaultDir = Math.max(-0.35, Math.min(0.35, n));
          }
          break;
        }
      }
    });
    // Live walls update if the safeCol / wall amp changed for an
    // already-zigzag wall — the existing tickWalls + tickWavePreview
    // setup will pick up the new wall amp/period on the next tick.
  }

  // Always-visible Count stepper. Stepping below 1 unsets the cap
  // entirely (count=null → "—"); step from null lifts to 1.
  private bumpQuickCount(delta: number): void {
    this.mutateDialogWave((w) => {
      const cur = w.countCap;
      if (delta > 0) {
        const base = cur === null ? 0 : cur;
        w.countCap = Math.min(200, base + delta);
      } else if (cur !== null) {
        const next = cur + delta;
        w.countCap = next < 1 ? null : next;
      }
    });
  }

  // Always-visible Duration stepper. Step 0.5s; below 0.5 unsets dur
  // (dur=null → "—"); step from null lifts to 0.5.
  private bumpQuickDur(delta: number): void {
    this.mutateDialogWave((w) => {
      const cur = w.durOverride;
      if (delta > 0) {
        const base = cur === null ? 0 : cur;
        const next = Math.min(120, Math.round((base + delta) * 2) / 2);
        w.durOverride = next < 0.5 ? 0.5 : next;
      } else if (cur !== null) {
        const next = Math.round((cur + delta) * 2) / 2;
        w.durOverride = next < 0.5 ? null : next;
      }
    });
  }


  // True for slot-only waves (count=0 + slots) — those open in the
  // isCustomShapedWave moved to waveDsl.ts so screen modules can call
  // it directly without going through Game.

  private openNewCustomWaveDialog(): void {
    if (!this.editingCustom) return;
    if (this.editingCustom.waves.length >= MAX_WAVES_PER_CUSTOM) return;
    this.editorDialog = "customWave";
    this.editorDialogIsNewWave = true;
    this.editorDialogWaveIdx = null;
    this.editorCustomWaveSlots = new Array(CUSTOM_WAVE_LEN).fill(null);
    this.editorCustomWaveKind = "normal";
    this.editorCustomWaveRate = 0.5;
    this.editorCustomWaveSpeed = 1.2;
    this.editorCustomWaveWalls = "none";
    this.editorCustomWaveOptionsOpen = false;
    this.editorCustomWaveVisibleRows = 1;
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
    this.startWavePreview();
  }

  private openExistingCustomWaveDialog(idx: number): void {
    if (!this.editingCustom) return;
    const line = this.editingCustom.waves[idx] ?? "";
    let parsed: ParsedWave | null = null;
    try { parsed = parseWaveLine(line); } catch { parsed = null; }
    this.editorDialog = "customWave";
    this.editorDialogIsNewWave = false;
    this.editorDialogWaveIdx = idx;
    // Inflate slots into the editor's 30-row buffer (truncate / pad as
    // needed). Map back from angleIdx 7/8 to side cells.
    const slots: typeof this.editorCustomWaveSlots = new Array(CUSTOM_WAVE_LEN).fill(null);
    if (parsed) {
      const len = Math.min(CUSTOM_WAVE_LEN, parsed.slots.length);
      for (let i = 0; i < len; i++) {
        const s = parsed.slots[i];
        if (!s) continue;
        const side: "main" | "left" | "right" =
          s.angleIdx === 7 ? "left" : s.angleIdx === 8 ? "right" : "main";
        slots[i] = {
          kind: s.kind,
          size: s.size,
          side,
          col: side === "main" ? Math.max(0, Math.min(9, s.col)) : 0,
          angleIdx: s.angleIdx,
        };
      }
    }
    this.editorCustomWaveSlots = slots;
    this.editorCustomWaveKind = "normal";
    this.editorCustomWaveRate = parsed?.slotInterval ?? 0.5;
    this.editorCustomWaveSpeed = parsed?.baseSpeedMul ?? 1.2;
    this.editorCustomWaveWalls = parsed?.walls ?? "none";
    this.editorCustomWaveOptionsOpen = false;
    // Show as many rows as the original wave defined; ensure the
    // topmost row is empty so the user has somewhere to keep adding.
    const filledLen = parsed?.slots.length ?? 0;
    let rows = Math.max(1, Math.min(CUSTOM_WAVE_LEN, filledLen));
    if (filledLen > 0 && slots[filledLen - 1] !== null && rows < CUSTOM_WAVE_LEN) rows += 1;
    this.editorCustomWaveVisibleRows = rows;
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
    this.startWavePreview();
  }

  // Place a hex at (row, side/col) using the currently-selected kind.
  // Tapping the same position cycles size; tapping a different position
  // in the same row moves the row's hex.
  private placeCustomWaveCell(
    row: number,
    side: "main" | "left" | "right",
    col: number,
  ): void {
    const slot = this.editorCustomWaveSlots[row];
    const sameCell =
      !!slot && slot.side === side && (side !== "main" || slot.col === col);
    const sameKind = !!slot && slot.kind === this.editorCustomWaveKind;
    if (sameCell && sameKind) {
      // Same position AND same kind selected → open the size / angle
      // picker so the user can fine-tune the existing block.
      this.openCustomCellPicker(row);
      return;
    }
    // Different kind selected, or different cell in the same row: place
    // a fresh block (swapping out whatever was there).
    this.editorCustomWaveSlots[row] = {
      kind: this.editorCustomWaveKind,
      size: 1,
      side,
      col: side === "main" ? col : 0,
      angleIdx: side === "left" ? 7 : side === "right" ? 8 : 0,
    };
    // Auto-grow: keep the topmost visible row empty so the user has
    // somewhere to land the next placement. Cap at CUSTOM_WAVE_LEN.
    const topIdx = this.editorCustomWaveVisibleRows - 1;
    if (
      this.editorCustomWaveSlots[topIdx] !== null &&
      this.editorCustomWaveVisibleRows < CUSTOM_WAVE_LEN
    ) {
      this.editorCustomWaveVisibleRows += 1;
    }
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
  }

  // "Add row" button at the top of the grid — inserts another empty
  // row above the current topmost. Capped at CUSTOM_WAVE_LEN.
  private addCustomWaveRow(): void {
    if (this.editorCustomWaveVisibleRows >= CUSTOM_WAVE_LEN) return;
    this.editorCustomWaveVisibleRows += 1;
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
  }

  // Rate is shown as blocks-per-10s (higher = denser) but stored as
  // slotInterval seconds. Treat `delta` as blocks-per-10s so + lifts
  // the displayed value and − drops it; convert back to seconds via
  // 10 / blocks. Snaps to multiples of 5 between 5..200 blocks/10s
  // (= 2.0..0.05s), matching the regular wave editor's stepper.
  private bumpCustomWaveRate(deltaBlocks: number): void {
    const curBlocks = 10 / this.editorCustomWaveRate;
    const snapped = Math.round(curBlocks / 5) * 5;
    const nextBlocks = Math.max(5, Math.min(200, snapped + deltaBlocks));
    this.editorCustomWaveRate = 10 / nextBlocks;
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
  }

  private bumpCustomWaveSpeed(delta: number): void {
    const cur = this.editorCustomWaveSpeed;
    const next = Math.round((cur + delta) * 100) / 100;
    this.editorCustomWaveSpeed = Math.max(0.5, Math.min(3.0, next));
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
  }

  private cycleCustomWaveWalls(dir: number): void {
    const idx = WALL_CYCLE.indexOf(this.editorCustomWaveWalls);
    const len = WALL_CYCLE.length;
    const nextIdx = ((idx < 0 ? 0 : idx) + dir + len) % len;
    this.editorCustomWaveWalls = WALL_CYCLE[nextIdx]!;
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.renderEditorEdit();
  }

  // Compose the slot-only wave line. count=0 disables the prob stream
  // entirely; the slot tokens drive the wave's contents. Slot order is
  // bottom-row-first (index 0 = first to spawn).
  private composeCustomWaveLine(): string {
    const tokens: string[] = [];
    tokens.push("count=0");
    tokens.push(`slotRate=${this.editorCustomWaveRate.toFixed(2)}`);
    tokens.push(`speed=${this.editorCustomWaveSpeed.toFixed(2)}`);
    if (this.editorCustomWaveWalls !== "none") {
      tokens.push(`walls=${this.editorCustomWaveWalls}`);
    }
    // Emit only the visible rows. Hidden trailing slots are excluded
    // so a 5-row wave is exactly 5 slot tokens long.
    const len = Math.min(this.editorCustomWaveVisibleRows, CUSTOM_WAVE_LEN);
    for (let i = 0; i < len; i++) {
      const slot = this.editorCustomWaveSlots[i];
      if (!slot) {
        tokens.push("000");
        continue;
      }
      const prefix = slotKindToPrefix(slot.kind);
      const colDigit = slot.side === "main" ? slot.col : 0;
      tokens.push(`${prefix}${slot.size}${colDigit}${slot.angleIdx}`);
    }
    return tokens.join(", ");
  }

  // Tap on an already-placed cell opens a small picker (size + angle)
  // rather than cycling. Captures the clicked cell's viewport rect so
  // the picker can anchor near it (instead of floating viewport-center).
  private openCustomCellPicker(rowIdx: number): void {
    const slot = this.editorCustomWaveSlots[rowIdx];
    if (!slot) return;
    let sel: string;
    if (slot.side === "main") {
      sel = `button[data-action="editor-custom-cell"][data-row="${rowIdx}"][data-col="${slot.col}"]`;
    } else {
      sel = `button[data-action="editor-custom-cell"][data-row="${rowIdx}"][data-side="${slot.side}"]`;
    }
    const cell = this.overlay.querySelector<HTMLElement>(sel);
    const cellRect = cell?.getBoundingClientRect() ?? null;
    this.editorCustomCellPicker = { rowIdx, cellRect };
    this.renderEditorEdit();
  }

  private closeCustomCellPicker(): void {
    if (!this.editorCustomCellPicker) return;
    this.editorCustomCellPicker = null;
    this.renderEditorEdit();
  }

  private setCustomCellSize(rowIdx: number, size: number): void {
    const slot = this.editorCustomWaveSlots[rowIdx];
    if (!slot) return;
    const isPickup = slot.kind === "coin" || slot.kind === "shield" || slot.kind === "drone";
    slot.size = isPickup ? 1 : Math.max(1, Math.min(5, size));
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    // Selection commits — close the picker. Re-tap the cell to set the
    // other field if needed.
    this.editorCustomCellPicker = null;
    this.renderEditorEdit();
  }

  private setCustomCellAngle(rowIdx: number, angleIdx: number): void {
    const slot = this.editorCustomWaveSlots[rowIdx];
    if (!slot || slot.side !== "main") return;
    slot.angleIdx = Math.max(0, Math.min(6, angleIdx));
    this.editorDialogWaveLine = this.composeCustomWaveLine();
    this.editorCustomCellPicker = null;
    this.renderEditorEdit();
  }

  private applyCustomWaveDialog(): void {
    const c = this.editingCustom;
    if (!c) return;
    const isNew = this.editorDialogIsNewWave;
    const idx = this.editorDialogWaveIdx;
    if (!isNew && idx === null) return;
    // Sanity: at least one slot must have content.
    const hasContent = this.editorCustomWaveSlots.some((s) => s !== null);
    if (!hasContent) {
      window.alert("Place at least one block before saving.");
      return;
    }
    const newLine = this.composeCustomWaveLine();
    this.stopWavePreview();
    if (isNew) {
      c.waves = [...c.waves, newLine];
      this.editorSelectedWaveIdx = c.waves.length - 1;
    } else if (idx !== null) {
      c.waves[idx] = newLine;
    }
    this.editingCustom = upsertCustomChallenge(c);
    this.editorDialog = null;
    this.editorDialogWaveIdx = null;
    this.editorDialogIsNewWave = false;
    this.editorDialogWaveLine = "";
    this.editorCustomWaveSlots = new Array(CUSTOM_WAVE_LEN).fill(null);
    this.renderEditorEdit();
  }

  // ----- Wave preview loop ---------------------------------------------

  // Start a fresh preview run. Clears any in-flight clusters, applies
  // walls + safe-column from the current working line, reseeds the rng,
  // and resets the slot/prob/dur counters. Called on dialog open and on
  // preset pick — other tweaks update live during tick.
  private startWavePreview(): void {
    let parsed: ParsedWave;
    try { parsed = parseWaveLine(this.editorDialogWaveLine); } catch { return; }
    // Clear any leftover bodies from the previous loop.
    for (const c of this.clusters) Composite.remove(this.engine.world, c.body);
    this.clusters = [];
    this.clusterByBodyId.clear();
    for (const d of this.debris) Composite.remove(this.engine.world, d.body);
    this.debris = [];
    this.sideWarnings = [];
    // Apply walls.
    if (parsed.walls === "none") this.setWall("none", 0);
    else if (parsed.walls === "zigzag") this.setWall("zigzag", 1.0, { amp: parsed.wallAmp, period: parsed.wallPeriod });
    else if (parsed.walls === "narrow") this.setWall("narrow", 1.0);
    else this.setWall("pinch", 1.0);
    // Pick safe column for prob spawns (mirrors beginChallengeWave).
    if (parsed.safeCol === "none") this.safeColumn = 99;
    else if (typeof parsed.safeCol === "number") this.safeColumn = parsed.safeCol - 4;
    else {
      const halfFull = Math.floor(BOARD_COLS / 2);
      this.safeColumn = Math.floor(Math.random() * (halfFull * 2 + 1)) - halfFull;
    }
    // Fresh rng so the preview doesn't reuse leftover sequence state.
    this.rng = mulberry32(Math.floor(Math.random() * 0xffffffff));
    this.editorDialogPreview = {
      slotIdx: 0,
      slotTimer: parsed.slotInterval,
      probCount: 0,
      spawnTimer: parsed.spawnInterval,
      waveTimer: parsed.durOverride ?? 0,
      restartDelay: 0,
      lastSpeedMul: parsed.baseSpeedMul,
    };
    document.body.classList.add("editor-previewing");
  }

  private stopWavePreview(): void {
    if (!this.editorDialogPreview) {
      document.body.classList.remove("editor-previewing");
      return;
    }
    this.editorDialogPreview = null;
    for (const c of this.clusters) Composite.remove(this.engine.world, c.body);
    this.clusters = [];
    this.clusterByBodyId.clear();
    for (const d of this.debris) Composite.remove(this.engine.world, d.body);
    this.debris = [];
    this.sideWarnings = [];
    document.body.classList.remove("editor-previewing");
  }

  // Per-frame preview tick. Re-parses the working line each frame so
  // rate/count/dur/walls/mix tweaks apply live. End condition triggers
  // a short delay, then a fresh restart.
  private tickWavePreview(dt: number): void {
    const p = this.editorDialogPreview;
    if (!p) return;
    let parsed: ParsedWave;
    try { parsed = parseWaveLine(this.editorDialogWaveLine); } catch { return; }
    // Live mix override: if the user has bumped any non-default value,
    // weights come from editorDialogPctValues so the preview reflects
    // their tweaks immediately.
    const mix = this.editorDialogPctValues;
    const mixSum = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    if (mixSum > 0) parsed.weights = { ...mix };

    // Live walls: setWall lerps, so flipping kind looks intentional.
    // Also re-apply when wallAmp/wallPeriod change so editing those in
    // Advanced shows up immediately (setWall short-circuits the
    // same-kind path and just updates amp/period instantly).
    const wallKindChanged =
      this.wall.kind !== parsed.walls && this.wall.pendingKind !== parsed.walls;
    const wallShapeChanged =
      parsed.walls === "zigzag" &&
      (Math.abs(this.wall.amp - parsed.wallAmp) > 0.001 ||
       Math.abs(this.wall.period - parsed.wallPeriod) > 0.001);
    if (wallKindChanged || wallShapeChanged) {
      if (parsed.walls === "none") this.setWall("none", 0);
      else if (parsed.walls === "zigzag") this.setWall("zigzag", 1.0, { amp: parsed.wallAmp, period: parsed.wallPeriod });
      else if (parsed.walls === "narrow") this.setWall("narrow", 1.0);
      else this.setWall("pinch", 1.0);
    }

    // Live speed: rescale in-flight cluster velocities so existing
    // spawns also reflect a Speed tweak — without this, the change
    // only kicks in for the next slot/prob spawn, which feels broken.
    if (Math.abs(p.lastSpeedMul - parsed.baseSpeedMul) > 0.001) {
      const ratio = parsed.baseSpeedMul / Math.max(0.0001, p.lastSpeedMul);
      for (const c of this.clusters) {
        const v = c.body.velocity;
        Body.setVelocity(c.body, { x: v.x * ratio, y: v.y * ratio });
      }
      p.lastSpeedMul = parsed.baseSpeedMul;
    }

    if (p.restartDelay > 0) {
      p.restartDelay -= dt;
      if (p.restartDelay <= 0 && this.clusters.length === 0) {
        // Reset counters for next loop. Keep the wall state lerping so
        // the canvas stays continuous.
        p.slotIdx = 0;
        p.slotTimer = parsed.slotInterval;
        p.probCount = 0;
        p.spawnTimer = parsed.spawnInterval;
        p.waveTimer = parsed.durOverride ?? 0;
      } else if (p.restartDelay <= 0) {
        // Clusters still on screen — wait for them to fall off before
        // looping. Hold the timer at 0.
        p.restartDelay = 0;
      }
      return;
    }

    // Slot stream.
    if (parsed.slots.length > 0 && p.slotIdx < parsed.slots.length) {
      p.slotTimer -= dt;
      if (p.slotTimer <= 0) {
        const slot = parsed.slots[p.slotIdx];
        if (slot !== null && slot !== undefined) this.spawnFromSlot(slot, parsed);
        p.slotIdx += 1;
        p.slotTimer = parsed.slotInterval;
      }
    }
    // Probabilistic stream.
    const probLimit = parsed.countCap;
    const probEnabled = (probLimit === null || p.probCount < probLimit);
    if (probEnabled) {
      p.spawnTimer -= dt;
      if (p.spawnTimer <= 0) {
        this.spawnChallengeProbabilistic(parsed);
        p.probCount += 1;
        p.spawnTimer = parsed.spawnInterval;
      }
    }
    // Dur countdown.
    if (parsed.durOverride !== null) p.waveTimer -= dt;
    // End check.
    const slotsDone = p.slotIdx >= parsed.slots.length;
    const probDone = probLimit === null ? false : p.probCount >= probLimit;
    const durDone = parsed.durOverride !== null && p.waveTimer <= 0;
    const streamsDone = slotsDone && (probLimit === null ? parsed.slots.length > 0 : probDone);
    if (durDone || streamsDone) {
      p.restartDelay = 1.0;
    }
  }

  // Always-visible Rate stepper. UI displays blocks per 10s (higher =
  // denser); delta is in those same units. Internally the wave still
  // stores `spawnInterval` in seconds (= 10 / blocksPer10s). Snaps to
  // multiples of 5 blocks/10s, clamped 5..200 (= 2.0s..0.05s).
  private bumpQuickRate(deltaBlocks: number): void {
    this.mutateDialogWave((w) => {
      const curBlocks = 10 / w.spawnInterval;
      const snapped = Math.round(curBlocks / 5) * 5;
      const nextBlocks = Math.max(5, Math.min(200, snapped + deltaBlocks));
      w.spawnInterval = 10 / nextBlocks;
    });
  }

  // Always-visible Walls cycler. Wraps through none / pinch / zigzag /
  // narrow. The mini preview canvas above the label re-paints in the
  // post-render pass.
  private cycleWalls(dir: number): void {
    this.mutateDialogWave((w) => {
      const idx = WALL_CYCLE.indexOf(w.walls);
      const len = WALL_CYCLE.length;
      const nextIdx = ((idx < 0 ? 0 : idx) + dir + len) % len;
      w.walls = WALL_CYCLE[nextIdx]!;
    });
  }

  // Position a help popup so it stays inside the viewport. The dialog
  // has `transform: translate(-50%, -50%)`, which makes it a containing
  // block for `position: fixed` descendants — so we can't use fixed
  // positioning here. Instead we keep the popup's default
  // `position: absolute` (anchored to the help-wrap) and only nudge
  // `left` / `top` to clamp the rect inside the viewport.
  private positionHelpPopup(_btn: HTMLElement, popup: HTMLElement): void {
    const PAD = 8;
    // Reset any previous tweaks so the measurement is clean.
    popup.style.position = "";
    popup.style.left = "";
    popup.style.top = "";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = popup.getBoundingClientRect();
    if (rect.right > vw - PAD) {
      popup.style.left = `${-(rect.right - (vw - PAD))}px`;
    } else if (rect.left < PAD) {
      popup.style.left = `${PAD - rect.left}px`;
    }
    if (rect.bottom > vh - PAD) {
      popup.style.top = `${-rect.height - 4}px`;
    }
  }


  // Adjust a non-normal kind by delta, debiting/crediting `normal` so
  // the total stays at exactly 100%. Clamps when normal would cross
  // zero (positive bumps) or 100 (negative bumps). No-op for kind="normal".
  private bumpClusterMix(kind: ClusterKind, delta: number): void {
    if (kind === "normal") return;
    const cur = this.editorDialogPctValues[kind] ?? 0;
    const norm = this.editorDialogPctValues.normal ?? 0;
    let actualDelta = delta;
    if (delta > 0) {
      // Bumping up — debit normal. If normal can't cover the bump, take
      // whatever is available.
      actualDelta = Math.min(delta, norm);
    } else {
      // Bumping down — refund to normal. Floor the kind at 0.
      actualDelta = Math.max(delta, -cur);
    }
    if (actualDelta === 0) return;
    this.editorDialogPctValues = {
      ...this.editorDialogPctValues,
      [kind]: cur + actualDelta,
      normal: norm - actualDelta,
    };
    this.renderEditorEdit();
  }

  // Read the wave dialog form, compose a DSL line, validate, and apply.
  // Branches on `editorDialogIsNewWave` to either append a new wave or
  // replace the wave at `editorDialogWaveIdx`.
  private applyWaveDialog(): void {
    const c = this.editingCustom;
    if (!c) return;
    const isNew = this.editorDialogIsNewWave;
    const idx = this.editorDialogWaveIdx;
    if (!isNew && idx === null) return;

    // The whole working state lives on `editorDialogWaveLine` — every
    // basic stepper, every advanced cycler / stepper, and the walls
    // cycler call mutateDialogWave which keeps the line current. So
    // OK just parses that line, overlays the cluster mix from the
    // basic view, and carries forward any pre-existing slot tokens.
    let parsedWorking: ParsedWave;
    try { parsedWorking = parseWaveLine(this.editorDialogWaveLine); }
    catch (e) {
      const dlg = this.overlay.querySelector<HTMLElement>(".editor-dialog");
      const msg = `Invalid: ${(e as Error).message}`;
      const errEl = dlg?.querySelector<HTMLElement>(".editor-dialog-err");
      if (errEl) errEl.textContent = msg;
      else dlg?.insertAdjacentHTML("afterbegin", `<div class="editor-dialog-err">${escapeHtml(msg)}</div>`);
      return;
    }

    // Carry forward the existing slot tokens (phase 1 doesn't edit slot
    // patterns through the regular dialog). composeWaveLine drops them
    // because the working line was a fresh recompose, so re-add.
    if (!isNew && idx !== null) {
      const existingLine = c.waves[idx] ?? "";
      try {
        const existing = parseWaveLine(existingLine);
        parsedWorking.slots = existing.slots;
      } catch { /* ignore */ }
    }

    // Compose final DSL from the parsed working wave + the user's mix.
    const tokens = composeWaveLine(parsedWorking).split(", ");
    const KINDS: ClusterKind[] = ["normal", "sticky", "slow", "fast", "coin", "shield", "drone", "tiny", "big"];
    const mix = this.editorDialogPctValues;
    const pctParts: string[] = [];
    let hasNonDefault = false;
    for (const k of KINDS) {
      const v = Math.max(0, Math.round(mix[k] ?? 0));
      if (v > 0) pctParts.push(`${k}:${v}`);
      if ((k === "normal" && v !== 100) || (k !== "normal" && v > 0)) hasNonDefault = true;
    }
    if (hasNonDefault && pctParts.length > 0) {
      tokens.push(`pct=${pctParts.join(",")}`);
    }
    const newLine = tokens.join(", ");

    // Validate before applying.
    try { parseWaveLine(newLine); }
    catch (e) {
      const dlg = this.overlay.querySelector<HTMLElement>(".editor-dialog");
      const msg = `Invalid: ${(e as Error).message}`;
      const errEl = dlg?.querySelector<HTMLElement>(".editor-dialog-err");
      if (errEl) errEl.textContent = msg;
      else dlg?.insertAdjacentHTML("afterbegin", `<div class="editor-dialog-err">${escapeHtml(msg)}</div>`);
      return;
    }

    this.stopWavePreview();
    if (isNew) {
      c.waves = [...c.waves, newLine];
      this.editorSelectedWaveIdx = c.waves.length - 1;
    } else if (idx !== null) {
      c.waves[idx] = newLine;
    }
    this.editingCustom = upsertCustomChallenge(c);
    this.editorDialog = null;
    this.editorDialogWaveIdx = null;
    this.editorDialogIsNewWave = false;
    this.editorDialogPresetId = null;
    this.editorDialogPresetValues = {};
    this.editorDialogWaveLine = "";
    this.editorDialogPctValues = {
      normal: 100, sticky: 0, slow: 0, fast: 0, coin: 0, shield: 0, drone: 0, tiny: 0, big: 0,
    };
    this.renderEditorEdit();
  }

  // ----- Settings dialog ----------------------------------------------


  private bumpSettingsField(field: string, delta: number): void {
    const c = this.editingCustom;
    if (!c) return;
    switch (field) {
      case "slowDuration":
        c.effects.slowDuration = clampRound(c.effects.slowDuration + delta, 0, 30, 0.5);
        break;
      case "fastDuration":
        c.effects.fastDuration = clampRound(c.effects.fastDuration + delta, 0, 30, 0.5);
        break;
      case "shieldDuration":
        c.effects.shieldDuration = clampRound(c.effects.shieldDuration + delta, 0, 60, 0.5);
        break;
      case "droneDuration":
        c.effects.droneDuration = clampRound(c.effects.droneDuration + delta, 0, 60, 0.5);
        break;
      case "dangerSize":
        c.effects.dangerSize = Math.max(2, Math.min(15, Math.round(c.effects.dangerSize + delta)));
        break;
      case "starOne":
        c.stars.one = Math.max(0, Math.round(c.stars.one + delta));
        break;
      case "starTwo":
        c.stars.two = Math.max(0, Math.round(c.stars.two + delta));
        break;
      case "starThree":
        c.stars.three = Math.max(0, Math.round(c.stars.three + delta));
        break;
    }
    this.renderEditorEdit();
  }

  private applySettingsDialog(): void {
    const c = this.editingCustom;
    if (!c) return;
    // Numeric fields are live-mutated by the steppers — only the
    // difficulty selection still lives in the DOM (`.selected` class
    // on the picker buttons), so reconcile that on OK.
    const dlg = this.overlay.querySelector<HTMLElement>(".editor-dialog");
    const diffSel = dlg?.querySelector<HTMLButtonElement>(".editor-diff-btn.selected");
    if (diffSel) {
      const d = parseInt(diffSel.dataset.dialogDifficulty ?? String(c.difficulty), 10);
      if (d >= 1 && d <= 5) c.difficulty = d as 1 | 2 | 3 | 4 | 5;
    }
    this.editingCustom = upsertCustomChallenge(c);
    this.editorDialog = null;
    this.renderEditorEdit();
  }

  private autoSuggestStars(): void {
    const c = this.editingCustom;
    if (!c) return;
    const def = toChallengeDef(c);
    const t = computeStarThresholds(def);
    c.stars.one = t.one;
    c.stars.two = t.two;
    c.stars.three = t.three;
    this.renderEditorEdit();
  }

  // Estimate a difficulty rating (1..5) by walking the wave list and
  // weighting length, average + peak speed, walls density, and
  // power-up presence. Cosmetic — drives the difficulty hex count on
  // the challenge card, not gameplay.
  private autoSuggestDifficulty(): void {
    const c = this.editingCustom;
    if (!c) return;
    const parsed: ParsedWave[] = [];
    for (const line of c.waves) {
      try { parsed.push(parseWaveLine(line)); } catch { /* skip bad waves */ }
    }
    if (parsed.length === 0) return;

    let speedSum = 0;
    let speedMax = 0;
    let wallsCount = 0;
    let hardWallsCount = 0;
    let helpfulSum = 0;
    for (const w of parsed) {
      speedSum += w.baseSpeedMul;
      if (w.baseSpeedMul > speedMax) speedMax = w.baseSpeedMul;
      if (w.walls !== "none") wallsCount += 1;
      if (w.walls === "narrow" || w.walls === "zigzag") hardWallsCount += 1;
      const wsum = Object.values(w.weights).reduce((a, b) => a + (b ?? 0), 0) || 1;
      const helpful =
        ((w.weights.sticky ?? 0) +
          (w.weights.slow ?? 0) +
          (w.weights.coin ?? 0) +
          (w.weights.shield ?? 0)) /
        wsum;
      helpfulSum += helpful;
    }
    const length = parsed.length;
    const speedAvg = speedSum / length;
    const wallsRate = wallsCount / length;
    const hardWallsRate = hardWallsCount / length;
    const helpfulPct = helpfulSum / length;

    // Each factor adds roughly 0..1; sum + 1 gives a 1..5 rating after
    // clamping. Tuned against the shipped roster's block 1..6 spread.
    let score = 1;
    score += Math.min(1.5, Math.max(0, (length - 10) / 40));
    score += Math.min(1.5, Math.max(0, (speedAvg - 0.9) * 1.5));
    score += Math.min(0.5, Math.max(0, (speedMax - 1.5) / 1.4));
    score += wallsRate;
    score += hardWallsRate * 0.5;
    score -= Math.min(0.5, helpfulPct);
    const diff = Math.max(1, Math.min(5, Math.round(score))) as 1 | 2 | 3 | 4 | 5;

    // Update both the dialog UI and the working model so OK can read
    // the selected button as before. Also mutate editingCustom so the
    // suggestion persists if the user closes the dialog without OK.
    if (this.editingCustom) this.editingCustom.difficulty = diff;
    const dlg = this.overlay.querySelector<HTMLElement>(".editor-dialog");
    if (!dlg) return;
    dlg.querySelectorAll<HTMLButtonElement>(".editor-diff-btn").forEach((b) => {
      const d = parseInt(b.dataset.dialogDifficulty ?? "0", 10);
      b.classList.toggle("selected", d === diff);
    });
  }

  // ----- Publish to Community ------------------------------------------

  private async publishCustomChallenge(custom: CustomChallenge): Promise<void> {
    // Debug mode keeps the legacy "copy roster JSON to clipboard" flow
    // for authoring official content; everywhere else routes through
    // the real CloudKit publish path.
    if (this.debugEnabled && !isCloudKitAvailable()) {
      const rosterId = window.prompt('Roster ID? (e.g. "7-1")', "");
      if (!rosterId) return;
      const blockMatch = rosterId.match(/^(\d)-(\d)$/);
      const block = blockMatch ? Math.max(1, Math.min(6, parseInt(blockMatch[1]!, 10))) : 1;
      const index = blockMatch ? Math.max(1, Math.min(5, parseInt(blockMatch[2]!, 10))) : 1;
      const def = {
        id: rosterId,
        name: custom.name,
        block,
        index,
        difficulty: custom.difficulty,
        effects: { ...custom.effects },
        waves: [...custom.waves],
      };
      const json = JSON.stringify(def, null, 2);
      void navigator.clipboard?.writeText(json).catch(() => { /* ignore */ });
      // eslint-disable-next-line no-console
      console.log("[editor] published:", json);
      window.alert("Challenge definition copied to clipboard (and logged to console).");
      return;
    }

    if (!isCloudKitAvailable()) {
      window.alert("Publishing requires iOS with iCloud signed in.");
      return;
    }
    const errors = validateCustomChallenge(custom);
    if (errors.length > 0) {
      window.alert("Fix these before publishing:\n\n• " + errors.join("\n• "));
      return;
    }
    const isUpdate = !!custom.publishedRecordName;
    const verb = isUpdate ? "Update your published challenge" : "Publish to Community";
    const disclaimer = isUpdate
      ? "Your name and the new content will replace the previous version for everyone who has installed it. Their best scores will be kept."
      : "Your Game Center display name and this challenge will be visible to other players. Inappropriate names can be reported and removed.";
    if (!window.confirm(`${verb}?\n\n${disclaimer}`)) return;

    if (!(await isCloudReady())) {
      window.alert("iCloud isn't available. Check Settings → iCloud and try again.");
      return;
    }
    const authorName = getGameCenterDisplayName() ?? "Anonymous";
    const result = await cloudPublish(custom, authorName);
    if (!result.ok) {
      const msg = result.moderation?.message
        ?? result.error
        ?? "Publish failed. Please try again.";
      window.alert(msg);
      return;
    }
    window.alert(isUpdate ? "Update published." : "Challenge published to Community.");
    // Re-render the editor home so the PUBLISH button switches to UPDATE
    // and the new "Published" badge appears.
    if (this.state === "editorHome") this.renderEditorHome();
    // Invalidate community cache so the next visit shows the new entry.
    this.communityLoaded = false;
  }

  // Snap any currently-open swipe row back to its resting position.
  // No-op if nothing is open. Used when cancelling a delete confirm,
  // tapping outside the open row, or re-rendering the editor home.
  private closeSwipeRow(): void {
    if (!this.swipeOpenId) return;
    const swipe = this.overlay.querySelector<HTMLElement>(`.editor-home-row-swipe[data-swipe-id="${cssAttrEscape(this.swipeOpenId)}"]`);
    const row = swipe?.querySelector<HTMLElement>(".editor-home-row");
    if (row) {
      row.style.transition = "transform 160ms ease-out";
      row.style.transform = "translateX(0)";
      setTimeout(() => { if (row) row.style.transition = ""; }, 200);
    }
    this.swipeOpenId = null;
  }

  private async unpublishCustomChallenge(custom: CustomChallenge): Promise<void> {
    if (!custom.publishedRecordName) return;
    if (!window.confirm(`Unpublish "${custom.name}"?\n\nIt will be removed from the Community list. Players who have already installed it keep their copies.`)) return;
    const ok = await unpublishChallenge(custom);
    if (!ok) {
      window.alert("Couldn't unpublish. Try again later.");
      return;
    }
    if (this.state === "editorHome") this.renderEditorHome();
    this.communityLoaded = false;
  }

  private renderUnlockShop(): void {
    this.overlay.innerHTML = UnlockShop.render({
      priceLabel: this.unlockProduct?.displayPrice ?? null,
      hardcoreUnlockScore: HARDCORE_UNLOCK_SCORE,
    });
  }

  private openChallengeSelect(): void {
    this.state = "challengeSelect";
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    // Modal state from a prior visit shouldn't carry over — close any
    // open leaderboard / report sheets before re-rendering.
    this.leaderboardSheet = null;
    this.reportSheet = null;
    this.renderChallengeSelect();
    this.overlay.classList.remove("hidden");
    // Kick off the StoreKit product fetch the first time the player visits
    // the challenge select. Once it resolves, re-render so the price slot
    // in the IAP banner shows the localized cost instead of the placeholder.
    if (isStoreKitAvailable() && !this.unlockProduct) {
      void getUnlockAllProduct().then((p) => {
        if (!p) return;
        this.unlockProduct = p;
        if (this.state === "challengeSelect") this.renderChallengeSelect();
      });
    }
  }

  private openChallengeIntro(def: ChallengeDef): void {
    this.activeChallenge = def;
    this.state = "challengeIntro";
    this.setHudVisible(false);
    this.setInPlay(false);
    this.renderChallengeIntro();
  }

  private beginChallengeStart(def: ChallengeDef): void {
    // Move from intro/replay/select directly into a fresh challenge run.
    this.state = "playing";
    this.overlay.classList.add("hidden");
    this.setHudVisible(true);
    this.setInPlay(true);
    this.setScoreVisible(true);
    this.setPauseButtonVisible(true);
    this.setSliderEnabled(true);
    this.resetRunState(0);
    this.startChallenge(def);
    setMusicSpeed(1);
    startMusic();
    this.maybeShowControlsHint();
  }

  private renderChallengeSelect(): void {
    const progress = loadChallengeProgress();
    const allCustoms = listCustomChallenges();
    const authoredCustoms = allCustoms.filter((c) => !c.installedFrom);
    const installedCustoms = allCustoms.filter((c) => !!c.installedFrom);
    const showMyChallenges =
      progress.purchasedUnlock || this.debugEnabled || this.isEditorTempUnlocked();
    this.overlay.innerHTML = renderChallengeSelectView({
      progress,
      challenges: CHALLENGES,
      authoredCustoms,
      installedCustoms,
      showMyChallenges,
      iapPriceLabel: this.unlockProduct?.displayPrice ?? null,
      communityReadable: isCommunityReadable(),
      collapsed: {
        official: loadCollapsed("official"),
        myChallenges: loadCollapsed("myChallenges"),
        installedChallenges: loadCollapsed("installedChallenges"),
        community: loadCollapsed("community"),
      },
      installedBodyHtml:
        installedCustoms.length > 0
          ? this.renderInstalledChallengesBody(installedCustoms)
          : "",
      communityBodyHtml: isCommunityReadable() ? this.renderCommunityBody() : "",
      leaderboardSheetHtml: this.renderLeaderboardSheetHtml(),
      reportSheetHtml: this.renderReportSheetHtml(),
    });
    if (isCommunityReadable() && !this.communityLoaded && !this.communityLoading) {
      void this.refreshCommunity();
    }
  }

  // ----- Community challenges -------------------------------------------

  // Body markup for the Community collapsible. Pure render delegated
  // to ui/screens/communityBody.ts; this is just the deps gather.
  private renderCommunityBody(): string {
    const installedSet = new Set(
      listCustomChallenges()
        .map((c) => c.installedFrom)
        .filter((rn): rn is string => typeof rn === "string"),
    );
    return renderCommunityBodyView({
      loading: this.communityLoading,
      loaded: this.communityLoaded,
      error: this.communityError,
      challenges: this.communityChallenges,
      sort: this.communitySort,
      installedSet,
      upvotedSet: this.upvoteCache,
      showAuthedActions: isCloudKitAvailable(),
    });
  }

  // Body markup for the Installed Challenges collapsible. Each row uses
  // the editor-home-row chrome (full-width, big PLAY button) and is
  // wrapped in the same swipe container used by My Challenges in the
  // editor home — so the swipe handler picks it up automatically; only
  // the revealed action button differs (UNINSTALL not DELETE).
  private renderInstalledChallengesBody(installed: CustomChallenge[]): string {
    return renderInstalledChallengesBodyView({
      installed,
      showLeaderboard: isCommunityReadable(),
    });
  }

  // Open the single-challenge view for a deep-link record name. Used
  // by main.ts when the launch URL has ?challenge=X, and by future
  // in-app entry points if we ever want a "show one" surface from a
  // share notification. `origin` controls where BACK lands.
  async openSingleChallenge(recordName: string, origin: "menu" | "challengeSelect" = "menu"): Promise<void> {
    this.singleChallenge = { recordName, challenge: null, error: null, origin };
    this.state = "communitySingle";
    this.setScoreVisible(false);
    this.setPauseButtonVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    this.renderSingleChallenge();
    this.overlay.classList.remove("hidden");
    if (!isCommunityReadable()) {
      this.singleChallenge.error = "Community challenges aren't reachable from this build.";
      this.renderSingleChallenge();
      return;
    }
    const fetched = await fetchCommunityChallenge(recordName);
    if (!this.singleChallenge || this.singleChallenge.recordName !== recordName) return;
    if (!fetched) {
      this.singleChallenge.error = "This challenge couldn't be loaded — it may have been removed.";
    } else {
      this.singleChallenge.challenge = fetched;
      // Hydrate the upvote cache for this single record so the heart
      // shows filled if the player has already liked it.
      void this.hydrateUpvoteCache([fetched]);
    }
    this.renderSingleChallenge();
  }

  private closeSingleChallenge(): void {
    const origin = this.singleChallenge?.origin ?? "menu";
    this.singleChallenge = null;
    if (origin === "challengeSelect") {
      this.openChallengeSelect();
    } else {
      this.state = "menu";
      this.renderMenu();
    }
  }

  private renderSingleChallenge(): void {
    const sheet = this.singleChallenge;
    if (!sheet) return;
    const recordName = sheet.challenge?.recordName ?? sheet.recordName;
    const lbSheet = this.leaderboardSheet;
    const lbChallenge = lbSheet
      ? this.communityChallenges.find((c) => c.recordName === lbSheet.recordName)
      : undefined;
    this.overlay.innerHTML = SingleChallenge.render({
      challenge: sheet.challenge,
      error: sheet.error,
      installed: !!listCustomChallenges().find((c) => c.installedFrom === recordName),
      upvoted: this.upvoteCache.has(recordName),
      showAuthedActions: isCloudKitAvailable(),
      leaderboardSheet: lbSheet ? {
        title: lbChallenge ? lbChallenge.name : "Leaderboard",
        loading: lbSheet.loading,
        rows: lbSheet.rows,
      } : null,
      reportSheet: this.reportSheet
        ? { reason: this.reportSheet.reason, note: this.reportSheet.note }
        : null,
    });
  }

  private async refreshCommunity(): Promise<void> {
    if (!isCommunityReadable()) return;
    if (this.communityLoading) return;
    this.communityLoading = true;
    this.communityError = null;
    try {
      const result = await queryCommunity({ sort: this.communitySort, limit: 50 });
      this.communityChallenges = result.challenges;
      this.communityLoaded = true;
      // Hydrate the local upvote cache for whatever's on screen, in
      // parallel. Best-effort — the heart icon defaults to hollow and
      // flips to filled as each fetch resolves.
      void this.hydrateUpvoteCache(result.challenges);
    } catch (err) {
      console.warn("[community] refresh failed:", err);
      this.communityError = String(err);
    } finally {
      this.communityLoading = false;
      if (this.state === "challengeSelect") this.renderChallengeSelect();
    }
  }

  private async hydrateUpvoteCache(list: PublishedChallenge[]): Promise<void> {
    const before = this.upvoteCache.size;
    await Promise.all(list.map(async (p) => {
      if (this.upvoteCache.has(p.recordName)) return;
      const has = await cloudHasUpvoted(p.recordName);
      if (has) this.upvoteCache.add(p.recordName);
    }));
    if (this.upvoteCache.size !== before && this.state === "challengeSelect") {
      this.renderChallengeSelect();
    }
  }

  // Locate a PublishedChallenge across both the cached community list
  // and the single-challenge deep-link view, so action handlers work
  // identically from either entry point.
  private findPublishedChallenge(recordName: string): PublishedChallenge | null {
    const fromList = this.communityChallenges.find((c) => c.recordName === recordName);
    if (fromList) return fromList;
    if (this.singleChallenge?.challenge?.recordName === recordName) {
      return this.singleChallenge.challenge;
    }
    return null;
  }

  private async handleCommunityInstall(recordName: string): Promise<void> {
    const p = this.findPublishedChallenge(recordName);
    if (!p) return;
    const installed = await installCommunity(p);
    if (!installed) {
      window.alert("Couldn't install. Check iCloud connectivity and try again.");
      return;
    }
    if (this.state === "challengeSelect") this.renderChallengeSelect();
    if (this.state === "communitySingle") this.renderSingleChallenge();
  }

  private handleCommunityPlay(recordName: string): void {
    const local = listCustomChallenges().find((c) => c.installedFrom === recordName);
    if (!local) return;
    this.playCustomChallenge(local, 0);
  }

  // Fork a published challenge into the user's own My Challenges as an
  // editable copy. Independent of the published source (no installedFrom
  // link, won't auto-update on author edits) — same semantics as
  // remixing a roster challenge in the editor home. Drops the player
  // into the editor on the new copy so they can start tweaking.
  private handleCommunityRemix(recordName: string): void {
    const p = this.findPublishedChallenge(recordName);
    if (!p) return;
    const cloned = remixCustomChallenge({
      name: `${p.name} (by ${p.authorName})`,
      difficulty: p.difficulty,
      effects: p.effects,
      waves: p.waves,
    });
    this.openEditorEdit(cloned);
  }

  private async handleCommunityUpvote(recordName: string): Promise<void> {
    const target = this.findPublishedChallenge(recordName);
    if (!target) return;
    const wasUpvoted = this.upvoteCache.has(recordName);
    const apply = (delta: number) => {
      target.upvoteCount = Math.max(0, target.upvoteCount + delta);
    };
    // Optimistic UI: update local count + cache before the round-trip
    // resolves, then revert if the call fails.
    if (wasUpvoted) {
      this.upvoteCache.delete(recordName);
      apply(-1);
    } else {
      this.upvoteCache.add(recordName);
      apply(1);
    }
    this.rerenderForCommunityState();
    const ok = wasUpvoted
      ? await cloudRemoveUpvote(recordName)
      : await cloudUpvote(recordName);
    if (!ok) {
      if (wasUpvoted) {
        this.upvoteCache.add(recordName);
        apply(1);
      } else {
        this.upvoteCache.delete(recordName);
        apply(-1);
      }
      this.rerenderForCommunityState();
    }
  }

  // Re-render whichever surface is currently showing a community card.
  // Both renderChallengeSelect and renderSingleChallenge rebuild from
  // cached state, so this just wakes up the right one.
  private rerenderForCommunityState(): void {
    if (this.state === "challengeSelect") this.renderChallengeSelect();
    else if (this.state === "communitySingle") this.renderSingleChallenge();
  }

  private async openLeaderboardSheet(recordName: string): Promise<void> {
    this.leaderboardSheet = { recordName, rows: [], loading: true };
    if (this.state === "challengeSelect") this.renderChallengeSelect();
    const rows = await cloudTopScores(recordName, 20);
    if (!this.leaderboardSheet || this.leaderboardSheet.recordName !== recordName) return;
    this.leaderboardSheet = { recordName, rows, loading: false };
    if (this.state === "challengeSelect") this.renderChallengeSelect();
  }

  private closeLeaderboardSheet(): void {
    this.leaderboardSheet = null;
    if (this.state === "challengeSelect") this.renderChallengeSelect();
  }

  private renderLeaderboardSheetHtml(): string {
    const sheet = this.leaderboardSheet;
    if (!sheet) return "";
    const challenge = this.communityChallenges.find((c) => c.recordName === sheet.recordName);
    return LeaderboardSheet.render({
      title: challenge ? challenge.name : "Leaderboard",
      loading: sheet.loading,
      rows: sheet.rows,
    });
  }

  private openReportDialog(recordName: string): void {
    this.reportSheet = { recordName, reason: "inappropriate_name", note: "" };
    if (this.state === "challengeSelect") this.renderChallengeSelect();
  }

  private closeReportDialog(): void {
    this.reportSheet = null;
    if (this.state === "challengeSelect") this.renderChallengeSelect();
  }

  private renderReportSheetHtml(): string {
    return ReportSheet.render(this.reportSheet);
  }

  private async submitReport(): Promise<void> {
    const sheet = this.reportSheet;
    if (!sheet) return;
    const noteEl = this.overlay.querySelector<HTMLTextAreaElement>("[data-report-note]");
    const note = noteEl?.value ?? sheet.note;
    const ok = await reportChallenge(sheet.recordName, sheet.reason, note);
    this.reportSheet = null;
    if (this.state === "challengeSelect") this.renderChallengeSelect();
    if (ok) {
      window.alert("Thanks — a moderator will review this challenge.");
    } else {
      window.alert("Couldn't submit the report. Try again later.");
    }
  }

  private renderChallengeIntro(): void {
    const def = this.activeChallenge;
    if (!def) return;
    this.overlay.innerHTML = ChallengeIntro.render({
      id: def.id,
      name: def.name,
      difficulty: def.difficulty,
      waveCount: def.waves.length,
      best: loadChallengeProgress().best[def.id] ?? 0,
    });
    this.overlay.classList.remove("hidden");
  }

  private renderChallengeComplete(newlyUnlocked: number[] = []): void {
    const def = this.activeChallenge;
    if (!def) return;
    const isCustom = isCustomChallenge(def);
    const customRecord = isCustom ? getCustomChallenge(def.id) : undefined;
    const progress = loadChallengeProgress();
    const best = isCustom ? (customRecord?.best ?? 0) : (progress.best[def.id] ?? 0);
    const thresholds = isCustom && customRecord
      ? customRecord.stars
      : computeStarThresholds(def);
    const props = {
      idLabel: isCustom ? "CUSTOM" : def.id,
      name: def.name,
      score: this.score,
      best,
      isNewBest: this.score >= best,
      thresholds,
      earnedStars: awardStars(this.score, thresholds),
      newlyUnlocked,
      onStarPop: (_i: number, earned: boolean) => {
        if (earned) playSfx("impact");
      },
    };
    this.overlay.innerHTML = ChallengeComplete.render(props);
    this.overlay.classList.remove("hidden");
    this.setScoreVisible(false);
    this.setHudVisible(false);
    this.setInPlay(false);
    ChallengeComplete.bind?.(this.overlay, props);
  }

  // TEMP — see EDITOR_TEMP_UNLOCKED_ON_IOS at the top of this file.
  private isEditorTempUnlocked(): boolean {
    return EDITOR_TEMP_UNLOCKED_ON_IOS && isStoreKitAvailable();
  }

  private setSliderEnabled(enabled: boolean): void {
    const movePadEl = document.getElementById("movepad");
    if (!movePadEl) return;
    movePadEl.classList.toggle("disabled", !enabled);
  }

  // Toggle a body-level `in-play` class so CSS can hide the bottom
  // position slider (and any future game-only chrome) on every menu /
  // editor screen — they don't accept input there anyway.
  private setInPlay(active: boolean): void {
    document.body.classList.toggle("in-play", active);
    // Snap the knob to centre at the start of every run so the
    // slider doesn't carry over the previous run's position. The
    // knob position is a CSS variable resolved against the pad's
    // current width — no need to wait for layout, no polling.
    if (active) this.sliderHandle?.refresh(0);
  }

  private pauseGame(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.resumeCountdown = 0;
    this.overlay.innerHTML = `
      <h1>PAUSED</h1>
      <p class="hint desktop-only"><kbd>SPACE</kbd> to resume</p>
      <p class="hint touch-only">Tap to resume</p>
      <button type="button" class="pill-btn pill-btn-pause" data-action="quit">QUIT</button>
      <div class="pause-footer">
        ${this.audioTogglesHtml()}
      </div>
    `;
    this.overlay.classList.remove("hidden");
    this.setPauseButtonVisible(false);
    this.setSliderEnabled(false);
    // Drop any in-flight slider value so the player doesn't sail off the
    // moment the countdown ends if their finger was mid-drag at pause.
    this.slideTarget = null;
  }

  private beginResumeCountdown(): void {
    if (this.state !== "paused") return;
    this.overlay.classList.add("hidden");
    this.resumeCountdown = 3;
    // Pause button + slider stay locked during the countdown — the
    // player can see the big number and shouldn't be moving anything
    // mid-count. Both unlock when the countdown completes (in update).
    this.setPauseButtonVisible(false);
  }

  // Wipe the persisted seen-hints + rotate-tutorial state so the next
  // run replays the AVOID/HEAL/SLOW/etc. labels and the rotate gesture
  // tutorial, then briefly flash the button so the player has feedback.
  private resetHints(btn: HTMLButtonElement): void {
    this.seenKinds = new Set();
    this.rotateTutorialShown = false;
    this.controlsHintShown = false;
    removeKey(SEEN_HINTS_STORAGE_KEY);
    removeKey(ROTATE_TUTORIAL_STORAGE_KEY);
    removeKey(CONTROLS_HINT_STORAGE_KEY);
    const original = btn.textContent ?? "Hints";
    btn.textContent = "Reset!";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 900);
  }

  private quitToMenu(): void {
    if (this.state !== "paused") return;
    const wasChallenge = this.gameMode === "challenge";
    const wasCustom = wasChallenge && this.activeChallenge !== null && isCustomChallenge(this.activeChallenge);
    this.resetRunState(0);
    this.setGameMode("endless");
    this.activeChallenge = null;
    this.effectOverrides = null;
    this.setSliderEnabled(true);
    stopMusic();
    if (wasCustom) {
      this.returnFromCustomRun();
    } else if (wasChallenge) {
      this.openChallengeSelect();
    } else {
      this.state = "menu";
      this.renderMenu();
    }
  }

  // Tear-down + reset of every per-run field. Shared by startOrRestart
  // (transitions on into "playing") and quitToMenu (transitions on into
  // "menu") so both paths leave the engine and UI in a clean state.
  private resetRunState(initialScore: number): void {
    for (const s of this.sticksInFlight) Composite.remove(this.engine.world, s.body);
    this.sticksInFlight = [];
    for (const c of this.clusters) Composite.remove(this.engine.world, c.body);
    for (const d of this.debris) Composite.remove(this.engine.world, d.body);
    for (const d of this.drones) Composite.remove(this.engine.world, d.body);
    Composite.remove(this.engine.world, this.player.body);

    this.clusters = [];
    this.debris = [];
    this.drones = [];
    this.clusterByBodyId.clear();
    this.pendingContacts = [];

    this.score = initialScore;
    this.debugRun = initialScore > 0;
    this.comboHits = 0;
    this.spawnTimer = 0;
    this.firstSpawn = true;
    this.resumeCountdown = 0;
    this.nextMilestoneIdx = 0;
    this.wasInDangerThisRun = false;
    this.wavePhase = "calm";
    this.wavePhaseTimer = 0;
    this.swarmWave = false;
    this.timeEffect = null;
    this.timeEffectTimer = 0;
    this.timeEffectMax = 1;
    this.slowFromPickup = false;
    this.slowUpFired = false;
    this.timeScale = 1;
    this.floaters = [];
    this.sideWarnings = [];
    this.shieldTimer = 0;
    this.tinyTimer = 0;
    this.tinyMax = 1;
    this.bigTimer = 0;
    this.bigMax = 1;
    this.bigLevel = 0;
    this.bigBonus = 0;
    this.playerHexScale = 1;
    this.playerHexScaleTarget = 1;
    this.rotateTutorialActive = false;
    this.rotateTutorialTimer = 0;
    this.rotateTutorialStartAngle = 0;
    this.fastLevel = 0;
    this.fastBonus = 0;
    this.progress = 0;
    this.progressDisplayed = 0;
    this.waveBumpT = 0;
    this.challengeWaveIdx = 0;
    this.challengeSlotIdx = 0;
    this.challengeProbCount = 0;
    this.challengeWaveTimer = 0;
    this.challengeSlotTimer = 0;
    this.challengeSpawnTimer = 0;
    this.challengeFinishingHold = 0;
    this.currentParsedWave = null;
    this.wall.kind = "none";
    this.wall.amount = 0;
    this.wall.amountTarget = 0;
    this.wall.phase = 0;
    this.wall.pushHoldT = 0;
    this.wall.pushDir = 0;
    this.rotationDragActive = false;
    this.slideTarget = null;

    this.player = new Player({
      centerX: this.boardOriginX + this.boardWidth / 2,
      centerY: this.playerY,
      hexSize: this.hexSize,
      engine: this.engine,
      collisionCategory: CAT_PLAYER,
      collisionMask: CAT_CLUSTER,
    });
    this.player.setOrphanListener((orphans) => this.spawnPlayerOrphans(orphans));
    this.scoreEl.textContent = String(this.score);
  }

  private audioTogglesHtml(): string {
    const sfx = isSfxOn();
    const music = isMusicOn();
    return `
      <div class="audio-toggles" role="group" aria-label="Audio">
        <button type="button" class="audio-toggle" data-action="toggle-sfx" aria-pressed="${sfx}">SFX</button>
        <button type="button" class="audio-toggle" data-action="toggle-music" aria-pressed="${music}">MUSIC</button>
      </div>
    `;
  }

  private refreshAudioToggles(): void {
    const sfx = isSfxOn();
    const music = isMusicOn();
    const sfxBtn = this.overlay.querySelector('button[data-action="toggle-sfx"]') as HTMLButtonElement | null;
    if (sfxBtn) sfxBtn.setAttribute("aria-pressed", String(sfx));
    const musicBtn = this.overlay.querySelector('button[data-action="toggle-music"]') as HTMLButtonElement | null;
    if (musicBtn) musicBtn.setAttribute("aria-pressed", String(music));
  }

  // difficultyButtonsHtml inlined into the GameOver screen template.

  private renderGameOver(): void {
    if (this.gameMode === "challenge" && this.activeChallenge) {
      const def = this.activeChallenge;
      const best = loadChallengeProgress().best[def.id] ?? 0;
      this.overlay.innerHTML = GameOver.render({
        mode: "challenge",
        score: this.score,
        best,
        challengeName: def.name,
        challengeId: def.id,
        challengeProgress: this.progress,
      });
      this.overlay.classList.remove("hidden");
      return;
    }
    this.overlay.innerHTML = GameOver.render({
      mode: "endless",
      score: this.score,
      best: this.best,
    });
    this.overlay.classList.remove("hidden");
    this.renderAchievementBadges();
    this.refreshDifficultyButtons();
  }

  private onInput(action: InputAction, pressed: boolean): void {
    if (action === "confirm" && pressed) {
      if (this.state === "challengeIntro" && this.activeChallenge) {
        this.beginChallengeStart(this.activeChallenge);
        return;
      }
      if (this.state === "challengeComplete" && this.activeChallenge) {
        this.beginChallengeStart(this.activeChallenge);
        return;
      }
      if (this.state === "gameover" && this.gameMode === "challenge" && this.activeChallenge) {
        this.beginChallengeStart(this.activeChallenge);
        return;
      }
      if (this.state === "menu" || this.state === "gameover") {
        this.setGameMode("endless");
        this.activeChallenge = null;
        this.effectOverrides = null;
        this.startOrRestart();
        return;
      }
    }
    if (action === "pause" && pressed && this.state === "playing") {
      this.pauseGame();
      return;
    }
    if (action === "pause" && pressed && this.state === "paused") {
      this.beginResumeCountdown();
      return;
    }
    // Movement holds are accepted in menu too so the player can try the
    // controls before starting a run. Paused / gameover ignore them.
    if (this.state !== "playing" && this.state !== "menu") return;

    switch (action) {
      case "left":
        this.holds.left.active = pressed;
        break;
      case "right":
        this.holds.right.active = pressed;
        break;
      case "rotateCw":
        this.holds.rotateCw.active = pressed;
        break;
      case "rotateCcw":
        this.holds.rotateCcw.active = pressed;
        break;
    }
  }

  private update(dt: number): void {
    if (this.state === "paused") {
      // Tick the resume countdown (3 → 2 → 1 → go) even while paused so
      // the wait-then-resume flow advances. When it hits zero we flip
      // back into "playing" and the next frame runs the full update.
      if (this.resumeCountdown > 0) {
        this.resumeCountdown -= dt;
        if (this.resumeCountdown <= 0) {
          this.resumeCountdown = 0;
          this.state = "playing";
          this.setPauseButtonVisible(true);
          this.setSliderEnabled(true);
        }
      }
      return;
    }

    // Starfield + nebula drift downward in real time during menu, play
    // and gameover. The nebula intensity eases toward the tier target so
    // it never pops in abruptly when the score crosses a threshold.
    this.starScrollY += dt;
    this.nebulaScrollY += dt;
    this.updateStarTier();
    const nebulaTarget = NEBULA_INTENSITY_BY_TIER[this.starTier] ?? 1;
    this.nebulaIntensity += (nebulaTarget - this.nebulaIntensity) * (1 - Math.exp(-dt * 0.6));

    // Tick floating score popups (always real time so they don't slow with
    // a slow-mo effect — UI feedback should be instantly readable).
    if (this.floaters.length > 0) {
      this.floaters = this.floaters.filter((f) => {
        f.age += dt;
        return f.age < f.lifetime;
      });
    }
    if (this.sideWarnings.length > 0) {
      this.sideWarnings = this.sideWarnings.filter((sw) => {
        sw.age += dt;
        return sw.age < sw.lifetime;
      });
    }

    // The simulation only runs when there's something to simulate:
    //   - Editor wave dialog with the live preview active.
    //   - Active gameplay (playing / paused — handled below).
    // Every other state (main menu, challenge select / intro / complete,
    // gameover, unlock shop, blocks guide, editor home, editor edit
    // without preview) returns early so the engine sits idle and no
    // wreckage / practice clusters lurk behind the overlay.
    if ((this.state === "editorEdit" || this.state === "editorHome") && this.editorDialogPreview) {
      this.clampChallengeFallVelocities();
      Engine.update(this.engine, Math.min(dt * 1000, 1000 / 30));
      this.cleanupOffscreenBodies();
      this.tickWalls(dt);
      this.tickWavePreview(dt);
      return;
    }
    // Gameover: keep stepping physics so the wreckage from endGame()
    // tumbles behind the overlay (and ages off-screen). No input,
    // contacts, spawns or wave logic — those are gated by the
    // "playing" state below. Without this branch, the player blob
    // shatters into debris but the debris is frozen in place because
    // nothing steps the engine until PLAY AGAIN.
    if (this.state === "gameover") {
      Engine.update(this.engine, Math.min(dt * 1000, 1000 / 30));
      const screenBottom = this.boardOriginY + this.boardHeight + this.hexSize;
      this.debris = this.debris.filter((d) => {
        const alive = d.update(dt);
        if (!alive || d.body.position.y > screenBottom) {
          Composite.remove(this.engine.world, d.body);
          return false;
        }
        return true;
      });
      this.cleanupOffscreenBodies();
      return;
    }
    if (this.state !== "playing") {
      return;
    }

    // Real-time effect timer (counts down in wall-clock seconds, regardless
    // of timescale) so the slow / fast power-up always lasts its full
    // duration. When fast expires *cleanly* (no hit ate it), award the
    // accumulated bonus pool as a single payout.
    if (this.timeEffect !== null) {
      this.timeEffectTimer -= dt;
      // Schedule slow_up so the audio finishes precisely as the
      // countdown bar empties. Only fires for power-up slow, not for
      // collision-induced (stick-buffer) slow.
      if (
        this.timeEffect === "slow" &&
        this.slowFromPickup &&
        !this.slowUpFired &&
        this.timeEffectTimer <= SLOW_UP_LEAD
      ) {
        playSfx("slow_up");
        this.slowUpFired = true;
      }
      if (this.timeEffectTimer <= 0) {
        if (this.timeEffect === "fast") this.awardFastBonus();
        this.timeEffect = null;
        this.timeScale = 1;
        this.slowFromPickup = false;
        this.slowUpFired = false;
      }
    }

    // Tiny / big size effects tick in wall-clock time, parallel to the
    // slow/fast time effect. Tiny just expires silently (size restores).
    // Big banks the accumulated bonus pool when the timer runs out clean.
    if (this.tinyTimer > 0) {
      this.tinyTimer = Math.max(0, this.tinyTimer - dt);
      if (this.tinyTimer === 0) this.updatePlayerScaleTarget();
    }
    if (this.bigTimer > 0) {
      this.bigTimer = Math.max(0, this.bigTimer - dt);
      if (this.bigTimer === 0) {
        this.awardBigBonus();
        this.bigLevel = 0;
        this.bigMax = 1;
        this.updatePlayerScaleTarget();
      }
    }
    this.animatePlayerScale(dt);

    this.tickWalls(dt);

    // ROTATE tutorial: tick its timer and dismiss when the player has
    // turned the blob enough or 5 seconds have passed.
    if (this.rotateTutorialActive) {
      this.rotateTutorialTimer += dt;
      let turned = this.player.body.angle - this.rotateTutorialStartAngle;
      turned = Math.atan2(Math.sin(turned), Math.cos(turned));
      if (Math.abs(turned) >= Math.PI / 6 || this.rotateTutorialTimer > 5) {
        this.rotateTutorialActive = false;
      }
    }

    // The slowest active power-up modifier determines how much we slow
    // vs the current base rate. Base rate itself ramps with the
    // late-game multiplier so slow/fast feel proportional to whatever
    // the current "100%" of the game is.
    const modifier = this.timeScale;
    const effectiveScale = modifier * this.lateGameSpeedMul();

    // Music tracks effective scale, except collision-induced slow
    // (stick-buffer) is excluded — the recovery moment shouldn't drag
    // the music down.
    let musicModifier = this.timeScale;
    if (this.timeEffect === "slow" && !this.slowFromPickup) musicModifier = 1;
    // Compress music speed to 30% of the deviation from 1.0 so slow/fast
    // feel like a gentle tape stretch rather than dragging or chipmunking
    // the track. e.g. game scale 0.5 → music 0.85, game 1.25 → music 1.075.
    const gameScale = musicModifier * this.lateGameSpeedMul();
    setMusicSpeed(1 + (gameScale - 1) * 0.3);

    // gameDt drives physics + spawn + wave so slow-mo really slows everything.
    const gameDt = dt * effectiveScale;

    // Player input → physics velocities (input applied in real time so the
    // controls always feel responsive even during slow-mo).
    this.applyMovementInput(effectiveScale);

    const playerSize = this.player.size();
    const dangerSize = this.dangerSize();
    this.player.inDanger = playerSize >= dangerSize;
    // Critical = a danger hit is queued (next blue blow ends the run). The
    // player draw uses this to ramp the red glow up/down.
    this.player.criticalDanger = this.player.inDanger && this.comboHits > 0;

    // Survivor: was in danger and clawed back to a single hex.
    if (playerSize >= dangerSize) this.wasInDangerThisRun = true;
    if (this.wasInDangerThisRun && playerSize === 1) {
      this.awardAchievement(ACHIEVEMENTS.survivor);
      this.wasInDangerThisRun = false;
    }

    // Shield timer ticks in wall-clock seconds so its 10s feels real.
    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    }

    // Drone update: oscillate horizontally, age out, despawn dead bodies.
    this.updateDrones(dt);

    // Tick stick-in-flight pieces: re-aim their springs at the player's
    // updated cell-target world position and snap them in once close
    // enough (or after a hard timeout).
    this.updateSticksInFlight(dt);

    if (this.gameMode === "endless") {
      // Wave/calm phase progression — uses gameDt so wave length feels right
      // during slow-mo, but spawn cadence is the same dilation.
      this.advanceWavePhase(gameDt);

      // Spawn.
      this.spawnTimer -= gameDt;
      if (this.spawnTimer <= 0) {
        this.spawnCluster();
        this.spawnTimer = this.currentSpawnInterval();
      }
    } else {
      this.advanceChallenge(gameDt);
      this.updateChallengeFinishing(dt);
      // Smooth the progress value for a calm climbing animation.
      this.progressDisplayed += (this.progress - this.progressDisplayed) * (1 - Math.exp(-dt * 6));
      if (this.waveBumpT > 0) this.waveBumpT = Math.max(0, this.waveBumpT - dt);
    }

    // Re-apply target fall velocity for challenge clusters so gravity
    // doesn't drift them off-spec. No-op in endless mode (no targetVy).
    this.clampChallengeFallVelocities();

    // Step physics with scaled time.
    Engine.update(this.engine, Math.min(gameDt * 1000, 1000 / 30));

    // Constrain player to the rail using bounds, so the rotated/grown blob
    // never extends past the board bottom — and to the (possibly pinched)
    // side rails.
    this.player.clampToRail(this.playerY);
    {
      const r = this.playerRailBounds();
      this.player.clampBoundsX(r.left, r.right);
    }

    this.player.update(dt);

    // Process queued contacts (collected during collisionStart).
    if (this.pendingContacts.length > 0) {
      this.handlePendingContacts();
      // Contacts can flip comboHits — refresh the critical flag now so the
      // glow snaps to the new state on the very next render rather than
      // waiting one full tick.
      this.player.criticalDanger = this.player.inDanger && this.comboHits > 0;
    }

    // Score on pass + cleanup. Bodies are despawned shortly after they exit
    // the board area; clip masking in render() hides them in the meantime.
    const screenBottom = this.boardOriginY + this.boardHeight + this.hexSize;
    for (const c of this.clusters) {
      if (!c.alive) continue;
      const bounds = c.body.bounds;
      if (!c.scored && !c.contacted && bounds.min.y > this.playerY + this.hexSize * 0.3) {
        c.scored = true;
        // Base score always banks at 1. While fast is active, the *extra*
        // points (multiplier - 1) accumulate into a separate bonus pool
        // that's awarded only if the player survives to the end of the
        // effect — and lost entirely on a hit.
        this.score += 1;
        if (this.timeEffect === "fast") {
          this.fastBonus += this.fastMultiplier() - 1;
        }
        if (this.bigTimer > 0) {
          this.bigBonus += this.bigMultiplier() - 1;
        }
        this.comboHits = 0;
        this.scoreEl.textContent = String(this.score);

        this.checkScoreMilestones();
      }
      if (bounds.min.y > screenBottom) {
        c.alive = false;
      }
    }

    // Update debris.
    this.debris = this.debris.filter((d) => {
      const alive = d.update(dt);
      if (!alive || d.body.position.y > screenBottom) {
        Composite.remove(this.engine.world, d.body);
        return false;
      }
      return true;
    });

    // Cleanup dead clusters.
    this.clusters = this.clusters.filter((c) => {
      if (c.alive) return true;
      Composite.remove(this.engine.world, c.body);
      this.clusterByBodyId.delete(c.body.id);
      return false;
    });
  }

  // Big block-cap hint label drawn above each cluster that carries one.
  // Rendered outside the board clip so it can hover above the play area
  // when a cluster is near the top of the board.
  private drawClusterHints(): void {
    const ctx = this.ctx;
    // 20% smaller than before, in a wide monospace stack with extra
    // letter-spacing so the labels read as spacey/technical rather than
    // the chunky 900-weight sans-serif (whose 'A' renders oddly).
    const fontSize = Math.max(28, Math.round(this.hexSize * 1.76));
    let drewAny = false;

    for (const c of this.clusters) {
      if (!c.hintLabel || !c.alive) continue;
      if (!drewAny) {
        ctx.save();
        ctx.font = `600 ${fontSize}px "Avenir Next", "Helvetica Neue", "Trebuchet MS", Arial, sans-serif`;
        // letterSpacing is well-supported in modern Chromium/Safari;
        // older engines ignore it and the label just renders tight.
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.22em";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        drewAny = true;
      }
      const palette = hintPalette(c.kind);
      // Hover above the cluster, clamped both horizontally and vertically
      // so the word never spills off the canvas. The textAlign is
      // "center", so the constraint on cx is "half the text width away
      // from each edge, plus a small margin".
      const margin = 6;
      const halfTextW = ctx.measureText(c.hintLabel).width / 2;
      const cxIdeal = (c.body.bounds.min.x + c.body.bounds.max.x) / 2;
      const cxMin = this.boardOriginX + halfTextW + margin;
      const cxMax = this.boardOriginX + this.boardWidth - halfTextW - margin;
      const cx = cxMin <= cxMax ? Math.max(cxMin, Math.min(cxMax, cxIdeal)) : cxIdeal;

      // Ride above the cluster as it falls so the label visibly
      // anchors to the block it's describing. textBaseline is
      // alphabetic, so y is the baseline; sit a half-font above the
      // cluster top with a small extra gap. While the cluster is still
      // above the inset (e.g. iOS Dynamic Island), pin the label below
      // the inset so it stays fully visible.
      const clusterTop = c.body.bounds.min.y;
      const idealY = clusterTop - fontSize * 0.4;
      const minY = this.boardOriginY + this.topInset + 18 + fontSize * 0.74;
      const y = Math.max(minY, idealY);

      // Fade in based on the cluster's descent through the obscured
      // band: fully invisible while the cluster top is still above the
      // canvas, fully visible by the time it has cleared the inset.
      const fadeStart = this.boardOriginY;
      const fadeEnd = this.boardOriginY + this.topInset + fontSize * 1.2;
      const alpha = fadeEnd > fadeStart
        ? Math.max(0, Math.min(1, (clusterTop - fadeStart) / (fadeEnd - fadeStart)))
        : 1;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      ctx.shadowColor = palette.glow;
      ctx.shadowBlur = 26;
      ctx.fillStyle = palette.fill;
      ctx.fillText(c.hintLabel, cx, y);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = palette.stroke;
      ctx.strokeText(c.hintLabel, cx, y);
      ctx.globalAlpha = 1;
    }

    if (drewAny) {
      // letterSpacing isn't preserved by save/restore; reset before
      // restoring so subsequent text draws keep default kerning.
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
      ctx.restore();
    }
  }

  private fastMultiplier(): number {
    if (this.fastLevel <= 0) return 1;
    return FAST_MULTIPLIER_BASE + (this.fastLevel - 1) * FAST_MULTIPLIER_STEP;
  }

  // Award the accumulated fast bonus to the score with a chunky "+N"
  // floater. Called when the fast effect timer expires cleanly. After
  // the award, the bonus pool resets to 0; the multiplier level (and
  // therefore future stacking) is preserved for the rest of the run.
  // Where the fast-bonus tally is drawn in the HUD (just under the
  // countdown bar). Award and loss floaters originate here so the
  // visual feedback stays at the score readout instead of erupting
  // around the player and breaking concentration on the dodge.
  private fastBonusHudPos(): { x: number; y: number } {
    const fontSize = Math.max(20, Math.round(this.hexSize * 1.05));
    // Sit just under the countdown bar (which is drawn at topInset + 6,
    // height 6) so the +N / -N pop is never obscured by the iOS Dynamic
    // Island or by the score row above it.
    return {
      x: this.boardOriginX + this.boardWidth / 2,
      y: this.boardOriginY + this.topInset + 6 + 12 + fontSize / 2,
    };
  }

  private awardFastBonus(): void {
    if (this.fastBonus <= 0) return;
    const banked = this.fastBonus;
    const mul = this.fastMultiplier();
    this.score += this.fastBonus;
    this.scoreEl.textContent = String(this.score);
    this.checkScoreMilestones();
    // Endless-only score-payload achievements. Challenge mode tracks
    // its own per-challenge progression and shouldn't compound onto
    // the standard ladder.
    if (this.gameMode === "endless") {
      // Threshold achievements for the size of the banked payout. Award the
      // highest tier that the pool clears so a single big payout doesn't
      // pop four banners back-to-back.
      const tierId = highestTierCrossed(banked, BONUS_POOL_TIERS);
      if (tierId) this.awardAchievement(tierId as AchievementId);
      // Multiplier achievements based on the peak the player held when the
      // bonus actually banked. Same single-tier rule as the pool tiers.
      if (mul >= 6) this.awardAchievement(ACHIEVEMENTS.bonus6x);
      else if (mul >= 5) this.awardAchievement(ACHIEVEMENTS.bonus5x);
      else if (mul >= 4) this.awardAchievement(ACHIEVEMENTS.bonus4x);
      else if (mul >= 3) this.awardAchievement(ACHIEVEMENTS.bonus3x);
      // Trifecta: bank the payout while a shield is up and a drone is out.
      if (this.shieldTimer > 0 && this.drones.length > 0) {
        this.awardAchievement(ACHIEVEMENTS.trifecta);
      }
    }
    const p = this.fastBonusHudPos();
    // Big celebratory pop: huge font, scale 0 → 1.6 fast, then a slow
    // upward drift + fade so the player can really see the payout.
    this.spawnFloater(
      `+${this.fastBonus}`,
      p.x,
      p.y,
      "#c8ffd5",
      "rgba(120, 255, 170, 0.95)",
      {
        // Stay put: the grand payout grows and fades in place. The
        // drawer also clamps the rendered y so the text top can never
        // overlap the canvas top edge, even at peakScale.
        vy: 0,
        lifetime: 1.8,
        fontSize: Math.max(56, Math.round(this.hexSize * 3.2)),
        grand: true,
        peakScale: 1.6,
      },
    );
    this.fastBonus = 0;
  }

  // The player got hit while fast was active. Scatter the lost bonus as
  // red fragments from the bonus HUD, end the fast effect, and reset
  // both the bonus pool and the multiplier level so the next pickup
  // starts fresh at 3x.
  private loseFastBonus(): void {
    if (this.timeEffect !== "fast") return;
    const lost = this.fastBonus;
    const p = this.fastBonusHudPos();
    if (lost > 0) {
      this.spawnFloater(
        `-${lost}`,
        p.x,
        p.y,
        "#ffb0b0",
        "rgba(255, 80, 80, 0.95)",
        { vy: 60, vx: 0, lifetime: 1.0, shake: true },
      );
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.random() * 0.4;
        this.spawnFloater(
          `-${Math.max(1, Math.round(lost / 5))}`,
          p.x,
          p.y,
          "#ff8a8a",
          "rgba(255, 70, 70, 0.95)",
          {
            vx: Math.cos(a) * 180,
            vy: Math.sin(a) * 180,
            lifetime: 0.7,
          },
        );
      }
    }
    this.fastBonus = 0;
    this.fastLevel = 0;
    this.timeEffect = null;
    this.timeEffectTimer = 0;
    this.timeScale = 1;
  }

  private awardBigBonus(): void {
    if (this.bigBonus <= 0) return;
    const banked = this.bigBonus;
    this.score += banked;
    this.scoreEl.textContent = String(this.score);
    this.checkScoreMilestones();
    const p = this.fastBonusHudPos();
    this.spawnFloater(
      `+${banked}`,
      p.x,
      p.y,
      "#dab8ff",
      "rgba(180, 100, 255, 0.95)",
      {
        vy: 0,
        lifetime: 1.8,
        fontSize: Math.max(56, Math.round(this.hexSize * 3.2)),
        grand: true,
        peakScale: 1.6,
      },
    );
    this.bigBonus = 0;
  }

  // Player took a blue-cluster hit while big was active. Same forfeit
  // pattern as fast: scatter a red "lost" pop, end the effect, reset
  // pool + level so the next pickup starts fresh at 3X.
  private loseBigBonus(): void {
    if (this.bigTimer <= 0) return;
    const lost = this.bigBonus;
    const p = this.fastBonusHudPos();
    if (lost > 0) {
      this.spawnFloater(
        `-${lost}`,
        p.x,
        p.y,
        "#ffb0b0",
        "rgba(255, 80, 80, 0.95)",
        { vy: 60, vx: 0, lifetime: 1.0, shake: true },
      );
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.random() * 0.4;
        this.spawnFloater(
          `-${Math.max(1, Math.round(lost / 5))}`,
          p.x,
          p.y,
          "#ff8a8a",
          "rgba(255, 70, 70, 0.95)",
          {
            vx: Math.cos(a) * 180,
            vy: Math.sin(a) * 180,
            lifetime: 0.7,
          },
        );
      }
    }
    this.bigBonus = 0;
    this.bigLevel = 0;
    this.bigTimer = 0;
    this.bigMax = 1;
    this.updatePlayerScaleTarget();
  }

  private spawnFloater(
    text: string,
    x: number,
    y: number,
    fillColor: string,
    glowColor: string,
    opts?: {
      vx?: number;
      vy?: number;
      lifetime?: number;
      shake?: boolean;
      fontSize?: number;
      grand?: boolean;
      peakScale?: number;
    },
  ): void {
    this.floaters.push({
      text,
      x,
      y,
      vx: opts?.vx ?? 0,
      vy: opts?.vy ?? -80,
      age: 0,
      lifetime: opts?.lifetime ?? 1.0,
      fillColor,
      glowColor,
      fontSize: opts?.fontSize ?? Math.max(28, Math.round(this.hexSize * 1.6)),
      shake: opts?.shake ?? false,
      grand: opts?.grand ?? false,
      peakScale: opts?.peakScale ?? 1.4,
    });
  }

  private drawFloaters(): void {
    if (this.floaters.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.22em";
    for (const f of this.floaters) {
      const t = f.age / f.lifetime;
      // Drift via per-floater velocity (defaults to a 1s upward rise) plus
      // optional horizontal shake for the "lost bonus" presentation.
      const xOffset =
        f.vx * f.age + (f.shake ? Math.sin(f.age * 28) * 5 : 0);
      const yOffset = f.vy * f.age;
      let scale: number;
      let alpha: number;
      if (f.grand) {
        // Grand: ease from 0 to peakScale over ~0.2s with ease-out cubic,
        // then hold full size while fading + drifting up + out slowly.
        const popDur = 0.2;
        const popT = Math.min(1, f.age / popDur);
        scale = f.peakScale * (1 - Math.pow(1 - popT, 3));
        if (f.age < popDur) {
          alpha = 1;
        } else {
          const fadeT = (f.age - popDur) / Math.max(0.001, f.lifetime - popDur);
          alpha = Math.max(0, 1 - fadeT);
        }
      } else {
        scale = 1 + (f.peakScale - 1) * Math.min(1, f.age / 0.18);
        alpha = Math.max(0, 1 - t);
      }
      // Match the cluster kind-hint font so the +N / -N pops read as
      // part of the same UI vocabulary as AVOID / HEAL / SLOW / FAST.
      ctx.font = `600 ${f.fontSize}px "Avenir Next", "Helvetica Neue", "Trebuchet MS", Arial, sans-serif`;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = f.glowColor;
      ctx.shadowBlur = 20;
      // Clamp the rendered y so the text top never overlaps the canvas
      // top edge (text is drawn with middle baseline, so half-height
      // sits above the position). Approximate cap-height as ~0.74 of
      // the font size, plus a small breathing pad.
      const halfH = f.fontSize * scale * 0.74 * 0.5;
      // Keep clear of the HUD/Dynamic Island band so big "+N" pops drift
      // up past the countdown bar instead of being clipped behind it.
      const minY = this.topInset + halfH + 6;
      const drawY = Math.max(minY, f.y + yOffset);
      ctx.save();
      ctx.translate(f.x + xOffset, drawY);
      ctx.scale(scale, scale);
      ctx.fillStyle = f.fillColor;
      ctx.fillText(f.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
      ctx.strokeText(f.text, 0, 0);
      ctx.restore();
    }
    // letterSpacing isn't preserved by save/restore; reset it before
    // returning so subsequent text draws keep their default kerning.
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
    ctx.restore();
  }

  // Apply touch / keyboard movement + rotation hold to the player. Touch
  // rotation drag itself is applied inside the rotate-pad input callback,
  // not here. `timeScale` is the current effective scale (slow-mo / hint /
  // tutorial < 1, late-game / fast > 1) so we can compensate keyboard
  // velocity below 1 — the player should feel just as snappy in slow-mo
  // as at full speed.
  private applyMovementInput(timeScale = 1): void {
    if (this.slideTarget !== null) {
      const halfBoundsW =
        (this.player.body.bounds.max.x - this.player.body.bounds.min.x) / 2;
      // Map slider position against the BOARD centre, not the rail centre.
      // Zigzag walls translate the corridor laterally with the wave, so
      // referencing the rail meant a stationary slider thumb would still
      // drag the player back and forth as the corridor scrolled. The
      // board centre is fixed; clampBoundsX afterwards still stops the
      // player at any wall it overshoots.
      const boardCenter = this.boardOriginX + this.boardWidth / 2;
      const usableHalfWidth = Math.max(0, this.boardWidth / 2 - halfBoundsW);
      const desiredX = boardCenter + this.slideTarget * usableHalfWidth;
      const { left: railLeft, right: railRight } = this.playerRailBounds();
      const minTarget = railLeft + halfBoundsW;
      const maxTarget = railRight - halfBoundsW;
      const targetX = Math.max(minTarget, Math.min(maxTarget, desiredX));
      this.player.setX(targetX);
    } else {
      const wantLeft = this.holds.left.active;
      const wantRight = this.holds.right.active;
      const compensate = timeScale < 1 ? 1 / timeScale : 1;
      let vx = 0;
      if (wantLeft && !wantRight) vx = -PLAYER_MOVE_SPEED * compensate;
      else if (wantRight && !wantLeft) vx = PLAYER_MOVE_SPEED * compensate;
      this.player.setHorizontalVelocity(vx);
    }
    if (!this.rotationDragActive) {
      if (this.holds.rotateCw.active && !this.holds.rotateCcw.active) {
        this.player.setAngularVelocity(PLAYER_ROT_SPEED);
      } else if (this.holds.rotateCcw.active && !this.holds.rotateCw.active) {
        this.player.setAngularVelocity(-PLAYER_ROT_SPEED);
      } else {
        // Snap rotation to a stop the instant the key releases — no spin
        // carry-over from physics momentum.
        this.player.setAngularVelocity(0);
      }
    }
  }

  // Cap challenge cluster fall velocities at their `targetVy` each frame
  // so Matter's gravity can't accelerate them past the designer's
  // `speed=` value. Soft clamp: only caps when gravity has pushed v.y
  // above target; collisions that slow or bounce a cluster upward are
  // left alone (gravity will recover them gradually). Horizontal
  // velocity is always preserved so side entries, tilt, and post-
  // collision shove still play out. Endless-mode clusters have
  // targetVy === null and are skipped.
  private clampChallengeFallVelocities(): void {
    if (this.clusters.length === 0) return;
    for (const c of this.clusters) {
      if (!c.alive) continue;
      const target = c.targetVy;
      if (target === null) continue;
      const v = c.body.velocity;
      if (v.y <= target + 0.01) continue;
      Body.setVelocity(c.body, { x: v.x, y: target });
    }
  }

  // Trim off-screen clusters and debris during the gameover dwell so the
  // physics world doesn't accumulate dead bodies while the overlay is up.
  private cleanupOffscreenBodies(): void {
    const screenBottom = this.boardOriginY + this.boardHeight + this.hexSize;
    for (const c of this.clusters) {
      if (c.body.bounds.min.y > screenBottom) c.alive = false;
    }
    this.clusters = this.clusters.filter((c) => {
      if (c.alive) return true;
      Composite.remove(this.engine.world, c.body);
      this.clusterByBodyId.delete(c.body.id);
      return false;
    });
    this.debris = this.debris.filter((d) => {
      const alive = d.update(0);
      if (!alive || d.body.position.y > screenBottom) {
        Composite.remove(this.engine.world, d.body);
        return false;
      }
      return true;
    });
  }

  private onCollisionStart(event: IEventCollision<Engine>): void {
    if (this.state !== "playing") return;

    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const parentA = a.parent ?? a;
      const parentB = b.parent ?? b;
      const aIsPlayer = parentA.label === "player";
      const bIsPlayer = parentB.label === "player";
      const aIsCluster = parentA.label === "cluster";
      const bIsCluster = parentB.label === "cluster";
      const aIsDrone = parentA.label === "drone";
      const bIsDrone = parentB.label === "drone";

      // Drone vs cluster: drones only intercept blue (normal) clusters.
      // Power-ups, coins, and sticky red blocks pass through so the
      // player can still grab (or be hit by) them. Each successful
      // intercept also burns 1 second off this drone's lifetime, just
      // like the shield burns shield time on absorbed hits.
      if ((aIsDrone && bIsCluster) || (bIsDrone && aIsCluster)) {
        const droneParent = aIsDrone ? parentA : parentB;
        const clusterParent = aIsCluster ? parentA : parentB;
        const cluster = this.clusterByBodyId.get(clusterParent.id);
        if (
          cluster &&
          cluster.alive &&
          !cluster.contacted &&
          cluster.kind === "normal"
        ) {
          cluster.contacted = true;
          playSfx("drone");
          this.shatterClusterMidair(cluster);
          const drone = this.drones.find((d) => d.body.id === droneParent.id);
          if (drone) drone.lifetime = Math.max(0, drone.lifetime - 1);
        }
        continue;
      }

      // Player vs cluster — defer to handlePendingContacts so a single
      // frame's contacts route through the per-kind logic in one place.
      if (this.player.invulnTimer > 0) continue;

      let clusterPart;
      let clusterParentId;
      if (aIsPlayer && bIsCluster) {
        clusterPart = b;
        clusterParentId = parentB.id;
      } else if (bIsPlayer && aIsCluster) {
        clusterPart = a;
        clusterParentId = parentA.id;
      } else continue;

      const cluster = this.clusterByBodyId.get(clusterParentId);
      if (!cluster || cluster.contacted || !cluster.alive) continue;

      const support = pair.collision.supports[0];
      const point = support
        ? { x: support.x, y: support.y }
        : { x: clusterPart.position.x, y: clusterPart.position.y };

      cluster.contacted = true;
      this.pendingContacts.push({ cluster, contact: { point, partId: clusterPart.id } });
    }
  }

  // Cluster torn apart in mid-air by a drone. No player effect — just
  // visual shatter.
  private shatterClusterMidair(cluster: FallingCluster): void {
    for (const p of cluster.partWorldPositions()) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 6,
          y: -2 - Math.random() * 4,
        },
        kind: cluster.kind,
      });
    }
    cluster.alive = false;
  }

  private handlePendingContacts(): void {
    for (const { cluster, contact } of this.pendingContacts) {
      if (!cluster.alive) continue;

      this.player.invulnTimer = STICK_INVULN_MS / 1000;

      // Shield only absorbs blue (normal) hits at a cost of 1s per absorbed
      // contact. Red sticky still rips hexes off, and every helpful pickup
      // (coin, slow, fast, drone, shield refresh) still registers normally.
      if (this.shieldTimer > 0 && cluster.kind === "normal") {
        this.absorbWithShield(cluster);
        continue;
      }

      if (cluster.kind === "normal") {
        this.handleNormalContact(cluster, contact);
      } else if (cluster.kind === "sticky") {
        this.handleStickyContact(cluster, contact);
      } else if (cluster.kind === "coin") {
        this.handleCoinContact(cluster);
      } else if (cluster.kind === "shield") {
        this.handleShieldContact(cluster);
      } else if (cluster.kind === "drone") {
        this.handleDroneContact(cluster);
      } else if (cluster.kind === "tiny") {
        this.handleTinyContact(cluster);
      } else if (cluster.kind === "big") {
        this.handleBigContact(cluster);
      } else {
        // slow / fast power-up: activate the time effect, scatter the blob
        // into debris, and clear combo (helpful pickup).
        this.handlePowerupContact(cluster);
      }
    }
    this.pendingContacts = [];
  }

  private absorbWithShield(cluster: FallingCluster): void {
    // Shatter the cluster into debris and burn 1s off the shield. Combo is
    // preserved (a deflected hit isn't a recovery moment).
    const allParts = cluster.partWorldPositions();
    playSfx("impact");
    const extras = Math.min(allParts.length - 1, 3);
    for (let i = 1; i <= extras; i++) {
      setTimeout(() => playSfx("impact"), i * 45);
    }
    for (const p of allParts) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 5,
          y: -1 - Math.random() * 3,
        },
        kind: cluster.kind,
      });
    }
    cluster.alive = false;
    this.shieldTimer = Math.max(0, this.shieldTimer - 1);
  }

  private handleShieldContact(cluster: FallingCluster): void {
    playSfx("shield");
    this.shieldTimer = this.shieldDuration();
    const center = cluster.body.position;
    this.spawnFloater(
      "SHIELD",
      center.x,
      center.y,
      "#f0f0f0",
      "rgba(220, 220, 220, 0.95)",
    );
    this.scatterPickupDebris(cluster);
    cluster.alive = false;
    this.comboHits = 0;
  }

  private handleDroneContact(cluster: FallingCluster): void {
    playSfx("shield");
    this.spawnDrone();
    const center = cluster.body.position;
    this.spawnFloater(
      "DRONE",
      center.x,
      center.y,
      "#eedfff",
      "rgba(210, 170, 255, 0.95)",
    );
    this.scatterPickupDebris(cluster);
    cluster.alive = false;
    this.comboHits = 0;
  }

  private handleTinyContact(cluster: FallingCluster): void {
    playSfx("shield");
    const center = cluster.body.position;
    // BIG during TINY pickup = clean exit: bank the accumulated big bonus
    // and reset the multiplier, then fall through to activate TINY.
    if (this.bigTimer > 0) {
      this.awardBigBonus();
      this.bigLevel = 0;
      this.bigTimer = 0;
      this.bigMax = 1;
    }
    if (this.tinyTimer > 0) {
      // Re-hit while still tiny: bank the small bonus and refresh the
      // duration. No further size change (stays at TINY_PLAYER_SCALE).
      this.score += TINY_REHIT_BONUS;
      this.scoreEl.textContent = String(this.score);
      this.checkScoreMilestones();
      this.spawnFloater(
        `+${TINY_REHIT_BONUS}`,
        center.x,
        center.y,
        "#cbd9ff",
        "rgba(90, 130, 255, 0.95)",
      );
    } else {
      this.spawnFloater(
        "TINY",
        center.x,
        center.y,
        "#cbd9ff",
        "rgba(90, 130, 255, 0.95)",
      );
    }
    const dur = this.tinyDuration();
    this.tinyTimer = dur;
    this.tinyMax = dur;
    this.updatePlayerScaleTarget();
    this.scatterPickupDebris(cluster);
    cluster.alive = false;
    this.comboHits = 0;
  }

  private handleBigContact(cluster: FallingCluster): void {
    playSfx("fast_up");
    // TINY during BIG pickup: end TINY (no bonus to bank) and grow into BIG.
    if (this.tinyTimer > 0) {
      this.tinyTimer = 0;
      this.tinyMax = 1;
    }
    this.bigLevel += 1;
    const dur = this.bigDuration();
    this.bigTimer = dur;
    this.bigMax = dur;
    this.updatePlayerScaleTarget();
    const mul = this.bigMultiplier();
    const center = cluster.body.position;
    this.spawnFloater(
      `${mul}X`,
      center.x,
      center.y,
      "#dab8ff",
      "rgba(180, 100, 255, 0.95)",
    );
    this.scatterPickupDebris(cluster);
    cluster.alive = false;
    this.comboHits = 0;
  }

  private scatterPickupDebris(cluster: FallingCluster): void {
    for (const p of cluster.partWorldPositions()) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 6,
          y: -3 - Math.random() * 3,
        },
        kind: cluster.kind,
      });
    }
  }

  private updateDrones(dt: number): void {
    if (this.drones.length === 0) return;
    for (const d of this.drones) {
      d.lifetime -= dt;
      d.phase += dt * d.speed;
      d.pulse += dt * 4;
      const x = d.centreX + Math.sin(d.phase) * d.amplitude;
      Body.setPosition(d.body, { x, y: d.baseY });
      Body.setAngle(d.body, Math.sin(d.phase * 0.5) * 0.4);
    }
    this.drones = this.drones.filter((d) => {
      if (d.lifetime > 0) return true;
      Composite.remove(this.engine.world, d.body);
      return false;
    });
  }

  private drawDrones(): void {
    if (this.drones.length === 0) return;
    const ctx = this.ctx;
    const droneSize = this.hexSize * DRONE_SIZE_FACTOR;
    for (const d of this.drones) {
      const px = d.body.position.x;
      const py = d.body.position.y;
      const pulseT = (Math.sin(d.pulse) + 1) * 0.5;

      // Halo.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const haloR = droneSize * 2.2;
      const halo = ctx.createRadialGradient(px, py, 0, px, py, haloR);
      halo.addColorStop(0, `rgba(210, 170, 255, ${0.6 + pulseT * 0.25})`);
      halo.addColorStop(0.55, "rgba(140, 90, 220, 0.35)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(px, py, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Hex core.
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.body.angle);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        const x = droneSize * Math.cos(a);
        const y = droneSize * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, -droneSize, 0, droneSize);
      grad.addColorStop(0, "#e6d6ff");
      grad.addColorStop(1, "#3c1a72");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + pulseT * 0.3})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Lifetime ring around the drone.
      const t = Math.max(0, d.lifetime / d.maxLifetime);
      ctx.save();
      ctx.strokeStyle = "rgba(210, 170, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, droneSize * 1.4, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ROTATE tutorial overlay: a curved double-headed arrow ringing the
  // player + a big "ROTATE" label, both pulsing softly. Drawn last over
  // gameplay so it can't get hidden behind clusters.
  private drawResumeCountdown(): void {
    if (this.resumeCountdown <= 0) return;
    const remaining = this.resumeCountdown;
    const num = Math.ceil(remaining);
    if (num <= 0) return;

    const ctx = this.ctx;
    // Each second runs frac=1 (just appeared) → frac=0 (about to roll).
    // Use that to scale-in fast and fade-out at the very end.
    const frac = remaining - (num - 1);
    const t = 1 - frac; // 0 → 1 over the second
    const scale = 0.55 + 0.45 * Math.min(1, t * 5);
    const alpha = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;

    const cx = this.boardOriginX + this.boardWidth / 2;
    const cy = this.boardOriginY + this.boardHeight * 0.4;
    const fontSize = Math.max(96, Math.round(this.hexSize * 5));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${fontSize}px "Avenir Next", "Helvetica Neue", "Trebuchet MS", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(91, 139, 255, 0.85)";
    ctx.shadowBlur = 32;
    ctx.fillStyle = "#e8ecff";
    ctx.fillText(String(num), 0, 0);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(13, 15, 28, 0.85)";
    ctx.strokeText(String(num), 0, 0);
    ctx.restore();
  }

  private drawRotateTutorial(): void {
    if (!this.rotateTutorialActive) return;
    const ctx = this.ctx;
    const com = this.player.body.position;
    const bounds = this.player.body.bounds;
    const halfH = (bounds.max.y - bounds.min.y) / 2;
    const halfArrow = this.hexSize * 2.6; // half-width of the straight arrow
    const arrowY = bounds.min.y - this.hexSize * 1.1;
    const pulse = (Math.sin(performance.now() * 0.006) + 1) * 0.5;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 230, 120, ${0.7 + pulse * 0.3})`;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255, 200, 80, 0.85)";
    ctx.shadowBlur = 18;

    // Straight horizontal shaft.
    ctx.beginPath();
    ctx.moveTo(com.x - halfArrow, arrowY);
    ctx.lineTo(com.x + halfArrow, arrowY);
    ctx.stroke();

    // Arrowheads at both ends.
    const head = this.hexSize * 0.55;
    ctx.beginPath();
    // Right tip pointing right.
    ctx.moveTo(com.x + halfArrow, arrowY);
    ctx.lineTo(com.x + halfArrow - head, arrowY - head * 0.7);
    ctx.moveTo(com.x + halfArrow, arrowY);
    ctx.lineTo(com.x + halfArrow - head, arrowY + head * 0.7);
    // Left tip pointing left.
    ctx.moveTo(com.x - halfArrow, arrowY);
    ctx.lineTo(com.x - halfArrow + head, arrowY - head * 0.7);
    ctx.moveTo(com.x - halfArrow, arrowY);
    ctx.lineTo(com.x - halfArrow + head, arrowY + head * 0.7);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Big "ROTATE" label above the arrow. Same spacey monospace as the
    // kind-hint labels — 700-weight, wide letter-spacing — and ~20%
    // smaller than the prior 900-weight system sans-serif.
    const fontSize = Math.max(28, Math.round(this.hexSize * 1.92));
    ctx.font = `600 ${fontSize}px "Avenir Next", "Helvetica Neue", "Trebuchet MS", Arial, sans-serif`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.22em";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = Math.max(
      this.boardOriginY + fontSize * 0.7,
      arrowY - fontSize * 0.85,
    );
    ctx.shadowColor = "rgba(255, 220, 120, 0.95)";
    ctx.shadowBlur = 26;
    ctx.fillStyle = "#fff3c2";
    ctx.fillText("ROTATE", com.x, labelY);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(80, 50, 0, 0.85)";
    ctx.strokeText("ROTATE", com.x, labelY);

    ctx.restore();
    void halfH; // reserved for future styling that anchors below the blob
  }

  private drawShield(): void {
    if (this.shieldTimer <= 0) return;
    const ctx = this.ctx;
    const com = this.player.body.position;
    const bounds = this.player.body.bounds;
    const dx = (bounds.max.x - bounds.min.x) / 2;
    const dy = (bounds.max.y - bounds.min.y) / 2;
    const radius = Math.hypot(dx, dy) + this.hexSize * 0.5;
    const shieldMax = this.shieldDuration();
    const t = Math.min(1, this.shieldTimer / shieldMax);
    const pulse = (Math.sin(performance.now() * 0.006) + 1) * 0.5;

    ctx.save();
    // Soft fill.
    ctx.globalCompositeOperation = "lighter";
    const fill = ctx.createRadialGradient(com.x, com.y, 0, com.x, com.y, radius);
    fill.addColorStop(0, "rgba(220, 220, 220, 0)");
    fill.addColorStop(0.7, `rgba(220, 220, 220, ${0.05 + pulse * 0.05})`);
    fill.addColorStop(1, `rgba(220, 220, 220, ${0.18 + pulse * 0.12})`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(com.x, com.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crisp ring + countdown arc.
    ctx.save();
    ctx.strokeStyle = `rgba(230, 230, 230, ${0.55 + pulse * 0.25})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(com.x, com.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(245, 245, 245, 0.95)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(com.x, com.y, radius, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawBigAura(): void {
    if (this.bigTimer <= 0) return;
    const ctx = this.ctx;
    const pos = this.player.body.position;
    const bounds = this.player.body.bounds;
    const dx = (bounds.max.x - bounds.min.x) / 2;
    const dy = (bounds.max.y - bounds.min.y) / 2;
    const pulse = (Math.sin(performance.now() * 0.005) + 1) * 0.5;
    const baseR = Math.hypot(dx, dy) + this.hexSize * 0.6;
    const r = baseR * (1 + 0.12 * pulse);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const grad = ctx.createRadialGradient(pos.x, pos.y, baseR * 0.5, pos.x, pos.y, r);
    grad.addColorStop(0, "rgba(180, 100, 255, 0)");
    grad.addColorStop(0.55, `rgba(180, 100, 255, ${0.18 + pulse * 0.10})`);
    grad.addColorStop(1, "rgba(100, 30, 180, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = `rgba(218, 184, 255, ${0.35 + pulse * 0.30})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private spawnDrone(): void {
    const baseY = this.boardOriginY + this.boardHeight * 0.5;
    const centreX = this.boardOriginX + this.boardWidth / 2;
    const amplitude = this.boardWidth * 0.35;
    const droneSize = this.hexSize * DRONE_SIZE_FACTOR;
    const body = Bodies.polygon(centreX, baseY, 6, droneSize, {
      isStatic: true,
      isSensor: true,
      label: "drone",
      collisionFilter: { category: CAT_DRONE, mask: CAT_CLUSTER },
    });
    Composite.add(this.engine.world, body);
    this.drones.push({
      body,
      baseY,
      centreX,
      amplitude,
      phase: Math.random() * Math.PI * 2,
      speed: DRONE_OSCILLATION_SPEED,
      lifetime: this.droneDuration(),
      maxLifetime: this.droneDuration(),
      pulse: Math.random() * Math.PI * 2,
    });
  }

  private handleNormalContact(cluster: FallingCluster, contact: ContactInfo): void {
    const allParts = cluster.partWorldPositions();
    // One impact per hex in the cluster (capped at 4 so a giant blob
    // doesn't carpet-bomb the mix), staggered slightly so they read as
    // a chained punch rather than a single louder thud. Random variants
    // mean the staggered fires don't sound identical.
    playSfx("impact");
    const extras = Math.min(allParts.length - 1, 3);
    for (let i = 1; i <= extras; i++) {
      setTimeout(() => playSfx("impact"), i * 45);
    }

    // A normal-cluster hit while fast or big is active vaporises the
    // accumulated bonus pool(s) — scatter them as red fragments and end
    // the effect(s). Fast and big bank/forfeit independently.
    this.loseFastBonus();
    this.loseBigBonus();

    // Snapshot pre-hit size so the lose check only counts hits taken while
    // already in the danger zone. Otherwise a fast 5→6→7 combo would end
    // the run before the danger glow ever appears.
    const wasInDanger = this.player.size() >= this.dangerSize();

    // Bigger blocks bite harder, but a notch gentler than sticky removes:
    // 1–3 hex clusters stick 1, 4 sticks 2, 5 sticks 3 (max(1, N-2)). Each
    // stick anchors at the cluster part closest to the contact point that
    // hasn't already been used, and chains via findStickCell on the
    // rebuilt blob.
    const stickCount = Math.max(1, allParts.length - 2);
    const partsByDist = allParts
      .map((p) => ({
        p,
        d: Math.hypot(p.x - contact.point.x, p.y - contact.point.y),
      }))
      .sort((a, b) => a.d - b.d);

    // Cells reserved by either an existing stick-in-flight or a stick we
    // queue in this loop, so multiple parts of the same cluster don't
    // pick the same target.
    const reserved = new Set<string>(
      this.sticksInFlight.map((s) => axialKey(s.targetCell)),
    );

    const stuckPartIds = new Set<number>();
    let stuck = 0;
    for (const item of partsByDist) {
      if (stuck >= stickCount) break;
      const cell = this.player.findStickCell(item.p.x, item.p.y, reserved);
      if (!cell) continue;
      reserved.add(axialKey(cell));
      this.spawnStickInFlight(cell, item.p, cluster);
      stuckPartIds.add(item.p.partId);
      stuck += 1;
    }
    // Prevent the same blue cluster from being scored as a "passed without
    // contact" point at end of play. (The cluster is killed below.)

    if (stuck > 0) {
      // Brief slow-mo buffer so the player can recover their bearings after
      // a hit. Stacks with an existing slow effect by extending the timer
      // rather than truncating; overrides a fast effect (slow > fast for
      // recovery). Slow-mo fires at impact, even though the new hex hasn't
      // physically merged yet — gives the player time to read the
      // sucking-in animation before the next hit.
      if (this.timeEffect === "slow") {
        this.timeEffectTimer = Math.max(this.timeEffectTimer, STICK_SLOW_BUFFER);
      } else {
        this.timeEffect = "slow";
        this.timeScale = SLOW_TIMESCALE;
        this.timeEffectTimer = STICK_SLOW_BUFFER;
        this.timeEffectMax = STICK_SLOW_BUFFER;
      }
      // Collision-induced slow stays silent — clear the pickup flag so
      // slow_up doesn't fire even if a previous pickup-slow is still
      // active. Once a hit happens the audio narrative is over.
      this.slowFromPickup = false;
    }
    // Tutorial trigger for the very first 1→2 growth fires at completion
    // time inside completeStickInFlight, since size only changes when the
    // hex actually lands.

    // Spawn debris for the cluster parts that didn't stick.
    for (const p of allParts) {
      if (stuckPartIds.has(p.partId)) continue;
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 2 - 1,
        },
        kind: cluster.kind,
      });
    }

    cluster.alive = false;

    // Only hits taken *while already in danger* count toward the lose
    // combo, so the player is guaranteed at least one frame of warning
    // glow before a fatal sequence.
    if (wasInDanger) {
      this.comboHits += 1;
      if (this.comboHits >= LOSE_COMBO) {
        this.endGame();
      }
    } else {
      this.comboHits = 0;
    }
  }

  // Listener wired to Player.setOrphanListener — fires whenever an
  // automatic connectivity sweep drops cells. Spawns each orphan as
  // a debris piece flying outward from the player's centre.
  private spawnPlayerOrphans(
    orphans: ReadonlyArray<{ cell: Axial; worldX: number; worldY: number }>,
  ): void {
    for (const o of orphans) {
      this.spawnDebris({
        x: o.worldX,
        y: o.worldY,
        angle: this.player.body.angle,
        velocity: this.player.body.velocity,
        angularVelocity: this.player.body.angularVelocity,
        impulse: {
          x:
            Math.sign(o.worldX - this.player.body.position.x) *
              (1.5 + Math.random() * 1.5) +
            (Math.random() - 0.5),
          y: -1 - Math.random() * 2,
        },
        kind: "normal",
      });
    }
  }

  private spawnDebris(opts: {
    x: number;
    y: number;
    angle: number;
    velocity: { x: number; y: number };
    angularVelocity: number;
    impulse: { x: number; y: number };
    kind: ClusterKind;
    scale?: number;
    lifetime?: number;
  }): void {
    const d = DebrisHex.spawn({ ...opts, hexSize: this.hexSize });
    this.debris.push(d);
    Composite.add(this.engine.world, d.body);
  }

  private spawnStickInFlight(
    targetCell: Axial,
    part: { x: number; y: number; angle: number; partId: number },
    cluster: FallingCluster,
  ): void {
    // Free hex body driven by per-frame velocity blending. Collides with
    // nothing — purely visual motion, never touches the player or other
    // physics.
    const body = Bodies.polygon(part.x, part.y, 6, this.hexSize, {
      friction: 0,
      frictionAir: 0,
      restitution: 0,
      density: 0.0008,
      label: "stickInFlight",
      angle: part.angle,
      collisionFilter: { category: 0x0020, mask: 0x0000 },
    });
    Body.setVelocity(body, {
      x: cluster.body.velocity.x + (Math.random() - 0.5) * 1.5,
      y: cluster.body.velocity.y + (Math.random() - 0.5) * 1.5,
    });
    Body.setAngularVelocity(
      body,
      cluster.body.angularVelocity + (Math.random() - 0.5) * 0.3,
    );

    Composite.add(this.engine.world, body);

    this.sticksInFlight.push({
      body,
      targetCell,
      age: 0,
      lifetime: STICK_FLIGHT_LIFETIME,
    });
  }

  private updateSticksInFlight(dt: number): void {
    if (this.sticksInFlight.length === 0) return;
    const snapDist = this.hexSize * STICK_FLIGHT_SNAP_DIST_FRAC;
    const remaining: StickInFlight[] = [];
    for (const s of this.sticksInFlight) {
      s.age += dt;

      const target = this.player.projectedCellWorldCenter(s.targetCell);
      const dx = target.x - s.body.position.x;
      const dy = target.y - s.body.position.y;
      const dist = Math.hypot(dx, dy);

      // Drive the homing piece directly: aim at the target slot at a
      // closing speed proportional to how far it has to go, on top of the
      // player's own velocity so it tracks side-to-side motion. Blended
      // each frame for a soft, springy feel without applying any force
      // back to the player.
      const ux = dist > 0.001 ? dx / dist : 0;
      const uy = dist > 0.001 ? dy / dist : 0;
      const closingSpeed = dist / STICK_FLIGHT_CLOSE_STEPS;
      const desiredVx = this.player.body.velocity.x + ux * closingSpeed;
      const desiredVy = this.player.body.velocity.y + uy * closingSpeed;
      Body.setVelocity(s.body, {
        x: s.body.velocity.x + (desiredVx - s.body.velocity.x) * STICK_FLIGHT_VELOCITY_BLEND,
        y: s.body.velocity.y + (desiredVy - s.body.velocity.y) * STICK_FLIGHT_VELOCITY_BLEND,
      });

      if (dist <= snapDist || s.age >= s.lifetime) {
        this.completeStickInFlight(s);
        continue;
      }
      remaining.push(s);
    }
    this.sticksInFlight = remaining;
  }

  private completeStickInFlight(s: StickInFlight): void {
    Composite.remove(this.engine.world, s.body);

    const sizeBefore = this.player.size();
    this.player.addCell(s.targetCell);
    // Sticks can land in unfortunate orders that leave a hole inside the
    // silhouette. Compact closes the gap so the blob always reads as solid.
    this.player.compact();

    // First-ever 1→2 growth (persisted across launches) teaches the
    // rotate gesture.
    if (sizeBefore === 1 && this.player.size() > 1 && !this.rotateTutorialShown) {
      this.rotateTutorialShown = true;
      saveBool(ROTATE_TUTORIAL_STORAGE_KEY, true);
      this.rotateTutorialActive = true;
      this.rotateTutorialTimer = 0;
      this.rotateTutorialStartAngle = this.player.body.angle;
    }
  }

  private drawSticksInFlight(): void {
    if (this.sticksInFlight.length === 0) return;
    const ctx = this.ctx;
    for (const s of this.sticksInFlight) {
      const t = Math.min(1, s.age / Math.max(0.001, s.lifetime));
      // Subtle scale pulse and a glow trail so the suck-in reads clearly.
      const scale = 1 + 0.08 * Math.sin(t * Math.PI);
      ctx.save();
      ctx.translate(s.body.position.x, s.body.position.y);
      ctx.rotate(s.body.angle);
      ctx.scale(scale, scale);

      pathHex(ctx, 0, 0, this.hexSize);
      const grad = ctx.createLinearGradient(0, -this.hexSize, 0, this.hexSize);
      grad.addColorStop(0, "#aac4ff");
      grad.addColorStop(1, "#5b8bff");
      ctx.fillStyle = grad;
      ctx.shadowColor = "rgba(170, 196, 255, 0.85)";
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#1c2348";
      ctx.stroke();
      ctx.restore();
    }
  }

  private handleStickyContact(cluster: FallingCluster, contact: ContactInfo): void {
    playSfx("heal");
    const allParts = cluster.partWorldPositions();
    // Sticky red is a heal, not a hit — fast bonus survives this contact.
    // Only a real blue-cluster collision ends fast mode.
    // If the player is already at size 1, there's nothing to heal so the
    // pickup banks +2 points instead, with a coin-style floater.
    if (this.player.size() === 1) {
      const HEAL_BONUS = 2;
      this.score += HEAL_BONUS;
      this.scoreEl.textContent = String(this.score);
      this.checkScoreMilestones();
      this.spawnFloater(
        `+${HEAL_BONUS}`,
        cluster.body.position.x,
        cluster.body.position.y,
        "#ff9bb5",
        "rgba(255, 140, 180, 0.95)",
      );
    }
    // A sticky cluster of N hexes rips off N-1 hexes from the player
    // (floor of 1, capped at player size - 1 so we always leave at least
    // one cell). The cells removed are the N-1 closest to the contact
    // point, ordered by distance.
    if (this.player.size() > 1) {
      const stickyCellCount = allParts.length;
      const removalsRequested = Math.max(1, stickyCellCount - 1);
      const removalsAllowed = Math.min(removalsRequested, this.player.size() - 1);

      // Capture world positions FIRST — once removeCell rebuilds the body,
      // any cell we haven't pulled a position for yet will report a stale
      // location.
      const cellsByDist = this.player.cells
        .map((cell) => {
          const wp = this.player.cellWorldCenter(cell);
          const d = Math.hypot(wp.x - contact.point.x, wp.y - contact.point.y);
          return { cell, dist: d, wp };
        })
        .sort((a, b) => a.dist - b.dist);

      const toRemove = cellsByDist.slice(0, removalsAllowed);

      for (const item of toRemove) {
        this.spawnDebris({
          x: item.wp.x,
          y: item.wp.y,
          angle: this.player.body.angle,
          velocity: this.player.body.velocity,
          angularVelocity: this.player.body.angularVelocity,
          impulse: {
            x: (Math.random() - 0.5) * 4,
            y: -2 - Math.random() * 2,
          },
          kind: "normal",
        });
      }
      for (const item of toRemove) this.player.removeCell(item.cell);

      // After all targeted removals, drop any "barbell" shapes (still
      // technically one component but joined by a thin neck) — true
      // disconnections are auto-handled inside Player.removeCell now.
      // The orphan listener (wired in the Game constructor) spawns
      // debris for everything that falls off, so this call is fire-
      // and-forget.
      this.player.pruneNarrowSections();
    }

    // The sticky cluster itself shatters into debris.
    for (const p of allParts) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 5,
          y: (Math.random() - 0.5) * 3,
        },
        kind: cluster.kind,
      });
    }

    cluster.alive = false;
    this.comboHits = 0;
  }

  private handleCoinContact(cluster: FallingCluster): void {
    playSfx("coin");
    // Coin pickup: base +5 always banks. While fast is active, the
    // multiplier also applies — the *extra* points (5 × (mul - 1)) join
    // the at-risk bonus pool, just like a passed cluster would.
    this.score += COIN_SCORE_BONUS;
    this.scoreEl.textContent = String(this.score);
    if (this.timeEffect === "fast") {
      this.fastBonus += COIN_SCORE_BONUS * (this.fastMultiplier() - 1);
    }
    if (this.bigTimer > 0) {
      this.bigBonus += COIN_SCORE_BONUS * (this.bigMultiplier() - 1);
    }
    this.checkScoreMilestones();
    const center = cluster.body.position;
    this.spawnFloater(`+${COIN_SCORE_BONUS}`, center.x, center.y, "#ffe28a", "rgba(255, 175, 70, 0.95)");
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.15;
      const speed = 5 + Math.random() * 2.5;
      this.spawnDebris({
        x: center.x,
        y: center.y,
        angle: a,
        velocity: { x: 0, y: 0 },
        angularVelocity: (Math.random() - 0.5) * 6,
        impulse: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
        kind: "coin",
        scale: 0.32,
        lifetime: 0.55,
      });
    }
    cluster.alive = false;
  }

  private handlePowerupContact(cluster: FallingCluster): void {
    const center = cluster.body.position;
    if (cluster.kind === "slow") {
      // Slow during fast = clean exit: pay out the accumulated bonus and
      // reset the multiplier level, then activate slow.
      if (this.timeEffect === "fast") {
        this.awardFastBonus();
        this.fastLevel = 0;
      }
      playSfx("slow_down");
      this.timeEffect = "slow";
      this.timeScale = SLOW_TIMESCALE;
      const slowDur = this.slowDuration();
      this.timeEffectTimer = slowDur;
      this.timeEffectMax = slowDur;
      this.slowFromPickup = true;
      this.slowUpFired = false;
    } else if (cluster.kind === "fast") {
      // Each fast pickup stacks: level += 1, speed += 0.1, multiplier += 1.
      // Existing accumulated bonus carries into the new effect so combos
      // can stack big rewards across multiple pickups.
      playSfx("fast_up");
      this.fastLevel += 1;
      this.timeEffect = "fast";
      this.timeScale = FAST_TIMESCALE_BASE + (this.fastLevel - 1) * FAST_TIMESCALE_STEP;
      this.timeEffectTimer = this.fastDuration();
      this.timeEffectMax = this.fastDuration();
      const mul = this.fastMultiplier();
      // Multiplier achievements fire only on payout (in awardFastBonus),
      // not on pickup — picking up 6X but losing it on a blue hit
      // shouldn't unlock "Hex Time".
      this.spawnFloater(
        `${mul}X`,
        center.x,
        center.y,
        "#c8ffd5",
        "rgba(120, 255, 170, 0.95)",
      );
    }

    // Burst the powerup into debris so the pickup feels punchy.
    const allParts = cluster.partWorldPositions();
    for (const p of allParts) {
      this.spawnDebris({
        x: p.x,
        y: p.y,
        angle: p.angle,
        velocity: cluster.body.velocity,
        angularVelocity: cluster.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 6,
          y: -3 - Math.random() * 3,
        },
        kind: cluster.kind,
      });
    }

    cluster.alive = false;
    // Picking up a power-up doesn't count as a "hit" against the combo.
    this.comboHits = 0;
  }

  // Forced opening spawn: a centered single-cell blue cluster, straight
  // drop, no side / angled / swarm overrides. Mirrors the tail of the
  // regular spawnCluster path but with all the variation knobs nailed
  // down so the AVOID hint sits dead-centre.
  private spawnFirstClusterCentered(): void {
    const kind: ClusterKind = "normal";
    const shape: Shape = COIN_SHAPE;
    const railLeft = this.currentRailLeft();
    const railRight = this.currentRailRight();
    const x = (railLeft + railRight) / 2;
    const y = this.boardOriginY - this.hexSize * 4;
    const speed = this.computeFallSpeed();

    const cluster = FallingCluster.spawn({
      shape,
      x,
      y,
      hexSize: this.hexSize,
      kind,
      initialSpeedY: speed,
      initialSpin: 0,
    });
    Body.setVelocity(cluster.body, { x: 0, y: speed });

    cluster.body.collisionFilter.category = CAT_CLUSTER;
    cluster.body.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    for (let i = 1; i < cluster.body.parts.length; i++) {
      cluster.body.parts[i]!.collisionFilter.category = CAT_CLUSTER;
      cluster.body.parts[i]!.collisionFilter.mask =
        CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    }

    if (!this.seenKinds.has(kind)) {
      cluster.hintLabel = kindLabel(kind);
      this.seenKinds.add(kind);
      saveSeenHints(this.seenKinds);
    }

    this.clusters.push(cluster);
    this.clusterByBodyId.set(cluster.body.id, cluster);
    Composite.add(this.engine.world, cluster.body);
  }

  // Pick a kind from the Helpful tier — coin (always), slow, tiny,
  // shield, drone — uniform across whichever ones currently pass their
  // score gate and aren't excluded by the difficulty config. Returns
  // null if nothing is eligible (which should never happen since coin
  // is always eligible unless the difficulty excludes it).
  private pickHelpfulKind(cfg: DifficultyConfig): ClusterKind | null {
    const exclude = cfg.helpfulExclude;
    const pool: ClusterKind[] = [];
    const allow = (k: ClusterKind, gate: boolean) => {
      if (gate && !(exclude && exclude.includes(k))) pool.push(k);
    };
    allow("coin", true);
    allow("slow", this.score >= POWERUP_MIN_SCORE);
    allow("tiny", this.score >= (cfg.tinyMinScore ?? TINY_MIN_SCORE));
    allow("shield", this.score >= SHIELD_MIN_SCORE);
    allow("drone", this.score >= DRONE_MIN_SCORE);
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Pick a kind from the Challenge tier — fast, big — uniform across
  // whichever pass their score gate.
  private pickChallengeKind(cfg: DifficultyConfig): ClusterKind | null {
    const pool: ClusterKind[] = [];
    if (this.score >= POWERUP_MIN_SCORE) pool.push("fast");
    if (this.score >= (cfg.bigMinScore ?? BIG_MIN_SCORE)) pool.push("big");
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private spawnCluster(): void {
    // Very first spawn of the run: force a centered single-cell blue
    // cluster so the first-ever AVOID hint label is dead-centre. This
    // overrides everything (kind, shape, column, side spawn, angle) to
    // give a clean opening cue.
    if (this.firstSpawn) {
      this.firstSpawn = false;
      this.spawnFirstClusterCentered();
      return;
    }

    // Swarm waves drop a stream of single hexes at varied speeds. Outside
    // a swarm, pick a 2-5 cell polyhex shape from the library.
    const isSwarmSpawn = this.wavePhase === "wave" && this.swarmWave;

    // Pick the cluster kind first so we know the shape (coins are always
    // single-hex). Power-ups and coins are rare; never during a swarm.
    let kind: ClusterKind = "normal";
    if (isSwarmSpawn) {
      // Occasional heal block tucked into the middle of a swarm — gives
      // the player a brief opportunity to recover during otherwise pure
      // dodge phases.
      if (
        this.score >= STICKY_MIN_SCORE &&
        Math.random() < SWARM_STICKY_CHANCE
      ) {
        kind = "sticky";
      }
    } else {
      const cfg = this.cfg();
      const stickyEnd = SPAWN_STICKY_TIER_WEIGHT * cfg.stickyMul;
      const helpfulEnd = stickyEnd + SPAWN_HELPFUL_TIER_WEIGHT * cfg.helpfulMul;
      const challengeEnd = helpfulEnd + SPAWN_CHALLENGE_TIER_WEIGHT * cfg.challengeMul;
      const r = Math.random();
      if (r < stickyEnd) {
        if (this.score >= STICKY_MIN_SCORE) kind = "sticky";
      } else if (r < helpfulEnd) {
        kind = this.pickHelpfulKind(cfg) ?? "normal";
      } else if (r < challengeEnd) {
        kind = this.pickChallengeKind(cfg) ?? "normal";
      }
    }

    // Coin / shield / drone pickups and swarm hexes are always single-cell.
    // Tiny / big drop as 2-5 cell polyhexes so they read as "real" blocks
    // the player has to dodge into rather than as small pickups.
    const shape: Shape =
      kind === "coin" ||
      kind === "shield" ||
      kind === "drone" ||
      isSwarmSpawn
        ? COIN_SHAPE
        : pickShape(Math.random);

    // Side spawn: at high score the play also gets clusters flying in from
    // left/right at a downward angle. Sticky/slow/fast still drop from the
    // top so they're catchable.
    const sideSpawn =
      kind === "normal" &&
      this.score >= SIDE_SPAWNS_SCORE &&
      Math.random() < 0.18;

    const speed = this.computeFallSpeed();
    const spin = (Math.random() - 0.5) * (isSwarmSpawn ? 0.16 : 0.08);
    let x: number;
    let y: number;
    let vx: number;
    let vy: number;

    let sideEntryFromLeft: boolean | null = null;
    if (sideSpawn) {
      const fromLeft = Math.random() < 0.5;
      sideEntryFromLeft = fromLeft;
      const entry = this.computeSideEntry(speed, fromLeft, Math.random);
      x = entry.x;
      y = entry.y;
      vx = entry.vx;
      vy = entry.vy;
    } else {
      const colStep = this.pickSpawnColumn(shape);
      if (colStep === null) return; // would block the safe lane
      const railLeft = this.currentRailLeft();
      const railRight = this.currentRailRight();
      const railCenter = (railLeft + railRight) / 2;
      const colWidth = SQRT3 * this.hexSize;
      x = railCenter + colStep * colWidth;
      y = this.boardOriginY - this.hexSize * 4;

      // Angled-drop spawn: late game, some clusters drop at a non-vertical
      // angle. The angle stays small (≤ ~20°) so the cluster still ends up
      // somewhere reachable.
      if (this.score >= ANGLED_SPAWNS_SCORE && kind === "normal" && Math.random() < 0.3) {
        const angle = (Math.random() - 0.5) * 0.7;
        vx = Math.sin(angle) * speed;
        vy = Math.cos(angle) * speed;
      } else {
        vx = 0;
        vy = speed;
      }
    }

    const cluster = FallingCluster.spawn({
      shape,
      x,
      y,
      hexSize: this.hexSize,
      kind,
      initialSpeedY: vy,
      initialSpin: spin,
    });
    // Override velocity so we can include the horizontal component for
    // angled / side spawns.
    Body.setVelocity(cluster.body, { x: vx, y: vy });

    cluster.body.collisionFilter.category = CAT_CLUSTER;
    cluster.body.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    for (let i = 1; i < cluster.body.parts.length; i++) {
      cluster.body.parts[i]!.collisionFilter.category = CAT_CLUSTER;
      cluster.body.parts[i]!.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    }

    // First time this kind is seen this page session, attach a big
    // glowing label to this specific cluster (AVOID / HEAL / SLOW /
    // FAST / COLLECT). Once shown, it doesn't repeat on restart — a
    // full page reload is what brings the labels back.
    if (!this.seenKinds.has(kind)) {
      cluster.hintLabel = kindLabel(kind);
      this.seenKinds.add(kind);
      saveSeenHints(this.seenKinds);
    }

    this.clusters.push(cluster);
    this.clusterByBodyId.set(cluster.body.id, cluster);
    Composite.add(this.engine.world, cluster.body);
    if (sideEntryFromLeft !== null) {
      this.sideWarnings.push({ cluster, side: sideEntryFromLeft ? "left" : "right", age: 0, lifetime: 0.7 });
    }
  }

  // ----- Challenge runtime ----------------------------------------------

  // Public entry point: switch the engine into challenge mode and start
  // the named challenge. Caller is responsible for state-machine bookkeeping
  // (overlay hide, hud reveal, etc).
  // Switch mode and re-layout the canvas if the mode actually changes
  // (challenge mode reserves margins for the progress bars).
  private setGameMode(mode: GameMode): void {
    if (this.gameMode === mode) return;
    this.gameMode = mode;
    // Endless mode reverts to Math.random so each run is fresh; challenge
    // mode reseeds inside startChallenge().
    if (mode === "endless") this.rng = Math.random;
    this.resize();
  }

  startChallenge(def: ChallengeDef, opts?: { seed?: number; startWaveIdx?: number }): void {
    this.setGameMode("challenge");
    this.activeChallenge = def;
    this.effectOverrides = def.effects ?? null;
    const startIdx = Math.max(0, Math.min(def.waves.length - 1, opts?.startWaveIdx ?? 0));
    this.challengeWaveIdx = startIdx;
    this.challengeSlotIdx = 0;
    this.challengeProbCount = 0;
    this.challengeWaveTimer = 0;
    this.challengeSlotTimer = 0;
    this.challengeSpawnTimer = 0;
    this.challengeFinishingHold = 0;
    this.progress = 0;
    this.progressDisplayed = 0;
    // Stash the seed key; beginChallengeWave reseeds per-wave from
    // (key, waveIdx). Roster keys off the challenge id; custom challenges
    // stringify their numeric seed so the editor's seed input still
    // fully controls determinism.
    this.challengeSeedKey = typeof opts?.seed === "number"
      ? String(opts.seed >>> 0)
      : def.id;
    this.beginChallengeWave();
    trackChallengeStart(def.block);
  }

  private beginChallengeWave(): void {
    const def = this.activeChallenge;
    if (!def) return;
    if (this.challengeWaveIdx >= def.waves.length) return;
    const line = def.waves[this.challengeWaveIdx]!;
    let parsed: ParsedWave;
    try {
      parsed = parseWaveLine(line);
    } catch (err) {
      console.error(`[challenge ${def.id}] wave ${this.challengeWaveIdx + 1} parse error:`, err);
      // Skip the bad wave so the run doesn't deadlock.
      this.challengeWaveIdx += 1;
      this.beginChallengeWave();
      return;
    }
    // Per-wave reseed: an explicit seed= in the wave DSL pins this
    // wave's spawn layout; otherwise we derive from the challenge key
    // and wave index so each wave still has its own stream.
    //
    // Note: forward-isolation only. Reseeding makes the rng draws
    // deterministic per wave, but `pickSpawnColumn` reads the wall
    // lerp's current `wall.amount`, which depends on time elapsed since
    // the previous wave set its target. Editing an earlier wave's
    // duration can therefore shift later waves' column placements even
    // though their seeded streams are unchanged. Reverse-direction
    // edits (mutating wave N) leave wave N+1's *seed* alone but its
    // *column footprint* is environment-coupled by design.
    const waveSeed =
      parsed.seed ?? hashSeed(`${this.challengeSeedKey}:${this.challengeWaveIdx}`);
    this.rng = mulberry32(waveSeed);
    this.currentParsedWave = parsed;
    this.challengeSlotIdx = 0;
    this.challengeProbCount = 0;
    this.challengeWaveTimer = parsed.durOverride ?? 0;
    this.challengeSlotTimer = parsed.slotInterval;
    this.challengeSpawnTimer = parsed.spawnInterval;

    // Apply walls. Wall.amount lerps; setting kind+target is enough.
    if (parsed.walls === "none") {
      this.setWall("none", 0);
    } else if (parsed.walls === "zigzag") {
      this.setWall("zigzag", 1.0, { amp: parsed.wallAmp, period: parsed.wallPeriod });
    } else if (parsed.walls === "narrow") {
      this.setWall("narrow", 1.0);
    } else {
      this.setWall("pinch", 1.0);
    }

    // Pick a safe column (or skip enforcement) for the prob stream.
    // Challenge mode treats unset (`null`) as "no enforced safe column"
    // so legacy waves that omit `safeCol=` keep their existing behaviour.
    // Authors who pin `safeCol=N` get a forbidden column in the prob
    // path; `safeCol=none` is identical to leaving it unset.
    if (typeof parsed.safeCol === "number") {
      this.safeColumn = parsed.safeCol - 4;
    } else {
      this.safeColumn = 99; // out-of-range sentinel — filter is a no-op
    }

    // Pulse the progress bar on every wave boundary except the first.
    if (this.challengeWaveIdx > 0) this.waveBumpT = 0.2;
  }

  private advanceChallenge(dt: number): void {
    const def = this.activeChallenge;
    const wave = this.currentParsedWave;
    if (!def || !wave) return;

    // Hard wall: dur expired.
    if (wave.durOverride !== null) {
      this.challengeWaveTimer -= dt;
    }

    // Slot stream.
    if (wave.slots.length > 0 && this.challengeSlotIdx < wave.slots.length) {
      this.challengeSlotTimer -= dt;
      if (this.challengeSlotTimer <= 0) {
        const slot = wave.slots[this.challengeSlotIdx]!;
        if (slot !== null) this.spawnFromSlot(slot, wave);
        this.challengeSlotIdx += 1;
        this.challengeSlotTimer = wave.slotInterval;
      }
    }

    // Probabilistic stream.
    const probLimit = wave.countCap;
    const probEnabled = (probLimit === null || this.challengeProbCount < probLimit);
    if (probEnabled) {
      this.challengeSpawnTimer -= dt;
      if (this.challengeSpawnTimer <= 0) {
        this.spawnChallengeProbabilistic(wave);
        this.challengeProbCount += 1;
        this.challengeSpawnTimer = wave.spawnInterval;
      }
    }

    // Compute progress: per-wave portion = (slotsFired + probsFired) /
    // expected. expected falls back to 1 if neither is set (won't happen
    // under the validator).
    const slotsTotal = wave.slots.length;
    const probTotal = probLimit ?? Math.max(0, Math.floor((wave.durOverride ?? 0) / wave.spawnInterval));
    const expected = Math.max(1, slotsTotal + probTotal);
    const fired = this.challengeSlotIdx + this.challengeProbCount;
    const within = Math.min(1, fired / expected);
    this.progress = (this.challengeWaveIdx + within) / def.waves.length;

    // Wave end?
    const slotsDone = this.challengeSlotIdx >= slotsTotal;
    const probDone = probLimit === null ? false : this.challengeProbCount >= probLimit;
    const durDone = wave.durOverride !== null && this.challengeWaveTimer <= 0;
    const streamsDone = slotsDone && (probLimit === null ? slotsTotal > 0 : probDone);
    if (durDone || streamsDone) {
      this.challengeWaveIdx += 1;
      if (this.challengeWaveIdx < def.waves.length) {
        this.beginChallengeWave();
      } else {
        this.currentParsedWave = null;
        // Defer completion until the last block has passed the player so
        // the trailing animation lands under this run's banner and not
        // the next state.
        this.challengeFinishingHold = 0.5;
      }
    }
  }

  // Convert a slot to actual spawn parameters and spawn a normal cluster.
  private spawnFromSlot(slot: { size: number; col: number; angleIdx: number; kind?: ClusterKind }, wave: ParsedWave): void {
    const sizeRaw = Math.max(1, Math.min(5, slot.size));
    let size = sizeRaw;
    // Narrow walls can't fit size-4+ polyhexes through the corridor; clamp.
    if (wave.walls === "narrow" && size >= 3) size = 2;
    const kind: ClusterKind = slot.kind ?? "normal";
    // Pickups are always single-hex regardless of the requested size.
    const isPickup = kind === "coin" || kind === "shield" || kind === "drone";
    const shape = isPickup ? COIN_SHAPE : buildPolyhexShape(size, this.rng);

    const angle = ANGLE_TABLE[Math.max(0, Math.min(9, slot.angleIdx))] as {
      tilt: number;
      sideEntry?: "left" | "right" | "random";
      randomTilt?: number;
    };
    const halfFull = Math.floor(BOARD_COLS / 2);
    // Map slot col 0..9 onto the active rail's column range. Use the
    // projected inset so slots stay inside the corridor while the wall
    // is still animating in.
    const colWidth = SQRT3 * this.hexSize;
    const insetCols = this.projectedWallInsetPx() / Math.max(1, colWidth);
    const halfActive = Math.max(1, Math.floor(halfFull - insetCols));
    const colStep = -halfActive + Math.round((slot.col / 9) * (halfActive * 2));
    const railLeft = this.currentRailLeft();
    const railRight = this.currentRailRight();
    const railCenter = (railLeft + railRight) / 2;
    // Challenge mode uses a clean base (no score ramp, no wave-phase
    // variance) so each `speed=` token in the DSL means exactly what
    // the designer wrote. The cluster's targetVy is re-applied each
    // frame in update() so gravity can't drive slow waves up to
    // terminal velocity.
    const speed = Math.min(CHALLENGE_MAX_FALL_SPEED, CHALLENGE_BASE_FALL_SPEED * wave.baseSpeedMul);

    let x: number;
    let y: number;
    let vx: number;
    let vy: number;
    let sideEntryFromLeft: boolean | null = null;
    if (angle.sideEntry) {
      const fromLeft = angle.sideEntry === "left" || (angle.sideEntry === "random" && this.rng() < 0.5);
      sideEntryFromLeft = fromLeft;
      const entry = this.computeSideEntry(speed, fromLeft, this.rng);
      x = entry.x;
      y = entry.y;
      vx = entry.vx;
      vy = entry.vy;
    } else {
      x = railCenter + colStep * colWidth;
      y = this.boardOriginY - this.hexSize * 4;
      // Wave-level tilt bias: when `dirRandom` is set, each spawn picks
      // a random angle in [-defaultDir, +defaultDir]; otherwise it's a
      // fixed offset added to the slot's own tilt.
      const dirBias = wave.defaultDirRandom
        ? (this.rng() * 2 - 1) * wave.defaultDir
        : wave.defaultDir;
      const tilt = angle.tilt + (angle.randomTilt ? (this.rng() - 0.5) * angle.randomTilt : 0) + dirBias;
      vx = Math.sin(tilt) * speed;
      vy = Math.cos(tilt) * speed;
    }

    const cluster = this.spawnChallengeCluster(kind, shape, x, y, vx, vy);
    if (cluster && sideEntryFromLeft !== null) {
      // Side-entry clusters launch with a small horizontal velocity and
      // rely on gravity to arc them down into the player's lane. The
      // velocity clamp would otherwise lock vy at the launch value and
      // prevent gravity from acting, so we opt them out.
      cluster.targetVy = null;
      this.sideWarnings.push({ cluster, side: sideEntryFromLeft ? "left" : "right", age: 0, lifetime: 0.7 });
    }
  }

  // Pick a probabilistic kind based on wave weights, then spawn.
  private spawnChallengeProbabilistic(wave: ParsedWave): void {
    const total = Object.values(wave.weights).reduce((a, b) => a + (b ?? 0), 0);
    if (total <= 0) return;
    let r = this.rng() * total;
    let kind: ClusterKind = "normal";
    for (const [k, w] of Object.entries(wave.weights)) {
      const ww = w ?? 0;
      if (ww <= 0) continue;
      if (r < ww) { kind = k as ClusterKind; break; }
      r -= ww;
    }

    // Pickup kinds always single-cell.
    const isPickup = kind === "coin" || kind === "shield" || kind === "drone";
    let shape: Shape;
    if (isPickup) {
      shape = COIN_SHAPE;
    } else {
      const sz = wave.sizeMin + Math.floor(this.rng() * (wave.sizeMax - wave.sizeMin + 1));
      const sizeClamped = wave.walls === "narrow" && sz >= 3 ? 2 : sz;
      shape = buildPolyhexShape(Math.max(1, Math.min(5, sizeClamped)), this.rng);
    }

    // Pick a column avoiding the safe lane for prob spawns.
    const colStep = this.pickSpawnColumn(shape);
    if (colStep === null) return;
    const railLeft = this.currentRailLeft();
    const railRight = this.currentRailRight();
    const railCenter = (railLeft + railRight) / 2;
    const colWidth = SQRT3 * this.hexSize;
    // Challenge mode uses a clean base (no score ramp, no wave-phase
    // variance) so each `speed=` token in the DSL means exactly what
    // the designer wrote. The cluster's targetVy is re-applied each
    // frame in update() so gravity can't drive slow waves up to
    // terminal velocity.
    const speed = Math.min(CHALLENGE_MAX_FALL_SPEED, CHALLENGE_BASE_FALL_SPEED * wave.baseSpeedMul);

    let x: number;
    let y: number;
    let vx: number;
    let vy: number;
    let sideEntryFromLeft: boolean | null = null;
    if (wave.origin === "side") {
      const fromLeft = this.rng() < 0.5;
      sideEntryFromLeft = fromLeft;
      const entry = this.computeSideEntry(speed, fromLeft, this.rng);
      x = entry.x;
      y = entry.y;
      vx = entry.vx;
      vy = entry.vy;
    } else {
      x = railCenter + colStep * colWidth;
      y = this.boardOriginY - this.hexSize * 4;
      // dirRandom: each spawn picks a random tilt in [-defaultDir, +defaultDir].
      // Without it, every probabilistic cluster falls at the same fixed angle.
      const tilt = wave.defaultDirRandom
        ? (this.rng() * 2 - 1) * wave.defaultDir
        : wave.defaultDir;
      vx = Math.sin(tilt) * speed;
      vy = Math.cos(tilt) * speed;
    }
    const cluster = this.spawnChallengeCluster(kind, shape, x, y, vx, vy);
    if (cluster && sideEntryFromLeft !== null) {
      cluster.targetVy = null;
      this.sideWarnings.push({ cluster, side: sideEntryFromLeft ? "left" : "right", age: 0, lifetime: 0.7 });
    }
  }

  // Build a FallingCluster from explicit parameters and add it to the
  // world, mirroring spawnCluster's wiring.
  private spawnChallengeCluster(
    kind: ClusterKind,
    shape: Shape,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): FallingCluster {
    const speed = Math.max(0.5, Math.hypot(vx, vy));
    const cluster = FallingCluster.spawn({
      shape,
      x,
      y,
      hexSize: this.hexSize,
      kind,
      initialSpeedY: speed,
      initialSpin: (this.rng() - 0.5) * 0.08,
    });
    Body.setVelocity(cluster.body, { x: vx, y: vy });
    // Lock the fall velocity so gravity can't accelerate it past the
    // designer's intent. update() re-applies this each step. Side-entry
    // clusters have a horizontal entry vector; we lock |total| so the
    // angle stays as designed and the cluster doesn't slow down mid-air.
    cluster.targetVy = vy;
    cluster.body.collisionFilter.category = CAT_CLUSTER;
    cluster.body.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    for (let i = 1; i < cluster.body.parts.length; i++) {
      cluster.body.parts[i]!.collisionFilter.category = CAT_CLUSTER;
      cluster.body.parts[i]!.collisionFilter.mask = CAT_PLAYER | CAT_CLUSTER | CAT_DRONE;
    }
    if (!this.seenKinds.has(kind)) {
      cluster.hintLabel = kindLabel(kind);
      this.seenKinds.add(kind);
      saveSeenHints(this.seenKinds);
    }
    this.clusters.push(cluster);
    this.clusterByBodyId.set(cluster.body.id, cluster);
    Composite.add(this.engine.world, cluster.body);
    return cluster;
  }

  private updateChallengeFinishing(dt: number): void {
    if (this.gameMode !== "challenge") return;
    if (this.challengeFinishingHold <= 0) return;
    if (this.activeChallenge === null) return;
    if (this.challengeWaveIdx < this.activeChallenge.waves.length) return;
    // Wait until every cluster has either passed the player (scored), been
    // hit (contacted), or fallen off the screen. This means the last block
    // visibly clears the player line before victory fires.
    const stillPending = this.clusters.some(
      (c) => c.alive && !c.scored && !c.contacted,
    );
    if (stillPending) return;
    // Last block is past. Bank any pending FAST/BIG bonus pool and end
    // the matching effect so the player isn't watching the HUD countdown
    // drain in real time before completion.
    if (this.timeEffect === "fast") {
      this.awardFastBonus();
      this.timeEffect = null;
      this.timeEffectTimer = 0;
      this.timeScale = 1;
    } else if (this.timeEffect === "slow") {
      this.timeEffect = null;
      this.timeEffectTimer = 0;
      this.timeScale = 1;
    }
    if (this.bigTimer > 0) {
      this.awardBigBonus();
      this.bigTimer = 0;
      this.bigLevel = 0;
      this.bigMax = 1;
      this.updatePlayerScaleTarget();
    }
    this.challengeFinishingHold -= dt;
    if (this.challengeFinishingHold <= 0) {
      this.completeChallenge();
    }
  }

  private completeChallenge(): void {
    const def = this.activeChallenge;
    if (!def) return;
    // +20 completion bonus.
    this.score += 20;
    this.scoreEl.textContent = String(this.score);
    this.spawnFloater(
      "+20",
      this.boardOriginX + this.boardWidth / 2,
      this.boardOriginY + this.boardHeight * 0.4,
      "#9bf0c2",
      "rgba(120, 255, 170, 0.95)",
    );

    // Custom challenges save into hexrain.customChallenges.v1 (their own
    // best/stars), bypassing the roster progress key entirely. Achievement
    // checks only fire for roster challenges — earning a Block badge from
    // a player-authored level would be misleading.
    if (isCustomChallenge(def)) {
      // For custom challenges the per-challenge stars come from the
      // user-editable thresholds rather than computeStarThresholds.
      const custom = getCustomChallenge(def.id);
      let stars: 0 | 1 | 2 | 3 = 0;
      if (custom) {
        if (this.score >= custom.stars.three) stars = 3;
        else if (this.score >= custom.stars.two) stars = 2;
        else if (this.score >= custom.stars.one) stars = 1;
      }
      saveCustomChallengeRun(def.id, this.score, 1, stars);
      // Community: if this is an installed challenge, fire the score off
      // to the per-challenge leaderboard (best per player; submit only
      // upserts when the new score is higher).
      if (custom?.installedFrom) {
        void submitCommunityScore(
          custom.installedFrom,
          getGameCenterDisplayName() ?? "Anonymous",
          this.score,
          1,
        );
      }
      this.state = "challengeComplete";
      this.setPauseButtonVisible(false);
      stopMusic();
      this.renderChallengeComplete([]);
      return;
    }

    const beforeUnlocked = new Set(loadChallengeProgress().unlockedBlocks);
    const thresholds = computeStarThresholds(def);
    const stars = awardStars(this.score, thresholds);
    const progress = saveChallengeCompletion(def.id, this.score, stars);
    // Newly-unlocked blocks (only computed once, when the save flips the
    // 3-of-5 threshold over). Forwarded to the complete screen for the
    // "BLOCK N UNLOCKED" celebration banner.
    const newlyUnlocked = progress.unlockedBlocks.filter((b) => !beforeUnlocked.has(b));
    // Block completion → achievement.
    const block = def.block;
    const allInBlockDone = CHALLENGES
      .filter((c) => c.block === block)
      .every((c) => progress.completed.includes(c.id));
    if (allInBlockDone) {
      const achId = ([
        ACHIEVEMENTS.challengeBlock1,
        ACHIEVEMENTS.challengeBlock2,
        ACHIEVEMENTS.challengeBlock3,
        ACHIEVEMENTS.challengeBlock4,
        ACHIEVEMENTS.challengeBlock5,
        ACHIEVEMENTS.challengeBlock6,
      ] as const)[block - 1];
      if (achId) this.awardAchievement(achId);
    }

    this.state = "challengeComplete";
    this.setPauseButtonVisible(false);
    stopMusic();
    this.renderChallengeComplete(newlyUnlocked);
  }

  // Called from death path to bank a partial-run best score + best-pct.
  private endChallengeRun(): void {
    const def = this.activeChallenge;
    if (!def) return;
    if (isCustomChallenge(def)) {
      saveCustomChallengeRun(def.id, this.score, this.progress, 0);
      const custom = getCustomChallenge(def.id);
      if (custom?.installedFrom) {
        void submitCommunityScore(
          custom.installedFrom,
          getGameCenterDisplayName() ?? "Anonymous",
          this.score,
          this.progress,
        );
      }
      return;
    }
    saveChallengeBest(def.id, this.score, this.progress);
  }

  // ----- Wave / difficulty system -----

  private waveParams() {
    return computeWaveParams(this.score, this.cfg().spawnIntervalMul);
  }

  private currentSpawnInterval(): number {
    const p = this.waveParams();
    if (this.wavePhase === "wave" && this.swarmWave) return SWARM_SPAWN_INTERVAL;
    return this.wavePhase === "wave" ? p.waveSpawnInterval : p.calmSpawnInterval;
  }

  // Shared side-entry physics for both endless and challenge spawns. We
  // launch nearly horizontally at a fraction of the fall speed so gravity
  // has time to arc the cluster down into the player's lane, instead of
  // the previous "shoots across the board in a flash" behaviour.
  // Caller is responsible for clearing targetVy (challenge mode) so the
  // velocity clamp doesn't lock vy and prevent gravity from acting.
  private computeSideEntry(
    baseSpeed: number,
    fromLeft: boolean,
    rng: () => number,
  ): { x: number; y: number; vx: number; vy: number } {
    const halfBoard = this.boardHeight * 0.5;
    const yMin = this.hexSize * 2;
    const yMax = Math.max(yMin + this.hexSize, halfBoard - this.hexSize);
    const y = this.boardOriginY + yMin + rng() * (yMax - yMin);
    const sideAngle = 0.05 + rng() * 0.1; // nearly horizontal; gravity arcs them
    const total = baseSpeed * 0.2;
    const x = fromLeft
      ? this.boardOriginX - this.hexSize * 1.2
      : this.boardOriginX + this.boardWidth + this.hexSize * 1.2;
    const vx = (fromLeft ? 1 : -1) * Math.cos(sideAngle) * total;
    const vy = Math.sin(sideAngle) * total;
    return { x, y, vx, vy };
  }

  private computeFallSpeed(): number {
    // Difficulty scales the starting velocity but not the per-score ramp,
    // so easy/hard read as a different "starting pace" that converges
    // toward the same late-game pressure.
    const base = Math.min(
      MAX_FALL_SPEED,
      BASE_FALL_SPEED * this.cfg().fallSpeedMul + this.score * SPEED_RAMP,
    );
    if (this.wavePhase === "wave") {
      // Each cluster picks its own speed within ±30% of the wave-multiplier
      // baseline so the wave feels chaotic rather than uniform.
      const variance = this.swarmWave
        ? 0.6 + Math.random() * 0.9 // wider spread during a swarm
        : 0.7 + Math.random() * 0.6;
      return Math.min(MAX_FALL_SPEED * 1.7, base * this.waveParams().waveSpeedMul * variance);
    }
    return base;
  }

  // Score-driven cadence math lives in src/spawn.ts (Phase 1.5);
  // this is a thin forwarder so call sites stay short.
  private lateGameSpeedMul(): number {
    return lateGameSpeedMul(this.score);
  }

  private advanceWavePhase(dt: number): void {
    this.wavePhaseTimer += dt;
    const p = this.waveParams();
    if (this.wavePhase === "calm" && this.wavePhaseTimer >= p.calmDuration) {
      this.startWave();
    } else if (this.wavePhase === "wave" && this.wavePhaseTimer >= p.waveDuration) {
      this.startCalm();
    }
  }

  private startWave(): void {
    this.wavePhase = "wave";
    this.wavePhaseTimer = 0;
    // Decide whether this is a single-hex swarm wave for variety.
    this.swarmWave = Math.random() < SWARM_WAVE_CHANCE;
    // Pick a fresh safe column. Swarm waves still respect this.
    const half = Math.floor(BOARD_COLS / 2);
    this.safeColumn = Math.floor(Math.random() * (half * 2 + 1)) - half;
    // Late game: half of waves narrow the play area. Hard kicks this in
    // earlier (200) than easy/medium (600).
    this.chooseWallForEndlessWave();
  }

  private startCalm(): void {
    this.wavePhase = "calm";
    this.wavePhaseTimer = 0;
    this.swarmWave = false;
    this.setWall("none", 0);
  }

  private loadDifficulty(): Difficulty {
    const v = loadString(DIFFICULTY_STORAGE_KEY, "");
    if (v === "easy" || v === "medium" || v === "hard" || v === "hardcore") {
      // Defensive: drop hardcore back to medium if the player loaded it
      // last session and has since lost the unlock (e.g. a new install
      // syncing localStorage from a cloud backup).
      if (v === "hardcore" && !this.isHardcoreUnlocked()) return DIFFICULTY_DEFAULT;
      return v;
    }
    return DIFFICULTY_DEFAULT;
  }

  private loadBestFor(d: Difficulty): number {
    return Number(loadString(HIGH_SCORE_KEY_PREFIX + d, "0")) || 0;
  }

  private saveBestFor(d: Difficulty, best: number): void {
    saveString(HIGH_SCORE_KEY_PREFIX + d, String(best));
  }

  // Hardcore mode is locked until the player either scores HARDCORE_THRESHOLD
  // on hard or buys the unlock-everything IAP. We snapshot the org-unlock
  // path in localStorage so it survives across runs without a re-derivation.
  // ?debug=1 also opens it so test sessions can pick PAINFUL without grinding.
  private isHardcoreUnlocked(): boolean {
    if (this.debugEnabled) return true;
    if (loadBool(HARDCORE_UNLOCK_KEY, false)) return true;
    return loadChallengeProgress().purchasedUnlock;
  }

  private grantHardcoreUnlock(): void {
    if (loadBool(HARDCORE_UNLOCK_KEY, false)) return;
    saveBool(HARDCORE_UNLOCK_KEY, true);
  }

  // Called from the score-update path during a hard run. Cheap — just a
  // string compare + threshold check until the unlock fires once.
  private maybeUnlockHardcore(): void {
    if (this.debugEnabled) return; // debug runs don't dirty real unlock state
    if (this.difficulty !== "hard") return;
    if (this.score < HARDCORE_UNLOCK_SCORE) return;
    if (loadBool(HARDCORE_UNLOCK_KEY, false)) return;
    this.grantHardcoreUnlock();
    // Floater so the moment is visible mid-run.
    this.spawnFloater(
      "PAINFUL UNLOCKED",
      this.boardOriginX + this.boardWidth / 2,
      this.boardOriginY + this.boardHeight * 0.35,
      "#ff7a4a",
      "rgba(255, 140, 80, 0.95)",
    );
  }

  // The active difficulty's tunable bundle.
  private cfg(): DifficultyConfig {
    return DIFFICULTY_CONFIG[this.difficulty];
  }

  // Danger threshold: the player size at which the red glow appears
  // and a blue hit becomes lethal. Custom challenges can override the
  // per-difficulty value via effects.dangerSize so authors can tune
  // the failure margin per challenge.
  private dangerSize(): number {
    const override = this.effectOverrides?.dangerSize;
    if (typeof override === "number" && override > 0) return override;
    return this.cfg().dangerSize;
  }

  private setDifficulty(d: Difficulty): void {
    if (d === this.difficulty) return;
    this.difficulty = d;
    saveString(DIFFICULTY_STORAGE_KEY, d);
    this.best = this.loadBestFor(d);
    this.bestEl.textContent = String(this.best);
    // The gameover overlay bakes "Best {n}" into its innerHTML; re-render
    // so it picks up the new difficulty's high score without the player
    // having to play and die again to see it update.
    if (this.state === "gameover") this.renderGameOver();
    else this.refreshDifficultyButtons();
  }

  private refreshDifficultyButtons(): void {
    const host = document.getElementById("difficultyButtons");
    if (!host) return;
    const hardcoreUnlocked = this.isHardcoreUnlocked();
    for (const btn of Array.from(host.querySelectorAll<HTMLButtonElement>("button[data-difficulty]"))) {
      const value = btn.dataset.difficulty as Difficulty | undefined;
      btn.classList.toggle("active", value === this.difficulty);
      btn.setAttribute("aria-pressed", value === this.difficulty ? "true" : "false");
      // Locked HARDCORE button: visually distinct + clickthrough routes
      // to the unlock-everything screen instead of selecting the difficulty.
      const locked = value === "hardcore" && !hardcoreUnlocked;
      btn.classList.toggle("locked", locked);
      btn.setAttribute("aria-disabled", locked ? "true" : "false");
    }
  }

  // Inner left/right edges of the play area, accounting for the animated
  // pinch / zigzag / narrow when active.
  currentRailLeft(yWorld?: number): number {
    return this.boardOriginX + this.wallInsetAt(yWorld).left;
  }
  currentRailRight(yWorld?: number): number {
    return this.boardOriginX + this.boardWidth - this.wallInsetAt(yWorld).right;
  }

  // Most restrictive rail bounds across the player's vertical extent.
  // Critical for zigzag, where the wall's sine bulge at one y can be
  // tighter than at playerY — sampling only at playerY would let the
  // wall visually push the player's body even though the bottom rail
  // looks clear (or vice versa). Pinch / narrow are y-independent so
  // this collapses to a single sample for them.
  private playerRailBounds(): { left: number; right: number } {
    const top = this.player.body.bounds.min.y;
    const bot = Math.max(top, this.player.body.bounds.max.y);
    if (this.wall.kind !== "zigzag") {
      const inset = this.wallInsetAt(this.playerY);
      return {
        left: this.boardOriginX + inset.left,
        right: this.boardOriginX + this.boardWidth - inset.right,
      };
    }
    const STEPS = 5;
    let left = -Infinity;
    let right = Infinity;
    for (let i = 0; i <= STEPS; i++) {
      const y = top + ((bot - top) * i) / STEPS;
      const inset = this.wallInsetAt(y);
      const l = this.boardOriginX + inset.left;
      const r = this.boardOriginX + this.boardWidth - inset.right;
      if (l > left) left = l;
      if (r < right) right = r;
    }
    return { left, right };
  }

  // Single source of truth for how far the active wall reaches in from
  // each side at world y. Pinch and narrow are y-independent; zigzag's
  // inset varies sinusoidally with y to make the corridor slant.
  // Set wall kind + target. To get smooth ease-out followed by ease-in
  // and a pre-arrival warning flash, we never snap the kind in:
  //   1. If kind matches current and the wall is up, just update target.
  //   2. If kind is "none", retract.
  //   3. Otherwise: retract the current wall first, queue the new kind,
  //      then once retraction completes the update loop fires a 1-second
  //      warning flash before the new wall starts lerping in.
  // Per-frame wall lerp + queued-kind transition. Shared by the live
  // play loop and the editor wave-preview loop so wall changes during
  // preview animate the same way they do in-game.
  private tickWalls(dt: number): void {
    const wallLerp = 1 - Math.exp(-dt * 4);
    this.wall.amount += (this.wall.amountTarget - this.wall.amount) * wallLerp;
    if (this.wall.kind === "zigzag") this.wall.phase += dt;
    if (this.wall.warningT > 0) {
      this.wall.warningT = Math.max(0, this.wall.warningT - dt);
      if (this.wall.warningT === 0 && this.wall.postWarningAmount > 0) {
        this.wall.amountTarget = this.wall.postWarningAmount;
        this.wall.postWarningAmount = 0;
      }
    }
    if (this.wall.pushHoldT > 0) {
      this.wall.pushHoldT = Math.max(0, this.wall.pushHoldT - dt);
      if (this.wall.pushHoldT === 0) this.wall.pushDir = 0;
    }
    // Once the current wall has retracted, either apply the queued
    // kind (which kicks off the warning + lerp-in cycle) or settle
    // back to "none".
    if (this.wall.amount < 0.01 && this.wall.amountTarget === 0 && this.wall.warningT === 0) {
      if (this.wall.pendingKind !== null) {
        this.wall.kind = this.wall.pendingKind;
        this.wall.amp = this.wall.pendingAmp;
        this.wall.period = this.wall.pendingPeriod;
        this.wall.warningT = 1.0;
        this.wall.warningKind = this.wall.pendingKind;
        this.wall.pendingKind = null;
      } else if (this.wall.kind !== "none" && this.wall.postWarningAmount === 0) {
        this.wall.kind = "none";
      }
    }
  }

  private setWall(kind: WallKind, amount: number, ampPeriod?: { amp: number; period: number }): void {
    const amp = ampPeriod?.amp ?? 0.18;
    const period = ampPeriod?.period ?? 1.4;
    if (kind === this.wall.kind && kind !== "none") {
      // Same kind already up — just update the target instantly.
      this.wall.amountTarget = amount;
      this.wall.amp = amp;
      this.wall.period = period;
      this.wall.pendingKind = null;
      this.wall.postWarningAmount = 0;
      this.wall.warningT = 0;
      return;
    }
    if (kind === "none") {
      this.wall.amountTarget = 0;
      this.wall.pendingKind = null;
      this.wall.postWarningAmount = 0;
      this.wall.warningT = 0;
      this.wall.pushHoldT = 0;
      this.wall.pushDir = 0;
      return;
    }
    // New non-none kind. Hold target at 0 (retract first if needed) and
    // queue the kind + warning. The update loop will apply pendingKind
    // once amount<0.01, fire the warning, and finally set amountTarget.
    this.wall.amountTarget = 0;
    this.wall.pendingKind = kind;
    this.wall.pendingAmp = amp;
    this.wall.pendingPeriod = period;
    this.wall.postWarningAmount = amount;
    // If already retracted, switch kind + start the warning right now.
    if (this.wall.amount < 0.01) {
      this.wall.kind = kind;
      this.wall.amp = amp;
      this.wall.period = period;
      this.wall.warningT = 1.0;
      this.wall.warningKind = kind;
      this.wall.pendingKind = null;
    }
  }

  // Pick a wall kind for an endless wave based on score.
  // narrow > zigzag > pinch > none. Mutually exclusive.
  private chooseWallForEndlessWave(): void {
    const r = Math.random();
    const cfg = this.cfg();
    if (this.score >= cfg.narrowScore && r < 0.40) {
      this.setWall("narrow", 1.0);
    } else if (this.score >= cfg.zigzagScore && r < 0.40) {
      this.setWall("zigzag", 1.0);
    } else if (this.score >= cfg.narrowingScore && r < 0.50) {
      this.setWall("pinch", 1.0);
    } else {
      this.setWall("none", 0);
    }
  }

  // Draw the active wall slabs into the play area.
  // Draw the vertical challenge-progress strip at the left edge of the
  // play area. Fills bottom-up; tick marks per wave boundary; brief pulse
  // on each wave increment.
  // Subtle flashing line on the play-area edge marking where a side-
  // entry cluster is about to come in. Tracks the cluster body's
  // current y so the flash sits exactly at the entry point even as
  // gravity bends the trajectory between spawn and on-screen entry.
  private drawSideWarnings(ctx: CanvasRenderingContext2D): void {
    const heightHalf = this.hexSize * 1.2;
    for (const sw of this.sideWarnings) {
      const lifeT = sw.age / sw.lifetime;
      const fadeIn = Math.min(1, lifeT / 0.1);
      const fadeOut = lifeT > 0.7 ? 1 - (lifeT - 0.7) / 0.3 : 1;
      const env = Math.max(0, fadeIn * fadeOut);
      const blink = 0.4 + 0.6 * (Math.sin(sw.age * Math.PI * 16) > 0 ? 1 : 0);
      const alpha = env * blink;
      const y = sw.cluster.body.position.y;
      const x = sw.side === "left" ? this.boardOriginX : this.boardOriginX + this.boardWidth - 2;
      ctx.fillStyle = `rgba(255, 230, 140, ${0.9 * alpha})`;
      ctx.fillRect(x, y - heightHalf, 2, heightHalf * 2);
    }
  }

  private drawChallengeProgress(ctx: CanvasRenderingContext2D): void {
    const def = this.activeChallenge;
    if (!def) return;
    const baseW = 8;
    const w = baseW + (this.waveBumpT > 0 ? 6 * this.waveBumpT * 5 : 0);
    // Inset from the top so the curved corners on modern iPhones (and
    // the dynamic island row) don't clip the top of the bar. The
    // existing `topInset` already places content below the HUD,
    // which clears the corner curve. Add a small extra gap for the
    // percent label that sits above the left bar.
    const y0 = this.boardOriginY + this.topInset + 12;
    const h = this.boardHeight - (y0 - this.boardOriginY) - 4;
    // Hug the viewport edges so the bars feel like a frame around the
    // canvas. canvas.width is dpr-scaled; cssWidth is what our render
    // coords use after setTransform(dpr,...).
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.width / dpr;
    const xLeft = 4;
    const xRight = cssWidth - baseW - 4;
    // Both bars at full alpha so the screen reads as a symmetric
    // pair of progress columns rather than a primary + faded mirror.
    this.drawProgressBar(ctx, xLeft, y0, w, h, def.waves.length, 1.0);
    this.drawProgressBar(ctx, xRight, y0, w, h, def.waves.length, 1.0);
  }

  private drawProgressBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y0: number,
    w: number,
    h: number,
    totalWaves: number,
    alpha: number,
  ): void {
    ctx.fillStyle = `rgba(255,255,255,${0.12 * alpha})`;
    ctx.fillRect(x, y0, w, h);
    ctx.strokeStyle = `rgba(127, 232, 156, ${0.55 * alpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y0 + 0.5, w - 1, h - 1);
    const fill = h * Math.min(1, Math.max(0, this.progressDisplayed));
    const grad = ctx.createLinearGradient(x, y0 + h - fill, x, y0 + h);
    grad.addColorStop(0, `rgba(164, 255, 195, ${alpha})`);
    grad.addColorStop(1, `rgba(63, 200, 115, ${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y0 + h - fill, w, fill);
    if (totalWaves > 0) {
      ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
      for (let i = 1; i < totalWaves; i++) {
        const ty = y0 + h - h * (i / totalWaves);
        ctx.fillRect(x, ty - 0.5, w, 1);
      }
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D): void {
    // Pre-arrival warning: blinking line on each play-area edge for one
    // full second before the wall starts moving in. Color varies by
    // upcoming wall kind so the warning telegraphs which type is coming.
    if (this.wall.warningT > 0) {
      const t = this.wall.warningT;
      const blink = Math.sin(t * Math.PI * 14) > 0 ? 1 : 0.2;
      const alpha = blink * (t < 0.15 ? t / 0.15 : 1); // soft trail-off as warning ends
      const rgb =
        this.wall.warningKind === "narrow" ? "255, 80, 90"
        : this.wall.warningKind === "zigzag" ? "220, 170, 255"
        : "255, 130, 140";
      ctx.fillStyle = `rgba(${rgb}, ${0.85 * alpha})`;
      ctx.fillRect(this.boardOriginX, this.boardOriginY, 3, this.boardHeight);
      ctx.fillRect(
        this.boardOriginX + this.boardWidth - 3,
        this.boardOriginY,
        3,
        this.boardHeight,
      );
    }
    if (this.wall.amount < 0.01) return;
    const x0 = this.boardOriginX;
    const y0 = this.boardOriginY;
    const w = this.boardWidth;
    const h = this.boardHeight;
    const tints =
      this.wall.kind === "narrow"
        ? { fill: "rgba(220, 80, 90, 0.16)", edge: "rgba(255, 130, 140, 0.65)" }
        : this.wall.kind === "zigzag"
          ? { fill: "rgba(170, 120, 200, 0.14)", edge: "rgba(220, 170, 255, 0.55)" }
          : { fill: "rgba(180, 100, 110, 0.12)", edge: "rgba(255, 120, 130, 0.55)" };
    if (this.wall.kind === "zigzag") {
      // Trace polygons that follow wallInsetAt(y) along the board height.
      const STEPS = 24;
      const leftPts: Array<{ x: number; y: number }> = [];
      const rightPts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= STEPS; i++) {
        const y = y0 + (h * i) / STEPS;
        const inset = this.wallInsetAt(y);
        leftPts.push({ x: x0 + inset.left, y });
        rightPts.push({ x: x0 + w - inset.right, y });
      }
      ctx.fillStyle = tints.fill;
      // Left slab
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (const p of leftPts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(x0, y0 + h);
      ctx.closePath();
      ctx.fill();
      // Right slab
      ctx.beginPath();
      ctx.moveTo(x0 + w, y0);
      for (const p of rightPts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(x0 + w, y0 + h);
      ctx.closePath();
      ctx.fill();
      // Edges
      ctx.strokeStyle = tints.edge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < leftPts.length; i++) {
        const p = leftPts[i];
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < rightPts.length; i++) {
        const p = rightPts[i];
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      return;
    }
    // pinch / narrow: rectangular slabs.
    const inset = this.wallInsetAt(y0).left;
    ctx.fillStyle = tints.fill;
    ctx.fillRect(x0, y0, inset, h);
    ctx.fillRect(x0 + w - inset, y0, inset, h);
    ctx.strokeStyle = tints.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + inset, y0);
    ctx.lineTo(x0 + inset, y0 + h);
    ctx.moveTo(x0 + w - inset, y0);
    ctx.lineTo(x0 + w - inset, y0 + h);
    ctx.stroke();
  }

  // Effect-duration helpers. Honor the active challenge's overrides
  // when set, otherwise fall back to the difficulty-multiplied defaults.
  // Per-effect duration multipliers (slow/fast/shield/drone) override
  // the global effectDurationMul when present — used by hardcore to
  // stretch fast while shrinking shields and drones.
  private slowDuration(): number {
    const c = this.cfg();
    return this.effectOverrides?.slowDuration ?? SLOW_EFFECT_DURATION * (c.slowDurationMul ?? c.effectDurationMul);
  }
  private fastDuration(): number {
    const c = this.cfg();
    return this.effectOverrides?.fastDuration ?? FAST_EFFECT_DURATION * (c.fastDurationMul ?? c.effectDurationMul);
  }
  private shieldDuration(): number {
    const c = this.cfg();
    return this.effectOverrides?.shieldDuration ?? SHIELD_DURATION * (c.shieldDurationMul ?? c.effectDurationMul);
  }
  private droneDuration(): number {
    const c = this.cfg();
    return this.effectOverrides?.droneDuration ?? DRONE_DURATION * (c.droneDurationMul ?? c.effectDurationMul);
  }
  private tinyDuration(): number {
    const c = this.cfg();
    return this.effectOverrides?.tinyDuration ?? TINY_DURATION * (c.tinyDurationMul ?? c.effectDurationMul);
  }
  private bigDuration(): number {
    const c = this.cfg();
    return this.effectOverrides?.bigDuration ?? BIG_DURATION * (c.bigDurationMul ?? c.effectDurationMul);
  }
  private bigSizeScale(): number {
    if (this.bigLevel <= 0) return 1;
    return BIG_SIZE_BASE + (this.bigLevel - 1) * BIG_SIZE_STEP;
  }
  private bigMultiplier(): number {
    if (this.bigLevel <= 0) return 1;
    return BIG_MULTIPLIER_BASE + (this.bigLevel - 1) * BIG_MULTIPLIER_STEP;
  }
  private updatePlayerScaleTarget(): void {
    const tinyFactor = this.tinyTimer > 0 ? TINY_PLAYER_SCALE : 1;
    const bigFactor = this.bigTimer > 0 ? this.bigSizeScale() : 1;
    this.playerHexScaleTarget = tinyFactor * bigFactor;
  }
  private animatePlayerScale(dt: number): void {
    const target = this.playerHexScaleTarget;
    const k = 1 - Math.exp(-dt * PLAYER_SCALE_RATE);
    const next = this.playerHexScale + (target - this.playerHexScale) * k;
    // Snap when essentially at target to avoid endless tiny rebuilds.
    const snapped = Math.abs(next - target) < 0.002 ? target : next;
    if (Math.abs(snapped - this.playerHexScale) >= 0.002 || snapped !== this.playerHexScale) {
      this.playerHexScale = snapped;
      this.player.setHexSize(this.hexSize * this.playerHexScale);
    }
  }

  // Single source of truth for wall inset geometry. Pinch (0.36) and
  // narrow (0.42) are y-independent; zigzag oscillates around a 0.18
  // base by ±amp so corridor width stays roughly constant.
  private computeWallInset(
    kind: WallKind,
    amount: number,
    amp: number,
    period: number,
    phase: number,
    yWorld?: number,
  ): { left: number; right: number } {
    if (kind === "none" || amount < 0.01) return { left: 0, right: 0 };
    const halfBoard = this.boardWidth * 0.5;
    if (kind === "pinch") {
      const inset = amount * halfBoard * 0.36;
      return { left: inset, right: inset };
    }
    if (kind === "narrow") {
      const inset = amount * halfBoard * 0.42;
      return { left: inset, right: inset };
    }
    if (kind === "zigzag") {
      const baseInset = amount * halfBoard * 0.18;
      const y = yWorld ?? (this.boardOriginY + this.boardHeight * 0.5);
      const norm = (y - this.boardOriginY) / Math.max(1, this.boardHeight);
      const ampPx = amount * halfBoard * amp;
      const arg = 2 * Math.PI * (norm * 1.5 + phase / Math.max(0.1, period));
      const offset = Math.sin(arg) * ampPx;
      return { left: baseInset + offset, right: baseInset - offset };
    }
    return { left: 0, right: 0 };
  }

  private wallInsetAt(yWorld?: number): { left: number; right: number } {
    return this.computeWallInset(
      this.wall.kind,
      this.wall.amount,
      this.wall.amp,
      this.wall.period,
      this.wall.phase,
      yWorld,
    );
  }

  // Worst-case inset px once the wall finishes its current animation:
  // takes the eventual kind (pendingKind if a transition is queued),
  // its eventual amp, and the largest amount it'll reach (current,
  // target, or postWarningAmount). Used by spawn placement so blocks
  // chosen while a wall is animating in still land inside the corridor.
  // Zigzag's per-side oscillation peaks at base + amp on whichever
  // side the sine is currently swinging toward, so we report that
  // worst-case as a scalar.
  private projectedWallInsetPx(): number {
    const usePending = this.wall.pendingKind !== null;
    const kind: WallKind = usePending ? this.wall.pendingKind! : this.wall.kind;
    const amp = usePending ? this.wall.pendingAmp : this.wall.amp;
    const period = usePending ? this.wall.pendingPeriod : this.wall.period;
    const amount = Math.max(
      this.wall.amount,
      this.wall.amountTarget,
      this.wall.postWarningAmount,
    );
    // For zigzag the peak side hits base+amp; force the sine to its
    // crest by passing phase such that the argument lands at π/2.
    const phase =
      kind === "zigzag" ? 0.25 * Math.max(0.1, period) : this.wall.phase;
    const inset = this.computeWallInset(kind, amount, amp, period, phase, this.boardOriginY);
    return Math.max(inset.left, inset.right);
  }

  private shapeColumnFootprint(shape: Shape): { min: number; max: number } {
    let minC = Infinity;
    let maxC = -Infinity;
    for (const c of shape) {
      // Pointy-top: a cell's column index is q + r/2 (rounded).
      const col = Math.round(c.q + c.r / 2);
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
    }
    return { min: minC, max: maxC };
  }

  private pickSpawnColumn(shape: Shape): number | null {
    // The available columns shrink with the wall inset, so spawns stay inside the
    // narrowed area when active.
    const halfFull = Math.floor(BOARD_COLS / 2);
    // Approximate the active half-width in "column units" using the inset
    // at the spawn y (top of board). Pinch and narrow are y-independent;
    // zigzag varies with y but spawning is at the top so this is fine.
    const colWidth = SQRT3 * this.hexSize;
    // Use the *projected* inset (where the wall will be once its
    // current lerp settles) so spawns picked during the wall-in
    // animation don't land outside the eventual corridor.
    const insetCols = this.projectedWallInsetPx() / Math.max(1, colWidth);
    const halfActive = Math.max(1, Math.floor(halfFull - insetCols));
    const fp = this.shapeColumnFootprint(shape);
    const all: number[] = [];
    for (let c = -halfActive; c <= halfActive; c++) all.push(c);

    // Endless mode only enforces the safe column during a "wave" phase
    // (calm spawns are unrestricted). Challenge mode never advances the
    // wave/calm machine, so we enforce whenever a safeCol= was pinned;
    // unset waves leave `safeColumn` at the out-of-range sentinel (99)
    // and the predicate becomes a no-op.
    const enforce = this.gameMode === "challenge" || this.wavePhase === "wave";
    const valid = enforce
      ? all.filter((colStep) => {
          const lo = colStep + fp.min;
          const hi = colStep + fp.max;
          return this.safeColumn < lo || this.safeColumn > hi;
        })
      : all;

    if (valid.length === 0) return null;
    return valid[Math.floor(this.rng() * valid.length)]!;
  }

  // ----- end wave system -----

  private endGame(): void {
    this.state = "gameover";
    this.setPauseButtonVisible(false);
    this.resumeCountdown = 0;
    playSfx("gameover");
    stopMusic();
    if (this.gameMode === "challenge") {
      // Challenge runs bank into per-challenge best, not the endless leaderboard.
      this.endChallengeRun();
    } else if (!this.debugRun && this.score > this.best) {
      // Don't bank a new high score for runs that started above 0 — those
      // are debug "skip-ahead" runs and the score isn't earned cleanly.
      this.best = this.score;
      this.saveBestFor(this.difficulty, this.best);
      this.bestEl.textContent = String(this.best);
    }
    if (this.gameMode === "endless" && !this.debugRun) trackPlayEnd(this.difficulty, this.score);
    if (this.gameMode === "endless") void gcSubmitScore(this.score, this.difficulty);
    // Scatter the player blob into debris so the wreckage tumbles behind the
    // game-over screen. The player body itself is removed from the world so
    // it doesn't keep being clamped to the rail.
    const com = this.player.body.position;
    for (const cell of this.player.cells.slice()) {
      const wp = this.player.cellWorldCenter(cell);
      const dx = wp.x - com.x;
      const dy = wp.y - com.y;
      const radial = Math.hypot(dx, dy);
      const ux = radial > 0.001 ? dx / radial : (Math.random() - 0.5);
      const uy = radial > 0.001 ? dy / radial : (Math.random() - 0.5);
      this.spawnDebris({
        x: wp.x,
        y: wp.y,
        angle: this.player.body.angle,
        velocity: this.player.body.velocity,
        angularVelocity: this.player.body.angularVelocity,
        impulse: {
          x: ux * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
          y: uy * (3 + Math.random() * 4) - 2 - Math.random() * 4,
        },
        kind: "normal",
      });
    }
    // Drop any sticks-in-flight onto the wreckage as debris — the player
    // they were homing toward is about to disappear.
    for (const s of this.sticksInFlight) {
      this.spawnDebris({
        x: s.body.position.x,
        y: s.body.position.y,
        angle: s.body.angle,
        velocity: s.body.velocity,
        angularVelocity: s.body.angularVelocity,
        impulse: {
          x: (Math.random() - 0.5) * 4,
          y: -2 - Math.random() * 2,
        },
        kind: "normal",
      });
      Composite.remove(this.engine.world, s.body);
    }
    this.sticksInFlight = [];

    Composite.remove(this.engine.world, this.player.body);


    this.renderGameOver();
  }

  private checkScoreMilestones(): void {
    // Challenge mode runs are not eligible for the standard score-tier
    // achievements — challenge scoring is per-challenge, not stacked
    // against the endless leaderboard.
    if (this.gameMode === "challenge") return;
    const milestones = SCORE_MILESTONES_BY_DIFFICULTY[this.difficulty];
    const { nextIdx, awarded } = stepMilestones(this.score, milestones, this.nextMilestoneIdx);
    for (const id of awarded) this.awardAchievement(id as AchievementId);
    this.nextMilestoneIdx = nextIdx;
    // Hardcore organic unlock: scoring HARDCORE_UNLOCK_SCORE on hard
    // grants the difficulty for future runs.
    this.maybeUnlockHardcore();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);

    // iOS WKWebView occasionally reports a stale, ~quarter-sized layout
    // during the brief foreground restore from the app switcher. If we
    // accept that reading we end up locked to a tiny play area until the
    // next manual resize. Bail out if the canvas reports a width well
    // under its own parent's width (which represents the laid-out CSS
    // box, not the full document — desktop browsers have a much wider
    // document than #app's 540px clamp).
    const parent = this.canvas.parentElement;
    if (parent) {
      const parentW = parent.getBoundingClientRect().width;
      if (parentW > 1 && cssW < parentW * 0.5) {
        return;
      }
    }

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The play area is the full canvas — the HUD bar and the touchbar live
    // in sibling elements above and below, so this canvas is exclusively
    // game space. Pick hexSize so BOARD_COLS columns fit the full width
    // exactly; height is whatever the canvas gives us.
    //
    // In challenge mode we reserve a small margin on each side for the
    // vertical progress bars so they don't paint on top of falling clusters.
    const sideInset = this.gameMode === "challenge" ? PROGRESS_BAR_RESERVE : 0;
    const usableW = Math.max(1, cssW - sideInset * 2);
    const colWidthFor = (size: number) => SQRT3 * size;
    this.hexSize = Math.max(10, usableW / (colWidthFor(1) * BOARD_COLS));

    this.boardWidth = usableW;
    this.boardHeight = cssH;
    this.boardOriginX = sideInset;
    this.boardOriginY = 0;

    // Measure the HUD's bottom edge in canvas-local pixels so on-canvas
    // chrome (countdown bar, hint labels) can keep clear of the score row
    // and the iOS Dynamic Island that sits above it.
    const hudEl = document.querySelector<HTMLElement>(".hud");
    if (hudEl) {
      const hudRect = hudEl.getBoundingClientRect();
      this.topInset = Math.max(0, hudRect.bottom - rect.top + 8);
    } else {
      this.topInset = 0;
    }
    // playerY is the rail Y — the line on which the player's lowest pixel
    // sits, just above the very bottom of the canvas.
    this.playerY = this.boardOriginY + this.boardHeight - RAIL_BOTTOM_INSET;

    // Re-center / re-size the player after layout. setCenter places the CoM
    // at this y; the next clampToRail in the update loop will pull it up so
    // the bounds touch the rail. Preserve any active tiny/big scale so a
    // resize mid-effect doesn't pop the player back to full size.
    this.player.setHexSize(this.hexSize * this.playerHexScale);
    this.player.setCenter(this.boardOriginX + this.boardWidth / 2, this.playerY - this.hexSize);

    // Regenerate starfield to fit the new canvas dimensions. Three planes
    // at the current density tier: a faint deep plane of pinprick stars, a
    // back plane of small dim ones, and a sparser front plane of brighter
    // ones that parallax further when the player moves.
    this.regenerateStarfield(cssW, cssH);

    // Nebula tiles vertically; size it to the canvas so a single tile
    // covers the screen and we can wrap by drawing twice with a y offset.
    this.nebulaCanvas = generateNebula(cssW, cssH);
  }

  private updateStarTier(): void {
    let tier = 0;
    for (const t of STAR_TIER_THRESHOLDS) {
      if (this.score >= t) tier += 1;
    }
    if (tier !== this.starTier) {
      this.starTier = tier;
      const rect = this.canvas.getBoundingClientRect();
      this.regenerateStarfield(Math.max(1, rect.width), Math.max(1, rect.height));
    }
  }

  private regenerateStarfield(cssW: number, cssH: number): void {
    // Density multiplier per tier — tier 0 is already a touch denser than
    // before to make the starfield more prominent at the start; each tier
    // adds another layer of richness that peaks at score 600.
    const tierMul = 1 + this.starTier * 0.45;
    const area = cssW * cssH;
    this.starsDeep = generateStars(
      cssW,
      cssH,
      Math.round((area / 2200) * tierMul),
      0.25,
      0.6,
      0.15,
    );
    this.starsBack = generateStars(
      cssW,
      cssH,
      Math.round((area / 3600) * tierMul),
      0.4,
      1.0,
      0.4,
    );
    this.starsFront = generateStars(
      cssW,
      cssH,
      Math.round((area / 9000) * tierMul),
      0.9,
      1.9,
      0.7,
    );
  }

  private drawStarfield(canvasW: number, canvasH: number): void {
    const ctx = this.ctx;
    // Parallax driver: how far the player is from the centre of the rail,
    // normalised to [-1, 1]. Negative = left, positive = right.
    const cx = this.boardOriginX + this.boardWidth / 2;
    const halfW = this.boardWidth / 2;
    const offset = Math.max(-1, Math.min(1, halfW > 0 ? (this.player.body.position.x - cx) / halfW : 0));

    drawStarLayer(
      ctx,
      this.starsDeep,
      canvasW,
      canvasH,
      -offset * PARALLAX_DEEP,
      this.starScrollY * STAR_SCROLL_DEEP,
      "#5b6da0",
    );

    // Nebula sits between the deep + back planes so foreground stars still
    // sparkle on top of it. Drawn twice so the tile wraps smoothly.
    if (this.nebulaCanvas && this.nebulaIntensity > 0.01) {
      const neb = this.nebulaCanvas;
      const tileH = neb.height;
      const sy = ((this.nebulaScrollY * NEBULA_SCROLL_SPEED) % tileH + tileH) % tileH;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.max(0, Math.min(1, this.nebulaIntensity));
      ctx.drawImage(neb, 0, sy - tileH);
      ctx.drawImage(neb, 0, sy);
      ctx.restore();
    }

    drawStarLayer(
      ctx,
      this.starsBack,
      canvasW,
      canvasH,
      -offset * PARALLAX_BACK,
      this.starScrollY * STAR_SCROLL_BACK,
      "#9fb4e6",
    );
    drawStarLayer(
      ctx,
      this.starsFront,
      canvasW,
      canvasH,
      -offset * PARALLAX_FRONT,
      this.starScrollY * STAR_SCROLL_FRONT,
      "#ffffff",
    );
  }

  private render(dt: number): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Two-plane parallax starfield, drawn first so everything else covers it.
    this.drawStarfield(rect.width, rect.height);

    // Board background — translucent so the starfield (and nebula at
    // higher scores) reads through the play area rather than being a
    // near-opaque slab on top of it.
    ctx.fillStyle = "rgba(14, 17, 36, 0.45)";
    ctx.fillRect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);

    // Wall panels: dim slabs slide in from the sides while a wall is active.
    this.drawWalls(ctx);

    // Side-entry warnings: glowing tabs at the play-area edge announcing
    // a cluster about to fly in horizontally.
    if (this.sideWarnings.length > 0) this.drawSideWarnings(ctx);

    // Challenge progress bar (left edge, fills bottom-up).
    if (this.gameMode === "challenge" && this.activeChallenge && (this.state === "playing" || this.state === "paused")) {
      this.drawChallengeProgress(ctx);
    }

    // Bottom rail line where the player sits.
    ctx.strokeStyle = "rgba(180, 200, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.boardOriginX, this.playerY + 1);
    ctx.lineTo(this.boardOriginX + this.boardWidth, this.playerY + 1);
    ctx.stroke();

    // Clip falling clusters and debris to the board area so nothing renders
    // in the margins after a piece falls past the bottom.
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.boardOriginX, this.boardOriginY, this.boardWidth, this.boardHeight);
    ctx.clip();

    for (const d of this.debris) d.draw(ctx, this.hexSize);
    for (const c of this.clusters) c.draw(ctx, this.hexSize, dt, this.timeEffect);
    this.drawDrones();

    ctx.restore();

    // Skip drawing the player after game-over — the body has been removed
    // from the world and replaced with debris that's already animating.
    // Also skip during the editor wave-preview loop (no player exists in
    // that simulation, just clusters falling).
    if (this.state !== "gameover" && !this.editorDialogPreview) {
      this.drawShield();
      this.drawBigAura();
      this.player.draw(ctx);
      this.drawSticksInFlight();
    }

    // Big first-appearance hint label above each cluster that carries
    // one. Drawn outside the board clip so it can hover above the play
    // area when the cluster is near the top.
    this.drawClusterHints();

    // Rotate-gesture tutorial (only fires once per page session).
    this.drawRotateTutorial();

    // 3-2-1 resume countdown after unpause. Drawn on top of the play
    // field so the player has a clear visual cue before action restarts.
    this.drawResumeCountdown();

    // Floating score popups (+5 on coin pickup, 3X on fast pickup).
    this.drawFloaters();

    // Time-effect HUD: a small countdown bar at the top of the play area,
    // with an extra "{N}X · +M" line just under it while fast is active so
    // the player can see the multiplier and the running bonus pool grow.
    // Skip while game-over so a dead-during-slow-mo run doesn't leave the
    // bar lingering above the GAME OVER screen.
    if (this.state !== "gameover") {
      const w = this.boardWidth * 0.95;
      const x0 = this.boardOriginX + (this.boardWidth - w) / 2;
      let yRow = this.boardOriginY + this.topInset + 6;
      const cx = this.boardOriginX + this.boardWidth / 2;
      const fontSize = Math.max(20, Math.round(this.hexSize * 1.05));

      const drawBar = (
        frac: number,
        color: string,
        label: string | null,
        labelGlow: string,
        labelFill: string,
        labelStroke: string,
      ) => {
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(x0, yRow, w, 6);
        ctx.fillStyle = color;
        ctx.fillRect(x0, yRow, w * Math.max(0, Math.min(1, frac)), 6);
        if (label) {
          ctx.save();
          ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.shadowColor = labelGlow;
          ctx.shadowBlur = 12;
          ctx.fillStyle = labelFill;
          ctx.fillText(label, cx, yRow + 12);
          ctx.shadowBlur = 0;
          ctx.lineWidth = 2;
          ctx.strokeStyle = labelStroke;
          ctx.strokeText(label, cx, yRow + 12);
          ctx.restore();
          yRow += 12 + fontSize + 4;
        } else {
          yRow += 12;
        }
      };

      if (this.timeEffect !== null) {
        const frac = this.timeEffectTimer / this.timeEffectMax;
        const color = this.timeEffect === "slow" ? "#ffd76b" : "#7fe89c";
        const fastLabel =
          this.timeEffect === "fast"
            ? `${this.fastMultiplier()}X · +${this.fastBonus}`
            : null;
        drawBar(
          frac,
          color,
          fastLabel,
          "rgba(120, 255, 170, 0.95)",
          "#c8ffd5",
          "rgba(0, 60, 20, 0.85)",
        );
      }
      if (this.bigTimer > 0) {
        const frac = this.bigTimer / this.bigMax;
        const label = `${this.bigMultiplier()}X · +${this.bigBonus}`;
        drawBar(
          frac,
          "#9b3df0",
          label,
          "rgba(180, 100, 255, 0.95)",
          "#dab8ff",
          "rgba(40, 10, 80, 0.85)",
        );
      }
      if (this.tinyTimer > 0) {
        const frac = this.tinyTimer / this.tinyMax;
        drawBar(
          frac,
          "#1ee0ff",
          null,
          "rgba(60, 230, 255, 0.95)",
          "#c8fbff",
          "rgba(0, 60, 80, 0.85)",
        );
      }
    }
  }
}

// Help-text strings for editor form fields. Surfaced via small (i)
// FIELD_HELP + helpTipHtml moved to src/ui/components/helpTip.ts so
// screen modules can import directly. composeWaveLine moved to
// waveDsl.ts (Phase 1.6) so it lives next to its inverse parseWaveLine.

// Hard cap on rows in the Custom Wave editor. Each row maps to one slot
// token in the DSL output (skipped rows emit "000").
// IOS_SHARE_GLYPH_SVG moved to src/ui/components/icons.ts in Phase 2.

const CUSTOM_WAVE_LEN = 30;

const CUSTOM_WAVE_KINDS: ClusterKind[] = [
  "normal", "sticky", "slow", "fast", "coin", "shield", "drone", "tiny", "big",
];

const WALL_CYCLE: WallKind[] = ["none", "pinch", "zigzag", "narrow"];

// checkWaveLine moved to waveDsl.ts so it lives next to parseWaveLine.

// Parse a wave DSL line and project its weights into a 7-key %-summing
// map. Used when opening the wave dialog on an existing wave so the
// cluster mix block reflects the wave's current weights.
function parseLineToMix(line: string): Partial<Record<ClusterKind, number>> {
  const KINDS: ClusterKind[] = ["normal", "sticky", "slow", "fast", "coin", "shield", "drone", "tiny", "big"];
  const out: Partial<Record<ClusterKind, number>> = {};
  for (const k of KINDS) out[k] = 0;
  let parsed: ParsedWave | null = null;
  try { parsed = parseWaveLine(line); } catch { /* fall through */ }
  if (!parsed) {
    out.normal = 100;
    return out;
  }
  const weights = parsed.weights;
  let sum = 0;
  for (const k of KINDS) sum += weights[k] ?? 0;
  if (sum === 0) {
    out.normal = 100;
    return out;
  }
  let rounded = 0;
  for (const k of KINDS) {
    const v = Math.round(((weights[k] ?? 0) / sum) * 100);
    out[k] = v;
    rounded += v;
  }
  // Dump rounding remainder onto normal so the row still totals 100.
  out.normal = Math.max(0, (out.normal ?? 0) + 100 - rounded);
  return out;
}


// angleToCssRotation moved to src/ui/components/angles.ts so screen
// modules can import directly.

// Clamp a numeric value into [min, max] and round to the nearest
// `step`. Used by the Advanced steppers so each bump lands on a clean
// value (e.g., speed 1.20 → 1.25, never 1.249999).
function clampRound(v: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, v));
  const snapped = Math.round(clamped / step) * step;
  // Avoid float jitter — snap to step's decimal precision.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(snapped.toFixed(decimals));
}

// Escape a string for safe inclusion inside a `[attr="..."]`
// CSS attribute selector. Only `\` and `"` need escaping per the
// CSS spec; we encode them as the spec's `\HEX ` form so any value
// (including custom-challenge ids that contain `:` or hex digits)
// can be looked up via querySelector without selector parse errors.
function cssAttrEscape(s: string): string {
  return s.replace(/["\\]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

// escapeHtml moved to src/ui/escape.ts in Phase 2.

// Render a single block icon into the given canvas, mirroring the in-game
// look so the BLOCKS guide stays visually consistent with the actual
// clusters: hex outline for "normal", a glowing blob for the helpful
// kinds, an ellipsoidal coin face for "coin".
// Paint a polyhex preview for the cell picker's size buttons. Pickup
// kinds (coin / shield / drone) are always single-cell regardless of
// `size`. Other kinds render their actual N-cell polyhex via
// buildPolyhexShape (deterministic per (kind, size) so the same size
// button always shows the same shape).
function drawClusterShapeIcon(canvas: HTMLCanvasElement, kind: ClusterKind, size: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const isPickup = kind === "coin" || kind === "shield" || kind === "drone";
  if (isPickup || size <= 1) {
    drawBlockIcon(canvas, kind);
    return;
  }
  const shape = buildPolyhexShape(size, mulberry32(0x42 + size));
  // Compute bounding box in pixel coords so we can centre + scale.
  const SQRT3 = Math.sqrt(3);
  const pts = shape.map((c) => ({
    x: SQRT3 * (c.q + c.r / 2),
    y: 1.5 * c.r,
  }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  // The bounding box is in units of "1 hex size". Add hex radius (1)
  // worth of margin on each side so cells don't clip at the edge.
  const bbW = maxX - minX + SQRT3;
  const bbH = maxY - minY + 2;
  const scale = Math.min((w * 0.78) / bbW, (h * 0.78) / bbH);
  const hexR = scale;
  const cxOff = w / 2 - ((minX + maxX) / 2) * scale;
  const cyOff = h / 2 - ((minY + maxY) / 2) * scale;
  for (const p of pts) {
    const px = cxOff + p.x * scale;
    const py = cyOff + p.y * scale;
    paintCellOnCanvas(ctx, px, py, hexR, kind);
  }
}

// Paint a single cluster cell (hex / coin disc / blob) at (cx, cy).
// Mirrors drawBlockIcon's per-kind branches but parameterised by the
// hex radius so the polyhex preview stays in scale.
function paintCellOnCanvas(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  kind: ClusterKind,
): void {
  if (kind === "coin") {
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    grad.addColorStop(0, "#fff1c2");
    grad.addColorStop(0.45, "#ffb255");
    grad.addColorStop(1, "#a14e08");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 240, 200, 0.95)";
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  if (kind === "normal") {
    pathHex(ctx, cx, cy, r);
    const grad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    grad.addColorStop(0, "#aac4ff");
    grad.addColorStop(1, "#5b8bff");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#1c2348";
    ctx.stroke();
    return;
  }
  // Helpful kinds — small blob.
  const palette = blobPalette(kind);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6);
  halo.addColorStop(0, palette.haloInner);
  halo.addColorStop(0.55, palette.haloMid);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const core = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r * 0.85);
  core.addColorStop(0, palette.coreLight);
  core.addColorStop(1, palette.coreDark);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// drawBlockIcon moved to src/ui/components/blockIcon.ts in Phase 2.

// difficultyTint moved to src/ui/components/blockIcon.ts in Phase 2.

function generateStars(
  w: number,
  h: number,
  count: number,
  minR: number,
  maxR: number,
  minA: number,
): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: minR + Math.random() * (maxR - minR),
      a: minA + Math.random() * (1 - minA),
    });
  }
  return out;
}

// Pre-render a tile of soft coloured nebula blobs into an offscreen canvas.
// Blobs are kept clear of the top + bottom edges so the tile wraps
// vertically without a visible seam. Cool/warm colours are mixed with the
// `lighter` composite so they read as glow rather than paint.
function generateNebula(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const cx = c.getContext("2d");
  if (!cx) return c;
  const blobs: Array<{ x: number; y: number; r: number; color: string }> = [
    { x: 0.18 * w, y: 0.30 * h, r: Math.min(w, h) * 0.42, color: "rgba(120, 80, 200, 0.55)" },
    { x: 0.78 * w, y: 0.55 * h, r: Math.min(w, h) * 0.50, color: "rgba(70, 150, 220, 0.45)" },
    { x: 0.45 * w, y: 0.78 * h, r: Math.min(w, h) * 0.36, color: "rgba(210, 90, 160, 0.42)" },
    { x: 0.62 * w, y: 0.20 * h, r: Math.min(w, h) * 0.30, color: "rgba(90, 200, 220, 0.35)" },
    { x: 0.30 * w, y: 0.62 * h, r: Math.min(w, h) * 0.28, color: "rgba(180, 110, 230, 0.30)" },
  ];
  cx.globalCompositeOperation = "lighter";
  for (const b of blobs) {
    const g = cx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, b.color);
    g.addColorStop(0.55, b.color.replace(/[0-9.]+\)$/, "0.10)"));
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

function drawStarLayer(
  ctx: CanvasRenderingContext2D,
  stars: Star[],
  canvasW: number,
  canvasH: number,
  shiftX: number,
  shiftY: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (const s of stars) {
    // Wrap horizontally + vertically so stars never disappear off one edge
    // as the parallax / scroll moves them past it; positive modulo trick
    // handles negative shifts.
    const sx = ((s.x + shiftX) % canvasW + canvasW) % canvasW;
    const sy = ((s.y + shiftY) % canvasH + canvasH) % canvasH;
    ctx.globalAlpha = s.a;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

