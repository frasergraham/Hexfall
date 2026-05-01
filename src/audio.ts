// Audio module: persists SFX / music prefs and plays UI / gameplay
// sounds via the Web Audio API.
//
// Web Audio gives us sub-millisecond latency and free concurrent
// playback (each source is one-shot), unlike HTMLAudioElement which
// goes through the media pipeline and lags by tens of ms in Safari.
//
// Critical Safari constraint: the AudioContext must be created inside
// a user gesture. Creating it at module load (or any background path)
// risks the context being permanently locked into a state where
// resume() silently no-ops with no error. We defer creation to the
// first playSfx() call, which is always invoked from a click /
// keypress / collision-during-active-tab handler.
//
// Music playback is stubbed for now — the toggle is wired so once a
// track is added we can flip it on without touching call sites.

import clickUrl from "./assets/audio/click.mp3?url";
import shieldUrl from "./assets/audio/shield.mp3?url";
import droneUrl from "./assets/audio/drone.mp3?url";
import slowDownUrl from "./assets/audio/slow_down.mp3?url";
import slowUpUrl from "./assets/audio/slow_up.mp3?url";
import fastUpUrl from "./assets/audio/fast_up.mp3?url";
import gameoverUrl from "./assets/audio/gameover.mp3?url";
import coinUrl from "./assets/audio/coin.mp3?url";
import healUrl from "./assets/audio/heal.mp3?url";
import impact0Url from "./assets/audio/impact_0.mp3?url";
import impact1Url from "./assets/audio/impact_1.mp3?url";
import impact2Url from "./assets/audio/impact_2.mp3?url";
import impact3Url from "./assets/audio/impact_3.mp3?url";
import impact4Url from "./assets/audio/impact_4.mp3?url";
import musicGameUrl from "./assets/audio/music_game.mp3?url";

import { loadBool, saveBool } from "./storage";
import { STORAGE_KEYS } from "./storageKeys";

type SfxName =
  | "click"
  | "impact"
  | "shield"
  | "drone"
  | "slow_down"
  | "slow_up"
  | "fast_up"
  | "gameover"
  | "coin"
  | "heal";

const SFX_URLS: Record<SfxName, string[]> = {
  click: [clickUrl],
  impact: [impact0Url, impact1Url, impact2Url, impact3Url, impact4Url],
  shield: [shieldUrl],
  drone: [droneUrl],
  slow_down: [slowDownUrl],
  slow_up: [slowUpUrl],
  fast_up: [fastUpUrl],
  gameover: [gameoverUrl],
  coin: [coinUrl],
  heal: [healUrl],
};

const SFX_VOLUME = 0.6;
const MUSIC_VOLUME = 0.18;
// Fade in/out length when music starts/stops, so toggles and game
// state transitions don't pop.
const MUSIC_FADE = 0.4;

// Default to ON when the key is missing — the loadBool wrapper
// returns the fallback both for "missing" and "storage broken".
let sfxOn = loadBool(STORAGE_KEYS.sfx, true);
let musicOn = loadBool(STORAGE_KEYS.music, true);

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
// Tracks game-side intent: true after startMusic(), false after
// stopMusic(). Survives the music toggle so flipping music back on
// during a run resumes correctly.
let musicWanted = false;
const buffers = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<AudioBuffer>>();

// iOS WKWebView interrupts the audio session when the app backgrounds,
// gets a phone call, hears Siri, etc. After foregrounding the context
// often reports "running" again but the underlying render graph is
// dead — SFX play silently and music stays muted. The only reliable
// fix is to tear down whenever we were actually hidden, so the next
// user gesture (or music intent) rebuilds against a fresh graph.
let wasHidden = false;
async function tryResumeOnForeground(): Promise<void> {
  const dirty = wasHidden;
  wasHidden = false;
  if (!ctx) return;
  if (dirty) {
    tearDownContext();
  } else if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
  // Music intent survives teardown; restart it now (creates a fresh
  // ctx if needed). SFX rebuilds lazily on the next playSfx().
  if (musicWanted && musicOn) {
    void startMusicInternal();
  }
}

function tearDownContext(): void {
  if (musicSource) {
    try { musicSource.stop(); } catch { /* ignore */ }
    try { musicSource.disconnect(); } catch { /* ignore */ }
    musicSource = null;
  }
  if (ctx) {
    try { void ctx.close(); } catch { /* ignore */ }
  }
  ctx = null;
  sfxGain = null;
  musicGain = null;
  // Decoded buffers belong to the closed context — drop them so the
  // new context decodes its own from the cached fetches.
  buffers.clear();
  inflight.clear();
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) wasHidden = true;
    else void tryResumeOnForeground();
  });
  window.addEventListener("pagehide", () => { wasHidden = true; });
  window.addEventListener("blur", () => { wasHidden = true; });
  // pageshow fires on bfcache restore (iOS sometimes uses it instead of
  // visibilitychange when returning from the app switcher).
  window.addEventListener("pageshow", () => { void tryResumeOnForeground(); });
  window.addEventListener("focus", () => { void tryResumeOnForeground(); });
}

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  sfxGain = ctx.createGain();
  sfxGain.gain.value = SFX_VOLUME;
  sfxGain.connect(ctx.destination);
  musicGain = ctx.createGain();
  // Start at 0 so the first startMusic() can ramp in cleanly.
  musicGain.gain.value = 0;
  musicGain.connect(ctx.destination);
  return ctx;
}

