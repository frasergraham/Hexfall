// Polyfills for the jsdom test environment so Game can be constructed
// without throwing on missing browser APIs.
//
// Game touches: canvas 2D context (drawing math), requestAnimationFrame
// (drives the loop, deterministically replaced here), ResizeObserver
// (no-op so resize callbacks never fire spuriously), localStorage
// (jsdom provides one but we wipe it between tests), and a few audio
// shims so audio.ts doesn't blow up at import time.

import { afterEach, beforeEach, vi } from "vitest";

// ----- requestAnimationFrame: deterministic, manual ----------------------
//
// Tests that want to step the loop call advanceFrames(n) instead of relying
// on real wall-clock RAF. Each "frame" advances 16ms.

let pendingRafCallbacks: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;
let mockNow = 0;

(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  const id = nextRafId++;
  pendingRafCallbacks.push({ id, cb });
  return id;
};
(globalThis as any).cancelAnimationFrame = (id: number) => {
  pendingRafCallbacks = pendingRafCallbacks.filter((p) => p.id !== id);
};
(globalThis as any).performance = globalThis.performance ?? { now: () => mockNow };
const origNow = performance.now.bind(performance);
vi.stubGlobal("performance", {
  ...performance,
  now: () => mockNow,
});
// Save reference so tests can restore wall-clock if they need it.
(globalThis as any).__realPerformanceNow = origNow;

export function advanceFrames(frames: number, dtMs = 16): void {
  for (let i = 0; i < frames; i++) {
    mockNow += dtMs;
    const batch = pendingRafCallbacks;
    pendingRafCallbacks = [];
    for (const { cb } of batch) cb(mockNow);
  }
}

export function resetMockTime(): void {
  mockNow = 0;
  pendingRafCallbacks = [];
  nextRafId = 1;
}

// ----- ResizeObserver / matchMedia: no-ops --------------------------------

(globalThis as any).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

if (!globalThis.matchMedia) {
  (globalThis as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// ----- Canvas 2D context: minimal stub ------------------------------------
//
// Returns an object with every CanvasRenderingContext2D method we know the
// game uses, all as no-ops. Drawing math runs but nothing is rasterised.

function makeStubContext(): unknown {
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 0, height: 0 },
      lineWidth: 1,
      strokeStyle: "#000",
      fillStyle: "#000",
      globalAlpha: 1,
      shadowBlur: 0,
      shadowColor: "rgba(0,0,0,0)",
      lineCap: "butt",
      lineJoin: "miter",
      font: "10px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      filter: "none",
      imageSmoothingEnabled: true,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      measureText: () => ({ width: 0 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: noop,
      drawImage: noop,
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return (target as any)[prop];
        // Any other method (beginPath, moveTo, fill, stroke, save, etc.) is a no-op.
        return noop;
      },
      set(target, prop, value) {
        (target as any)[prop] = value;
        return true;
      },
    },
  );
}

(globalThis as any).HTMLCanvasElement.prototype.getContext = function () {
  return makeStubContext() as CanvasRenderingContext2D;
};

// ----- AudioContext: minimal stub so audio.ts imports cleanly -------------

class StubAudio {
  src = "";
  loop = false;
  volume = 1;
  preload = "";
  currentTime = 0;
  paused = true;
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void {}
  cloneNode(): StubAudio { return new StubAudio(); }
  addEventListener(): void {}
  removeEventListener(): void {}
}
(globalThis as any).Audio = StubAudio;

// ----- localStorage --------------------------------------------------------
//
// jsdom in vitest 4 ships a half-broken localStorage that needs a CLI
// flag to be persistent (and warns about it on every run). Replace it
// with a simple Map-backed shim so all tests get a fresh, predictable
// storage between runs.

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  get: () => memoryStorage,
});

// ----- Per-test cleanup ---------------------------------------------------

beforeEach(() => {
  resetMockTime();
  memoryStorage.clear();
});

afterEach(() => {
  resetMockTime();
});
