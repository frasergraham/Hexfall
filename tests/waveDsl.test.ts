import { describe, expect, it } from "vitest";
import { parseWaveLine, slotKindToPrefix, validateChallenge, ANGLE_TABLE } from "../src/waveDsl";
import { CHALLENGES } from "../src/challenges";

describe("parseWaveLine — basic key=value tokens", () => {
  it("parses size, rate, speed, count", () => {
    const w = parseWaveLine("size=2-3, rate=0.7, speed=1.2, count=10");
    expect(w.sizeMin).toBe(2);
    expect(w.sizeMax).toBe(3);
    expect(w.spawnInterval).toBe(0.7);
    expect(w.baseSpeedMul).toBe(1.2);
    expect(w.countCap).toBe(10);
  });

  it("size=N as a single value sets min=max=N", () => {
    const w = parseWaveLine("size=4, rate=0.5, count=5");
    expect(w.sizeMin).toBe(4);
    expect(w.sizeMax).toBe(4);
  });

  it("walls + wallAmp", () => {
    const w = parseWaveLine("size=2, rate=0.5, count=5, walls=zigzag, wallAmp=0.3");
    expect(w.walls).toBe("zigzag");
    expect(w.wallAmp).toBeCloseTo(0.3);
  });

  it("safeCol can be 'none' or a number", () => {
    expect(parseWaveLine("size=2, rate=0.5, count=5, safeCol=none").safeCol).toBe("none");
    expect(parseWaveLine("size=2, rate=0.5, count=5, safeCol=2").safeCol).toBe(2);
  });

  it("dur sets a wave time-cap", () => {
    const w = parseWaveLine("dur=8, rate=0.5, speed=1.0, size=1");
    expect(w.durOverride).toBe(8);
  });
});

describe("parseWaveLine — pct (cluster mix)", () => {
  it("parses kind:weight pairs", () => {
    const w = parseWaveLine("size=2, rate=0.5, count=10, pct=normal:60,coin:40");
    expect(w.weights.normal).toBe(60);
    expect(w.weights.coin).toBe(40);
  });

  it("includes tiny and big as valid kinds", () => {
    const w = parseWaveLine("size=2, rate=0.5, count=10, pct=normal:50,sticky:20,tiny:15,big:15");
    expect(w.weights.tiny).toBe(15);
    expect(w.weights.big).toBe(15);
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      parseWaveLine("size=2, rate=0.5, count=10, pct=normal:50,bogus:50"),
    ).toThrow();
  });
});

describe("parseWaveLine — slots", () => {
  it("parses 3-digit slots as normal-kind", () => {
    const w = parseWaveLine("count=0, slotRate=0.5, speed=1.2, 130,230,330");
    expect(w.slots.length).toBe(3);
    expect(w.slots[0]).toEqual({ size: 1, col: 3, angleIdx: 0, kind: "normal" });
    expect(w.slots[1]?.size).toBe(2);
    expect(w.slots[2]?.size).toBe(3);
  });

  it("000 is a skip (null entry)", () => {
    const w = parseWaveLine("count=0, slotRate=0.5, 130,000,230");
    expect(w.slots[1]).toBe(null);
  });

  it("kind-prefixed slots decode to the correct kind", () => {
    const w = parseWaveLine("count=0, slotRate=0.5, S130,C230,T330,B100");
    expect(w.slots[0]?.kind).toBe("sticky");
    expect(w.slots[1]?.kind).toBe("coin");
    expect(w.slots[2]?.kind).toBe("tiny");
    expect(w.slots[3]?.kind).toBe("big");
  });
});

describe("slotKindToPrefix", () => {
  it("round-trips with the parser's prefix table", () => {
    expect(slotKindToPrefix("normal")).toBe("");
    expect(slotKindToPrefix("sticky")).toBe("S");
    expect(slotKindToPrefix("coin")).toBe("C");
    expect(slotKindToPrefix("tiny")).toBe("T");
    expect(slotKindToPrefix("big")).toBe("B");
  });
});

describe("ANGLE_TABLE", () => {
  it("has 10 entries (indices 0-9)", () => {
    expect(ANGLE_TABLE.length).toBe(10);
  });
  it("index 0 = no tilt", () => {
    expect(ANGLE_TABLE[0]?.tilt).toBe(0);
  });
});

describe("validateChallenge — every shipped challenge parses + does something", () => {
  it("the entire CHALLENGES roster validates with no errors", () => {
    for (const def of CHALLENGES) {
      const errs = validateChallenge(def);
      expect(errs, `challenge ${def.id} (${def.name})`).toEqual([]);
    }
  });
});

describe("validateChallenge — failure modes", () => {
  it("flags 'wave does nothing' (no count, no slots, no dur)", () => {
    const errs = validateChallenge({
      id: "x-x",
      name: "test",
      block: 1,
      index: 1,
      difficulty: 1,
      waves: ["size=1, rate=0.5, speed=1.0"],
    });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("flags an unparseable line", () => {
    const errs = validateChallenge({
      id: "x-x",
      name: "test",
      block: 1,
      index: 1,
      difficulty: 1,
      waves: ["completely garbage line"],
    });
    expect(errs.length).toBeGreaterThan(0);
  });
});