async function loadBuffer(url: string): Promise<AudioBuffer> {
  const cached = buffers.get(url);
  if (cached) return cached;
  const pending = inflight.get(url);
  if (pending) return pending;
  const c = getCtx();
  if (!c) throw new Error("Web Audio not available");
  const p = (async () => {
    const res = await fetch(url);
    const bytes = await res.arrayBuffer();
    const buf = await c.decodeAudioData(bytes);
    buffers.set(url, buf);
    return buf;
  })();
  inflight.set(url, p);
  return p;
}

function preloadAllBuffers(): void {
  for (const urls of Object.values(SFX_URLS)) {
    for (const url of urls) {
      if (!buffers.has(url)) void loadBuffer(url).catch(() => { /* ignore */ });
    }
  }
}

// Public no-op kept for API compat. Real preload happens after the
// first user gesture creates the AudioContext.
export function preloadSfx(): void { /* deferred to first gesture */ }

export function playSfx(name: SfxName): void {
  if (!sfxOn) return;
  // Detect a dead / wedged context (iOS audio session interrupted, or
  // a previous close()) and rebuild fresh inside this user gesture.
  // This is the fix for "audio disappears after backgrounding" on
  // Capacitor / WKWebView.
  if (ctx && (ctx.state === "closed" || ctx.state === ("interrupted" as AudioContextState))) {
    tearDownContext();
    if (musicWanted && musicOn) void startMusicInternal();
  }
  const fresh = ctx === null;
  const c = getCtx();
  const gain = sfxGain;
  if (!c || !gain) return;
  if (fresh) preloadAllBuffers();

  const urls = SFX_URLS[name];
  const url = urls[Math.floor(Math.random() * urls.length)];

  const fire = () => {
    const buf = buffers.get(url);
    if (!buf) {
      void loadBuffer(url).catch(() => { /* ignore */ });
      return;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(0);
  };

  // Browser may start the context suspended even when created in a
  // gesture (especially the very first time). resume() is async, so
  // await it before scheduling the source — otherwise the first sound
  // plays into a paused graph and is silent.
  if (c.state === "suspended") {
    void c.resume().then(fire);
  } else {
    fire();
  }
}

export function isSfxOn(): boolean { return sfxOn; }
export function isMusicOn(): boolean { return musicOn; }

export function setSfxOn(on: boolean): void {
  sfxOn = on;
  saveBool(STORAGE_KEYS.sfx, on);
}

export function setMusicOn(on: boolean): void {
  musicOn = on;
  saveBool(STORAGE_KEYS.music, on);
  // Apply to a currently-running music phase: turning music off fades
  // out; turning back on while still in-game (musicWanted) fades back in.
  if (on && musicWanted) {
    void startMusicInternal();
  } else if (!on) {
    fadeMusicGain(0);
  }
}

// Game-side: declare intent to play music. Idempotent.
export function startMusic(): void {
  musicWanted = true;
  if (!musicOn) return;
  void startMusicInternal();
}

// Game-side: declare intent to stop music. Fades out; the source stays
// alive so a subsequent startMusic() can fade right back in without
// re-decoding.
export function stopMusic(): void {
  musicWanted = false;
  fadeMusicGain(0);
}

// Adjust music tempo. Pass effectiveScale (1 = normal, 0.5 = slow,
// 1.25+ = fast). The source's playbackRate also pitch-shifts the
// audio, but for an ambient rhythmic track that lands as "tape stretch"
// which fits the slow-mo / speed-up game feel.
export function setMusicSpeed(rate: number): void {
  if (!musicSource || !ctx) return;
  const target = Math.max(0.25, Math.min(rate, 2));
  musicSource.playbackRate.setTargetAtTime(target, ctx.currentTime, 0.6);
}

async function startMusicInternal(): Promise<void> {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    try { await c.resume(); } catch { /* ignore */ }
  }
  // Lazy-create the looping source on first start. We keep it alive
  // across stop/start cycles — gain ramping handles audible on/off.
  if (!musicSource) {
    try {
      const buf = await loadBuffer(musicGameUrl);
      // Race: a stopMusic() may have arrived during the await.
      if (!musicWanted || !musicOn) return;
      musicSource = c.createBufferSource();
      musicSource.buffer = buf;
      musicSource.loop = true;
      if (musicGain) musicSource.connect(musicGain);
      musicSource.start(0);
    } catch { /* ignore */ }
  }
  fadeMusicGain(MUSIC_VOLUME);
}

function fadeMusicGain(target: number): void {
  if (!ctx || !musicGain) return;
  const now = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  // setValueAtTime captures the current curve point so the linear ramp
  // starts from where we actually are, not from the previous setpoint.
  musicGain.gain.setValueAtTime(musicGain.gain.value, now);
  musicGain.gain.linearRampToValueAtTime(target, now + MUSIC_FADE);
}
