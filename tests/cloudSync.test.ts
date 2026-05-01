// Round-trip + co-write tests for `cloudSync.writeLocalProgressFromCloud`
// and `challenges.ts:save()`. Both write to the same key
// (`STORAGE_KEYS.challengeProgress`) so the two paths must agree on the
// shape and not corrupt each other.

import { beforeEach, describe, expect, it } from "vitest";
import { writeLocalProgressFromCloud } from "../src/cloudSync";
import {
  loadChallengeProgress,
  saveChallengeBest,
  saveChallengeCompletion,
  type ChallengeProgress,
} from "../src/challenges";
import { STORAGE_KEYS } from "../src/storageKeys";

beforeEach(() => {
  for (const k of Object.values(STORAGE_KEYS)) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
});

describe("cloudSync writeLocalProgressFromCloud + challenges.save round-trip", () => {
  it("cloud-shaped payload survives a load via challenges.loadChallengeProgress", () => {
    // unlockedBlocks is derived from `completed` on every load, so the
    // cloud payload should ship a `completed` set that justifies the
    // unlocks rather than carrying both fields independently.
    const cloud: ChallengeProgress = {
      v: 1,
      best: { "1-1": 250, "1-2": 250, "1-3": 250, "2-3": 1000 },
      bestPct: { "1-1": 75, "2-3": 100 },
      stars: { "1-1": 2, "2-3": 3 },
      completed: ["1-1", "1-2", "1-3", "2-3"],
      unlockedBlocks: [1, 2],
      purchasedUnlock: false,
    };
    writeLocalProgressFromCloud(JSON.stringify(cloud), Date.now());
    const reloaded = loadChallengeProgress();
    expect(reloaded.best).toEqual(cloud.best);
    expect(reloaded.bestPct).toEqual(cloud.bestPct);
    expect(reloaded.stars).toEqual(cloud.stars);
    expect(reloaded.completed).toEqual(cloud.completed);
    // 3 completes in block 1 trips the unlock for block 2.
    expect(reloaded.unlockedBlocks).toContain(2);
    expect(reloaded.purchasedUnlock).toBe(false);
  });

  it("a local save after a cloud pull preserves the cloud values it didn't touch", () => {
    // Cloud seeds completes on block-1 challenges so block 2 is unlocked.
    writeLocalProgressFromCloud(JSON.stringify({
      v: 1,
      best: { "1-1": 500, "1-2": 500, "1-3": 500 },
      bestPct: { "1-1": 100, "1-2": 100, "1-3": 100 },
      stars: { "1-1": 3, "1-2": 3, "1-3": 3 },
      completed: ["1-1", "1-2", "1-3"],
      unlockedBlocks: [1, 2],
      purchasedUnlock: false,
    }), Date.now());
    // Local then improves on a different challenge.
    saveChallengeCompletion("2-1", 300, 2);
    const merged = loadChallengeProgress();
    expect(merged.best["1-1"]).toBe(500);
    expect(merged.best["2-1"]).toBe(300);
    expect(merged.completed).toEqual(["1-1", "1-2", "1-3", "2-1"]);
    expect(merged.unlockedBlocks).toContain(1);
    expect(merged.unlockedBlocks).toContain(2);
  });

  it("a malformed cloud payload is a no-op (never corrupts local)", () => {
    saveChallengeBest("1-1", 100, 0.5);
    writeLocalProgressFromCloud("{not json", Date.now());
    expect(loadChallengeProgress().best["1-1"]).toBe(100);
  });

  it("a cloud payload with the wrong v is rejected", () => {
    saveChallengeBest("1-1", 100, 0.5);
    writeLocalProgressFromCloud(JSON.stringify({ v: 99, best: { "1-1": 9999 } }), Date.now());
    expect(loadChallengeProgress().best["1-1"]).toBe(100);
  });
});
