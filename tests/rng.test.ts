import { describe, expect, it } from "vitest";
import { mulberry32, hashSeed } from "../src/rng";

describe("mulberry32", () => {
  it("returns a function whose outputs lie in [0, 1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is seedable: same seed produces the same sequence", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("is independent: different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a() !== b()) differences++;
    }
    expect(differences).toBeGreaterThan(95);
  });

  it("handles seed=0 without falling into a degenerate cycle", () => {
    const r = mulberry32(0);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(r());
    expect(seen.size).toBeGreaterThan(95);
  });

  it("handles negative seeds (gets coerced to uint32)", () => {
    const a = mulberry32(-1);
    const b = mulberry32(0xffffffff);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
});

describe("hashSeed", () => {
  it("empty string → FNV-1a offset basis", () => {
    expect(hashSeed("")).toBe(0x811c9dc5);
  });

  it("returns a uint32 (>=0, <2^32)", () => {
    for (const s of ["", "a", "test", "challenge:5-3", "🌟"]) {
      const h = hashSeed(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(hashSeed("hex-rain")).toBe(hashSeed("hex-rain"));
  });

  it("differs for different inputs", () => {
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    expect(hashSeed("3-4")).not.toBe(hashSeed("3-5"));
  });
});
