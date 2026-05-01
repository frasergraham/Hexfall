import { describe, expect, it, beforeEach } from "vitest";
import {
  loadBool,
  loadJson,
  loadString,
  removeKey,
  saveBool,
  saveJson,
  saveString,
} from "../src/storage";
import { STORAGE_KEYS } from "../src/storageKeys";

beforeEach(() => {
  // jsdom's localStorage in vitest 4 lacks .clear() in some configs;
  // remove keys we know we touched in this file instead.
  for (const k of [
    "test:str", "test:bool", "test:json",
    "missing", "kill", "bad",
    ...Object.values(STORAGE_KEYS),
  ]) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
});

describe("loadString / saveString", () => {
  it("round-trips a value", () => {
    saveString("test:str", "hello");
    expect(loadString("test:str")).toBe("hello");
  });

  it("returns the fallback when missing", () => {
    expect(loadString("missing", "default")).toBe("default");
    expect(loadString("missing")).toBe("");
  });
});

describe("loadBool / saveBool", () => {
  it("round-trips true and false", () => {
    saveBool("test:bool", true);
    expect(loadBool("test:bool")).toBe(true);
    saveBool("test:bool", false);
    expect(loadBool("test:bool")).toBe(false);
  });

  it("uses the fallback when missing", () => {
    expect(loadBool("missing", true)).toBe(true);
    expect(loadBool("missing", false)).toBe(false);
    expect(loadBool("missing")).toBe(false);
  });

  it("uses '1' / '0' on disk (compatible with legacy single-letter encoding)", () => {
    saveBool("test:bool", true);
    expect(localStorage.getItem("test:bool")).toBe("1");
    saveBool("test:bool", false);
    expect(localStorage.getItem("test:bool")).toBe("0");
  });
});

describe("loadJson / saveJson", () => {
  it("round-trips an object", () => {
    const obj = { a: 1, b: ["x", "y"], c: { nested: true } };
    saveJson("test:json", obj);
    expect(loadJson("test:json", null)).toEqual(obj);
  });

  it("returns the fallback when missing", () => {
    expect(loadJson("missing", { default: true })).toEqual({ default: true });
  });

  it("returns the fallback for malformed JSON", () => {
    localStorage.setItem("bad", "not-json{");
    expect(loadJson("bad", { fallback: true })).toEqual({ fallback: true });
  });
});

describe("removeKey", () => {
  it("removes the key", () => {
    saveString("kill", "me");
    removeKey("kill");
    expect(localStorage.getItem("kill")).toBe(null);
  });

  it("is silent when the key doesn't exist", () => {
    expect(() => removeKey("nope")).not.toThrow();
  });
});

describe("STORAGE_KEYS registry", () => {
  it("has unique values across every entry", () => {
    const values = Object.values(STORAGE_KEYS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("every key starts with 'hexrain.' (the app's namespace prefix)", () => {
    for (const k of Object.values(STORAGE_KEYS)) {
      expect(k.startsWith("hexrain.")).toBe(true);
    }
  });
});

describe("storage migration: pre-Phase-1 raw localStorage → new wrappers", () => {
  it("loads a string written by raw localStorage.setItem", () => {
    localStorage.setItem(STORAGE_KEYS.difficulty, "hard");
    expect(loadString(STORAGE_KEYS.difficulty)).toBe("hard");
  });

  it("loads a JSON blob written by raw localStorage.setItem", () => {
    const blob = { v: 1, score: 99 };
    localStorage.setItem(STORAGE_KEYS.challengeProgress, JSON.stringify(blob));
    expect(loadJson<typeof blob>(STORAGE_KEYS.challengeProgress, { v: 1, score: 0 })).toEqual(blob);
  });

  it("loads a '1'/'0' bool written by raw localStorage.setItem", () => {
    localStorage.setItem(STORAGE_KEYS.sfx, "1");
    expect(loadBool(STORAGE_KEYS.sfx)).toBe(true);
    localStorage.setItem(STORAGE_KEYS.sfx, "0");
    expect(loadBool(STORAGE_KEYS.sfx)).toBe(false);
  });
});
