// Pinned determinism test. The REFACTOR.md plan calls this out as the
// canary for behaviour preservation: if the same seed stops producing
// the same RNG sequence (or the two mulberry32 implementations stop
// agreeing with each other), the gameplay determinism guarantee is
// broken and the refactor must be backed out.
//
// We hash the first 1024 outputs of each RNG into a stable string so
// the assertion is one tight equality check; the hash also makes the
// expected value easy to update when an intentional change lands
// (the diff would still need a written justification, per the plan).

import { describe, it, expect } from "vitest";
import { mulberry32 as rngMulberry32, hashSeed } from "../src/rng";
import { mulberry32 as hexMulberry32, hashString } from "../src/hex";

function fingerprint(rng: () => number, n = 1024): string {
  let acc = 0x811c9dc5;
  for (let i = 0; i < n; i++) {
    // Mix the IEEE-754 bits of each output into an FNV-1a-style hash.
    const v = rng();
    const u = (v * 0x100000000) >>> 0;
    acc = (acc ^ (u & 0xff)) >>> 0;
    acc = Math.imul(acc, 0x01000193) >>> 0;
    acc = (acc ^ ((u >>> 8) & 0xff)) >>> 0;
    acc = Math.imul(acc, 0x01000193) >>> 0;
    acc = (acc ^ ((u >>> 16) & 0xff)) >>> 0;
    acc = Math.imul(acc, 0x01000193) >>> 0;
    acc = (acc ^ ((u >>> 24) & 0xff)) >>> 0;
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  return acc.toString(16).padStart(8, "0");
}

describe("mulberry32 determinism", () => {
  it("rng.ts: seed 1 → pinned 1024-output fingerprint", () => {
    expect(fingerprint(rngMulberry32(1))).toMatchInlineSnapshot(`"fb87abb0"`);
  });

  it("rng.ts: seed 0 → pinned 1024-output fingerprint", () => {
    expect(fingerprint(rngMulberry32(0))).toMatchInlineSnapshot(`"51e861a0"`);
  });

  it("rng.ts: arbitrary seed 0xdeadbeef → pinned fingerprint", () => {
    expect(fingerprint(rngMulberry32(0xdeadbeef))).toMatchInlineSnapshot(`"fc58c0f4"`);
  });

  it("hex.ts: seed 1 → pinned 1024-output fingerprint", () => {
    expect(fingerprint(hexMulberry32(1))).toMatchInlineSnapshot(`"fb87abb0"`);
  });

  it("rng.ts and hex.ts: same seed → same fingerprint", () => {
    // Locks in today's behaviour (they ARE equivalent under int32-wrapping).
    // If a refactor unifies them, this assertion still holds.
    for (const seed of [0, 1, 42, 0xcafe, 0xdeadbeef, 0x12345678]) {
      expect(fingerprint(rngMulberry32(seed))).toBe(fingerprint(hexMulberry32(seed)));
    }
  });
});

describe("hashSeed / hashString stability", () => {
  it("hashSeed: known inputs → pinned outputs", () => {
    expect(hashSeed("")).toBe(0x811c9dc5);
    expect(hashSeed("a").toString(16)).toMatchInlineSnapshot(`"e40c292c"`);
    expect(hashSeed("hex-rain").toString(16)).toMatchInlineSnapshot(`"cda81933"`);
    expect(hashSeed("3-4").toString(16)).toMatchInlineSnapshot(`"cf487bab"`);
  });

  it("hashString in hex.ts uses same algorithm shape", () => {
    // Both implementations are FNV-1a with the same prime/offset.
    // hex.ts: 2166136261 >>> 0  ===  rng.ts: 0x811c9dc5
    expect(hashString("")).toBe(2166136261 >>> 0);
    // Stable across implementations for the same input.
    for (const s of ["", "a", "hex-rain", "3-4", "challenge:1-1"]) {
      expect(hashString(s)).toBe(hashSeed(s));
    }
  });
});
